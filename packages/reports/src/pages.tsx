import 'server-only';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { formatMoney, formatNumber, type TenantLocale } from '@kitto/core';
import {
  param,
  requirePermission,
  type TenantContext,
  type TenantPageProps,
} from '@kitto/auth/server';
import {
  Alert,
  Card,
  Money,
  PageHeader,
  SectionHeading,
  Stat,
  TextField,
  buttonClass,
} from '@kitto/ui';
import { BarChart, BarList, DonutChart, LineChart, StackedBar } from './charts';
import {
  newCustomersReport,
  paymentMethodsReport,
  receivablesAgingReport,
  reservationStatusReport,
  revenueReport,
  stockSummaryReport,
  topItemsReport,
  total,
  utilisationReport,
} from './data';
import { formatDay, percent, presetRanges, resolveRange, type ReportRange } from './math';
import { REPORT_PERMISSIONS as P } from './permissions';
import {
  REPORT_AGING_LABELS,
  ALL_REPORT_SECTIONS,
  canViewReport,
  REPORT_PAYMENT_METHOD_LABELS,
  REPORT_RESERVATION_STATUS_LABELS,
  visibleReportSections,
  type ReportSection,
} from './shared';

/** What every report section receives. */
export interface ReportSectionProps {
  ctx: TenantContext;
  range: ReportRange;
}

const money = (t: Pick<TenantLocale, 'currency' | 'locale'>) => (minor: number) =>
  formatMoney(minor, t);
const count = (t: Pick<TenantLocale, 'locale'>) => (n: number) => formatNumber(n, t);

function periodText(range: ReportRange, locale: string) {
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };
  return `${formatDay(range.from, locale, opts)} – ${formatDay(range.to, locale, opts)}`;
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <Card aria-labelledby={`${id}-heading`} className="min-w-0">
      <SectionHeading id={`${id}-heading`}>{title}</SectionHeading>
      {children}
    </Card>
  );
}

function StatGrid({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {children}
    </div>
  );
}

// --------------------------------------------------------------- sections

/** Invoiced vs collected over the period, with outstanding and overdue totals. */
export async function RevenueSection({ ctx, range }: ReportSectionProps) {
  if (!canViewReport(ctx, 'billing')) return null;
  const [rows, aging] = await Promise.all([
    revenueReport(ctx.db, ctx.tenant.id, range),
    receivablesAgingReport(ctx.db, ctx.tenant.id),
  ]);
  const fmt = money(ctx.tenant);
  const invoiced = total(rows, (r) => r.invoiced_minor);
  const paid = total(rows, (r) => r.paid_minor);
  const outstanding = total(aging, (r) => r.outstanding_minor);
  const overdue = total(
    aging.filter((r) => r.bucket !== 'current'),
    (r) => r.outstanding_minor,
  );
  const weekly = range.bucket === 'week';
  return (
    <Section id="report-revenue" title="Revenue">
      <StatGrid label="Revenue figures">
        <Stat label="Invoiced" value={<Money minor={invoiced} tenant={ctx.tenant} />} />
        <Stat label="Collected" value={<Money minor={paid} tenant={ctx.tenant} />} />
        <Stat
          label="Outstanding"
          value={<Money minor={outstanding} tenant={ctx.tenant} />}
          hint="All open invoices, today"
        />
        <Stat
          label="Overdue"
          value={<Money minor={overdue} tenant={ctx.tenant} />}
          hint="Past their due date"
        />
      </StatGrid>
      <BarChart
        title={weekly ? 'Invoiced and collected per week' : 'Invoiced and collected per day'}
        description={`Invoiced ${fmt(invoiced)} and collected ${fmt(paid)} between ${periodText(range, ctx.tenant.locale)}.`}
        labelHeader={weekly ? 'Week starting' : 'Day'}
        labels={rows.map((r) => formatDay(r.bucket, ctx.tenant.locale))}
        series={[
          { name: 'Invoiced', values: rows.map((r) => r.invoiced_minor), color: 'var(--brand)' },
          { name: 'Collected', values: rows.map((r) => r.paid_minor), color: 'var(--success)' },
        ]}
        format={fmt}
      />
    </Section>
  );
}

