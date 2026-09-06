import { describe, it, expect } from 'vitest';
import {
  gridRows, gridCells, gridCellCount, sampleGrid, fillGridGaps,
  encodeHeights, decodeHeights, bytesToBase64, base64ToBytes, sampleGridSmooth,
  encodeDirections, decodeDirections, sampleDirectionSmooth,
  GRID_MAX_LAT, GRID_LAT_STEP, NO_DATA, NO_DIR,
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
    // By position, not by an exact latitude: the step size is a tuning knob and no row is
    // guaranteed to land on 0 or 70.
    const nearest = (target) => rows.reduce((a, b) => (Math.abs(b.lat - target) < Math.abs(a.lat - target) ? b : a));
    const equator = nearest(0);
    const high = nearest(75);
    expect(high.count).toBeLessThan(equator.count / 2);
    // Never so thin that a row degenerates.
    for (const r of rows) expect(r.count).toBeGreaterThanOrEqual(8);
  });

  it('fits inside a single minute of the API budget', () => {
    // The constraint that decided the grid's resolution, and the one three failed attempts
    // ignored. Open-Meteo's free tier allows roughly 600 calls a minute; a grid larger than
    // that cannot be fetched in one pass at all, and every design that spread it over several
    // minutes then ran into the platform's bounded invocations. The grid fits the budget.
    expect(gridCellCount()).toBeLessThan(600);
    // And four refreshes a day stay well under the daily allowance.
    expect(gridCellCount() * 4).toBeLessThan(10000);
  });

  it('completes in one pass, rather than needing several invocations', () => {
    // 5 batches of 100, 8s apart, is ~32s: inside a single slice. At 5 degrees this was 17
    // batches over 3.2 minutes, which needed ~2.5 hours of cron ticks to finish and so never
    // did.
    const batches = Math.ceil(gridCellCount() / 100);
    expect((batches - 1) * 8).toBeLessThan(45);
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
    // Indices relative to the grid, so resizing it does not silently skip the middle.
    for (const i of [0, 1, Math.floor(cells.length / 3), Math.floor(cells.length * 2 / 3), cells.length - 1]) {
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

describe('fillGridGaps', () => {
  const rows = gridRows();
  const offsetOf = (rowIndex) => rows.slice(0, rowIndex).reduce((n, r) => n + r.count, 0);
  // The widest row, where a step east is a step east and not most of the way round the world.
  const wide = rows.reduce((a, b, i) => (b.count > rows[a].count ? i : a), 0);
  const empty = () => new Array(gridCellCount()).fill(null);

  it('carries a reading into the cells beside it', () => {
    // Which is the whole job: the coastline decides where the chart stops now, and the chart
    // has to have something to paint right up to it, including in the cells the model had
    // nothing to say about.
    const h = empty();
    const seed = offsetOf(wide) + 10;
    h[seed] = 4;
    const filled = fillGridGaps(h);
    expect(filled[seed - 1]).toBe(4);
    expect(filled[seed + 1]).toBe(4);
  });

  it('leaves a cell that already has a reading exactly as it was', () => {
    const h = gridCells().map((_, i) => (i % 3 === 0 ? null : 2.5));
    const filled = fillGridGaps(h);
    for (let i = 0; i < h.length; i++) if (h[i] != null) expect(filled[i]).toBe(h[i]);
  });

  it('fills across a row boundary, not only along a row', () => {
    // Rows hold different numbers of cells, so "the cell above" is not the one at the same
    // index — getting that wrong would drag a value sideways across an ocean.
    const h = empty();
    const row = rows[wide];
    const seed = offsetOf(wide) + 3;
    h[seed] = 6;
    const filled = fillGridGaps(h);
    const lon = -180 + (3 + 0.5) * row.step;
    const above = rows[wide + 1];
    const j = Math.min(above.count - 1, Math.floor((((lon + 180) % 360) + 360) % 360 / above.step));
    expect(filled[offsetOf(wide + 1) + j]).toBe(6);
  });

  it('wraps around the world rather than stopping at the edge of the array', () => {
    // A row is a circle. Both ends of it have a neighbour on the far side of the antimeridian,
    // and reading past the end of the array instead would pick up a cell from another row.
    const start = offsetOf(wide);
    const last = start + rows[wide].count - 1;
    // A single round, so each direction is tested on its own: over two rounds a value can
    // reach the same cell the long way round through the row below, and a broken wrap would
    // pass unnoticed.
    const west = empty();
    west[start] = 3;
    expect(fillGridGaps(west, 1)[last]).toBe(3);
    const east = empty();
    east[last] = 5;
    expect(fillGridGaps(east, 1)[start]).toBe(5);
  });

  it('spreads far enough to reach a coast and no further', () => {
    // Two rounds is about two cells, and a cell is 1,100km. Spreading without limit would
    // carry a Pacific swell height across a continent and paint it on an inland sea, which is
    // a claim about the world rather than a way of reaching the shore.
    const h = empty();
    const seed = offsetOf(wide) + 10;
    h[seed] = 4;
    const filled = fillGridGaps(h);
    expect(filled[seed + 2]).not.toBeNull();
    expect(filled[seed + 3]).toBeNull();
  });

  it('invents nothing when there is nothing to spread', () => {
    expect(fillGridGaps(empty()).every((v) => v === null)).toBe(true);
  });

  it('survives junk rather than throwing before the overlay is built', () => {
    for (const junk of [null, undefined, 'grid']) expect(() => fillGridGaps(junk)).not.toThrow();
    expect(fillGridGaps([])).toEqual([]);
  });
});

describe('direction encoding', () => {
  it('round-trips a bearing to within the step it stores', () => {
    const degrees = [0, 45, 90, 180, 270, 359];
    const back = decodeDirections(encodeDirections(degrees));
    for (let i = 0; i < degrees.length; i++) {
      expect(Math.abs(back[i] - degrees[i]), String(degrees[i])).toBeLessThan(1.5);
    }
  });

  it('keeps "no reading" distinct from due north', () => {
    // Both would be zero in a naive encoding, and a grid of land would come back pointing north.
    const bytes = encodeDirections([null, 0, undefined, NaN]);
    expect(Array.from(bytes)).toEqual([NO_DIR, 0, NO_DIR, NO_DIR]);
    expect(decodeDirections(bytes)[0]).toBeNull();
    expect(decodeDirections(bytes)[1]).toBe(0);
  });

  it('folds 360 back to 0 rather than into the reserved byte', () => {
    expect(encodeDirections([360])[0]).toBe(0);
    expect(encodeDirections([720])[0]).toBe(0);
    expect(encodeDirections([-90])[0]).toBe(encodeDirections([270])[0]);
  });

  it('never emits the no-data byte for a real bearing', () => {
    for (let d = 0; d < 360; d += 0.25) expect(encodeDirections([d])[0], String(d)).not.toBe(NO_DIR);
  });
});

describe('sampleDirectionSmooth', () => {
  const flat = (deg) => decodeDirections(encodeDirections(gridCells().map(() => deg)));

  it('reproduces a uniform field', () => {
    for (const deg of [0, 90, 200, 315]) {
      const got = sampleDirectionSmooth(flat(deg), 20, -30);
      expect(Math.abs(got - deg), String(deg)).toBeLessThan(1.5);
    }
  });

  it('averages around the compass instead of straight through it', () => {
    // The classic bug: 350 and 10 degrees are twenty degrees apart, and averaging the numbers
    // gives due south. Two cells either side of north must interpolate to about north.
    const cells = gridCells();
    const rows = gridRows();
    const wide = rows.reduce((a, b, i) => (b.count > rows[a].count ? i : a), 0);
    const offset = rows.slice(0, wide).reduce((n, r) => n + r.count, 0);
    const degrees = cells.map(() => null);
    degrees[offset + 10] = 350;
    degrees[offset + 11] = 10;
    const row = rows[wide];
    const lonBetween = -180 + (10 + 1) * row.step; // the boundary between the two cells
    const got = sampleDirectionSmooth(decodeDirections(encodeDirections(degrees)), row.lat, lonBetween);
    expect(got > 350 || got < 10, 'got ' + got).toBe(true);
  });

  it('does not let a land cell pull the arrow toward north', () => {
    const cells = gridCells();
    const degrees = cells.map((c, i) => (i % 2 === 0 ? null : 225));
    const got = sampleDirectionSmooth(decodeDirections(encodeDirections(degrees)), 0, 0);
    if (got !== null) expect(Math.abs(got - 225)).toBeLessThan(1.5);
  });

  it('returns nothing where two swells cancel, rather than an arrow made of the residue', () => {
    const cells = gridCells();
    const rows = gridRows();
    const wide = rows.reduce((a, b, i) => (b.count > rows[a].count ? i : a), 0);
    const offset = rows.slice(0, wide).reduce((n, r) => n + r.count, 0);
    const degrees = cells.map(() => null);
    degrees[offset + 10] = 0;
    degrees[offset + 11] = 180;
    const row = rows[wide];
    const between = -180 + (10 + 1) * row.step;
    expect(sampleDirectionSmooth(decodeDirections(encodeDirections(degrees)), row.lat, between)).toBeNull();
  });

  it('returns nothing where every contributing cell is land', () => {
    expect(sampleDirectionSmooth(flat(null), 0, 0)).toBeNull();
  });

  it('survives junk rather than throwing mid-frame', () => {
    for (const junk of [null, undefined, []]) {
      expect(() => sampleDirectionSmooth(junk, 0, 0)).not.toThrow();
      expect(sampleDirectionSmooth(junk, 0, 0)).toBeNull();
    }
    expect(sampleDirectionSmooth(flat(90), NaN, 0)).toBeNull();
  });
});
