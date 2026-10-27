-- Customers: normalisation, permissions per role, tenant isolation and audit.
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
-- Add an existing user to a tenant with a system role (as postgres, bypassing RLS).
create or replace function tests.add_member(p_tenant uuid, p_uid uuid, p_email text, p_role text) returns void
language sql as $$
  insert into public.tenant_members (tenant_id, user_id, role_id, email)
  select p_tenant, p_uid, r.id, p_email from public.roles r where r.tenant_id = p_tenant and r.key = p_role;
$$;
grant usage on schema tests to anon, authenticated;
grant execute on all functions in schema tests to anon, authenticated;

select tests.create_user('a1000000-0000-0000-0000-000000000001', 'owner-a@cust.test');
select tests.create_user('a1000000-0000-0000-0000-000000000002', 'desk-a@cust.test');
select tests.create_user('a1000000-0000-0000-0000-000000000003', 'viewer-a@cust.test');
select tests.create_user('b1000000-0000-0000-0000-000000000001', 'owner-b@cust.test');

select tests.login('a1000000-0000-0000-0000-000000000001', 'owner-a@cust.test');
select public.create_tenant('Cust A', 'cust-a');
select tests.login('b1000000-0000-0000-0000-000000000001', 'owner-b@cust.test');
select public.create_tenant('Cust B', 'cust-b');
select set_config('tests.a', (select id::text from public.tenants where slug = 'cust-a'), true);
select set_config('tests.b', (select id::text from public.tenants where slug = 'cust-b'), true);
select tests.add_member(current_setting('tests.a')::uuid, 'a1000000-0000-0000-0000-000000000002', 'desk-a@cust.test', 'front_desk');
select tests.add_member(current_setting('tests.a')::uuid, 'a1000000-0000-0000-0000-000000000003', 'viewer-a@cust.test', 'viewer');

select ok(
  (select bool_and(public.has_permission(current_setting('tests.a')::uuid, k))
   from unnest(array['customers.view', 'customers.create', 'customers.edit', 'customers.delete']) k)
  is not true,
  'owner B holds no customer permissions in tenant A'
);

-- ---------------------------------------------------------------------------
-- Front desk in A: create and edit; normalisation.
-- ---------------------------------------------------------------------------
select tests.login('a1000000-0000-0000-0000-000000000002', 'desk-a@cust.test');
set local role authenticated;

select lives_ok(
  $$insert into public.customers (tenant_id, name, phone, email, tags)
    values (current_setting('tests.a')::uuid, '  Wanjiku Kamau ', '0712 345 678', ' Wanjiku@Example.COM ',
            array['VIP', 'vip', ' corporate ', ''])$$,
  'front desk adds a customer'
);
select results_eq(
  $$select name, phone, email, tags from public.customers where tenant_id = current_setting('tests.a')::uuid$$,
  $$values ('Wanjiku Kamau', '+254712345678', 'wanjiku@example.com', array['corporate', 'vip'])$$,
  'name, phone, email and tags are normalised'
);
select throws_ok(
  $$insert into public.customers (tenant_id, name, phone) values (current_setting('tests.a')::uuid, 'Dup', '+254712345678')$$,
  '23505', null, 'phone numbers are unique per tenant'
);
select throws_ok(
  $$insert into public.customers (tenant_id, name, phone) values (current_setting('tests.a')::uuid, 'Bad', '12')$$,
  '22023', null, 'invalid phone numbers are rejected'
);
select throws_ok(
  $$insert into public.customers (tenant_id, name, attributes) values (current_setting('tests.a')::uuid, 'Bad', '[]')$$,
  '23514', null, 'attributes must be a JSON object'
);
select lives_ok(
  $$insert into public.customers (tenant_id, name) values (current_setting('tests.a')::uuid, 'Walk-in')$$,
  'contact details are optional'
);
select is(
  (select count(*)::int from public.customers where tenant_id = current_setting('tests.a')::uuid and phone is null),
  1, 'blank phones become null (so many customers can have none)'
);
update public.customers set notes = 'Prefers a sea view' where tenant_id = current_setting('tests.a')::uuid and name = 'Wanjiku Kamau';
select is(
  (select notes from public.customers where tenant_id = current_setting('tests.a')::uuid and name = 'Wanjiku Kamau'),
  'Prefers a sea view', 'front desk edits customers'
);
select lives_ok(
  $$insert into public.customer_notes (tenant_id, customer_id, body)
    select tenant_id, id, 'Called about late checkout' from public.customers
    where tenant_id = current_setting('tests.a')::uuid and name = 'Wanjiku Kamau'$$,
  'front desk adds a note'
);
select is(
  (select author_email from public.customer_notes where tenant_id = current_setting('tests.a')::uuid),
  'desk-a@cust.test', 'notes record their author'
);
-- Front desk lacks customers.delete: the delete matches no rows.
delete from public.customers where tenant_id = current_setting('tests.a')::uuid and name = 'Walk-in';
select is(
  (select count(*)::int from public.customers where tenant_id = current_setting('tests.a')::uuid),
  2, 'front desk cannot delete customers'
);
select throws_ok(
  $$update public.customers set created_by = null$$, '42501', null, 'created_by is not client-writable'
);
reset role;

