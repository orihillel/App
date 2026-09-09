import { conditionsScore, scoreToRating } from './rating.js';

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

// Corrects a day's sampled hours from a settled calibration -- the part that was missing.
// applyCalibration existed and calibrationLabel said "runs 15% bigger than forecast here", and
// between them nothing actually made the wave height, the rating badge, or the best-window pick
// reflect it. A spot the app had already proven runs consistently big kept scoring itself
// against the uncorrected number everywhere except one footnote.
//
// Recomputes wave, score and rating from the calibrated height using the exact inputs
// fetchSpotForecast scored the hour with the first time -- the dominant swell train's period
// and direction, not the raw ones, which the score has always been built from (see the
// "against the *dominant* train" comment in forecast.js). Diverging from that here would swap
// one inconsistency (a corrected number next to an uncorrected rating) for a subtler one (a
// rating computed a different way than every other hour's).
//
// A ratio of 1 -- no calibration, or none ready -- must reproduce every field unchanged. That
// is the whole basis for trusting this instead of re-deriving the score independently: it is
// provably a no-op until there is real evidence of a bias, not a second scoring path that
// might quietly disagree with the first.
export function recalibrateHours(hours, cal, spot) {
  if (!Array.isArray(hours) || !cal || !cal.ready) return hours;
  return hours.map((h) => {
    if (h.waveFt == null) return h;
    const waveFt = applyCalibration(h.waveFt, cal);
    const dominant = (h.trains && h.trains[0]) || null;
    const scorePeriod = dominant && dominant.period != null ? dominant.period : h.period;
    const scoreSwellDeg = dominant && dominant.deg != null ? dominant.deg : h.swellDeg;
    const score = conditionsScore(
      waveFt, h.windMph, h.type, scorePeriod, scoreSwellDeg,
      spot && spot.offshoreDeg, h.tidePosition, spot,
    );
    const base = Math.max(1, Math.round(waveFt));
    return {
      ...h, waveFt, wave: Math.max(1, base - 1) + '-' + (base + 1), score, rating: scoreToRating(score),
      // The trains are on screen directly underneath the corrected height, so leaving them raw
      // showed the correction and contradicted it in the same breath: "4-6ft" over a
      // groundswell line still reading 5.2ft.
      //
      // Scaled by the same ratio, not re-derived. The bias was measured against the combined
      // height, which is the two trains added in quadrature -- scaling both by r scales that
      // combination by r as well, so the split stays consistent with the total it came from.
      // Uniform scaling also cannot reorder them, which matters because the score above is
      // built from whichever train is dominant.
      trains: Array.isArray(h.trains)
        ? h.trains.map((tr) => (tr.heightFt == null ? tr : { ...tr, heightFt: applyCalibration(tr.heightFt, cal) }))
        : h.trains,
    };
  });
}

// The week-ahead chart's points, calibrated the same way -- but score and rating are left
// alone rather than recomputed, because nothing reads the ones this function returns. The
// chart draws waveFt, tideFt and windSpd directly and the tapped-time line below it shows the
// same three; the one other reader of continuous[].rating, checkAlertMatch in lib/alerts.js,
// is handed the raw forecast rather than this.
//
// That last part is deliberate rather than an oversight to tidy up later. The alert matcher is
// shared with the Worker, which evaluates alerts on a schedule with the tab closed and has no
// access to the calibration samples -- those live in the browser. Calibrating the client's copy
// alone would mean the two disagreed about whether an alert fires, which is the one thing
// sharing that function exists to prevent. So alerts are matched on the raw forecast on both
// sides, and a spot with a settled correction has it applied everywhere it is displayed but not
// yet to the threshold an alert fires on.
//
// Every field this function does not touch is copied through unchanged rather than dropped.
export function recalibrateContinuous(continuous, cal) {
  if (!Array.isArray(continuous) || !cal || !cal.ready) return continuous;
  return continuous.map((p) => (p.waveFt == null ? p : { ...p, waveFt: applyCalibration(p.waveFt, cal) }));
}
