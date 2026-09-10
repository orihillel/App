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

export function marineUrl(lat, lon, { peak = true } = {}) {
  return 'https://marine-api.open-meteo.com/v1/marine?latitude=' + lat + '&longitude=' + lon +
    '&hourly=' + (peak ? PEAK_HOURLY : BASE_HOURLY).join(',') +
    '&daily=wave_height_max&timezone=auto&forecast_days=7';
}

// Whether this deployment has established that the upstream knows the peak-period names.
// null = not yet asked, true = it answered, false = it rejected them and must not be asked again.
let peakSupported = null;
export function _resetPeakSupport() { peakSupported = null; } // tests only

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
  if (peakSupported !== false) {
    const res = await fetchImpl(marineUrl(lat, lon, { peak: true }));
    if (res.ok) { peakSupported = true; return res; }
    if (res.status !== 400) return res;
    peakSupported = false;
  }
  return fetchImpl(marineUrl(lat, lon, { peak: false }));
}
