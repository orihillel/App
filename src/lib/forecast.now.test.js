import { describe, it, expect, vi } from 'vitest';
import { fetchNowForSpots, NOW_BATCH_SIZE } from './forecast.js';

const SPOT = { name: 'A spot', lat: 33.38, lon: -117.6, offshoreDeg: 60 };

// One location's worth of an Open-Meteo multi-location answer.
function location({ wave = 1.5, windDeg = 60, windMs = 3, time = '2026-09-06T13:00', tide = null } = {}) {
  return {
    marine: {
      current: {
        time, wave_height: wave, wave_period: 11, wave_direction: 220,
        swell_wave_height: wave * 0.9, swell_wave_direction: 220, swell_wave_period: 13,
        wind_wave_height: 0.3, wind_wave_direction: 300, wind_wave_period: 5,
        sea_surface_temperature: 19,
      },
      hourly: tide ? { time: tide.times, sea_level_height_msl: tide.values } : undefined,
    },
    wind: { current: { time, wind_speed_10m: windMs, wind_direction_10m: windDeg } },
  };
}

// A fetch that answers marine and wind separately and records every URL it was given.
function stubFetch(perLocation, { fail = () => false } = {}) {
  const urls = [];
  const impl = vi.fn(async (url) => {
    urls.push(url);
    if (fail(url, urls.length)) return { ok: false, status: 429, json: async () => ({}) };
    const n = new URL(url).searchParams.get('latitude').split(',').length;
    const kind = url.includes('marine') ? 'marine' : 'wind';
    const body = Array.from({ length: n }, (_, i) => perLocation(i)[kind]);
    return { ok: true, status: 200, json: async () => (n === 1 ? body[0] : body) };
  });
  return { impl, urls };
}

const spotsNamed = (n) => Array.from({ length: n }, (_, i) => ({ id: 'spot' + i, spot: { ...SPOT, lat: 30 + i * 0.01 } }));

