import { describe, it, expect, vi } from 'vitest';
import {
  frameTimes, fetchFrame, framesAreUsable, loadFrames, advanceFrames, framesPerPass,
  FRAME_COUNT, FRAME_STEP_H, MAX_TIMESTEPS_PER_FRAME, FRAMES_MIN_COVERAGE,
  FRAMES_REFRESH_MS, UNITS_PER_PASS, UNITS_PER_MINUTE, FRAMES_KEY, FRAMES_PARTIAL_KEY,
} from '../src/waveFrames.js';
import { createFakeKv } from './fakeKv.js';
import { gridCells, FRAME_LAT_STEP, base64ToBytes, decodeHeights } from '../../src/lib/wavegrid.js';

const CELLS = gridCells(FRAME_LAT_STEP);
const noSleep = () => Promise.resolve();

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
  const good = { frames: [{}, {}], cells: CELLS.length, coverage: 1, aborted: null };
  it('accepts a complete build', () => expect(framesAreUsable(good)).toBe(true));
  it('refuses a build that covered too little of the world', () => {
    expect(framesAreUsable({ ...good, coverage: FRAMES_MIN_COVERAGE - 0.01 })).toBe(false);
  });
  it('refuses an aborted build, a single frame, a different grid, and nothing at all', () => {
    expect(framesAreUsable({ ...good, aborted: 'timestep-overrun' })).toBe(false);
    expect(framesAreUsable({ ...good, frames: [{}] })).toBe(false);
    expect(framesAreUsable({ ...good, cells: 406 })).toBe(false);
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
    const first = await advanceFrames(e, { fetchImpl, sleep: noSleep });
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
      out = await advanceFrames(e, { fetchImpl, sleep: noSleep, now });
      if (out.complete) break;
    }
    expect(out.complete).toBe(true);
    expect(out.frames).toHaveLength(FRAME_COUNT);
    const calls = fetchImpl.mock.calls.length;
    await advanceFrames(e, { fetchImpl, sleep: noSleep, now });
    expect(fetchImpl.mock.calls.length).toBe(calls); // a finished week costs nothing
  });

  it('keeps the frames it already has when the six-hourly boundary moves', async () => {
    // The week slides forward every six hours, and its later frames are the same instants.
    // Restarting from nothing each time would mean the build never converges.
    const e = env();
    const fetchImpl = serve();
    const t0 = Date.parse('2026-09-10T00:00:00Z');
    await advanceFrames(e, { fetchImpl, sleep: noSleep, now: t0 });
    const before = fetchImpl.mock.calls.length;
    const after = await advanceFrames(e, { fetchImpl, sleep: noSleep, now: t0 + 6 * 3600e3 });
    expect(after.frames.length).toBeGreaterThan(0);
    expect(fetchImpl.mock.calls.length - before).toBeLessThanOrEqual(framesPerPass(CELLS.length));
  });

  it('stops the pass at an over-long frame and stores nothing', async () => {
    const overrun = { hourly: { time: Array(168).fill('x'), wave_height: Array(168).fill(1), wave_direction: Array(168).fill(0) } };
    const e = env();
    const out = await advanceFrames(e, { fetchImpl: async () => okRes(CELLS.map(() => overrun)), sleep: noSleep });
    expect(out.aborted).toBe('timestep-overrun');
    expect(await e.SUBSCRIPTIONS.get(FRAMES_PARTIAL_KEY)).toBeFalsy();
  });

  it('does not record a frame that answered with nothing', async () => {
    // Storing an empty frame marks that hour done and leaves a hole in the week all day.
    const e = env();
    const out = await advanceFrames(e, {
      fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({ reason: 'rate limited' }) }),
      sleep: noSleep,
    });
    expect(out.frames).toHaveLength(0);
    expect(out.lastStatus).toBe(429);
  });
});

describe('loadFrames only ever reads', () => {
  const env = () => ({ SUBSCRIPTIONS: createFakeKv() });
  const week = (generatedAt) => JSON.stringify({
    generatedAt, cells: CELLS.length, latStep: FRAME_LAT_STEP, stepHours: FRAME_STEP_H,
    frames: Array.from({ length: FRAME_COUNT }, (_, i) => ({ t: 't' + i, data: 'x', dirs: 'y' })),
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
