-- =============================================================================
-- inventory 0001 Stock locations, items, suppliers, purchases and the stock
-- movement ledger.
--
--   * Quantities are numeric(12,3) so items can be counted in whole units
--     (bottles, filters) or measured (2.5 kg, 0.75 l). Money is integer minor
--     units in the tenant's currency.
--   * stock_movements is an append-only ledger of signed quantities per item
--     and location (purchase, sale, return, adjustment, transfer). Nothing
--     ever edits or deletes a movement; mistakes are corrected with another
--     movement.
--   * stock_levels is a summary of the ledger, one row per item and location,
--     maintained ONLY by the trigger on stock_movements:
--         INSERT .. ON CONFLICT (item_id, location_id) DO UPDATE
--           SET quantity = quantity + excluded.quantity RETURNING quantity
--     The upsert takes a row lock on the level row, so concurrent movements
--     for the same item and location queue up and each one sees the result
--     of the one before it (READ COMMITTED re-reads the locked row). If the
--     new level is below zero, the movement takes stock away and the item
--     does not allow negative stock, the trigger raises and the whole
--     operation (a sale, a transfer, an order being sent) rolls back. Two
--     people can therefore never sell the last bottle twice.
--   * Functions that move several items or locations at once lock the level
--     rows in a fixed order (item, then location) first, so they cannot
--     deadlock with each other.
--   * Every tenant has one default location ("Main store") created with the
--     tenant; more can be added (bar, kitchen, workshop...).
-- =============================================================================

create table public.stock_locations (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  is_default  boolean not null default false,
  active      boolean not null default true,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, id),
  constraint stock_locations_default_active check (not is_default or active)
);
create unique index stock_locations_tenant_name_idx on public.stock_locations (tenant_id, lower(btrim(name)));
create unique index stock_locations_one_default_idx on public.stock_locations (tenant_id) where is_default;

create trigger stock_locations_updated_at before update on public.stock_locations
  for each row execute function private.set_updated_at();
create trigger stock_locations_tenant_immutable before update of tenant_id on public.stock_locations
  for each row execute function private.prevent_tenant_change();

comment on table public.stock_locations is
  'Places stock is kept (store, bar, kitchen, workshop). Each tenant has exactly one default location.';

create table public.suppliers (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id) on delete cascade,
  name          text not null check (char_length(btrim(name)) between 1 and 120),
  contact_name  text not null default '' check (char_length(contact_name) <= 120),
  phone         text check (phone is null or char_length(btrim(phone)) between 1 and 40),
  email         text check (email is null or char_length(btrim(email)) between 3 and 254),
  notes         text not null default '' check (char_length(notes) <= 2000),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, id)
);
create index suppliers_tenant_name_idx on public.suppliers (tenant_id, name);

create trigger suppliers_updated_at before update on public.suppliers
  for each row execute function private.set_updated_at();
create trigger suppliers_tenant_immutable before update of tenant_id on public.suppliers
  for each row execute function private.prevent_tenant_change();

create table public.items (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants (id) on delete cascade,
  sku             text check (sku is null or sku ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$'),
  name            text not null check (char_length(btrim(name)) between 1 and 120),
  unit            text not null default 'each' check (char_length(btrim(unit)) between 1 and 20),
  category        text not null default '' check (char_length(category) <= 60),
  description     text not null default '' check (char_length(description) <= 2000),
  -- What it costs to buy and what it sells for, per unit. Optional.
  cost_minor      bigint check (cost_minor is null or cost_minor >= 0),
  price_minor     bigint check (price_minor is null or price_minor >= 0),
  -- At or below this total quantity (all locations) the item is "low".
  reorder_level   numeric(12, 3) not null default 0 check (reorder_level >= 0),
  -- Services and made-to-order dishes have no stock to count.
  track_stock     boolean not null default true,
  -- Some stock may run below zero (e.g. ingredients counted later).
  allow_negative  boolean not null default false,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tenant_id, id)
);
create unique index items_tenant_sku_idx on public.items (tenant_id, lower(sku)) where sku is not null;
create index items_tenant_name_idx on public.items (tenant_id, name);

