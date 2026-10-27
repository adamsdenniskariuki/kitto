-- =============================================================================
-- core 0001 Foundation: extensions, the private schema and generic triggers.
--
--   * Extensions live in the `extensions` schema (on Supabase's search_path).
--     btree_gist lets one GiST index combine "=" on tenant_id with "&&" on a
--     time range: the booking module's no-double-booking constraint needs it.
--   * The `private` schema is NOT exposed through the Data API (PostgREST only
--     serves the schemas listed in config.toml -> api.schemas). Helpers and
--     internal tables live there.
--   * Every function pins `search_path = ''` and schema-qualifies every name,
--     so a caller cannot shadow a table or function with their own object.
-- =============================================================================

create extension if not exists btree_gist with schema extensions;

create schema if not exists private;
revoke all on schema private from public;
-- RLS policies run as the calling role, so callers need USAGE on the schema
-- holding the helper functions the policies reference. USAGE alone exposes
-- nothing over HTTP.
grant usage on schema private to anon, authenticated, service_role;

-- Function privileges: Postgres lets PUBLIC execute every new function and
-- Supabase also grants anon/authenticated. Kitto's rule is explicit grants:
-- every function is followed by `revoke all on function ... from public, anon,
-- authenticated` and then grants only to the roles that need it. A pgTAP guard
-- (core_schema_test) fails if anything in public is callable by anon without
-- being on its allow-list.
alter default privileges in schema public revoke execute on functions from anon, authenticated;

-- Keeps updated_at honest without trusting the client.
create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- A row never moves between tenants. Attach to every tenant-owned table:
--   create trigger <t>_tenant_immutable before update of tenant_id on <t>
--     for each row execute function private.prevent_tenant_change();
create function private.prevent_tenant_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'tenant_id cannot be changed' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- True when the current statement comes straight from a client (PostgREST
-- runs as anon/authenticated) rather than from a SECURITY DEFINER function or
-- a migration. Triggers use it to apply extra checks only to direct writes.
create function private.is_client_call()
returns boolean
language sql
stable
set search_path = ''
as $$
  select current_user in ('anon', 'authenticated');
$$;

-- Normalise a phone number to E.164. Kenyan local formats (07.., 01.., 7..,
-- 254..) map to +254; other E.164 numbers pass through unchanged.
create function public.normalize_phone(p_phone text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g');
begin
  if v ~ '^0[17][0-9]{8}$' then
    v := '+254' || substr(v, 2);
  elsif v ~ '^254[17][0-9]{8}$' then
    v := '+' || v;
  elsif v ~ '^[17][0-9]{8}$' then
    v := '+254' || v;
  end if;

  if v !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'Invalid phone number: %', p_phone using errcode = '22023';
  end if;
  return v;
end;
$$;
revoke all on function public.normalize_phone(text) from public, anon, authenticated;
grant execute on function public.normalize_phone(text) to authenticated, service_role;

-- is_client_call() is used inside triggers that run as the calling role.
revoke all on function private.is_client_call() from public, anon, authenticated;
grant execute on function private.is_client_call() to anon, authenticated, service_role;

comment on function public.normalize_phone(text) is
  'Normalise a phone number to E.164, mapping Kenyan local formats (07.., 01.., 254..) to +254.';
