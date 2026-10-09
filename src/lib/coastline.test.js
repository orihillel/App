import { describe, it, expect } from 'vitest';
import { decodeArc, coastlineOpacity, coastlineTiles, coastlineLevel, COASTLINE_STILL_PX, COASTLINE_MOVING_PX } from './coastline.js';
import { latLonToVector3 } from './geo3d.js';

// A stand-in for the real projection: keeps the test about the decoding and packing, and lets
// a vertex be checked by eye.
const fakeProject = (lat, lon, r) => ({ x: lon, y: lat, z: r });

// scale [1, 1] and translate [0, 0] means grid units are degrees, so the expected values below
// are just the running sums.
const IDENTITY = { scale: [1, 1], translate: [0, 0] };

describe('decodeArc', () => {
  it('accumulates deltas into absolute positions', () => {
    // TopoJSON's first pair is the starting position; every pair after it is a delta.
    const pts = decodeArc([[10, 20], [5, 0], [0, -5]], IDENTITY);
    expect(pts).toEqual([[20, 10], [20, 15], [15, 15]]);
  });

  it('applies the transform back to degrees', () => {
    const t = { scale: [0.5, 0.25], translate: [-180, -90] };
    const [first] = decodeArc([[0, 0]], t);
    expect(first).toEqual([-90, -180]); // grid origin is the bottom-left corner of the world
    const [, second] = decodeArc([[0, 0], [360, 720]], t);
    expect(second).toEqual([90, 0]);
  });

  it('returns [lat, lon], not TopoJSON\'s [lon, lat]', () => {
    // The rest of the app takes lat first. Getting this backwards would put every coastline in
    // the wrong hemisphere, which is exactly the kind of thing that looks plausible in a diff.
    const [pt] = decodeArc([[100, 40]], IDENTITY);
    expect(pt).toEqual([40, 100]);
  });
});

describe('coastlineTiles: packing', () => {
  // Every tile's segments, end to end, in the order they were found.
  const flat = (tiles) => tiles.flatMap((t) => Array.from(t.positions));

  it('emits both endpoints of every segment', () => {
    // One arc of 3 points is 2 segments, so 4 vertices, so 12 floats -- all in one tile here.
    const topo = { transform: IDENTITY, arcs: [[[0, 0], [1, 0], [1, 0]]] };
    const { fine } = coastlineTiles(topo, 1, fakeProject);
    expect(fine.length).toBe(1);
    expect(fine[0].positions).toBeInstanceOf(Float32Array);
    // Segment 1 runs (0,0)->(0,1) in lon, segment 2 runs (0,1)->(0,2), sharing the middle point.
    expect(flat(fine)).toEqual([0, 0, 1, 1, 0, 1, 1, 0, 1, 2, 0, 1]);
  });

  it('sizes the buffers exactly, with no slack', () => {
    const topo = { transform: IDENTITY, arcs: [
      [[0, 0], [1, 1], [1, 1], [1, 1]], // 4 points -> 3 segments
      [[0, 0], [2, 2]],                 // 2 points -> 1 segment
    ] };
    expect(flat(coastlineTiles(topo, 1, fakeProject).fine).length).toBe(4 * 6);
  });

  it('skips arcs too short to make a segment rather than emitting a degenerate one', () => {
    const topo = { transform: IDENTITY, arcs: [[[5, 5]], [], [[0, 0], [1, 0]]] };
    expect(flat(coastlineTiles(topo, 1, fakeProject).fine).length).toBe(6); // only the last arc counts
  });

  it('passes the radius through to the projection', () => {
    const topo = { transform: IDENTITY, arcs: [[[0, 0], [1, 0]]] };
    expect(coastlineTiles(topo, 7, fakeProject).fine[0].positions[2]).toBe(7);
  });

  it('returns no tiles rather than throwing on missing or malformed data', () => {
    for (const junk of [null, undefined, {}, { arcs: [] }, { transform: IDENTITY }, { arcs: 'no', transform: IDENTITY }]) {
      expect(() => coastlineTiles(junk, 1, fakeProject)).not.toThrow();
      expect(coastlineTiles(junk, 1, fakeProject)).toEqual({ fine: [], coarse: [], coarseError: 0 });
    }
  });
});

describe('coastlineOpacity', () => {
  it('is off when zoomed out and full when zoomed in', () => {
    expect(coastlineOpacity(3.0, 1.6, 1.1)).toBe(0);
    expect(coastlineOpacity(1.6, 1.6, 1.1)).toBe(0);
    expect(coastlineOpacity(1.1, 1.6, 1.1)).toBe(1);
    expect(coastlineOpacity(1.015, 1.6, 1.1)).toBe(1);
  });

  it('ramps smoothly in between, so it does not pop mid-pinch', () => {
    const mid = coastlineOpacity(1.35, 1.6, 1.1);
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(0.6);
    // Monotonic across the range.
    let prev = -1;
    for (let d = 1.6; d >= 1.1; d -= 0.05) {
      const o = coastlineOpacity(d, 1.6, 1.1);
      expect(o).toBeGreaterThanOrEqual(prev);
      prev = o;
    }
  });

  it('stays in [0,1] and does not divide by zero on a degenerate range', () => {
    expect(coastlineOpacity(1.2, 1.1, 1.1)).toBe(0);
    expect(coastlineOpacity(1.2, 1.0, 1.6)).toBe(0);
  });
});

