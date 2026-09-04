import { parseLatestObs, LATEST_OBS_URL, nearestWaveStation, isFresh, toObservation } from './buoys.js';

// Where live buoy readings come from.
//
// There is no such thing as "all the buoys" behind one API. The global moored-buoy network is a
// patchwork of national programmes — NOAA in the US, IOLR in Israel, the Marine Institute in
// Ireland, Puertos del Estado in Spain, MHL in New South Wales — each publishing in its own
// format, on its own schedule, with its own idea of what a station record looks like. The
// nearest thing to a global registry (the WMO's DBCP) distributes over the GTS, which is not
// something a web app can query.
//
// So: a registry of sources, each normalising to the same station shape, each independently
// allowed to fail. Adding a country means adding one entry here, not touching the endpoint.
//
// A NOTE ON WHAT IS VERIFIED. The sandbox this was written in blocks every one of these hosts
// at the egress proxy, so no response format below has been checked against a live server.
// NDBC's fixed-width table is a long-standing documented format and its parser is covered by a
// realistic fixture (which caught a real column bug). The others are written from their
// published formats and are covered by fixtures too, but a fixture only proves the parser
// matches *my understanding* of the format. Each source is therefore fail-safe: a source whose
// shape turns out to be wrong yields no stations and the others still answer.

// Normalised station shape, shared by every source:
//   { station, lat, lon, waveHeightM, dominantPeriodS, meanWaveDirDeg, waterTempC, observedAt }

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'surfcast-surf-app' } });
  if (!res.ok) throw new Error(url + ' -> ' + res.status);
  return res.text();
}

// --- NOAA NDBC (United States, plus its international partners) --------------------------
// The one source whose format is not in doubt. See buoys.js.
const ndbc = {
  id: 'ndbc',
  label: 'NOAA NDBC',
  ttlSeconds: 600,
  async load() {
    return parseLatestObs(await fetchText(LATEST_OBS_URL));
  },
};

// --- ISRAMAR / IOLR (Israel) ------------------------------------------------------------
// Israel Oceanographic and Limnological Research runs the deep-sea buoys off Haifa and Ashdod,
// which are the only wave measurements anywhere near the Israeli coast — NDBC has nothing in
// the eastern Mediterranean, so without this the buoy panel simply never appears in Israel.
//
// UNVERIFIED SHAPE: this parser reads a JSON series of the form ISRAMAR publishes, but the
// endpoint could not be called from the sandbox. If it is wrong it returns nothing and the
// panel stays hidden, exactly as it does today — no worse than the status quo.
export const ISRAMAR_STATIONS = [
  { station: 'IOLR-Haifa', url: 'https://isramar.ocean.org.il/isramar2009/station/data/Haifa_deep_sea_buoy.json', lat: 32.79, lon: 34.95 },
  { station: 'IOLR-Ashdod', url: 'https://isramar.ocean.org.il/isramar2009/station/data/Ashdod_deep_sea_buoy.json', lat: 31.83, lon: 34.57 },
];

export function parseIsramar(json, meta) {
  if (!json || typeof json !== 'object') return null;
  // Accept either a bare latest-reading object or a series whose last entry is the newest.
  const rows = Array.isArray(json) ? json : (Array.isArray(json.data) ? json.data : [json]);
  const last = rows[rows.length - 1];
  if (!last || typeof last !== 'object') return null;
  const num = (...keys) => {
    for (const k of keys) {
      const v = last[k];
      if (v == null || v === '') continue;
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
    return null;
  };
  const waveHeightM = num('Hs', 'hs', 'wave_height', 'significant_wave_height');
  if (waveHeightM == null) return null;
  const time = last.datetime || last.time || last.date || last.timestamp;
  const observedAt = time ? Date.parse(String(time).endsWith('Z') ? time : time + 'Z') : null;
  return {
    station: meta.station,
    lat: meta.lat,
    lon: meta.lon,
    waveHeightM,
    dominantPeriodS: num('Tp', 'tp', 'peak_period', 'dominant_period'),
    meanWaveDirDeg: num('Dir', 'dir', 'wave_direction', 'mean_direction'),
    waterTempC: num('Tw', 'tw', 'water_temp', 'sea_temperature'),
    observedAt: Number.isFinite(observedAt) ? observedAt : null,
  };
}

const isramar = {
  id: 'isramar',
  label: 'ISRAMAR / IOLR (Israel)',
  ttlSeconds: 900,
  async load() {
    const out = [];
    // One station failing must not lose the other.
    for (const meta of ISRAMAR_STATIONS) {
      try {
        const parsed = parseIsramar(JSON.parse(await fetchText(meta.url)), meta);
        if (parsed) out.push(parsed);
      } catch { /* this station is unavailable right now */ }
    }
    return out;
  },
};

export const SOURCES = [ndbc, isramar];

// Every source, cached separately so a slow or broken one cannot invalidate the others, and
// merged into one station list. A source that throws contributes nothing and is not retried
// within this request.
export async function loadAllStations(env, { fetchSource } = {}) {
  const results = await Promise.all(SOURCES.map(async (source) => {
    const key = 'buoys:' + source.id;
    try {
      // Parsed here rather than via KV's typed get(key, 'json'), so this works against any
      // KV-shaped binding — including the in-memory fake the tests use.
      const cached = await env.SUBSCRIPTIONS.get(key);
      if (cached) return JSON.parse(cached);
      const stations = (fetchSource ? await fetchSource(source) : await source.load()) || [];
      await env.SUBSCRIPTIONS.put(key, JSON.stringify(stations), { expirationTtl: source.ttlSeconds });
      return stations;
    } catch {
      return [];
    }
  }));
  return results.flat();
}

export { nearestWaveStation, isFresh, toObservation };
