// The global wave-height grid behind the globe's ocean overlay.
//
// The grid definition is shared with the app (../../src/lib/wavegrid.js) so that the bytes
// written here and the bytes read there can never disagree about which cell is which.
//
// This lives in the Worker rather than the app for the same reason /buoy does, only more so.
// It is over a thousand upstream points, it is identical for every user, and it changes a few
// times a day. Fetched per-browser it would be a thousand requests each, every session; fetched
// once here on a schedule it is a couple of KB from KV, and it is the only version that fits
// inside a free API's daily budget at all.
import {
  gridCells, gridCellCount, encodeHeights, bytesToBase64, base64ToBytes, NO_DATA,
} from '../../src/lib/wavegrid.js';

export const GRID_KEY = 'wavegrid:v1';

// WaveWatch III — the model behind Open-Meteo's marine data — runs four times a day, at 00,
// 06, 12 and 18Z. Refreshing faster than the model updates would spend the API budget
// re-fetching numbers that have not changed, so the cadence is matched to the source rather
// than picked for feel.
export const REFRESH_MS = 6 * 60 * 60 * 1000;

// Open-Meteo takes comma-separated coordinates and answers with one object per location.
export const BATCH_SIZE = 100;

// Paced, because the unpaced version shipped broken in a very specific way.
//
// The first build fired all 17 batches back to back in about two seconds. Roughly the first
// half came back; the rest did not — and since gridCells() runs south to north, that rendered
// as a swell map with a southern hemisphere and nothing above the equator. A burst limiter is
// the obvious reading: not a bad request shape (that would fail every batch alike) but too many
// requests too fast.
//
// So batches are spaced, failures are retried after a longer pause, and — the part that turned
// one bad build into a persistent one — an incomplete grid is no longer cached as though it
// were good.
// 100 points every 12 seconds is 500 a minute, under Open-Meteo's documented 600/minute, and
// walks the whole grid in about 3.2 minutes. That is a long time for a request and nothing at
// all for a cron job: it is spent awaiting, not computing, and Cron Triggers allow far more
// wall time than this. Under a minute of pacing would still be over the limit, so the choice
// is really between a slow build and a broken one.
export const BATCH_GAP_MS = 12000;
export const RETRY_PAUSES_MS = [5000, 15000];

// Cloudflare's free plan allows 50 subrequests per invocation, so retries need a budget rather
// than an appetite: 17 batches plus retries must not walk past it and have the runtime cut the
// build off mid-way — which would look exactly like the bug being fixed here.
export const MAX_REQUESTS = 45;

// A build that reached less than this much of the ocean is a failure, not a map. Half a world
// of real data next to half a world of nothing does not read as "partial" on a globe; it reads
// as "the northern hemisphere is flat", which is worse than showing no overlay at all.
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
// Returns nulls rather than throwing for anything it cannot read: a batch that fails leaves
// its patch of ocean unpainted, which is honest, while an exception would lose the other
// twelve batches that did work.
export async function fetchBatch(cells, { fetchImpl = fetch, now = Date.now() } = {}) {
  const url = MARINE_URL
    + '?latitude=' + cells.map((c) => c.lat.toFixed(2)).join(',')
    + '&longitude=' + cells.map((c) => c.lon.toFixed(2)).join(',')
    + '&hourly=wave_height&forecast_days=1';
  let payload;
  let status = null;
  try {
    const res = await fetchImpl(url);
    status = res.status ?? null;
    // 429 and friends are the whole reason this function reports a status: without it a
    // rate-limited batch is indistinguishable from an ocean that happens to have no data.
    if (!res.ok) return { values: cells.map(() => null), ok: false, status };
    payload = await res.json();
  } catch {
    return { values: cells.map(() => null), ok: false, status };
  }
  // A multi-location request answers with an array; a single-location one answers with a bare
  // object. Accepting both means a one-cell batch (or an API that decides to normalise) cannot
  // silently produce a grid of nulls.
  const list = Array.isArray(payload) ? payload : [payload];
  const wanted = currentHourIso(now);
  const values = cells.map((_, i) => {
    const loc = list[i];
    const hourly = loc && loc.hourly;
    if (!hourly || !Array.isArray(hourly.time) || !Array.isArray(hourly.wave_height)) return null;
    let idx = hourly.time.findIndex((t) => typeof t === 'string' && t.startsWith(wanted));
    if (idx < 0) idx = 0; // clock skew, or a model run that starts later today
    const v = hourly.wave_height[idx];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  });
  // A 200 carrying nothing usable is still a failed batch, and worth retrying.
  return { values, ok: values.some((v) => v != null), status };
}

