/**
 * Document kinds and statuses, mirroring the CHECK constraints in the billing
 * migration. Status is derived in SQL (issue/void functions and the payment
 * trigger); these helpers only label it and decide which buttons to show.
 */
export const DOCUMENT_KINDS = ['invoice', 'quote'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const DOCUMENT_STATUSES = [
  'draft',
  'issued',
  'partially_paid',
  'paid',
  'accepted',
  'void',
] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const PAYMENT_METHODS = ['cash', 'mpesa', 'card', 'bank', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  mpesa: 'M-Pesa',
  card: 'Card',
  bank: 'Bank transfer',
  other: 'Other',
};

export const KIND_LABELS: Record<DocumentKind, string> = { invoice: 'Invoice', quote: 'Quote' };

const STATUS_LABELS: Record<DocumentStatus, string> = {
  draft: 'Draft',
  issued: 'Issued',
  partially_paid: 'Part paid',
  paid: 'Paid',
  accepted: 'Accepted',
  void: 'Void',
};

export const STATUS_TONES: Record<
  DocumentStatus,
  'neutral' | 'brand' | 'success' | 'warning' | 'danger'
> = {
  draft: 'neutral',
  issued: 'brand',
  partially_paid: 'warning',
  paid: 'success',
  accepted: 'success',
  void: 'danger',
};

export function isDocumentKind(v: string): v is DocumentKind {
  return (DOCUMENT_KINDS as readonly string[]).includes(v);
}

export function isDocumentStatus(v: string): v is DocumentStatus {
  return (DOCUMENT_STATUSES as readonly string[]).includes(v);
}

/** "Sent" reads better than "Issued" for a quote the customer hasn't answered yet. */
export function statusLabel(kind: string, status: string): string {
  if (kind === 'quote' && status === 'issued') return 'Sent';
  return isDocumentStatus(status) ? STATUS_LABELS[status] : status;
}

type Doc = { kind: string; status: string; paid_minor: number };

/** Only invoices that are issued and not yet fully paid take payments. */
export const isPayable = (d: Doc) =>
  d.kind === 'invoice' && (d.status === 'issued' || d.status === 'partially_paid');

/** Voiding is for issued documents with no money against them. */
export const canVoid = (d: Doc) => d.status === 'issued' && d.paid_minor === 0;

export const canConvert = (d: Doc) => d.kind === 'quote' && d.status === 'issued';
