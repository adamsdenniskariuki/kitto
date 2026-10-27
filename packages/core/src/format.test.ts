import { describe, expect, it } from 'vitest';
import { addDays, isLocalDateTime, todayIn, utcToZonedLocal, zonedTimeToUtc } from './format';

describe('time zones', () => {
  it('converts tenant wall-clock time to UTC', () => {
    expect(zonedTimeToUtc('2026-03-06T19:00', 'Africa/Nairobi').toISOString()).toBe(
      '2026-03-06T16:00:00.000Z',
    );
    expect(zonedTimeToUtc('2026-01-15T09:30', 'America/New_York').toISOString()).toBe(
      '2026-01-15T14:30:00.000Z',
    );
    expect(zonedTimeToUtc('2026-07-15', 'Europe/London').toISOString()).toBe(
      '2026-07-14T23:00:00.000Z',
    );
  });

  it('handles daylight saving on either side of the change', () => {
    // New York springs forward on 2026-03-08 at 02:00.
    expect(zonedTimeToUtc('2026-03-08T01:00', 'America/New_York').toISOString()).toBe(
      '2026-03-08T06:00:00.000Z',
    );
    expect(zonedTimeToUtc('2026-03-08T03:00', 'America/New_York').toISOString()).toBe(
      '2026-03-08T07:00:00.000Z',
    );
  });

  it('round-trips through utcToZonedLocal', () => {
    for (const tz of ['Africa/Nairobi', 'Asia/Kolkata', 'America/Los_Angeles', 'UTC']) {
      expect(utcToZonedLocal(zonedTimeToUtc('2026-11-02T08:45', tz), tz)).toBe('2026-11-02T08:45');
    }
  });

  it('validates local date-times', () => {
    expect(isLocalDateTime('2026-02-28T23:59')).toBe(true);
    expect(isLocalDateTime('2026-02-29')).toBe(false);
    expect(isLocalDateTime('2026-01-01T24:00')).toBe(false);
    expect(isLocalDateTime('tomorrow')).toBe(false);
    expect(() => zonedTimeToUtc('nope', 'UTC')).toThrow(RangeError);
  });

  it('knows the local date and adds days across months', () => {
    expect(todayIn('Africa/Nairobi', new Date('2026-05-31T22:30:00Z'))).toBe('2026-06-01');
    expect(todayIn('UTC', new Date('2026-05-31T22:30:00Z'))).toBe('2026-05-31');
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});
