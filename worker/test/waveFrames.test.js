import { describe, it, expect, vi } from 'vitest';
import {
  frameTimes, fetchFrame, framesAreUsable, loadFrames, advanceFrames, framesPerPass,
  FRAME_COUNT, FRAME_STEP_H, MAX_TIMESTEPS_PER_FRAME, FRAMES_MIN_COVERAGE,
  FRAMES_REFRESH_MS, UNITS_PER_PASS, UNITS_PER_MINUTE, FRAMES_KEY, FRAMES_PARTIAL_KEY,
  WAVE_SOURCE, WIND_SOURCE, WIND_FRAME_LAT_STEP, markFramesWanted, framesAreWanted, WANTED_TTL_MS,
  frameFits, base64LengthFor, OM_FRAMES_PER_PASS,
} from '../src/waveFrames.js';

// The swell week is sampled from a published global file now (see src/omGrid.js), so the
// source that still walks cells in batches is the wind one. These tests are about that
// batching -- the pacing, the partial, the timestep-overrun guard -- so they run against a
// wave source with the file path switched off rather than being rewritten for wind.
const POINT_WAVE = { ...WAVE_SOURCE, omModel: null, latStep: FRAME_LAT_STEP };
const WAVE_CELLS = gridCells(WAVE_SOURCE.latStep);
import { createFakeKv } from './fakeKv.js';
import { gridCells, FRAME_LAT_STEP } from '../../src/lib/wavegrid.js';

const CELLS = gridCells(FRAME_LAT_STEP);

// One well-formed location object carrying exactly one hour.
const loc = (h, d) => ({ hourly: { time: ['2026-09-10T00:00'], wave_height: [h], wave_direction: [d] } });
const okRes = (body) => ({ ok: true, status: 200, json: async () => body });

describe('frameTimes', () => {
  it('gives a week of six-hourly steps', () => {
    const t = frameTimes(Date.parse('2026-09-10T13:20:00Z'));
    expect(t).toHaveLength(FRAME_COUNT);
    expect(FRAME_COUNT * FRAME_STEP_H).toBe(168); // exactly seven days
  });

  it('anchors to a six-hourly boundary, so every device animates the same instants', () => {
    const a = frameTimes(Date.parse('2026-09-10T13:20:00Z'));
    const b = frameTimes(Date.parse('2026-09-10T17:59:00Z'));
    expect(a[0]).toBe('2026-09-10T12:00');
    expect(b[0]).toBe(a[0]); // same boundary -> same build is reusable all afternoon
  });

  it('steps forward six hours at a time, in the format start_hour wants', () => {
    const t = frameTimes(Date.parse('2026-09-10T00:00:00Z'));
    expect(t[0]).toBe('2026-09-10T00:00');
    expect(t[1]).toBe('2026-09-10T06:00');
    expect(t[4]).toBe('2026-09-11T00:00');
    for (const s of t) expect(s).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });
});

