/**
 * Per-tenant formatting. Money is stored as integer minor units (cents) in
 * the database, never floats; these helpers convert for display only.
 */

export interface TenantLocale {
  currency: string;
  locale: string;
  timezone: string;
}

export const DEFAULT_TENANT_LOCALE: TenantLocale = {
  currency: 'KES',
  locale: 'en-KE',
  timezone: 'Africa/Nairobi',
};

function fractionDigits(currency: string): number {
  return (
    new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits ?? 2
  );
}

/** Convert minor units (e.g. cents) to a major-unit number. */
export function fromMinorUnits(minor: number, currency: string): number {
  return minor / 10 ** fractionDigits(currency);
}

/** Convert a major-unit amount (e.g. 12.5) to integer minor units, rounding half away from zero. */
export function toMinorUnits(major: number, currency: string): number {
  // Shift the decimal point in the string form so 1.005 -> 100.5 (not 100.49999...).
  const [mantissa, exponent = '0'] = String(Math.abs(major)).split('e');
  const shifted = Number(`${mantissa}e${Number(exponent) + fractionDigits(currency)}`);
  return Math.sign(major) * Math.round(shifted) || 0;
}

export function formatMoney(
  minor: number,
  t: Pick<TenantLocale, 'currency' | 'locale'> = DEFAULT_TENANT_LOCALE,
): string {
  return new Intl.NumberFormat(t.locale, { style: 'currency', currency: t.currency }).format(
    fromMinorUnits(minor, t.currency),
  );
}

export function formatNumber(
  value: number,
  t: Pick<TenantLocale, 'locale'> = DEFAULT_TENANT_LOCALE,
): string {
  return new Intl.NumberFormat(t.locale).format(value);
}

export function formatDate(
  value: Date | string,
  t: Pick<TenantLocale, 'locale' | 'timezone'> = DEFAULT_TENANT_LOCALE,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' },
): string {
  return new Intl.DateTimeFormat(t.locale, { timeZone: t.timezone, ...options }).format(
    new Date(value),
  );
}

export function formatDateTime(
  value: Date | string,
  t: Pick<TenantLocale, 'locale' | 'timezone'> = DEFAULT_TENANT_LOCALE,
): string {
  return formatDate(value, t, { dateStyle: 'medium', timeStyle: 'short' });
}
