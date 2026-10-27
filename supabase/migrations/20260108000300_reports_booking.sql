-- =============================================================================
-- reports 0003 Booking reports: utilisation per resource and reservations by
-- status. Depends on the booking module (resources, resource_hours,
-- reservations).
-- =============================================================================

-- For each active resource (and any inactive one booked in the period): how
-- many reservations touch the period, the booked minutes inside it, and the
-- minutes it was available. Availability comes from resource_hours per local
-- weekday; a resource without opening hours is available all day.
-- Cancelled and no-show reservations don't occupy anything.
create function public.report_booking_utilisation(p_tenant_id uuid, p_from date, p_to date)
returns table (
  resource_id       uuid,
  resource_name     text,
  reservations      integer,
  booked_minutes    bigint,
  available_minutes bigint
)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_timezone text := private.report_guard(p_tenant_id, 'booking.view', p_from, p_to);
  v_period   tstzrange := private.report_period(p_from, p_to, v_timezone);
begin
  return query
  with booked as (
    select r.resource_id,
           count(*) as reservations,
           sum(extract(epoch from upper(r.during * v_period) - lower(r.during * v_period)) / 60) as minutes
    from public.reservations r
    where r.tenant_id = p_tenant_id
      and r.during && v_period
      and r.status not in ('cancelled', 'no_show')
    group by r.resource_id
  ),
  days as (
    select d::date as day, extract(dow from d)::smallint as weekday
    from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') as d
  ),
  available as (
    select res.id as resource_id,
           sum(coalesce(
             (select sum(extract(epoch from h.closes - h.opens) / 60)
              from public.resource_hours h
              where h.resource_id = res.id and h.weekday = d.weekday),
             case when exists (select 1 from public.resource_hours h where h.resource_id = res.id)
                  then 0 else 24 * 60 end)) as minutes
    from public.resources res
    cross join days d
    where res.tenant_id = p_tenant_id
    group by res.id
  )
  select res.id, res.name, coalesce(b.reservations, 0)::integer,
         round(coalesce(b.minutes, 0))::bigint, round(coalesce(a.minutes, 0))::bigint
  from public.resources res
  left join booked b on b.resource_id = res.id
  left join available a on a.resource_id = res.id
  where res.tenant_id = p_tenant_id
    and (res.active or b.resource_id is not null)
  order by res.position, res.name;
end;
$$;
comment on function public.report_booking_utilisation(uuid, date, date) is
  'Booked versus available minutes per resource in the period (needs reports.view and booking.view).';

-- Reservations starting in the period, per status (every status listed).
create function public.report_reservation_status(p_tenant_id uuid, p_from date, p_to date)
returns table (status text, reservations integer)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_timezone text := private.report_guard(p_tenant_id, 'booking.view', p_from, p_to);
  v_period   tstzrange := private.report_period(p_from, p_to, v_timezone);
begin
  return query
  select s.status, count(r.id)::integer
  from (values ('tentative', 1), ('confirmed', 2), ('checked_in', 3), ('completed', 4),
               ('cancelled', 5), ('no_show', 6)) as s (status, position)
  left join public.reservations r
    on r.status = s.status and r.tenant_id = p_tenant_id and r.starts_at <@ v_period
  group by s.status, s.position
  order by s.position;
end;
$$;
comment on function public.report_reservation_status(uuid, date, date) is
  'Reservations starting in the period per status (needs reports.view and booking.view).';

revoke all on function public.report_booking_utilisation(uuid, date, date) from public, anon, authenticated;
revoke all on function public.report_reservation_status(uuid, date, date) from public, anon, authenticated;
grant execute on function public.report_booking_utilisation(uuid, date, date) to authenticated, service_role;
grant execute on function public.report_reservation_status(uuid, date, date) to authenticated, service_role;
