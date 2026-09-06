// Regenerates public/coastline-10m.json from Natural Earth's 10m-resolution land dataset
// (via the `world-atlas` package), for the globe's vector coastline layer.
//
// Run with: npm run build:coastline
//
// This is the sibling of build-landmasses.mjs, and the two are deliberately different:
//
//   - build-landmasses.mjs emits 110m rings, as [lat, lon] polygons, for the *canvas texture*
//     the globe paints before (or instead of) the satellite imagery. That is a whole-Earth
//     backdrop, so 110m is plenty and small is what matters.
//   - this emits 10m arcs, as raw TopoJSON, for line geometry drawn *on* the sphere. It is
//     read when zoomed in, where 110m's ~10km precision would be tens of pixels of error, so
//     here detail is what matters and 80x more points is the point.
//
// Output shape is TopoJSON's own `{transform, arcs, objects}`. TopoJSON stores every boundary
// exactly once as an "arc" and assembles polygons by reference; since the globe draws lines
// rather than filling land, the arcs *are* the drawing, and taking them directly avoids the
// duplicated shared edges that polygon assembly would produce. The file stays in its native
// delta-encoded integer form, which is what makes it compress well.
//
// `objects` is carried too, and costs almost nothing: it is a list of arc *indices*, 35KB raw
// and under 10KB gzipped against the arcs' 743KB. It is what lets the wave overlay fill land
// rather than only trace it — the mask that hides the swell chart under the continents is
// rasterized from these same rings, so its edge is the same geometry as the drawn coastline
// rather than an independent approximation that would disagree with it.
import { writeFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import landTopo from 'world-atlas/land-10m.json' with { type: 'json' };

const outPath = fileURLToPath(new URL('../public/coastline-10m.json', import.meta.url));
const json = JSON.stringify({
  transform: landTopo.transform,
  arcs: landTopo.arcs,
  objects: landTopo.objects,
});
writeFileSync(outPath, json);

let points = 0;
for (const arc of landTopo.arcs) points += arc.length;
const [scaleLon] = landTopo.transform.scale;

console.log('arcs      ', landTopo.arcs.length.toLocaleString());
console.log('points    ', points.toLocaleString());
console.log('grid step ', (scaleLon * 111320).toFixed(0) + 'm at the equator');
console.log('raw       ', (statSync(outPath).size / 1024).toFixed(0) + 'KB');
console.log('gzipped   ', (gzipSync(json, { level: 9 }).length / 1024).toFixed(0) + 'KB (what a browser downloads)');
