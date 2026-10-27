'use server';

import { formString, runTenantAction } from '@kitto/auth/server';
import { MPESA_PERMISSIONS as P } from './permissions';
import { requestMpesaPayment } from './request';
import { mpesaFormSchema } from './schemas';
import { mpesaErrorCode } from './shared';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Sends an STK push to the customer's phone for (part of) an invoice's balance. */
export async function requestMpesaAction(formData: FormData): Promise<void> {
  const invoiceId = formString(formData, 'invoiceId');
  await runTenantAction(
    formData,
    P.request,
    UUID.test(invoiceId) ? `/invoices/${invoiceId}` : '/invoices',
    async (ctx) => {
      const parsed = mpesaFormSchema.safeParse({
        invoiceId,
        phone: formString(formData, 'phone'),
        amount: formString(formData, 'amount'),
      });
      if (!parsed.success) {
        const field = parsed.error.issues[0]?.path[0];
        return {
          error: field === 'phone' ? 'phone' : field === 'amount' ? 'mpesa_amount' : 'invalid',
        };
      }
      await requestMpesaPayment(ctx.db, {
        invoiceId: parsed.data.invoiceId,
        amountMinor: parsed.data.amount * 100,
        phone: parsed.data.phone,
      });
      return { notice: 'mpesa_sent' };
    },
    mpesaErrorCode,
  );
}
