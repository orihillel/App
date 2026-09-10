// The week-long animation behind the globe's swell overlay: 28 frames, six hours apart.
//
// The overlay has always drawn one moment. This is the same map through time, so you can watch
// a swell cross an ocean rather than infer it from a single frame.
//
// Everything about the shape of this is set by two hard budgets, and both have bitten this
// repository before.
//
// Open-Meteo bills by values returned -- locations times timesteps. A week of 6-hourly frames
// is 28 timesteps, and 28 of those on the live 406-cell grid is 11,368 units against a daily
// allowance of about 10,000: the animation would not fit in a day, let alone leave room for the
// spot forecasts. So the frames use their own coarser grid (FRAME_LAT_STEP, 186 cells) and the
// week costs 5,208. The overlay is interpolated to a 720x360 texture before it is drawn, so
// what is lost is detail in the swell field rather than blocks on the screen.
//
// Cloudflare's free plan allows 50 external subrequests per invocation. Open-Meteo accepts up
// to 1000 locations in one request, so all 186 cells go in a single fetch per frame: 28
// fetches, with room to spare. The planned count is checked before the build starts rather
// than discovered when the platform kills it half way.
import {
  gridCells, FRAME_LAT_STEP, encodeHeights, encodeDirections, bytesToBase64,
} from '../../src/lib/wavegrid.js';

export const FRAMES_KEY = 'waveframes:v2';
export const FRAME_COUNT = 28;        // 7 days
export const FRAME_STEP_H = 6;

// Rebuilt daily rather than every six hours like the live grid. It costs half a day's
// allowance, and a forecast four days out does not move enough between morning and evening to
// be worth spending that twice.
export const FRAMES_REFRESH_MS = 24 * 60 * 60 * 1000;

export const FRAMES_FAIL_KEY = 'waveframes:fail:v2';
export const FRAMES_FAIL_COOLDOWN_MS = 60 * 60 * 1000;

// Same reasoning as the live grid's gate: half a world of frames reads as "the rest of the
// ocean is flat", which is worse than offering no animation.
export const FRAMES_MIN_COVERAGE = 0.85;

// All 186 in one request. See the note above on Open-Meteo's 1000-location ceiling.
export const FRAME_BATCH_SIZE = 200;

// Kept below Cloudflare's 50 so a build cannot be killed part-way by the platform.
export const MAX_FETCHES = 45;

// The safety property this whole file turns on.
//
// Each frame asks for exactly one hour, via start_hour and end_hour. If those parameters were
// ever ignored rather than honoured, the request would answer with the full 168-hour series and
// the build would spend 186 x 168 = 31,248 units -- three days of allowance -- without erroring.
// That is not hypothetical: this overlay's own history includes a version that asked for 24
// values per cell and used one, and it took five rounds to find because nothing failed, it just
// silently cost 24x.
//
// So a frame that comes back with more timesteps than it asked for aborts the entire build.
// Stopping at the first over-long response caps the damage at one frame instead of 28.
export const MAX_TIMESTEPS_PER_FRAME = 1;

const MARINE_URL = 'https://marine-api.open-meteo.com/v1/marine';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const FRAME_GAP_MS = 120;

// The hours the frames describe: from the 6-hourly boundary at or before now, stepping forward.
// Anchored to a boundary rather than to the current minute so every device animating the same
// build steps through the same instants, and so the KV entry is reusable all day.
export function frameTimes(now = Date.now(), count = FRAME_COUNT) {
  const d = new Date(now);
  d.setUTCMinutes(0, 0, 0);
  d.setUTCHours(Math.floor(d.getUTCHours() / FRAME_STEP_H) * FRAME_STEP_H);
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push(new Date(d.getTime() + i * FRAME_STEP_H * 3600e3).toISOString().slice(0, 16));
  }
  return out;
}

// One frame: every cell's height and direction at a single hour.
//
// Never throws -- it reports. `overrun` is the one answer the caller must not continue past.
export async function fetchFrame(cells, isoHour, { fetchImpl = fetch } = {}) {
  const url = MARINE_URL
    + '?latitude=' + cells.map((c) => c.lat.toFixed(2)).join(',')
    + '&longitude=' + cells.map((c) => c.lon.toFixed(2)).join(',')
    + '&hourly=wave_height,wave_direction'
    + '&start_hour=' + encodeURIComponent(isoHour)
    + '&end_hour=' + encodeURIComponent(isoHour);

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
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const values = [];
  const directions = [];
  let answered = 0;
  for (let i = 0; i < cells.length; i++) {
    const loc = list[i];
    const hourly = loc && loc.hourly;
    if (!hourly || !Array.isArray(hourly.time) || !Array.isArray(hourly.wave_height)) {
      values.push(null); directions.push(null); continue;
    }
    // The guard. Checked per location because the first one is enough to know, and checking it
    // here means no shape of response can slip past.
    if (hourly.time.length > MAX_TIMESTEPS_PER_FRAME) {
      return {
        values: cells.map(() => null), directions: cells.map(() => null),
        ok: false, status, overrun: hourly.time.length,
        error: 'asked for one hour and got ' + hourly.time.length + '; start_hour was not honoured',
      };
    }
    answered++;
    values.push(num(hourly.wave_height[0]));
    directions.push(Array.isArray(hourly.wave_direction) ? num(hourly.wave_direction[0]) : null);
  }
  return {
    values, directions, ok: answered > 0, status,
    error: answered > 0 ? null : 'response carried no readable wave height',
  };
}

