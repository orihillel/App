import { describe, it, expect } from 'vitest';
import { swellTrend, STEADY_FT } from './swelltrend.js';

const hrs = (...surf) => surf.map((surfFt, i) => ({ hour: 5 + i * 2, surfFt }));

describe('swellTrend', () => {
  it('reads a swell on the way up and on the way down', () => {
    expect(swellTrend(hrs(2, 3, 4, 5, 6), 2)).toBe('Building');
    expect(swellTrend(hrs(6, 5, 4, 3, 2), 2)).toBe('Dropping');
  });

  it('calls a flat day steady rather than picking a direction out of noise', () => {
    expect(swellTrend(hrs(4, 4, 4, 4, 4), 2)).toBe('Steady');
    expect(swellTrend(hrs(4, 4.1, 4.05, 4.2, 4.1), 2)).toBe('Steady');
  });

  it('needs more than half a foot across the window before it says anything', () => {
    // Just under, then just over, on a size where the absolute floor is what governs.
    expect(swellTrend(hrs(3, 3.2, 3.3, 3.4, 3.5), 2)).toBe('Steady');   // 0.4 across the window
    expect(swellTrend(hrs(3, 3.2, 3.4, 3.9, 4.2), 2)).toBe('Building'); // 0.7 across it
  });

  it('scales the deadband on a big swell, where half a foot really is nothing', () => {
    // 0.6ft on a 12ft swell is 5% -- inside the fraction, so still steady.
    expect(swellTrend(hrs(12, 12.2, 12.3, 12.8, 13), 2)).toBe('Steady');
    expect(swellTrend(hrs(12, 12.2, 12.3, 14, 15), 2)).toBe('Building');
    expect(STEADY_FT).toBeLessThan(1);
  });

  it('measures across the hour, not from it -- so one odd hour does not flip the arrow', () => {
    // A single high sample in the middle of a falling swell. The trend through it is still down.
    expect(swellTrend(hrs(8, 7, 9, 5, 4), 2)).toBe('Dropping');
  });

  it('works at the ends of the day, where there is only one neighbour', () => {
    expect(swellTrend(hrs(2, 3, 4, 5, 6), 0)).toBe('Building');
    expect(swellTrend(hrs(2, 3, 4, 5, 6), 4)).toBe('Building');
    expect(swellTrend(hrs(6, 5, 4, 3, 2), 0)).toBe('Dropping');
  });

  it('falls back to the offshore height for a forecast cached before surfFt existed', () => {
    const old = [{ waveFt: 2 }, { waveFt: 3 }, { waveFt: 4 }];
    expect(swellTrend(old, 1)).toBe('Building');
  });

  it('skips an unusable sample rather than letting it shrink the window', () => {
    // A hole on each side of the hour. Reaching past them sees 8ft falling to 5.9ft -- clearly
    // dropping. Giving up and measuring from the hour itself sees 6 to 5.9 and calls it steady,
    // which is the opposite of the decision the reader needs.
    const falling = [{ surfFt: 8 }, { surfFt: null }, { surfFt: 6 }, { surfFt: null }, { surfFt: 5.9 }];
    expect(swellTrend(falling, 2)).toBe('Dropping');
    // And the mirror of it, so neither side's search can be dropped unnoticed.
    const rising = [{ surfFt: 5.9 }, { surfFt: null }, { surfFt: 6 }, { surfFt: null }, { surfFt: 8 }];
    expect(swellTrend(rising, 2)).toBe('Building');
  });

  it('says nothing when there is nothing to compare against', () => {
    expect(swellTrend([{ surfFt: 4 }], 0)).toBeNull();
    expect(swellTrend([{ surfFt: null }, { surfFt: 4 }, { surfFt: null }], 1)).toBeNull();
  });

  it('answers null for junk rather than throwing', () => {
    for (const bad of [null, undefined, [], 'nope']) expect(swellTrend(bad, 0)).toBeNull();
    expect(swellTrend(hrs(2, 3, 4), NaN)).toBeNull();
  });

  it('clamps an index past the end instead of reading off the array', () => {
    expect(swellTrend(hrs(2, 3, 4, 5, 6), 99)).toBe('Building');
    expect(swellTrend(hrs(2, 3, 4, 5, 6), -3)).toBe('Building');
  });
});
