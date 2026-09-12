import { COLORS } from './colors.js';
import { swellWindowFor, swellExposure, tideFit } from './spotmodel.js';
import { sizeFit, weightsFor, bandFor } from './surfer.js';

export const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export function degToCompass(deg) {
  const idx = Math.round((((deg % 360) + 360) % 360) / 22.5) % 16;
  return COMPASS[idx];
}
export function angDiff(a, b) { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }
export function windType(windDeg, offshoreDeg) {
  const diff = angDiff(windDeg, offshoreDeg);
  if (diff <= 50) return 'offshore';
  if (diff >= 130) return 'onshore';
  return 'cross';
}
// Same offshore/onshore angle used for the rating, but as a smooth green→yellow→red
// gradient instead of three buckets, for the wind-direction arrows on the week chart.
export function windAngleColor(windDeg, offshoreDeg) {
  const diff = angDiff(windDeg, offshoreDeg); // 0 = straight offshore, 180 = straight onshore
  const hue = 120 - (diff / 180) * 120; // 120° green -> 0° red
  return 'hsl(' + Math.round(hue) + ', 72%, 50%)';
}
// Scored rather than a simple nested if/else, so wind direction, wind speed, wave size,
// swell period, and swell/shore alignment all pull the rating up or down together instead
// of one factor (wind direction) overriding everything else. Split into a raw numeric score
// plus a bucketing step so the globe can use the continuous score for a color gradient while
// everything else keeps using the FIRING/GOOD/FAIR/POOR label.
// The score FIRING starts at. The *size* it starts at is no longer a constant: it is the bottom
// of the reader's own ideal band (see lib/surfer.js), because "too small to be firing" is a fact
// about the surfer and their board, not about the ocean. For the default shortboard/intermediate
// profile that bottom is 3ft, which is exactly the constant this replaced.
export const FIRING_SCORE = 6;

// The same factors as before, but each one now reported as well as summed, so the app can say
// *why* a rating is what it is instead of only what it is. `conditionsScore` keeps returning a
// bare number for every existing caller; `scoreBreakdown` is the same arithmetic with its
// working shown.
export function scoreBreakdown(waveFt, windMph, type, period, swellDeg, offshoreDeg, tidePosition, spot, profile) {
  const { periodWeight, windWeight } = weightsFor(profile);
  const terms = [];
  const add = (key, points, text) => { if (points !== 0) terms.push({ key, points, text }); };

  let windPoints;
  let windText;
  if (windMph < 3) {
    windPoints = 3; windText = 'glassy'; // direction barely matters at this speed
  } else if (type === 'offshore') {
    if (windMph <= 10) { windPoints = 3; windText = 'light offshore'; }
    else if (windMph <= 18) { windPoints = 1; windText = 'strong offshore'; } // holds you back
    else { windPoints = -1; windText = 'gale-force offshore'; } // its own chop, hard to get out
  } else if (type === 'cross') {
    if (windMph <= 8) { windPoints = 1; windText = 'light cross-shore'; }
    else if (windMph <= 15) { windPoints = 0; windText = 'cross-shore'; }
    else { windPoints = -2; windText = 'strong cross-shore'; }
  } else {
    if (windMph <= 6) { windPoints = 1; windText = 'light onshore'; } // barely textured
    else if (windMph <= 12) { windPoints = -1; windText = 'onshore'; }
    else { windPoints = -3; windText = 'strong onshore'; }
  }
  // Scaled only where it hurts. A SUP minds an onshore far more than a bodyboard does, but
  // nobody gets *extra* credit for glass because of what they ride.
  add('wind', windPoints < 0 ? windPoints * windWeight : windPoints, windText);

  // Size, against the band this board and skill actually want — see lib/surfer.js. This used to
  // be an unconditional "bigger is better", which is only true for one kind of surfer.
  add('size', sizeFit(waveFt, profile), sizeText(waveFt, profile));

  if (period != null) {
    let p = 0, text = null;
    if (period >= 12) { p = 2; text = period + 's groundswell'; } // powerful, well-groomed
    else if (period >= 9) { p = 1; text = period + 's swell'; }
    else if (period < 7) { p = -1; text = period + 's wind swell'; } // weak, choppy
    add('period', p * periodWeight, text);
  }

  // Does the swell actually reach this spot? See lib/spotmodel.js — this used to assume the
  // ideal direction was exactly opposite the offshore wind, which is only true of a straight
  // beach break and penalised the angled swells that make points and reefs work at all.
  if (swellDeg != null && (spot || offshoreDeg != null)) {
    const window = swellWindowFor(spot || { offshoreDeg });
    const exposure = swellExposure(swellDeg, window);
    add('swellwindow', 2 * exposure,
      exposure >= 0.75 ? 'swell straight into the bank'
        : exposure >= 0.35 ? 'swell partly in the window'
          : 'swell off the window');
  }

  // Tide. Spots that carry a `bestTide` are scored against the tide they actually want;
  // everything else falls back to "mid is the safest guess", at half weight because it is a
  // guess. Kept small (±1) either way — it is still the least certain factor in the score.
  if (tidePosition != null) {
    const t = tideFit(spot && spot.bestTide, tidePosition);
    add('tide', t, t > 0 ? 'tide suits it' : 'tide is wrong for it');
  }

  let score = 0;
  for (const t of terms) score += t.points;

  // FIRING has to mean something. Offshore wind alone is worth +3 and being in the swell window
  // another +2, so on a coast where the mornings are usually offshore — the Israeli
  // Mediterranean, say — almost any clean day cleared the FIRING threshold and the badge stopped
  // discriminating: measured at Tel Aviv, a 2.5ft 7s morning and a 6ft storm both read FIRING.
  // Small surf can be excellent, and still is: it keeps every point it earned, and GOOD is the
  // honest ceiling for it. This only ever caps, so nothing that was rated lower moves up.
  const capped = waveFt != null && waveFt < bandFor(profile).lo;
  if (capped) score = Math.min(score, FIRING_SCORE - 0.5);

  return { score, terms, capped };
}

