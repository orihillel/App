// The globe's data, taken from Open-Meteo's published files rather than from a thousand
// point queries.
//
// The old path asked the forecast API for one location at a time: 406 points, batched a
// hundred at a time, and the grid's resolution was set by what that cost rather than by what
// anybody wanted to see. A 10-degree grid is 1,100km a cell, which is coarse enough that a
// whole North Atlantic depression is a handful of cells and no colour ramp can reveal
// structure the sampling never captured.
//
// Open-Meteo also publishes the same models as files, one per timestep, covering the whole
// globe, on an AWS Open Data bucket that needs no credentials at all. `ecmwf_wam025` is the
// wave model at 0.25 degrees -- about 28km -- in a 1.4MB file holding wave height, direction,
// period and peak period together. Downloading one file and sampling it ourselves costs one
// request instead of four hundred, and the grid's resolution stops being a budget decision.
//
// Verified against the live bucket rather than assumed: anonymous GET returns 200, byte-range
// requests return 206, and the arrays are [721, 1440] -- row 0 at 90S, column 0 at 180W, land
// as NaN. Sixteen probes across known ocean and known land agree, and the two that did not
// were both surf breaks sitting on a coastal cell the model calls land, which is what a 28km
// grid does at a coastline.
import { gridCells, GRID_LAT_STEP } from '../../src/lib/wavegrid.js';

export const OM_BUCKET = 'https://openmeteo.s3.amazonaws.com';
export const WAVE_MODEL = 'ecmwf_wam025';

// The model runs four times a day and publishes 3-hourly steps.
const RUN_HOURS = [0, 6, 12, 18];
const STEP_HOURS = 3;

// How far back to look for a run that has published. A run takes a while to appear, so "the
// run that just started" is usually not there yet; walking back finds the newest one that is.
// Four runs is a day, which is further back than the data is worth using.
export const MAX_RUNS_BACK = 4;

const pad = (n, w = 2) => String(n).padStart(w, '0');

// Where one timestep of one run lives.
//
// The path carries the run that produced it *and* the time it describes, which is why both are
// arguments: the same valid time exists under several runs, and the newest run holding it is
// the best forecast of it.
export function omKey(runMs, validMs, model = WAVE_MODEL) {
  const r = new Date(runMs);
  const v = new Date(validMs);
  const dir = [
    'data_spatial', model,
    r.getUTCFullYear(), pad(r.getUTCMonth() + 1), pad(r.getUTCDate()),
    // Four digits, not two: the bucket writes 0600Z and 1800Z, and 06Z is a 404.
    pad(r.getUTCHours()) + '00Z',
  ].join('/');
  const name = v.getUTCFullYear() + '-' + pad(v.getUTCMonth() + 1) + '-' + pad(v.getUTCDate())
    + 'T' + pad(v.getUTCHours()) + pad(v.getUTCMinutes());
  return dir + '/' + name + '.om';
}

// The model run at or before a moment.
export function runAt(ms) {
  const d = new Date(ms);
  const h = RUN_HOURS.filter((x) => x <= d.getUTCHours()).pop() ?? 0;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h);
}

// The published timestep at or before a moment. Files exist every three hours; asking for the
// hour in between is a 404, so this is what makes the URL guessable rather than searched for.
export function stepAt(ms) {
  const d = new Date(ms);
  const h = Math.floor(d.getUTCHours() / STEP_HOURS) * STEP_HOURS;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h);
}

// Candidate URLs for "the field right now", newest run first.
//
// Returned rather than fetched so the order is testable without a network: which run is
// preferred is the whole decision here, and a test that had to mock four HTTP calls to check
// it would be testing the mock.
export function candidateKeys(now, model = WAVE_MODEL) {
  return candidateKeysFor(stepAt(now), now, model);
}

// The same, for a moment that is not now.
//
// The animated week wants a file per forecast hour, and those are future timesteps of the same
// runs. Which run to prefer is unchanged -- newest first, never one that would be forecasting
// its own past -- so only the valid time differs.
export function candidateKeysFor(validMs, now, model = WAVE_MODEL) {
  const out = [];
  for (let i = 0; i < MAX_RUNS_BACK; i++) {
    const run = runAt(now) - i * 6 * 3600 * 1000;
    if (run > validMs) continue;
    out.push(omKey(run, validMs, model));
  }
  return out;
}

