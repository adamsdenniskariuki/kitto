-- =============================================================================
-- mpesa 0001 M-Pesa (Daraja) STK push requests and callbacks.
--
--   1. Staff ask for a payment: mpesa_start_request checks the invoice and
--      amount and stores a pending request holding only the SHA-256 HASH of
--      a fresh random token. The token itself goes into the callback URL
--      (/api/mpesa/callback/<token>) sent to Safaricom, so every request has
--      its own unguessable callback path and the database never stores it.
--   2. The app calls Daraja and attaches the CheckoutRequestID.
--   3. Safaricom POSTs the result to the callback URL. The route passes the
--      token and body to mpesa_record_callback, a SECURITY DEFINER function
--      callable without a session, which finds the request by token hash,
--      locks it and, on success, records the payment against the invoice.
--      It is IDEMPOTENT: replays of a finished request change nothing.
--   * Money that cannot be applied (the invoice was voided or paid in the
--     meantime, or the amount differs) is never dropped: the request is
--     marked needs_review for a human to refund or apply.
-- =============================================================================

create table public.mpesa_requests (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants (id) on delete cascade,
  invoice_id           uuid not null,
  amount_minor         bigint not null check (amount_minor > 0),
  phone                text not null check (phone ~ '^254[17][0-9]{8}$'),
  status               text not null default 'pending'
                       check (status in ('pending', 'succeeded', 'failed', 'cancelled', 'expired', 'needs_review')),
  callback_token_hash  text not null unique check (callback_token_hash ~ '^[0-9a-f]{64}$'),
  checkout_request_id  text unique check (char_length(checkout_request_id) between 1 and 100),
  merchant_request_id  text check (char_length(merchant_request_id) between 1 and 100),
  result_code          integer,
  result_desc          text check (char_length(result_desc) <= 500),
  receipt              text check (char_length(receipt) between 1 and 40),
  payment_id           uuid,
  payload              jsonb,
  requested_by         uuid default auth.uid() references auth.users (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  completed_at         timestamptz,
  unique (tenant_id, id),
  foreign key (tenant_id, invoice_id) references public.invoices (tenant_id, id) on delete cascade,
  foreign key (tenant_id, payment_id) references public.payments (tenant_id, id)
);
create index mpesa_requests_invoice_idx on public.mpesa_requests (invoice_id, created_at desc);
-- At most one request waits on a customer's phone per invoice.
create unique index mpesa_requests_one_pending_idx on public.mpesa_requests (invoice_id)
  where status = 'pending';

create trigger mpesa_requests_updated_at before update on public.mpesa_requests
  for each row execute function private.set_updated_at();
create trigger mpesa_requests_tenant_immutable before update of tenant_id on public.mpesa_requests
  for each row execute function private.prevent_tenant_change();

comment on table public.mpesa_requests is
  'M-Pesa STK push requests. Written only by the mpesa_* functions; the callback token is stored as a SHA-256 hash.';

select private.register_permission('mpesa.request', 'mpesa', 'Send M-Pesa payment requests to customers'' phones',
  array['manager', 'front_desk', 'waiter', 'sales']);

select private.enable_audit('public.mpesa_requests');

revoke all on public.mpesa_requests from anon, authenticated;
grant select on public.mpesa_requests to authenticated;
alter table public.mpesa_requests enable row level security;
create policy "billing.view reads mpesa requests"
  on public.mpesa_requests for select to authenticated
  using (tenant_id in (select private.permitted_tenant_ids('billing.view')));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.mpesa_requests;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Start a request.
-- ---------------------------------------------------------------------------
create function public.mpesa_start_request(
  p_invoice_id    uuid,
  p_amount_minor  bigint,
  p_phone         text,
  p_token_hash    text
)
returns table (request_id uuid, account_reference text, description text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invoices;
  v_id  uuid;
begin
  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'Invoice not found' using errcode = 'P0002';
  end if;
  perform private.assert_permission(v_inv.tenant_id, 'mpesa.request');
  if v_inv.kind <> 'invoice' or v_inv.status not in ('issued', 'partially_paid') then
    raise exception 'Payments can only be recorded against issued, unpaid invoices' using errcode = '22023';
  end if;
  if v_inv.currency <> 'KES' then
    raise exception 'M-Pesa payments must be in KES' using errcode = '22023';
  end if;
  if p_phone is null or p_phone !~ '^254[17][0-9]{8}$' then
    raise exception 'Invalid M-Pesa phone number' using errcode = '22023';
  end if;
  if p_amount_minor is null or p_amount_minor % 100 <> 0 or p_amount_minor not between 100 and 25000000 then
    raise exception 'M-Pesa amounts are whole shillings between 1 and 250,000' using errcode = '22023';
  end if;
  if p_amount_minor > v_inv.total_minor - v_inv.paid_minor then
    raise exception 'Payment exceeds the balance due' using errcode = '22023';
  end if;

  -- Customers have about a minute to answer the prompt; free the slot for
  -- requests that never heard back. A late callback can still settle them.
  update public.mpesa_requests
  set status = 'expired', completed_at = now()
  where invoice_id = v_inv.id and status = 'pending' and created_at < now() - interval '5 minutes';
  if exists (select 1 from public.mpesa_requests r where r.invoice_id = v_inv.id and r.status = 'pending') then
    raise exception 'A payment request is already waiting on the customer''s phone' using errcode = '55000';
  end if;
  if (select count(*) from public.mpesa_requests r
      where r.invoice_id = v_inv.id and r.created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Too many payment requests for this invoice; try again later' using errcode = '54000';
  end if;

  insert into public.mpesa_requests (tenant_id, invoice_id, amount_minor, phone, callback_token_hash, requested_by)
  values (v_inv.tenant_id, v_inv.id, p_amount_minor, p_phone, p_token_hash, auth.uid())
  returning id into v_id;

  return query select
    v_id,
    -- Daraja shows AccountReference to the customer: at most 12 characters.
    left(replace(v_inv.number, '-', ''), 12),
    left('Invoice ' || v_inv.number, 13);
end;
$$;
revoke all on function public.mpesa_start_request(uuid, bigint, text, text) from public, anon, authenticated;
grant execute on function public.mpesa_start_request(uuid, bigint, text, text) to authenticated, service_role;
comment on function public.mpesa_start_request(uuid, bigint, text, text) is
  'Validate and store a pending STK push for an invoice. p_token_hash is the hex SHA-256 of the callback token.';

-- ---------------------------------------------------------------------------
-- 2. Attach Daraja's ids, or close a request Daraja refused / reported as failed.
-- ---------------------------------------------------------------------------
create function public.mpesa_attach_checkout(p_request_id uuid, p_checkout_request_id text, p_merchant_request_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.mpesa_requests;
begin
  select * into v_req from public.mpesa_requests where id = p_request_id for update;
  if not found then
    raise exception 'Payment request not found' using errcode = 'P0002';
  end if;
  perform private.assert_permission(v_req.tenant_id, 'mpesa.request');
  update public.mpesa_requests
  set checkout_request_id = coalesce(checkout_request_id, p_checkout_request_id),
      merchant_request_id = coalesce(merchant_request_id, p_merchant_request_id)
  where id = v_req.id;
end;
$$;
revoke all on function public.mpesa_attach_checkout(uuid, text, text) from public, anon, authenticated;
grant execute on function public.mpesa_attach_checkout(uuid, text, text) to authenticated, service_role;

create function public.mpesa_fail_request(p_request_id uuid, p_result_code integer, p_result_desc text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.mpesa_requests;
begin
  select * into v_req from public.mpesa_requests where id = p_request_id for update;
  if not found then
    raise exception 'Payment request not found' using errcode = 'P0002';
  end if;
  perform private.assert_permission(v_req.tenant_id, 'mpesa.request');
  if v_req.status <> 'pending' then
    return v_req.status;
  end if;
  if p_result_code = 0 then
    raise exception 'A successful payment is settled by its callback' using errcode = '22023';
  end if;
  update public.mpesa_requests
  set status = case when p_result_code = 1032 then 'cancelled' else 'failed' end,
      result_code = p_result_code,
      result_desc = left(coalesce(p_result_desc, ''), 500),
      completed_at = now()
  where id = v_req.id
  returning status into v_req.status;
  return v_req.status;
end;
$$;
revoke all on function public.mpesa_fail_request(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.mpesa_fail_request(uuid, integer, text) to authenticated, service_role;
comment on function public.mpesa_fail_request(uuid, integer, text) is
  'Close a pending request that Daraja rejected or reported as failed (1032 = cancelled by the customer).';

-- ---------------------------------------------------------------------------
-- 3. The callback. Callable by anyone who knows a request's token.
-- ---------------------------------------------------------------------------
create function public.mpesa_record_callback(p_token text, p_payload jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stk      jsonb := p_payload -> 'Body' -> 'stkCallback';
  v_checkout text := v_stk ->> 'CheckoutRequestID';
  v_code     integer;
  v_desc     text := left(coalesce(v_stk ->> 'ResultDesc', ''), 500);
  v_req      public.mpesa_requests;
  v_inv      public.invoices;
  v_amount   numeric;
  v_receipt  text;
  v_payment  uuid;
  v_status   text;
begin
  if p_token is null or char_length(p_token) not between 32 and 128 then
    raise exception 'Payment request not found' using errcode = 'P0002';
  end if;
  select * into v_req from public.mpesa_requests
  where callback_token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
  for update;
  if not found then
    raise exception 'Payment request not found' using errcode = 'P0002';
  end if;
  -- Idempotent: anything already settled is acknowledged and left alone.
  if v_req.status not in ('pending', 'expired') then
    return 'duplicate';
  end if;
  if v_stk is null or v_checkout is null or (v_stk ->> 'ResultCode') !~ '^-?[0-9]{1,9}$' then
    raise exception 'Malformed callback' using errcode = '22023';
  end if;
  if v_req.checkout_request_id is not null and v_req.checkout_request_id <> v_checkout then
    raise exception 'Callback does not match the request' using errcode = '22023';
  end if;
  v_code := (v_stk ->> 'ResultCode')::integer;

  if v_code = 0 then
    select (i ->> 'Value')::numeric into v_amount
    from jsonb_array_elements(coalesce(v_stk -> 'CallbackMetadata' -> 'Item', '[]')) i
    where i ->> 'Name' = 'Amount' and (i ->> 'Value') ~ '^[0-9]+(\.[0-9]+)?$';
    select left(nullif(btrim(i ->> 'Value'), ''), 40) into v_receipt
    from jsonb_array_elements(coalesce(v_stk -> 'CallbackMetadata' -> 'Item', '[]')) i
    where i ->> 'Name' = 'MpesaReceiptNumber';

    select * into v_inv from public.invoices where id = v_req.invoice_id for update;
    if v_receipt is not null
       and v_amount is not null and round(v_amount * 100) = v_req.amount_minor
       and v_inv.kind = 'invoice' and v_inv.status in ('issued', 'partially_paid')
       and v_req.amount_minor <= v_inv.total_minor - v_inv.paid_minor
       and not exists (select 1 from public.payments p
                       where p.tenant_id = v_req.tenant_id and p.method = 'mpesa' and p.reference = v_receipt) then
      insert into public.payments (tenant_id, invoice_id, amount_minor, method, reference, note, recorded_by)
      values (v_req.tenant_id, v_req.invoice_id, v_req.amount_minor, 'mpesa', v_receipt,
              'M-Pesa from ' || v_req.phone, v_req.requested_by)
      returning id into v_payment;
      v_status := 'succeeded';
    else
      -- The customer paid but it cannot be applied automatically.
      v_status := 'needs_review';
    end if;
  elsif v_code = 1032 then
    v_status := 'cancelled';
  else
    v_status := 'failed';
  end if;

  update public.mpesa_requests
  set status = v_status,
      checkout_request_id = coalesce(checkout_request_id, v_checkout),
      result_code = v_code,
      result_desc = v_desc,
      receipt = v_receipt,
      payment_id = v_payment,
      payload = p_payload,
      completed_at = now()
  where id = v_req.id;
  return v_status;
end;
$$;
revoke all on function public.mpesa_record_callback(text, jsonb) from public, anon, authenticated;
grant execute on function public.mpesa_record_callback(text, jsonb) to anon, authenticated, service_role;
comment on function public.mpesa_record_callback(text, jsonb) is
  '[anon] Apply a Daraja STK callback to the request whose token hashes to its stored hash. Idempotent; returns the outcome.';
