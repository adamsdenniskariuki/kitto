import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Tables } from './database.types';
import type { PermissionSet } from './permissions';
import { permissionSet } from './permissions';
import type {
  CreateRoleInput,
  CreateTenantInput,
  InviteMemberInput,
  TenantSettingsInput,
  UpdateMemberInput,
} from './schemas';

/** A Supabase client typed against Kitto's schema. Modules extend `Database` with their own tables. */
export type KittoClient = SupabaseClient<Database>;

export type Tenant = Tables<'tenants'>;
export type Role = Tables<'roles'>;
export type Member = Tables<'tenant_members'>;
export type Invitation = Tables<'invitations'>;
export type AuditEntry = Tables<'audit_log'>;
export type Permission = Tables<'permissions'>;

/** Error raised by data-access helpers, keeping the Postgres SQLSTATE for callers to branch on. */
export class KittoError extends Error {
  constructor(
    message: string,
    readonly code: string | undefined,
  ) {
    super(message);
    this.name = 'KittoError';
  }

  get isPermissionDenied(): boolean {
    return this.code === '42501';
  }
  get isConflict(): boolean {
    return this.code === '23505';
  }
  get isNotFound(): boolean {
    return this.code === 'P0002' || this.code === 'PGRST116';
  }
}

/** Unwrap a Supabase response, throwing KittoError on failure. */
export function unwrap<T>(res: {
  data: T;
  error: { message: string; code?: string } | null;
}): NonNullable<T> {
  if (res.error) throw new KittoError(res.error.message, res.error.code);
  if (res.data === null || res.data === undefined) throw new KittoError('Not found', 'PGRST116');
  return res.data as NonNullable<T>;
}

// ---------------------------------------------------------------- tenants

export async function createTenant(db: KittoClient, input: CreateTenantInput): Promise<string> {
  return unwrap(await db.rpc('create_tenant', { p_name: input.name, p_slug: input.slug }));
}

export async function myTenants(db: KittoClient) {
  return unwrap(await db.rpc('my_tenants'));
}

export async function getTenantBySlug(db: KittoClient, slug: string): Promise<Tenant | null> {
  const res = await db.from('tenants').select('*').eq('slug', slug).maybeSingle();
  if (res.error) throw new KittoError(res.error.message, res.error.code);
  return res.data;
}

export async function updateTenantSettings(
  db: KittoClient,
  tenantId: string,
  input: TenantSettingsInput,
): Promise<Tenant> {
  return unwrap(await db.from('tenants').update(input).eq('id', tenantId).select('*').single());
}

// ------------------------------------------------------------ permissions

export async function myPermissions(
  db: KittoClient,
  tenantId: string,
  roleKey: string,
): Promise<PermissionSet> {
  const keys = unwrap(await db.rpc('my_permissions', { p_tenant_id: tenantId }));
  return permissionSet(roleKey, keys);
}

export async function hasPermission(
  db: KittoClient,
  tenantId: string,
  permission: string,
): Promise<boolean> {
  return unwrap(
    await db.rpc('has_permission', { p_tenant_id: tenantId, p_permission: permission }),
  );
}

export async function listPermissions(db: KittoClient): Promise<Permission[]> {
  return unwrap(await db.from('permissions').select('*').order('module').order('key'));
}

// ------------------------------------------------------------------ roles

export async function listRoles(db: KittoClient, tenantId: string) {
  return unwrap(
    await db
      .from('roles')
      .select('*, role_permissions(permission_key)')
      .eq('tenant_id', tenantId)
      .order('is_system', { ascending: false })
      .order('name'),
  );
}

export async function createRole(
  db: KittoClient,
  tenantId: string,
  input: CreateRoleInput,
): Promise<Role> {
  return unwrap(
    await db
      .from('roles')
      .insert({
        tenant_id: tenantId,
        key: input.key,
        name: input.name,
        ...(input.description ? { description: input.description } : {}),
      })
      .select('*')
      .single(),
  );
}

