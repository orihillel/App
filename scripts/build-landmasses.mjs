// Regenerates src/data/landmasses.json from Natural Earth's 110m-resolution
// land dataset (via the `world-atlas` package), replacing the globe's
// hand-approximated landmass polygons with real coastline data.
//
// Run with: npm run build:landmasses
//
// Output shape matches what the globe's canvas-texture renderer expects:
// an array of closed rings, each ring an array of [lat, lon] points.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { feature } from 'topojson-client';
import landTopo from 'world-atlas/land-110m.json' with { type: 'json' };

const outPath = fileURLToPath(new URL('../src/data/landmasses.json', import.meta.url));

const geojson = feature(landTopo, landTopo.objects.land);
const polygons = geojson.type === 'FeatureCollection' ? geojson.features : [geojson];

// A few rings (Russia's far east, Antarctica, Fiji) cross the antimeridian.
// The renderer paints an equirectangular canvas texture with plain lon -> x
// math and no wraparound, so a ring whose longitude jumps from ~180 to ~-180
// between consecutive points would draw a spurious line clear across the
// map. Unwrap those jumps into a continuous (non-modular) longitude — e.g.
// 178, 179, -179 becomes 178, 179, 181 — so the path stays contiguous; the
// renderer draws each ring three times (shifted a full map-width left/right)
// so whichever copy lands in view still covers the wraparound correctly.
function unwrapLongitudes(ring) {
  const out = [ring[0].slice()];
  for (let i = 1; i < ring.length; i++) {
    const [lat, lon] = ring[i];
    const prevLon = out[i - 1][1];
    let unwrapped = lon;
    while (unwrapped - prevLon > 180) unwrapped -= 360;
    while (unwrapped - prevLon < -180) unwrapped += 360;
    out.push([lat, unwrapped]);
  }
  return out;
}

const rings = [];
for (const poly of polygons) {
  const geom = poly.type === 'Feature' ? poly.geometry : poly;
  const polyRings = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates; // MultiPolygon
  for (const rs of polyRings) {
    // Only the exterior ring — this dataset has no interior holes (lakes are
    // a separate Natural Earth layer, not cut out of land here).
    const [exterior] = rs;
    if (!exterior || exterior.length < 4) continue;
    // GeoJSON rings are closed (first point repeats as last); drop the
    // duplicate and convert [lon, lat] -> [lat, lon] for this app's convention.
    const raw = exterior.slice(0, -1).map(([lon, lat]) => [lat, lon]);
    let ring = unwrapLongitudes(raw);

    // Antarctica's coastline sweeps the full 360° (that's real, not a data
    // glitch), so after unwrapping its first and last points sit ~360°
    // apart — closing the loop with a straight chord between them would
    // draw a spurious line clear across the map. Route the closure over the
    // pole instead: drop down/up to it at each end before closing.
    const lonSpan = Math.max(...ring.map((p) => p[1])) - Math.min(...ring.map((p) => p[1]));
    if (lonSpan > 350) {
      const avgLat = ring.reduce((sum, [lat]) => sum + lat, 0) / ring.length;
      const poleLat = avgLat < 0 ? -90 : 90;
      const [, lastLon] = ring[ring.length - 1];
      const [, firstLon] = ring[0];
      ring = [...ring, [poleLat, lastLon], [poleLat, firstLon]];
    }

    ring = ring.map(([lat, lon]) => [Math.round(lat * 1000) / 1000, Math.round(lon * 1000) / 1000]);
    rings.push(ring);
  }
}

writeFileSync(outPath, JSON.stringify(rings));
console.log(`Wrote ${rings.length} landmass rings (${polygons.length} source polygons) to ${outPath}`);
