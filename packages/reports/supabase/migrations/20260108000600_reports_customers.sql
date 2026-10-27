-- =============================================================================
-- reports 0006 Customer reports: new customers per day. Depends on the
-- customers module.
-- =============================================================================

-- Customers added on each local day of the period (archived ones included:
-- they were still new then). Every day appears, with zero when none.
create function public.report_new_customers(p_tenant_id uuid, p_from date, p_to date)
returns table (day date, customers integer)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_timezone text := private.report_guard(p_tenant_id, 'customers.view', p_from, p_to);
  v_period   tstzrange := private.report_period(p_from, p_to, v_timezone);
begin
  return query
  with added as (
    select (c.created_at at time zone v_timezone)::date as day, count(*) as customers
    from public.customers c
    where c.tenant_id = p_tenant_id
      and c.created_at <@ v_period
    group by 1
  )
  select d::date, coalesce(a.customers, 0)::integer
  from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') as d
  left join added a on a.day = d::date
  order by 1;
end;
$$;
comment on function public.report_new_customers(uuid, date, date) is
  'Customers added per day of the period (needs reports.view and customers.view).';

revoke all on function public.report_new_customers(uuid, date, date) from public, anon, authenticated;
grant execute on function public.report_new_customers(uuid, date, date) to authenticated, service_role;
