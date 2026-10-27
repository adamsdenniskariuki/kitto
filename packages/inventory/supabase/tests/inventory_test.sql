-- Inventory: default locations, items, purchases and receiving, the stock
-- ledger and derived levels, no negative stock unless allowed, adjustments
-- with reasons, atomic transfers, low stock, permissions per role, tenant
-- isolation and audit.
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

select tests.create_user('a6000000-0000-0000-0000-000000000001', 'owner-a@inv.test');
select tests.create_user('a6000000-0000-0000-0000-000000000002', 'store-a@inv.test');
select tests.create_user('a6000000-0000-0000-0000-000000000003', 'waiter-a@inv.test');
select tests.create_user('a6000000-0000-0000-0000-000000000004', 'viewer-a@inv.test');
select tests.create_user('b6000000-0000-0000-0000-000000000001', 'owner-b@inv.test');

select tests.login('a6000000-0000-0000-0000-000000000001', 'owner-a@inv.test');
select public.create_tenant('Inv A', 'inv-a');
select tests.login('b6000000-0000-0000-0000-000000000001', 'owner-b@inv.test');
select public.create_tenant('Inv B', 'inv-b');
select set_config('tests.a', (select id::text from public.tenants where slug = 'inv-a'), true);
select set_config('tests.b', (select id::text from public.tenants where slug = 'inv-b'), true);
select tests.add_member(current_setting('tests.a')::uuid, 'a6000000-0000-0000-0000-000000000002', 'store-a@inv.test', 'storekeeper');
select tests.add_member(current_setting('tests.a')::uuid, 'a6000000-0000-0000-0000-000000000003', 'waiter-a@inv.test', 'waiter');
select tests.add_member(current_setting('tests.a')::uuid, 'a6000000-0000-0000-0000-000000000004', 'viewer-a@inv.test', 'viewer');

-- ---------------------------------------------------------------------------
-- Default role grants and the default location.
-- ---------------------------------------------------------------------------
select results_eq(
  $$select r.key, array_agg(rp.permission_key order by rp.permission_key)
    from public.roles r join public.role_permissions rp on rp.role_id = r.id
    where r.tenant_id = current_setting('tests.a')::uuid and rp.permission_key like 'inventory.%'
    group by r.key order by r.key$$,
  $$values ('front_desk', array['inventory.view']),
           ('manager', array['inventory.adjust', 'inventory.manage', 'inventory.purchase', 'inventory.transfer', 'inventory.view']),
           ('sales', array['inventory.view']),
           ('storekeeper', array['inventory.adjust', 'inventory.manage', 'inventory.purchase', 'inventory.transfer', 'inventory.view']),
           ('viewer', array['inventory.view']),
           ('waiter', array['inventory.view'])$$,
  'default roles get sensible inventory permissions'
);
select results_eq(
  $$select name, is_default from public.stock_locations where tenant_id = current_setting('tests.a')::uuid$$,
  $$values ('Main store'::text, true)$$,
  'every new tenant gets a default location'
);
select set_config('tests.main', (select id::text from public.stock_locations
  where tenant_id = current_setting('tests.a')::uuid and is_default), true);
select set_config('tests.main_b', (select id::text from public.stock_locations
  where tenant_id = current_setting('tests.b')::uuid and is_default), true);

-- ---------------------------------------------------------------------------
-- The storekeeper sets up items, a supplier and a second location.
-- ---------------------------------------------------------------------------
select tests.login('a6000000-0000-0000-0000-000000000002', 'store-a@inv.test');
set local role authenticated;

with i as (
  insert into public.items (tenant_id, sku, name, unit, price_minor, reorder_level)
  values (current_setting('tests.a')::uuid, ' TUSK-500 ', ' Tusker 500ml ', 'bottle', 30000, 5)
  returning id
) select set_config('tests.beer', id::text, true) from i;
with i as (
  insert into public.items (tenant_id, name, unit, allow_negative)
  values (current_setting('tests.a')::uuid, 'Cooking oil', 'l', true)
  returning id
) select set_config('tests.oil', id::text, true) from i;
with i as (
  insert into public.items (tenant_id, name, track_stock, price_minor)
  values (current_setting('tests.a')::uuid, 'Room service fee', false, 20000)
  returning id
) select set_config('tests.fee', id::text, true) from i;
with s as (
  insert into public.suppliers (tenant_id, name, phone)
  values (current_setting('tests.a')::uuid, 'Kenya Breweries', '0700 000 000')
  returning id
) select set_config('tests.kbl', id::text, true) from s;
with l as (
  insert into public.stock_locations (tenant_id, name)
  values (current_setting('tests.a')::uuid, 'Bar')
  returning id
) select set_config('tests.bar', id::text, true) from l;

