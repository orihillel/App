import { describe, it, expect, vi } from 'vitest';
import { fetchBatch, advanceBuild, loadGrid, GRID_KEY, REFRESH_MS, BATCH_SIZE, MIN_COVERAGE, MAX_REQUESTS } from '../src/waveGrid.js';
import { gridCellCount, base64ToBytes, encodeHeights, bytesToBase64 } from '../../src/lib/wavegrid.js';
import { createFakeKv } from './fakeKv.js';

const NOW = Date.parse('2026-09-05T14:20:00Z');
const HOUR = '2026-09-05T14:00';

// One location's worth of an Open-Meteo marine response.
const loc = (h) => ({ hourly: { time: [HOUR, '2026-09-05T15:00'], wave_height: [h, h + 1] } });
const okRes = (body) => ({ ok: true, json: async () => body });

const env = () => ({ SUBSCRIPTIONS: createFakeKv() });
// Pacing is real in production and pointless in a test; every build here runs with it off.
const INSTANT = { sleep: async () => {}, gapMs: 0 };
const cells = [{ lat: 0, lon: 0 }, { lat: 10, lon: 20 }];

describe('fetchBatch', () => {
  it('asks for every cell in one request and reads the answers positionally', async () => {
    let seen = '';
    const fetchImpl = async (url) => { seen = url; return okRes([loc(1.5), loc(3.2)]); };
    const out = await fetchBatch(cells, { fetchImpl, now: NOW });
    expect(out.values).toEqual([1.5, 3.2]);
    expect(out.ok).toBe(true);
    expect(seen).toContain('latitude=0.00,10.00');
    expect(seen).toContain('longitude=0.00,20.00');
  });

  it('picks the row for the current hour, not just the first one', async () => {
    const fetchImpl = async () => okRes([{ hourly: {
      time: ['2026-09-05T12:00', '2026-09-05T13:00', HOUR], wave_height: [9, 9, 2.4],
    } }]);
    expect((await fetchBatch([cells[0]], { fetchImpl, now: NOW })).values).toEqual([2.4]);
  });

  it('falls back to the first row when the current hour is missing', async () => {
    // Clock skew, or a model run whose series starts later in the day. Better a nearby hour
    // than a hole in the ocean.
    const fetchImpl = async () => okRes([{ hourly: {
      time: ['2026-09-06T02:00'], wave_height: [1.1],
    } }]);
    expect((await fetchBatch([cells[0]], { fetchImpl, now: NOW })).values).toEqual([1.1]);
  });

  it('accepts a bare object as well as an array', async () => {
    // A one-location request answers with an object rather than a list. Rejecting that shape
    // would turn the last, short batch of every build into nulls.
    const fetchImpl = async () => okRes(loc(2.2));
    expect((await fetchBatch([cells[0]], { fetchImpl, now: NOW })).values).toEqual([2.2]);
  });

  it('reads a land point as null, not as calm water', async () => {
    const fetchImpl = async () => okRes([{ hourly: { time: [HOUR], wave_height: [null] } }, loc(2)]);
    expect((await fetchBatch(cells, { fetchImpl, now: NOW })).values).toEqual([null, 2]);
  });

  it('counts an all-land batch as answered, not as failed', async () => {
    // A batch sitting entirely over Antarctica legitimately returns nothing but nulls. Judging
    // failure by non-null values would mark it failed, retry it forever, and leave the build
    // permanently one batch short of ever completing.
    const fetchImpl = async () => okRes(cells.map(() => ({ hourly: { time: [HOUR], wave_height: [null] } })));
    const out = await fetchBatch(cells, { fetchImpl, now: NOW });
    expect(out.values).toEqual([null, null]);
    expect(out.ok).toBe(true);
  });

  it('returns nulls rather than throwing when the request fails', async () => {
    for (const fetchImpl of [
      async () => { throw new Error('network'); },
      async () => ({ ok: false, json: async () => ({}) }),
      async () => ({ ok: true, json: async () => { throw new Error('not json'); } }),
      async () => okRes(null),
      async () => okRes([{ hourly: null }, 'nonsense']),
    ]) {
      const out = await fetchBatch(cells, { fetchImpl, now: NOW });
      expect(out.values).toEqual([null, null]);
      // Reported as failed, which is what makes it eligible for a retry rather than being
      // mistaken for a stretch of ocean with no data.
      expect(out.ok).toBe(false);
    }
  });

  it('reports the status code, so a rate-limited batch is not read as empty ocean', async () => {
    const fetchImpl = async () => ({ ok: false, status: 429, json: async () => ({}) });
    expect((await fetchBatch(cells, { fetchImpl, now: NOW })).status).toBe(429);
  });
});

