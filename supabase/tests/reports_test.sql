-- Reports: permissions, tenant isolation, time zones and gap filling.
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

select tests.create_user('a6000000-0000-0000-0000-000000000001', 'owner-a@rep.test');
select tests.create_user('a6000000-0000-0000-0000-000000000002', 'desk-a@rep.test');
select tests.create_user('a6000000-0000-0000-0000-000000000003', 'viewer-a@rep.test');
select tests.create_user('a6000000-0000-0000-0000-000000000004', 'analyst-a@rep.test');
select tests.create_user('b6000000-0000-0000-0000-000000000001', 'owner-b@rep.test');

select tests.login('a6000000-0000-0000-0000-000000000001', 'owner-a@rep.test');
select public.create_tenant('Rep A', 'rep-a');
select tests.login('b6000000-0000-0000-0000-000000000001', 'owner-b@rep.test');
select public.create_tenant('Rep B', 'rep-b');
select set_config('tests.a', (select id::text from public.tenants where slug = 'rep-a'), true);
select set_config('tests.b', (select id::text from public.tenants where slug = 'rep-b'), true);
select tests.add_member(current_setting('tests.a')::uuid, 'a6000000-0000-0000-0000-000000000002', 'desk-a@rep.test', 'front_desk');
select tests.add_member(current_setting('tests.a')::uuid, 'a6000000-0000-0000-0000-000000000003', 'viewer-a@rep.test', 'viewer');
-- A custom role that may see reports but nothing else.
insert into public.roles (tenant_id, key, name) values (current_setting('tests.a')::uuid, 'analyst', 'Analyst');
insert into public.role_permissions (tenant_id, role_id, permission_key)
select tenant_id, id, 'reports.view' from public.roles where tenant_id = current_setting('tests.a')::uuid and key = 'analyst';
select tests.add_member(current_setting('tests.a')::uuid, 'a6000000-0000-0000-0000-000000000004', 'analyst-a@rep.test', 'analyst');

select is(
  (select array_agg(r.key order by r.key) from public.role_permissions rp join public.roles r on r.id = rp.role_id
   where rp.tenant_id = current_setting('tests.a')::uuid and rp.permission_key = 'reports.view'),
  array['analyst', 'manager', 'viewer'], 'reports.view goes to managers and viewers by default'
);

-- ---------------------------------------------------------------------------
-- Seed history directly (as postgres, triggers off) so dates are exact.
-- Both tenants use Africa/Nairobi (UTC+3). The period is Sun 1 - Sat 7 March 2026.
-- ---------------------------------------------------------------------------
set local session_replication_role = replica;

insert into public.invoices (id, tenant_id, kind, number, status, issue_date, due_date, total_minor, paid_minor) values
  ('a6100000-0000-0000-0000-000000000001', current_setting('tests.a')::uuid, 'invoice', 'INV-1', 'partially_paid', '2026-03-02', '2026-03-05', 10000, 4000),
  ('a6100000-0000-0000-0000-000000000002', current_setting('tests.a')::uuid, 'invoice', 'INV-2', 'paid', '2026-03-03', null, 5000, 5000),
  ('a6100000-0000-0000-0000-000000000003', current_setting('tests.a')::uuid, 'invoice', null, 'draft', null, null, 8888, 0),
  ('a6100000-0000-0000-0000-000000000004', current_setting('tests.a')::uuid, 'invoice', 'INV-4', 'void', '2026-03-02', null, 9999, 0),
  ('a6100000-0000-0000-0000-000000000005', current_setting('tests.a')::uuid, 'invoice', 'INV-5', 'issued', '2026-01-01', '2026-01-10', 7000, 0),
  ('a6100000-0000-0000-0000-000000000006', current_setting('tests.a')::uuid, 'quote', 'Q-1', 'issued', '2026-03-04', null, 3333, 0),
  ('a6100000-0000-0000-0000-000000000007', current_setting('tests.a')::uuid, 'invoice', 'INV-7', 'issued', '2026-03-06', null, 2000, 0),
  ('b6100000-0000-0000-0000-000000000001', current_setting('tests.b')::uuid, 'invoice', 'INV-1', 'paid', '2026-03-02', null, 777, 777);

