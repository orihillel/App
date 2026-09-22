import { describe, it, expect } from 'vitest';
import {
  omKey, runAt, stepAt, candidateKeys, looksLikeOm, areaMean, areaMeanBearing, regrid,
  buildGridFromOm, OM_MIN_BYTES, MAX_RUNS_BACK,
  candidateKeysFor, parseFrameHour, fetchFrameFromOm,
  RangeBackend, areaMeanWind, regridWind, buildWindGridFromOm,
  newRunProbe, runDirOf,
  WIND_MODEL, WIND_STEP_HOURS, OM_TAIL_WINDOW,
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

// A stand-in for a file in the bucket: it answers Range requests out of a byte array and
// records every one, so a test can assert both what came back and how many round trips it
// took to get it.
function fakeFile(bytes) {
  const asked = [];
  const fetchImpl = async (url, init) => {
    const header = init.headers.Range;
    asked.push(header);
    let start; let end;
    const suffix = /^bytes=-(\d+)$/.exec(header);
    if (suffix) {
      start = Math.max(0, bytes.length - Number(suffix[1]));
      end = bytes.length - 1;
    } else {
      const m = /^bytes=(\d+)-(\d+)$/.exec(header);
      start = Number(m[1]);
      end = Math.min(bytes.length - 1, Number(m[2]));
    }
    const slice = bytes.slice(start, end + 1);
    return {
      ok: true,
      status: 206,
      headers: { get: (k) => (k.toLowerCase() === 'content-range' ? `bytes ${start}-${end}/${bytes.length}` : null) },
      arrayBuffer: async () => slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength),
    };
  };
  return { fetchImpl, asked };
}

describe('RangeBackend', () => {
  const bytes = new Uint8Array(4096);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;

  it('learns the file size from the suffix request it already had to make', async () => {
    const { fetchImpl, asked } = fakeFile(bytes);
    const be = new RangeBackend('u', { fetch: fetchImpl, tailWindow: 1024, readWindow: 1024 });
    expect(await be.count()).toBe(4096);
    // One request, not a HEAD and then a GET. Content-Range carries the total.
    expect(asked).toEqual(['bytes=-1024']);
  });

  // The reason this class exists. The shipped backend asks for the same 107KB window 23 times
  // to open one file; every one of those reads has to land in a block already fetched.
  it('serves many small reads out of one fetched window', async () => {
    const { fetchImpl, asked } = fakeFile(bytes);
    const be = new RangeBackend('u', { fetch: fetchImpl, tailWindow: 1024, readWindow: 1024 });
    await be.count();
    for (let off = 3072; off < 4096; off += 8) {
      const got = await be.getBytes(off, 8);
      expect(Array.from(got)).toEqual(Array.from(bytes.slice(off, off + 8)));
    }
    expect(asked).toHaveLength(1);
    expect(be.requests).toBe(1);
  });

  it('reads ahead by a whole window on a miss, so the reads after it are free', async () => {
    const { fetchImpl, asked } = fakeFile(bytes);
    const be = new RangeBackend('u', { fetch: fetchImpl, tailWindow: 256, readWindow: 2048 });
    await be.getBytes(0, 4);
    expect(asked).toEqual(['bytes=0-2047']);
    for (let off = 0; off < 2048; off += 64) await be.getBytes(off, 64);
    expect(be.requests).toBe(1);
  });

  it('returns the right bytes, not just the right number of requests', async () => {
    const { fetchImpl } = fakeFile(bytes);
    const be = new RangeBackend('u', { fetch: fetchImpl, tailWindow: 256, readWindow: 512 });
    // Two reads far enough apart to need separate windows.
    expect(Array.from(await be.getBytes(100, 4))).toEqual([100, 101, 102, 103]);
    expect(Array.from(await be.getBytes(3000, 4))).toEqual(Array.from(bytes.slice(3000, 3004)));
    expect(be.requests).toBe(2);
  });

  it('asks for a window at least as big as the read, however big the read is', async () => {
    const { fetchImpl, asked } = fakeFile(bytes);
    const be = new RangeBackend('u', { fetch: fetchImpl, readWindow: 16 });
    const got = await be.getBytes(0, 3000);
    expect(got).toHaveLength(3000);
    expect(asked).toEqual(['bytes=0-2999']);
  });

  it('forgets old blocks rather than growing without bound', async () => {
    const { fetchImpl } = fakeFile(bytes);
    const be = new RangeBackend('u', { fetch: fetchImpl, readWindow: 256, maxBlocks: 2 });
    await be.getBytes(0, 4);
    await be.getBytes(1000, 4);
    await be.getBytes(2000, 4);
    expect(be.blocks).toHaveLength(2);
    // The first window is gone, so reading from it again costs a request.
    await be.getBytes(0, 4);
    expect(be.requests).toBe(4);
  });

  it('throws on a range the bucket refuses, so the caller can try the next run', async () => {
    const be = new RangeBackend('u', { fetch: async () => ({ ok: false, status: 404 }) });
    await expect(be.count()).rejects.toThrow('404');
  });
});

