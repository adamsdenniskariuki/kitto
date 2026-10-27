-- =============================================================================
-- billing 0001 Quotes, invoices, line items and payments.
--
-- One table holds both documents; `kind` tells them apart:
--     quote    draft -> issued -> accepted (converted to an invoice) | void
--     invoice  draft -> issued -> partially_paid -> paid,  issued -> void
--
--   * Money is integer minor units (cents) in the tenant's currency. Line
--     amounts are GENERATED columns and document totals are kept in step by
--     triggers, so the database is the only place arithmetic happens.
--   * Numbers (INV-00001, QUO-00001) are GAPLESS per tenant and kind: they
--     come from a counter row that is locked by the UPDATE inside the issuing
--     transaction. A rolled back issue rolls the counter back too, so no
--     number is ever skipped or reused. Drafts have no number.
--   * Issued documents are frozen: lines can only change while the parent is
--     a draft, and only SECURITY DEFINER functions change status.
--   * Payments are append-only. Each insert locks its invoice row, refuses
--     anything that would overpay it and then derives the status from the
--     amount paid. Corrections are made by voiding, never by editing.
--   * An invoice can point at a customer and, generically, at whatever it
--     bills (source_type/source_id, e.g. 'reservation' + id), so modules can
--     bill their records without billing depending on them.
-- =============================================================================

create table public.invoices (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants (id) on delete cascade,
  kind            text not null default 'invoice' check (kind in ('invoice', 'quote')),
  number          text check (number is null or char_length(number) between 1 and 40),
  status          text not null default 'draft'
                  check (status in ('draft', 'issued', 'partially_paid', 'paid', 'accepted', 'void')),
  customer_id     uuid,
  quote_id        uuid,
  source_type     text check (source_type ~ '^[a-z][a-z0-9_]{0,39}$'),
  source_id       uuid,
  currency        text not null default 'KES' check (currency ~ '^[A-Z]{3}$'),
  issue_date      date,
  due_date        date,
  notes           text not null default '' check (char_length(notes) <= 2000),
  subtotal_minor  bigint not null default 0 check (subtotal_minor >= 0),
  tax_minor       bigint not null default 0 check (tax_minor >= 0),
  total_minor     bigint not null default 0 check (total_minor >= 0),
  paid_minor      bigint not null default 0 check (paid_minor >= 0 and paid_minor <= total_minor),
  issued_at       timestamptz,
  voided_at       timestamptz,
  void_reason     text check (void_reason is null or char_length(void_reason) <= 500),
  created_by      uuid default auth.uid() references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint invoices_source_pair check ((source_type is null) = (source_id is null)),
  constraint invoices_status_kind check (
    (kind = 'invoice' and status <> 'accepted')
    or (kind = 'quote' and status in ('draft', 'issued', 'accepted', 'void'))
  ),
  constraint invoices_numbered check ((status = 'draft') = (number is null)),
  constraint invoices_due_after_issue check (due_date is null or issue_date is null or due_date >= issue_date),
  constraint invoices_quote_kind check (quote_id is null or kind = 'invoice'),
  unique (tenant_id, id),
  unique (tenant_id, kind, number),
  foreign key (tenant_id, customer_id) references public.customers (tenant_id, id),
  foreign key (tenant_id, quote_id) references public.invoices (tenant_id, id)
);
create index invoices_tenant_created_idx on public.invoices (tenant_id, kind, created_at desc);
create index invoices_tenant_customer_idx on public.invoices (tenant_id, customer_id)
  where customer_id is not null;
create index invoices_tenant_source_idx on public.invoices (tenant_id, source_type, source_id)
  where source_id is not null;

create trigger invoices_updated_at before update on public.invoices
  for each row execute function private.set_updated_at();
create trigger invoices_tenant_immutable before update of tenant_id on public.invoices
  for each row execute function private.prevent_tenant_change();

comment on table public.invoices is
  'Quotes and invoices. Totals are maintained from invoice_lines; numbers are gapless per tenant and kind.';

