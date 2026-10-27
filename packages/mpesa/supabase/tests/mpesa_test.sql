-- M-Pesa: request validation, one pending request per invoice, idempotent
-- callbacks, needs_review instead of overpaying, permissions, isolation.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create schema if not exists tests;
create or replace function tests.login(p_uid uuid, p_email text) returns void
language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'email', p_email)::text, true);
$$;
create or replace function tests.create_user(p_uid uuid, p_email text) returns void
language sql as $$
  insert into auth.users (instance_id, id, aud, role, email)
  values ('00000000-0000-0000-0000-000000000000', p_uid, 'authenticated', 'authenticated', p_email);
$$;
create or replace function tests.add_member(p_tenant uuid, p_uid uuid, p_email text, p_role text) returns void
language sql as $$
  insert into public.tenant_members (tenant_id, user_id, role_id, email)
  select p_tenant, p_uid, r.id, p_email from public.roles r where r.tenant_id = p_tenant and r.key = p_role;
$$;
-- A Daraja STK callback body.
create or replace function tests.stk(p_checkout text, p_code integer, p_amount numeric, p_receipt text) returns jsonb
language sql as $$
  select jsonb_build_object('Body', jsonb_build_object('stkCallback', jsonb_strip_nulls(jsonb_build_object(
    'MerchantRequestID', 'm-' || p_checkout,
    'CheckoutRequestID', p_checkout,
    'ResultCode', p_code,
    'ResultDesc', case p_code when 0 then 'The service request is processed successfully.'
                              when 1032 then 'Request cancelled by user' else 'Failed' end,
    'CallbackMetadata', case when p_code = 0 then jsonb_build_object('Item', jsonb_build_array(
      jsonb_build_object('Name', 'Amount', 'Value', p_amount),
      jsonb_build_object('Name', 'MpesaReceiptNumber', 'Value', p_receipt),
      jsonb_build_object('Name', 'PhoneNumber', 'Value', 254708374149))) end))));
$$;
create or replace function tests.hash(p_token text) returns text
language sql as $$ select encode(sha256(convert_to(p_token, 'UTF8')), 'hex'); $$;
grant usage on schema tests to anon, authenticated;
grant execute on all functions in schema tests to anon, authenticated;

select tests.create_user('a5000000-0000-0000-0000-000000000001', 'owner-a@mpesa.test');
select tests.create_user('a5000000-0000-0000-0000-000000000002', 'waiter-a@mpesa.test');
select tests.create_user('a5000000-0000-0000-0000-000000000003', 'viewer-a@mpesa.test');
select tests.create_user('b5000000-0000-0000-0000-000000000001', 'owner-b@mpesa.test');

select tests.login('a5000000-0000-0000-0000-000000000001', 'owner-a@mpesa.test');
select public.create_tenant('Pay A', 'pay-a');
select tests.login('b5000000-0000-0000-0000-000000000001', 'owner-b@mpesa.test');
select public.create_tenant('Pay B', 'pay-b');
select set_config('tests.a', (select id::text from public.tenants where slug = 'pay-a'), true);
select set_config('tests.b', (select id::text from public.tenants where slug = 'pay-b'), true);
select tests.add_member(current_setting('tests.a')::uuid, 'a5000000-0000-0000-0000-000000000002', 'waiter-a@mpesa.test', 'waiter');
select tests.add_member(current_setting('tests.a')::uuid, 'a5000000-0000-0000-0000-000000000003', 'viewer-a@mpesa.test', 'viewer');

-- Owner A issues a KES 1,000 invoice and a second one to void later.
select tests.login('a5000000-0000-0000-0000-000000000001', 'owner-a@mpesa.test');
set local role authenticated;
select set_config('tests.inv', (select id::text from public.issue_invoice(public.save_invoice_draft(
  current_setting('tests.a')::uuid, null, 'invoice', null, null, '',
  '[{"description": "Dinner", "quantity": 1, "unit_price_minor": 100000}]'::jsonb))), true);
