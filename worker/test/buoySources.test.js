import { describe, it, expect, vi } from 'vitest';
import { parseIsramar, ISRAMAR_STATIONS, SOURCES, loadAllStations } from '../src/buoySources.js';
import { createFakeKv } from './fakeKv.js';

const HAIFA = ISRAMAR_STATIONS[0];

describe('parseIsramar', () => {
  it('reads the newest row of a series', () => {
    const s = parseIsramar({ data: [
      { datetime: '2026-09-04T06:00', Hs: 0.8, Tp: 6.0, Dir: 280, Tw: 27.0 },
      { datetime: '2026-09-04T07:00', Hs: 1.1, Tp: 7.0, Dir: 285, Tw: 27.2 },
    ] }, HAIFA);
    expect(s.waveHeightM).toBe(1.1);
    expect(s.dominantPeriodS).toBe(7);
    expect(s.meanWaveDirDeg).toBe(285);
    expect(s.waterTempC).toBe(27.2);
    expect(s.station).toBe('IOLR-Haifa');
    expect(s.lat).toBe(HAIFA.lat);
  });

  it('accepts a bare latest-reading object as well as a series', () => {
    expect(parseIsramar({ datetime: '2026-09-04T07:00', Hs: 1.4 }, HAIFA).waveHeightM).toBe(1.4);
    expect(parseIsramar([{ datetime: '2026-09-04T07:00', Hs: 1.4 }], HAIFA).waveHeightM).toBe(1.4);
  });

  it('tolerates the field-name variants the format uses', () => {
    const a = parseIsramar({ time: '2026-09-04T07:00', significant_wave_height: 2, peak_period: 8 }, HAIFA);
    expect(a.waveHeightM).toBe(2);
    expect(a.dominantPeriodS).toBe(8);
  });

  it('reads the timestamp as UTC', () => {
    const s = parseIsramar({ datetime: '2026-09-04T07:30', Hs: 1 }, HAIFA);
    expect(s.observedAt).toBe(Date.parse('2026-09-04T07:30Z'));
  });

  it('returns nothing without a wave height — a station reporting only temperature is no use', () => {
    expect(parseIsramar({ datetime: '2026-09-04T07:00', Tw: 27 }, HAIFA)).toBeNull();
  });

  it('returns nothing rather than throwing on a shape it does not recognise', () => {
    for (const junk of [null, undefined, 'a string', 42, {}, [], { data: [] }, { data: 'nope' }]) {
      expect(() => parseIsramar(junk, HAIFA)).not.toThrow();
      expect(parseIsramar(junk, HAIFA)).toBeNull();
    }
  });

  it('covers the Israeli coast — the reason this source exists', () => {
    // NDBC has nothing in the eastern Mediterranean, so without these there is no buoy for
    // any Israeli spot. Both sit within range of the coastline they serve.
    for (const s of ISRAMAR_STATIONS) {
      expect(s.lat).toBeGreaterThan(31);
      expect(s.lat).toBeLessThan(34);
      expect(s.lon).toBeGreaterThan(33);
      expect(s.lon).toBeLessThan(36);
    }
  });
});

describe('source registry', () => {
  it('every source declares what the loader needs', () => {
    for (const s of SOURCES) {
      expect(typeof s.id).toBe('string');
      expect(typeof s.label).toBe('string');
      expect(typeof s.ttlSeconds).toBe('number');
      expect(typeof s.load).toBe('function');
    }
  });
  it('ids are distinct, since they key the cache', () => {
    const ids = SOURCES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('loadAllStations', () => {
  const env = () => ({ SUBSCRIPTIONS: createFakeKv() });

  it('merges the stations from every source', async () => {
    const stations = await loadAllStations(env(), {
      fetchSource: (s) => [{ station: s.id + '-1', lat: 0, lon: 0, waveHeightM: 1, observedAt: Date.now() }],
    });
    expect(stations).toHaveLength(SOURCES.length);
    expect(stations.map((s) => s.station)).toEqual(SOURCES.map((s) => s.id + '-1'));
  });

  it('one source failing costs only that source', async () => {
    const stations = await loadAllStations(env(), {
      fetchSource: (s) => {
        if (s.id === 'ndbc') throw new Error('NDBC is down');
        return [{ station: 'kept', lat: 0, lon: 0, waveHeightM: 1, observedAt: Date.now() }];
      },
    });
    expect(stations).toHaveLength(1);
    expect(stations[0].station).toBe('kept');
  });

  it('returns an empty list, not an error, when every source fails', async () => {
    const stations = await loadAllStations(env(), {
      fetchSource: () => { throw new Error('everything is down'); },
    });
    expect(stations).toEqual([]);
  });

  it('caches each source separately and does not refetch within its TTL', async () => {
    const e = env();
    const load = vi.fn((s) => [{ station: s.id, lat: 0, lon: 0, waveHeightM: 1, observedAt: Date.now() }]);
    await loadAllStations(e, { fetchSource: load });
    expect(load).toHaveBeenCalledTimes(SOURCES.length);
    await loadAllStations(e, { fetchSource: load });
    expect(load).toHaveBeenCalledTimes(SOURCES.length); // second call served from cache
  });

  it('tolerates a source that returns nothing at all', async () => {
    const stations = await loadAllStations(env(), { fetchSource: () => null });
    expect(stations).toEqual([]);
  });
});
