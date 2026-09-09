import { DAY_LABELS } from './spots.js';
import { degToCompass, windType, conditionsScore, scoreToRating } from './rating.js';
import { daylightHours } from './daylight.js';
import { hourLabel12 } from './format.js';
import { bestWindow } from './bestwindow.js';
import { swellTrains, wetsuitFor } from './swell.js';
import { confidenceForSeries, confidenceLabel } from './confidence.js';

// What to tell someone when the forecast did not arrive.
//
// Deliberately specific about rate limiting, because that is the failure this app is most
// likely to hit and the only one where waiting is genuinely the right advice: Open-Meteo's
// free tier is counted per location, so a single app open used to spend hundreds of calls
// colouring globe markers and could exhaust the day's allowance for the whole network.
export function describeForecastError(err) {
  const status = err && err.status;
  if (status === 429) return 'The forecast service is rate-limiting this connection. It usually clears within the hour.';
  if (status === 401 || status === 403) return 'The forecast service refused the request.';
  if (typeof status === 'number' && status >= 500) return 'The forecast service is having trouble (error ' + status + ').';
  if (typeof status === 'number') return 'The forecast service rejected the request (error ' + status + ').';
  if (err && err.message === 'Incomplete forecast data') return 'The forecast has no readings for this spot right now.';
  return 'Couldn\'t reach the forecast service.';
}

// Open-Meteo, straight from the browser. The fallback, not the first choice -- see fetchRaw.
async function fetchDirect(spot) {
  const marineUrl = 'https://marine-api.open-meteo.com/v1/marine?latitude=' + spot.lat + '&longitude=' + spot.lon +
    '&hourly=wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period,wind_wave_height,wind_wave_direction,wind_wave_period,sea_surface_temperature,sea_level_height_msl&daily=wave_height_max&timezone=auto&forecast_days=7';
  // sunrise/sunset drive which hours get sampled below, per spot and per date.
  const windUrl = 'https://api.open-meteo.com/v1/forecast?latitude=' + spot.lat + '&longitude=' + spot.lon +
    '&hourly=wind_speed_10m,wind_direction_10m&daily=sunrise,sunset&timezone=auto&forecast_days=7';
  const [marineRes, windRes] = await Promise.all([fetch(marineUrl), fetch(windUrl)]);
  if (!marineRes.ok || !windRes.ok) {
    // The status travels with the error. Every failure used to arrive at the spot page as the
    // same sentence -- "couldn't reach the forecast service" -- which reads the same whether
    // the service is down, the request is malformed, or this device has simply run out of
    // quota for the hour. Those want three different things from the person reading it, and
    // from anyone trying to work out afterwards what went wrong.
    const bad = marineRes.ok ? windRes : marineRes;
    const err = new Error('Forecast request failed');
    err.status = bad.status;
    throw err;
  }
  const [marine, wind] = await Promise.all([marineRes.json(), windRes.json()]);
  return { marine, wind };
}

// Where a spot's two upstream payloads come from.
//
// The Worker first, when one is configured. It calls Open-Meteo from Cloudflare's addresses
// and caches the answer, so one upstream fetch per spot serves everyone -- rather than every
// visitor spending an allowance that Open-Meteo counts per location and shares across everyone
// behind one address. Exhausting it is what made every spot page read "no forecast" while the
// globe, fed by this same Worker, looked perfectly healthy.
//
// Falling back to a direct call keeps the app working with no Worker configured at all, and if
// the Worker is missing or broken. But *only* then: when the Worker answers that the upstream
// refused it, asking Open-Meteo again from here would be refused too, and would spend one more
// of the allowance to learn nothing. That status is passed straight through instead.
async function fetchRaw(spot) {
  const base = import.meta.env.VITE_PUSH_API_URL;
  if (base) {
    let res = null;
    try {
      res = await fetch(base + '/forecast?lat=' + spot.lat + '&lon=' + spot.lon);
    } catch { /* Worker unreachable -- fall through and ask Open-Meteo directly */ }
    if (res && res.ok) {
      const body = await res.json().catch(() => null);
      if (body && body.marine && body.wind) return { marine: body.marine, wind: body.wind };
      // A 200 that isn't a forecast means this Worker predates the endpoint. Go direct.
    } else if (res && res.status !== 404) {
      const body = await res.json().catch(() => null);
      const err = new Error('Forecast request failed');
      err.status = (body && body.status) || res.status;
      throw err;
    }
  }
  return fetchDirect(spot);
}

