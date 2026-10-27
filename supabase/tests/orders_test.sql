-- Orders: numbering, lines while open, the status machine, stock consumed on
-- send and returned on cancel, no negative stock, billing (own invoice or
-- the reservation's) and paid status, manual payment, permissions per role,
-- tenant isolation and audit.
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
create or replace function tests.level(p_item uuid) returns numeric
language sql as $$
  select coalesce(sum(quantity), 0) from public.stock_levels where item_id = p_item;
$$;
grant usage on schema tests to anon, authenticated;
grant execute on all functions in schema tests to anon, authenticated;

select tests.create_user('a7000000-0000-0000-0000-000000000001', 'owner-a@ord.test');
select tests.create_user('a7000000-0000-0000-0000-000000000002', 'waiter-a@ord.test');
select tests.create_user('a7000000-0000-0000-0000-000000000003', 'desk-a@ord.test');
select tests.create_user('a7000000-0000-0000-0000-000000000004', 'viewer-a@ord.test');
select tests.create_user('b7000000-0000-0000-0000-000000000001', 'owner-b@ord.test');

select tests.login('a7000000-0000-0000-0000-000000000001', 'owner-a@ord.test');
select public.create_tenant('Ord A', 'ord-a');
select tests.login('b7000000-0000-0000-0000-000000000001', 'owner-b@ord.test');
select public.create_tenant('Ord B', 'ord-b');
select set_config('tests.a', (select id::text from public.tenants where slug = 'ord-a'), true);
select set_config('tests.b', (select id::text from public.tenants where slug = 'ord-b'), true);
select tests.add_member(current_setting('tests.a')::uuid, 'a7000000-0000-0000-0000-000000000002', 'waiter-a@ord.test', 'waiter');
select tests.add_member(current_setting('tests.a')::uuid, 'a7000000-0000-0000-0000-000000000003', 'desk-a@ord.test', 'front_desk');
select tests.add_member(current_setting('tests.a')::uuid, 'a7000000-0000-0000-0000-000000000004', 'viewer-a@ord.test', 'viewer');

-- Fixtures (as the table owner): items with stock, a customer, reservations.
insert into public.items (tenant_id, name, price_minor)
values (current_setting('tests.a')::uuid, 'Tusker', 30000);
insert into public.items (tenant_id, name, price_minor, track_stock)
values (current_setting('tests.a')::uuid, 'Service charge', 20000, false);
insert into public.items (tenant_id, name, price_minor, active)
values (current_setting('tests.a')::uuid, 'Old stock', 100, false);
insert into public.items (tenant_id, name, price_minor)
values (current_setting('tests.b')::uuid, 'B beer', 1);
select set_config('tests.beer', (select id::text from public.items where name = 'Tusker'), true);
select set_config('tests.fee', (select id::text from public.items where name = 'Service charge'), true);
select set_config('tests.old', (select id::text from public.items where name = 'Old stock'), true);
select set_config('tests.beer_b', (select id::text from public.items where name = 'B beer'), true);
insert into public.stock_movements (tenant_id, item_id, location_id, kind, quantity, reason)
select current_setting('tests.a')::uuid, current_setting('tests.beer')::uuid, l.id, 'adjustment', 10, 'Opening'
from public.stock_locations l where l.tenant_id = current_setting('tests.a')::uuid and l.is_default;
insert into public.customers (tenant_id, name) values (current_setting('tests.a')::uuid, 'Guest');
select set_config('tests.guest', (select id::text from public.customers where tenant_id = current_setting('tests.a')::uuid), true);
insert into public.resources (tenant_id, kind, name) values (current_setting('tests.a')::uuid, 'room', 'Room 7');
insert into public.reservations (tenant_id, resource_id, customer_id, during, status)
select current_setting('tests.a')::uuid, r.id, current_setting('tests.guest')::uuid,
       tstzrange('2030-03-01 14:00+03', '2030-03-03 10:00+03'), 'confirmed'
from public.resources r where r.tenant_id = current_setting('tests.a')::uuid;
insert into public.reservations (tenant_id, resource_id, during, status)
select current_setting('tests.a')::uuid, r.id, tstzrange('2030-04-01 14:00+03', '2030-04-02 10:00+03'), 'tentative'
from public.resources r where r.tenant_id = current_setting('tests.a')::uuid;
select set_config('tests.res', (select id::text from public.reservations
  where tenant_id = current_setting('tests.a')::uuid and status = 'confirmed'), true);
select set_config('tests.res2', (select id::text from public.reservations
  where tenant_id = current_setting('tests.a')::uuid and status = 'tentative'), true);
update public.reservations set status = 'cancelled' where id = current_setting('tests.res2')::uuid;

-- ---------------------------------------------------------------------------
-- Default role grants.
-- ---------------------------------------------------------------------------
select results_eq(
  $$select r.key, array_agg(rp.permission_key order by rp.permission_key)
    from public.roles r join public.role_permissions rp on rp.role_id = r.id
    where r.tenant_id = current_setting('tests.a')::uuid and rp.permission_key like 'orders.%'
    group by r.key order by r.key$$,
  $$values ('front_desk', array['orders.bill', 'orders.cancel', 'orders.create', 'orders.serve', 'orders.view']),
           ('manager', array['orders.bill', 'orders.cancel', 'orders.create', 'orders.serve', 'orders.view']),
           ('sales', array['orders.bill', 'orders.create', 'orders.serve', 'orders.view']),
           ('storekeeper', array['orders.view']),
           ('viewer', array['orders.view']),
           ('waiter', array['orders.bill', 'orders.create', 'orders.serve', 'orders.view'])$$,
  'default roles get sensible order permissions'
);

-- ---------------------------------------------------------------------------
-- The waiter opens an order and adds lines.
-- ---------------------------------------------------------------------------
select tests.login('a7000000-0000-0000-0000-000000000002', 'waiter-a@ord.test');
set local role authenticated;

with o as (
  insert into public.orders (tenant_id, channel) values (current_setting('tests.a')::uuid, ' Table 4 ')
  returning id
) select set_config('tests.o1', id::text, true) from o;
select results_eq(
  $$select o.number, o.status, o.channel, l.is_default from public.orders o
    join public.stock_locations l on l.id = o.location_id where o.id = current_setting('tests.o1')::uuid$$,
  $$values (1, 'open'::text, 'Table 4'::text, true)$$,
  'a new order is numbered, open and takes stock from the default location'
);
insert into public.order_lines (tenant_id, order_id, item_id, quantity, position)
values (current_setting('tests.a')::uuid, current_setting('tests.o1')::uuid, current_setting('tests.beer')::uuid, 2, 0);
insert into public.order_lines (tenant_id, order_id, description, unit_price_minor, note, position)
values (current_setting('tests.a')::uuid, current_setting('tests.o1')::uuid, ' Corkage ', 50000, ' Own wine ', 1);
insert into public.order_lines (tenant_id, order_id, item_id, quantity, position)
values (current_setting('tests.a')::uuid, current_setting('tests.o1')::uuid, current_setting('tests.fee')::uuid, 1, 2);
select results_eq(
  $$select description, quantity, unit_price_minor, note, line_total_minor from public.order_lines
    where order_id = current_setting('tests.o1')::uuid order by position$$,
  $$values ('Tusker'::text, 2.000::numeric, 30000::bigint, ''::text, 60000::bigint),
           ('Corkage', 1.000, 50000, 'Own wine', 50000),
           ('Service charge', 1.000, 20000, '', 20000)$$,
  'item lines take the item''s name and price; free-text lines are allowed'
);
select is((select total_minor from public.orders where id = current_setting('tests.o1')::uuid), 130000::bigint,
  'the order total follows its lines');
select throws_ok(
  $$insert into public.order_lines (tenant_id, order_id, item_id, quantity)
    values (current_setting('tests.a')::uuid, current_setting('tests.o1')::uuid, current_setting('tests.old')::uuid, 1)$$,
  '22023', 'That item is no longer sold', 'inactive items cannot be ordered'
);
select throws_ok(
  $$update public.orders set status = 'sent' where id = current_setting('tests.o1')::uuid$$,
  '42501', null, 'status only changes through set_order_status'
);

with o as (
  insert into public.orders (tenant_id, channel) values (current_setting('tests.a')::uuid, 'Counter')
  returning id
) select set_config('tests.o2', id::text, true) from o;
select is((select number from public.orders where id = current_setting('tests.o2')::uuid), 2, 'numbers count up');
select throws_ok($$select public.set_order_status(current_setting('tests.o2')::uuid, 'sent')$$,
  '22023', 'An order needs at least one line', 'an empty order cannot be sent');
select throws_ok($$select public.set_order_status(current_setting('tests.o2')::uuid, 'fulfilled')$$,
  '22023', 'An order that is open cannot become fulfilled', 'steps cannot be skipped');

-- ---------------------------------------------------------------------------
-- Sending consumes stock; lines are then frozen.
-- ---------------------------------------------------------------------------
select is((public.set_order_status(current_setting('tests.o1')::uuid, 'sent')).status, 'sent', 'the waiter sends it');
select is(tests.level(current_setting('tests.beer')::uuid), 8.000::numeric, 'sending consumes tracked stock');
select results_eq(
  $$select kind, quantity, reason from public.stock_movements where source_type = 'order'
    and source_id = current_setting('tests.o1')::uuid$$,
  $$values ('sale'::text, -2.000::numeric, 'Order #1'::text)$$,
  'one sale movement per tracked item, nothing for services or free text'
);
select throws_ok(
  $$insert into public.order_lines (tenant_id, order_id, description, unit_price_minor)
    values (current_setting('tests.a')::uuid, current_setting('tests.o1')::uuid, 'More', 1)$$,
  '22023', 'Only open orders can be changed', 'no lines are added after sending'
);
select throws_ok(
  $$update public.order_lines set quantity = 1 where order_id = current_setting('tests.o1')::uuid$$,
  '22023', 'Only open orders can be changed', 'no lines are changed after sending'
);
select throws_ok(
  $$delete from public.order_lines where order_id = current_setting('tests.o1')::uuid$$,
  '22023', 'Only open orders can be changed', 'no lines are removed after sending'
);
-- Not enough stock: the order stays open and nothing moves.
with o as (
  insert into public.orders (tenant_id, channel) values (current_setting('tests.a')::uuid, 'Table 9')
  returning id
) select set_config('tests.o3', id::text, true) from o;
insert into public.order_lines (tenant_id, order_id, item_id, quantity)
values (current_setting('tests.a')::uuid, current_setting('tests.o3')::uuid, current_setting('tests.beer')::uuid, 9);
select throws_ok($$select public.set_order_status(current_setting('tests.o3')::uuid, 'sent')$$,
  '22023', 'Not enough Tusker in stock at Main store', 'an order cannot take more than is in stock');
select is((select status from public.orders where id = current_setting('tests.o3')::uuid), 'open',
  'the refused order stays open');
select is(tests.level(current_setting('tests.beer')::uuid), 8.000::numeric, 'and no stock moved');
select throws_ok($$select public.set_order_status(current_setting('tests.o3')::uuid, 'cancelled')$$,
  '42501', null, 'the waiter cannot cancel');
reset role;

-- ---------------------------------------------------------------------------
-- Cancelling: an open order moves nothing; a sent one returns its stock.
-- ---------------------------------------------------------------------------
select tests.login('a7000000-0000-0000-0000-000000000003', 'desk-a@ord.test');
set local role authenticated;
select is((public.set_order_status(current_setting('tests.o3')::uuid, 'cancelled', 'Changed mind')).cancel_reason,
  'Changed mind', 'front desk cancels an open order');
select is(
  (select count(*)::int from public.stock_movements where source_id = current_setting('tests.o3')::uuid),
  0, 'cancelling an open order moves no stock'
);
with o as (
  insert into public.orders (tenant_id, channel) values (current_setting('tests.a')::uuid, 'Table 2')
  returning id
) select set_config('tests.o4', id::text, true) from o;
insert into public.order_lines (tenant_id, order_id, item_id, quantity)
values (current_setting('tests.a')::uuid, current_setting('tests.o4')::uuid, current_setting('tests.beer')::uuid, 1),
       (current_setting('tests.a')::uuid, current_setting('tests.o4')::uuid, current_setting('tests.beer')::uuid, 2);
select lives_ok($$select public.set_order_status(current_setting('tests.o4')::uuid, 'sent')$$, 'send order 4');
select is(tests.level(current_setting('tests.beer')::uuid), 5.000::numeric, 'two lines of one item consume together');
select lives_ok($$select public.set_order_status(current_setting('tests.o4')::uuid, 'cancelled', 'Walked out')$$,
  'cancel a sent order');
select is(tests.level(current_setting('tests.beer')::uuid), 8.000::numeric, 'cancelling returns the stock');
select results_eq(
  $$select kind, quantity from public.stock_movements where source_id = current_setting('tests.o4')::uuid
    order by created_at, kind desc$$,
  $$values ('sale'::text, -3.000::numeric), ('return', 3.000)$$,
  'the return mirrors the sale'
);
select throws_ok($$select public.set_order_status(current_setting('tests.o4')::uuid, 'sent')$$,
  '22023', 'This order is cancelled and can no longer be changed', 'cancelled is final');
select throws_ok(
  $$update public.orders set notes = 'x' where id = current_setting('tests.o4')::uuid$$,
  '22023', 'This order is cancelled and can no longer be changed', 'a cancelled order is frozen'
);

-- ---------------------------------------------------------------------------
-- Fulfil, then pay by hand (cash, no invoice).
-- ---------------------------------------------------------------------------
select lives_ok($$select public.set_order_status(current_setting('tests.o1')::uuid, 'fulfilled')$$, 'fulfil order 1');
select throws_ok($$select public.set_order_status(current_setting('tests.o1')::uuid, 'cancelled')$$,
  '22023', 'An order that is fulfilled cannot become cancelled', 'fulfilled orders cannot be cancelled');
select is((public.set_order_status(current_setting('tests.o1')::uuid, 'paid')).status, 'paid', 'marked paid by hand');
select isnt((select paid_at from public.orders where id = current_setting('tests.o1')::uuid), null, 'paid_at is set');
reset role;

-- ---------------------------------------------------------------------------
-- Billed on its own invoice: paid when the invoice is.
-- ---------------------------------------------------------------------------
select tests.login('a7000000-0000-0000-0000-000000000003', 'desk-a@ord.test');
set local role authenticated;
with o as (
  insert into public.orders (tenant_id, channel, customer_id)
  values (current_setting('tests.a')::uuid, 'Counter', current_setting('tests.guest')::uuid)
  returning id
) select set_config('tests.o5', id::text, true) from o;
insert into public.order_lines (tenant_id, order_id, item_id, quantity)
values (current_setting('tests.a')::uuid, current_setting('tests.o5')::uuid, current_setting('tests.beer')::uuid, 1);
select lives_ok($$select public.set_order_status(current_setting('tests.o5')::uuid, 'sent')$$, 'send order 5');
select lives_ok($$select public.set_order_status(current_setting('tests.o5')::uuid, 'fulfilled')$$, 'fulfil order 5');
select set_config('tests.inv5', public.draft_invoice_for_source(current_setting('tests.a')::uuid, 'order',
  current_setting('tests.o5')::uuid, current_setting('tests.guest')::uuid,
  '[{"description": "Tusker", "quantity": 1, "unit_price_minor": 30000}]'::jsonb)::text, true);
select is((select invoice_id from public.orders where id = current_setting('tests.o5')::uuid),
  current_setting('tests.inv5')::uuid, 'the invoice is linked to the order');
select throws_ok($$select public.set_order_status(current_setting('tests.o5')::uuid, 'paid')$$,
  '22023', 'This order is on an invoice; record the payment there', 'an invoiced order is paid through its invoice');
select lives_ok($$select public.issue_invoice(current_setting('tests.inv5')::uuid)$$, 'issue it');
insert into public.payments (tenant_id, invoice_id, amount_minor, method)
values (current_setting('tests.a')::uuid, current_setting('tests.inv5')::uuid, 10000, 'cash');
select is((select status from public.orders where id = current_setting('tests.o5')::uuid), 'fulfilled',
  'a part payment does not pay the order');
insert into public.payments (tenant_id, invoice_id, amount_minor, method)
values (current_setting('tests.a')::uuid, current_setting('tests.inv5')::uuid, 20000, 'mpesa');
select is((select status from public.orders where id = current_setting('tests.o5')::uuid), 'paid',
  'paying the invoice pays the order');

-- Voiding an invoice releases its orders.
with o as (
  insert into public.orders (tenant_id, channel) values (current_setting('tests.a')::uuid, 'Counter')
  returning id
) select set_config('tests.o7', id::text, true) from o;
insert into public.order_lines (tenant_id, order_id, description, unit_price_minor)
values (current_setting('tests.a')::uuid, current_setting('tests.o7')::uuid, 'Labour', 150000);
select lives_ok($$select public.set_order_status(current_setting('tests.o7')::uuid, 'sent')$$, 'send order 7');
select set_config('tests.inv7', public.draft_invoice_for_source(current_setting('tests.a')::uuid, 'order',
  current_setting('tests.o7')::uuid, null,
  '[{"description": "Labour", "quantity": 1, "unit_price_minor": 150000}]'::jsonb)::text, true);
select lives_ok($$select public.issue_invoice(current_setting('tests.inv7')::uuid)$$, 'issue invoice 7');
reset role;
select tests.login('a7000000-0000-0000-0000-000000000001', 'owner-a@ord.test');
set local role authenticated;
select lives_ok($$select public.void_invoice(current_setting('tests.inv7')::uuid, 'Wrong price')$$, 'void it');
select is((select invoice_id from public.orders where id = current_setting('tests.o7')::uuid), null,
  'voiding the invoice releases the order to be billed again');
reset role;

-- ---------------------------------------------------------------------------
-- Charged to a reservation: billed and paid with the reservation's invoice.
-- ---------------------------------------------------------------------------
select tests.login('a7000000-0000-0000-0000-000000000002', 'waiter-a@ord.test');
set local role authenticated;
with o as (
  insert into public.orders (tenant_id, channel, reservation_id)
  values (current_setting('tests.a')::uuid, 'Room service', current_setting('tests.res')::uuid)
  returning id
) select set_config('tests.o6', id::text, true) from o;
select is((select customer_id from public.orders where id = current_setting('tests.o6')::uuid),
  current_setting('tests.guest')::uuid, 'an order charged to a reservation takes its guest');
select throws_ok(
  $$insert into public.orders (tenant_id, reservation_id) values (current_setting('tests.a')::uuid, current_setting('tests.res2')::uuid)$$,
  '22023', 'Orders cannot be charged to a cancelled reservation', 'not to a cancelled reservation'
);
insert into public.order_lines (tenant_id, order_id, item_id, quantity)
values (current_setting('tests.a')::uuid, current_setting('tests.o6')::uuid, current_setting('tests.beer')::uuid, 2);
select lives_ok($$select public.set_order_status(current_setting('tests.o6')::uuid, 'sent')$$, 'send order 6');
reset role;
select tests.login('a7000000-0000-0000-0000-000000000003', 'desk-a@ord.test');
set local role authenticated;
select set_config('tests.inv6', public.draft_invoice_for_source(current_setting('tests.a')::uuid, 'reservation',
  current_setting('tests.res')::uuid, current_setting('tests.guest')::uuid,
  '[{"description": "Room 7", "quantity": 2, "unit_price_minor": 500000},
    {"description": "Order #7", "quantity": 1, "unit_price_minor": 60000}]'::jsonb)::text, true);
select is((select invoice_id from public.orders where id = current_setting('tests.o6')::uuid),
  current_setting('tests.inv6')::uuid, 'the reservation''s invoice bills the orders charged to it');
select lives_ok($$select public.issue_invoice(current_setting('tests.inv6')::uuid)$$, 'issue the stay invoice');
insert into public.payments (tenant_id, invoice_id, amount_minor, method)
values (current_setting('tests.a')::uuid, current_setting('tests.inv6')::uuid, 1060000, 'card');
select is((select status from public.orders where id = current_setting('tests.o6')::uuid), 'sent',
  'a sent order on a paid invoice waits to be fulfilled');
select is((public.set_order_status(current_setting('tests.o6')::uuid, 'fulfilled')).status, 'paid',
  'and is paid as soon as it is fulfilled');

-- A charged order with no invoice yet cannot be paid by hand.
with o as (
  insert into public.orders (tenant_id, reservation_id)
  values (current_setting('tests.a')::uuid, current_setting('tests.res')::uuid)
  returning id
) select set_config('tests.o8', id::text, true) from o;
insert into public.order_lines (tenant_id, order_id, description, unit_price_minor)
values (current_setting('tests.a')::uuid, current_setting('tests.o8')::uuid, 'Laundry', 80000);
select lives_ok($$select public.set_order_status(current_setting('tests.o8')::uuid, 'sent')$$, 'send order 8');
select lives_ok($$select public.set_order_status(current_setting('tests.o8')::uuid, 'fulfilled')$$, 'fulfil order 8');
select throws_ok($$select public.set_order_status(current_setting('tests.o8')::uuid, 'paid')$$,
  '22023', 'This order is charged to a reservation and is paid with its invoice', 'charged orders are paid with the stay');
reset role;

-- ---------------------------------------------------------------------------
-- The viewer looks only.
-- ---------------------------------------------------------------------------
select tests.login('a7000000-0000-0000-0000-000000000004', 'viewer-a@ord.test');
set local role authenticated;
select is((select count(*)::int from public.orders where tenant_id = current_setting('tests.a')::uuid), 8,
  'the viewer sees orders');
select throws_ok($$insert into public.orders (tenant_id) values (current_setting('tests.a')::uuid)$$,
  '42501', null, 'the viewer cannot open orders');
select throws_ok($$select public.set_order_status(current_setting('tests.o2')::uuid, 'cancelled')$$,
  '42501', null, 'the viewer cannot cancel');
reset role;

-- ---------------------------------------------------------------------------
-- Tenant isolation.
-- ---------------------------------------------------------------------------
select tests.login('b7000000-0000-0000-0000-000000000001', 'owner-b@ord.test');
set local role authenticated;
select is_empty($$select 1 from public.orders where tenant_id = current_setting('tests.a')::uuid$$,
  'tenant B sees none of tenant A''s orders');
select is_empty($$select 1 from public.order_lines where tenant_id = current_setting('tests.a')::uuid$$,
  'or their lines');
select throws_ok($$select public.set_order_status(current_setting('tests.o2')::uuid, 'cancelled')$$,
  '42501', null, 'tenant B cannot change tenant A''s orders');
select throws_ok(
  $$insert into public.order_lines (tenant_id, order_id, description, unit_price_minor)
    values (current_setting('tests.a')::uuid, current_setting('tests.o2')::uuid, 'Planted', 1)$$,
  '42501', null, 'tenant B cannot add lines to tenant A''s orders'
);
select is_empty(
  $$update public.orders set notes = 'hacked' where tenant_id = current_setting('tests.a')::uuid returning id$$,
  'tenant B cannot edit tenant A''s orders'
);
with o as (
  insert into public.orders (tenant_id) values (current_setting('tests.b')::uuid) returning id
) select set_config('tests.ob', id::text, true) from o;
select is((select number from public.orders where id = current_setting('tests.ob')::uuid), 1,
  'each tenant numbers its own orders');
select throws_ok(
  $$insert into public.order_lines (tenant_id, order_id, item_id, quantity)
    values (current_setting('tests.b')::uuid, current_setting('tests.ob')::uuid, current_setting('tests.beer')::uuid, 1)$$,
  'P0002', null, 'tenant B cannot order tenant A''s items'
);
select throws_ok(
  $$insert into public.orders (tenant_id, reservation_id) values (current_setting('tests.b')::uuid, current_setting('tests.res')::uuid)$$,
  'P0002', null, 'or charge tenant A''s reservations'
);
reset role;

-- Anonymous users get nothing.
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok($$select 1 from public.orders$$, '42501', null, 'anon cannot read orders');
select throws_ok($$select public.set_order_status(current_setting('tests.o2')::uuid, 'cancelled')$$,
  '42501', null, 'anon cannot change orders');
reset role;

-- Audit trail.
select ok(
  exists (select 1 from public.audit_log where table_name = 'orders' and record_id = current_setting('tests.o4')
          and 'status' = any (changed) and new_data ->> 'status' = 'cancelled'),
  'cancelling is audited'
);

select * from finish();
rollback;