/** Replace a role's permission keys with `keys` (adds missing, removes extra). */
export async function setRolePermissions(
  db: KittoClient,
  tenantId: string,
  roleId: string,
  keys: readonly string[],
) {
  const current = unwrap(
    await db.from('role_permissions').select('permission_key').eq('role_id', roleId),
  );
  const have = new Set(current.map((r) => r.permission_key));
  const want = new Set(keys);
  const toAdd = [...want].filter((k) => !have.has(k));
  const toRemove = [...have].filter((k) => !want.has(k));
  if (toRemove.length) {
    const res = await db
      .from('role_permissions')
      .delete()
      .eq('role_id', roleId)
      .in('permission_key', toRemove);
    if (res.error) throw new KittoError(res.error.message, res.error.code);
  }
  if (toAdd.length) {
    const res = await db
      .from('role_permissions')
      .insert(
        toAdd.map((permission_key) => ({ tenant_id: tenantId, role_id: roleId, permission_key })),
      );
    if (res.error) throw new KittoError(res.error.message, res.error.code);
  }
}

export async function deleteRole(db: KittoClient, roleId: string): Promise<void> {
  const res = await db.from('roles').delete().eq('id', roleId);
  if (res.error) throw new KittoError(res.error.message, res.error.code);
}

// ---------------------------------------------------------------- members

export async function listMembers(db: KittoClient, tenantId: string) {
  return unwrap(
    await db
      .from('tenant_members')
      .select('*, role:roles(id, key, name)')
      .eq('tenant_id', tenantId)
      .order('email'),
  );
}

export async function updateMember(
  db: KittoClient,
  tenantId: string,
  userId: string,
  input: UpdateMemberInput,
): Promise<Member> {
  const patch: Database['public']['Tables']['tenant_members']['Update'] = {};
  if (input.roleId !== undefined) patch.role_id = input.roleId;
  if (input.displayName !== undefined) patch.display_name = input.displayName;
  if (input.status !== undefined) patch.status = input.status;
  return unwrap(
    await db
      .from('tenant_members')
      .update(patch)
      .eq('tenant_id', tenantId)
      .eq('user_id', userId)
      .select('*')
      .single(),
  );
}

export async function removeMember(
  db: KittoClient,
  tenantId: string,
  userId: string,
): Promise<void> {
  const res = await db
    .from('tenant_members')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('user_id', userId);
  if (res.error) throw new KittoError(res.error.message, res.error.code);
}

// ------------------------------------------------------------ invitations

export async function inviteMember(
  db: KittoClient,
  tenantId: string,
  input: InviteMemberInput,
): Promise<Invitation> {
  return unwrap(
    await db
      .from('invitations')
      .insert({ tenant_id: tenantId, email: input.email, role_id: input.roleId })
      .select('*')
      .single(),
  );
}

export async function listPendingInvitations(db: KittoClient, tenantId: string) {
  return unwrap(
    await db
      .from('invitations')
      .select('*, role:roles(id, key, name)')
      .eq('tenant_id', tenantId)
      .is('accepted_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false }),
  );
}

export async function revokeInvitation(db: KittoClient, invitationId: string): Promise<void> {
  const res = await db.from('invitations').delete().eq('id', invitationId);
  if (res.error) throw new KittoError(res.error.message, res.error.code);
}

/** Accept an invitation for the signed-in user; returns the tenant id. */
export async function acceptInvitation(db: KittoClient, token: string): Promise<string> {
  return unwrap(await db.rpc('accept_invitation', { p_token: token }));
}

// ------------------------------------------------------------------ audit

export interface AuditQuery {
  table?: string;
  recordId?: string;
  limit?: number;
  /** Return entries older than this id (keyset pagination). */
  before?: number;
}

export async function listAudit(
  db: KittoClient,
  tenantId: string,
  q: AuditQuery = {},
): Promise<AuditEntry[]> {
  let query = db
    .from('audit_log')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('id', { ascending: false })
    .limit(Math.min(q.limit ?? 50, 200));
  if (q.table) query = query.eq('table_name', q.table);
  if (q.recordId) query = query.eq('record_id', q.recordId);
  if (q.before) query = query.lt('id', q.before);
  return unwrap(await query);
}
