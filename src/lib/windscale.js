// The colour ramp for the globe's wind overlay.
//
// A deliberate counterpart to wavescale.js rather than a copy of it. The swell ramp is the one
// every wave map uses — indigo through blue, teal, green, yellow, orange, red — and reusing it
// here would make two different quantities look like the same quantity on the same globe. So
// this one runs the other way round the wheel: still calm to alarming, but through violet and
// magenta, so a glance tells you which layer you are reading before you find the legend.
//
// The stops are placed on what wind does to surf, which is not the same as what wind does to a
// weather map. Under about 8km/h the sea is glass and it barely matters which way it blows; by
// 25km/h direction is the whole story and an onshore has already ruined it; past 45km/h almost
// nothing is rideable whatever the swell is doing. So the ramp's fastest colour change sits
// where a surfer's decision actually changes, not spread evenly across a range that runs to
// hurricane force.
//
// Like the wave ramp, this is not the spot-rating scale. Bright here means strong, not bad: a
// strong offshore is the best wind there is, and whether a given wind helps or wrecks a spot is
// a judgement the app makes per spot from that spot's own orientation.

// The age of a grid is the age of a grid: imported rather than rewritten, so "2h ago" cannot
// start meaning two different things on two legends of the same globe.
import { gridAgeLabel } from './wavescale.js';

export { gridAgeLabel };

// Stops in km/h, which is what the grid stores and what Open-Meteo returns natively.
const STOPS = [
  [0, [24, 28, 58]],
  [8, [58, 52, 128]],
  [16, [104, 72, 168]],
  [25, [152, 88, 184]],
  [35, [206, 100, 170]],
  [45, [236, 122, 132]],
  // The top stays saturated violet rather than fading to white, which is where a ramp usually
  // ends. The swell ramp already ends pale pink, and at the top of both scales the two were
  // close enough to be confusable — a storm sea and a storm wind painted nearly the same
  // colour, at exactly the moment someone is looking hardest at which is which.
  [60, [232, 130, 220]],
  [90, [214, 180, 255]],
];

export const WIND_SCALE_MAX = STOPS[STOPS.length - 1][0];

export function windColor(kph) {
  if (kph == null || !Number.isFinite(kph) || kph < 0) return null;
  if (kph <= STOPS[0][0]) return STOPS[0][1].slice();
  const last = STOPS[STOPS.length - 1];
  if (kph >= last[0]) return last[1].slice();
  for (let i = 1; i < STOPS.length; i++) {
    const [hi, cHi] = STOPS[i];
    if (kph > hi) continue;
    const [lo, cLo] = STOPS[i - 1];
    const t = (kph - lo) / (hi - lo);
    return [
      Math.round(cLo[0] + (cHi[0] - cLo[0]) * t),
      Math.round(cLo[1] + (cHi[1] - cLo[1]) * t),
      Math.round(cLo[2] + (cHi[2] - cLo[2]) * t),
    ];
  }
  return last[1].slice();
}

// Legend ticks in the units on screen: round kph for metric, round mph for imperial. Round
// numbers in the reader's own units rather than a conversion showing its working — "31mph" on
// a legend is arithmetic, not a label.
export function windScaleTicks(units) {
  if (units === 'imperial') {
    return [0, 5, 10, 20, 30, 40, 55].map((mph) => ({ kph: mph * 1.60934, label: String(mph) }));
  }
  return [0, 10, 20, 30, 50, 70, 90].map((kph) => ({ kph, label: String(kph) }));
}

export function windScaleUnitLabel(units) {
  return units === 'imperial' ? 'mph' : 'kph';
}

// One definition for the bar and the globe, so the legend cannot drift from what is painted.
export function windScaleGradient() {
  const parts = STOPS.map(([kph, c]) => {
    const pct = ((kph / WIND_SCALE_MAX) * 100).toFixed(1);
    return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ') ' + pct + '%';
  });
  return 'linear-gradient(90deg, ' + parts.join(', ') + ')';
}

// Where a wind drawn on the globe is blowing.
//
// Open-Meteo reports `wind_direction_10m` the way every weather source does: the bearing the
// wind comes *from*. A westerly blows from the west, towards the east. An arrow on a map reads
// as travel though, exactly as it does for the swell arrows next door, so both layers draw the
// direction of travel and both say so in the legend — one convention on one globe, rather than
// two that a reader has to tell apart by which button is lit.
export function windTravelBearing(fromDeg) {
  if (fromDeg == null || !Number.isFinite(fromDeg)) return null;
  return ((fromDeg % 360) + 540) % 360;
}

// The line under the wind legend. Same shape as the swell one, so the two read as one system.
export function windLegendCaption(meta, units, now = Date.now()) {
  const parts = ['Open-ocean wind speed (' + windScaleUnitLabel(units) + ')'];
  // While the week is animating the map is not "now" and must not say it is. The frame's own
  // time replaces the grid's age, because how old the build is stops being the interesting
  // fact once the picture on screen is four days ahead of it.
  if (meta && meta.frameLabel) parts.push(meta.frameLabel);
  else parts.push(gridAgeLabel(meta && meta.generatedAt, now) || 'age unknown');
  if (meta && meta.stale) parts.push('last good data');
  if (meta && meta.coarse) parts.push('coarse edge — coastline unavailable');
  if (meta && meta.arrows) parts.push('arrows show where the wind is blowing');
  else if (meta && meta.noDirections) parts.push('no wind directions in this grid yet');
  return parts.join(' · ');
}