-- ---------------------------------------------------------------------------
-- Viewer in A: read only.
-- ---------------------------------------------------------------------------
select tests.login('a1000000-0000-0000-0000-000000000003', 'viewer-a@cust.test');
set local role authenticated;
select is((select count(*)::int from public.customers), 2, 'viewers read customers');
select is((select count(*)::int from public.customer_notes), 1, 'viewers read notes');
select throws_ok(
  $$insert into public.customers (tenant_id, name) values (current_setting('tests.a')::uuid, 'Nope')$$,
  '42501', null, 'viewers cannot add customers'
);
update public.customers set name = 'Changed';
select is((select count(*)::int from public.customers where name = 'Changed'), 0, 'viewers cannot edit customers');
reset role;

-- ---------------------------------------------------------------------------
-- Owner B: tenant A is invisible and untouchable.
-- ---------------------------------------------------------------------------
select tests.login('b1000000-0000-0000-0000-000000000001', 'owner-b@cust.test');
set local role authenticated;
select is((select count(*)::int from public.customers), 0, 'owner B sees no tenant A customers');
select is((select count(*)::int from public.customer_notes), 0, 'owner B sees no tenant A notes');
select throws_ok(
  $$insert into public.customers (tenant_id, name) values (current_setting('tests.a')::uuid, 'Spy')$$,
  '42501', null, 'owner B cannot add customers to tenant A'
);
insert into public.customers (tenant_id, name) values (current_setting('tests.b')::uuid, 'B guest');
-- A note in B pointing at an A customer fails the composite foreign key.
reset role;
select set_config('tests.a_customer', (select id::text from public.customers
  where tenant_id = current_setting('tests.a')::uuid and name = 'Wanjiku Kamau'), true);
set local role authenticated;
select throws_ok(
  $$insert into public.customer_notes (tenant_id, customer_id, body)
    values (current_setting('tests.b')::uuid, current_setting('tests.a_customer')::uuid, 'sneaky')$$,
  '23503', null, 'notes cannot point at another tenant''s customer'
);
update public.customers set name = 'Hacked' where id = current_setting('tests.a_customer')::uuid;
delete from public.customers where id = current_setting('tests.a_customer')::uuid;
select throws_ok(
  $$update public.customers set tenant_id = current_setting('tests.a')::uuid where tenant_id = current_setting('tests.b')::uuid$$,
  '42501', null, 'customers cannot be moved to another tenant'
);
reset role;
select is(
  (select name from public.customers where id = current_setting('tests.a_customer')::uuid),
  'Wanjiku Kamau', 'tenant A customer was neither changed nor deleted by owner B'
);

-- ---------------------------------------------------------------------------
-- Owner A: delete with customers.delete; audit history.
-- ---------------------------------------------------------------------------
select tests.login('a1000000-0000-0000-0000-000000000001', 'owner-a@cust.test');
set local role authenticated;
delete from public.customers where tenant_id = current_setting('tests.a')::uuid and name = 'Walk-in';
select is((select count(*)::int from public.customers), 1, 'owners delete customers');
select ok(
  (select count(*) from public.audit_log
   where tenant_id = current_setting('tests.a')::uuid and table_name = 'customers' and action = 'insert') = 2,
  'customer inserts are audited'
);
select is(
  (select changed from public.audit_log
   where tenant_id = current_setting('tests.a')::uuid and table_name = 'customers' and action = 'update'),
  array['notes'], 'customer updates record the changed columns'
);
select is(
  (select actor_email from public.audit_log
   where tenant_id = current_setting('tests.a')::uuid and table_name = 'customer_notes'),
  'desk-a@cust.test', 'note history records who wrote it'
);
reset role;

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok('select * from public.customers', '42501', null, 'anon cannot read customers');
reset role;

select * from finish();
rollback;
