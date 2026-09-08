import { describe, it, expect } from 'vitest';
import { nextTideEvent, tideState } from './tides.js';

// A simple curve: rises to a high at hour 3, falls to a low at hour 9, rises again.
const TIDE = [0, 1, 2, 3, 2, 1, 0, -1, -2, -3, -2, -1, 0].map((ft, hour) => ({ hour, ft }));

describe('nextTideEvent', () => {
  it('finds the next high after the given hour', () => {
    expect(nextTideEvent(TIDE, 0)).toEqual({ type: 'High', hour: 3 });
  });
  it('finds the next low when a high has already passed', () => {
    expect(nextTideEvent(TIDE, 4)).toEqual({ type: 'Low', hour: 9 });
  });
  it('returns null once every event in the data has already passed', () => {
    expect(nextTideEvent(TIDE, 11)).toBeNull();
  });
  it('returns null for missing or too-short data instead of throwing', () => {
    expect(nextTideEvent(null, 0)).toBeNull();
    expect(nextTideEvent([{ hour: 0, ft: 1 }, { hour: 1, ft: 2 }], 0)).toBeNull();
  });
});

describe('tideState', () => {
  // A clean semidiurnal-ish day: low at 0, high at 6, low at 12, high at 18.
  const curve = Array.from({ length: 24 }, (_, h) => ({ hour: h, ft: -3 * Math.cos((h / 12) * Math.PI * 2) }));

  it('calls the peak High and the trough Low', () => {
    expect(tideState(curve, 6)).toBe('High');
    expect(tideState(curve, 12)).toBe('Low');
    expect(tideState(curve, 18)).toBe('High');
  });

  it('will not call the first sample a turn, having nothing before it to compare', () => {
    // Hour 0 is the bottom of this curve, but the curve starts there: nothing says whether the
    // tide arrived at that point falling or had been sitting there. All that is actually known
    // is that it rises from here, so that is what it says. Calling it "Low" would be a guess,
    // and it is midnight -- an hour the spot page never shows, since it samples daylight.
    expect(tideState(curve, 0)).toBe('Pushing');
  });

  it('calls a rising tide Pushing and a falling one Pulling', () => {
    expect(tideState(curve, 3)).toBe('Pushing');   // climbing towards the 6am high
    expect(tideState(curve, 9)).toBe('Pulling');   // draining towards the noon low
    expect(tideState(curve, 15)).toBe('Pushing');
    expect(tideState(curve, 21)).toBe('Pulling');
  });

  it('agrees with nextTideEvent about where the turns are', () => {
    // The two are read off the same curve and shown side by side; disagreeing would put
    // "High" next to "Next High 6p".
    for (let h = 0; h < 22; h++) {
      const next = nextTideEvent(curve, h);
      if (!next) continue;
      expect(tideState(curve, next.hour)).toBe(next.type);
    }
  });

  it('reads the hour asked about, not the start of the day', () => {
    expect(tideState(curve, 3)).not.toBe(tideState(curve, 9));
  });

  it('uses the nearest sample when the hour falls between them', () => {
    const sparse = [{ hour: 0, ft: 0 }, { hour: 6, ft: 3 }, { hour: 12, ft: 0 }];
    expect(tideState(sparse, 5)).toBe('High'); // nearest sample is the 6am peak
    expect(tideState(sparse, 1)).toBe('Pushing');
  });

  it('still answers at the ends of the day, where there is only one neighbour', () => {
    const rising = [{ hour: 0, ft: 0 }, { hour: 1, ft: 1 }, { hour: 2, ft: 2 }];
    expect(tideState(rising, 0)).toBe('Pushing');
    expect(tideState(rising, 2)).toBe('Pushing');
  });

  it('says nothing rather than guessing when there is no curve to read', () => {
    expect(tideState(null, 6)).toBeNull();
    expect(tideState([], 6)).toBeNull();
    expect(tideState([{ hour: 0, ft: 1 }], 6)).toBeNull();
    expect(tideState(curve, undefined)).toBeNull();
  });
});