describe('wind, which is a vector', () => {
  const field = (fn) => {
    const nLat = 5, nLon = 8;
    const values = new Float32Array(nLat * nLon);
    for (let r = 0; r < nLat; r++) for (let c = 0; c < nLon; c++) values[r * nLon + c] = fn(r, c);
    return { values, nLat, nLon };
  };

  it('reports the direction the wind comes from, in the convention the app already stores', () => {
    // u is eastward. A wind blowing towards the east comes from the west: 270.
    const u = field(() => 10);
    const v = field(() => 0);
    const { speed, bearing } = areaMeanWind(u, v, 0, 0, 90, 180);
    expect(bearing).toBeCloseTo(270, 5);
    // ...and metres per second become km/h, which is what the scale and the legend read in.
    expect(speed).toBeCloseTo(36, 5);
  });

  it('gets all four quarters the right way round', () => {
    const cases = [
      [0, 10, 180],   // blowing north -> from the south
      [-10, 0, 90],   // blowing west  -> from the east
      [0, -10, 0],    // blowing south -> from the north
      [10, 10, 225],  // blowing north-east -> from the south-west
    ];
    for (const [uu, vv, expected] of cases) {
      const { bearing } = areaMeanWind(field(() => uu), field(() => vv), 0, 0, 90, 180);
      expect(bearing).toBeCloseTo(expected, 5);
    }
  });

  // The whole reason u and v are averaged rather than the speeds: a cell holding a sea breeze
  // on one side and a land breeze on the other has a real mean speed and almost no mean wind,
  // and it is the second number that says whether a face will be clean.
  it('averages the wind, not the windiness', () => {
    const u = field((r, c) => (c % 2 ? 10 : -10));
    const v = field(() => 0);
    const { speed } = areaMeanWind(u, v, 0, 0, 90, 180);
    expect(speed).toBeCloseTo(0, 5);
  });

  it('points nowhere when there is no wind to point at', () => {
    const { speed, bearing } = areaMeanWind(field(() => 0), field(() => 0), 0, 0, 90, 180);
    expect(speed).toBeCloseTo(0, 5);
    // atan2(0, 0) is 0 -- a confident due-north arrow drawn on a dead calm.
    expect(bearing).toBeNull();
  });

  it('reports nothing for a cell it has no readings in', () => {
    const nan = field(() => NaN);
    expect(areaMeanWind(nan, nan, 0, 0, 90, 180)).toEqual({ speed: null, bearing: null });
  });

  it('produces exactly one value per cell of the grid it is asked for', () => {
    const u = field(() => 3);
    const v = field(() => 4);
    const g = regridWind(u, v, 20);
    expect(g.cells).toBe(gridCellCount(20));
    expect(g.speeds).toHaveLength(gridCellCount(20));
    expect(g.directions).toHaveLength(gridCellCount(20));
    for (const s of g.speeds) expect(s).toBeCloseTo(18, 5); // hypot(3,4) m/s in km/h
  });
});

