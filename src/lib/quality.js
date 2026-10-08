// Automatic quality scaling for the globe: the pixel ratio follows how the device is coping.
//
// The globe draws at up to twice the CSS resolution. On a phone that is 1.3 million pixels a
// frame, and the overlay, the coastline, the arrows and the wind all draw into every one of
// them. A device that cannot keep up drops frames, and a dropped frame during a drag or the
// animated week is exactly the stutter this globe has spent its effort removing. Drawing fewer
// pixels is the one lever that helps whatever the GPU is struggling with, so when frames keep
// arriving late the governor lowers the pixel ratio a step at a time, down to the CSS
// resolution, and when they have been on time for a good while it raises it again.
//
// Two things keep it from flickering between sizes, which would be worse than either. It waits
// for evidence: a step down needs half a second of mostly late frames, a step up three seconds
// of almost none. And it remembers: a level that has been tried and given up twice is not tried
// again.
//
// What counts as late is judged against the screen's own refresh interval, measured from the
// ticks where the globe had nothing to draw -- the loop still runs then, and a tick that does
// nothing arrives exactly once a refresh. So a 120 Hz phone is held to 8.3 ms, and an iPhone in
// Low Power Mode, at 30 Hz, is not marked down for drawing every 33 ms.
//
// Pure arithmetic, fed one tick at a time; see lib/quality.test.js.

export const QUALITY_STEPS = [1, 1.25, 1.5, 1.75, 2];

// A drawn frame is late when it arrives this many refresh intervals after the one before.
const LATE = 1.5;
// Step down after this much drawing in which more than this share of frames were late...
const DOWN_AFTER_MS = 500;
const DOWN_LATE_SHARE = 0.25;
// ...and up after this much drawing with fewer late frames than this.
const UP_AFTER_MS = 3000;
const UP_LATE_SHARE = 0.05;
// A level given up this many times is not tried again.
const MAX_RETRIES = 2;
// Gaps longer than this are not frame intervals: a backgrounded tab, a long pause. A device
// drawing three frames a second is still drawing frames, and is the one that most needs this.
const MAX_INTERVAL_MS = 1000;
// Until any idle ticks have been seen, the refresh is assumed to be 60 Hz.
const DEFAULT_REFRESH_MS = 1000 / 60;
// How many idle intervals the refresh estimate is taken over.
const REFRESH_SAMPLES = 32;

export function createQualityGovernor({ max = 2, min = 1 } = {}) {
  const top = Math.max(min, max);
  const levels = QUALITY_STEPS.filter((r) => r > min && r < top);
  levels.unshift(min);
  if (top > min) levels.push(top);
  return {
    levels,
    level: levels.length - 1,
    refreshSamples: [],
    refreshMs: DEFAULT_REFRESH_MS,
    // Drawing time, and how much of it went to late frames, over the short window that decides
    // a step down and the long one that decides a step up.
    short: { drawn: 0, late: 0 },
    long: { drawn: 0, late: 0 },
    // Drawing time since the last step, and which way it went: a step down soon after a step
    // up means that level was too much.
    sinceStep: 0,
    lastStep: 0,
    givenUp: new Array(levels.length).fill(0),
  };
}

export function governorRatio(gov) {
  return gov.levels[gov.level];
}

// One tick of the loop. `intervalMs` is the time since the previous tick; `drew` and
// `prevDrew` say whether this tick and the one before it drew a frame. Returns the new pixel
// ratio when it should change, or null.
export function governorTick(gov, { intervalMs, drew, prevDrew }) {
  if (!(intervalMs > 0) || intervalMs > MAX_INTERVAL_MS) return null;

  if (!drew && !prevDrew) {
    // An idle tick: the loop did nothing, so this interval is the screen's refresh.
    gov.refreshSamples.push(intervalMs);
    if (gov.refreshSamples.length > REFRESH_SAMPLES) gov.refreshSamples.shift();
    const sorted = gov.refreshSamples.slice().sort((a, b) => a - b);
    gov.refreshMs = sorted[Math.floor(sorted.length / 2)];
    return null;
  }
  // Only the gap between two drawn frames says anything about how long a frame takes.
  if (!drew || !prevDrew) return null;

  const late = intervalMs > gov.refreshMs * LATE ? intervalMs : 0;
  gov.short.drawn += intervalMs;
  gov.short.late += late;
  gov.long.drawn += intervalMs;
  gov.long.late += late;
  gov.sinceStep += intervalMs;

  if (gov.short.drawn >= DOWN_AFTER_MS) {
    const share = gov.short.late / gov.short.drawn;
    gov.short = { drawn: 0, late: 0 };
    if (share > DOWN_LATE_SHARE && gov.level > 0) {
      if (gov.lastStep > 0 && gov.sinceStep < UP_AFTER_MS) gov.givenUp[gov.level] += 1;
      return step(gov, -1);
    }
  }
  if (gov.long.drawn >= UP_AFTER_MS) {
    const share = gov.long.late / gov.long.drawn;
    gov.long = { drawn: 0, late: 0 };
    const next = gov.level + 1;
    if (share < UP_LATE_SHARE && next < gov.levels.length && gov.givenUp[next] < MAX_RETRIES) {
      return step(gov, +1);
    }
  }
  return null;
}

// Each step starts both windows afresh, so the new size is judged on its own frames.
function step(gov, dir) {
  gov.level += dir;
  gov.lastStep = dir;
  gov.sinceStep = 0;
  gov.short = { drawn: 0, late: 0 };
  gov.long = { drawn: 0, late: 0 };
  return gov.levels[gov.level];
}
