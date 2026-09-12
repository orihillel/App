import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  MAX_FORECAST_DAYS, DETAILED_DAYS, outlookUrl, parseOutlook, fetchOutlook,
  outlookBarHeight, OUTLOOK_BAR_MAX_PX, OUTLOOK_BAR_MIN_PX,
} from './outlook.js';

function body(days, { from = '2026-09-01', heights = null } = {}) {
  const time = [];
  const wave = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(from + 'T00:00:00');
    d.setDate(d.getDate() + i);
    time.push(d.toISOString().slice(0, 10));
    wave.push(heights ? heights[i] : 1 + i * 0.1);
  }
  return { daily: { time, wave_height_max: wave } };
}

describe('outlookUrl', () => {
  it('asks for one daily variable over the full 16 days, not the hourly set', () => {
    const url = outlookUrl(33.38, -117.6);
    expect(url).toContain('forecast_days=16');
    expect(url).toContain('daily=wave_height_max');
    // The whole reason this is a separate request: billing is locations x variables x days, and
    // stretching the 13-variable hourly call to 16 days would more than double a spot fetch.
    expect(url).not.toContain('hourly=');
    expect(url).not.toContain('swell_wave_height');
  });

  it('is capped at what the upstream actually serves', () => {
    expect(MAX_FORECAST_DAYS).toBe(16);
  });
});

describe('parseOutlook', () => {
  it('returns only the days past the detailed window', () => {
    const out = parseOutlook(body(16));
    expect(out).toHaveLength(16 - DETAILED_DAYS);
    expect(out[0].date).toBe('2026-09-08');
  });

  it('converts metres to feet', () => {
    const out = parseOutlook(body(8, { heights: [0, 0, 0, 0, 0, 0, 0, 2] }));
    expect(out[0].waveFt).toBeCloseTo(2 * 3.28084, 4);
  });

  it('labels the weekday from the date', () => {
    // 2026-09-08 is a Tuesday.
    expect(parseOutlook(body(8))[0].day).toBe('Tue');
  });

  it('skips days with no height rather than charting them as flat', () => {
    const b = body(10);
    b.daily.wave_height_max[8] = null;
    const out = parseOutlook(b);
    expect(out.map((d) => d.date)).toEqual(['2026-09-08', '2026-09-10']);
  });

  it('skips a date it cannot parse rather than emitting a NaN day', () => {
    // body(9) is 09-01..09-09; skipping the detailed week leaves indices 7 and 8, so corrupting
    // index 8 must leave exactly index 7 standing.
    const b = body(9);
    b.daily.time[8] = 'not-a-date';
    expect(parseOutlook(b).map((d) => d.date)).toEqual(['2026-09-08']);
  });

  it('is empty when the upstream returned fewer days than the detailed window', () => {
    expect(parseOutlook(body(7))).toEqual([]);
    expect(parseOutlook(body(3))).toEqual([]);
  });

  it('is empty rather than throwing on a malformed or missing body', () => {
    for (const junk of [null, undefined, {}, { daily: {} }, { daily: { time: 'x', wave_height_max: 3 } }]) {
      expect(parseOutlook(junk)).toEqual([]);
    }
  });
});

