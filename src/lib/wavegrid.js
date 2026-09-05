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
export const GRID_LAT_STEP = 5;

// Rows are spaced evenly in latitude, but the number of cells in a row scales with cos(lat) so
// that cells stay roughly equal *area* rather than equal *degrees*. A 5-degree lon cell at 70N
// is a third the width of one at the equator, so a uniform grid spends a third of its budget
// on the two thinnest slivers of the map. This keeps the sampling even where it is visible and
// costs about 35% fewer points, which is the difference between fitting in a free API's daily
// budget and not.
export function gridRows() {
  const rows = [];
  for (let lat = -GRID_MAX_LAT; lat <= GRID_MAX_LAT; lat += GRID_LAT_STEP) {
    const shrink = Math.cos((lat * Math.PI) / 180);
    const count = Math.max(8, Math.round((360 / GRID_LAT_STEP) * shrink));
    rows.push({ lat, count, step: 360 / count });
  }
  return rows;
}

// Every cell centre, in the order their bytes are stored. Callers must not re-sort this: the
// index *is* the addressing scheme.
export function gridCells() {
  const cells = [];
  for (const row of gridRows()) {
    for (let i = 0; i < row.count; i++) {
      cells.push({ lat: row.lat, lon: -180 + (i + 0.5) * row.step });
    }
  }
  return cells;
}

export function gridCellCount() {
  let n = 0;
  for (const row of gridRows()) n += row.count;
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
export function sampleGrid(heights, lat, lon) {
  if (!heights || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -GRID_MAX_LAT - GRID_LAT_STEP / 2 || lat > GRID_MAX_LAT + GRID_LAT_STEP / 2) return null;
  const rows = gridRows();
  // Nearest row, then nearest cell within it. Rows are evenly spaced, so this is arithmetic
  // rather than a search.
  let r = Math.round((lat + GRID_MAX_LAT) / GRID_LAT_STEP);
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
export function sampleGridSmooth(heights, lat, lon) {
  if (!heights || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const rows = gridRows();
  const fr = (lat + GRID_MAX_LAT) / GRID_LAT_STEP;
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
