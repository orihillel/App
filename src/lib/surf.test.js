import { describe, it, expect } from 'vitest';
import { breakingHeightFt, setWaveFt, surfRange, REFRACTION, SET_FACTOR } from './surf.js';
import { formatWaveRange } from './format.js';

const M = 3.28084;
const ratio = (metres, period) => breakingHeightFt(metres * M, period) / (metres * M);

describe('breakingHeightFt', () => {
  it('reproduces Surfline\'s published rule: face is about 1.3x deepwater swell at 12-16s', () => {
    // The single external number this is anchored to. 1.5m is an ordinary groundswell day.
    expect(ratio(1.5, 14)).toBeCloseTo(1.31, 2);
  });

  it('grows the same swell with period, which is the whole point of doing this', () => {
    // Identical offshore height; only the period differs. The app previously showed one number
    // for both of these.
    expect(ratio(1.5, 6)).toBeLessThan(1.0);
    expect(ratio(1.5, 20)).toBeGreaterThan(1.4);
    expect(ratio(1.5, 20)).toBeGreaterThan(ratio(1.5, 14));
    expect(ratio(1.5, 14)).toBeGreaterThan(ratio(1.5, 6));
  });

  it('amplifies a small swell proportionally more than a big one, as Hb scales with H0^0.8', () => {
    expect(ratio(0.5, 14)).toBeGreaterThan(ratio(3.0, 14));
  });

  it('follows the Komar & Gaughan formula exactly', () => {
    const H0 = 1.2, T = 12; // metres, seconds
    const expected = 0.39 * Math.pow(9.81, 0.2) * Math.pow(T * H0 * H0, 0.4) * REFRACTION;
    expect(breakingHeightFt(H0 * M, T)).toBeCloseTo(expected * M, 6);
  });

  it('returns the height untouched when there is no period to transform with', () => {
    // No period means no transform is possible, and a wrong number is worse than an
    // untransformed one.
    for (const p of [null, undefined, 0, -1, NaN]) expect(breakingHeightFt(5, p)).toBe(5);
  });

  it('passes through a zero, negative or missing height rather than producing NaN', () => {
    for (const h of [0, -2, null, undefined]) expect(breakingHeightFt(h, 12)).toBe(h);
    expect(Number.isNaN(breakingHeightFt(NaN, 12))).toBe(true);
  });

  it('lets the refraction coefficient be overridden, since it is really per-spot', () => {
    expect(breakingHeightFt(5, 12, { refraction: 1 })).toBeCloseTo(breakingHeightFt(5, 12) / REFRACTION, 6);
  });

  it('keeps flat days flat rather than inflating them without bound', () => {
    // The ratio does rise as the swell shrinks, so the guard that matters is the absolute size.
    expect(breakingHeightFt(0.3, 20)).toBeLessThan(1);
  });
});

describe('setWaveFt', () => {
  it('is the Rayleigh H(1/10), 1.27x significant', () => {
    expect(setWaveFt(4)).toBeCloseTo(4 * SET_FACTOR, 10);
    expect(SET_FACTOR).toBeCloseTo(1.27, 10);
  });
  it('passes null through', () => {
    expect(setWaveFt(null)).toBeNull();
  });
});

describe('surfRange', () => {
  it('runs from the ordinary wave to the set, not a fixed band either side', () => {
    expect(surfRange(4)).toBe('4-5.08');
    expect(surfRange(8)).toBe('8-10.16');
  });

  it('widens as the swell grows, which a plus-or-minus-one band never did', () => {
    const width = (ft) => { const [a, b] = surfRange(ft).split('-').map(Number); return b - a; };
    expect(width(10)).toBeGreaterThan(width(2));
  });

  it('never shows a zero-width or inverted range', () => {
    for (const ft of [0.4, 1, 1.4, 2, 3.2, 5.5, 12, 30]) {
      const [a, b] = surfRange(ft).split('-').map(Number);
      expect(b).toBeGreaterThan(a);
      expect(a).toBeGreaterThan(0);
    }
  });

  it('answers for nothing at all rather than printing NaN', () => {
    for (const bad of [0, -1, null, undefined, NaN]) expect(surfRange(bad)).toBe('0-0');
  });
});

// The bug this guards was reported from a beach in Israel: the sea was ankle-to-shin, maybe
// 0.2-0.3m, and the app said a third of a metre and up. It was not a model error. surfRange
// rounded both ends to whole feet and forced them a foot apart, so every sea below about half
// a metre of breaking height collapsed onto one string, and a metric reader -- which is most
// of the world, and all of the Mediterranean -- got "0.3-0.6" for all of it.
describe('small surf survives the trip to the screen', () => {
  const M = 3.28084;
  const metric = (metres, period) =>
    formatWaveRange(surfRange(breakingHeightFt(metres * M, period)), 'metric');

  it('does not floor an ankle-high sea at a third of a metre', () => {
    // 0.2m at 5s is a calm Eastern Mediterranean morning. The old code said '0.3-0.6'.
    const shown = metric(0.2, 5).split('-').map(Number);
    expect(Math.max(...shown)).toBeLessThanOrEqual(0.4);
  });

  it('has more than three values to say between flat and waist high', () => {
    // Rounding to whole feet first meant the metric card could only ever print multiples of
    // 0.3048m: below a metre that is 0.3, 0.6, 0.9 and nothing else -- three strings for the
    // entire range most people actually surf in. Counting distinct outputs is the direct
    // measure of that, and it does not depend on where the display rounding happens to land.
    const seen = new Set();
    for (let hs = 0.05; hs <= 0.9; hs += 0.025) {
      for (const v of metric(hs, 5).split('-')) if (Number(v) <= 1) seen.add(v);
    }
    expect(seen.size).toBeGreaterThan(6);
  });

  it('keeps flat flat instead of inventing a foot of surf', () => {
    const [lo, hi] = surfRange(breakingHeightFt(0.03 * M, 4)).split('-').map(Number);
    expect(lo).toBeLessThan(0.5);
    expect(hi).toBeLessThan(0.5);
  });

  it('still reads as a surf report in feet, where whole feet are the convention', () => {
    const imperial = (ft) => formatWaveRange(surfRange(ft), 'imperial');
    expect(imperial(3.2)).toBe('3-4');
    expect(imperial(8)).toBe('8-10');
  });

  it('is monotone: a bigger sea never displays smaller', () => {
    let prev = -Infinity;
    for (let hs = 0.05; hs <= 4; hs += 0.05) {
      const hi = Math.max(...metric(hs, 8).split('-').map(Number));
      expect(hi).toBeGreaterThanOrEqual(prev);
      prev = hi;
    }
  });
});