describe('fetchOutlook', () => {
  const spot = { lat: 33.38, lon: -117.6 };

  it('returns the parsed days on a good answer', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => body(16) }));
    expect(await fetchOutlook(spot, { fetchImpl })).toHaveLength(9);
  });

  it('returns nothing rather than failing the page when the request is refused', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) }));
    expect(await fetchOutlook(spot, { fetchImpl })).toEqual([]);
  });

  it('refuses a rejected response even when its body would parse as a forecast', async () => {
    // A proxy or a rate limiter can answer 502/429 with something forecast-shaped, and parsing
    // it would put invented days on the chart. The status decides, not the body.
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 502, json: async () => body(16) }));
    expect(await fetchOutlook(spot, { fetchImpl })).toEqual([]);
  });

  it('returns nothing rather than throwing when the network is down', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('offline'); });
    expect(await fetchOutlook(spot, { fetchImpl })).toEqual([]);
  });

  it('returns nothing rather than throwing when the body is junk', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => { throw new Error('bad json'); } }));
    expect(await fetchOutlook(spot, { fetchImpl })).toEqual([]);
  });

  it('does not call out at all for a spot with no usable coordinates', async () => {
    const fetchImpl = vi.fn();
    for (const bad of [null, {}, { lat: 1 }, { lat: NaN, lon: 2 }, { lat: 1, lon: 'x' }]) {
      expect(await fetchOutlook(bad, { fetchImpl })).toEqual([]);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('outlookBarHeight', () => {
  const days = (heights) => heights.map((waveFt, i) => ({ date: 'd' + i, waveFt }));

  it('scales to the tallest day in the strip, so the biggest one fills it', () => {
    const d = days([1, 2, 4]);
    expect(outlookBarHeight(4, d)).toBe(OUTLOOK_BAR_MAX_PX);
    expect(outlookBarHeight(2, d)).toBe(Math.round(OUTLOOK_BAR_MAX_PX / 2));
  });

  it('shows the shape of a flat fortnight instead of fourteen identical stubs', () => {
    const d = days([1, 1.1, 1.2]);
    expect(outlookBarHeight(1.2, d)).toBeGreaterThan(outlookBarHeight(1, d));
  });

  it('keeps the smallest day visible rather than drawing nothing', () => {
    expect(outlookBarHeight(0.01, days([0.01, 10]))).toBe(OUTLOOK_BAR_MIN_PX);
    expect(outlookBarHeight(0, days([0, 10]))).toBe(OUTLOOK_BAR_MIN_PX);
  });

  it('does not divide by zero on an all-flat strip', () => {
    expect(outlookBarHeight(0, days([0, 0, 0]))).toBe(OUTLOOK_BAR_MIN_PX);
  });

  it('falls back rather than returning NaN for junk input', () => {
    for (const bad of [null, undefined, NaN, 'tall']) {
      expect(outlookBarHeight(bad, days([1, 2]))).toBe(OUTLOOK_BAR_MIN_PX);
    }
    expect(outlookBarHeight(1, null)).toBe(OUTLOOK_BAR_MIN_PX);
    expect(outlookBarHeight(1, [])).toBe(OUTLOOK_BAR_MIN_PX);
  });
});

// The Worker is not an optimisation here: Open-Meteo is unreachable from some networks and
// regions entirely, which is the whole reason /forecast goes through it. The first version of
// this module called Open-Meteo directly and forecast.test.js's routing tests caught it.
describe('fetchOutlook routing', () => {
  const spot = { lat: 33.38, lon: -117.6 };
  afterEach(() => { vi.unstubAllEnvs(); });

  it('asks the Worker, not Open-Meteo, when one is configured', async () => {
    vi.stubEnv('VITE_PUSH_API_URL', 'https://worker.example');
    const calls = [];
    const fetchImpl = vi.fn(async (url) => {
      calls.push(String(url));
      return { ok: true, status: 200, json: async () => body(16) };
    });
    expect(await fetchOutlook(spot, { fetchImpl })).toHaveLength(9);
    expect(calls.some((u) => u.includes('worker.example/outlook'))).toBe(true);
    expect(calls.some((u) => u.includes('open-meteo.com'))).toBe(false);
  });

  it('falls back to Open-Meteo when the Worker predates the endpoint and 404s', async () => {
    vi.stubEnv('VITE_PUSH_API_URL', 'https://worker.example');
    const calls = [];
    const fetchImpl = vi.fn(async (url) => {
      calls.push(String(url));
      if (String(url).includes('worker.example')) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => body(16) };
    });
    expect(await fetchOutlook(spot, { fetchImpl })).toHaveLength(9);
    expect(calls.some((u) => u.includes('open-meteo.com'))).toBe(true);
  });

  it('falls back to Open-Meteo when the Worker is unreachable', async () => {
    vi.stubEnv('VITE_PUSH_API_URL', 'https://worker.example');
    const calls = [];
    const fetchImpl = vi.fn(async (url) => {
      calls.push(String(url));
      if (String(url).includes('worker.example')) throw new TypeError('Failed to fetch');
      return { ok: true, status: 200, json: async () => body(16) };
    });
    expect(await fetchOutlook(spot, { fetchImpl })).toHaveLength(9);
    expect(calls.some((u) => u.includes('open-meteo.com'))).toBe(true);
  });

  it('does not retry Open-Meteo directly when the Worker reports it rate-limited', async () => {
    // Asking again from the browser would be refused too, and would spend one more of the very
    // allowance that is exhausted.
    vi.stubEnv('VITE_PUSH_API_URL', 'https://worker.example');
    const calls = [];
    const fetchImpl = vi.fn(async (url) => {
      calls.push(String(url));
      return { ok: false, status: 429, json: async () => ({ error: 'upstream', status: 429 }) };
    });
    expect(await fetchOutlook(spot, { fetchImpl })).toEqual([]);
    expect(calls.some((u) => u.includes('open-meteo.com'))).toBe(false);
  });

  it('goes straight to Open-Meteo when no Worker is configured', async () => {
    vi.stubEnv('VITE_PUSH_API_URL', '');
    const calls = [];
    const fetchImpl = vi.fn(async (url) => {
      calls.push(String(url));
      return { ok: true, status: 200, json: async () => body(16) };
    });
    expect(await fetchOutlook(spot, { fetchImpl })).toHaveLength(9);
    expect(calls.every((u) => u.includes('open-meteo.com'))).toBe(true);
  });
});
