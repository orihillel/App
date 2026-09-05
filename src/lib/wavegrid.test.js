import { describe, it, expect } from 'vitest';
import {
  gridRows, gridCells, gridCellCount, sampleGrid,
  encodeHeights, decodeHeights, bytesToBase64, base64ToBytes, sampleGridSmooth,
  GRID_MAX_LAT, GRID_LAT_STEP, NO_DATA,
} from './wavegrid.js';

describe('the grid itself', () => {
  it('covers the surfing latitudes and stops at the ice', () => {
    const rows = gridRows();
    expect(rows[0].lat).toBe(-GRID_MAX_LAT);
    expect(rows[rows.length - 1].lat).toBe(GRID_MAX_LAT);
    // Arctic Norway (Unstad, 68.3N) and the Southern Ocean swell fetch both have to be inside.
    expect(GRID_MAX_LAT).toBeGreaterThan(68.3);
  });

  it('thins rows toward the poles so cells stay roughly equal-area', () => {
    const rows = gridRows();
    const equator = rows.find((r) => r.lat === 0);
    const high = rows.find((r) => r.lat === 70);
    expect(high.count).toBeLessThan(equator.count / 2);
    // Never so thin that a row degenerates.
    for (const r of rows) expect(r.count).toBeGreaterThanOrEqual(8);
  });

  it('stays small enough to refresh inside a free API budget', () => {
    // The reason for the cos(lat) thinning. Four refreshes a day must sit under 10k points.
    expect(gridCellCount()).toBeLessThan(2000);
    expect(gridCellCount() * 4).toBeLessThan(10000);
  });

  it('agrees with itself about how many cells there are', () => {
    // The Worker fetches by gridCells() and the app addresses by index; a mismatch here would
    // silently paint one ocean's swell onto another rather than failing.
    expect(gridCells()).toHaveLength(gridCellCount());
  });

  it('places every cell centre inside the world', () => {
    for (const c of gridCells()) {
      expect(c.lat).toBeGreaterThanOrEqual(-90);
      expect(c.lat).toBeLessThanOrEqual(90);
      expect(c.lon).toBeGreaterThan(-180);
      expect(c.lon).toBeLessThan(180);
    }
  });
});

describe('encoding', () => {
  it('round-trips a height to within the 0.1m step it stores', () => {
    // The guarantee is half a step, 0.05m — 1.25 sits exactly on a rounding boundary and comes
    // back 1.3, which is the format working, not failing. Far finer than the forecast itself.
    const heights = [0, 0.4, 1.25, 3.7, 12.9, 25.4];
    const back = decodeHeights(encodeHeights(heights));
    for (let i = 0; i < heights.length; i++) {
      expect(Math.abs(back[i] - heights[i]), String(heights[i])).toBeLessThanOrEqual(0.05 + 1e-9);
    }
  });

  it('keeps "no data" distinct from "flat calm"', () => {
    // The whole point: one is transparent ocean-less land, the other is painted dark blue.
    const bytes = encodeHeights([null, 0, undefined, NaN, -1]);
    expect(Array.from(bytes)).toEqual([NO_DATA, 0, NO_DATA, NO_DATA, NO_DATA]);
    const back = decodeHeights(bytes);
    expect(back[0]).toBeNull();
    expect(back[1]).toBe(0);
  });

  it('clamps a freak value rather than wrapping it around to calm', () => {
    // 255 is reserved, and a byte that overflowed would decode as no-data or as near-zero.
    expect(encodeHeights([40])[0]).toBe(254);
    expect(decodeHeights(encodeHeights([40]))[0]).toBeCloseTo(25.4, 1);
  });

  it('survives a base64 round trip byte for byte', () => {
    const bytes = encodeHeights([0, 1.5, null, 25.4, 3.3]);
    expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes));
  });

  it('is compact enough to be worth caching', () => {
    const bytes = encodeHeights(new Array(gridCellCount()).fill(2));
    expect(bytesToBase64(bytes).length).toBeLessThan(4000);
  });
});

