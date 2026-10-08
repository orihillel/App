import { describe, it, expect } from 'vitest';
import { deflateSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import {
  topologyToPolygons, polygonsToPixelRings, fillLandRings, rasterizeCoverage, fetchLandMask, LAND_MASK,
} from './landmask.js';

// An identity transform, so an arc's integer coordinates are read straight off as degrees:
// decodeArc yields [lat, lon] from [x, y], so [3, 7] is longitude 3, latitude 7.
const T = { scale: [1, 1], translate: [0, 0] };

// A closed square from (0,0) to (10,10), as one arc's worth of deltas.
const SQUARE = [[0, 0], [10, 0], [0, 10], [-10, 0], [0, -10]];

// A box straddling the antimeridian: 175E round to 179W and back. Stored the way real data
// stores it — every longitude inside [-180, 180], so the crossing shows up as a 358-degree step
// between consecutive points rather than as an out-of-range number.
const CROSSING = [[175, 0], [4, 0], [-358, 0], [0, 5], [358, 0], [-4, 0], [0, -5]];

function topo(arcs, geometries) {
  return { transform: T, arcs, objects: { land: { type: 'GeometryCollection', geometries } } };
}

describe('topologyToPolygons', () => {
  it('assembles a ring from the arcs a polygon references', () => {
    const [polygon] = topologyToPolygons(topo([SQUARE], [{ type: 'Polygon', arcs: [[0]] }]));
    expect(polygon).toHaveLength(1);
    expect(polygon[0]).toEqual([[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]]);
  });

  it('joins several arcs without repeating the point they meet at', () => {
    // The same square, cut in two at (10,10): TopoJSON stores a shared boundary once, so both
    // halves carry the corner and a naive concatenation would leave a zero-length segment.
    const a = [[0, 0], [10, 0], [0, 10]];
    const b = [[10, 10], [-10, 0], [0, -10]];
    const [polygon] = topologyToPolygons(topo([a, b], [{ type: 'Polygon', arcs: [[0, 1]] }]));
    expect(polygon[0]).toEqual([[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]]);
  });

  it('walks an arc backwards when the reference is negative', () => {
    // ~0 is arc 0 reversed — how the polygon on the other side of a shared edge traverses it.
    const [forward] = topologyToPolygons(topo([SQUARE], [{ type: 'Polygon', arcs: [[0]] }]));
    const [back] = topologyToPolygons(topo([SQUARE], [{ type: 'Polygon', arcs: [[~0]] }]));
    expect(back[0]).toEqual(forward[0].slice().reverse());
  });

  it('keeps a hole with the ring it belongs to rather than as its own polygon', () => {
    // A hole only means anything relative to its exterior; separated, it would fill as land.
    const hole = [[2, 2], [4, 0], [0, 4], [-4, 0], [0, -4]];
    const polygons = topologyToPolygons(topo([SQUARE, hole], [{ type: 'Polygon', arcs: [[0], [1]] }]));
    expect(polygons).toHaveLength(1);
    expect(polygons[0]).toHaveLength(2);
  });

  it('reads a MultiPolygon as several polygons', () => {
    const far = [[100, 40], [5, 0], [0, 5], [-5, 0], [0, -5]];
    const polygons = topologyToPolygons(topo([SQUARE, far], [{ type: 'MultiPolygon', arcs: [[[0]], [[1]]] }]));
    expect(polygons).toHaveLength(2);
  });

  it('unwraps a ring crossing the antimeridian instead of stepping back across the map', () => {
    // 179 -> -179 is one degree east. Drawn literally on an equirectangular canvas it is a line
    // clear across the world, and a filled ring built on it floods half the map.
    const [polygon] = topologyToPolygons(topo([CROSSING], [{ type: 'Polygon', arcs: [[0]] }]));
    const lons = polygon[0].map(([, lon]) => lon);
    expect(lons.slice(0, 3)).toEqual([175, 179, 181]);
    for (let i = 1; i < lons.length; i++) expect(Math.abs(lons[i] - lons[i - 1])).toBeLessThan(180);
  });

  it('keeps a hole inside its continent when the continent unwraps past the antimeridian', () => {
    // An exterior that starts on the far side of 180 unwraps to below -180; a hole inside it,
    // unwrapped on its own, stays between -180 and 180 -- a whole map-width from the land it
    // is a hole in, where it cuts nothing and is filled as land itself. Afro-Eurasia and the
    // Caspian are exactly this.
    const arc = (pts) => pts.map((p, i) => (i === 0 ? p : [p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]]));
    // [lon, lat]: from 170W westward across the antimeridian to 60E and back.
    const continent = arc([[-170, 0], [170, 0], [100, 0], [60, 0], [60, 20], [100, 20], [170, 20], [-170, 20], [-170, 0]]);
    const lake = arc([[80, 5], [90, 5], [90, 10], [80, 10], [80, 5]]);
    const [polygon] = topologyToPolygons(topo([continent, lake], [{ type: 'Polygon', arcs: [[0], [1]] }]));
    const lons = (ring) => ring.map(([, lon]) => lon);
    expect(Math.min(...lons(polygon[0]))).toBe(-300);
    expect(Math.min(...lons(polygon[1]))).toBe(80 - 360);
    expect(Math.max(...lons(polygon[1]))).toBe(90 - 360);
    // And so the lake is a lake: the rasterized mask is sea there and land around it.
    const width = 360;
    const mask = rasterizeCoverage(polygonsToPixelRings([polygon], width, 180), width, 180);
    expect(mask[(90 - 7) * width + (85 + 180)]).toBe(0);
    expect(mask[(90 - 15) * width + (85 + 180)]).toBe(255);
  });

  it('closes a ring that sweeps the whole world over the pole, not across the map', () => {
    // Antarctica's coastline genuinely goes all the way round. Joining its unwrapped ends with
    // a straight chord would draw a line the width of the map at ~70S and fill everything
    // below it in the wrong shape.
    const sweep = [[-180, -70], [90, 0], [90, 0], [90, 0], [90, 0]];
    const [polygon] = topologyToPolygons(topo([sweep], [{ type: 'Polygon', arcs: [[0]] }]));
    const ring = polygon[0];
    expect(ring[ring.length - 1][0]).toBe(-90);
    expect(ring[ring.length - 2][0]).toBe(-90);
  });

  it('gives back nothing rather than throwing when the file is not what it should be', () => {
    for (const junk of [null, undefined, {}, { arcs: [] }, topo([SQUARE], [])]) {
      expect(topologyToPolygons(junk)).toEqual([]);
    }
    expect(topologyToPolygons(topo([SQUARE], [{ type: 'Polygon' }]))).toEqual([]);
  });
});

