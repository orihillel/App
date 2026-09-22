import { describe, it, expect } from 'vitest';
import {
  fetchWindBatch, buildWindGrid, loadWindGrid,
  WIND_KEY, REFRESH_MS, MIN_COVERAGE, FAIL_KEY, FAIL_COOLDOWN_MS, WIND_LAT_STEP } from '../src/windGrid.js';
import { gridCellCount, base64ToBytes, decodeSpeeds, decodeDirections } from '../../src/lib/wavegrid.js';
import { createFakeKv } from './fakeKv.js';

const NOW = Date.parse('2026-09-05T14:20:00Z');
const HOUR = '2026-09-05T14:00';

// One location's worth of an Open-Meteo forecast response, in each shape it can arrive in.
const cur = (kph, dir = 270) => ({ current: { time: HOUR, wind_speed_10m: kph, wind_direction_10m: dir } });
const hourly = (kph, dir = 270) => ({
  hourly: {
    time: [HOUR, '2026-09-05T15:00'],
    wind_speed_10m: [kph, kph + 5],
    wind_direction_10m: [dir, dir],
  },
});
const okRes = (body) => ({ ok: true, status: 200, json: async () => body });

const env = () => ({ SUBSCRIPTIONS: createFakeKv() });
const INSTANT = { sleep: async () => {}, gapMs: 0 };
const cells = [{ lat: 0, lon: 0 }, { lat: 10, lon: 20 }];

describe('fetchWindBatch', () => {
  it('asks the forecast endpoint, not the marine one', async () => {
    // Wind is not on marine-api. Sending this to the wrong host does not throw, it 400s, and
    // the overlay just never appears.
    let seen = '';
    const fetchImpl = async (url) => { seen = url; return okRes([cur(20), cur(30)]); };
    await fetchWindBatch(cells, { fetchImpl, now: NOW });
    expect(seen).toContain('api.open-meteo.com/v1/forecast');
    expect(seen).not.toContain('marine-api');
  });

  it('asks for one value a cell, not a day of them', async () => {
    // The lesson the wave grid paid for: `hourly` returns 24 values per location and bills for
    // all 24. One pass of this grid is 406 units that way and 9,744 the other.
    let seen = '';
    const fetchImpl = async (url) => { seen = url; return okRes([cur(20), cur(30)]); };
    await fetchWindBatch(cells, { fetchImpl, now: NOW });
    expect(seen).toContain('current=wind_speed_10m,wind_direction_10m');
    expect(seen).not.toContain('hourly=');
  });

  it('asks for every cell in one request and reads the answers positionally', async () => {
    let seen = '';
    const fetchImpl = async (url) => { seen = url; return okRes([cur(11, 90), cur(44, 180)]); };
    const out = await fetchWindBatch(cells, { fetchImpl, now: NOW });
    expect(out.values).toEqual([11, 44]);
    expect(out.directions).toEqual([90, 180]);
    expect(out.ok).toBe(true);
    expect(seen).toContain('latitude=0.00,10.00');
    expect(seen).toContain('longitude=0.00,20.00');
  });

  it('accepts a bare object, so a one-cell batch is not a grid of nulls', async () => {
    const fetchImpl = async () => okRes(cur(17));
    const out = await fetchWindBatch([{ lat: 0, lon: 0 }], { fetchImpl, now: NOW });
    expect(out.values).toEqual([17]);
  });

  it('falls back to the hourly series when current is refused outright', async () => {
    let call = 0;
    const fetchImpl = async () => {
      call++;
      if (call === 1) return { ok: false, status: 400, json: async () => ({ reason: 'no current' }) };
      return okRes([hourly(21), hourly(9)]);
    };
    const out = await fetchWindBatch(cells, { fetchImpl, now: NOW });
    expect(out.ok).toBe(true);
    expect(out.values).toEqual([21, 9]);
  });

  it('does not spend a second request on a rate limit', async () => {
    // A 429 answered by more traffic is the failure mode that made this a cooldown, not a retry.
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      return { ok: false, status: 429, json: async () => ({ reason: 'Minutely API request limit exceeded' }) };
    };
    const out = await fetchWindBatch(cells, { fetchImpl, now: NOW });
    expect(calls).toBe(1);
    expect(out.ok).toBe(false);
    expect(out.status).toBe(429);
    expect(out.error).toContain('limit exceeded');
  });

  it('carries the upstream reason back rather than only that it failed', async () => {
    const fetchImpl = async () => ({ ok: false, status: 400, json: async () => ({ reason: 'cannot initialize' }) });
    const out = await fetchWindBatch(cells, { fetchImpl, now: NOW });
    expect(out.error).toContain('cannot initialize');
    expect(out.status).toBe(400);
  });

  it('never throws when the host is unreachable', async () => {
    const fetchImpl = async () => { throw new Error('getaddrinfo ENOTFOUND'); };
    const out = await fetchWindBatch(cells, { fetchImpl, now: NOW });
    expect(out.ok).toBe(false);
    expect(out.error).toContain('ENOTFOUND');
    expect(out.values).toEqual([null, null]);
  });
});