describe('buildWindGridFromOm', () => {
  it('looks in the wind model, at the cadence that model publishes', () => {
    // GFS writes a file every hour; the wave model writes one every three. Probed against the
    // live bucket -- 2026-09-22T0100.om is a 404 under ecmwf_wam025 and a 206 under this one.
    const keys = candidateKeys(T(2026, 9, 22, 13, 40), WIND_MODEL, WIND_STEP_HOURS);
    expect(keys[0]).toBe('data_spatial/ncep_gfs013/2026/09/22/1200Z/2026-09-22T1300.om');
    expect(stepAt(T(2026, 9, 22, 13, 40), 1)).toBe(T(2026, 9, 22, 13));
    // The wave model's own cadence is untouched by that.
    expect(stepAt(T(2026, 9, 22, 13, 40))).toBe(T(2026, 9, 22, 12));
  });

  it('asks the bucket for the hour, not the three-hour boundary', async () => {
    // The builder has to use the wind model's own cadence, not just be able to. At 13:40 the
    // wave model's newest file is T1200 and GFS's is T1300, and asking a model for an hour it
    // does not publish is a 404 for every candidate run.
    const asked = [];
    await buildWindGridFromOm({
      now: T(2026, 9, 22, 13, 40),
      fetch: async (url) => { asked.push(url); return { ok: false, status: 404 }; },
    });
    expect(asked[0]).toContain('/ncep_gfs013/2026/09/22/1200Z/2026-09-22T1300.om');
    for (const url of asked) expect(url).toContain('2026-09-22T1300.om');
  });

  it('returns null rather than throwing when no run is reachable', async () => {
    const out = await buildWindGridFromOm({
      now: T(2026, 9, 22, 12),
      fetch: async () => ({ ok: false, status: 404 }),
    });
    expect(out).toBeNull();
  });

  it('does not cry wolf over a run that has simply not published yet', async () => {
    // A 404 is the ordinary answer for the newest run. Reporting it as a fault would bury the
    // faults that matter in noise every single build.
    const seen = [];
    await buildWindGridFromOm({
      now: T(2026, 9, 22, 12),
      onOmError: (e) => seen.push(e),
      fetch: async () => ({ ok: false, status: 404 }),
    });
    expect(seen).toEqual([]);
  });

  it('does report a bucket that answers with something other than "not yet"', async () => {
    const seen = [];
    await buildWindGridFromOm({
      now: T(2026, 9, 22, 12),
      onOmError: (e) => seen.push(e.status),
      fetch: async () => ({ ok: false, status: 503 }),
    });
    expect(seen).toEqual(Array(MAX_RUNS_BACK).fill(503));
  });

  it('tries every candidate run before giving up', async () => {
    let tried = 0;
    await buildWindGridFromOm({
      now: T(2026, 9, 22, 12),
      fetch: async () => { tried++; return { ok: false, status: 404 }; },
    });
    expect(tried).toBe(MAX_RUNS_BACK);
  });

  it('keeps going when one run throws instead of answering', async () => {
    let calls = 0;
    const out = await buildWindGridFromOm({
      now: T(2026, 9, 22, 12),
      fetch: async () => { calls++; if (calls === 1) throw new Error('socket'); return { ok: false, status: 404 }; },
    });
    expect(calls).toBe(MAX_RUNS_BACK);
    expect(out).toBeNull();
  });

  it('moves on from a file that opens but has no wind in it, and lets go of it', async () => {
    // A model whose file is readable but carries something else. Opening is injected so this
    // exercises the branch itself rather than the reader failing on a stub's empty bytes.
    let closed = 0;
    let opens = 0;
    const out = await buildWindGridFromOm({
      now: T(2026, 9, 22, 12),
      openOm: async () => {
        opens++;
        return { fields: { wave_height: {} }, backend: { close: async () => { closed++; }, requests: 0 } };
      },
    });
    expect(out).toBeNull();
    expect(opens).toBe(MAX_RUNS_BACK);
    // Every window it fetched is released rather than held until the invocation ends.
    expect(closed).toBe(MAX_RUNS_BACK);
  });

  it('builds a grid from the first run that has both components', async () => {
    const plane = (val) => ({ getDimensions: () => [4, 8], read: async () => new Float32Array(32).fill(val) });
    let opens = 0;
    const out = await buildWindGridFromOm({
      now: T(2026, 9, 22, 12),
      step: 20,
      openOm: async (url) => {
        opens++;
        // The newest run has not published; the one before it has.
        if (opens === 1) throw new Error('404');
        return {
          fields: { wind_u_component_10m: plane(3), wind_v_component_10m: plane(4) },
          backend: { close: async () => {}, requests: 3 },
          url,
        };
      },
    });
    expect(out).not.toBeNull();
    expect(out.cells).toBe(gridCellCount(20));
    expect(out.latStep).toBe(20);
    expect(out.coverage).toBe(1);
    expect(out.windCells).toBe(gridCellCount(20));
    // 3 and 4 m/s is 5 m/s is 18 km/h, from the south-west.
    for (const s of out.speeds) expect(s).toBeCloseTo(18, 5);
    for (const d of out.directions) expect(d).toBeCloseTo(216.87, 1);
    // It settled on the second candidate, which is the walk-back doing its job.
    expect(out.source).toContain('/2026/09/22/0600Z/');
    expect(out.source).toContain('ncep_gfs013');
  });
});

