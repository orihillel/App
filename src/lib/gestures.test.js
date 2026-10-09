import { describe, it, expect } from 'vitest';
import { createGesture, gestureDown, gestureMove, gestureUp, gestureCancel, TAP_SLOP_PX, TAP_MS } from './gestures.js';

describe('a drag', () => {
  it('grabs, reports each move, and releases without a tap once it has moved', () => {
    const g = createGesture();
    expect(gestureDown(g, 1, 100, 100, 0).type).toBe('grab');
    expect(gestureMove(g, 1, 110, 104)).toEqual({ type: 'drag', dx: 10, dy: 4 });
    expect(gestureMove(g, 1, 130, 104)).toEqual({ type: 'drag', dx: 20, dy: 0 });
    expect(gestureUp(g, 1, 130, 104, 200)).toEqual({ type: 'release', tap: null });
  });

  it('ignores a mouse moving over the globe with no button down', () => {
    const g = createGesture();
    expect(gestureMove(g, 1, 50, 50)).toEqual({ type: 'none' });
  });
});

describe('a tap', () => {
  it('is a press and release barely apart in space and time', () => {
    const g = createGesture();
    gestureDown(g, 1, 100, 100, 0);
    gestureMove(g, 1, 102, 101);
    expect(gestureUp(g, 1, 102, 101, 120)).toEqual({ type: 'release', tap: { x: 102, y: 101 } });
  });

  it('is not a press that wandered, or one that was held', () => {
    const wandered = createGesture();
    gestureDown(wandered, 1, 100, 100, 0);
    expect(gestureUp(wandered, 1, 100 + TAP_SLOP_PX, 100, 100).tap).toBeNull();
    const held = createGesture();
    gestureDown(held, 1, 100, 100, 0);
    expect(gestureUp(held, 1, 100, 100, TAP_MS).tap).toBeNull();
  });
});

describe('a pinch', () => {
  it('takes over from the drag when a second finger lands, so its speed can be dropped', () => {
    const g = createGesture();
    gestureDown(g, 1, 100, 100, 0);
    gestureMove(g, 1, 120, 100);
    expect(gestureDown(g, 2, 220, 100, 50).type).toBe('pinch-start');
    // The first finger moving now pinches rather than drags.
    expect(gestureMove(g, 1, 100, 100).type).toBe('pinch');
  });

  it('reports the change in spread as old over new: below 1 as the fingers part', () => {
    const g = createGesture();
    gestureDown(g, 1, 100, 100, 0);
    gestureDown(g, 2, 200, 100, 0); // 100 apart
    const out = gestureMove(g, 2, 300, 100); // 200 apart
    expect(out.type).toBe('pinch');
    expect(out.ratio).toBeCloseTo(0.5, 12);
    const back = gestureMove(g, 1, 200, 100); // 100 apart again
    expect(back.ratio).toBeCloseTo(2, 12);
  });

  it('leaves the remaining finger doing nothing on its own', () => {
    const g = createGesture();
    gestureDown(g, 1, 100, 100, 0);
    gestureDown(g, 2, 200, 100, 0);
    expect(gestureUp(g, 2, 200, 100, 100)).toEqual({ type: 'none' });
    expect(gestureMove(g, 1, 300, 300)).toEqual({ type: 'none' });
  });

  it('starts again, from where the fingers are now, when a lifted finger is put back', () => {
    const g = createGesture();
    gestureDown(g, 1, 100, 100, 0);
    gestureDown(g, 2, 200, 100, 0);
    gestureUp(g, 2, 200, 100, 100);
    gestureMove(g, 1, 300, 300); // wandered while alone
    expect(gestureDown(g, 3, 300, 400, 150).type).toBe('pinch-start'); // 100 apart now
    const out = gestureMove(g, 3, 300, 500); // 200 apart
    expect(out.ratio).toBeCloseTo(0.5, 12);
  });

  it('is never a tap, however the last finger comes up', () => {
    const g = createGesture();
    gestureDown(g, 1, 100, 100, 0);
    gestureDown(g, 2, 200, 100, 10);
    gestureUp(g, 2, 200, 100, 60);
    // The first finger lifts exactly where it went down, well inside the tap window.
    expect(gestureUp(g, 1, 100, 100, 120)).toEqual({ type: 'release', tap: null });
  });
});

describe('a cancelled pointer', () => {
  it('ends the gesture with no tap and nothing to release', () => {
    const g = createGesture();
    gestureDown(g, 1, 100, 100, 0);
    expect(gestureCancel(g, 1)).toEqual({ type: 'cancel' });
    // Its late pointerup, if one comes, is ignored.
    expect(gestureUp(g, 1, 100, 100, 50)).toEqual({ type: 'none' });
    // And the next touch starts afresh.
    expect(gestureDown(g, 2, 10, 10, 100).type).toBe('grab');
  });

  it('ends a pinch but leaves the other finger to be lifted', () => {
    const g = createGesture();
    gestureDown(g, 1, 100, 100, 0);
    gestureDown(g, 2, 200, 100, 0);
    expect(gestureCancel(g, 2)).toEqual({ type: 'none' });
    expect(gestureMove(g, 1, 150, 150)).toEqual({ type: 'none' });
    expect(gestureUp(g, 1, 150, 150, 50)).toEqual({ type: 'release', tap: null });
  });

  it('ignores a pointer it was never told about', () => {
    expect(gestureCancel(createGesture(), 9)).toEqual({ type: 'none' });
  });
});