describe('buildWindGrid', () => {
  it('fills the whole grid and reports full coverage', async () => {
    const fetchImpl = async (url) => {
      const n = url.split('latitude=')[1].split('&')[0].split(',').length;
      return okRes(Array.from({ length: n }, () => cur(30, 270)));
    };
    const out = await buildWindGrid({ fetchImpl, now: NOW, ...INSTANT });
    expect(out.cells).toBe(gridCellCount(WIND_LAT_STEP));
    expect(out.coverage).toBe(1);
    expect(out.batchesDone).toBe(out.batchesTotal);
    const speeds = decodeSpeeds(base64ToBytes(out.data));
    expect(speeds.length).toBe(gridCellCount(WIND_LAT_STEP));
    expect(speeds.every((v) => v === 30)).toBe(true);
  });

  it('stores the directions alongside the speeds', async () => {
    const fetchImpl = async (url) => {
      const n = url.split('latitude=')[1].split('&')[0].split(',').length;
      return okRes(Array.from({ length: n }, () => cur(12, 90)));
    };
    const out = await buildWindGrid({ fetchImpl, now: NOW, ...INSTANT });
    const dirs = decodeDirections(base64ToBytes(out.dirs));
    expect(dirs.every((d) => d != null && Math.abs(d - 90) < 2)).toBe(true);
  });

  it('keeps the failure that explains a gap, not the last status of any kind', async () => {
    // A later good batch overwriting the 429 is the diagnostic erasing itself.
    let call = 0;
    const fetchImpl = async (url) => {
      call++;
      if (call === 1) return { ok: false, status: 429, json: async () => ({ reason: 'rate limited' }) };
      const n = url.split('latitude=')[1].split('&')[0].split(',').length;
      return okRes(Array.from({ length: n }, () => cur(20)));
    };
    const out = await buildWindGrid({ fetchImpl, now: NOW, ...INSTANT });
    expect(out.lastStatus).toBe(429);
    expect(out.batchesDone).toBe(out.batchesTotal - 1);
    expect(out.coverage).toBeLessThan(1);
  });
});

