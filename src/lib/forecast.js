import { DAY_LABELS } from './spots.js';
import { degToCompass, windType, conditionsScore, scoreToRating } from './rating.js';
import { daylightHours } from './daylight.js';
import { hourLabel12 } from './format.js';
import { bestWindow } from './bestwindow.js';
import { swellTrains, wetsuitFor } from './swell.js';
import { confidenceForSeries, confidenceLabel } from './confidence.js';

export async function fetchSpotForecast(spot) {
  const marineUrl = 'https://marine-api.open-meteo.com/v1/marine?latitude=' + spot.lat + '&longitude=' + spot.lon +
    '&hourly=wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period,wind_wave_height,wind_wave_direction,wind_wave_period,sea_surface_temperature,sea_level_height_msl&daily=wave_height_max&timezone=auto&forecast_days=7';
  // sunrise/sunset drive which hours get sampled below, per spot and per date.
  const windUrl = 'https://api.open-meteo.com/v1/forecast?latitude=' + spot.lat + '&longitude=' + spot.lon +
    '&hourly=wind_speed_10m,wind_direction_10m&daily=sunrise,sunset&timezone=auto&forecast_days=7';
  const [marineRes, windRes] = await Promise.all([fetch(marineUrl), fetch(windUrl)]);
  if (!marineRes.ok || !windRes.ok) throw new Error('Forecast request failed');
  const marine = await marineRes.json();
  const wind = await windRes.json();

  // Which hours to sample, from this spot's own sunrise and sunset rather than a fixed
  // 5am-7pm list — see lib/daylight.js for why that fixed list was actively wrong at the
  // high-latitude spots in the catalog.
  const windDaily = wind.daily || {};
  const hourIndices = daylightHours(
    (windDaily.sunrise || [])[0],
    (windDaily.sunset || [])[0],
  );

  // Today's tide range, computed up front so each hour can be scored by how close it sits
  // to today's own mid-tide (see conditionsScore) — not an absolute tide height.
  const mhForTide = marine.hourly || {};
  const seaToday = hourIndices.map((idx) => (mhForTide.sea_level_height_msl ? mhForTide.sea_level_height_msl[idx] : null));
  const validTidesToday = seaToday.filter((v) => v != null);
  const tMin = validTidesToday.length ? Math.min(...validTidesToday) : null;
  const tMax = validTidesToday.length ? Math.max(...validTidesToday) : null;

  const hours = hourIndices.map((idx, i) => {
    const mh = marine.hourly || {};
    const wh = mh.wave_height ? mh.wave_height[idx] : null;
    const wp = mh.wave_period ? mh.wave_period[idx] : null;
    const wdir = mh.wave_direction ? mh.wave_direction[idx] : null;
    const sp = mh.swell_wave_period ? mh.swell_wave_period[idx] : null;
    const sd = mh.swell_wave_direction ? mh.swell_wave_direction[idx] : null;
    const whh = wind.hourly || {};
    const ws = whh.wind_speed_10m ? whh.wind_speed_10m[idx] : null;
    const wdd = whh.wind_direction_10m ? whh.wind_direction_10m[idx] : null;
    if (wh == null || ws == null || wdd == null) throw new Error('Incomplete forecast data');
    const waveFt = wh * 3.28084;
    const windMph = ws * 0.621371;
    const period = sp != null ? Math.round(sp) : Math.round(wp != null ? wp : 0);
    const swellDeg = sd != null ? sd : (wdir != null ? wdir : 0);
    // The two trains, kept apart rather than collapsed into one number — see lib/swell.js.
    const trains = swellTrains({
      swellHeightFt: mh.swell_wave_height && mh.swell_wave_height[idx] != null ? mh.swell_wave_height[idx] * 3.28084 : null,
      swellPeriod: sp,
      swellDeg: sd,
      windWaveHeightFt: mh.wind_wave_height && mh.wind_wave_height[idx] != null ? mh.wind_wave_height[idx] * 3.28084 : null,
      windWavePeriod: mh.wind_wave_period ? mh.wind_wave_period[idx] : null,
      windWaveDeg: mh.wind_wave_direction ? mh.wind_wave_direction[idx] : null,
    });
    const type = windType(wdd, spot.offshoreDeg);
    const tideVal = seaToday[i];
    const tidePosition = (tideVal != null && tMin != null && tMax != null && tMax > tMin) ? (tideVal - tMin) / (tMax - tMin) : null;
    // Score against the *dominant* train rather than the groundswell period regardless of how
    // little groundswell there is. Before the trains were separated this could not be told
    // apart: a 6ft day that is almost entirely 6-second wind chop, with a foot of 15-second
    // swell underneath it, was being scored as though the whole 6ft arrived at 15 seconds.
    const dominant = trains[0] || null;
    const scorePeriod = dominant && dominant.period != null ? dominant.period : period;
    const scoreSwellDeg = dominant && dominant.deg != null ? dominant.deg : swellDeg;
    const score = conditionsScore(waveFt, windMph, type, scorePeriod, scoreSwellDeg, spot.offshoreDeg, tidePosition, spot);
    const base = Math.max(1, Math.round(waveFt));
    return {
      t: hourLabel12(idx), hour: idx, wave: Math.max(1, base - 1) + '-' + (base + 1), period,
      swellDir: degToCompass(swellDeg), swellDeg, windSpd: Math.round(windMph),
      windDir: degToCompass(wdd), windDeg: wdd, type, score, rating: scoreToRating(score), trains,
    };
  });

  const daily = marine.daily || {};
  const dayTimes = daily.time || [];
  const dayWave = daily.wave_height_max || [];
  const weekly = dayTimes.map((dateStr, i) => {
    const waveM = dayWave[i];
    const d = new Date(dateStr + 'T00:00:00');
    return { day: DAY_LABELS[d.getDay()], waveFt: waveM != null ? waveM * 3.28084 : 0 };
  });

  const hAll = marine.hourly || {};
  const timesAll = hAll.time || [];
  const waveAll = hAll.wave_height || [];
  const periodAll = hAll.swell_wave_period || hAll.wave_period || [];
  const swellDirAll = hAll.swell_wave_direction || hAll.wave_direction || [];
  const windAllH = wind.hourly || {};
  const windSpeedAll = windAllH.wind_speed_10m || [];
  const windDirAll = windAllH.wind_direction_10m || [];
  // Live sea-level curve from the same marine call — this is a modeled tide (referenced to
  // global mean sea level, not a nautical chart datum), so heights won't match an official
  // tide table exactly, but the rise/fall shape and high/low timing are real.
  const seaAll = hAll.sea_level_height_msl || [];
  const continuous = [];
  for (let idx = 0; idx < timesAll.length; idx += 3) {
    if (waveAll[idx] == null) continue;
    const d = new Date(timesAll[idx]);
    const cWaveFt = waveAll[idx] * 3.28084;
    const cWindMph = windSpeedAll[idx] != null ? windSpeedAll[idx] * 0.621371 : null;
    const cWindDeg = windDirAll[idx] != null ? windDirAll[idx] : null;
    const cPeriod = periodAll[idx] != null ? Math.round(periodAll[idx]) : null;
    const cSwellDeg = swellDirAll[idx] != null ? swellDirAll[idx] : null;
    const cType = cWindDeg != null ? windType(cWindDeg, spot.offshoreDeg) : null;
    // No per-day tide range computed out here (would mean tracking a min/max per day across
    // the whole week), so this leaves tide out of the week-ahead score — the same score used
    // for today already includes it, just not this longer-range one.
    const cScore = cWindMph != null ? conditionsScore(cWaveFt, cWindMph, cType, cPeriod, cSwellDeg, spot.offshoreDeg, null, spot) : null;
    continuous.push({
      waveFt: cWaveFt,
      tideFt: seaAll[idx] != null ? seaAll[idx] * 3.28084 : null,
      windSpd: cWindMph != null ? Math.round(cWindMph) : null,
      windDeg: cWindDeg,
      score: cScore,
      rating: cScore != null ? scoreToRating(cScore) : null,
      day: DAY_LABELS[d.getDay()],
      hour: d.getHours(),
      dayStart: d.getHours() < 2,
    });
  }

  const tideToday = hourIndices.map((idx) => (seaAll[idx] != null ? seaAll[idx] * 3.28084 : null));
  const tideFine = [];
  for (let i = 0; i < Math.min(24, timesAll.length); i++) {
    if (seaAll[i] == null) continue;
    tideFine.push({ hour: i, ft: seaAll[i] * 3.28084 });
  }

  // Water temperature: one more hourly variable from the same marine call, and the answer to
  // "what do I take to the beach" that the app could not previously give at all.
  const sstNow = (hAll.sea_surface_temperature || [])[hourIndices[0]];
  const waterC = sstNow != null ? sstNow : null;

  return {
    hours, weekly, continuous, tideToday, tideFine,
    best: bestWindow(hours),
    waterC,
    wetsuit: wetsuitFor(waterC),
  };
}

