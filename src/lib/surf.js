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

// The height range the card shows: significant to sets.
//
// This used to be the rounded height plus and minus a foot, which is a band of constant width
// wherever it sits -- "1-3" for two-foot surf and "9-11" for ten-foot, when the real spread
// between an average wave and a set grows with the swell. Anchoring it to the wave statistics
// makes the low end the ordinary wave and the high end the set, which is what a surf report's
// range has always meant.
export function surfRange(significantFt) {
  if (!(significantFt > 0)) return '0-1';
  const low = Math.max(1, Math.round(significantFt));
  const high = Math.max(low + 1, Math.round(setWaveFt(significantFt)));
  return low + '-' + high;
}
