import { COLORS } from './colors.js';
import { swellWindowFor, swellExposure, tideFit } from './spotmodel.js';

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
export function conditionsScore(waveFt, windMph, type, period, swellDeg, offshoreDeg, tidePosition, spot) {
  let score = 0;

  if (windMph < 3) {
    score += 3; // glassy — direction barely matters at this speed
  } else if (type === 'offshore') {
    if (windMph <= 10) score += 3;
    else if (windMph <= 18) score += 1; // still offshore, but strong enough to hold you back
    else score -= 1; // gale-force offshore creates its own chop and makes paddling out hard
  } else if (type === 'cross') {
    if (windMph <= 8) score += 1;
    else if (windMph <= 15) score += 0;
    else score -= 2;
  } else {
    if (windMph <= 6) score += 1; // light onshore, barely textured
    else if (windMph <= 12) score -= 1;
    else score -= 3;
  }

  if (waveFt >= 4) score += 2;
  else if (waveFt >= 2.5) score += 1;

  if (period != null) {
    if (period >= 12) score += 2; // long-period groundswell — powerful, well-groomed
    else if (period >= 9) score += 1;
    else if (period < 7) score -= 1; // short-period wind swell — weak, choppy
  }

  // Does the swell actually reach this spot? See lib/spotmodel.js — this used to assume the
  // ideal direction was exactly opposite the offshore wind, which is only true of a straight
  // beach break and penalised the angled swells that make points and reefs work at all.
  if (swellDeg != null && (spot || offshoreDeg != null)) {
    const window = swellWindowFor(spot || { offshoreDeg });
    score += 2 * swellExposure(swellDeg, window);
  }

  // Tide. Spots that carry a `bestTide` are scored against the tide they actually want;
  // everything else falls back to "mid is the safest guess", at half weight because it is a
  // guess. Kept small (±1) either way — it is still the least certain factor in the score.
  if (tidePosition != null) {
    score += tideFit(spot && spot.bestTide, tidePosition);
  }

  return score;
}
export function scoreToRating(score) {
  if (score >= 6) return 'FIRING';
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