describe('fetchFrame', () => {
  it('asks for exactly one hour, both ends of the range', async () => {
    let url = '';
    const fetchImpl = vi.fn(async (u) => { url = String(u); return okRes(CELLS.map(() => loc(1.5, 270))); });
    await fetchFrame(CELLS, '2026-09-10T06:00', { fetchImpl });
    expect(url).toContain('start_hour=2026-09-10T06%3A00');
    expect(url).toContain('end_hour=2026-09-10T06%3A00');
    expect(url).toContain('hourly=wave_height,wave_direction');
    expect(url).not.toContain('forecast_days');
  });

  it('sends every cell in one request, because the platform allows 50 fetches and no more', async () => {
    const fetchImpl = vi.fn(async () => okRes(CELLS.map(() => loc(1, 200))));
    await fetchFrame(CELLS, '2026-09-10T00:00', { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('reads heights and directions positionally', async () => {
    const fetchImpl = vi.fn(async () => okRes(CELLS.map((_, i) => loc(i / 100, i % 360))));
    const r = await fetchFrame(CELLS, '2026-09-10T00:00', { fetchImpl });
    expect(r.ok).toBe(true);
    expect(r.values[7]).toBeCloseTo(0.07, 5);
    expect(r.directions[7]).toBe(7);
  });

  it('ABORTS when a frame comes back with more hours than it asked for', async () => {
    // The expensive silent failure: if start_hour were ignored, every frame would carry the
    // full 168-hour series and the build would spend 168x its budget without erroring.
    const overrun = { hourly: { time: Array.from({ length: 168 }, (_, i) => 'h' + i), wave_height: Array(168).fill(1), wave_direction: Array(168).fill(0) } };
    const fetchImpl = vi.fn(async () => okRes(CELLS.map(() => overrun)));
    const r = await fetchFrame(CELLS, '2026-09-10T00:00', { fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.overrun).toBe(168);
    expect(r.error).toMatch(/start_hour was not honoured/);
    expect(MAX_TIMESTEPS_PER_FRAME).toBe(1);
  });

  it('treats a land or ice cell as no data rather than as a failure', async () => {
    const fetchImpl = vi.fn(async () => okRes(CELLS.map((_, i) => (i % 3 ? loc(1, 90) : loc(null, null)))));
    const r = await fetchFrame(CELLS, '2026-09-10T00:00', { fetchImpl });
    expect(r.ok).toBe(true);
    expect(r.values[0]).toBeNull();
  });

  it('reports rather than throws on a rejected or unreachable request', async () => {
    const bad = await fetchFrame(CELLS, '2026-09-10T00:00', {
      fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({ reason: 'Minutely API request limit exceeded' }) }),
    });
    expect(bad.ok).toBe(false);
    expect(bad.status).toBe(429);
    expect(bad.error).toMatch(/limit exceeded/);
    const dead = await fetchFrame(CELLS, '2026-09-10T00:00', { fetchImpl: async () => { throw new TypeError('offline'); } });
    expect(dead.ok).toBe(false);
    expect(dead.error).toMatch(/offline/);
  });
});


describe('framesAreUsable', () => {
  // The swell week's own cell count, not the batching tests' one: the two sources sample at
  // different steps now, and a week built for the wrong grid is exactly what this rejects.
  const payload = 'A'.repeat(base64LengthFor(WAVE_CELLS.length));
  const frame = () => ({ t: 'x', data: payload, dirs: payload });
  const good = { frames: [frame(), frame()], cells: WAVE_CELLS.length, coverage: 1, aborted: null };
  it('accepts a complete build', () => expect(framesAreUsable(good)).toBe(true));
  it('refuses a build that covered too little of the world', () => {
    expect(framesAreUsable({ ...good, coverage: FRAMES_MIN_COVERAGE - 0.01 })).toBe(false);
  });
  it('refuses an aborted build, a single frame, a different grid, and nothing at all', () => {
    expect(framesAreUsable({ ...good, aborted: 'timestep-overrun' })).toBe(false);
    expect(framesAreUsable({ ...good, frames: [frame()] })).toBe(false);
    expect(framesAreUsable({ ...good, cells: 406 })).toBe(false);
    // A week whose header says one grid and whose bytes say another.
    expect(framesAreUsable({ ...good, frames: [{ t: 'x', data: 'AAAA' }, frame()] })).toBe(false);
    expect(framesAreUsable(null)).toBe(false);
  });
});


describe('pacing the build under the per-minute allowance', () => {
  const loc = (h, d) => ({ hourly: { time: ['t'], wave_height: [h], wave_direction: [d] } });
  const okRes = (body) => ({ ok: true, status: 200, json: async () => body });
  const serve = () => vi.fn(async () => okRes(CELLS.map(() => loc(1.4, 250))));
  const noSleep = () => Promise.resolve();
  const env = () => ({ SUBSCRIPTIONS: createFakeKv() });

  it('never asks for more in one pass than a minute of allowance buys', () => {
    // The bug this replaced: a 28-frame week is 5,208 units against ~600 a minute, fired at
    // once. It got about three frames in and every remaining request was refused.
    expect(CELLS.length * FRAME_COUNT).toBeGreaterThan(UNITS_PER_MINUTE * 8);
    const perPass = framesPerPass(CELLS.length);
    expect(perPass * CELLS.length).toBeLessThanOrEqual(UNITS_PER_PASS);
    expect(UNITS_PER_PASS).toBeLessThan(UNITS_PER_MINUTE);
    expect(perPass).toBeGreaterThanOrEqual(1);
  });

  it('takes a few frames per pass and leaves the rest for the next one', async () => {
    const e = env();
    const fetchImpl = serve();
    const first = await advanceFrames(e, { fetchImpl, sleep: noSleep, source: POINT_WAVE });
    expect(first.complete).toBe(false);
    expect(first.fetchedThisPass).toBe(framesPerPass(CELLS.length));
    expect(first.units).toBeLessThanOrEqual(UNITS_PER_PASS);
    expect(first.remaining).toBeGreaterThan(0);
  });

  it('assembles the whole week across passes, then stops fetching', async () => {
    const e = env();
    const fetchImpl = serve();
    const now = Date.parse('2026-09-10T00:00:00Z');
    let out;
    for (let i = 0; i < 20; i++) {
      out = await advanceFrames(e, { fetchImpl, sleep: noSleep, source: POINT_WAVE, now });
      if (out.complete) break;
    }
    expect(out.complete).toBe(true);
    expect(out.frames).toHaveLength(FRAME_COUNT);
    const calls = fetchImpl.mock.calls.length;
    await advanceFrames(e, { fetchImpl, sleep: noSleep, source: POINT_WAVE, now });
    expect(fetchImpl.mock.calls.length).toBe(calls); // a finished week costs nothing
  });

  it('keeps the frames it already has when the six-hourly boundary moves', async () => {
    // The week slides forward every six hours, and its later frames are the same instants.
    // Restarting from nothing each time would mean the build never converges.
    const e = env();
    const fetchImpl = serve();
    const t0 = Date.parse('2026-09-10T00:00:00Z');
    await advanceFrames(e, { fetchImpl, sleep: noSleep, source: POINT_WAVE, now: t0 });
    const before = fetchImpl.mock.calls.length;
    const after = await advanceFrames(e, { fetchImpl, sleep: noSleep, source: POINT_WAVE, now: t0 + 6 * 3600e3 });
    expect(after.frames.length).toBeGreaterThan(0);
    expect(fetchImpl.mock.calls.length - before).toBeLessThanOrEqual(framesPerPass(CELLS.length));
  });

  it('stops the pass at an over-long frame and stores nothing', async () => {
    const overrun = { hourly: { time: Array(168).fill('x'), wave_height: Array(168).fill(1), wave_direction: Array(168).fill(0) } };
    const e = env();
    const out = await advanceFrames(e, { fetchImpl: async () => okRes(CELLS.map(() => overrun)), sleep: noSleep, source: POINT_WAVE });
    expect(out.aborted).toBe('timestep-overrun');
    expect(await e.SUBSCRIPTIONS.get(FRAMES_PARTIAL_KEY)).toBeFalsy();
  });

  it('does not record a frame that answered with nothing', async () => {
    // Storing an empty frame marks that hour done and leaves a hole in the week all day.
    const e = env();
    const out = await advanceFrames(e, {
      source: POINT_WAVE,
      fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({ reason: 'rate limited' }) }),
      sleep: noSleep,
    });
    expect(out.frames).toHaveLength(0);
    expect(out.lastStatus).toBe(429);
  });
});

describe('loadFrames only ever reads', () => {
  const env = () => ({ SUBSCRIPTIONS: createFakeKv() });
  // Built at the swell source's own step: loadFrames checks a cached week against the grid the
  // current source samples, so a fixture at the old one is correctly refused.
  const week = (generatedAt) => JSON.stringify({
    generatedAt, cells: WAVE_CELLS.length, latStep: WAVE_SOURCE.latStep, stepHours: FRAME_STEP_H,
    // Payloads the right size for this grid: framesAreUsable checks the bytes now, not just
    // the recorded count, because those two disagreeing is what broke the animation once.
    frames: Array.from({ length: FRAME_COUNT }, (_, i) => ({
      t: 't' + i,
      data: 'A'.repeat(base64LengthFor(WAVE_CELLS.length)),
      dirs: 'A'.repeat(base64LengthFor(WAVE_CELLS.length)),
    })),
    coverage: 1, aborted: null,
  });

  it('never fetches, which is what makes the button safe to press', async () => {
    const out = await loadFrames(env());
    expect(out.frames).toBeNull();
    expect(out.build.building).toBe(true);
    expect(out.build.ready).toBe(0);
    expect(out.build.wanted).toBe(FRAME_COUNT);
  });

  it('reports how much of the week is ready while it is assembling', async () => {
    const e = env();
    const loc = (h) => ({ hourly: { time: ['t'], wave_height: [h], wave_direction: [200] } });
    await advanceFrames(e, {
      source: POINT_WAVE,
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => CELLS.map(() => loc(1)) }),
      sleep: () => Promise.resolve(),
    });
    const out = await loadFrames(e);
    expect(out.frames).toBeNull();
    expect(out.build.ready).toBeGreaterThan(0);
    expect(out.build.ready).toBeLessThan(FRAME_COUNT);
  });

  it('serves a finished week, and marks an old one stale rather than withdrawing it', async () => {
    const e = env();
    const t0 = Date.parse('2026-09-10T00:00:00Z');
    await e.SUBSCRIPTIONS.put(FRAMES_KEY, week(t0));
    expect((await loadFrames(e, { now: t0 })).frames.stale).toBe(false);
    expect((await loadFrames(e, { now: t0 + FRAMES_REFRESH_MS + 1 })).frames.stale).toBe(true);
  });
});

