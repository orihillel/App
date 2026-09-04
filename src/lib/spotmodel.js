import { angDiff } from './rating.js';

// How exposed a spot is to swell from a given direction, and which tide suits it.
//
// The old rule was a single line: the ideal swell direction is `offshoreDeg + 180`, and swell
// more than 70° off that scored -2. That assumes swell arrives perpendicular to the beach —
// true of a straight beach break, and wrong about exactly the waves worth travelling for.
// What makes a point or a reef peel is swell arriving at a sharp angle to the shore normal.
//
// Jeffreys Bay is the clearest case in our own catalog. It carries `offshoreDeg: 325`, so the
// old rule expected swell from 145°. J-Bay's actual window is south-west, around 200–230°:
// 55–85° away, so a classic J-Bay swell was scored 0 or −2. The app marked the best day of the
// year as worse than average.
//
// Two changes fix that:
//
//  1. The generic fallback is now physical rather than a guess. A coastline blocks swell from
//     behind it, so the exposed arc is roughly the shore normal ±90°, and anything inside that
//     arc reaches the spot. Direction within the arc is a matter of degree, not a cliff edge.
//  2. Spots whose window is actually known carry it explicitly as `swellWindow: [from, to]`,
//     which overrides the fallback.

// Compass arcs run clockwise from `from` to `to`, so [200, 250] and [340, 30] are both valid.
export function inArc(deg, from, to) {
  if (deg == null) return false;
  const d = ((deg % 360) + 360) % 360;
  const a = ((from % 360) + 360) % 360;
  const b = ((to % 360) + 360) % 360;
  return a <= b ? d >= a && d <= b : d >= a || d <= b;
}

export function arcCentre(from, to) {
  const a = ((from % 360) + 360) % 360;
  const b = ((to % 360) + 360) % 360;
  const span = a <= b ? b - a : 360 - a + b;
  return (a + span / 2) % 360;
}

// The arc a spot can physically receive swell from.
export function swellWindowFor(spot) {
  if (spot && Array.isArray(spot.swellWindow) && spot.swellWindow.length === 2) {
    const [from, to] = spot.swellWindow;
    return { from, to, ideal: arcCentre(from, to), explicit: true };
  }
  if (!spot || spot.offshoreDeg == null) return null;
  // Offshore wind blows from land out to sea, so the direction the shore faces — and the
  // direction swell arrives from — is the opposite. The exposed arc is that ±90°: beyond a
  // right angle the land itself is in the way.
  const normal = (spot.offshoreDeg + 180) % 360;
  return { from: (normal - 90 + 360) % 360, to: (normal + 90) % 360, ideal: normal, explicit: false };
}

// −1 (blocked by land) through 1 (straight into the window).
//
// Inside an explicit window every direction scores well, because a window someone actually
// recorded already means "this works here" — there is no reason to keep penalising the edges of
// a range that was chosen deliberately. The derived window is softer and tapers, since it is
// inferred rather than known.
export function swellExposure(swellDeg, window) {
  if (swellDeg == null || !window) return 0;
  const offIdeal = angDiff(swellDeg, window.ideal);
  if (window.explicit) {
    if (inArc(swellDeg, window.from, window.to)) return 1;
    // Just outside a known window still gets some swell in — refraction is not a hard edge.
    return offIdeal <= 110 ? -0.3 : -1;
  }
  if (offIdeal >= 90) return -1;      // behind the land
  if (offIdeal <= 45) return 1;       // straight in
  return 1 - (offIdeal - 45) / 45;    // tapering across the rest of the arc
}

// Which tide a break wants. 'all' means it is not fussy, which is the honest answer for most
// beach breaks and the safest default when nobody has recorded one.
export function tideFit(bestTide, tidePosition) {
  if (tidePosition == null) return 0;
  switch (bestTide) {
    case 'low': return 1 - tidePosition * 2;          // 1 at dead low, −1 at dead high
    case 'high': return tidePosition * 2 - 1;
    case 'mid': return 1 - Math.abs(tidePosition - 0.5) * 4; // 1 at mid, −1 at either extreme
    case 'all': return 0;
    default:
      // No per-spot data: many breaks get too full at peak high and too shallow at peak low,
      // so mid is the safest broad guess — but held to half weight, since it is a guess.
      return (1 - Math.abs(tidePosition - 0.5) * 4) * 0.5;
  }
}