/** How customers paid (M-Pesa, cash, card...) in the period. */
export async function PaymentMethodsSection({ ctx, range }: ReportSectionProps) {
  if (!canViewReport(ctx, 'billing')) return null;
  const rows = await paymentMethodsReport(ctx.db, ctx.tenant.id, range);
  const fmt = money(ctx.tenant);
  const sum = total(rows, (r) => r.amount_minor);
  const payments = total(rows, (r) => r.payments);
  const top = [...rows].sort((a, b) => b.amount_minor - a.amount_minor)[0];
  return (
    <Section id="report-payments" title="Payments by method">
      {sum === 0 ? (
        <p className="text-sm text-muted">No payments in this period.</p>
      ) : (
        <DonutChart
          title="Share of payments by method"
          description={`${formatNumber(payments, ctx.tenant)} payments worth ${fmt(sum)}; most came by ${REPORT_PAYMENT_METHOD_LABELS[top!.method] ?? top!.method} (${percent(top!.amount_minor, sum)}%).`}
          labelHeader="Method"
          slices={rows.map((r) => ({
            label: REPORT_PAYMENT_METHOD_LABELS[r.method] ?? r.method,
            value: r.amount_minor,
          }))}
          format={fmt}
          centre={formatNumber(payments, ctx.tenant)}
        />
      )}
    </Section>
  );
}

/** Unpaid balances by how long they are overdue. */
export async function AgingSection({ ctx }: ReportSectionProps) {
  if (!canViewReport(ctx, 'billing')) return null;
  const rows = await receivablesAgingReport(ctx.db, ctx.tenant.id);
  const fmt = money(ctx.tenant);
  const outstanding = total(rows, (r) => r.outstanding_minor);
  return (
    <Section id="report-aging" title="Receivables aging">
      {outstanding === 0 ? (
        <p className="text-sm text-muted">Nothing is owed. Every issued invoice is paid.</p>
      ) : (
        <BarChart
          title="Outstanding balance by days overdue"
          description={`${fmt(outstanding)} outstanding across ${formatNumber(
            total(rows, (r) => r.invoices),
            ctx.tenant,
          )} invoices.`}
          labelHeader="Days overdue"
          labels={rows.map((r) => REPORT_AGING_LABELS[r.bucket] ?? r.bucket)}
          series={[
            {
              name: 'Outstanding',
              values: rows.map((r) => r.outstanding_minor),
              color: 'var(--warning)',
            },
          ]}
          format={fmt}
        />
      )}
    </Section>
  );
}

/** Booked share of opening hours per resource, and reservations by status. */
export async function BookingSection({ ctx, range }: ReportSectionProps) {
  if (!canViewReport(ctx, 'booking')) return null;
  const [resources, statuses] = await Promise.all([
    utilisationReport(ctx.db, ctx.tenant.id, range),
    reservationStatusReport(ctx.db, ctx.tenant.id, range),
  ]);
  const booked = total(resources, (r) => r.booked_minutes);
  const available = total(resources, (r) => r.available_minutes);
  const reservations = total(statuses, (r) => r.reservations);
  const n = count(ctx.tenant);
  return (
    <Section id="report-booking" title="Bookings">
      <StatGrid label="Booking figures">
        <Stat label="Reservations" value={n(reservations)} hint="Starting in the period" />
        <Stat
          label="Utilisation"
          value={`${percent(booked, available)}%`}
          hint="Booked share of opening hours"
        />
      </StatGrid>
      <div className="grid gap-6 lg:grid-cols-2">
        {resources.length === 0 ? (
          <p className="text-sm text-muted">No resources yet.</p>
        ) : (
          <BarList
            title="Utilisation by resource"
            max={100}
            rows={resources.map((r) => {
              const pct = percent(r.booked_minutes, r.available_minutes);
              return {
                label: r.resource_name,
                value: pct,
                display: `${pct}% · ${n(r.reservations)} ${r.reservations === 1 ? 'booking' : 'bookings'}`,
              };
            })}
          />
        )}
        <StackedBar
          title="Reservations by status"
          description={`${n(reservations)} reservations in the period.`}
          labelHeader="Status"
          slices={statuses.map((s, i) => ({
            label: REPORT_RESERVATION_STATUS_LABELS[s.status] ?? s.status,
            value: s.reservations,
            color: [
              'var(--muted)',
              'var(--brand)',
              'var(--warning)',
              'var(--success)',
              'var(--danger)',
              'var(--ink)',
            ][i],
          }))}
          format={n}
        />
      </div>
    </Section>
  );
}

