-- =============================================================================
-- billing 0002 Billing functions.
--
--   * save_invoice_draft and draft_invoice_for_source are SECURITY INVOKER:
--     the caller's RLS applies, so they are conveniences that write a draft
--     and its lines in one transaction.
--   * issue_invoice, void_invoice and convert_quote change status, so they
--     are SECURITY DEFINER and check the permission themselves. Each locks
--     the document row first, so double clicks and races serialise.
-- =============================================================================

create function public.save_invoice_draft(
  p_tenant_id    uuid,
  p_invoice_id   uuid,
  p_kind         text,
  p_customer_id  uuid,
  p_due_date     date,
  p_notes        text,
  p_lines        jsonb,
  p_source_type  text default null,
  p_source_id    uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id     uuid := p_invoice_id;
  v_status text;
begin
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'A document needs at least one line' using errcode = '22023';
  end if;
  if jsonb_array_length(p_lines) > 100 then
    raise exception 'A document can have at most 100 lines' using errcode = '22023';
  end if;

  if v_id is null then
    insert into public.invoices (tenant_id, kind, customer_id, due_date, notes, source_type, source_id)
    values (p_tenant_id, coalesce(p_kind, 'invoice'), p_customer_id, p_due_date,
            btrim(coalesce(p_notes, '')), p_source_type, p_source_id)
    returning id into v_id;
  else
    select i.status into v_status from public.invoices i
    where i.id = v_id and i.tenant_id = p_tenant_id;
    if not found then
      raise exception 'Document not found' using errcode = 'P0002';
    end if;
    if v_status <> 'draft' then
      raise exception 'Only drafts can be edited' using errcode = '22023';
    end if;
    update public.invoices
    set customer_id = p_customer_id, due_date = p_due_date, notes = btrim(coalesce(p_notes, ''))
    where id = v_id;
    delete from public.invoice_lines where invoice_id = v_id;
  end if;

  insert into public.invoice_lines
    (tenant_id, invoice_id, position, description, quantity, unit_price_minor, tax_rate_bp)
  select p_tenant_id, v_id, e.ord::integer, btrim(e.value ->> 'description'), (e.value ->> 'quantity')::numeric,
         (e.value ->> 'unit_price_minor')::bigint, coalesce((e.value ->> 'tax_rate_bp')::integer, 0)
  from jsonb_array_elements(p_lines) with ordinality as e(value, ord);

  return v_id;
end;
$$;
revoke all on function public.save_invoice_draft(uuid, uuid, text, uuid, date, text, jsonb, text, uuid)
  from public, anon, authenticated;
grant execute on function public.save_invoice_draft(uuid, uuid, text, uuid, date, text, jsonb, text, uuid)
  to authenticated, service_role;
comment on function public.save_invoice_draft(uuid, uuid, text, uuid, date, text, jsonb, text, uuid) is
  'Create (p_invoice_id null) or replace a draft quote/invoice and its lines. Lines: [{description, quantity, unit_price_minor, tax_rate_bp}].';

-- ---------------------------------------------------------------------------
-- One live invoice per source record: returns the existing draft/issued/paid
-- invoice for (source_type, source_id) or creates a draft from p_lines.
-- ---------------------------------------------------------------------------
create function public.draft_invoice_for_source(
  p_tenant_id    uuid,
  p_source_type  text,
  p_source_id    uuid,
  p_customer_id  uuid,
  p_lines        jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_source_type is null or p_source_id is null then
    raise exception 'A source is required' using errcode = '22023';
  end if;
  -- Serialise concurrent requests for the same source.
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || p_source_type || p_source_id::text, 0));
  select i.id into v_id
  from public.invoices i
  where i.tenant_id = p_tenant_id and i.kind = 'invoice'
    and i.source_type = p_source_type and i.source_id = p_source_id
    and i.status <> 'void'
  order by i.created_at
  limit 1;
  if v_id is not null then
    return v_id;
  end if;
  return public.save_invoice_draft(p_tenant_id, null, 'invoice', p_customer_id, null, '', p_lines,
                                   p_source_type, p_source_id);
