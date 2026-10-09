import { describe, it, expect } from 'vitest';
import {
  createFrameStats, recordFrame, recordGpu, summarizeFrames, percentile, perfLines, readPerfFlag,
  frameActivity, createActivityStats, ACTIVITIES,
} from './framestats.js';

function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
  };
}

describe('percentile', () => {
  it('reads the nearest-rank percentile of a sorted list', () => {
    const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(xs, 50)).toBe(5);
    expect(percentile(xs, 95)).toBe(10);
    expect(percentile(xs, 10)).toBe(1);
    expect(percentile([], 50)).toBeNull();
  });
});

describe('summarizeFrames', () => {
  it('reads a steady 60 Hz run as 60 fps with nothing dropped', () => {
    const s = createFrameStats(120);
    for (let i = 0; i < 120; i++) recordFrame(s, 1000 / 60, 2);
    const sum = summarizeFrames(s);
    expect(Math.round(sum.fps)).toBe(60);
    expect(Math.round(sum.hz)).toBe(60);
    expect(sum.dropped).toBe(0);
    expect(sum.cpuP50).toBe(2);
  });

  it('counts a frame that overran by two intervals as two dropped', () => {
    const s = createFrameStats(120);
    for (let i = 0; i < 100; i++) recordFrame(s, 1000 / 60, 1);
    recordFrame(s, 50, 30); // one gap three intervals long
    const sum = summarizeFrames(s);
    expect(sum.dropped).toBe(2);
    expect(sum.max).toBe(50);
  });

  it('estimates a 120 Hz screen from its fastest frames', () => {
    const s = createFrameStats(120);
    for (let i = 0; i < 100; i++) recordFrame(s, 1000 / 120, 1);
    for (let i = 0; i < 20; i++) recordFrame(s, 1000 / 60, 1); // some frames miss
    const sum = summarizeFrames(s);
    expect(Math.round(sum.hz)).toBe(120);
    expect(sum.dropped).toBe(20);
  });

  it('does not invent a screen rate when every frame is slow', () => {
    // Software rendering, or a phone far over budget: no frame makes a 30 Hz deadline.
    const s = createFrameStats(60);
    for (let i = 0; i < 60; i++) recordFrame(s, 180, 1);
    const sum = summarizeFrames(s);
    expect(sum.hz).toBeNull();
    // Counted against 60 Hz: each 180 ms gap is about ten missed frames.
    expect(sum.dropped).toBe(60 * 10);
    expect(perfLines(sum)[0]).toBe('6 fps · every frame slow · 600 dropped');
  });

  it('still reads iOS Low Power Mode as a 30 Hz screen', () => {
    const s = createFrameStats(60);
    for (let i = 0; i < 60; i++) recordFrame(s, 1000 / 30, 1);
    expect(Math.round(summarizeFrames(s).hz)).toBe(30);
  });

  it('keeps only the most recent window', () => {
    const s = createFrameStats(10);
    for (let i = 0; i < 10; i++) recordFrame(s, 100, 1);
    for (let i = 0; i < 10; i++) recordFrame(s, 1000 / 60, 1);
    expect(Math.round(summarizeFrames(s).fps)).toBe(60);
  });

  it('ignores gaps that are not real frame intervals', () => {
    const s = createFrameStats(10);
    recordFrame(s, 0, 1);
    recordFrame(s, NaN, 1);
    recordFrame(s, -5, 1);
    expect(summarizeFrames(s)).toBeNull();
  });
});

