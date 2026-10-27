import { describe, expect, it } from 'vitest';
import { safeNextPath } from './redirect';
import { cookieDomain, isGlobalPath, siteProtocol } from './config';

const ORIGIN = 'https://example.com';

describe('safeNextPath', () => {
  it('keeps same-origin paths and query strings', () => {
    expect(safeNextPath('/t/acme/admin?x=1', ORIGIN)).toBe('/t/acme/admin?x=1');
    expect(safeNextPath('https://example.com/invite/abc', ORIGIN)).toBe('/invite/abc');
  });

  it('falls back for empty, foreign and protocol-relative targets', () => {
    expect(safeNextPath(null, ORIGIN)).toBe('/');
    expect(safeNextPath('', ORIGIN, '/home')).toBe('/home');
    expect(safeNextPath('https://evil.example/x', ORIGIN)).toBe('/');
    expect(safeNextPath('//evil.example/x', ORIGIN)).toBe('/');
    expect(safeNextPath('/\\evil.example', ORIGIN)).toBe('/');
    expect(safeNextPath('javascript:alert(1)', ORIGIN)).toBe('/');
  });

  it('allows tenant subdomains only when a root domain is given', () => {
    expect(safeNextPath('https://acme.example.com/admin', ORIGIN)).toBe('/');
    expect(safeNextPath('https://acme.example.com/admin', ORIGIN, '/', 'example.com')).toBe(
      'https://acme.example.com/admin',
    );
    expect(safeNextPath('http://acme.example.com/admin', ORIGIN, '/', 'example.com')).toBe('/');
    expect(safeNextPath('https://a.b.example.com/', ORIGIN, '/', 'example.com')).toBe('/');
    expect(safeNextPath('https://evilexample.com/', ORIGIN, '/', 'example.com')).toBe('/');
    expect(safeNextPath('https://example.com.evil.io/', ORIGIN, '/', 'example.com')).toBe('/');
  });

  it('handles ports in the root domain', () => {
    expect(
      safeNextPath('http://acme.lvh.me:3000/x', 'http://lvh.me:3000', '/', 'lvh.me:3000'),
    ).toBe('http://acme.lvh.me:3000/x');
  });
});

describe('config helpers', () => {
  it('cookieDomain shares cookies across subdomains except on localhost', () => {
    expect(cookieDomain({ mode: 'path' })).toBeUndefined();
    expect(cookieDomain({ mode: 'subdomain', rootDomain: 'example.com' })).toBe('.example.com');
    expect(cookieDomain({ mode: 'subdomain', rootDomain: 'lvh.me:3000' })).toBe('.lvh.me');
    expect(cookieDomain({ mode: 'subdomain', rootDomain: 'localhost:3000' })).toBeUndefined();
    expect(cookieDomain({ mode: 'subdomain', rootDomain: '127.0.0.1:3000' })).toBeUndefined();
  });

  it('isGlobalPath matches whole segments', () => {
    expect(isGlobalPath('/login')).toBe(true);
    expect(isGlobalPath('/auth/confirm')).toBe(true);
    expect(isGlobalPath('/loginx')).toBe(false);
    expect(isGlobalPath('/admin')).toBe(false);
  });

  it('siteProtocol', () => {
    expect(siteProtocol('http://localhost:3000')).toBe('http');
    expect(siteProtocol('https://kitto.app')).toBe('https');
  });
});
