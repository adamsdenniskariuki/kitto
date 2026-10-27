import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { after } from 'next/server';
import { KittoError, type KittoClient } from '@kitto/core';
import { readMpesaConfig, type MpesaConfig } from './config';
import { createDarajaClient, type DarajaClient } from './daraja';
import { attachCheckout, failRequest, startRequest } from './data';
import { buildStkCallback, minorToShillings, mockReceipt, mockResultCode } from './format';

/** Path the app mounts the callback route at; the token follows it. */
export const MPESA_CALLBACK_PATH = '/api/mpesa/callback';

/** A fresh unguessable token for one request's callback URL, and the hash the database keeps. */
export function newCallbackToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashCallbackToken(token) };
}

export function hashCallbackToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

// One client (and so one cached OAuth token) per server instance and config.
let cached: { key: string; client: DarajaClient } | undefined;
function clientFor(config: Exclude<MpesaConfig, { mode: 'disabled' }>): DarajaClient {
  const key = JSON.stringify(config);
  if (cached?.key !== key) cached = { key, client: createDarajaClient(config) };
  return cached.client;
}

/**
 * Sends an STK push for part or all of an invoice's balance:
 *   1. mpesa_start_request checks everything and stores a pending request;
 *   2. Daraja is asked to prompt the phone, with a per-request callback URL;
 *   3. its ids are attached, or the request is closed if Daraja refused.
 * In mock mode a successful (or, by phone number, failed) callback is POSTed
 * to the app's own callback route a second later.
 */
export async function requestMpesaPayment(
  db: KittoClient,
  input: { invoiceId: string; amountMinor: number; phone: string },
  config: MpesaConfig = readMpesaConfig(),
): Promise<string> {
  if (config.mode === 'disabled')
    throw new KittoError('M-Pesa is not configured', 'mpesa_disabled');
  const { token, hash } = newCallbackToken();
  const started = await startRequest(db, { ...input, tokenHash: hash });
  const callbackUrl = `${config.callbackBaseUrl}${MPESA_CALLBACK_PATH}/${token}`;
  const amountKes = minorToShillings(input.amountMinor);

  let ids;
  try {
    ids = await clientFor(config).stkPush({
      phone: input.phone,
      amountKes,
      accountReference: started.accountReference,
      description: started.description,
      callbackUrl,
    });
  } catch (e) {
    console.error('M-Pesa STK push failed', e instanceof Error ? e.message : e);
    await failRequest(db, started.requestId, -1, 'Daraja did not accept the request').catch(
      () => {},
    );
    throw new KittoError('M-Pesa rejected the request', 'mpesa_rejected');
  }
  await attachCheckout(db, started.requestId, ids);

  if (config.mode === 'mock') {
    // after() runs once the response is sent, like a phone answering a moment later.
    after(async () => {
      await sleep(1000);
      const body = buildStkCallback({
        ...ids,
        resultCode: mockResultCode(input.phone),
        amountKes,
        phone: input.phone,
        receipt: mockReceipt(),
      });
      await fetch(callbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).catch((error: unknown) => console.error('Mock M-Pesa callback failed', error));
    });
  }
  return started.requestId;
}
