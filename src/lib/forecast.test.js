import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchSpotForecast, geocodePlace, findOffshoreDirection } from './forecast.js';

const SPOT = { lat: 33.38, lon: -117.6, offshoreDeg: 60 };

// 24 hourly values so both the HOUR_INDICES samples (up to index 19) and the
// today-tide-range calculation have real numbers to work with.
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
function makeWindResponse() {
  return {
    hourly: {
      wind_speed_10m: hourly(24, () => 5), // m/s -> ~11mph
      wind_direction_10m: hourly(24, () => 60), // matches offshoreDeg exactly
    },
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
    expect(result.hours).toHaveLength(8); // one per HOUR_LABELS slot
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

  it('throws on a wave-height gap instead of guessing a value for it', async () => {
    const marine = makeMarineResponse();
    marine.hourly.wave_height[5] = null; // HOUR_INDICES includes 5
    fetch.mockImplementation((url) =>
      Promise.resolve(mockFetchOnce(url.includes('marine-api') ? marine : makeWindResponse()))
    );
    await expect(fetchSpotForecast(SPOT)).rejects.toThrow('Incomplete forecast data');
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
