-- =============================================================================
-- inventory 0002 Moving stock: receive a purchase, adjust a count, transfer
-- between locations. Each runs in one transaction, checks the caller's
-- permission and writes the ledger; stock_levels follows by trigger and
-- refuses to go negative unless the item allows it.
-- =============================================================================

create function public.receive_purchase(p_purchase_id uuid, p_update_costs boolean default true)
returns public.purchases
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_purchase public.purchases;
begin
  select * into v_purchase from public.purchases where id = p_purchase_id for update;
  if not found then
    raise exception 'Purchase not found' using errcode = 'P0002';
  end if;
  perform private.assert_permission(v_purchase.tenant_id, 'inventory.purchase');
  if v_purchase.status <> 'draft' then
    raise exception 'This purchase has already been received' using errcode = '22023';
  end if;
  if not exists (select 1 from public.purchase_lines l where l.purchase_id = v_purchase.id) then
    raise exception 'A purchase needs at least one line' using errcode = '22023';
  end if;

  perform private.lock_stock_levels(v_purchase.tenant_id, (
    select jsonb_agg(jsonb_build_object('item_id', l.item_id, 'location_id', v_purchase.location_id))
    from public.purchase_lines l where l.purchase_id = v_purchase.id
  ));

  insert into public.stock_movements
    (tenant_id, item_id, location_id, kind, quantity, unit_cost_minor, source_type, source_id)
  select v_purchase.tenant_id, l.item_id, v_purchase.location_id, 'purchase', l.quantity, l.unit_cost_minor,
         'purchase', v_purchase.id
  from public.purchase_lines l
  where l.purchase_id = v_purchase.id
  order by l.item_id, l.position;

  if p_update_costs then
    update public.items i
    set cost_minor = c.unit_cost_minor
    from (
      select distinct on (l.item_id) l.item_id, l.unit_cost_minor
      from public.purchase_lines l
      where l.purchase_id = v_purchase.id
      order by l.item_id, l.position desc
    ) c
    where i.id = c.item_id and i.cost_minor is distinct from c.unit_cost_minor;
  end if;

  update public.purchases
  set status = 'received', received_at = now(), received_by = auth.uid()
  where id = v_purchase.id
  returning * into v_purchase;
  return v_purchase;
end;
$$;
revoke all on function public.receive_purchase(uuid, boolean) from public, anon, authenticated;
grant execute on function public.receive_purchase(uuid, boolean) to authenticated, service_role;
comment on function public.receive_purchase(uuid, boolean) is
  'Book a draft purchase into stock at its location (one purchase movement per line) and optionally update item costs.';

-- ---------------------------------------------------------------------------
create function public.adjust_stock(
  p_tenant_id    uuid,
  p_item_id      uuid,
  p_location_id  uuid,
  p_quantity     numeric,
  p_reason       text
)
returns public.stock_movements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_movement public.stock_movements;
begin
  perform private.assert_permission(p_tenant_id, 'inventory.adjust');
  if p_quantity is null or p_quantity = 0 then
    raise exception 'Enter a quantity other than zero' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'A reason is required for stock adjustments' using errcode = '22023';
  end if;
  insert into public.stock_movements (tenant_id, item_id, location_id, kind, quantity, reason)
  values (p_tenant_id, p_item_id, p_location_id, 'adjustment', p_quantity, btrim(p_reason))
  returning * into v_movement;
  return v_movement;
end;
$$;
revoke all on function public.adjust_stock(uuid, uuid, uuid, numeric, text) from public, anon, authenticated;
grant execute on function public.adjust_stock(uuid, uuid, uuid, numeric, text) to authenticated, service_role;
comment on function public.adjust_stock(uuid, uuid, uuid, numeric, text) is
  'Add (positive) or remove (negative) stock at a location with a reason, e.g. a count or breakage.';

-- ---------------------------------------------------------------------------
create function public.transfer_stock(
  p_tenant_id  uuid,
  p_item_id    uuid,
  p_from       uuid,
  p_to         uuid,
  p_quantity   numeric,
  p_note       text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_transfer uuid := gen_random_uuid();
begin
  perform private.assert_permission(p_tenant_id, 'inventory.transfer');
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Enter a quantity above zero' using errcode = '22023';
  end if;
  if p_from is null or p_to is null or p_from = p_to then
    raise exception 'Choose two different locations' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.stock_locations l where l.id = p_to and l.tenant_id = p_tenant_id and l.active
  ) then
    raise exception 'Stock can only be moved to an active location' using errcode = '22023';
  end if;

  perform private.lock_stock_levels(p_tenant_id, jsonb_build_array(
    jsonb_build_object('item_id', p_item_id, 'location_id', p_from),
    jsonb_build_object('item_id', p_item_id, 'location_id', p_to)
  ));
  -- Both halves or neither: the second insert never runs if the first fails.
  insert into public.stock_movements (tenant_id, item_id, location_id, kind, quantity, reason, transfer_id)
  values (p_tenant_id, p_item_id, p_from, 'transfer', -p_quantity, btrim(coalesce(p_note, '')), v_transfer),
         (p_tenant_id, p_item_id, p_to, 'transfer', p_quantity, btrim(coalesce(p_note, '')), v_transfer);
  return v_transfer;
end;
$$;
revoke all on function public.transfer_stock(uuid, uuid, uuid, uuid, numeric, text) from public, anon, authenticated;
grant execute on function public.transfer_stock(uuid, uuid, uuid, uuid, numeric, text) to authenticated, service_role;
comment on function public.transfer_stock(uuid, uuid, uuid, uuid, numeric, text) is
  'Move stock between two locations as a pair of transfer movements in one transaction.';
