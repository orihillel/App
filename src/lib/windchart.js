import { angDiff, windAngleColor } from './rating.js';

// The week's wind as bars that point at what it does to the waves: above the line when it blows
// offshore, below when it blows onshore, taller the stronger it is.
//
// The week chart used to carry wind as a dotted speed line over the wave curve, with a small
// arrow at the start of each day. Speed alone is half the answer -- 15mph offshore grooms a
// face and 15mph onshore ruins it -- and the direction was only drawn once a day, while the
// sea breeze that decides most afternoons turns round inside one. Splitting the chart at a
// centre line puts both halves of the answer into one glance: a row of bars above the line is
// a clean week, a row below it is a blown-out one.
//
// Height is the full speed rather than only its offshore component. That component is zero for
// a wind blowing straight along the beach, and a 20mph cross-shore wind is not nothing: the
// bar keeps its full height and its colour (the same green-to-red angle scale as the arrows)
// says how straight on or off it is.

// Below this a wind barely touches the surface whatever its direction -- the same threshold
// the rating treats as glassy (see scoreBreakdown in lib/rating.js).
export const GLASSY_MPH = 3;

// The smallest top of the scale. Without a floor a calm week would scale 4mph to full height
// and look like a gale.
export const MIN_SCALE_MPH = 15;

// Which side of the line: true when the wind is blowing off the land (within 90 degrees of the
// spot's offshore direction), false when it is blowing in off the sea. Dead cross-shore counts
// as offshore -- it is not blowing in -- and its colour is what says it is cross.
export function isOffshoreSide(windDeg, offshoreDeg) {
  return angDiff(windDeg, offshoreDeg) <= 90;
}

// One bar per reading, laid out on the same x positions the week chart's line uses (see
// linePath in lib/format.js), so a bar sits directly under the wave height it goes with.
//
// Readings with no wind are kept as gaps (null) rather than dropped, so the positions of the
// rest do not shift.
export function windBars(points, offshoreDeg, { width = 300, height = 64, pad = 10 } = {}) {
  if (!Array.isArray(points) || !points.length || !Number.isFinite(offshoreDeg)) return null;
  const speeds = points.map((p) => (p && Number.isFinite(p.windSpd) ? p.windSpd : null));
  const top = Math.max(MIN_SCALE_MPH, ...speeds.filter((s) => s != null));
  const mid = height / 2;
  const half = mid - 2; // a little room at the edges
  const n = points.length;
  const step = n > 1 ? (width - pad * 2) / (n - 1) : 0;
  const barW = Math.max(1, Math.min(6, step * 0.7));
  const bars = points.map((p, i) => {
    const spd = speeds[i];
    if (spd == null || !Number.isFinite(p.windDeg)) return null;
    const x = n > 1 ? pad + i * step : width / 2;
    const offshore = isOffshoreSide(p.windDeg, offshoreDeg);
    const h = Math.max(1, (spd / top) * half);
    return {
      x, barW,
      y: offshore ? mid - h : mid,
      h,
      offshore,
      glassy: spd < GLASSY_MPH,
      color: windAngleColor(p.windDeg, offshoreDeg),
    };
  });
  return { bars, mid, top, width, height };
}
