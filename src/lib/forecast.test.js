import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchSpotForecast, geocodePlace, findOffshoreDirection, describeForecastError, fetchNowViaWorker, fetchModelAgreement } from './forecast.js';

const SPOT = { lat: 33.38, lon: -117.6, offshoreDeg: 60 };

// 24 hourly values so both the sampled daylight hours and the today-tide-range calculation
// have real numbers to work with.
function hourly(n, fn) { return Array.from({ length: n }, (_, i) => fn(i)); }

function makeMarineResponse() {
  return {
    hourly: {
      time: hourly(24, (i) => `2026-09-01T${String(i).padStart(2, '0')}:00`),
      wave_height: hourly(24, () => 1.5), // meters -> ~4.9ft
      wave_direction: hourly(24, () => 200),
      wave_period: hourly(24, () => 10),
      swell_wave_height: hourly(24, () => 1.2),
      swell_wave_direction: hourly(24, () => 210),
      swell_wave_period: hourly(24, () => 11),
      sea_level_height_msl: hourly(24, (i) => Math.sin((i / 24) * Math.PI * 2)), // -1..1
    },
    daily: {
      time: ['2026-09-01', '2026-09-02'],
      wave_height_max: [1.5, 1.8],
    },
  };
}
function makeWindResponse(sunrise = '2026-09-01T06:10', sunset = '2026-09-01T19:20') {
  return {
    hourly: {
      wind_speed_10m: hourly(24, () => 5), // m/s -> ~11mph
      wind_direction_10m: hourly(24, () => 60), // matches offshoreDeg exactly
    },
    // Which hours get sampled is derived from these, per spot and per date.
    daily: { time: ['2026-09-01'], sunrise: [sunrise], sunset: [sunset] },
  };
}

function mockFetchOnce(json, ok = true) {
  return { ok, json: async () => json };
}