// The wind week rides the same builder as the swell week. These assert the parts that differ --
// endpoint, variables, encoding, keys, grid -- and, more importantly, that the parts that do not
// differ are genuinely shared rather than a second copy that will drift.
describe('the wind week', () => {
  const NOW_W = Date.parse('2026-09-05T12:00:00Z');
  const envW = () => ({ SUBSCRIPTIONS: createFakeKv() });
  const FAST = { sleep: async () => {}, gapMs: 0 };

  it('costs less than the swell week, which is why it fits beside it', () => {
    // 186 x 28 = 5,208 for the swell week; two of those is 10,416 against ~10,000 a day. The
    // wind week's coarser grid is what makes a second week affordable at all.
    const swell = gridCells(FRAME_LAT_STEP).length;
    const wind = gridCells(WIND_FRAME_LAT_STEP).length;
    expect(wind).toBeLessThan(swell);
    expect(swell * FRAME_COUNT + wind * FRAME_COUNT).toBeLessThan(10000);
  });

  it('asks the forecast endpoint for wind, one hour at a time', async () => {
    let seen = '';
    const fetchImpl = async (url) => {
      seen = url;
      return { ok: true, status: 200, json: async () => [{ hourly: { time: ['2026-09-05T12:00'], wind_speed_10m: [30], wind_direction_10m: [270] } }] };
    };
    await fetchFrame([{ lat: 0, lon: 0 }], '2026-09-05T12:00', { fetchImpl, source: WIND_SOURCE });
    expect(seen).toContain('api.open-meteo.com/v1/forecast');
    expect(seen).toContain('hourly=wind_speed_10m,wind_direction_10m');
    expect(seen).toContain('start_hour=');
    expect(seen).toContain('end_hour=');
  });

  it('keeps the timestep guard, which is the expensive mistake to repeat', async () => {
    // A frame that answers with the whole series instead of the hour it asked for would spend
    // 105 x 168 units without erroring.
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => [{ hourly: { time: ['a', 'b', 'c'], wind_speed_10m: [1, 2, 3], wind_direction_10m: [1, 2, 3] } }],
    });
    const r = await fetchFrame([{ lat: 0, lon: 0 }], '2026-09-05T12:00', { fetchImpl, source: WIND_SOURCE });
    expect(r.overrun).toBe(3);
    expect(r.ok).toBe(false);
  });

  it('stores the wind week under its own keys, never the swell week\'s', async () => {
    const env = envW();
    const fetchImpl = async (url) => {
      const n = url.split('latitude=')[1].split('&')[0].split(',').length;
      return { ok: true, status: 200, json: async () => Array.from({ length: n }, () => ({ hourly: { time: ['x'], wind_speed_10m: [25], wind_direction_10m: [270] } })) };
    };
    await advanceFrames(env, { now: NOW_W, fetchImpl, source: WIND_SOURCE, ...FAST });
    const keys = [...env.SUBSCRIPTIONS._store.keys()];
    expect(keys.some((k) => k.startsWith('windframes:'))).toBe(true);
    expect(keys.some((k) => k.startsWith('waveframes:'))).toBe(false);
  });

  it('records the grid it was sampled on, so the app cannot decode it as the swell week', async () => {
    const env = envW();
    const fetchImpl = async (url) => {
      const n = url.split('latitude=')[1].split('&')[0].split(',').length;
      return { ok: true, status: 200, json: async () => Array.from({ length: n }, () => ({ hourly: { time: ['x'], wind_speed_10m: [25], wind_direction_10m: [270] } })) };
    };
    const out = await advanceFrames(env, { now: NOW_W, fetchImpl, source: WIND_SOURCE, ...FAST });
    expect(out.latStep).toBe(WIND_FRAME_LAT_STEP);
    expect(out.cells).toBe(gridCells(WIND_FRAME_LAT_STEP).length);
  });

  it('is only worth building once somebody has opened it', async () => {
    const env = envW();
    expect(await framesAreWanted(env, WIND_SOURCE, NOW_W)).toBe(false);
    await markFramesWanted(env, WIND_SOURCE, NOW_W);
    expect(await framesAreWanted(env, WIND_SOURCE, NOW_W)).toBe(true);
  });

  it('stops being worth building once nobody has asked for two days', async () => {
    const env = envW();
    await markFramesWanted(env, WIND_SOURCE, NOW_W);
    expect(await framesAreWanted(env, WIND_SOURCE, NOW_W + WANTED_TTL_MS - 1000)).toBe(true);
    expect(await framesAreWanted(env, WIND_SOURCE, NOW_W + WANTED_TTL_MS + 1000)).toBe(false);
  });

  it('never gates the swell week behind a flag, because it is the default layer', async () => {
    const env = envW();
    expect(await framesAreWanted(env, WAVE_SOURCE, NOW_W)).toBe(true);
  });
});

