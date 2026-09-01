import { describe, it, expect } from 'vitest';
import { nextTideEvent } from './placeholders.js';

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
