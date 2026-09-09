// Whether a spot's `offshoreDeg` (or `swellWindow`) points the way the actual coastline does.
//
// Both are hand-entered — either estimated when the spot was added, or read off a map by eye —
// and neither is checked against anything the way coordinates are (see check-spots.mjs). They
// drive real scoring: `offshoreDeg` decides which wind readings score as offshore, and for the
// 56% of the catalog with no explicit `swellWindow` it also sets the centre of the derived
// swell-exposure arc (see lib/spotmodel.js). A shore-normal bearing that is wrong by 90° scores
// every wind and swell direction backwards at that spot, and nothing about the app would catch
// it — a wrong `offshoreDeg` still renders, still fetches, still produces a plausible-looking
// rating, just one built from the wrong side of the compass.
//
// This derives the real shore-normal from the same 10m coastline the globe draws and coordinates
// are checked against, and compares it to what each spot actually carries. It is not a pass/fail
// gate the way check-spots.mjs is, and after building it that turned out to be truer than
// expected: a point or a reef can genuinely take swell at a sharp angle to the coast (Jeffreys
// Bay's `swellWindow` is deliberately ~70° off the naive shore-normal, which is the entire reason
// explicit windows exist — see the comment at the top of spotmodel.js), so a large disagreement is
// sometimes the data being *right* about a real place.
//
// It is also, separately, sometimes this script being wrong about the shape of the coast. The
// first version measured the single nearest ~401m segment, and Steamer Lane is the spot that
// caught it: it sits on a lighthouse point where the coastline bends sharply within a couple of
// hundred metres, and disagreed with its own catalog entry's well-documented WNW exposure by
// 160°. Swell does not refract around a 200m wiggle; it responds to the coast's shape over
// kilometres. Fitting the trend across an 8km neighbourhood instead (see regionalBearing) cut
// that to 117° — better, not fixed — and a cluster of genuinely correct Oahu North Shore points
// (Off The Wall, Rocky Point, Chun's Reef, Log Cabins, all independently well known and internally
// consistent with each other and with Pipeline) still shows 70-80° of "disagreement" that is not
// a data error, because a bay or a point is exactly the shape a short-baseline vertex fit reads
// worst. Nothing here corrects a single catalog entry on the strength of its own output — what it
// flags is a reason to go and check, not a verdict, and every spot this session did change was
// checked against independent knowledge of the real place first, not against this script's number.
//
// Run with: npm run check:orientation

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CATALOG as SPOTS } from '../src/lib/spots.catalog.js';
import { decodeArc } from '../src/lib/coastline.js';
import { topologyToPolygons } from '../src/lib/landmask.js';
import { angDiff } from '../src/lib/rating.js';
import { arcCentre } from '../src/lib/spotmodel.js';

const topo = JSON.parse(readFileSync(
  fileURLToPath(new URL('../public/coastline-10m-v2.json', import.meta.url)), 'utf8',
));

const KM_PER_DEG = 111.32;
const DEG = Math.PI / 180;

// --- coastline vertices, bucketed for a fast neighbourhood lookup ------------------------

// Bucketed by whole-degree cell, exactly as check-spots.mjs indexes segments for its own
// distance search — the two scripts solve neighbour problems shaped the same way, even though
// what this one does with a neighbourhood of vertices (fit their trend, see regionalBearing)
// differs from checking distance to the single nearest one.
const buckets = new Map();
for (const arc of topo.arcs) {
  const pts = decodeArc(arc, topo.transform);
  for (let i = 1; i < pts.length; i++) {
    const seg = [pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]];
    const latLo = Math.floor(Math.min(seg[0], seg[2]));
    const latHi = Math.floor(Math.max(seg[0], seg[2]));
    const lonLo = Math.floor(Math.min(seg[1], seg[3]));
    const lonHi = Math.floor(Math.max(seg[1], seg[3]));
    if (lonHi - lonLo > 2) continue; // an antimeridian-spanning arc: not worth this script's trouble
    for (let la = latLo; la <= latHi; la++) {
      for (let lo = lonLo; lo <= lonHi; lo++) {
        const k = la + ':' + lo;
        let b = buckets.get(k);
        if (!b) buckets.set(k, (b = []));
        b.push(seg);
      }
    }
  }
}

// --- is a point out to sea? -----------------------------------------------------------------

const landPolygons = topologyToPolygons(topo, 'land');
// Bounding boxes, computed once — most polygons (most landmasses) can be ruled out for a given
// point by four comparisons instead of a full ray-cast across every ring.
const indexed = landPolygons.map((polygon) => {
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const ring of polygon) for (const [lat, lon] of ring) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  }
  return { polygon, minLat, maxLat, minLon, maxLon };
});

