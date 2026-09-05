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
// at 6,000km, for 743KB gzipped and one draw call. The imagery stays for colour and context;
// the vector layer is what you actually read a coastline from when you are picking a spot.
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

// Every arc flattened into gl.LINES pairs: one Float32Array, one draw call.
//
// Each segment needs both endpoints, and consecutive segments share a point, so an arc of n
// points yields (n-1) segments and 2*(n-1) vertices. Building the typed array in one pass and
// at exact size matters: this is ~400k segments, and growing an ordinary array would churn
// through several reallocations of a multi-megabyte buffer on the main thread.
export function arcsToLineVertices(topology, radius, latLonToVec3) {
  if (!topology || !Array.isArray(topology.arcs) || !topology.transform) {
    return new Float32Array(0);
  }
  let segments = 0;
  for (const arc of topology.arcs) if (arc.length > 1) segments += arc.length - 1;

  const positions = new Float32Array(segments * 6);
  let o = 0;
  for (const arc of topology.arcs) {
    if (arc.length < 2) continue;
    const pts = decodeArc(arc, topology.transform);
    let prev = latLonToVec3(pts[0][0], pts[0][1], radius);
    for (let i = 1; i < pts.length; i++) {
      const cur = latLonToVec3(pts[i][0], pts[i][1], radius);
      positions[o++] = prev.x; positions[o++] = prev.y; positions[o++] = prev.z;
      positions[o++] = cur.x; positions[o++] = cur.y; positions[o++] = cur.z;
      prev = cur;
    }
  }
  return positions;
}

// How strongly to show the coastline at a given camera distance.
//
// It is pointless when zoomed out — at globe view the imagery already reads as continents, and
// 400k segments of hairline over it would only add noise — and it is the whole point when
// zoomed in. So it fades in across the range where the imagery starts failing rather than
// switching on at a threshold, which would read as a glitch mid-pinch.
export function coastlineOpacity(distance, fadeStart, fadeEnd) {
  if (!(fadeStart > fadeEnd)) return 0;
  const t = (fadeStart - distance) / (fadeStart - fadeEnd);
  return Math.max(0, Math.min(1, t));
}
