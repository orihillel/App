// Real, harmonic tide predictions for US spots, from NOAA's CO-OPS network -- the one part of
// this app's forecast that does not actually need forecasting. A tide is astronomically
// deterministic; predicting it needs no weather-model skill at all, so a proper harmonic
// prediction is strictly more accurate for the *timing* of highs and lows than pulling one from
// the same wave/wind model as everything else, which is what the app does everywhere it can't
// reach a real station — see lib/forecast.js's own comment on sea_level_height_msl being "a
// modeled tide... [that] won't match an official tide table exactly."
//
// Coverage is exactly NOAA's own network: the US, its territories, and a handful of affiliated
// stations. Everywhere else keeps the modeled curve unchanged — this never claims coverage it
// does not have, and never throws when it does: a station list that fails to parse, a
// prediction request that 404s, a spot with no station for a hundred kilometres, all fall
// straight through to "no real tide available," which the caller already treats as the default.
//
// Field names in the two responses below are read defensively rather than trusted outright.
// Neither NOAA endpoint could be called from the sandbox this was written in to confirm its
// exact shape, so a name that turns out wrong costs one station or one day of predictions
// quietly dropped, not a broken request — the same principle fetchModelAgreement already uses
// for Open-Meteo's own unverifiable model identifiers.

const STATIONS_URL = 'https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=tidepredictions';
const STATIONS_TTL_S = 24 * 60 * 60; // the station network changes on a timescale of years
// A prediction is astronomy, not forecasting: once computed for a given day it never changes.
// This TTL exists purely to bound how often NOAA gets asked, not because the answer goes stale.
const PREDICTIONS_TTL_S = 6 * 60 * 60;

// Real-world stations sit every few tens of kilometres along a maintained coast; past this,
// "nearest" stops meaning anything useful about the tide at the spot actually asked about.
const MAX_STATION_KM = 100;

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export async function loadTideStations(env, { fetchImpl = fetch } = {}) {
  const key = 'tide-stations:noaa';
  try {
    const cached = await env.SUBSCRIPTIONS.get(key);
    if (cached) return JSON.parse(cached);
  } catch { /* fall through to a fresh fetch */ }

  let stations = [];
  try {
    const res = await fetchImpl(STATIONS_URL);
    if (res.ok) {
      const body = await res.json();
      stations = (Array.isArray(body.stations) ? body.stations : [])
        .map((s) => ({
          id: s.id ?? s.stationId ?? null,
          name: s.name ?? null,
          lat: Number(s.lat ?? s.latitude),
          lon: Number(s.lng ?? s.lon ?? s.longitude),
        }))
        .filter((s) => s.id != null && Number.isFinite(s.lat) && Number.isFinite(s.lon));
    }
  } catch { /* stations stays [] -- every lookup below then safely finds nothing */ }

  try { await env.SUBSCRIPTIONS.put(key, JSON.stringify(stations), { expirationTtl: STATIONS_TTL_S }); } catch { /* not fatal */ }
  return stations;
}

export function nearestTideStation(stations, lat, lon, maxKm = MAX_STATION_KM) {
  let best = null;
  for (const s of stations || []) {
    const km = haversineKm(lat, lon, s.lat, s.lon);
    if (km > maxKm) continue;
    if (!best || km < best.km) best = { ...s, km };
  }
  return best;
}

// Two UTC calendar days of hourly predictions — enough to safely cover any US timezone's full
// local "today" regardless of where midnight UTC happens to fall relative to the station's own
// clock, without having to know that station's offset up front.
export async function loadPredictions(env, station, { fetchImpl = fetch, now = new Date() } = {}) {
  const fmt = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
  const begin = fmt(now);
  const end = fmt(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  const key = 'tide-predictions:' + station.id + ':' + begin;
  try {
    const cached = await env.SUBSCRIPTIONS.get(key);
    if (cached) return JSON.parse(cached);
  } catch { /* fall through to a fresh fetch */ }

  let predictions = [];
  try {
    const url = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter'
      + '?begin_date=' + begin + '&end_date=' + end + '&station=' + encodeURIComponent(station.id)
      + '&product=predictions&datum=MLLW&time_zone=lst_ldt&interval=h&units=english'
      + '&application=surfcast&format=json';
    const res = await fetchImpl(url);
    if (res.ok) {
      const body = await res.json();
      // "t" is a local timestamp like "2026-09-08 14:00" (a space, not a T) and "v" the
      // predicted height in feet against MLLW -- a different vertical datum than the modeled
      // curve's MSL, which does not matter here: nothing compares this height to any other
      // absolute-referenced number. Everything downstream reads it relative to itself (today's
      // own high and low, or the sample either side of a hover), the same as the modeled curve.
      predictions = (Array.isArray(body.predictions) ? body.predictions : [])
        .map((p) => ({ t: p.t, ft: Number(p.v) }))
        .filter((p) => typeof p.t === 'string' && Number.isFinite(p.ft));
    }
  } catch { /* predictions stays [] */ }

  try { await env.SUBSCRIPTIONS.put(key, JSON.stringify(predictions), { expirationTtl: PREDICTIONS_TTL_S }); } catch { /* not fatal */ }
  return predictions;
}
