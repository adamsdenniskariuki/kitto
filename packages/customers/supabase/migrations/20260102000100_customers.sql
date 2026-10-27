-- =============================================================================
-- customers 0001 Customer records and their notes timeline.
--
--   * One `customers` table serves every kind of app: hotel guests, diners,
--     car buyers. App-specific fields go in `attributes` (jsonb object), e.g.
--     {"id_number": "...", "preferred_model": "..."}, so no app needs a fork.
--   * Phone numbers are normalised to E.164 by a trigger and unique per
--     tenant, so "0712 345 678" and "+254712345678" are the same customer.
--   * Customers are archived rather than deleted once anything references
--     them (bookings, invoices, orders use ON DELETE RESTRICT foreign keys).
--   * `customer_notes` is an append-only timeline (calls, preferences,
--     complaints). Other modules show their own history next to it.
-- =============================================================================

create table public.customers (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete cascade,
  name         text not null check (char_length(btrim(name)) between 1 and 120),
  phone        text check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  email        text check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 254),
  tags         text[] not null default '{}' check (cardinality(tags) <= 20),
  notes        text not null default '' check (char_length(notes) <= 2000),
  attributes   jsonb not null default '{}' check (jsonb_typeof(attributes) = 'object'),
  archived_at  timestamptz,
  created_by   uuid default auth.uid() references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- Target for composite foreign keys from other modules: (tenant_id, customer_id)
  -- guarantees a booking can only point at a customer of the same tenant.
  unique (tenant_id, id)
);
create unique index customers_tenant_phone_idx on public.customers (tenant_id, phone)
  where phone is not null;
create index customers_tenant_name_idx on public.customers (tenant_id, lower(name));
create index customers_tenant_email_idx on public.customers (tenant_id, lower(email));

comment on table public.customers is
  'People or companies a tenant does business with. App-specific fields live in attributes.';

create trigger customers_updated_at before update on public.customers
  for each row execute function private.set_updated_at();
create trigger customers_tenant_immutable before update of tenant_id on public.customers
  for each row execute function private.prevent_tenant_change();

-- Normalise contact details before the CHECK constraints see them.
create function private.normalize_customer()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.name := btrim(new.name);
  new.phone := case when btrim(coalesce(new.phone, '')) = '' then null
                    else public.normalize_phone(new.phone) end;
  new.email := nullif(lower(btrim(coalesce(new.email, ''))), '');
  new.tags := coalesce(
    (select array_agg(distinct lower(btrim(t)) order by lower(btrim(t)))
     from unnest(new.tags) as t where btrim(t) <> ''),
    '{}');
  return new;
end;
$$;
create trigger customers_normalize before insert or update of name, phone, email, tags
  on public.customers for each row execute function private.normalize_customer();

create table public.customer_notes (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null,
  customer_id  uuid not null,
  body         text not null check (char_length(btrim(body)) between 1 and 2000),
  author_id    uuid default auth.uid() references auth.users (id) on delete set null,
  author_email text default (auth.jwt() ->> 'email'),
  created_at   timestamptz not null default now(),
  foreign key (tenant_id, customer_id) references public.customers (tenant_id, id) on delete cascade
);
create index customer_notes_tenant_customer_idx
  on public.customer_notes (tenant_id, customer_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Permissions (owners always hold every permission).
-- ---------------------------------------------------------------------------
select private.register_permission('customers.view', 'customers', 'View customers and their history',
  array['manager', 'front_desk', 'waiter', 'sales', 'viewer']);
select private.register_permission('customers.create', 'customers', 'Add customers',
  array['manager', 'front_desk', 'waiter', 'sales']);
select private.register_permission('customers.edit', 'customers', 'Edit, archive and add notes to customers',
  array['manager', 'front_desk', 'sales']);
select private.register_permission('customers.delete', 'customers', 'Delete customers with no history',
  array['manager']);

-- ---------------------------------------------------------------------------
-- Audit and row level security.
-- ---------------------------------------------------------------------------
select private.enable_audit('public.customers');
select private.enable_audit('public.customer_notes');

revoke all on public.customers, public.customer_notes from anon, authenticated;
grant select, delete on public.customers to authenticated;
grant insert (tenant_id, name, phone, email, tags, notes, attributes) on public.customers to authenticated;
grant update (name, phone, email, tags, notes, attributes, archived_at) on public.customers to authenticated;
grant select, delete on public.customer_notes to authenticated;
grant insert (tenant_id, customer_id, body) on public.customer_notes to authenticated;

alter table public.customers enable row level security;
alter table public.customer_notes enable row level security;

create policy "customers.view reads customers"
  on public.customers for select to authenticated
  using (tenant_id in (select private.permitted_tenant_ids('customers.view')));
create policy "customers.create adds customers"
  on public.customers for insert to authenticated
  with check (tenant_id in (select private.permitted_tenant_ids('customers.create')));
create policy "customers.edit updates customers"
  on public.customers for update to authenticated
  using (tenant_id in (select private.permitted_tenant_ids('customers.edit')))
  with check (tenant_id in (select private.permitted_tenant_ids('customers.edit')));
create policy "customers.delete deletes customers"
  on public.customers for delete to authenticated
  using (tenant_id in (select private.permitted_tenant_ids('customers.delete')));

create policy "customers.view reads notes"
  on public.customer_notes for select to authenticated
  using (tenant_id in (select private.permitted_tenant_ids('customers.view')));
create policy "customers.edit adds notes"
  on public.customer_notes for insert to authenticated
  with check (tenant_id in (select private.permitted_tenant_ids('customers.edit')));
-- Authors can take back their own note; customers.delete can remove any.
create policy "authors or customers.delete remove notes"
  on public.customer_notes for delete to authenticated
  using (
    (author_id = (select auth.uid()) and tenant_id in (select private.permitted_tenant_ids('customers.edit')))
    or tenant_id in (select private.permitted_tenant_ids('customers.delete'))
  );