insert into public.payments (tenant_id, invoice_id, amount_minor, method, received_at) values
  -- 22:30 UTC on the 1st is 01:30 on the 2nd in Nairobi.
  (current_setting('tests.a')::uuid, 'a6100000-0000-0000-0000-000000000001', 4000, 'mpesa', '2026-03-01 22:30+00'),
  (current_setting('tests.a')::uuid, 'a6100000-0000-0000-0000-000000000002', 5000, 'cash', '2026-03-03 09:00+03'),
  -- 21:30 UTC on the 7th is already the 8th in Nairobi: outside the period.
  (current_setting('tests.a')::uuid, 'a6100000-0000-0000-0000-000000000002', 1, 'card', '2026-03-07 21:30+00'),
  (current_setting('tests.b')::uuid, 'b6100000-0000-0000-0000-000000000001', 777, 'mpesa', '2026-03-02 12:00+03');

insert into public.resources (id, tenant_id, name, position, active) values
  ('a6200000-0000-0000-0000-000000000001', current_setting('tests.a')::uuid, 'Room 1', 1, true),
  ('a6200000-0000-0000-0000-000000000002', current_setting('tests.a')::uuid, 'Hall', 2, true),
  ('a6200000-0000-0000-0000-000000000003', current_setting('tests.a')::uuid, 'Old room', 3, false),
  ('b6200000-0000-0000-0000-000000000001', current_setting('tests.b')::uuid, 'B room', 1, true);
-- Room 1 opens 09:00-17:00 Monday to Friday; the hall has no hours (open all day).
insert into public.resource_hours (tenant_id, resource_id, weekday, opens, closes)
select current_setting('tests.a')::uuid, 'a6200000-0000-0000-0000-000000000001', d, '09:00', '17:00'
from generate_series(1, 5) d;
insert into public.reservations (tenant_id, resource_id, during, status) values
  (current_setting('tests.a')::uuid, 'a6200000-0000-0000-0000-000000000001', '[2026-03-02 10:00+03, 2026-03-02 12:00+03)', 'confirmed'),
  (current_setting('tests.a')::uuid, 'a6200000-0000-0000-0000-000000000001', '[2026-03-03 10:00+03, 2026-03-03 12:00+03)', 'cancelled'),
  -- Starts before the period: only the 2 hours after midnight count.
  (current_setting('tests.a')::uuid, 'a6200000-0000-0000-0000-000000000002', '[2026-02-28 22:00+03, 2026-03-01 02:00+03)', 'completed'),
  (current_setting('tests.a')::uuid, 'a6200000-0000-0000-0000-000000000002', '[2026-03-04 10:00+03, 2026-03-04 11:00+03)', 'no_show'),
  (current_setting('tests.a')::uuid, 'a6200000-0000-0000-0000-000000000002', '[2026-03-07 23:00+03, 2026-03-08 01:00+03)', 'tentative'),
  (current_setting('tests.b')::uuid, 'b6200000-0000-0000-0000-000000000001', '[2026-03-02 10:00+03, 2026-03-02 12:00+03)', 'confirmed');

insert into public.stock_locations (id, tenant_id, name) values
  ('a6300000-0000-0000-0000-000000000001', current_setting('tests.a')::uuid, 'Report store'),
  ('b6300000-0000-0000-0000-000000000001', current_setting('tests.b')::uuid, 'Report store');
insert into public.items (id, tenant_id, name, cost_minor, reorder_level, track_stock, active) values
  ('a6400000-0000-0000-0000-000000000001', current_setting('tests.a')::uuid, 'Soda', 50, 12, true, true),
  ('a6400000-0000-0000-0000-000000000002', current_setting('tests.a')::uuid, 'Beer', 200, 0, true, true),
  ('a6400000-0000-0000-0000-000000000003', current_setting('tests.a')::uuid, 'Tea', null, 0, true, true),
  ('a6400000-0000-0000-0000-000000000004', current_setting('tests.a')::uuid, 'Massage', 1000, 0, false, true),
  ('a6400000-0000-0000-0000-000000000005', current_setting('tests.a')::uuid, 'Old stock', 1000, 0, true, false),
  ('b6400000-0000-0000-0000-000000000001', current_setting('tests.b')::uuid, 'B soda', 50, 0, true, true);
