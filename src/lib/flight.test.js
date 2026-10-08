import { describe, it, expect } from 'vitest';
import {
  flightPath, flightDuration, flightEase, cubicBezier, planFlight,
  FLIGHT_MIN_MS, FLIGHT_MAX_MS, FLIGHT_SPEED,
} from './flight.js';
import { latLonToVector3 } from './geo3d.js';

const TAN_HALF_FOV = Math.tan((22.5 * Math.PI) / 180);
const dir = (lat, lon) => { const v = latLonToVector3(lat, lon, 1); return [v.x, v.y, v.z]; };
const angleBetween = (a, b) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));

describe('flightPath', () => {
  it('starts at the first view and ends at the second', () => {
    const { S, at } = flightPath(2, 0.5, 1.5);
    expect(at(0).width).toBeCloseTo(1, 10);
    expect(at(0).across).toBeCloseTo(0, 10);
    expect(at(S).width).toBeCloseTo(0.25, 9);
    expect(at(S).across).toBeCloseTo(1, 9);
  });

  it('pulls back on the way when the target is far, and not when it is near', () => {
    // Far: many screen widths away at the same zoom. The path rises above both ends.
    const far = flightPath(1, 1, 8);
    let highest = 0;
    for (let s = 0; s <= far.S; s += far.S / 50) highest = Math.max(highest, far.at(s).width);
    expect(highest).toBeGreaterThan(2);
    // Near, zooming in: the view only ever narrows.
    const near = flightPath(1, 0.3, 0.2);
    let last = Infinity;
    for (let s = 0; s <= near.S; s += near.S / 50) {
      expect(near.at(s).width).toBeLessThanOrEqual(last + 1e-12);
      last = near.at(s).width;
    }
  });

  it('crosses steadily, never doubling back', () => {
    const { S, at } = flightPath(1.5, 0.6, 2);
    let last = -Infinity;
    for (let s = 0; s <= S; s += S / 100) {
      expect(at(s).across).toBeGreaterThanOrEqual(last - 1e-12);
      last = at(s).across;
    }
  });

  it('zooms straight in when there is nowhere to go', () => {
    const { S, at } = flightPath(2, 0.5, 0);
    expect(S).toBeGreaterThan(0);
    expect(at(S).width).toBeCloseTo(0.25, 9);
    expect(at(S / 2).across).toBe(1);
  });

  it('has nothing to do between two identical views', () => {
    expect(flightPath(1, 1, 0).S).toBe(0);
  });
});

describe('flightDuration', () => {
  it('takes as long as the path needs at the set speed', () => {
    expect(flightDuration(1.8)).toBeCloseTo((1000 * 1.8) / FLIGHT_SPEED, 6);
  });

  it('is never a jump and never a wait', () => {
    expect(flightDuration(0.01)).toBe(FLIGHT_MIN_MS);
    expect(flightDuration(40)).toBe(FLIGHT_MAX_MS);
    expect(flightDuration(NaN)).toBe(FLIGHT_MIN_MS);
  });
});

describe('cubicBezier', () => {
  it('is the CSS curve: pinned at both ends, and matching known points of `ease`', () => {
    expect(flightEase(0)).toBe(0);
    expect(flightEase(1)).toBe(1);
    // `ease` is well past half way at half time: it sets off quickly and settles slowly.
    expect(flightEase(0.5)).toBeCloseTo(0.8024, 3);
    expect(flightEase(0.25)).toBeCloseTo(0.4085, 3);
  });

  it('is the identity for a straight line', () => {
    const linear = cubicBezier(0, 0, 1, 1);
    for (const x of [0.1, 0.33, 0.5, 0.9]) expect(linear(x)).toBeCloseTo(x, 6);
  });

  it('only ever moves forward', () => {
    let last = 0;
    for (let x = 0; x <= 1; x += 0.01) {
      expect(flightEase(x)).toBeGreaterThanOrEqual(last - 1e-9);
      last = flightEase(x);
    }
  });
});

describe('planFlight', () => {
  const fromDir = dir(20, -150);
  const toDir = dir(35, -120);

  it('flies from one view to the other', () => {
    const f = planFlight({ fromDir, toDir, fromDistance: 3, toDistance: 1.65, tanHalfFov: TAN_HALF_FOV });
    const start = f.pose(0);
    expect(start.distance).toBeCloseTo(3, 9);
    expect(angleBetween(start.dir, fromDir)).toBeCloseTo(0, 9);
    const end = f.pose(1);
    expect(end.distance).toBe(1.65);
    expect(end.dir).toEqual(toDir);
  });

  it('stays on the great circle between them, and on the globe\'s surface directions', () => {
    const f = planFlight({ fromDir, toDir, fromDistance: 3, toDistance: 1.65, tanHalfFov: TAN_HALF_FOV });
    const total = angleBetween(fromDir, toDir);
    for (let k = 0; k <= 1; k += 0.1) {
      const p = f.pose(k);
      expect(Math.hypot(...p.dir)).toBeCloseTo(1, 9);
      expect(angleBetween(fromDir, p.dir) + angleBetween(p.dir, toDir)).toBeCloseTo(total, 6);
    }
  });

  it('takes a cluster tap at the default zoom in well under a second, but not instantly', () => {
    const f = planFlight({ fromDir, toDir, fromDistance: 3, toDistance: 1.65, tanHalfFov: TAN_HALF_FOV });
    expect(f.duration).toBeGreaterThanOrEqual(FLIGHT_MIN_MS);
    expect(f.duration).toBeLessThan(1000);
  });

  it('never dips the camera into the globe', () => {
    const f = planFlight({ fromDir, toDir: dir(-30, 60), fromDistance: 1.05, toDistance: 1.02, tanHalfFov: TAN_HALF_FOV });
    for (let k = 0; k <= 1; k += 0.02) expect(f.pose(k).distance).toBeGreaterThan(1);
  });

  it('only zooms when tapped straight ahead', () => {
    const f = planFlight({ fromDir, toDir: fromDir, fromDistance: 2, toDistance: 1.1, tanHalfFov: TAN_HALF_FOV });
    expect(f.duration).toBeGreaterThan(0);
    const mid = f.pose(0.5);
    expect(mid.distance).toBeLessThan(2);
    expect(mid.distance).toBeGreaterThan(1.1);
    expect(angleBetween(mid.dir, fromDir)).toBeCloseTo(0, 9);
  });
});
