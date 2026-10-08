import { describe, it, expect } from 'vitest';
import { createQualityGovernor, governorTick, governorRatio, QUALITY_STEPS } from './quality.js';

const F60 = 1000 / 60;

// A device whose frame takes `cost(ratio)` milliseconds of work, drawing for `ms`: each frame
// lands on the first refresh after its work is done, as on a real screen. Returns every ratio
// change the governor asked for, in order.
function drive(gov, ms, cost, refresh = F60) {
  const changes = [];
  for (let t = 0; t < ms;) {
    const interval = Math.max(1, Math.ceil(cost(governorRatio(gov)) / refresh - 1e-9)) * refresh;
    const r = governorTick(gov, { intervalMs: interval, drew: true, prevDrew: true });
    if (r != null) changes.push(r);
    t += interval;
  }
  return changes;
}
// Drives as above until the governor reaches `ratio`, and stops there -- the load changing at
// the moment it responds, so no frames from one phase spill into the next.
function driveUntil(gov, cost, ratio, limitMs = 10000, refresh = F60) {
  for (let t = 0; t < limitMs && governorRatio(gov) !== ratio;) {
    const interval = Math.max(1, Math.ceil(cost(governorRatio(gov)) / refresh - 1e-9)) * refresh;
    governorTick(gov, { intervalMs: interval, drew: true, prevDrew: true });
    t += interval;
  }
  return governorRatio(gov);
}
// A device that can draw a frame in 13ms at a ratio of 1.5, and in proportion to the pixel
// count either side of it: on time at 1.5 and below, late above.
const fitsAt15 = (ratio) => 13 * (ratio / 1.5) ** 2;

// Feeds the governor `ms` worth of ticks `interval` apart. `drew` says whether those ticks drew
// a frame. Returns every ratio change it asked for, in order.
function run(gov, ms, interval, drew = true) {
  const changes = [];
  let prevDrew = drew;
  for (let t = 0; t < ms; t += interval) {
    const r = governorTick(gov, { intervalMs: interval, drew, prevDrew });
    if (r != null) changes.push(r);
    prevDrew = drew;
  }
  return changes;
}

describe('createQualityGovernor', () => {
  it('starts at the top, with the steps in between', () => {
    const gov = createQualityGovernor({ max: 2, min: 1 });
    expect(gov.levels).toEqual(QUALITY_STEPS);
    expect(governorRatio(gov)).toBe(2);
  });

  it('keeps an odd device ratio as its top step', () => {
    const gov = createQualityGovernor({ max: 1.6, min: 1 });
    expect(gov.levels).toEqual([1, 1.25, 1.5, 1.6]);
  });

  it('has nothing to do on a screen that is already at one pixel a CSS pixel', () => {
    const gov = createQualityGovernor({ max: 1, min: 1 });
    expect(gov.levels).toEqual([1]);
    expect(run(gov, 5000, F60 * 3)).toEqual([]);
  });
});

