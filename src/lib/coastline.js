// Turning the shipped TopoJSON coastline into line geometry.
//
// Why vectors at all, when the globe already has satellite imagery: a single global texture
// cannot be sharp at close zoom, and the shortfall is not marginal. At the old closest zoom the
// view was ~3.8 degrees wide, which a 5400px-wide global image covers with 57 texture pixels —
// against roughly 1170 device pixels of screen. That is a 20x shortfall, and it is why
// coastlines looked soft. Closing it with a bigger image would need ~110,000px around the
// equator at that zoom, and over a million at the zoom this change opens up. No such texture
// exists, and it could not be downloaded or held in memory if it did.
//
// Lines have no resolution. A coastline drawn as geometry is exactly as crisp at 79km across as
// at 6,000km, for 743KB gzipped. The imagery stays for colour and context; the vector layer is
// what you actually read a coastline from when you are picking a spot.
//
// The data is Natural Earth 1:10m (`world-atlas`), quantized to a ~401m grid — about 6 screen
// pixels at the closest zoom, which is what set that zoom limit.

// TopoJSON stores each arc as a starting position followed by deltas, both in integer grid
// units, with a transform mapping the grid back to degrees. Decoding is a running sum; this is
// the whole format, which is why no TopoJSON library is needed here.
export function decodeArc(arc, transform) {
  const [sx, sy] = transform.scale;
  const [tx, ty] = transform.translate;
  const out = new Array(arc.length);
  let x = 0;
  let y = 0;
  for (let i = 0; i < arc.length; i++) {
    x += arc[i][0];
    y += arc[i][1];
    out[i] = [y * sy + ty, x * sx + tx]; // [lat, lon] — the order the rest of the app uses
  }
  return out;
}

// How strongly to show the coastline at a given camera distance.
//
// It is pointless when zoomed out — at globe view the imagery already reads as continents, and
// 400k segments of line over it would only add noise — and it is the whole point when
// zoomed in. So it fades in across the range where the imagery starts failing rather than
// switching on at a threshold, which would read as a glitch mid-pinch.
export function coastlineOpacity(distance, fadeStart, fadeEnd) {
  if (!(fadeStart > fadeEnd)) return 0;
  const t = (fadeStart - distance) / (fadeStart - fadeEnd);
  return Math.max(0, Math.min(1, t));
}

// The coastline as tiles of segments, at two levels of detail, for drawing as ribbons.
//
// WebGL draws a line one device pixel wide whatever width is asked for, so at twice the CSS
// resolution the coastline was half a CSS pixel thin. Drawn as ribbons a fixed number of CSS
// pixels wide (three.js's LineSegments2) it has the weight it was meant to -- but every segment
// is then a quad of its own, and drawing all 400k of them whatever the view would be a waste. So
// the segments are sorted into tiles of the map, each its own mesh with its own bounds: three
// skips every tile outside the view, which zoomed in is nearly all of them, and the globe skips
// the ones round the back.
//
// The coarse level keeps every `coarseStride`-th point of each arc, and always its last so an
// arc still ends where it ends, for the zooms and the moments where the difference cannot be
// seen (see coastlineLevel).
//
// Returns `{ fine, coarse, coarseError }`. Each level is a list of tiles, `{ positions, center,
// reach }`: the tile's segments as gl.LINES pairs, the unit vector to its middle, and how far
// round from that middle its furthest point is, as an angle at the globe's centre. `coarseError`
// is how far the coarse level strays from the fine one, as the same kind of angle: nine of its
// segments in ten stray no further than this from the points they skip.
export function coastlineTiles(topology, radius, latLonToVec3, options) {
  const steps = coastlineTilesInSteps(topology, radius, latLonToVec3, options);
  for (;;) {
    const { done, value } = steps.next();
    if (done) return value;
  }
}