insert into public.stock_levels (tenant_id, item_id, location_id, quantity) values
  (current_setting('tests.a')::uuid, 'a6400000-0000-0000-0000-000000000001', 'a6300000-0000-0000-0000-000000000001', 10),
  (current_setting('tests.a')::uuid, 'a6400000-0000-0000-0000-000000000002', 'a6300000-0000-0000-0000-000000000001', 5),
  (current_setting('tests.a')::uuid, 'a6400000-0000-0000-0000-000000000003', 'a6300000-0000-0000-0000-000000000001', 3),
  (current_setting('tests.a')::uuid, 'a6400000-0000-0000-0000-000000000005', 'a6300000-0000-0000-0000-000000000001', 50),
  (current_setting('tests.b')::uuid, 'b6400000-0000-0000-0000-000000000001', 'b6300000-0000-0000-0000-000000000001', 1000);

insert into public.orders (id, tenant_id, number, status, location_id, sent_at) values
  ('a6500000-0000-0000-0000-000000000001', current_setting('tests.a')::uuid, 1, 'paid', 'a6300000-0000-0000-0000-000000000001', '2026-03-02 12:00+03'),
  ('a6500000-0000-0000-0000-000000000002', current_setting('tests.a')::uuid, 2, 'sent', 'a6300000-0000-0000-0000-000000000001', '2026-03-04 12:00+03'),
  ('a6500000-0000-0000-0000-000000000003', current_setting('tests.a')::uuid, 3, 'open', 'a6300000-0000-0000-0000-000000000001', null),
  ('a6500000-0000-0000-0000-000000000004', current_setting('tests.a')::uuid, 4, 'cancelled', 'a6300000-0000-0000-0000-000000000001', '2026-03-04 12:00+03'),
  ('a6500000-0000-0000-0000-000000000005', current_setting('tests.a')::uuid, 5, 'fulfilled', 'a6300000-0000-0000-0000-000000000001', '2026-02-01 12:00+03'),
  ('b6500000-0000-0000-0000-000000000001', current_setting('tests.b')::uuid, 1, 'paid', 'b6300000-0000-0000-0000-000000000001', '2026-03-02 12:00+03');
insert into public.order_lines (tenant_id, order_id, item_id, description, quantity, unit_price_minor) values
  (current_setting('tests.a')::uuid, 'a6500000-0000-0000-0000-000000000001', 'a6400000-0000-0000-0000-000000000001', 'Soda', 2, 100),
  (current_setting('tests.a')::uuid, 'a6500000-0000-0000-0000-000000000001', 'a6400000-0000-0000-0000-000000000002', 'Beer', 1, 300),
  (current_setting('tests.a')::uuid, 'a6500000-0000-0000-0000-000000000001', null, 'Corkage', 1, 500),
  (current_setting('tests.a')::uuid, 'a6500000-0000-0000-0000-000000000002', 'a6400000-0000-0000-0000-000000000001', 'Soda (cold)', 3, 100),
  (current_setting('tests.a')::uuid, 'a6500000-0000-0000-0000-000000000002', null, 'Corkage ', 1, 500),
  (current_setting('tests.a')::uuid, 'a6500000-0000-0000-0000-000000000003', 'a6400000-0000-0000-0000-000000000002', 'Beer', 10, 300),
  (current_setting('tests.a')::uuid, 'a6500000-0000-0000-0000-000000000004', 'a6400000-0000-0000-0000-000000000002', 'Beer', 10, 300),
  (current_setting('tests.a')::uuid, 'a6500000-0000-0000-0000-000000000005', 'a6400000-0000-0000-0000-000000000002', 'Beer', 10, 300),
  (current_setting('tests.b')::uuid, 'b6500000-0000-0000-0000-000000000001', 'b6400000-0000-0000-0000-000000000001', 'B soda', 99, 100);

insert into public.customers (tenant_id, name, created_at, archived_at) values
  (current_setting('tests.a')::uuid, 'Late night', '2026-03-01 21:30+00', null),
  (current_setting('tests.a')::uuid, 'Morning', '2026-03-02 10:00+03', null),
  (current_setting('tests.a')::uuid, 'Archived', '2026-03-05 10:00+03', '2026-03-06 10:00+03'),
  (current_setting('tests.a')::uuid, 'Before', '2026-02-28 20:00+00', null),
  (current_setting('tests.b')::uuid, 'B customer', '2026-03-02 10:00+03', null);

set local session_replication_role = origin;

-- ---------------------------------------------------------------------------
-- Viewer in A: every report, with exact numbers.
-- ---------------------------------------------------------------------------
select tests.login('a6000000-0000-0000-0000-000000000003', 'viewer-a@rep.test');
set local role authenticated;

