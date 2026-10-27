-- Billing: drafts, gapless numbering, totals and tax, issue/void rules,
-- quote conversion, payments without overpayment, status derivation,
-- source idempotency, permissions per role, tenant isolation and audit.
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
grant usage on schema tests to anon, authenticated;
grant execute on all functions in schema tests to anon, authenticated;

select tests.create_user('a4000000-0000-0000-0000-000000000001', 'owner-a@bill.test');
select tests.create_user('a4000000-0000-0000-0000-000000000002', 'desk-a@bill.test');
select tests.create_user('a4000000-0000-0000-0000-000000000003', 'waiter-a@bill.test');
select tests.create_user('a4000000-0000-0000-0000-000000000004', 'viewer-a@bill.test');
select tests.create_user('a4000000-0000-0000-0000-000000000005', 'manager-a@bill.test');
select tests.create_user('b4000000-0000-0000-0000-000000000001', 'owner-b@bill.test');

select tests.login('a4000000-0000-0000-0000-000000000001', 'owner-a@bill.test');
select public.create_tenant('Bill A', 'bill-a');
select tests.login('b4000000-0000-0000-0000-000000000001', 'owner-b@bill.test');
select public.create_tenant('Bill B', 'bill-b');
select set_config('tests.a', (select id::text from public.tenants where slug = 'bill-a'), true);
select set_config('tests.b', (select id::text from public.tenants where slug = 'bill-b'), true);
select tests.add_member(current_setting('tests.a')::uuid, 'a4000000-0000-0000-0000-000000000002', 'desk-a@bill.test', 'front_desk');
select tests.add_member(current_setting('tests.a')::uuid, 'a4000000-0000-0000-0000-000000000003', 'waiter-a@bill.test', 'waiter');
select tests.add_member(current_setting('tests.a')::uuid, 'a4000000-0000-0000-0000-000000000004', 'viewer-a@bill.test', 'viewer');
select tests.add_member(current_setting('tests.a')::uuid, 'a4000000-0000-0000-0000-000000000005', 'manager-a@bill.test', 'manager');
insert into public.customers (tenant_id, name) values (current_setting('tests.a')::uuid, 'Wanjiku');
insert into public.customers (tenant_id, name) values (current_setting('tests.b')::uuid, 'Otieno');
select set_config('tests.cust_a', (select id::text from public.customers where tenant_id = current_setting('tests.a')::uuid), true);
select set_config('tests.cust_b', (select id::text from public.customers where tenant_id = current_setting('tests.b')::uuid), true);

-- ---------------------------------------------------------------------------
-- Default role grants.
-- ---------------------------------------------------------------------------
select results_eq(
  $$select r.key, array_agg(rp.permission_key order by rp.permission_key)
    from public.roles r join public.role_permissions rp on rp.role_id = r.id
    where r.tenant_id = current_setting('tests.a')::uuid
      and (rp.permission_key like 'billing.%' or rp.permission_key = 'payments.record')
    group by r.key order by r.key$$,
  $$values ('front_desk', array['billing.create', 'billing.issue', 'billing.view', 'payments.record']),
           ('manager', array['billing.create', 'billing.issue', 'billing.view', 'billing.void', 'payments.record']),
           ('sales', array['billing.create', 'billing.issue', 'billing.view', 'payments.record']),
           ('viewer', array['billing.view']),
           ('waiter', array['billing.view', 'payments.record'])$$,
  'default roles get sensible billing permissions'
);