describe('advanceBuild', () => {
  const allOk = async (url) => {
    const lats = new URL(url).searchParams.get('latitude').split(',');
    return okRes(lats.map((l) => loc(Math.abs(Number(l)) / 10)));
  };

  it('covers every cell in one slice when nothing fails', async () => {
    let calls = 0;
    const fetchImpl = async (url) => { calls++; return allOk(url); };
    const grid = await advanceBuild(env(), { fetchImpl, now: NOW, ...INSTANT });
    expect(grid).not.toBeNull();
    expect(grid.cells).toBe(gridCellCount());
    expect(calls).toBe(Math.ceil(gridCellCount() / BATCH_SIZE));
    expect(grid.coverage).toBe(1);
    // First cell is the -75 row: |-75|/10 = 7.5m -> 75 decimetres.
    expect(base64ToBytes(grid.data)[0]).toBe(75);
  });

  it('saves what it fetched and resumes, instead of restarting from nothing', async () => {
    // The bug this exists for. A single run built the whole grid; if the platform cut it off
    // anywhere before the end, every fetched batch was lost and the next run began again from
    // zero — a build that could never finish, showing as an overlay that never appeared.
    const e = env();
    let calls = 0;
    const fetchImpl = async (url) => { calls++; return allOk(url); };
    // A clock that runs out after three batches, forcing the slice to end early.
    let t = 0;
    const clock = () => { t += 20000; return t; };
    const first = await advanceBuild(e, { fetchImpl, now: NOW, ...INSTANT, clock });
    expect(first).toBeNull();                       // not finished
    const afterFirst = calls;
    expect(afterFirst).toBeGreaterThan(0);
    expect(afterFirst).toBeLessThan(Math.ceil(gridCellCount() / BATCH_SIZE));

    // Next invocation picks up where it stopped rather than refetching from the start.
    const grid = await advanceBuild(e, { fetchImpl, now: NOW, ...INSTANT, ignoreLease: true });
    expect(grid).not.toBeNull();
    expect(calls).toBe(Math.ceil(gridCellCount() / BATCH_SIZE)); // no batch fetched twice
    expect(grid.coverage).toBe(1);
  });

  it('retries a batch that failed, on the next slice', async () => {
    const e = env();
    let failFirst = true;
    const fetchImpl = async (url) => {
      const lats = new URL(url).searchParams.get('latitude').split(',');
      if (failFirst && Number(lats[0]) === -75) throw new Error('rate limited');
      return allOk(url);
    };
    expect(await advanceBuild(e, { fetchImpl, now: NOW, ...INSTANT })).toBeNull();
    failFirst = false;
    const grid = await advanceBuild(e, { fetchImpl, now: NOW, ...INSTANT, ignoreLease: true });
    expect(grid).not.toBeNull();
    expect(base64ToBytes(grid.data)[0]).toBe(75);
  });

  it('stops before exhausting the platform subrequest budget', async () => {
    // Cloudflare's free plan allows 50 subrequests per invocation; walking past that gets the
    // run cut off, which is indistinguishable from the bug being fixed.
    let calls = 0;
    const fetchImpl = async () => { calls++; throw new Error('everything is down'); };
    const out = await advanceBuild(env(), { fetchImpl, now: NOW, ...INSTANT });
    expect(out).toBeNull();
    expect(calls).toBeLessThanOrEqual(MAX_REQUESTS);
  });

  it('paces its requests rather than firing them all at once', async () => {
    const waits = [];
    const fetchImpl = allOk;
    await advanceBuild(env(), { fetchImpl, now: NOW, sleep: async (ms) => { waits.push(ms); } });
    expect(waits.length).toBe(Math.ceil(gridCellCount() / BATCH_SIZE) - 1);
    expect(Math.min(...waits)).toBeGreaterThan(0);
  });

  it('does not start a second builder while one is mid-slice', async () => {
    // Two builders would double the upstream traffic for no gain.
    const e = env();
    let t = 0;
    const clock = () => { t += 20000; return t; };
    const fetchImpl = allOk;
    await advanceBuild(e, { fetchImpl, now: NOW, ...INSTANT, clock });
    let calls = 0;
    const out = await advanceBuild(e, { fetchImpl: async (u) => { calls++; return allOk(u); }, now: NOW, ...INSTANT });
    expect(out).toBeNull();
    expect(calls).toBe(0);
  });

  it('reports the coverage it achieved, so half a world is visible as a number', async () => {
    const fetchImpl = async (url) => {
      const lats = new URL(url).searchParams.get('latitude').split(',');
      // Land everywhere north of the equator.
      return okRes(lats.map((l) => (Number(l) > 0 ? { hourly: { time: [HOUR], wave_height: [null] } } : loc(2))));
    };
    const grid = await advanceBuild(env(), { fetchImpl, now: NOW, ...INSTANT });
    expect(grid.coverage).toBeGreaterThan(0.4);
    expect(grid.coverage).toBeLessThan(0.65);
  });
});