select results_eq(
  $$select bucket, invoiced_minor, paid_minor
    from public.report_revenue(current_setting('tests.a')::uuid, '2026-03-01', '2026-03-07')$$,
  $$values ('2026-03-01'::date, 0::bigint, 0::bigint), ('2026-03-02', 10000, 4000), ('2026-03-03', 5000, 5000),
           ('2026-03-04', 0, 0), ('2026-03-05', 0, 0), ('2026-03-06', 2000, 0), ('2026-03-07', 0, 0)$$,
  'daily revenue fills empty days, buckets payments by local day and skips drafts, voids and quotes'
);
select results_eq(
  $$select bucket, invoiced_minor, paid_minor
    from public.report_revenue(current_setting('tests.a')::uuid, '2026-03-01', '2026-03-07', 'week')$$,
  $$values ('2026-02-23'::date, 0::bigint, 0::bigint), ('2026-03-02', 17000, 9000)$$,
  'weekly revenue buckets start on Monday'
);
select is(
  (select count(*)::int from public.report_revenue(current_setting('tests.a')::uuid, '2026-01-01', '2026-12-31')),
  365, 'a whole year has a row per day'
);
select results_eq(
  $$select method, payments, amount_minor
    from public.report_payment_methods(current_setting('tests.a')::uuid, '2026-03-01', '2026-03-07')$$,
  $$values ('mpesa', 1, 4000::bigint), ('cash', 1, 5000::bigint), ('card', 0, 0::bigint),
           ('bank', 0, 0::bigint), ('other', 0, 0::bigint)$$,
  'payments by method list every method, M-Pesa first'
);
select results_eq(
  $$select bucket, invoices, outstanding_minor
    from public.report_receivables_aging(current_setting('tests.a')::uuid, '2026-03-10')$$,
  $$values ('current', 1, 2000::bigint), ('1_30', 1, 6000::bigint), ('31_60', 1, 7000::bigint),
           ('61_90', 0, 0::bigint), ('over_90', 0, 0::bigint)$$,
  'receivables are aged by days past due'
);
select is(
  (select sum(outstanding_minor)::bigint from public.report_receivables_aging(current_setting('tests.a')::uuid)),
  15000::bigint, 'ageing defaults to today and covers every open invoice'
);
select results_eq(
  $$select resource_name, reservations, booked_minutes, available_minutes
    from public.report_booking_utilisation(current_setting('tests.a')::uuid, '2026-03-01', '2026-03-07')$$,
  $$values ('Room 1', 1, 120::bigint, 2400::bigint), ('Hall', 2, 180::bigint, 10080::bigint)$$,
  'utilisation clips bookings to the period, ignores cancellations and uses opening hours'
);
select results_eq(
  $$select status, reservations
    from public.report_reservation_status(current_setting('tests.a')::uuid, '2026-03-01', '2026-03-07')$$,
  $$values ('tentative', 1), ('confirmed', 1), ('checked_in', 0), ('completed', 0), ('cancelled', 1), ('no_show', 1)$$,
  'reservations starting in the period are counted per status'
);
select results_eq(
  $$select name, quantity, revenue_minor
    from public.report_top_items(current_setting('tests.a')::uuid, '2026-03-01', '2026-03-07')$$,
  $$values ('Corkage', 2::numeric, 1000::bigint), ('Soda', 5::numeric, 500::bigint), ('Beer', 1::numeric, 300::bigint)$$,
  'top items count sent orders only and group free-text lines'
);
select results_eq(
  $$select items, stock_value_minor, low_items, uncosted_items from public.report_stock_summary(current_setting('tests.a')::uuid)$$,
  $$values (3, 1500::bigint, 1, 1)$$,
  'stock value is on hand at cost for active tracked items'
);
select results_eq(
  $$select day, customers from public.report_new_customers(current_setting('tests.a')::uuid, '2026-03-01', '2026-03-07')$$,
  $$values ('2026-03-01'::date, 0), ('2026-03-02', 2), ('2026-03-03', 0), ('2026-03-04', 0),
           ('2026-03-05', 1), ('2026-03-06', 0), ('2026-03-07', 0)$$,
  'new customers are counted per local day'
);

