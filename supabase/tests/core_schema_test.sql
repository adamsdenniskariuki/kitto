-- Schema guards that apply to EVERY module, now and in the future:
--   * every table in public has RLS enabled;
--   * every tenant-owned table (has tenant_id) has at least one policy, an
--     index starting with tenant_id, and is not readable by anon;
--   * anon can execute no function in public unless it is on the allow-list.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select is(
  array(
    select c.relname::text
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
    order by 1
  ),
  '{}'::text[],
  'every public table has row level security enabled'
);

select is(
  array(
    select c.relname::text
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
    where n.nspname = 'public' and c.relkind = 'r'
      and not exists (select 1 from pg_policy p where p.polrelid = c.oid)
    order by 1
  ),
  '{}'::text[],
  'every tenant-owned table has at least one RLS policy'
);

select is(
  array(
    select c.relname::text
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
    where n.nspname = 'public' and c.relkind = 'r'
      and not exists (
        select 1 from pg_index i
        where i.indrelid = c.oid and i.indkey[0] = a.attnum
      )
    order by 1
  ),
  '{}'::text[],
  'every tenant_id column leads an index (RLS filters on it)'
);

select is(
  array(
    select c.relname::text
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'v', 'm')
      and has_table_privilege('anon', c.oid, 'select')
    order by 1
  ),
  '{}'::text[],
  'anon cannot select from any public table or view'
);

-- Modules that intentionally expose a function to logged-out visitors (e.g. a
-- public booking page) mark it with a comment starting with "[anon]".
select is(
  array(
    select p.oid::regprocedure::text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and has_function_privilege('anon', p.oid, 'execute')
      and coalesce(obj_description(p.oid, 'pg_proc'), '') not like '[anon]%'
    order by 1
  ),
  '{}'::text[],
  'anon can execute no public function unless it is marked [anon]'
);

select is(
  array(
    select p.oid::regprocedure::text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.prosecdef
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%'
      )
    order by 1
  ),
  '{}'::text[],
  'every SECURITY DEFINER function pins its search_path'
);

select has_table('public', 'tenants', 'tenants table exists');
select has_table('public', 'roles', 'roles table exists');
select has_table('public', 'tenant_members', 'tenant_members table exists');
select has_table('public', 'audit_log', 'audit_log table exists');

select set_eq(
  'select key from private.role_templates',
  array['owner', 'manager', 'front_desk', 'waiter', 'storekeeper', 'sales', 'viewer'],
  'the seven default roles exist as templates'
);

select * from finish();
rollback;
