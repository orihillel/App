import { describe, it, expect } from 'vitest';
import { cellSizeForDistance, clusterPoints, centroid } from './markercluster.js';
import { SPOTS, ORDER } from './spots.js';

const CATALOG = ORDER.filter((id) => SPOTS[id]).map((id) => ({ id, lat: SPOTS[id].lat, lon: SPOTS[id].lon }));

describe('cellSizeForDistance', () => {
  it('is coarse when the whole globe is in view and fine when it is not', () => {
    const far = cellSizeForDistance(3);
    const near = cellSizeForDistance(1.6);
    expect(far).toBeGreaterThan(near);
  });

  it('stops clustering entirely once you are close enough to separate spots by eye', () => {
    expect(cellSizeForDistance(1.05)).toBe(0);
  });

  it('never returns a cell so coarse that a continent becomes one dot', () => {
    for (const d of [2, 2.5, 3, 4, 8]) expect(cellSizeForDistance(d)).toBeLessThanOrEqual(24);
  });

  it('returns 0 rather than NaN for a nonsense distance', () => {
    for (const d of [NaN, undefined, 0, 1, -3]) expect(cellSizeForDistance(d)).toBe(0);
  });
});

describe('clusterPoints', () => {
  it('hands everything back untouched when clustering is off', () => {
    const out = clusterPoints(CATALOG, 0);
    expect(out.length).toBe(CATALOG.length);
    expect(out.every((c) => c.count === 1)).toBe(true);
  });

  it('loses no spot: every id survives exactly once, at every zoom', () => {
    // The failure this guards is a marker that quietly disappears into a cell and never comes
    // back out -- which on a spot globe means a spot you can no longer reach.
    for (const cell of [0, 2, 5, 12, 24]) {
      const out = clusterPoints(CATALOG, cell);
      const ids = out.flatMap((c) => c.ids);
      expect(ids.length, 'cell ' + cell).toBe(CATALOG.length);
      expect(new Set(ids).size, 'cell ' + cell).toBe(CATALOG.length);
      expect(out.reduce((n, c) => n + c.count, 0), 'cell ' + cell).toBe(CATALOG.length);
    }
  });

  it('actually thins out the crowded coastlines it exists for', () => {
    const out = clusterPoints(CATALOG, 12);
    expect(out.length).toBeLessThan(CATALOG.length * 0.75);
    expect(out.some((c) => c.count > 1)).toBe(true);
  });

  it('clusters less as the cell shrinks', () => {
    const coarse = clusterPoints(CATALOG, 20).length;
    const fine = clusterPoints(CATALOG, 4).length;
    expect(fine).toBeGreaterThan(coarse);
  });

  it('does not merge spots on opposite sides of the planet', () => {
    const pts = [
      { id: 'a', lat: 0, lon: 0 },
      { id: 'b', lat: 0, lon: 180 },
      { id: 'c', lat: 60, lon: -120 },
    ];
    expect(clusterPoints(pts, 24).length).toBe(3);
  });

  it('keeps high-latitude spots apart that an unweighted lat/lon grid would merge', () => {
    // At 70N a 10-degree longitude step is about 380km; at the equator it is 1,100km. A grid
    // that ignores that merges Arctic spots three times more eagerly than tropical ones.
    const arctic = [
      { id: 'n1', lat: 70, lon: 0 },
      { id: 'n2', lat: 70, lon: 9 },
    ];
    const tropic = [
      { id: 't1', lat: 0, lon: 0 },
      { id: 't2', lat: 0, lon: 9 },
    ];
    expect(clusterPoints(arctic, 10).length).toBe(1); // one widened cell holds both
    expect(clusterPoints(tropic, 10).length).toBe(2); // the same span is two cells here
  });

  it('survives junk coordinates instead of placing a marker at NaN', () => {
    const out = clusterPoints([{ id: 'ok', lat: 10, lon: 10 }, { id: 'bad', lat: null, lon: undefined }], 10);
    expect(out.length).toBe(1);
    expect(Number.isFinite(out[0].lat)).toBe(true);
  });
});

describe('centroid', () => {
  it('averages across the antimeridian rather than through the far side of the planet', () => {
    // Averaging the longitudes gives 0 -- the Gulf of Guinea, a hemisphere away from both.
    const c = centroid([{ lat: 0, lon: 179 }, { lat: 0, lon: -179 }]);
    expect(Math.abs(Math.abs(c.lon) - 180)).toBeLessThan(0.001);
    expect(c.lat).toBeCloseTo(0, 6);
  });

  it('puts the centre of a tight group inside the group', () => {
    const c = centroid([{ lat: 33.3, lon: -117.5 }, { lat: 33.5, lon: -117.7 }]);
    expect(c.lat).toBeGreaterThan(33.3);
    expect(c.lat).toBeLessThan(33.5);
    expect(c.lon).toBeLessThan(-117.5);
    expect(c.lon).toBeGreaterThan(-117.7);
  });

  it('falls back to a real point when the vectors cancel out', () => {
    const c = centroid([{ lat: 0, lon: 0 }, { lat: 0, lon: 180 }]);
    expect(Number.isFinite(c.lat) && Number.isFinite(c.lon)).toBe(true);
  });
});
