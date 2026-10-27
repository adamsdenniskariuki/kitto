import { createMpesaCallbackRoute } from '@kitto/mpesa/callback';

/**
 * Daraja STK push results land here. `secret` is a per-request random token
 * (only its hash is stored), so the URL itself authenticates the callback.
 * The proxy (src/proxy.ts) skips /api/mpesa/: no session or tenant needed.
 */
export const dynamic = 'force-dynamic';

export const { POST } = createMpesaCallbackRoute();
