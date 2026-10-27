-- Booking: no double-booking, status flow, pricing, availability, recurring
-- series, permissions per role, tenant isolation and audit.
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

select tests.create_user('a2000000-0000-0000-0000-000000000001', 'owner-a@book.test');
select tests.create_user('a2000000-0000-0000-0000-000000000002', 'desk-a@book.test');
select tests.create_user('a2000000-0000-0000-0000-000000000003', 'waiter-a@book.test');
select tests.create_user('a2000000-0000-0000-0000-000000000004', 'viewer-a@book.test');
select tests.create_user('b2000000-0000-0000-0000-000000000001', 'owner-b@book.test');

select tests.login('a2000000-0000-0000-0000-000000000001', 'owner-a@book.test');
select public.create_tenant('Book A', 'book-a');
select tests.login('b2000000-0000-0000-0000-000000000001', 'owner-b@book.test');
select public.create_tenant('Book B', 'book-b');
select set_config('tests.a', (select id::text from public.tenants where slug = 'book-a'), true);
select set_config('tests.b', (select id::text from public.tenants where slug = 'book-b'), true);
update public.tenants set timezone = 'Africa/Nairobi' where id in (current_setting('tests.a')::uuid, current_setting('tests.b')::uuid);
select tests.add_member(current_setting('tests.a')::uuid, 'a2000000-0000-0000-0000-000000000002', 'desk-a@book.test', 'front_desk');
select tests.add_member(current_setting('tests.a')::uuid, 'a2000000-0000-0000-0000-000000000003', 'waiter-a@book.test', 'waiter');
select tests.add_member(current_setting('tests.a')::uuid, 'a2000000-0000-0000-0000-000000000004', 'viewer-a@book.test', 'viewer');
-- A day a week ahead, so slots are never "in the past".
select set_config('tests.day', ((now() at time zone 'Africa/Nairobi')::date + 7)::text, true);

-- ---------------------------------------------------------------------------
-- Owner A configures resources.
-- ---------------------------------------------------------------------------
select tests.login('a2000000-0000-0000-0000-000000000001', 'owner-a@book.test');
set local role authenticated;
select lives_ok(
  $$insert into public.resources (tenant_id, kind, name, capacity, rate_minor, rate_unit)
    values (current_setting('tests.a')::uuid, 'room', 'Room 101', 2, 500000, 'night'),
           (current_setting('tests.a')::uuid, 'room', 'Room 102', 4, 800000, 'night'),
           (current_setting('tests.a')::uuid, 'table', 'Table 1', 4, 0, 'booking'),
           (current_setting('tests.a')::uuid, 'court', 'Court', 4, 100000, 'hour')$$,
  'owners add resources'
);
select throws_ok(
  $$insert into public.resources (tenant_id, name) values (current_setting('tests.a')::uuid, 'room 101')$$,
  '23505', null, 'resource names are unique per tenant (case-insensitive)'
);
-- The court opens 08:00-12:00 on the test day only.
insert into public.resource_hours (tenant_id, resource_id, weekday, opens, closes)
select tenant_id, id, extract(dow from current_setting('tests.day')::date), '08:00', '12:00'
from public.resources where tenant_id = current_setting('tests.a')::uuid and name = 'Court';
insert into public.customers (tenant_id, name) values (current_setting('tests.a')::uuid, 'Achieng');
reset role;
select set_config('tests.r101', (select id::text from public.resources where tenant_id = current_setting('tests.a')::uuid and name = 'Room 101'), true);
select set_config('tests.r102', (select id::text from public.resources where tenant_id = current_setting('tests.a')::uuid and name = 'Room 102'), true);
select set_config('tests.table', (select id::text from public.resources where tenant_id = current_setting('tests.a')::uuid and name = 'Table 1'), true);
select set_config('tests.court', (select id::text from public.resources where tenant_id = current_setting('tests.a')::uuid and name = 'Court'), true);
select set_config('tests.cust', (select id::text from public.customers where tenant_id = current_setting('tests.a')::uuid), true);

