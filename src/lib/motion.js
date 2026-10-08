// Frame-rate-independent easing and momentum for the globe.
//
// The globe's motion constants were tuned as fractions per frame: close 28% of the gap to the
// target each frame, keep 94% of a flick's speed each frame. That only means one thing at one
// frame rate. On a 120 Hz iPhone the same code eased and coasted twice as fast and a flick
// stopped in half the distance; in iOS Low Power Mode (30 fps) everything moved at half speed;
// and when frames ran slow -- a heavy zoom, a busy phone -- a fling dragged on for seconds.
//
// These helpers keep the tuned feel but apply it per unit of time: the constants still read as
// "per frame at 60 Hz", and a frame of any other length gets the equivalent amount.

export const REFERENCE_FRAME_MS = 1000 / 60;

// The longest step one frame may take. After a stall (a tab switch, a long task) the next frame
// would otherwise jump the globe the whole way at once.
export const MAX_FRAME_MS = 100;

// The time since the previous animation frame, clamped. The first frame has no previous one and
// is treated as an ordinary 60 Hz frame.
export function frameDelta(nowMs, prevMs, maxMs = MAX_FRAME_MS) {
  if (prevMs == null || !Number.isFinite(prevMs) || !(nowMs > prevMs)) return REFERENCE_FRAME_MS;
  return Math.min(nowMs - prevMs, maxMs);
}

// The fraction of the remaining gap to close over `dtMs`, given the fraction closed per 60 Hz
// frame. Two 120 Hz frames close exactly what one 60 Hz frame does.
export function easeAlpha(perFrame, dtMs) {
  if (!(perFrame > 0)) return 0;
  if (perFrame >= 1) return 1;
  return 1 - Math.pow(1 - perFrame, dtMs / REFERENCE_FRAME_MS);
}

// How much of a velocity survives `dtMs`, given what survives one 60 Hz frame.
export function decayFactor(perFrame, dtMs) {
  if (!(perFrame > 0)) return 0;
  return Math.pow(perFrame, dtMs / REFERENCE_FRAME_MS);
}

// Smooths a velocity sample into the running estimate. `keepPerFrame` is how much of the old
// estimate a sample 60 Hz-frame apart keeps, so the smoothing spans the same time whether touch
// events arrive at 60 or 120 a second.
export function blendVelocity(prev, sample, dtMs, keepPerFrame = 0.6) {
  const keep = decayFactor(keepPerFrame, dtMs);
  return prev * keep + sample * (1 - keep);
}

// How long the globe's ambient motion -- the wind's particles, the drifting arrows -- keeps going
// after the last touch. Motion means drawing every frame, which a still globe otherwise never
// does: a minute is long enough to watch the sea move, and short enough not to run a phone's
// battery down on a screen left open. After it everything settles and holds still, and the next
// touch sets it going again.
export const AMBIENT_MOTION_MS = 60000;