describe('loadWindGrid', () => {
  const fullBuild = (over = {}) => async (opts) => ({
    generatedAt: opts.now,
    cells: gridCellCount(WIND_LAT_STEP),
    data: 'AAA',
    dirs: 'BBB',
    coverage: 1,
    batchesDone: 5,
    batchesTotal: 5,
    lastStatus: null,
    lastError: null,
    ...over,
  });

  it('builds, caches and serves a fresh grid', async () => {
    const e = env();
    const { grid } = await loadWindGrid(e, { now: NOW, build: fullBuild() });
    expect(grid.data).toBe('AAA');
    expect(grid.stale).toBe(false);
    expect(await e.SUBSCRIPTIONS.get(WIND_KEY, { type: 'json' })).toBeTruthy();
  });

  it('serves the cache without rebuilding until it is an hour old', async () => {
    // Wind is re-forecast hourly. Six hours, the swell cadence, would be a different kind of
    // wrong here -- the sea breeze that ruins a session comes and goes inside that window.
    const e = env();
    let builds = 0;
    const build = async (opts) => { builds++; return fullBuild()(opts); };
    await loadWindGrid(e, { now: NOW, build });
    await loadWindGrid(e, { now: NOW + REFRESH_MS - 1000, build });
    expect(builds).toBe(1);
    await loadWindGrid(e, { now: NOW + REFRESH_MS + 1000, build });
    expect(builds).toBe(2);
  });

  it('rebuilds a cached grid that has speeds but no directions', async () => {
    const e = env();
    await e.SUBSCRIPTIONS.put(WIND_KEY, JSON.stringify({
      generatedAt: NOW, cells: gridCellCount(WIND_LAT_STEP), data: 'OLD', coverage: 1,
    }));
    const { grid } = await loadWindGrid(e, { now: NOW + 1000, build: fullBuild() });
    expect(grid.data).toBe('AAA');
    expect(grid.dirs).toBe('BBB');
  });

  it('refuses a build that reached too little of the world', async () => {
    const e = env();
    const { grid, build } = await loadWindGrid(e, {
      now: NOW, build: fullBuild({ coverage: MIN_COVERAGE - 0.1 }),
    });
    // Half a world of wind reads as "the rest of the ocean is calm", which is a worse lie than
    // showing nothing.
    expect(grid).toBeNull();
    expect(build.coverage).toBeLessThan(MIN_COVERAGE);
  });

  it('stops asking for a while after a failure', async () => {
    const e = env();
    let builds = 0;
    const failing = async (opts) => { builds++; return fullBuild({ coverage: 0 })(opts); };
    await loadWindGrid(e, { now: NOW, build: failing });
    expect(builds).toBe(1);
    const { build } = await loadWindGrid(e, { now: NOW + 1000, build: failing });
    expect(builds).toBe(1);
    expect(build.cooling).toBe(true);
    expect(build.retryInSeconds).toBeGreaterThan(0);
    await loadWindGrid(e, { now: NOW + FAIL_COOLDOWN_MS + 1000, build: failing });
    expect(builds).toBe(2);
    expect(await e.SUBSCRIPTIONS.get(FAIL_KEY, { type: 'json' })).toBeTruthy();
  });

  it('serves an old complete grid rather than nothing when a rebuild fails', async () => {
    const e = env();
    await e.SUBSCRIPTIONS.put(WIND_KEY, JSON.stringify({
      generatedAt: NOW - REFRESH_MS * 5, cells: gridCellCount(WIND_LAT_STEP), data: 'OLD', dirs: 'OLDDIR', coverage: 1,
    }));
    const { grid } = await loadWindGrid(e, { now: NOW, build: fullBuild({ coverage: 0 }) });
    expect(grid.data).toBe('OLD');
    expect(grid.stale).toBe(true);
  });

  it('reports rather than throws when a build blows up', async () => {
    const e = env();
    const { grid, build } = await loadWindGrid(e, {
      now: NOW, build: async () => { throw new Error('boom'); },
    });
    expect(grid).toBeNull();
    expect(build.lastError).toContain('boom');
  });

  it('does not serve a grid built for a different number of cells', async () => {
    // The grid definition is the addressing scheme. A grid of the wrong size does not throw,
    // it paints one ocean's wind onto another.
    const e = env();
    await e.SUBSCRIPTIONS.put(WIND_KEY, JSON.stringify({
      generatedAt: NOW, cells: gridCellCount(WIND_LAT_STEP) + 7, data: 'OLD', dirs: 'D', coverage: 1,
    }));
    const { grid } = await loadWindGrid(e, { now: NOW + 1000, build: fullBuild() });
    expect(grid.data).toBe('AAA');
  });
});
