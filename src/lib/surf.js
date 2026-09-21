// Offshore significant wave height is not surf height, and the app was showing the first while
// calling it the second.
//
// Open-Meteo's wave_height is the significant wave height at a model grid point out at sea. The
// number a surfer means by "it's three foot", and the number Surfline and every other forecast
// publishes, is the height of the wave face where it breaks. Those differ by a factor that
// depends on period, which is exactly why the distinction matters here rather than being a
// units quibble: the same 1.5m offshore breaks noticeably bigger at 16 seconds than at 6, and
// the app could not express that in the height at all. It showed one number for both.
//
// Komar & Gaughan (1972) is the standard result, from Airy theory with conservation of energy
// flux, fitted to three laboratory datasets and one field dataset:
//
//     Hb = k * g^(1/5) * (T * H0^2)^(2/5),  k = 0.39
//
// applied here to Hs, which makes it the significant breaker height.
const K = 0.39;
const G = 9.81;
const M_PER_FT = 0.3048;

// Shoaling alone -- which is all the formula above describes -- overstates what actually
// arrives, because a real coast also spreads swell energy along itself by refraction. Surfline
// publish their own rule of thumb: face height is about 1.3x the deepwater swell height on a
// 12-16 second groundswell. Komar & Gaughan gives 1.63x there, and 0.8 is what reconciles the
// two. So this is not a free parameter picked to taste: it is the one number that makes the
// formula agree with the published behaviour of the thing it is modelling.
//
// It is a single global constant standing in for something genuinely per-spot -- a focusing
// reef and a straight beach do not share a refraction coefficient. The app already has the
// machinery to learn that difference per spot from buoy comparisons; this is the honest
// starting point for it, not the last word.
export const REFRACTION = 0.8;

// Breaking wave height, in feet, from offshore significant wave height in feet and peak period.
//
// Returns the input unchanged when there is no period to work from: no period means no
// transform is possible, and a wrong number is worse than an untransformed one.
export function breakingHeightFt(offshoreFt, periodS, { refraction = REFRACTION } = {}) {
  if (!(offshoreFt > 0)) return offshoreFt;
  if (!(periodS > 0)) return offshoreFt;
  const h0 = offshoreFt * M_PER_FT;
  const hb = K * Math.pow(G, 0.2) * Math.pow(periodS * h0 * h0, 0.4);
  return (hb / M_PER_FT) * refraction;
}

// The average of the highest tenth of the waves -- the sets.
//
// Significant wave height is already an average of the biggest third, so it is not the height of
// the waves anyone paddles for. On a Rayleigh distribution H(1/10) = 1.27 Hs (and the largest
// wave in a thousand is about 1.86 Hs). Surf observations are conventionally recorded as H(1/10)
// too, which is the same convention as the number on the front of this app's card.
export const SET_FACTOR = 1.27;
export function setWaveFt(significantFt) {
  return significantFt == null ? significantFt : significantFt * SET_FACTOR;
}

// The height range the card shows: significant to sets, in feet, at the precision the model
// actually has.
//
// Anchoring the range to the wave statistics -- ordinary wave at the low end, set at the high
// end -- is what a surf report's range has always meant, and that part was right. Rounding it
// here was not. Both ends were snapped to whole feet and then forced at least a foot apart,
// which on anything small stopped being a range and became a floor: every sea from dead flat
// up to about half a metre of breaking height came out as "1-2", and a metric reader saw
// "0.3-0.6" for all of it. Feet are much too coarse a lattice to quantise on and then convert
// away from -- a foot is 0.3m, so three display values spanned the entire knee-high-and-under
// band, which is most of what the Mediterranean does outside a winter storm. The app was
// reporting a third of a metre of surf on a flat day and could not express 0.2m at all.
//
// So no rounding happens here. It happens at the edge, where the unit is known: lib/format.js
// rounds to whole feet for an imperial reader (the surf convention) and to 0.1m for a metric
// one, and a range whose ends land on the same number prints as that number rather than as a
// manufactured spread. Two decimal places of a foot is 3mm, comfortably finer than either.
//
// Everything that reads the range back as a number -- alert thresholds, the chart bars, the
// buoy comparison -- gets the honest value now too, so an alert set at 2ft stops firing on a
// sea the old lattice had rounded up to it.
const round2 = (n) => Math.round(n * 100) / 100;

export function surfRange(significantFt) {
  if (!(significantFt > 0)) return '0-0';
  return round2(significantFt) + '-' + round2(setWaveFt(significantFt));
}
