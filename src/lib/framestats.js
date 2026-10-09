// Frame timing for the globe's on-screen performance display.
//
// Nothing about the globe's smoothness has ever been measured on a phone -- every number so far
// came from a desktop-class machine with software rendering, which says nothing about a
// mid-range Android or an iPhone in Low Power Mode. This is the instrument for that: turn it on
// with ?perf=1, use the globe, read the numbers off the screen.
//
// What it records is the gap between consecutive *drawn* frames, taken from the timestamps
// requestAnimationFrame hands the loop, plus how long the loop's own JavaScript took, and -- where
// the browser can say -- how long the GPU took (see lib/gputimer.js). The gap is what smoothness
// is: a 60 Hz screen wants a new picture every 16.7 ms, and a gap of 33 ms is a dropped frame you
// can see. The globe only draws when something changes, so an idle globe records nothing -- that
// is the point of drawing on demand, and the display says "idle" rather than reporting a frame
// rate of zero as if something were wrong.
//
// The same numbers are kept for each thing the globe can be doing (see frameActivity), because a
// phone that keeps up with a drag can still fall behind playing the week, and one number across
// all of it hides which.

// About four seconds of frames at 60 Hz: long enough to cover a fling or a few seconds of the
// animated week, short enough that the numbers describe what just happened.
export const FRAME_WINDOW = 240;

export function createFrameStats(size = FRAME_WINDOW) {
  return {
    size, intervals: new Float64Array(size), cpu: new Float64Array(size), count: 0, next: 0,
    // GPU times arrive on their own, frames later, so they keep their own place in the ring.
    gpu: new Float64Array(size), gpuCount: 0, gpuNext: 0,
  };
}

// One drawn frame: `intervalMs` since the previous drawn frame, `cpuMs` of JavaScript spent on
// this one. Intervals that are not real frame gaps -- the first frame after the globe sat idle,
// a tab coming back from the background -- must not be recorded, or one long pause reads as a
// catastrophic frame.
export function recordFrame(stats, intervalMs, cpuMs) {
  if (!stats || !(intervalMs > 0) || !Number.isFinite(intervalMs)) return;
  stats.intervals[stats.next] = intervalMs;
  stats.cpu[stats.next] = Number.isFinite(cpuMs) && cpuMs >= 0 ? cpuMs : 0;
  stats.next = (stats.next + 1) % stats.size;
  stats.count = Math.min(stats.count + 1, stats.size);
}

// The GPU's time for one drawn frame, whenever its answer comes back.
export function recordGpu(stats, ms) {
  if (!stats || !(ms >= 0) || !Number.isFinite(ms)) return;
  stats.gpu[stats.gpuNext] = ms;
  stats.gpuNext = (stats.gpuNext + 1) % stats.size;
  stats.gpuCount = Math.min(stats.gpuCount + 1, stats.size);
}

export function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

// The window, summarised.
//
// The display's own refresh interval is not exposed to the page, so it is estimated from the
// fastest frames: the 10th-percentile gap is a frame that made its deadline, which is the
// screen's interval (16.7 ms at 60 Hz, 8.3 at 120, 33.3 in iOS Low Power Mode). A frame is
// "dropped" for each whole interval a gap overran it by -- the jank a viewer actually sees.
//
// That only works if some frames make their deadline. When even the fastest are slower than
// 30 Hz, the screen rate cannot be read off them -- every frame is late -- so it is reported as
// unknown and drops are counted against 60 Hz, rather than calling it a 6 Hz screen.
const SLOWEST_SCREEN_MS = 34.5;
export function summarizeFrames(stats) {
  if (!stats || !stats.count) return null;
  const n = stats.count;
  const gaps = Array.from(stats.intervals.subarray(0, n)).sort((a, b) => a - b);
  const cpu = Array.from(stats.cpu.subarray(0, n)).sort((a, b) => a - b);
  const gpu = Array.from(stats.gpu.subarray(0, stats.gpuCount)).sort((a, b) => a - b);
  const total = gaps.reduce((s, g) => s + g, 0);
  const fastest = percentile(gaps, 10);
  const screenKnown = fastest <= SLOWEST_SCREEN_MS;
  const vsyncMs = screenKnown ? fastest : 1000 / 60;
  let dropped = 0;
  for (const g of gaps) dropped += Math.max(0, Math.round(g / vsyncMs) - 1);
  return {
    frames: n,
    fps: total > 0 ? (n * 1000) / total : null,
    vsyncMs,
    hz: screenKnown && vsyncMs > 0 ? 1000 / vsyncMs : null,
    p50: percentile(gaps, 50),
    p95: percentile(gaps, 95),
    p99: percentile(gaps, 99),
    max: gaps[n - 1],
    dropped,
    cpuP50: percentile(cpu, 50),
    cpuP95: percentile(cpu, 95),
    gpuFrames: gpu.length,
    gpuP50: percentile(gpu, 50),
    gpuP95: percentile(gpu, 95),
  };
}

