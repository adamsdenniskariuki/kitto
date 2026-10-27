import type { NextConfig } from 'next';

/**
 * Headers for every response. A full script CSP needs per-request nonces (and
 * gives up static rendering), so this sets the directives that are safe with
 * Next's inline scripts: no framing, no <base>/<object> tricks, and forms may
 * only post back to this site (or a tenant subdomain of it).
 */
const root = process.env.NEXT_PUBLIC_ROOT_DOMAIN;
const formAction = root ? `'self' *.${root.split(':')[0]}` : "'self'";

const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: `frame-ancestors 'none'; base-uri 'self'; form-action ${formAction}; object-src 'none'`,
  },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), usb=()' },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Kitto packages ship TypeScript source; Next compiles them.
  transpilePackages: [
    '@kitto/core',
    '@kitto/ui',
    '@kitto/auth',
    '@kitto/admin',
    '@kitto/customers',
    '@kitto/booking',
    '@kitto/billing',
    '@kitto/mpesa',
    '@kitto/inventory',
    '@kitto/orders',
    '@kitto/reports',
  ],
  // Rendered on the server only (invoice PDFs); keep it out of the bundle.
  serverExternalPackages: ['@react-pdf/renderer'],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
