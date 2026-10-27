import { KittoError, unwrap, type KittoClient, type Tables } from '@kitto/core';
import type { BillingSource } from './schemas';
import type { DocumentKind, PaymentMethod } from './status';

export type Invoice = Tables<'invoices'>;
type GeneratedLineAmounts = 'line_subtotal_minor' | 'line_tax_minor' | 'line_total_minor';
/** Generated (stored, not-null inputs) columns are never null, whatever the types say. */
export type InvoiceLine = Omit<Tables<'invoice_lines'>, GeneratedLineAmounts> &
  Record<GeneratedLineAmounts, number>;
export type Payment = Tables<'payments'>;

/** A document with who it is for, as the pages show it. */
export type InvoiceRow = Invoice & {
  customer: { id: string; name: string; phone: string | null; email: string | null } | null;
};

const INVOICE_SELECT = '*, customer:customers(id, name, phone, email)' as const;

/** A line in minor units, as the database stores it. */
export interface LineInput {
  description: string;
  quantity: number;
  unitPriceMinor: number;
  taxRateBp: number;
}

export interface InvoiceQuery {
  kind?: DocumentKind | undefined;
  status?: string | undefined;
  customerId?: string | undefined;
  source?: BillingSource | undefined;
  limit?: number;
}

export async function listInvoices(
  db: KittoClient,
  tenantId: string,
  q: InvoiceQuery = {},
): Promise<InvoiceRow[]> {
  let req = db.from('invoices').select(INVOICE_SELECT).eq('tenant_id', tenantId);
  if (q.kind) req = req.eq('kind', q.kind);
  if (q.status) req = req.eq('status', q.status);
  if (q.customerId) req = req.eq('customer_id', q.customerId);
  if (q.source) req = req.eq('source_type', q.source.type).eq('source_id', q.source.id);
  return unwrap(await req.order('created_at', { ascending: false }).limit(q.limit ?? 200));
}

export async function getInvoice(db: KittoClient, id: string): Promise<InvoiceRow | null> {
  const res = await db.from('invoices').select(INVOICE_SELECT).eq('id', id).maybeSingle();
  if (res.error) throw new KittoError(res.error.message, res.error.code);
  return res.data;
}

export async function listInvoiceLines(db: KittoClient, invoiceId: string): Promise<InvoiceLine[]> {
  const rows = unwrap(
    await db.from('invoice_lines').select('*').eq('invoice_id', invoiceId).order('position'),
  );
  return rows.map((r) => ({
    ...r,
    line_subtotal_minor: r.line_subtotal_minor ?? 0,
    line_tax_minor: r.line_tax_minor ?? 0,
    line_total_minor: r.line_total_minor ?? 0,
  }));
}

export async function listPayments(db: KittoClient, invoiceId: string): Promise<Payment[]> {
  return unwrap(
    await db.from('payments').select('*').eq('invoice_id', invoiceId).order('received_at'),
  );
}

const linesJson = (lines: readonly LineInput[]) =>
  lines.map((l) => ({
    description: l.description,
    quantity: l.quantity,
    unit_price_minor: l.unitPriceMinor,
    tax_rate_bp: l.taxRateBp,
  }));

// The generated RPC types mark every argument as required and non-null; SQL
// accepts NULL for these (meaning "new draft", "no customer", "no due date").
const nullable = (v: string | null) => v as string;

export interface DraftInput {
  kind: DocumentKind;
  customerId: string | null;
  dueDate: string | null;
  notes: string;
  lines: readonly LineInput[];
}

/** Create (no `invoiceId`) or replace a draft and its lines in one transaction. Returns its id. */
export async function saveInvoiceDraft(
  db: KittoClient,
  tenantId: string,
  input: DraftInput & { invoiceId?: string | null; source?: BillingSource | null },
): Promise<string> {
  return unwrap(
    await db.rpc('save_invoice_draft', {
      p_tenant_id: tenantId,
      p_invoice_id: nullable(input.invoiceId ?? null),
      p_kind: input.kind,
      p_customer_id: nullable(input.customerId),
      p_due_date: nullable(input.dueDate),
      p_notes: input.notes,
      p_lines: linesJson(input.lines),
      ...(input.source ? { p_source_type: input.source.type, p_source_id: input.source.id } : {}),
    }),
  );
}

/**
 * The bridge other modules use: one live invoice per source record (e.g. a
 * reservation). Returns the existing non-void invoice, or a new draft built
 * from `lines` for staff to review and issue.
 */
export async function draftInvoiceForSource(
  db: KittoClient,
  tenantId: string,
  input: { source: BillingSource; customerId: string | null; lines: readonly LineInput[] },
): Promise<string> {
  return unwrap(
    await db.rpc('draft_invoice_for_source', {
      p_tenant_id: tenantId,
      p_source_type: input.source.type,
      p_source_id: input.source.id,
      p_customer_id: nullable(input.customerId),
      p_lines: linesJson(input.lines),
    }),
  );
}

/** Assign the next gapless number and freeze the document. */
export async function issueInvoice(db: KittoClient, id: string): Promise<Invoice> {
  return unwrap(await db.rpc('issue_invoice', { p_invoice_id: id }));
}

export async function voidInvoice(db: KittoClient, id: string, reason: string): Promise<Invoice> {
  return unwrap(await db.rpc('void_invoice', { p_invoice_id: id, p_reason: reason }));
}

/** Accept an issued quote, copying it into a new draft invoice. Returns the invoice id. */
export async function convertQuote(db: KittoClient, quoteId: string): Promise<string> {
  return unwrap(await db.rpc('convert_quote', { p_quote_id: quoteId }));
}

/** Drafts are deleted, not voided (they never had a number). */
export async function deleteDraft(db: KittoClient, id: string): Promise<void> {
  const rows = unwrap(await db.from('invoices').delete().eq('id', id).select('id'));
  if (rows.length === 0) throw new KittoError('Only drafts can be edited', '22023');
}

export interface PaymentInput {
  amountMinor: number;
  method: PaymentMethod;
  reference: string | null;
  note: string;
}

/** Record a (part) payment. SQL locks the invoice, refuses overpayment and updates its status. */
export async function recordPayment(
  db: KittoClient,
  tenantId: string,
  invoiceId: string,
  input: PaymentInput,
): Promise<Payment> {
  return unwrap(
    await db
      .from('payments')
      .insert({
        tenant_id: tenantId,
        invoice_id: invoiceId,
        amount_minor: input.amountMinor,
        method: input.method,
        reference: input.reference,
        note: input.note,
      })
      .select()
      .single(),
  );
}

/** Amount still owed on an invoice (never negative). */
export const balanceDue = (i: Pick<Invoice, 'total_minor' | 'paid_minor'>) =>
  Math.max(0, i.total_minor - i.paid_minor);