create trigger items_updated_at before update on public.items
  for each row execute function private.set_updated_at();
create trigger items_tenant_immutable before update of tenant_id on public.items
  for each row execute function private.prevent_tenant_change();

comment on table public.items is
  'Things that are stocked or sold. Stock levels come from stock_movements, never from this table.';

create table public.purchases (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants (id) on delete cascade,
  supplier_id     uuid not null,
  location_id     uuid not null,
  status          text not null default 'draft' check (status in ('draft', 'received')),
  reference       text not null default '' check (char_length(reference) <= 60),
  notes           text not null default '' check (char_length(notes) <= 2000),
  total_minor     bigint not null default 0 check (total_minor >= 0),
  received_at     timestamptz,
  received_by     uuid references auth.users (id) on delete set null,
  created_by      uuid default auth.uid() references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint purchases_received check ((status = 'received') = (received_at is not null)),
  unique (tenant_id, id),
  foreign key (tenant_id, supplier_id) references public.suppliers (tenant_id, id),
  foreign key (tenant_id, location_id) references public.stock_locations (tenant_id, id)
);
create index purchases_tenant_created_idx on public.purchases (tenant_id, created_at desc);
create index purchases_tenant_supplier_idx on public.purchases (tenant_id, supplier_id);

create trigger purchases_updated_at before update on public.purchases
  for each row execute function private.set_updated_at();
create trigger purchases_tenant_immutable before update of tenant_id on public.purchases
  for each row execute function private.prevent_tenant_change();

comment on table public.purchases is
  'Purchases from suppliers. Drafts are editable; receiving one books its lines into stock and freezes it.';

create table public.purchase_lines (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  purchase_id       uuid not null,
  item_id           uuid not null,
  position          integer not null default 0,
  quantity          numeric(12, 3) not null check (quantity > 0),
  unit_cost_minor   bigint not null default 0 check (unit_cost_minor >= 0),
  line_total_minor  bigint generated always as (round(quantity * unit_cost_minor)::bigint) stored,
  foreign key (tenant_id, purchase_id) references public.purchases (tenant_id, id) on delete cascade,
  foreign key (tenant_id, item_id) references public.items (tenant_id, id)
);
create index purchase_lines_tenant_idx on public.purchase_lines (tenant_id, purchase_id);
create index purchase_lines_purchase_idx on public.purchase_lines (purchase_id, position);
create index purchase_lines_item_idx on public.purchase_lines (item_id);
create trigger purchase_lines_tenant_immutable before update of tenant_id on public.purchase_lines
  for each row execute function private.prevent_tenant_change();

create table public.stock_movements (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants (id) on delete cascade,
  item_id          uuid not null,
  location_id      uuid not null,
  kind             text not null check (kind in ('purchase', 'sale', 'return', 'adjustment', 'transfer')),
  -- Signed: positive adds stock at the location, negative takes it away.
  quantity         numeric(12, 3) not null check (quantity <> 0),
  unit_cost_minor  bigint check (unit_cost_minor is null or unit_cost_minor >= 0),
  reason           text not null default '' check (char_length(reason) <= 200),
  -- What caused it, generically ('purchase', 'order', ...), so modules can
  -- move stock without inventory depending on them.
  source_type      text check (source_type ~ '^[a-z][a-z0-9_]{0,39}$'),
  source_id        uuid,
  -- Both halves of a transfer share this id.
  transfer_id      uuid,
  created_by       uuid default auth.uid() references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint stock_movements_source_pair check ((source_type is null) = (source_id is null)),
  constraint stock_movements_sign check (
    (kind = 'purchase' and quantity > 0)
    or (kind = 'sale' and quantity < 0)
    or (kind = 'return' and quantity > 0)
    or kind in ('adjustment', 'transfer')
  ),
  constraint stock_movements_reason check (kind <> 'adjustment' or char_length(btrim(reason)) > 0),
  constraint stock_movements_transfer check ((kind = 'transfer') = (transfer_id is not null)),
  foreign key (tenant_id, item_id) references public.items (tenant_id, id),
  foreign key (tenant_id, location_id) references public.stock_locations (tenant_id, id)
);
create index stock_movements_tenant_created_idx on public.stock_movements (tenant_id, created_at desc);
create index stock_movements_item_idx on public.stock_movements (item_id, created_at desc);
create index stock_movements_location_idx on public.stock_movements (location_id);
create index stock_movements_source_idx on public.stock_movements (tenant_id, source_type, source_id)
  where source_id is not null;