create table public.invoice_lines (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null,
  invoice_id           uuid not null,
  position             integer not null default 0,
  description          text not null check (char_length(btrim(description)) between 1 and 500),
  quantity             numeric(12, 2) not null default 1 check (quantity > 0),
  unit_price_minor     bigint not null check (unit_price_minor >= 0),
  -- Tax rate in basis points (1600 = 16% VAT), added on top of the price.
  tax_rate_bp          integer not null default 0 check (tax_rate_bp between 0 and 10000),
  -- Half-up rounding per line, mirrored by math.ts in the billing package.
  line_subtotal_minor  bigint generated always as (round(quantity * unit_price_minor)::bigint) stored,
  line_tax_minor       bigint generated always as
                       (round(round(quantity * unit_price_minor) * tax_rate_bp / 10000.0)::bigint) stored,
  line_total_minor     bigint generated always as
                       (round(quantity * unit_price_minor)::bigint
                        + round(round(quantity * unit_price_minor) * tax_rate_bp / 10000.0)::bigint) stored,
  foreign key (tenant_id, invoice_id) references public.invoices (tenant_id, id) on delete cascade
);
create index invoice_lines_invoice_idx on public.invoice_lines (invoice_id, position);
create index invoice_lines_tenant_idx on public.invoice_lines (tenant_id, invoice_id);
create trigger invoice_lines_tenant_immutable before update of tenant_id on public.invoice_lines
  for each row execute function private.prevent_tenant_change();

create table public.payments (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  invoice_id    uuid not null,
  amount_minor  bigint not null check (amount_minor > 0),
  method        text not null check (method in ('cash', 'mpesa', 'card', 'bank', 'other')),
  reference     text check (reference is null or char_length(btrim(reference)) between 1 and 100),
  note          text not null default '' check (char_length(note) <= 500),
  received_at   timestamptz not null default now(),
  recorded_by   uuid default auth.uid() references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (tenant_id, id),
  -- Only drafts can be deleted and drafts have no payments, so this cascade
  -- only runs when the whole tenant is deleted.
  foreign key (tenant_id, invoice_id) references public.invoices (tenant_id, id) on delete cascade
);
create index payments_invoice_idx on public.payments (invoice_id, received_at);
-- An M-Pesa receipt can only settle one payment per tenant.
create unique index payments_mpesa_reference_idx on public.payments (tenant_id, reference)
  where method = 'mpesa' and reference is not null;

comment on table public.payments is
  'Append-only payments against invoices. Inserts lock the invoice and refuse overpayment.';

-- ---------------------------------------------------------------------------
-- Gapless numbering. The counter lives in the private schema (no client
-- access). INSERT .. ON CONFLICT DO UPDATE locks the tenant's counter row
-- until the issuing transaction ends, so concurrent issues queue up.
-- ---------------------------------------------------------------------------
create table private.billing_counters (
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  kind        text not null check (kind in ('invoice', 'quote')),
  last_value  bigint not null check (last_value > 0),
  primary key (tenant_id, kind)
);

