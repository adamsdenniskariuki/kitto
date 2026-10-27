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

// ------------------------------------------------------------- time zones
//
// Staff think in the tenant's wall-clock time ("Friday 19:00 in Nairobi"),
// whatever time zone their device or the server is in. These helpers move
// between that local time ("YYYY-MM-DDTHH:mm", what <input type=
// "datetime-local"> uses) and absolute instants, using only Intl.

const LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/;

function zoneParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

/** Offset of `timeZone` from UTC at `date`, in milliseconds (Nairobi: +3h). */
function zoneOffset(date: Date, timeZone: string): number {
  const p = zoneParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

function localParts(local: string): [number, number, number, number, number, number] | null {
  const m = LOCAL_PATTERN.exec(local);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map((v) => Number(v ?? 0)) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const date = new Date(Date.UTC(y, mo - 1, d));
  const valid =
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === mo - 1 &&
    date.getUTCDate() === d &&
    h < 24 &&
    mi < 60 &&
    s < 60;
  return valid ? [y, mo, d, h, mi, s] : null;
}

/** True for "YYYY-MM-DD", "YYYY-MM-DDTHH:mm" and "YYYY-MM-DDTHH:mm:ss" with real dates. */
export function isLocalDateTime(local: string): boolean {
  return localParts(local) !== null;
}

/** The instant at which the wall clock in `timeZone` shows `local`. */
export function zonedTimeToUtc(local: string, timeZone: string): Date {
  const parts = localParts(local);
  if (!parts) throw new RangeError(`Invalid local date-time: ${local}`);
  const [y, mo, d, h, mi, s] = parts;
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  // Two passes settle the offset even next to a daylight-saving change.
  const first = guess - zoneOffset(new Date(guess), timeZone);
  return new Date(guess - zoneOffset(new Date(first), timeZone));
}

/** "YYYY-MM-DDTHH:mm" as shown by a wall clock in `timeZone` at `value`. */
export function utcToZonedLocal(value: Date | string, timeZone: string): string {
  const p = zoneParts(new Date(value), timeZone);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** Today's date ("YYYY-MM-DD") in `timeZone`. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return utcToZonedLocal(now, timeZone).slice(0, 10);
}

/** Add whole days to a "YYYY-MM-DD" date (calendar arithmetic, no time zones involved). */
export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