describe('governorTick', () => {
  it('leaves a device that keeps up alone', () => {
    const gov = createQualityGovernor();
    expect(run(gov, 20000, F60)).toEqual([]);
    expect(governorRatio(gov)).toBe(2);
  });

  it('steps down even on a device managing only a few frames a second', () => {
    const gov = createQualityGovernor();
    expect(run(gov, 2100, 300)).toEqual([1.75, 1.5, 1.25]);
  });

  it('steps down half a second at a time while frames keep running late, to the floor', () => {
    const gov = createQualityGovernor();
    // Every frame takes two refreshes: 30 fps on a 60 Hz screen.
    expect(run(gov, 600, F60 * 2)).toEqual([1.75]);
    expect(run(gov, 3000, F60 * 2)).toEqual([1.5, 1.25, 1]);
    expect(run(gov, 3000, F60 * 2)).toEqual([]); // nowhere lower to go
  });

  it('ignores the odd late frame', () => {
    const gov = createQualityGovernor();
    let changes = [];
    // One frame in ten takes two refreshes.
    for (let i = 0; i < 600; i++) changes = changes.concat(run(gov, 1, i % 10 === 0 ? F60 * 2 : F60));
    expect(changes).toEqual([]);
  });

  it('steps back up after three seconds of frames on time', () => {
    const gov = createQualityGovernor();
    run(gov, 1100, F60 * 2); // down twice
    expect(governorRatio(gov)).toBe(1.5);
    expect(run(gov, 2900, F60)).toEqual([]);
    expect(run(gov, 200, F60)).toEqual([1.75]);
  });

  it('settles where the device keeps up, and stops retrying the level above', () => {
    const gov = createQualityGovernor();
    // Down through the levels it cannot hold...
    expect(drive(gov, 1200, fitsAt15)).toEqual([1.75, 1.5]);
    // ...then tries the next one up twice, failing at once each time, and gives up on it.
    expect(drive(gov, 8000, fitsAt15)).toEqual([1.75, 1.5, 1.75, 1.5]);
    expect(drive(gov, 30000, fitsAt15)).toEqual([]);
    expect(governorRatio(gov)).toBe(1.5);
  });

  it('climbs back when the load lifts', () => {
    const gov = createQualityGovernor();
    // Heavy, late at any size: down to the floor, half a second a step.
    expect(driveUntil(gov, () => 30, 1, 2100)).toBe(1);
    // Light, on time at any size: one step every three seconds, back to the top.
    expect(drive(gov, 12100, () => 5)).toEqual([1.25, 1.5, 1.75, 2]);
  });

  it('does not hold a slowdown long after a step up against that level', () => {
    const gov = createQualityGovernor();
    expect(driveUntil(gov, () => 30, 1.75)).toBe(1.75);
    expect(drive(gov, 3100, () => 5)).toEqual([2]);
    drive(gov, 20000, () => 5); // a long, happy stretch at 2
    expect(driveUntil(gov, () => 30, 1.75)).toBe(1.75); // a heavy moment, much later
    expect(drive(gov, 3100, () => 5)).toEqual([2]); // 2 is still worth trying
  });

  it('counts a step up that fails straight away against that level', () => {
    const gov = createQualityGovernor();
    expect(driveUntil(gov, () => 30, 1.75)).toBe(1.75);
    expect(drive(gov, 3100, () => 5)).toEqual([2]);
    expect(driveUntil(gov, () => 30, 1.75)).toBe(1.75); // at once: 2 failed
    expect(gov.givenUp[gov.levels.indexOf(2)]).toBe(1);
  });

  it('measures the screen from idle ticks, so 120 Hz is held to 8.3 ms', () => {
    const gov = createQualityGovernor();
    run(gov, 500, 1000 / 120, false); // idle: the screen ticks at 120 Hz
    expect(gov.refreshMs).toBeCloseTo(1000 / 120, 5);
    // Drawing at 60 fps on a 120 Hz screen is missing every other refresh.
    expect(run(gov, 600, F60)).toEqual([1.75]);
  });

  it('does not mark down a phone in Low Power Mode for drawing at 30 Hz', () => {
    const gov = createQualityGovernor();
    run(gov, 1000, 1000 / 30, false); // idle: the screen ticks at 30 Hz
    expect(run(gov, 5000, 1000 / 30)).toEqual([]);
  });

  it('ignores gaps that are not frames at all', () => {
    const gov = createQualityGovernor();
    expect(run(gov, 30000, 5000)).toEqual([]); // a backgrounded tab, a tick every few seconds
    expect(gov.short.drawn).toBe(0);
  });

  it('only judges the gap between two drawn frames', () => {
    const gov = createQualityGovernor();
    // The first frame after a pause follows an idle tick, not a frame: never late.
    for (let i = 0; i < 100; i++) {
      governorTick(gov, { intervalMs: F60, drew: false, prevDrew: false });
      governorTick(gov, { intervalMs: F60 * 4, drew: true, prevDrew: false });
    }
    expect(governorRatio(gov)).toBe(2);
  });
});
