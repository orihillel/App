// The global wind grid behind the globe's second overlay.
//
// A sibling of waveGrid.js rather than a generalisation of it. The two share a grid definition
// (../../src/lib/wavegrid.js), so a byte here and a byte there always describe the same piece of
// ocean, but almost nothing else about them is the same: a different upstream endpoint, a
// different pair of variables, a different encoding, and -- the reason a shared builder would
// have been wrong -- a different refresh cadence. Swell is a WaveWatch III product that updates
// four times a day; wind is re-forecast hourly, and a six-hour-old wind map is a different kind
// of wrong from a six-hour-old swell map.
//
// Wind is not on the marine endpoint. It comes from Open-Meteo's ordinary forecast API, which
// means a second pass over the grid rather than two more variables on the existing one.
import {
  gridCells, gridCellCount, encodeSpeeds, encodeDirections, bytesToBase64,
} from '../../src/lib/wavegrid.js';

// One point per cell still, so the rate limit still sets this. See the note in buildWindGrid.
export const WIND_LAT_STEP = 10;

export const WIND_KEY = 'windgrid:v1';

// Hourly, because that is how often the wind fields behind it are re-issued, and because wind
// is the fast-moving half of a surf forecast: the swell that arrives tomorrow was set days ago,
// the wind that ruins it arrives with the sea breeze.
export const REFRESH_MS = 60 * 60 * 1000;

// Same shape as the wave grid's: Open-Meteo takes comma-separated coordinates on this endpoint
// too and answers with one object per location.
export const BATCH_SIZE = 100;
export const BUILD_GAP_MS = 300;

// The same gate, for the same reason: half a world of wind reads as "the rest of the ocean is
// calm", which is worse than showing no overlay at all. Coverage is how much of the grid was
// successfully *queried*, never how many cells held a reading -- see waveGrid.js, where
// measuring the latter made the gate unpassable.
export const MIN_COVERAGE = 0.85;

export const FAIL_COOLDOWN_MS = 10 * 60 * 1000;
export const FAIL_KEY = 'windgrid:fail:v1';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

function currentHourIso(now) {
  const d = new Date(now);
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString().slice(0, 13);
}

// One batch of cells -> their wind speed and direction, positionally aligned with `cells`.
//
// `current` rather than an hourly series, which is the lesson waveGrid.js paid for: the overlay
// needs exactly one value per cell, and asking for `hourly` returns 24 and bills for all of
// them. One pass over the 406-cell grid is 406 units this way and 9,744 the other.
//
// Speed in km/h is Open-Meteo's own default, so nothing is converted before it is stored.
//
// Never throws. It reports the status and the upstream's own reason instead, because that
// sentence is the difference between a rate limit, a rejected request shape and an unreachable
// host -- three failures that look identical from the screen.
export async function fetchWindBatch(cells, opts = {}) {
  const first = await requestBatch(cells, 'current', opts);
  if (first.ok || first.status === 429 || first.status == null) return first;
  const fallback = await requestBatch(cells, 'hourly', opts);
  return fallback.ok ? fallback : first;
}

async function requestBatch(cells, mode, { fetchImpl = fetch, now = Date.now() } = {}) {
  const url = FORECAST_URL
    + '?latitude=' + cells.map((c) => c.lat.toFixed(2)).join(',')
    + '&longitude=' + cells.map((c) => c.lon.toFixed(2)).join(',')
    + (mode === 'current'
      ? '&current=wind_speed_10m,wind_direction_10m'
      : '&hourly=wind_speed_10m,wind_direction_10m&forecast_days=1');
  let payload;
  let status = null;
  try {
    const res = await fetchImpl(url);
    status = typeof res.status === 'number' ? res.status : null;
    if (!res.ok) {
      let reason = null;
      try {
        const body = await res.json();
        reason = (body && (body.reason || body.error)) || null;
      } catch { /* not JSON; the status alone will have to do */ }
      return { values: cells.map(() => null), directions: cells.map(() => null), ok: false, status, error: reason };
    }
    payload = await res.json();
  } catch (e) {
    return { values: cells.map(() => null), directions: cells.map(() => null), ok: false, status, error: String((e && e.message) || e) };
  }
  const list = Array.isArray(payload) ? payload : [payload];
  const wanted = currentHourIso(now);
  let answered = 0;
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const values = [];
  const directions = [];
  for (let i = 0; i < cells.length; i++) {
    const loc = list[i];
    if (!loc) { values.push(null); directions.push(null); continue; }
    if (loc.current && 'wind_speed_10m' in loc.current) {
      answered++;
      values.push(num(loc.current.wind_speed_10m));
      directions.push(num(loc.current.wind_direction_10m));
      continue;
    }
    const hourly = loc.hourly;
    if (!hourly || !Array.isArray(hourly.time) || !Array.isArray(hourly.wind_speed_10m)) {
      values.push(null); directions.push(null); continue;
    }
    answered++;
    let idx = hourly.time.findIndex((t) => typeof t === 'string' && t.startsWith(wanted));
    if (idx < 0) idx = 0;
    values.push(num(hourly.wind_speed_10m[idx]));
    directions.push(Array.isArray(hourly.wind_direction_10m) ? num(hourly.wind_direction_10m[idx]) : null);
  }
  return {
    values,
    directions,
    ok: answered > 0,
    status,
    error: answered > 0 ? null : 'response carried no readable wind speed',
  };
}

