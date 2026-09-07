// Merging spot markers that would otherwise pile up on the same stretch of coast.
//
// The globe draws every spot as its own marker. That is fine in the open ocean and hopeless
// along a coastline that carries dozens of them: zoomed out, California, Central America and
// southwest France each collapse into an indistinct blob of overlapping dots, and tapping one
// gets you whichever the raycaster happened to hit first. The legend meanwhile promises
// "spot colour = live conditions right now", which a blob cannot express either.
//
// So markers within one cell of a grid merge into a single marker carrying a count, and the
// cell shrinks as you zoom in until, close enough, nothing merges at all. The whole thing is
// geographic rather than screen-space on purpose: a cluster that is a stable fact about the
// world does not flicker or re-form as the globe rotates, which one recomputed from screen
// positions every frame would.

import { visibleAngularRadius } from './swellarrows.js';

const DEG = Math.PI / 180;

// How coarse the grid should be at a given camera distance, in degrees of latitude.
//
// Tied to how much of the world is actually on screen rather than to the distance directly:
// the aim is a roughly constant number of markers across the view, so the globe stays about
// as busy zoomed out as zoomed in. Below a degree and a half the cells are finer than the
// markers are wide, so clustering stops entirely and every spot stands on its own.
export function cellSizeForDistance(distance, { across = 7, maxDeg = 24, minDeg = 1.5, halfFovRad = (22.5 * Math.PI) / 180 } = {}) {
  if (!Number.isFinite(distance) || distance <= 1) return 0;
  const alphaDeg = (visibleAngularRadius(distance, halfFovRad) * 2) / DEG;
  const cell = alphaDeg / across;
  if (!(cell > minDeg)) return 0;
  return Math.min(cell, maxDeg);
}

// Group points into grid cells and return one entry per occupied cell.
//
// `cellDeg <= 0` means no clustering: every point comes back on its own, in input order.
//
// Longitude cells widen by 1/cos(lat) so a cell covers roughly the same amount of ground at
// every latitude. Without it, cells converge at the poles and a handful of Icelandic and
// Tasmanian spots merge far more eagerly than the equatorial ones -- the same failure a
// lat/lon lattice has whenever it is used for anything area-shaped.
export function clusterPoints(points, cellDeg) {
  if (!Array.isArray(points) || points.length === 0) return [];
  if (!(cellDeg > 0)) {
    return points.map((p) => ({ lat: p.lat, lon: p.lon, ids: [p.id], count: 1 }));
  }
  const cells = new Map();
  for (const p of points) {
    if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue;
    const latBand = Math.floor((p.lat + 90) / cellDeg);
    // The band's own latitude, not the point's, so every point in a band lands on the same
    // longitude grid -- otherwise two neighbours a hair apart in latitude get different cell
    // widths and fall into cells that do not line up.
    const bandLat = latBand * cellDeg - 90 + cellDeg / 2;
    const lonDeg = Math.min(180, cellDeg / Math.max(0.08, Math.cos(bandLat * DEG)));
    const lonBand = Math.floor((p.lon + 180) / lonDeg);
    const key = latBand + ':' + lonBand;
    const cell = cells.get(key);
    if (cell) cell.push(p); else cells.set(key, [p]);
  }
  const out = [];
  for (const members of cells.values()) {
    if (members.length === 1) {
      out.push({ lat: members[0].lat, lon: members[0].lon, ids: [members[0].id], count: 1 });
    } else {
      const c = centroid(members);
      out.push({ lat: c.lat, lon: c.lon, ids: members.map((m) => m.id), count: members.length });
    }
  }
  return out;
}

// The average of points on a sphere, done as unit vectors rather than by averaging the
// coordinates. Averaging longitudes puts the mean of 179 and -179 on the far side of the
// planet; averaging the vectors puts it where it belongs, on the antimeridian.
export function centroid(points) {
  let x = 0, y = 0, z = 0;
  for (const p of points) {
    const la = p.lat * DEG, lo = p.lon * DEG;
    const cl = Math.cos(la);
    x += cl * Math.cos(lo); y += cl * Math.sin(lo); z += Math.sin(la);
  }
  const len = Math.hypot(x, y, z);
  // Every point cancelling out (an exactly antipodal pair) has no meaningful centre; fall back
  // to the first member rather than returning a NaN that would place a marker nowhere.
  if (!(len > 1e-9)) return { lat: points[0].lat, lon: points[0].lon };
  const lat = Math.asin(z / len) / DEG;
  const lon = Math.atan2(y / len, x / len) / DEG;
  return { lat, lon };
}