// The same work a piece at a time: a generator that pauses every couple of thousand points, so
// the globe can spread the ~400k segments over several frames instead of stalling the pinch that
// brought the camera close enough to want them. What it finally returns is coastlineTiles'.
const STEP_POINTS = 2048;
// How far the coarse level strays is tallied into bins a little over 1% apart, from a millionth
// of a radian (6m on the ground) to a tenth (640km), and its 90th percentile read off them at the
// end: sorting all ~100k numbers took 11ms, one long step on its own.
const STRAY_BINS = 1000;
const STRAY_MIN = 1e-6;
const STRAY_DECADES = 5;
export function* coastlineTilesInSteps(topology, radius, latLonToVec3, { coarseStride = 4, tileDeg = 15 } = {}) {
  if (!topology || !Array.isArray(topology.arcs) || !topology.transform) {
    return { fine: [], coarse: [], coarseError: 0 };
  }
  const [sx, sy] = topology.transform.scale;
  const [tx, ty] = topology.transform.translate;
  const stride = Math.max(1, Math.floor(coarseStride));
  const cols = Math.ceil(360 / tileDeg);
  const rows = Math.ceil(180 / tileDeg);

  // One arc at a time, decoded as decodeArc does into these, which grow as needed.
  let lat = new Float64Array(0);
  let lon = new Float64Array(0);
  let xyz = new Float64Array(0);
  const decode = (arc) => {
    if (lat.length < arc.length) {
      lat = new Float64Array(arc.length);
      lon = new Float64Array(arc.length);
      xyz = new Float64Array(arc.length * 3);
    }
    let x = 0;
    let y = 0;
    for (let i = 0; i < arc.length; i++) {
      x += arc[i][0];
      y += arc[i][1];
      lat[i] = y * sy + ty;
      lon[i] = x * sx + tx;
    }
    return arc.length;
  };
  // The coarse level's next point along an arc of n points after point i.
  const next = (i, n) => Math.min(i + stride, n - 1);
  // The first coarse segment that ends at or after point `from`.
  const firstEndingFrom = (from) => Math.max(0, Math.ceil(from / stride) - 1) * stride;
  // The tile a segment from point a to point b belongs to: the one its middle is in. Measured the
  // short way round, because an arc crossing the antimeridian steps from 180 to -180, and the
  // middle of that step is on the antimeridian, not at Greenwich.
  const tileOf = (a, b) => {
    let dLon = lon[b] - lon[a];
    if (dLon > 180) dLon -= 360;
    else if (dLon < -180) dLon += 360;
    const midLon = lon[a] + dLon / 2;
    const r = Math.min(rows - 1, Math.max(0, Math.floor(((lat[a] + lat[b]) / 2 + 90) / tileDeg)));
    const c = Math.min(cols - 1, Math.max(0, Math.floor(((((midLon + 180) % 360) + 360) % 360) / tileDeg)));
    return r * cols + c;
  };
  // How far, at most, the points between a and b are from the straight line joining them, as an
  // angle at the globe's centre.
  const stray = (a, b) => {
    const ax = xyz[a * 3];
    const ay = xyz[a * 3 + 1];
    const az = xyz[a * 3 + 2];
    const ux = xyz[b * 3] - ax;
    const uy = xyz[b * 3 + 1] - ay;
    const uz = xyz[b * 3 + 2] - az;
    const uu = ux * ux + uy * uy + uz * uz;
    let worst = 0;
    for (let k = a + 1; k < b; k++) {
      const px = xyz[k * 3] - ax;
      const py = xyz[k * 3 + 1] - ay;
      const pz = xyz[k * 3 + 2] - az;
      const t = uu > 0 ? Math.min(1, Math.max(0, (px * ux + py * uy + pz * uz) / uu)) : 0;
      const dx = px - t * ux;
      const dy = py - t * uy;
      const dz = pz - t * uz;
      worst = Math.max(worst, dx * dx + dy * dy + dz * dz); // squared: Math.hypot is slow
    }
    return Math.sqrt(worst) / radius;
  };

  // First, how many segments each tile gets at each level, so that every buffer is made once at
  // its exact size: this is ~400k segments, and growing ordinary arrays instead would churn
  // through reallocations of multi-megabyte buffers on the main thread. Like everything below,
  // an arc at a time and a stretch of it at a time -- the longest run to nearly 70,000 points --
  // counting the segments that end in the stretch.
  const fineCount = new Int32Array(rows * cols);
  const coarseCount = new Int32Array(rows * cols);
  const count = (n, from, to) => {
    for (let i = Math.max(1, from); i < to; i++) fineCount[tileOf(i - 1, i)]++;
    for (let i = firstEndingFrom(from); i < n - 1 && next(i, n) < to; i += stride) coarseCount[tileOf(i, next(i, n))]++;
  };
  for (const arc of topology.arcs) {
    if (!(arc.length > 1)) continue;
    const n = decode(arc);
    for (let from = 0; from < n; from += STEP_POINTS) {
      count(n, from, Math.min(n, from + STEP_POINTS));
      yield;
    }
  }

  // Then every point projected once, and written into both levels.
  const fine = [];
  const coarse = [];
  for (let key = 0; key < fineCount.length; key++) {
    fine.push(fineCount[key] ? new Float32Array(fineCount[key] * 6) : null);
    coarse.push(coarseCount[key] ? new Float32Array(coarseCount[key] * 6) : null);
    if (key % 16 === 15) yield;
  }
  const fineAt = new Int32Array(rows * cols);
  const coarseAt = new Int32Array(rows * cols);
  const strayBins = new Uint32Array(STRAY_BINS);
  let strays = 0;
  const put = (level, at, tile, a, b) => {
    const p = level[tile];
    let o = at[tile];
    p[o++] = xyz[a * 3]; p[o++] = xyz[a * 3 + 1]; p[o++] = xyz[a * 3 + 2];
    p[o++] = xyz[b * 3]; p[o++] = xyz[b * 3 + 1]; p[o++] = xyz[b * 3 + 2];
    at[tile] = o;
  };
  const fill = (n, from, to) => {
    for (let i = from; i < to; i++) {
      const v = latLonToVec3(lat[i], lon[i], radius);
      xyz[i * 3] = v.x; xyz[i * 3 + 1] = v.y; xyz[i * 3 + 2] = v.z;
    }
    for (let i = Math.max(1, from); i < to; i++) put(fine, fineAt, tileOf(i - 1, i), i - 1, i);
    for (let i = firstEndingFrom(from); i < n - 1 && next(i, n) < to; i += stride) {
      const j = next(i, n);
      put(coarse, coarseAt, tileOf(i, j), i, j);
      const bin = Math.floor((Math.log10(Math.max(STRAY_MIN, stray(i, j)) / STRAY_MIN) / STRAY_DECADES) * STRAY_BINS);
      strayBins[Math.min(STRAY_BINS - 1, bin)]++;
      strays++;
    }
  };
  for (const arc of topology.arcs) {
    if (!(arc.length > 1)) continue;
    const n = decode(arc);
    for (let from = 0; from < n; from += STEP_POINTS) {
      fill(n, from, Math.min(n, from + STEP_POINTS));
      yield;
    }
  }

  const tile = (positions, key) => {
    const mid = latLonToVec3(-90 + (Math.floor(key / cols) + 0.5) * tileDeg, -180 + ((key % cols) + 0.5) * tileDeg, 1);
    const center = [mid.x, mid.y, mid.z];
    let furthest = 1; // the cosine of the angle out to the tile's furthest point
    for (let i = 0; i < positions.length; i += 3) {
      const cos = (positions[i] * center[0] + positions[i + 1] * center[1] + positions[i + 2] * center[2]) / radius;
      if (cos < furthest) furthest = cos;
    }
    return { positions, center, reach: Math.acos(Math.max(-1, Math.min(1, furthest))) };
  };
  const result = { fine: [], coarse: [], coarseError: 0 };
  for (const [name, level] of [['fine', fine], ['coarse', coarse]]) {
    for (let key = 0; key < level.length; key++) {
      if (!level[key]) continue;
      result[name].push(tile(level[key], key));
      yield;
    }
  }
  // The top of the bin the 90th percentile falls in.
  for (let b = 0, seen = 0; b < STRAY_BINS && strays > 0; b++) {
    seen += strayBins[b];
    if (seen >= 0.9 * strays) {
      result.coarseError = STRAY_MIN * Math.pow(10, ((b + 1) / STRAY_BINS) * STRAY_DECADES);
      break;
    }
  }
  return result;
}

// Which level of the coastline to draw: the coarse one wherever it is within half a pixel of the
// full one on screen, which nobody can see; within a pixel and a half while the camera is moving
// -- earth.nullschool's trick, since detail nobody can follow in motion is not worth drawing
// then; and the full one everywhere else. `coarseError` is coastlineTiles', and `pxPerRadian` is
// how many CSS pixels an angle at the globe's centre spans on screen at the point nearest the
// camera, where the globe is magnified most.
export const COASTLINE_STILL_PX = 0.5;
export const COASTLINE_MOVING_PX = 1.5;
export function coastlineLevel(coarseError, pxPerRadian, moving) {
  return coarseError * pxPerRadian <= (moving ? COASTLINE_MOVING_PX : COASTLINE_STILL_PX) ? 'coarse' : 'fine';
}
