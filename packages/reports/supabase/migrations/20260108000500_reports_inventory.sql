-- =============================================================================
-- reports 0005 Inventory reports: stock value and low-stock count. Depends on
-- the inventory module (items, item_stock).
-- =============================================================================

-- Right now: active stock-tracked items, what their stock on hand cost
-- (on hand x unit cost; items without a cost count as zero, negative stock as
-- none) and how many are at or below their reorder level.
create function public.report_stock_summary(p_tenant_id uuid)
returns table (items integer, stock_value_minor bigint, low_items integer, uncosted_items integer)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.report_guard(p_tenant_id, 'inventory.view');
  return query
  select count(*)::integer,
         coalesce(round(sum(greatest(s.on_hand, 0) * coalesce(i.cost_minor, 0))), 0)::bigint,
         count(*) filter (where s.low)::integer,
         count(*) filter (where i.cost_minor is null and s.on_hand > 0)::integer
  from public.item_stock s
  join public.items i on i.id = s.item_id
  where s.tenant_id = p_tenant_id
    and s.track_stock
    and s.active;
end;
$$;
comment on function public.report_stock_summary(uuid) is
  'Stock value at cost and low-stock count (needs reports.view and inventory.view).';

revoke all on function public.report_stock_summary(uuid) from public, anon, authenticated;
grant execute on function public.report_stock_summary(uuid) to authenticated, service_role;