comment on table public.stock_movements is
  'Append-only stock ledger: signed quantity per item and location. stock_levels is derived from it.';

create table public.stock_levels (
  tenant_id    uuid not null references public.tenants (id) on delete cascade,
  item_id      uuid not null,
  location_id  uuid not null,
  quantity     numeric(14, 3) not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (item_id, location_id),
  foreign key (tenant_id, item_id) references public.items (tenant_id, id) on delete cascade,
  foreign key (tenant_id, location_id) references public.stock_locations (tenant_id, id) on delete cascade
);
create index stock_levels_tenant_idx on public.stock_levels (tenant_id, item_id);

comment on table public.stock_levels is
  'Quantity on hand per item and location: the running sum of stock_movements, kept by trigger.';

-- ---------------------------------------------------------------------------
-- Default location for every tenant (new ones by trigger, existing ones now).
-- ---------------------------------------------------------------------------
create function private.seed_stock_location()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.stock_locations (tenant_id, name, is_default)
  values (new.id, 'Main store', true);
  return null;
end;
$$;
revoke all on function private.seed_stock_location() from public, anon, authenticated;
create trigger tenants_seed_stock_location after insert on public.tenants
  for each row execute function private.seed_stock_location();

insert into public.stock_locations (tenant_id, name, is_default)
select t.id, 'Main store', true
from public.tenants t
where not exists (select 1 from public.stock_locations l where l.tenant_id = t.id and l.is_default);

-- The default location cannot be switched off or deleted (it may be renamed).
create function private.guard_stock_location()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.is_default and private.is_client_call() then
      raise exception 'The default location cannot be deleted' using errcode = '22023';
    end if;
    return old;
  end if;
  if private.is_client_call() and old.is_default and not new.active then
    raise exception 'The default location cannot be deactivated' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger stock_locations_guard before update or delete on public.stock_locations
  for each row execute function private.guard_stock_location();

-- Tidy text; items that have stock history keep tracking it.
create function private.guard_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.sku := nullif(btrim(new.sku), '');
  new.name := btrim(new.name);
  new.unit := btrim(new.unit);
  new.category := btrim(new.category);
  if tg_op = 'UPDATE' and old.track_stock and not new.track_stock
     and exists (select 1 from public.stock_movements m where m.item_id = old.id) then
    raise exception 'An item with stock history must keep tracking stock' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger items_guard before insert or update on public.items
  for each row execute function private.guard_item();

-- ---------------------------------------------------------------------------
-- Purchases: only drafts are editable by clients; lines follow their parent.
-- ---------------------------------------------------------------------------
create function private.guard_purchase()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if private.is_client_call() and old.status <> 'draft' then
    raise exception 'Received purchases cannot be changed' using errcode = '22023';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
create trigger purchases_guard before update or delete on public.purchases
  for each row execute function private.guard_purchase();

create function private.guard_purchase_line()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  select p.status into v_status
  from public.purchases p
  where p.id = case when tg_op = 'DELETE' then old.purchase_id else new.purchase_id end;
  if found and v_status <> 'draft' then
    raise exception 'Received purchases cannot be changed' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' and (new.purchase_id, new.item_id) is distinct from (old.purchase_id, old.item_id) then
    raise exception 'Lines cannot move between purchases or items' using errcode = '22023';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if not exists (select 1 from public.items i where i.id = new.item_id and i.track_stock) then
    raise exception 'Only items that track stock can be purchased' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger purchase_lines_guard before insert or update or delete on public.purchase_lines
  for each row execute function private.guard_purchase_line();

create function private.sync_purchase_total()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_purchase uuid := case when tg_op = 'DELETE' then old.purchase_id else new.purchase_id end;
begin
  update public.purchases p
  set total_minor = s.total
  from (
    select coalesce(sum(l.line_total_minor), 0)::bigint as total
    from public.purchase_lines l
    where l.purchase_id = v_purchase
  ) s
  where p.id = v_purchase and p.total_minor is distinct from s.total;
  return null;
