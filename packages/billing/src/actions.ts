'use server';

import { z } from 'zod';
import { formString, runTenantAction } from '@kitto/auth/server';
import { toMinorUnits } from '@kitto/core';
import {
  convertQuote,
  deleteDraft,
  draftInvoiceForSource,
  issueInvoice,
  recordPayment,
  saveInvoiceDraft,
  voidInvoice,
  type LineInput,
} from './data';
import { BILLING_PERMISSIONS as P } from './permissions';
import {
  invoiceFormSchema,
  lineFormSchema,
  linesFromForm,
  paymentFormSchema,
  sourceSchema,
  toLineInput,
  voidFormSchema,
} from './schemas';
import { billingErrorCode } from './shared';

const idOf = (fd: FormData, key: string) => z.uuid().parse(formString(fd, key));

/** Tenant-relative path to come back to, e.g. "/bookings/<id>"; anything else is ignored. */
const returnPath = (fd: FormData) => {
  const v = formString(fd, 'returnTo');
  return /^\/[A-Za-z0-9/_-]{0,200}$/.test(v) && !v.startsWith('//') ? v : null;
};

const toMinorLines = (
  lines: readonly z.output<typeof lineFormSchema>[],
  currency: string,
): LineInput[] =>
  lines.map((l) => ({
    description: l.description,
    quantity: l.quantity,
    unitPriceMinor: toMinorUnits(l.unitPrice, currency),
    taxRateBp: l.taxRateBp,
  }));

function parseDraft(fd: FormData) {
  return invoiceFormSchema.safeParse({
    kind: formString(fd, 'kind') || 'invoice',
    customerId: formString(fd, 'customerId'),
    dueDate: formString(fd, 'dueDate'),
    notes: formString(fd, 'notes'),
    lines: linesFromForm(fd).map(toLineInput),
  });
}

const draftError = (error: z.ZodError) =>
  error.issues[0]?.path[0] === 'lines'
    ? error.issues[0].path.length === 1
      ? 'no_lines'
      : 'invalid_lines'
    : 'invalid';

export async function createInvoiceAction(formData: FormData): Promise<void> {
  const kind = formString(formData, 'kind') === 'quote' ? 'quote' : 'invoice';
  await runTenantAction(
    formData,
    P.create,
    `/invoices/new?kind=${kind}`,
    async (ctx) => {
      const parsed = parseDraft(formData);
      if (!parsed.success) return { error: draftError(parsed.error) };
      const { lines, ...rest } = parsed.data;
      const id = await saveInvoiceDraft(ctx.db, ctx.tenant.id, {
        ...rest,
        lines: toMinorLines(lines, ctx.tenant.currency),
      });
      return { notice: 'created', path: `/invoices/${id}` };
    },
    billingErrorCode,
  );
}

export async function updateInvoiceAction(formData: FormData): Promise<void> {
  const id = idOf(formData, 'invoiceId');
  await runTenantAction(
    formData,
    P.create,
    `/invoices/${id}/edit`,
    async (ctx) => {
      const parsed = parseDraft(formData);
      if (!parsed.success) return { error: draftError(parsed.error) };
      const { lines, ...rest } = parsed.data;
      await saveInvoiceDraft(ctx.db, ctx.tenant.id, {
        ...rest,
        invoiceId: id,
        lines: toMinorLines(lines, ctx.tenant.currency),
      });
      return { notice: 'saved', path: `/invoices/${id}` };
    },
    billingErrorCode,
  );
}

export async function issueInvoiceAction(formData: FormData): Promise<void> {
  const id = idOf(formData, 'invoiceId');
  await runTenantAction(
    formData,
    P.issue,
    `/invoices/${id}`,
    async (ctx) => {
      await issueInvoice(ctx.db, id);
      return { notice: 'issued' };
    },
    billingErrorCode,
  );
}

export async function voidInvoiceAction(formData: FormData): Promise<void> {
  const id = idOf(formData, 'invoiceId');
  await runTenantAction(
    formData,
    P.void,
    `/invoices/${id}`,
    async (ctx) => {
      const parsed = voidFormSchema.safeParse({ reason: formString(formData, 'reason') });
      if (!parsed.success) return { error: 'void_reason' };
      await voidInvoice(ctx.db, id, parsed.data.reason);
      return { notice: 'voided' };
    },
    billingErrorCode,
  );
}

export async function convertQuoteAction(formData: FormData): Promise<void> {
  const id = idOf(formData, 'invoiceId');
  await runTenantAction(
    formData,
    P.issue,
    `/invoices/${id}`,
    async (ctx) => {
      const invoiceId = await convertQuote(ctx.db, id);
      return { notice: 'converted', path: `/invoices/${invoiceId}` };
    },
    billingErrorCode,
  );
}

export async function deleteInvoiceAction(formData: FormData): Promise<void> {
  const id = idOf(formData, 'invoiceId');
  await runTenantAction(
    formData,
    P.create,
    `/invoices/${id}`,
    async (ctx) => {
      await deleteDraft(ctx.db, id);
      return { notice: 'deleted', path: '/invoices' };
    },
    billingErrorCode,
  );
}

export async function recordPaymentAction(formData: FormData): Promise<void> {
  const id = idOf(formData, 'invoiceId');
  await runTenantAction(
    formData,
    P.record,
    `/invoices/${id}`,
    async (ctx) => {
      const parsed = paymentFormSchema.safeParse({
        amount: formString(formData, 'amount'),
        method: formString(formData, 'method') || 'cash',
        reference: formString(formData, 'reference'),
        note: formString(formData, 'note'),
      });
      if (!parsed.success) return { error: 'invalid_payment' };
      const { amount, ...rest } = parsed.data;
      await recordPayment(ctx.db, ctx.tenant.id, id, {
        ...rest,
        amountMinor: toMinorUnits(amount, ctx.tenant.currency),
      });
      return { notice: 'payment_recorded' };
    },
    billingErrorCode,
  );
}

/**
 * Bill a record from another module (see SourceInvoices). The suggested lines
 * arrive as form fields, which is fine: anyone allowed to run this can create
 * any draft anyway, and staff review the draft before issuing it.
 */
export async function invoiceSourceAction(formData: FormData): Promise<void> {
  const back = returnPath(formData) ?? '/invoices';
  await runTenantAction(
    formData,
    P.create,
    back,
    async (ctx) => {
      const source = sourceSchema.safeParse({
        type: formString(formData, 'sourceType'),
        id: formString(formData, 'sourceId'),
      });
      const customerId = z
        .union([z.literal('').transform(() => null), z.uuid()])
        .safeParse(formString(formData, 'customerId'));
      const lines = z
        .array(lineFormSchema)
        .min(1)
        .max(100)
        .safeParse(linesFromForm(formData).map(toLineInput));
      if (!source.success || !customerId.success) return { error: 'invalid' };
      if (!lines.success) return { error: 'invalid_lines' };
      const id = await draftInvoiceForSource(ctx.db, ctx.tenant.id, {
        source: source.data,
        customerId: customerId.data,
        lines: toMinorLines(lines.data, ctx.tenant.currency),
      });
      return { notice: 'source_invoiced', path: `/invoices/${id}` };
    },
    billingErrorCode,
  );
}
