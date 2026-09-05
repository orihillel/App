import { describe, it, expect, vi } from 'vitest';
import { fetchBatch, buildGrid, loadGrid, GRID_KEY, REFRESH_MS, BATCH_SIZE } from '../src/waveGrid.js';
import { gridCellCount, base64ToBytes, encodeHeights, bytesToBase64, NO_DATA } from '../../src/lib/wavegrid.js';
import { createFakeKv } from './fakeKv.js';

const NOW = Date.parse('2026-09-05T14:20:00Z');
const HOUR = '2026-09-05T14:00';

// One location's worth of an Open-Meteo marine response.
const loc = (h) => ({ hourly: { time: [HOUR, '2026-09-05T15:00'], wave_height: [h, h + 1] } });
const okRes = (body) => ({ ok: true, json: async () => body });

const env = () => ({ SUBSCRIPTIONS: createFakeKv() });
const cells = [{ lat: 0, lon: 0 }, { lat: 10, lon: 20 }];

describe('fetchBatch', () => {
  it('asks for every cell in one request and reads the answers positionally', async () => {
    let seen = '';
    const fetchImpl = async (url) => { seen = url; return okRes([loc(1.5), loc(3.2)]); };
    const out = await fetchBatch(cells, { fetchImpl, now: NOW });
    expect(out).toEqual([1.5, 3.2]);
    expect(seen).toContain('latitude=0.00,10.00');
    expect(seen).toContain('longitude=0.00,20.00');
  });

  it('picks the row for the current hour, not just the first one', async () => {
    const fetchImpl = async () => okRes([{ hourly: {
      time: ['2026-09-05T12:00', '2026-09-05T13:00', HOUR], wave_height: [9, 9, 2.4],
    } }]);
    expect(await fetchBatch([cells[0]], { fetchImpl, now: NOW })).toEqual([2.4]);
  });

  it('falls back to the first row when the current hour is missing', async () => {
    // Clock skew, or a model run whose series starts later in the day. Better a nearby hour
    // than a hole in the ocean.
    const fetchImpl = async () => okRes([{ hourly: {
      time: ['2026-09-06T02:00'], wave_height: [1.1],
    } }]);
    expect(await fetchBatch([cells[0]], { fetchImpl, now: NOW })).toEqual([1.1]);
  });

  it('accepts a bare object as well as an array', async () => {
    // A one-location request answers with an object rather than a list. Rejecting that shape
    // would turn the last, short batch of every build into nulls.
    const fetchImpl = async () => okRes(loc(2.2));
    expect(await fetchBatch([cells[0]], { fetchImpl, now: NOW })).toEqual([2.2]);
  });

  it('reads a land point as null, not as calm water', async () => {
    const fetchImpl = async () => okRes([{ hourly: { time: [HOUR], wave_height: [null] } }, loc(2)]);
    expect(await fetchBatch(cells, { fetchImpl, now: NOW })).toEqual([null, 2]);
  });

  it('returns nulls rather than throwing when the request fails', async () => {
    for (const fetchImpl of [
      async () => { throw new Error('network'); },
      async () => ({ ok: false, json: async () => ({}) }),
      async () => ({ ok: true, json: async () => { throw new Error('not json'); } }),
      async () => okRes(null),
      async () => okRes([{ hourly: null }, 'nonsense']),
    ]) {
      await expect(fetchBatch(cells, { fetchImpl, now: NOW })).resolves.toEqual([null, null]);
    }
  });
});

describe('buildGrid', () => {
  it('covers every cell, in batches, and packs them in grid order', async () => {
    let calls = 0;
    // Answer each location with a height derived from its latitude, so misalignment shows.
    const fetchImpl = async (url) => {
      calls++;
      const lats = new URL(url).searchParams.get('latitude').split(',');
      return okRes(lats.map((l) => loc(Math.abs(Number(l)) / 10)));
    };
    const grid = await buildGrid({ fetchImpl, now: NOW });
    expect(grid.cells).toBe(gridCellCount());
    expect(calls).toBe(Math.ceil(gridCellCount() / BATCH_SIZE));
    const bytes = base64ToBytes(grid.data);
    expect(bytes.length).toBe(gridCellCount());
    // First cell is the -75 row: |−75|/10 = 7.5m -> 75 decimetres.
    expect(bytes[0]).toBe(75);
  });

  it('leaves the cells of a failed batch empty and keeps the rest', async () => {
    let n = 0;
    const fetchImpl = async (url) => {
      if (n++ === 0) throw new Error('first batch down');
      const lats = new URL(url).searchParams.get('latitude').split(',');
      return okRes(lats.map(() => loc(2)));
    };
    const bytes = base64ToBytes((await buildGrid({ fetchImpl, now: NOW })).data);
    expect(bytes[0]).toBe(NO_DATA);
    expect(bytes[bytes.length - 1]).toBe(20);
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
