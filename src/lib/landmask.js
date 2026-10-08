// Turning the shipped TopoJSON coastline into a land mask for the wave overlay.
//
// The overlay used to decide where land was by asking the wave grid: a cell with no reading was
// assumed to be land and left transparent. That grid is 10 degrees across — roughly 1,100km —
// so the chart's edge was a coarse staircase that agreed with no coastline on Earth, sometimes
// a hundred kilometres out to sea and sometimes well inland. Next to the vector coastline drawn
// on the same sphere, the disagreement was the most obvious thing on the globe.
//
// So the mask is cut from the coastline itself. Same file, same arcs, same vertices as the
// lines: whatever the coastline layer draws, this fills. The two cannot drift apart, because
// there is only one piece of geometry.
//
// The arcs alone cannot do this — an arc is a boundary, and filling needs to know which side is
// land. That is what TopoJSON's `objects` carries, and why the published coastline now includes
// it: a list of arc indices assembled into rings, 10KB gzipped against the arcs' 743KB.
//
// What comes out of here is coverage, not a picture: the fraction of each texel that is land.
// The overlay's shader thresholds it, which is what makes the chart's edge as hard as the line
// drawn beside it however far you zoom in — a mask baked into the chart's own alpha could only
// ever be as sharp as its texels, and at the closest zoom one texel is a couple of hundred
// screen pixels.
import { decodeArc } from './coastline.js';

// Rings, as [lat, lon], from a TopoJSON topology.
//
// Returns one entry per polygon: the exterior ring first, then any holes. Grouping matters —
// a hole only means anything relative to the ring it sits inside.
export function topologyToPolygons(topology, objectName = 'land') {
  const object = topology && topology.objects && topology.objects[objectName];
  if (!object || !Array.isArray(topology.arcs) || !topology.transform) return [];
  const geometries = object.type === 'GeometryCollection' ? (object.geometries || []) : [object];

  const cache = new Map();
  const arcPoints = (index) => {
    // A negative index means the arc traversed backwards: TopoJSON stores each shared boundary
    // once, and the two polygons either side of it walk it in opposite directions. ~i is the
    // encoding, so ~(-1) is arc 0 reversed.
    const forward = index >= 0;
    const i = forward ? index : ~index;
    let pts = cache.get(i);
    if (!pts) {
      pts = decodeArc(topology.arcs[i] || [], topology.transform);
      cache.set(i, pts);
    }
    return forward ? pts : pts.slice().reverse();
  };

  const polygons = [];
  for (const geom of geometries) {
    if (!geom || !Array.isArray(geom.arcs)) continue;
    const list = geom.type === 'MultiPolygon' ? geom.arcs : [geom.arcs];
    for (const rings of list) {
      const built = [];
      for (const ring of rings) {
        const pts = [];
        for (const index of ring) {
          const arc = arcPoints(index);
          // Consecutive arcs in a ring share their meeting point; keeping both copies would
          // add a zero-length segment at every join.
          for (let i = pts.length ? 1 : 0; i < arc.length; i++) pts.push(arc[i]);
        }
        if (pts.length >= 4) built.push(closeAcrossTheAntimeridian(pts));
      }
      if (built.length) polygons.push(alignHoles(built));
    }
  }
  return polygons;
}

// Longitude, made continuous.
//
// The mask is painted on an equirectangular canvas with plain lon -> x arithmetic, so a ring
// that steps from 179 to -179 between two points would be drawn as a line clear across the
// world and fill everything on one side of it. Unwrapping turns that step into 179 -> 181; the
// caller draws the ring again a map-width to each side so the part that ran off the edge comes
// back on the other one.
function closeAcrossTheAntimeridian(points) {
  const out = [points[0].slice()];
  let min = points[0][1];
  let max = points[0][1];
  for (let i = 1; i < points.length; i++) {
    const prevLon = out[i - 1][1];
    let lon = points[i][1];
    while (lon - prevLon > 180) lon -= 360;
    while (lon - prevLon < -180) lon += 360;
    out.push([points[i][0], lon]);
    if (lon < min) min = lon;
    if (lon > max) max = lon;
  }
  // Antarctica's coastline genuinely sweeps the whole 360 degrees, so once unwrapped its ends
  // sit a full turn apart and closing them with a straight chord would slice the map in half.
  // Route the closure over the pole instead, which is also what the continent actually does.
  if (max - min > 350) {
    const avgLat = out.reduce((sum, p) => sum + p[0], 0) / out.length;
    const pole = avgLat < 0 ? -90 : 90;
    out.push([pole, out[out.length - 1][1]], [pole, out[0][1]]);
  }
  return out;
}