-- ---------------------------------------------------------------------------
-- Front desk: reservations, double-booking, status flow, pricing.
-- ---------------------------------------------------------------------------
select tests.login('a2000000-0000-0000-0000-000000000002', 'desk-a@book.test');
set local role authenticated;

select lives_ok(
  $$select public.create_reservation(current_setting('tests.r101')::uuid,
      current_setting('tests.day')::date + time '14:00', current_setting('tests.day')::date + 2 + time '10:00',
      current_setting('tests.cust')::uuid, 2, 'Honeymoon')$$,
  'front desk books a 2-night stay'
);
select results_eq(
  $$select price_minor, starts_at, status from public.reservations where resource_id = current_setting('tests.r101')::uuid$$,
  $$values (1000000::bigint, (current_setting('tests.day')::date + time '14:00') at time zone 'Africa/Nairobi', 'confirmed')$$,
  'nightly price covers 2 nights; local times use the tenant time zone'
);
select throws_ok(
  $$select public.create_reservation(current_setting('tests.r101')::uuid,
      current_setting('tests.day')::date + 1 + time '12:00', current_setting('tests.day')::date + 3 + time '10:00')$$,
  '23P01', null, 'overlapping reservations are rejected (no double-booking)'
);
select lives_ok(
  $$select public.create_reservation(current_setting('tests.r101')::uuid,
      current_setting('tests.day')::date + 2 + time '10:00', current_setting('tests.day')::date + 3 + time '10:00')$$,
  'back-to-back reservations are allowed (ranges are half-open)'
);
select throws_ok(
  $$select public.create_reservation(current_setting('tests.r101')::uuid,
      current_setting('tests.day')::date + 5 + time '14:00', current_setting('tests.day')::date + 6 + time '10:00',
      null, 3)$$,
  '22023', null, 'guests cannot exceed capacity'
);
select throws_ok(
  $$select public.create_reservation(current_setting('tests.r101')::uuid,
      current_setting('tests.day')::date + time '14:00', current_setting('tests.day')::date + time '13:00')$$,
  '22023', null, 'the end must be after the start'
);
select throws_ok(
  $$select public.create_reservation(current_setting('tests.r101')::uuid,
      current_setting('tests.day')::date + 9 + time '14:00', current_setting('tests.day')::date + 10 + time '10:00',
      null, 1, '', '', 'completed')$$,
  '22023', null, 'new reservations cannot start completed'
);
select throws_ok(
  $$update public.reservations set price_minor = 0$$, '42501', null, 'prices are not client-writable'
);

-- Hourly pricing: 90 minutes on the court at 1,000.00/hour is 2 started hours.
select is(
  (public.create_reservation(current_setting('tests.court')::uuid,
     current_setting('tests.day')::date + time '09:00', current_setting('tests.day')::date + time '10:30')).price_minor,
  200000::bigint, 'hourly price charges every started hour'
);

-- Status flow.
select set_config('tests.stay', (select id::text from public.reservations
  where resource_id = current_setting('tests.r101')::uuid and title = 'Honeymoon'), true);
select throws_ok(
  $$update public.reservations set status = 'completed' where id = current_setting('tests.stay')::uuid$$,
  '22023', null, 'confirmed cannot jump to completed'
);
update public.reservations set status = 'checked_in' where id = current_setting('tests.stay')::uuid;
select isnt(
  (select checked_in_at from public.reservations where id = current_setting('tests.stay')::uuid),
  null, 'checking in stamps checked_in_at'
);
update public.reservations set status = 'completed' where id = current_setting('tests.stay')::uuid;
select is(
  (select status from public.reservations where id = current_setting('tests.stay')::uuid),
  'completed', 'checked in can complete'
);
select throws_ok(
  $$update public.reservations set status = 'cancelled' where id = current_setting('tests.stay')::uuid$$,
  '22023', null, 'completed reservations are final'
);
select lives_ok(
  $$update public.reservations set notes = 'Left a review' where id = current_setting('tests.stay')::uuid$$,
  'notes stay editable on final reservations'
);

-- Cancelling frees the slot.
select public.create_reservation(current_setting('tests.table')::uuid,
  current_setting('tests.day')::date + time '19:00', current_setting('tests.day')::date + time '21:00',
  null, 4, 'Birthday');