-- ---------------------------------------------------------------------------
-- Front desk drafts an invoice; totals come from the lines.
-- ---------------------------------------------------------------------------
select tests.login('a4000000-0000-0000-0000-000000000002', 'desk-a@bill.test');
set local role authenticated;
select set_config('tests.inv1', public.save_invoice_draft(
  current_setting('tests.a')::uuid, null, 'invoice', current_setting('tests.cust_a')::uuid, null, 'Thanks!',
  '[{"description": "Room 101, 2 nights", "quantity": 2, "unit_price_minor": 500000, "tax_rate_bp": 1600},
    {"description": "Breakfast", "quantity": 1.5, "unit_price_minor": 33333}]'::jsonb)::text, true);
select results_eq(
  $$select status, number, currency, subtotal_minor, tax_minor, total_minor
    from public.invoices where id = current_setting('tests.inv1')::uuid$$,
  $$values ('draft', null::text, 'KES', 1050000::bigint, 160000::bigint, 1210000::bigint)$$,
  'a draft has no number, takes the tenant currency and sums lines (half-up rounding, tax on top)'
);
select results_eq(
  $$select position, line_subtotal_minor, line_tax_minor, line_total_minor
    from public.invoice_lines where invoice_id = current_setting('tests.inv1')::uuid order by position$$,
  $$values (1, 1000000::bigint, 160000::bigint, 1160000::bigint), (2, 50000::bigint, 0::bigint, 50000::bigint)$$,
  'line amounts are generated by the database'
);
select throws_ok(
  $$select public.save_invoice_draft(current_setting('tests.a')::uuid, null, 'invoice', null, null, '', '[]'::jsonb)$$,
  '22023', null, 'a document needs at least one line'
);
select throws_ok(
  $$select public.save_invoice_draft(current_setting('tests.a')::uuid, null, 'invoice', current_setting('tests.cust_b')::uuid, null, '',
      '[{"description": "x", "quantity": 1, "unit_price_minor": 1}]'::jsonb)$$,
  '23503', null, 'an invoice cannot point at another tenant''s customer'
);
select throws_ok(
  $$select public.save_invoice_draft(current_setting('tests.a')::uuid, null, 'invoice', null, null, '',
      '[{"description": "x", "quantity": 0, "unit_price_minor": 1}]'::jsonb)$$,
  '23514', null, 'quantities must be positive'
);
select throws_ok(
  $$update public.invoices set total_minor = 1 where id = current_setting('tests.inv1')::uuid$$,
  '42501', null, 'totals cannot be written by clients'
);
select throws_ok(
  $$select public.save_invoice_draft(current_setting('tests.b')::uuid, null, 'invoice', null, null, '',
      '[{"description": "x", "quantity": 1, "unit_price_minor": 1}]'::jsonb)$$,
  '42501', null, 'cannot create drafts in another tenant'
);
-- Editing replaces the lines.
select lives_ok(
  $$select public.save_invoice_draft(current_setting('tests.a')::uuid, current_setting('tests.inv1')::uuid, 'invoice',
      current_setting('tests.cust_a')::uuid, null, 'Thanks!',
      '[{"description": "Room 101, 2 nights", "quantity": 2, "unit_price_minor": 500000, "tax_rate_bp": 1600}]'::jsonb)$$,
  'drafts can be edited'
);
select is(
  (select total_minor from public.invoices where id = current_setting('tests.inv1')::uuid),
  1160000::bigint, 'editing recomputes the totals'
);
select throws_ok(
  $$insert into public.payments (tenant_id, invoice_id, amount_minor, method)
    values (current_setting('tests.a')::uuid, current_setting('tests.inv1')::uuid, 100, 'cash')$$,
  '22023', null, 'drafts cannot take payments'
);

-- ---------------------------------------------------------------------------
-- Issue: gapless numbers, frozen documents.
-- ---------------------------------------------------------------------------
select results_eq(
  $$select number, status, issue_date = (now() at time zone 'Africa/Nairobi')::date, due_date - issue_date
    from public.issue_invoice(current_setting('tests.inv1')::uuid)$$,
  $$values ('INV-00001'::text, 'issued'::text, true, 14)$$,
  'issuing assigns INV-00001, today''s date and a 14 day due date'
);
select throws_ok(
  $$select public.issue_invoice(current_setting('tests.inv1')::uuid)$$,
  '22023', null, 'an issued invoice cannot be issued again'
);
select throws_ok(
  $$select public.save_invoice_draft(current_setting('tests.a')::uuid, current_setting('tests.inv1')::uuid, 'invoice',
      null, null, '', '[{"description": "x", "quantity": 1, "unit_price_minor": 1}]'::jsonb)$$,
  '22023', null, 'issued documents are frozen'
);
select throws_ok(
  $$insert into public.invoice_lines (tenant_id, invoice_id, description, quantity, unit_price_minor)
    values (current_setting('tests.a')::uuid, current_setting('tests.inv1')::uuid, 'Extra', 1, 100)$$,
  '22023', null, 'lines cannot be added to issued documents'
);
select is_empty(
  $$delete from public.invoices where id = current_setting('tests.inv1')::uuid returning id$$,
  'issued documents cannot be deleted'
);

-- Second invoice gets INV-00002; a rolled back issue leaves no gap.
select set_config('tests.inv2', public.save_invoice_draft(
  current_setting('tests.a')::uuid, null, 'invoice', null, null, '',
  '[{"description": "Dinner", "quantity": 1, "unit_price_minor": 250000}]'::jsonb)::text, true);
select set_config('tests.inv3', public.save_invoice_draft(
  current_setting('tests.a')::uuid, null, 'invoice', null, null, '',
  '[{"description": "Laundry", "quantity": 1, "unit_price_minor": 80000}]'::jsonb)::text, true);
savepoint before_issue;
select public.issue_invoice(current_setting('tests.inv2')::uuid);
rollback to savepoint before_issue;
select is(
  (select number from public.issue_invoice(current_setting('tests.inv3')::uuid)),
  'INV-00002', 'a rolled back issue does not burn a number (gapless)'
);
select is(
  (select number from public.issue_invoice(current_setting('tests.inv2')::uuid)),
  'INV-00003', 'numbers continue in order'
);
select throws_ok(
  $$select public.issue_invoice(public.save_invoice_draft(current_setting('tests.a')::uuid, null, 'invoice', null, null, '',
      '[{"description": "Free", "quantity": 1, "unit_price_minor": 0}]'::jsonb))$$,
  '22023', null, 'a zero total cannot be issued'
);
reset role;

-- ---------------------------------------------------------------------------
-- Payments: part payments, no overpayment, derived status.
-- ---------------------------------------------------------------------------
select tests.login('a4000000-0000-0000-0000-000000000003', 'waiter-a@bill.test');
set local role authenticated;
select lives_ok(
  $$insert into public.payments (tenant_id, invoice_id, amount_minor, method, reference)
    values (current_setting('tests.a')::uuid, current_setting('tests.inv1')::uuid, 160000, 'cash', ' ')$$,
  'waiters record part payments'
);
select results_eq(
  $$select status, paid_minor from public.invoices where id = current_setting('tests.inv1')::uuid$$,
  $$values ('partially_paid'::text, 160000::bigint)$$,
  'a part payment makes the invoice partially paid'
);
select throws_ok(
  $$insert into public.payments (tenant_id, invoice_id, amount_minor, method)
    values (current_setting('tests.a')::uuid, current_setting('tests.inv1')::uuid, 1000001, 'cash')$$,
  '22023', 'Payment exceeds the balance due', 'payments cannot exceed the balance'
);
select throws_ok(
  $$insert into public.payments (tenant_id, invoice_id, amount_minor, method)
    values (current_setting('tests.a')::uuid, current_setting('tests.inv1')::uuid, 0, 'cash')$$,
  '23514', null, 'payments must be positive'
);
select lives_ok(
  $$insert into public.payments (tenant_id, invoice_id, amount_minor, method, reference)
    values (current_setting('tests.a')::uuid, current_setting('tests.inv1')::uuid, 1000000, 'mpesa', 'QAB123')$$,
  'the balance can be paid in full'
);
select results_eq(
  $$select status, paid_minor, total_minor from public.invoices where id = current_setting('tests.inv1')::uuid$$,
  $$values ('paid'::text, 1160000::bigint, 1160000::bigint)$$,
  'paying the balance marks the invoice paid'
);
select throws_ok(
  $$insert into public.payments (tenant_id, invoice_id, amount_minor, method)
    values (current_setting('tests.a')::uuid, current_setting('tests.inv1')::uuid, 1, 'cash')$$,
  '22023', null, 'paid invoices take no more payments'
);
select throws_ok(
  $$insert into public.payments (tenant_id, invoice_id, amount_minor, method, reference)
    values (current_setting('tests.a')::uuid, current_setting('tests.inv2')::uuid, 1, 'mpesa', 'QAB123')$$,
  '23505', null, 'an M-Pesa receipt settles only one payment'
);
select is(
  (select reference from public.payments where invoice_id = current_setting('tests.inv1')::uuid and method = 'cash'),
  null, 'blank references are stored as null'
);
select throws_ok(
  $$update public.payments set amount_minor = 1 where invoice_id = current_setting('tests.inv1')::uuid$$,
  '42501', null, 'payments cannot be edited'
);
select throws_ok(
  $$delete from public.payments where invoice_id = current_setting('tests.inv1')::uuid$$,
  '42501', null, 'payments cannot be deleted'
);
select throws_ok(
  $$select public.save_invoice_draft(current_setting('tests.a')::uuid, null, 'invoice', null, null, '',
      '[{"description": "x", "quantity": 1, "unit_price_minor": 1}]'::jsonb)$$,
  '42501', null, 'waiters cannot create invoices'
);
select throws_ok(
  $$select public.void_invoice(current_setting('tests.inv3')::uuid, 'Duplicate')$$,
  '42501', null, 'waiters cannot void'
);
reset role;

-- Concurrency guard: the payment trigger locks the invoice row. Without that
-- lock two inserts that each fit the balance could both commit; with it the
-- second sees the first's paid amount. (Simulated sequentially here.)
select tests.login('a4000000-0000-0000-0000-000000000002', 'desk-a@bill.test');
set local role authenticated;
insert into public.payments (tenant_id, invoice_id, amount_minor, method)
values (current_setting('tests.a')::uuid, current_setting('tests.inv2')::uuid, 200000, 'card');
select throws_ok(
  $$insert into public.payments (tenant_id, invoice_id, amount_minor, method)
    values (current_setting('tests.a')::uuid, current_setting('tests.inv2')::uuid, 200000, 'card')$$,
  '22023', null, 'a second payment that would overpay is refused'
);
select throws_ok(
  $$select public.void_invoice(current_setting('tests.inv3')::uuid, 'Duplicate')$$,
  '42501', null, 'front desk cannot void (billing.void)'
);
reset role;

-- ---------------------------------------------------------------------------
-- Void rules (manager holds billing.void).
-- ---------------------------------------------------------------------------
select tests.login('a4000000-0000-0000-0000-000000000005', 'manager-a@bill.test');
set local role authenticated;
select throws_ok(
  $$select public.void_invoice(current_setting('tests.inv2')::uuid, 'Mistake')$$,
  '22023', null, 'invoices with payments cannot be voided'
);
select throws_ok(
  $$select public.void_invoice(current_setting('tests.inv3')::uuid, '  ')$$,
  '22023', null, 'voiding needs a reason'
);
select results_eq(
  $$select status, number, void_reason from public.void_invoice(current_setting('tests.inv3')::uuid, 'Duplicate')$$,
  $$values ('void'::text, 'INV-00002'::text, 'Duplicate'::text)$$,
  'unpaid issued invoices can be voided and keep their number'
);
select throws_ok(
  $$insert into public.payments (tenant_id, invoice_id, amount_minor, method)
    values (current_setting('tests.a')::uuid, current_setting('tests.inv3')::uuid, 1, 'cash')$$,
  '22023', null, 'void invoices take no payments'
);
select throws_ok(
  $$select public.void_invoice(current_setting('tests.inv3')::uuid, 'Again')$$,
  '22023', null, 'void is final'
);
reset role;

-- ---------------------------------------------------------------------------
-- Quotes: own numbering, conversion to an invoice.
-- ---------------------------------------------------------------------------
select tests.login('a4000000-0000-0000-0000-000000000002', 'desk-a@bill.test');
set local role authenticated;
select set_config('tests.quote', public.save_invoice_draft(
  current_setting('tests.a')::uuid, null, 'quote', current_setting('tests.cust_a')::uuid, null, 'Valid 2 weeks',
  '[{"description": "Conference room", "quantity": 3, "unit_price_minor": 1000000, "tax_rate_bp": 1600}]'::jsonb)::text, true);
select throws_ok(
  $$select public.convert_quote(current_setting('tests.quote')::uuid)$$,
  '22023', null, 'draft quotes cannot be converted'
);
select is(
  (select number from public.issue_invoice(current_setting('tests.quote')::uuid)),
  'QUO-00001', 'quotes have their own gapless sequence'
);
select throws_ok(
  $$insert into public.payments (tenant_id, invoice_id, amount_minor, method)
    values (current_setting('tests.a')::uuid, current_setting('tests.quote')::uuid, 1, 'cash')$$,
  '22023', null, 'quotes take no payments'
);
select set_config('tests.converted', public.convert_quote(current_setting('tests.quote')::uuid)::text, true);
select results_eq(
  $$select kind, status, quote_id, customer_id, total_minor, notes
    from public.invoices where id = current_setting('tests.converted')::uuid$$,
  $$values ('invoice'::text, 'draft'::text, current_setting('tests.quote')::uuid, current_setting('tests.cust_a')::uuid,
            3480000::bigint, 'Valid 2 weeks'::text)$$,
  'converting copies the quote into a draft invoice'
);
select is(
  (select status from public.invoices where id = current_setting('tests.quote')::uuid),
  'accepted', 'the quote is marked accepted'
);
select throws_ok(
  $$select public.convert_quote(current_setting('tests.quote')::uuid)$$,
  '22023', null, 'a quote converts only once'
);
select is(
  (select number from public.issue_invoice(current_setting('tests.converted')::uuid)),
  'INV-00004', 'the converted invoice continues the invoice sequence'
);

-- ---------------------------------------------------------------------------
-- Source links: one live invoice per source record.
-- ---------------------------------------------------------------------------
select set_config('tests.src', gen_random_uuid()::text, true);
select set_config('tests.src_inv', public.draft_invoice_for_source(
  current_setting('tests.a')::uuid, 'reservation', current_setting('tests.src')::uuid,
  current_setting('tests.cust_a')::uuid,
  '[{"description": "Room 102", "quantity": 1, "unit_price_minor": 800000}]'::jsonb)::text, true);
select is(
  public.draft_invoice_for_source(current_setting('tests.a')::uuid, 'reservation', current_setting('tests.src')::uuid,
    null, '[{"description": "Again", "quantity": 1, "unit_price_minor": 1}]'::jsonb),
  current_setting('tests.src_inv')::uuid,
  'billing the same source again returns the existing invoice'
);
select results_eq(
  $$select source_type, total_minor from public.invoices where id = current_setting('tests.src_inv')::uuid$$,
  $$values ('reservation'::text, 800000::bigint)$$,
  'the invoice remembers its source'
);
select throws_ok(
  $$insert into public.invoices (tenant_id, source_type) values (current_setting('tests.a')::uuid, 'reservation')$$,
  '23514', null, 'source type and id come together'
);
-- Drafts can be deleted; their lines go with them.
select lives_ok(
  $$delete from public.invoices where id = current_setting('tests.src_inv')::uuid$$,
  'drafts can be deleted'
);
reset role;
select is(
  (select count(*)::integer from public.invoice_lines where invoice_id = current_setting('tests.src_inv')::uuid),
  0, 'deleting a draft removes its lines'
);

-- ---------------------------------------------------------------------------
-- Viewer and tenant isolation.
-- ---------------------------------------------------------------------------
select tests.login('a4000000-0000-0000-0000-000000000004', 'viewer-a@bill.test');
set local role authenticated;
select ok(
  (select count(*) from public.invoices where tenant_id = current_setting('tests.a')::uuid) >= 5,
  'viewers read invoices'
);
select ok(
  (select count(*) from public.payments) >= 3, 'viewers read payments'
);
select throws_ok(
  $$insert into public.payments (tenant_id, invoice_id, amount_minor, method)
    values (current_setting('tests.a')::uuid, current_setting('tests.inv2')::uuid, 1, 'cash')$$,
  '42501', null, 'viewers cannot record payments'
);
select throws_ok(
  $$select public.issue_invoice(current_setting('tests.inv2')::uuid)$$,
  '42501', null, 'viewers cannot issue'
);
reset role;

select tests.login('b4000000-0000-0000-0000-000000000001', 'owner-b@bill.test');
set local role authenticated;
select is_empty($$select 1 from public.invoices where tenant_id = current_setting('tests.a')::uuid$$,
  'tenant B sees none of tenant A''s invoices');
select is_empty($$select 1 from public.invoice_lines where tenant_id = current_setting('tests.a')::uuid$$,
  'tenant B sees none of tenant A''s lines');
select is_empty($$select 1 from public.payments where tenant_id = current_setting('tests.a')::uuid$$,
  'tenant B sees none of tenant A''s payments');
select throws_ok(
  $$insert into public.payments (tenant_id, invoice_id, amount_minor, method)
    values (current_setting('tests.a')::uuid, current_setting('tests.inv2')::uuid, 1, 'cash')$$,
  '42501', null, 'tenant B cannot pay tenant A''s invoices'
);
select throws_ok(
  $$insert into public.payments (tenant_id, invoice_id, amount_minor, method)
    values (current_setting('tests.b')::uuid, current_setting('tests.inv2')::uuid, 1, 'cash')$$,
  'P0002', null, 'a payment cannot reach another tenant''s invoice through its own tenant id'
);
select throws_ok(
  $$select public.issue_invoice(current_setting('tests.converted')::uuid)$$,
  '42501', null, 'tenant B cannot issue tenant A''s documents'
);
select throws_ok(
  $$select public.void_invoice(current_setting('tests.inv2')::uuid, 'x')$$,
  '42501', null, 'tenant B cannot void tenant A''s documents'
);
select throws_ok(
  $$select public.convert_quote(current_setting('tests.quote')::uuid)$$,
  '42501', null, 'tenant B cannot convert tenant A''s quotes'
);
select is_empty(
  $$update public.invoices set notes = 'hacked' where tenant_id = current_setting('tests.a')::uuid returning id$$,
  'tenant B cannot edit tenant A''s invoices'
);
-- Tenant B's own numbering starts at 1.
select is(
  (select number from public.issue_invoice(public.save_invoice_draft(current_setting('tests.b')::uuid, null, 'invoice',
     current_setting('tests.cust_b')::uuid, null, '', '[{"description": "Tea", "quantity": 1, "unit_price_minor": 5000}]'::jsonb))),
  'INV-00001', 'each tenant has its own sequence'
);
reset role;

-- Anonymous users get nothing.
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok($$select 1 from public.invoices$$, '42501', null, 'anon cannot read invoices');
select throws_ok($$select public.issue_invoice(current_setting('tests.inv2')::uuid)$$, '42501', null,
  'anon cannot issue');
reset role;

-- Audit trail.
select ok(
  exists (select 1 from public.audit_log where table_name = 'payments' and tenant_id = current_setting('tests.a')::uuid),
  'payments are audited'
);
select ok(
  exists (select 1 from public.audit_log where table_name = 'invoices' and record_id = current_setting('tests.inv3')
          and 'status' = any (changed) and new_data ->> 'status' = 'void'),
  'voiding is audited'
);

select * from finish();
rollback;
