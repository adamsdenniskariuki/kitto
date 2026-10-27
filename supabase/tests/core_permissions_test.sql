-- Roles & permissions: defaults, custom roles, no privilege escalation, and
-- owners can never lock themselves out.
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

select tests.create_user('aaaaaaaa-0000-0000-0000-000000000001', 'owner@kitto.test');
select tests.create_user('aaaaaaaa-0000-0000-0000-000000000002', 'manager@kitto.test');
select tests.create_user('aaaaaaaa-0000-0000-0000-000000000003', 'viewer@kitto.test');
select tests.create_user('aaaaaaaa-0000-0000-0000-000000000004', 'owner2@kitto.test');

select tests.login('aaaaaaaa-0000-0000-0000-000000000001', 'owner@kitto.test');
select public.create_tenant('Hotel', 'hotel');
select set_config('tests.t', (select id::text from public.tenants where slug = 'hotel'), true);
create or replace function tests.role_id(p_key text) returns uuid language sql as $$
  select id from public.roles where tenant_id = current_setting('tests.t')::uuid and key = p_key;
$$;
grant execute on function tests.role_id(text) to authenticated;

-- Invitations (owner invites a manager and a viewer).
set local role authenticated;
select lives_ok(
  $$insert into public.invitations (tenant_id, email, role_id)
    values (current_setting('tests.t')::uuid, ' Manager@Kitto.test ', tests.role_id('manager'))$$,
  'owner invites a manager'
);
select lives_ok(
  $$insert into public.invitations (tenant_id, email, role_id)
    values (current_setting('tests.t')::uuid, 'viewer@kitto.test', tests.role_id('viewer'))$$,
  'owner invites a viewer'
);
reset role;
select is((select email from public.invitations where role_id = tests.role_id('manager')),
  'manager@kitto.test', 'invitation emails are normalised');

select tests.login('aaaaaaaa-0000-0000-0000-000000000003', 'viewer@kitto.test');
select throws_ok(
  format('select public.accept_invitation(%L)', (select token from public.invitations where email = 'manager@kitto.test')),
  '42501', null, 'an invitation cannot be accepted by a different email'
);
select is(
  public.accept_invitation((select token from public.invitations where email = 'viewer@kitto.test')),
  current_setting('tests.t')::uuid, 'the viewer accepts their invitation'
);
select throws_ok(
  format('select public.accept_invitation(%L)', (select token from public.invitations where email = 'viewer@kitto.test')),
  'P0002', null, 'an invitation works only once'
);
select tests.login('aaaaaaaa-0000-0000-0000-000000000002', 'manager@kitto.test');
select lives_ok(
  format('select public.accept_invitation(%L)', (select token from public.invitations where email = 'manager@kitto.test')),
  'the manager accepts their invitation'
);

-- Expired invitation.
insert into public.invitations (tenant_id, email, role_id, expires_at)
values (current_setting('tests.t')::uuid, 'late@kitto.test', tests.role_id('viewer'), now() - interval '1 minute');
select tests.create_user('aaaaaaaa-0000-0000-0000-000000000005', 'late@kitto.test');
select tests.login('aaaaaaaa-0000-0000-0000-000000000005', 'late@kitto.test');
select throws_ok(
  format('select public.accept_invitation(%L)', (select token from public.invitations where email = 'late@kitto.test')),
  'P0002', null, 'expired invitations are rejected'
);

-- ---------------------------------------------------------------------------
-- Default permissions.
-- ---------------------------------------------------------------------------
select tests.login('aaaaaaaa-0000-0000-0000-000000000003', 'viewer@kitto.test');
set local role authenticated;
select is(public.has_permission(current_setting('tests.t')::uuid, 'members.manage'), false, 'viewer cannot manage members');
select is((select count(*)::int from public.tenant_members), 3, 'viewers see their colleagues');
select is((select count(*)::int from public.invitations), 0, 'viewers cannot read invitations');
select is((select count(*)::int from public.audit_log), 0, 'viewers cannot read the audit log');
select throws_ok(
  $$insert into public.roles (tenant_id, key, name) values (current_setting('tests.t')::uuid, 'x_role', 'X')$$,
  '42501', null, 'viewers cannot create roles'
);
reset role;

select tests.login('aaaaaaaa-0000-0000-0000-000000000002', 'manager@kitto.test');
set local role authenticated;
select is(public.has_permission(current_setting('tests.t')::uuid, 'members.manage'), true, 'manager can manage members');
select is(public.has_permission(current_setting('tests.t')::uuid, 'roles.manage'), false, 'manager cannot manage roles by default');
select ok('audit.view' in (select public.my_permissions(current_setting('tests.t')::uuid)), 'my_permissions lists granted keys');
select ok((select count(*) from public.audit_log) > 0, 'manager can read the audit log');
reset role;

select tests.login('aaaaaaaa-0000-0000-0000-000000000001', 'owner@kitto.test');
select is(
  (select count(*)::int from public.my_permissions(current_setting('tests.t')::uuid)),
  (select count(*)::int from public.permissions),
  'owners implicitly hold every permission'
);

