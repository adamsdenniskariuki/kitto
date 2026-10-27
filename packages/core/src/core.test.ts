import { describe, expect, it } from 'vitest';
import { formatDate, formatMoney, fromMinorUnits, toMinorUnits } from './format';
import { can, canAll, canAny, groupByModule, permissionSet } from './permissions';
import { createTenantSchema, inviteMemberSchema, tenantSettingsSchema } from './schemas';

describe('money', () => {
  it('converts between minor and major units using the currency exponent', () => {
    expect(toMinorUnits(12.5, 'KES')).toBe(1250);
    expect(toMinorUnits(0.015, 'USD')).toBe(2);
    expect(toMinorUnits(-1.005, 'USD')).toBe(-101);
    expect(toMinorUnits(500, 'JPY')).toBe(500);
    expect(fromMinorUnits(1250, 'KES')).toBe(12.5);
  });

  it('formats per tenant currency and locale', () => {
    const kes = formatMoney(123456, { currency: 'KES', locale: 'en-KE' });
    expect(kes).toContain('1,234.56');
    expect(kes).toMatch(/Ksh|KES/);
    expect(formatMoney(123456, { currency: 'USD', locale: 'en-US' })).toBe('$1,234.56');
  });
});

describe('dates', () => {
  it('formats in the tenant time zone', () => {
    const t = '2026-01-01T22:30:00Z';
    expect(formatDate(t, { locale: 'en-GB', timezone: 'Africa/Nairobi' })).toBe('2 Jan 2026');
    expect(formatDate(t, { locale: 'en-GB', timezone: 'UTC' })).toBe('1 Jan 2026');
  });
});

describe('permissions', () => {
  const waiter = permissionSet('waiter', ['orders.create', 'orders.view']);
  const owner = permissionSet('owner', []);

  it('checks keys held by the role', () => {
    expect(can(waiter, 'orders.create')).toBe(true);
    expect(can(waiter, 'inventory.adjust')).toBe(false);
    expect(can(null, 'orders.view')).toBe(false);
  });

  it('gives owners every permission, mirroring has_permission()', () => {
    expect(can(owner, 'anything.at_all')).toBe(true);
  });

  it('supports all/any checks', () => {
    expect(canAll(waiter, ['orders.create', 'orders.view'])).toBe(true);
    expect(canAll(waiter, ['orders.create', 'billing.refund'])).toBe(false);
    expect(canAny(waiter, ['billing.refund', 'orders.view'])).toBe(true);
  });

  it('groups permissions by module', () => {
    const groups = groupByModule([
      { key: 'orders.view', module: 'orders' },
      { key: 'audit.view', module: 'core' },
      { key: 'orders.create', module: 'orders' },
    ]);
    expect([...groups.keys()]).toEqual(['core', 'orders']);
    expect(groups.get('orders')?.map((p) => p.key)).toEqual(['orders.create', 'orders.view']);
  });
});

describe('schemas', () => {
  it('normalises and validates tenant input', () => {
    expect(createTenantSchema.parse({ name: ' Acme ', slug: ' ACME-1 ' })).toEqual({
      name: 'Acme',
      slug: 'acme-1',
    });
    expect(createTenantSchema.safeParse({ name: 'Acme', slug: 'www' }).success).toBe(false);
    expect(createTenantSchema.safeParse({ name: 'Acme', slug: 'a_b' }).success).toBe(false);
  });

  it('validates settings', () => {
    const ok = {
      name: 'Acme',
      currency: 'kes',
      locale: 'en-KE',
      timezone: 'Africa/Nairobi',
      theme: 'default',
    };
    expect(tenantSettingsSchema.parse(ok).currency).toBe('KES');
    expect(tenantSettingsSchema.safeParse({ ...ok, timezone: 'Mars/Base' }).success).toBe(false);
  });

  it('validates invitations', () => {
    const roleId = '6b1f2b9e-4c7d-4a8e-9f3a-2d1c0b9a8e7f';
    expect(inviteMemberSchema.parse({ email: ' A@B.co ', roleId }).email).toBe('a@b.co');
    expect(inviteMemberSchema.safeParse({ email: 'nope', roleId }).success).toBe(false);
  });
});
