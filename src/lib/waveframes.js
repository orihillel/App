// A frame of the animated swell week, as a person would say it.
//
// The build anchors its frames to UTC six-hourly boundaries, because every device animating the
// same build has to step through the same instants. Nobody checks a forecast in UTC, though, so
// what the label says is the reader's own clock: "Thu 3pm" is a time you can be at the beach
// for, "2026-09-12T21:00" is a timestamp.
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function frameLabel(iso, now = null) {
  if (typeof iso !== 'string' || !iso) return '';
  // The build writes "YYYY-MM-DDTHH:MM" with no zone, and it means UTC. Appending the Z is what
  // makes the Date honour that rather than reading it as local time -- which would be silently
  // wrong by the viewer's own offset, and correct only in London.
  const d = new Date(/[Zz]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + 'Z');
  if (Number.isNaN(d.getTime())) return '';
  const h = d.getHours();
  const hour = (h % 12 === 0 ? 12 : h % 12) + (h < 12 ? 'am' : 'pm');
  // "Today"/"Tomorrow" where they apply, because a day name three days out is useful and a day
  // name for this afternoon is a small puzzle.
  if (now) {
    const ref = new Date(now);
    const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    const tomorrow = new Date(ref.getTime() + 24 * 3600e3);
    if (sameDay(d, ref)) return 'Today ' + hour;
    if (sameDay(d, tomorrow)) return 'Tomorrow ' + hour;
  }
  return DAYS[d.getDay()] + ' ' + hour;
}

// What the animation button says when there is no week to play yet.
//
// The week is assembled a couple of frames at a time on a schedule, because it cannot be
// fetched in one go without exceeding the upstream's per-minute allowance -- so "not yet" is
// the normal state for the first couple of hours after a deploy, and it is a different thing
// from "broken". Saying which, and how far along, is the difference between waiting and
// wondering.
export function frameBuildLabel(build) {
  if (!build) return 'Animation unavailable right now';
  // Reached the Worker and it answered with an error, or did not reach it at all. Two very
  // different problems that used to render as the same sentence.
  if (build.unreachable) return "Animation unavailable — couldn't reach the forecast service";
  if (build.httpStatus === 404) return 'Animation unavailable — this Worker predates the animation';
  if (Number.isFinite(build.httpStatus)) return 'Animation unavailable — the service answered ' + build.httpStatus;
  if (build.aborted) return 'Animation unavailable — the forecast service refused the request';
  if (build.building && Number.isFinite(build.ready) && Number.isFinite(build.wanted)) {
    if (build.ready <= 0) return 'Building the week — no hours ready yet';
    return 'Building the week — ' + build.ready + ' of ' + build.wanted + ' hours ready';
  }
  return 'Animation unavailable right now';
}

// A point between two frames of the week.
//
// The frames are six hours apart, which is as fine as the budget allows to fetch -- but it does
// not have to be as fine as the eye gets. Stepping straight from one to the next is 28 discrete
// jumps, and reads as a slideshow however fast it is played. Interpolating between them costs
// nothing upstream and turns the same data into continuous motion: a swell crossing an ocean
// rather than teleporting across it every six hours.
//
// Heights blend linearly. Directions cannot -- 350 degrees and 10 degrees average to 180, which
// points the arrow exactly backwards -- so they take the short way round the circle.
export function lerpFrames(a, b, t) {
  if (!a) return b || null;
  if (!b || !(t > 0)) return a;
  const clamped = t > 1 ? 1 : t;
  return {
    t: a.t,
    heights: lerpValues(a.heights, b.heights, clamped),
    dirs: lerpAngles(a.dirs, b.dirs, clamped),
  };
}

function lerpValues(a, b, t) {
  if (!a) return b;
  if (!b) return a;
  const out = new Array(a.length);
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    // A cell that is land in one frame and not the other keeps whichever reading exists rather
    // than blending toward a number that is not a wave height.
    if (x == null) { out[i] = y == null ? null : y; continue; }
    if (y == null) { out[i] = x; continue; }
    out[i] = x + (y - x) * t;
  }
  return out;
}

