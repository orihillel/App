import { describe, it, expect, vi } from 'vitest';
import { loadTideStations, nearestTideStation, loadPredictions } from '../src/noaaTide.js';
import { createFakeKv } from './fakeKv.js';

function makeEnv() {
  return { SUBSCRIPTIONS: createFakeKv() };
}

describe('loadTideStations', () => {
  it('parses a well-formed response', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      stations: [{ id: '9410230', name: 'La Jolla', lat: 32.8669, lng: -117.2571 }],
    }), { status: 200 }));
    const stations = await loadTideStations(makeEnv(), { fetchImpl });
    expect(stations).toEqual([{ id: '9410230', name: 'La Jolla', lat: 32.8669, lon: -117.2571 }]);
  });

  it('reads latitude/longitude as well as lat/lng, since the exact field names were never confirmed live', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      stations: [{ stationId: 'X1', name: 'Alt Names', latitude: 10, longitude: 20 }],
    }), { status: 200 }));
    const stations = await loadTideStations(makeEnv(), { fetchImpl });
    expect(stations).toEqual([{ id: 'X1', name: 'Alt Names', lat: 10, lon: 20 }]);
  });

  it('drops a station missing an id or a usable coordinate rather than keeping a broken entry', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      stations: [
        { id: 'A', name: 'no coords' },
        { id: null, name: 'no id', lat: 1, lng: 2 },
        { id: 'B', name: 'fine', lat: 1, lng: 2 },
      ],
    }), { status: 200 }));
    const stations = await loadTideStations(makeEnv(), { fetchImpl });
    expect(stations.map((s) => s.id)).toEqual(['B']);
  });

  it('returns an empty list, not a throw, when the request fails or the shape is nonsense', async () => {
    for (const impl of [
      vi.fn(async () => new Response('nope', { status: 500 })),
      vi.fn(async () => { throw new TypeError('offline'); }),
      vi.fn(async () => new Response('not json', { status: 200 })),
      vi.fn(async () => new Response(JSON.stringify({ stations: 'not an array' }), { status: 200 })),
    ]) {
      expect(await loadTideStations(makeEnv(), { fetchImpl: impl })).toEqual([]);
    }
  });

  it('caches the parsed list, so a second call asks nothing upstream', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      stations: [{ id: '1', name: 'A', lat: 1, lng: 1 }],
    }), { status: 200 }));
    const env = makeEnv();
    await loadTideStations(env, { fetchImpl });
    await loadTideStations(env, { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('nearestTideStation', () => {
  const stations = [
    { id: 'near', name: 'Near', lat: 33.0, lon: -117.5 },
    { id: 'far', name: 'Far', lat: 40.0, lon: -70.0 },
  ];

  it('picks the closer of two stations', () => {
    const best = nearestTideStation(stations, 33.1, -117.4);
    expect(best.id).toBe('near');
    expect(best.km).toBeLessThan(20);
  });

  it('returns null when nothing is within range', () => {
    expect(nearestTideStation(stations, -34.0, 151.0)).toBeNull(); // Sydney; nowhere near either
  });

  it('respects a tighter max range', () => {
    expect(nearestTideStation(stations, 33.1, -117.4, 1)).toBeNull();
  });

  it('tolerates an empty or missing station list', () => {
    expect(nearestTideStation([], 33, -117)).toBeNull();
    expect(nearestTideStation(null, 33, -117)).toBeNull();
  });
});

describe('loadPredictions', () => {
  const station = { id: '9410230', name: 'La Jolla', lat: 32.87, lon: -117.26 };

  it('parses a well-formed predictions response', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      predictions: [{ t: '2026-09-08 00:00', v: '1.234' }, { t: '2026-09-08 01:00', v: '1.400' }],
    }), { status: 200 }));
    const preds = await loadPredictions(makeEnv(), station, { fetchImpl });
    expect(preds).toEqual([{ t: '2026-09-08 00:00', ft: 1.234 }, { t: '2026-09-08 01:00', ft: 1.4 }]);
  });

  it('requests two UTC calendar days, so any US timezone\'s full local "today" is covered', async () => {
    let seenUrl = '';
    const fetchImpl = vi.fn(async (url) => { seenUrl = String(url); return new Response('{"predictions":[]}', { status: 200 }); });
    const now = new Date('2026-09-08T23:30:00Z'); // near UTC midnight, where a naive one-day window would miss local evening hours west of it
    await loadPredictions(makeEnv(), station, { fetchImpl, now });
    expect(seenUrl).toContain('begin_date=20260908');
    expect(seenUrl).toContain('end_date=20260909');
    expect(seenUrl).toContain('station=9410230');
  });

  it('drops a row with a non-numeric height rather than passing NaN through', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      predictions: [{ t: '2026-09-08 00:00', v: '1.0' }, { t: '2026-09-08 01:00', v: 'n/a' }],
    }), { status: 200 }));
    const preds = await loadPredictions(makeEnv(), station, { fetchImpl });
    expect(preds).toHaveLength(1);
  });

  it('returns an empty list, not a throw, on failure', async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError('offline'); });
    expect(await loadPredictions(makeEnv(), station, { fetchImpl })).toEqual([]);
  });

  it('caches per station per day, so a second call for the same day asks nothing upstream', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"predictions":[]}', { status: 200 }));
    const env = makeEnv();
    const now = new Date('2026-09-08T12:00:00Z');
    await loadPredictions(env, station, { fetchImpl, now });
    await loadPredictions(env, station, { fetchImpl, now });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not reuse a cache entry for a different day', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"predictions":[]}', { status: 200 }));
    const env = makeEnv();
    await loadPredictions(env, station, { fetchImpl, now: new Date('2026-09-08T12:00:00Z') });
    await loadPredictions(env, station, { fetchImpl, now: new Date('2026-09-09T12:00:00Z') });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
