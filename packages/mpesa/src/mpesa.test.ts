import { describe, expect, it } from 'vitest';
import { KittoError } from '@kitto/core';
import { MpesaConfigError, mpesaMode, readMpesaConfig } from './config';
import { createDarajaClient, DarajaError } from './daraja';
import {
  buildStkCallback,
  darajaText,
  darajaTimestamp,
  minorToShillings,
  mockReceipt,
  mockResultCode,
  resultMessage,
  stkCallbackSchema,
  stkPassword,
} from './format';
import { formatDarajaPhone, maskDarajaPhone, toDarajaPhone } from './phone';
import { mpesaFormSchema } from './schemas';
import { mpesaErrorCode } from './shared';

describe('toDarajaPhone', () => {
  it.each([
    ['0712345678', '254712345678'],
    ['0712 345 678', '254712345678'],
    ['712345678', '254712345678'],
    ['+254712345678', '254712345678'],
    ['+254-712-345-678', '254712345678'],
    ['254712345678', '254712345678'],
    ['0110 123 456', '254110123456'],
    [' (0712) 345678 ', '254712345678'],
  ])('%s -> %s', (input, out) => expect(toDarajaPhone(input)).toBe(out));

  it.each([
    '',
    '0201234567',
    '+255712345678',
    '07123456789',
    '071234567',
    'phone',
    '2540712345678',
  ])('rejects %j', (input) => expect(toDarajaPhone(input)).toBeNull());

  it('formats and masks', () => {
    expect(formatDarajaPhone('254712345678')).toBe('+254 712 345 678');
    expect(maskDarajaPhone('254712345678')).toBe('+254 7•• ••• 678');
    expect(maskDarajaPhone('x')).toBe('•••');
  });
});

describe('Daraja formats', () => {
  it('stamps in Nairobi time (UTC+3)', () => {
    expect(darajaTimestamp(new Date('2026-01-31T22:15:09Z'))).toBe('20260201011509');
  });

  it('builds the STK password', () => {
    expect(stkPassword('174379', 'passkey', '20260101000000')).toBe(
      Buffer.from('174379passkey20260101000000').toString('base64'),
    );
  });

  it('cleans account references', () => {
    expect(darajaText('INV-00012 (Acme)', 12)).toBe('INV00012 Acm');
    expect(darajaText('—', 12)).toBe('Kitto');
  });

  it('converts whole shillings only', () => {
    expect(minorToShillings(150_000)).toBe(1500);
    expect(() => minorToShillings(150_050)).toThrow(RangeError);
    expect(() => minorToShillings(0)).toThrow(RangeError);
  });

  it('builds callbacks the schema accepts', () => {
    const ok = buildStkCallback({
      merchantRequestId: 'm',
      checkoutRequestId: 'c',
      resultCode: 0,
      amountKes: 10,
      receipt: 'KTOABC1234',
    });
    expect(stkCallbackSchema.safeParse(ok).success).toBe(true);
    expect(ok.Body.stkCallback.CallbackMetadata?.Item).toContainEqual({
      Name: 'Amount',
      Value: 10,
    });
    const cancelled = buildStkCallback({
      merchantRequestId: 'm',
      checkoutRequestId: 'c',
      resultCode: 1032,
    });
    expect(cancelled.Body.stkCallback.CallbackMetadata).toBeUndefined();
    expect(stkCallbackSchema.safeParse({ Body: {} }).success).toBe(false);
    expect(
      stkCallbackSchema.safeParse({
        Body: {
          stkCallback: {
            MerchantRequestID: 'm',
            CheckoutRequestID: 'c',
            ResultCode: '0',
            ResultDesc: '',
          },
        },
      }).success,
    ).toBe(false);
  });

  it('picks mock outcomes and receipts', () => {
    expect(mockResultCode('254700001032')).toBe(1032);
    expect(mockResultCode('254700000001')).toBe(1);
    expect(mockResultCode('254712345678')).toBe(0);
    expect(mockReceipt(() => 0)).toBe('KTOAAAAAAA');
    expect(mockReceipt()).toMatch(/^KTO[A-Z2-9]{7}$/);
  });

  it('describes outcomes', () => {
    expect(resultMessage('succeeded')).toBe('Paid');
    expect(resultMessage('failed', 'Insufficient funds')).toBe('Not paid: Insufficient funds');
    expect(resultMessage('failed')).toBe('Not paid');
  });
});