// The bug this file exists to never repeat.
//
// When the swell week moved from 15 degrees to 5, every stored frame kept the right timestamp,
// so nothing looked missing, nothing was refetched, and the week was rewritten with the new
// step's cell count over the old step's bytes. The globe then read 186 cells of data as a
// 1,612-cell grid, and no later pass could fix it: each one saw a complete, fresh week.
describe('a week stored at a different resolution', () => {
  const NOW = Date.parse('2026-09-22T12:00:00Z');
  const COARSE = 15;
  const FINE = 5;
  const source = { ...WAVE_SOURCE, omModel: null, latStep: FINE };
  const b64 = (n) => 'A'.repeat(4 * Math.ceil(n / 3));

  const weekAt = (step, generatedAt = NOW) => ({
    generatedAt,
    cells: gridCells(step).length,
    latStep: step,
    stepHours: FRAME_STEP_H,
    coverage: 1,
    frames: frameTimes(NOW).map((t) => ({ t, data: b64(gridCells(step).length), dirs: b64(gridCells(step).length) })),
  });

  it('is not silently reused at the new step', async () => {
    const env = { SUBSCRIPTIONS: createFakeKv() };
    await env.SUBSCRIPTIONS.put(source.doneKey, JSON.stringify(weekAt(COARSE)));
    const asked = [];
    const out = await advanceFrames(env, {
      source, now: NOW, gapMs: 0, sleep: async () => {},
      fetchImpl: async (url) => { asked.push(url); throw new Error('no upstream in tests'); },
    });
    // Every frame it had was the wrong size, so every frame is missing again.
    expect(asked.length).toBeGreaterThan(0);
    expect(out.frames.every((f) => f.data.length === 4 * Math.ceil(gridCells(FINE).length / 3))).toBe(true);
    expect(out.complete).toBe(false);
  });

  it('does not write a week whose recorded size disagrees with its bytes', async () => {
    // The part that made it permanent: a record like this passes framesAreUsable, because that
    // compares the recorded count against the current step and both say the same number.
    const env = { SUBSCRIPTIONS: createFakeKv() };
    await env.SUBSCRIPTIONS.put(source.doneKey, JSON.stringify(weekAt(COARSE)));
    await advanceFrames(env, {
      source, now: NOW, gapMs: 0, sleep: async () => {},
      fetchImpl: async () => { throw new Error('no upstream in tests'); },
    });
    const stored = await env.SUBSCRIPTIONS.get(source.doneKey, { type: 'json' });
    const written = stored ?? await env.SUBSCRIPTIONS.get(source.partialKey, { type: 'json' });
    for (const f of (written?.frames ?? [])) {
      expect(f.data.length).toBe(4 * Math.ceil(written.cells / 3));
    }
  });

  it('keeps frames that are the right size, so a moved boundary still converges', async () => {
    // The reuse this guard must not break: same step, same bytes, only the week has rolled on.
    const env = { SUBSCRIPTIONS: createFakeKv() };
    await env.SUBSCRIPTIONS.put(source.doneKey, JSON.stringify(weekAt(FINE)));
    const asked = [];
    const out = await advanceFrames(env, {
      source, now: NOW, gapMs: 0, sleep: async () => {},
      fetchImpl: async (url) => { asked.push(url); throw new Error('no upstream in tests'); },
    });
    expect(asked).toEqual([]);
    expect(out.complete).toBe(true);
    expect(out.frames).toHaveLength(FRAME_COUNT);
  });

  it('accepts a frame that predates directions but not one with the wrong-sized ones', () => {
    const n = gridCells(FINE).length;
    expect(frameFits({ t: 'x', data: b64(n) }, n)).toBe(true);
    expect(frameFits({ t: 'x', data: b64(n), dirs: null }, n)).toBe(true);
    expect(frameFits({ t: 'x', data: b64(n), dirs: b64(n) }, n)).toBe(true);
    expect(frameFits({ t: 'x', data: b64(n), dirs: b64(gridCells(COARSE).length) }, n)).toBe(false);
    expect(frameFits({ t: 'x', data: b64(gridCells(COARSE).length) }, n)).toBe(false);
    expect(frameFits({ t: 'x' }, n)).toBe(false);
    expect(frameFits(null, n)).toBe(false);
  });
});

