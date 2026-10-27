import { describe, expect, it } from 'vitest';
import { isValidTenantSlug, resolveTenant, tenantUrl } from './tenant-resolution';

describe('resolveTenant (subdomain mode)', () => {
  const config = { mode: 'subdomain' as const, rootDomain: 'example.com' };

  it('reads the slug from the subdomain and keeps the path', () => {
    expect(resolveTenant(config, 'acme.example.com', '/bookings')).toEqual({
      slug: 'acme',
      pathname: '/bookings',
    });
  });

  it('ignores ports and case', () => {
    expect(
      resolveTenant(
        { mode: 'subdomain', rootDomain: 'localhost:3000' },
        'Acme.localhost:3000',
        '/',
      ),
    ).toEqual({
      slug: 'acme',
      pathname: '/',
    });
  });

  it('returns null for the apex, reserved, nested or foreign hosts', () => {
    expect(resolveTenant(config, 'example.com', '/')).toBeNull();
    expect(resolveTenant(config, 'www.example.com', '/')).toBeNull();
    expect(resolveTenant(config, 'a.b.example.com', '/')).toBeNull();
    expect(resolveTenant(config, 'acme.evil.com', '/')).toBeNull();
    expect(resolveTenant(config, 'evilexample.com', '/')).toBeNull();
  });

  it('requires a root domain', () => {
    expect(() => resolveTenant({ mode: 'subdomain' }, 'a.b.c', '/')).toThrow(/rootDomain/);
  });
});

describe('resolveTenant (path mode)', () => {
  const config = { mode: 'path' as const };

  it('reads the slug from /t/<slug> and strips it from the path', () => {
    expect(resolveTenant(config, 'example.com', '/t/acme/orders/42')).toEqual({
      slug: 'acme',
      pathname: '/orders/42',
    });
    expect(resolveTenant(config, 'example.com', '/t/acme')).toEqual({
      slug: 'acme',
      pathname: '/',
    });
  });

  it('supports a custom prefix', () => {
    expect(resolveTenant({ mode: 'path', pathPrefix: '/w/' }, 'x', '/w/acme/a')).toEqual({
      slug: 'acme',
      pathname: '/a',
    });
  });

  it('returns null outside the prefix or for invalid slugs', () => {
    expect(resolveTenant(config, 'example.com', '/about')).toBeNull();
    expect(resolveTenant(config, 'example.com', '/t/')).toBeNull();
    expect(resolveTenant(config, 'example.com', '/t/-bad-/x')).toBeNull();
    expect(resolveTenant(config, 'example.com', '/tx/acme')).toBeNull();
  });
});

describe('tenantUrl', () => {
  it('builds URLs in both modes', () => {
    expect(tenantUrl({ mode: 'subdomain', rootDomain: 'example.com' }, 'acme', '/admin')).toBe(
      'https://acme.example.com/admin',
    );
    expect(tenantUrl({ mode: 'path' }, 'acme', '/admin')).toBe('/t/acme/admin');
    expect(tenantUrl({ mode: 'path' }, 'acme')).toBe('/t/acme');
  });

  it('round-trips with resolveTenant', () => {
    const config = { mode: 'path' as const };
    expect(resolveTenant(config, 'x', tenantUrl(config, 'acme', '/rooms/1'))).toEqual({
      slug: 'acme',
      pathname: '/rooms/1',
    });
  });
});

describe('isValidTenantSlug', () => {
  it('matches the database check constraint', () => {
    expect(isValidTenantSlug('a')).toBe(true);
    expect(isValidTenantSlug('acme-hotel-2')).toBe(true);
    expect(isValidTenantSlug('a'.repeat(40))).toBe(true);
    expect(isValidTenantSlug('a'.repeat(41))).toBe(false);
    expect(isValidTenantSlug('Acme')).toBe(false);
    expect(isValidTenantSlug('-acme')).toBe(false);
    expect(isValidTenantSlug('acme_')).toBe(false);
  });
});