select set_config('tests.inv2', (select id::text from public.issue_invoice(public.save_invoice_draft(
  current_setting('tests.a')::uuid, null, 'invoice', null, null, '',
  '[{"description": "Lunch", "quantity": 1, "unit_price_minor": 50000}]'::jsonb))), true);
select set_config('tests.draft', public.save_invoice_draft(
  current_setting('tests.a')::uuid, null, 'invoice', null, null, '',
  '[{"description": "Tea", "quantity": 1, "unit_price_minor": 5000}]'::jsonb)::text, true);
reset role;

select results_eq(
  $$select r.key from public.roles r join public.role_permissions rp on rp.role_id = r.id
    where r.tenant_id = current_setting('tests.a')::uuid and rp.permission_key = 'mpesa.request' order by r.key$$,
  $$values ('front_desk'::text), ('manager'), ('sales'), ('waiter')$$,
  'mpesa.request defaults: manager, front desk, waiter, sales'
);

-- ---------------------------------------------------------------------------
-- Starting requests (as a waiter).
-- ---------------------------------------------------------------------------
select tests.login('a5000000-0000-0000-0000-000000000002', 'waiter-a@mpesa.test');
set local role authenticated;
select throws_ok(
  $$select * from public.mpesa_start_request(current_setting('tests.draft')::uuid, 5000, '254708374149', tests.hash(repeat('d', 43)))$$,
  '22023', null, 'drafts cannot be paid by M-Pesa'
);
select throws_ok(
  $$select * from public.mpesa_start_request(current_setting('tests.inv')::uuid, 40050, '254708374149', tests.hash(repeat('d', 43)))$$,
  '22023', null, 'M-Pesa amounts are whole shillings'
);
select throws_ok(
  $$select * from public.mpesa_start_request(current_setting('tests.inv')::uuid, 100100, '254708374149', tests.hash(repeat('d', 43)))$$,
  '22023', 'Payment exceeds the balance due', 'requests cannot exceed the balance'
);
select throws_ok(
  $$select * from public.mpesa_start_request(current_setting('tests.inv')::uuid, 40000, '0708374149', tests.hash(repeat('d', 43)))$$,
  '22023', null, 'phones must already be in 2547XXXXXXXX form'
);
select results_eq(
  $$select account_reference, description from public.mpesa_start_request(
      current_setting('tests.inv')::uuid, 40000, '254708374149', tests.hash(repeat('a', 43)))$$,
  $$values ('INV00001'::text, 'Invoice INV-0'::text)$$,
  'a request returns Daraja''s account reference (max 12) and description (max 13)'
);
select set_config('tests.req', (select id::text from public.mpesa_requests where callback_token_hash = tests.hash(repeat('a', 43))), true);
select throws_ok(
  $$select * from public.mpesa_start_request(current_setting('tests.inv')::uuid, 40000, '254708374149', tests.hash(repeat('b', 43)))$$,
  '55000', null, 'only one request can wait per invoice'
);
select lives_ok(
  $$select public.mpesa_attach_checkout(current_setting('tests.req')::uuid, 'ws_CO_1', 'm-1')$$,
  'the checkout id is attached after the push'
);
select throws_ok(
  $$update public.mpesa_requests set status = 'succeeded'$$,
  '42501', null, 'clients cannot write requests directly'
);
reset role;

-- ---------------------------------------------------------------------------
-- The callback runs without a session (anon), like Safaricom calling in.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok(
  $$select public.mpesa_record_callback(repeat('z', 43), tests.stk('ws_CO_1', 0, 400, 'QAA1'))$$,
  'P0002', null, 'an unknown token is rejected'
);
select throws_ok(
  $$select public.mpesa_record_callback(repeat('a', 43), tests.stk('ws_CO_other', 0, 400, 'QAA1'))$$,
  '22023', null, 'a callback for another checkout is rejected'
);
select is(
  public.mpesa_record_callback(repeat('a', 43), tests.stk('ws_CO_1', 0, 400, 'QAA1')),
  'succeeded', 'a successful callback settles the request'
);
select is(
  public.mpesa_record_callback(repeat('a', 43), tests.stk('ws_CO_1', 0, 400, 'QAA1')),
  'duplicate', 'replaying the callback is acknowledged and ignored (idempotent)'
);
select throws_ok($$select 1 from public.payments$$, '42501', null, 'anon still cannot read payments');
reset role;

