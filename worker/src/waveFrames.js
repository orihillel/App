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

// The limit that broke the first version of this, recorded because I priced the daily budget
// carefully and never checked this one -- in the file that states it.
//
// Open-Meteo's free tier allows roughly 600 units a minute as well as ~10,000 a day. A 28-frame
// week is 5,208 units: it fits the day nine times over and the minute not at all. Fired in one
// go it got about three frames in before every remaining request was refused, which left a
// mostly-empty week that the coverage gate correctly declined to serve.
//
// So the week is not built in one go. Each pass takes as many frames as a minute affords and
// appends them to a partial build in KV; the cron tick that already keeps the live grid warm
// runs the next pass. No pass ever exceeds the per-minute allowance, and a week assembles over
// a handful of ticks instead of failing in one.
export const UNITS_PER_MINUTE = 600;

// Deliberately under the limit rather than at it: the live grid's own warm-up runs on the same
// tick and spends 406 of the same allowance when it refreshes.
export const UNITS_PER_PASS = 500;

export const FRAMES_PARTIAL_KEY = 'waveframes:partial:v2';

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

// How many frames one pass can afford, from the per-minute allowance and the grid's size.
export function framesPerPass(cellCount, unitsPerPass = UNITS_PER_PASS) {
  return Math.max(1, Math.floor(unitsPerPass / Math.max(1, cellCount)));
}

// One pass of the accumulating build: take the partial week from KV, fetch the next few frames,
// put it back. Returns the partial (or the finished week) and what happened.
//
// The frames are keyed by their timestamp rather than their index, so a pass that runs after
// the six-hourly boundary has moved contributes to the right week instead of silently writing
// tomorrow's 6am into yesterday's slot 4.
export async function advanceFrames(env, opts = {}) {
  const now = opts.now || Date.now();
  const cells = gridCells(FRAME_LAT_STEP);
  const times = frameTimes(now, opts.frameCount || FRAME_COUNT);
  const perPass = opts.framesPerPass || framesPerPass(cells.length, opts.unitsPerPass);

  let partial = null;
  let done = null;
  try {
    partial = await env.SUBSCRIPTIONS.get(FRAMES_PARTIAL_KEY, { type: 'json' });
  } catch { /* KV unreadable: start a fresh partial */ }
  try {
    done = await env.SUBSCRIPTIONS.get(FRAMES_KEY, { type: 'json' });
  } catch { /* no finished week to build on */ }

  // A partial whose first frame is no longer the current boundary is describing a week that has
  // moved on. Its later frames are still wanted -- they are the same instants -- so it is kept
  // and re-indexed against the new list rather than thrown away, which is what makes the build
  // converge instead of restarting every six hours.
  const have = new Map();
  // The finished week counts as frames already in hand, but only while it is fresh. Inside a
  // day this makes the week roll forward for the price of the one or two new hours the moving
  // boundary exposes, rather than re-fetching six days everyone already has. Past a day it is
  // deliberately ignored, because a frame for Thursday 6am fetched three days ago is a
  // three-day-old forecast for that hour, and rolling it forever would quietly preserve it.
  if (done && Array.isArray(done.frames) && Number.isFinite(done.generatedAt)
      && now - done.generatedAt < (opts.refreshMs ?? FRAMES_REFRESH_MS)) {
    for (const f of done.frames) if (f && typeof f.t === 'string') have.set(f.t, f);
  }
  if (partial && Array.isArray(partial.frames)) {
    for (const f of partial.frames) if (f && typeof f.t === 'string') have.set(f.t, f);
  }

  const missing = times.filter((t) => !have.has(t));
  let fetched = 0;
  let lastStatus = null;
  let lastError = null;
  let aborted = null;

  for (const t of missing.slice(0, perPass)) {
    if (fetched > 0) await (opts.sleep || sleep)(opts.gapMs ?? FRAME_GAP_MS);
    const heights = new Array(cells.length).fill(null);
    const directions = new Array(cells.length).fill(null);
    let any = false;
    for (let start = 0; start < cells.length; start += (opts.batchSize || FRAME_BATCH_SIZE)) {
      const batch = cells.slice(start, start + (opts.batchSize || FRAME_BATCH_SIZE));
      const r = await fetchFrame(batch, t, opts);
      if (r.overrun) { aborted = 'timestep-overrun'; lastStatus = r.status; lastError = r.error; break; }
      if (!r.ok) { lastStatus = r.status; lastError = r.error; continue; }
      any = true;
      for (let i = 0; i < batch.length; i++) {
        heights[start + i] = r.values[i];
        directions[start + i] = r.directions ? r.directions[i] : null;
      }
    }
    if (aborted) break;
    // Only a frame that actually answered is recorded. Storing an empty one would mark it done
    // and leave a hole in the week for the rest of the day.
    if (!any) break;
    have.set(t, {
      t,
      data: bytesToBase64(encodeHeights(heights)),
      dirs: bytesToBase64(encodeDirections(directions)),
    });
    fetched++;
  }

  // Ordered by the week, not by the order they arrived.
  const frames = times.filter((t) => have.has(t)).map((t) => have.get(t));
  const next = {
    generatedAt: now,
    cells: cells.length,
    latStep: FRAME_LAT_STEP,
    stepHours: FRAME_STEP_H,
    frames,
    wanted: times.length,
    coverage: times.length ? Math.round((frames.length / times.length) * 1000) / 1000 : 0,
    aborted,
    lastStatus,
    lastError,
    units: fetched * cells.length,
  };

  const complete = frames.length >= times.length && !aborted;
  try {
    if (complete) {
      await env.SUBSCRIPTIONS.put(FRAMES_KEY, JSON.stringify(next));
      await env.SUBSCRIPTIONS.delete(FRAMES_PARTIAL_KEY);
      await env.SUBSCRIPTIONS.delete(FRAMES_FAIL_KEY);
    } else if (aborted) {
      // The premise is wrong, not the pacing. Keep nothing and cool off.
      await env.SUBSCRIPTIONS.delete(FRAMES_PARTIAL_KEY);
      await env.SUBSCRIPTIONS.put(FRAMES_FAIL_KEY, JSON.stringify({ at: now, build: { aborted, lastStatus, lastError } }));
    } else {
      await env.SUBSCRIPTIONS.put(FRAMES_PARTIAL_KEY, JSON.stringify(next));
    }
  } catch { /* the pass still happened; the next one will re-derive from whatever stuck */ }

  return { ...next, complete, fetchedThisPass: fetched, remaining: Math.max(0, times.length - frames.length) };
}