// One frame of the animated week, from the published file for that hour.
//
// `isoHour` is the frame's own key, "2026-09-22T06:00" -- the same string the week is indexed
// by, so a frame fetched here lands under the name the rest of the builder expects.
// "2026-09-22T06:00" or "2026-09-22T06", as UTC. Written out rather than inlined because the
// week's own keys and this bucket's filenames are two different truncations of the same
// instant, and getting the zone wrong would shift every frame by the runner's offset.
export function parseFrameHour(isoHour) {
  if (typeof isoHour !== 'string') return null;
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})(?::(\d{2}))?/.exec(isoHour);
  if (!m) return null;
  const ms = Date.parse(m[1] + 'T' + m[2] + ':' + (m[3] || '00') + ':00Z');
  return Number.isFinite(ms) ? ms : null;
}

export async function fetchFrameFromOm(isoHour, step, opts = {}) {
  const validMs = parseFrameHour(isoHour);
  if (validMs == null) return null;
  const now = opts.now || Date.now();
  const fetchImpl = opts.fetch || fetch;
  for (const key of candidateKeysFor(validMs, now, opts.model)) {
    let res;
    try {
      res = await fetchImpl(OM_BUCKET + '/' + key);
    } catch {
      continue;
    }
    if (!res || !res.ok) continue;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!looksLikeOm(bytes)) continue;
    const fields = await decodeOm(bytes, opts.reader);
    if (!fields.wave_height) continue;
    const height = await readField(fields.wave_height);
    const dir = fields.wave_direction ? await readField(fields.wave_direction) : null;
    const { heights, directions } = regrid(height, dir, step);
    return { heights, directions, source: key };
  }
  return null;
}

// Decode one file into the fields the globe draws.
//
// The reader is @openmeteo/file-reader, which is WebAssembly and needs a shim to run inside a
// Worker at all -- Emscripten locates its .wasm by URL and a bundled Worker has no URL to
// resolve. See src/wasm-shim.js and the `alias` in wrangler.toml. Measured in the real Worker
// runtime: the whole global field decodes in about 36ms, which is why this runs on the cron
// tick rather than on somebody's request.
export async function decodeOm(bytes, reader) {
  const r = reader || (await makeReader(bytes));
  const fields = {};
  const n = r.numberOfChildren();
  for (let i = 0; i < n; i++) {
    const c = await r.getChild(i);
    if (c && c.getDimensions().length === 2) fields[c.getName()] = c;
  }
  return fields;
}

async function makeReader(bytes) {
  const { OmFileReader, FileBackend } = await import('@openmeteo/file-reader');
  return OmFileReader.create(new FileBackend(bytes));
}

export async function readField(field) {
  const { OmDataType } = await import('@openmeteo/file-reader');
  const [nLat, nLon] = field.getDimensions();
  const values = await field.read({
    type: OmDataType.FloatArray,
    ranges: [{ start: 0, end: nLat }, { start: 0, end: nLon }],
  });
  return { values, nLat, nLon };
}

// Average the source cells that fall inside one of our cells, rather than picking one of them.
//
// The source is 0.25 degrees and our grid is coarser, so every cell of ours covers dozens of
// theirs. Taking the nearest single sample would hand a 200km cell whatever the one point at
// its centre happened to be, including a local extreme; the mean of what it actually covers is
// both steadier and the honest answer to "what is the sea doing here".
//
// Land is NaN in the source and stays absent here: a cell with no water in it reports null
// rather than zero, because the overlay must leave it transparent rather than paint it calm.
// How many columns a half-width covers, measured in degrees rather than by differencing two
// wrapped indices.
//
// The index version had a bug worth recording: a window spanning the whole globe wraps to the
// column it started from, so `(end - start + n) % n` is zero -- the same answer it gives for a
// window of no width at all -- and the average collapsed to a single column. Real grids never
// hit it (halfLon stays small away from the poles, and this grid stops at 75 degrees), which
// is exactly the kind of bug that waits.
function columnsSpanned(halfLon, nLon) {
  return Math.min(nLon, Math.max(1, Math.round(((2 * halfLon) / 360) * nLon) + 1));
}

export function areaMean(field, lat, lon, halfLat, halfLon) {
  const { values, nLat, nLon } = field;
  const rowOf = (a) => Math.round(((a + 90) / 180) * (nLat - 1));
  const colOf = (o) => ((Math.round(((((o + 180) % 360) + 360) % 360 / 360) * nLon) % nLon) + nLon) % nLon;
  const r0 = Math.max(0, rowOf(lat - halfLat));
  const r1 = Math.min(nLat - 1, rowOf(lat + halfLat));
  const cStart = colOf(lon - halfLon);
  const wide = columnsSpanned(halfLon, nLon);
  let sum = 0;
  let count = 0;
  for (let r = r0; r <= r1; r++) {
    for (let k = 0; k < wide; k++) {
      const v = values[r * nLon + ((cStart + k) % nLon)];
      if (Number.isFinite(v)) { sum += v; count++; }
    }
  }
  return count ? sum / count : null;
}

