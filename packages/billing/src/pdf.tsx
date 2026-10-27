import 'server-only';
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';
import { notFound } from 'next/navigation';
import { formatDate, formatMoney, type Tenant } from '@kitto/core';
import { getTenantContext, requirePermission } from '@kitto/auth/server';
import { getInvoice, listInvoiceLines, type InvoiceLine, type InvoiceRow } from './data';
import { formatTaxRate } from './math';
import { BILLING_PERMISSIONS as P } from './permissions';
import { statusLabel } from './status';

/**
 * Quote / invoice PDFs, drawn with @react-pdf/renderer on the server.
 *
 * The built-in Helvetica needs no font files but only covers Latin-1, so text
 * is passed through `latin1()` (e.g. Intl's narrow no-break spaces).
 */

const INK = '#15171f';
const MUTED = '#5b5f6b';
const LINE = '#e2ded3';

const s = StyleSheet.create({
  page: { padding: 40, paddingBottom: 60, fontSize: 10, color: INK, fontFamily: 'Helvetica' },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 24 },
  business: { fontSize: 16, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  muted: { color: MUTED },
  title: { fontSize: 22, fontFamily: 'Helvetica-Bold', textAlign: 'right' },
  meta: { textAlign: 'right' },
  parties: { marginBottom: 20 },
  label: { fontSize: 8, color: MUTED, textTransform: 'uppercase', letterSpacing: 1 },
  bold: { fontFamily: 'Helvetica-Bold' },
  tableHead: {
    flexDirection: 'row',
    borderBottomWidth: 1.5,
    borderBottomColor: INK,
    paddingBottom: 4,
    fontFamily: 'Helvetica-Bold',
  },
  row: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: LINE,
    paddingVertical: 6,
  },
  colDesc: { flex: 1, paddingRight: 8 },
  colQty: { width: 45, textAlign: 'right' },
  colTax: { width: 45, textAlign: 'right' },
  colPrice: { width: 85, textAlign: 'right' },
  colTotal: { width: 85, textAlign: 'right' },
  totals: { marginTop: 12, marginLeft: 'auto', width: 230 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  grand: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1.5,
    borderTopColor: INK,
    marginTop: 4,
    paddingTop: 4,
    fontFamily: 'Helvetica-Bold',
    fontSize: 12,
  },
  notes: { marginTop: 24 },
  footer: {
    position: 'absolute',
    bottom: 28,
    left: 40,
    right: 40,
    fontSize: 8,
    color: MUTED,
    textAlign: 'center',
  },
});

/** Replace characters Helvetica can't draw. */
export function latin1(text: string): string {
  return text
    .replace(/[\u202f\u2009\u2007]/g, ' ')
    .replace(/[\u2012-\u2015\u2212]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[^\x20-\x7e\xa0-\xff\n]/g, '?');
}

export interface InvoiceDocument {
  tenant: Pick<Tenant, 'name' | 'slug' | 'currency' | 'locale'>;
  invoice: InvoiceRow;
  lines: InvoiceLine[];
}

