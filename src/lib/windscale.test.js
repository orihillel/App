import { describe, it, expect } from 'vitest';
import {
  windColor, windScaleTicks, windScaleUnitLabel, windScaleGradient,
  windTravelBearing, windLegendCaption, WIND_SCALE_MAX,
  windColorBanded, windScaleBandGradient, WIND_BAND_EDGES,
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
    expect(windScaleTicks('imperial').map((t) => t.label)).toEqual(['0', '5', '10', '15', '20', '30', '45']);
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

  it('stops claiming "now" once a forecast frame is on screen', () => {
    // The map is four days ahead of the build that produced it; the age of the build is not
    // the interesting fact any more, and printing it would be a lie about what is drawn.
    const c = windLegendCaption({ generatedAt: Date.now(), frameLabel: 'forecast for Thu 6am' }, 'metric');
    expect(c).toContain('forecast for Thu 6am');
    expect(c).not.toContain('just now');
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

// The wind ramp was confined to one violet hue family so it could never be mistaken for the
// swell ramp. The two layers cannot be on screen together -- Globe.jsx holds a single `layer`
// state -- so that confinement was buying nothing and costing two thirds of the ramp's range.
// These numbers lock in what freeing it bought.
describe('the wind ramp has a real hue sweep now', () => {
  const OCEAN = [23, 90, 130];
  const lin = (u) => { const v = u / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const blend = (c) => c.map((v, i) => Math.round(0.85 * v + 0.15 * OCEAN[i]));
  function lab(c) {
    const [R, G, B] = blend(c).map(lin);
    const g = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const X = g((R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047);
    const Y = g(R * 0.2126 + G * 0.7152 + B * 0.0722);
    const Z = g((R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883);
    return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
  }
  const dE = (a, b) => { const p = lab(a), q = lab(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };

  // 15-30kph is where a morning stops being glassy and starts being blown out.
  it('keeps every five-knot step in the decisive band clearly apart', () => {
    for (let k = 5; k + 5 <= 35; k += 5) {
      expect(dE(windColor(k), windColor(k + 5)), k + ' -> ' + (k + 5) + 'kph').toBeGreaterThan(10);
    }
  });

  it('travels far enough overall to carry the levels asked of it', () => {
    let arc = 0;
    for (let k = 0; k + 1 <= WIND_SCALE_MAX; k += 1) arc += dE(windColor(k), windColor(k + 1));
    expect(arc).toBeGreaterThan(150);
  });

  it('never collides with the globe underneath it', () => {
    let closest = Infinity;
    for (let k = 0; k <= WIND_SCALE_MAX; k += 0.5) closest = Math.min(closest, dE(windColor(k), OCEAN));
    expect(closest).toBeGreaterThan(8);
  });
});

// Sibling of the banded wave tests. Nine bands, five of them between 5 and 30kph.
describe('windColorBanded', () => {
  const OCEAN = [23, 90, 130];
  const lin = (u) => { const v = u / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const blend = (c) => c.map((v, i) => Math.round(0.85 * v + 0.15 * OCEAN[i]));
  function lab(c) {
    const [R, G, B] = blend(c).map(lin);
    const g = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const X = g((R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047);
    const Y = g(R * 0.2126 + G * 0.7152 + B * 0.0722);
    const Z = g((R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883);
    return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
  }
  const dE = (a, b) => { const p = lab(a), q = lab(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };

  it('paints one flat colour across a band, edges belonging to the band above', () => {
    expect(windColorBanded(6)).toEqual(windColorBanded(9.9));
    expect(windColorBanded(5)).not.toEqual(windColorBanded(4.9));
  });

  it('separates neighbouring bands by far more than a viewer could miss', () => {
    for (let i = 1; i < WIND_BAND_EDGES.length - 1; i++) {
      const below = windColorBanded((WIND_BAND_EDGES[i - 1] + WIND_BAND_EDGES[i]) / 2);
      const above = windColorBanded((WIND_BAND_EDGES[i] + WIND_BAND_EDGES[i + 1]) / 2);
      expect(dE(below, above), WIND_BAND_EDGES[i] + 'kph edge').toBeGreaterThan(9);
    }
  });

  it('puts most of its bands in the band that decides glassy from blown out', () => {
    const decisive = WIND_BAND_EDGES.filter((k) => k >= 5 && k <= 30).length;
    expect(decisive).toBeGreaterThanOrEqual(5);
  });

  it('builds a legend bar of hard-edged bands, each colour appearing twice', () => {
    const g = windScaleBandGradient();
    expect(g.startsWith('linear-gradient(90deg,')).toBe(true);
    const c = windColorBanded(1);
    expect(g.split('rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')').length - 1).toBe(2);
  });

  it('clamps past the top and says nothing about no data', () => {
    expect(windColorBanded(200)).toEqual(windColorBanded(WIND_SCALE_MAX));
    for (const v of [null, undefined, NaN, -1]) expect(windColorBanded(v)).toBeNull();
  });
});
