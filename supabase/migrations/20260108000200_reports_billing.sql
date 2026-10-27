-- =============================================================================
-- reports 0002 Billing reports: revenue over time, payments by method and
-- receivables ageing. Depends on the billing module (invoices, payments).
-- =============================================================================

-- Invoiced (by issue date) and collected (by local day the payment arrived)
-- per day or ISO week (buckets start on Monday). Every bucket in the period
-- appears, with zeros when nothing happened.
create function public.report_revenue(
  p_tenant_id uuid,
  p_from      date,
  p_to        date,
  p_bucket    text default 'day'
)
returns table (bucket date, invoiced_minor bigint, paid_minor bigint)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_timezone text := private.report_guard(p_tenant_id, 'billing.view', p_from, p_to);
  v_period   tstzrange := private.report_period(p_from, p_to, v_timezone);
  v_week     boolean := p_bucket = 'week';
begin
  if p_bucket not in ('day', 'week') then
    raise exception 'Unknown report bucket %', p_bucket using errcode = '22023';
  end if;
  return query
  with buckets as (
    select b::date as bucket
    from generate_series(
      case when v_week then date_trunc('week', p_from::timestamp) else p_from::timestamp end,
      p_to::timestamp,
      case when v_week then interval '1 week' else interval '1 day' end) as b
  ),
  invoiced as (
    select case when v_week then date_trunc('week', i.issue_date::timestamp)::date else i.issue_date end as bucket,
           sum(i.total_minor) as amount
    from public.invoices i
    where i.tenant_id = p_tenant_id
      and i.kind = 'invoice'
      and i.status not in ('draft', 'void')
      and i.issue_date between p_from and p_to
    group by 1
  ),
  paid as (
    select case when v_week then date_trunc('week', p.received_at at time zone v_timezone)::date
                else (p.received_at at time zone v_timezone)::date end as bucket,
           sum(p.amount_minor) as amount
    from public.payments p
    where p.tenant_id = p_tenant_id
      and p.received_at <@ v_period
    group by 1
  )
  select b.bucket, coalesce(i.amount, 0)::bigint, coalesce(pd.amount, 0)::bigint
  from buckets b
  left join invoiced i on i.bucket = b.bucket
  left join paid pd on pd.bucket = b.bucket
  order by b.bucket;
end;
$$;
comment on function public.report_revenue(uuid, date, date, text) is
  'Invoiced and collected amounts per day or week of the period (needs reports.view and billing.view).';

-- Payments received in the period per method, every method listed (M-Pesa first).
create function public.report_payment_methods(p_tenant_id uuid, p_from date, p_to date)
returns table (method text, payments integer, amount_minor bigint)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_timezone text := private.report_guard(p_tenant_id, 'billing.view', p_from, p_to);
  v_period   tstzrange := private.report_period(p_from, p_to, v_timezone);
begin
  return query
  select m.method, count(p.id)::integer, coalesce(sum(p.amount_minor), 0)::bigint
  from (values ('mpesa', 1), ('cash', 2), ('card', 3), ('bank', 4), ('other', 5)) as m (method, position)
  left join public.payments p
    on p.method = m.method and p.tenant_id = p_tenant_id and p.received_at <@ v_period
  group by m.method, m.position
  order by m.position;
end;
$$;
comment on function public.report_payment_methods(uuid, date, date) is
  'Count and total of payments per method in the period (needs reports.view and billing.view).';

-- What customers still owe on issued invoices, by how overdue it is on
-- p_as_of (default: today in the tenant's time zone). Invoices without a due
-- date count as current.
create function public.report_receivables_aging(p_tenant_id uuid, p_as_of date default null)
returns table (bucket text, invoices integer, outstanding_minor bigint)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_timezone text := private.report_guard(p_tenant_id, 'billing.view');
  v_as_of    date := coalesce(p_as_of, (now() at time zone v_timezone)::date);
begin
  return query
  with open_invoices as (
    select i.total_minor - i.paid_minor as due,
           case when i.due_date is null then 0 else v_as_of - i.due_date end as days_overdue
    from public.invoices i
    where i.tenant_id = p_tenant_id
      and i.kind = 'invoice'
      and i.status in ('issued', 'partially_paid')
      and i.issue_date <= v_as_of
  )
  select b.bucket, count(o.due)::integer, coalesce(sum(o.due), 0)::bigint
  from (values ('current', 1, -2147483648, 0), ('1_30', 2, 1, 30), ('31_60', 3, 31, 60),
               ('61_90', 4, 61, 90), ('over_90', 5, 91, 2147483647)) as b (bucket, position, lo, hi)
  left join open_invoices o on o.days_overdue between b.lo and b.hi
  group by b.bucket, b.position
  order by b.position;
end;
$$;
comment on function public.report_receivables_aging(uuid, date) is
  'Outstanding invoice balances bucketed by days overdue (needs reports.view and billing.view).';

revoke all on function public.report_revenue(uuid, date, date, text) from public, anon, authenticated;
revoke all on function public.report_payment_methods(uuid, date, date) from public, anon, authenticated;
revoke all on function public.report_receivables_aging(uuid, date) from public, anon, authenticated;
grant execute on function public.report_revenue(uuid, date, date, text) to authenticated, service_role;
grant execute on function public.report_payment_methods(uuid, date, date) to authenticated, service_role;
grant execute on function public.report_receivables_aging(uuid, date) to authenticated, service_role;
