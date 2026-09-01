import { COLORS } from './colors.js';

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
export function conditionsScore(waveFt, windMph, type, period, swellDeg, offshoreDeg, tidePosition) {
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

  // Approximate "does the swell actually hit this spot" using the same offshore-direction
  // data collected when the spot was added — the ideal swell window is roughly opposite the
  // offshore wind direction. Coastlines aren't perfectly straight, so this is a rough proxy,
  // not a substitute for real per-spot swell-window data.
  if (swellDeg != null && offshoreDeg != null) {
    const idealSwellDeg = (offshoreDeg + 180) % 360;
    const off = angDiff(swellDeg, idealSwellDeg);
    if (off <= 35) score += 2;
    else if (off <= 70) score += 0;
    else score -= 2;
  }

  // Tide: with no per-spot "works best at X tide" data, the only generically defensible
  // signal is distance from today's own mid-tide — many breaks get too full/soft at peak
  // high and too shallow/exposed at peak low, while mid-tide is the safest broad guess.
  // Kept deliberately small (±1) since this is the least certain factor in the score.
  if (tidePosition != null) {
    const distFromMid = Math.abs(tidePosition - 0.5); // 0 = exactly mid, 0.5 = a dead extreme
    if (distFromMid <= 0.15) score += 1;
    else if (distFromMid >= 0.4) score -= 1;
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