select results_eq(
  $$select status, paid_minor from public.invoices where id = current_setting('tests.inv')::uuid$$,
  $$values ('partially_paid'::text, 40000::bigint)$$,
  'the payment is recorded once against the invoice'
);
select results_eq(
  $$select p.method, p.reference, p.amount_minor, p.recorded_by, r.status, r.receipt
    from public.mpesa_requests r join public.payments p on p.id = r.payment_id
    where r.id = current_setting('tests.req')::uuid$$,
  $$values ('mpesa'::text, 'QAA1'::text, 40000::bigint, 'a5000000-0000-0000-0000-000000000002'::uuid,
            'succeeded'::text, 'QAA1'::text)$$,
  'the payment carries the receipt and the staff member who asked'
);

-- Cancelled and failed callbacks record no payment.
select tests.login('a5000000-0000-0000-0000-000000000002', 'waiter-a@mpesa.test');
set local role authenticated;
select set_config('tests.req2', (select request_id::text from public.mpesa_start_request(
  current_setting('tests.inv')::uuid, 10000, '254708374149', tests.hash(repeat('c', 43)))), true);
reset role;
select is(public.mpesa_record_callback(repeat('c', 43), tests.stk('ws_CO_2', 1032, null, null)),
  'cancelled', 'a cancelled prompt is recorded as cancelled');
select is((select paid_minor from public.invoices where id = current_setting('tests.inv')::uuid),
  40000::bigint, 'a cancelled prompt records no payment');

-- Money that cannot be applied is flagged, never dropped or overpaid.
select tests.login('a5000000-0000-0000-0000-000000000002', 'waiter-a@mpesa.test');
set local role authenticated;
select set_config('tests.req3', (select request_id::text from public.mpesa_start_request(
  current_setting('tests.inv2')::uuid, 50000, '254708374149', tests.hash(repeat('e', 43)))), true);
select set_config('tests.req4', (select request_id::text from public.mpesa_start_request(
  current_setting('tests.inv')::uuid, 60000, '254708374149', tests.hash(repeat('f', 43)))), true);
reset role;
insert into public.payments (tenant_id, invoice_id, amount_minor, method)
values (current_setting('tests.a')::uuid, current_setting('tests.inv2')::uuid, 50000, 'cash');
select is(public.mpesa_record_callback(repeat('e', 43), tests.stk('ws_CO_3', 0, 500, 'QAA3')),
  'needs_review', 'a payment for an invoice paid meanwhile needs review');
select is((select paid_minor from public.invoices where id = current_setting('tests.inv2')::uuid),
  50000::bigint, 'and is not applied twice');
select is(public.mpesa_record_callback(repeat('f', 43), tests.stk('ws_CO_4', 0, 500, 'QAA4')),
  'needs_review', 'an amount that differs from the request needs review');
select is((select status from public.invoices where id = current_setting('tests.inv')::uuid),
  'partially_paid', 'and leaves the invoice alone');

-- A late success for a request that timed out still settles it.
select tests.login('a5000000-0000-0000-0000-000000000002', 'waiter-a@mpesa.test');
set local role authenticated;
select set_config('tests.req5', (select request_id::text from public.mpesa_start_request(
  current_setting('tests.inv')::uuid, 60000, '254708374149', tests.hash(repeat('g', 43)))), true);
reset role;
update public.mpesa_requests set created_at = now() - interval '10 minutes' where id = current_setting('tests.req5')::uuid;
select tests.login('a5000000-0000-0000-0000-000000000002', 'waiter-a@mpesa.test');
set local role authenticated;
select lives_ok(
  $$select * from public.mpesa_start_request(current_setting('tests.inv')::uuid, 10000, '254708374149', tests.hash(repeat('h', 43)))$$,
  'a stale pending request expires and frees the invoice'
);
reset role;
select is((select status from public.mpesa_requests where id = current_setting('tests.req5')::uuid),
  'expired', 'the stale request is marked expired');