describe('polygonsToPixelRings', () => {
  const square = topologyToPolygons(topo([SQUARE], [{ type: 'Polygon', arcs: [[0]] }]));

  it('places degrees on the canvas the same way the overlay paints them', () => {
    // 360x180 is one pixel per degree, so the numbers are readable: longitude 0 sits at the
    // middle of the canvas, latitude 10 ten pixels above the equator.
    const [rings] = polygonsToPixelRings(square, 360, 180);
    const xs = [];
    const ys = [];
    for (let i = 0; i < rings[0].pts.length; i += 2) { xs.push(rings[0].pts[i]); ys.push(rings[0].pts[i + 1]); }
    expect(Math.min(...xs)).toBe(180);
    expect(Math.max(...xs)).toBe(190);
    expect(Math.min(...ys)).toBe(80);
    expect(Math.max(...ys)).toBe(90);
  });

  it('drops points the canvas could not tell apart, but never the last one', () => {
    // The coastline is quantized to ~401m and a texel is ~20km; carrying every vertex would
    // describe an edge far finer than the texture can hold. Losing the final vertex, though,
    // would close the ring with a chord instead of its own last segment.
    const dense = [[0, 0]];
    for (let i = 0; i < 200; i++) dense.push([0.01, 0]); // 200 steps of a hundredth of a degree
    dense.push([0, 10], [-2, 0], [0, -10]);
    const [rings] = polygonsToPixelRings(
      topologyToPolygons(topo([dense], [{ type: 'Polygon', arcs: [[0]] }])), 360, 180,
    );
    const kept = rings[0].pts.length / 2;
    expect(kept).toBeGreaterThan(3);
    expect(kept).toBeLessThan(30);
    expect(rings[0].pts.slice(-2)).toEqual([180, 90]); // back to where it started
  });

  it('winds holes against the ring that contains them', () => {
    // Canvas fills by winding number: a hole wound the same way as its exterior is not a hole,
    // it is more land.
    const hole = [[2, 2], [4, 0], [0, 4], [-4, 0], [0, -4]];
    const [rings] = polygonsToPixelRings(
      topologyToPolygons(topo([SQUARE, hole], [{ type: 'Polygon', arcs: [[0], [1]] }])), 360, 180,
    );
    const area = (pts) => {
      let sum = 0;
      for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) sum += pts[j] * pts[i + 1] - pts[i] * pts[j + 1];
      return sum;
    };
    expect(rings).toHaveLength(2);
    expect(Math.sign(area(rings[0].pts))).toBe(1);
    expect(Math.sign(area(rings[1].pts))).toBe(-1);
  });

  it('leaves out an island too small to cover a pixel', () => {
    // Under a texel it can only be drawn as nothing; building the path is pure cost.
    const speck = [[0, 0], [0.001, 0], [0, 0.001], [-0.001, 0], [0, -0.001]];
    expect(polygonsToPixelRings(
      topologyToPolygons(topo([speck], [{ type: 'Polygon', arcs: [[0]] }])), 360, 180,
    )).toEqual([]);
  });

  it('records how far each ring reaches, so the caller knows which copies to draw', () => {
    const [rings] = polygonsToPixelRings(square, 360, 180);
    expect(rings[0].minX).toBe(180);
    expect(rings[0].maxX).toBe(190);
  });
});

