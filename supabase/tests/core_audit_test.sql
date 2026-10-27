-- Audit log: trigger-based who / what / when / before / after.
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
select tests.login('aaaaaaaa-0000-0000-0000-000000000001', 'owner@kitto.test');
select public.create_tenant('Dealer', 'dealer');
select set_config('tests.t', (select id::text from public.tenants where slug = 'dealer'), true);

select ok(
  exists (select 1 from public.audit_log where tenant_id = current_setting('tests.t')::uuid
          and table_name = 'tenants' and action = 'insert'),
  'creating a tenant is audited'
);

set local role authenticated;
update public.tenants set name = 'Dealer Ltd', currency = 'USD' where slug = 'dealer';
reset role;

select results_eq(
  $$select action, changed, old_data ->> 'name', new_data ->> 'name', actor_id, actor_email
    from public.audit_log
    where table_name = 'tenants' and action = 'update' and tenant_id = current_setting('tests.t')::uuid$$,
  $$values ('update'::text, array['currency', 'name']::text[], 'Dealer'::text, 'Dealer Ltd'::text,
            'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'owner@kitto.test'::text)$$,
  'updates record who, which columns, and before/after values'
);

-- An update that changes nothing is not logged.
set local role authenticated;
update public.tenants set name = 'Dealer Ltd' where slug = 'dealer';
reset role;
select is(
  (select count(*)::int from public.audit_log where table_name = 'tenants' and action = 'update'
     and tenant_id = current_setting('tests.t')::uuid),
  1, 'no-op updates are not logged'
);

-- Members are audited with the user id as record id.
select is(
  (select record_id from public.audit_log where table_name = 'tenant_members' and action = 'insert'
     and tenant_id = current_setting('tests.t')::uuid),
  'aaaaaaaa-0000-0000-0000-000000000001', 'membership changes are audited by user id'
);

-- History is append-only for clients.
set local role authenticated;
select ok((select count(*) from public.audit_log) > 0, 'owners can read their audit history');
select throws_ok($$update public.audit_log set actor_email = 'x@kitto.test'$$, '42501', null,
  'clients cannot rewrite history');
select throws_ok($$delete from public.audit_log$$, '42501', null, 'clients cannot delete history');
select throws_ok(
  $$insert into public.audit_log (tenant_id, table_name, record_id, action) values (current_setting('tests.t')::uuid, 'x', 'x', 'insert')$$,
  '42501', null, 'clients cannot forge history');
reset role;

-- enable_audit() is idempotent and works on any table with tenant_id.
create table public.widgets (id uuid primary key default gen_random_uuid(), tenant_id uuid not null, label text);
select lives_ok($$select private.enable_audit('public.widgets')$$, 'enable_audit attaches the trigger');
select lives_ok($$select private.enable_audit('public.widgets')$$, 'enable_audit is idempotent');
insert into public.widgets (tenant_id, label) values (current_setting('tests.t')::uuid, 'w');
delete from public.widgets;
select is(
  (select array_agg(action order by id) from public.audit_log where table_name = 'widgets'),
  array['insert', 'delete'], 'inserts and deletes on audited tables are logged'
);

-- Members without audit.view see nothing.
select tests.create_user('aaaaaaaa-0000-0000-0000-000000000002', 'viewer@kitto.test');
insert into public.tenant_members (tenant_id, user_id, role_id, email)
select current_setting('tests.t')::uuid, 'aaaaaaaa-0000-0000-0000-000000000002', id, 'viewer@kitto.test'
from public.roles where tenant_id = current_setting('tests.t')::uuid and key = 'viewer';
select tests.login('aaaaaaaa-0000-0000-0000-000000000002', 'viewer@kitto.test');
set local role authenticated;
select is((select count(*)::int from public.audit_log), 0, 'viewers cannot read audit history');
reset role;

select * from finish();
rollback;