// A real, harmonic tide prediction for this spot, from the Worker's NOAA proxy -- see
// worker/src/noaaTide.js for why that is worth having and worker/src/index.js's /tide for
// where it comes from. Never thrown from: no Worker configured, no station nearby (NOAA's
// coverage is the US and its territories), or the request simply failing all come back the
// same way, as "nothing real to use here," which is the signal to keep the modeled curve.
async function fetchRealTide(spot, { fetchImpl = fetch } = {}) {
  const base = import.meta.env.VITE_PUSH_API_URL;
  if (!base || !spot) return null;
  try {
    const res = await fetchImpl(base + '/tide?lat=' + spot.lat + '&lon=' + spot.lon);
    if (!res.ok) return null;
    const body = await res.json().catch(() => null);
    return body && Array.isArray(body.predictions) && body.predictions.length ? body : null;
  } catch {
    return null;
  }
}

// Builds the function fetchSpotForecast actually reads tide heights through, from whatever
// fetchRealTide came back with (or nothing).
//
// Both sources are looked up by the same key -- an ISO local timestamp truncated to the hour
// ("2026-09-08T14:00" and NOAA's own "2026-09-08 14:00" both become "2026-09-08 14") -- rather
// than by array index, because the two are on different clocks: Open-Meteo indexes a 7-day
// array from hour zero of its own local day, NOAA answers with whatever hours its predictions
// endpoint chose to return. Matching by index would quietly pair the wrong hour together the
// moment those two disagreed about where a day starts.
//
// They also measure from different floors, which is the harder half. NOAA answers on MLLW
// (mean lower low water -- the chart datum a printed tide table uses, so its numbers are
// essentially all positive); Open-Meteo's sea_level_height_msl is on MSL, swinging either side
// of zero. The gap between those two floors is a few feet at a typical station.
//
// No array built here is ever entirely one source, so that gap cannot be ignored: NOAA answers
// for today and tomorrow while the week chart runs seven days, so its later days are always
// modeled. Substituting hour by hour without reconciling the datums left a cliff at the
// boundary -- 3.4ft in one hour, on a curve whose steepest real hour was 0.85ft. That is not a
// small error in a number, it is a different tide: nextTideEvent reads high and low off exactly
// that shape, and it called a high tide at 11am on a day whose high was at noon.
//
// So both are put on one floor before either is read. A datum difference is a fixed vertical
// shift, so the mean difference across every hour the two both cover estimates it directly,
// and averaging over a day of a periodic curve also averages out the model's own wobble.
// NOAA's numbers are left alone and the modeled curve is lifted onto them, rather than the
// reverse, so a US spot reads the same heights as the tide table at the harbour -- on the days
// NOAA covers and on the days it does not.
const MIN_DATUM_OVERLAP_HOURS = 6;
const tideHourKey = (t) => t.replace('T', ' ').slice(0, 13);

function realTideLookup(realTide, times, modeledMetres) {
  const byHour = new Map();
  if (realTide && Array.isArray(realTide.predictions)) {
    for (const p of realTide.predictions) {
      if (typeof p.t !== 'string' || !Number.isFinite(p.ft)) continue;
      byHour.set(tideHourKey(p.t), p.ft);
    }
  }
  const modeled = Array.isArray(modeledMetres) ? modeledMetres : [];
  const modeledFtAt = (idx) => (modeled[idx] != null ? modeled[idx] * 3.28084 : null);

  // null means "use the modeled curve as it is and substitute nothing" -- the state every
  // non-US spot is in, and the one to fall back to whenever the two cannot be reconciled.
  let offset = null;
  if (byHour.size) {
    let sum = 0, overlap = 0, modeledHours = 0;
    for (let i = 0; i < modeled.length; i++) {
      const m = modeledFtAt(i);
      if (m == null) continue;
      modeledHours++;
      const t = times && times[i];
      const real = typeof t === 'string' ? byHour.get(tideHourKey(t)) : undefined;
      if (real != null) { sum += real - m; overlap++; }
    }
    // No modeled curve at all means there is nothing to mix and nothing to reconcile: the
    // real series stands on its own. Otherwise the offset has to be worth trusting before any
    // substitution happens, because a bad one is worse than not substituting -- too little
    // overlap and the safe answer is the single curve that is at least self-consistent.
    if (!modeledHours) offset = 0;
    else if (overlap >= MIN_DATUM_OVERLAP_HOURS) offset = sum / overlap;
  }

  return (isoLocalTime, idx) => {
    if (offset != null && typeof isoLocalTime === 'string') {
      const real = byHour.get(tideHourKey(isoLocalTime));
      if (real != null) return real;
    }
    const m = modeledFtAt(idx);
    return m == null ? null : m + (offset == null ? 0 : offset);
  };
}

