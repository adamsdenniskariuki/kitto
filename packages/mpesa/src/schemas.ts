import { z } from 'zod';
import { toDarajaPhone } from './phone';

/** The "Request M-Pesa payment" form: amount in whole shillings, any common phone format. */
export const mpesaFormSchema = z.object({
  invoiceId: z.uuid(),
  phone: z
    .string()
    .trim()
    .transform((v, ctx) => {
      const phone = toDarajaPhone(v);
      if (!phone) {
        ctx.addIssue({ code: 'custom', message: 'phone' });
        return z.NEVER;
      }
      return phone;
    }),
  amount: z
    .string()
    .trim()
    .transform((v) => (v === '' ? Number.NaN : Number(v.replace(/,/g, ''))))
    .pipe(z.number().int().min(1).max(250_000)),
});

export type MpesaForm = z.output<typeof mpesaFormSchema>;
