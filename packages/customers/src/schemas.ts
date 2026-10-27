import { z } from 'zod';

/**
 * Mirror of public.normalize_phone() so forms can flag bad numbers before a
 * round trip. Local Kenyan formats (0712..., 712..., 254712...) become E.164;
 * anything else must already be E.164. The database re-checks regardless.
 */
export function normalizePhone(input: string): string | null {
  let v = input.replace(/[^0-9+]/g, '');
  if (/^0[17][0-9]{8}$/.test(v)) v = `+254${v.slice(1)}`;
  else if (/^254[17][0-9]{8}$/.test(v)) v = `+${v}`;
  else if (/^[17][0-9]{8}$/.test(v)) v = `+254${v}`;
  return /^\+[1-9][0-9]{7,14}$/.test(v) ? v : null;
}

/** "VIP, corporate,  vip" -> ['corporate', 'vip'] (as the database stores them). */
export function parseTags(input: string): string[] {
  const tags = input
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(tags)].sort();
}

const blankToNull = (v: string) => (v === '' ? null : v);

/** A customer as typed into a form: every field is a string. */
export const customerFormSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(120, 'Keep the name under 120 characters'),
  phone: z
    .string()
    .trim()
    .refine((v) => v === '' || normalizePhone(v) !== null, 'Enter a valid phone number')
    .transform((v) => (v === '' ? null : normalizePhone(v))),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .refine((v) => v === '' || z.email().safeParse(v).success, 'Enter a valid email address')
    .transform(blankToNull),
  tags: z
    .string()
    .transform(parseTags)
    .refine((t) => t.length <= 20, 'Use at most 20 tags')
    .refine((t) => t.every((tag) => tag.length <= 40), 'Keep each tag under 40 characters'),
  notes: z.string().trim().max(2000, 'Keep notes under 2,000 characters'),
});
export type CustomerInput = z.output<typeof customerFormSchema>;

export const customerNoteSchema = z.object({
  body: z.string().trim().min(1, 'Write a note').max(2000, 'Keep notes under 2,000 characters'),
});
export type CustomerNoteInput = z.output<typeof customerNoteSchema>;
