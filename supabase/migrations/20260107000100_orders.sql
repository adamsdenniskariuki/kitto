-- =============================================================================
-- orders 0001 Orders and order lines (restaurant tables, bar tabs, a parts
-- counter...).
--
--     open -> sent -> fulfilled -> paid
--     open | sent -> cancelled
--
--   * Numbers are per tenant (#1, #2...) from a counter row locked by the
--     inserting transaction, so they are gapless like invoice numbers.
--   * Lines can only be added, changed or removed while the order is open. A
--     line is an inventory item (name and price copied from it unless given)
--     or free text.
--   * Sending an order ("to the kitchen", "to the counter") consumes stock:
--     one 'sale' movement per tracked item at the order's location, in the
--     same transaction as the status change. Not enough stock (and the item
--     doesn't allow negative stock) means the order is not sent.
--   * Cancelling a sent order returns exactly what it consumed ('return'
--     movements computed from the ledger). Fulfilled orders cannot be
--     cancelled; correct them with a stock adjustment and a credit instead.
--   * Paid: an order is billed on an invoice (its own, source 'order', or its
--     reservation's when it is charged to a booking). orders.invoice_id
--     records which; when that invoice becomes paid, fulfilled orders on it
--     become paid (sent ones as soon as they are fulfilled). Orders without
--     an invoice can be marked paid by hand (cash at the counter). Voiding
--     an invoice releases its orders so they can be billed again.
--   * Status only changes through public.set_order_status, which checks the
--     permission for the step; the trigger below enforces the flow for
--     everyone, including SECURITY DEFINER code.
--
-- Depends on inventory (items, locations, ledger), customers, booking
-- (reservations: an order can be charged to one) and billing (invoices).
-- =============================================================================

create table private.order_counters (
  tenant_id   uuid primary key references public.tenants (id) on delete cascade,
  last_value  integer not null check (last_value > 0)
);

create table public.orders (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants (id) on delete cascade,
  number          integer not null check (number > 0),
  status          text not null default 'open'
                  check (status in ('open', 'sent', 'fulfilled', 'paid', 'cancelled')),
  -- Where it is for: "Table 4", "Bar", "Counter", a job card number...
  channel         text not null default '' check (char_length(channel) <= 60),
  customer_id     uuid,
  -- Charged to a booking: billed with the reservation instead of on its own.
  reservation_id  uuid,
  -- Where stock is taken from when the order is sent.
  location_id     uuid not null,
  invoice_id      uuid,
  notes           text not null default '' check (char_length(notes) <= 2000),
  total_minor     bigint not null default 0 check (total_minor >= 0),
  sent_at         timestamptz,
  fulfilled_at    timestamptz,
  paid_at         timestamptz,
  cancelled_at    timestamptz,
  cancel_reason   text check (cancel_reason is null or char_length(cancel_reason) <= 500),
  created_by      uuid default auth.uid() references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, number),
  foreign key (tenant_id, customer_id) references public.customers (tenant_id, id),
  foreign key (tenant_id, reservation_id) references public.reservations (tenant_id, id),
  foreign key (tenant_id, location_id) references public.stock_locations (tenant_id, id),
  foreign key (tenant_id, invoice_id) references public.invoices (tenant_id, id) on delete set null (invoice_id)
);
create index orders_tenant_created_idx on public.orders (tenant_id, created_at desc);
create index orders_tenant_status_idx on public.orders (tenant_id, status);
create index orders_tenant_customer_idx on public.orders (tenant_id, customer_id) where customer_id is not null;
create index orders_tenant_reservation_idx on public.orders (tenant_id, reservation_id)
  where reservation_id is not null;
create index orders_invoice_idx on public.orders (invoice_id) where invoice_id is not null;

create trigger orders_updated_at before update on public.orders
  for each row execute function private.set_updated_at();
create trigger orders_tenant_immutable before update of tenant_id on public.orders
  for each row execute function private.prevent_tenant_change();

comment on table public.orders is
  'Orders (open -> sent -> fulfilled -> paid, or cancelled). Sending consumes stock; cancelling returns it.';

create table public.order_lines (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  order_id          uuid not null,
  item_id           uuid,
  position          integer not null default 0,
  description       text not null check (char_length(btrim(description)) between 1 and 200),
  quantity          numeric(12, 3) not null default 1 check (quantity > 0),
  unit_price_minor  bigint not null check (unit_price_minor >= 0),
  note              text not null default '' check (char_length(note) <= 200),
  line_total_minor  bigint generated always as (round(quantity * unit_price_minor)::bigint) stored,
  foreign key (tenant_id, order_id) references public.orders (tenant_id, id) on delete cascade,
  foreign key (tenant_id, item_id) references public.items (tenant_id, id)
);
create index order_lines_tenant_idx on public.order_lines (tenant_id, order_id);
create index order_lines_order_idx on public.order_lines (order_id, position);
create index order_lines_item_idx on public.order_lines (item_id) where item_id is not null;
create trigger order_lines_tenant_immutable before update of tenant_id on public.order_lines
  for each row execute function private.prevent_tenant_change();

-- ---------------------------------------------------------------------------
-- New orders: number, default location, customer from the reservation.
-- ---------------------------------------------------------------------------
create function private.prepare_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_res record;
begin
  if tg_op = 'INSERT' then
    insert into private.order_counters as c (tenant_id, last_value)
    values (new.tenant_id, 1)
    on conflict (tenant_id) do update set last_value = c.last_value + 1
    returning c.last_value into new.number;
    if new.location_id is null then
      select l.id into new.location_id
      from public.stock_locations l
      where l.tenant_id = new.tenant_id and l.is_default;
    end if;
  end if;
  new.channel := btrim(coalesce(new.channel, ''));
  new.notes := btrim(coalesce(new.notes, ''));

  if new.reservation_id is not null
     and (tg_op = 'INSERT' or new.reservation_id is distinct from old.reservation_id) then
    select r.status, r.customer_id into v_res
    from public.reservations r
    where r.id = new.reservation_id and r.tenant_id = new.tenant_id;
    if not found then
      raise exception 'Reservation not found' using errcode = 'P0002';
    end if;
    if v_res.status in ('cancelled', 'no_show') then
      raise exception 'Orders cannot be charged to a cancelled reservation' using errcode = '22023';
    end if;
    new.customer_id := coalesce(new.customer_id, v_res.customer_id);
  end if;
  return new;
end;
$$;
create trigger orders_prepare before insert or update of reservation_id, channel, notes on public.orders
  for each row execute function private.prepare_order();

-- The status machine (mirrored by status.ts in the orders package).
create function private.order_status_flow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allowed text[];
begin
  if old.status in ('paid', 'cancelled')
     and (new.status, new.channel, new.customer_id, new.reservation_id, new.location_id, new.notes,
          new.invoice_id)
         is distinct from
         (old.status, old.channel, old.customer_id, old.reservation_id, old.location_id, old.notes,
          old.invoice_id) then
    raise exception 'This order is % and can no longer be changed', old.status using errcode = '22023';
  end if;
  if new.location_id is distinct from old.location_id and old.status <> 'open' then
    raise exception 'The stock location can only change while the order is open' using errcode = '22023';
  end if;

  if new.status is distinct from old.status then
    v_allowed := case old.status
      when 'open'      then array['sent', 'cancelled']
      when 'sent'      then array['fulfilled', 'cancelled']
      when 'fulfilled' then array['paid']
      else '{}'::text[]
    end;
    if not new.status = any (v_allowed) then
      raise exception 'An order that is % cannot become %', old.status, new.status using errcode = '22023';
    end if;

    case new.status
      when 'sent' then
        if not exists (select 1 from public.order_lines l where l.order_id = new.id) then
          raise exception 'An order needs at least one line' using errcode = '22023';
        end if;
        new.sent_at := now();
      when 'fulfilled' then
        new.fulfilled_at := now();
        -- Already settled on a paid invoice: straight through to paid.
        if exists (select 1 from public.invoices i where i.id = new.invoice_id and i.status = 'paid') then
          new.status := 'paid';
          new.paid_at := now();
        end if;
      when 'paid' then
        new.paid_at := now();
      when 'cancelled' then
        new.cancelled_at := now();
        new.cancel_reason := nullif(btrim(new.cancel_reason), '');
      else null;
    end case;
  end if;
  return new;
end;
$$;
create trigger orders_status_flow before update on public.orders
  for each row execute function private.order_status_flow();

-- Stock follows the status: sending consumes, cancelling a sent order returns.
create function private.order_stock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is not distinct from old.status then
    return null;
  end if;

  if old.status = 'open' and new.status in ('sent', 'fulfilled', 'paid') then
    perform private.lock_stock_levels(new.tenant_id, (
      select coalesce(jsonb_agg(jsonb_build_object('item_id', l.item_id, 'location_id', new.location_id)), '[]')
      from public.order_lines l join public.items i on i.id = l.item_id
      where l.order_id = new.id and i.track_stock
    ));
    insert into public.stock_movements (tenant_id, item_id, location_id, kind, quantity, reason, source_type, source_id)
    select new.tenant_id, l.item_id, new.location_id, 'sale', -sum(l.quantity), 'Order #' || new.number,
           'order', new.id
    from public.order_lines l join public.items i on i.id = l.item_id
    where l.order_id = new.id and i.track_stock
    group by l.item_id
    order by l.item_id;
  elsif new.status = 'cancelled' then
    insert into public.stock_movements (tenant_id, item_id, location_id, kind, quantity, reason, source_type, source_id)
    select new.tenant_id, m.item_id, m.location_id, 'return', -sum(m.quantity),
           'Order #' || new.number || ' cancelled', 'order', new.id
    from public.stock_movements m
    where m.tenant_id = new.tenant_id and m.source_type = 'order' and m.source_id = new.id
    group by m.item_id, m.location_id
    having sum(m.quantity) < 0
    order by m.item_id, m.location_id;
  end if;
  return null;
end;
$$;
create trigger orders_stock after update of status on public.orders
  for each row execute function private.order_stock();

-- ---------------------------------------------------------------------------
-- Lines: only while open; items fill in their name and price.
-- ---------------------------------------------------------------------------
create function private.guard_order_line()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_item   public.items;
begin
  select o.status into v_status
  from public.orders o
  where o.id = case when tg_op = 'DELETE' then old.order_id else new.order_id end;
  if found and v_status <> 'open' then
    raise exception 'Only open orders can be changed' using errcode = '22023';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_op = 'UPDATE' and (new.order_id, new.item_id) is distinct from (old.order_id, old.item_id) then
    raise exception 'Lines cannot move between orders or items' using errcode = '22023';
  end if;

  if new.item_id is not null and tg_op = 'INSERT' then
    select * into v_item from public.items i where i.id = new.item_id and i.tenant_id = new.tenant_id;
    if not found then
      raise exception 'Item not found' using errcode = 'P0002';
    end if;
    if not v_item.active then
      raise exception 'That item is no longer sold' using errcode = '22023';
    end if;
    new.description := coalesce(nullif(btrim(new.description), ''), v_item.name);
    new.unit_price_minor := coalesce(new.unit_price_minor, v_item.price_minor, 0);
  end if;
  new.description := btrim(new.description);
  new.note := btrim(coalesce(new.note, ''));
  return new;
end;
$$;
create trigger order_lines_guard before insert or update or delete on public.order_lines
  for each row execute function private.guard_order_line();

create function private.sync_order_total()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order uuid := case when tg_op = 'DELETE' then old.order_id else new.order_id end;
begin
  update public.orders o
  set total_minor = s.total
  from (
    select coalesce(sum(l.line_total_minor), 0)::bigint as total
    from public.order_lines l
    where l.order_id = v_order
  ) s
  where o.id = v_order and o.total_minor is distinct from s.total;
  return null;
end;
$$;
create trigger order_lines_total after insert or update or delete on public.order_lines
  for each row execute function private.sync_order_total();

-- ---------------------------------------------------------------------------
-- Billing hooks. Invoices carry a generic source (billing knows nothing of
-- orders); these triggers link orders to the invoice that bills them and
-- settle them when it is paid.
-- ---------------------------------------------------------------------------
create function private.link_orders_to_invoice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind <> 'invoice' or new.source_id is null then
    return null;
  end if;
  if new.source_type = 'order' then
    update public.orders o
    set invoice_id = new.id
    where o.id = new.source_id and o.tenant_id = new.tenant_id
      and o.invoice_id is null and o.status in ('sent', 'fulfilled');
  elsif new.source_type = 'reservation' then
    -- The reservation's invoice also bills the orders charged to it.
    update public.orders o
    set invoice_id = new.id
    where o.reservation_id = new.source_id and o.tenant_id = new.tenant_id
      and o.invoice_id is null and o.status in ('sent', 'fulfilled');
  end if;
  return null;
end;
$$;
create trigger invoices_link_orders after insert on public.invoices
  for each row execute function private.link_orders_to_invoice();

create function private.settle_orders_from_invoice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'paid' and old.status <> 'paid' then
    update public.orders o
    set status = 'paid'
    where o.invoice_id = new.id and o.status = 'fulfilled';
  elsif new.status = 'void' and old.status <> 'void' then
    update public.orders o
    set invoice_id = null
    where o.invoice_id = new.id and o.status in ('sent', 'fulfilled');
  end if;
  return null;
end;
$$;
create trigger invoices_settle_orders after update of status on public.invoices
  for each row execute function private.settle_orders_from_invoice();

-- ---------------------------------------------------------------------------
-- Changing status, with the permission each step needs.
-- ---------------------------------------------------------------------------
create function public.set_order_status(p_order_id uuid, p_status text, p_reason text default null)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  perform private.assert_permission(v_order.tenant_id, case p_status
    when 'sent'      then 'orders.serve'
    when 'fulfilled' then 'orders.serve'
    when 'cancelled' then 'orders.cancel'
    when 'paid'      then 'orders.bill'
    else 'orders.view'
  end);
  if p_status not in ('sent', 'fulfilled', 'cancelled', 'paid') then
    raise exception 'Unknown order status' using errcode = '22023';
  end if;
  if p_status = 'paid' and v_order.status = 'fulfilled' then
    if v_order.invoice_id is not null then
      raise exception 'This order is on an invoice; record the payment there' using errcode = '22023';
    end if;
    if v_order.reservation_id is not null then
      raise exception 'This order is charged to a reservation and is paid with its invoice'
        using errcode = '22023';
    end if;
  end if;
  update public.orders
  set status = p_status,
      cancel_reason = case when p_status = 'cancelled' then p_reason else cancel_reason end
  where id = v_order.id
  returning * into v_order;
  return v_order;
end;
$$;
revoke all on function public.set_order_status(uuid, text, text) from public, anon, authenticated;
grant execute on function public.set_order_status(uuid, text, text) to authenticated, service_role;
comment on function public.set_order_status(uuid, text, text) is
  'Move an order along open -> sent -> fulfilled -> paid (or cancel it), checking the permission for the step.';

-- ---------------------------------------------------------------------------
-- Permissions.
-- ---------------------------------------------------------------------------
select private.register_permission('orders.view', 'orders', 'View orders',
  array['manager', 'front_desk', 'waiter', 'storekeeper', 'sales', 'viewer']);
select private.register_permission('orders.create', 'orders', 'Open orders and edit their lines while open',
  array['manager', 'front_desk', 'waiter', 'sales']);
select private.register_permission('orders.serve', 'orders', 'Send orders (consumes stock) and mark them fulfilled',
  array['manager', 'front_desk', 'waiter', 'sales']);
select private.register_permission('orders.cancel', 'orders', 'Cancel orders (returns consumed stock)',
  array['manager', 'front_desk']);
select private.register_permission('orders.bill', 'orders', 'Bill orders and mark them paid without an invoice',
  array['manager', 'front_desk', 'waiter', 'sales']);

-- ---------------------------------------------------------------------------
-- Audit, privileges and row level security.
-- ---------------------------------------------------------------------------
select private.enable_audit('public.orders');
select private.enable_audit('public.order_lines');

revoke all on public.orders, public.order_lines from anon, authenticated;

grant select on public.orders to authenticated;
grant insert (tenant_id, channel, customer_id, reservation_id, location_id, notes) on public.orders to authenticated;
grant update (channel, customer_id, reservation_id, location_id, notes) on public.orders to authenticated;

grant select, delete on public.order_lines to authenticated;
grant insert (tenant_id, order_id, item_id, position, description, quantity, unit_price_minor, note)
  on public.order_lines to authenticated;
grant update (position, description, quantity, unit_price_minor, note) on public.order_lines to authenticated;

alter table public.orders      enable row level security;
alter table public.order_lines enable row level security;

create policy "orders.view reads orders"
  on public.orders for select to authenticated
  using (tenant_id in (select private.permitted_tenant_ids('orders.view')));
create policy "orders.create opens orders"
  on public.orders for insert to authenticated
  with check (status = 'open' and tenant_id in (select private.permitted_tenant_ids('orders.create')));
create policy "orders.create edits orders"
  on public.orders for update to authenticated
  using (tenant_id in (select private.permitted_tenant_ids('orders.create')))
  with check (tenant_id in (select private.permitted_tenant_ids('orders.create')));

create policy "orders.view reads lines"
  on public.order_lines for select to authenticated
  using (tenant_id in (select private.permitted_tenant_ids('orders.view')));
create policy "orders.create adds lines"
  on public.order_lines for insert to authenticated
  with check (tenant_id in (select private.permitted_tenant_ids('orders.create')));
create policy "orders.create edits lines"
  on public.order_lines for update to authenticated
  using (tenant_id in (select private.permitted_tenant_ids('orders.create')))
  with check (tenant_id in (select private.permitted_tenant_ids('orders.create')));
create policy "orders.create removes lines"
  on public.order_lines for delete to authenticated
  using (tenant_id in (select private.permitted_tenant_ids('orders.create')));

-- Realtime: order lists (e.g. the kitchen's) refresh as orders move.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.orders;
  end if;
end;
$$;
