-- =============================================================================
-- reports 0001 The reports.view permission and the shared report guard.
--
--   * Report functions are read-only aggregates over other modules' tables.
--     They are SECURITY INVOKER, so the caller's row level security applies
--     on top of the explicit checks: a report can never show a row the user
--     could not select themselves.
--   * Each report needs reports.view AND the view permission of the module it
--     reports on (billing.view, booking.view...). Without the module
--     permission the function raises 42501 instead of silently returning
--     zeros, so the UI can hide the section.
--   * Reports are split into one migration per module (0200 billing, 0300
--     booking, 0400 orders, 0500 inventory, 0600 customers). An app that
--     leaves a module out drops that file from its migrations (and the
--     matching section from its reports page); nothing else depends on it.
--   * Periods are whole days in the tenant's time zone: [from 00:00, to+1
--     00:00) local time, at most 366 days. Empty days are filled with
--     generate_series so charts never skip a day.
-- =============================================================================

select private.register_permission('reports.view', 'reports', 'View reports and dashboards',
  array['manager', 'viewer']);

-- Assert the caller may run a report on this tenant and return its time zone.
-- The period, when given, must run forwards and span at most 366 days.
create function private.report_guard(
  p_tenant_id  uuid,
  p_permission text,
  p_from       date default null,
  p_to         date default null
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_timezone text;
begin
  perform private.assert_permission(p_tenant_id, 'reports.view');
  perform private.assert_permission(p_tenant_id, p_permission);
  if (p_from is null) <> (p_to is null) then
    raise exception 'A report period needs both a start and an end' using errcode = '22023';
  end if;
  if p_from is not null and (p_to < p_from or p_to - p_from > 365) then
    raise exception 'A report period runs forwards and spans at most 366 days' using errcode = '22023';
  end if;
  select t.timezone into v_timezone from public.tenants t where t.id = p_tenant_id;
  return v_timezone;
end;
$$;
comment on function private.report_guard(uuid, text, date, date) is
  'Raise 42501 unless the caller holds reports.view and the module permission; validate the period; return the tenant time zone.';

-- The instants bounding a local-date period: [from 00:00, to+1 00:00) in p_timezone.
create function private.report_period(p_from date, p_to date, p_timezone text)
returns tstzrange
language sql
immutable
set search_path = ''
as $$
  select tstzrange(
    p_from::timestamp at time zone p_timezone,
    (p_to + 1)::timestamp at time zone p_timezone,
    '[)');
$$;

revoke all on function private.report_guard(uuid, text, date, date) from public, anon, authenticated;
revoke all on function private.report_period(date, date, text) from public, anon, authenticated;
grant execute on function private.report_guard(uuid, text, date, date) to authenticated, service_role;
grant execute on function private.report_period(date, date, text) to authenticated, service_role;