function pointInRing(lat, lon, ring) {
  // Standard even-odd ray cast, cast along latitude. Working in plain degrees rather than a
  // local projection is fine here — the only questions asked are "on land" or "not," a handful
  // of kilometres from a coast, never near a pole.
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [latI, lonI] = ring[i], [latJ, lonJ] = ring[j];
    if ((latI > lat) !== (latJ > lat)) {
      const lonCross = lonI + ((lat - latI) / (latJ - latI)) * (lonJ - lonI);
      if (lon < lonCross) inside = !inside;
    }
  }
  return inside;
}

function isLand(lat, lon) {
  for (const { polygon, minLat, maxLat, minLon, maxLon } of indexed) {
    if (lat < minLat || lat > maxLat || lon < minLon || lon > maxLon) continue;
    // Even-odd across every ring in the polygon: a hole ring flips the same test back off
    // without needing to know in advance which ring is the hole.
    let inside = false;
    for (const ring of polygon) if (pointInRing(lat, lon, ring)) inside = !inside;
    if (inside) return true;
  }
  return false;
}

// A short enough step that it stays on the right side of a narrow spit or a tight point, and
// long enough that it clears the ~401m simplification of the dataset itself.
const STEP_KM = 2;
function destPoint(lat, lon, bearingDeg, km) {
  const k = Math.cos(lat * DEG);
  const dLat = (km / KM_PER_DEG) * Math.cos(bearingDeg * DEG);
  const dLon = (km / (KM_PER_DEG * k)) * Math.sin(bearingDeg * DEG);
  return [lat + dLat, lon + dLon];
}

// How far to look for the *trend* of the coast, not its exact shape at the spot itself.
//
// The first version of this used the single nearest ~401m segment, and Steamer Lane was the
// spot that caught it: it sits on a lighthouse point, where the coastline bends sharply within
// a couple of hundred metres, and the nearest segment there points almost any direction
// depending on which side of the point it happens to be. Steamer Lane's real, well-documented
// exposure is WNW — its own catalog entry already carries that as an explicit swellWindow —
// and the single-segment version disagreed with it by 160°. Swell does not refract around a
// 200m-scale wiggle; it responds to the shape of the coast over kilometres, which a point or a
// headland is a small feature on top of, not a fair sample of.
const BASELINE_KM = 8;

// The coastline's regional trend near a point, as the direction of greatest spread among every
// vertex within BASELINE_KM — a small, dependency-free stand-in for fitting a line through
// them (the first principal component of their scatter). A single sharp point or a small cove
// pulls the *local* segment one way; averaged over several kilometres either side it is one
// short wiggle in a much longer, straighter trend, and contributes far less to the spread than
// the trend itself does.
function regionalBearing(lat, lon) {
  const k = Math.cos(lat * DEG);
  const latCell = Math.floor(lat), lonCell = Math.floor(lon);
  const spanCells = Math.ceil(BASELINE_KM / (KM_PER_DEG * Math.min(1, k))) + 1;
  const seen = new Set();
  let sxx = 0, sxy = 0, syy = 0, n = 0;
  for (let dLat = -spanCells; dLat <= spanCells; dLat++) {
    for (let dLon = -spanCells; dLon <= spanCells; dLon++) {
      const b = buckets.get((latCell + dLat) + ':' + (lonCell + dLon));
      if (!b) continue;
      for (const seg of b) {
        for (const [plat, plon] of [[seg[0], seg[1]], [seg[2], seg[3]]]) {
          const key = plat.toFixed(5) + ',' + plon.toFixed(5);
          if (seen.has(key)) continue;
          const x = (plon - lon) * k * KM_PER_DEG, y = (plat - lat) * KM_PER_DEG;
          if (x * x + y * y > BASELINE_KM * BASELINE_KM) continue;
          seen.add(key);
          sxx += x * x; sxy += x * y; syy += y * y; n++;
        }
      }
    }
  }
  if (n < 4) return null;
  // Principal axis of the scatter, via the 2x2 covariance matrix's dominant eigenvector —
  // closed form for 2x2 rather than pulling in a linear-algebra dependency for one number.
  const trace = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  const disc = Math.sqrt(Math.max(0, (trace * trace) / 4 - det));
  const lambda = trace / 2 + disc; // larger eigenvalue: the axis most of the spread lies along
  // Eigenvector for lambda from (sxx - lambda)*vx + sxy*vy = 0, guarding the degenerate case
  // (a perfectly north-south coast) where that row is all zero.
  let vx, vy;
  if (Math.abs(sxy) > 1e-9) { vx = lambda - syy; vy = sxy; } else { vx = sxx >= syy ? 1 : 0; vy = sxx >= syy ? 0 : 1; }
  // x is east, y is north here (built that way above), so atan2(x, y) is compass bearing.
  return ((Math.atan2(vx, vy) / DEG) + 360) % 360;
}