select throws_ok(
  $$select public.create_reservation(current_setting('tests.table')::uuid,
      current_setting('tests.day')::date + time '20:00', current_setting('tests.day')::date + time '22:00')$$,
  '23P01', null, 'the table is taken'
);
update public.reservations set status = 'cancelled' where title = 'Birthday';
select isnt(
  (select cancelled_at from public.reservations where title = 'Birthday'), null, 'cancelling stamps cancelled_at'
);
select lives_ok(
  $$select public.create_reservation(current_setting('tests.table')::uuid,
      current_setting('tests.day')::date + time '20:00', current_setting('tests.day')::date + time '22:00')$$,
  'a cancelled reservation frees its time'
);

-- ---------------------------------------------------------------------------
-- Availability.
-- ---------------------------------------------------------------------------
-- Court open 08:00-12:00 and busy 09:00-10:30: hour-long slots on a 30-minute grid.
select results_eq(
  $$select to_char(starts_at at time zone 'Africa/Nairobi', 'HH24:MI')
    from public.available_slots(current_setting('tests.court')::uuid, current_setting('tests.day')::date, 60, 30)$$,
  $$values ('08:00'), ('10:30'), ('11:00')$$,
  'available_slots skips busy time and closing time'
);
select is(
  (select count(*)::int from public.available_slots(current_setting('tests.court')::uuid, current_setting('tests.day')::date + 1, 60)),
  0, 'no slots on days without opening hours'
);
select is(
  (select count(*)::int from public.available_slots(current_setting('tests.table')::uuid, current_setting('tests.day')::date, 120, 60)),
  20, 'resources without hours are open all day (23 two-hour starts, minus 3 overlapping 20:00-22:00)'
);
select results_eq(
  $$select name from public.available_resources(current_setting('tests.a')::uuid,
      current_setting('tests.day')::date + 1 + time '14:00', current_setting('tests.day')::date + 2 + time '10:00', 'room', 2)$$,
  $$values ('Room 102')$$,
  'available_resources excludes booked rooms'
);
select results_eq(
  $$select name from public.available_resources(current_setting('tests.a')::uuid,
      current_setting('tests.day')::date + 4 + time '14:00', current_setting('tests.day')::date + 5 + time '10:00', 'room', 3)$$,
  $$values ('Room 102')$$,
  'available_resources respects capacity'
);
select is(
  (select count(*)::int from public.available_resources(current_setting('tests.a')::uuid,
      current_setting('tests.day')::date + time '11:00', current_setting('tests.day')::date + time '13:00', 'court')),
  0, 'available_resources respects opening hours'
);

-- ---------------------------------------------------------------------------
-- Recurring series: all or nothing.
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from public.create_recurring_reservations(current_setting('tests.r102')::uuid,
     current_setting('tests.day')::date + 14 + time '09:00', 60, interval '1 week', 4, null, 1, 'Weekly meeting')),
  4, 'a weekly series creates every occurrence'
);
select is(
  (select count(distinct series_id)::int from public.reservations where title = 'Weekly meeting'),
  1, 'the occurrences share one series'
);
-- The third occurrence (day + 14, 09:30) overlaps the first weekly meeting.
select throws_ok(
  $$select public.create_recurring_reservations(current_setting('tests.r102')::uuid,
      current_setting('tests.day')::date + time '09:30', 60, interval '1 week', 3)$$,
  '23P01', null, 'a clash anywhere in the series fails the whole series'
);
select is(
  (select count(*)::int from public.reservations where resource_id = current_setting('tests.r102')::uuid),
  4, 'nothing from the failed series was saved'
);
reset role;