select is((select sku || '|' || name from public.items where id = current_setting('tests.beer')::uuid),
  'TUSK-500|Tusker 500ml', 'item text is trimmed');
select throws_ok(
  $$insert into public.items (tenant_id, sku, name) values (current_setting('tests.a')::uuid, 'tusk-500', 'Dup')$$,
  '23505', null, 'SKUs are unique per tenant, ignoring case'
);
select throws_ok(
  $$insert into public.stock_locations (tenant_id, name) values (current_setting('tests.a')::uuid, ' bar ')$$,
  '23505', null, 'location names are unique per tenant'
);
select throws_ok(
  $$update public.stock_locations set active = false where id = current_setting('tests.main')::uuid$$,
  '22023', 'The default location cannot be deactivated', 'the default location stays active'
);
select throws_ok(
  $$delete from public.stock_locations where id = current_setting('tests.main')::uuid$$,
  '22023', 'The default location cannot be deleted', 'the default location cannot be deleted'
);
select throws_ok(
  $$insert into public.stock_movements (tenant_id, item_id, location_id, kind, quantity)
    values (current_setting('tests.a')::uuid, current_setting('tests.beer')::uuid, current_setting('tests.main')::uuid, 'purchase', 100)$$,
  '42501', null, 'clients cannot write the ledger directly'
);
select throws_ok(
  $$insert into public.stock_levels (tenant_id, item_id, location_id, quantity)
    values (current_setting('tests.a')::uuid, current_setting('tests.beer')::uuid, current_setting('tests.main')::uuid, 100)$$,
  '42501', null, 'clients cannot write stock levels'
);

-- ---------------------------------------------------------------------------
-- A purchase: draft lines, total, receive into stock, then frozen.
-- ---------------------------------------------------------------------------
with p as (
  insert into public.purchases (tenant_id, supplier_id, location_id, reference)
  values (current_setting('tests.a')::uuid, current_setting('tests.kbl')::uuid, current_setting('tests.main')::uuid, 'DN-1')
  returning id
) select set_config('tests.po', id::text, true) from p;
insert into public.purchase_lines (tenant_id, purchase_id, item_id, quantity, unit_cost_minor, position)
values (current_setting('tests.a')::uuid, current_setting('tests.po')::uuid, current_setting('tests.beer')::uuid, 24, 18000, 0),
       (current_setting('tests.a')::uuid, current_setting('tests.po')::uuid, current_setting('tests.oil')::uuid, 2.5, 30000, 1);
select is((select total_minor from public.purchases where id = current_setting('tests.po')::uuid),
  (24 * 18000 + 75000)::bigint, 'the purchase total follows its lines');
select throws_ok(
  $$insert into public.purchase_lines (tenant_id, purchase_id, item_id, quantity)
    values (current_setting('tests.a')::uuid, current_setting('tests.po')::uuid, current_setting('tests.fee')::uuid, 1)$$,
  '22023', 'Only items that track stock can be purchased', 'services cannot be purchased into stock'
);
select is(
  (select count(*)::int from public.stock_movements where tenant_id = current_setting('tests.a')::uuid),
  0, 'a draft purchase moves no stock'
);

select is((public.receive_purchase(current_setting('tests.po')::uuid)).status, 'received', 'receiving a purchase');
select results_eq(
  $$select kind, quantity, source_type from public.stock_movements
    where source_id = current_setting('tests.po')::uuid order by quantity$$,
  $$values ('purchase'::text, 2.500::numeric, 'purchase'::text), ('purchase', 24.000, 'purchase')$$,
  'receiving books one purchase movement per line'
);
select is(
  (select quantity from public.stock_levels
   where item_id = current_setting('tests.beer')::uuid and location_id = current_setting('tests.main')::uuid),
  24.000::numeric, 'the stock level is derived from the movements'
);
select is((select cost_minor from public.items where id = current_setting('tests.beer')::uuid), 18000::bigint,
  'receiving updates the item cost');
