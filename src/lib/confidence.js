// How much to trust the forecast, from how much the models agree with each other.
//
// Every number in this app comes from a model, and a model is a guess with a confidence
// interval that nobody was showing. Two days out, the major global models usually agree within
// a few inches and the forecast is worth planning around; seven days out they can disagree by
// a factor of two, and presenting that as a single confident number is misleading in exactly
// the situation where the user most needs to know to wait.
//
// Windguru's whole appeal is putting several models side by side and letting you see the
// spread. This is the same idea reduced to one honest signal, because Open-Meteo will serve
// any of its models on request (`&models=`) and the disagreement between two independent ones
// is a usable proxy for how settled the forecast is.

// Two genuinely independent global models: the ECMWF and NOAA's GFS. Agreement between two
// different centres' physics means something; two runs of the same model would not.
export const CONFIDENCE_MODELS = ['ecmwf_ifs025', 'gfs_seamless'];

// Spread is measured relative to the wave height itself, because half a foot of disagreement
// means something very different on a 1ft day than on a 10ft one.
export function relativeSpread(a, b) {
  if (a == null || b == null) return null;
  const mean = (a + b) / 2;
  if (!(mean > 0.01)) return 0; // both flat: no disagreement worth reporting
  return Math.abs(a - b) / mean;
}

// Thresholds are deliberately generous. The point is to flag the days where the models have
// genuinely diverged, not to put a caveat on every forecast — a badge that is always showing
// gets ignored, which would defeat the purpose.
export function confidenceFromSpread(spread) {
  if (spread == null) return null;
  if (spread <= 0.2) return 'high';   // within 20%: the models broadly agree
  if (spread <= 0.45) return 'medium';
  return 'low';                       // they disagree by nearly half: treat as a maybe
}

// One label for a run of hours, taken from the *worst* agreement in it rather than the average.
// A day the models disagree about for part of the time is a day to be cautious about, and
// averaging would hide exactly the divergence this exists to surface.
export function confidenceForSeries(seriesA, seriesB) {
  if (!Array.isArray(seriesA) || !Array.isArray(seriesB)) return null;
  const n = Math.min(seriesA.length, seriesB.length);
  if (n === 0) return null;
  let worst = null;
  for (let i = 0; i < n; i++) {
    const spread = relativeSpread(seriesA[i], seriesB[i]);
    if (spread == null) continue;
    if (worst == null || spread > worst) worst = spread;
  }
  return confidenceFromSpread(worst);
}

export function confidenceLabel(level) {
  switch (level) {
    case 'high': return 'Models agree';
    case 'medium': return 'Models differ somewhat';
    case 'low': return 'Models disagree — treat as a maybe';
    default: return null;
  }
}
