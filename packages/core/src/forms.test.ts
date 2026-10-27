import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { fieldErrors, formValues, userMessage } from './forms';
import { KittoError } from './data';
import { tenantPath } from './tenant-resolution';

describe('forms', () => {
  it('fieldErrors keeps the first message per field', () => {
    const schema = z.object({ email: z.email('Bad email'), name: z.string().min(2, 'Too short') });
    const res = schema.safeParse({ email: 'x', name: '' });
    expect(res.success).toBe(false);
    if (!res.success)
      expect(fieldErrors(res.error)).toEqual({ email: 'Bad email', name: 'Too short' });
  });

  it('formValues returns strings only', () => {
    const fd = new FormData();
    fd.set('a', '1');
    fd.set('$ACTION_ID_x', '');
    fd.set('file', new Blob(['x']));
    expect(formValues(fd)).toEqual({ a: '1' });
  });

  it('userMessage passes through Kitto SQL messages and hides internals', () => {
    expect(
      userMessage(new KittoError('A workspace needs at least one active owner', '23514')),
    ).toBe('A workspace needs at least one active owner');
    expect(userMessage(new KittoError('permission denied for table audit_log', '42501'))).toBe(
      "You don't have permission to do that.",
    );
    expect(
      userMessage(new KittoError('Only an owner can grant or change the owner role', '42501')),
    ).toBe('Only an owner can grant or change the owner role');
    expect(
      userMessage(new KittoError('duplicate key value violates unique constraint "x"', '23505')),
    ).toBe('That already exists.');
    expect(
      userMessage(new KittoError('new row for relation "t" violates check constraint', '23514')),
    ).toBe('That change is not allowed.');
    expect(userMessage(new Error('boom'))).toBe('Something went wrong. Please try again.');
  });
});

describe('tenantPath', () => {
  it('prefixes the slug in path mode', () => {
    expect(tenantPath({ mode: 'path' }, 'acme', '/admin')).toBe('/t/acme/admin');
    expect(tenantPath({ mode: 'path' }, 'acme')).toBe('/t/acme');
    expect(tenantPath({ mode: 'path', pathPrefix: '/w/' }, 'acme', 'x')).toBe('/w/acme/x');
  });
  it('is host-relative in subdomain mode', () => {
    expect(tenantPath({ mode: 'subdomain', rootDomain: 'example.com' }, 'acme', '/admin')).toBe(
      '/admin',
    );
  });
});
