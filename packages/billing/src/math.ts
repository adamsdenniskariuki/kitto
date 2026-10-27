/**
 * Line arithmetic, mirroring the GENERATED columns on invoice_lines exactly so
 * the form can preview totals before saving. The database stays the source of
 * truth; this only has to agree with it.
 *
 *   subtotal = round(quantity * unit_price)            (half up)
 *   tax      = round(subtotal * tax_rate_bp / 10000)   (half up, on the rounded subtotal)
 *   total    = subtotal + tax
 *
 * Quantities have at most two decimals, so everything is done in BigInt
 * hundredths: no floating-point drift on large amounts.
 */

export interface LineAmountsInput {
  /** Up to two decimals, e.g. 1.5 or "2.25". */
  quantity: number | string;
  unitPriceMinor: number;
  /** Basis points: 1600 = 16%. */
  taxRateBp: number;
}

export interface LineAmounts {
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
}

/** n / d rounded half up, for non-negative n and positive d. */
function divHalfUp(n: bigint, d: bigint): bigint {
  return (n * 2n + d) / (2n * d);
}

/** Quantity in hundredths (1.5 -> 150), or null if it has more than two decimals. */
export function quantityHundredths(quantity: number | string): bigint | null {
  const s = typeof quantity === 'number' ? String(quantity) : quantity.trim();
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  return BigInt(m[1]!) * 100n + BigInt((m[2] ?? '').padEnd(2, '0'));
}

export function lineAmounts(line: LineAmountsInput): LineAmounts {
  const q = quantityHundredths(line.quantity);
  if (q === null || !Number.isSafeInteger(line.unitPriceMinor) || line.unitPriceMinor < 0) {
    return { subtotalMinor: 0, taxMinor: 0, totalMinor: 0 };
  }
  const subtotal = divHalfUp(q * BigInt(line.unitPriceMinor), 100n);
  const tax = divHalfUp(subtotal * BigInt(Math.max(0, Math.trunc(line.taxRateBp))), 10000n);
  return {
    subtotalMinor: Number(subtotal),
    taxMinor: Number(tax),
    totalMinor: Number(subtotal + tax),
  };
}

export function documentTotals(lines: readonly LineAmountsInput[]): LineAmounts {
  return lines.map(lineAmounts).reduce(
    (sum, l) => ({
      subtotalMinor: sum.subtotalMinor + l.subtotalMinor,
      taxMinor: sum.taxMinor + l.taxMinor,
      totalMinor: sum.totalMinor + l.totalMinor,
    }),
    { subtotalMinor: 0, taxMinor: 0, totalMinor: 0 },
  );
}

/** 1600 -> "16%", 1250 -> "12.5%". */
export function formatTaxRate(bp: number): string {
  return `${Number((bp / 100).toFixed(2))}%`;
}

/** "16" or "12.5" (percent) -> basis points, or null when not 0..100 with at most two decimals. */
export function percentToBp(percent: string): number | null {
  const q = quantityHundredths(percent === '' ? '0' : percent);
  if (q === null || q > 10000n) return null;
  return Number(q);
}
