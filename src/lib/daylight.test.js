import { describe, it, expect } from 'vitest';
import { isoLocalHour, daylightHours, pickHourAt } from './daylight.js';

describe('isoLocalHour', () => {
  it('reads the local wall-clock hour as a fraction', () => {
    expect(isoLocalHour('2026-09-04T06:30')).toBe(6.5);
    expect(isoLocalHour('2026-09-04T00:00')).toBe(0);
    expect(isoLocalHour('2026-09-04T19:45')).toBe(19.75);
  });
  it('returns null for anything unparseable', () => {
    for (const v of [null, undefined, '', 'nonsense', 42, {}]) {
      expect(isoLocalHour(v)).toBeNull();
    }
  });
});

describe('daylightHours', () => {
  it('opens an hour before sunrise and closes at sunset', () => {
    const hours = daylightHours('2026-06-21T05:42', '2026-06-21T20:10');
    expect(hours[0]).toBe(4);              // 05:42 -> floor 5, minus one
    expect(hours[hours.length - 1]).toBe(21); // 20:10 -> ceil 21
  });

  it('returns ascending, distinct whole hours', () => {
    const hours = daylightHours('2026-06-21T05:42', '2026-06-21T20:10');
    expect(hours).toEqual([...new Set(hours)]);
    for (let i = 1; i < hours.length; i++) expect(hours[i]).toBeGreaterThan(hours[i - 1]);
    expect(hours.every((h) => Number.isInteger(h) && h >= 0 && h <= 23)).toBe(true);
  });

  it('gives the requested number of samples on a normal day', () => {
    expect(daylightHours('2026-06-21T05:42', '2026-06-21T20:10')).toHaveLength(8);
  });

  it('shortens rather than repeating when the day is too short for that many', () => {
    // A December day inside the Arctic Circle: about four hours of usable light.
    const hours = daylightHours('2026-12-15T10:50', '2026-12-15T13:40');
    expect(hours.length).toBeLessThan(8);
    expect(hours).toEqual([...new Set(hours)]);
    expect(hours[0]).toBe(9);
    expect(hours[hours.length - 1]).toBe(14);
  });

  it('never suggests hours of darkness on a short winter day', () => {
    // The bug this replaces: the old fixed list ran 5am to 7pm regardless, so on this day it
    // offered six sample points before sunrise and three after sunset.
    const hours = daylightHours('2026-12-15T10:50', '2026-12-15T13:40');
    expect(hours.some((h) => h < 9)).toBe(false);
    expect(hours.some((h) => h > 14)).toBe(false);
  });

  it('falls back to a midday window through polar night, when there is no sunrise at all', () => {
    for (const [rise, set] of [[null, null], [undefined, undefined], ['bad', 'bad']]) {
      const hours = daylightHours(rise, set);
      expect(hours.length).toBeGreaterThan(0);
      expect(hours.every((h) => h >= 0 && h <= 23)).toBe(true);
      // Centred on midday, which is where the usable twilight is.
      expect(hours[0]).toBeGreaterThanOrEqual(6);
      expect(hours[hours.length - 1]).toBeLessThanOrEqual(20);
    }
  });

  it('clamps to a real clock at the extremes', () => {
    const hours = daylightHours('2026-06-21T00:10', '2026-06-21T23:55');
    expect(hours[0]).toBeGreaterThanOrEqual(0);
    expect(hours[hours.length - 1]).toBeLessThanOrEqual(23);
  });

  it('handles a sunset that does not follow its sunrise by falling back', () => {
    const hours = daylightHours('2026-06-21T20:00', '2026-06-21T05:00');
    expect(hours.length).toBeGreaterThan(0);
  });
});

describe('pickHourAt', () => {
  const hours = [5, 8, 11, 14, 17, 20].map((h) => ({ hour: h, t: h + 'h' }));

  it('finds the exact hour when the spot samples it', () => {
    expect(pickHourAt(hours, 11).hour).toBe(11);
  });

  it('falls back to the closest hour the spot actually has', () => {
    // The bug this replaces: a spot whose day is shorter than the one you were looking at had
    // no sample at that index and rendered as "no data" grey.
    expect(pickHourAt(hours, 12).hour).toBe(11);
    expect(pickHourAt(hours, 13).hour).toBe(14);
    expect(pickHourAt(hours, 3).hour).toBe(5);
    expect(pickHourAt(hours, 23).hour).toBe(20);
  });

  it('always returns a sample for a spot that has any', () => {
    const short = [{ hour: 10 }, { hour: 12 }, { hour: 14 }];
    for (let h = 0; h <= 23; h++) expect(pickHourAt(short, h)).toBeTruthy();
  });

  it('shows the same moment across spots with different windows', () => {
    const arctic = [{ hour: 10 }, { hour: 12 }, { hour: 14 }];
    const tropical = [{ hour: 5 }, { hour: 8 }, { hour: 11 }, { hour: 14 }, { hour: 17 }];
    // Asking both for 2pm gets 2pm at each, rather than "the 4th sample" — which is out of
    // range at one and mid-morning at the other.
    expect(pickHourAt(arctic, 14).hour).toBe(14);
    expect(pickHourAt(tropical, 14).hour).toBe(14);
  });

  it('handles empty, missing and unhoured input', () => {
    expect(pickHourAt([], 12)).toBeNull();
    expect(pickHourAt(null, 12)).toBeNull();
    expect(pickHourAt(undefined, 12)).toBeNull();
    const noHours = [{ t: '5a' }, { t: '7a' }];
    expect(pickHourAt(noHours, 12)).toBe(noHours[0]);
    expect(pickHourAt(hours, undefined)).toBe(hours[0]);
  });
});
