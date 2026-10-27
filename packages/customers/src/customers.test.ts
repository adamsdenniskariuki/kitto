import { describe, expect, it } from 'vitest';
import { KittoError } from '@kitto/core';
import { searchTerm } from './data';
import { customerFormSchema, normalizePhone, parseTags } from './schemas';
import { customerErrorCode, customerFormError } from './shared';

const form = (over: Partial<Record<string, string>> = {}) => ({
  name: 'Wanjiku',
  phone: '',
  email: '',
  tags: '',
  notes: '',
  ...over,
});

describe('normalizePhone (mirrors public.normalize_phone)', () => {
  it.each([
    ['0712 345 678', '+254712345678'],
    ['712345678', '+254712345678'],
    ['254112345678', '+254112345678'],
    ['+44 20 7946 0958', '+442079460958'],
  ])('%s -> %s', (input, expected) => expect(normalizePhone(input)).toBe(expected));

  it('rejects junk', () => {
    expect(normalizePhone('12')).toBeNull();
    expect(normalizePhone('call me')).toBeNull();
  });
});

describe('customerFormSchema', () => {
  it('normalises like the database does', () => {
    expect(
      customerFormSchema.parse(
        form({
          name: '  Wanjiku ',
          phone: '0712345678',
          email: ' W@Example.com ',
          tags: 'VIP, vip, corporate,',
        }),
      ),
    ).toEqual({
      name: 'Wanjiku',
      phone: '+254712345678',
      email: 'w@example.com',
      tags: ['corporate', 'vip'],
      notes: '',
    });
  });

  it('turns blank contact details into null', () => {
    const parsed = customerFormSchema.parse(form());
    expect(parsed.phone).toBeNull();
    expect(parsed.email).toBeNull();
    expect(parsed.tags).toEqual([]);
  });

  it('maps the first bad field to an error code', () => {
    const bad = (over: Record<string, string>) => {
      const r = customerFormSchema.safeParse(form(over));
      if (r.success) throw new Error('expected failure');
      return customerFormError(r.error);
    };
    expect(bad({ name: ' ' })).toBe('invalid_name');
    expect(bad({ phone: '12' })).toBe('invalid_phone');
    expect(bad({ email: 'nope' })).toBe('invalid_email');
    expect(bad({ tags: Array.from({ length: 21 }, (_, i) => `t${i}`).join(',') })).toBe(
      'invalid_tags',
    );
  });
});

describe('helpers', () => {
  it('parses tags', () => expect(parseTags(' B, a ,,b')).toEqual(['a', 'b']));

  it('strips PostgREST filter syntax from searches', () => {
    expect(searchTerm('a,b(c)*%')).toBe('a b c');
  });

  it('classifies database errors', () => {
    expect(
      customerErrorCode(
        new KittoError(
          'duplicate key value violates unique constraint "customers_tenant_phone_key"',
          '23505',
        ),
      ),
    ).toBe('phone_taken');
    expect(
      customerErrorCode(new KittoError('update or delete violates foreign key', '23503')),
    ).toBe('in_use');
    expect(customerErrorCode(new KittoError('denied', '42501'))).toBe('forbidden');
  });
});
