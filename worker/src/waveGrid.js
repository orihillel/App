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
  gridCells, gridCellCount, encodeHeights, bytesToBase64,
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

// A build that queried less than this much of the grid is not a map. Half a world of data reads
// as "the rest of the ocean is flat", which is worse than showing no overlay at all.
//
// Coverage means *how much of the grid was successfully queried*, which is not the same as how
// many cells held water. Measuring non-null values instead — the first version — counted every
// land cell as a failure, and roughly an eighth of the grid is land even by a coarse coastline
// (finer than that, Open-Meteo also returns nothing for enclosed seas, lakes and shallow
// coastal cells). A flawless build scored about 0.85 against a threshold of 0.85, so the gate
// was unpassable however well the fetch worked. The app said so exactly: "Fetched 5 of 5
// batches" with no error, and no map.
export const MIN_COVERAGE = 0.85;

// After a failed build, stop trying for a while.
//
// Without this, every tap of the overlay toggle fires another five upstream requests, and a
// failure is exactly when they are least affordable — a rate limit answered by more traffic. It
// also matters because a *daily* quota, once spent, cannot recover until it resets: retrying
// into it just keeps it spent. Tonight's broken builds each cost ~4,800 units against a ~10,000
// daily allowance, which is how a bug in one request parameter became an outage.
export const FAIL_COOLDOWN_MS = 10 * 60 * 1000;
export const FAIL_KEY = 'wavegrid:fail:v1';

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
// Asks for `current` rather than an hourly series, and that is the whole fix. The overlay needs
// exactly one number per cell — the wave height right now — but this was requesting
// `hourly=wave_height&forecast_days=1`, which is **24 values per location**, and discarding 23
// of them. Open-Meteo bills by values returned, so each 100-cell batch cost 2,400 units instead
// of 100. The grid blew the per-minute allowance two batches in, which is exactly what the app
// reported: "Fetched 2 of 5 batches · HTTP 429 · Minutely API request limit exceeded".
//
// One value per location instead of 24 makes the whole grid 406 units rather than 9,744.
//
// Never throws. It reports what happened instead — status code and the upstream's own reason —
// because for five rounds there was no way to tell a rate limit from a rejected request shape
// from an unreachable host.
export async function fetchBatch(cells, opts = {}) {
  const first = await requestBatch(cells, 'current', opts);
  if (first.ok || first.status === 429 || first.status == null) return first;
  // A 4xx that is not a rate limit may mean this deployment's Open-Meteo does not offer
  // `current` on the marine endpoint. Falling back to the hourly series costs more, but a
  // working overlay beats a correct-but-empty one, and it only happens when `current` is
  // refused outright.
  const fallback = await requestBatch(cells, 'hourly', opts);
  return fallback.ok ? fallback : first;
}

async function requestBatch(cells, mode, { fetchImpl = fetch, now = Date.now() } = {}) {
  const url = MARINE_URL
    + '?latitude=' + cells.map((c) => c.lat.toFixed(2)).join(',')
    + '&longitude=' + cells.map((c) => c.lon.toFixed(2)).join(',')
    + (mode === 'current' ? '&current=wave_height' : '&hourly=wave_height&forecast_days=1');
  let payload;
  let status = null;
  try {
    const res = await fetchImpl(url);
    status = typeof res.status === 'number' ? res.status : null;
    if (!res.ok) {
      // Open-Meteo puts the cause in the body on a 4xx, and that sentence is what finally
      // ended five rounds of guessing. It is always worth carrying back.
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
  // "Answered" counts locations that came back with a readable reading, whatever it held. A
  // batch sitting entirely over Antarctica legitimately returns nothing but nulls, and judging
  // success by non-null values would mark it failed and retry it forever.
  let answered = 0;
  const values = cells.map((_, i) => {
    const loc = list[i];
    if (!loc) return null;
    // Either shape is read, whichever the request asked for, so the fallback needs no separate
    // parser and a server that answers with both cannot confuse it.
    if (loc.current && 'wave_height' in loc.current) {
      answered++;
      const v = loc.current.wave_height;
      return typeof v === 'number' && Number.isFinite(v) ? v : null;
    }
    const hourly = loc.hourly;
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
    error: answered > 0 ? null : 'response carried no readable wave height',
  };
}

// Build the whole grid in one go, reporting what happened.
export async function buildGrid(opts = {}) {
  const wait = opts.sleep || sleep;
  const cells = gridCells();
  const heights = new Array(cells.length).fill(null);
  let batchesDone = 0;
  let batchesTotal = 0;
  let cellsQueried = 0;
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
    cellsQueried += batch.length;
    for (let i = 0; i < batch.length; i++) heights[start + i] = values[i];
  }

  // Queried, not watery: a batch that answered covers its cells whatever those cells contained.
  const queried = batchesTotal > 0 ? cellsQueried / cells.length : 0;
  let withData = 0;
  for (const v of heights) if (v != null) withData++;
  return {
    generatedAt: opts.now || Date.now(),
    cells: cells.length,
    data: bytesToBase64(encodeHeights(heights)),
    coverage: Math.round(queried * 1000) / 1000,
    // Kept for information only. It is never a gate, because land legitimately has no wave
    // height and treating that as missing data is the bug this replaced.
    oceanCells: withData,
    batchesDone,
    batchesTotal,
    lastStatus,
    lastError,
  };
}

// Coverage as recorded by the build.
//
// It is deliberately not inferred from the bytes for an entry that lacks the field: the bytes
// cannot tell land from a batch that never answered, and guessing at that distinction is what
// made the gate unpassable. An entry without a recorded coverage is simply rebuilt once.
function coverageOf(grid) {
  return grid && typeof grid.coverage === 'number' ? grid.coverage : 0;
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

  // A recent failure means don't ask again yet: report what went wrong last time instead of
  // spending five more requests to be told the same thing.
  let failure = null;
  try {
    failure = await env.SUBSCRIPTIONS.get(FAIL_KEY, { type: 'json' });
  } catch { /* no cooldown record readable; proceed to build */ }
  if (failure && failure.at && now - failure.at < FAIL_COOLDOWN_MS && !opts.ignoreCooldown) {
    return {
      grid: isUsable(cached) ? { ...cached, stale: true } : null,
      build: { ...failure.build, cooling: true, retryInSeconds: Math.round((FAIL_COOLDOWN_MS - (now - failure.at)) / 1000) },
    };
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
      await env.SUBSCRIPTIONS.delete(FAIL_KEY);
    } catch { /* still worth returning even if it could not be cached */ }
    return { grid: { ...fresh, stale: false }, build };
  }

  // Remember the failure so the next few minutes of taps cost nothing upstream.
  try {
    await env.SUBSCRIPTIONS.put(FAIL_KEY, JSON.stringify({ at: now, build }));
  } catch { /* the cooldown is an optimisation, not a correctness requirement */ }
  // An old complete grid is a better answer than a fresh partial one.
  if (isUsable(cached)) return { grid: { ...cached, stale: true }, build };
  return { grid: null, build };
}
