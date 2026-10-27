-- =============================================================================
-- booking 0002 Booking functions.
--
--   * Local time in, absolute time stored. Staff type wall-clock times
--     ("Friday 19:00"); `timestamp AT TIME ZONE tenant.timezone` turns them
--     into timestamptz. Never convert through the session's time zone.
--   * available_slots: generate_series over each opening window, keeping the
--     candidates that fit inside the free time, computed with multirange
--     arithmetic (PG14+):  free = range_agg(open hours) - range_agg(busy).
--   * available_resources: which rooms / tables / vehicles are free for a
--     whole range, e.g. a 3-night stay for 2 guests.
--   * create_recurring_reservations: WITH RECURSIVE generates the series in
--     local time (so "every Tuesday 10:00" stays at 10:00 across daylight
--     saving) and inserts it in one statement: one clash rolls back all.
--   * Every function is SECURITY INVOKER: the caller's RLS applies, so these
--     are conveniences, never a way around permissions.
-- =============================================================================

create function public.create_reservation(
  p_resource_id   uuid,
  p_starts_local  timestamp,
  p_ends_local    timestamp,
  p_customer_id   uuid default null,
  p_guests        integer default 1,
  p_title         text default '',
  p_notes         text default '',
  p_status        text default 'confirmed'
)
returns public.reservations
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_tz     text;
  v_row    public.reservations;
begin
  select r.tenant_id, t.timezone into v_tenant, v_tz
  from public.resources r
  join public.tenants t on t.id = r.tenant_id
  where r.id = p_resource_id;
  if not found then
    raise exception 'Resource not found' using errcode = 'P0002';
  end if;
  if p_ends_local <= p_starts_local then
    raise exception 'The end must be after the start' using errcode = '22023';
  end if;

  -- If someone else books an overlapping time first, the exclusion
  -- constraint rejects this insert with SQLSTATE 23P01.
  insert into public.reservations
    (tenant_id, resource_id, customer_id, during, guests, title, notes, status)
  values
    (v_tenant, p_resource_id, p_customer_id,
     tstzrange(p_starts_local at time zone v_tz, p_ends_local at time zone v_tz, '[)'),
     coalesce(p_guests, 1), btrim(coalesce(p_title, '')), btrim(coalesce(p_notes, '')),
     coalesce(p_status, 'confirmed'))
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.create_reservation(uuid, timestamp, timestamp, uuid, integer, text, text, text)
  from public, anon, authenticated;
grant execute on function public.create_reservation(uuid, timestamp, timestamp, uuid, integer, text, text, text)
  to authenticated, service_role;
comment on function public.create_reservation(uuid, timestamp, timestamp, uuid, integer, text, text, text) is
  'Reserve a resource between two local (tenant time zone) times. Raises 23P01 if the time is taken.';

