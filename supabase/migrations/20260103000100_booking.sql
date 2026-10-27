-- =============================================================================
-- booking 0001 Bookable resources and reservations.
--
-- One generic model covers very different businesses:
--     hotel        resource kind 'room'    rate per night, stays across days
--     restaurant   resource kind 'table'   capacity = seats, slots per evening
--     dealership   resource kind 'vehicle' test drives by the hour
-- App-specific details (room type, bed size, VIN) go in resources.attributes.
--
--   * The double-booking guard is an EXCLUSION CONSTRAINT: no two blocking
--     reservations of the same resource may have overlapping time ranges.
--     Postgres checks it atomically, so two staff clicking "book" at the same
--     instant cannot both win (the second gets SQLSTATE 23P01). btree_gist
--     (enabled by core) lets one GiST index combine "=" on uuid with "&&".
--   * Ranges are '[)' (start included, end excluded): 10:00-11:00 and
--     11:00-12:00 do not overlap, and a 10:00 checkout frees the room for a
--     14:00 check-in the same day.
--   * Statuses move along a fixed path, enforced by a trigger:
--         tentative -> confirmed -> checked_in -> completed
--         tentative/confirmed -> cancelled,  confirmed -> no_show
--     Cancelled and no-show reservations stop blocking the resource.
--   * Price is computed by the database from the resource's rate when a
--     reservation is created or moved; clients cannot set it.
-- =============================================================================

create table public.resources (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete cascade,
  kind         text not null default 'resource' check (kind ~ '^[a-z][a-z0-9_]{0,39}$'),
  name         text not null check (char_length(btrim(name)) between 1 and 120),
  description  text not null default '' check (char_length(description) <= 1000),
  capacity     integer not null default 1 check (capacity between 1 and 10000),
  rate_minor   bigint not null default 0 check (rate_minor >= 0),
  rate_unit    text not null default 'booking' check (rate_unit in ('booking', 'hour', 'day', 'night')),
  attributes   jsonb not null default '{}' check (jsonb_typeof(attributes) = 'object'),
  active       boolean not null default true,
  position     integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, id)
);
create unique index resources_tenant_name_idx on public.resources (tenant_id, lower(name));
create index resources_tenant_kind_idx on public.resources (tenant_id, kind, position);
create trigger resources_updated_at before update on public.resources
  for each row execute function private.set_updated_at();
create trigger resources_tenant_immutable before update of tenant_id on public.resources
  for each row execute function private.prevent_tenant_change();

comment on table public.resources is
  'Anything that can be reserved: rooms, tables, vehicles, bays, people. App-specific fields live in attributes.';

-- Weekly opening hours in the tenant's local (wall-clock) time. A resource
-- with no rows is open around the clock (hotel rooms). To open past
-- midnight, add a second row for the next weekday starting at 00:00.
create table public.resource_hours (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null,
  resource_id  uuid not null,
  weekday      smallint not null check (weekday between 0 and 6), -- 0 = Sunday, as extract(dow)
  opens        time not null,
  closes       time not null,
  check (closes > opens),
  unique (resource_id, weekday, opens),
  foreign key (tenant_id, resource_id) references public.resources (tenant_id, id) on delete cascade
);
create index resource_hours_tenant_idx on public.resource_hours (tenant_id, resource_id);

create table public.reservation_series (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete cascade,
  every        interval not null check (every >= interval '15 minutes'),
  occurrences  integer not null check (occurrences between 2 and 52),
  created_by   uuid default auth.uid() references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (tenant_id, id)
);

