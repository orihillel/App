import { describe, it, expect } from 'vitest';
import {
  createGpuTimer, restartGpuTimer, gpuTimerAvailable, beginGpuFrame, endGpuFrame, pollGpuFrames, MAX_PENDING,
} from './gputimer.js';

// Just enough of a WebGL2 context with the timer extension: queries answer when a test says so.
function fakeGl({ withTimer = true } = {}) {
  const ext = { TIME_ELAPSED_EXT: 0x88bf, GPU_DISJOINT_EXT: 0x8fbb };
  return {
    QUERY_RESULT_AVAILABLE: 0x8867,
    QUERY_RESULT: 0x8866,
    lost: false,
    disjoint: false,
    open: null,
    created: [],
    getExtension(name) { return withTimer && name === 'EXT_disjoint_timer_query_webgl2' ? ext : null; },
    createQuery() { const q = { available: false, ns: 0, deleted: false }; this.created.push(q); return q; },
    beginQuery(target, q) {
      if (this.open) throw new Error('a query is already open');
      this.open = q;
    },
    endQuery() { this.open = null; },
    deleteQuery(q) { q.deleted = true; },
    isContextLost() { return this.lost; },
    getParameter(p) {
      if (p !== ext.GPU_DISJOINT_EXT) return null;
      const d = this.disjoint;
      this.disjoint = false;
      return d;
    },
    getQueryParameter(q, p) { return p === this.QUERY_RESULT_AVAILABLE ? q.available : q.ns; },
  };
}
const answer = (q, ms) => { q.available = true; q.ns = ms * 1e6; };
const collect = (timer) => {
  const out = [];
  pollGpuFrames(timer, (ms, tag) => out.push([ms, tag]));
  return out;
};

describe('timing frames on the GPU', () => {
  it('reports a frame once the GPU has answered, in milliseconds, with its tag', () => {
    const gl = fakeGl();
    const timer = createGpuTimer(gl);
    expect(gpuTimerAvailable(timer)).toBe(true);
    expect(beginGpuFrame(timer)).toBe(true);
    endGpuFrame(timer, 'drag');
    // Never in the same frame: nothing yet.
    expect(collect(timer)).toEqual([]);
    answer(gl.created[0], 2.5);
    expect(collect(timer)).toEqual([[2.5, 'drag']]);
    expect(gl.created[0].deleted).toBe(true);
    expect(collect(timer)).toEqual([]);
  });

  it('reports oldest first, so a later answer waits for an earlier one', () => {
    const gl = fakeGl();
    const timer = createGpuTimer(gl);
    beginGpuFrame(timer); endGpuFrame(timer, 'a');
    beginGpuFrame(timer); endGpuFrame(timer, 'b');
    answer(gl.created[1], 4);
    expect(collect(timer)).toEqual([]);
    answer(gl.created[0], 3);
    expect(collect(timer)).toEqual([[3, 'a'], [4, 'b']]);
  });

  it('never opens a second query while one is open', () => {
    const timer = createGpuTimer(fakeGl());
    expect(beginGpuFrame(timer)).toBe(true);
    expect(beginGpuFrame(timer)).toBe(false);
    endGpuFrame(timer, 'x');
    expect(beginGpuFrame(timer)).toBe(true);
  });

  it('stops timing new frames while too many go unanswered', () => {
    const gl = fakeGl();
    const timer = createGpuTimer(gl);
    for (let i = 0; i < MAX_PENDING; i++) {
      expect(beginGpuFrame(timer)).toBe(true);
      endGpuFrame(timer, i);
    }
    expect(beginGpuFrame(timer)).toBe(false);
    answer(gl.created[0], 1);
    collect(timer);
    expect(beginGpuFrame(timer)).toBe(true);
  });

  it('throws away everything in flight after a disjoint event, and carries on after it', () => {
    const gl = fakeGl();
    const timer = createGpuTimer(gl);
    beginGpuFrame(timer); endGpuFrame(timer, 'a');
    beginGpuFrame(timer); endGpuFrame(timer, 'b');
    answer(gl.created[0], 3);
    gl.disjoint = true;
    expect(collect(timer)).toEqual([]);
    expect(gl.created.every((q) => q.deleted)).toBe(true);
    beginGpuFrame(timer); endGpuFrame(timer, 'c');
    answer(gl.created[2], 5);
    expect(collect(timer)).toEqual([[5, 'c']]);
  });

  it('drops what was in flight when the context is lost, and starts again once it is back', () => {
    const gl = fakeGl();
    const timer = createGpuTimer(gl);
    beginGpuFrame(timer); endGpuFrame(timer, 'a');
    gl.lost = true;
    expect(collect(timer)).toEqual([]);
    expect(timer.pending).toEqual([]);
    gl.lost = false;
    expect(restartGpuTimer(timer)).toBe(true);
    beginGpuFrame(timer); endGpuFrame(timer, 'b');
    answer(gl.created[1], 2);
    expect(collect(timer)).toEqual([[2, 'b']]);
  });

  it('says so where the browser has no timer, and never touches the context', () => {
    const gl = fakeGl({ withTimer: false });
    const timer = createGpuTimer(gl);
    expect(gpuTimerAvailable(timer)).toBe(false);
    expect(beginGpuFrame(timer)).toBe(false);
    endGpuFrame(timer, 'a');
    expect(collect(timer)).toEqual([]);
    expect(gl.created).toEqual([]);
  });

  it('copes with no context at all', () => {
    const timer = createGpuTimer(null);
    expect(gpuTimerAvailable(timer)).toBe(false);
    expect(beginGpuFrame(timer)).toBe(false);
  });
});
