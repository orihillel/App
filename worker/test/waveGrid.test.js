import { describe, it, expect, vi } from 'vitest';
import { fetchBatch, buildGrid, loadGrid, GRID_KEY, REFRESH_MS, BATCH_SIZE, MIN_COVERAGE, FAIL_KEY, FAIL_COOLDOWN_MS } from '../src/waveGrid.js';
import { gridCells, gridCellCount, base64ToBytes, decodeDirections, encodeHeights, encodeDirections, bytesToBase64 } from '../../src/lib/wavegrid.js';
import { createFakeKv } from './fakeKv.js';

const NOW = Date.parse('2026-09-05T14:20:00Z');
const HOUR = '2026-09-05T14:00';

// One location's worth of an Open-Meteo marine response, in each shape.
const cur = (h, dir = 225) => ({ current: { time: HOUR, wave_height: h, wave_direction: dir } });
const loc = (h, dir = 225) => ({
  hourly: {
    time: [HOUR, '2026-09-05T15:00'], wave_height: [h, h + 1], wave_direction: [dir, dir],
  },
});
const okRes = (body) => ({ ok: true, status: 200, json: async () => body });

const env = () => ({ SUBSCRIPTIONS: createFakeKv() });
// The courtesy pause is real in production and pointless in a test.
const INSTANT = { sleep: async () => {}, gapMs: 0 };
const cells = [{ lat: 0, lon: 0 }, { lat: 10, lon: 20 }];

describe('fetchBatch', () => {
  it('asks for every cell in one request and reads the answers positionally', async () => {
    let seen = '';
    const fetchImpl = async (url) => { seen = url; return okRes([cur(1.5), cur(3.2)]); };
    const out = await fetchBatch(cells, { fetchImpl, now: NOW });
    expect(out.values).toEqual([1.5, 3.2]);
    expect(out.ok).toBe(true);
    expect(seen).toContain('latitude=0.00,10.00');
    expect(seen).toContain('longitude=0.00,20.00');
  });

  it('asks only for the current reading, not a day of hourly values', async () => {
    // The bug that produced "Fetched 2 of 5 batches · HTTP 429". The overlay needs one number
    // per cell; requesting an hourly series returned 24 and discarded 23, costing 24x the
    // allowance and exhausting the per-minute budget two batches into a five-batch grid.
    let seen = '';
    const fetchImpl = async (url) => { seen = url; return okRes([cur(1), cur(1)]); };
    await fetchBatch(cells, { fetchImpl, now: NOW });
    expect(seen).toContain('current=wave_height');
    expect(seen).not.toContain('hourly=');
    expect(seen).not.toContain('forecast_days');
  });

  it('falls back to the hourly series if current is refused', async () => {
    // Only on a non-rate-limit 4xx: if this deployment's marine endpoint has no `current`, a
    // costlier working overlay beats a cheap empty one.
    const seen = [];
    const fetchImpl = async (url) => {
      seen.push(url);
      if (url.includes('current=')) return { ok: false, status: 400, json: async () => ({ reason: 'no current' }) };
      return okRes([loc(2), loc(3)]);
    };
    const out = await fetchBatch(cells, { fetchImpl, now: NOW });
    expect(out.values).toEqual([2, 3]);
    expect(seen).toHaveLength(2);
  });

  it('does not burn a second request when the first was rate-limited', async () => {
    // Retrying a 429 with an even more expensive request is the worst possible response to it.
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      return { ok: false, status: 429, json: async () => ({ reason: 'Minutely API request limit exceeded' }) };
    };
    const out = await fetchBatch(cells, { fetchImpl, now: NOW });
    expect(calls).toBe(1);
    expect(out.status).toBe(429);
    expect(out.error).toContain('Minutely');
  });

  it('picks the row for the current hour, not just the first one', async () => {
    const fetchImpl = async () => okRes([{ hourly: {
      time: ['2026-09-05T12:00', '2026-09-05T13:00', HOUR], wave_height: [9, 9, 2.4],
    } }]);
    expect((await fetchBatch([cells[0]], { fetchImpl, now: NOW })).values).toEqual([2.4]);
  });

  it('falls back to the first row when the current hour is missing', async () => {
    const fetchImpl = async () => okRes([{ hourly: { time: ['2026-09-06T02:00'], wave_height: [1.1] } }]);
    expect((await fetchBatch([cells[0]], { fetchImpl, now: NOW })).values).toEqual([1.1]);
  });

  it('accepts a bare object as well as an array', async () => {
    const fetchImpl = async () => okRes(cur(2.2));
    expect((await fetchBatch([cells[0]], { fetchImpl, now: NOW })).values).toEqual([2.2]);
  });

  it('reads a land point as null, not as calm water', async () => {
    const fetchImpl = async () => okRes([{ current: { time: HOUR, wave_height: null } }, cur(2)]);
    expect((await fetchBatch(cells, { fetchImpl, now: NOW })).values).toEqual([null, 2]);
  });

  it('counts an all-land batch as answered, not as failed', async () => {
    // A batch sitting entirely over Antarctica legitimately returns nothing but nulls. Judging
    // success by non-null values would mark it failed and retry it forever.
    const fetchImpl = async () => okRes(cells.map(() => ({ current: { time: HOUR, wave_height: null } })));
    const out = await fetchBatch(cells, { fetchImpl, now: NOW });
    expect(out.values).toEqual([null, null]);
    expect(out.ok).toBe(true);
  });

  it('reports the status code rather than only failing', async () => {
    const fetchImpl = async () => ({ ok: false, status: 429, json: async () => ({}) });
    const out = await fetchBatch(cells, { fetchImpl, now: NOW });
    expect(out.ok).toBe(false);
    expect(out.status).toBe(429);
  });

  it("surfaces the upstream's own reason for a rejection", async () => {
    // The sentence that would have ended this days earlier. Open-Meteo puts the cause in the
    // body on a 4xx, and a bare "it failed" is what left four fixes guessing.
    const fetchImpl = async () => ({
      ok: false, status: 400, json: async () => ({ reason: 'latitude must be a number' }),
    });
    const out = await fetchBatch(cells, { fetchImpl, now: NOW });
    expect(out.error).toBe('latitude must be a number');
    expect(out.status).toBe(400);
  });

  it('reports a network failure as an error rather than throwing', async () => {
    const fetchImpl = async () => { throw new Error('connect ECONNREFUSED'); };
    const out = await fetchBatch(cells, { fetchImpl, now: NOW });
    expect(out.ok).toBe(false);
    expect(out.error).toContain('ECONNREFUSED');
  });

  it('returns nulls rather than throwing on any unreadable answer', async () => {
    for (const fetchImpl of [
      async () => ({ ok: true, status: 200, json: async () => { throw new Error('not json'); } }),
      async () => okRes(null),
      async () => okRes([{ hourly: null }, 'nonsense']),
    ]) {
      const out = await fetchBatch(cells, { fetchImpl, now: NOW });
      expect(out.values).toEqual([null, null]);
      expect(out.ok).toBe(false);
      expect(out.error).toBeTruthy();
    }
  });
});

