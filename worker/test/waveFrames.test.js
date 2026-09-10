import { describe, it, expect, vi } from 'vitest';
import {
  frameTimes, fetchFrame, buildFrames, framesAreUsable, loadFrames,
  FRAME_COUNT, FRAME_STEP_H, MAX_TIMESTEPS_PER_FRAME, MAX_FETCHES, FRAMES_MIN_COVERAGE,
  FRAMES_REFRESH_MS,
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

describe('buildFrames', () => {
  const serve = (h = 1.4, d = 250) => vi.fn(async () => okRes(CELLS.map(() => loc(h, d))));

  it('builds a full week and stays inside the platform subrequest limit', async () => {
    const fetchImpl = serve();
    const out = await buildFrames({ fetchImpl, sleep: noSleep, now: Date.parse('2026-09-10T00:00:00Z') });
    expect(out.frames).toHaveLength(FRAME_COUNT);
    expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(MAX_FETCHES);
    expect(fetchImpl.mock.calls.length).toBeLessThan(50);
    expect(out.aborted).toBeNull();
    expect(out.coverage).toBe(1);
  });

  it('costs what the budget said it would', async () => {
    // 186 cells x 28 frames. The number that chose the coarse grid, asserted so it cannot drift.
    const out = await buildFrames({ fetchImpl: serve(), sleep: noSleep });
    expect(out.units).toBe(186 * FRAME_COUNT);
    expect(out.units).toBeLessThan(10000);
  });

  it('stops the whole build at the first over-long frame, not just that frame', async () => {
    const overrun = { hourly: { time: Array(168).fill('x'), wave_height: Array(168).fill(1), wave_direction: Array(168).fill(0) } };
    let n = 0;
    const fetchImpl = vi.fn(async () => {
      n++;
      return okRes(CELLS.map(() => (n >= 3 ? overrun : loc(1, 90))));
    });
    const out = await buildFrames({ fetchImpl, sleep: noSleep });
    expect(out.aborted).toBe('timestep-overrun');
    // Three requests spent, not twenty-eight.
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(framesAreUsable(out)).toBe(false);
  });

  it('plans fewer frames rather than exceeding the fetch limit when batches are smaller', async () => {
    const fetchImpl = serve();
    const out = await buildFrames({ fetchImpl, sleep: noSleep, batchSize: 50, maxFetches: 20 });
    // 186 cells at 50 per batch is 4 fetches a frame, so 20 fetches buys 5 frames.
    expect(out.frames).toHaveLength(5);
    expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(20);
  });

  it('encodes each frame so the app can decode it against the coarse grid', async () => {
    const out = await buildFrames({ fetchImpl: serve(2.5, 180), sleep: noSleep, frameCount: 2 });
    expect(out.cells).toBe(CELLS.length);
    expect(out.latStep).toBe(FRAME_LAT_STEP);
    expect(out.stepHours).toBe(FRAME_STEP_H);
    const heights = decodeHeights(base64ToBytes(out.frames[0].data));
    expect(heights).toHaveLength(CELLS.length);
    expect(heights[0]).toBeCloseTo(2.5, 1);
    expect(out.frames[0].t).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('keeps going when one frame fails, and records why', async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => {
      n++;
      if (n === 2) return { ok: false, status: 429, json: async () => ({ reason: 'rate limited' }) };
      return okRes(CELLS.map(() => loc(1, 90)));
    });
    const out = await buildFrames({ fetchImpl, sleep: noSleep, frameCount: 4 });
    expect(out.frames).toHaveLength(4);      // the failed frame is still a frame, just empty
    expect(out.lastStatus).toBe(429);
    expect(out.coverage).toBeLessThan(1);
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

describe('loadFrames', () => {
  const okBuild = () => ({
    generatedAt: Date.now(), cells: CELLS.length, latStep: FRAME_LAT_STEP, stepHours: FRAME_STEP_H,
    frames: [{ t: 'a', data: 'x', dirs: 'y' }, { t: 'b', data: 'x', dirs: 'y' }],
    coverage: 1, aborted: null, units: 5208,
  });

  it('serves a cached week without asking upstream again', async () => {
    const env = { SUBSCRIPTIONS: createFakeKv() };
    const build = vi.fn(async () => okBuild());
    await loadFrames(env, { build });
    const second = await loadFrames(env, { build });
    expect(build).toHaveBeenCalledTimes(1);
    expect(second.frames.stale).toBe(false);
  });

  it('rebuilds once the cached week is a day old', async () => {
    const env = { SUBSCRIPTIONS: createFakeKv() };
    const t0 = Date.parse('2026-09-10T00:00:00Z');
    const build = vi.fn(async (o) => ({ ...okBuild(), generatedAt: o.now }));
    await loadFrames(env, { build, now: t0 });
    await loadFrames(env, { build, now: t0 + FRAMES_REFRESH_MS + 1 });
    expect(build).toHaveBeenCalledTimes(2);
  });

  it('does not cache an aborted build, and cools off instead of retrying it', async () => {
    // The abort is a property of the upstream, not a transient. Retrying on the next request
    // would spend the same units to be told the same thing.
    const env = { SUBSCRIPTIONS: createFakeKv() };
    const build = vi.fn(async () => ({ ...okBuild(), aborted: 'timestep-overrun', coverage: 0 }));
    const first = await loadFrames(env, { build });
    expect(first.frames).toBeNull();
    expect(first.build.aborted).toBe('timestep-overrun');
    const second = await loadFrames(env, { build });
    expect(build).toHaveBeenCalledTimes(1);         // not asked again
    expect(second.build.cooling).toBe(true);
    expect(second.build.retryInSeconds).toBeGreaterThan(0);
  });

  it('keeps serving the last good week, marked stale, while a rebuild is failing', async () => {
    const env = { SUBSCRIPTIONS: createFakeKv() };
    const t0 = Date.parse('2026-09-10T00:00:00Z');
    await loadFrames(env, { build: async (o) => ({ ...okBuild(), generatedAt: o.now }), now: t0 });
    const later = await loadFrames(env, {
      build: async () => ({ frames: [], coverage: 0, lastStatus: 429, lastError: 'rate limited' }),
      now: t0 + FRAMES_REFRESH_MS + 1,
    });
    expect(later.frames).not.toBeNull();
    expect(later.frames.stale).toBe(true);
    expect(later.build.lastStatus).toBe(429);
  });

  it('survives a build that throws', async () => {
    const env = { SUBSCRIPTIONS: createFakeKv() };
    const out = await loadFrames(env, { build: async () => { throw new Error('boom'); } });
    expect(out.frames).toBeNull();
    expect(out.build.lastError).toMatch(/boom/);
  });
});
