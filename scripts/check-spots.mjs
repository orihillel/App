// Every spot in the catalog has to be on a coast.
//
// Coordinates are the one part of the spot data that is hand-written, unverifiable by reading,
// and silently wrong when it is wrong: a spot a degree out still renders, still fetches a
// forecast, and still draws a marker — just in the wrong ocean, or in the middle of a
// continent. Nothing else in the app notices.
//
// So they are checked against the same 10m coastline the globe draws (public/coastline-10m-v2
// .json), whose vertices sit about 401m apart. Nearest-vertex distance is therefore the
// distance to the coast to within a couple of hundred metres, which is far finer than any
// error worth catching.
//
// Run with: npm run check:spots
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CATALOG as SPOTS } from '../src/lib/spots.catalog.js';
import { decodeArc } from '../src/lib/coastline.js';

// A spot further than this from the coast is a mistake, not a judgement call. It is
// deliberately generous: a reef pass or an outer bank genuinely sits a few kilometres out, and
// the dataset generalises small inlets and drops the smallest islands entirely.
const MAX_KM = 12;

// Islands that are real but too small for a 1:10m land dataset to carry, so the nearest mapped
// coast is a different island altogether. Listed by name rather than waved through by raising
// the tolerance, so the exception stays visible and a genuine error somewhere near one of them
// is still caught by the far looser bound below.
const UNMAPPED_ISLANDS = {
  bawa: 'The Hinako Islands are a few hundred metres across; the nearest mapped land is Nias.',
};
const UNMAPPED_MAX_KM = 40;

// Distance to the nearest coastline *segment*, not the nearest vertex.
//
// The first version of this measured to vertices and reported eight false positives, Lacanau
// among them: the Landes coast is dead straight for a hundred kilometres, so TopoJSON's
// simplification leaves its points 15km apart and a spot sitting exactly on the beach scores
// 15km from the nearest one. On a straight coast, vertex distance measures the dataset's
// sampling rather than anything about the spot.
const topo = JSON.parse(readFileSync(
  fileURLToPath(new URL('../public/coastline-10m-v2.json', import.meta.url)), 'utf8',
));

const KM_PER_DEG = 111.32;

// Segments, bucketed by every whole-degree cell their bounding box touches — a long segment
// has to be findable from the middle of itself, not only from its ends.
const buckets = new Map();
let segments = 0;
for (const arc of topo.arcs) {
  const pts = decodeArc(arc, topo.transform);
  for (let i = 1; i < pts.length; i++) {
    const seg = [pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]];
    segments++;
    const latLo = Math.floor(Math.min(seg[0], seg[2]));
    const latHi = Math.floor(Math.max(seg[0], seg[2]));
    const lonLo = Math.floor(Math.min(seg[1], seg[3]));
    const lonHi = Math.floor(Math.max(seg[1], seg[3]));
    // An arc that steps across the antimeridian would otherwise be inserted into every cell of
    // its row; it is only ever two cells, so leave those to their endpoints.
    if (lonHi - lonLo > 2) { push(latLo, lonLo, seg); push(latHi, lonHi, seg); continue; }
    for (let la = latLo; la <= latHi; la++) for (let lo = lonLo; lo <= lonHi; lo++) push(la, lo, seg);
  }
}

function push(latCell, lonCell, seg) {
  const k = latCell + ':' + lonCell;
  let b = buckets.get(k);
  if (!b) buckets.set(k, (b = []));
  b.push(seg);
}

// Point-to-segment distance on a local flat-earth projection. Over a few kilometres at any
// latitude the curvature error is far below the tolerance being tested.
function pointToSegmentKm(lat, lon, seg) {
  const k = Math.cos((lat * Math.PI) / 180);
  const px = 0;
  const py = 0;
  const ax = (seg[1] - lon) * k;
  const ay = seg[0] - lat;
  const bx = (seg[3] - lon) * k;
  const by = seg[2] - lat;
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  let t = len > 0 ? (((px - ax) * dx + (py - ay) * dy) / len) : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx - px;
  const cy = ay + t * dy - py;
  return Math.sqrt(cx * cx + cy * cy) * KM_PER_DEG;
}

function nearestCoastKm(lat, lon) {
  const latCell = Math.floor(lat);
  const lonCell = Math.floor(lon);
  let best = Infinity;
  for (let ring = 0; ring <= 6; ring++) {
    for (let dLat = -ring; dLat <= ring; dLat++) {
      for (let dLon = -ring; dLon <= ring; dLon++) {
        if (ring > 0 && Math.max(Math.abs(dLat), Math.abs(dLon)) !== ring) continue;
        const wrapped = ((((lonCell + dLon + 180) % 360) + 360) % 360) - 180;
        const b = buckets.get((latCell + dLat) + ':' + wrapped);
        if (!b) continue;
        for (const seg of b) {
          const d = pointToSegmentKm(lat, lon, seg);
          if (d < best) best = d;
        }
      }
    }
    // Everything within `ring` whole cells has been searched; a cell is at least this many km
    // across at this latitude, so nothing further out can beat a hit already this close.
    if (best <= ring * KM_PER_DEG * Math.cos((lat * Math.PI) / 180)) break;
  }
  return best;
}

// `npm run check:spots -- 12.34 -56.78 [...]` measures arbitrary coordinates, which is how the
// corrections below were checked before being written into the catalog.
const probes = process.argv.slice(2).map(Number).filter(Number.isFinite);
if (probes.length >= 2) {
  for (let i = 0; i + 1 < probes.length; i += 2) {
    console.log(`${probes[i]}, ${probes[i + 1]} -> ${nearestCoastKm(probes[i], probes[i + 1]).toFixed(2)}km from the coast`);
  }
  process.exit(0);
}

const rows = [];
for (const [id, spot] of Object.entries(SPOTS)) {
  rows.push({ id, name: spot.name, region: spot.region, km: nearestCoastKm(spot.lat, spot.lon) });
}
rows.sort((a, b) => b.km - a.km);

const limitFor = (id) => (id in UNMAPPED_ISLANDS ? UNMAPPED_MAX_KM : MAX_KM);
const bad = rows.filter((r) => !(r.km <= limitFor(r.id)));
console.log(`${rows.length} spots checked against ${segments.toLocaleString()} coastline segments`);
console.log('furthest from a coast:');
for (const r of rows.slice(0, 12)) {
  console.log(`  ${r.km.toFixed(1).padStart(6)}km  ${r.name} — ${r.region}`);
}

for (const id of Object.keys(UNMAPPED_ISLANDS)) {
  if (!(id in SPOTS)) {
    console.error(`\nUNMAPPED_ISLANDS lists "${id}", which is no longer in the catalog.`);
    process.exit(1);
  }
}

if (bad.length) {
  console.error(`\n${bad.length} spot(s) are further from a coastline than they should be:`);
  for (const r of bad) {
    console.error(`  ${r.id}: ${r.name} (${r.region}) — ${r.km.toFixed(1)}km, limit ${limitFor(r.id)}km`);
  }
  process.exit(1);
}
const exempt = Object.keys(UNMAPPED_ISLANDS).length;
console.log(`\nOK — every spot is within ${MAX_KM}km of the coast`
  + (exempt ? `, bar ${exempt} on island(s) the dataset does not carry.` : '.'));