describe('perfLines', () => {
  it('says idle rather than zero frames a second when nothing is drawing', () => {
    const lines = perfLines(null, { idle: true, calls: 9, triangles: 312000, lines: 809764, pixelRatio: 2, width: 780, height: 1500 });
    expect(lines[0]).toMatch(/^idle/);
    expect(lines).toContain('draws 9 · tris 312k · lines 810k');
    expect(lines).toContain('px ratio 2 · 780×1500');
  });

  it('shows when the pixel ratio has been stepped down', () => {
    expect(perfLines(null, { idle: true, pixelRatio: 1.5, pixelRatioMax: 2, width: 585, height: 1125 })).toContain('px ratio 1.5 of 2 · 585×1125');
    expect(perfLines(null, { idle: true, pixelRatio: 2, pixelRatioMax: 2, width: 780, height: 1500 })).toContain('px ratio 2 · 780×1500');
  });

  it('reports rate, frame times and JS time while drawing', () => {
    const s = createFrameStats(60);
    for (let i = 0; i < 60; i++) recordFrame(s, 1000 / 60, 3.2);
    const lines = perfLines(summarizeFrames(s), { calls: 4, triangles: 900, lines: 0, paintMs: 12.66 });
    expect(lines[0]).toBe('60 fps · ~60 Hz screen · 0 dropped');
    expect(lines[1]).toBe('frame 16.7 / 16.7 / 16.7 / 16.7 ms (p50/p95/p99/max)');
    expect(lines[2]).toBe('JS 3.2 / 3.2 ms per frame (p50/p95)');
    expect(lines).toContain('overlay paint 12.7 ms');
  });

  it('reports the GPU where the browser can time it, and says so where it cannot', () => {
    const s = createFrameStats(60);
    for (let i = 0; i < 60; i++) { recordFrame(s, 1000 / 60, 1); recordGpu(s, 4.2); }
    const sum = summarizeFrames(s);
    expect(perfLines(sum, { gpu: true })).toContain('GPU 4.2 / 4.2 ms per frame (p50/p95)');
    expect(perfLines(sum, { gpu: false })).toContain('GPU time not offered by this browser');
    expect(perfLines(sum, {}).some((l) => l.startsWith('GPU'))).toBe(false);
  });

  it('lists each activity that has been done, even once the globe is idle again', () => {
    const acts = createActivityStats(60);
    for (let i = 0; i < 30; i++) { recordFrame(acts.drag, 1000 / 60, 1); recordGpu(acts.drag, 3); }
    for (let i = 0; i < 20; i++) { recordFrame(acts.play, 20, 1); recordGpu(acts.play, 6); }
    const activities = Object.fromEntries(ACTIVITIES.map((n) => [n, summarizeFrames(acts[n])]));
    const lines = perfLines(null, { idle: true, gpu: true, activities });
    expect(lines[0]).toMatch(/^idle/);
    expect(lines).toContain('activity  p50/p95/p99 ms · GPU p95 · frames');
    expect(lines).toContain('  drag     16.7/16.7/16.7 · 3.0 · 30');
    expect(lines).toContain('  playback 20.0/20.0/20.0 · 6.0 · 20');
    // Nothing for what has not been done.
    expect(lines.some((l) => /fling|fly-to|still/.test(l))).toBe(false);
    // And no GPU column where there is no GPU timer.
    expect(perfLines(null, { idle: true, gpu: false, activities })).toContain('  drag     16.7/16.7/16.7 · 30');
  });

  it('leaves the activities out until there are some', () => {
    const lines = perfLines(null, { idle: true, activities: Object.fromEntries(ACTIVITIES.map((n) => [n, null])) });
    expect(lines.some((l) => l.startsWith('activity'))).toBe(false);
  });
});

describe('the 99th percentile and the GPU', () => {
  it('reads the 99th percentile of frame gaps, where the rare long frame shows', () => {
    const s = createFrameStats(200);
    for (let i = 0; i < 100; i++) recordFrame(s, 1000 / 60, 1);
    recordFrame(s, 50, 1);
    recordFrame(s, 50, 1);
    const sum = summarizeFrames(s);
    expect(sum.p95).toBeCloseTo(1000 / 60, 9);
    expect(sum.p99).toBe(50);
  });

  it('keeps GPU times apart from frame gaps, since they arrive frames later', () => {
    const s = createFrameStats(10);
    for (let i = 0; i < 10; i++) recordFrame(s, 1000 / 60, 1);
    expect(summarizeFrames(s).gpuP50).toBeNull();
    expect(summarizeFrames(s).gpuFrames).toBe(0);
    recordGpu(s, 2);
    recordGpu(s, 4);
    recordGpu(s, NaN);
    recordGpu(s, -1);
    const sum = summarizeFrames(s);
    expect(sum.gpuFrames).toBe(2);
    expect(sum.gpuP50).toBe(2);
    expect(sum.gpuP95).toBe(4);
  });
});

describe('frameActivity', () => {
  it('names what the globe was doing, the most demanding thing first', () => {
    expect(frameActivity({ handOn: true, flying: true, cameraMoving: true, playing: true })).toBe('drag');
    expect(frameActivity({ flying: true, cameraMoving: true, playing: true })).toBe('fly');
    expect(frameActivity({ cameraMoving: true, playing: true })).toBe('fling');
    expect(frameActivity({ playing: true })).toBe('play');
    expect(frameActivity({})).toBe('still');
    expect(frameActivity()).toBe('still');
  });

  it('keeps a window for every activity it can name', () => {
    const acts = createActivityStats();
    for (const name of ACTIVITIES) expect(acts[name].size).toBeGreaterThan(0);
    expect(Object.keys(acts).sort()).toEqual([...ACTIVITIES].sort());
  });
});

describe('readPerfFlag', () => {
  it('is off by default', () => {
    expect(readPerfFlag('', fakeStorage())).toBe(false);
  });

  it('turns on from ?perf=1 and remembers it for later visits without the parameter', () => {
    const store = fakeStorage();
    expect(readPerfFlag('?perf=1', store)).toBe(true);
    expect(readPerfFlag('', store)).toBe(true);
  });

  it('turns off from ?perf=0 and forgets it', () => {
    const store = fakeStorage({ 'surf-perf': '1' });
    expect(readPerfFlag('?perf=0', store)).toBe(false);
    expect(readPerfFlag('', store)).toBe(false);
  });

  it('still honours the URL when storage throws', () => {
    const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
    expect(readPerfFlag('?perf=1', broken)).toBe(true);
    expect(readPerfFlag('', broken)).toBe(false);
  });
});
