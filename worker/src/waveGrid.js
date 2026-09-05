// The global wave-height grid behind the globe's ocean overlay.
//
// The grid definition is shared with the app (../../src/lib/wavegrid.js) so the bytes written
// here and the bytes read there can never disagree about which cell is which.
//
// This file was rewritten after four failed fixes, and the reason is worth recording. Each
// earlier version pushed the fetch further into the background — paced across minutes, sliced
// across cron runs, started via waitUntil — on the theory that the upstream rate limit was the
// problem. Then the endpoint reported `batchesDone: 0, startedAt: null`: no build had ever
// *started*. Every one of those fixes was tuning a build that was never running, and none of
// that machinery could be observed failing, because background work leaves no trace.
//
// So it is all gone. The grid is 406 points, which is 5 requests, which fits comfortably in one
// response. It is built when it is asked for, and whatever happens comes back in the reply.
import {
  gridCells, gridCellCount, encodeHeights, bytesToBase64, base64ToBytes, NO_DATA,
} from '../../src/lib/wavegrid.js';

export const GRID_KEY = 'wavegrid:v1';

// WaveWatch III — the model behind Open-Meteo's marine data — runs four times a day at 00, 06,
// 12 and 18Z. Refreshing faster would re-fetch numbers that have not changed.
export const REFRESH_MS = 6 * 60 * 60 * 1000;

// Open-Meteo takes comma-separated coordinates and answers with one object per location.
export const BATCH_SIZE = 100;

// A courtesy pause between batches, not a rate-limit strategy. 406 points across 5 requests is
// inside the free tier's per-minute allowance on its own; this just avoids firing them in the
// same instant.
export const BUILD_GAP_MS = 300;

// A build that reached less than this much of the grid is not a map. Half a world of data reads
// as "the rest of the ocean is flat", which is worse than showing no overlay at all.
export const MIN_COVERAGE = 0.85;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const MARINE_URL = 'https://marine-api.open-meteo.com/v1/marine';

// The nearest hour, since the grid describes "now" rather than a forecast.
function currentHourIso(now) {
  const d = new Date(now);
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString().slice(0, 13); // YYYY-MM-DDTHH
}

// One batch of cells -> their wave heights, positionally aligned with `cells`.
//
// Never throws. It reports what happened instead — status code and error text — because the one
// thing four blind fixes lacked was any way to tell a rate limit from a rejected request shape
// from an unreachable host.
export async function fetchBatch(cells, { fetchImpl = fetch, now = Date.now() } = {}) {
  const url = MARINE_URL
    + '?latitude=' + cells.map((c) => c.lat.toFixed(2)).join(',')
    + '&longitude=' + cells.map((c) => c.lon.toFixed(2)).join(',')
    + '&hourly=wave_height&forecast_days=1';
  let payload;
  let status = null;
  try {
    const res = await fetchImpl(url);
    status = typeof res.status === 'number' ? res.status : null;
    if (!res.ok) {
      // Open-Meteo puts the reason in the body on a 4xx — "latitude must be a number", say —
      // which is exactly the sentence that would have ended this days earlier.
      let reason = null;
      try {
        const body = await res.json();
        reason = (body && (body.reason || body.error)) || null;
      } catch { /* not JSON; the status alone will have to do */ }
      return { values: cells.map(() => null), ok: false, status, error: reason };
    }
    payload = await res.json();
  } catch (e) {
    return { values: cells.map(() => null), ok: false, status, error: String((e && e.message) || e) };
  }
  // A multi-location request answers with an array; a single-location one answers with a bare
  // object. Accepting both means a one-cell batch cannot silently produce a grid of nulls.
  const list = Array.isArray(payload) ? payload : [payload];
  const wanted = currentHourIso(now);
  // "Answered" counts locations that came back with a readable series, whatever it held. A
  // batch sitting entirely over Antarctica legitimately returns nothing but nulls, and judging
  // success by non-null values would mark it failed and retry it forever.
  let answered = 0;
  const values = cells.map((_, i) => {
    const loc = list[i];
    const hourly = loc && loc.hourly;
    if (!hourly || !Array.isArray(hourly.time) || !Array.isArray(hourly.wave_height)) return null;
    answered++;
    let idx = hourly.time.findIndex((t) => typeof t === 'string' && t.startsWith(wanted));
    if (idx < 0) idx = 0; // clock skew, or a model run that starts later today
    const v = hourly.wave_height[idx];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  });
  return {
    values,
    ok: answered > 0,
    status,
    error: answered > 0 ? null : 'response carried no readable hourly series',
  };
}

