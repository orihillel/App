// The marine request, in one place, because two callers build it: the browser directly and the
// Worker on its behalf. They were separate string literals listing the same eleven variables,
// which is a duplication that only shows up as a bug -- a spot fetched through the Worker
// carrying a field the direct path does not, or the reverse.

const BASE_HOURLY = [
  'wave_height', 'wave_direction', 'wave_period',
  'swell_wave_height', 'swell_wave_direction', 'swell_wave_period',
  'wind_wave_height', 'wind_wave_direction', 'wind_wave_period',
  'sea_surface_temperature', 'sea_level_height_msl',
];

// Peak period, asked for on top of the mean period already there.
//
// Surf forecasting quotes peak period -- the period carrying the most energy -- and every
// threshold in this app is written in that idiom: conditionsScore gives its groundswell bonus
// at 12 seconds and classifyTrain calls 12 seconds groundswell, which are peak-period numbers.
// Open-Meteo offers both swell_wave_period and swell_wave_peak_period, and offering both is
// what says the first is a mean. For a JONSWAP spectrum T02 is 0.834 Tp, so a mean 11s is a
// peak 13.2s -- across the threshold. The app was quietly withholding the groundswell bonus on
// genuine groundswell days.
const PEAK_HOURLY = [...BASE_HOURLY, 'swell_wave_peak_period', 'wind_wave_peak_period'];

// Which wave models to ask for, finest first.
//
// Left to itself Open-Meteo answers from `best_match`, which is a sensible global default and
// is what this app used for its whole life. The reason to name models instead is resolution:
// `meteofrance_wave` runs a 0.08-degree grid, about 8km, against the 0.25-degree (~25km) grids
// of the global models. A wave field 25km across cannot see a headland, and almost every spot
// in the catalog sits behind one.
//
// Two models rather than one, and the order is the whole design. The finer model is preferred
// wherever it has a number; the global one fills in everywhere it does not -- which matters
// because the finer grid is also the less complete one (3-hourly, reissued twice a day, ten
// days) against a global model that is hourly, reissued four times a day and runs to sixteen.
// Asking for both in one request means the fallback is per value rather than per spot, and
// costs one request rather than two.
//
// These identifiers could not be checked against the live API from here -- open-meteo.com is
// refused by this environment's egress -- and that is exactly how the confidence badge's model
// names were wrong for months without anything saying so. So they are asked for, never
// assumed: a name this upstream does not know produces a 400, which is caught below and costs
// the finer grid and nothing else. See `waveModelsUsed` for how to tell which one answered.
export const WAVE_MODELS = ['meteofrance_wave', 'ncep_gfswave025'];

export function marineUrl(lat, lon, { peak = true, models = null } = {}) {
  return 'https://marine-api.open-meteo.com/v1/marine?latitude=' + lat + '&longitude=' + lon +
    '&hourly=' + (peak ? PEAK_HOURLY : BASE_HOURLY).join(',') +
    '&daily=wave_height_max&timezone=auto&forecast_days=7' +
    (models && models.length ? '&models=' + models.join(',') : '');
}

// Whether this deployment has established that the upstream knows the peak-period names.
// null = not yet asked, true = it answered, false = it rejected them and must not be asked again.
let peakSupported = null;
// The same tri-state for the named models, kept separate so one cannot answer for the other.
let modelsSupported = null;
export function _resetPeakSupport() { peakSupported = null; modelsSupported = null; } // tests only

// Asks for peak period, and copes with being wrong about it.
//
// The variable names could not be checked against the live API from here -- open-meteo.com is
// refused by this environment's egress -- and they are corroborated only by third-party
// documentation. That is the same position the confidence badge's model identifiers were in,
// and every one of those guesses turned out wrong. The difference is the blast radius: a bad
// model name there produced no badge, quietly, while a bad variable name in this list makes
// Open-Meteo reject the whole request and takes the entire forecast with it. So it is asked
// for, not assumed, and the first rejection settles it for the life of the process.
//
// Only a 400 counts as a rejection. A 429 must not trigger a retry: rate limiting is the
// failure this app has actually hit, and answering it by immediately spending a second request
// is how a rate limit becomes a longer rate limit.
export async function fetchMarine(lat, lon, fetchImpl = fetch) {
  // Peak is settled first and on its own, with no `models` in the request. Both probes read the
  // same 400, so asking both questions at once means a wrong model name is indistinguishable
  // from a wrong variable name -- and the app would answer by dropping peak period, degrading
  // the forecast for the life of the process to fix a problem peak period never had.
  if (peakSupported === null) {
    const res = await fetchImpl(marineUrl(lat, lon, { peak: true }));
    if (res.ok) { peakSupported = true; return res; }
    if (res.status !== 400) return res;
    peakSupported = false;
    return fetchImpl(marineUrl(lat, lon, { peak: false }));
  }

  // Peak is known, so a 400 from here can only be the model names, and the fallback costs the
  // finer grid alone. A 429 is not a rejection and must not spend a second request on itself:
  // answering a rate limit with more traffic is how this app has actually broken before.
  if (modelsSupported !== false) {
    const res = await fetchImpl(marineUrl(lat, lon, { peak: peakSupported, models: WAVE_MODELS }));
    if (res.ok) { modelsSupported = true; return res; }
    if (res.status !== 400) return res;
    modelsSupported = false;
  }
  return fetchImpl(marineUrl(lat, lon, { peak: peakSupported }));
}

// Collapse a multi-model response back to the plain keys the rest of the app reads.
//
// Asking for `&models=a,b` makes Open-Meteo answer with `wave_height_a` and `wave_height_b`
// rather than `wave_height`. Rather than teach twenty call sites in forecast.js about that,
// this puts the response back into the shape they already expect, choosing per value: the first
// model that has a number for that hour wins, which is the finer grid wherever it reaches and
// the global one everywhere else.
//
// A response with no suffixed keys -- the ordinary single-model answer, or a Worker old enough
// to predate this -- passes through untouched, so nothing depends on the models having been
// asked for or on the request having succeeded.
export function mergeWaveModels(marine, models = WAVE_MODELS) {
  const hourly = marine && marine.hourly;
  if (!hourly || typeof hourly !== 'object') return marine;

  const bases = new Map(); // base variable -> [series in model order]
  for (const key of Object.keys(hourly)) {
    for (let rank = 0; rank < models.length; rank++) {
      const suffix = '_' + models[rank];
      if (!key.endsWith(suffix) || !Array.isArray(hourly[key])) continue;
      const base = key.slice(0, -suffix.length);
      if (!base) continue;
      if (!bases.has(base)) bases.set(base, []);
      bases.get(base)[rank] = hourly[key];
      break;
    }
  }
  if (!bases.size) return marine;

  const merged = { ...hourly };
  // Which models actually contributed a wave height, so "did the finer grid answer here?" is a
  // fact the app can report rather than a thing nobody can tell. The confidence badge was wrong
  // for months precisely because nothing recorded this.
  const used = new Set();
  for (const [base, series] of bases) {
    const length = series.reduce((n, s) => (s ? Math.max(n, s.length) : n), 0);
    const out = new Array(length).fill(null);
    for (let i = 0; i < length; i++) {
      for (let rank = 0; rank < series.length; rank++) {
        const v = series[rank] && series[rank][i];
        if (v == null || !Number.isFinite(v)) continue;
        out[i] = v;
        if (base === 'wave_height') used.add(models[rank]);
        break;
      }
    }
    merged[base] = out;
    // The per-model series stay in place. They cost nothing to keep and the confidence badge
    // reads exactly this shape.
  }
  return { ...marine, hourly: merged, waveModelsUsed: [...used] };
}
