import { describe, it, expect } from 'vitest';
import {
  windColor, windScaleTicks, windScaleUnitLabel, windScaleGradient,
  windTravelBearing, windLegendCaption, WIND_SCALE_MAX,
} from './windscale.js';
import { waveColor } from './wavescale.js';

describe('windColor', () => {
  it('is null where there is no reading, so nothing is painted', () => {
    // Distinct from calm: calm gets the bottom of the ramp, no-reading gets no pixel at all.
    expect(windColor(null)).toBeNull();
    expect(windColor(undefined)).toBeNull();
    expect(windColor(NaN)).toBeNull();
    expect(windColor(-1)).toBeNull();
    expect(windColor(0)).not.toBeNull();
  });

  it('clamps rather than wrapping at the top of the ramp', () => {
    // A wind that pegs the scale is still a wind. Wrapping would paint a hurricane as a calm.
    expect(windColor(WIND_SCALE_MAX)).toEqual(windColor(WIND_SCALE_MAX + 500));
  });

  it('moves monotonically brighter as the wind gets up', () => {
    const lum = (kph) => { const c = windColor(kph); return c[0] + c[1] + c[2]; };
    const steps = [0, 8, 16, 25, 35, 45, 60, 90];
    for (let i = 1; i < steps.length; i++) {
      expect(lum(steps[i]), steps[i] + ' vs ' + steps[i - 1]).toBeGreaterThan(lum(steps[i - 1]));
    }
  });

  it('interpolates between stops rather than stepping', () => {
    const a = windColor(8), mid = windColor(12), b = windColor(16);
    expect(mid).not.toEqual(a);
    expect(mid).not.toEqual(b);
  });

  it('never looks like the swell ramp at the same fraction of its range', () => {
    // Two quantities on one globe. If the ramps collided, the legend would be the only thing
    // telling a reader which layer is on -- which is exactly what a glance should answer.
    for (const f of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      const w = waveColor(f * 12);
      const g = windColor(f * WIND_SCALE_MAX);
      const distance = Math.abs(w[0] - g[0]) + Math.abs(w[1] - g[1]) + Math.abs(w[2] - g[2]);
      expect(distance, 'fraction ' + f).toBeGreaterThan(60);
    }
  });
});

describe('windScaleTicks', () => {
  it('is round numbers in the units on screen, not a conversion showing its working', () => {
    expect(windScaleTicks('metric').map((t) => t.label)).toEqual(['0', '10', '20', '30', '50', '70', '90']);
    expect(windScaleTicks('imperial').map((t) => t.label)).toEqual(['0', '5', '10', '20', '30', '40', '55']);
  });

  it('carries the kph each tick actually sits at, so the bar can place it', () => {
    const [, five] = windScaleTicks('imperial');
    expect(five.kph).toBeCloseTo(8.05, 1);
  });

  it('names the unit it is in', () => {
    expect(windScaleUnitLabel('metric')).toBe('kph');
    expect(windScaleUnitLabel('imperial')).toBe('mph');
  });
});

describe('windScaleGradient', () => {
  it('spans the bar from zero to the top of the ramp', () => {
    const g = windScaleGradient();
    expect(g.startsWith('linear-gradient(90deg,')).toBe(true);
    expect(g).toContain('0.0%');
    expect(g).toContain('100.0%');
  });
});

describe('windTravelBearing', () => {
  it('turns the bearing wind comes from into the one it is going', () => {
    // A westerly (from 270) blows towards the east (90).
    expect(windTravelBearing(270)).toBe(90);
    expect(windTravelBearing(0)).toBe(180);
    expect(windTravelBearing(180)).toBe(0);
  });

  it('stays inside a compass', () => {
    for (const d of [0, 45, 90, 180, 270, 359, 360, 720, -90]) {
      const v = windTravelBearing(d);
      expect(v, String(d)).toBeGreaterThanOrEqual(0);
      expect(v, String(d)).toBeLessThan(360);
    }
  });

  it('has nothing to say without a bearing', () => {
    expect(windTravelBearing(null)).toBeNull();
    expect(windTravelBearing(NaN)).toBeNull();
  });
});

describe('windLegendCaption', () => {
  it('names the quantity and the units, so it cannot be read as the swell layer', () => {
    const c = windLegendCaption({ generatedAt: Date.now() }, 'metric');
    expect(c).toContain('wind speed');
    expect(c).toContain('kph');
  });

  it('says which way the arrows read rather than leaving it to be guessed', () => {
    expect(windLegendCaption({ generatedAt: Date.now(), arrows: true }, 'metric'))
      .toContain('arrows show where the wind is blowing');
  });

  it('separates a grid with no directions from one whose directions failed', () => {
    expect(windLegendCaption({ generatedAt: Date.now(), noDirections: true }, 'metric'))
      .toContain('no wind directions in this grid yet');
  });

  it('admits when it is showing the last good data, or a coarse edge', () => {
    const c = windLegendCaption({ generatedAt: Date.now(), stale: true, coarse: true }, 'metric');
    expect(c).toContain('last good data');
    expect(c).toContain('coarse edge');
  });

  it('says the age is unknown rather than inventing one', () => {
    expect(windLegendCaption({}, 'metric')).toContain('age unknown');
    expect(windLegendCaption(null, 'metric')).toContain('age unknown');
  });
});
