import { createKittoProxy } from '@kitto/auth/proxy';

export const proxy = createKittoProxy();

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/mpesa/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
