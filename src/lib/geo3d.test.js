import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { markerScaleForDistance, markerScreenSizeRatio, latLonToVector3, rotationToFace, shortestAngleTo } from './geo3d.js';

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

describe('rotationToFace', () => {
  // Checked by doing the thing rather than by re-deriving the algebra: rotate the real vector
  // with three's own Euler, in the order the globe uses, and see where it ends up.
  function facedPosition(lat, lon) {
    const { rotX, rotY } = rotationToFace(lat, lon);
    return latLonToVector3(lat, lon, 1).applyEuler(new THREE.Euler(rotX, rotY, 0));
  }

  it('brings any point round to the camera axis', () => {
    for (const [lat, lon] of [[0, 0], [33.4, -117.6], [-34, 151], [0, 179.5], [0, -179.5], [64, -21], [-45, -73]]) {
      const p = facedPosition(lat, lon);
      expect(Math.abs(p.x), `x at ${lat},${lon}`).toBeLessThan(1e-9);
      expect(Math.abs(p.y), `y at ${lat},${lon}`).toBeLessThan(1e-9);
      expect(p.z, `z at ${lat},${lon}`).toBeCloseTo(1, 9); // +Z, not -Z: the near side, not the antipode
    }
  });

  it('faces the poles without spinning off to a NaN', () => {
    for (const lat of [90, -90]) {
      const p = facedPosition(lat, 0);
      expect(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)).toBe(true);
      expect(p.z).toBeCloseTo(1, 9);
    }
  });
});

describe('shortestAngleTo', () => {
  it('goes the short way round rather than most of a turn', () => {
    // From just past the antimeridian to just before it: 6 degrees, not 354.
    const from = Math.PI - 0.05;
    const to = -Math.PI + 0.05;
    expect(Math.abs(shortestAngleTo(from, to) - from)).toBeLessThan(0.2);
  });

  it('lands on an angle equivalent to the target', () => {
    for (const [a, b] of [[0, 1], [3, -3], [-3, 3], [0, Math.PI], [10, -10]]) {
      const out = shortestAngleTo(a, b);
      const diff = Math.abs(((out - b) % (Math.PI * 2)));
      expect(Math.min(diff, Math.PI * 2 - diff)).toBeLessThan(1e-9);
    }
  });

  it('never travels more than half a turn', () => {
    for (let i = 0; i < 40; i++) {
      const a = (i - 20) * 0.7, b = (i * 1.3) - 12;
      expect(Math.abs(shortestAngleTo(a, b) - a)).toBeLessThanOrEqual(Math.PI + 1e-9);
    }
  });
});