-- ---------------------------------------------------------------------------
-- Custom roles.
-- ---------------------------------------------------------------------------
set local role authenticated;
select lives_ok(
  $$insert into public.roles (tenant_id, key, name, description)
    values (current_setting('tests.t')::uuid, 'night_auditor', 'Night auditor', 'Reads the audit log')$$,
  'owners create custom roles'
);
select lives_ok(
  $$insert into public.role_permissions (tenant_id, role_id, permission_key)
    values (current_setting('tests.t')::uuid, tests.role_id('night_auditor'), 'audit.view')$$,
  'owners grant permissions to custom roles'
);
select throws_ok(
  $$insert into public.role_permissions (tenant_id, role_id, permission_key)
    values (current_setting('tests.t')::uuid, tests.role_id('owner'), 'audit.view')$$,
  '42501', null, 'the owner role permissions are implicit and not editable'
);
delete from public.roles where key = 'viewer';
select is((select count(*)::int from public.roles where key = 'viewer'), 1, 'system roles cannot be deleted');
select throws_ok(
  $$update public.roles set key = 'boss' where key = 'manager'$$,
  '42501', null, 'system role keys are not client-writable'
);
reset role;

-- Register a new permission later (as a module migration would): existing
-- tenants' system roles are back-filled.
select private.register_permission('demo.do', 'demo', 'Demo permission', array['manager', 'viewer']);
select ok(
  exists (select 1 from public.role_permissions where role_id = tests.role_id('viewer') and permission_key = 'demo.do'),
  'register_permission back-fills existing system roles'
);
select ok(
  not exists (select 1 from public.role_permissions where role_id = tests.role_id('night_auditor') and permission_key = 'demo.do'),
  'custom roles are left alone'
);

-- ---------------------------------------------------------------------------
-- No privilege escalation by managers.
-- ---------------------------------------------------------------------------
select tests.login('aaaaaaaa-0000-0000-0000-000000000001', 'owner@kitto.test');
set local role authenticated;
insert into public.roles (tenant_id, key, name) values (current_setting('tests.t')::uuid, 'admin_like', 'Admin-like');
insert into public.role_permissions (tenant_id, role_id, permission_key)
values (current_setting('tests.t')::uuid, tests.role_id('admin_like'), 'roles.manage');
reset role;

select tests.login('aaaaaaaa-0000-0000-0000-000000000002', 'manager@kitto.test');
set local role authenticated;
select throws_ok(
  $$update public.tenant_members set role_id = tests.role_id('admin_like') where user_id = auth.uid()$$,
  '42501', null, 'a manager cannot give themselves a role with more permissions'
);
select throws_ok(
  $$update public.tenant_members set role_id = tests.role_id('owner') where user_id = auth.uid()$$,
  '42501', null, 'a manager cannot promote themselves to owner'
);
select throws_ok(
  $$update public.tenant_members set status = 'disabled' where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  '42501', null, 'a manager cannot disable an owner'
);
select throws_ok(
  $$insert into public.invitations (tenant_id, email, role_id)
    values (current_setting('tests.t')::uuid, 'friend@kitto.test', tests.role_id('owner'))$$,
  '42501', null, 'a manager cannot invite an owner'
);
select lives_ok(
  $$update public.tenant_members set role_id = tests.role_id('front_desk')
    where user_id = 'aaaaaaaa-0000-0000-0000-000000000003'$$,
  'a manager can move a viewer to front desk'
);
select throws_ok(
  $$insert into public.role_permissions (tenant_id, role_id, permission_key)
    values (current_setting('tests.t')::uuid, tests.role_id('viewer'), 'roles.manage')$$,
  '42501', null, 'without roles.manage, role permissions cannot be edited'
);
reset role;

-- ---------------------------------------------------------------------------
-- Owners cannot lock themselves out.
-- ---------------------------------------------------------------------------
select tests.login('aaaaaaaa-0000-0000-0000-000000000001', 'owner@kitto.test');
set local role authenticated;
select throws_ok(
  $$delete from public.tenant_members where user_id = auth.uid()$$,
  '23514', null, 'the last owner cannot leave'
);
select throws_ok(
  $$update public.tenant_members set role_id = tests.role_id('manager') where user_id = auth.uid()$$,
  '23514', null, 'the last owner cannot demote themselves'
);
select throws_ok(
  $$update public.tenant_members set status = 'disabled' where user_id = auth.uid()$$,
  '23514', null, 'the last owner cannot disable themselves'
);
select lives_ok(
  $$update public.tenant_members set role_id = tests.role_id('owner')
    where user_id = 'aaaaaaaa-0000-0000-0000-000000000002'$$,
  'an owner promotes the manager to owner'
);
select lives_ok(
  $$delete from public.tenant_members where user_id = auth.uid()$$,
  'with a second owner, the first can leave'
);
reset role;

select is(
  (select count(*)::int from public.tenant_members m join public.roles r on r.id = m.role_id
   where m.tenant_id = current_setting('tests.t')::uuid and r.key = 'owner'),
  1, 'exactly one owner remains'
);

-- Deleting the whole tenant cascades without tripping the owner guard.
select lives_ok($$delete from public.tenants where slug = 'hotel'$$, 'a tenant can be deleted (service role)');

select * from finish();
rollback;
