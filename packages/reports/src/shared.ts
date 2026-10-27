import { REPORT_PERMISSIONS, REPORT_SOURCE_PERMISSIONS, type ReportSource } from './permissions';

type Can = { can: (p: string) => boolean };

/** The report sections, in page order, and the module each one reads. */
export const REPORT_SECTIONS = {
  revenue: 'billing',
  payments: 'billing',
  aging: 'billing',
  booking: 'booking',
  'top-items': 'orders',
  stock: 'inventory',
  customers: 'customers',
} as const satisfies Record<string, ReportSource>;

export type ReportSection = keyof typeof REPORT_SECTIONS;

export const ALL_REPORT_SECTIONS = Object.keys(REPORT_SECTIONS) as ReportSection[];

/** True when the user may see reports built on `source`'s data. */
export function canViewReport(ctx: Can, source: ReportSource): boolean {
  return ctx.can(REPORT_PERMISSIONS.view) && ctx.can(REPORT_SOURCE_PERMISSIONS[source]);
}

/** The sections of `sections` the user may see. */
export function visibleReportSections(
  ctx: Can,
  sections: readonly ReportSection[] = ALL_REPORT_SECTIONS,
): ReportSection[] {
  return sections.filter((s) => canViewReport(ctx, REPORT_SECTIONS[s]));
}

/** Nav entry for apps that include the reports module. */
export function reportsNav(ctx: Can & { path: (p?: string) => string }) {
  return ctx.can(REPORT_PERMISSIONS.view) ? [{ href: ctx.path('/reports'), label: 'Reports' }] : [];
}

export const REPORT_PAYMENT_METHOD_LABELS: Record<string, string> = {
  mpesa: 'M-Pesa',
  cash: 'Cash',
  card: 'Card',
  bank: 'Bank transfer',
  other: 'Other',
};

export const REPORT_AGING_LABELS: Record<string, string> = {
  current: 'Not yet due',
  '1_30': '1–30 days',
  '31_60': '31–60 days',
  '61_90': '61–90 days',
  over_90: 'Over 90 days',
};

export const REPORT_RESERVATION_STATUS_LABELS: Record<string, string> = {
  tentative: 'Tentative',
  confirmed: 'Confirmed',
  checked_in: 'Checked in',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'No-show',
};