describe('fetchSpotForecast', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('converts units, tags wind type against the spot, and fills every hourly sample', async () => {
    fetch.mockImplementation((url) =>
      Promise.resolve(mockFetchOnce(url.includes('marine-api') ? makeMarineResponse() : makeWindResponse()))
    );
    const result = await fetchSpotForecast(SPOT);
    expect(result.hours).toHaveLength(8);
    const first = result.hours[0];
    expect(first.type).toBe('offshore'); // wind exactly matches offshoreDeg
    expect(first.windDir).toBe('ENE'); // 60deg
    // 5 m/s -> ~11.2mph, rounded
    expect(first.windSpd).toBe(Math.round(5 * 0.621371));
    expect(result.weekly).toHaveLength(2);
    expect(result.continuous.length).toBeGreaterThan(0);
    expect(result.tideToday).toHaveLength(8);
  });

  it('throws when either request fails, rather than silently returning partial data', async () => {
    fetch.mockImplementation((url) =>
      Promise.resolve(mockFetchOnce({}, !url.includes('marine-api')))
    );
    await expect(fetchSpotForecast(SPOT)).rejects.toThrow('Forecast request failed');
  });

  it('drops a wave-height gap instead of guessing a value for it', async () => {
    // This used to throw, losing the whole week over one missing hour. The line it was really
    // holding is that no number may be invented, and dropping the hour holds it just as well:
    // the day comes back one point shorter, with every remaining point a real reading.
    const marine = makeMarineResponse();
    marine.hourly.wave_height[5] = null; // 5am: the first sampled hour for the sunrise below
    fetch.mockImplementation((url) =>
      Promise.resolve(mockFetchOnce(url.includes('marine-api') ? marine : makeWindResponse()))
    );
    const result = await fetchSpotForecast(SPOT);
    expect(result.hours.map((h) => h.hour)).not.toContain(5);
    expect(result.hours).toHaveLength(7); // the eight sampled hours, less the empty one
    expect(result.hours.every((h) => h.wave && h.windSpd != null)).toBe(true);
  });

  it('samples the hours around this spot\'s own sunrise and sunset', async () => {
    fetch.mockImplementation((url) =>
      Promise.resolve(mockFetchOnce(url.includes('marine-api') ? makeMarineResponse() : makeWindResponse()))
    );
    const result = await fetchSpotForecast(SPOT);
    // Sunrise 06:10 -> the window opens an hour earlier, at 5. Sunset 19:20 -> closes at 20.
    expect(result.hours[0].hour).toBe(5);
    expect(result.hours[result.hours.length - 1].hour).toBe(20);
    expect(result.hours[0].t).toBe('5a');
    // Every sample carries the hour it came from, which is what the tide readout indexes by.
    expect(result.hours.every((h) => Number.isInteger(h.hour))).toBe(true);
  });

  it('offers no hours of darkness on a short Arctic winter day', async () => {
    // Unstad sits at 68.3N. Under the old fixed 5am-7pm list, most of these samples were
    // hours when the sun was down.
    fetch.mockImplementation((url) =>
      Promise.resolve(url.includes('marine-api')
        ? mockFetchOnce(makeMarineResponse())
        : mockFetchOnce(makeWindResponse('2026-12-15T10:50', '2026-12-15T13:40')))
    );
    const result = await fetchSpotForecast(SPOT);
    expect(result.hours.length).toBeLessThan(8);
    expect(result.hours.every((h) => h.hour >= 9 && h.hour <= 14)).toBe(true);
    expect(result.tideToday).toHaveLength(result.hours.length);
  });

  it('reports the best window of the day alongside the hours', async () => {
    fetch.mockImplementation((url) =>
      Promise.resolve(mockFetchOnce(url.includes('marine-api') ? makeMarineResponse() : makeWindResponse()))
    );
    const result = await fetchSpotForecast(SPOT);
    // Offshore wind over a 4.9ft swell scores well, so there is a window to report. It is not
    // the whole day: the mock's tide curve moves, and the score includes distance from
    // mid-tide, so some hours genuinely rate higher than others.
    expect(result.best).not.toBeNull();
    const peak = Math.max(...result.hours.map((h) => h.score));
    expect(result.best.score).toBe(peak);
    // The window indexes back into the hours array it was derived from.
    expect(result.hours[result.best.startIdx].hour).toBe(result.best.startHour);
    expect(result.hours[result.best.endIdx].hour).toBe(result.best.endHour);
    expect(result.best.endIdx).toBeGreaterThanOrEqual(result.best.startIdx);
    // Every hour it spans is at or near the peak.
    for (let i = result.best.startIdx; i <= result.best.endIdx; i++) {
      expect(result.hours[i].score).toBeGreaterThanOrEqual(peak - 1);
    }
  });
});

describe('geocodePlace', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('extracts name/region/coordinates from the first result', async () => {
    fetch.mockResolvedValue(mockFetchOnce({
      results: [{ name: 'Malibu', admin1: 'California', country: 'United States', latitude: 34.03, longitude: -118.68 }],
    }));
    const place = await geocodePlace('malibu');
    expect(place).toEqual({ name: 'Malibu', region: 'California, United States', lat: 34.03, lon: -118.68 });
  });

  it('throws when there are no results', async () => {
    fetch.mockResolvedValue(mockFetchOnce({ results: [] }));
    await expect(geocodePlace('nowhere')).rejects.toThrow('No results');
  });
});

describe('findOffshoreDirection', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('reads offshore as the opposite of the seaward direction, per the "land on left, water on right" convention', async () => {
    // A coastline segment running due north (bearing 0). By the node-order convention, the sea
    // is 90deg clockwise of travel direction (east, bearing 90) — so offshore wind (blowing
    // away from land, out to sea) is described as coming from the opposite side: west, 270.
    fetch.mockResolvedValue(mockFetchOnce({
      elements: [{ geometry: [{ lat: 0, lon: 0 }, { lat: 0.01, lon: 0 }] }],
    }));
    const deg = await findOffshoreDirection(0.005, 0.001);
    expect(deg).toBe(270);
  });

  it('throws when no coastline is found nearby', async () => {
    fetch.mockResolvedValue(mockFetchOnce({ elements: [] }));
    await expect(findOffshoreDirection(0, 0)).rejects.toThrow('No coastline found nearby');
  });

  it('throws when the request itself fails', async () => {
    fetch.mockResolvedValue(mockFetchOnce({}, false));
    await expect(findOffshoreDirection(0, 0)).rejects.toThrow('Coastline lookup failed');
  });
});