// A context that records instead of painting: the drawing is a handful of calls whose order is
// the whole behaviour, and jsdom has no canvas to paint on anyway.
function fakeCtx() {
  const calls = [];
  return {
    calls,
    beginPath() { calls.push(['beginPath']); },
    moveTo(x, y) { calls.push(['moveTo', x, y]); },
    lineTo(x, y) { calls.push(['lineTo', x, y]); },
    closePath() { calls.push(['closePath']); },
    fill() { calls.push(['fill']); },
  };
}

describe('fillLandRings', () => {
  const rings = polygonsToPixelRings(
    topologyToPolygons(topo([SQUARE], [{ type: 'Polygon', arcs: [[0]] }])), 360, 180,
  );

  it('draws a ring once when one copy covers it', () => {
    const ctx = fakeCtx();
    fillLandRings(ctx, rings, 360);
    expect(ctx.calls.filter((c) => c[0] === 'moveTo')).toHaveLength(1);
    expect(ctx.calls.filter((c) => c[0] === 'fill')).toHaveLength(1);
  });

  it('repeats a ring that ran off the edge a map-width away', () => {
    // Unwrapping pushes a ring past the antimeridian off the end of the canvas; the pixels it
    // wrapped around to are covered by the copy shifted back.
    const wrapped = polygonsToPixelRings(
      topologyToPolygons(topo([CROSSING], [{ type: 'Polygon', arcs: [[0]] }])), 360, 180,
    );
    const ctx = fakeCtx();
    fillLandRings(ctx, wrapped, 360);
    expect(ctx.calls.filter((c) => c[0] === 'moveTo')).toHaveLength(2);
    const xs = ctx.calls.filter((c) => c[0] === 'lineTo').map((c) => c[1]);
    expect(Math.min(...xs)).toBeLessThan(0); // the copy that reaches back onto the canvas
  });

  it('closes every ring it starts', () => {
    const ctx = fakeCtx();
    fillLandRings(ctx, rings, 360);
    expect(ctx.calls.filter((c) => c[0] === 'closePath')).toHaveLength(1);
  });

  it('fills a polygon and its holes in one path, so the holes stay holes', () => {
    // Two fills would paint the hole back in as land.
    const hole = [[2, 2], [4, 0], [0, 4], [-4, 0], [0, -4]];
    const withHole = polygonsToPixelRings(
      topologyToPolygons(topo([SQUARE, hole], [{ type: 'Polygon', arcs: [[0], [1]] }])), 360, 180,
    );
    const ctx = fakeCtx();
    fillLandRings(ctx, withHole, 360);
    expect(ctx.calls.filter((c) => c[0] === 'moveTo')).toHaveLength(2);
    expect(ctx.calls.filter((c) => c[0] === 'fill')).toHaveLength(1);
  });

  it('does nothing at all when there is no land to draw', () => {
    const ctx = fakeCtx();
    fillLandRings(ctx, [], 360);
    expect(ctx.calls.filter((c) => c[0] === 'fill')).toHaveLength(0);
  });
});