function sizeText(waveFt, profile) {
  if (waveFt == null) return null;
  const { lo, hi } = bandFor(profile);
  if (waveFt < lo) return 'under size for your board';
  if (waveFt > hi) return 'bigger than your board wants';
  return 'right in your size range';
}

export function conditionsScore(waveFt, windMph, type, period, swellDeg, offshoreDeg, tidePosition, spot, profile) {
  return scoreBreakdown(waveFt, windMph, type, period, swellDeg, offshoreDeg, tidePosition, spot, profile).score;
}
export function scoreToRating(score) {
  if (score >= FIRING_SCORE) return 'FIRING';
  if (score >= 3) return 'GOOD';
  if (score >= 0) return 'FAIR';
  return 'POOR';
}
export function rateConditions(waveFt, windMph, type, period, swellDeg, offshoreDeg) {
  return scoreToRating(conditionsScore(waveFt, windMph, type, period, swellDeg, offshoreDeg));
}
// Continuous POOR→FIRING gradient (red→green) for the globe markers, built from the same
// raw score the rating badges bucket into four labels. Guarded against NaN/undefined: an
// invalid hsl() string (e.g. "hsl(NaN, ...)") fails Three.js's color parser silently, which
// would leave a marker stuck on whatever color it had before — this makes sure that can't happen.
export function scoreToColor(score) {
  const s = Number.isFinite(score) ? score : 0;
  const t = Math.max(0, Math.min(1, (s + 5) / 15)); // score roughly spans -5..10
  const hue = t * 140; // 0° red -> 140° green
  return 'hsl(' + Math.round(hue) + ', 68%, 50%)';
}

export function ratingBg(r) {
  if (r === 'FIRING') return COLORS.tealBright;
  if (r === 'GOOD') return COLORS.teal;
  if (r === 'FAIR') return COLORS.gold;
  if (r === 'LOADING') return '#33465C';
  return COLORS.poor;
}
export function ratingText(r) {
  if (r === 'POOR') return COLORS.foam;
  if (r === 'LOADING') return COLORS.foamDim;
  return COLORS.navy;
}
export function windColor(type) {
  if (type === 'offshore') return COLORS.tealBright;
  if (type === 'onshore') return COLORS.coral;
  return COLORS.gold;
}
