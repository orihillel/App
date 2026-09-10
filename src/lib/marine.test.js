import { describe, it, expect, vi, beforeEach } from 'vitest';
import { marineUrl, fetchMarine, _resetPeakSupport } from './marine.js';

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