// A ring in pixels, the shape polygonsToPixelRings hands over: flat [x, y, ...] and its reach.
function pixelRing(points) {
  const xs = points.map(([x]) => x);
  return { pts: points.flat(), minX: Math.min(...xs), maxX: Math.max(...xs) };
}
const box = (x0, y0, x1, y1) => pixelRing([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
const boxBackwards = (x0, y0, x1, y1) => pixelRing([[x0, y0], [x0, y1], [x1, y1], [x1, y0]]);
function at(mask, width, x, y) {
  return mask[y * width + x];
}

describe('rasterizeCoverage', () => {
  it('fills whole pixels solid and leaves the sea empty', () => {
    const mask = rasterizeCoverage([[box(1, 1, 3, 3)]], 5, 5);
    expect(at(mask, 5, 1, 1)).toBe(255);
    expect(at(mask, 5, 2, 2)).toBe(255);
    expect(at(mask, 5, 0, 0)).toBe(0);
    expect(at(mask, 5, 3, 2)).toBe(0);
    expect(at(mask, 5, 4, 4)).toBe(0);
  });

  it('gives a pixel the shore crosses the share of it that is land', () => {
    // Half a pixel in from each side: corners are a quarter land, edges half.
    const mask = rasterizeCoverage([[box(0.5, 0.5, 2.5, 2.5)]], 4, 4);
    expect(at(mask, 4, 0, 0)).toBe(64);
    expect(at(mask, 4, 1, 0)).toBe(128);
    expect(at(mask, 4, 1, 1)).toBe(255);
    expect(at(mask, 4, 2, 2)).toBe(64);
  });

  it('measures a slanting shore by area', () => {
    // x + y = 4: the pixels it runs corner to corner through are exactly half land.
    const mask = rasterizeCoverage([[pixelRing([[0, 0], [4, 0], [0, 4]])]], 4, 4);
    expect(at(mask, 4, 0, 0)).toBe(255);
    expect(at(mask, 4, 3, 0)).toBe(128);
    expect(at(mask, 4, 1, 2)).toBe(128);
    expect(at(mask, 4, 3, 3)).toBe(0);
  });

  it('leaves a hole empty', () => {
    const mask = rasterizeCoverage([[box(0, 0, 6, 6), boxBackwards(2, 2, 4, 4)]], 6, 6);
    expect(at(mask, 6, 1, 1)).toBe(255);
    expect(at(mask, 6, 2, 2)).toBe(0);
    expect(at(mask, 6, 3, 3)).toBe(0);
    expect(at(mask, 6, 4, 4)).toBe(255);
  });

  it('leaves no seam where two pieces of land meet inside a pixel', () => {
    // Two polygons sharing an edge halfway across column 2. Filled one after the other, each
    // half-covers it and the result is three quarters land -- a faint line of sea down the
    // join. Summed as one fill, the shared edge cancels.
    const mask = rasterizeCoverage([[box(0, 0, 2.5, 4)], [box(2.5, 0, 4, 4)]], 4, 4);
    for (let y = 0; y < 4; y++) expect(at(mask, 4, 2, y)).toBe(255);
  });

  it('does not overflow where land is covered twice', () => {
    const mask = rasterizeCoverage([[box(0, 0, 2, 2)], [box(0, 0, 2, 2)]], 3, 3);
    expect(at(mask, 3, 0, 0)).toBe(255);
    expect(at(mask, 3, 2, 2)).toBe(0);
  });

  it('brings land that runs off one edge back on the other', () => {
    // Columns 6 to 10 of an 8-wide map: 6 and 7 here, and 0 and 1 on the far side.
    const mask = rasterizeCoverage([[box(6, 0, 10, 2)]], 8, 2);
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((x) => at(mask, 8, x, 0))).toEqual([255, 255, 0, 0, 0, 0, 255, 255]);
    const left = rasterizeCoverage([[box(-2, 0, 2, 2)]], 8, 2);
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((x) => at(left, 8, x, 1))).toEqual([255, 255, 0, 0, 0, 0, 255, 255]);
  });

  it('cuts a slanting edge at the border without losing its share', () => {
    // A triangle whose sloping side crosses the right-hand border: the part past it wraps.
    const mask = rasterizeCoverage([[pixelRing([[6, 0], [10, 0], [6, 4]])]], 8, 4);
    const wrapped = rasterizeCoverage([[pixelRing([[-2, 0], [2, 0], [-2, 4]])]], 8, 4);
    expect(Array.from(mask)).toEqual(Array.from(wrapped));
    expect(at(mask, 8, 6, 0)).toBe(255);
    expect(at(mask, 8, 0, 0)).toBe(255); // x 8..9 of the first triangle, wrapped round
    expect(at(mask, 8, 1, 0)).toBe(128); // the slope crosses this pixel corner to corner
  });
});

