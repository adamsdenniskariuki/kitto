import 'server-only';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { flashMessages, formatDate, fromMinorUnits } from '@kitto/core';
import {
  param,
  requirePermission,
  type TenantContext,
  type TenantPageProps,
} from '@kitto/auth/server';
import { CUSTOMER_PERMISSIONS, customerOptions } from '@kitto/customers';
import {
  Badge,
  Card,
  DataTable,
  DateTime,
  EmptyState,
  Flash,
  Money,
  PageHeader,
  SectionHeading,
  SelectField,
  TenantField,
  TextField,
  TextareaField,
  buttonClass,
  cn,
} from '@kitto/ui';
import { ConfirmSubmit, SubmitButton } from '@kitto/ui/client';
import {
  convertQuoteAction,
  createInvoiceAction,
  deleteInvoiceAction,
  invoiceSourceAction,
  issueInvoiceAction,
  recordPaymentAction,
  updateInvoiceAction,
  voidInvoiceAction,
} from './actions';
import { BillingLiveRefresh, LineItemsEditor } from './client';
import {
  balanceDue,
  getInvoice,
  listInvoiceLines,
  listInvoices,
  listPayments,
  type InvoiceLine,
  type InvoiceRow,
  type LineInput,
} from './data';
import { formatTaxRate } from './math';
import { BILLING_PERMISSIONS as P } from './permissions';
import type { BillingSource, RawLine } from './schemas';
import { BILLING_ERRORS, BILLING_NOTICES } from './shared';
import {
  canConvert,
  canVoid,
  isDocumentKind,
  isDocumentStatus,
  isPayable,
  KIND_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  STATUS_TONES,
  statusLabel,
  type DocumentKind,
  type PaymentMethod,
} from './status';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Extra flash messages, e.g. from the M-Pesa module's actions on the invoice page. */
export interface FlashCatalog {
  notices?: Record<string, string>;
  errors?: Record<string, string>;
}

function flash(searchParams: TenantPageProps['searchParams'], extra: FlashCatalog = {}) {
  return (
    <Flash
      {...flashMessages(
        searchParams,
        { ...BILLING_NOTICES, ...extra.notices },
        { ...BILLING_ERRORS, ...extra.errors },
      )}
    />
  );
}

export function DocumentStatusBadge({ kind, status }: { kind: string; status: string }) {
  return (
    <Badge tone={isDocumentStatus(status) ? STATUS_TONES[status] : 'neutral'}>
      {statusLabel(kind, status)}
    </Badge>
  );
}

/** "INV-00012", or "Draft quote" before a number is assigned. */
export function documentTitle(d: { kind: string; number: string | null }): string {
  const kind = isDocumentKind(d.kind) ? KIND_LABELS[d.kind] : 'Document';
  return d.number ?? `Draft ${kind.toLowerCase()}`;
}

/** A calendar date (no time zone shift: dates are already tenant-local). */
function Day({ value, ctx }: { value: string | null; ctx: TenantContext }) {
  if (!value) return <>—</>;
  return (
    <time dateTime={value}>
      {formatDate(`${value}T12:00:00Z`, { ...ctx.tenant, timezone: 'UTC' })}
    </time>
  );
}

function billingHeader(
  ctx: TenantContext,
  title: ReactNode,
  description?: string,
  actions?: ReactNode,
) {
  return (
    <PageHeader
      eyebrow={
        <Link href={ctx.path('/invoices')} className="hover:underline">
          Invoices
        </Link>
      }
      title={title}
      description={description}
      actions={actions}
    />
  );
}

const sourceLabel = (type: string) =>
  type.charAt(0).toUpperCase() + type.slice(1).replace(/_/g, ' ');

// ------------------------------------------------------------------- list

const KIND_TABS: { kind: '' | DocumentKind; label: string }[] = [
  { kind: '', label: 'All' },
  { kind: 'invoice', label: 'Invoices' },
  { kind: 'quote', label: 'Quotes' },
];