select throws_ok($$select public.receive_purchase(current_setting('tests.po')::uuid)$$,
  '22023', 'This purchase has already been received', 'a purchase is received once');
select throws_ok(
  $$update public.purchase_lines set quantity = 48 where purchase_id = current_setting('tests.po')::uuid$$,
  '22023', 'Received purchases cannot be changed', 'received purchase lines are frozen'
);
select is_empty(
  $$delete from public.purchases where id = current_setting('tests.po')::uuid returning id$$,
  'received purchases cannot be deleted'
);

-- ---------------------------------------------------------------------------
-- Adjustments: a reason is required; no negative stock unless allowed.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$select public.adjust_stock(current_setting('tests.a')::uuid, current_setting('tests.beer')::uuid,
      current_setting('tests.main')::uuid, -1, '  ')$$,
  '22023', 'A reason is required for stock adjustments', 'adjustments need a reason'
);
select throws_ok(
  $$select public.adjust_stock(current_setting('tests.a')::uuid, current_setting('tests.beer')::uuid,
      current_setting('tests.main')::uuid, -25, 'Breakage')$$,
  '22023', 'Not enough Tusker 500ml in stock at Main store', 'stock cannot go below zero'
);
select is(
  (select quantity from public.stock_levels
   where item_id = current_setting('tests.beer')::uuid and location_id = current_setting('tests.main')::uuid),
  24.000::numeric, 'a refused movement leaves the level unchanged'
);
select is((public.adjust_stock(current_setting('tests.a')::uuid, current_setting('tests.beer')::uuid,
      current_setting('tests.main')::uuid, -2, 'Breakage')).reason, 'Breakage', 'a reasoned adjustment');
select is((public.adjust_stock(current_setting('tests.a')::uuid, current_setting('tests.oil')::uuid,
      current_setting('tests.main')::uuid, -4, 'Used in kitchen')).quantity, -4.000::numeric,
  'items that allow it can go negative');
select is(
  (select quantity from public.stock_levels
   where item_id = current_setting('tests.oil')::uuid and location_id = current_setting('tests.main')::uuid),
  -1.500::numeric, 'negative stock is tracked'
);
select throws_ok(
  $$select public.adjust_stock(current_setting('tests.a')::uuid, current_setting('tests.fee')::uuid,
      current_setting('tests.main')::uuid, 1, 'Count')$$,
  '22023', 'Room service fee does not track stock', 'untracked items have no stock'
);

-- ---------------------------------------------------------------------------
-- Transfers: both halves or neither.
-- ---------------------------------------------------------------------------
select isnt(public.transfer_stock(current_setting('tests.a')::uuid, current_setting('tests.beer')::uuid,
  current_setting('tests.main')::uuid, current_setting('tests.bar')::uuid, 10, 'Restock bar'), null, 'a transfer');
select results_eq(
  $$select l.name, s.quantity from public.stock_levels s join public.stock_locations l on l.id = s.location_id
    where s.item_id = current_setting('tests.beer')::uuid order by l.name$$,
  $$values ('Bar'::text, 10.000::numeric), ('Main store', 12.000)$$,
  'a transfer moves stock between locations'
);
select is(
  (select count(distinct transfer_id)::int || '/' || count(*)::int || '/' || sum(quantity)::int
   from public.stock_movements where kind = 'transfer' and tenant_id = current_setting('tests.a')::uuid),
  '1/2/0', 'a transfer is a pair of movements that cancel out'
);
select throws_ok(
  $$select public.transfer_stock(current_setting('tests.a')::uuid, current_setting('tests.beer')::uuid,
      current_setting('tests.main')::uuid, current_setting('tests.bar')::uuid, 13, '')$$,
  '22023', 'Not enough Tusker 500ml in stock at Main store', 'cannot transfer more than is there'
);
select is(
  (select count(*)::int from public.stock_movements where kind = 'transfer' and tenant_id = current_setting('tests.a')::uuid),
  2, 'a refused transfer records neither half'
);
select is(
  (select quantity from public.stock_levels
   where item_id = current_setting('tests.beer')::uuid and location_id = current_setting('tests.bar')::uuid),
  10.000::numeric, 'a refused transfer leaves the destination unchanged'
);
select throws_ok(
  $$select public.transfer_stock(current_setting('tests.a')::uuid, current_setting('tests.beer')::uuid,
      current_setting('tests.main')::uuid, current_setting('tests.main')::uuid, 1, '')$$,
  '22023', 'Choose two different locations', 'a transfer needs two locations'
);

