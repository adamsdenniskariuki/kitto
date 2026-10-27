'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import {
  createRole,
  createRoleSchema,
  deleteRole,
  inviteMember,
  inviteMemberSchema,
  permissionKeySchema,
  removeMember,
  revokeInvitation,
  setRolePermissions,
  tenantSettingsSchema,
  updateMember,
  updateTenantSettings,
} from '@kitto/core';
import {
  getTenantContext,
  requirePermission,
  sendInvitationEmail,
  type TenantContext,
} from '@kitto/auth/server';
import { errorCode, withParam, type ErrorCode, type NoticeCode } from './shared';

/*
 * Every action re-loads the tenant context from the slug in the form (which
 * re-checks membership), checks the permission for a friendly error, and then
 * relies on RLS and the SQL guards as the real enforcement. Results are
 * passed back as ?notice= / ?error= codes so forms work without JavaScript.
 */

type Outcome =
  | { notice: NoticeCode; extra?: Record<string, string> }
  | { error: ErrorCode; extra?: Record<string, string> };

async function run(
  formData: FormData,
  permission: string,
  page: string,
  work: (ctx: TenantContext) => Promise<Outcome>,
): Promise<never> {
  const slug = z.string().min(1).parse(formData.get('tenant'));
  const ctx = await getTenantContext(slug);
  requirePermission(ctx, permission);
  let outcome: Outcome;
  try {
    outcome = await work(ctx);
  } catch (e) {
    outcome = { error: errorCode(e) };
  }
  const path = ctx.path(page);
  revalidatePath(path);
  redirect(
    'notice' in outcome
      ? withParam(path, 'notice', outcome.notice, outcome.extra)
      : withParam(path, 'error', outcome.error, outcome.extra),
  );
}

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === 'string' ? v : '';
};

// --------------------------------------------------------------- settings

export async function saveSettingsAction(formData: FormData): Promise<void> {
  await run(formData, 'tenant.manage', '/admin/settings', async (ctx) => {
    const parsed = tenantSettingsSchema.safeParse({
      name: str(formData, 'name'),
      currency: str(formData, 'currency'),
      locale: str(formData, 'locale'),
      timezone: str(formData, 'timezone'),
      theme: str(formData, 'theme'),
    });
    if (!parsed.success) return { error: 'invalid' };
    await updateTenantSettings(ctx.db, ctx.tenant.id, parsed.data);
    return { notice: 'saved' };
  });
}

// ------------------------------------------------------------------ staff

export async function inviteMemberAction(formData: FormData): Promise<void> {
  await run(formData, 'members.manage', '/admin/staff', async (ctx) => {
    const parsed = inviteMemberSchema.safeParse({
      email: str(formData, 'email'),
      roleId: str(formData, 'roleId'),
    });
    if (!parsed.success)
      return {
        error: parsed.error.issues.some((i) => i.path[0] === 'email') ? 'invalid_email' : 'invalid',
      };
    const invitation = await inviteMember(ctx.db, ctx.tenant.id, parsed.data);
    try {
      await sendInvitationEmail(invitation.email, invitation.token);
    } catch (e) {
      return e instanceof Error && e.message === 'rate_limited'
        ? { error: 'rate_limited' }
        : { notice: 'invite_saved_email_failed' };
    }
    return { notice: 'invited' };
  });
}

export async function revokeInvitationAction(formData: FormData): Promise<void> {
  await run(formData, 'members.manage', '/admin/staff', async (ctx) => {
    await revokeInvitation(ctx.db, z.uuid().parse(str(formData, 'invitationId')));
    return { notice: 'revoked' };
  });
}

export async function changeMemberRoleAction(formData: FormData): Promise<void> {
  await run(formData, 'members.manage', '/admin/staff', async (ctx) => {
    const userId = z.uuid().parse(str(formData, 'userId'));
    const roleId = z.uuid().parse(str(formData, 'roleId'));
    await updateMember(ctx.db, ctx.tenant.id, userId, { roleId });
    return { notice: 'member_updated' };
  });
}

export async function setMemberStatusAction(formData: FormData): Promise<void> {
  await run(formData, 'members.manage', '/admin/staff', async (ctx) => {
    const userId = z.uuid().parse(str(formData, 'userId'));
    const status = z.enum(['active', 'disabled']).parse(str(formData, 'status'));
    await updateMember(ctx.db, ctx.tenant.id, userId, { status });
    return { notice: 'member_updated' };
  });
}

export async function removeMemberAction(formData: FormData): Promise<void> {
  await run(formData, 'members.manage', '/admin/staff', async (ctx) => {
    await removeMember(ctx.db, ctx.tenant.id, z.uuid().parse(str(formData, 'userId')));
    return { notice: 'member_removed' };
  });
}

// ------------------------------------------------------------------ roles

export async function createRoleAction(formData: FormData): Promise<void> {
  await run(formData, 'roles.manage', '/admin/roles', async (ctx) => {
    const description = str(formData, 'description');
    const parsed = createRoleSchema.safeParse({
      key: str(formData, 'key'),
      name: str(formData, 'name'),
      ...(description ? { description } : {}),
    });
    if (!parsed.success)
      return {
        error: parsed.error.issues.some((i) => i.path[0] === 'key')
          ? 'invalid_role_key'
          : 'invalid',
      };
    const role = await createRole(ctx.db, ctx.tenant.id, parsed.data);
    return { notice: 'role_created', extra: { role: role.id } };
  });
}

export async function saveRolePermissionsAction(formData: FormData): Promise<void> {
  const roleId = z.uuid().parse(str(formData, 'roleId'));
  await run(formData, 'roles.manage', '/admin/roles', async (ctx) => {
    const keys = z.array(permissionKeySchema).parse(formData.getAll('permission'));
    await setRolePermissions(ctx.db, ctx.tenant.id, roleId, keys);
    return { notice: 'saved', extra: { role: roleId } };
  });
}

export async function deleteRoleAction(formData: FormData): Promise<void> {
  await run(formData, 'roles.manage', '/admin/roles', async (ctx) => {
    await deleteRole(ctx.db, z.uuid().parse(str(formData, 'roleId')));
    return { notice: 'role_deleted' };
  });
}
