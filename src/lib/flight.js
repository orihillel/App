// The globe's flight to a cluster of spots: the camera's path when a cluster is tapped.
//
// Tapping a cluster turns the globe to it and zooms a step closer, which is what splits it into
// its members. That used to hand the new position to the same per-frame easing a wheel notch
// uses, which closes a fixed share of the gap each frame: the globe lurched off at full speed on
// the first frame and crawled the last few degrees, and the turn and the zoom ran on unrelated
// curves. Now the move is planned as one flight, along the path van Wijk and Nuij showed is the
// smoothest way to pan and zoom at once ("Smooth and efficient zooming and panning", 2003) and
// that Mapbox's flyTo follows: it pulls back a little when the target is far, so the ground
// never streams past faster than the eye can follow, and it takes as long as the distance needs.
//
// Pure arithmetic; the globe turns a flight's pose into its rotation each frame.

// How far the path pulls back: Mapbox's default, the value van Wijk and Nuij found people
// preferred. 0 would be a straight zoom with a pan, larger a higher arc.
export const FLIGHT_CURVE = 1.42;
// How fast, in screen widths a second along the path: Mapbox's default.
export const FLIGHT_SPEED = 1.2;
// Never so quick it reads as a jump, never so slow it keeps someone waiting.
export const FLIGHT_MIN_MS = 600;
export const FLIGHT_MAX_MS = 2500;

const cosh = (x) => (Math.exp(x) + Math.exp(-x)) / 2;
const sinh = (x) => (Math.exp(x) - Math.exp(-x)) / 2;
const tanh = (x) => sinh(x) / cosh(x);

// The path from a view `w0` wide to one `w1` wide whose centre is `u1` away, all in the same
// units. Returns its length `S` and `at(s)` for s from 0 to S: the width of the view then, as a
// share of `w0`, and how much of the way across it has come, from 0 to 1. Mapbox's arithmetic,
// term for term, including its fallback for a flight that only zooms.
export function flightPath(w0, w1, u1, curve = FLIGHT_CURVE) {
  const rho = curve;
  const rho2 = rho * rho;
  const r = (i) => {
    const b = (w1 * w1 - w0 * w0 + (i ? -1 : 1) * rho2 * rho2 * u1 * u1) / (2 * (i ? w1 : w0) * rho2 * u1);
    return Math.log(Math.sqrt(b * b + 1) - b);
  };
  const r0 = r(0);
  let S = (r(1) - r0) / rho;
  let at = (s) => ({
    width: cosh(r0) / cosh(r0 + rho * s),
    across: (w0 * ((cosh(r0) * tanh(r0 + rho * s) - sinh(r0)) / rho2)) / u1,
  });
  if (Math.abs(u1) < 1e-6 || !Number.isFinite(S)) {
    // Nowhere to go but in or out.
    if (Math.abs(w0 - w1) < 1e-6) return { S: 0, at: () => ({ width: 1, across: 1 }) };
    const k = w1 < w0 ? -1 : 1;
    S = Math.abs(Math.log(w1 / w0)) / rho;
    at = (s) => ({ width: Math.exp(k * rho * s), across: 1 });
  }
  return { S, at };
}

// How long a flight of length `S` takes, in milliseconds.
export function flightDuration(S, speed = FLIGHT_SPEED) {
  const ms = (1000 * S) / speed;
  return Math.min(FLIGHT_MAX_MS, Math.max(FLIGHT_MIN_MS, Number.isFinite(ms) ? ms : 0));
}

// The pace along the path: CSS's `ease`, the curve Mapbox flies on. It sets off promptly, so a
// tap is answered at once, and spends its last third settling, so the globe arrives rather than
// stops.
export const flightEase = cubicBezier(0.25, 0.1, 0.25, 1);

// A CSS cubic-bezier timing function, solved for x by Newton's method with bisection to fall
// back on, as browsers do.
export function cubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t) => ((ay * t + by) * t + cy) * t;
  const slopeX = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = sampleX(t) - x;
      if (Math.abs(err) < 1e-7) return sampleY(t);
      const d = slopeX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    while (hi - lo > 1e-7) {
      if (sampleX(t) < x) lo = t; else hi = t;
      t = (lo + hi) / 2;
    }
    return sampleY(t);
  };
}

// A whole flight between two views of the globe: from the camera `fromDistance` out, looking at
// `fromDir`, to `toDistance` out looking at `toDir` (unit vectors from the globe's centre, in its
// own frame). The globe's camera always looks at the centre, so the ground it shows is about as
// wide as the camera is high above the surface, times a constant; `tanHalfFov` makes it a width.
//
// Returns `{ duration, pose(k) }`: for k from 0 to 1, the share of the time gone, the camera's
// distance and the direction it is looking along, slerped across the arc between the two.
export function planFlight({ fromDir, toDir, fromDistance, toDistance, tanHalfFov, radius = 1 }) {
  const width = (d) => 2 * Math.max(d - radius, 1e-6) * tanHalfFov;
  const w0 = width(fromDistance);
  const w1 = width(toDistance);
  const dot = Math.max(-1, Math.min(1, fromDir[0] * toDir[0] + fromDir[1] * toDir[1] + fromDir[2] * toDir[2]));
  const angle = Math.acos(dot);
  const path = flightPath(w0, w1, angle * radius);
  const duration = path.S > 0 ? flightDuration(path.S) : 0;
  return {
    duration,
    pose(k) {
      if (!(k < 1) || path.S === 0) return { distance: toDistance, dir: toDir.slice() };
      const e = flightEase(Math.max(0, k));
      const { width: w, across } = path.at(e * path.S);
      return {
        distance: radius + (w * w0) / (2 * tanHalfFov),
        dir: slerp(fromDir, toDir, angle, Math.min(1, Math.max(0, across))),
      };
    },
  };
}

// The point `t` of the way along the great circle from `a` to `b`, `angle` apart.
function slerp(a, b, angle, t) {
  if (angle < 1e-9) return a.slice();
  const s = Math.max(Math.sin(angle), 1e-9);
  const wa = Math.sin((1 - t) * angle) / s;
  const wb = Math.sin(t * angle) / s;
  const p = [a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb, a[2] * wa + b[2] * wb];
  const l = Math.hypot(p[0], p[1], p[2]);
  return [p[0] / l, p[1] / l, p[2] / l];
}
