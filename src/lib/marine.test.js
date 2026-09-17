import { describe, it, expect, vi, beforeEach } from 'vitest';
import { marineUrl, fetchMarine, mergeWaveModels, WAVE_MODELS, _resetPeakSupport } from './marine.js';

const ok = () => ({ ok: true, status: 200 });
const bad = (status) => ({ ok: false, status });

describe('marineUrl', () => {
  it('asks for peak period by default, alongside the mean period', () => {
    const u = marineUrl(33, -117);
    expect(u).toContain('swell_wave_peak_period');
    expect(u).toContain('wind_wave_peak_period');
    expect(u).toContain('swell_wave_period'); // the mean one is still there as the fallback
  });

  it('can be built without them', () => {
    expect(marineUrl(33, -117, { peak: false })).not.toContain('peak_period');
  });

  it('carries every variable the forecast reads, and the coordinates', () => {
    const u = marineUrl(33.38, -117.6);
    for (const v of ['wave_height', 'wave_direction', 'swell_wave_height', 'wind_wave_height',
      'sea_surface_temperature', 'sea_level_height_msl', 'wave_height_max']) expect(u).toContain(v);
    expect(u).toContain('latitude=33.38');
    expect(u).toContain('longitude=-117.6');
  });
});

describe('fetchMarine', () => {
  beforeEach(() => _resetPeakSupport());

  it('asks for peak period first and is done when that works', async () => {
    const f = vi.fn(async () => ok());
    await fetchMarine(33, -117, f);
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0][0]).toContain('peak_period');
  });

  it('retries without peak period when the upstream rejects the parameter', async () => {
    const f = vi.fn(async (url) => (String(url).includes('peak_period') ? bad(400) : ok()));
    const res = await fetchMarine(33, -117, f);
    expect(res.ok).toBe(true);
    expect(f).toHaveBeenCalledTimes(2);
    expect(f.mock.calls[1][0]).not.toContain('peak_period');
  });

  it('remembers the rejection, so it is asked once and not once per spot', async () => {
    const f = vi.fn(async (url) => (String(url).includes('peak_period') ? bad(400) : ok()));
    await fetchMarine(33, -117, f);
    await fetchMarine(34, -118, f);
    await fetchMarine(35, -119, f);
    // 2 for the first (ask, fall back), then 1 each -- not 2 each.
    expect(f).toHaveBeenCalledTimes(4);
    expect(f.mock.calls.slice(1).every((c) => !String(c[0]).includes('peak_period'))).toBe(true);
  });

  it('does NOT retry on a rate limit, which would spend a second request to be refused again', async () => {
    const f = vi.fn(async () => bad(429));
    const res = await fetchMarine(33, -117, f);
    expect(f).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(429); // passed up unchanged, so the caller can say "rate limited"
  });

  it('does not retry on a server error either', async () => {
    const f = vi.fn(async () => bad(503));
    expect((await fetchMarine(33, -117, f)).status).toBe(503);
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe('marineUrl with named models', () => {
  it('asks for no model at all by default, which is what it always did', () => {
    expect(marineUrl(33, -117)).not.toContain('models=');
  });

  it('names the finer model first, so it wins the merge below', () => {
    const u = marineUrl(33, -117, { models: WAVE_MODELS });
    expect(u).toContain('&models=meteofrance_wave,ncep_gfswave025');
    expect(WAVE_MODELS[0]).toBe('meteofrance_wave');
  });

  it('leaves the parameter off for an empty list rather than sending a bare models=', () => {
    expect(marineUrl(33, -117, { models: [] })).not.toContain('models=');
    expect(marineUrl(33, -117, { models: null })).not.toContain('models=');
  });
});

describe('fetchMarine model probing', () => {
  beforeEach(() => _resetPeakSupport());

  it('settles peak period before it ever mentions a model', () => {
    // Both probes read the same 400. Asking both questions in one request means a wrong model
    // name looks exactly like a wrong variable name, and the app answers by dropping peak
    // period -- degrading the forecast to fix a problem peak period never had.
    const urls = [];
    const fetchImpl = vi.fn(async (u) => { urls.push(u); return ok(); });
    return fetchMarine(33, -117, fetchImpl).then(() => {
      expect(urls).toHaveLength(1);
      expect(urls[0]).toContain('swell_wave_peak_period');
      expect(urls[0]).not.toContain('models=');
    });
  });

  it('asks for the models once peak is known', async () => {
    const urls = [];
    const fetchImpl = vi.fn(async (u) => { urls.push(u); return ok(); });
    await fetchMarine(33, -117, fetchImpl); // settles peak
    await fetchMarine(33, -117, fetchImpl);
    expect(urls[1]).toContain('models=meteofrance_wave');
    expect(urls[1]).toContain('swell_wave_peak_period'); // and keeps the peak it established
  });

  it('drops the models and keeps peak period when the names are rejected', async () => {
    const urls = [];
    const fetchImpl = vi.fn(async (u) => {
      urls.push(u);
      return u.includes('models=') ? bad(400) : ok();
    });
    await fetchMarine(33, -117, fetchImpl); // settles peak: supported
    const res = await fetchMarine(33, -117, fetchImpl);
    expect(res.ok).toBe(true);
    // Fell back to a request with no models, and peak period survived the fallback.
    expect(urls[urls.length - 1]).not.toContain('models=');
    expect(urls[urls.length - 1]).toContain('swell_wave_peak_period');
  });

  it('never asks for the rejected models again', async () => {
    const fetchImpl = vi.fn(async (u) => (u.includes('models=') ? bad(400) : ok()));
    await fetchMarine(33, -117, fetchImpl);
    await fetchMarine(33, -117, fetchImpl);
    const before = fetchImpl.mock.calls.length;
    await fetchMarine(33, -117, fetchImpl);
    // One request, not two: the rejection is remembered for the life of the process.
    expect(fetchImpl.mock.calls.length - before).toBe(1);
  });

  it('does not treat a rate limit as a rejection', async () => {
    // Answering a 429 by spending another request is how a rate limit becomes a longer one.
    const fetchImpl = vi.fn(async (u) => (u.includes('models=') ? bad(429) : ok()));
    await fetchMarine(33, -117, fetchImpl); // settles peak
    const before = fetchImpl.mock.calls.length;
    const res = await fetchMarine(33, -117, fetchImpl);
    expect(res.status).toBe(429);
    expect(fetchImpl.mock.calls.length - before).toBe(1);
    // And it stays a question worth asking, rather than being written off by one bad minute.
    const after = fetchImpl.mock.calls.length;
    await fetchMarine(33, -117, fetchImpl);
    expect(fetchImpl.mock.calls.length - after).toBe(1);
  });
});

describe('mergeWaveModels', () => {
  const marine = (hourly) => ({ hourly });

  it('prefers the finer model wherever it has a number', () => {
    const out = mergeWaveModels(marine({
      time: ['a', 'b', 'c'],
      wave_height_meteofrance_wave: [1.1, 2.2, 3.3],
      wave_height_ncep_gfswave025: [9, 9, 9],
    }));
    expect(out.hourly.wave_height).toEqual([1.1, 2.2, 3.3]);
    expect(out.waveModelsUsed).toEqual(['meteofrance_wave']);
  });

  it('falls back per value, not per spot', () => {
    // The finer grid is also the less complete one. A gap in it must cost that hour, not the
    // whole spot.
    const out = mergeWaveModels(marine({
      wave_height_meteofrance_wave: [1.1, null, 3.3],
      wave_height_ncep_gfswave025: [9, 8, 7],
    }));
    expect(out.hourly.wave_height).toEqual([1.1, 8, 3.3]);
    expect(out.waveModelsUsed.sort()).toEqual(['meteofrance_wave', 'ncep_gfswave025']);
  });

  it('uses the global model alone where the finer one does not reach', () => {
    const out = mergeWaveModels(marine({
      wave_height_meteofrance_wave: [null, null],
      wave_height_ncep_gfswave025: [4, 5],
    }));
    expect(out.hourly.wave_height).toEqual([4, 5]);
    expect(out.waveModelsUsed).toEqual(['ncep_gfswave025']);
  });

  it('merges every variable, not just the wave height', () => {
    const out = mergeWaveModels(marine({
      swell_wave_period_meteofrance_wave: [null, 12],
      swell_wave_period_ncep_gfswave025: [10, 11],
      swell_wave_direction_meteofrance_wave: [225, 230],
      swell_wave_direction_ncep_gfswave025: [1, 2],
    }));
    expect(out.hourly.swell_wave_period).toEqual([10, 12]);
    expect(out.hourly.swell_wave_direction).toEqual([225, 230]);
  });

  it('leaves an ordinary single-model response exactly as it found it', () => {
    // Nothing may depend on the models having been asked for, or on the request succeeding.
    const plain = marine({ time: ['a'], wave_height: [2] });
    expect(mergeWaveModels(plain)).toBe(plain);
  });

  it('keeps the per-model series, which the confidence badge reads', () => {
    const out = mergeWaveModels(marine({
      wave_height_meteofrance_wave: [1],
      wave_height_ncep_gfswave025: [2],
    }));
    expect(out.hourly.wave_height_meteofrance_wave).toEqual([1]);
    expect(out.hourly.wave_height_ncep_gfswave025).toEqual([2]);
  });

  it('treats a non-finite reading as missing rather than passing it through', () => {
    const out = mergeWaveModels(marine({
      wave_height_meteofrance_wave: [NaN, 'x'],
      wave_height_ncep_gfswave025: [3, 4],
    }));
    expect(out.hourly.wave_height).toEqual([3, 4]);
  });

  it('survives junk', () => {
    expect(mergeWaveModels(null)).toBeNull();
    expect(mergeWaveModels({})).toEqual({});
    expect(mergeWaveModels({ hourly: null })).toEqual({ hourly: null });
  });
});
