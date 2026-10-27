import { describe, expect, it } from 'vitest';
import { KittoError } from '@kitto/core';
import { adminNav, errorCode, flash, withParam } from './shared';

describe('admin shared helpers', () => {
  it('adminNav shows only permitted sections', () => {
    const ctx = {
      can: (p: string) => p === 'audit.view' || p === 'members.manage',
      path: (p = '/') => `/t/acme${p}`,
    };
    expect(adminNav(ctx)).toEqual([
      { href: '/t/acme/admin/staff', label: 'Staff' },
      { href: '/t/acme/admin/audit', label: 'Audit log' },
    ]);
  });

  it('errorCode classifies SQL guard errors', () => {
    expect(errorCode(new KittoError('A workspace needs at least one active owner', '23514'))).toBe(
      'last_owner',
    );
    expect(
      errorCode(new KittoError('Only an owner can grant or change the owner role', '42501')),
    ).toBe('owner_only');
    expect(
      errorCode(
        new KittoError('You cannot assign a role with permissions you do not have', '42501'),
      ),
    ).toBe('role_not_held');
    expect(errorCode(new KittoError('duplicate key value', '23505'))).toBe('exists');
    expect(errorCode(new KittoError('new row violates row-level security policy', '42501'))).toBe(
      'forbidden',
    );
    expect(errorCode(new Error('x'))).toBe('failed');
  });

  it('flash ignores unknown codes, so links cannot inject text', () => {
    expect(flash({ notice: 'saved' })).toEqual({ notice: 'Saved.' });
    expect(flash({ error: 'last_owner' }).error).toMatch(/owner/);
    expect(flash({ notice: '<script>', error: 'Your account is hacked' })).toEqual({});
    expect(flash({ notice: 'toString' })).toEqual({});
  });

  it('withParam builds the redirect URL', () => {
    expect(withParam('/t/a/admin/roles', 'notice', 'saved', { role: 'r1' })).toBe(
      '/t/a/admin/roles?role=r1&notice=saved',
    );
  });
});
