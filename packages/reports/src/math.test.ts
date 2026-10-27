import { describe, expect, it } from 'vitest';
import {
  barRects,
  daysBetween,
  donutArcs,
  formatDay,
  labelIndexes,
  linePath,
  niceCeiling,
  percent,
  presetRanges,
  resolveRange,
  slotCentres,
  ticks,
  yScale,
} from './math';

describe('scales', () => {
  it('niceCeiling rounds up to 1, 2 or 5 x 10^n', () => {
    expect(niceCeiling(0)).toBe(1);
    expect(niceCeiling(-5)).toBe(1);
    expect(niceCeiling(Number.NaN)).toBe(1);
    expect(niceCeiling(1)).toBe(1);
    expect(niceCeiling(1.2)).toBe(2);
    expect(niceCeiling(3)).toBe(5);
    expect(niceCeiling(7)).toBe(10);
    expect(niceCeiling(10)).toBe(10);
    expect(niceCeiling(11)).toBe(20);
    expect(niceCeiling(450)).toBe(500);
    expect(niceCeiling(501)).toBe(1000);
    expect(niceCeiling(1_234_567)).toBe(2_000_000);
  });

  it('ticks are evenly spaced from zero', () => {
    expect(ticks(100)).toEqual([0, 25, 50, 75, 100]);
    expect(ticks(5, 2)).toEqual([0, 2.5, 5]);
    expect(ticks(1, 0)).toEqual([0, 1]);
  });

  it('yScale maps 0..max to height..0 and clamps', () => {
    const y = yScale(200, 100);
    expect(y(0)).toBe(100);
    expect(y(100)).toBe(50);
    expect(y(200)).toBe(0);
    expect(y(400)).toBe(0);
    expect(y(-10)).toBe(100);
    expect(yScale(0, 100)(0)).toBe(100);
  });

  it('slotCentres splits the width evenly', () => {
    expect(slotCentres(4, 100)).toEqual([12.5, 37.5, 62.5, 87.5]);
    expect(slotCentres(0, 100)).toEqual([]);
  });
});

describe('barRects', () => {
  it('lays out grouped bars inside each slot', () => {
    const [a, b] = barRects(
      [
        [10, 0],
        [5, 20],
      ],
      200,
      100,
      20,
      0.5,
    );
    // Two slots of 100; the group is 50 wide and centred, each bar 25.
    expect(a![0]).toEqual({ x: 25, y: 50, width: 25, height: 50 });
    expect(b![0]).toEqual({ x: 50, y: 75, width: 25, height: 25 });
    expect(a![1]).toEqual({ x: 125, y: 100, width: 25, height: 0 });
    expect(b![1]).toEqual({ x: 150, y: 0, width: 25, height: 100 });
  });

  it('copes with no data', () => {
    expect(barRects([], 100, 100, 1)).toEqual([]);
    expect(barRects([[]], 100, 100, 1)).toEqual([[]]);
  });
});

describe('linePath', () => {
  it('draws through each slot centre', () => {
    expect(linePath([0, 50, 100], 300, 100, 100)).toBe('M50 100 L150 50 L250 0');
  });

  it('rounds to two decimals', () => {
    expect(linePath([1], 3, 3, 3)).toBe('M1.5 2');
    expect(linePath([1, 2], 1, 3, 3)).toBe('M0.25 2 L0.75 1');
  });
});

describe('donutArcs', () => {
  it('splits the ring by share, clockwise from 12 o’clock', () => {
    const arcs = donutArcs([1, 0, 3], 10, 5);
    expect(arcs.map((a) => [a.index, a.fraction])).toEqual([
      [0, 0.25],
      [2, 0.75],
    ]);
    // A quarter: from the top (0,-10) to 3 o'clock (10,0), small arc.
    expect(arcs[0]!.path).toBe('M0 -10 A10 10 0 0 1 10 0 L5 0 A5 5 0 0 0 0 -5 Z');
    // Three quarters needs the large-arc flag.
    expect(arcs[1]!.path).toMatch(/^M10 0 A10 10 0 1 1 0 -10 /);
  });

  it('draws a single full slice as two halves', () => {
    const [arc] = donutArcs([0, 7], 10, 5);
    expect(arc!.index).toBe(1);
    expect(arc!.fraction).toBe(1);
    expect(arc!.path.match(/Z/g)).toHaveLength(2);
  });

  it('returns nothing when everything is zero or negative', () => {
    expect(donutArcs([0, 0], 10, 5)).toEqual([]);
    expect(donutArcs([-1], 10, 5)).toEqual([]);
  });
});