describe('describeForecastError', () => {
  it('names rate limiting specifically, because waiting is the right advice only there', () => {
    const err = new Error('Forecast request failed');
    err.status = 429;
    expect(describeForecastError(err)).toMatch(/rate-limiting/i);
    expect(describeForecastError(err)).toMatch(/within the hour/i);
  });

  it('reports the status for a rejected request rather than blaming the connection', () => {
    const err = new Error('Forecast request failed');
    err.status = 400;
    const msg = describeForecastError(err);
    expect(msg).toContain('400');
    expect(msg).not.toMatch(/couldn.t reach/i);
  });

  it('distinguishes the service being down from the request being wrong', () => {
    const down = new Error('Forecast request failed'); down.status = 503;
    expect(describeForecastError(down)).toMatch(/having trouble/i);
    expect(describeForecastError(down)).toContain('503');
  });

  it('falls back to a reachability message when there is no status at all', () => {
    expect(describeForecastError(new TypeError('Failed to fetch'))).toMatch(/couldn.t reach/i);
    expect(describeForecastError(undefined)).toMatch(/couldn.t reach/i);
  });

  it('says the spot has no readings when the payload came back empty', () => {
    expect(describeForecastError(new Error('Incomplete forecast data'))).toMatch(/no readings/i);
  });
});

describe('fetchSpotForecast error reporting', () => {
  it('carries the failing status out, so the page can say which failure it was', async () => {
    const spot = { lat: 33.38, lon: -117.59, offshoreDeg: 70 };
    globalThis.fetch = vi.fn(async () => new Response('{}', { status: 429 }));
    await expect(fetchSpotForecast(spot)).rejects.toMatchObject({ status: 429 });
  });

  it('reports the status of whichever of the two calls failed, not always the first', async () => {
    const spot = { lat: 33.38, lon: -117.59, offshoreDeg: 70 };
    globalThis.fetch = vi.fn(async (url) => new Response('{}', { status: String(url).includes('marine') ? 200 : 400 }));
    await expect(fetchSpotForecast(spot)).rejects.toMatchObject({ status: 400 });
  });
});

