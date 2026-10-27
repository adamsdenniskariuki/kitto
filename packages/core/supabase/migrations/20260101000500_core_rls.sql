-- =============================================================================
-- core 0005 Row level security and table privileges.
--
-- Model:
--   * Members of a tenant can read its tenant row, roles and colleagues.
--   * Writes need a permission key (tenant.manage, members.manage, ...).
--   * anon (logged-out visitors) gets NO table access at all.
--   * Column-level GRANTs stop clients writing columns the database owns
--     (slug, is_system, status timestamps, ...), even on rows RLS allows.
-- =============================================================================

-- Supabase grants ALL on public tables to anon/authenticated; RLS filters
-- rows. Start from nothing for anon and re-grant per table for authenticated.
revoke all on public.tenants, public.permissions, public.roles, public.role_permissions,
  public.tenant_members, public.invitations, public.audit_log from anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;

grant select on public.permissions to authenticated;

grant select on public.tenants to authenticated;
grant update (name, currency, locale, timezone, theme, settings) on public.tenants to authenticated;

grant select, delete on public.roles to authenticated;
grant insert (tenant_id, key, name, description) on public.roles to authenticated;
grant update (name, description) on public.roles to authenticated;

grant select, delete on public.role_permissions to authenticated;
grant insert (tenant_id, role_id, permission_key) on public.role_permissions to authenticated;

grant select, delete on public.tenant_members to authenticated;
grant update (role_id, display_name, status) on public.tenant_members to authenticated;

grant select, delete on public.invitations to authenticated;
grant insert (tenant_id, email, role_id) on public.invitations to authenticated;

grant select on public.audit_log to authenticated;

alter table public.tenants          enable row level security;
alter table public.permissions      enable row level security;
alter table public.roles            enable row level security;
alter table public.role_permissions enable row level security;
alter table public.tenant_members   enable row level security;
alter table public.invitations      enable row level security;
alter table public.audit_log        enable row level security;

-- Tenants
create policy "members read their tenants"
  on public.tenants for select to authenticated
  using (id in (select private.member_tenant_ids()));
create policy "tenant.manage updates the tenant"
  on public.tenants for update to authenticated
  using (id in (select private.permitted_tenant_ids('tenant.manage')))
  with check (id in (select private.permitted_tenant_ids('tenant.manage')));

-- Permission catalogue: readable by every signed-in user.
create policy "permissions are readable"
  on public.permissions for select to authenticated
  using (true);

-- Roles
create policy "members read roles"
  on public.roles for select to authenticated
  using (tenant_id in (select private.member_tenant_ids()));
create policy "roles.manage creates roles"
  on public.roles for insert to authenticated
  with check (tenant_id in (select private.permitted_tenant_ids('roles.manage')));
create policy "roles.manage updates roles"
  on public.roles for update to authenticated
  using (tenant_id in (select private.permitted_tenant_ids('roles.manage')))
  with check (tenant_id in (select private.permitted_tenant_ids('roles.manage')));
create policy "roles.manage deletes custom roles"
  on public.roles for delete to authenticated
  using (not is_system and tenant_id in (select private.permitted_tenant_ids('roles.manage')));

-- Role permissions: you can only hand out permissions you hold yourself.
create policy "members read role permissions"
  on public.role_permissions for select to authenticated
  using (tenant_id in (select private.member_tenant_ids()));
create policy "roles.manage grants held permissions"
  on public.role_permissions for insert to authenticated
  with check (
    tenant_id in (select private.permitted_tenant_ids('roles.manage'))
    and public.has_permission(tenant_id, permission_key)
  );
create policy "roles.manage revokes permissions"
  on public.role_permissions for delete to authenticated
  using (tenant_id in (select private.permitted_tenant_ids('roles.manage')));

-- Members
create policy "members read colleagues"
  on public.tenant_members for select to authenticated
  using (tenant_id in (select private.member_tenant_ids()) or user_id = (select auth.uid()));
create policy "members.manage updates members"
  on public.tenant_members for update to authenticated
  using (tenant_id in (select private.permitted_tenant_ids('members.manage')))
  with check (tenant_id in (select private.permitted_tenant_ids('members.manage')));
create policy "members.manage removes members, anyone can leave"
  on public.tenant_members for delete to authenticated
  using (
    user_id = (select auth.uid())
    or tenant_id in (select private.permitted_tenant_ids('members.manage'))
  );

-- Invitations
create policy "members.manage reads invitations"
  on public.invitations for select to authenticated
  using (tenant_id in (select private.permitted_tenant_ids('members.manage')));
create policy "members.manage invites"
  on public.invitations for insert to authenticated
  with check (tenant_id in (select private.permitted_tenant_ids('members.manage')));
create policy "members.manage revokes invitations"
  on public.invitations for delete to authenticated
  using (tenant_id in (select private.permitted_tenant_ids('members.manage')));

-- Audit log: read-only, audit.view.
create policy "audit.view reads the audit log"
  on public.audit_log for select to authenticated
  using (tenant_id in (select private.permitted_tenant_ids('audit.view')));