-- ---------------------------------------------------------------------------
create function public.available_slots(
  p_resource_id      uuid,
  p_day              date,
  p_duration_minutes integer,
  p_step_minutes     integer default 30
)
returns table (starts_at timestamptz, ends_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  with res as (
    select r.id, t.timezone as tz
    from public.resources r
    join public.tenants t on t.id = r.tenant_id
    where r.id = p_resource_id and r.active
  ),
  dur as (
    select make_interval(mins => greatest(p_duration_minutes, 5)) as d
  ),
  open_windows as (
    select tstzrange((p_day + h.opens) at time zone res.tz,
                     (p_day + h.closes) at time zone res.tz, '[)') as w
    from public.resource_hours h
    join res on res.id = h.resource_id
    where h.weekday = extract(dow from p_day)
    union all
    -- No opening hours at all: open around the clock.
    select tstzrange(p_day::timestamp at time zone res.tz,
                     (p_day + 1)::timestamp at time zone res.tz, '[)')
    from res
    where not exists (select 1 from public.resource_hours h where h.resource_id = res.id)
  ),
  busy as (
    -- A day either side catches reservations spilling across midnight.
    select range_agg(v.during) as r
    from public.reservations v
    join res on res.id = v.resource_id
    where private.reservation_blocks(v.status)
      and v.during && tstzrange((p_day - 1)::timestamp at time zone res.tz,
                                (p_day + 2)::timestamp at time zone res.tz)
  ),
  free as (
    select range_agg(o.w) - coalesce((select r from busy), '{}'::tstzmultirange) as r
    from open_windows o
  )
  select gs, gs + dur.d
  from open_windows o
  cross join dur
  cross join free
  cross join lateral generate_series(lower(o.w), upper(o.w) - dur.d,
                                     make_interval(mins => greatest(p_step_minutes, 5))) as gs
  where tstzrange(gs, gs + dur.d, '[)') <@ free.r
    and gs >= now()
  order by 1;
$$;
revoke all on function public.available_slots(uuid, date, integer, integer) from public, anon, authenticated;
grant execute on function public.available_slots(uuid, date, integer, integer) to authenticated, service_role;
comment on function public.available_slots(uuid, date, integer, integer) is
  'Free start times for one resource on a local date, on a p_step_minutes grid from each opening time.';

-- ---------------------------------------------------------------------------
create function public.available_resources(
  p_tenant_id    uuid,
  p_starts_local timestamp,
  p_ends_local   timestamp,
  p_kind         text default null,
  p_guests       integer default 1
)
returns setof public.resources
language sql
stable
security invoker
set search_path = ''
as $$
  with win as (
    select tstzrange(p_starts_local at time zone t.timezone,
                     p_ends_local at time zone t.timezone, '[)') as r
    from public.tenants t
    where t.id = p_tenant_id and p_ends_local > p_starts_local
  )
  select r.*
  from public.resources r
  cross join win
  where r.tenant_id = p_tenant_id
    and r.active
    and r.capacity >= greatest(coalesce(p_guests, 1), 1)
    and (p_kind is null or r.kind = p_kind)
    and not exists (
      select 1 from public.reservations v
      where v.resource_id = r.id
        and private.reservation_blocks(v.status)
        and v.during && win.r
    )
    -- Resources with opening hours must be open for the whole range.
    and (
      not exists (select 1 from public.resource_hours h where h.resource_id = r.id)
      or exists (
        select 1 from public.resource_hours h
        where h.resource_id = r.id
          and h.weekday = extract(dow from p_starts_local)
          and p_starts_local >= p_starts_local::date + h.opens
          and p_ends_local <= p_starts_local::date + h.closes
      )
    )
  order by r.position, r.name;
$$;
revoke all on function public.available_resources(uuid, timestamp, timestamp, text, integer)
  from public, anon, authenticated;
grant execute on function public.available_resources(uuid, timestamp, timestamp, text, integer)
  to authenticated, service_role;
comment on function public.available_resources(uuid, timestamp, timestamp, text, integer) is
  'Active resources (optionally of one kind, with room for p_guests) that are free for the whole local time range.';

-- ---------------------------------------------------------------------------
create function public.create_recurring_reservations(
  p_resource_id      uuid,
  p_starts_local     timestamp,
  p_duration_minutes integer,
  p_every            interval,
  p_occurrences      integer,
  p_customer_id      uuid default null,
  p_guests           integer default 1,
  p_title            text default '',
  p_notes            text default ''
)
returns setof public.reservations
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_tz     text;
  v_series uuid;
begin
  if p_occurrences is null or p_occurrences not between 2 and 52 then
    raise exception 'A series has between 2 and 52 occurrences' using errcode = '22023';
  end if;
  if p_duration_minutes is null or p_duration_minutes < 5 then
    raise exception 'Reservations last at least 5 minutes' using errcode = '22023';
  end if;

  select r.tenant_id, t.timezone into v_tenant, v_tz
  from public.resources r
  join public.tenants t on t.id = r.tenant_id
  where r.id = p_resource_id;
  if not found then
    raise exception 'Resource not found' using errcode = 'P0002';
  end if;

  insert into public.reservation_series (tenant_id, every, occurrences)
  values (v_tenant, p_every, p_occurrences)
  returning id into v_series;

  with recursive occurrence (n, local_start) as (
    select 1, p_starts_local
    union all
    select o.n + 1, o.local_start + p_every
    from occurrence o
    where o.n < p_occurrences
  )
  insert into public.reservations
    (tenant_id, resource_id, customer_id, series_id, during, guests, title, notes, status)
  select v_tenant, p_resource_id, p_customer_id, v_series,
         tstzrange(o.local_start at time zone v_tz,
                   (o.local_start + make_interval(mins => p_duration_minutes)) at time zone v_tz, '[)'),
         coalesce(p_guests, 1), btrim(coalesce(p_title, '')), btrim(coalesce(p_notes, '')), 'confirmed'
  from occurrence o;

  return query
    select * from public.reservations v
    where v.tenant_id = v_tenant and v.series_id = v_series
    order by v.starts_at;
end;
$$;
revoke all on function public.create_recurring_reservations(uuid, timestamp, integer, interval, integer, uuid, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.create_recurring_reservations(uuid, timestamp, integer, interval, integer, uuid, integer, text, text)
  to authenticated, service_role;
comment on function public.create_recurring_reservations(uuid, timestamp, integer, interval, integer, uuid, integer, text, text) is
  'Book the same resource every p_every (in local time) p_occurrences times, all or nothing.';