// Where the two upstream payloads come from. The Worker exists so that browsers stop spending
// an Open-Meteo allowance counted per location and shared across a whole network.
describe('fetchSpotForecast routing', () => {
  const SPOT2 = { lat: 33.38, lon: -117.59, offshoreDeg: 70 };

  function workerBody() {
    return { marine: makeMarineResponse(), wind: makeWindResponse() };
  }

  afterEach(() => { vi.unstubAllEnvs(); });

  it('asks the Worker, not Open-Meteo, when one is configured', async () => {
    vi.stubEnv('VITE_PUSH_API_URL', 'https://worker.example');
    const calls = [];
    globalThis.fetch = vi.fn(async (url) => {
      calls.push(String(url));
      return new Response(JSON.stringify(workerBody()), { status: 200 });
    });
    await fetchSpotForecast(SPOT2);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('worker.example/forecast');
    expect(calls.some((u) => u.includes('open-meteo.com'))).toBe(false);
  });

  it('goes straight to Open-Meteo when no Worker is configured', async () => {
    vi.stubEnv('VITE_PUSH_API_URL', '');
    const calls = [];
    globalThis.fetch = vi.fn(async (url) => {
      calls.push(String(url));
      return new Response(JSON.stringify(String(url).includes('marine') ? makeMarineResponse() : makeWindResponse()), { status: 200 });
    });
    await fetchSpotForecast(SPOT2);
    expect(calls.every((u) => u.includes('open-meteo.com'))).toBe(true);
  });

  it('falls back to Open-Meteo when the Worker is unreachable', async () => {
    vi.stubEnv('VITE_PUSH_API_URL', 'https://worker.example');
    const calls = [];
    globalThis.fetch = vi.fn(async (url) => {
      calls.push(String(url));
      if (String(url).includes('worker.example')) throw new TypeError('Failed to fetch');
      return new Response(JSON.stringify(String(url).includes('marine') ? makeMarineResponse() : makeWindResponse()), { status: 200 });
    });
    const out = await fetchSpotForecast(SPOT2);
    expect(out.hours.length).toBeGreaterThan(0);
    expect(calls.some((u) => u.includes('open-meteo.com'))).toBe(true);
  });

  it('falls back when the Worker predates the endpoint and 404s', async () => {
    vi.stubEnv('VITE_PUSH_API_URL', 'https://worker.example');
    const calls = [];
    globalThis.fetch = vi.fn(async (url) => {
      calls.push(String(url));
      if (String(url).includes('worker.example')) return new Response('{}', { status: 404 });
      return new Response(JSON.stringify(String(url).includes('marine') ? makeMarineResponse() : makeWindResponse()), { status: 200 });
    });
    const out = await fetchSpotForecast(SPOT2);
    expect(out.hours.length).toBeGreaterThan(0);
    expect(calls.some((u) => u.includes('open-meteo.com'))).toBe(true);
  });

  it('does not retry Open-Meteo directly when the Worker reports it rate-limited', async () => {
    // Asking again from the browser would be refused too, and would spend one more of the
    // very allowance that is exhausted. The status is passed through instead.
    vi.stubEnv('VITE_PUSH_API_URL', 'https://worker.example');
    const calls = [];
    globalThis.fetch = vi.fn(async (url) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ error: 'upstream', status: 429 }), { status: 429 });
    });
    await expect(fetchSpotForecast(SPOT2)).rejects.toMatchObject({ status: 429 });
    expect(calls.some((u) => u.includes('open-meteo.com'))).toBe(false);
  });
});

// The marine model is gridded over open water, so a cell close in to shore can be empty for a
// few hours while the rest of the week is fine. Losing the whole forecast over that is what
// this covers.
describe('fetchSpotForecast with gaps in the data', () => {
  const SPOT3 = { lat: 33.38, lon: -117.59, offshoreDeg: 60 };

  function serve(marine, wind) {
    globalThis.fetch = vi.fn(async (url) => new Response(
      JSON.stringify(String(url).includes('marine') ? marine : wind), { status: 200 },
    ));
  }

  it('keeps the hours that have readings instead of discarding the day', async () => {
    const marine = makeMarineResponse();
    // Morning gone, afternoon fine.
    for (let i = 0; i < 12; i++) marine.hourly.wave_height[i] = null;
    serve(marine, makeWindResponse());

    const out = await fetchSpotForecast(SPOT3);
    expect(out.hours.length).toBeGreaterThan(0);
    expect(out.hours.every((h) => h.hour >= 12)).toBe(true);
    // And the rest of the forecast survives with it.
    expect(out.weekly.length).toBeGreaterThan(0);
    expect(out.continuous.length).toBeGreaterThan(0);
  });

  it('drops an hour missing wind, not just one missing waves', async () => {
    const wind = makeWindResponse();
    for (let i = 0; i < 12; i++) wind.hourly.wind_speed_10m[i] = null;
    serve(makeMarineResponse(), wind);

    const out = await fetchSpotForecast(SPOT3);
    expect(out.hours.length).toBeGreaterThan(0);
    expect(out.hours.every((h) => h.hour >= 12)).toBe(true);
  });

  it('keeps tideToday aligned with the hours it kept', async () => {
    const marine = makeMarineResponse();
    for (let i = 0; i < 12; i++) marine.hourly.wave_height[i] = null;
    serve(marine, makeWindResponse());

    const out = await fetchSpotForecast(SPOT3);
    // Misalignment here would draw the tide curve against the wrong times of day.
    expect(out.tideToday).toHaveLength(out.hours.length);
    out.hours.forEach((h, i) => {
      expect(out.tideToday[i]).toBeCloseTo(marine.hourly.sea_level_height_msl[h.hour] * 3.28084, 5);
    });
  });

  it('still fails, and says so, when no sampled hour has a reading', async () => {
    const marine = makeMarineResponse();
    marine.hourly.wave_height = marine.hourly.wave_height.map(() => null);
    serve(marine, makeWindResponse());

    await expect(fetchSpotForecast(SPOT3)).rejects.toThrow('Incomplete forecast data');
  });
});

