// Where the swell is heading, as arrows over the globe's wave overlay.
//
// The overlay colours the sea by wave height, which says how big it is and nothing about which
// way it is moving — and for a surfer the direction is half the forecast. These are the little
// arrows on top of it.
//
// Three pieces of maths live here rather than in the globe, because all three are easy to get
// quietly wrong and none of them need WebGL to test: where to put the arrows, how many to draw
// at a given zoom, and which way each one points once it is lying on a sphere.

// Points spread evenly over a sphere, by the golden-angle spiral — and then shuffled.
//
// Even spacing matters because a lat/lon lattice is nearly all pole: its cells are slivers up
// there and continents down at the equator. The spiral spaces by *area* instead.
//
// The shuffle is the part that is not obvious, and a test caught its absence. The spiral walks
// from one pole to the other in index order, so the first fifty points of it are fifty points in
// the Arctic. The globe draws the first N as a zoom-dependent level of detail, and that would
// have meant zooming out empties one hemisphere of arrows entirely. Reordering by the reversed
// bits of the index — the van der Corput sequence — makes every prefix a spread of the whole
// set rather than a slice off one end of it.
export function fibonacciSphere(n) {
  if (!(n > 0)) return [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  const points = [];
  for (let i = 0; i < n; i++) {
    // Offset by half a step so the very first point is not exactly on a pole.
    const y = 1 - ((i + 0.5) / n) * 2;
    const lat = (Math.asin(Math.max(-1, Math.min(1, y))) * 180) / Math.PI;
    const lon = (((i * golden * 180) / Math.PI) % 360 + 540) % 360 - 180;
    points.push({ lat, lon, key: radicalInverse2(i) });
  }
  points.sort((a, b) => a.key - b.key);
  return points.map(({ lat, lon }) => ({ lat, lon }));
}

// The index's bits, reversed, read as a fraction. Consecutive integers map to values that keep
// landing in the largest remaining gap, which is what spreads a prefix out.
function radicalInverse2(i) {
  let bits = i >>> 0;
  bits = ((bits << 16) | (bits >>> 16)) >>> 0;
  bits = (((bits & 0x55555555) << 1) | ((bits & 0xaaaaaaaa) >>> 1)) >>> 0;
  bits = (((bits & 0x33333333) << 2) | ((bits & 0xcccccccc) >>> 2)) >>> 0;
  bits = (((bits & 0x0f0f0f0f) << 4) | ((bits & 0xf0f0f0f0) >>> 4)) >>> 0;
  bits = (((bits & 0x00ff00ff) << 8) | ((bits & 0xff00ff00) >>> 8)) >>> 0;
  return bits * 2.3283064365386963e-10; // / 2^32
}

// How much of the unit sphere's surface is actually on screen.
//
// This is the number the arrow count is built on, and getting it wrong is what a first pass got
// wrong: it used the *visible hemisphere* — (1 - 1/d)/2 — which is right only while the whole
// globe fits in the frame. Zoomed in, the sphere overflows the viewport and the screen shows a
// far smaller patch than the horizon does. At a distance of 1.4 the hemisphere model says 14%
// of the sphere is in view; the truth is 0.7%, twenty times less, and the arrows came out
// twenty times too sparse.
//
// The real patch: a ray leaving the camera at angle b from the axis meets the sphere at a point
// whose angle from the sub-camera point is asin(d·sin b) - b, by the law of sines on the
// camera-centre-hit triangle. Beyond the grazing angle asin(1/d) the ray misses the sphere
// entirely, which is the case where the silhouette is inside the frame and the horizon is the
// limit again.
export function visibleSphereFraction(distance, halfFovRad) {
  if (!Number.isFinite(distance) || distance <= 1) return 0;
  const graze = Math.asin(1 / distance);
  const horizon = (1 - 1 / distance) / 2;
  if (!Number.isFinite(halfFovRad) || halfFovRad >= graze) return horizon;
  const alpha = Math.asin(Math.min(1, distance * Math.sin(halfFovRad))) - halfFovRad;
  return Math.min(horizon, (1 - Math.cos(alpha)) / 2);
}

// How many arrows to draw at a given camera distance.
//
// Zooming in shows a smaller patch of sphere, so a fixed number thins out to nothing. Scaling
// the total by the inverse of the visible fraction holds the on-screen count roughly steady.
//
// The cap is the honest part, and it is why the field still thins at the very closest zoom
// rather than staying dense all the way down. The swell behind these arrows is a 10-degree grid
// — about 1,100km — so at maximum zoom the whole screen sits inside two cells. Drawing a
// hundred arrows there would produce a dense lattice of near-identical directions, which looks
// like fine-grained data and is not. Better to show a few honest ones.
export function arrowCountForDistance(distance, {
  base = 420, max = 6000, refDistance = 3, halfFovRad = (22.5 * Math.PI) / 180,
} = {}) {
  if (!Number.isFinite(distance) || distance <= 1) return max;
  const here = visibleSphereFraction(distance, halfFovRad);
  if (!(here > 0)) return max;
  const scale = visibleSphereFraction(refDistance, halfFovRad) / here;
  return Math.max(base, Math.min(max, Math.round(base * scale)));
}

// The frame an arrow sits in at a point on the globe, pointing along a compass bearing.
//
// Returns three unit vectors in the same coordinate frame as geo3d's latLonToVector3: the
// outward `normal`, the `forward` direction the arrow points along the surface, and the `side`
// that completes a right-handed basis. The globe feeds these straight into an instance matrix.
//
// `north` and `east` are the derivatives of that position function with respect to latitude and
// longitude — worth stating, because guessing their signs from the shape of the formula is how
// an arrow field ends up mirrored, which looks plausible and is exactly backwards.
export function orientationAt(lat, lon, bearingDeg) {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((lon + 180) * Math.PI) / 180;
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const sinTheta = Math.sin(theta);
  const cosTheta = Math.cos(theta);

  const normal = [-sinPhi * cosTheta, cosPhi, sinPhi * sinTheta];
  const north = [cosPhi * cosTheta, sinPhi, -cosPhi * sinTheta];
  const east = [sinTheta, 0, cosTheta];

  const b = (bearingDeg * Math.PI) / 180;
  const cb = Math.cos(b);
  const sb = Math.sin(b);
  const forward = [
    north[0] * cb + east[0] * sb,
    north[1] * cb + east[1] * sb,
    north[2] * cb + east[2] * sb,
  ];
  // side = forward x normal, which makes (side, forward, normal) right-handed.
  const side = [
    forward[1] * normal[2] - forward[2] * normal[1],
    forward[2] * normal[0] - forward[0] * normal[2],
    forward[0] * normal[1] - forward[1] * normal[0],
  ];
  return { normal, forward, side };
}
