// A coarse global grid of live wave heights, for the globe's ocean overlay.
//
// Shared by the app and the Worker: the Worker walks this grid to fetch and cache the heights,
// the app walks the identical grid to decode them. One definition means the two can never
// disagree about which byte describes which piece of ocean — a disagreement that would not
// throw, it would just quietly paint the Pacific's swell onto the Atlantic.
//
// Why a Worker fetches this rather than the app: the app already asks Open-Meteo for a
// forecast per spot, from each user's own browser. A global grid is a very different shape of
// request — over a thousand points, identical for every user, changing a few times a day. One
// scheduled fetch shared by everyone is both far kinder to a free public API and the only
// version that fits inside its rate limits at all.

// Poleward of this there is sea ice, no surf, and nothing worth a request. 75 still takes in
// Arctic Norway (Unstad sits at 68.3N) and the Southern Ocean latitudes where the swell that
// reaches half the catalog is actually generated.
export const GRID_MAX_LAT = 75;

// 10 degrees, and the number is set by the rate limit rather than by taste.
//
// At 5 degrees this grid was 1,612 points. Open-Meteo's free tier allows roughly 600 calls a
// minute, so 1,612 points cannot be fetched inside a minute *at all* — and every design that
// spread them across several minutes then collided with the platform's bounded invocations.
// Three attempts failed that way: unpaced (half the grid), paced over 3.2 minutes (never
// finished), sliced across cron runs (needed ~2.5 hours of ticks). The grid has to fit the
// budget, not the other way round.
//
// 10 degrees is 406 points: one pass, about 32 seconds, comfortably inside a minute's budget.
// The overlay is interpolated to a 720x360 texture before it reaches the screen, so the cost is
// detail in the swell field rather than visible blocks — and a coarse map that exists beats a
// fine one that never loads.
export const GRID_LAT_STEP = 10;

// The coarser grid the week-long animation is built on, and it is set by the same arithmetic
// that set the one above -- the budget, not taste.
//
// Open-Meteo bills by values returned: locations times timesteps. A week of 6-hourly frames is
// 28 timesteps, and 28 frames of the 406-cell live grid is 11,368 units against a daily
// allowance of roughly 10,000. The whole week, in one build, would not fit in a day. At 15
// degrees the grid is 186 cells and the same week costs 5,208 -- affordable once a day, which
// is the cadence the animation is rebuilt at.
//
// The visible cost is smaller than it sounds: the overlay is interpolated to a 720x360 texture
// before it is drawn, so this is detail in the swell field rather than blocks on the screen.
export const FRAME_LAT_STEP = 15;

// Rows are spaced evenly in latitude, but the number of cells in a row scales with cos(lat) so
// that cells stay roughly equal *area* rather than equal *degrees*. A 5-degree lon cell at 70N
// is a third the width of one at the equator, so a uniform grid spends a third of its budget
// on the two thinnest slivers of the map. This keeps the sampling even where it is visible and
// costs about 35% fewer points, which is the difference between fitting in a free API's daily
// budget and not.
export function gridRows(step = GRID_LAT_STEP) {
  const rows = [];
  for (let lat = -GRID_MAX_LAT; lat <= GRID_MAX_LAT; lat += step) {
    const shrink = Math.cos((lat * Math.PI) / 180);
    const count = Math.max(8, Math.round((360 / step) * shrink));
    rows.push({ lat, count, step: 360 / count });
  }
  return rows;
}

// Every cell centre, in the order their bytes are stored. Callers must not re-sort this: the
// index *is* the addressing scheme.
export function gridCells(step = GRID_LAT_STEP) {
  const cells = [];
  for (const row of gridRows(step)) {
    for (let i = 0; i < row.count; i++) {
      cells.push({ lat: row.lat, lon: -180 + (i + 0.5) * row.step });
    }
  }
  return cells;
}

export function gridCellCount(step = GRID_LAT_STEP) {
  let n = 0;
  for (const row of gridRows(step)) n += row.count;
  return n;
}

// One byte per cell: wave height in decimetres, so 0-25.4m at 0.1m steps — finer than the
// forecast is accurate to, and a range no sea has ever exceeded.
export const NO_DATA = 255;