describe('loadGrid', () => {
  const good = { generatedAt: NOW, cells: gridCellCount(), data: bytesToBase64(encodeHeights(new Array(gridCellCount()).fill(2))) };

  it('builds and caches when there is nothing stored', async () => {
    const e = env();
    const build = vi.fn(async () => good);
    const out = await loadGrid(e, { build, now: NOW });
    expect(out.stale).toBe(false);
    expect(build).toHaveBeenCalledTimes(1);
    expect(JSON.parse(await e.SUBSCRIPTIONS.get(GRID_KEY)).data).toBe(good.data);
  });

  it('serves the cache without refetching inside the model cadence', async () => {
    const e = env();
    await e.SUBSCRIPTIONS.put(GRID_KEY, JSON.stringify(good));
    const build = vi.fn(async () => good);
    const out = await loadGrid(e, { build, now: NOW + REFRESH_MS - 1000 });
    expect(build).not.toHaveBeenCalled();
    expect(out.stale).toBe(false);
  });

  it('refetches once the cache is older than the model cadence', async () => {
    const e = env();
    await e.SUBSCRIPTIONS.put(GRID_KEY, JSON.stringify(good));
    const build = vi.fn(async () => ({ ...good, generatedAt: NOW + REFRESH_MS + 1 }));
    await loadGrid(e, { build, now: NOW + REFRESH_MS + 1 });
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('keeps the old grid, marked stale, when a refresh fails', async () => {
    // A six-hour-old wave field still describes the ocean. Blanking the overlay because one
    // fetch failed would be a worse answer than a slightly old one.
    const e = env();
    await e.SUBSCRIPTIONS.put(GRID_KEY, JSON.stringify(good));
    const out = await loadGrid(e, {
      build: async () => { throw new Error('upstream down'); },
      now: NOW + REFRESH_MS + 1,
    });
    expect(out.data).toBe(good.data);
    expect(out.stale).toBe(true);
  });

  it('refuses a half-fetched grid, not just an empty one', async () => {
    // The shipped bug: this was checked only against *entirely* empty, so a grid missing
    // everything north of the equator was cached and served for six hours as a map. Half a
    // world of data reads as "the north is flat", which is worse than no overlay at all.
    const e = env();
    await e.SUBSCRIPTIONS.put(GRID_KEY, JSON.stringify(good));
    const half = { generatedAt: NOW, cells: gridCellCount(), coverage: 0.52, data: good.data };
    const out = await loadGrid(e, { build: async () => half, now: NOW + REFRESH_MS + 1 });
    expect(out.data).toBe(good.data);
    expect(out.stale).toBe(true);
    expect(MIN_COVERAGE).toBeGreaterThan(0.52);
  });

  it('discards a half-fetched grid already sitting in the cache', async () => {
    // The bad grid is in KV right now; it has to be rejected on read rather than served until
    // it ages out six hours later.
    const e = env();
    await e.SUBSCRIPTIONS.put(GRID_KEY, JSON.stringify({ ...good, coverage: 0.5 }));
    const build = vi.fn(async () => good);
    const out = await loadGrid(e, { build, now: NOW });
    expect(build).toHaveBeenCalledTimes(1); // refetched rather than trusted
    expect(out.stale).toBe(false);
  });

  it('judges a grid cached before coverage was recorded by its own bytes', async () => {
    const e = env();
    const heights = new Array(gridCellCount()).fill(null).map((_, i) => (i < gridCellCount() / 2 ? 2 : null));
    await e.SUBSCRIPTIONS.put(GRID_KEY, JSON.stringify({
      generatedAt: NOW, cells: gridCellCount(), data: bytesToBase64(encodeHeights(heights)),
    }));
    const build = vi.fn(async () => good);
    await loadGrid(e, { build, now: NOW });
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('treats an all-null build as a failure, not as a flat calm ocean', async () => {
    // The dangerous case: upstream answers 200 with nothing usable. Storing that would paint
    // every sea on Earth as dead flat, which looks like data rather than like a fault.
    const e = env();
    await e.SUBSCRIPTIONS.put(GRID_KEY, JSON.stringify(good));
    const empty = { generatedAt: NOW, cells: gridCellCount(), data: bytesToBase64(encodeHeights(new Array(gridCellCount()).fill(null))) };
    const out = await loadGrid(e, { build: async () => empty, now: NOW + REFRESH_MS + 1 });
    expect(out.data).toBe(good.data);
    expect(out.stale).toBe(true);
  });

  it('never builds inside a request, since a build is paced over minutes', async () => {
    // Building in the request path would hang the user's fetch for the length of the build.
    const e = env();
    const build = vi.fn(async () => good);
    const out = await loadGrid(e, { build, now: NOW, mayBuild: false });
    expect(build).not.toHaveBeenCalled();
    expect(out).toBeNull();
  });

  it('serves a stale cache to a request rather than rebuilding for it', async () => {
    const e = env();
    await e.SUBSCRIPTIONS.put(GRID_KEY, JSON.stringify(good));
    const build = vi.fn(async () => good);
    const out = await loadGrid(e, { build, now: NOW + REFRESH_MS + 1, mayBuild: false });
    expect(build).not.toHaveBeenCalled();
    expect(out.data).toBe(good.data);
    expect(out.stale).toBe(true);
  });

  it('returns null when there is no cache and the build fails', async () => {
    const out = await loadGrid(env(), { build: async () => { throw new Error('down'); }, now: NOW });
    expect(out).toBeNull();
  });

  it('ignores a cached grid whose size no longer matches the current grid', async () => {
    // The grid definition changing is exactly when stale bytes would be misread as a different
    // patch of ocean. The cell count is the guard.
    const e = env();
    await e.SUBSCRIPTIONS.put(GRID_KEY, JSON.stringify({ ...good, cells: 7 }));
    const build = vi.fn(async () => good);
    await loadGrid(e, { build, now: NOW });
    expect(build).toHaveBeenCalledTimes(1);
  });
});
