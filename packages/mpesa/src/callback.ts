import 'server-only';
import { createAnonClient } from '@kitto/auth/server';
import { KittoError } from '@kitto/core';
import { recordCallback } from './data';
import { stkCallbackSchema } from './format';

const MAX_BODY_BYTES = 16 * 1024;

const reply = (status: number, ResultDesc: string) =>
  Response.json({ ResultCode: status === 200 ? 0 : 1, ResultDesc }, { status });

/**
 * Route handler for `app/api/mpesa/callback/[secret]/route.ts`:
 *   export const { POST } = createMpesaCallbackRoute();
 *
 * `secret` is the per-request token from the CallBackURL. The handler checks
 * the body's shape, then hands token and body to mpesa_record_callback (as
 * anon: no session, the token is the credential). Replays are acknowledged
 * without effect. Errors return 5xx only when retrying could help.
 */
export function createMpesaCallbackRoute() {
  return {
    async POST(
      request: Request,
      { params }: { params: Promise<{ secret: string }> },
    ): Promise<Response> {
      const { secret } = await params;
      if (!/^[A-Za-z0-9_-]{32,128}$/.test(secret)) return reply(404, 'Unknown request');

      const length = Number(request.headers.get('content-length') ?? 0);
      if (length > MAX_BODY_BYTES) return reply(413, 'Too large');
      const text = await request.text();
      if (text.length > MAX_BODY_BYTES) return reply(413, 'Too large');

      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        return reply(400, 'Invalid JSON');
      }
      const parsed = stkCallbackSchema.safeParse(json);
      if (!parsed.success) return reply(400, 'Invalid callback');

      try {
        await recordCallback(createAnonClient(), secret, json);
      } catch (e) {
        if (e instanceof KittoError && e.code === 'P0002') return reply(404, 'Unknown request');
        if (e instanceof KittoError && e.code === '22023') return reply(400, 'Invalid callback');
        console.error('M-Pesa callback failed', e instanceof Error ? e.message : e);
        return reply(500, 'Try again');
      }
      return reply(200, 'Accepted');
    },
  };
}
