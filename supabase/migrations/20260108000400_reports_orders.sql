-- =============================================================================
-- reports 0004 Orders reports: top items sold. Depends on the orders module
-- (orders, order_lines) and inventory (items, for names).
-- =============================================================================

-- Best sellers by revenue among orders sent to the kitchen/bar/store in the
-- period (sent, fulfilled or paid; open and cancelled orders don't count).
-- Free-text lines without an item are grouped by their description.
create function public.report_top_items(p_tenant_id uuid, p_from date, p_to date, p_limit integer default 10)
returns table (item_id uuid, name text, quantity numeric, revenue_minor bigint)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_timezone text := private.report_guard(p_tenant_id, 'orders.view', p_from, p_to);
  v_period   tstzrange := private.report_period(p_from, p_to, v_timezone);
begin
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'A top-items limit is between 1 and 100' using errcode = '22023';
  end if;
  return query
  select l.item_id,
         coalesce(min(i.name), min(btrim(l.description))),
         sum(l.quantity)::numeric,
         sum(l.line_total_minor)::bigint
  from public.order_lines l
  join public.orders o on o.id = l.order_id
  left join public.items i on i.id = l.item_id
  where o.tenant_id = p_tenant_id
    and o.status in ('sent', 'fulfilled', 'paid')
    and coalesce(o.sent_at, o.created_at) <@ v_period
  group by l.item_id, case when l.item_id is null then lower(btrim(l.description)) end
  order by 4 desc, 3 desc, 2
  limit p_limit;
end;
$$;
comment on function public.report_top_items(uuid, date, date, integer) is
  'Items with the most sales in the period (needs reports.view and orders.view).';

revoke all on function public.report_top_items(uuid, date, date, integer) from public, anon, authenticated;
grant execute on function public.report_top_items(uuid, date, date, integer) to authenticated, service_role;
