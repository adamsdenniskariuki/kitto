/**
 * Turn an untrusted "next" value (query string, email link) into a safe
 * redirect target. Prevents open redirects such as ?next=https://evil.example.
 *
 * Same-origin URLs become a path. In subdomain mode, URLs on a tenant
 * subdomain of `rootDomain` (same protocol) are allowed and returned whole,
 * because sign-in happens on the root domain.
 */
export function safeNextPath(
  next: string | null | undefined,
  origin: string,
  fallback = '/',
  rootDomain?: string,
): string {
  if (!next) return fallback;
  try {
    const base = new URL(origin);
    const url = new URL(next, base);
    // Reject protocol-relative tricks such as "//evil.example" or "/\evil".
    if (/^[/\\]{2}/.test(next) || /^\/\\/.test(next)) return fallback;
    if (url.origin === base.origin) {
      const path = url.pathname + url.search;
      return path.startsWith('//') ? fallback : path;
    }
    if (rootDomain && url.protocol === base.protocol) {
      const root = rootDomain.toLowerCase();
      const host = url.host.toLowerCase();
      const sub = host.endsWith(`.${root}`) ? host.slice(0, -(root.length + 1)) : '';
      if (/^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/.test(sub)) return url.toString();
    }
    return fallback;
  } catch {
    return fallback;
  }
}