export function encodeHeights(metres) {
  const bytes = new Uint8Array(metres.length);
  for (let i = 0; i < metres.length; i++) {
    const m = metres[i];
    // Land, ice, or a point the upstream model has nothing for. Distinguishing it from "flat
    // calm" is the whole point: one must be painted, the other must be left transparent.
    bytes[i] = (m == null || !Number.isFinite(m) || m < 0)
      ? NO_DATA
      : Math.min(254, Math.round(m * 10));
  }
  return bytes;
}

export function decodeHeights(bytes) {
  const out = new Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    out[i] = bytes[i] === NO_DATA ? null : bytes[i] / 10;
  }
  return out;
}

// Base64 rather than a JSON array of numbers: the grid is ~1.2KB of bytes, which JSON would
// inflate roughly fourfold for no gain, and Workers KV bills by stored size.
export function bytesToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function base64ToBytes(b64) {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}

// The wave height at a position, by looking up the cell containing it.
//
// Returns null over land and outside the grid's latitude range, which the overlay renders as
// "draw nothing here" rather than as calm water.
export function sampleGrid(heights, lat, lon, step = GRID_LAT_STEP) {
  if (!heights || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -GRID_MAX_LAT - step / 2 || lat > GRID_MAX_LAT + step / 2) return null;
  const rows = gridRows(step);
  // Nearest row, then nearest cell within it. Rows are evenly spaced, so this is arithmetic
  // rather than a search.
  let r = Math.round((lat + GRID_MAX_LAT) / step);
  r = Math.max(0, Math.min(rows.length - 1, r));
  let offset = 0;
  for (let i = 0; i < r; i++) offset += rows[i].count;
  const row = rows[r];
  let wrapped = ((lon + 180) % 360 + 360) % 360;
  const i = Math.min(row.count - 1, Math.floor(wrapped / row.step));
  const v = heights[offset + i];
  return v === undefined ? null : v;
}