end;
$$;
create trigger purchase_lines_total after insert or update or delete on public.purchase_lines
  for each row execute function private.sync_purchase_total();

-- ---------------------------------------------------------------------------
-- The ledger.
-- ---------------------------------------------------------------------------
create function private.check_stock_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.items;
begin
  select * into v_item from public.items i where i.id = new.item_id and i.tenant_id = new.tenant_id;
  if not found then
    raise exception 'Item not found' using errcode = 'P0002';
  end if;
  if not v_item.track_stock then
    raise exception '% does not track stock', v_item.name using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.stock_locations l where l.id = new.location_id and l.tenant_id = new.tenant_id
  ) then
    raise exception 'Location not found' using errcode = 'P0002';
  end if;
  new.reason := btrim(coalesce(new.reason, ''));
  new.created_at := now();
  return new;
end;
$$;
create trigger stock_movements_check before insert on public.stock_movements
  for each row execute function private.check_stock_movement();

-- Add the movement to the level. The upsert locks the level row until the
-- transaction ends, which is what makes concurrent consumption safe.
create function private.apply_stock_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_level numeric;
  v_item  public.items;
  v_where text;
begin
  insert into public.stock_levels as s (tenant_id, item_id, location_id, quantity, updated_at)
  values (new.tenant_id, new.item_id, new.location_id, new.quantity, now())
  on conflict (item_id, location_id)
  do update set quantity = s.quantity + excluded.quantity, updated_at = now()
  returning s.quantity into v_level;

  if v_level < 0 and new.quantity < 0 then
    select * into v_item from public.items i where i.id = new.item_id;
    if not v_item.allow_negative then
      select l.name into v_where from public.stock_locations l where l.id = new.location_id;
      raise exception 'Not enough % in stock at %', v_item.name, v_where
        using errcode = '22023', hint = 'insufficient_stock';
    end if;
  end if;
  return null;
end;
$$;
create trigger stock_movements_apply after insert on public.stock_movements
  for each row execute function private.apply_stock_movement();

create function private.stock_movements_append_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Allowed only when the whole tenant is being deleted.
  if tg_op = 'DELETE' and not exists (select 1 from public.tenants t where t.id = old.tenant_id) then
    return old;
  end if;
  raise exception 'Stock movements cannot be changed or deleted; record another movement instead'
    using errcode = '22023';
end;
$$;
create trigger stock_movements_append_only before update or delete on public.stock_movements
  for each row execute function private.stock_movements_append_only();

