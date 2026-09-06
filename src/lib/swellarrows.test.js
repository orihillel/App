import { describe, it, expect } from 'vitest';
import { fibonacciSphere, arrowCountForDistance, orientationAt, visibleSphereFraction } from './swellarrows.js';
import { latLonToVector3 } from './geo3d.js';

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.sqrt(dot(a, a));

describe('fibonacciSphere', () => {
  it('stays inside the world', () => {
    for (const p of fibonacciSphere(500)) {
      expect(p.lat).toBeGreaterThanOrEqual(-90);
      expect(p.lat).toBeLessThanOrEqual(90);
      expect(p.lon).toBeGreaterThanOrEqual(-180);
      expect(p.lon).toBeLessThan(180);
    }
  });

  it('spreads evenly by area rather than by degrees', () => {
    // A lat/lon lattice puts most of its points near the poles, where the cells are slivers.
    // Equal-area spacing means the share of points between two latitudes matches the share of
    // the sphere's surface between them — half of it lies between 30S and 30N.
    const points = fibonacciSphere(4000);
    const tropics = points.filter((p) => Math.abs(p.lat) < 30).length / points.length;
    expect(tropics).toBeGreaterThan(0.45);
    expect(tropics).toBeLessThan(0.55);
  });

  it('has no two points on top of each other', () => {
    const points = fibonacciSphere(300).map((p) => latLonToVector3(p.lat, p.lon, 1));
    let closest = Infinity;
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        closest = Math.min(closest, points[i].distanceTo(points[j]));
      }
    }
    // Even spacing over 300 points puts neighbours around 0.13 radians apart; anything an order
    // of magnitude below that is a collision.
    expect(closest).toBeGreaterThan(0.05);
  });

  it('is even in any prefix, which is what makes it usable as a level of detail', () => {
    // The globe draws the first N of one fixed field. Without the shuffle the spiral runs
    // pole to pole in index order, so the first fifty points are fifty points in the Arctic and
    // zooming out empties a hemisphere. Checked by hemisphere and by latitude band.
    const full = fibonacciSphere(4000);
    for (const n of [50, 200, 1000]) {
      const prefix = full.slice(0, n);
      const north = prefix.filter((p) => p.lat > 0).length / n;
      expect(north, 'north ' + n).toBeGreaterThan(0.35);
      expect(north, 'north ' + n).toBeLessThan(0.65);
      const tropics = prefix.filter((p) => Math.abs(p.lat) < 30).length / n;
      expect(tropics, 'tropics ' + n).toBeGreaterThan(0.35);
      expect(tropics, 'tropics ' + n).toBeLessThan(0.65);
    }
  });

  it('keeps a prefix spread out, not just balanced', () => {
    // Balanced hemispheres could still be two tight clusters. This checks the prefix actually
    // covers the sphere: every one of eight octants gets a share of it.
    const prefix = fibonacciSphere(4000).slice(0, 160);
    const octants = new Map();
    for (const p of prefix) {
      const key = (p.lat > 0 ? 'N' : 'S') + Math.floor(((p.lon + 180) / 360) * 4);
      octants.set(key, (octants.get(key) || 0) + 1);
    }
    expect(octants.size).toBe(8);
    for (const [key, count] of octants) expect(count, key).toBeGreaterThan(160 / 8 / 3);
  });

  it('returns nothing for a nonsense count rather than throwing', () => {
    for (const n of [0, -5, NaN, undefined]) expect(fibonacciSphere(n)).toEqual([]);
  });
});

describe('visibleSphereFraction', () => {
  const HALF_FOV = (22.5 * Math.PI) / 180;

  it('is the horizon when the whole globe fits in the frame', () => {
    // Far enough out, the silhouette is inside the viewport and the limit is the horizon.
    expect(visibleSphereFraction(6, HALF_FOV)).toBeCloseTo((1 - 1 / 6) / 2, 6);
  });

  it('is far less than the horizon once the globe overflows the frame', () => {
    // The mistake the first version made. At 1.4 the horizon says 14% of the sphere is in view;
    // the viewport actually shows well under a hundredth of it.
    const horizon = (1 - 1 / 1.4) / 2;
    const onScreen = visibleSphereFraction(1.4, HALF_FOV);
    expect(onScreen).toBeLessThan(horizon / 10);
    expect(onScreen).toBeGreaterThan(0);
  });

  it('shrinks all the way down as the camera closes in', () => {
    let prev = Infinity;
    for (const d of [3, 2, 1.6, 1.3, 1.1, 1.02]) {
      const f = visibleSphereFraction(d, HALF_FOV);
      expect(f, String(d)).toBeLessThan(prev);
      prev = f;
    }
  });

  it('is nothing at or inside the surface, rather than NaN', () => {
    for (const d of [1, 0.5, 0, -2, NaN]) expect(visibleSphereFraction(d, HALF_FOV)).toBe(0);
  });
});

