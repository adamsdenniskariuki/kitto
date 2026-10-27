import { addDays, isLocalDateTime, todayIn } from '@kitto/core';

// ------------------------------------------------------------------ scales

/** The smallest "nice" number (1, 2 or 5 x 10^n) at or above `value`; at least 1. */
export function niceCeiling(value: number): number {
  if (!Number.isFinite(value) || value <= 1) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 5, 10]) {
    // Round away float noise (e.g. 0.1 * 3) before comparing.
    const candidate = Number((step * magnitude).toPrecision(12));
    if (candidate >= value) return candidate;
  }
  return 10 * magnitude;
}

/** Evenly spaced axis ticks from 0 to `max` (inclusive). */
export function ticks(max: number, count = 4): number[] {
  const n = Math.max(1, Math.round(count));
  return Array.from({ length: n + 1 }, (_, i) => Number(((max * i) / n).toPrecision(12)));
}

/** Map 0..max onto height..0 (SVG y grows downwards). Values are clamped into range. */
export function yScale(max: number, height: number) {
  const top = max > 0 ? max : 1;
  return (value: number) => height - (Math.min(Math.max(value, 0), top) / top) * height;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Grouped vertical bars: one slot per category, one bar per series inside it.
 * `series[s][c]` is the value of series s in category c. Bars fill `fill` of
 * each slot, leaving the rest as a gap between categories.
 */
export function barRects(
  series: readonly (readonly number[])[],
  width: number,
  height: number,
  max: number,
  fill = 0.75,
): Rect[][] {
  const categories = Math.max(0, ...series.map((s) => s.length));
  const slot = width / Math.max(1, categories);
  const groupWidth = slot * Math.min(Math.max(fill, 0.05), 1);
  const barWidth = groupWidth / Math.max(1, series.length);
  const y = yScale(max, height);
  return series.map((values, s) =>
    values.map((v, c) => {
      const top = y(v);
      return {
        x: c * slot + (slot - groupWidth) / 2 + s * barWidth,
        y: top,
        width: barWidth,
        height: height - top,
      };
    }),
  );
}

/** The x of each category's centre. */
export function slotCentres(count: number, width: number): number[] {
  const slot = width / Math.max(1, count);
  return Array.from({ length: count }, (_, i) => (i + 0.5) * slot);
}

const round = (n: number) => Math.round(n * 100) / 100;

/** An SVG path through the values, one point per category centre. */
export function linePath(values: readonly number[], width: number, height: number, max: number) {
  const xs = slotCentres(values.length, width);
  const y = yScale(max, height);
  return values.map((v, i) => `${i === 0 ? 'M' : 'L'}${round(xs[i]!)} ${round(y(v))}`).join(' ');
}

export interface Arc {
  /** Index into the input values. */
  index: number;
  value: number;
  fraction: number;
  /** SVG path of the ring segment, centred on (0, 0). */
  path: string;
}

/**
 * Ring segments for a donut chart centred on (0, 0), starting at 12 o'clock
 * and running clockwise. Zero values get no segment; a single non-zero value
 * is drawn as two half rings because an SVG arc cannot close on itself.
 */
export function donutArcs(values: readonly number[], radius: number, inner: number): Arc[] {
  const total = values.reduce((sum, v) => sum + Math.max(v, 0), 0);
  if (total <= 0) return [];
  const point = (r: number, turn: number) => {
    const angle = turn * 2 * Math.PI - Math.PI / 2;
    return `${round(r * Math.cos(angle))} ${round(r * Math.sin(angle))}`;
  };
  const segment = (start: number, end: number) => {
    const large = end - start > 0.5 ? 1 : 0;
    return (
      `M${point(radius, start)} A${radius} ${radius} 0 ${large} 1 ${point(radius, end)} ` +
      `L${point(inner, end)} A${inner} ${inner} 0 ${large} 0 ${point(inner, start)} Z`
    );
  };
  const arcs: Arc[] = [];
  let start = 0;
  values.forEach((raw, index) => {
    const value = Math.max(raw, 0);
    if (value === 0) return;
    const fraction = value / total;
    const end = start + fraction;
    const path =
      fraction >= 0.999999
        ? `${segment(0, 0.5)} ${segment(0.5, 1)}`
        : segment(start, Math.min(end, 1));
    arcs.push({ index, value, fraction, path });
    start = end;
  });
  return arcs;
}

/** Whole-number percentage of part in whole (0 when whole is 0). */
export function percent(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

/** Spread `count` labels so at most `max` are shown: indexes to label, always first and last. */
export function labelIndexes(count: number, max = 6): number[] {
  if (count <= 0) return [];
  if (count <= max) return Array.from({ length: count }, (_, i) => i);
  const step = (count - 1) / (max - 1);
  return [...new Set(Array.from({ length: max }, (_, i) => Math.round(i * step)))];
}

// ------------------------------------------------------------ date ranges

export const DEFAULT_RANGE_DAYS = 30;
export const MAX_RANGE_DAYS = 366;
/** Longer periods are charted per week instead of per day. */
export const WEEKLY_AFTER_DAYS = 92;

export type ReportBucket = 'day' | 'week';

export interface ReportRange {
  /** First day, "YYYY-MM-DD" in the tenant's time zone. */
  from: string;
  /** Last day (inclusive). */
  to: string;
  days: number;
  bucket: ReportBucket;
  /** True when the requested range was invalid, reversed or too long and has been corrected. */
  adjusted: boolean;
}

const isDay = (v: string | undefined): v is string =>
  typeof v === 'string' && v.length === 10 && isLocalDateTime(v);

/** Whole days from `a` to `b` ("YYYY-MM-DD"); negative when b is earlier. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/**
 * The report period from ?from=&to= (both optional, inclusive local dates).
 * Defaults to the last 30 days ending today in `timeZone`; a reversed range
 * is swapped and anything longer than 366 days keeps its end date.
 */
export function resolveRange(
  input: { from?: string | undefined; to?: string | undefined },
  timeZone: string,
  now: Date = new Date(),
): ReportRange {
  const today = todayIn(timeZone, now);
  let adjusted = false;
  const given = (v: string | undefined) => {
    if (!v) return undefined;
    if (isDay(v)) return v;
    adjusted = true;
    return undefined;
  };
  let from = given(input.from);
  let to = given(input.to);
  if (!to) to = from ? addDays(from, DEFAULT_RANGE_DAYS - 1) : today;
  if (!from) from = addDays(to, -(DEFAULT_RANGE_DAYS - 1));
  if (daysBetween(from, to) < 0) {
    [from, to] = [to, from];
    adjusted = true;
  }
  if (daysBetween(from, to) + 1 > MAX_RANGE_DAYS) {
    from = addDays(to, -(MAX_RANGE_DAYS - 1));
    adjusted = true;
  }
  const days = daysBetween(from, to) + 1;
  return { from, to, days, bucket: days > WEEKLY_AFTER_DAYS ? 'week' : 'day', adjusted };
}

/** Preset periods ending today: [label, from, to]. */
export function presetRanges(timeZone: string, now: Date = new Date()) {
  const today = todayIn(timeZone, now);
  return [7, 30, 90, 365].map((n) => ({
    label: `Last ${n} days`,
    from: addDays(today, -(n - 1)),
    to: today,
  }));
}

/** Format a "YYYY-MM-DD" day without shifting it through a time zone. */
export function formatDay(
  day: string,
  locale: string,
  options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' },
): string {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(
    new Date(`${day}T00:00:00Z`),
  );
}