// Holes, moved by whole turns of longitude to sit inside the ring they are holes in.
//
// Each ring is unwrapped on its own, from its own first point, so an exterior walked from the
// far side of the antimeridian can come out a whole turn away from the holes inside it:
// Afro-Eurasia's coastline unwraps to between -377 and -180 degrees, and the Caspian, a hole in
// it, to between 47 and 55. Drawn a map-width apart, the hole cut nothing out of its continent
// and was filled as land on its own, so the mask the phone drew had the Caspian as land.
// Shifting each hole to the middle of its exterior's span puts it back where it belongs.
function alignHoles(rings) {
  if (rings.length < 2) return rings;
  const middle = (ring) => {
    let min = Infinity;
    let max = -Infinity;
    for (const [, lon] of ring) {
      if (lon < min) min = lon;
      if (lon > max) max = lon;
    }
    return (min + max) / 2;
  };
  const centre = middle(rings[0]);
  return rings.map((ring, i) => {
    const turns = i === 0 ? 0 : Math.round((centre - middle(ring)) / 360);
    return turns ? ring.map(([lat, lon]) => [lat, lon + turns * 360]) : ring;
  });
}

// Polygons in degrees -> polygons in canvas pixels, thinned to what the canvas can resolve.
//
// The coastline is quantized to about 401m, and a 2048-wide mask texel is about 20km. Carrying
// every vertex would build a path of 400,000 points to describe an edge that can only be drawn
// to the nearest texel, so points closer together than `minStep` pixels are dropped. This is
// the one place the mask is allowed to be coarser than the lines, and only because the texture
// it is painted into cannot hold the difference.
export function polygonsToPixelRings(polygons, width, height, minStep = 0.75) {
  const out = [];
  for (const polygon of polygons) {
    const rings = [];
    for (const ring of polygon) {
      const xs = new Array(ring.length);
      const ys = new Array(ring.length);
      for (let i = 0; i < ring.length; i++) {
        xs[i] = ((ring[i][1] + 180) / 360) * width;
        ys[i] = ((90 - ring[i][0]) / 180) * height;
      }
      const pts = [];
      let lastX = NaN;
      let lastY = NaN;
      let minX = Infinity;
      let maxX = -Infinity;
      for (let i = 0; i < xs.length; i++) {
        const far = !(Math.abs(xs[i] - lastX) < minStep && Math.abs(ys[i] - lastY) < minStep);
        // The last vertex is always kept: dropping it would leave the ring closed by a chord
        // back to the start rather than by its own final segment.
        if (far || i === xs.length - 1) {
          pts.push(xs[i], ys[i]);
          lastX = xs[i];
          lastY = ys[i];
        }
        if (xs[i] < minX) minX = xs[i];
        if (xs[i] > maxX) maxX = xs[i];
      }
      // An island that thins to a line covers no pixels; drawing it would only cost time.
      if (pts.length >= 6) rings.push({ pts, minX, maxX });
    }
    if (rings.length) out.push(orientForNonZeroFill(rings));
  }
  return out;
}

// Exterior rings one way round, holes the other.
//
// Canvas's default fill rule counts winding: a hole only reads as a hole if it is wound against
// the ring containing it. TopoJSON's winding convention is the opposite of GeoJSON's and gets
// inverted again by the flip from latitude to a downward y axis, so rather than reason about
// which it ends up as, the areas are measured and set.
function orientForNonZeroFill(rings) {
  return rings.map((ring, i) => {
    const wantPositive = i === 0;
    return signedArea(ring.pts) >= 0 === wantPositive ? ring : { ...ring, pts: reverse(ring.pts) };
  });
}

function signedArea(pts) {
  let sum = 0;
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
    sum += (pts[j] * pts[i + 1]) - (pts[i] * pts[j + 1]);
  }
  return sum / 2;
}

