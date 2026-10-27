-- Inventory concurrency: two sessions selling the last unit at the same time.
--
-- Uses dblink to open real, separate database sessions, so the data they use
-- must be committed. It lives in a throwaway tenant that is deleted at the
-- end. Session A takes the last bottle and holds its transaction open;
-- session B tries the same and must WAIT on the stock_levels row lock, then
-- fail once A commits, because it re-reads the level A left behind.
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
select no_plan();

-- Connect back to this server over the network (local connections are not
-- password-authenticated, which dblink refuses for non-superusers).
select set_config('tests.conn', format('host=%s port=%s dbname=%s user=postgres password=postgres',
  host(inet_server_addr()), inet_server_port(), current_database()), true);
select set_config('tests.slug', 'inv-race-' || substr(md5(random()::text), 1, 8), true);

select extensions.dblink_connect('setup', current_setting('tests.conn'));
select extensions.dblink_connect('a', current_setting('tests.conn'));
select extensions.dblink_connect('b', current_setting('tests.conn'));

select extensions.dblink_exec('setup', format($sql$
  insert into public.tenants (name, slug) values ('Race', %L);
  insert into public.items (tenant_id, name)
    select id, 'Last bottle' from public.tenants where slug = %L;
  insert into public.stock_movements (tenant_id, item_id, location_id, kind, quantity, reason)
    select t.id, i.id, l.id, 'adjustment', 1, 'Opening stock'
    from public.tenants t
    join public.items i on i.tenant_id = t.id
    join public.stock_locations l on l.tenant_id = t.id and l.is_default
    where t.slug = %L;
$sql$, current_setting('tests.slug'), current_setting('tests.slug'), current_setting('tests.slug')));

select set_config('tests.sell', format($sql$
  insert into public.stock_movements (tenant_id, item_id, location_id, kind, quantity)
  select t.id, i.id, l.id, 'sale', -1
  from public.tenants t
  join public.items i on i.tenant_id = t.id
  join public.stock_locations l on l.tenant_id = t.id and l.is_default
  where t.slug = %L
$sql$, current_setting('tests.slug')), true);

select is(
  (select s.quantity from public.stock_levels s join public.tenants t on t.id = s.tenant_id
   where t.slug = current_setting('tests.slug')),
  1.000::numeric, 'one bottle in stock'
);

-- A sells it and keeps its transaction open.
select extensions.dblink_exec('a', 'begin');
select extensions.dblink_exec('a', current_setting('tests.sell'));

-- B tries to sell it too, asynchronously.
select extensions.dblink_send_query('b', current_setting('tests.sell'));
select pg_sleep(0.5);
select is(extensions.dblink_is_busy('b'), 1, 'the second sale waits for the first (row lock on the level)');

select extensions.dblink_exec('a', 'commit');
select * from extensions.dblink_get_result('b', false) as r(status text);
select matches(
  extensions.dblink_error_message('b'),
  'Not enough Last bottle in stock',
  'once the first commits, the second sees no stock left and is refused'
);
select * from extensions.dblink_get_result('b', false) as r(status text);

select is(
  (select s.quantity from public.stock_levels s join public.tenants t on t.id = s.tenant_id
   where t.slug = current_setting('tests.slug')),
  0.000::numeric, 'the bottle was sold once and stock never went negative'
);
select is(
  (select count(*)::int from public.stock_movements m join public.tenants t on t.id = m.tenant_id
   where t.slug = current_setting('tests.slug') and m.kind = 'sale'),
  1, 'only one sale was recorded'
);

-- Clean up the committed data.
select extensions.dblink_exec('setup', format('delete from public.tenants where slug = %L',
  current_setting('tests.slug')));
select is(
  (select count(*)::int from public.tenants where slug = current_setting('tests.slug')),
  0, 'the throwaway tenant is gone'
);
select extensions.dblink_disconnect('a');
select extensions.dblink_disconnect('b');
select extensions.dblink_disconnect('setup');

select * from finish();
rollback;