// What the globe was doing when a frame was drawn, most demanding first:
//
//   drag    a hand on the globe -- dragging, or pinching
//   fly     flying to a spot that was tapped
//   fling   the globe moving on its own after a hand let go -- momentum, or easing to a zoom
//   play    the week playing, with the camera still
//   still   the camera still while something else moves -- the wind's streaks, gliding swell
//           arrows, a label fading, new data
//
// An idle globe draws nothing, so there is no idle row: the display says "idle" instead.
export const ACTIVITIES = ['drag', 'fling', 'fly', 'play', 'still'];
const ACTIVITY_LABELS = { drag: 'drag', fling: 'fling', fly: 'fly-to', play: 'playback', still: 'still' };
export function frameActivity({ handOn = false, flying = false, cameraMoving = false, playing = false } = {}) {
  if (handOn) return 'drag';
  if (flying) return 'fly';
  if (cameraMoving) return 'fling';
  if (playing) return 'play';
  return 'still';
}

// Ten seconds of each at 60 Hz. Each is kept until that activity comes round again, so a run of
// each can be read off afterwards; and it is long enough that its 99th percentile is not just
// the one worst frame.
export const ACTIVITY_WINDOW = 600;
export function createActivityStats(size = ACTIVITY_WINDOW) {
  return Object.fromEntries(ACTIVITIES.map((name) => [name, createFrameStats(size)]));
}

// One decimal below 100 ms: 16.7 against 17 is the difference between a 60 Hz frame and a late one.
function ms(v) { return v == null ? '–' : v < 100 ? v.toFixed(1) : String(Math.round(v)); }
function count(v) {
  if (v == null) return '–';
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return Math.round(v / 1e3) + 'k';
  return String(v);
}

// The lines the display shows. `idle` when nothing has been drawn lately, so a still globe reads
// as working as intended rather than as zero frames a second. `gpu` is whether the browser can
// time the GPU at all (left out, the display does not mention it), and `activities` the
// summaries by activity, by name.
export function perfLines(summary, {
  idle = false, calls, triangles, lines, pixelRatio, pixelRatioMax, width, height, paintMs, gpu, activities,
} = {}) {
  const out = [];
  if (idle || !summary) {
    out.push('idle · drawing only on change');
  } else {
    const screen = summary.hz != null ? '~' + Math.round(summary.hz) + ' Hz screen' : 'every frame slow';
    out.push(Math.round(summary.fps) + ' fps · ' + screen + ' · ' + summary.dropped + ' dropped');
    out.push('frame ' + ms(summary.p50) + ' / ' + ms(summary.p95) + ' / ' + ms(summary.p99) + ' / ' + ms(summary.max) + ' ms (p50/p95/p99/max)');
    out.push('JS ' + ms(summary.cpuP50) + ' / ' + ms(summary.cpuP95) + ' ms per frame (p50/p95)');
    if (gpu === true) out.push('GPU ' + ms(summary.gpuP50) + ' / ' + ms(summary.gpuP95) + ' ms per frame (p50/p95)');
    else if (gpu === false) out.push('GPU time not offered by this browser');
  }
  const done = activities ? ACTIVITIES.filter((name) => activities[name]) : [];
  if (done.length) {
    out.push('activity  p50/p95/p99 ms' + (gpu === true ? ' · GPU p95' : '') + ' · frames');
    for (const name of done) {
      const a = activities[name];
      out.push('  ' + ACTIVITY_LABELS[name].padEnd(9) + ms(a.p50) + '/' + ms(a.p95) + '/' + ms(a.p99)
        + (gpu === true ? ' · ' + ms(a.gpuP95) : '') + ' · ' + a.frames);
    }
  }
  out.push('draws ' + count(calls) + ' · tris ' + count(triangles) + ' · lines ' + count(lines));
  if (pixelRatio != null) {
    // Below the device's own when the quality governor has stepped it down (lib/quality.js).
    const ratio = pixelRatioMax != null && pixelRatioMax !== pixelRatio ? pixelRatio + ' of ' + pixelRatioMax : String(pixelRatio);
    out.push('px ratio ' + ratio + ' · ' + width + '×' + height);
  }
  if (paintMs != null) out.push('overlay paint ' + ms(paintMs) + ' ms');
  return out;
}

// Whether the display is on. `?perf=1` turns it on and remembers it, so an installed Home Screen
// app -- which always opens its own start URL -- keeps it once it has been opened that way;
// `?perf=0` turns it off again. Storage that throws (private mode, blocked site data) just means
// the flag lasts as long as the URL does.
export function readPerfFlag(search, storage) {
  let param;
  try { param = new URLSearchParams(search || '').get('perf'); } catch { param = null; }
  if (param === '1' || param === '0') {
    try {
      if (param === '1') storage.setItem('surf-perf', '1');
      else storage.removeItem('surf-perf');
    } catch { /* not remembered; the URL still decides this visit */ }
    return param === '1';
  }
  try { return !!storage && storage.getItem('surf-perf') === '1'; } catch { return false; }
}