/** Best sellers by revenue from sent, fulfilled and paid orders. */
export async function TopItemsSection({ ctx, range }: ReportSectionProps) {
  if (!canViewReport(ctx, 'orders')) return null;
  const rows = await topItemsReport(ctx.db, ctx.tenant.id, range, 10);
  const fmt = money(ctx.tenant);
  const n = count(ctx.tenant);
  return (
    <Section id="report-top-items" title="Top items sold">
      {rows.length === 0 ? (
        <p className="text-sm text-muted">No orders in this period.</p>
      ) : (
        <BarList
          title="Top items by revenue"
          rows={rows.map((r) => ({
            label: r.name,
            value: r.revenue_minor,
            display: `${fmt(r.revenue_minor)} · ${n(r.quantity)} sold`,
          }))}
        />
      )}
    </Section>
  );
}

/** Stock on hand at cost, and how many items are low. Not tied to the period. */
export async function StockSection({ ctx }: ReportSectionProps) {
  if (!canViewReport(ctx, 'inventory')) return null;
  const s = await stockSummaryReport(ctx.db, ctx.tenant.id);
  const n = count(ctx.tenant);
  return (
    <Section id="report-stock" title="Stock">
      <StatGrid label="Stock figures">
        <Stat label="Tracked items" value={n(s.items)} />
        <Stat
          label="Stock value"
          value={<Money minor={s.stock_value_minor} tenant={ctx.tenant} />}
          hint={s.uncosted_items > 0 ? `${n(s.uncosted_items)} items have no cost` : 'At cost'}
        />
        <Stat
          label="Low on stock"
          value={n(s.low_items)}
          hint={
            s.low_items > 0 ? (
              <Link href={ctx.path('/inventory/low')} className="underline">
                See low stock
              </Link>
            ) : (
              'All above reorder level'
            )
          }
        />
      </StatGrid>
    </Section>
  );
}

/** Customers added per day. */
export async function NewCustomersSection({ ctx, range }: ReportSectionProps) {
  if (!canViewReport(ctx, 'customers')) return null;
  const rows = await newCustomersReport(ctx.db, ctx.tenant.id, range);
  const n = count(ctx.tenant);
  const added = total(rows, (r) => r.customers);
  return (
    <Section id="report-customers" title="New customers">
      <StatGrid label="Customer figures">
        <Stat label="New customers" value={n(added)} />
      </StatGrid>
      <LineChart
        title="New customers per day"
        description={`${n(added)} customers added between ${periodText(range, ctx.tenant.locale)}.`}
        labelHeader="Day"
        labels={rows.map((r) => formatDay(r.day, ctx.tenant.locale))}
        series={[{ name: 'New customers', values: rows.map((r) => r.customers) }]}
        format={n}
      />
    </Section>
  );
}

const SECTION_COMPONENTS: Record<ReportSection, (p: ReportSectionProps) => Promise<ReactNode>> = {
  revenue: RevenueSection,
  payments: PaymentMethodsSection,
  aging: AgingSection,
  booking: BookingSection,
  'top-items': TopItemsSection,
  stock: StockSection,
  customers: NewCustomersSection,
};

// ------------------------------------------------------------------ page