describe('arrowCountForDistance', () => {
  it('draws more as you zoom in, because less of the sphere is on screen', () => {
    expect(arrowCountForDistance(1.8)).toBeGreaterThan(arrowCountForDistance(3));
    expect(arrowCountForDistance(1.5)).toBeGreaterThan(arrowCountForDistance(1.8));
  });

  it('holds the on-screen count steady over the range where it can', () => {
    // The point of the whole function. Measured against the real on-screen patch, not the
    // horizon — which is what made the first version twenty times too sparse when zoomed in.
    const halfFov = (22.5 * Math.PI) / 180;
    const onScreen = (d) => arrowCountForDistance(d) * visibleSphereFraction(d, halfFov);
    const counts = [3, 2.4, 2, 1.8].map(onScreen);
    for (const c of counts) {
      expect(c).toBeGreaterThan(counts[0] * 0.7);
      expect(c).toBeLessThan(counts[0] * 1.4);
    }
  });

  it('stops adding arrows past the point where the data has nothing more to say', () => {
    // The field behind them is a 1,100km grid; at full zoom the screen is inside two cells.
    // Past the cap, more arrows would be a lattice of identical directions dressed up as detail.
    expect(arrowCountForDistance(1.05)).toBe(6000);
    expect(arrowCountForDistance(1.001)).toBe(6000);
  });

  it('never drops below the count the whole-globe view needs', () => {
    expect(arrowCountForDistance(6)).toBe(420);
    expect(arrowCountForDistance(100)).toBe(420);
  });

  it('gives the cap rather than a NaN for junk', () => {
    for (const d of [NaN, undefined, 0, -3, 1]) expect(arrowCountForDistance(d)).toBe(6000);
  });
});

describe('orientationAt', () => {
  const at = (lat, lon, bearing) => orientationAt(lat, lon, bearing);

  it('gives an orthonormal frame anywhere on the globe', () => {
    for (const [lat, lon, b] of [[0, 0, 0], [45, -120, 90], [-33.9, 151.2, 217], [68, 13.6, 350]]) {
      const { normal, forward, side } = at(lat, lon, b);
      for (const v of [normal, forward, side]) expect(len(v)).toBeCloseTo(1, 6);
      expect(dot(normal, forward)).toBeCloseTo(0, 6);
      expect(dot(normal, side)).toBeCloseTo(0, 6);
      expect(dot(forward, side)).toBeCloseTo(0, 6);
    }
  });

  it('puts the normal where the globe puts the point, so arrows sit on the surface', () => {
    for (const [lat, lon] of [[0, 0], [51.5, -0.1], [-34, 18.4], [20, 179]]) {
      const p = latLonToVector3(lat, lon, 1);
      const { normal } = at(lat, lon, 0);
      expect(dot(normal, [p.x, p.y, p.z])).toBeCloseTo(1, 6);
    }
  });

  it('points a bearing of 0 north and 90 east, not the mirror of them', () => {
    // Getting these signs backwards mirrors the whole arrow field — which looks entirely
    // plausible and is exactly wrong.
    const north = at(0, 0, 0).forward;
    const stepNorth = latLonToVector3(1, 0, 1).sub(latLonToVector3(0, 0, 1));
    expect(dot(north, [stepNorth.x, stepNorth.y, stepNorth.z])).toBeGreaterThan(0);

    const east = at(0, 0, 90).forward;
    const stepEast = latLonToVector3(0, 1, 1).sub(latLonToVector3(0, 0, 1));
    expect(dot(east, [stepEast.x, stepEast.y, stepEast.z])).toBeGreaterThan(0);
  });

  it('turns clockwise through the compass, as a bearing does', () => {
    const { forward: n } = at(20, 40, 0);
    const { forward: ne } = at(20, 40, 45);
    const { forward: e } = at(20, 40, 90);
    expect(dot(n, ne)).toBeCloseTo(Math.cos(Math.PI / 4), 5);
    expect(dot(n, e)).toBeCloseTo(0, 6);
  });

  it('makes a right-handed basis, so arrows are not drawn back to front', () => {
    // side x forward should be the normal; the opposite winding renders the arrow mirrored and
    // facing into the sphere.
    const { normal, forward, side } = at(-12, 77, 130);
    const cross = [
      side[1] * forward[2] - side[2] * forward[1],
      side[2] * forward[0] - side[0] * forward[2],
      side[0] * forward[1] - side[1] * forward[0],
    ];
    expect(dot(cross, normal)).toBeCloseTo(1, 6);
  });
});