export function framesAreUsable(entry) {
  return !!entry
    && Array.isArray(entry.frames) && entry.frames.length > 1
    && entry.cells === gridCells(FRAME_LAT_STEP).length
    && typeof entry.coverage === 'number' && entry.coverage >= FRAMES_MIN_COVERAGE
    && !entry.aborted;
}

// The cached week, and the progress of the one being assembled.
//
// This used to build on demand, and that was the bug: a week is 5,208 units and the per-minute
// allowance is 600, so pressing the button spent three frames' worth and was refused the rest.
// The build is paced across cron ticks now (see advanceFrames), so this only ever reads --
// it never fetches, and therefore can never blow a limit however often it is called.
//
// A partial week is reported rather than hidden. "Building the week, 9 of 28 hours ready" is a
// state worth showing; "unavailable" for the same thing is what sent the last round of this
// feature to guesswork.
export async function loadFrames(env, opts = {}) {
  const now = opts.now || Date.now();
  let cached = null;
  try {
    cached = await env.SUBSCRIPTIONS.get(FRAMES_KEY, { type: 'json' });
  } catch { /* KV unavailable */ }

  if (framesAreUsable(cached)) {
    const stale = now - cached.generatedAt >= FRAMES_REFRESH_MS;
    return { frames: { ...cached, stale }, build: null };
  }

  let partial = null;
  try {
    partial = await env.SUBSCRIPTIONS.get(FRAMES_PARTIAL_KEY, { type: 'json' });
  } catch { /* no partial readable */ }

  let failure = null;
  try {
    failure = await env.SUBSCRIPTIONS.get(FRAMES_FAIL_KEY, { type: 'json' });
  } catch { /* no cooldown record */ }

  const ready = partial && Array.isArray(partial.frames) ? partial.frames.length : 0;
  const wanted = (partial && partial.wanted) || FRAME_COUNT;
  return {
    frames: null,
    build: {
      building: !failure,
      ready,
      wanted,
      aborted: failure ? (failure.build && failure.build.aborted) || null : (partial && partial.aborted) || null,
      lastStatus: failure ? failure.build && failure.build.lastStatus : (partial && partial.lastStatus) || null,
      lastError: failure ? failure.build && failure.build.lastError : (partial && partial.lastError) || null,
    },
  };
}
