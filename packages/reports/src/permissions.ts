/** Permission key registered by the reports migration. */
export const REPORT_PERMISSIONS = {
  view: 'reports.view',
} as const;

/**
 * Each report also needs the view permission of the module it reads (the SQL
 * checks both). Kept as plain keys so reports doesn't depend on every module.
 */
export const REPORT_SOURCE_PERMISSIONS = {
  billing: 'billing.view',
  booking: 'booking.view',
  orders: 'orders.view',
  inventory: 'inventory.view',
  customers: 'customers.view',
} as const;

export type ReportSource = keyof typeof REPORT_SOURCE_PERMISSIONS;
