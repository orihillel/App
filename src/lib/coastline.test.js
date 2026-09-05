import { describe, it, expect } from 'vitest';
import { decodeArc, arcsToLineVertices, coastlineOpacity } from './coastline.js';

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

describe('arcsToLineVertices', () => {
  it('emits both endpoints of every segment', () => {
    // One arc of 3 points is 2 segments, so 4 vertices, so 12 floats.
    const topo = { transform: IDENTITY, arcs: [[[0, 0], [1, 0], [1, 0]]] };
    const v = arcsToLineVertices(topo, 1, fakeProject);
    expect(v).toBeInstanceOf(Float32Array);
    expect(v.length).toBe(12);
    // Segment 1 runs (0,0)->(0,1) in lon, segment 2 runs (0,1)->(0,2), sharing the middle point.
    expect(Array.from(v)).toEqual([0, 0, 1, 1, 0, 1, 1, 0, 1, 2, 0, 1]);
  });

  it('sizes the buffer exactly, with no slack', () => {
    const topo = { transform: IDENTITY, arcs: [
      [[0, 0], [1, 1], [1, 1], [1, 1]], // 4 points -> 3 segments
      [[0, 0], [2, 2]],                 // 2 points -> 1 segment
    ] };
    expect(arcsToLineVertices(topo, 1, fakeProject).length).toBe(4 * 6);
  });

  it('skips arcs too short to make a segment rather than emitting a degenerate one', () => {
    const topo = { transform: IDENTITY, arcs: [[[5, 5]], [], [[0, 0], [1, 0]]] };
    expect(arcsToLineVertices(topo, 1, fakeProject).length).toBe(6); // only the last arc counts
  });

  it('passes the radius through to the projection', () => {
    const topo = { transform: IDENTITY, arcs: [[[0, 0], [1, 0]]] };
    const v = arcsToLineVertices(topo, 7, fakeProject);
    expect(v[2]).toBe(7);
  });

  it('returns an empty buffer rather than throwing on missing or malformed data', () => {
    for (const junk of [null, undefined, {}, { arcs: [] }, { transform: IDENTITY }, { arcs: 'no', transform: IDENTITY }]) {
      expect(() => arcsToLineVertices(junk, 1, fakeProject)).not.toThrow();
      expect(arcsToLineVertices(junk, 1, fakeProject).length).toBe(0);
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
