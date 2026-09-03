import { describe, it, expect } from 'vitest';
import { markerScaleForDistance, markerScreenSizeRatio } from './geo3d.js';

// The globe's actual numbers, so these assertions track the real thing. `shell` is 1.0 --
// markers are centred exactly on the surface so a dot sits at its true coordinates from every
// angle; it used to be 1.045, which drew them up to 100px away from their own lat/lon.
const OPTS = { shell: 1.0, refDistance: 3.0, minDistance: 1.08, closeShrink: 0.38 };

describe('markerScaleForDistance', () => {
  it('leaves markers untouched at the reference zoom', () => {
    expect(markerScaleForDistance(OPTS.refDistance, OPTS)).toBeCloseTo(1, 6);
  });

  it('never grows them when zoomed further out than the reference', () => {
    for (const d of [3.5, 4, 5, 6]) {
      expect(markerScaleForDistance(d, OPTS)).toBe(1);
    }
  });

  it('shrinks monotonically as the camera closes in', () => {
    const distances = [3.0, 2.5, 2.0, 1.5, 1.2, 1.08];
    const scales = distances.map((d) => markerScaleForDistance(d, OPTS));
    for (let i = 1; i < scales.length; i++) {
      expect(scales[i]).toBeLessThan(scales[i - 1]);
    }
  });

  it('stays positive and finite at (and below) the closest zoom', () => {
    for (const d of [OPTS.minDistance, OPTS.shell, OPTS.shell - 0.5]) {
      const scale = markerScaleForDistance(d, OPTS);
      expect(Number.isFinite(scale)).toBe(true);
      expect(scale).toBeGreaterThan(0);
    }
  });
});

describe('markerScreenSizeRatio', () => {
  it('is 1 at the reference zoom — the default view is unchanged', () => {
    expect(markerScreenSizeRatio(OPTS.refDistance, OPTS)).toBeCloseTo(1, 6);
  });

  it('lands exactly on closeShrink at the closest zoom', () => {
    expect(markerScreenSizeRatio(OPTS.minDistance, OPTS)).toBeCloseTo(OPTS.closeShrink, 6);
  });

  it('shrinks on screen the whole way in, which the previous fix did not', () => {
    // The bug this replaces held a *constant* on-screen size: every ratio here was 1.0, which
    // still left a ~13.5px dot swallowing a ~5px-wide Oahu at full zoom.
    const ratios = [3.0, 2.0, 1.5, 1.2, 1.08].map((d) => markerScreenSizeRatio(d, OPTS));
    for (let i = 1; i < ratios.length; i++) {
      expect(ratios[i]).toBeLessThan(ratios[i - 1]);
    }
    expect(ratios[0]).toBeCloseTo(1, 6);
  });

  it('honours a different closeShrink target', () => {
    const opts = { ...OPTS, closeShrink: 0.25 };
    expect(markerScreenSizeRatio(opts.minDistance, opts)).toBeCloseTo(0.25, 6);
  });

  it('follows the zoom range rather than a baked-in constant', () => {
    // Move the closest zoom and the curve still lands on closeShrink there.
    const opts = { ...OPTS, minDistance: 1.2 };
    expect(markerScreenSizeRatio(1.2, opts)).toBeCloseTo(opts.closeShrink, 6);
  });
});
