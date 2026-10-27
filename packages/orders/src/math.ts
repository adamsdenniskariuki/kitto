/**
 * Order totals, mirroring the database: a line total is
 * round(quantity * unit price) in minor units (order_lines.line_total_minor)
 * and the order total is their sum. Quantities have up to three decimals, so
 * they are scaled to thousandths to avoid floating point drift.
 */
export function lineTotalMinor(quantity: number | string, unitPriceMinor: number): number {
  const thousandths = Math.round(Number(quantity) * 1000);
  return Math.round((thousandths * unitPriceMinor) / 1000);
}

export function orderTotalMinor(
  lines: readonly { quantity: number | string; unit_price_minor: number }[],
): number {
  return lines.reduce((sum, l) => sum + lineTotalMinor(l.quantity, l.unit_price_minor), 0);
}

/** An invoice line as billing's SourceInvoices takes it (orders doesn't depend on billing). */
export interface InvoiceLineSuggestion {
  description: string;
  quantity: number;
  unitPriceMinor: number;
  taxRateBp: number;
}

const hasAtMostTwoDecimals = (q: number) => Math.abs(Math.round(q * 100) - q * 100) < 1e-6;

/**
 * Invoice lines for an order's lines. Invoices count in hundredths, so a line
 * like 0.125 kg becomes one line at its total, with the quantity in the text.
 * `prefix` labels lines from several orders on one invoice ("#12 · ").
 */
export function orderInvoiceLines(
  lines: readonly {
    description: string;
    quantity: number | string;
    unit_price_minor: number;
    note?: string;
  }[],
  prefix = '',
): InvoiceLineSuggestion[] {
  return lines.map((l) => {
    const quantity = Number(l.quantity);
    const text = `${prefix}${l.description}${l.note ? ` (${l.note})` : ''}`.slice(0, 500);
    return hasAtMostTwoDecimals(quantity)
      ? { description: text, quantity, unitPriceMinor: l.unit_price_minor, taxRateBp: 0 }
      : {
          description: `${text} × ${quantity}`.slice(0, 500),
          quantity: 1,
          unitPriceMinor: lineTotalMinor(quantity, l.unit_price_minor),
          taxRateBp: 0,
        };
  });
}