// Fetch every cell and pack the result.
//
// `coverage` rides along so a caller — and anyone reading the endpoint — can tell a whole
// ocean from half of one without having to decode the bytes and eyeball a globe.
export async function buildGrid(opts = {}) {
  const wait = opts.sleep || sleep;
  const cells = gridCells();
  const heights = new Array(cells.length).fill(null);
  const starts = [];
  for (let start = 0; start < cells.length; start += BATCH_SIZE) starts.push(start);

  let requests = 0;
  let pending = starts;
  const attempts = [0, ...RETRY_PAUSES_MS];

  for (let round = 0; round < attempts.length && pending.length; round++) {
    if (attempts[round]) await wait(attempts[round]);
    const failed = [];
    for (const start of pending) {
      if (requests >= MAX_REQUESTS) { failed.push(start); continue; }
      // Space the requests apart, but never pay the gap before the very first one.
      if (requests > 0) await wait(opts.gapMs ?? BATCH_GAP_MS);
      requests++;
      const batch = cells.slice(start, start + BATCH_SIZE);
      const { values, ok } = await fetchBatch(batch, opts);
      if (!ok) { failed.push(start); continue; }
      for (let i = 0; i < batch.length; i++) heights[start + i] = values[i];
    }
    pending = failed;
  }

  // Land is legitimately null, so coverage is measured against the cells that came back at all
  // rather than against the ocean — a batch that failed contributes nothing either way.
  const got = heights.reduce((n, v) => n + (v != null ? 1 : 0), 0);
  return {
    generatedAt: opts.now || Date.now(),
    cells: cells.length,
    data: bytesToBase64(encodeHeights(heights)),
    coverage: Math.round((got / cells.length) * 1000) / 1000,
    requests,
  };
}

// Coverage as recorded by the build, or measured from the bytes for a grid stored before the
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
    // Also applied to what is already in KV, so the half-world grid cached by the unpaced
    // build is discarded on the next read instead of being served until it expires.
    && coverageOf(grid) >= MIN_COVERAGE;
}

// The cached grid, refreshed when stale.
//
// A refresh that fails returns the previous grid rather than nothing: a six-hour-old wave field
// is a good description of the ocean, and blanking the overlay because one fetch failed would
// be a worse answer than a slightly old one. `stale: true` lets the app say so.
export async function loadGrid(env, opts = {}) {
  const now = opts.now || Date.now();
  // A build is paced across minutes, so it must never happen inside a user's request — that
  // would hang their fetch for the length of the build. Reads serve whatever is cached and
  // return promptly; the scheduled handler is the only caller that builds.
  const mayBuild = opts.mayBuild !== false;
  let cached = null;
  try {
    cached = await env.SUBSCRIPTIONS.get(GRID_KEY, { type: 'json' });
  } catch { /* KV unavailable: fall through and try a fresh build */ }

  if (isUsable(cached) && now - cached.generatedAt < REFRESH_MS) {
    return { ...cached, stale: false };
  }

  if (!mayBuild) {
    // Nothing good cached and not allowed to build: say so, and let the cron fill it in.
    return isUsable(cached) ? { ...cached, stale: true } : null;
  }

  let fresh = null;
  try {
    fresh = await (opts.build ? opts.build(opts) : buildGrid({ ...opts, now }));
  } catch { /* handled below */ }

  // Good enough to keep? This used to ask only whether the build was *entirely* empty, which
  // is why a half-fetched grid — every batch after the ninth rate-limited away — was cached and
  // served for six hours as a swell map with nothing north of the equator. An incomplete grid
  // is a failed build wearing a successful one's clothes, and the old grid beats it.
  const usable = fresh && typeof fresh.data === 'string'
    && fresh.cells === gridCellCount()
    && coverageOf(fresh) >= MIN_COVERAGE;

  if (usable) {
    try {
      await env.SUBSCRIPTIONS.put(GRID_KEY, JSON.stringify(fresh));
    } catch { /* the grid is still worth returning even if it could not be cached */ }
    return { ...fresh, stale: false };
  }
  if (isUsable(cached)) return { ...cached, stale: true };
  return null;
}