// The real shore-normal at a point: the coastline's own regional bearing there, rotated 90°
// toward whichever side is not land. Returns the *offshore-wind* convention the catalog uses —
// the bearing a wind blows *from* to leave the coast — i.e. the bearing pointing toward land,
// not out to sea. See the comment on offshoreDeg's convention at the top of spotmodel.js.
function derivedOffshoreDeg(lat, lon) {
  const along = regionalBearing(lat, lon);
  if (along == null) return null;
  const normalA = (along + 90) % 360;
  const normalB = (along + 270) % 360;
  const [latA, lonA] = destPoint(lat, lon, normalA, STEP_KM);
  const [latB, lonB] = destPoint(lat, lon, normalB, STEP_KM);
  const aIsLand = isLand(latA, lonA);
  const bIsLand = isLand(latB, lonB);
  // Both or neither landed on land: too ambiguous a spot (a narrow spit, an estuary mouth, a
  // point right at the tip of a peninsula) to derive anything from. Silence, not a guess.
  if (aIsLand === bIsLand) return null;
  return aIsLand ? normalA : normalB;
}

// --- run it ----------------------------------------------------------------------------------

const FLAG_DEG = 45; // half the derived fallback's own ±90° arc: past this, it centres wrongly

const rows = [];
for (const [id, spot] of Object.entries(SPOTS)) {
  if (spot.offshoreDeg == null) continue;
  const derived = derivedOffshoreDeg(spot.lat, spot.lon);
  if (derived == null) continue;
  const diff = angDiff(spot.offshoreDeg, derived);
  const explicit = Array.isArray(spot.swellWindow);
  const storedIdeal = explicit ? (arcCentre(spot.swellWindow[0], spot.swellWindow[1]) + 180) % 360 : spot.offshoreDeg;
  const diffFromWindow = explicit ? angDiff(storedIdeal, derived) : diff;
  rows.push({ id, name: spot.name, region: spot.region, stored: spot.offshoreDeg, derived, diff, explicit, diffFromWindow });
}

const plain = rows.filter((r) => !r.explicit).sort((a, b) => b.diff - a.diff);
const flagged = plain.filter((r) => r.diff >= FLAG_DEG);

console.log(`${rows.length} spots checked against the real coastline (of ${Object.keys(SPOTS).length} total; the rest sit somewhere this couldn't resolve -- an estuary, a narrow spit, or too far from any indexed segment).`);
console.log(`${rows.length - plain.length} carry an explicit swellWindow -- shown separately below, since disagreeing there can be the data working as intended.`);
console.log();
console.log(`Largest disagreements among spots with NO explicit swellWindow (their offshoreDeg is the only steer the derived arc gets):`);
for (const r of plain.slice(0, 20)) {
  const mark = r.diff >= FLAG_DEG ? '  <-- flagged' : '';
  console.log(`  ${String(Math.round(r.diff)).padStart(3)}°  ${r.name} — ${r.region} (stored ${r.stored}°, coastline says ~${Math.round(r.derived)}°)${mark}`);
}

const explicitRows = rows.filter((r) => r.explicit).sort((a, b) => b.diffFromWindow - a.diffFromWindow);
console.log();
console.log(`For reference, spots WITH an explicit swellWindow (large disagreement here is often the point, not a bug):`);
for (const r of explicitRows.slice(0, 8)) {
  console.log(`  ${String(Math.round(r.diffFromWindow)).padStart(3)}°  ${r.name} — ${r.region} (window centred ${Math.round((r.stored + 180) % 360)}°, coastline says ~${Math.round(r.derived)}°)`);
}

console.log();
if (flagged.length) {
  console.log(`${flagged.length} spot(s) with no explicit swellWindow disagree with the coastline by ${FLAG_DEG}°+ -- worth a human look, not an automatic failure:`);
  for (const r of flagged) console.log(`  ${r.id}: ${r.name} (${r.region})`);
} else {
  console.log(`No spot without an explicit swellWindow disagrees with the coastline by ${FLAG_DEG}° or more.`);
}
