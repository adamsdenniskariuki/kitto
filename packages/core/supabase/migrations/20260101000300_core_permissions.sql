-- =============================================================================
-- core 0003 Permissions: helpers, registration, tenant bootstrap, guards.
--
--   * has_permission(tenant, key) is the single source of truth. RLS policies
--     use the set-returning form `tenant_id in (select
--     private.permitted_tenant_ids('x.y'))`: the sub-select is uncorrelated, so
--     Postgres runs it ONCE per statement instead of once per row.
--   * Helpers are SECURITY DEFINER so they can read tenant_members/roles without
--     re-entering the RLS policies on those tables (which would recurse).
--   * Owners cannot lock themselves out: the last active owner of a tenant
--     cannot leave, be removed, be disabled or be demoted.
-- =============================================================================

-- Tenants the current user is an active member of.
create function private.member_tenant_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.tenant_id
  from public.tenant_members m
  where m.user_id = (select auth.uid())
    and m.status = 'active';
$$;

-- Tenants where the current user holds p_permission (owners hold everything).
create function private.permitted_tenant_ids(p_permission text)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.tenant_id
  from public.tenant_members m
  join public.roles r on r.id = m.role_id
  where m.user_id = (select auth.uid())
    and m.status = 'active'
    and (
      (r.key = 'owner' and r.is_system)
      or exists (
        select 1 from public.role_permissions rp
        where rp.role_id = r.id and rp.permission_key = p_permission
      )
    );
$$;

create function private.is_owner(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tenant_members m
    join public.roles r on r.id = m.role_id
    where m.tenant_id = p_tenant_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and r.key = 'owner' and r.is_system
  );
$$;

