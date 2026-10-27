import { unwrap, type Database, type KittoClient } from '@kitto/core';
import type { ReportBucket, ReportRange } from './math';

type Fn<K extends keyof Database['public']['Functions']> =
  Database['public']['Functions'][K]['Returns'];

export type RevenueRow = Fn<'report_revenue'>[number];
export type PaymentMethodRow = Fn<'report_payment_methods'>[number];
export type AgingRow = Fn<'report_receivables_aging'>[number];
export type UtilisationRow = Fn<'report_booking_utilisation'>[number];
export type ReservationStatusRow = Fn<'report_reservation_status'>[number];
export type TopItemRow = Fn<'report_top_items'>[number];
export type StockSummary = Fn<'report_stock_summary'>[number];
export type NewCustomersRow = Fn<'report_new_customers'>[number];

type Period = Pick<ReportRange, 'from' | 'to'>;

const period = (tenantId: string, range: Period) => ({
  p_tenant_id: tenantId,
  p_from: range.from,
  p_to: range.to,
});

/** Invoiced and collected per day (or week), every bucket present. */
export async function revenueReport(
  db: KittoClient,
  tenantId: string,
  range: Period & { bucket?: ReportBucket },
): Promise<RevenueRow[]> {
  return unwrap(
    await db.rpc('report_revenue', { ...period(tenantId, range), p_bucket: range.bucket ?? 'day' }),
  );
}

export async function paymentMethodsReport(
  db: KittoClient,
  tenantId: string,
  range: Period,
): Promise<PaymentMethodRow[]> {
  return unwrap(await db.rpc('report_payment_methods', period(tenantId, range)));
}

/** Outstanding balances by days overdue, as of `asOf` (default: today for the tenant). */
export async function receivablesAgingReport(
  db: KittoClient,
  tenantId: string,
  asOf?: string,
): Promise<AgingRow[]> {
  return unwrap(
    await db.rpc('report_receivables_aging', {
      p_tenant_id: tenantId,
      ...(asOf && { p_as_of: asOf }),
    }),
  );
}

export async function utilisationReport(
  db: KittoClient,
  tenantId: string,
  range: Period,
): Promise<UtilisationRow[]> {
  return unwrap(await db.rpc('report_booking_utilisation', period(tenantId, range)));
}

export async function reservationStatusReport(
  db: KittoClient,
  tenantId: string,
  range: Period,
): Promise<ReservationStatusRow[]> {
  return unwrap(await db.rpc('report_reservation_status', period(tenantId, range)));
}

export async function topItemsReport(
  db: KittoClient,
  tenantId: string,
  range: Period,
  limit = 10,
): Promise<TopItemRow[]> {
  return unwrap(await db.rpc('report_top_items', { ...period(tenantId, range), p_limit: limit }));
}

export async function stockSummaryReport(db: KittoClient, tenantId: string): Promise<StockSummary> {
  const [row] = unwrap(await db.rpc('report_stock_summary', { p_tenant_id: tenantId }));
  return row ?? { items: 0, stock_value_minor: 0, low_items: 0, uncosted_items: 0 };
}

export async function newCustomersReport(
  db: KittoClient,
  tenantId: string,
  range: Period,
): Promise<NewCustomersRow[]> {
  return unwrap(await db.rpc('report_new_customers', period(tenantId, range)));
}

/** Sum a numeric column of report rows. */
export function total<T>(rows: readonly T[], pick: (row: T) => number): number {
  return rows.reduce((sum, row) => sum + pick(row), 0);
}
