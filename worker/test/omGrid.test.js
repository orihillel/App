import { describe, it, expect } from 'vitest';
import {
  omKey, runAt, stepAt, candidateKeys, looksLikeOm, areaMean, areaMeanBearing, regrid,
  buildGridFromOm, OM_MIN_BYTES, MAX_RUNS_BACK,
  candidateKeysFor, parseFrameHour, fetchFrameFromOm,
} from '../src/omGrid.js';
import { gridCellCount } from '../../src/lib/wavegrid.js';

const T = (y, m, d, h, mi = 0) => Date.UTC(y, m - 1, d, h, mi);

describe('locating a published file', () => {
  it('writes the run hour with four digits, because the bucket does', () => {
    // 06Z is a 404; 0600Z is the file. Found the hard way against the live bucket.
    expect(omKey(T(2026, 9, 21, 18), T(2026, 9, 22, 3)))
      .toBe('data_spatial/ecmwf_wam025/2026/09/21/1800Z/2026-09-22T0300.om');
    expect(omKey(T(2026, 9, 1, 6), T(2026, 9, 1, 9)))
      .toBe('data_spatial/ecmwf_wam025/2026/09/01/0600Z/2026-09-01T0900.om');
  });

  it('rounds back to the run and the timestep that exist, never forward', () => {
    expect(runAt(T(2026, 9, 22, 13, 40))).toBe(T(2026, 9, 22, 12));
    expect(runAt(T(2026, 9, 22, 5, 59))).toBe(T(2026, 9, 22, 0));
    // Files are three-hourly; asking for the hour in between is a 404.
    expect(stepAt(T(2026, 9, 22, 13, 40))).toBe(T(2026, 9, 22, 12));
    expect(stepAt(T(2026, 9, 22, 2, 59))).toBe(T(2026, 9, 22, 0));
  });

  it('offers the newest run first and walks back', () => {
    const keys = candidateKeys(T(2026, 9, 22, 13));
    expect(keys).toHaveLength(MAX_RUNS_BACK);
    expect(keys[0]).toContain('/2026/09/22/1200Z/');
    expect(keys[1]).toContain('/2026/09/22/0600Z/');
    expect(keys[3]).toContain('/2026/09/21/1800Z/');
    // Every candidate describes the same moment; only the run that forecast it differs.
    for (const k of keys) expect(k.endsWith('2026-09-22T1200.om')).toBe(true);
  });

  it('never asks a run to forecast its own past', () => {
    // The newest run has published nothing yet at the moment it starts, so a candidate list
    // that included it would be asking for a file that cannot exist rather than one that is
    // merely late.
    for (const k of candidateKeys(T(2026, 9, 22, 12, 1))) {
      const run = k.match(/\/(\d{4})\/(\d{2})\/(\d{2})\/(\d{2})00Z\//);
      const valid = k.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2})\d{2}\.om$/);
      const runMs = Date.UTC(+run[1], +run[2] - 1, +run[3], +run[4]);
      const validMs = Date.UTC(+valid[1], +valid[2] - 1, +valid[3], +valid[4]);
      expect(runMs).toBeLessThanOrEqual(validMs);
    }
  });
});

describe('looksLikeOm', () => {
  const big = (first, second) => {
    const b = new Uint8Array(OM_MIN_BYTES + 10);
    b[0] = first; b[1] = second;
    return b;
  };
  it('accepts the format\'s own magic number', () => {
    expect(looksLikeOm(big(0x4f, 0x4d))).toBe(true); // "OM"
  });
  // The point of the guard: reaching for the reader pulls in two megabytes of WebAssembly, and
  // doing that to discover the body was an error page is slow exactly when slow is worst.
  it('rejects a body that is the right size but the wrong thing', () => {
    expect(looksLikeOm(big(0x3c, 0x21))).toBe(false); // "<!" -- an HTML error page
  });
  it('rejects anything too small to be a global field', () => {
    const small = new Uint8Array(1000); small[0] = 0x4f; small[1] = 0x4d;
    expect(looksLikeOm(small)).toBe(false);
    expect(looksLikeOm(null)).toBe(false);
  });
});