function reverse(pts) {
  const out = new Array(pts.length);
  for (let i = 0, o = pts.length - 2; i < pts.length; i += 2, o -= 2) {
    out[o] = pts[i];
    out[o + 1] = pts[i + 1];
  }
  return out;
}

// Fill the land rings into whatever context is given.
//
// The caller owns the paint: the mask canvas fills them solid white, so the canvas's alpha
// channel comes back as coverage — 0 at sea, 255 on land, and everything between along a
// coastline, which is where the sharpness comes from. That fractional coverage says *where
// inside the texel* the shore runs, and the shader recovers a hard edge from it.
//
// Each polygon is drawn up to three times, a map-width apart, so rings unwrapped past the edge
// of the canvas still cover the pixels they wrapped around to. Only the copies that can reach
// the canvas are built; for all but a handful of rings that is one of the three.
export function fillLandRings(ctx, pixelPolygons, width) {
  for (const shift of [-width, 0, width]) {
    ctx.beginPath();
    let any = false;
    for (const rings of pixelPolygons) {
      // Judged on the exterior ring: a hole cannot reach pixels its own outline does not.
      if (rings[0].maxX + shift < 0 || rings[0].minX + shift > width) continue;
      for (const { pts } of rings) {
        ctx.moveTo(pts[0] + shift, pts[1]);
        for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i] + shift, pts[i + 1]);
        ctx.closePath();
        any = true;
      }
    }
    if (any) ctx.fill();
  }
}

// The same fill, without a canvas: the exact fraction of each pixel the rings cover.
//
// For scripts/build-landmask.mjs, which builds the mask once and ships it, so that a phone does
// not fetch 3MB of coastline and fill it into a 34MB canvas the first time it shows the swell.
// Node has no canvas, and a pixel-exact answer is better than a canvas's anyway.
//
// It is the signed-area method font rasterizers use: every edge adds, to the cells along its
// path, how much of each cell lies to its right, and a running sum along each row then says how
// much of each pixel is inside -- the winding number, weighted by area. Exterior rings and
// holes are wound oppositely (see orientForNonZeroFill), so a hole subtracts what its outline
// added, and polygons that share an edge leave no seam along it: the two passes cancel exactly.
//
// Drawn three times, a map-width apart, exactly as fillLandRings does, so rings unwrapped past
// the edge come back on the other side. Returns one byte a pixel, north at row 0, 255 = land.
export function rasterizeCoverage(pixelPolygons, width, height) {
  // Two spare cells a row: an edge at the right-hand border spills its share past the last
  // pixel, where the row's sum no longer reaches it.
  const stride = width + 2;
  const acc = new Float32Array(stride * height);
  for (const shift of [-width, 0, width]) {
    for (const rings of pixelPolygons) {
      if (rings[0].maxX + shift < 0 || rings[0].minX + shift > width) continue;
      for (const { pts } of rings) {
        for (let i = 0; i < pts.length; i += 2) {
          const j = (i + 2) % pts.length; // the last point closes back to the first
          clippedEdge(acc, stride, width, height, pts[i] + shift, pts[i + 1], pts[j] + shift, pts[j + 1]);
        }
      }
    }
  }
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let x = 0, a = y * stride, o = y * width; x < width; x++) {
      sum += acc[a + x];
      const c = Math.abs(sum);
      out[o + x] = c >= 1 ? 255 : Math.round(c * 255);
    }
  }
  return out;
}

// An edge, cut where it crosses the left or right border. The part outside is moved onto the
// border, where it still adds its winding to every pixel to its right -- which is exactly what
// the part that ran off the left would have done -- and the part off the right adds nothing.
function clippedEdge(acc, stride, width, height, x0, y0, x1, y1) {
  const cuts = [0];
  for (const border of [0, width]) {
    const t = (border - x0) / (x1 - x0);
    if (t > 0 && t < 1) cuts.push(t);
  }
  cuts.push(1);
  if (cuts.length === 4 && cuts[1] > cuts[2]) [cuts[1], cuts[2]] = [cuts[2], cuts[1]];
  for (let k = 0; k + 1 < cuts.length; k++) {
    const ta = cuts[k];
    const tb = cuts[k + 1];
    const xa = Math.min(width, Math.max(0, x0 + (x1 - x0) * ta));
    const xb = Math.min(width, Math.max(0, x0 + (x1 - x0) * tb));
    edge(acc, stride, height, xa, y0 + (y1 - y0) * ta, xb, y0 + (y1 - y0) * tb);
  }
}

