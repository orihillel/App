// Live buoy observations from NOAA's National Data Buoy Center.
//
// Everything else in this app is a forecast — a model's opinion about the future. This is the
// one thing that is a measurement: what the ocean is actually doing right now, from an
// instrument in the water. It is also the piece a small app can genuinely compete on. Surfline's
// moat is a thousand HD cameras, which is not winnable; "the model says 4ft, and the buoy 20
// miles offshore says 4.2ft at 13 seconds" is, and most apps do not show it.
//
// It lives in the Worker rather than the browser because NDBC serves no CORS headers, so a page
// cannot read it directly — and because one upstream fetch here can serve every user and every
// spot, which is the polite way to consume a public service.

// NDBC publishes the latest observation from every station in a single fixed-width table, with
// each station's coordinates included. One request therefore covers the whole catalog.
export const LATEST_OBS_URL = 'https://www.ndbc.noaa.gov/data/latest_obs/latest_obs.txt';

// Columns of latest_obs.txt, after the two leading '#' header lines. Missing values are 'MM'.
const COL = {
  station: 0, lat: 1, lon: 2, year: 3, month: 4, day: 5, hour: 6, minute: 7,
  // Offsets from the first observation column: WDIR WSPD GST WVHT DPD APD MWD PRES PTDY
  // ATMP WTMP ... — note WTMP (water) sits one past ATMP (air), which is easy to misread.
  waveHeightM: 8 + 3, dominantPeriodS: 8 + 4, meanWaveDirDeg: 8 + 6, waterTempC: 8 + 10,
};

function num(token) {
  if (token == null || token === 'MM' || token === '') return null;
  const v = Number(token);
  return Number.isFinite(v) ? v : null;
}

export function parseLatestObs(text) {
  if (typeof text !== 'string') return [];
  const out = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const f = trimmed.split(/\s+/);
    if (f.length < 18) continue;
    const lat = num(f[COL.lat]);
    const lon = num(f[COL.lon]);
    if (lat == null || lon == null) continue;
    const y = num(f[COL.year]), mo = num(f[COL.month]), d = num(f[COL.day]);
    const h = num(f[COL.hour]), mi = num(f[COL.minute]);
    out.push({
      station: f[COL.station],
      lat,
      lon,
      waveHeightM: num(f[COL.waveHeightM]),
      dominantPeriodS: num(f[COL.dominantPeriodS]),
      meanWaveDirDeg: num(f[COL.meanWaveDirDeg]),
      waterTempC: num(f[COL.waterTempC]),
      // The table is published in UTC.
      observedAt: (y != null && mo != null && d != null && h != null && mi != null)
        ? Date.UTC(y, mo - 1, d, h, mi) : null,
    });
  }
  return out;
}

export function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// The nearest station that is actually reporting waves.
//
// Plenty of stations report wind and pressure but no wave height at all — inland lakes, met
// towers on piers — and one of those, however close, tells a surfer nothing. Stations without a
// wave reading are skipped rather than returned empty.
//
// The distance cap matters for honesty as much as for relevance: a buoy 400km away is measuring
// a different piece of ocean, and presenting it beside a spot's forecast would imply a
// correspondence that does not exist.
export const MAX_BUOY_KM = 250;

export function nearestWaveStation(stations, lat, lon, maxKm = MAX_BUOY_KM) {
  let best = null;
  for (const s of stations) {
    if (s.waveHeightM == null) continue;
    const km = haversineKm(lat, lon, s.lat, s.lon);
    if (km > maxKm) continue;
    if (!best || km < best.km) best = { ...s, km };
  }
  return best;
}

// A reading nobody has updated in hours is not "live". Stations drop out, and showing a stale
// number as a current observation is worse than showing nothing.
export const MAX_AGE_MS = 3 * 60 * 60 * 1000;

export function isFresh(observedAt, now = Date.now()) {
  if (observedAt == null) return false;
  const age = now - observedAt;
  // Small negative ages happen through clock skew between NDBC and the Worker; only reject
  // something meaningfully in the future.
  return age > -30 * 60 * 1000 && age < MAX_AGE_MS;
}

export function toObservation(station, now = Date.now()) {
  if (!station) return null;
  return {
    station: station.station,
    km: Math.round(station.km),
    waveFt: station.waveHeightM != null ? +(station.waveHeightM * 3.28084).toFixed(1) : null,
    period: station.dominantPeriodS != null ? Math.round(station.dominantPeriodS) : null,
    dirDeg: station.meanWaveDirDeg,
    waterC: station.waterTempC,
    observedAt: station.observedAt,
    ageMinutes: station.observedAt != null ? Math.round((now - station.observedAt) / 60000) : null,
  };
}
