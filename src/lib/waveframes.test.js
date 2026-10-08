import { describe, it, expect } from 'vitest';
import { frameLabel, frameBuildLabel, lerpFrames, weekFrameAt, PLAYBACK_SPEEDS, nextSpeed, speedLabel, advanceTimeline, LOOP_HOLD_STEPS, stepFrame, isTimelineKey } from './waveframes.js';

describe('frameLabel', () => {
  it('reads a UTC frame in the viewer\'s own clock', () => {
    // The container runs UTC, so these are directly checkable here.
    expect(frameLabel('2026-09-10T15:00')).toBe('Thu 3pm');
    expect(frameLabel('2026-09-10T00:00')).toBe('Thu 12am');
    expect(frameLabel('2026-09-10T12:00')).toBe('Thu 12pm');
  });

  it('treats a zoneless timestamp as UTC, which is what the build writes', () => {
    // Without this the label is silently wrong by the viewer's offset, and right only in London.
    expect(frameLabel('2026-09-10T15:00')).toBe(frameLabel('2026-09-10T15:00Z'));
  });

  it('says today and tomorrow where they apply', () => {
    const now = Date.parse('2026-09-10T09:00:00Z');
    expect(frameLabel('2026-09-10T18:00', now)).toBe('Today 6pm');
    expect(frameLabel('2026-09-11T06:00', now)).toBe('Tomorrow 6am');
    expect(frameLabel('2026-09-13T06:00', now)).toBe('Sun 6am');
  });

  it('answers empty for junk rather than printing NaN', () => {
    for (const bad of ['', null, undefined, 'not a date', 42]) expect(frameLabel(bad)).toBe('');
  });
});

describe('frameBuildLabel', () => {
  it('says how far along the week is, because "not yet" is not "broken"', () => {
    // The week assembles a couple of frames at a time on a schedule, so this is the normal
    // state for the first couple of hours after a deploy.
    expect(frameBuildLabel({ building: true, ready: 9, wanted: 28 }))
      .toBe('Building the week — 9 of 28 hours ready');
    expect(frameBuildLabel({ building: true, ready: 0, wanted: 28 }))
      .toBe('Building the week — no hours ready yet');
  });

  it('distinguishes a refused request from a build still in progress', () => {
    expect(frameBuildLabel({ aborted: 'timestep-overrun' })).toMatch(/refused the request/);
  });

  it('falls back to a plain sentence when it knows nothing', () => {
    expect(frameBuildLabel(null)).toBe('Animation unavailable right now');
    expect(frameBuildLabel({})).toBe('Animation unavailable right now');
  });
});

