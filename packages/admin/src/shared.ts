import { CORE_PERMISSIONS, KittoError } from '@kitto/core';

/** The admin sections, each guarded by one permission. */
export const ADMIN_SECTIONS = [
  {
    path: '/admin/staff',
    label: 'Staff',
    permission: CORE_PERMISSIONS.membersManage,
    description: 'Invite people, change roles, disable access.',
  },
  {
    path: '/admin/roles',
    label: 'Roles',
    permission: CORE_PERMISSIONS.rolesManage,
    description: 'Default and custom roles and what each can do.',
  },
  {
    path: '/admin/settings',
    label: 'Settings',
    permission: CORE_PERMISSIONS.tenantManage,
    description: 'Name, currency, locale, time zone and theme.',
  },
  {
    path: '/admin/audit',
    label: 'Audit log',
    permission: CORE_PERMISSIONS.auditView,
    description: 'Who changed what, and when.',
  },
] as const;

export const ADMIN_PERMISSIONS: string[] = ADMIN_SECTIONS.map((s) => s.permission);

/** Admin nav items the user may see, as hrefs for <NavLinks>. */
export function adminNav(ctx: { can: (p: string) => boolean; path: (p?: string) => string }) {
  return ADMIN_SECTIONS.filter((s) => ctx.can(s.permission)).map((s) => ({
    href: ctx.path(s.path),
    label: s.label,
  }));
}

/**
 * Outcome codes passed back to pages in the query string (?notice= / ?error=).
 * Codes, not messages, so nobody can craft a link that shows arbitrary text.
 */
export const NOTICES = {
  saved: 'Saved.',
  invited: 'Invitation sent.',
  invite_saved_email_failed: "Invitation created, but the email couldn't be sent. Try again later.",
  revoked: 'Invitation revoked.',
  member_updated: 'Member updated.',
  member_removed: 'Member removed.',
  role_created: 'Role created.',
  role_deleted: 'Role deleted.',
} as const;

export const ERRORS = {
  invalid: 'Please check the form and try again.',
  invalid_email: 'Enter a valid email address.',
  invalid_role_key: 'Role keys use 2-40 lowercase letters, numbers or underscores.',
  forbidden: "You don't have permission to do that.",
  last_owner: 'A workspace needs at least one active owner.',
  owner_only: 'Only an owner can grant or change the owner role.',
  role_not_held: 'You can only grant permissions (and assign roles) that you hold yourself.',
  system_role: 'System roles cannot be deleted or renamed.',
  owner_role_fixed: 'The owner role always has every permission.',
  exists: 'That already exists.',
  role_in_use: 'That role is still assigned to someone. Move them to another role first.',
  rate_limited: 'Too many emails sent. Please wait a minute and try again.',
  failed: 'Something went wrong. Please try again.',
} as const;

export type NoticeCode = keyof typeof NOTICES;
export type ErrorCode = keyof typeof ERRORS;

/** Classify an error from a data-access call into an ErrorCode. */
export function errorCode(e: unknown): ErrorCode {
  if (!(e instanceof KittoError)) return 'failed';
  const m = e.message;
  if (/at least one active owner/i.test(m)) return 'last_owner';
  if (/only an owner can/i.test(m)) return 'owner_only';
  if (/permissions you do not have|invite someone into that role/i.test(m)) return 'role_not_held';
  if (/system roles/i.test(m)) return 'system_role';
  if (/owner role always/i.test(m)) return 'owner_role_fixed';
  if (e.code === '23503') return 'role_in_use';
  if (e.isConflict) return 'exists';
  if (e.isPermissionDenied) return 'forbidden';
  return 'failed';
}

/** Read ?notice= and ?error= into display text (unknown codes are ignored). */
export function flash(searchParams: Record<string, string | string[] | undefined>): {
  notice?: string;
  error?: string;
} {
  const n = searchParams.notice;
  const e = searchParams.error;
  return {
    ...(typeof n === 'string' && Object.hasOwn(NOTICES, n)
      ? { notice: NOTICES[n as NoticeCode] }
      : {}),
    ...(typeof e === 'string' && Object.hasOwn(ERRORS, e) ? { error: ERRORS[e as ErrorCode] } : {}),
  };
}

/** Build "path?key=value" for redirects back to an admin page. */
export function withParam(
  path: string,
  key: 'notice' | 'error',
  value: string,
  extra: Record<string, string> = {},
): string {
  const qs = new URLSearchParams({ ...extra, [key]: value });
  return `${path}?${qs.toString()}`;
}