create function public.has_permission(p_tenant_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_tenant_id in (select private.permitted_tenant_ids(p_permission));
$$;
comment on function public.has_permission(uuid, text) is
  'True when the signed-in user is an active member of the tenant whose role grants the permission (owners: always).';

-- For SECURITY DEFINER functions: raise 42501 unless permitted.
create function private.assert_permission(p_tenant_id uuid, p_permission text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_permission(p_tenant_id, p_permission) then
    raise exception 'Permission denied: % required', p_permission using errcode = '42501';
  end if;
end;
$$;

-- Every permission key the current user holds in a tenant (for the UI).
create function public.my_permissions(p_tenant_id uuid)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select p.key
  from public.permissions p
  where public.has_permission(p_tenant_id, p.key)
  order by p.key;
$$;

-- The tenants the current user belongs to, with their role (tenant switcher).
create function public.my_tenants()
returns table (tenant_id uuid, slug text, name text, role_key text, role_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.slug, t.name, r.key, r.name
  from public.tenant_members m
  join public.tenants t on t.id = m.tenant_id
  join public.roles r on r.id = m.role_id
  where m.user_id = (select auth.uid())
    and m.status = 'active'
  order by t.name;
$$;

-- ---------------------------------------------------------------------------
-- Registration: modules call this from their migrations, e.g.
--   select private.register_permission('booking.create', 'booking',
--     'Create reservations', array['manager', 'front_desk']);
-- It is idempotent, adds the key to the role templates for future tenants and
-- back-fills the matching system roles of tenants that already exist.
-- ---------------------------------------------------------------------------
create function private.register_permission(
  p_key text,
  p_module text,
  p_description text,
  p_default_roles text[] default '{}'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.permissions (key, module, description)
  values (p_key, p_module, p_description)
  on conflict (key) do update
    set module = excluded.module, description = excluded.description;

  insert into private.role_template_permissions (role_key, permission_key)
  select r, p_key from unnest(p_default_roles) as r
  where r <> 'owner'
  on conflict do nothing;

  insert into public.role_permissions (tenant_id, role_id, permission_key)
  select ro.tenant_id, ro.id, p_key
  from public.roles ro
  where ro.is_system and ro.key = any (p_default_roles) and ro.key <> 'owner'
  on conflict do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tenant bootstrap: a new tenant gets the system roles and their permissions.
-- ---------------------------------------------------------------------------
create function private.seed_tenant_roles()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.roles (tenant_id, key, name, description, is_system)
  select new.id, rt.key, rt.name, rt.description, true
  from private.role_templates rt
  order by rt.position;

  insert into public.role_permissions (tenant_id, role_id, permission_key)
  select new.id, r.id, rtp.permission_key
  from private.role_template_permissions rtp
  join public.roles r on r.tenant_id = new.id and r.key = rtp.role_key;
  return new;
end;
$$;

create trigger tenants_seed_roles after insert on public.tenants
  for each row execute function private.seed_tenant_roles();

-- Create a tenant and make the caller its owner.
create function public.create_tenant(p_name text, p_slug text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_tenant uuid;
begin
  if v_uid is null then
    raise exception 'Sign in to create a workspace' using errcode = '42501';
  end if;
  select u.email into v_email from auth.users u where u.id = v_uid;

  insert into public.tenants (name, slug)
  values (btrim(p_name), lower(btrim(p_slug)))
  returning id into v_tenant;

  insert into public.tenant_members (tenant_id, user_id, role_id, email)
  select v_tenant, v_uid, r.id, coalesce(v_email, '')
  from public.roles r
  where r.tenant_id = v_tenant and r.key = 'owner';

  return v_tenant;
exception
  when unique_violation then
    raise exception 'The address "%" is already taken', p_slug using errcode = '23505';
end;
$$;

-- Accept an invitation addressed to the signed-in user's email.
create function public.accept_invitation(p_token uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_inv public.invitations%rowtype;
begin
  if v_uid is null then
    raise exception 'Sign in to accept the invitation' using errcode = '42501';
  end if;
  select u.email into v_email from auth.users u where u.id = v_uid;

  select * into v_inv from public.invitations i where i.token = p_token for update;
  if not found or v_inv.accepted_at is not null or v_inv.expires_at < now() then
    raise exception 'This invitation is invalid or has expired' using errcode = 'P0002';
  end if;
  if lower(v_inv.email) <> lower(coalesce(v_email, '')) then
    raise exception 'This invitation was sent to a different email address' using errcode = '42501';
  end if;

  insert into public.tenant_members (tenant_id, user_id, role_id, email)
  values (v_inv.tenant_id, v_uid, v_inv.role_id, v_email)
  on conflict (tenant_id, user_id) do update
    set role_id = excluded.role_id, status = 'active';

  update public.invitations set accepted_at = now() where id = v_inv.id;
  return v_inv.tenant_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------
create function private.is_owner_role(p_role_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.roles r where r.id = p_role_id and r.key = 'owner' and r.is_system);
$$;

-- Is there another active owner? Is the membership being removed by a cascade
-- (tenant or user deleted)? Definer helpers so the invoker trigger below can ask.
create function private.other_active_owner_exists(p_tenant_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tenant_members m
    join public.roles r on r.id = m.role_id
    where m.tenant_id = p_tenant_id
      and m.user_id <> p_user_id
      and m.status = 'active'
      and r.key = 'owner' and r.is_system
  );
$$;

create function private.membership_parent_gone(p_tenant_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (select 1 from public.tenants t where t.id = p_tenant_id)
      or not exists (select 1 from auth.users u where u.id = p_user_id);
$$;

-- A non-owner may only hand out a role whose permissions they hold themselves.
create function private.can_assign_role(p_tenant_id uuid, p_role_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_owner(p_tenant_id)
      or (
        not private.is_owner_role(p_role_id)
        and not exists (
          select 1 from public.role_permissions rp
          where rp.role_id = p_role_id
            and not public.has_permission(p_tenant_id, rp.permission_key)
        )
      );
$$;

-- 1. Only owners may grant the owner role or change an owner's membership.
-- 2. Non-owners may only assign roles within their own permissions.
-- 3. The last active owner cannot leave, be removed, disabled or demoted.
-- SECURITY INVOKER on purpose: is_client_call() must see the role that ran the
-- statement (a client, or the definer of accept_invitation()).
create function private.guard_tenant_members()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_was_owner boolean := tg_op <> 'INSERT' and old.status = 'active' and private.is_owner_role(old.role_id);
  v_is_owner  boolean := tg_op <> 'DELETE' and new.status = 'active' and private.is_owner_role(new.role_id);
  v_tenant    uuid := case when tg_op = 'DELETE' then old.tenant_id else new.tenant_id end;
begin
  if private.is_client_call() and not private.is_owner(v_tenant) then
    if (tg_op <> 'DELETE' and private.is_owner_role(new.role_id))
       or (tg_op <> 'INSERT' and private.is_owner_role(old.role_id)) then
      raise exception 'Only an owner can grant or change the owner role' using errcode = '42501';
    end if;
    if tg_op <> 'DELETE' and (tg_op = 'INSERT' or new.role_id <> old.role_id)
       and not private.can_assign_role(v_tenant, new.role_id) then
      raise exception 'You cannot assign a role with permissions you do not have' using errcode = '42501';
    end if;
  end if;

  if v_was_owner and not v_is_owner
     and not private.membership_parent_gone(old.tenant_id, old.user_id)
     and not private.other_active_owner_exists(old.tenant_id, old.user_id) then
    raise exception 'A workspace needs at least one active owner' using errcode = '23514';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger tenant_members_guard
  before insert or update or delete on public.tenant_members
  for each row execute function private.guard_tenant_members();

-- Only owners may invite owners; non-owners may only invite into roles within
-- their own permissions. SECURITY INVOKER (see above).
create function private.guard_invitations()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if private.is_client_call() and not private.can_assign_role(new.tenant_id, new.role_id) then
    raise exception 'You cannot invite someone into that role' using errcode = '42501';
  end if;
  new.email := lower(btrim(new.email));
  return new;
end;
$$;

create trigger invitations_guard before insert or update on public.invitations
  for each row execute function private.guard_invitations();

-- System roles keep their key; the owner role's permissions are implicit and
-- cannot be edited; system roles cannot be deleted (except by tenant cascade).
create function private.guard_roles()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.is_system and private.is_client_call() then
      raise exception 'System roles cannot be deleted' using errcode = '42501';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and old.is_system and (new.key <> old.key or not new.is_system) then
    raise exception 'System roles cannot be renamed' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger roles_guard before update or delete on public.roles
  for each row execute function private.guard_roles();

create function private.guard_role_permissions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.is_owner_role(coalesce(new.role_id, old.role_id)) then
    raise exception 'The owner role always has every permission' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger role_permissions_guard before insert or delete on public.role_permissions
  for each row execute function private.guard_role_permissions();

-- ---------------------------------------------------------------------------
-- Function privileges (explicit; see 0001).
-- ---------------------------------------------------------------------------
revoke all on function private.member_tenant_ids() from public, anon, authenticated;
revoke all on function private.permitted_tenant_ids(text) from public, anon, authenticated;
revoke all on function private.is_owner(uuid) from public, anon, authenticated;
revoke all on function private.is_owner_role(uuid) from public, anon, authenticated;
revoke all on function private.can_assign_role(uuid, uuid) from public, anon, authenticated;
revoke all on function private.other_active_owner_exists(uuid, uuid) from public, anon, authenticated;
revoke all on function private.membership_parent_gone(uuid, uuid) from public, anon, authenticated;
revoke all on function private.assert_permission(uuid, text) from public, anon, authenticated;
revoke all on function private.register_permission(text, text, text, text[]) from public, anon, authenticated;
revoke all on function public.has_permission(uuid, text) from public, anon, authenticated;
revoke all on function public.my_permissions(uuid) from public, anon, authenticated;
revoke all on function public.my_tenants() from public, anon, authenticated;
revoke all on function public.create_tenant(text, text) from public, anon, authenticated;
revoke all on function public.accept_invitation(uuid) from public, anon, authenticated;

grant execute on function private.member_tenant_ids() to authenticated, service_role;
grant execute on function private.permitted_tenant_ids(text) to authenticated, service_role;
grant execute on function private.is_owner(uuid) to authenticated, service_role;
grant execute on function private.is_owner_role(uuid) to authenticated, service_role;
grant execute on function private.can_assign_role(uuid, uuid) to authenticated, service_role;
grant execute on function private.other_active_owner_exists(uuid, uuid) to authenticated, service_role;
grant execute on function private.membership_parent_gone(uuid, uuid) to authenticated, service_role;
grant execute on function private.assert_permission(uuid, text) to authenticated, service_role;
grant execute on function public.has_permission(uuid, text) to authenticated, service_role;
grant execute on function public.my_permissions(uuid) to authenticated, service_role;
grant execute on function public.my_tenants() to authenticated, service_role;
grant execute on function public.create_tenant(text, text) to authenticated, service_role;
grant execute on function public.accept_invitation(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Core permissions.
-- ---------------------------------------------------------------------------
select private.register_permission('tenant.manage', 'core', 'Edit workspace settings (name, currency, theme)');
select private.register_permission('members.manage', 'core', 'Invite, disable and change the role of staff', array['manager']);
select private.register_permission('roles.manage', 'core', 'Create custom roles and edit role permissions');
select private.register_permission('audit.view', 'core', 'View the audit log', array['manager']);