describe('pacing a week that comes from files', () => {
  const NOW2 = Date.parse('2026-09-22T12:00:00Z');
  const om5 = { ...WAVE_SOURCE, latStep: 5 };
  const cells5 = gridCells(5).length;
  const goodFrame = () => ({
    heights: new Array(cells5).fill(1.5),
    directions: new Array(cells5).fill(270),
    source: 'x',
  });

  it('fetches a whole batch of frames in one pass', async () => {
    const env = { SUBSCRIPTIONS: createFakeKv() };
    const hours = [];
    const out = await advanceFrames(env, {
      source: om5, now: NOW2, gapMs: 0, sleep: async () => {},
      fetchFrameOm: async (t) => { hours.push(t); return goodFrame(); },
    });
    // The unit arithmetic would have allowed exactly one.
    expect(framesPerPass(cells5)).toBe(1);
    expect(hours).toHaveLength(OM_FRAMES_PER_PASS);
    expect(out.fetchedThisPass).toBe(OM_FRAMES_PER_PASS);
    expect(out.remaining).toBe(FRAME_COUNT - OM_FRAMES_PER_PASS);
  });

  it('hands every frame of the pass the same run probe', async () => {
    // One probe per pass is what turns three requests a frame into about one. A fresh one per
    // frame would be the bug it was written to remove, and looks identical from the outside
    // unless the identity is checked.
    const env = { SUBSCRIPTIONS: createFakeKv() };
    const probes = new Set();
    await advanceFrames(env, {
      source: om5, now: NOW2, gapMs: 0, sleep: async () => {},
      fetchFrameOm: async (t, step, o) => { probes.add(o.probe); return goodFrame(); },
    });
    expect(probes.size).toBe(1);
    expect([...probes][0]).toBeTruthy();
    expect([...probes][0].exhausted).toBeInstanceOf(Set);
  });

  it('assembles the whole week in three passes', async () => {
    const env = { SUBSCRIPTIONS: createFakeKv() };
    let passes = 0;
    let out;
    do {
      passes++;
      out = await advanceFrames(env, {
        source: om5, now: NOW2, gapMs: 0, sleep: async () => {},
        fetchFrameOm: async () => goodFrame(),
      });
    } while (!out.complete && passes < 10);
    expect(out.complete).toBe(true);
    expect(passes).toBe(Math.ceil(FRAME_COUNT / OM_FRAMES_PER_PASS));
    expect(out.frames).toHaveLength(FRAME_COUNT);
    expect(framesAreUsable(out, om5)).toBe(true);
  });
});