// One edge's contribution, row by row: for each row it passes through, the signed height of
// the part in that row, shared among the cells it crosses by how much of each lies to its
// right. (After font-rs's accumulation rasterizer, by Raph Levien.)
function edge(acc, stride, height, x0, y0, x1, y1) {
  if (y0 === y1) return; // a horizontal edge encloses nothing
  let dir = 1;
  if (y0 > y1) {
    dir = -1;
    [x0, y0, x1, y1] = [x1, y1, x0, y0];
  }
  const dxdy = (x1 - x0) / (y1 - y0);
  let x = x0;
  let yStart = Math.floor(y0);
  if (y0 < 0) { x -= y0 * dxdy; yStart = 0; }
  const yEnd = Math.min(height, Math.ceil(y1));
  for (let y = yStart; y < yEnd; y++) {
    const row = y * stride;
    const dy = Math.min(y + 1, y1) - Math.max(y, y0);
    const xNext = x + dxdy * dy;
    const d = dy * dir;
    const left = x < xNext ? x : xNext;
    const right = x < xNext ? xNext : x;
    const leftCell = Math.floor(left);
    const rightCell = Math.ceil(right);
    if (rightCell <= leftCell + 1) {
      // Within one cell: what lies right of the edge's midpoint is this cell's, the rest the next's.
      const mid = 0.5 * (x + xNext) - leftCell;
      acc[row + leftCell] += d - d * mid;
      acc[row + leftCell + 1] += d * mid;
    } else {
      // Across several: a triangle in the first and last cells, a trapezium in each between.
      const s = 1 / (right - left);
      const leftFrac = left - leftCell;
      const a0 = 0.5 * s * (1 - leftFrac) * (1 - leftFrac);
      const rightFrac = right - rightCell + 1;
      const am = 0.5 * s * rightFrac * rightFrac;
      acc[row + leftCell] += d * a0;
      if (rightCell === leftCell + 2) {
        acc[row + leftCell + 1] += d * (1 - a0 - am);
      } else {
        const a1 = s * (1.5 - leftFrac);
        acc[row + leftCell + 1] += d * (a1 - a0);
        for (let xi = leftCell + 2; xi < rightCell - 1; xi++) acc[row + xi] += d * s;
        const a2 = a1 + (rightCell - leftCell - 3) * s;
        acc[row + rightCell - 1] += d * (1 - a2 - am);
      }
      acc[row + rightCell] += d * am;
    }
    x = xNext;
  }
}

// The shipped mask (see scripts/build-landmask.mjs): one byte a texel as above, deflated.
//
// The name carries a version for the reason the coastline's does: public files are not
// content-hashed, and the service worker serves this one cache-first, so new contents need a
// new name or every cached copy keeps the old ones.
export const LAND_MASK = { file: 'landmask-4096x2048-v1.bin', width: 4096, height: 2048 };

// Fetches and inflates the shipped mask: `{ mask, width, height }`, or null where it cannot be
// had -- no DecompressionStream in this browser, or a response that is not the file expected.
//
// Read straight into one array of the final size, rather than collected and joined, so the
// 8MB result costs 8MB rather than twice that at its peak.
export async function fetchLandMask(url, { width, height } = LAND_MASK, fetchImpl = globalThis.fetch) {
  if (typeof DecompressionStream === 'undefined' || typeof fetchImpl !== 'function') return null;
  const res = await fetchImpl(url);
  if (!res || !res.ok || !res.body) return null;
  const mask = new Uint8Array(width * height);
  const reader = res.body.pipeThrough(new DecompressionStream('deflate')).getReader();
  let at = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (at + value.length > mask.length) {
      reader.cancel();
      return null; // longer than a mask of this size: some other file
    }
    mask.set(value, at);
    at += value.length;
  }
  return at === mask.length ? { mask, width, height } : null;
}
