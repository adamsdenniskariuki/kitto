import { describe, expect, it } from 'vitest';
import { KittoError } from '@kitto/core';
import {
  addLocalMinutes,
  localMinutesBetween,
  openingHoursSchema,
  reservationFormSchema,
  resourceFormSchema,
} from './schemas';
import { bookingErrorCode, hoursErrorCode } from './shared';
import {
  BLOCKING_STATUSES,
  canTransition,
  isFinal,
  RESERVATION_STATUSES,
  STATUS_TRANSITIONS,
} from './status';

const reservation = (over: Partial<Record<string, string>> = {}) => ({
  resourceId: '7d1d6c34-5b8e-4d2c-9a43-2f6f0e1c9b11',
  start: '2026-03-02T14:00',
  end: '2026-03-02T15:30',
  customerId: '',
  guests: '2',
  title: '',
  notes: '',
  status: 'confirmed',
  repeat: '',
  occurrences: '',
  ...over,
});

describe('status machine (mirrors private.reservation_status_flow)', () => {
  it('allows the happy path and cancellations', () => {
    expect(canTransition('tentative', 'confirmed')).toBe(true);
    expect(canTransition('confirmed', 'checked_in')).toBe(true);
    expect(canTransition('checked_in', 'completed')).toBe(true);
    expect(canTransition('confirmed', 'cancelled')).toBe(true);
    expect(canTransition('confirmed', 'no_show')).toBe(true);
  });

  it('refuses skipping steps, going back and unknown statuses', () => {
    expect(canTransition('tentative', 'checked_in')).toBe(false);
    expect(canTransition('completed', 'confirmed')).toBe(false);
    expect(canTransition('checked_in', 'cancelled')).toBe(false);
    expect(canTransition('confirmed', 'teleported')).toBe(false);
  });

  it('treats statuses with no way out as final', () => {
    const finals = RESERVATION_STATUSES.filter(isFinal);
    expect(finals).toEqual(['completed', 'cancelled', 'no_show']);
    for (const s of finals) expect(STATUS_TRANSITIONS[s]).toEqual([]);
  });

  it('frees the resource only when cancelled or a no-show', () => {
    const freeing = RESERVATION_STATUSES.filter((s) => !BLOCKING_STATUSES.includes(s));
    expect(freeing).toEqual(['cancelled', 'no_show']);
  });
});

describe('resourceFormSchema', () => {
  const base = {
    kind: 'Meeting room',
    name: ' Boardroom ',
    description: '',
    capacity: '12',
    rate: '2,500.50',
    rateUnit: 'hour',
    active: true,
  };

  it('normalises kind, trims and parses numbers', () => {
    expect(resourceFormSchema.parse(base)).toEqual({
      kind: 'meeting_room',
      name: 'Boardroom',
      description: '',
      capacity: 12,
      rate: 2500.5,
      rateUnit: 'hour',
      active: true,
    });
  });

  it('defaults an empty kind and rate', () => {
    const r = resourceFormSchema.parse({ ...base, kind: '', rate: '' });
    expect(r.kind).toBe('resource');
    expect(r.rate).toBe(0);
  });

  it.each([
    { capacity: '0' },
    { capacity: '1.5' },
    { rate: '-1' },
    { rate: 'free' },
    { rateUnit: 'week' },
    { name: '  ' },
    { kind: '9lives' },
  ])('rejects %o', (over) => {
    expect(resourceFormSchema.safeParse({ ...base, ...over }).success).toBe(false);
  });
});

describe('openingHoursSchema', () => {
  it('accepts a valid day', () => {
    expect(openingHoursSchema.parse({ weekday: '1', opens: '08:00', closes: '17:30' })).toEqual({
      weekday: 1,
      opens: '08:00',
      closes: '17:30',
    });
  });

  it.each([
    { weekday: '7', opens: '08:00', closes: '17:00' },
    { weekday: '1', opens: '17:00', closes: '08:00' },
    { weekday: '1', opens: '8am', closes: '17:00' },
    { weekday: '1', opens: '24:00', closes: '23:00' },
  ])('rejects %o', (h) => {
    expect(openingHoursSchema.safeParse(h).success).toBe(false);
  });
});

describe('reservationFormSchema', () => {
  it('parses a one-off booking', () => {
    const r = reservationFormSchema.parse(reservation());
    expect(r).toMatchObject({ customerId: null, guests: 2, repeat: '', occurrences: 1 });
  });

  it('drops seconds from browser datetime values', () => {
    const r = reservationFormSchema.parse(
      reservation({ start: '2026-03-02T14:00:00', end: '2026-03-02T15:00:00' }),
    );
    expect([r.start, r.end]).toEqual(['2026-03-02T14:00', '2026-03-02T15:00']);
  });

  it('requires the end after the start', () => {
    const res = reservationFormSchema.safeParse(reservation({ end: '2026-03-02T14:00' }));
    expect(res.success).toBe(false);
    expect(res.error?.issues[0]?.path).toEqual(['end']);
  });

  it('needs at least two occurrences to repeat', () => {
    expect(
      reservationFormSchema.safeParse(reservation({ repeat: 'weekly', occurrences: '1' })).success,
    ).toBe(false);
    expect(
      reservationFormSchema.parse(reservation({ repeat: 'weekly', occurrences: '4' })).occurrences,
    ).toBe(4);
    expect(
      reservationFormSchema.safeParse(reservation({ repeat: 'daily', occurrences: '53' })).success,
    ).toBe(false);
  });

  it.each([
    { resourceId: 'nope' },
    { customerId: 'nope' },
    { guests: '0' },
    { status: 'completed' },
    { start: 'tomorrow' },
  ])('rejects %o', (over) => {
    expect(reservationFormSchema.safeParse(reservation(over)).success).toBe(false);
  });
});

describe('local wall-clock arithmetic', () => {
  it('measures and adds minutes across midnight', () => {
    expect(localMinutesBetween('2026-03-02T22:00', '2026-03-03T01:30')).toBe(210);
    expect(addLocalMinutes('2026-03-02T23:30', 90)).toBe('2026-03-03T01:00');
  });
});

describe('bookingErrorCode', () => {
  it.each([
    ['23P01', 'conflicting key value violates exclusion constraint', 'conflict'],
    ['22023', 'A completed reservation cannot become confirmed', 'bad_transition'],
    ['22023', 'This reservation is cancelled and can no longer be changed', 'final'],
    ['22023', 'Boardroom holds at most 12 guests', 'capacity'],
    ['22023', 'Boardroom is not taking reservations', 'inactive'],
    ['22023', 'The end must be after the start', 'invalid_time'],
    ['42501', 'permission denied', 'forbidden'],
    ['P0002', 'Resource not found', 'not_found'],
    ['23503', 'violates foreign key', 'in_use'],
  ])('%s %s -> %s', (code, message, expected) => {
    expect(bookingErrorCode(new KittoError(message, code))).toBe(expected);
  });

  it('maps duplicate opening hours to an overlap', () => {
    expect(hoursErrorCode(new KittoError('duplicate key', '23505'))).toBe('overlapping_hours');
  });
});