select throws_ok(
  $$select * from public.report_revenue(current_setting('tests.a')::uuid, '2026-03-07', '2026-03-01')$$,
  '22023', null, 'periods must run forwards'
);
select throws_ok(
  $$select * from public.report_revenue(current_setting('tests.a')::uuid, '2025-01-01', '2026-03-01')$$,
  '22023', null, 'periods are at most 366 days'
);
select throws_ok(
  $$select * from public.report_revenue(current_setting('tests.a')::uuid, '2026-03-01', '2026-03-07', 'month')$$,
  '22023', null, 'unknown buckets are rejected'
);
select throws_ok(
  $$select * from public.report_top_items(current_setting('tests.a')::uuid, '2026-03-01', '2026-03-07', 1000)$$,
  '22023', null, 'top items are limited to 100'
);
select throws_ok(
  $$select * from public.report_revenue(current_setting('tests.b')::uuid, '2026-03-01', '2026-03-07')$$,
  '42501', null, 'a viewer in A cannot report on tenant B'
);
reset role;

-- ---------------------------------------------------------------------------
-- Roles without reports.view, or without the module permission.
-- ---------------------------------------------------------------------------
select tests.login('a6000000-0000-0000-0000-000000000002', 'desk-a@rep.test');
set local role authenticated;
select ok(public.has_permission(current_setting('tests.a')::uuid, 'billing.view'), 'front desk can view billing');
select throws_ok(
  $$select * from public.report_revenue(current_setting('tests.a')::uuid, '2026-03-01', '2026-03-07')$$,
  '42501', null, 'front desk lacks reports.view'
);
select throws_ok(
  $$select * from public.report_stock_summary(current_setting('tests.a')::uuid)$$,
  '42501', null, 'every report needs reports.view'
);
reset role;

select tests.login('a6000000-0000-0000-0000-000000000004', 'analyst-a@rep.test');
set local role authenticated;
select throws_ok(
  $$select * from public.report_payment_methods(current_setting('tests.a')::uuid, '2026-03-01', '2026-03-07')$$,
  '42501', null, 'reports.view alone does not reveal billing'
);
select throws_ok(
  $$select * from public.report_booking_utilisation(current_setting('tests.a')::uuid, '2026-03-01', '2026-03-07')$$,
  '42501', null, 'reports.view alone does not reveal bookings'
);
select throws_ok(
  $$select * from public.report_top_items(current_setting('tests.a')::uuid, '2026-03-01', '2026-03-07')$$,
  '42501', null, 'reports.view alone does not reveal orders'
);
select throws_ok(
  $$select * from public.report_new_customers(current_setting('tests.a')::uuid, '2026-03-01', '2026-03-07')$$,
  '42501', null, 'reports.view alone does not reveal customers'
);
reset role;

-- ---------------------------------------------------------------------------
-- Owner B: only tenant B's numbers.
-- ---------------------------------------------------------------------------
select tests.login('b6000000-0000-0000-0000-000000000001', 'owner-b@rep.test');
set local role authenticated;
select throws_ok(
  $$select * from public.report_revenue(current_setting('tests.a')::uuid, '2026-03-01', '2026-03-07')$$,
  '42501', null, 'owner B cannot run reports on tenant A'
);
select throws_ok(
  $$select * from public.report_stock_summary(current_setting('tests.a')::uuid)$$,
  '42501', null, 'owner B cannot see tenant A stock'
);
select is(
  (select sum(paid_minor)::bigint from public.report_revenue(current_setting('tests.b')::uuid, '2026-03-01', '2026-03-07')),
  777::bigint, 'owner B sees only tenant B revenue'
);
select results_eq(
  $$select name, revenue_minor from public.report_top_items(current_setting('tests.b')::uuid, '2026-03-01', '2026-03-07')$$,
  $$values ('B soda', 9900::bigint)$$,
  'owner B sees only tenant B items'
);
select is(
  (select sum(customers)::int from public.report_new_customers(current_setting('tests.b')::uuid, '2026-03-01', '2026-03-07')),
  1, 'owner B sees only tenant B customers'
);
select results_eq(
  $$select resource_name, booked_minutes from public.report_booking_utilisation(current_setting('tests.b')::uuid, '2026-03-01', '2026-03-07')$$,
  $$values ('B room', 120::bigint)$$,
  'owner B sees only tenant B resources'
);
reset role;

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok(
  $$select * from public.report_revenue(current_setting('tests.a')::uuid, '2026-03-01', '2026-03-07')$$,
  '42501', null, 'anon cannot run reports'
);
reset role;

select * from finish();
rollback;
