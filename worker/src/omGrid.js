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

// The wind model, which is a different file in the same bucket.
//
// No wave model carries the wind that blows over the sea. `ncep_gfswave025` and `dwd_gwam` both
// publish a `wind_wave` partition, which is the sea that wind raises -- a wave variable wearing
// a wind-sounding name, and not the thing an onshore/offshore read needs. The 10m wind lives in
// the atmospheric models, so that is where this goes.
//
// GFS at 0.13 degrees rather than ECMWF at 0.25: measured against the live bucket, the IFS file
// needs more than four times the range requests for the same two fields, because its variables
// are laid out in smaller pieces. Both were read successfully; this one is cheaper.
export const WIND_MODEL = 'ncep_gfs013';
export const WIND_U_FIELD = 'wind_u_component_10m';
export const WIND_V_FIELD = 'wind_v_component_10m';

// Both models run four times a day, but they do not publish at the same cadence: the wave model
// writes a file every three hours and GFS writes one every hour. Probed, not assumed --
// `2026-09-22T0100.om` is a 404 under `ecmwf_wam025` and a 206 under `ncep_gfs013`. Asking for
// an hour a model does not publish is a 404, so this is what keeps the URL guessable.
const RUN_HOURS = [0, 6, 12, 18];
const STEP_HOURS = 3;
export const WIND_STEP_HOURS = 1;

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
export function stepAt(ms, stepHours = STEP_HOURS) {
  const d = new Date(ms);
  const h = Math.floor(d.getUTCHours() / stepHours) * stepHours;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h);
}