// Build the whole week, reporting what happened rather than throwing.
export async function buildFrames(opts = {}) {
  const wait = opts.sleep || sleep;
  const cells = gridCells(FRAME_LAT_STEP);
  const batchSize = opts.batchSize || FRAME_BATCH_SIZE;
  const perFrame = Math.ceil(cells.length / batchSize);

  // Decided before a single request goes out. A build that plans more fetches than the platform
  // allows does not fail cleanly -- it is killed mid-flight, having already spent the units.
  const maxFrames = Math.max(1, Math.floor((opts.maxFetches || MAX_FETCHES) / perFrame));
  const wanted = Math.min(opts.frameCount || FRAME_COUNT, maxFrames);
  const times = frameTimes(opts.now || Date.now(), wanted);

  const frames = [];
  let cellsQueried = 0;
  let lastStatus = null;
  let lastError = null;
  let aborted = null;

  for (let f = 0; f < times.length && !aborted; f++) {
    if (f > 0) await wait(opts.gapMs ?? FRAME_GAP_MS);
    const heights = new Array(cells.length).fill(null);
    const directions = new Array(cells.length).fill(null);
    for (let start = 0; start < cells.length; start += batchSize) {
      const batch = cells.slice(start, start + batchSize);
      const r = await fetchFrame(batch, times[f], opts);
      if (r.overrun) {
        // Not a failed frame -- a failed premise. Everything after it would cost the same
        // multiple, so nothing after it runs.
        aborted = 'timestep-overrun';
        lastStatus = r.status;
        lastError = r.error;
        break;
      }
      if (!r.ok) { lastStatus = r.status; lastError = r.error; continue; }
      cellsQueried += batch.length;
      for (let i = 0; i < batch.length; i++) {
        heights[start + i] = r.values[i];
        directions[start + i] = r.directions ? r.directions[i] : null;
      }
    }
    if (aborted) break;
    frames.push({
      t: times[f],
      data: bytesToBase64(encodeHeights(heights)),
      dirs: bytesToBase64(encodeDirections(directions)),
    });
  }

  const planned = times.length * cells.length;
  return {
    generatedAt: opts.now || Date.now(),
    cells: cells.length,
    latStep: FRAME_LAT_STEP,
    stepHours: FRAME_STEP_H,
    frames,
    coverage: planned > 0 ? Math.round((cellsQueried / planned) * 1000) / 1000 : 0,
    aborted,
    lastStatus,
    lastError,
    // What the build would have cost, so the number is visible rather than folklore.
    units: cellsQueried,
  };
}

export function framesAreUsable(entry) {
  return !!entry
    && Array.isArray(entry.frames) && entry.frames.length > 1
    && entry.cells === gridCells(FRAME_LAT_STEP).length
    && typeof entry.coverage === 'number' && entry.coverage >= FRAMES_MIN_COVERAGE
    && !entry.aborted;
}

// The cached week, built on demand and then reused all day.
//
// Deliberately the same shape as loadGrid in waveGrid.js -- serve a fresh entry, honour a
// cooldown after a failure, otherwise build -- because the two answer the same question about
// the same upstream and diverging would mean two sets of rules to reason about.
//
// The one difference that matters: an aborted build is never cached and always starts a
// cooldown, because the thing it aborted on is a property of the upstream rather than a
// transient, and retrying it on the next request would spend the same units to learn the same
// thing.
export async function loadFrames(env, opts = {}) {
  const now = opts.now || Date.now();
  let cached = null;
  try {
    cached = await env.SUBSCRIPTIONS.get(FRAMES_KEY, { type: 'json' });
  } catch { /* KV unavailable: fall through and try a fresh build */ }

  if (framesAreUsable(cached) && now - cached.generatedAt < FRAMES_REFRESH_MS) {
    return { frames: { ...cached, stale: false }, build: null };
  }

  let failure = null;
  try {
    failure = await env.SUBSCRIPTIONS.get(FRAMES_FAIL_KEY, { type: 'json' });
  } catch { /* no cooldown record readable; proceed to build */ }
  if (failure && failure.at && now - failure.at < FRAMES_FAIL_COOLDOWN_MS && !opts.ignoreCooldown) {
    return {
      frames: framesAreUsable(cached) ? { ...cached, stale: true } : null,
      build: { ...failure.build, cooling: true, retryInSeconds: Math.round((FRAMES_FAIL_COOLDOWN_MS - (now - failure.at)) / 1000) },
    };
  }

  let fresh;
  try {
    fresh = await (opts.build ? opts.build(opts) : buildFrames({ ...opts, now }));
  } catch (e) {
    fresh = { frames: [], coverage: 0, lastError: String((e && e.message) || e) };
  }

  const build = {
    frames: Array.isArray(fresh.frames) ? fresh.frames.length : 0,
    coverage: fresh.coverage ?? 0,
    aborted: fresh.aborted ?? null,
    lastStatus: fresh.lastStatus ?? null,
    lastError: fresh.lastError ?? null,
    units: fresh.units ?? 0,
  };

  if (framesAreUsable(fresh)) {
    try {
      await env.SUBSCRIPTIONS.put(FRAMES_KEY, JSON.stringify(fresh));
      await env.SUBSCRIPTIONS.delete(FRAMES_FAIL_KEY);
    } catch { /* still worth returning even if it could not be cached */ }
    return { frames: { ...fresh, stale: false }, build };
  }

  try {
    await env.SUBSCRIPTIONS.put(FRAMES_FAIL_KEY, JSON.stringify({ at: now, build }));
  } catch { /* the cooldown is an optimisation, not a correctness requirement */ }
  return { frames: framesAreUsable(cached) ? { ...cached, stale: true } : null, build };
}
