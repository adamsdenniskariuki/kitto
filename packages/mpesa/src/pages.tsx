import 'server-only';
import { requirePermission, type TenantContext } from '@kitto/auth/server';
import { balanceDue, isPayable, type InvoiceRow } from '@kitto/billing';
import { BillingLiveRefresh } from '@kitto/billing/client';
import {
  Badge,
  Card,
  DateTime,
  Money,
  SectionHeading,
  TenantField,
  TextField,
  type Tone,
} from '@kitto/ui';
import { SubmitButton } from '@kitto/ui/client';
import { requestMpesaAction } from './actions';
import { mpesaMode } from './config';
import { listMpesaRequests } from './data';
import { resultMessage, type MpesaStatus } from './format';
import { MPESA_PERMISSIONS as P } from './permissions';
import { maskDarajaPhone, toDarajaPhone } from './phone';

const STATUS: Record<MpesaStatus, { label: string; tone: Tone }> = {
  pending: { label: 'Waiting', tone: 'brand' },
  succeeded: { label: 'Paid', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'warning' },
  expired: { label: 'No answer', tone: 'neutral' },
  needs_review: { label: 'Needs review', tone: 'danger' },
};

/**
 * "Pay with M-Pesa" for InvoiceDetailPage's `sections` prop:
 *   sections={[(inv) => <InvoiceMpesa ctx={ctx} invoice={inv} />]}
 * Sends an STK push and lists recent requests, refreshing live as callbacks land.
 */
export async function InvoiceMpesa({ ctx, invoice }: { ctx: TenantContext; invoice: InvoiceRow }) {
  requirePermission(ctx, P.view);
  if (invoice.kind !== 'invoice' || invoice.status === 'draft') return null;
  const mode = mpesaMode();
  const requests = await listMpesaRequests(ctx.db, invoice.id);
  const canRequest =
    mode !== 'disabled' && invoice.currency === 'KES' && isPayable(invoice) && ctx.can(P.request);
  if (!canRequest && requests.length === 0) return null;

  const t = ctx.tenant;
  const balanceKes = Math.floor(balanceDue(invoice) / 100);
  const customerPhone = invoice.customer?.phone ? toDarajaPhone(invoice.customer.phone) : null;

  return (
    <Card aria-labelledby="mpesa-heading">
      <BillingLiveRefresh tenantId={t.id} table="mpesa_requests" />
      <SectionHeading id="mpesa-heading">M-Pesa</SectionHeading>
      {canRequest && balanceKes >= 1 && (
        <form
          action={requestMpesaAction}
          className="grid gap-4 sm:grid-cols-[1fr_12rem_auto] sm:items-end"
        >
          <TenantField slug={t.slug} />
          <input type="hidden" name="invoiceId" value={invoice.id} />
          <TextField
            id="f-mpesa-phone"
            label="Customer's M-Pesa number"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            required
            placeholder="0712 345 678"
            defaultValue={customerPhone ? `0${customerPhone.slice(3)}` : ''}
            hint={
              mode === 'mock'
                ? 'Mock mode: numbers ending 1032 cancel, 0001 fail, anything else pays.'
                : 'The customer gets a prompt to enter their M-Pesa PIN.'
            }
          />
          <TextField
            id="f-mpesa-amount"
            label="Amount (KES)"
            name="amount"
            inputMode="numeric"
            autoComplete="off"
            required
            defaultValue={String(balanceKes)}
          />
          <SubmitButton pendingLabel="Sending…">Send M-Pesa request</SubmitButton>
        </form>
      )}
      {requests.length > 0 && (
        <ul className="mt-6 divide-y divide-line text-sm" aria-label="M-Pesa requests">
          {requests.map((r) => {
            const s = STATUS[r.status as MpesaStatus] ?? {
              label: r.status,
              tone: 'neutral' as const,
            };
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <Badge tone={s.tone}>{s.label}</Badge>
                <Money minor={r.amount_minor} tenant={t} />
                <span className="text-muted">{maskDarajaPhone(r.phone)}</span>
                {r.receipt && <span className="font-mono">{r.receipt}</span>}
                <span className="text-muted">
                  <DateTime value={r.created_at} tenant={t} />
                </span>
                {r.status !== 'succeeded' && (
                  <span className="w-full text-muted">
                    {resultMessage(r.status, r.result_desc)}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