// The same, for a bearing. Averaging degrees arithmetically puts the mean of 350 and 10 at 180,
// which is the exact opposite of where the swell is going, so this averages the unit vectors.
export function areaMeanBearing(field, lat, lon, halfLat, halfLon) {
  const { values, nLat, nLon } = field;
  const rowOf = (a) => Math.round(((a + 90) / 180) * (nLat - 1));
  const colOf = (o) => ((Math.round(((((o + 180) % 360) + 360) % 360 / 360) * nLon) % nLon) + nLon) % nLon;
  const r0 = Math.max(0, rowOf(lat - halfLat));
  const r1 = Math.min(nLat - 1, rowOf(lat + halfLat));
  const cStart = colOf(lon - halfLon);
  const wide = columnsSpanned(halfLon, nLon);
  let x = 0;
  let y = 0;
  let count = 0;
  for (let r = r0; r <= r1; r++) {
    for (let k = 0; k < wide; k++) {
      const v = values[r * nLon + ((cStart + k) % nLon)];
      if (!Number.isFinite(v)) continue;
      const rad = (v * Math.PI) / 180;
      x += Math.cos(rad); y += Math.sin(rad); count++;
    }
  }
  if (!count) return null;
  // Opposing swells that cancel leave no meaningful mean direction; saying nothing is better
  // than reporting the arbitrary bearing of a near-zero vector.
  if (Math.hypot(x, y) / count < 0.15) return null;
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

// Sample a decoded file onto the app's own grid.
export function regrid(heightField, dirField, step = GRID_LAT_STEP) {
  const cells = gridCells(step);
  const heights = new Array(cells.length);
  const directions = new Array(cells.length);
  const halfLat = step / 2;
  for (let i = 0; i < cells.length; i++) {
    const { lat, lon } = cells[i];
    // Cells are equal-area rather than equal-degree, so a row near the pole is wider in
    // longitude than one at the equator; halving the row's own span is what keeps the average
    // over the cell the grid actually has.
    const halfLon = Math.min(180, halfLat / Math.max(0.15, Math.cos((lat * Math.PI) / 180)));
    heights[i] = areaMean(heightField, lat, lon, halfLat, halfLon);
    directions[i] = dirField ? areaMeanBearing(dirField, lat, lon, halfLat, halfLon) : null;
  }
  return { cells: cells.length, heights, directions };
}

// Build a grid from the newest published file.
//
// Returns null rather than throwing when no run is reachable, so the caller can fall back to
// the point-query build instead of the globe going dark. That fallback is the whole reason the
// old path is still here: this one depends on a bucket, a file format and a WebAssembly module,
// and a map drawn from four hundred points beats no map at all.
// The format's magic number, plus a floor no real global field could be under. A 0.25-degree
// world is a megabyte and a half; anything under a hundred kilobytes is something else
// wearing the right filename.
export const OM_MAGIC = [0x4f, 0x4d]; // "OM"
export const OM_MIN_BYTES = 100 * 1024;

export function looksLikeOm(bytes) {
  return !!bytes && bytes.length >= OM_MIN_BYTES
    && bytes[0] === OM_MAGIC[0] && bytes[1] === OM_MAGIC[1];
}

export async function buildGridFromOm(opts = {}) {
  const now = opts.now || Date.now();
  const step = opts.step || GRID_LAT_STEP;
  const fetchImpl = opts.fetch || fetch;
  for (const key of candidateKeys(now, opts.model)) {
    let res;
    try {
      res = await fetchImpl(OM_BUCKET + '/' + key);
    } catch {
      continue; // network trouble on one run is not a reason to skip the rest
    }
    if (!res || !res.ok) continue;
    const bytes = new Uint8Array(await res.arrayBuffer());
    // Check it looks like one of these files before reaching for the reader. Importing the
    // reader pulls in two megabytes of WebAssembly, and doing that to find out that the body
    // was a 404 page, an error document or a test's stub is slow in exactly the situations
    // where being slow is worst.
    if (!looksLikeOm(bytes)) continue;
    const fields = await decodeOm(bytes, opts.reader);
    if (!fields.wave_height) continue;
    const height = await readField(fields.wave_height);
    const dir = fields.wave_direction ? await readField(fields.wave_direction) : null;
    const { cells, heights, directions } = regrid(height, dir, step);
    let withData = 0;
    for (const v of heights) if (v != null) withData++;
    return {
      generatedAt: now,
      cells,
      heights,
      directions,
      // One file either decoded or it did not; there is no partial fetch to be short of. The
      // fraction of cells holding water is reported separately and is never a gate, because
      // land legitimately has no wave height.
      latStep: step,
      coverage: 1,
      oceanCells: withData,
      source: key,
    };
  }
  return null;
}