// Model agreement, fetched separately and allowed to fail.
//
// Open-Meteo will serve individual models via `&models=`, and returns each one under a
// suffixed key (wave_height_<model>). The exact marine model identifiers could not be checked
// from the sandbox this was written in — open-meteo.com is blocked by its proxy — so rather
// than depend on getting a name right, this tries a few candidate pairs and reads whatever
// per-model keys come back, by pattern rather than by name. If none of them work the whole
// feature simply does not render: a wrong guess costs one failed request and nothing else.
const CONFIDENCE_MODEL_PAIRS = ['ecmwf_wam025,gfs_wave025', 'ewam,gwam', 'ecmwf_wam,gfs_wave'];

export async function fetchModelAgreement(spot, hourIndices) {
  for (const pair of CONFIDENCE_MODEL_PAIRS) {
    try {
      const url = 'https://marine-api.open-meteo.com/v1/marine?latitude=' + spot.lat +
        '&longitude=' + spot.lon + '&hourly=wave_height&timezone=auto&forecast_days=3&models=' + pair;
      const res = await fetch(url);
      if (!res.ok) continue;
      const json = await res.json();
      const hourly = json.hourly || {};
      // Read the per-model series by shape rather than by name, so this does not depend on
      // having guessed the identifiers correctly.
      const series = Object.keys(hourly)
        .filter((k) => k.startsWith('wave_height_') && Array.isArray(hourly[k]))
        .map((k) => hourly[k]);
      if (series.length < 2) continue;
      const pick = (arr) => hourIndices.map((i) => (arr[i] != null ? arr[i] : null));
      const level = confidenceForSeries(pick(series[0]), pick(series[1]));
      if (level) return { level, label: confidenceLabel(level) };
    } catch {
      // Offline, blocked, or an identifier this build guessed wrong: try the next pair.
    }
  }
  return null;
}