export function InvoicePdf({ doc }: { doc: InvoiceDocument }) {
  const { tenant, invoice: inv, lines } = doc;
  const isQuote = inv.kind === 'quote';
  const title = `${inv.status === 'draft' ? 'Draft ' : ''}${isQuote ? 'Quote' : 'Invoice'}`;
  const money = (minor: number) => latin1(formatMoney(minor, tenant));
  const day = (d: string | null) =>
    d ? latin1(formatDate(`${d}T12:00:00Z`, { locale: tenant.locale, timezone: 'UTC' })) : '-';
  const t = (v: string) => latin1(v);

  return (
    <Document
      title={t(`${title} ${inv.number ?? ''} - ${tenant.name}`)}
      author={t(tenant.name)}
      creator="Kitto"
      producer="Kitto"
    >
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <View>
            <Text style={s.business}>{t(tenant.name)}</Text>
          </View>
          <View>
            <Text style={s.title}>{title}</Text>
            {inv.number && <Text style={[s.meta, s.bold]}>{inv.number}</Text>}
            <Text style={[s.meta, s.muted]}>Date: {day(inv.issue_date)}</Text>
            {inv.due_date && (
              <Text style={[s.meta, s.muted]}>
                {isQuote ? 'Valid until' : 'Due'}: {day(inv.due_date)}
              </Text>
            )}
            <Text style={[s.meta, s.bold]}>{statusLabel(inv.kind, inv.status)}</Text>
          </View>
        </View>

        {inv.customer && (
          <View style={s.parties}>
            <Text style={s.label}>{isQuote ? 'Prepared for' : 'Bill to'}</Text>
            <Text style={s.bold}>{t(inv.customer.name)}</Text>
            {inv.customer.phone && <Text>{t(inv.customer.phone)}</Text>}
            {inv.customer.email && <Text>{t(inv.customer.email)}</Text>}
          </View>
        )}

        {/* `fixed` repeats the header row on every page of a long document. */}
        <View style={s.tableHead} fixed>
          <Text style={s.colDesc}>Description</Text>
          <Text style={s.colQty}>Qty</Text>
          <Text style={s.colPrice}>Unit price</Text>
          <Text style={s.colTax}>Tax</Text>
          <Text style={s.colTotal}>Amount</Text>
        </View>
        {lines.map((l) => (
          <View key={l.id} style={s.row} wrap={false}>
            <Text style={s.colDesc}>{t(l.description)}</Text>
            <Text style={s.colQty}>{String(Number(l.quantity))}</Text>
            <Text style={s.colPrice}>{money(l.unit_price_minor)}</Text>
            <Text style={s.colTax}>{l.tax_rate_bp ? formatTaxRate(l.tax_rate_bp) : '-'}</Text>
            <Text style={s.colTotal}>{money(l.line_total_minor)}</Text>
          </View>
        ))}

        <View style={s.totals} wrap={false}>
          <View style={s.totalRow}>
            <Text>Subtotal</Text>
            <Text>{money(inv.subtotal_minor)}</Text>
          </View>
          <View style={s.totalRow}>
            <Text>Tax</Text>
            <Text>{money(inv.tax_minor)}</Text>
          </View>
          <View style={s.grand}>
            <Text>Total</Text>
            <Text>{money(inv.total_minor)}</Text>
          </View>
          {!isQuote && inv.paid_minor > 0 && (
            <View style={s.totalRow}>
              <Text>Paid</Text>
              <Text>-{money(inv.paid_minor)}</Text>
            </View>
          )}
          {!isQuote && inv.status !== 'void' && (
            <View style={[s.totalRow, s.bold]}>
              <Text>Balance due</Text>
              <Text>{money(Math.max(0, inv.total_minor - inv.paid_minor))}</Text>
            </View>
          )}
        </View>

        {inv.notes && (
          <View style={s.notes} wrap={false}>
            <Text style={s.label}>Notes</Text>
            <Text>{t(inv.notes)}</Text>
          </View>
        )}

        <Text
          style={s.footer}
          fixed
          render={({ pageNumber, totalPages }) =>
            `${t(tenant.name)}  |  Page ${pageNumber} of ${totalPages}`
          }
        />
      </Page>
    </Document>
  );
}

/** "INV-00012-acme.pdf", or "draft-invoice-acme.pdf". */
export function pdfFilename(doc: InvoiceDocument): string {
  const name = doc.invoice.number ?? `draft-${doc.invoice.kind}`;
  return `${name}-${doc.tenant.slug}.pdf`.replace(/[^A-Za-z0-9._-]/g, '');
}

export async function invoicePdfResponse(doc: InvoiceDocument): Promise<Response> {
  const pdf = await renderToBuffer(<InvoicePdf doc={doc} />);
  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${pdfFilename(doc)}"`,
      // Payment status changes, so never serve a stale copy.
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
}

/**
 * Route handler for `app/t/[tenant]/invoices/[id]/pdf/route.ts`:
 *   export const { GET } = createInvoicePdfRoute();
 * Same checks as the pages: membership, billing.view, then RLS.
 */
export function createInvoicePdfRoute() {
  return {
    async GET(
      _request: Request,
      { params }: { params: Promise<{ tenant: string; id: string }> },
    ): Promise<Response> {
      const { tenant: slug, id } = await params;
      const ctx = await getTenantContext(slug);
      requirePermission(ctx, P.view);
      if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
      const invoice = await getInvoice(ctx.db, id);
      if (!invoice || invoice.tenant_id !== ctx.tenant.id) notFound();
      const lines = await listInvoiceLines(ctx.db, invoice.id);
      return invoicePdfResponse({ tenant: ctx.tenant, invoice, lines });
    },
  };
}