describe('fetchNowViaWorker', () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it('asks the Worker for exactly the spots given', async () => {
    vi.stubEnv('VITE_PUSH_API_URL', 'https://worker.example');
    const calls = [];
    globalThis.fetch = vi.fn(async (url) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ spots: { a: { hours: [{}], now: true } } }), { status: 200 });
    });
    const out = await fetchNowViaWorker(['a', 'b']);
    expect(calls[0]).toContain('/conditions?ids=a%2Cb');
    expect(out.a.now).toBe(true);
  });

  it('returns null when no Worker is configured, so the caller goes direct', async () => {
    vi.stubEnv('VITE_PUSH_API_URL', '');
    const spy = vi.fn();
    globalThis.fetch = spy;
    expect(await fetchNowViaWorker(['a'])).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns null rather than throwing when the Worker fails or is unreachable', async () => {
    vi.stubEnv('VITE_PUSH_API_URL', 'https://worker.example');
    globalThis.fetch = vi.fn(async () => new Response('{}', { status: 502 }));
    expect(await fetchNowViaWorker(['a'])).toBeNull();
    globalThis.fetch = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    expect(await fetchNowViaWorker(['a'])).toBeNull();
  });

  it('asks for nothing when given nothing', async () => {
    vi.stubEnv('VITE_PUSH_API_URL', 'https://worker.example');
    const spy = vi.fn();
    globalThis.fetch = spy;
    expect(await fetchNowViaWorker([])).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('fetchModelAgreement', () => {
  function twoSeriesResponse(suffixA, suffixB, valuesA, valuesB) {
    return new Response(JSON.stringify({
      hourly: { ['wave_height_' + suffixA]: valuesA, ['wave_height_' + suffixB]: valuesB },
    }), { status: 200 });
  }

  it('tries the corrected pairing first, and succeeds on it', async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url) => {
      calls.push(String(url));
      return twoSeriesResponse('ecmwf_wam025', 'ncep_gfswave025', [1, 1.1, 1], [1, 1.1, 1]);
    });
    const result = await fetchModelAgreement({ lat: 1, lon: 2 }, [0, 1, 2], { fetchImpl });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('models=ecmwf_wam025,ncep_gfswave025');
    expect(result.level).toBe('high');
  });

  it('falls through to the next candidate when a pair returns only one usable series', async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call++;
      if (call === 1) {
        // One valid model key, one that never came back -- a half-wrong guess.
        return new Response(JSON.stringify({ hourly: { wave_height_ecmwf_wam025: [1, 1, 1] } }), { status: 200 });
      }
      return twoSeriesResponse('dwd_ewam', 'dwd_gwam', [2, 2, 2], [2, 2, 2]);
    });
    const result = await fetchModelAgreement({ lat: 1, lon: 2 }, [0, 1, 2], { fetchImpl });
    expect(call).toBe(2);
    expect(result.level).toBe('high');
  });

  it('reads per-model series by key shape, not by the exact name guessed', async () => {
    // If Open-Meteo's naming has moved again since this was last checked, a key that merely
    // starts with wave_height_ must still be picked up.
    const fetchImpl = vi.fn(async () => twoSeriesResponse('some_future_model_v3', 'another_one', [3, 5, 3], [3, 3, 3]));
    const result = await fetchModelAgreement({ lat: 1, lon: 2 }, [0, 1, 2], { fetchImpl });
    expect(result).not.toBeNull();
  });

  it('resolves to null, not a throw, when every candidate fails', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 400 }));
    await expect(fetchModelAgreement({ lat: 1, lon: 2 }, [0], { fetchImpl })).resolves.toBeNull();
  });

  it('resolves to null when the network itself is unreachable', async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    await expect(fetchModelAgreement({ lat: 1, lon: 2 }, [0], { fetchImpl })).resolves.toBeNull();
  });
});
