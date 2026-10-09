// What the fingers (or the mouse) on the globe are doing, from Pointer Events.
//
// The globe used to listen to mouse and touch events separately, with two copies of the same
// drag and two subtly different ideas of a tap. Pointer Events give one stream for both, plus
// pointercancel -- the system taking a touch away for a call or a swipe -- and pointer capture,
// which keeps a drag going when it leaves the canvas.
//
// Kept apart from the globe, as plain bookkeeping fed one event at a time, because the rules are
// easy to get subtly wrong and each one is a bug somebody hit:
//
//   - a second finger turns a drag into a pinch, and whatever speed the first finger had built
//     up is thrown away, or the globe sets off on its own when the pinch ends;
//   - once a pinch loses a finger, the one still down does nothing on its own -- the globe does
//     not lurch to wherever it has wandered -- until it is lifted or joined by another;
//   - a gesture that was ever a pinch is never a tap, however close together the last finger
//     went down and came up.
//
// Each call returns what the globe should do: `{ type: 'none' }` when nothing.

// A tap is a press and release this close together, in CSS pixels and milliseconds: barely any
// movement, and not held. The same drag gesture that turns the globe goes down and up too, and
// this is what tells "meant to tap that" from "turned the globe past it".
export const TAP_SLOP_PX = 6;
export const TAP_MS = 500;

const NONE = Object.freeze({ type: 'none' });

export function createGesture() {
  return { pointers: new Map(), mode: 'idle', last: null, down: null, pinchDist: null, wasPinch: false };
}

function spread(g) {
  const [a, b] = g.pointers.values();
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// A pointer goes down at (x, y) at time t (ms). The first starts a drag ('grab': stop any coast
// in progress); the second turns it into a pinch ('pinch-start': the drag and its speed are
// over). Any more are carried along but change nothing.
export function gestureDown(g, id, x, y, t) {
  g.pointers.set(id, { x, y });
  if (g.pointers.size === 1) {
    g.mode = 'drag';
    g.last = { x, y };
    g.down = { x, y, t };
    g.wasPinch = false;
    return { type: 'grab' };
  }
  // Two down again after one of a pinch was lifted is a pinch again, measured from where the
  // fingers are now -- people lift a finger and put it back to keep zooming.
  if (g.pointers.size === 2) {
    g.mode = 'pinch';
    g.wasPinch = true;
    g.pinchDist = spread(g);
    return { type: 'pinch-start' };
  }
  return NONE;
}

// A pointer moves. A drag reports how far since the last move; a pinch reports how much the
// distance between the first two fingers changed, as old / new -- above 1 when they close, the
// factor to multiply the camera's distance by, so pinching feels the same at every zoom.
export function gestureMove(g, id, x, y) {
  const p = g.pointers.get(id);
  if (!p) return NONE; // a mouse hovering, or a pointer that went down somewhere else
  p.x = x;
  p.y = y;
  if (g.mode === 'drag' && g.pointers.size === 1) {
    const dx = x - g.last.x;
    const dy = y - g.last.y;
    g.last = { x, y };
    return { type: 'drag', dx, dy };
  }
  if (g.mode === 'pinch' && g.pointers.size >= 2) {
    const d = spread(g);
    if (!(d > 0) || !(g.pinchDist > 0)) { g.pinchDist = d; return NONE; }
    const ratio = g.pinchDist / d;
    g.pinchDist = d;
    return { type: 'pinch', ratio };
  }
  return NONE;
}

// A pointer comes up at (x, y) at time t. While others are still down nothing is released: a
// pinch losing a finger goes on hold. The last one up releases the gesture, and says whether it
// was a tap and where.
export function gestureUp(g, id, x, y, t) {
  if (!g.pointers.has(id)) return NONE;
  g.pointers.delete(id);
  if (g.pointers.size > 0) {
    if (g.mode === 'pinch') {
      g.mode = 'hold';
      g.pinchDist = null;
    }
    return NONE;
  }
  const wasDrag = g.mode === 'drag';
  g.mode = 'idle';
  const tap = wasDrag && !g.wasPinch && g.down
    && Math.hypot(x - g.down.x, y - g.down.y) < TAP_SLOP_PX && t - g.down.t < TAP_MS;
  return { type: 'release', tap: tap ? { x, y } : null };
}

// The system took a pointer away. Never a release and never a tap; once the last one is gone the
// gesture is over, with no speed left in it.
export function gestureCancel(g, id) {
  if (!g.pointers.has(id)) return NONE;
  g.pointers.delete(id);
  if (g.pointers.size === 0) {
    g.mode = 'idle';
    g.pinchDist = null;
    return { type: 'cancel' };
  }
  if (g.mode === 'pinch') {
    g.mode = 'hold';
    g.pinchDist = null;
  }
  return NONE;
}