create function private.next_document_number(p_tenant_id uuid, p_kind text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_next bigint;
begin
  insert into private.billing_counters as c (tenant_id, kind, last_value)
  values (p_tenant_id, p_kind, 1)
  on conflict (tenant_id, kind) do update set last_value = c.last_value + 1
  returning c.last_value into v_next;
  return case p_kind when 'quote' then 'QUO-' else 'INV-' end || lpad(v_next::text, 5, '0');
end;
$$;
revoke all on function private.next_document_number(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Triggers.
-- ---------------------------------------------------------------------------

-- New documents take the tenant's currency.
create function private.prepare_invoice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select t.currency into new.currency from public.tenants t where t.id = new.tenant_id;
  return new;
end;
$$;
create trigger invoices_prepare before insert on public.invoices
  for each row execute function private.prepare_invoice();

-- Only drafts may be edited by clients; status, totals and numbers are
-- changed by the SECURITY DEFINER functions and triggers below.
create function private.guard_invoice()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if private.is_client_call() and old.status <> 'draft' then
    raise exception 'Only drafts can be edited' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger invoices_guard before update on public.invoices
  for each row execute function private.guard_invoice();

-- Lines belong to drafts. (A cascade from a deleted invoice finds no parent.)
create function private.guard_invoice_line()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  select i.status into v_status
  from public.invoices i
  where i.id = case when tg_op = 'DELETE' then old.invoice_id else new.invoice_id end;
  if found and v_status <> 'draft' then
    raise exception 'Only drafts can be edited' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' then
    if new.invoice_id is distinct from old.invoice_id then
      raise exception 'Lines cannot move between documents' using errcode = '22023';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
create trigger invoice_lines_guard before insert or update or delete on public.invoice_lines
  for each row execute function private.guard_invoice_line();

create function private.sync_invoice_totals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice uuid := case when tg_op = 'DELETE' then old.invoice_id else new.invoice_id end;
begin
  update public.invoices i
  set subtotal_minor = s.subtotal, tax_minor = s.tax, total_minor = s.subtotal + s.tax
  from (
    select coalesce(sum(l.line_subtotal_minor), 0)::bigint as subtotal,
           coalesce(sum(l.line_tax_minor), 0)::bigint as tax
    from public.invoice_lines l
    where l.invoice_id = v_invoice
  ) s
  where i.id = v_invoice
    and (i.subtotal_minor, i.tax_minor) is distinct from (s.subtotal, s.tax);
  return null;
end;
$$;
create trigger invoice_lines_totals after insert or update or delete on public.invoice_lines
  for each row execute function private.sync_invoice_totals();

-- Direct client inserts must hold payments.record before the checks below
-- reveal anything about the invoice (RLS would reject them afterwards anyway).
create function private.authorize_payment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if private.is_client_call() then
    perform private.assert_permission(new.tenant_id, 'payments.record');
  end if;
  return new;
end;
$$;
create trigger payments_authorize before insert on public.payments
  for each row execute function private.authorize_payment();

-- Before a payment: lock the invoice and check the amount fits the balance.
create function private.check_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invoices;
begin
  select * into v_inv from public.invoices
  where id = new.invoice_id and tenant_id = new.tenant_id
  for update;
  if not found then
    raise exception 'Invoice not found' using errcode = 'P0002';
  end if;
  if v_inv.kind <> 'invoice' or v_inv.status not in ('issued', 'partially_paid') then
    raise exception 'Payments can only be recorded against issued, unpaid invoices' using errcode = '22023';
  end if;
  if new.amount_minor > v_inv.total_minor - v_inv.paid_minor then
    raise exception 'Payment exceeds the balance due' using errcode = '22023';
  end if;
  new.reference := nullif(btrim(new.reference), '');
  new.note := btrim(coalesce(new.note, ''));
  return new;
end;
$$;
create trigger payments_check before insert on public.payments
  for each row execute function private.check_payment();

-- After a payment: add it up and derive the status.
create function private.apply_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.invoices i
  set paid_minor = i.paid_minor + new.amount_minor,
      status = case
        when i.paid_minor + new.amount_minor >= i.total_minor then 'paid'
        else 'partially_paid'
      end
  where i.id = new.invoice_id;
  return null;
end;
$$;
create trigger payments_apply after insert on public.payments
  for each row execute function private.apply_payment();

create function private.payments_append_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Allowed only as part of deleting the invoice (i.e. the whole tenant).
  if tg_op = 'DELETE' and not exists (select 1 from public.invoices i where i.id = old.invoice_id) then
    return old;
  end if;
  raise exception 'Payments cannot be changed or deleted; void the invoice instead' using errcode = '22023';
end;
$$;
create trigger payments_append_only before update or delete on public.payments
  for each row execute function private.payments_append_only();

-- ---------------------------------------------------------------------------
-- Permissions.
-- ---------------------------------------------------------------------------
select private.register_permission('billing.view', 'billing', 'View quotes, invoices and payments',
  array['manager', 'front_desk', 'waiter', 'sales', 'viewer']);
select private.register_permission('billing.create', 'billing', 'Create, edit and delete draft quotes and invoices',
  array['manager', 'front_desk', 'sales']);
select private.register_permission('billing.issue', 'billing', 'Issue quotes and invoices and convert accepted quotes',
  array['manager', 'front_desk', 'sales']);
select private.register_permission('billing.void', 'billing', 'Void issued quotes and unpaid invoices',
  array['manager']);
select private.register_permission('payments.record', 'billing', 'Record payments against invoices',
  array['manager', 'front_desk', 'waiter', 'sales']);

-- ---------------------------------------------------------------------------
-- Audit, privileges and row level security.
-- ---------------------------------------------------------------------------
select private.enable_audit('public.invoices');
select private.enable_audit('public.invoice_lines');
select private.enable_audit('public.payments');

revoke all on public.invoices, public.invoice_lines, public.payments from anon, authenticated;

grant select, delete on public.invoices to authenticated;
grant insert (tenant_id, kind, customer_id, source_type, source_id, due_date, notes)
  on public.invoices to authenticated;
grant update (customer_id, source_type, source_id, due_date, notes) on public.invoices to authenticated;

grant select, delete on public.invoice_lines to authenticated;
grant insert (tenant_id, invoice_id, position, description, quantity, unit_price_minor, tax_rate_bp)
  on public.invoice_lines to authenticated;
grant update (position, description, quantity, unit_price_minor, tax_rate_bp)
  on public.invoice_lines to authenticated;

grant select on public.payments to authenticated;
grant insert (tenant_id, invoice_id, amount_minor, method, reference, note) on public.payments to authenticated;

alter table public.invoices      enable row level security;
alter table public.invoice_lines enable row level security;
alter table public.payments      enable row level security;

create policy "billing.view reads invoices"
  on public.invoices for select to authenticated
  using (tenant_id in (select private.permitted_tenant_ids('billing.view')));
create policy "billing.create adds drafts"
  on public.invoices for insert to authenticated
  with check (status = 'draft' and tenant_id in (select private.permitted_tenant_ids('billing.create')));
create policy "billing.create edits drafts"
  on public.invoices for update to authenticated
  using (status = 'draft' and tenant_id in (select private.permitted_tenant_ids('billing.create')))
  with check (status = 'draft' and tenant_id in (select private.permitted_tenant_ids('billing.create')));
create policy "billing.create deletes drafts"
  on public.invoices for delete to authenticated
  using (status = 'draft' and tenant_id in (select private.permitted_tenant_ids('billing.create')));

create policy "billing.view reads lines"
  on public.invoice_lines for select to authenticated
  using (tenant_id in (select private.permitted_tenant_ids('billing.view')));
create policy "billing.create adds lines"
  on public.invoice_lines for insert to authenticated
  with check (tenant_id in (select private.permitted_tenant_ids('billing.create')));
create policy "billing.create edits lines"
  on public.invoice_lines for update to authenticated
  using (tenant_id in (select private.permitted_tenant_ids('billing.create')))
  with check (tenant_id in (select private.permitted_tenant_ids('billing.create')));
create policy "billing.create removes lines"
  on public.invoice_lines for delete to authenticated
  using (tenant_id in (select private.permitted_tenant_ids('billing.create')));

create policy "billing.view reads payments"
  on public.payments for select to authenticated
  using (tenant_id in (select private.permitted_tenant_ids('billing.view')));
create policy "payments.record adds payments"
  on public.payments for insert to authenticated
  with check (tenant_id in (select private.permitted_tenant_ids('payments.record')));

-- Realtime: invoice pages refresh when a payment lands (e.g. an M-Pesa callback).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.invoices;
  end if;
end;
$$;
