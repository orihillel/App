import { describe, it, expect } from 'vitest';
import { bestWindow } from './bestwindow.js';

const hour = (h, score, extra = {}) => ({
  hour: h, t: h + 'h', score, rating: 'GOOD', wave: '3-4', type: 'offshore',
  windSpd: 6, windDir: 'E', ...extra,
});

describe('bestWindow', () => {
  it('finds the run of hours at the day\'s best', () => {
    const w = bestWindow([hour(6, 1), hour(8, 5), hour(10, 5), hour(12, 1), hour(14, 0)]);
    expect(w.startHour).toBe(8);
    expect(w.endHour).toBe(10);
    expect(w.label).toBe('8a–10a');
  });

  it('keeps a run together across a one-point dip', () => {
    // 4 then 5 then 4 is one good stretch, not three separate ones.
    const w = bestWindow([hour(6, 0), hour(8, 4), hour(10, 5), hour(12, 4), hour(14, 0)]);
    expect(w.startHour).toBe(8);
    expect(w.endHour).toBe(12);
  });

  it('splits on a real drop', () => {
    const w = bestWindow([hour(6, 5), hour(8, 5), hour(10, 0), hour(12, 5)]);
    expect(w.startHour).toBe(6);
    expect(w.endHour).toBe(8);
  });

  it('prefers the longer run over a shorter one at the same level', () => {
    const w = bestWindow([hour(6, 5), hour(8, 0), hour(10, 5), hour(12, 5), hour(14, 5)]);
    expect(w.startHour).toBe(10);
    expect(w.endHour).toBe(14);
  });

  it('breaks ties towards the earlier run', () => {
    const w = bestWindow([hour(6, 5), hour(8, 5), hour(10, 0), hour(12, 5), hour(14, 5)]);
    expect(w.startHour).toBe(6);
  });

  it('labels a single-hour window without a range', () => {
    const w = bestWindow([hour(6, 0), hour(8, 5), hour(10, 0)]);
    expect(w.label).toBe('8a');
  });

  it('says nothing when the whole day is poor', () => {
    // Claiming a "best window" on a bad day reads as a recommendation to go.
    expect(bestWindow([hour(6, 0), hour(8, 1), hour(10, 0)])).toBeNull();
    expect(bestWindow([hour(6, -3), hour(8, -2)])).toBeNull();
  });

  it('reports the conditions at the peak hour of the window', () => {
    const w = bestWindow([
      hour(6, 4, { wave: '2-3', windSpd: 9 }),
      hour(8, 5, { wave: '4-5', windSpd: 3 }),
    ]);
    expect(w.wave).toBe('4-5');
    expect(w.windSpd).toBe(3);
  });

  it('handles empty, missing and unscored input', () => {
    expect(bestWindow([])).toBeNull();
    expect(bestWindow(null)).toBeNull();
    expect(bestWindow(undefined)).toBeNull();
    expect(bestWindow([{ hour: 6 }, { hour: 8 }])).toBeNull();
  });

  it('ignores unscored hours without letting them break a run', () => {
    const w = bestWindow([hour(6, 5), { hour: 8, t: '8a' }, hour(10, 5)]);
    // The unscored hour is not in the window, so the run stops there rather than spanning a gap
    // whose conditions are unknown.
    expect(w.startHour).toBe(6);
    expect(w.endHour).toBe(6);
  });

  it('indexes back into the array it was given', () => {
    const hours = [hour(6, 1), hour(8, 5), hour(10, 5)];
    const w = bestWindow(hours);
    expect(hours[w.startIdx].hour).toBe(w.startHour);
    expect(hours[w.endIdx].hour).toBe(w.endHour);
  });
});