// Build the whole grid in one go, reporting what happened.
//
// Unlike the sea, the atmosphere has a reading everywhere -- there is wind over land, over ice
// and over the poles. The overlay is still cut to the coastline before it is drawn, so what is
// painted is the wind over water; but a cell that answers over Kansas is a real answer and must
// not be mistaken for a failed one.
export async function buildWindGrid(opts = {}) {
  const wait = opts.sleep || sleep;
  // Its own step, not the shared default. The swell grid moved to 2 degrees when the Worker
  // started building it from published files; wind has no such file yet (the wave model's
  // archive carries wave variables only), so it is still one point per cell and still bound by
  // the per-minute allowance that 406 cells was chosen to fit. Sharing the constant would have
  // sent this path after ten thousand points in a single pass.
  const cells = gridCells(WIND_LAT_STEP);
  const speeds = new Array(cells.length).fill(null);
  const directions = new Array(cells.length).fill(null);
  let batchesDone = 0;
  let batchesTotal = 0;
  let cellsQueried = 0;
  let lastStatus = null;
  let lastError = null;

  for (let start = 0; start < cells.length; start += BATCH_SIZE) {
    batchesTotal++;
    if (batchesTotal > 1) await wait(opts.gapMs ?? BUILD_GAP_MS);
    const batch = cells.slice(start, start + BATCH_SIZE);
    const { values, directions: dirs, ok, status, error } = await fetchWindBatch(batch, opts);
    if (!ok) {
      // Only failures are recorded, so a later good batch cannot overwrite the 429 that
      // explains the gap. See waveGrid.js -- the diagnostic erasing itself is the exact bug
      // this reporting path exists to prevent.
      lastStatus = status;
      lastError = error;
      continue;
    }
    batchesDone++;
    cellsQueried += batch.length;
    for (let i = 0; i < batch.length; i++) {
      speeds[start + i] = values[i];
      directions[start + i] = dirs ? dirs[i] : null;
    }
  }

  const queried = batchesTotal > 0 ? cellsQueried / cells.length : 0;
  let withData = 0;
  for (const v of speeds) if (v != null) withData++;
  return {
    generatedAt: opts.now || Date.now(),
    cells: cells.length,
    // Travels with the bytes so the app samples at the step this was actually built at.
    latStep: WIND_LAT_STEP,
    data: bytesToBase64(encodeSpeeds(speeds)),
    dirs: bytesToBase64(encodeDirections(directions)),
    coverage: Math.round(queried * 1000) / 1000,
    windCells: withData,
    batchesDone,
    batchesTotal,
    lastStatus,
    lastError,
  };
}

function coverageOf(grid) {
  return grid && typeof grid.coverage === 'number' ? grid.coverage : 0;
}

// Speed alone is servable; speed plus direction is what stops a rebuild.
//
// The same split the wave grid draws, and for the same reason: a map with no arrows beats a
// blank globe, so a grid missing its directions is rebuilt but never thrown away.
function isServable(grid) {
  return !!grid && typeof grid.data === 'string'
    && grid.cells === gridCellCount(typeof grid.latStep === 'number' ? grid.latStep : WIND_LAT_STEP)
    && coverageOf(grid) >= MIN_COVERAGE;
}

function isUsable(grid) {
  return isServable(grid) && typeof grid.dirs === 'string';
}

// The cached wind grid, rebuilt when stale or missing.
//
// Built only when it is asked for. That is not laziness, it is the budget: a wind pass is
// another 406 units against a daily allowance of roughly 10,000 that the swell grid and the
// animated week already draw on, so the app pays for this layer when someone actually looks at
// it and nothing when nobody does.
export async function loadWindGrid(env, opts = {}) {
  const now = opts.now || Date.now();
  let cached = null;
  try {
    cached = await env.SUBSCRIPTIONS.get(WIND_KEY, { type: 'json' });
  } catch { /* KV unavailable: fall through and try a fresh build */ }

  if (isUsable(cached) && now - cached.generatedAt < REFRESH_MS) {
    return { grid: { ...cached, stale: false }, build: null };
  }

  let failure = null;
  try {
    failure = await env.SUBSCRIPTIONS.get(FAIL_KEY, { type: 'json' });
  } catch { /* no cooldown record readable; proceed to build */ }
  if (failure && failure.at && now - failure.at < FAIL_COOLDOWN_MS && !opts.ignoreCooldown) {
    return {
      grid: isServable(cached) ? { ...cached, stale: true } : null,
      build: { ...failure.build, cooling: true, retryInSeconds: Math.round((FAIL_COOLDOWN_MS - (now - failure.at)) / 1000) },
    };
  }

  let fresh;
  try {
    fresh = await (opts.build ? opts.build(opts) : buildWindGrid({ ...opts, now }));
  } catch (e) {
    fresh = { batchesDone: 0, batchesTotal: 0, lastError: String((e && e.message) || e) };
  }

  const build = {
    batchesDone: fresh.batchesDone ?? 0,
    batchesTotal: fresh.batchesTotal ?? 0,
    coverage: fresh.coverage ?? 0,
    lastStatus: fresh.lastStatus ?? null,
    lastError: fresh.lastError ?? null,
  };

  if (isUsable(fresh)) {
    try {
      await env.SUBSCRIPTIONS.put(WIND_KEY, JSON.stringify(fresh));
      await env.SUBSCRIPTIONS.delete(FAIL_KEY);
    } catch { /* still worth returning even if it could not be cached */ }
    return { grid: { ...fresh, stale: false }, build };
  }

  try {
    await env.SUBSCRIPTIONS.put(FAIL_KEY, JSON.stringify({ at: now, build }));
  } catch { /* the cooldown is an optimisation, not a correctness requirement */ }
  if (isServable(cached)) return { grid: { ...cached, stale: true }, build };
  return { grid: null, build };
}