// Candidate URLs for "the field right now", newest run first.
//
// Returned rather than fetched so the order is testable without a network: which run is
// preferred is the whole decision here, and a test that had to mock four HTTP calls to check
// it would be testing the mock.
export function candidateKeys(now, model = WAVE_MODEL, stepHours = STEP_HOURS) {
  return candidateKeysFor(stepAt(now, stepHours), now, model);
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

// The run directory a file key belongs to, e.g. "data_spatial/ecmwf_wam025/2026/09/22/1800Z".
export function runDirOf(key) {
  return key.slice(0, key.lastIndexOf('/'));
}

// A note of which runs have already been found not to reach a given hour, shared across the
// frames of one pass.
//
// A model publishes its timesteps in order, so a run that has no file for hour t has none for
// any hour after t either. Without this, every frame re-asks the newest run and collects the
// same 404 -- measured in the real Worker, twelve frames cost thirty-six requests where they
// should cost about twelve, and a Worker invocation is allowed fifty in total.
//
// Only sound because advanceFrames walks the week forward in time. Handed in rather than kept
// in module state, so it lives exactly as long as the pass it belongs to and two passes can
// never poison each other.
export function newRunProbe() {
  return { exhausted: new Set() };
}

export async function fetchFrameFromOm(isoHour, step, opts = {}) {
  const validMs = parseFrameHour(isoHour);
  if (validMs == null) return null;
  const now = opts.now || Date.now();
  const fetchImpl = opts.fetch || fetch;
  const probe = opts.probe || null;
  for (const key of candidateKeysFor(validMs, now, opts.model)) {
    const runDir = runDirOf(key);
    if (probe && probe.exhausted.has(runDir)) continue;
    let res;
    try {
      res = await fetchImpl(OM_BUCKET + '/' + key);
    } catch {
      // A socket failure says nothing about whether the run has published, so it is not
      // recorded -- only a 404 is evidence about the run itself.
      continue;
    }
    if (!res || !res.ok) {
      if (probe && res && res.status === 404) probe.exhausted.add(runDir);
      continue;
    }
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

// ---------------------------------------------------------------------------
// Reading one field out of a file too big to download
// ---------------------------------------------------------------------------

// The wave file is 1.4MB and is fetched whole, above. The wind file is not: `ncep_gfs013`
// publishes twenty-one fields in one 24MB file, and only two of them are wanted.
//
// The reader can do that already -- it takes a backend and asks it for byte ranges -- but the
// obvious backend is the trap. Handing the shipped `OmHttpBackend` this file and asking for u
// and v costs **85 HTTP requests**, measured against the live bucket, and a Worker invocation
// on the free plan is allowed fifty. That number is not a property of the data. Tracing the
// ranges it asks for shows what it is:
//
//   - 23 requests to open the file and list its children, every one of them inside the *same
//     107KB* window at the end of the file, several of them under forty bytes.
//   - 31 requests to read one field, whose bytes turn out to be one **contiguous 1.8MB run**.
//
// So it is 85 requests for what is, on the wire, three regions. This backend coalesces them: a
// miss fetches a window large enough to cover the reads that follow, and the small ones land in
// it. Measured the same way afterwards: **3 requests**. What looked like a limit that needed the
// read paced across cron ticks was an artefact of how the ranges were issued.
//
// The window sizes are the only tuning, and they are deliberately generous rather than fitted
// to this one file's layout: a miss costs one extra request, never a wrong answer.
export const OM_TAIL_WINDOW = 512 * 1024;
export const OM_READ_WINDOW = 2 * 1024 * 1024;

// The reader's backend interface is two methods: how big is the file, and give me these bytes.
export class RangeBackend {
  constructor(url, opts = {}) {
    this.url = url;
    this.fetchImpl = opts.fetch || fetch;
    this.tailWindow = opts.tailWindow ?? OM_TAIL_WINDOW;
    this.readWindow = opts.readWindow ?? OM_READ_WINDOW;
    // Four is enough for the trailer plus two fields with one to spare, and it is a memory
    // bound as much as a cache policy: blocks are megabytes and a Worker has 128MB.
    this.maxBlocks = opts.maxBlocks ?? 4;
    this.blocks = [];
    this.size = null;
    // Counted so a test can assert the coalescing still works. It is the whole point of the
    // class, and a silent regression here is a Worker that exceeds its subrequest limit in
    // production and nowhere else.
    this.requests = 0;
    this.bytesFetched = 0;
  }

  async fetchRange(header) {
    this.requests++;
    const res = await this.fetchImpl(this.url, { headers: { Range: header } });
    if (!res || !res.ok) {
      const err = new Error('range ' + header + ' -> ' + (res ? res.status : 'no response'));
      // Carried on the error rather than parsed back out of its message. A run that has not
      // published yet is a 404 and is the ordinary case; anything else is a fault somebody
      // needs to hear about, and the caller cannot tell them apart from a string.
      if (res) err.status = res.status;
      throw err;
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    this.bytesFetched += buf.length;
    let start = 0;
    // Content-Range is how a suffix request ("the last N bytes") reports where it landed, and
    // it carries the total size, so one request both sizes the file and fills the cache.
    const cr = res.headers && res.headers.get ? res.headers.get('content-range') : null;
    const m = cr ? /bytes (\d+)-(\d+)\/(\d+)/.exec(cr) : null;
    if (m) { start = Number(m[1]); this.size = Number(m[3]); }
    const block = { start, bytes: buf };
    this.blocks.push(block);
    while (this.blocks.length > this.maxBlocks) this.blocks.shift();
    return block;
  }

  blockFor(offset, size) {
    // Newest first: reads run forward through a field, so the block just fetched is the one
    // the next read almost always wants.
    for (let i = this.blocks.length - 1; i >= 0; i--) {
      const b = this.blocks[i];
      if (offset >= b.start && offset + size <= b.start + b.bytes.length) return b;
    }
    return null;
  }

  async count() {
    if (this.size == null) await this.fetchRange('bytes=-' + this.tailWindow);
    return this.size;
  }

  async getBytes(offset, size) {
    let b = this.blockFor(offset, size);
    if (!b) {
      const len = Math.max(size, this.readWindow);
      b = await this.fetchRange('bytes=' + offset + '-' + (offset + len - 1));
      if (offset < b.start || offset + size > b.start + b.bytes.length) {
        throw new Error('range ' + offset + '+' + size + ' not covered by the block returned');
      }
    }
    return b.bytes.subarray(offset - b.start, offset - b.start + size);
  }

  async close() { this.blocks = []; }
}

// Open a file over byte ranges and hand back the 2-D fields it holds, by name.
export async function openOmOverRange(url, opts = {}) {
  const backend = opts.backend || new RangeBackend(url, opts);
  const { OmFileReader } = await import('@openmeteo/file-reader');
  const reader = await OmFileReader.create(backend);
  const fields = {};
  const n = reader.numberOfChildren();
  for (let i = 0; i < n; i++) {
    const c = await reader.getChild(i);
    if (c && c.getDimensions().length === 2) fields[c.getName()] = c;
  }
  return { fields, backend };
}

// ---------------------------------------------------------------------------
// Wind
// ---------------------------------------------------------------------------

// Average the wind over one of our cells as a vector, and report it the way the app stores it.
//
// Not the mean of the speeds. Wind is a vector, and the two are different quantities: a cell
// holding a sea breeze on one side and a land breeze on the other has a real mean speed and
// almost no mean wind, and it is the second number that tells a surfer whether the face will be
// clean. Averaging u and v separately and taking the magnitude gives that; it also makes the
// direction fall out of the same sum, instead of being a second circular mean that could
// disagree with the speed it is attached to.
//
// The bearing returned is the direction the wind comes *from*, in degrees, because that is the
// convention the point-query path stores (Open-Meteo's `wind_direction_10m`) and the app's
// arrows already read. A westerly -- u positive, blowing towards the east -- is 270.
export function areaMeanWind(uField, vField, lat, lon, halfLat, halfLon) {
  const { nLat, nLon } = uField;
  const rowOf = (a) => Math.round(((a + 90) / 180) * (nLat - 1));
  const colOf = (o) => ((Math.round(((((o + 180) % 360) + 360) % 360 / 360) * nLon) % nLon) + nLon) % nLon;
  const r0 = Math.max(0, rowOf(lat - halfLat));
  const r1 = Math.min(nLat - 1, rowOf(lat + halfLat));
  const cStart = colOf(lon - halfLon);
  const wide = columnsSpanned(halfLon, nLon);
  let su = 0;
  let sv = 0;
  let count = 0;
  for (let r = r0; r <= r1; r++) {
    for (let k = 0; k < wide; k++) {
      const i = r * nLon + ((cStart + k) % nLon);
      const u = uField.values[i];
      const v = vField.values[i];
      if (!Number.isFinite(u) || !Number.isFinite(v)) continue;
      su += u; sv += v; count++;
    }
  }
  if (!count) return { speed: null, bearing: null };
  const u = su / count;
  const v = sv / count;
  // The file is metres per second; the app's scale, its legend and its stored bytes are all
  // km/h, which is Open-Meteo's own default on the forecast endpoint the old path used.
  const speed = Math.hypot(u, v) * 3.6;
  // A dead-calm cell has no direction to report, and atan2(0, 0) is 0 -- a due-north arrow
  // drawn on nothing. Below a tenth of a km/h there is no wind to point at.
  const bearing = speed < 0.1 ? null : ((270 - (Math.atan2(v, u) * 180) / Math.PI) % 360 + 360) % 360;
  return { speed, bearing };
}

// Sample decoded u/v fields onto the app's own grid.
export function regridWind(uField, vField, step = GRID_LAT_STEP) {
  const cells = gridCells(step);
  const speeds = new Array(cells.length);
  const directions = new Array(cells.length);
  const halfLat = step / 2;
  for (let i = 0; i < cells.length; i++) {
    const { lat, lon } = cells[i];
    const halfLon = Math.min(180, halfLat / Math.max(0.15, Math.cos((lat * Math.PI) / 180)));
    const { speed, bearing } = areaMeanWind(uField, vField, lat, lon, halfLat, halfLon);
    speeds[i] = speed;
    directions[i] = bearing;
  }
  return { cells: cells.length, speeds, directions };
}

// Build a wind grid from the newest published file, or null if none is reachable.
//
// The same shape and the same promise as buildGridFromOm: null rather than a throw, so the
// caller falls back to point queries instead of the overlay going dark.
//
// Unlike the sea, the atmosphere has a reading everywhere -- over land, over ice, over the
// poles -- so unlike the wave field there are no NaNs to step around and coverage is 1 or the
// build did not happen.
export async function buildWindGridFromOm(opts = {}) {
  const now = opts.now || Date.now();
  const step = opts.step || GRID_LAT_STEP;
  const model = opts.model || WIND_MODEL;
  for (const key of candidateKeys(now, model, opts.stepHours ?? WIND_STEP_HOURS)) {
    const url = OM_BUCKET + '/' + key;
    let opened;
    try {
      opened = await (opts.openOm || openOmOverRange)(url, opts);
    } catch (err) {
      // A run that has not published yet answers the suffix request with a 404, and that is
      // the ordinary case for the newest run rather than something to report. Everything else
      // -- a 500, a socket, a reader that could not start -- is a fault, and a fault that
      // falls through to the point queries in silence is indistinguishable from a fast path
      // that was never needed. That is how a broken one survives for weeks.
      if (err && err.status === 404) continue;
      opts.onOmError?.(err);
      continue;
    }
    const { fields, backend } = opened;
    const uf = fields[WIND_U_FIELD];
    const vf = fields[WIND_V_FIELD];
    if (!uf || !vf) { await backend.close(); continue; }
    const u = await readField(uf);
    const v = await readField(vf);
    await backend.close();
    const { cells, speeds, directions } = regridWind(u, v, step);
    let withData = 0;
    for (const s of speeds) if (s != null) withData++;
    return {
      generatedAt: now,
      cells,
      speeds,
      directions,
      latStep: step,
      coverage: 1,
      windCells: withData,
      source: key,
      requests: backend.requests,
    };
  }
  return null;
}
