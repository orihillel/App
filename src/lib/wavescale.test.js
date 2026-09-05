import { describe, it, expect } from 'vitest';
import {
  waveColor, waveScaleTicks, waveScaleUnitLabel, waveScaleGradient, gridAgeLabel, WAVE_SCALE_MAX,
} from './wavescale.js';

describe('waveColor', () => {
  it('gets darker and colder toward flat, brighter and warmer toward big', () => {
    const calm = waveColor(0.2);
    const big = waveColor(7);
    const sum = (c) => c[0] + c[1] + c[2];
    expect(sum(big)).toBeGreaterThan(sum(calm));
    expect(big[0]).toBeGreaterThan(calm[0]); // more red
    expect(calm[2]).toBeGreaterThan(calm[0]); // calm is blue-dominant
  });

  it('changes monotonically enough that neighbouring heights are distinguishable', () => {
    // A ramp with a flat stretch would render different swells as the same colour.
    let prev = waveColor(0);
    for (let m = 0.25; m <= WAVE_SCALE_MAX; m += 0.25) {
      const c = waveColor(m);
      expect(c).not.toEqual(prev);
      prev = c;
    }
  });

  it('interpolates between stops rather than banding', () => {
    const a = waveColor(1.0);
    const mid = waveColor(1.5);
    const b = waveColor(2.0);
    for (let i = 0; i < 3; i++) {
      const lo = Math.min(a[i], b[i]);
      const hi = Math.max(a[i], b[i]);
      expect(mid[i]).toBeGreaterThanOrEqual(lo);
      expect(mid[i]).toBeLessThanOrEqual(hi);
    }
    expect(mid).not.toEqual(a);
    expect(mid).not.toEqual(b);
  });

  it('clamps past the top of the ramp instead of running off it', () => {
    expect(waveColor(30)).toEqual(waveColor(WAVE_SCALE_MAX));
    expect(waveColor(WAVE_SCALE_MAX + 0.1)).toEqual(waveColor(WAVE_SCALE_MAX));
  });

  it('returns null for no-data, so land is never painted as calm sea', () => {
    // The single most important case: null must not become the 0m colour, or every continent
    // gets a coat of deep blue.
    for (const v of [null, undefined, NaN, -1, 'two']) expect(waveColor(v)).toBeNull();
    expect(waveColor(0)).not.toBeNull();
  });

  it('gives back a fresh array, so a caller cannot mutate the ramp', () => {
    const c = waveColor(0);
    c[0] = 999;
    expect(waveColor(0)[0]).not.toBe(999);
  });
});

describe('legend', () => {
  it('labels round numbers in whichever unit is on screen', () => {
    expect(waveScaleTicks('metric').map((t) => t.label)).toEqual(['0', '1', '2', '3', '4', '6', '9']);
    expect(waveScaleTicks('imperial').map((t) => t.label)).toEqual(['0', '3', '6', '10', '15', '20', '30']);
    expect(waveScaleUnitLabel('imperial')).toBe('ft');
    expect(waveScaleUnitLabel('metric')).toBe('m');
  });

  it('converts imperial ticks to the right position on the ramp', () => {
    const ten = waveScaleTicks('imperial').find((t) => t.label === '10');
    expect(ten.metres).toBeCloseTo(3.048, 2);
  });

  it('keeps every tick inside the ramp it labels', () => {
    for (const units of ['metric', 'imperial']) {
      for (const t of waveScaleTicks(units)) {
        expect(t.metres).toBeGreaterThanOrEqual(0);
        expect(t.metres).toBeLessThanOrEqual(WAVE_SCALE_MAX);
      }
    }
  });

  it('builds a gradient from the same stops the globe is painted with', () => {
    const g = waveScaleGradient();
    expect(g.startsWith('linear-gradient(90deg,')).toBe(true);
    const c0 = waveColor(0);
    expect(g).toContain('rgb(' + c0[0] + ',' + c0[1] + ',' + c0[2] + ') 0.0%');
    expect(g).toContain('100.0%');
  });
});

describe('gridAgeLabel', () => {
  const now = Date.parse('2026-09-05T12:00:00Z');
  it('says how old the data is in the largest sensible unit', () => {
    expect(gridAgeLabel(now - 30 * 1000, now)).toBe('just now');
    expect(gridAgeLabel(now - 25 * 60000, now)).toBe('25 min ago');
    expect(gridAgeLabel(now - 5 * 3600000, now)).toBe('5h ago');
    expect(gridAgeLabel(now - 3 * 86400000, now)).toBe('3d ago');
  });
  it('never reports the future as a negative age', () => {
    expect(gridAgeLabel(now + 60000, now)).toBe('just now');
  });
  it('returns nothing rather than "NaN min ago" on junk', () => {
    for (const v of [null, undefined, 'yesterday', NaN]) expect(gridAgeLabel(v, now)).toBeNull();
  });
});
