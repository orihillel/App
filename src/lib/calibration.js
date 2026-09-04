// Correcting the forecast at a spot from what the buoy actually measured there.
//
// A forecast cannot be made exact. Every number in this app is the output of a numerical model
// solving fluid dynamics on a grid a few kilometres wide, initialised from incomplete
// observations, run out days ahead. It has irreducible uncertainty, which is why the app shows
// model disagreement (lib/confidence.js) rather than pretending otherwise.
//
// What *can* be fixed is the part of the error that is consistent. Models have persistent local
// biases: a grid cell sitting in deep water offshore of a spot that sits behind a headland will
// read high there every single time, and a spot that focuses swell over a reef will read low.
// That bias is systematic, not random, so it can be measured and subtracted — which is most of
// what a human forecaster does when they say "the model always overcalls this beach".
//
// Every ingredient was already here: the forecast for right now, and a buoy measuring right now.
// Pairing them over time gives the bias.

// Samples older than this stop being representative — sandbars move, and a bias learned last
// winter is not evidence about this one.
export const MAX_SAMPLE_AGE_MS = 120 * 24 * 60 * 60 * 1000; // ~4 months
export const MAX_SAMPLES = 60;

// Below this there is not enough evidence to distinguish a bias from noise, and correcting on
// three data points would be worse than not correcting at all.
export const MIN_SAMPLES = 8;

// A correction bigger than this says something is wrong with the pairing — the wrong buoy, a
// spot that does not track it at all — rather than a bias worth applying. Refuse instead of
// confidently reporting a number built on a bad assumption.
export const MAX_TRUSTED_RATIO = 2.5;

export function addSample(samples, { forecastFt, observedFt, at = Date.now() }) {
  const list = Array.isArray(samples) ? samples : [];
  if (!(forecastFt > 0) || !(observedFt > 0)) return list;
  // One sample per hour at most: the buoy only updates every 30-60 minutes, and stacking
  // repeats of the same reading would weight one moment as though it were many.
  const hour = Math.floor(at / (60 * 60 * 1000));
  if (list.some((s) => Math.floor(s.at / (60 * 60 * 1000)) === hour)) return list;
  return [{ f: round2(forecastFt), o: round2(observedFt), at }, ...list].slice(0, MAX_SAMPLES);
}

function round2(n) { return Math.round(n * 100) / 100; }

export function freshSamples(samples, now = Date.now()) {
  return (Array.isArray(samples) ? samples : [])
    .filter((s) => s && s.at && now - s.at <= MAX_SAMPLE_AGE_MS && s.f > 0 && s.o > 0);
}

// The bias as a multiplier: >1 means the spot runs bigger than forecast, <1 smaller.
//
// The ratio is taken per sample and then averaged, rather than averaging the two heights and
// dividing. Otherwise a handful of big days would dominate the answer, and the correction would
// be tuned to the rarest conditions instead of the ordinary ones.
export function calibration(samples, now = Date.now()) {
  const usable = freshSamples(samples, now);
  if (usable.length < MIN_SAMPLES) {
    return { ready: false, samples: usable.length, needed: MIN_SAMPLES, ratio: 1 };
  }
  const ratios = usable.map((s) => s.o / s.f).sort((a, b) => a - b);
  // Median, not mean: one buoy dropout or one freak reading should not move the correction.
  const mid = Math.floor(ratios.length / 2);
  const ratio = ratios.length % 2 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2;
  if (!(ratio > 0) || ratio > MAX_TRUSTED_RATIO || ratio < 1 / MAX_TRUSTED_RATIO) {
    return { ready: false, samples: usable.length, needed: MIN_SAMPLES, ratio: 1, rejected: true };
  }
  return {
    ready: true,
    samples: usable.length,
    ratio: round2(ratio),
    // How far off the raw forecast has been running, as a percentage, for display.
    percent: Math.round((ratio - 1) * 100),
  };
}

export function applyCalibration(waveFt, cal) {
  if (waveFt == null || !cal || !cal.ready) return waveFt;
  return waveFt * cal.ratio;
}

// "Runs 15% bigger than forecast here" — worth saying only once it is both settled and large
// enough to matter. A 4% correction is inside the noise of reading a wave height anyway.
export function calibrationLabel(cal) {
  if (!cal || !cal.ready || Math.abs(cal.percent) < 8) return null;
  const dir = cal.percent > 0 ? 'bigger' : 'smaller';
  return 'Runs ' + Math.abs(cal.percent) + '% ' + dir + ' than forecast here (' + cal.samples + ' checks)';
}