function lerpAngles(a, b, t) {
  if (!a) return b;
  if (!b) return a;
  const out = new Array(a.length);
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x == null) { out[i] = y == null ? null : y; continue; }
    if (y == null) { out[i] = x; continue; }
    // Shortest arc: the difference is wrapped into -180..180 before it is scaled.
    let d = ((y - x + 540) % 360) - 180;
    out[i] = ((x + d * t) % 360 + 360) % 360;
  }
  return out;
}

// The animated week's playback: how fast it runs, whether it starts over, and the arrow keys.
//
// Playback runs on the render loop's clock (see advanceTimeline below), so speed is simply how
// many forecast steps go by per real second; between steps the overlay blends the two either
// side on the GPU, every frame, whatever the screen's rate.
export const PLAYBACK_SPEEDS = [0.5, 1, 2];

export function nextSpeed(speed) {
  const i = PLAYBACK_SPEEDS.indexOf(speed);
  return PLAYBACK_SPEEDS[(i + 1) % PLAYBACK_SPEEDS.length];
}

export function speedLabel(speed) {
  return (speed === 0.5 ? '½' : String(speed)) + '×';
}

// How far the week moves in `dtMs` of real time: `stepMs` per forecast step at 1x, scaled by
// `speed`. Without loop it stops on the last frame and says so, so the caller can stop playing.
// With loop it holds the last frame for half a step and then starts over, so the week is seen
// to end before it begins again rather than skipping its last picture. Off by default: a swell
// jumping back to Monday is easy to misread as a glitch, so it is something to ask for.
//
// It used to advance a fixed amount per timer tick, which made the week play slower whenever
// ticks ran late -- on a busy phone, exactly when it was already struggling. Measured in time,
// a late frame shows the right moment instead of a stale one.
export const LOOP_HOLD_STEPS = 0.5;
export function advanceTimeline(pos, last, dtMs, { speed = 1, stepMs = 450, loop = false } = {}) {
  if (!(last > 0)) return { pos: 0, ended: true };
  const next = (pos || 0) + (Math.max(0, dtMs || 0) * speed) / stepMs;
  if (loop) return next >= last + LOOP_HOLD_STEPS ? { pos: 0, ended: false } : { pos: next, ended: false };
  return next >= last ? { pos: last, ended: true } : { pos: next, ended: false };
}

// One arrow-key press: the next or previous whole frame from wherever the animation is, so a
// press from between two frames lands on the neighbouring one in that direction rather than
// on the one it was already nearest.
export function stepFrame(pos, delta, last) {
  if (!(last > 0)) return 0;
  const target = delta > 0 ? Math.floor(pos + 1e-9) + 1 : Math.ceil(pos - 1e-9) - 1;
  return Math.max(0, Math.min(last, target));
}

// Whether a key press belongs to the timeline rather than to whatever has focus. The range
// input already moves on its own arrow keys, and a text field needs them for its cursor.
export function isTimelineKey(e) {
  if (!e || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return false;
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return false;
  const tag = e.target && e.target.tagName;
  return !(tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target && e.target.isContentEditable));
}

// What the overlay should show at `pos` through the week: a frame (or a blend of two), or null
// for the live map.
//
// Null at "now" with nothing playing. The week's first frame is the same moment as the live
// map, but drawn from a coarser grid -- 5 degrees against the live map's 2 -- so showing it
// there swapped a sharp picture for a blocky one the moment the week loaded, and nothing ever
// swapped it back: hiding and re-showing the overlay rewinds to "now", which drew frame zero
// again, still captioned live. While playing, frame zero is drawn like any other, so the
// animation does not change sharpness every time it passes the start.
export function weekFrameAt(list, pos, playing) {
  if (!Array.isArray(list) || !list.length) return null;
  if (!playing && pos <= 0) return null;
  const last = list.length - 1;
  const i = Math.max(0, Math.min(last, Math.floor(pos)));
  const t = pos - i;
  // Exactly on a frame, draw it; between two, draw the blend.
  return t > 0 && i < last ? lerpFrames(list[i], list[i + 1], t) : list[i];
}