export async function fetchSpotForecast(spot) {
  // Run alongside the main fetch, not after it: real tide is a pure bonus over the modeled
  // curve every spot already gets, on the same footing as the buoy panel and the model
  // agreement badge -- never allowed to slow the page down or fail it. No extra .catch here:
  // fetchRealTide's own body is entirely inside its own try/catch and cannot throw, which a
  // mutation test confirmed by proving an outer one was never actually reachable -- rather than
  // keep it as reassurance nothing exercises, the guarantee is fetchRealTide's contract instead.
  const [{ marine, wind }, realTide] = await Promise.all([fetchRaw(spot), fetchRealTide(spot)]);
  const tideFtAt = realTideLookup(realTide, (marine.hourly || {}).time, (marine.hourly || {}).sea_level_height_msl);

  // Which hours to sample, from this spot's own sunrise and sunset rather than a fixed
  // 5am-7pm list — see lib/daylight.js for why that fixed list was actively wrong at the
  // high-latitude spots in the catalog.
  const windDaily = wind.daily || {};
  const sampledHours = daylightHours(
    (windDaily.sunrise || [])[0],
    (windDaily.sunset || [])[0],
  );

  // Of those, the ones the models actually have a reading for.
  //
  // The marine model is gridded over open water, so a cell close in to shore can come back
  // empty for a few hours while the rest of the week is fine. This used to throw on the first
  // such hour and lose everything: no chart, no week, no tide, no best window -- the same
  // "no forecast right now" a total outage produces, from a spot with six good hours in the
  // day and seven good days behind them. An hour with no reading is dropped instead, which
  // is not the same as inventing one; the day simply has fewer points, exactly as it already
  // does for a short winter day (see lib/daylight.js).
  const hourIndices = sampledHours.filter((idx) => {
    const mh = marine.hourly || {};
    const whh = wind.hourly || {};
    return (mh.wave_height ? mh.wave_height[idx] : null) != null
      && (whh.wind_speed_10m ? whh.wind_speed_10m[idx] : null) != null
      && (whh.wind_direction_10m ? whh.wind_direction_10m[idx] : null) != null;
  });
  // Nothing usable anywhere in the window is still a failure, and still says so.
  if (!hourIndices.length) throw new Error('Incomplete forecast data');

  // Every hour of today's tide, in feet — the curve the tide chart draws, and the range each
  // hour is scored against.
  //
  // All 24 hours, not just the ones the page samples. Each hour is scored by where it sits
  // between today's low and today's high (see conditionsScore), and a tide does not wait for
  // daylight to turn: scaling against the sampled window instead makes whichever sampled hour
  // happens to be lowest read as dead low, however far from the real low it is. On a diurnal
  // tide whose low falls at 2am that is not a rounding difference — the 5am hour reads 0.00
  // when the sea is really 15% of the way up the day, and tideFit hands a low-tide spot its
  // full bonus for an hour that is not low tide.
  const timesAllForTide = (marine.hourly || {}).time || [];
  const tideFine = [];
  for (let i = 0; i < Math.min(24, timesAllForTide.length); i++) {
    const ft = tideFtAt(timesAllForTide[i], i);
    if (ft == null) continue;
    tideFine.push({ hour: i, ft });
  }
  const tMin = tideFine.length ? Math.min(...tideFine.map((p) => p.ft)) : null;
  const tMax = tideFine.length ? Math.max(...tideFine.map((p) => p.ft)) : null;
  const seaToday = hourIndices.map((idx) => tideFtAt(timesAllForTide[idx], idx));

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
      // The raw values the two above were built from. Nothing downstream should ever need to
      // reparse "3-5" back into a float or re-derive tide position from a different curve —
      // that already happened once, correctly, right here. See lib/calibration.js, which reads
      // these to recompute a corrected wave/score/rating without repeating this function.
      //
      // windMph alongside the already-rounded windSpd, not instead of it: conditionsScore's
      // thresholds are whole numbers, and rounding first would round some hours across a
      // threshold the raw value never crossed (10.3mph rounds to 10 and passes "<=10"; 10.3
      // itself does not). A recompute built on windSpd would occasionally rate the same hour
      // differently from how it was rated the first time, for a reason that has nothing to do
      // with calibration.
      waveFt, tidePosition, windMph,
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
  // Tide heights all come through tideFtAt, which already holds the modeled sea-level curve
  // from this same marine call and the real NOAA prediction where there is one — see
  // realTideLookup for how those two are reconciled onto a single datum. A tide is
  // astronomically deterministic, so a harmonic prediction is strictly more accurate for the
  // timing of highs and lows than pulling one from the same model as the wave and wind
  // numbers; away from NOAA's coverage the modeled curve is exactly what it always was.
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
      tideFt: tideFtAt(timesAll[idx], idx),
      windSpd: cWindMph != null ? Math.round(cWindMph) : null,
      windDeg: cWindDeg,
      score: cScore,
      rating: cScore != null ? scoreToRating(cScore) : null,
      day: DAY_LABELS[d.getDay()],
      hour: d.getHours(),
      dayStart: d.getHours() < 2,
    });
  }

  const tideToday = hourIndices.map((idx) => tideFtAt(timesAll[idx], idx));

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
//
// The original three guesses were checked later, by searching Open-Meteo's own docs rather
// than calling the API (still blocked here). None of them survive: `gfs_wave025` and bare
// `ewam`/`gwam` are not real identifiers, and `ecmwf_wam,gfs_wave` is missing the suffix every
// real one carries -- so this most likely never rendered the badge at all, on any spot,
// silently, exactly as it was built to fail. The two front candidates below come from that
// same search and are two independently-run centres (NOAA and ECMWF; then MeteoFrance and
// ECMWF), which is the pairing the badge is meant to compare in the first place. The old
// guesses stay on the end rather than being deleted -- Open-Meteo's own docs disagree with
// each other on some of these across pages, which reads as identifiers that have moved before,
// so a candidate that is wrong today costs nothing kept and might be right on some future
// deploy that broke a newer one.
const CONFIDENCE_MODEL_PAIRS = [
  'ecmwf_wam025,ncep_gfswave025',
  'dwd_ewam,dwd_gwam',
  'meteofrance_wave,ecmwf_wam025',
  'ecmwf_wam025,gfs_wave025', 'ewam,gwam', 'ecmwf_wam,gfs_wave',
];

