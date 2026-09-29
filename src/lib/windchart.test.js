import { describe, it, expect } from 'vitest';
import { windGrid, windBand, arrowSize, WIND_BANDS, WIND_HOURS, ARROW_MIN, ARROW_MAX, offshoreFromLabel } from './windchart.js';

const pt = (day, hour, windSpd, windDeg) => ({ day, hour, windSpd, windDeg });

// A day of three-hourly readings, midnight to 9pm.
function day(name, spd = 10, deg = 270) {
  return [0, 3, 6, 9, 12, 15, 18, 21].map((h) => pt(name, h, spd, deg));
}

describe('windBand', () => {
  it('steps through four named strengths', () => {
    expect(windBand(0).id).toBe('light');
    expect(windBand(7.9).id).toBe('light');
    expect(windBand(8).id).toBe('moderate');
    expect(windBand(15).id).toBe('strong');
    expect(windBand(22).id).toBe('very-strong');
    expect(windBand(60).id).toBe('very-strong');
    expect(windBand(null)).toBeNull();
  });

  it('gives every band its own colour', () => {
    expect(new Set(WIND_BANDS.map((b) => b.color)).size).toBe(WIND_BANDS.length);
  });
});

describe('arrowSize', () => {
  it('grows with the wind and stops growing at 30mph', () => {
    expect(arrowSize(0)).toBe(ARROW_MIN);
    expect(arrowSize(10)).toBeGreaterThan(arrowSize(5));
    expect(arrowSize(30)).toBe(ARROW_MAX);
    expect(arrowSize(60)).toBe(ARROW_MAX);
  });
});

describe('windGrid', () => {
  it('lays readings out one row a day and one column per surfable hour', () => {
    const g = windGrid([...day('Mon'), ...day('Tue')], 90);
    expect(g.hours).toEqual(WIND_HOURS);
    expect(g.rows.map((r) => r.day)).toEqual(['Mon', 'Tue']);
    expect(g.rows[0].cells.map((c) => c.hour)).toEqual(WIND_HOURS);
  });

  it('points the arrow where the wind goes and names where it comes from', () => {
    // A westerly (from 270) blows towards the east (90).
    const c = windGrid(day('Mon', 10, 270), 90).rows[0].cells[0];
    expect(c.from).toBe('W');
    expect(c.travelDeg).toBe(90);
  });

  it('says whether each reading is offshore at this spot', () => {
    const g = windGrid([pt('Mon', 6, 10, 90), pt('Mon', 9, 10, 270), pt('Mon', 12, 10, 0)], 90);
    expect(g.rows[0].cells.slice(0, 3).map((c) => c.type)).toEqual(['offshore', 'onshore', 'cross']);
  });

  it('keeps each reading pointing back at its place in the week, for tap selection', () => {
    const g = windGrid([...day('Mon'), ...day('Tue')], 90);
    expect(g.rows[1].cells[0].idx).toBe(8 + 2); // Tuesday 6am: 8 readings on Monday, then 0am, 3am
  });

  it('leaves a morning that has already gone empty rather than shifting the afternoon left', () => {
    const g = windGrid([pt('Mon', 15, 10, 0), pt('Mon', 18, 10, 0), ...day('Tue')], 90);
    expect(g.rows[0].cells.map(Boolean)).toEqual([false, false, false, true, true]);
  });

  it('stops at a week', () => {
    const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue'];
    const g = windGrid(names.flatMap((n) => day(n)), 90);
    expect(g.rows).toHaveLength(7);
  });

  it('draws nothing when no reading carries wind', () => {
    expect(windGrid([{ day: 'Mon', hour: 6, windSpd: null, windDeg: null }], 90)).toBeNull();
    expect(windGrid([], 90)).toBeNull();
    expect(windGrid(null, 90)).toBeNull();
  });
});

describe('offshoreFromLabel', () => {
  it('names the direction offshore wind comes from', () => {
    expect(offshoreFromLabel(90)).toBe('E');
    expect(offshoreFromLabel(undefined)).toBeNull();
  });
});