-- Lock the level rows a multi-row operation is about to touch, in a fixed
-- order (item, then location), creating missing ones at zero, so concurrent
-- operations queue instead of deadlocking.
create function private.lock_stock_levels(p_tenant_id uuid, p_pairs jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pair record;
begin
  for v_pair in
    select distinct (e ->> 'item_id')::uuid as item_id, (e ->> 'location_id')::uuid as location_id
    from jsonb_array_elements(p_pairs) e
    order by 1, 2
  loop
    if not exists (select 1 from public.items i where i.id = v_pair.item_id and i.tenant_id = p_tenant_id) then
      raise exception 'Item not found' using errcode = 'P0002';
    end if;
    if not exists (
      select 1 from public.stock_locations l where l.id = v_pair.location_id and l.tenant_id = p_tenant_id
    ) then
      raise exception 'Location not found' using errcode = 'P0002';
    end if;
    insert into public.stock_levels (tenant_id, item_id, location_id, quantity)
    values (p_tenant_id, v_pair.item_id, v_pair.location_id, 0)
    on conflict (item_id, location_id) do nothing;
    perform 1 from public.stock_levels s
    where s.item_id = v_pair.item_id and s.location_id = v_pair.location_id
    for update;
  end loop;
end;
$$;
revoke all on function private.lock_stock_levels(uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- What's on hand, per item across all locations; "low" when at or below the
-- reorder level (or below zero). Runs with the caller's rights, so RLS on
-- items and stock_levels applies.
-- ---------------------------------------------------------------------------
create view public.item_stock
with (security_invoker = true)
as
select
  i.id as item_id,
  i.tenant_id,
  i.sku,
  i.name,
  i.unit,
  i.category,
  i.reorder_level,
  i.track_stock,
  i.active,
  coalesce(sum(s.quantity), 0)::numeric(14, 3) as on_hand,
  (i.track_stock and i.active
   and (coalesce(sum(s.quantity), 0) < 0
        or (i.reorder_level > 0 and coalesce(sum(s.quantity), 0) <= i.reorder_level))) as low
from public.items i
left join public.stock_levels s on s.item_id = i.id
group by i.id;

comment on view public.item_stock is
  'Quantity on hand per item (all locations) and whether it is at or below its reorder level.';

-- ---------------------------------------------------------------------------
-- Permissions.
-- ---------------------------------------------------------------------------
select private.register_permission('inventory.view', 'inventory', 'View items, stock levels, suppliers and purchases',
  array['manager', 'front_desk', 'waiter', 'storekeeper', 'sales', 'viewer']);
select private.register_permission('inventory.manage', 'inventory', 'Add and edit items, suppliers and locations',
  array['manager', 'storekeeper']);
select private.register_permission('inventory.purchase', 'inventory', 'Record and receive purchases from suppliers',
  array['manager', 'storekeeper']);
select private.register_permission('inventory.adjust', 'inventory', 'Adjust stock counts (with a reason)',
  array['manager', 'storekeeper']);
select private.register_permission('inventory.transfer', 'inventory', 'Move stock between locations',
  array['manager', 'storekeeper']);

-- ---------------------------------------------------------------------------
-- Audit, privileges and row level security.
-- ---------------------------------------------------------------------------
select private.enable_audit('public.stock_locations');
select private.enable_audit('public.suppliers');
select private.enable_audit('public.items');
select private.enable_audit('public.purchases');
select private.enable_audit('public.purchase_lines');
select private.enable_audit('public.stock_movements');

revoke all on public.stock_locations, public.suppliers, public.items, public.purchases,
  public.purchase_lines, public.stock_movements, public.stock_levels, public.item_stock
  from anon, authenticated;

grant select, delete on public.stock_locations to authenticated;
grant insert (tenant_id, name, active, position) on public.stock_locations to authenticated;
grant update (name, active, position) on public.stock_locations to authenticated;

grant select, delete on public.suppliers to authenticated;
grant insert (tenant_id, name, contact_name, phone, email, notes, active) on public.suppliers to authenticated;
grant update (name, contact_name, phone, email, notes, active) on public.suppliers to authenticated;

grant select, delete on public.items to authenticated;
grant insert (tenant_id, sku, name, unit, category, description, cost_minor, price_minor, reorder_level,
              track_stock, allow_negative, active)
  on public.items to authenticated;
grant update (sku, name, unit, category, description, cost_minor, price_minor, reorder_level,
              track_stock, allow_negative, active)
  on public.items to authenticated;

grant select, delete on public.purchases to authenticated;
grant insert (tenant_id, supplier_id, location_id, reference, notes) on public.purchases to authenticated;
grant update (supplier_id, location_id, reference, notes) on public.purchases to authenticated;

grant select, delete on public.purchase_lines to authenticated;
grant insert (tenant_id, purchase_id, item_id, position, quantity, unit_cost_minor)
  on public.purchase_lines to authenticated;
grant update (position, quantity, unit_cost_minor) on public.purchase_lines to authenticated;

-- The ledger and levels are written only by SECURITY DEFINER functions.
grant select on public.stock_movements to authenticated;
grant select on public.stock_levels to authenticated;
grant select on public.item_stock to authenticated;

alter table public.stock_locations enable row level security;
alter table public.suppliers       enable row level security;
alter table public.items           enable row level security;
alter table public.purchases       enable row level security;
alter table public.purchase_lines  enable row level security;
alter table public.stock_movements enable row level security;
alter table public.stock_levels    enable row level security;

create policy "inventory.view reads locations"
  on public.stock_locations for select to authenticated
  using (tenant_id in (select private.permitted_tenant_ids('inventory.view')));
create policy "inventory.manage adds locations"
  on public.stock_locations for insert to authenticated
  with check (tenant_id in (select private.permitted_tenant_ids('inventory.manage')));
create policy "inventory.manage edits locations"
  on public.stock_locations for update to authenticated
  using (tenant_id in (select private.permitted_tenant_ids('inventory.manage')))
  with check (tenant_id in (select private.permitted_tenant_ids('inventory.manage')));
create policy "inventory.manage deletes locations"
  on public.stock_locations for delete to authenticated
  using (tenant_id in (select private.permitted_tenant_ids('inventory.manage')));

create policy "inventory.view reads suppliers"
  on public.suppliers for select to authenticated
  using (tenant_id in (select private.permitted_tenant_ids('inventory.view')));
create policy "inventory.manage adds suppliers"
  on public.suppliers for insert to authenticated
  with check (tenant_id in (select private.permitted_tenant_ids('inventory.manage')));
create policy "inventory.manage edits suppliers"
  on public.suppliers for update to authenticated
  using (tenant_id in (select private.permitted_tenant_ids('inventory.manage')))
  with check (tenant_id in (select private.permitted_tenant_ids('inventory.manage')));
create policy "inventory.manage deletes suppliers"
  on public.suppliers for delete to authenticated
  using (tenant_id in (select private.permitted_tenant_ids('inventory.manage')));

create policy "inventory.view reads items"
  on public.items for select to authenticated
  using (tenant_id in (select private.permitted_tenant_ids('inventory.view')));
create policy "inventory.manage adds items"
  on public.items for insert to authenticated
  with check (tenant_id in (select private.permitted_tenant_ids('inventory.manage')));
create policy "inventory.manage edits items"
  on public.items for update to authenticated
  using (tenant_id in (select private.permitted_tenant_ids('inventory.manage')))
  with check (tenant_id in (select private.permitted_tenant_ids('inventory.manage')));
create policy "inventory.manage deletes items"
  on public.items for delete to authenticated
  using (tenant_id in (select private.permitted_tenant_ids('inventory.manage')));

create policy "inventory.view reads purchases"
  on public.purchases for select to authenticated
  using (tenant_id in (select private.permitted_tenant_ids('inventory.view')));
create policy "inventory.purchase adds purchases"
  on public.purchases for insert to authenticated
  with check (status = 'draft' and tenant_id in (select private.permitted_tenant_ids('inventory.purchase')));
create policy "inventory.purchase edits draft purchases"
  on public.purchases for update to authenticated
  using (status = 'draft' and tenant_id in (select private.permitted_tenant_ids('inventory.purchase')))
  with check (status = 'draft' and tenant_id in (select private.permitted_tenant_ids('inventory.purchase')));
create policy "inventory.purchase deletes draft purchases"
  on public.purchases for delete to authenticated
  using (status = 'draft' and tenant_id in (select private.permitted_tenant_ids('inventory.purchase')));

create policy "inventory.view reads purchase lines"
  on public.purchase_lines for select to authenticated
  using (tenant_id in (select private.permitted_tenant_ids('inventory.view')));
create policy "inventory.purchase adds purchase lines"
  on public.purchase_lines for insert to authenticated
  with check (tenant_id in (select private.permitted_tenant_ids('inventory.purchase')));
create policy "inventory.purchase edits purchase lines"
  on public.purchase_lines for update to authenticated
  using (tenant_id in (select private.permitted_tenant_ids('inventory.purchase')))
  with check (tenant_id in (select private.permitted_tenant_ids('inventory.purchase')));
create policy "inventory.purchase removes purchase lines"
  on public.purchase_lines for delete to authenticated
  using (tenant_id in (select private.permitted_tenant_ids('inventory.purchase')));

create policy "inventory.view reads movements"
  on public.stock_movements for select to authenticated
  using (tenant_id in (select private.permitted_tenant_ids('inventory.view')));

create policy "inventory.view reads stock levels"
  on public.stock_levels for select to authenticated
  using (tenant_id in (select private.permitted_tenant_ids('inventory.view')));

-- Realtime: stock and low-stock lists refresh as stock moves.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.stock_levels;
  end if;
end;
$$;