export async function geocodePlace(query) {
  const url = 'https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(query) + '&count=1&language=en&format=json';
  const res = await fetch(url);
  if (!res.ok) throw new Error('Geocoding failed');
  const data = await res.json();
  if (!data.results || !data.results.length) throw new Error('No results');
  const r = data.results[0];
  const region = [r.admin1, r.country].filter(Boolean).join(', ');
  return { name: r.name, region, lat: r.latitude, lon: r.longitude };
}

function toRad(d) { return (d * Math.PI) / 180; }
function toDeg(r) { return (r * 180) / Math.PI; }
function bearingBetween(lat1, lon1, lat2, lon2) {
  const p1 = toRad(lat1), p2 = toRad(lat2), dl = toRad(lon2 - lon1);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}
function metersXY(lat, lon, refLat) {
  const R = 6371000;
  return [toRad(lon) * Math.cos(toRad(refLat)) * R, toRad(lat) * R];
}
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}
export async function findOffshoreDirection(lat, lon) {
  const q = '[out:json][timeout:20];way["natural"="coastline"](around:4000,' + lat + ',' + lon + ');out geom;';
  const url = 'https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(q);
  const res = await fetch(url);
  if (!res.ok) throw new Error('Coastline lookup failed');
  const data = await res.json();
  const ways = (data.elements || []).filter((el) => el.geometry && el.geometry.length > 1);
  if (!ways.length) throw new Error('No coastline found nearby');
  const [px, py] = metersXY(lat, lon, lat);
  let best = null;
  ways.forEach((way) => {
    const g = way.geometry;
    for (let i = 0; i < g.length - 1; i++) {
      const [ax, ay] = metersXY(g[i].lat, g[i].lon, lat);
      const [bx, by] = metersXY(g[i + 1].lat, g[i + 1].lon, lat);
      const d = segDist(px, py, ax, ay, bx, by);
      if (!best || d < best.d) best = { d, a: g[i], b: g[i + 1] };
    }
  });
  if (!best) throw new Error('No coastline segment found');
  const alongBearing = bearingBetween(best.a.lat, best.a.lon, best.b.lat, best.b.lon);
  const seaward = (alongBearing + 90) % 360;
  return Math.round((seaward + 180) % 360);
}