describe('config', () => {
  const full = {
    MPESA_ENV: 'sandbox',
    MPESA_CONSUMER_KEY: 'k',
    MPESA_CONSUMER_SECRET: 's',
    MPESA_SHORTCODE: '174379',
    MPESA_PASSKEY: 'p',
    MPESA_CALLBACK_BASE_URL: 'https://example.com/',
  };

  it('is disabled unless MPESA_ENV is set', () => {
    expect(mpesaMode({})).toBe('disabled');
    expect(mpesaMode({ MPESA_ENV: 'live' })).toBe('disabled');
    expect(readMpesaConfig({})).toEqual({ mode: 'disabled' });
  });

  it('needs no credentials in mock mode', () => {
    expect(readMpesaConfig({ MPESA_ENV: 'MOCK' })).toEqual({
      mode: 'mock',
      callbackBaseUrl: 'http://localhost:3000',
    });
    expect(
      readMpesaConfig({ MPESA_ENV: 'mock', NEXT_PUBLIC_SITE_URL: 'https://a.test' }),
    ).toMatchObject({
      callbackBaseUrl: 'https://a.test',
    });
  });

  it('refuses mock mode on a Vercel production deployment', () => {
    expect(() => readMpesaConfig({ MPESA_ENV: 'mock', VERCEL_ENV: 'production' })).toThrow(
      /not allowed in production/,
    );
    expect(readMpesaConfig({ MPESA_ENV: 'mock', VERCEL_ENV: 'preview' }).mode).toBe('mock');
  });

  it('requires credentials and https for Daraja', () => {
    expect(readMpesaConfig(full)).toMatchObject({
      mode: 'sandbox',
      callbackBaseUrl: 'https://example.com',
    });
    expect(() => readMpesaConfig({ ...full, MPESA_PASSKEY: '' })).toThrow(/MPESA_PASSKEY/);
    expect(() => readMpesaConfig({ ...full, MPESA_CALLBACK_BASE_URL: 'http://x.test' })).toThrow(
      MpesaConfigError,
    );
  });
});

