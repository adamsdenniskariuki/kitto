/**
 * Permission keys and role helpers. The database is the source of truth
 * (public.permissions, public.has_permission()); this mirror lets the UI hide
 * what a user cannot do. Never rely on it for security: RLS does that.
 */

export const CORE_PERMISSIONS = {
  tenantManage: 'tenant.manage',
  membersManage: 'members.manage',
  rolesManage: 'roles.manage',
  auditView: 'audit.view',
} as const;

/** "<module>.<action>", e.g. booking.create, inventory.adjust. */
export type PermissionKey = `${string}.${string}`;

export const PERMISSION_KEY_PATTERN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

export const DEFAULT_ROLES = [
  'owner',
  'manager',
  'front_desk',
  'waiter',
  'storekeeper',
  'sales',
  'viewer',
] as const;
export type DefaultRoleKey = (typeof DEFAULT_ROLES)[number];

export const OWNER_ROLE: DefaultRoleKey = 'owner';

/** A user's effective permissions within one tenant. */
export interface PermissionSet {
  roleKey: string;
  permissions: ReadonlySet<string>;
}

export function permissionSet(roleKey: string, permissions: Iterable<string>): PermissionSet {
  return { roleKey, permissions: new Set(permissions) };
}

/** Mirror of public.has_permission(): the owner role holds every permission. */
export function can(set: PermissionSet | null | undefined, permission: string): boolean {
  if (!set) return false;
  return set.roleKey === OWNER_ROLE || set.permissions.has(permission);
}

export function canAll(
  set: PermissionSet | null | undefined,
  permissions: readonly string[],
): boolean {
  return permissions.every((p) => can(set, p));
}

export function canAny(
  set: PermissionSet | null | undefined,
  permissions: readonly string[],
): boolean {
  return permissions.some((p) => can(set, p));
}

/** Group permission keys by module for a role editor. */
export function groupByModule<T extends { key: string; module: string }>(
  perms: readonly T[],
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const p of [...perms].sort((a, b) => a.key.localeCompare(b.key))) {
    const list = groups.get(p.module) ?? [];
    list.push(p);
    groups.set(p.module, list);
  }
  return groups;
}