-- ---------------------------------------------------------------------------
-- Roles: waiters make reservations but cannot manage them; viewers read only.
-- ---------------------------------------------------------------------------
select tests.login('a2000000-0000-0000-0000-000000000003', 'waiter-a@book.test');
set local role authenticated;
select lives_ok(
  $$select public.create_reservation(current_setting('tests.table')::uuid,
      current_setting('tests.day')::date + 1 + time '19:00', current_setting('tests.day')::date + 1 + time '21:00')$$,
  'waiters take table bookings'
);
update public.reservations set status = 'cancelled'
where resource_id = current_setting('tests.table')::uuid and status = 'confirmed';
select is(
  (select count(*)::int from public.reservations where resource_id = current_setting('tests.table')::uuid and status = 'cancelled'),
  1, 'waiters cannot cancel reservations (only the earlier cancellation exists)'
);
select throws_ok(
  $$insert into public.resources (tenant_id, name) values (current_setting('tests.a')::uuid, 'Table 2')$$,
  '42501', null, 'waiters cannot add resources'
);
reset role;

select tests.login('a2000000-0000-0000-0000-000000000004', 'viewer-a@book.test');
set local role authenticated;
select ok((select count(*) from public.reservations) > 0, 'viewers read reservations');
select throws_ok(
  $$select public.create_reservation(current_setting('tests.table')::uuid,
      current_setting('tests.day')::date + 3 + time '19:00', current_setting('tests.day')::date + 3 + time '21:00')$$,
  '42501', null, 'viewers cannot make reservations'
);
select throws_ok('delete from public.reservations', '42501', null, 'reservations are never deleted, only cancelled');
reset role;

-- ---------------------------------------------------------------------------
-- Owner B: tenant A is invisible and untouchable.
-- ---------------------------------------------------------------------------
select tests.login('b2000000-0000-0000-0000-000000000001', 'owner-b@book.test');
set local role authenticated;
select is((select count(*)::int from public.resources), 0, 'owner B sees no tenant A resources');
select is((select count(*)::int from public.reservations), 0, 'owner B sees no tenant A reservations');
select is(
  (select count(*)::int from public.available_slots(current_setting('tests.table')::uuid, current_setting('tests.day')::date, 60)),
  0, 'owner B gets no slots for tenant A resources'
);
select throws_ok(
  $$select public.create_reservation(current_setting('tests.table')::uuid,
      current_setting('tests.day')::date + 4 + time '19:00', current_setting('tests.day')::date + 4 + time '21:00')$$,
  'P0002', null, 'owner B cannot book tenant A resources'
);
insert into public.resources (tenant_id, name) values (current_setting('tests.b')::uuid, 'B room');
select throws_ok(
  $$insert into public.reservations (tenant_id, resource_id, during)
    values (current_setting('tests.b')::uuid, current_setting('tests.table')::uuid,
            tstzrange(now() + interval '30 days', now() + interval '31 days'))$$,
  'P0002', null, 'a B reservation cannot point at an A resource'
);
select throws_ok(
  $$insert into public.reservations (tenant_id, resource_id, customer_id, during)
    select current_setting('tests.b')::uuid, id, current_setting('tests.cust')::uuid,
           tstzrange(now() + interval '30 days', now() + interval '31 days')
    from public.resources where name = 'B room'$$,
  '23503', null, 'a B reservation cannot point at an A customer'
);
update public.reservations set status = 'cancelled' where resource_id = current_setting('tests.table')::uuid;
reset role;
select is(
  (select count(*)::int from public.reservations where resource_id = current_setting('tests.table')::uuid and status = 'confirmed'),
  2, 'owner B changed nothing in tenant A'
);

-- ---------------------------------------------------------------------------
-- Audit and anon.
-- ---------------------------------------------------------------------------
select ok(
  (select count(*) from public.audit_log
   where tenant_id = current_setting('tests.a')::uuid and table_name = 'reservations' and action = 'update'
     and 'status' = any(changed)) >= 3,
  'status changes are audited'
);
select is(
  (select actor_email from public.audit_log
   where tenant_id = current_setting('tests.a')::uuid and table_name = 'resources' and action = 'insert' limit 1),
  'owner-a@book.test', 'resource history records who added it'
);

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok('select * from public.reservations', '42501', null, 'anon cannot read reservations');
select throws_ok(
  $$select * from public.available_slots(current_setting('tests.table')::uuid, current_setting('tests.day')::date, 60)$$,
  '42501', null, 'anon cannot query availability'
);
reset role;

select * from finish();
rollback;