describe('Daraja client', () => {
  const config = {
    mode: 'sandbox' as const,
    consumerKey: 'key',
    consumerSecret: 'secret',
    shortcode: '174379',
    passkey: 'pass',
    callbackBaseUrl: 'https://example.com',
  };
  const push = {
    phone: '254712345678',
    amountKes: 10,
    accountReference: 'INV00001',
    description: 'Invoice INV-00001',
    callbackUrl: 'https://example.com/api/mpesa/callback/token',
  };

  function fakeFetch(responses: Record<string, () => Response>) {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const fn = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, init });
      const key = Object.keys(responses).find((k) => u.includes(k));
      if (!key) throw new Error(`unexpected ${u}`);
      return responses[key]!();
    }) as typeof fetch;
    return { fn, calls };
  }

  it('mock mode never touches the network', async () => {
    const client = createDarajaClient({ mode: 'mock', callbackBaseUrl: 'http://localhost:3000' });
    const ids = await client.stkPush(push);
    expect(ids.checkoutRequestId).toMatch(/^ws_CO_MOCK_/);
    expect(ids.merchantRequestId).toMatch(/^mock-mr-/);
    expect((await client.stkQuery('x')).resultCode).toBeNull();
  });

  it('authenticates once and sends the STK push', async () => {
    const { fn, calls } = fakeFetch({
      '/oauth/': () => Response.json({ access_token: 'tok', expires_in: '3599' }),
      '/stkpush/': () =>
        Response.json({ ResponseCode: '0', MerchantRequestID: 'mr1', CheckoutRequestID: 'co1' }),
    });
    const client = createDarajaClient(config, {
      fetch: fn,
      now: () => new Date('2026-01-01T00:00:00Z'),
    });
    expect(await client.stkPush(push)).toEqual({
      merchantRequestId: 'mr1',
      checkoutRequestId: 'co1',
    });
    await client.stkPush(push);
    expect(calls.filter((c) => c.url.includes('/oauth/'))).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
    );
    const body = JSON.parse(String(calls[1]!.init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      BusinessShortCode: '174379',
      Timestamp: '20260101030000',
      Password: Buffer.from('174379pass20260101030000').toString('base64'),
      TransactionType: 'CustomerPayBillOnline',
      Amount: 10,
      PartyA: '254712345678',
      PartyB: '174379',
      CallBackURL: push.callbackUrl,
      AccountReference: 'INV00001',
      TransactionDesc: 'Invoice INV00',
    });
    expect((calls[1]!.init?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('reports rejections without leaking the request', async () => {
    const { fn } = fakeFetch({
      '/oauth/': () => Response.json({ access_token: 'tok' }),
      '/stkpush/': () => Response.json({ errorMessage: 'Invalid PhoneNumber' }, { status: 400 }),
    });
    const client = createDarajaClient(config, { fetch: fn });
    await expect(client.stkPush(push)).rejects.toThrow(
      new DarajaError('Daraja STK push rejected: Invalid PhoneNumber'),
    );
  });

  it('fails clearly when OAuth fails', async () => {
    const { fn } = fakeFetch({ '/oauth/': () => new Response('no', { status: 401 }) });
    await expect(createDarajaClient(config, { fetch: fn }).stkPush(push)).rejects.toThrow(
      /OAuth failed \(401\)/,
    );
  });

  it('queries a push', async () => {
    const { fn } = fakeFetch({
      '/oauth/': () => Response.json({ access_token: 'tok' }),
      '/stkpushquery/': () =>
        Response.json({ ResultCode: '1032', ResultDesc: 'Request cancelled by user' }),
    });
    expect(await createDarajaClient(config, { fetch: fn }).stkQuery('co1')).toEqual({
      resultCode: 1032,
      resultDesc: 'Request cancelled by user',
    });
    const pending = fakeFetch({
      '/oauth/': () => Response.json({ access_token: 'tok' }),
      '/stkpushquery/': () =>
        Response.json(
          { errorCode: '500.001.1001', errorMessage: 'The transaction is being processed' },
          { status: 500 },
        ),
    });
    expect(
      (await createDarajaClient(config, { fetch: pending.fn }).stkQuery('co1')).resultCode,
    ).toBeNull();
  });
});

describe('forms and errors', () => {
  const id = '7d1d6c34-5b8e-4d2c-9a43-2f6f0e1c9b11';
  it('parses the request form', () => {
    expect(
      mpesaFormSchema.parse({ invoiceId: id, phone: '0712 345 678', amount: '1,500' }),
    ).toEqual({
      invoiceId: id,
      phone: '254712345678',
      amount: 1500,
    });
    const bad = mpesaFormSchema.safeParse({ invoiceId: id, phone: '020 123 4567', amount: '10' });
    expect(bad.success ? null : bad.error.issues[0]?.path).toEqual(['phone']);
    expect(
      mpesaFormSchema.safeParse({ invoiceId: id, phone: '0712345678', amount: '10.5' }).success,
    ).toBe(false);
    expect(
      mpesaFormSchema.safeParse({ invoiceId: id, phone: '0712345678', amount: '250001' }).success,
    ).toBe(false);
  });

  it.each([
    [new KittoError('M-Pesa payments must be in KES', '22023'), 'currency'],
    [new KittoError('Invalid M-Pesa phone number', '22023'), 'phone'],
    [
      new KittoError('M-Pesa amounts are whole shillings between 1 and 250,000', '22023'),
      'mpesa_amount',
    ],
    [new KittoError('already waiting', '55000'), 'pending'],
    [new KittoError('Too many payment requests', '54000'), 'rate_limited'],
    [new KittoError('M-Pesa is not configured', 'mpesa_disabled'), 'mpesa_disabled'],
    [new KittoError('M-Pesa rejected the request', 'mpesa_rejected'), 'mpesa_rejected'],
    [new KittoError('Payment exceeds the balance due', '22023'), 'overpayment'],
    [
      new KittoError('Payments can only be recorded against issued, unpaid invoices', '22023'),
      'not_payable',
    ],
    [new KittoError('denied', '42501'), 'forbidden'],
  ])('maps %s', (e, code) => expect(mpesaErrorCode(e)).toBe(code));
});