describe('fetchNowForSpots', () => {
  it('asks for one value per spot instead of a week of hourly data', async () => {
    // The bug this exists for: a seven-day, eleven-variable forecast per spot, for the whole
    // catalog, measured at 809 requests on a single app open against a 600-a-minute limit.
    const { impl, urls } = stubFetch(() => location());
    await fetchNowForSpots(spotsNamed(3), { fetchImpl: impl });
    const marine = urls.find((u) => u.includes('marine'));
    expect(marine).toContain('current=');
    expect(marine).not.toMatch(/hourly=wave_height/);
    expect(marine).toContain('forecast_days=1');
  });

  it('covers every spot, in batches, however many there are', async () => {
    const { impl, urls } = stubFetch(() => location());
    const many = spotsNamed(NOW_BATCH_SIZE * 2 + 7);
    const out = await fetchNowForSpots(many, { fetchImpl: impl });
    expect(Object.keys(out)).toHaveLength(many.length);
    // Three batches of coordinates, two requests each — not one request per spot.
    expect(urls).toHaveLength(6);
    const covered = urls.filter((u) => u.includes('marine'))
      .reduce((n, u) => n + new URL(u).searchParams.get('latitude').split(',').length, 0);
    expect(covered).toBe(many.length);
  });

  it('is two requests a batch rather than two a spot', async () => {
    const { impl, urls } = stubFetch(() => location());
    await fetchNowForSpots(spotsNamed(100), { fetchImpl: impl });
    expect(urls).toHaveLength(2);
  });

  it('keeps going when one batch is refused, rather than losing the rest', async () => {
    // A rate limit answers some batches and not others. Losing the whole pass to the first 429
    // is how a partial outage becomes a total one.
    const { impl } = stubFetch(() => location(), { fail: (url) => url.includes('marine') && url.split(',').length > 50 && !url.includes('30.5') });
    const out = await fetchNowForSpots(spotsNamed(NOW_BATCH_SIZE + 5), { fetchImpl: impl });
    expect(Object.keys(out).length).toBeGreaterThan(0);
  });

  it('survives a batch that throws instead of answering', async () => {
    let call = 0;
    const impl = vi.fn(async (url) => {
      call++;
      if (call <= 2) throw new Error('network down');
      const n = new URL(url).searchParams.get('latitude').split(',').length;
      const kind = url.includes('marine') ? 'marine' : 'wind';
      return { ok: true, json: async () => Array.from({ length: n }, () => location()[kind]) };
    });
    const out = await fetchNowForSpots(spotsNamed(NOW_BATCH_SIZE + 3), { fetchImpl: impl });
    expect(Object.keys(out)).toHaveLength(3); // the second batch still landed
  });

  it('reads a single-location answer, which comes back as a bare object', async () => {
    const { impl } = stubFetch(() => location());
    const out = await fetchNowForSpots(spotsNamed(1), { fetchImpl: impl });
    expect(out.spot0.hours).toHaveLength(1);
  });

  it('produces a row the globe can colour a marker from', async () => {
    const { impl } = stubFetch(() => location({ wave: 1.5, windDeg: 60, windMs: 2 }));
    const out = await fetchNowForSpots(spotsNamed(1), { fetchImpl: impl });
    const [row] = out.spot0.hours;
    expect(typeof row.score).toBe('number');
    expect(['POOR', 'FAIR', 'GOOD', 'FIRING']).toContain(row.rating);
    expect(Number.isFinite(row.hour)).toBe(true);
  });

  it('marks the entry so it can never stand in for a real forecast', async () => {
    // The spot page reads a chart, a week and a tide curve from a forecast. One hour is not
    // one, and letting it pass as loaded leaves every spot but the first showing placeholders.
    const { impl } = stubFetch(() => location());
    const out = await fetchNowForSpots(spotsNamed(1), { fetchImpl: impl });
    expect(out.spot0.now).toBe(true);
    expect(out.spot0.continuous).toBeUndefined();
    expect(out.spot0.weekly).toBeUndefined();
  });

  it("takes each spot's own local hour from its own timestamp", async () => {
    // Every spot is in a different timezone; matching rows by clock hour is how the globe
    // reads them, so a single browser-local hour for all of them would be wrong nearly
    // everywhere.
    const { impl } = stubFetch((i) => location({ time: '2026-09-06T0' + i + ':00' }));
    const out = await fetchNowForSpots(spotsNamed(4), { fetchImpl: impl });
    expect([0, 1, 2, 3].map((i) => out['spot' + i].hours[0].hour)).toEqual([0, 1, 2, 3]);
  });

  it('scores with the tide, from the day of sea levels it asks for alongside', async () => {
    // Dropping the tide term here would score the globe by a different rule than the spot
    // page, which the app deliberately keeps as one.
    // Compared against *mid* tide, not against the opposite extreme: the score rewards being
    // near today's mid-tide, so a dead low and a dead high are equally far from it and score
    // the same. That is the rule working, and the first version of this test had it backwards.
    const times = Array.from({ length: 24 }, (_, i) => '2026-09-06T' + String(i).padStart(2, '0') + ':00');
    const ramp = Array.from({ length: 24 }, (_, i) => i);              // 13:00 sits mid-range
    const spike = Array.from({ length: 24 }, (_, i) => (i === 13 ? 1 : 0)); // 13:00 sits at the top
    const at = async (values) => {
      const { impl } = stubFetch(() => location({ tide: { times, values } }));
      const out = await fetchNowForSpots(spotsNamed(1), { fetchImpl: impl });
      return out.spot0.hours[0].score;
    };
    const midTide = await at(ramp);
    const fullTide = await at(spike);
    expect(midTide).toBeGreaterThan(fullTide);
    // And with no tide series at all the score still comes back, just without that term.
    const { impl } = stubFetch(() => location());
    const none = await fetchNowForSpots(spotsNamed(1), { fetchImpl: impl });
    expect(Number.isFinite(none.spot0.hours[0].score)).toBe(true);
  });

  it('skips a location the model has nothing for, rather than inventing a rating', async () => {
    const { impl } = stubFetch(() => ({ marine: { current: {} }, wind: { current: {} } }));
    const out = await fetchNowForSpots(spotsNamed(2), { fetchImpl: impl });
    expect(out).toEqual({});
  });

  it('ignores a spot with no usable coordinates instead of sending "undefined" upstream', async () => {
    const { impl, urls } = stubFetch(() => location());
    const out = await fetchNowForSpots([{ id: 'bad', spot: { offshoreDeg: 90 } }, ...spotsNamed(1)], { fetchImpl: impl });
    expect(Object.keys(out)).toEqual(['spot0']);
    expect(urls.join(' ')).not.toContain('undefined');
  });
});
