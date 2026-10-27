import { randomUUID } from 'node:crypto';
import type { MpesaConfig } from './config';
import { darajaText, darajaTimestamp, stkPassword } from './format';

/**
 * The Daraja client: OAuth token + M-Pesa Express (STK push and query).
 *
 *   sandbox     https://sandbox.safaricom.co.ke (test credentials, no real money)
 *   production  https://api.safaricom.co.ke
 *   mock        no network at all: returns fake ids. ./request.ts then POSTs
 *               a realistic callback to the app's own route, so CI and demos
 *               exercise the real callback path without a public URL.
 */

export const DARAJA_BASE_URL = {
  sandbox: 'https://sandbox.safaricom.co.ke',
  production: 'https://api.safaricom.co.ke',
} as const;

export class DarajaError extends Error {
  override name = 'DarajaError';
}

export interface StkPushRequest {
  /** Daraja format, 2547XXXXXXXX. */
  phone: string;
  /** Whole shillings. */
  amountKes: number;
  accountReference: string;
  description: string;
  callbackUrl: string;
}

export interface StkPushResult {
  merchantRequestId: string;
  checkoutRequestId: string;
}

export interface StkQueryResult {
  /** null while the customer has not answered yet. */
  resultCode: number | null;
  resultDesc: string;
}

export interface DarajaClient {
  readonly mode: 'mock' | 'sandbox' | 'production';
  stkPush(req: StkPushRequest): Promise<StkPushResult>;
  stkQuery(checkoutRequestId: string): Promise<StkQueryResult>;
}

export interface DarajaDeps {
  fetch?: typeof fetch;
  now?: () => Date;
}

export function createDarajaClient(
  config: Exclude<MpesaConfig, { mode: 'disabled' }>,
  deps: DarajaDeps = {},
): DarajaClient {
  if (config.mode === 'mock') {
    return {
      mode: 'mock',
      stkPush: async () => ({
        merchantRequestId: `mock-mr-${randomUUID()}`,
        checkoutRequestId: `ws_CO_MOCK_${randomUUID().replace(/-/g, '')}`,
      }),
      stkQuery: async () => ({ resultCode: null, resultDesc: 'Mock mode settles by callback' }),
    };
  }
  return liveClient(config, deps);
}

function liveClient(
  config: Extract<MpesaConfig, { mode: 'sandbox' | 'production' }>,
  deps: DarajaDeps,
): DarajaClient {
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? (() => new Date());
  const base = DARAJA_BASE_URL[config.mode];
  // One token per client, reused until a minute before it expires.
  let token: { value: string; expiresAt: number } | undefined;

  async function accessToken(): Promise<string> {
    if (token && token.expiresAt > now().getTime()) return token.value;
    const basic = Buffer.from(`${config.consumerKey}:${config.consumerSecret}`).toString('base64');
    const res = await doFetch(`${base}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: { Authorization: `Basic ${basic}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new DarajaError(`Daraja OAuth failed (${res.status})`);
    const body = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: string | number;
    };
    if (!body.access_token) throw new DarajaError('Daraja OAuth returned no token');
    const ttl = Number(body.expires_in ?? 3599);
    token = { value: body.access_token, expiresAt: now().getTime() + (ttl - 60) * 1000 };
    return token.value;
  }

  async function post(path: string, payload: Record<string, unknown>) {
    const bearer = await accessToken();
    const res = await doFetch(`${base}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify(payload),
    });
    if (res.status === 401) token = undefined;
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { res, body };
  }

  const security = () => {
    const timestamp = darajaTimestamp(now());
    return {
      BusinessShortCode: config.shortcode,
      Password: stkPassword(config.shortcode, config.passkey, timestamp),
      Timestamp: timestamp,
    };
  };

  return {
    mode: config.mode,

    async stkPush(req) {
      const { res, body } = await post('/mpesa/stkpush/v1/processrequest', {
        ...security(),
        TransactionType: 'CustomerPayBillOnline',
        Amount: req.amountKes,
        PartyA: req.phone,
        PartyB: config.shortcode,
        PhoneNumber: req.phone,
        CallBackURL: req.callbackUrl,
        AccountReference: darajaText(req.accountReference, 12),
        TransactionDesc: darajaText(req.description, 13),
      });
      const merchant = body.MerchantRequestID;
      const checkout = body.CheckoutRequestID;
      if (
        !res.ok ||
        String(body.ResponseCode) !== '0' ||
        typeof merchant !== 'string' ||
        typeof checkout !== 'string'
      ) {
        // Never log the request: it holds the password. Daraja's error text is safe.
        const reason =
          typeof body.errorMessage === 'string' ? body.errorMessage : `HTTP ${res.status}`;
        throw new DarajaError(`Daraja STK push rejected: ${reason}`);
      }
      return { merchantRequestId: merchant, checkoutRequestId: checkout };
    },

    async stkQuery(checkoutRequestId) {
      const { res, body } = await post('/mpesa/stkpushquery/v1/query', {
        ...security(),
        CheckoutRequestID: checkoutRequestId,
      });
      // "The transaction is being processed" comes back as an error code.
      if (body.errorCode === '500.001.1001') {
        return { resultCode: null, resultDesc: String(body.errorMessage ?? 'Pending') };
      }
      if (!res.ok || body.ResultCode === undefined) {
        const reason =
          typeof body.errorMessage === 'string' ? body.errorMessage : `HTTP ${res.status}`;
        throw new DarajaError(`Daraja STK query failed: ${reason}`);
      }
      return { resultCode: Number(body.ResultCode), resultDesc: String(body.ResultDesc ?? '') };
    },
  };
}