-- ---------------------------------------------------------------------------
-- Low stock: at or below the reorder level across all locations.
-- ---------------------------------------------------------------------------
select results_eq(
  $$select name, on_hand, low from public.item_stock where tenant_id = current_setting('tests.a')::uuid order by name$$,
  $$values ('Cooking oil'::text, -1.500::numeric, true), ('Room service fee', 0.000, false),
           ('Tusker 500ml', 22.000, false)$$,
  'item_stock sums all locations'
);
select lives_ok($$select public.adjust_stock(current_setting('tests.a')::uuid, current_setting('tests.beer')::uuid,
      current_setting('tests.main')::uuid, -12, 'Stock count')$$, 'count down to the bar stock');
select lives_ok($$select public.transfer_stock(current_setting('tests.a')::uuid, current_setting('tests.beer')::uuid,
      current_setting('tests.bar')::uuid, current_setting('tests.main')::uuid, 5, '')$$, 'move some back');
select results_eq(
  $$select name, on_hand from public.item_stock where tenant_id = current_setting('tests.a')::uuid and low order by name$$,
  $$values ('Cooking oil'::text, -1.500::numeric)$$,
  'above the reorder level is not low'
);
select lives_ok($$select public.adjust_stock(current_setting('tests.a')::uuid, current_setting('tests.beer')::uuid,
      current_setting('tests.bar')::uuid, -5, 'Sold off the books')$$, 'down to the reorder level');
select results_eq(
  $$select name, on_hand from public.item_stock where tenant_id = current_setting('tests.a')::uuid and low order by name$$,
  $$values ('Cooking oil'::text, -1.500::numeric), ('Tusker 500ml', 5.000)$$,
  'at the reorder level is low'
);

-- ---------------------------------------------------------------------------
-- The ledger is append-only; tracked items keep tracking.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$update public.stock_movements set quantity = 1000 where tenant_id = current_setting('tests.a')::uuid$$,
  '42501', null, 'clients cannot edit movements'
);
select throws_ok(
  $$update public.items set track_stock = false where id = current_setting('tests.beer')::uuid$$,
  '22023', 'An item with stock history must keep tracking stock', 'an item with history keeps tracking'
);
select throws_ok(
  $$delete from public.items where id = current_setting('tests.beer')::uuid$$,
  '23503', null, 'an item with history cannot be deleted'
);
reset role;
select throws_ok(
  $$update public.stock_movements set quantity = 1000 where tenant_id = current_setting('tests.a')::uuid$$,
  '22023', null, 'not even the owner of the table can edit movements'
);
select throws_ok(
  $$delete from public.stock_movements where tenant_id = current_setting('tests.a')::uuid$$,
  '22023', null, 'or delete them'
);
select is(
  (select sum(m.quantity) from public.stock_movements m where m.item_id = current_setting('tests.beer')::uuid),
  (select sum(s.quantity) from public.stock_levels s where s.item_id = current_setting('tests.beer')::uuid),
  'levels always equal the sum of the ledger'
);

-- ---------------------------------------------------------------------------
-- Roles: the waiter and viewer look but don't touch.
-- ---------------------------------------------------------------------------
select tests.login('a6000000-0000-0000-0000-000000000003', 'waiter-a@inv.test');
set local role authenticated;
select is((select count(*)::int from public.items where tenant_id = current_setting('tests.a')::uuid), 3,
  'the waiter sees items');
select is((select count(*)::int from public.item_stock where tenant_id = current_setting('tests.a')::uuid), 3,
  'and stock');
select throws_ok(
  $$insert into public.items (tenant_id, name) values (current_setting('tests.a')::uuid, 'Free beer')$$,
  '42501', null, 'the waiter cannot add items'
);
select throws_ok(
  $$select public.adjust_stock(current_setting('tests.a')::uuid, current_setting('tests.beer')::uuid,
      current_setting('tests.main')::uuid, 100, 'Found some')$$,
  '42501', null, 'the waiter cannot adjust stock'
);
select throws_ok(
  $$select public.transfer_stock(current_setting('tests.a')::uuid, current_setting('tests.beer')::uuid,
      current_setting('tests.main')::uuid, current_setting('tests.bar')::uuid, 1, '')$$,
  '42501', null, 'the waiter cannot transfer stock'
);
select throws_ok(
  $$insert into public.purchases (tenant_id, supplier_id, location_id)
    values (current_setting('tests.a')::uuid, current_setting('tests.kbl')::uuid, current_setting('tests.main')::uuid)$$,
  '42501', null, 'the waiter cannot record purchases'
);
reset role;

