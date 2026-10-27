import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  commonErrorCode,
  fieldErrors,
  flashMessages,
  formValues,
  userMessage,
  withQuery,
} from './forms';
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

describe('action outcomes', () => {
  it('commonErrorCode maps SQLSTATEs', () => {
    expect(commonErrorCode(new KittoError('x', '42501'))).toBe('forbidden');
    expect(commonErrorCode(new KittoError('x', '23505'))).toBe('exists');
    expect(commonErrorCode(new KittoError('x', '23503'))).toBe('in_use');
    expect(commonErrorCode(new KittoError('x', '23P01'))).toBe('conflict');
    expect(commonErrorCode(new KittoError('x', '22023'))).toBe('invalid');
    expect(commonErrorCode(new Error('boom'))).toBe('failed');
  });

  it('flashMessages only shows known codes', () => {
    const notices = { saved: 'Saved.' };
    expect(flashMessages({ notice: 'saved' }, notices)).toEqual({ notice: 'Saved.' });
    expect(flashMessages({ notice: '<script>' }, notices)).toEqual({});
    expect(flashMessages({ error: 'in_use' }, notices).error).toMatch(/still used/);
    expect(flashMessages({ error: 'mine' }, notices, { mine: 'Mine.' })).toEqual({
      error: 'Mine.',
    });
  });

  it('withQuery merges parameters', () => {
    expect(withQuery('/a', { notice: 'saved' })).toBe('/a?notice=saved');
    expect(withQuery('/a?day=2026-01-01', { error: 'x', skip: undefined })).toBe(
      '/a?day=2026-01-01&error=x',
    );
  });
});