export async function fetchModelAgreement(spot, hourIndices, { fetchImpl = fetch } = {}) {
  for (const pair of CONFIDENCE_MODEL_PAIRS) {
    try {
      const url = 'https://marine-api.open-meteo.com/v1/marine?latitude=' + spot.lat +
        '&longitude=' + spot.lon + '&hourly=wave_height&timezone=auto&forecast_days=3&models=' + pair;
      const res = await fetchImpl(url);
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

// One "right now" reading for many spots at once, in a handful of requests.
//
// This exists because of an arithmetic mistake with a very clear signature. The app used to
// call fetchSpotForecast for *every spot in the catalog* — two requests each, seven days of
// hourly data, eleven marine variables — on open and again every ten minutes. Measured in a
// browser: **809 requests on a single app open**, against a free tier that allows 600 calls a
// minute and 10,000 a day. It was over budget at 348 spots and hopeless at 403; the symptom is
// the app failing to fetch anything, because the tail of the catalog is answered with 429s.
//
// Almost all of that data was thrown away. Everything except the spot on screen exists to
// colour a marker on the globe, and a marker needs one number: the score right now. Seven days
// of hourly detail per spot is 168 times more than that.
//
// So: `current=` instead of `hourly=`, and Open-Meteo's comma-separated multi-location form
// (the same one worker/src/waveGrid.js uses) instead of one request per spot. 403 spots become
// ten requests rather than 806, and a few thousand values rather than three quarters of a
// million.
export const NOW_BATCH_SIZE = 100;

const MARINE_CURRENT = 'wave_height,wave_period,wave_direction,swell_wave_height,swell_wave_direction,swell_wave_period,wind_wave_height,wind_wave_direction,wind_wave_period,sea_surface_temperature';

// The tide *position* — where the sea sits between today's own low and high — cannot be read
// from a single instant, so today's curve comes along for the ride. One extra variable at
// daily resolution keeps the globe's colours scored by the same rule as the spot page, rather
// than quietly dropping a term from one of them.
const MARINE_HOURLY = 'sea_level_height_msl';

function coords(list, key) {
  return list.map((s) => s[key]).join(',');
}

// Open-Meteo answers a multi-location request with an array, and a single-location one with a
// bare object. Accepting both means a one-spot batch cannot silently produce nothing.
function asList(payload, n) {
  const list = Array.isArray(payload) ? payload : [payload];
  return list.length >= n ? list : new Array(n).fill(null);
}

// The globe's "right now" readings, from the Worker rather than from here.
//
// One reading is 36 billed values (see the Worker's handleConditions), so a browser fetching
// them for a whole catalog spends more than a day's free allowance in a single globe open.
// Through the Worker they are cached per spot and shared by everyone, and this asks only for
// what is on screen.
//
// Returns null when there is no Worker configured or it cannot answer, which is the caller's
// signal to fall back to asking Open-Meteo directly.
export async function fetchNowViaWorker(ids, { fetchImpl = fetch } = {}) {
  const base = import.meta.env.VITE_PUSH_API_URL;
  if (!base || !Array.isArray(ids) || !ids.length) return null;
  try {
    const res = await fetchImpl(base + '/conditions?ids=' + encodeURIComponent(ids.join(',')));
    if (!res.ok) return null;
    const body = await res.json();
    return body && body.spots && typeof body.spots === 'object' ? body.spots : null;
  } catch {
    return null;
  }
}

export async function fetchNowForSpots(spotList, { fetchImpl = fetch, batchSize = NOW_BATCH_SIZE, now = new Date() } = {}) {
  const out = {};
  // Every batch failing is a different thing from a few cells having no reading, and the only
  // way to tell them apart from the outside is to say so. Reported alongside the results rather
  // than thrown, because a partial answer is still worth drawing.
  const failures = [];
  const usable = spotList.filter((s) => s && s.spot && Number.isFinite(s.spot.lat) && Number.isFinite(s.spot.lon));
  for (let start = 0; start < usable.length; start += batchSize) {
    const batch = usable.slice(start, start + batchSize);
    const spots = batch.map((b) => b.spot);
    // No `timezone=auto`. A single-location request takes it happily, but it is not accepted
    // alongside a list of coordinates — every spot would need its own zone — and one rejected
    // parameter fails the whole batch, which is every marker on the globe at once. The Worker's
    // own multi-location request omits it for the same reason. Times come back in UTC and the
    // local hour is worked out below.
    const marineUrl = 'https://marine-api.open-meteo.com/v1/marine?latitude=' + coords(spots, 'lat')
      + '&longitude=' + coords(spots, 'lon')
      + '&current=' + MARINE_CURRENT + '&hourly=' + MARINE_HOURLY + '&forecast_days=1';
    const windUrl = 'https://api.open-meteo.com/v1/forecast?latitude=' + coords(spots, 'lat')
      + '&longitude=' + coords(spots, 'lon')
      + '&current=wind_speed_10m,wind_direction_10m&forecast_days=1';
    let marine;
    let wind;
    try {
      const [mRes, wRes] = await Promise.all([fetchImpl(marineUrl), fetchImpl(windUrl)]);
      if (!mRes.ok || !wRes.ok) {
        failures.push((mRes.ok ? wRes : mRes).status || 0);
        continue; // a failed batch leaves those markers grey, not wrong
      }
      [marine, wind] = await Promise.all([mRes.json(), wRes.json()]);
    } catch {
      failures.push(0);
      continue;
    }
    const marineList = asList(marine, batch.length);
    const windList = asList(wind, batch.length);
    for (let i = 0; i < batch.length; i++) {
      const row = nowRow(batch[i].spot, marineList[i], windList[i], now);
      if (row) out[batch[i].id] = { hours: [row], now: true };
    }
  }
  Object.defineProperty(out, 'failedBatches', { value: failures, enumerable: false });
  return out;
}

// One hour-shaped row, so the globe reads it with exactly the same code it reads a full
// forecast with. Anything the spot page needs and this cannot supply is simply absent, and the
// entry is marked `now` so the app knows not to let it stand in for a real forecast.
function nowRow(spot, marine, wind, now) {
  const mc = marine && marine.current;
  const wc = wind && wind.current;
  if (!mc || !wc) return null;
  const waveM = mc.wave_height;
  const windMs = wc.wind_speed_10m;
  const windDeg = wc.wind_direction_10m;
  if (waveM == null || windMs == null || windDeg == null) return null;

  const waveFt = waveM * 3.28084;
  const windMph = windMs * 0.621371;
  const period = mc.swell_wave_period != null ? Math.round(mc.swell_wave_period)
    : (mc.wave_period != null ? Math.round(mc.wave_period) : 0);
  const swellDeg = mc.swell_wave_direction != null ? mc.swell_wave_direction
    : (mc.wave_direction != null ? mc.wave_direction : 0);
  const trains = swellTrains({
    swellHeightFt: mc.swell_wave_height != null ? mc.swell_wave_height * 3.28084 : null,
    swellPeriod: mc.swell_wave_period,
    swellDeg: mc.swell_wave_direction,
    windWaveHeightFt: mc.wind_wave_height != null ? mc.wind_wave_height * 3.28084 : null,
    windWavePeriod: mc.wind_wave_period,
    windWaveDeg: mc.wind_wave_direction,
  });
  const dominant = trains[0] || null;
  const type = windType(windDeg, spot.offshoreDeg);
  const score = conditionsScore(
    waveFt, windMph, type,
    dominant && dominant.period != null ? dominant.period : period,
    dominant && dominant.deg != null ? dominant.deg : swellDeg,
    spot.offshoreDeg, tidePositionNow(marine, mc.time), spot,
  );
  const hour = localHour(mc.time, spot.lon, now);
  return {
    t: hourLabel12(hour), hour, wave: Math.max(1, Math.round(waveFt) - 1) + '-' + (Math.round(waveFt) + 1),
    period, swellDir: degToCompass(swellDeg), swellDeg, windSpd: Math.round(windMph),
    windDir: degToCompass(windDeg), windDeg, type, score, rating: scoreToRating(score), trains,
  };
}

// Where the sea sits between today's own low and high, from the day of sea levels fetched
// alongside — the same measure the spot page scores with.
function tidePositionNow(marine, currentTime) {
  const hourly = marine && marine.hourly;
  const series = (hourly && hourly.sea_level_height_msl) || null;
  if (!Array.isArray(series)) return null;
  const values = series.filter((v) => v != null);
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (!(max > min)) return null;
  const times = (hourly.time || []);
  let idx = typeof currentTime === 'string' ? times.findIndex((t) => t.slice(0, 13) === currentTime.slice(0, 13)) : -1;
  if (idx < 0) idx = 0;
  const at = series[idx];
  return at == null ? null : (at - min) / (max - min);
}

// The spot's own local hour.
//
// The batched request cannot ask for per-location timezones (see above), so the timestamps come
// back in UTC and local time is the UTC hour offset by the spot's longitude — fifteen degrees to
// the hour. That is the solar hour rather than the civil one, so it can be an hour off where a
// country's legal timezone is skewed or on daylight saving. It is only used to label the row and
// to match it against a clock hour on the globe; nothing is scored from it.
function localHour(time, lon, now) {
  const utc = typeof time === 'string' ? Number(time.slice(11, 13)) : NaN;
  const base = Number.isFinite(utc) ? utc : now.getUTCHours();
  const shift = Number.isFinite(lon) ? Math.round(lon / 15) : 0;
  return ((base + shift) % 24 + 24) % 24;
}