select tests.login('a6000000-0000-0000-0000-000000000004', 'viewer-a@inv.test');
set local role authenticated;
select is((select count(*)::int from public.stock_movements where tenant_id = current_setting('tests.a')::uuid), 10,
  'the viewer sees the ledger');
select is_empty(
  $$update public.items set price_minor = 1 where tenant_id = current_setting('tests.a')::uuid returning id$$,
  'the viewer cannot edit items'
);
reset role;

-- ---------------------------------------------------------------------------
-- Tenant isolation.
-- ---------------------------------------------------------------------------
select tests.login('b6000000-0000-0000-0000-000000000001', 'owner-b@inv.test');
set local role authenticated;
select is_empty($$select 1 from public.items where tenant_id = current_setting('tests.a')::uuid$$,
  'tenant B sees none of tenant A''s items');
select is_empty($$select 1 from public.item_stock where tenant_id = current_setting('tests.a')::uuid$$,
  'or their stock');
select is_empty($$select 1 from public.stock_levels where tenant_id = current_setting('tests.a')::uuid$$,
  'or their levels');
select is_empty($$select 1 from public.stock_movements where tenant_id = current_setting('tests.a')::uuid$$,
  'or their ledger');
select is_empty($$select 1 from public.purchases where tenant_id = current_setting('tests.a')::uuid$$,
  'or their purchases');
select is_empty($$select 1 from public.suppliers where tenant_id = current_setting('tests.a')::uuid$$,
  'or their suppliers');
select is_empty($$select 1 from public.stock_locations where tenant_id = current_setting('tests.a')::uuid$$,
  'or their locations');
select throws_ok(
  $$select public.adjust_stock(current_setting('tests.a')::uuid, current_setting('tests.beer')::uuid,
      current_setting('tests.main')::uuid, 100, 'Mine now')$$,
  '42501', null, 'tenant B cannot adjust tenant A''s stock'
);
select throws_ok(
  $$select public.adjust_stock(current_setting('tests.b')::uuid, current_setting('tests.beer')::uuid,
      current_setting('tests.main_b')::uuid, 100, 'Mine now')$$,
  'P0002', null, 'tenant A''s item cannot be reached through tenant B''s id'
);
select throws_ok(
  $$select public.transfer_stock(current_setting('tests.b')::uuid, current_setting('tests.beer')::uuid,
      current_setting('tests.main')::uuid, current_setting('tests.main_b')::uuid, 1, '')$$,
  'P0002', null, 'tenant B cannot pull stock out of tenant A''s locations'
);
select throws_ok(
  $$select public.receive_purchase(current_setting('tests.po')::uuid)$$,
  '42501', null, 'tenant B cannot receive tenant A''s purchases'
);
select throws_ok(
  $$insert into public.items (tenant_id, name) values (current_setting('tests.a')::uuid, 'Planted')$$,
  '42501', null, 'tenant B cannot add items to tenant A'
);
select is_empty(
  $$update public.items set price_minor = 1 where tenant_id = current_setting('tests.a')::uuid returning id$$,
  'tenant B cannot edit tenant A''s items'
);
reset role;

-- Anonymous users get nothing.
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok($$select 1 from public.items$$, '42501', null, 'anon cannot read items');
select throws_ok($$select 1 from public.item_stock$$, '42501', null, 'anon cannot read stock');
select throws_ok(
  $$select public.adjust_stock(current_setting('tests.a')::uuid, current_setting('tests.beer')::uuid,
      current_setting('tests.main')::uuid, 1, 'x')$$,
  '42501', null, 'anon cannot adjust stock'
);
reset role;

-- Audit trail.
select ok(
  exists (select 1 from public.audit_log where table_name = 'stock_movements'
          and tenant_id = current_setting('tests.a')::uuid and new_data ->> 'reason' = 'Breakage'),
  'stock movements are audited'
);
select ok(
  exists (select 1 from public.audit_log where table_name = 'purchases' and record_id = current_setting('tests.po')
          and 'status' = any (changed) and new_data ->> 'status' = 'received'),
  'receiving is audited'
);

select * from finish();
rollback;
