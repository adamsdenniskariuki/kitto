-- Tenant isolation: members of tenant B can neither read nor write tenant A.
--
-- Pattern used in every Kitto pgTAP file:
--   select tests.login('<uuid>', '<email>');  -- as postgres: set JWT claims
--   set local role authenticated;             -- now RLS applies
--   ... assertions ...
--   reset role;                               -- back to postgres (bypasses RLS)
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
grant usage on schema tests to anon, authenticated;
grant execute on all functions in schema tests to anon, authenticated;

select tests.create_user('aaaaaaaa-0000-0000-0000-000000000001', 'owner-a@kitto.test');
select tests.create_user('bbbbbbbb-0000-0000-0000-000000000001', 'owner-b@kitto.test');
select tests.create_user('cccccccc-0000-0000-0000-000000000001', 'nobody@kitto.test');

select tests.login('aaaaaaaa-0000-0000-0000-000000000001', 'owner-a@kitto.test');
select lives_ok($$select public.create_tenant('Hotel A', 'hotel-a')$$, 'owner A creates a tenant');
select tests.login('bbbbbbbb-0000-0000-0000-000000000001', 'owner-b@kitto.test');
select lives_ok($$select public.create_tenant('Cars B', 'cars-b')$$, 'owner B creates a tenant');
select set_config('tests.tenant_a', (select id::text from public.tenants where slug = 'hotel-a'), true);
select set_config('tests.role_a', (select id::text from public.roles
  where tenant_id = current_setting('tests.tenant_a')::uuid and key = 'viewer'), true);

select is(
  (select count(*)::int from public.roles where tenant_id = current_setting('tests.tenant_a')::uuid and is_system),
  7, 'a new tenant gets the seven system roles'
);
select is(
  (select r.key from public.tenant_members m join public.roles r on r.id = m.role_id
   where m.user_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'owner', 'the creator becomes owner'
);
select throws_ok(
  $$select public.create_tenant('Duplicate', 'hotel-a')$$, '23505', null,
  'tenant slugs are unique'
);
select throws_ok(
  $$select public.create_tenant('Bad slug', 'Not A Slug!')$$, '23514', null,
  'tenant slugs must be URL-safe'
);

-- ---------------------------------------------------------------------------
-- Owner B: reads only tenant B; writes to A are refused or silently filtered.
-- ---------------------------------------------------------------------------
select tests.login('bbbbbbbb-0000-0000-0000-000000000001', 'owner-b@kitto.test');
set local role authenticated;

select results_eq('select slug from public.tenants', $$values ('cars-b')$$,
  'owner B sees only their own tenant');
select is((select count(*)::int from public.roles where tenant_id = current_setting('tests.tenant_a')::uuid), 0,
  'owner B cannot see tenant A roles');
select is((select count(*)::int from public.tenant_members where tenant_id = current_setting('tests.tenant_a')::uuid), 0,
  'owner B cannot see tenant A members');
select is((select count(*)::int from public.role_permissions where tenant_id = current_setting('tests.tenant_a')::uuid), 0,
  'owner B cannot see tenant A role permissions');
select is((select count(*)::int from public.audit_log where tenant_id = current_setting('tests.tenant_a')::uuid), 0,
  'owner B cannot see tenant A audit history');
select is(public.has_permission(current_setting('tests.tenant_a')::uuid, 'tenant.manage'), false,
  'owner B has no permissions in tenant A');
select is((select count(*)::int from public.my_tenants()), 1, 'my_tenants lists only own tenants');

select throws_ok(
  $$insert into public.roles (tenant_id, key, name) values (current_setting('tests.tenant_a')::uuid, 'spy', 'Spy')$$,
  '42501', null, 'owner B cannot create roles in tenant A'
);
select throws_ok(
  $$insert into public.invitations (tenant_id, email, role_id)
    values (current_setting('tests.tenant_a')::uuid, 'owner-b@kitto.test', current_setting('tests.role_a')::uuid)$$,
  '42501', null, 'owner B cannot invite themselves into tenant A'
);
select throws_ok(
  $$insert into public.role_permissions (tenant_id, role_id, permission_key)
    values (current_setting('tests.tenant_a')::uuid, current_setting('tests.role_a')::uuid, 'tenant.manage')$$,
  '42501', null, 'owner B cannot grant permissions in tenant A'
);
-- A role from tenant B cannot be attached to tenant A data (composite FK).
select throws_ok(
  $$insert into public.role_permissions (tenant_id, role_id, permission_key)
    select tenant_id, current_setting('tests.role_a')::uuid, 'audit.view'
    from public.roles where key = 'viewer'$$,
  null, null, 'a role id from another tenant is rejected'
);

update public.tenants set name = 'Hacked' where slug = 'hotel-a';
update public.roles set name = 'Hacked' where tenant_id = current_setting('tests.tenant_a')::uuid;
delete from public.roles where tenant_id = current_setting('tests.tenant_a')::uuid;
delete from public.tenant_members where tenant_id = current_setting('tests.tenant_a')::uuid;
reset role;

select is((select name from public.tenants where slug = 'hotel-a'), 'Hotel A', 'tenant A was not renamed');
select is((select count(*)::int from public.roles where tenant_id = current_setting('tests.tenant_a')::uuid and name = 'Hacked'), 0,
  'tenant A roles were not changed');
select is((select count(*)::int from public.tenant_members where tenant_id = current_setting('tests.tenant_a')::uuid), 1,
  'tenant A members were not removed');

-- ---------------------------------------------------------------------------
-- A user with no membership sees nothing.
-- ---------------------------------------------------------------------------
select tests.login('cccccccc-0000-0000-0000-000000000001', 'nobody@kitto.test');
set local role authenticated;
select is((select count(*)::int from public.tenants), 0, 'non-members see no tenants');
select is((select count(*)::int from public.roles), 0, 'non-members see no roles');
select ok((select count(*) from public.permissions) > 0, 'the permission catalogue is readable');
reset role;

-- ---------------------------------------------------------------------------
-- Column privileges and anon.
-- ---------------------------------------------------------------------------
select tests.login('aaaaaaaa-0000-0000-0000-000000000001', 'owner-a@kitto.test');
set local role authenticated;
select throws_ok($$insert into public.tenants (name, slug) values ('Direct', 'direct')$$,
  '42501', null, 'tenants cannot be inserted directly (use create_tenant)');
select throws_ok($$update public.tenants set slug = 'stolen'$$,
  '42501', null, 'the slug is not client-writable');
select lives_ok($$update public.tenants set currency = 'USD', theme = 'ocean' where slug = 'hotel-a'$$,
  'owners update tenant settings');
select throws_ok($$update public.roles set is_system = false$$,
  '42501', null, 'is_system is not client-writable');
select throws_ok($$insert into public.audit_log (tenant_id, table_name, record_id, action) values
  (current_setting('tests.tenant_a')::uuid, 'x', 'y', 'insert')$$,
  '42501', null, 'clients cannot write audit history');
select throws_ok('select * from private.role_templates', '42501', null, 'private tables are not readable');
reset role;

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok('select * from public.tenants', '42501', null, 'anon cannot read tenants');
select throws_ok('select * from public.tenant_members', '42501', null, 'anon cannot read members');
select throws_ok($$select public.create_tenant('Anon', 'anon-co')$$, '42501', null, 'anon cannot create tenants');
reset role;

select * from finish();
rollback;