// Bilinear sample, skipping cells with no data.
//
// Nearest-neighbour on a 5-degree grid renders as visible blocks the size of Portugal, so the
// overlay interpolates. The null-awareness is the part that matters: averaging a land cell in
// as though it were 0m would drag a band of false calm out along every coast — exactly where
// people are looking. Instead only the neighbours that have data contribute, reweighted, so
// the field fades out at the coast rather than dipping.
// The same bilinear sampling as sampleGridSmooth and sampleDirectionSmooth, with the part that
// does not depend on the point hoisted out of the call.
//
// Those two rebuild the row table on every invocation -- eleven rows, each with a cos() and a
// round() -- and allocate an offsets array and four array literals besides. That is invisible
// when the overlay is painted once. The animation paints it 28 times, and a 720x360 texture is
// 259,200 texels, so painting one frame was calling gridRows 259,200 times: about 2.9 million
// trig operations and a million short-lived arrays to produce a picture whose geometry never
// changes. Measured in a browser, each frame froze the main thread for about half a second.
//
// Same arithmetic, same results -- a test asserts they agree texel for texel. Build one sampler
// per paint and call it per texel.
export function makeGridSampler(step = GRID_LAT_STEP) {
  const rows = gridRows(step);
  const n = rows.length;
  const counts = new Int32Array(n);
  const stepsLon = new Float64Array(n);
  const offsets = new Int32Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    counts[i] = rows[i].count;
    stepsLon[i] = rows[i].step;
    offsets[i] = acc;
    acc += rows[i].count;
  }

  // Which two cells in row `ri` a longitude falls between, and how much of each.
  function span(ri, lon) {
    const fx = ((((lon + 180) % 360) + 360) % 360) / stepsLon[ri] - 0.5;
    const i0 = Math.floor(fx);
    const t = fx - i0;
    const c = counts[ri];
    return {
      a: offsets[ri] + (((i0 % c) + c) % c),
      b: offsets[ri] + ((((i0 + 1) % c) + c) % c),
      wa: 1 - t,
      wb: t,
    };
  }

  function rowsAt(lat) {
    const fr = (lat + GRID_MAX_LAT) / step;
    const r0 = Math.floor(fr);
    return { r0, tLat: fr - r0 };
  }

  return {
    height(values, lat, lon) {
      if (!values || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      const { r0, tLat } = rowsAt(lat);
      let total = 0;
      let weight = 0;
      for (let k = 0; k < 2; k++) {
        const ri = r0 + k;
        const wLat = k === 0 ? 1 - tLat : tLat;
        if (ri < 0 || ri >= n || wLat <= 0) continue;
        const sp = span(ri, lon);
        for (let j = 0; j < 2; j++) {
          const wLon = j === 0 ? sp.wa : sp.wb;
          if (wLon <= 0) continue;
          const v = values[j === 0 ? sp.a : sp.b];
          if (v == null || !Number.isFinite(v)) continue;
          total += v * wLat * wLon;
          weight += wLat * wLon;
        }
      }
      return weight > 0 ? total / weight : null;
    },

    direction(values, lat, lon) {
      if (!values || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      const { r0, tLat } = rowsAt(lat);
      let x = 0;
      let y = 0;
      let weight = 0;
      for (let k = 0; k < 2; k++) {
        const ri = r0 + k;
        const wLat = k === 0 ? 1 - tLat : tLat;
        if (ri < 0 || ri >= n || wLat <= 0) continue;
        const sp = span(ri, lon);
        for (let j = 0; j < 2; j++) {
          const wLon = j === 0 ? sp.wa : sp.wb;
          if (wLon <= 0) continue;
          const deg = values[j === 0 ? sp.a : sp.b];
          if (deg == null || !Number.isFinite(deg)) continue;
          const w = wLat * wLon;
          const rad = (deg * Math.PI) / 180;
          x += Math.sin(rad) * w;
          y += Math.cos(rad) * w;
          weight += w;
        }
      }
      if (weight <= 0) return null;
      if (Math.sqrt(x * x + y * y) < weight * 0.15) return null;
      return (((Math.atan2(x, y) * 180) / Math.PI) + 360) % 360;
    },
  };
}

export function sampleGridSmooth(heights, lat, lon, step = GRID_LAT_STEP) {
  if (!heights || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const rows = gridRows(step);
  const fr = (lat + GRID_MAX_LAT) / step;
  const r0 = Math.floor(fr);
  const tLat = fr - r0;
  let total = 0;
  let weight = 0;
  const offsets = [];
  let acc = 0;
  for (const row of rows) { offsets.push(acc); acc += row.count; }

  for (const [ri, wLat] of [[r0, 1 - tLat], [r0 + 1, tLat]]) {
    if (ri < 0 || ri >= rows.length || wLat <= 0) continue;
    const row = rows[ri];
    // Cell centres sit at half-steps, so shift by half a cell before flooring to find the two
    // cells this longitude falls between.
    const fx = (((lon + 180) % 360 + 360) % 360) / row.step - 0.5;
    const i0 = Math.floor(fx);
    const tLon = fx - i0;
    for (const [ii, wLon] of [[i0, 1 - tLon], [i0 + 1, tLon]]) {
      if (wLon <= 0) continue;
      const wrapped = ((ii % row.count) + row.count) % row.count;
      const v = heights[offsets[ri] + wrapped];
      if (v == null || !Number.isFinite(v)) continue;
      total += v * wLat * wLon;
      weight += wLat * wLon;
    }
  }
  // Every contributing cell was land: nothing to draw here.
  return weight > 0 ? total / weight : null;
}

// Every cell that has no reading, filled from the cells around it.
//
// This exists because of where the overlay's edge comes from. It used to come from this grid:
// no reading meant land, and land meant draw nothing. Now the edge is cut from the real
// coastline, which sits wherever it sits — often a long way inside the cell that answered for
// it, since a cell here is about 1,100km across. Without filling, a bay or a whole coastal
// strip that the model has no cell centre in would be inside the coastline and still have
// nothing to paint, and the chart would stop short of the shore in ragged patches — the same
// complaint in a new place.
//
// Two rounds, deliberately. Land is hidden by the mask, so the only cells that need a value are
// the ones a coastal *texel* interpolates from, and those are at most a cell or two from open
// water. Spreading further would carry a swell height across a continent and paint it on an
// inland sea, which is a claim about the world rather than a way of reaching the coast.
export function fillGridGaps(heights, rounds = 2, step = GRID_LAT_STEP) {
  if (!Array.isArray(heights)) return heights;
  const rows = gridRows(step);
  const offsets = [];
  let acc = 0;
  for (const row of rows) { offsets.push(acc); acc += row.count; }
  let current = heights.slice();

  for (let pass = 0; pass < rounds; pass++) {
    const next = current.slice();
    let filled = 0;
    for (let ri = 0; ri < rows.length; ri++) {
      const row = rows[ri];
      for (let i = 0; i < row.count; i++) {
        const index = offsets[ri] + i;
        if (current[index] != null) continue;
        let total = 0;
        let n = 0;
        const take = (v) => { if (v != null && Number.isFinite(v)) { total += v; n++; } };
        // East and west, wrapping: a row is a circle, not a line.
        take(current[offsets[ri] + ((i - 1 + row.count) % row.count)]);
        take(current[offsets[ri] + ((i + 1) % row.count)]);
        // North and south. Rows hold different numbers of cells, so the neighbour is whichever
        // cell of the next row this longitude falls in rather than the one at the same index.
        const lon = -180 + (i + 0.5) * row.step;
        for (const rj of [ri - 1, ri + 1]) {
          if (rj < 0 || rj >= rows.length) continue;
          const other = rows[rj];
          const wrapped = ((lon + 180) % 360 + 360) % 360;
          take(current[offsets[rj] + Math.min(other.count - 1, Math.floor(wrapped / other.step))]);
        }
        if (n > 0) { next[index] = total / n; filled++; }
      }
    }
    current = next;
    if (!filled) break; // nothing left that borders a reading
  }
  return current;
}

// Wave direction, one byte a cell, alongside the heights.
//
// 255 is reserved for "no reading", leaving 0-254 for the compass — about 1.4 degrees a step,
// which is finer than a global wave model resolves direction to.
export const NO_DIR = 255;

export function encodeDirections(degrees) {
  const bytes = new Uint8Array(degrees.length);
  for (let i = 0; i < degrees.length; i++) {
    const d = degrees[i];
    if (d == null || !Number.isFinite(d)) { bytes[i] = NO_DIR; continue; }
    const wrapped = ((d % 360) + 360) % 360;
    // 360 and 0 are the same bearing, so the top of the range folds back to the bottom rather
    // than rounding up into the reserved byte.
    bytes[i] = Math.round((wrapped / 360) * 254) % 255;
  }
  return bytes;
}

export function decodeDirections(bytes) {
  const out = new Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    out[i] = bytes[i] === NO_DIR ? null : (bytes[i] / 254) * 360;
  }
  return out;
}

// Bilinear sample of a direction field — as vectors, not as numbers.
//
// Averaging bearings arithmetically is the classic way to get this wrong: 350 and 10 degrees
// are twenty degrees apart and average to due south. Summing unit vectors and taking the angle
// of the result is the circular mean, which gives due north, as it must.
//
// Null-aware in the same way as sampleGridSmooth: only cells that have a reading contribute, so
// a coastal cell with no data does not drag the arrow toward zero.
export function sampleDirectionSmooth(directions, lat, lon, step = GRID_LAT_STEP) {
  if (!directions || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const rows = gridRows(step);
  const fr = (lat + GRID_MAX_LAT) / step;
  const r0 = Math.floor(fr);
  const tLat = fr - r0;
  const offsets = [];
  let acc = 0;
  for (const row of rows) { offsets.push(acc); acc += row.count; }

  let x = 0;
  let y = 0;
  let weight = 0;
  for (const [ri, wLat] of [[r0, 1 - tLat], [r0 + 1, tLat]]) {
    if (ri < 0 || ri >= rows.length || wLat <= 0) continue;
    const row = rows[ri];
    const fx = (((lon + 180) % 360 + 360) % 360) / row.step - 0.5;
    const i0 = Math.floor(fx);
    const tLon = fx - i0;
    for (const [ii, wLon] of [[i0, 1 - tLon], [i0 + 1, tLon]]) {
      if (wLon <= 0) continue;
      const wrapped = ((ii % row.count) + row.count) % row.count;
      const deg = directions[offsets[ri] + wrapped];
      if (deg == null || !Number.isFinite(deg)) continue;
      const w = wLat * wLon;
      const rad = (deg * Math.PI) / 180;
      x += Math.sin(rad) * w;
      y += Math.cos(rad) * w;
      weight += w;
    }
  }
  if (weight <= 0) return null;
  // Opposing directions that cancel leave no meaningful mean; better to draw nothing than an
  // arrow pointing at the numerical residue of two contradictory swells.
  if (Math.sqrt(x * x + y * y) < weight * 0.15) return null;
  return (((Math.atan2(x, y) * 180) / Math.PI) + 360) % 360;
}