/** The period picker: a GET form (?from=&to=) plus quick ranges. */
function RangeForm({ ctx, range }: ReportSectionProps) {
  return (
    <Card className="mb-6">
      <form
        role="search"
        aria-label="Report period"
        method="get"
        className="flex flex-wrap items-end gap-3"
      >
        <TextField
          label="From"
          name="from"
          type="date"
          required
          defaultValue={range.from}
          wrapperClassName="w-full sm:w-44"
        />
        <TextField
          label="To"
          name="to"
          type="date"
          required
          defaultValue={range.to}
          wrapperClassName="w-full sm:w-44"
        />
        <button type="submit" className={buttonClass('secondary')}>
          Show
        </button>
      </form>
      <nav aria-label="Quick periods" className="mt-3">
        <ul className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
          {presetRanges(ctx.tenant.timezone).map((p) => {
            const current = p.from === range.from && p.to === range.to;
            return (
              <li key={p.label}>
                <Link
                  href={ctx.path(`/reports?${new URLSearchParams({ from: p.from, to: p.to })}`)}
                  aria-current={current ? 'page' : undefined}
                  className={
                    current ? 'font-semibold' : 'text-brand underline-offset-4 hover:underline'
                  }
                >
                  {p.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </Card>
  );
}

/**
 * KPIs and charts for the period in ?from=&to= (default: the last 30 days in
 * the tenant's time zone). Pass `sections` to show only the modules your app
 * includes; each section also hides itself unless the user may view both
 * reports and the module it reads.
 */
export async function ReportsPage({
  ctx,
  searchParams,
  sections = ALL_REPORT_SECTIONS,
}: TenantPageProps & { sections?: readonly ReportSection[] }) {
  requirePermission(ctx, P.view);
  const range = resolveRange(
    { from: param(searchParams, 'from'), to: param(searchParams, 'to') },
    ctx.tenant.timezone,
  );
  const visible = visibleReportSections(ctx, sections);
  return (
    <>
      <PageHeader
        title="Reports"
        description={`${periodText(range, ctx.tenant.locale)} (${range.days} ${range.days === 1 ? 'day' : 'days'}, ${ctx.tenant.timezone} time).`}
      />
      {range.adjusted && (
        <div className="mb-6">
          <Alert tone="warning">
            That period wasn&apos;t valid, so it was adjusted. Periods can be up to a year long.
          </Alert>
        </div>
      )}
      <RangeForm ctx={ctx} range={range} />
      {visible.length === 0 ? (
        <p className="text-muted">There are no reports you can see yet.</p>
      ) : (
        <div className="grid gap-6">
          {visible.map((s) => {
            const Component = SECTION_COMPONENTS[s];
            return <Component key={s} ctx={ctx} range={range} />;
          })}
        </div>
      )}
    </>
  );
}

/** Home-page summary: collected in the last 30 days and outstanding now. */
export async function ReportsKpiCard({ ctx }: { ctx: TenantContext }) {
  if (!canViewReport(ctx, 'billing')) return null;
  const range = resolveRange({}, ctx.tenant.timezone);
  const [rows, aging] = await Promise.all([
    revenueReport(ctx.db, ctx.tenant.id, range),
    receivablesAgingReport(ctx.db, ctx.tenant.id),
  ]);
  return (
    <Card aria-labelledby="kpi-heading">
      <SectionHeading id="kpi-heading">Last 30 days</SectionHeading>
      <div className="grid grid-cols-2 gap-3">
        <Stat
          label="Collected"
          value={<Money minor={total(rows, (r) => r.paid_minor)} tenant={ctx.tenant} />}
        />
        <Stat
          label="Outstanding"
          value={<Money minor={total(aging, (r) => r.outstanding_minor)} tenant={ctx.tenant} />}
        />
      </div>
      <p className="mt-3 text-sm">
        <Link href={ctx.path('/reports')} className="underline">
          Open reports
        </Link>
      </p>
    </Card>
  );
}