end;
$$;
revoke all on function public.draft_invoice_for_source(uuid, text, uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.draft_invoice_for_source(uuid, text, uuid, uuid, jsonb)
  to authenticated, service_role;
comment on function public.draft_invoice_for_source(uuid, text, uuid, uuid, jsonb) is
  'Idempotently start an invoice for a source record (e.g. a reservation); returns the existing non-void one if any.';

-- ---------------------------------------------------------------------------
create function public.issue_invoice(p_invoice_id uuid)
returns public.invoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invoices;
  v_tz  text;
begin
  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'Document not found' using errcode = 'P0002';
  end if;
  perform private.assert_permission(v_inv.tenant_id, 'billing.issue');
  if v_inv.status <> 'draft' then
    raise exception 'Only drafts can be issued' using errcode = '22023';
  end if;
  if not exists (select 1 from public.invoice_lines l where l.invoice_id = v_inv.id) then
    raise exception 'A document needs at least one line' using errcode = '22023';
  end if;
  if v_inv.total_minor <= 0 then
    raise exception 'The total must be above zero to issue' using errcode = '22023';
  end if;

  select t.timezone into v_tz from public.tenants t where t.id = v_inv.tenant_id;
  update public.invoices
  set status     = 'issued',
      number     = private.next_document_number(v_inv.tenant_id, v_inv.kind),
      issue_date = (now() at time zone v_tz)::date,
      due_date   = coalesce(v_inv.due_date, (now() at time zone v_tz)::date + 14),
      issued_at  = now()
  where id = v_inv.id
  returning * into v_inv;
  return v_inv;
end;
$$;
revoke all on function public.issue_invoice(uuid) from public, anon, authenticated;
grant execute on function public.issue_invoice(uuid) to authenticated, service_role;
comment on function public.issue_invoice(uuid) is
  'Issue a draft: assigns the next gapless number for its kind, the issue date and a default due date (+14 days).';

-- ---------------------------------------------------------------------------
create function public.void_invoice(p_invoice_id uuid, p_reason text)
returns public.invoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invoices;
begin
  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'Document not found' using errcode = 'P0002';
  end if;
  perform private.assert_permission(v_inv.tenant_id, 'billing.void');
  if v_inv.status <> 'issued' or v_inv.paid_minor > 0 then
    raise exception 'Only issued documents without payments can be voided' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 1 and 500 then
    raise exception 'A reason is required to void' using errcode = '22023';
  end if;
  update public.invoices
  set status = 'void', voided_at = now(), void_reason = btrim(p_reason)
  where id = v_inv.id
  returning * into v_inv;
  return v_inv;
end;
$$;
revoke all on function public.void_invoice(uuid, text) from public, anon, authenticated;
grant execute on function public.void_invoice(uuid, text) to authenticated, service_role;
comment on function public.void_invoice(uuid, text) is
  'Void an issued quote or an issued invoice with no payments. The number stays used (gapless history).';

-- ---------------------------------------------------------------------------
create function public.convert_quote(p_quote_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote public.invoices;
  v_id    uuid;
begin
  select * into v_quote from public.invoices where id = p_quote_id for update;
  if not found then
    raise exception 'Document not found' using errcode = 'P0002';
  end if;
  perform private.assert_permission(v_quote.tenant_id, 'billing.issue');
  if v_quote.kind <> 'quote' or v_quote.status <> 'issued' then
    raise exception 'Only issued quotes can be converted' using errcode = '22023';
  end if;

  update public.invoices set status = 'accepted' where id = v_quote.id;

  insert into public.invoices
    (tenant_id, kind, customer_id, quote_id, source_type, source_id, notes, created_by)
  values
    (v_quote.tenant_id, 'invoice', v_quote.customer_id, v_quote.id, v_quote.source_type,
     v_quote.source_id, v_quote.notes, auth.uid())
  returning id into v_id;

  insert into public.invoice_lines
    (tenant_id, invoice_id, position, description, quantity, unit_price_minor, tax_rate_bp)
  select l.tenant_id, v_id, l.position, l.description, l.quantity, l.unit_price_minor, l.tax_rate_bp
  from public.invoice_lines l
  where l.invoice_id = v_quote.id
  order by l.position;

  return v_id;
end;
$$;
revoke all on function public.convert_quote(uuid) from public, anon, authenticated;
grant execute on function public.convert_quote(uuid) to authenticated, service_role;
comment on function public.convert_quote(uuid) is
  'Mark an issued quote accepted and copy it into a new draft invoice; returns the invoice id.';
