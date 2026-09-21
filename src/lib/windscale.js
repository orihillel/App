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
//
// The stop *values* are unchanged and deliberately so: five of the ten sit between 5 and
// 30kph, the band that decides whether a morning is glassy or blown out, and measuring the
// alternatives confirmed that front-loading was already right. Every transfer function tried
// on top of it -- square root, Beaufort's own two-thirds power law, clipping -- made the worst
// case worse. That work was done and it worked; this change does not touch it.
//
// The *colours* are new, and the reason is a constraint that turned out not to exist.
//
// This ramp used to be confined to a single violet hue family so it could never be mistaken
// for the swell ramp on the same globe. That confinement cost it two thirds of its perceptual
// range: 119 against the swell ramp's 345, because lightness was doing nearly all the work and
// lightness alone is close to its sRGB ceiling. But the two layers cannot be on screen at the
// same time -- Globe.jsx holds one `layer` state with two values, and switching even drops the
// animated week so one layer's frames cannot appear under the other's legend. The task the
// constraint was protecting is knowing *which* layer you are looking at, not telling a wind
// colour from a wave colour side by side; and that is already carried by the lit button, the
// legend caption and the arrow field. It was being paid for twice, and the second payment was
// two thirds of this ramp.
//
// So the sweep is now purple through magenta to warm, with no teal and no green anywhere. It
// still reads as a different instrument from the swell ramp -- which is all identification
// needs -- without buying that at the price of contrast. Lightness climbs the whole way, as it
// always did here.
//
// Measured, composited at 0.85 over the ocean, one 5kph step across 5-35kph: worst case 8.3 ->
// 11.5, median 8.9 -> 16.5, total arc 119 -> 187. It also holds up better outdoors, where this
// layer needs it most: under 10,000 lux the worst step goes 5.8 -> 7.8.
const STOPS = [
  [0, [23, 0, 56]],
  [5, [55, 1, 81]],
  [10, [92, 3, 99]],
  [15, [133, 6, 107]],
  [20, [177, 12, 105]],
  [25, [222, 18, 91]],
  [30, [252, 58, 64]],
  [40, [253, 126, 80]],
  [55, [253, 172, 103]],
  [90, [254, 229, 177]],
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

// The same ramp in discrete bands. Sibling of waveColorBanded -- see wavescale.js for why the
// globe bands at all, and why each band takes its midpoint colour rather than its lower edge.
//
// Nine bands here, five of them between 5 and 30kph. Worst adjacent pair 11.8 dE, against a
// small-patch threshold of five to seven, so every band edge is a line rather than a hint.
export const WIND_BAND_EDGES = STOPS.map(([k]) => k);

export function windColorBanded(kph) {
  if (kph == null || !Number.isFinite(kph) || kph < 0) return null;
  const last = STOPS.length - 1;
  if (kph >= STOPS[last][0]) return windColor(STOPS[last][0]);
  for (let i = 1; i <= last; i++) {
    if (kph >= STOPS[i][0]) continue;
    return windColor((STOPS[i - 1][0] + STOPS[i][0]) / 2);
  }
  return windColor(STOPS[last][0]);
}

export function windScaleBandGradient() {
  const last = STOPS.length - 1;
  const parts = [];
  for (let i = 0; i < last; i++) {
    const c = windColor((STOPS[i][0] + STOPS[i + 1][0]) / 2);
    const rgb = 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
    parts.push(rgb + ' ' + ((i / last) * 100).toFixed(1) + '%');
    parts.push(rgb + ' ' + (((i + 1) / last) * 100).toFixed(1) + '%');
  }
  return 'linear-gradient(90deg, ' + parts.join(', ') + ')';
}

// Where a speed sits along the colour sequence, 0 to 1. The stops are front-loaded, so this is
// not the same as the speed's fraction of the maximum -- see waveRampPosition in wavescale.js
// for why the legend bar is painted evenly and the ticks carry the real numbers.
export function windRampPosition(kph) {
  const last = STOPS.length - 1;
  if (!(kph > STOPS[0][0])) return 0;
  if (kph >= STOPS[last][0]) return 1;
  for (let i = 1; i <= last; i++) {
    const hi = STOPS[i][0];
    if (kph > hi) continue;
    const lo = STOPS[i - 1][0];
    return (i - 1 + (kph - lo) / (hi - lo)) / last;
  }
  return 1;
}

// Legend ticks in the units on screen, each with its position along the bar: round kph for
// metric, round mph for imperial. Round numbers in the reader's own units rather than a
// conversion showing its working -- "31mph" on a legend is arithmetic, not a label.
export function windScaleTicks(units) {
  const vals = units === 'imperial'
    ? [0, 5, 10, 15, 20, 30, 45].map((mph) => ({ kph: mph * 1.60934, label: String(mph) }))
    : [0, 10, 20, 30, 50, 70, 90].map((kph) => ({ kph, label: String(kph) }));
  return vals.map((t) => ({ ...t, pos: windRampPosition(t.kph) }));
}

export function windScaleUnitLabel(units) {
  return units === 'imperial' ? 'mph' : 'kph';
}

// One definition for the bar and the globe, so the legend cannot drift from what is painted.
// Stops sit at even percentages; windScaleTicks says where the numbers land on them.
export function windScaleGradient() {
  const last = STOPS.length - 1;
  const parts = STOPS.map(([, c], i) => {
    const pct = ((i / last) * 100).toFixed(1);
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