select is(public.mpesa_record_callback(repeat('g', 43), tests.stk('ws_CO_5', 0, 600, 'QAA5')),
  'succeeded', 'a late callback for an expired request still records the payment');
select results_eq(
  $$select status, paid_minor from public.invoices where id = current_setting('tests.inv')::uuid$$,
  $$values ('paid'::text, 100000::bigint)$$,
  'the invoice is paid'
);

-- Rate limit: at most five requests per invoice per hour.
select tests.login('a5000000-0000-0000-0000-000000000002', 'waiter-a@mpesa.test');
set local role authenticated;
select is(
  public.mpesa_fail_request((select id from public.mpesa_requests where callback_token_hash = tests.hash(repeat('h', 43))),
    1, 'Insufficient funds'),
  'failed', 'staff can close a request Daraja reports as failed'
);
reset role;
select tests.login('a5000000-0000-0000-0000-000000000001', 'owner-a@mpesa.test');
select set_config('tests.inv3', (select id::text from public.issue_invoice(public.save_invoice_draft(
  current_setting('tests.a')::uuid, null, 'invoice', null, null, '',
  '[{"description": "Room", "quantity": 1, "unit_price_minor": 900000}]'::jsonb))), true);
insert into public.mpesa_requests (tenant_id, invoice_id, amount_minor, phone, callback_token_hash, status)
select current_setting('tests.a')::uuid, current_setting('tests.inv3')::uuid, 100, '254708374149',
       tests.hash('rate' || g), 'failed'
from generate_series(1, 5) g;
select tests.login('a5000000-0000-0000-0000-000000000002', 'waiter-a@mpesa.test');
set local role authenticated;
select throws_ok(
  $$select * from public.mpesa_start_request(current_setting('tests.inv3')::uuid, 100, '254708374149', tests.hash(repeat('i', 43)))$$,
  '54000', null, 'requests are rate limited per invoice'
);
reset role;

-- ---------------------------------------------------------------------------
-- Permissions and isolation.
-- ---------------------------------------------------------------------------
select tests.login('a5000000-0000-0000-0000-000000000003', 'viewer-a@mpesa.test');
set local role authenticated;
select ok((select count(*) from public.mpesa_requests) >= 5, 'viewers see the request history');
select throws_ok(
  $$select * from public.mpesa_start_request(current_setting('tests.inv3')::uuid, 100, '254708374149', tests.hash(repeat('j', 43)))$$,
  '42501', null, 'viewers cannot send payment requests'
);
reset role;

select tests.login('b5000000-0000-0000-0000-000000000001', 'owner-b@mpesa.test');
set local role authenticated;
select is_empty($$select 1 from public.mpesa_requests where tenant_id = current_setting('tests.a')::uuid$$,
  'tenant B sees none of tenant A''s requests');
select throws_ok(
  $$select * from public.mpesa_start_request(current_setting('tests.inv3')::uuid, 100, '254708374149', tests.hash(repeat('k', 43)))$$,
  '42501', null, 'tenant B cannot request payment for tenant A''s invoices'
);
select throws_ok(
  $$select public.mpesa_fail_request(current_setting('tests.req')::uuid, 1, 'x')$$,
  '42501', null, 'tenant B cannot close tenant A''s requests'
);
select throws_ok(
  $$select public.mpesa_attach_checkout(current_setting('tests.req')::uuid, 'x', 'y')$$,
  '42501', null, 'tenant B cannot touch tenant A''s requests'
);
reset role;

select ok(
  exists (select 1 from public.audit_log where table_name = 'mpesa_requests' and record_id = current_setting('tests.req')
          and new_data ->> 'status' = 'succeeded'),
  'request outcomes are audited'
);
select is(
  (select count(*)::integer from public.mpesa_requests where callback_token_hash = tests.hash(repeat('a', 43))
     and payload is not null),
  1, 'the callback payload is kept for reconciliation'
);

select * from finish();
rollback;