// Build the whole grid in one go, reporting what happened.
export async function buildGrid(opts = {}) {
  const wait = opts.sleep || sleep;
  const cells = gridCells();
  const heights = new Array(cells.length).fill(null);
  let batchesDone = 0;
  let batchesTotal = 0;
  let lastStatus = null;
  let lastError = null;

  for (let start = 0; start < cells.length; start += BATCH_SIZE) {
    batchesTotal++;
    if (batchesTotal > 1) await wait(opts.gapMs ?? BUILD_GAP_MS);
    const batch = cells.slice(start, start + BATCH_SIZE);
    const { values, ok, status, error } = await fetchBatch(batch, opts);
    if (!ok) {
      // Only failures are recorded. Keeping the *last* status of any kind meant a later
      // successful batch overwrote the 429 that explained the gap — the diagnostic erasing
      // itself, which is the failure mode this whole reporting path exists to prevent.
      lastStatus = status;
      lastError = error;
      continue;
    }
    batchesDone++;
    for (let i = 0; i < batch.length; i++) heights[start + i] = values[i];
  }

  let got = 0;
  for (const v of heights) if (v != null) got++;
  return {
    generatedAt: opts.now || Date.now(),
    cells: cells.length,
    data: bytesToBase64(encodeHeights(heights)),
    coverage: Math.round((got / cells.length) * 1000) / 1000,
    batchesDone,
    batchesTotal,
    lastStatus,
    lastError,
  };
}

// Coverage as recorded by the build, or measured from the bytes for a grid stored before that
// field existed — so an older cache entry is judged on the same terms as a new one.
function coverageOf(grid) {
  if (!grid || typeof grid.data !== 'string') return 0;
  if (typeof grid.coverage === 'number') return grid.coverage;
  try {
    const bytes = base64ToBytes(grid.data);
    if (!bytes.length) return 0;
    let got = 0;
    for (let i = 0; i < bytes.length; i++) if (bytes[i] !== NO_DATA) got++;
    return got / bytes.length;
  } catch {
    return 0;
  }
}

function isUsable(grid) {
  return !!grid && typeof grid.data === 'string'
    && grid.cells === gridCellCount()
    && coverageOf(grid) >= MIN_COVERAGE;
}

// The cached grid, rebuilt when stale or missing.
//
// Returns `{ grid, build }`: the map to draw, and what the last build attempt did. The
// diagnostics travel with the answer either way, so a failure says what happened rather than
// only that it happened.
export async function loadGrid(env, opts = {}) {
  const now = opts.now || Date.now();
  let cached = null;
  try {
    cached = await env.SUBSCRIPTIONS.get(GRID_KEY, { type: 'json' });
  } catch { /* KV unavailable: fall through and try a fresh build */ }

  if (isUsable(cached) && now - cached.generatedAt < REFRESH_MS) {
    return { grid: { ...cached, stale: false }, build: null };
  }

  let fresh;
  try {
    fresh = await (opts.build ? opts.build(opts) : buildGrid({ ...opts, now }));
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
      await env.SUBSCRIPTIONS.put(GRID_KEY, JSON.stringify(fresh));
    } catch { /* still worth returning even if it could not be cached */ }
    return { grid: { ...fresh, stale: false }, build };
  }
  // An old complete grid is a better answer than a fresh partial one.
  if (isUsable(cached)) return { grid: { ...cached, stale: true }, build };
  return { grid: null, build };
}