describe('the run probe', () => {
  const ok = { ok: true, status: 200, arrayBuffer: async () => new Uint8Array(0).buffer };
  const gone = { ok: false, status: 404 };

  it('names the run a file belongs to', () => {
    expect(runDirOf('data_spatial/ecmwf_wam025/2026/09/22/1800Z/2026-09-22T2100.om'))
      .toBe('data_spatial/ecmwf_wam025/2026/09/22/1800Z');
  });

  // Twelve frames cost thirty-six requests without this and about a dozen with it, measured in
  // the real Worker. A Worker invocation is allowed fifty in total.
  it('stops re-asking a run that has already answered 404', async () => {
    const probe = newRunProbe();
    const asked = [];
    const fetchImpl = async (url) => {
      asked.push(url);
      // Only the oldest run has published anything.
      return url.includes('/0000Z/') ? gone : gone;
    };
    const now = T(2026, 9, 22, 18);
    await fetchFrameFromOm('2026-09-22T18:00', 20, { fetch: fetchImpl, probe, now });
    const first = asked.length;
    expect(first).toBe(MAX_RUNS_BACK);
    asked.length = 0;
    // A later hour: every run is already known not to reach this far.
    await fetchFrameFromOm('2026-09-23T00:00', 20, { fetch: fetchImpl, probe, now });
    expect(asked).toEqual([]);
  });

  it('still walks back normally without one', async () => {
    const asked = [];
    const fetchImpl = async (url) => { asked.push(url); return gone; };
    const now = T(2026, 9, 22, 18);
    await fetchFrameFromOm('2026-09-22T18:00', 20, { fetch: fetchImpl, now });
    await fetchFrameFromOm('2026-09-23T00:00', 20, { fetch: fetchImpl, now });
    expect(asked.length).toBeGreaterThan(MAX_RUNS_BACK);
  });

  it('does not write off a run over a socket failure, which says nothing about publishing', async () => {
    const probe = newRunProbe();
    let calls = 0;
    const fetchImpl = async () => { calls++; throw new Error('socket'); };
    const now = T(2026, 9, 22, 18);
    await fetchFrameFromOm('2026-09-22T18:00', 20, { fetch: fetchImpl, probe, now });
    expect(probe.exhausted.size).toBe(0);
    const before = calls;
    await fetchFrameFromOm('2026-09-23T00:00', 20, { fetch: fetchImpl, probe, now });
    expect(calls).toBeGreaterThan(before);
  });

  it('does not write off a run over a 500 either', async () => {
    const probe = newRunProbe();
    await fetchFrameFromOm('2026-09-22T18:00', 20, { fetch: async () => ({ ok: false, status: 503 }), probe, now: T(2026, 9, 22, 18) });
    expect(probe.exhausted.size).toBe(0);
  });

  it('records only the runs that actually 404ed', async () => {
    const probe = newRunProbe();
    const fetchImpl = async (url) => (url.includes('/1800Z/') ? gone : ok);
    await fetchFrameFromOm('2026-09-22T18:00', 20, { fetch: fetchImpl, probe, now: T(2026, 9, 22, 18) });
    expect([...probe.exhausted].every((d) => d.endsWith('/1800Z'))).toBe(true);
    expect(probe.exhausted.size).toBe(1);
  });
});