describe('sampleGrid', () => {
  // A grid where each cell's value encodes its own index, so a lookup returning the wrong cell
  // is visible rather than plausible.
  const indexed = decodeHeights(encodeHeights(gridCells().map((_, i) => (i % 250) / 10)));

  it('returns the value of the cell containing the position', () => {
    const cells = gridCells();
    for (const i of [0, 1, 500, 900, cells.length - 1]) {
      expect(sampleGrid(indexed, cells[i].lat, cells[i].lon)).toBeCloseTo((i % 250) / 10, 5);
    }
  });

  it('wraps longitude rather than falling off the end of a row', () => {
    // 180 and -180 are the same meridian; so are 190 and -170.
    expect(sampleGrid(indexed, 0, 180)).toBe(sampleGrid(indexed, 0, -180));
    expect(sampleGrid(indexed, 0, 190)).toBe(sampleGrid(indexed, 0, -170));
    expect(sampleGrid(indexed, 0, -540)).toBe(sampleGrid(indexed, 0, 180));
  });

  it('returns null beyond the grid rather than clamping to the last row', () => {
    // Clamping would paint the Southern Ocean's swell across Antarctica.
    expect(sampleGrid(indexed, 89, 0)).toBeNull();
    expect(sampleGrid(indexed, -89, 0)).toBeNull();
  });

  it('reads land as null, not as calm', () => {
    const withLand = decodeHeights(encodeHeights(gridCells().map(() => null)));
    expect(sampleGrid(withLand, 0, 0)).toBeNull();
  });

  it('survives junk rather than throwing mid-render', () => {
    for (const junk of [null, undefined, []]) {
      expect(() => sampleGrid(junk, 0, 0)).not.toThrow();
      expect(sampleGrid(junk, 0, 0)).toBeNull();
    }
    expect(sampleGrid(indexed, NaN, 0)).toBeNull();
    expect(sampleGrid(indexed, 0, undefined)).toBeNull();
  });

  it('covers every latitude in range without a gap between rows', () => {
    const filled = decodeHeights(encodeHeights(gridCells().map(() => 1)));
    for (let lat = -GRID_MAX_LAT; lat <= GRID_MAX_LAT; lat += GRID_LAT_STEP / 2) {
      expect(sampleGrid(filled, lat, 17), 'lat ' + lat).toBe(1);
    }
  });
});

describe('sampleGridSmooth', () => {
  const flat = (v) => decodeHeights(encodeHeights(gridCells().map(() => v)));

  it('reproduces a uniform field exactly', () => {
    const h = flat(2);
    for (const [lat, lon] of [[0, 0], [33.3, -117.6], [-34, 25], [60, 170], [-70, -3]]) {
      expect(sampleGridSmooth(h, lat, lon)).toBeCloseTo(2, 5);
    }
  });

  it('gives intermediate values between cells instead of blocks', () => {
    // A north-south ramp: the value at a point between two rows must land between them.
    const cells = gridCells();
    const h = decodeHeights(encodeHeights(cells.map((c) => (c.lat + 90) / 20)));
    const a = sampleGridSmooth(h, 0, 10);
    const b = sampleGridSmooth(h, GRID_LAT_STEP, 10);
    const mid = sampleGridSmooth(h, GRID_LAT_STEP / 2, 10);
    expect(mid).toBeGreaterThan(Math.min(a, b));
    expect(mid).toBeLessThan(Math.max(a, b));
  });

  it('does not average land in as though it were flat calm', () => {
    // The failure that would matter: a false band of calm dragged along every coastline,
    // exactly where people look. A neighbour with no data must not pull the value toward zero.
    const cells = gridCells();
    const h = decodeHeights(encodeHeights(cells.map((c, i) => (i % 2 === 0 ? null : 4))));
    for (const [lat, lon] of [[0, 0], [10, 40], [-20, -60]]) {
      const v = sampleGridSmooth(h, lat, lon);
      if (v !== null) expect(v).toBeCloseTo(4, 5);
    }
  });

  it('returns null where every contributing cell is land', () => {
    expect(sampleGridSmooth(flat(null), 0, 0)).toBeNull();
  });

  it('wraps across the antimeridian rather than seaming', () => {
    const cells = gridCells();
    const h = decodeHeights(encodeHeights(cells.map((c) => 1 + Math.cos((c.lon * Math.PI) / 180))));
    const west = sampleGridSmooth(h, 0, 179.9);
    const east = sampleGridSmooth(h, 0, -179.9);
    expect(Math.abs(west - east)).toBeLessThan(0.1);
  });

  it('survives junk rather than throwing mid-texture-build', () => {
    for (const junk of [null, undefined, []]) {
      expect(() => sampleGridSmooth(junk, 0, 0)).not.toThrow();
      expect(sampleGridSmooth(junk, 0, 0)).toBeNull();
    }
    expect(sampleGridSmooth(flat(1), NaN, 0)).toBeNull();
  });
});
