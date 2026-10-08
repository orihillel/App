// Regenerates the globe's land mask, public/landmask-*.bin, from the shipped vector coastline.
//
// Run with: npm run build:landmask
//
// The mask is what cuts the swell and wind overlay to the shore, and what keeps the arrows off
// the land: the fraction of each texel of a 4096x2048 map that is land, one byte a texel. It
// used to be drawn on the phone, the first time the overlay was shown -- the whole 3MB coastline
// fetched (807KB over the wire), four thousand rings filled into a 34MB canvas, and eight
// million pixels read back, before the overlay could appear. All of that produced the same
// bytes every time, for everyone. Now it is done once, here, and shipped deflated; the phone
// fetches a fraction of the download and inflates it.
//
// The rings are the same ones the coastline lines are drawn from (public/coastline-10m-v2.json,
// built by build-coastline.mjs), thinned and placed by the same functions the phone used
// (lib/landmask.js), so the chart's edge and the drawn coastline are still one piece of
// geometry. The fill is lib/landmask.js's rasterizeCoverage rather than a canvas: Node has no
// canvas, and exact coverage is what a canvas approximates anyway.
//
// The output name carries a version (see LAND_MASK in lib/landmask.js), and it has to: the
// service worker keeps this file cache-first, so changed contents at an unchanged name would
// never reach anyone who already has it. Bump it whenever the coastline or the rasterizer
// changes, and rebuild.
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { topologyToPolygons, polygonsToPixelRings, rasterizeCoverage, LAND_MASK } from '../src/lib/landmask.js';

const coastline = fileURLToPath(new URL('../public/coastline-10m-v2.json', import.meta.url));
const outPath = fileURLToPath(new URL('../public/' + LAND_MASK.file, import.meta.url));
const { width, height } = LAND_MASK;

const started = Date.now();
const polygons = topologyToPolygons(JSON.parse(readFileSync(coastline, 'utf8')));
const mask = rasterizeCoverage(polygonsToPixelRings(polygons, width, height), width, height);
const packed = deflateSync(mask, { level: 9 });
writeFileSync(outPath, packed);

let land = 0;
let edge = 0;
for (const v of mask) {
  if (v === 255) land++;
  else if (v > 0) edge++;
}
console.log('polygons  ', polygons.length.toLocaleString());
console.log('size      ', width + 'x' + height);
console.log('land      ', ((land / mask.length) * 100).toFixed(1) + '% of texels, ' + edge.toLocaleString() + ' on a coastline');
console.log('deflated  ', (packed.length / 1024).toFixed(0) + 'KB');
console.log('took      ', ((Date.now() - started) / 1000).toFixed(1) + 's');