describe('coastlineTiles: tiles and detail', () => {
  // Grid units of a tenth of a degree, from the south-west corner of the world.
  const TENTHS = { scale: [0.1, 0.1], translate: [-180, -90] };
  const at = (lat, lon) => [Math.round((lon + 180) * 10), Math.round((lat + 90) * 10)];
  // An arc through these [lat, lon] points, as TopoJSON stores it: a start and then steps.
  const arcThrough = (...pts) => pts.map(([lat, lon], i) => {
    const [x, y] = at(lat, lon);
    if (i === 0) return [x, y];
    const [px, py] = at(...pts[i - 1]);
    return [x - px, y - py];
  });
  // Along the equator from 0 to 40 east, a point a degree; up the 100-east meridian from 10 to
  // 30 north; and one too short to draw.
  const topo = {
    transform: TENTHS,
    arcs: [
      arcThrough(...Array.from({ length: 41 }, (_, i) => [0, i])),
      arcThrough(...Array.from({ length: 21 }, (_, i) => [10 + i, 100])),
      arcThrough([10, 10]),
    ],
  };
  const segments = (tiles) => tiles.reduce((n, t) => n + t.positions.length / 6, 0);
  const angle = (t, i) => {
    const p = t.positions;
    const cos = (p[i] * t.center[0] + p[i + 1] * t.center[1] + p[i + 2] * t.center[2]) / Math.hypot(p[i], p[i + 1], p[i + 2]);
    return Math.acos(Math.min(1, cos));
  };

  it('keeps every segment, sorted into tiles', () => {
    const { fine } = coastlineTiles(topo, 1, latLonToVector3);
    expect(segments(fine)).toBe(40 + 20);
    // 0-40E on the equator crosses three 15-degree tiles; 10-30N on 100E crosses two.
    expect(fine.length).toBe(5);
  });

  it('says how far round from its middle every point of a tile can be, and that is not far', () => {
    for (const t of coastlineTiles(topo, 1, latLonToVector3).fine) {
      for (let i = 0; i < t.positions.length; i += 3) expect(angle(t, i)).toBeLessThanOrEqual(t.reach + 1e-6);
      // Half a 15-degree tile's diagonal, and the half degree a segment can hang over its edge.
      expect(t.reach).toBeLessThan(((7.5 * Math.SQRT2 + 0.5) * Math.PI) / 180);
    }
  });

  it('thins the coarse level to one segment in a stride, and keeps where each arc ends', () => {
    const { coarse } = coastlineTiles(topo, 1, latLonToVector3, { coarseStride: 4 });
    expect(segments(coarse)).toBe(10 + 5);
    const end = latLonToVector3(0, 40, 1);
    const reachesEnd = coarse.some((t) => {
      for (let i = 0; i < t.positions.length; i += 3) {
        if (Math.hypot(t.positions[i] - end.x, t.positions[i + 1] - end.y, t.positions[i + 2] - end.z) < 1e-6) return true;
      }
      return false;
    });
    expect(reachesEnd).toBe(true);
  });

  it('measures how far the coarse level strays from the points it skips', () => {
    const straight = { transform: TENTHS, arcs: [arcThrough([0, 0], [0, 1], [0, 2], [0, 3], [0, 4])] };
    // Only the sag of a straight line under the curve of the globe: 1 - cos(2 degrees).
    expect(coastlineTiles(straight, 1, latLonToVector3).coarseError).toBeCloseTo(1 - Math.cos((2 * Math.PI) / 180), 6);
    // A headland a degree out, skipped by the coarse line across its base.
    const headland = { transform: TENTHS, arcs: [arcThrough([0, 0], [0, 1], [1, 2], [0, 3], [0, 4])] };
    expect(coastlineTiles(headland, 1, latLonToVector3).coarseError).toBeCloseTo(Math.PI / 180, 3);
  });

  it('puts a segment across the antimeridian on the antimeridian, not at Greenwich', () => {
    const fiji = { transform: TENTHS, arcs: [arcThrough([-16.8, 179.9], [-16.8, -179.9])] };
    const [tile] = coastlineTiles(fiji, 1, latLonToVector3).fine;
    const there = latLonToVector3(-16.8, 180, 1);
    expect(tile.center[0] * there.x + tile.center[1] * there.y + tile.center[2] * there.z).toBeGreaterThan(Math.cos(Math.PI / 12));
    expect(tile.reach).toBeLessThan(Math.PI / 12);
  });
});

describe('coastlineLevel', () => {
  it('draws the coarse level wherever it is within half a pixel of the full one', () => {
    const error = 0.001; // radians
    expect(coastlineLevel(error, COASTLINE_STILL_PX / error, false)).toBe('coarse');
    expect(coastlineLevel(error, (COASTLINE_STILL_PX / error) * 1.01, false)).toBe('fine');
  });

  it('lets it stray further while the camera moves, but not without limit', () => {
    const error = 0.001;
    expect(coastlineLevel(error, (COASTLINE_STILL_PX / error) * 2, true)).toBe('coarse');
    expect(coastlineLevel(error, COASTLINE_MOVING_PX / error, true)).toBe('coarse');
    expect(coastlineLevel(error, (COASTLINE_MOVING_PX / error) * 1.01, true)).toBe('fine');
  });
});