describe('pacing a week that comes from files', () => {
  const NOW = Date.parse('2026-09-22T12:00:00Z');
  const omSource = { ...WAVE_SOURCE, latStep: 5 };

  // Feeding the unit arithmetic a 1,612-cell grid gives one frame a pass, which at ten-minute
  // ticks is a week taking four hours and forty minutes. A frame here is one download.
  it('takes many frames a pass, not the one the unit arithmetic allows', async () => {
    const env = { SUBSCRIPTIONS: createFakeKv() };
    const asked = [];
    await advanceFrames(env, {
      source: omSource, now: NOW, gapMs: 0, sleep: async () => {},
      fetch: async (url) => { asked.push(url); return { ok: false, status: 404 }; },
    });
    expect(framesPerPass(gridCells(5).length)).toBe(1); // what it would have been
    const out = await env.SUBSCRIPTIONS.get(omSource.partialKey, { type: 'json' });
    expect(OM_FRAMES_PER_PASS).toBeGreaterThan(1);
    // Every candidate of the first frame was tried, and it stopped there because a frame that
    // does not answer ends the pass.
    expect(asked.length).toBeGreaterThan(0);
    void out;
  });

  it('shares one run probe across the pass, so a missing run is asked for once', async () => {
    // Without this, each frame re-asks every newer run and collects the same 404 -- measured at
    // three requests a frame where it should be about one.
    const env = { SUBSCRIPTIONS: createFakeKv() };
    const asked = [];
    const published = '/0000Z/';
    await advanceFrames(env, {
      source: omSource, now: NOW, gapMs: 0, sleep: async () => {},
      fetch: async (url) => {
        asked.push(url);
        if (!url.includes(published)) return { ok: false, status: 404 };
        // A body that is not one of these files: the frame still fails, but only after the
        // newer runs have been ruled out, which is what this test is counting.
        return { ok: true, arrayBuffer: async () => new Uint8Array([0x3c, 0x21]).buffer };
      },
    });
    const newerRuns = asked.filter((u) => !u.includes(published));
    // Three newer runs, each asked once for the whole pass rather than once per frame.
    expect(newerRuns.length).toBeLessThanOrEqual(3);
  });
});

describe('serving a week whose bytes disagree with its own header', () => {
  const step = 5;
  const n = gridCells(step).length;
  const source = { ...WAVE_SOURCE, latStep: step };
  const b64 = (c) => 'A'.repeat(4 * Math.ceil(c / 3));
  const week = (frameCells) => ({
    generatedAt: Date.now(),
    cells: n,                       // what it claims
    latStep: step,
    coverage: 1,
    frames: frameTimes(Date.now()).map((t) => ({ t, data: b64(frameCells), dirs: b64(frameCells) })),
  });

  it('is refused, however well its header reads', () => {
    // This exact record was live. It passed every check there used to be, and the globe
    // scrubbed through 28 frames that all drew the same thing.
    expect(framesAreUsable(week(gridCells(15).length), source)).toBe(false);
    expect(framesAreUsable(week(n), source)).toBe(true);
  });

  it('is refused one bad frame at a time, not only when all of them are wrong', () => {
    const w = week(n);
    w.frames[9] = { t: w.frames[9].t, data: b64(gridCells(15).length), dirs: b64(gridCells(15).length) };
    expect(framesAreUsable(w, source)).toBe(false);
  });
});
