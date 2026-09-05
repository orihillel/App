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
  gridCells, gridCellCount, encodeHeights, bytesToBase64,
} from '../../src/lib/wavegrid.js';

export const GRID_KEY = 'wavegrid:v1';

// WaveWatch III — the model behind Open-Meteo's marine data — runs four times a day, at 00,
// 06, 12 and 18Z. Refreshing faster than the model updates would spend the API budget
// re-fetching numbers that have not changed, so the cadence is matched to the source rather
// than picked for feel.
export const REFRESH_MS = 6 * 60 * 60 * 1000;

// Open-Meteo takes comma-separated coordinates and answers with one object per location. The
// batch is kept well short of any single-URL limit, and the batches run in sequence rather than
// all at once: this is a free service doing us a favour, and a thousand-point burst from one
// Worker is how you get an IP blocked.
export const BATCH_SIZE = 100;

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
  try {
    const res = await fetchImpl(url);
    if (!res.ok) return cells.map(() => null);
    payload = await res.json();
  } catch {
    return cells.map(() => null);
  }
  // A multi-location request answers with an array; a single-location one answers with a bare
  // object. Accepting both means a one-cell batch (or an API that decides to normalise) cannot
  // silently produce a grid of nulls.
  const list = Array.isArray(payload) ? payload : [payload];
  const wanted = currentHourIso(now);
  return cells.map((_, i) => {
    const loc = list[i];
    const hourly = loc && loc.hourly;
    if (!hourly || !Array.isArray(hourly.time) || !Array.isArray(hourly.wave_height)) return null;
    let idx = hourly.time.findIndex((t) => typeof t === 'string' && t.startsWith(wanted));
    if (idx < 0) idx = 0; // clock skew, or a model run that starts later today
    const v = hourly.wave_height[idx];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  });
}

// Fetch every cell and pack the result.
export async function buildGrid(opts = {}) {
  const cells = gridCells();
  const heights = new Array(cells.length).fill(null);
  for (let start = 0; start < cells.length; start += BATCH_SIZE) {
    const batch = cells.slice(start, start + BATCH_SIZE);
    const values = await fetchBatch(batch, opts);
    for (let i = 0; i < batch.length; i++) heights[start + i] = values[i];
  }
  return {
    generatedAt: opts.now || Date.now(),
    cells: cells.length,
    data: bytesToBase64(encodeHeights(heights)),
  };
}

function isUsable(grid) {
  return grid && typeof grid.data === 'string' && grid.cells === gridCellCount();
}

// The cached grid, refreshed when stale.
//
// A refresh that fails returns the previous grid rather than nothing: a six-hour-old wave field
// is a good description of the ocean, and blanking the overlay because one fetch failed would
// be a worse answer than a slightly old one. `stale: true` lets the app say so.
export async function loadGrid(env, opts = {}) {
  const now = opts.now || Date.now();
  let cached = null;
  try {
    cached = await env.SUBSCRIPTIONS.get(GRID_KEY, { type: 'json' });
  } catch { /* KV unavailable: fall through and try a fresh build */ }

  if (isUsable(cached) && now - cached.generatedAt < REFRESH_MS) {
    return { ...cached, stale: false };
  }

  let fresh = null;
  try {
    fresh = await (opts.build ? opts.build(opts) : buildGrid({ ...opts, now }));
  } catch { /* handled below */ }

  // A build that came back all-null is a failed build wearing a successful one's clothes —
  // upstream down, or the request shape rejected. Keeping the old grid is strictly better.
  const gotAnything = fresh && typeof fresh.data === 'string'
    && bytesToBase64(new Uint8Array(0)) !== fresh.data
    && fresh.data !== bytesToBase64(encodeHeights(new Array(gridCellCount()).fill(null)));

  if (fresh && gotAnything) {
    try {
      await env.SUBSCRIPTIONS.put(GRID_KEY, JSON.stringify(fresh));
    } catch { /* the grid is still worth returning even if it could not be cached */ }
    return { ...fresh, stale: false };
  }
  if (isUsable(cached)) return { ...cached, stale: true };
  return null;
}