// A fetch that answers with these bytes.
const serve = (bytes, init) => async () => new Response(bytes, init);

describe('fetchLandMask', () => {
  const mask = Uint8Array.from({ length: 8 * 4 }, (_, i) => (i * 37) % 256);

  it('inflates the shipped file into one byte a texel', async () => {
    const got = await fetchLandMask('x', { width: 8, height: 4 }, serve(deflateSync(mask)));
    expect(got.width).toBe(8);
    expect(got.height).toBe(4);
    expect(Array.from(got.mask)).toEqual(Array.from(mask));
  });

  it('refuses a file of the wrong size rather than reading it as a map', async () => {
    expect(await fetchLandMask('x', { width: 8, height: 2 }, serve(deflateSync(mask)))).toBeNull();
    expect(await fetchLandMask('x', { width: 8, height: 8 }, serve(deflateSync(mask)))).toBeNull();
  });

  it('gives up on a failed response', async () => {
    expect(await fetchLandMask('x', { width: 8, height: 4 }, serve('', { status: 404 }))).toBeNull();
  });

  it('throws on bytes that are not deflated, so the caller can fall back', async () => {
    await expect(fetchLandMask('x', { width: 8, height: 4 }, serve(mask))).rejects.toThrow();
  });
});

describe('the shipped land mask', () => {
  // Built by scripts/build-landmask.mjs from the shipped coastline. If either changes without
  // the other, the overlay's edge and the coastline drawn on it stop agreeing -- quietly, a
  // few kilometres at a time. This rebuilds it and compares.
  const read = (name) => readFileSync(new URL('../../public/' + name, import.meta.url));

  it('is what the build script makes from the shipped coastline', async () => {
    const shipped = await fetchLandMask('x', LAND_MASK, serve(read(LAND_MASK.file)));
    const { width, height } = LAND_MASK;
    const fresh = rasterizeCoverage(
      polygonsToPixelRings(topologyToPolygons(JSON.parse(read('coastline-10m-v2.json'))), width, height),
      width, height,
    );
    expect(shipped.mask.length).toBe(fresh.length);
    let differing = 0;
    for (let i = 0; i < fresh.length; i++) if (shipped.mask[i] !== fresh[i]) differing++;
    expect(differing).toBe(0);
  }, 30000);

  it('has land and sea where they are', async () => {
    const shipped = await fetchLandMask('x', LAND_MASK, serve(read(LAND_MASK.file)));
    const { width, height } = LAND_MASK;
    const land = (lat, lon) => shipped.mask[Math.floor(((90 - lat) / 180) * height) * width + Math.floor(((lon + 180) / 360) * width)];
    expect(land(23, 12)).toBe(255);    // the Sahara
    expect(land(-80, 0)).toBe(255);    // Antarctica
    expect(land(0, -140)).toBe(0);     // the middle of the Pacific
    expect(land(-40, 60)).toBe(0);     // the Southern Indian Ocean
  });
});