describe('sampling a field onto our grid', () => {
  // A 5x8 toy field, valued by row so a mis-indexed read is visible rather than plausible.
  const field = (fn) => {
    const nLat = 5, nLon = 8;
    const values = new Float32Array(nLat * nLon);
    for (let r = 0; r < nLat; r++) for (let c = 0; c < nLon; c++) values[r * nLon + c] = fn(r, c);
    return { values, nLat, nLon };
  };

  it('averages what a cell covers rather than sampling its centre', () => {
    const f = field((r) => r); // 0..4 by row
    // A window spanning the whole thing averages every row.
    expect(areaMean(f, 0, 0, 90, 180)).toBeCloseTo(2, 5);
  });

  it('reports nothing for a cell with no water in it', () => {
    const f = field(() => NaN);
    expect(areaMean(f, 0, 0, 90, 180)).toBeNull();
    expect(areaMeanBearing(f, 0, 0, 90, 180)).toBeNull();
  });

  it('ignores land when averaging the water around it', () => {
    const f = field((r) => (r < 2 ? NaN : 4));
    expect(areaMean(f, 0, 0, 90, 180)).toBeCloseTo(4, 5);
  });

  // Averaging bearings arithmetically puts the mean of 350 and 10 at 180 -- the exact opposite
  // of where the swell is going.
  it('averages bearings as vectors, not as numbers', () => {
    const f = field((r, c) => (c % 2 ? 350 : 10));
    const mean = areaMeanBearing(f, 0, 0, 90, 180);
    expect(Math.min(mean, 360 - mean)).toBeLessThan(1);
  });

  it('says nothing when the directions cancel', () => {
    // Opposing swells leave no meaningful mean, and an arbitrary bearing from a near-zero
    // vector would be a confident arrow pointing nowhere real.
    const f = field((r, c) => (c % 2 ? 0 : 180));
    expect(areaMeanBearing(f, 0, 0, 90, 180)).toBeNull();
  });

  it('produces exactly one value per cell of the grid it is asked for', () => {
    const f = field((r) => r);
    const g = regrid(f, f, 20);
    expect(g.cells).toBe(gridCellCount(20));
    expect(g.heights).toHaveLength(gridCellCount(20));
    expect(g.directions).toHaveLength(gridCellCount(20));
  });
});

describe('buildGridFromOm', () => {
  it('returns null rather than throwing when no run is reachable', async () => {
    // The caller falls back to point queries on null. Throwing here would take the globe dark
    // instead.
    const out = await buildGridFromOm({ now: T(2026, 9, 22, 12), fetch: async () => ({ ok: false, status: 404 }) });
    expect(out).toBeNull();
  });

  it('tries every candidate run before giving up', async () => {
    const tried = [];
    await buildGridFromOm({
      now: T(2026, 9, 22, 12),
      fetch: async (url) => { tried.push(url); return { ok: false, status: 404 }; },
    });
    expect(tried).toHaveLength(MAX_RUNS_BACK);
  });

  it('keeps going when one run throws instead of answering', async () => {
    let calls = 0;
    const out = await buildGridFromOm({
      now: T(2026, 9, 22, 12),
      fetch: async () => { calls++; if (calls === 1) throw new Error('socket'); return { ok: false, status: 404 }; },
    });
    expect(calls).toBe(MAX_RUNS_BACK);
    expect(out).toBeNull();
  });

  it('does not reach for the reader when the body is not one of these files', async () => {
    // If it did, this would import two megabytes of WebAssembly to find out.
    const out = await buildGridFromOm({
      now: T(2026, 9, 22, 12),
      fetch: async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([0x3c, 0x21, 0x64]).buffer }),
    });
    expect(out).toBeNull();
  });
});

describe('a frame of the animated week', () => {
  it('reads the hour as UTC, however it is truncated', () => {
    // The week indexes frames by "2026-09-22T06:00"; the bucket names files
    // "2026-09-22T0600.om". Two truncations of the same instant, and getting the zone wrong
    // would shift every frame by the runner's offset.
    expect(parseFrameHour('2026-09-22T06:00')).toBe(Date.UTC(2026, 8, 22, 6));
    expect(parseFrameHour('2026-09-22T06')).toBe(Date.UTC(2026, 8, 22, 6));
    expect(parseFrameHour('nonsense')).toBeNull();
    expect(parseFrameHour(null)).toBeNull();
  });

  it('asks the newest run that could hold a future hour', () => {
    const now = Date.UTC(2026, 8, 22, 13);
    const keys = candidateKeysFor(Date.UTC(2026, 8, 25, 6), now);
    expect(keys[0]).toContain('/2026/09/22/1200Z/');
    for (const k of keys) expect(k.endsWith('2026-09-25T0600.om')).toBe(true);
  });

  it('gives back nothing rather than a hole when no run has that hour', async () => {
    // advanceFrames stops the pass on null. Recording an empty frame would mark it done and
    // leave a gap in the week until the next rebuild.
    const out = await fetchFrameFromOm('2026-09-25T06:00', 20, {
      now: Date.UTC(2026, 8, 22, 13),
      fetch: async () => ({ ok: false, status: 404 }),
    });
    expect(out).toBeNull();
  });

  it('refuses a body that is not one of these files', async () => {
    const out = await fetchFrameFromOm('2026-09-25T06:00', 20, {
      now: Date.UTC(2026, 8, 22, 13),
      fetch: async () => ({ ok: true, arrayBuffer: async () => new Uint8Array(200).buffer }),
    });
    expect(out).toBeNull();
  });
});