-- Which statuses hold the resource. Used by the exclusion constraint, so it
-- must be IMMUTABLE, and by every availability query, so they all agree.
create function private.reservation_blocks(p_status text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_status in ('tentative', 'confirmed', 'checked_in', 'completed');
$$;
revoke all on function private.reservation_blocks(text) from public, anon, authenticated;
grant execute on function private.reservation_blocks(text) to authenticated, service_role;

create table public.reservations (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants (id) on delete cascade,
  resource_id    uuid not null,
  customer_id    uuid,
  series_id      uuid,
  during         tstzrange not null,
  -- Generated copies of the range bounds: easy to sort, filter and index.
  starts_at      timestamptz generated always as (lower(during)) stored,
  ends_at        timestamptz generated always as (upper(during)) stored,
  status         text not null default 'confirmed'
                 check (status in ('tentative', 'confirmed', 'checked_in', 'completed', 'cancelled', 'no_show')),
  guests         integer not null default 1 check (guests between 1 and 10000),
  title          text not null default '' check (char_length(title) <= 200),
  notes          text not null default '' check (char_length(notes) <= 2000),
  price_minor    bigint not null default 0 check (price_minor >= 0),
  source         text not null default 'staff' check (source ~ '^[a-z][a-z0-9_]{0,39}$'),
  checked_in_at  timestamptz,
  completed_at   timestamptz,
  cancelled_at   timestamptz,
  created_by     uuid default auth.uid() references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint reservations_during_valid check (
    not isempty(during)
    and lower_inc(during) and not upper_inc(during)
    and not lower_inf(during) and not upper_inf(during)
  ),
  -- THE double-booking guard.
  constraint reservations_no_overlap exclude using gist (
    resource_id with =,
    during      with &&
  ) where (private.reservation_blocks(status)),

  -- Composite keys: a reservation can only point at rows of its own tenant.
  -- No cascade: resources and customers with history are archived, not deleted.
  foreign key (tenant_id, resource_id) references public.resources (tenant_id, id),
  foreign key (tenant_id, customer_id) references public.customers (tenant_id, id),
  foreign key (tenant_id, series_id)   references public.reservation_series (tenant_id, id),
  unique (tenant_id, id)
);
-- Calendar queries: "reservations of tenant X overlapping this week".
create index reservations_tenant_during_idx on public.reservations using gist (tenant_id, during);
create index reservations_tenant_starts_idx on public.reservations (tenant_id, starts_at);
create index reservations_tenant_customer_idx on public.reservations (tenant_id, customer_id)
  where customer_id is not null;

create trigger reservations_updated_at before update on public.reservations
  for each row execute function private.set_updated_at();
create trigger reservations_tenant_immutable before update of tenant_id on public.reservations
  for each row execute function private.prevent_tenant_change();

comment on table public.reservations is
  'A resource held for a time range. The reservations_no_overlap exclusion constraint prevents double booking.';

-- ---------------------------------------------------------------------------
-- Pricing: rate x units, where the unit comes from the resource.
--   booking  flat rate          hour  started hours        day  started 24h blocks
--   night    local calendar dates crossed (a 14:00 -> 10:00 stay is 1 night)
-- ---------------------------------------------------------------------------
create function public.reservation_price(
  p_rate_minor bigint,
  p_rate_unit text,
  p_during tstzrange,
  p_timezone text
)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select p_rate_minor * case p_rate_unit
    when 'hour'  then ceil(extract(epoch from upper(p_during) - lower(p_during)) / 3600)::bigint
    when 'day'   then ceil(extract(epoch from upper(p_during) - lower(p_during)) / 86400)::bigint
    when 'night' then greatest(1, ((upper(p_during) at time zone p_timezone)::date
                                   - (lower(p_during) at time zone p_timezone)::date))::bigint
    else 1
  end;
$$;
revoke all on function public.reservation_price(bigint, text, tstzrange, text) from public, anon, authenticated;
grant execute on function public.reservation_price(bigint, text, tstzrange, text) to authenticated, service_role;
comment on function public.reservation_price(bigint, text, tstzrange, text) is
  'Price in minor units for a time range at a rate per booking, hour, day or night (nights counted in local time).';

-- Before insert/move: resource must be active (for new bookings) and big
-- enough; price follows the resource's rate.
create function private.prepare_reservation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_res public.resources;
  v_tz  text;
begin
  -- SECURITY DEFINER so the price can be read even by roles that cannot see
  -- rates; the composite foreign key still ties the resource to the tenant.
  select * into v_res from public.resources where id = new.resource_id and tenant_id = new.tenant_id;
  if not found then
    raise exception 'Resource not found' using errcode = 'P0002';
  end if;
  if tg_op = 'INSERT' or new.resource_id is distinct from old.resource_id then
    if not v_res.active then
      raise exception '% is not taking reservations', v_res.name using errcode = '22023';
    end if;
    if tg_op = 'INSERT' and new.status not in ('tentative', 'confirmed', 'checked_in') then
      raise exception 'New reservations start as tentative, confirmed or checked in' using errcode = '22023';
    end if;
  end if;
  if new.guests > v_res.capacity
     and (tg_op = 'INSERT' or (new.guests, new.resource_id) is distinct from (old.guests, old.resource_id)) then
    raise exception '% holds at most % guests', v_res.name, v_res.capacity using errcode = '22023';
  end if;
  if tg_op = 'INSERT' or new.during is distinct from old.during or new.resource_id is distinct from old.resource_id then
    select t.timezone into v_tz from public.tenants t where t.id = new.tenant_id;
    new.price_minor := public.reservation_price(v_res.rate_minor, v_res.rate_unit, new.during, v_tz);
  end if;
  return new;
end;
$$;
-- Fires on every update (not "update of during"): column lists only see the
-- UPDATE's SET list, and the status trigger may shorten `during` itself.
create trigger reservations_prepare before insert or update
  on public.reservations for each row execute function private.prepare_reservation();

-- Status machine. Finished reservations are history: only notes can change.
create function private.reservation_status_flow()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_allowed text[];
begin
  if old.status in ('completed', 'cancelled', 'no_show')
     and (new.resource_id, new.during, new.guests, new.customer_id, new.status)
         is distinct from (old.resource_id, old.during, old.guests, old.customer_id, old.status) then
    raise exception 'This reservation is % and can no longer be changed', replace(old.status, '_', ' ')
      using errcode = '22023';
  end if;

  if new.status is distinct from old.status then
    v_allowed := case old.status
      when 'tentative'  then array['confirmed', 'cancelled']
      when 'confirmed'  then array['checked_in', 'cancelled', 'no_show']
      when 'checked_in' then array['completed']
      else '{}'::text[]
    end;
    if not new.status = any (v_allowed) then
      raise exception 'A % reservation cannot become %',
        replace(old.status, '_', ' '), replace(new.status, '_', ' ') using errcode = '22023';
    end if;

    case new.status
      when 'checked_in' then new.checked_in_at := now();
      when 'cancelled'  then new.cancelled_at := now();
      when 'completed'  then
        new.completed_at := now();
        -- Leaving early frees the rest of the booked time.
        if now() > lower(new.during) and now() < upper(new.during) then
          new.during := tstzrange(lower(new.during), now(), '[)');
        end if;
      else null;
    end case;
  end if;
  return new;
end;
$$;
-- Named to sort before reservations_prepare: triggers fire alphabetically,
-- so an early checkout's shortened range is priced by the next trigger.
create trigger reservations_flow before update on public.reservations
  for each row execute function private.reservation_status_flow();

-- ---------------------------------------------------------------------------
-- Permissions.
-- ---------------------------------------------------------------------------
select private.register_permission('booking.view', 'booking', 'View resources and reservations',
  array['manager', 'front_desk', 'waiter', 'sales', 'viewer']);
select private.register_permission('booking.create', 'booking', 'Make reservations',
  array['manager', 'front_desk', 'waiter', 'sales']);
select private.register_permission('booking.manage', 'booking', 'Edit, check in, complete and cancel reservations',
  array['manager', 'front_desk']);
select private.register_permission('booking.configure', 'booking', 'Add and edit resources, rates and opening hours',
  array['manager']);

-- ---------------------------------------------------------------------------
-- Audit, privileges and row level security.
-- ---------------------------------------------------------------------------
select private.enable_audit('public.resources');
select private.enable_audit('public.resource_hours');
select private.enable_audit('public.reservation_series');
select private.enable_audit('public.reservations');

revoke all on public.resources, public.resource_hours, public.reservation_series, public.reservations
  from anon, authenticated;

grant select, delete on public.resources to authenticated;
grant insert (tenant_id, kind, name, description, capacity, rate_minor, rate_unit, attributes, active, position)
  on public.resources to authenticated;
grant update (kind, name, description, capacity, rate_minor, rate_unit, attributes, active, position)
  on public.resources to authenticated;

grant select, delete on public.resource_hours to authenticated;
grant insert (tenant_id, resource_id, weekday, opens, closes) on public.resource_hours to authenticated;

grant select on public.reservation_series to authenticated;
grant insert (tenant_id, every, occurrences) on public.reservation_series to authenticated;

grant select on public.reservations to authenticated;
grant insert (tenant_id, resource_id, customer_id, series_id, during, status, guests, title, notes, source)
  on public.reservations to authenticated;
grant update (resource_id, customer_id, during, status, guests, title, notes)
  on public.reservations to authenticated;

alter table public.resources          enable row level security;
alter table public.resource_hours     enable row level security;
alter table public.reservation_series enable row level security;
alter table public.reservations       enable row level security;

create policy "booking.view reads resources"
  on public.resources for select to authenticated
  using (tenant_id in (select private.permitted_tenant_ids('booking.view')));
create policy "booking.configure adds resources"
  on public.resources for insert to authenticated
  with check (tenant_id in (select private.permitted_tenant_ids('booking.configure')));
create policy "booking.configure edits resources"
  on public.resources for update to authenticated
  using (tenant_id in (select private.permitted_tenant_ids('booking.configure')))
  with check (tenant_id in (select private.permitted_tenant_ids('booking.configure')));
create policy "booking.configure deletes unused resources"
  on public.resources for delete to authenticated
  using (tenant_id in (select private.permitted_tenant_ids('booking.configure')));

create policy "booking.view reads opening hours"
  on public.resource_hours for select to authenticated
  using (tenant_id in (select private.permitted_tenant_ids('booking.view')));
create policy "booking.configure adds opening hours"
  on public.resource_hours for insert to authenticated
  with check (tenant_id in (select private.permitted_tenant_ids('booking.configure')));
create policy "booking.configure removes opening hours"
  on public.resource_hours for delete to authenticated
  using (tenant_id in (select private.permitted_tenant_ids('booking.configure')));

create policy "booking.view reads series"
  on public.reservation_series for select to authenticated
  using (tenant_id in (select private.permitted_tenant_ids('booking.view')));
create policy "booking.create starts series"
  on public.reservation_series for insert to authenticated
  with check (tenant_id in (select private.permitted_tenant_ids('booking.create')));

create policy "booking.view reads reservations"
  on public.reservations for select to authenticated
  using (tenant_id in (select private.permitted_tenant_ids('booking.view')));
create policy "booking.create makes reservations"
  on public.reservations for insert to authenticated
  with check (tenant_id in (select private.permitted_tenant_ids('booking.create')));
create policy "booking.manage changes reservations"
  on public.reservations for update to authenticated
  using (tenant_id in (select private.permitted_tenant_ids('booking.manage')))
  with check (tenant_id in (select private.permitted_tenant_ids('booking.manage')));

-- Realtime: calendars refresh when reservations change. Supabase Realtime
-- applies the same RLS policies, so subscribers only hear about rows they can read.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.reservations;
  end if;
end;
$$;
