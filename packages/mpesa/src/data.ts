import { KittoError, unwrap, type KittoClient, type Tables } from '@kitto/core';

export type MpesaRequest = Tables<'mpesa_requests'>;

/** What staff see about a request: no token hash, no raw payload. */
export type MpesaRequestRow = Pick<
  MpesaRequest,
  | 'id'
  | 'invoice_id'
  | 'amount_minor'
  | 'phone'
  | 'status'
  | 'result_desc'
  | 'receipt'
  | 'created_at'
  | 'completed_at'
>;

export async function listMpesaRequests(
  db: KittoClient,
  invoiceId: string,
  limit = 10,
): Promise<MpesaRequestRow[]> {
  return unwrap(
    await db
      .from('mpesa_requests')
      .select(
        'id, invoice_id, amount_minor, phone, status, result_desc, receipt, created_at, completed_at',
      )
      .eq('invoice_id', invoiceId)
      .order('created_at', { ascending: false })
      .limit(limit),
  );
}

export interface StartedRequest {
  requestId: string;
  accountReference: string;
  description: string;
}

/** Validates the invoice, amount and phone in SQL and stores a pending request. */
export async function startRequest(
  db: KittoClient,
  input: { invoiceId: string; amountMinor: number; phone: string; tokenHash: string },
): Promise<StartedRequest> {
  const rows = unwrap(
    await db.rpc('mpesa_start_request', {
      p_invoice_id: input.invoiceId,
      p_amount_minor: input.amountMinor,
      p_phone: input.phone,
      p_token_hash: input.tokenHash,
    }),
  );
  const row = rows[0];
  if (!row) throw new KittoError('Payment request not created', 'P0002');
  return {
    requestId: row.request_id,
    accountReference: row.account_reference,
    description: row.description,
  };
}

export async function attachCheckout(
  db: KittoClient,
  requestId: string,
  ids: { checkoutRequestId: string; merchantRequestId: string },
): Promise<void> {
  const res = await db.rpc('mpesa_attach_checkout', {
    p_request_id: requestId,
    p_checkout_request_id: ids.checkoutRequestId,
    p_merchant_request_id: ids.merchantRequestId,
  });
  if (res.error) throw new KittoError(res.error.message, res.error.code);
}

export async function failRequest(
  db: KittoClient,
  requestId: string,
  resultCode: number,
  resultDesc: string,
): Promise<string> {
  return unwrap(
    await db.rpc('mpesa_fail_request', {
      p_request_id: requestId,
      p_result_code: resultCode,
      p_result_desc: resultDesc,
    }),
  );
}

/** Applies a Daraja callback. Callable without a session (anon); the token is the credential. */
export async function recordCallback(
  db: KittoClient,
  token: string,
  payload: unknown,
): Promise<string> {
  return unwrap(
    await db.rpc('mpesa_record_callback', {
      p_token: token,
      p_payload: payload as never,
    }),
  );
}