describe('buildGrid', () => {
  const allOk = async (url) => {
    const lats = new URL(url).searchParams.get('latitude').split(',');
    return okRes(lats.map((l) => cur(Math.abs(Number(l)) / 10)));
  };

  it('covers every cell in one pass', async () => {
    // The whole point of shrinking the grid: no slices, no background work, one call.
    let calls = 0;
    const fetchImpl = async (url) => { calls++; return allOk(url); };
    const grid = await buildGrid({ fetchImpl, now: NOW, ...INSTANT });
    expect(calls).toBe(Math.ceil(gridCellCount() / BATCH_SIZE));
    expect(grid.cells).toBe(gridCellCount());
    expect(grid.coverage).toBe(1);
    expect(grid.batchesDone).toBe(grid.batchesTotal);
    // First cell is the -75 row: |-75|/10 = 7.5m -> 75 decimetres.
    expect(base64ToBytes(grid.data)[0]).toBe(75);
  });

  it('keeps going when one batch fails, and says so', async () => {
    const fetchImpl = async (url) => {
      const lats = new URL(url).searchParams.get('latitude').split(',');
      if (Number(lats[0]) === -75) return { ok: false, status: 429, json: async () => ({ reason: 'slow down' }) };
      return allOk(url);
    };
    const grid = await buildGrid({ fetchImpl, now: NOW, ...INSTANT });
    expect(grid.batchesDone).toBe(grid.batchesTotal - 1);
    expect(grid.lastStatus).toBe(429);
    expect(grid.lastError).toBe('slow down');
    expect(grid.coverage).toBeLessThan(1);
  });

  it('counts a batch of land as covered, because land is not a missing answer', async () => {
    // The bug that produced "Fetched 5 of 5 batches" and still no map. Coverage was measured as
    // non-null values, so every land cell read as a failure. Roughly an eighth of the grid is
    // land even by a coarse coastline — finer than that, Open-Meteo also returns nothing for
    // enclosed seas and shallow coastal cells — so a flawless build scored about 0.85 against a
    // 0.85 threshold and the gate could never pass however well the fetch worked.
    const fetchImpl = async (url) => {
      const lats = new URL(url).searchParams.get('latitude').split(',');
      // Two thirds of the world is dry in this fake, far worse than reality.
      return okRes(lats.map((l, i) => (i % 3 === 0 ? cur(2) : { current: { time: HOUR, wave_height: null } })));
    };
    const grid = await buildGrid({ fetchImpl, now: NOW, ...INSTANT });
    expect(grid.batchesDone).toBe(grid.batchesTotal);
    expect(grid.coverage).toBe(1);                 // every cell was successfully queried
    expect(grid.oceanCells).toBeLessThan(grid.cells / 2); // and most of them were land
    expect(grid.coverage).toBeGreaterThanOrEqual(MIN_COVERAGE);
  });

  it('drops coverage only when a batch genuinely fails', async () => {
    const fetchImpl = async (url) => {
      const lats = new URL(url).searchParams.get('latitude').split(',');
      if (Number(lats[0]) === -75) return { ok: false, status: 500, json: async () => ({}) };
      return allOk(url);
    };
    const grid = await buildGrid({ fetchImpl, now: NOW, ...INSTANT });
    expect(grid.coverage).toBeLessThan(1);
    expect(grid.coverage).toBeGreaterThan(0.7);
  });

  it('reports a total failure without throwing', async () => {
    const fetchImpl = async () => { throw new Error('upstream unreachable'); };
    const grid = await buildGrid({ fetchImpl, now: NOW, ...INSTANT });
    expect(grid.batchesDone).toBe(0);
    expect(grid.coverage).toBe(0);
    expect(grid.lastError).toContain('unreachable');
  });
});

