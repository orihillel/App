import { describe, it, expect } from 'vitest';
import { topologyToPolygons, polygonsToPixelRings, punchLandMask } from './landmask.js';

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

// A context that records instead of painting: the drawing is a handful of calls whose order and
// composite mode are the whole behaviour, and jsdom has no canvas to paint on anyway.
function fakeCtx() {
  const calls = [];
  return {
    calls,
    globalCompositeOperation: 'source-over',
    fillStyle: '',
    save() { calls.push(['save', this.globalCompositeOperation]); },
    restore() { calls.push(['restore']); },
    beginPath() { calls.push(['beginPath']); },
    moveTo(x, y) { calls.push(['moveTo', x, y]); },
    lineTo(x, y) { calls.push(['lineTo', x, y]); },
    closePath() { calls.push(['closePath']); },
    fill() { calls.push(['fill', this.globalCompositeOperation]); },
  };
}

describe('punchLandMask', () => {
  const rings = polygonsToPixelRings(
    topologyToPolygons(topo([SQUARE], [{ type: 'Polygon', arcs: [[0]] }])), 360, 180,
  );

  it('erases rather than paints, and hands the canvas back as it found it', () => {
    // The chart is already on the canvas; land has to be taken out of it. Painting over in the
    // background colour would also cover the globe underneath.
    const ctx = fakeCtx();
    punchLandMask(ctx, rings, 360);
    expect(ctx.calls.filter((c) => c[0] === 'fill').every((c) => c[1] === 'destination-out')).toBe(true);
    expect(ctx.calls[0][0]).toBe('save');
    expect(ctx.calls[ctx.calls.length - 1][0]).toBe('restore');
  });

  it('draws a ring once when one copy covers it', () => {
    const ctx = fakeCtx();
    punchLandMask(ctx, rings, 360);
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
    punchLandMask(ctx, wrapped, 360);
    expect(ctx.calls.filter((c) => c[0] === 'moveTo')).toHaveLength(2);
    const xs = ctx.calls.filter((c) => c[0] === 'lineTo').map((c) => c[1]);
    expect(Math.min(...xs)).toBeLessThan(0); // the copy that reaches back onto the canvas
  });

  it('closes every ring it starts', () => {
    const ctx = fakeCtx();
    punchLandMask(ctx, rings, 360);
    expect(ctx.calls.filter((c) => c[0] === 'closePath')).toHaveLength(1);
  });

  it('does nothing at all when there is no land to cut out', () => {
    const ctx = fakeCtx();
    punchLandMask(ctx, [], 360);
    expect(ctx.calls.filter((c) => c[0] === 'fill')).toHaveLength(0);
  });
});
