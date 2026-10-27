import { z } from 'zod';
import { RESERVED_SLUGS, TENANT_SLUG_PATTERN } from './tenant-resolution';
import { PERMISSION_KEY_PATTERN } from './permissions';

export const tenantSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    TENANT_SLUG_PATTERN,
    'Use 1-40 lowercase letters, numbers or hyphens (not at the start or end).',
  )
  .refine((s) => !RESERVED_SLUGS.has(s), 'That address is reserved.');

export const createTenantSchema = z.object({
  name: z.string().trim().min(2, 'Name is too short.').max(120),
  slug: tenantSlugSchema,
});
export type CreateTenantInput = z.infer<typeof createTenantSchema>;

export const tenantSettingsSchema = z.object({
  name: z.string().trim().min(2).max(120),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'Use a 3-letter ISO currency code, e.g. KES.'),
  locale: z.string().trim().min(2).max(35),
  timezone: z
    .string()
    .trim()
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, 'Unknown time zone.'),
  theme: z.string().trim().min(1).max(40),
});
export type TenantSettingsInput = z.infer<typeof tenantSettingsSchema>;

export const roleKeySchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]{1,39}$/, 'Use 2-40 lowercase letters, numbers or underscores.');

export const createRoleSchema = z.object({
  key: roleKeySchema,
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).optional(),
});
export type CreateRoleInput = z.infer<typeof createRoleSchema>;

export const permissionKeySchema = z.string().regex(PERMISSION_KEY_PATTERN);

export const inviteMemberSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address.')),
  roleId: z.uuid(),
});
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

export const updateMemberSchema = z.object({
  roleId: z.uuid().optional(),
  displayName: z.string().trim().max(120).optional(),
  status: z.enum(['active', 'disabled']).optional(),
});
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;
