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
      if (built.length) polygons.push(built);
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

// Cut the land out of whatever is already on the canvas.
//
// `destination-out` erases rather than paints, so the swell chart underneath survives only over
// water — and it erases with the fill's own antialiasing, which is what gives the chart a soft
// true-to-the-coast edge instead of a stepped one.
//
// Each polygon is drawn up to three times, a map-width apart, so rings unwrapped past the edge
// of the canvas still cover the pixels they wrapped around to. Only the copies that can reach
// the canvas are built; for all but a handful of rings that is one of the three.
export function punchLandMask(ctx, pixelPolygons, width) {
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = '#000';
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
  ctx.restore();
}