describe('helpers', () => {
  it('percent rounds and survives zero', () => {
    expect(percent(1, 3)).toBe(33);
    expect(percent(2, 3)).toBe(67);
    expect(percent(5, 0)).toBe(0);
  });

  it('labelIndexes keeps first and last', () => {
    expect(labelIndexes(0)).toEqual([]);
    expect(labelIndexes(3, 6)).toEqual([0, 1, 2]);
    expect(labelIndexes(30, 5)).toEqual([0, 7, 15, 22, 29]);
  });

  it('formatDay does not shift the day by time zone', () => {
    expect(formatDay('2026-03-01', 'en-KE')).toBe('1 Mar');
    expect(formatDay('2026-12-31', 'en-US', { dateStyle: 'medium' })).toBe('Dec 31, 2026');
  });

  it('daysBetween counts calendar days', () => {
    expect(daysBetween('2026-03-01', '2026-03-31')).toBe(30);
    expect(daysBetween('2026-03-31', '2026-03-01')).toBe(-30);
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2);
  });
});

describe('resolveRange', () => {
  // 22:30 UTC on 1 March is already 2 March in Nairobi (UTC+3).
  const now = new Date('2026-03-01T22:30:00Z');
  const tz = 'Africa/Nairobi';

  it('defaults to the last 30 days ending today in the tenant time zone', () => {
    expect(resolveRange({}, tz, now)).toEqual({
      from: '2026-02-01',
      to: '2026-03-02',
      days: 30,
      bucket: 'day',
      adjusted: false,
    });
    expect(resolveRange({}, 'UTC', now).to).toBe('2026-03-01');
  });

  it('keeps a valid range', () => {
    expect(resolveRange({ from: '2026-01-01', to: '2026-01-07' }, tz, now)).toMatchObject({
      from: '2026-01-01',
      to: '2026-01-07',
      days: 7,
      bucket: 'day',
      adjusted: false,
    });
  });

  it('fills in a missing end from the other', () => {
    expect(resolveRange({ from: '2026-01-01' }, tz, now)).toMatchObject({
      from: '2026-01-01',
      to: '2026-01-30',
    });
    expect(resolveRange({ to: '2026-01-30' }, tz, now)).toMatchObject({
      from: '2026-01-01',
      to: '2026-01-30',
    });
  });

  it('swaps a reversed range', () => {
    expect(resolveRange({ from: '2026-01-07', to: '2026-01-01' }, tz, now)).toMatchObject({
      from: '2026-01-01',
      to: '2026-01-07',
      adjusted: true,
    });
  });

  it('ignores invalid dates', () => {
    const r = resolveRange({ from: '2026-02-30', to: 'yesterday' }, tz, now);
    expect(r).toMatchObject({ from: '2026-02-01', to: '2026-03-02', adjusted: true });
    expect(resolveRange({ from: '2026-01-01T10:00' }, tz, now).adjusted).toBe(true);
  });

  it('caps the length at 366 days, keeping the end', () => {
    const r = resolveRange({ from: '2020-01-01', to: '2026-03-01' }, tz, now);
    expect(r).toMatchObject({ to: '2026-03-01', days: 366, adjusted: true });
    expect(r.from).toBe('2025-03-01');
  });

  it('switches to weekly buckets for long periods', () => {
    expect(resolveRange({ from: '2026-01-01', to: '2026-04-02' }, tz, now).bucket).toBe('day');
    expect(resolveRange({ from: '2026-01-01', to: '2026-04-03' }, tz, now).bucket).toBe('week');
  });

  it('presets end today', () => {
    const presets = presetRanges(tz, now);
    expect(presets.map((p) => p.label)).toEqual([
      'Last 7 days',
      'Last 30 days',
      'Last 90 days',
      'Last 365 days',
    ]);
    expect(presets[0]).toEqual({ label: 'Last 7 days', from: '2026-02-24', to: '2026-03-02' });
    expect(presets.every((p) => !resolveRange(p, tz, now).adjusted)).toBe(true);
  });
});