describe('loadGrid', () => {
  // A complete grid carries directions as well as heights — see isUsable: an entry without them
  // predates the arrows and is rebuilt rather than served.
  const good = {
    generatedAt: NOW, cells: gridCellCount(), coverage: 1,
    data: bytesToBase64(encodeHeights(new Array(gridCellCount()).fill(2))),
    dirs: bytesToBase64(encodeDirections(new Array(gridCellCount()).fill(225))),
  };

  it('builds and caches when there is nothing stored', async () => {
    const e = env();
    const build = vi.fn(async () => good);
    const out = await loadGrid(e, { build, now: NOW });
    expect(out.grid.stale).toBe(false);
    expect(build).toHaveBeenCalledTimes(1);
    expect(JSON.parse(await e.SUBSCRIPTIONS.get(GRID_KEY)).data).toBe(good.data);
  });

  it('serves the cache without rebuilding inside the model cadence', async () => {
    const e = env();
    await e.SUBSCRIPTIONS.put(GRID_KEY, JSON.stringify(good));
    const build = vi.fn(async () => good);
    const out = await loadGrid(e, { build, now: NOW + REFRESH_MS - 1000 });
    expect(build).not.toHaveBeenCalled();
    expect(out.grid.stale).toBe(false);
  });

  it('rebuilds once the cache is older than the model cadence', async () => {
    const e = env();
    await e.SUBSCRIPTIONS.put(GRID_KEY, JSON.stringify(good));
    const build = vi.fn(async () => ({ ...good, generatedAt: NOW + REFRESH_MS + 1 }));
    await loadGrid(e, { build, now: NOW + REFRESH_MS + 1 });
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('keeps the old grid, marked stale, when a rebuild fails', async () => {
    const e = env();
    await e.SUBSCRIPTIONS.put(GRID_KEY, JSON.stringify(good));
    const out = await loadGrid(e, {
      build: async () => { throw new Error('upstream down'); },
      now: NOW + REFRESH_MS + 1,
    });
    expect(out.grid.data).toBe(good.data);
    expect(out.grid.stale).toBe(true);
    expect(out.build.lastError).toContain('upstream down');
  });

  it('refuses a half-fetched grid, keeping the complete older one', async () => {
    const e = env();
    await e.SUBSCRIPTIONS.put(GRID_KEY, JSON.stringify(good));
    const half = { generatedAt: NOW, cells: gridCellCount(), coverage: 0.52, data: good.data, dirs: good.dirs };
    const out = await loadGrid(e, { build: async () => half, now: NOW + REFRESH_MS + 1 });
    expect(out.grid.data).toBe(good.data);
    expect(out.grid.stale).toBe(true);
    expect(MIN_COVERAGE).toBeGreaterThan(0.52);
  });

  it('discards a half-fetched grid already sitting in the cache', async () => {
    const e = env();
    await e.SUBSCRIPTIONS.put(GRID_KEY, JSON.stringify({ ...good, coverage: 0.5 }));
    const build = vi.fn(async () => good);
    const out = await loadGrid(e, { build, now: NOW });
    expect(build).toHaveBeenCalledTimes(1);
    expect(out.grid.stale).toBe(false);
  });

  it('accepts a build where most of the world is land', async () => {
    // The end-to-end version of the same bug: five good batches must produce a stored map.
    const e = env();
    const mostlyLand = {
      generatedAt: NOW, cells: gridCellCount(), coverage: 1, oceanCells: 40,
      data: bytesToBase64(encodeHeights(gridCells().map((_, i) => (i % 10 === 0 ? 2 : null)))),
      dirs: bytesToBase64(encodeDirections(gridCells().map((_, i) => (i % 10 === 0 ? 200 : null)))),
    };
    const out = await loadGrid(e, { build: async () => mostlyLand, now: NOW });
    expect(out.grid).not.toBeNull();
    expect(out.grid.stale).toBe(false);
    expect(JSON.parse(await e.SUBSCRIPTIONS.get(GRID_KEY)).coverage).toBe(1);
  });

  it('ignores a cached grid whose size no longer matches the current grid', async () => {
    const e = env();
    await e.SUBSCRIPTIONS.put(GRID_KEY, JSON.stringify({ ...good, cells: 7 }));
    const build = vi.fn(async () => good);
    await loadGrid(e, { build, now: NOW });
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('does not retry into a quota it just exhausted', async () => {
    // Every tap of the overlay toggle used to fire five more upstream requests, and a failure
    // is exactly when they are least affordable. A daily quota, once spent, cannot recover
    // until it resets — retrying into it only keeps it spent.
    const e = env();
    const build = vi.fn(async () => ({
      batchesDone: 0, batchesTotal: 5, coverage: 0, lastStatus: 429, lastError: 'Daily API request limit exceeded',
    }));
    await loadGrid(e, { build, now: NOW });
    expect(build).toHaveBeenCalledTimes(1);

    const again = await loadGrid(e, { build, now: NOW + 60000 });
    expect(build).toHaveBeenCalledTimes(1); // no second attempt
    expect(again.build.cooling).toBe(true);
    expect(again.build.lastError).toContain('Daily');
    expect(again.build.retryInSeconds).toBeGreaterThan(0);
  });

  it('tries again once the cooldown has passed', async () => {
    const e = env();
    const build = vi.fn(async () => ({ batchesDone: 0, batchesTotal: 5, coverage: 0, lastStatus: 429 }));
    await loadGrid(e, { build, now: NOW });
    await loadGrid(e, { build, now: NOW + FAIL_COOLDOWN_MS + 1000 });
    expect(build).toHaveBeenCalledTimes(2);
  });

  it('clears the cooldown after a build succeeds', async () => {
    const e = env();
    await e.SUBSCRIPTIONS.put(FAIL_KEY, JSON.stringify({ at: NOW - FAIL_COOLDOWN_MS - 1, build: {} }));
    await loadGrid(e, { build: async () => good, now: NOW });
    expect(await e.SUBSCRIPTIONS.get(FAIL_KEY)).toBeNull();
  });

  it('still serves a cached grid while cooling down', async () => {
    // A rate limit must not hide a map that already exists.
    const e = env();
    await e.SUBSCRIPTIONS.put(GRID_KEY, JSON.stringify(good));
    const build = vi.fn(async () => ({ batchesDone: 0, batchesTotal: 5, coverage: 0, lastStatus: 429 }));
    await loadGrid(e, { build, now: NOW + REFRESH_MS + 1 });
    const out = await loadGrid(e, { build, now: NOW + REFRESH_MS + 2000 });
    expect(out.grid.data).toBe(good.data);
    expect(out.build.cooling).toBe(true);
  });

  it('returns diagnostics, not just null, when there is nothing to draw', async () => {
    // The failure that cost four rounds: "it does not work" with nothing to act on. A caller
    // must always be able to see how far the build got and what upstream said.
    const out = await loadGrid(env(), {
      build: async () => ({ batchesDone: 0, batchesTotal: 5, coverage: 0, lastStatus: 400, lastError: 'bad request' }),
      now: NOW,
    });
    expect(out.grid).toBeNull();
    expect(out.build).toEqual({
      batchesDone: 0, batchesTotal: 5, coverage: 0, lastStatus: 400, lastError: 'bad request',
    });
  });
});

describe('wave direction', () => {
  it('asks for direction in the same request as height, not a second pass', () => {
    // One more value a cell against a second trip over the whole grid — and the grid's whole
    // design is that it fits in one pass of the rate limit.
    let seen = '';
    const fetchImpl = async (url) => { seen = url; return okRes([cur(1), cur(1)]); };
    return fetchBatch(cells, { fetchImpl, now: NOW }).then(() => {
      expect(seen).toContain('current=wave_height,wave_direction');
    });
  });

  it('reads directions positionally, like the heights beside them', async () => {
    const fetchImpl = async () => okRes([cur(1.5, 300), cur(3.2, 45)]);
    const out = await fetchBatch(cells, { fetchImpl, now: NOW });
    expect(out.directions).toEqual([300, 45]);
  });

  it('reads them from the hourly fallback too', async () => {
    const fetchImpl = async () => okRes([loc(2, 190), loc(3, 20)]);
    const out = await fetchBatch(cells, { fetchImpl, now: NOW });
    expect(out.directions).toEqual([190, 20]);
  });

  it('gives a direction of null where the model has none, rather than north', async () => {
    const fetchImpl = async () => okRes([{ current: { time: HOUR, wave_height: 1.5 } }, cur(2, 100)]);
    const out = await fetchBatch(cells, { fetchImpl, now: NOW });
    expect(out.directions[0]).toBeNull();
    expect(out.values[0]).toBe(1.5); // the height is still good
    expect(out.directions[1]).toBe(100);
  });

  it('carries a direction for every cell a failed batch would have covered', async () => {
    const fetchImpl = async () => ({ ok: false, status: 429, json: async () => ({ reason: 'no' }) });
    const out = await fetchBatch(cells, { fetchImpl, now: NOW });
    expect(out.directions).toHaveLength(cells.length);
    expect(out.directions.every((d) => d === null)).toBe(true);
  });

  it('stores them in the built grid, alongside the heights', async () => {
    const fetchImpl = async (url) => {
      const n = new URL(url).searchParams.get('latitude').split(',').length;
      return okRes(Array.from({ length: n }, () => cur(2, 270)));
    };
    const grid = await buildGrid({ ...INSTANT, fetchImpl, now: NOW });
    expect(typeof grid.dirs).toBe('string');
    const back = decodeDirections(base64ToBytes(grid.dirs));
    expect(back).toHaveLength(gridCellCount());
    for (const d of back) expect(Math.abs(d - 270)).toBeLessThan(1.5);
  });
});

describe('a cached grid from before directions existed', () => {
  it('is rebuilt rather than served, so the arrows are not missing for six hours', async () => {
    // The cache is a six-hour one. An entry stored by the previous Worker has heights and no
    // directions, and serving it means the app draws no arrows for six hours after a deploy
    // with nothing to say why — the feature looks broken while the cache does its job.
    const e = env();
    await e.SUBSCRIPTIONS.put(GRID_KEY, JSON.stringify({
      generatedAt: NOW - 60000, cells: gridCellCount(), coverage: 1,
      data: bytesToBase64(encodeHeights(new Array(gridCellCount()).fill(2))),
      // No `dirs` — that is the whole point of this fixture.
    }));
    let calls = 0;
    const fetchImpl = async (url) => {
      calls++;
      const n = new URL(url).searchParams.get('latitude').split(',').length;
      return okRes(Array.from({ length: n }, () => cur(2, 180)));
    };
    const { grid } = await loadGrid(e, { ...INSTANT, fetchImpl, now: NOW });
    expect(calls).toBeGreaterThan(0); // i.e. it went and fetched rather than serving the cache
    expect(typeof grid.dirs).toBe('string');
  });

  it('still serves a complete grid that has them', async () => {
    const e = env();
    const fetchImpl = async (url) => {
      const n = new URL(url).searchParams.get('latitude').split(',').length;
      return okRes(Array.from({ length: n }, () => cur(2, 180)));
    };
    const first = await loadGrid(e, { ...INSTANT, fetchImpl, now: NOW });
    expect(first.build).not.toBeNull();
    let calls = 0;
    const second = await loadGrid(e, {
      ...INSTANT, now: NOW + 1000, fetchImpl: async (...a) => { calls++; return fetchImpl(...a); },
    });
    expect(calls).toBe(0); // answered from the cache
    expect(second.grid.dirs).toBe(first.grid.dirs);
  });
});