describe('frameBuildLabel distinguishes how the request failed', () => {
  it('separates an unreachable service from one that answered with an error', () => {
    expect(frameBuildLabel({ unreachable: true })).toMatch(/couldn't reach/);
    expect(frameBuildLabel({ httpStatus: 500 })).toMatch(/answered 500/);
  });

  it('names a Worker that predates the endpoint, which is a deploy problem not a data one', () => {
    expect(frameBuildLabel({ httpStatus: 404 })).toMatch(/predates the animation/);
  });

  it('still prefers progress over a status when the build is genuinely running', () => {
    expect(frameBuildLabel({ building: true, ready: 4, wanted: 28 })).toMatch(/4 of 28/);
  });
});

describe('lerpFrames', () => {
  const A = { t: '2026-09-11T00:00', heights: [1, 4, null, 2], dirs: [350, 10, null, 90] };
  const B = { t: '2026-09-11T06:00', heights: [3, 2, 5, null], dirs: [10, 350, 200, null] };

  it('blends heights linearly', () => {
    const mid = lerpFrames(A, B, 0.5);
    expect(mid.heights[0]).toBeCloseTo(2, 10);
    expect(mid.heights[1]).toBeCloseTo(3, 10);
  });

  it('takes the short way round the circle for directions', () => {
    // The whole reason directions cannot blend linearly: 350 and 10 average to 180 that way,
    // which points the arrow exactly backwards.
    const mid = lerpFrames(A, B, 0.5);
    expect(mid.dirs[0]).toBeCloseTo(0, 6);   // 350 -> 10 crosses north, not south
    expect(mid.dirs[1]).toBeCloseTo(0, 6);   // 10 -> 350, the other way
    expect(mid.dirs[0]).not.toBeCloseTo(180, 0);
  });

  it('keeps a reading that exists on only one side rather than blending toward nothing', () => {
    const mid = lerpFrames(A, B, 0.5);
    expect(mid.heights[2]).toBe(5);   // land in A, sea in B
    expect(mid.heights[3]).toBe(2);   // sea in A, land in B
    expect(mid.dirs[2]).toBe(200);
    expect(mid.dirs[3]).toBe(90);
  });

  it('returns the endpoints exactly at t=0 and t=1', () => {
    expect(lerpFrames(A, B, 0)).toBe(A);
    const end = lerpFrames(A, B, 1);
    expect(end.heights[0]).toBeCloseTo(3, 10);
    expect(end.dirs[0]).toBeCloseTo(10, 6);
  });

  it('clamps past the end and copes with a missing neighbour', () => {
    expect(lerpFrames(A, B, 2).heights[0]).toBeCloseTo(3, 10);
    expect(lerpFrames(A, null, 0.5)).toBe(A);
    expect(lerpFrames(null, B, 0.5)).toBe(B);
    expect(lerpFrames(null, null, 0.5)).toBeNull();
  });

  it('never produces an angle outside 0..360', () => {
    for (let t = 0; t <= 1; t += 0.05) {
      for (const d of lerpFrames(A, B, t).dirs) {
        if (d == null) continue;
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThan(360);
      }
    }
  });
});

describe('playback', () => {
  it('cycles the speeds and labels them', () => {
    expect(nextSpeed(1)).toBe(2);
    expect(nextSpeed(2)).toBe(0.5);
    expect(nextSpeed(0.5)).toBe(1);
    expect(PLAYBACK_SPEEDS.map(speedLabel)).toEqual(['½×', '1×', '2×']);
  });

  it('moves one forecast step per stepMs at 1x, scaled by speed', () => {
    expect(advanceTimeline(0, 27, 450, { speed: 1, stepMs: 450 }).pos).toBeCloseTo(1);
    expect(advanceTimeline(0, 27, 450, { speed: 2, stepMs: 450 }).pos).toBeCloseTo(2);
    expect(advanceTimeline(0, 27, 450, { speed: 0.5, stepMs: 450 }).pos).toBeCloseTo(0.5);
  });

  it('plays at the same pace whatever the frame rate', () => {
    // A second of 120 Hz frames and a second of 30 Hz frames reach the same place.
    let at120 = 0;
    for (let i = 0; i < 120; i++) at120 = advanceTimeline(at120, 27, 1000 / 120, { stepMs: 450 }).pos;
    let at30 = 0;
    for (let i = 0; i < 30; i++) at30 = advanceTimeline(at30, 27, 1000 / 30, { stepMs: 450 }).pos;
    expect(at120).toBeCloseTo(1000 / 450, 6);
    expect(at30).toBeCloseTo(at120, 6);
  });

  it('stops on the last frame without repeat, and says so', () => {
    expect(advanceTimeline(26.9, 27, 450, { speed: 2, stepMs: 450 })).toEqual({ pos: 27, ended: true });
    expect(advanceTimeline(26, 27, 100, { stepMs: 450 }).ended).toBe(false);
  });

  it('holds the last frame for half a step, then starts over, with repeat on', () => {
    const atEnd = advanceTimeline(26.9, 27, 90, { stepMs: 450, loop: true });
    expect(atEnd.pos).toBeCloseTo(27.1);
    expect(atEnd.ended).toBe(false);
    expect(advanceTimeline(27 + LOOP_HOLD_STEPS - 0.01, 27, 45, { stepMs: 450, loop: true }).pos).toBe(0);
  });

  it('ignores a negative or missing frame time', () => {
    expect(advanceTimeline(3, 27, -16, { stepMs: 450 }).pos).toBe(3);
    expect(advanceTimeline(3, 27, undefined, { stepMs: 450 }).pos).toBe(3);
  });

  it('copes with a week of one frame', () => {
    expect(advanceTimeline(0, 0, 16, { loop: true }).pos).toBe(0);
    expect(stepFrame(0, 1, 0)).toBe(0);
  });
});

describe('stepFrame', () => {
  it('steps one whole frame each way and stops at the ends', () => {
    expect(stepFrame(3, 1, 27)).toBe(4);
    expect(stepFrame(3, -1, 27)).toBe(2);
    expect(stepFrame(27, 1, 27)).toBe(27);
    expect(stepFrame(0, -1, 27)).toBe(0);
  });

  it('lands on the neighbouring frame from between two', () => {
    expect(stepFrame(3.2, 1, 27)).toBe(4);
    expect(stepFrame(3.8, 1, 27)).toBe(4);
    expect(stepFrame(3.2, -1, 27)).toBe(3);
    expect(stepFrame(3.8, -1, 27)).toBe(3);
  });
});

describe('isTimelineKey', () => {
  const key = (k, extra = {}) => ({ key: k, target: { tagName: 'DIV' }, ...extra });
  it('takes the bare left and right arrows', () => {
    expect(isTimelineKey(key('ArrowLeft'))).toBe(true);
    expect(isTimelineKey(key('ArrowRight'))).toBe(true);
    expect(isTimelineKey(key('ArrowUp'))).toBe(false);
    expect(isTimelineKey(key(' '))).toBe(false);
  });

  it('leaves them to a focused control or a shortcut', () => {
    expect(isTimelineKey(key('ArrowRight', { target: { tagName: 'INPUT' } }))).toBe(false);
    expect(isTimelineKey(key('ArrowRight', { target: { tagName: 'SELECT' } }))).toBe(false);
    expect(isTimelineKey(key('ArrowRight', { target: { tagName: 'DIV', isContentEditable: true } }))).toBe(false);
    expect(isTimelineKey(key('ArrowRight', { metaKey: true }))).toBe(false);
  });
});

describe('weekFrameAt', () => {
  const list = [
    { t: 'a', heights: [0, 0] },
    { t: 'b', heights: [2, 4] },
    { t: 'c', heights: [4, 8] },
  ];

  it('shows the live map at now when nothing is playing', () => {
    // The first frame is the same moment on a coarser grid; it must not replace the live map.
    expect(weekFrameAt(list, 0, false)).toBeNull();
  });

  it('draws the first frame like any other while playing', () => {
    expect(weekFrameAt(list, 0, true)).toBe(list[0]);
  });

  it('draws a frame exactly on it and a blend between two', () => {
    expect(weekFrameAt(list, 1, false)).toBe(list[1]);
    const mid = weekFrameAt(list, 1.5, true);
    expect(mid.heights).toEqual([3, 6]);
  });

  it('holds the last frame at the end of the week', () => {
    expect(weekFrameAt(list, 2, false)).toBe(list[2]);
    expect(weekFrameAt(list, 5, false)).toBe(list[2]);
  });

  it('has nothing to draw without frames', () => {
    expect(weekFrameAt([], 1, true)).toBeNull();
    expect(weekFrameAt(null, 1, true)).toBeNull();
  });
});