export async function InvoicesPage({ ctx, searchParams }: TenantPageProps) {
  requirePermission(ctx, P.view);
  const kindParam = param(searchParams, 'kind');
  const kind = isDocumentKind(kindParam) ? kindParam : undefined;
  const rows = await listInvoices(ctx.db, ctx.tenant.id, { kind });
  const canCreate = ctx.can(P.create);

  return (
    <>
      <BillingLiveRefresh tenantId={ctx.tenant.id} table="invoices" />
      <PageHeader
        title="Invoices"
        description="Quotes, invoices and what is still owed."
        actions={
          canCreate && (
            <>
              <Link href={ctx.path('/invoices/new')} className={buttonClass('primary')}>
                New invoice
              </Link>
              <Link
                href={ctx.path('/invoices/new?kind=quote')}
                className={buttonClass('secondary')}
              >
                New quote
              </Link>
            </>
          )
        }
      />
      {flash(searchParams)}
      <nav aria-label="Document type" className="mb-4 flex flex-wrap gap-2">
        {KIND_TABS.map((t) => {
          const current = (kind ?? '') === t.kind;
          return (
            <Link
              key={t.label}
              href={ctx.path(t.kind ? `/invoices?kind=${t.kind}` : '/invoices')}
              aria-current={current ? 'page' : undefined}
              className={buttonClass(current ? 'primary' : 'ghost', 'sm')}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
      <DataTable
        caption={
          kind === 'quote' ? 'Quotes' : kind === 'invoice' ? 'Invoices' : 'Quotes and invoices'
        }
        hideCaption
        rows={rows}
        rowKey={(r) => r.id}
        empty={
          <EmptyState title={kind === 'quote' ? 'No quotes yet' : 'No invoices yet'}>
            Drafts get a number when you issue them.
          </EmptyState>
        }
        columns={[
          {
            key: 'number',
            header: 'Number',
            rowHeader: true,
            cell: (r) => (
              <Link
                href={ctx.path(`/invoices/${r.id}`)}
                className="underline-offset-2 hover:underline"
              >
                {documentTitle(r)}
              </Link>
            ),
          },
          {
            key: 'kind',
            header: 'Type',
            hideOnMobile: true,
            cell: (r) => (isDocumentKind(r.kind) ? KIND_LABELS[r.kind] : r.kind),
          },
          { key: 'customer', header: 'Customer', cell: (r) => r.customer?.name ?? '—' },
          {
            key: 'date',
            header: 'Date',
            hideOnMobile: true,
            cell: (r) => <Day value={r.issue_date} ctx={ctx} />,
          },
          {
            key: 'status',
            header: 'Status',
            cell: (r) => <DocumentStatusBadge kind={r.kind} status={r.status} />,
          },
          {
            key: 'total',
            header: 'Total',
            align: 'right',
            cell: (r) => <Money minor={r.total_minor} tenant={ctx.tenant} />,
          },
          {
            key: 'balance',
            header: 'Balance',
            align: 'right',
            hideOnMobile: true,
            cell: (r) =>
              r.kind === 'invoice' && r.status !== 'void' && r.status !== 'draft' ? (
                <Money minor={balanceDue(r)} tenant={ctx.tenant} />
              ) : (
                '—'
              ),
          },
        ]}
      />
    </>
  );
}

// ------------------------------------------------------------ draft form

const rawLine = (l: InvoiceLine, currency: string): RawLine => ({
  description: l.description,
  quantity: String(Number(l.quantity)),
  unitPrice: String(fromMinorUnits(l.unit_price_minor, currency)),
  taxRate: String(l.tax_rate_bp / 100),
});

async function DraftForm({
  ctx,
  kind,
  invoice,
  lines = [],
  customerId,
}: {
  ctx: TenantContext;
  kind: DocumentKind;
  invoice?: InvoiceRow;
  lines?: RawLine[];
  customerId?: string | null;
}) {
  const customers = ctx.can(CUSTOMER_PERMISSIONS.view)
    ? await customerOptions(ctx.db, ctx.tenant.id)
    : [];
  const current = invoice?.customer ?? null;
  if (current && !customers.some((c) => c.value === current.id)) {
    customers.unshift({ value: current.id, label: current.name });
  }
  const selected = invoice ? invoice.customer_id : (customerId ?? null);

  return (
    <form action={invoice ? updateInvoiceAction : createInvoiceAction} className="space-y-6">
      <TenantField slug={ctx.tenant.slug} />
      <input type="hidden" name="kind" value={kind} />
      {invoice && <input type="hidden" name="invoiceId" value={invoice.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        {customers.length > 0 ? (
          <SelectField
            label="Customer"
            name="customerId"
            placeholder="No customer"
            options={customers}
            defaultValue={selected ?? ''}
          />
        ) : (
          <input type="hidden" name="customerId" value={selected ?? ''} />
        )}
        <TextField
          label={kind === 'quote' ? 'Valid until' : 'Due date'}
          name="dueDate"
          type="date"
          hint="Leave empty for 14 days after issue."
          defaultValue={invoice?.due_date ?? ''}
        />
      </div>
      <LineItemsEditor initial={lines} currency={ctx.tenant.currency} locale={ctx.tenant.locale} />
      <TextareaField
        label="Notes"
        name="notes"
        rows={3}
        maxLength={2000}
        hint="Printed on the document, e.g. payment details."
        defaultValue={invoice?.notes ?? ''}
      />
      <SubmitButton pendingLabel="Saving…">Save draft</SubmitButton>
    </form>
  );
}

export async function NewInvoicePage({ ctx, searchParams }: TenantPageProps) {
  requirePermission(ctx, P.create);
  const kind: DocumentKind = param(searchParams, 'kind') === 'quote' ? 'quote' : 'invoice';
  const customer = param(searchParams, 'customer');
  return (
    <>
      {billingHeader(
        ctx,
        kind === 'quote' ? 'New quote' : 'New invoice',
        'Saved as a draft. It gets its number when you issue it.',
      )}
      {flash(searchParams)}
      <Card aria-labelledby="draft-heading">
        <SectionHeading id="draft-heading">Details</SectionHeading>
        <DraftForm ctx={ctx} kind={kind} customerId={UUID.test(customer) ? customer : null} />
      </Card>
    </>
  );
}

export async function EditInvoicePage({
  ctx,
  searchParams,
  invoiceId,
}: TenantPageProps & { invoiceId: string }) {
  requirePermission(ctx, P.create);
  if (!UUID.test(invoiceId)) notFound();
  const invoice = await getInvoice(ctx.db, invoiceId);
  if (!invoice || invoice.tenant_id !== ctx.tenant.id) notFound();
  if (invoice.status !== 'draft') redirect(ctx.path(`/invoices/${invoice.id}?error=locked`));
  const lines = await listInvoiceLines(ctx.db, invoice.id);
  const kind: DocumentKind = invoice.kind === 'quote' ? 'quote' : 'invoice';
  return (
    <>
      {billingHeader(ctx, `Edit ${documentTitle(invoice).toLowerCase()}`)}
      {flash(searchParams)}
      <Card aria-labelledby="draft-heading">
        <SectionHeading id="draft-heading">Details</SectionHeading>
        <DraftForm
          ctx={ctx}
          kind={kind}
          invoice={invoice}
          lines={lines.map((l) => rawLine(l, ctx.tenant.currency))}
        />
      </Card>
    </>
  );
}

// ---------------------------------------------------------------- detail

export interface InvoiceDetailPageProps extends TenantPageProps {
  invoiceId: string;
  /** Extra sections from other modules (e.g. M-Pesa). Each gets the loaded document. */
  sections?: ((invoice: InvoiceRow) => ReactNode)[];
  /** Flash messages those modules' actions redirect back with. */
  messages?: FlashCatalog;
  /** Link for the record an invoice bills, e.g. ('reservation', id) -> '/bookings/<id>'. */
  sourceHref?: (type: string, id: string) => string | null;
}

export async function InvoiceDetailPage({
  ctx,
  searchParams,
  invoiceId,
  sections = [],
  messages,
  sourceHref,
}: InvoiceDetailPageProps) {
  requirePermission(ctx, P.view);
  if (!UUID.test(invoiceId)) notFound();
  const invoice = await getInvoice(ctx.db, invoiceId);
  if (!invoice || invoice.tenant_id !== ctx.tenant.id) notFound();
  const [lines, payments] = await Promise.all([
    listInvoiceLines(ctx.db, invoice.id),
    listPayments(ctx.db, invoice.id),
  ]);
  const isQuote = invoice.kind === 'quote';
  const draft = invoice.status === 'draft';
  const balance = balanceDue(invoice);
  const t = ctx.tenant;
  const href =
    invoice.source_type && invoice.source_id
      ? sourceHref?.(invoice.source_type, invoice.source_id)
      : null;
  const hidden = (
    <>
      <TenantField slug={t.slug} />
      <input type="hidden" name="invoiceId" value={invoice.id} />
    </>
  );

  return (
    <>
      <BillingLiveRefresh tenantId={t.id} table="invoices" />
      {billingHeader(
        ctx,
        <>
          {documentTitle(invoice)}{' '}
          <span className="align-middle text-base">
            <DocumentStatusBadge kind={invoice.kind} status={invoice.status} />
          </span>
        </>,
        undefined,
        <a
          href={ctx.path(`/invoices/${invoice.id}/pdf`)}
          className={buttonClass('secondary')}
          target="_blank"
          rel="noopener"
        >
          Download PDF
        </a>,
      )}
      {flash(searchParams, messages)}
      <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-8">
          <Card aria-labelledby="summary-heading">
            <SectionHeading id="summary-heading">Summary</SectionHeading>
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[max-content_1fr]">
              <dt className="text-muted">Type</dt>
              <dd>{isQuote ? 'Quote' : 'Invoice'}</dd>
              <dt className="text-muted">Customer</dt>
              <dd>
                {invoice.customer ? (
                  ctx.can(CUSTOMER_PERMISSIONS.view) ? (
                    <Link
                      href={ctx.path(`/customers/${invoice.customer.id}`)}
                      className="underline"
                    >
                      {invoice.customer.name}
                    </Link>
                  ) : (
                    invoice.customer.name
                  )
                ) : (
                  '—'
                )}
              </dd>
              <dt className="text-muted">Issued</dt>
              <dd>
                <Day value={invoice.issue_date} ctx={ctx} />
              </dd>
              <dt className="text-muted">{isQuote ? 'Valid until' : 'Due'}</dt>
              <dd>
                <Day value={invoice.due_date} ctx={ctx} />
              </dd>
              {invoice.source_type && invoice.source_id && (
                <>
                  <dt className="text-muted">For</dt>
                  <dd>
                    {href ? (
                      <Link href={ctx.path(href)} className="underline">
                        {sourceLabel(invoice.source_type)}
                      </Link>
                    ) : (
                      sourceLabel(invoice.source_type)
                    )}
                  </dd>
                </>
              )}
              {invoice.quote_id && (
                <>
                  <dt className="text-muted">From quote</dt>
                  <dd>
                    <Link href={ctx.path(`/invoices/${invoice.quote_id}`)} className="underline">
                      View quote
                    </Link>
                  </dd>
                </>
              )}
              {invoice.status === 'void' && (
                <>
                  <dt className="text-muted">Void reason</dt>
                  <dd>{invoice.void_reason}</dd>
                </>
              )}
              <dt className="text-muted">Created</dt>
              <dd>
                <DateTime value={invoice.created_at} tenant={t} />
              </dd>
            </dl>
          </Card>

          <Card aria-labelledby="lines-heading">
            <SectionHeading id="lines-heading">Lines</SectionHeading>
            <DataTable
              caption="Lines"
              hideCaption
              rows={lines}
              rowKey={(l) => l.id}
              empty={<p className="text-sm text-muted">No lines yet.</p>}
              columns={[
                {
                  key: 'description',
                  header: 'Description',
                  rowHeader: true,
                  cell: (l) => l.description,
                },
                {
                  key: 'qty',
                  header: 'Qty',
                  align: 'right',
                  cell: (l) => String(Number(l.quantity)),
                },
                {
                  key: 'price',
                  header: 'Unit price',
                  align: 'right',
                  hideOnMobile: true,
                  cell: (l) => <Money minor={l.unit_price_minor} tenant={t} />,
                },
                {
                  key: 'tax',
                  header: 'Tax',
                  align: 'right',
                  hideOnMobile: true,
                  cell: (l) => (l.tax_rate_bp ? formatTaxRate(l.tax_rate_bp) : '—'),
                },
                {
                  key: 'amount',
                  header: 'Amount',
                  align: 'right',
                  cell: (l) => <Money minor={l.line_total_minor} tenant={t} />,
                },
              ]}
            />
            <dl className="mt-4 ml-auto grid max-w-xs grid-cols-2 gap-x-6 gap-y-1 text-sm">
              <dt className="text-muted">Subtotal</dt>
              <dd className="text-right">
                <Money minor={invoice.subtotal_minor} tenant={t} />
              </dd>
              <dt className="text-muted">Tax</dt>
              <dd className="text-right">
                <Money minor={invoice.tax_minor} tenant={t} />
              </dd>
              <dt className="font-semibold">Total</dt>
              <dd className="text-right font-semibold" data-testid="invoice-total">
                <Money minor={invoice.total_minor} tenant={t} />
              </dd>
              {!isQuote && (
                <>
                  <dt className="text-muted">Paid</dt>
                  <dd className="text-right">
                    <Money minor={invoice.paid_minor} tenant={t} />
                  </dd>
                  <dt className="font-semibold">Balance due</dt>
                  <dd className="text-right font-semibold" data-testid="invoice-balance">
                    <Money minor={invoice.status === 'void' ? 0 : balance} tenant={t} />
                  </dd>
                </>
              )}
            </dl>
            {invoice.notes && (
              <p className="mt-4 text-sm whitespace-pre-line text-muted">{invoice.notes}</p>
            )}
          </Card>

          {!isQuote && !draft && (
            <Card aria-labelledby="payments-heading">
              <SectionHeading id="payments-heading">Payments</SectionHeading>
              <DataTable
                caption="Payments"
                hideCaption
                rows={payments}
                rowKey={(p) => p.id}
                empty={<p className="text-sm text-muted">No payments yet.</p>}
                columns={[
                  {
                    key: 'when',
                    header: 'Received',
                    rowHeader: true,
                    cell: (p) => <DateTime value={p.received_at} tenant={t} />,
                  },
                  {
                    key: 'method',
                    header: 'Method',
                    cell: (p) => PAYMENT_METHOD_LABELS[p.method as PaymentMethod] ?? p.method,
                  },
                  {
                    key: 'reference',
                    header: 'Reference',
                    hideOnMobile: true,
                    cell: (p) => p.reference ?? '—',
                  },
                  {
                    key: 'amount',
                    header: 'Amount',
                    align: 'right',
                    cell: (p) => <Money minor={p.amount_minor} tenant={t} />,
                  },
                ]}
              />
            </Card>
          )}

          {sections.map((render, i) => (
            <div key={i}>{render(invoice)}</div>
          ))}
        </div>

        <div className="space-y-8">
          <DocumentActions ctx={ctx} invoice={invoice} hidden={hidden} />

          {isPayable(invoice) && ctx.can(P.record) && (
            <Card aria-labelledby="record-payment-heading">
              <SectionHeading id="record-payment-heading">Record a payment</SectionHeading>
              <form action={recordPaymentAction} className="space-y-4">
                {hidden}
                <TextField
                  label={`Amount (${t.currency})`}
                  name="amount"
                  inputMode="decimal"
                  autoComplete="off"
                  required
                  hint={`Balance due: ${fromMinorUnits(balance, t.currency)}`}
                  defaultValue={String(fromMinorUnits(balance, t.currency))}
                />
                <SelectField
                  label="Method"
                  name="method"
                  options={PAYMENT_METHODS.map((m) => ({
                    value: m,
                    label: PAYMENT_METHOD_LABELS[m],
                  }))}
                  defaultValue="cash"
                />
                <TextField label="Reference" name="reference" maxLength={100} autoComplete="off" />
                <TextField label="Note" name="note" maxLength={500} autoComplete="off" />
                <SubmitButton pendingLabel="Recording…">Record payment</SubmitButton>
              </form>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function DocumentActions({
  ctx,
  invoice,
  hidden,
}: {
  ctx: TenantContext;
  invoice: InvoiceRow;
  hidden: ReactNode;
}) {
  const draft = invoice.status === 'draft';
  const buttons: ReactNode[] = [];
  if (draft && ctx.can(P.create)) {
    buttons.push(
      <Link
        key="edit"
        href={ctx.path(`/invoices/${invoice.id}/edit`)}
        className={buttonClass('secondary', 'sm')}
      >
        Edit draft
      </Link>,
    );
  }
  if (draft && ctx.can(P.issue)) {
    buttons.push(
      <form key="issue" action={issueInvoiceAction}>
        {hidden}
        <SubmitButton size="sm" pendingLabel="Issuing…">
          {invoice.kind === 'quote' ? 'Issue quote' : 'Issue invoice'}
        </SubmitButton>
      </form>,
    );
  }
  if (draft && ctx.can(P.create)) {
    buttons.push(
      <form key="delete" action={deleteInvoiceAction}>
        {hidden}
        <ConfirmSubmit message="Delete this draft? This cannot be undone.">
          Delete draft
        </ConfirmSubmit>
      </form>,
    );
  }
  if (canConvert(invoice) && ctx.can(P.issue)) {
    buttons.push(
      <form key="convert" action={convertQuoteAction}>
        {hidden}
        <SubmitButton size="sm" pendingLabel="Converting…">
          Accept and convert to invoice
        </SubmitButton>
      </form>,
    );
  }
  const voidable = canVoid(invoice) && ctx.can(P.void);
  if (buttons.length === 0 && !voidable) return null;

  return (
    <Card aria-labelledby="actions-heading">
      <SectionHeading id="actions-heading">Actions</SectionHeading>
      {buttons.length > 0 && <div className="flex flex-wrap gap-3">{buttons}</div>}
      {voidable && (
        <form action={voidInvoiceAction} className={cn('space-y-3', buttons.length > 0 && 'mt-6')}>
          {hidden}
          <TextField
            label="Reason for voiding"
            name="reason"
            maxLength={500}
            required
            autoComplete="off"
          />
          <ConfirmSubmit message="Void this document? Its number stays used and it cannot be undone.">
            Void
          </ConfirmSubmit>
        </form>
      )}
    </Card>
  );
}

// ------------------------------------------------- sections for other modules

function DocumentList({ ctx, rows }: { ctx: TenantContext; rows: InvoiceRow[] }) {
  return (
    <ul className="divide-y divide-line">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
          <Link
            href={ctx.path(`/invoices/${r.id}`)}
            className="font-medium underline-offset-2 hover:underline"
          >
            {documentTitle(r)}
          </Link>
          <Money minor={r.total_minor} tenant={ctx.tenant} />
          <DocumentStatusBadge kind={r.kind} status={r.status} />
        </li>
      ))}
    </ul>
  );
}

/**
 * A customer's quotes and invoices, for CustomerDetailPage's `sections` prop:
 *   sections={[(c) => <CustomerInvoices ctx={ctx} customerId={c.id} />]}
 */
export async function CustomerInvoices({
  ctx,
  customerId,
}: {
  ctx: TenantContext;
  customerId: string;
}) {
  if (!ctx.can(P.view)) return null;
  const rows = await listInvoices(ctx.db, ctx.tenant.id, { customerId, limit: 20 });
  return (
    <Card aria-labelledby="customer-invoices-heading">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <SectionHeading id="customer-invoices-heading">Invoices</SectionHeading>
        {ctx.can(P.create) && (
          <Link
            href={ctx.path(`/invoices/new?customer=${customerId}`)}
            className="text-sm underline-offset-2 hover:underline"
          >
            Invoice this customer
          </Link>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">No quotes or invoices yet.</p>
      ) : (
        <DocumentList ctx={ctx} rows={rows} />
      )}
    </Card>
  );
}

/**
 * Invoices for a record in another module (a reservation, an order...), with
 * a button that starts one from suggested lines. The other module doesn't
 * depend on billing: the app composes this into that module's page.
 *
 *   <SourceInvoices ctx={ctx} source={{ type: 'reservation', id }}
 *     customerId={r.customer_id} lines={[...]} returnTo={`/bookings/${id}`} />
 */
export async function SourceInvoices({
  ctx,
  source,
  customerId,
  lines,
  returnTo,
}: {
  ctx: TenantContext;
  source: BillingSource;
  customerId: string | null;
  lines: readonly LineInput[];
  returnTo: string;
}) {
  if (!ctx.can(P.view)) return null;
  const rows = await listInvoices(ctx.db, ctx.tenant.id, { source, limit: 20 });
  const live = rows.filter((r) => r.kind === 'invoice' && r.status !== 'void');
  const c = ctx.tenant.currency;
  return (
    <Card aria-labelledby="source-invoices-heading">
      <SectionHeading id="source-invoices-heading">Billing</SectionHeading>
      {rows.length > 0 ? (
        <DocumentList ctx={ctx} rows={rows} />
      ) : (
        <p className="text-sm text-muted">Not invoiced yet.</p>
      )}
      {live.length === 0 && ctx.can(P.create) && lines.length > 0 && (
        <form action={invoiceSourceAction} className="mt-4">
          <TenantField slug={ctx.tenant.slug} />
          <input type="hidden" name="sourceType" value={source.type} />
          <input type="hidden" name="sourceId" value={source.id} />
          <input type="hidden" name="customerId" value={customerId ?? ''} />
          <input type="hidden" name="returnTo" value={returnTo} />
          {lines.map((l, i) => (
            <span key={i} hidden>
              <input type="hidden" name="lineDescription" value={l.description} />
              <input type="hidden" name="lineQuantity" value={String(l.quantity)} />
              <input
                type="hidden"
                name="linePrice"
                value={String(fromMinorUnits(l.unitPriceMinor, c))}
              />
              <input type="hidden" name="lineTax" value={String(l.taxRateBp / 100)} />
            </span>
          ))}
          <SubmitButton size="sm" pendingLabel="Creating…">
            Create invoice
          </SubmitButton>
        </form>
      )}
    </Card>
  );
}
