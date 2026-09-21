// The colour ramp for the globe's live wave overlay.
//
// Deliberately the ramp every other wave map uses — indigo through blue, teal, green, yellow,
// orange, red — rather than something matched to this app's own palette. People arrive here
// having already read a swell map somewhere, and a familiar ramp is legible on sight in a way
// a house-styled one is not.
//
// It is *not* the spot-rating scale (POOR red -> FIRING teal), and must not be read as one: red
// here means big, not bad. Eight metres is a fine day for one person and a closed beach for
// another, which is a judgement the app makes per spot, with wind and tide and the spot's own
// swell window — not something a wave height alone can say. Hence the separate legend.

// Stops in metres, and the value spacing is half the design.
//
// The ramp used to run 0-12m on evenly-spaced round numbers, and that turned out to be the
// whole problem. 62.6% of the world's sea states are under 2.5m (Wang et al., Scientific Data
// 7:261, ten years of buoy-calibrated satellite observations), and that band was getting 24.8%
// of the ramp's perceptual range while 8-12m -- seas that cannot occur on a 1,100km sampling
// grid -- got 18.9%. Measured per step, the common band came out at 5.5 dE in the worst case
// against a just-noticeable threshold of 2.3 for a big patch and 5-7 for one the size of a
// grid cell. Most of the ocean, most of the time, was rendered in colours a reader could not
// tell apart.
//
// So the stops are spaced on a gamma-0.7 curve -- intervals widening as height grows -- which
// puts six of the ten intervals below 3m. Equal colour now buys less height down where the
// data is and more up where it is not, which is the right way round.
//
// Lightness climbs monotonically from end to end, and that is the other half. The old ramp
// *fell* in lightness from 4.5m to 8m: yellow was lighter than orange was lighter than red,
// 35 consecutive reversals, about 31 L in total. Above 4.5m it was ordered by hue alone, and
// hue is the channel that translucent compositing, sunlight and colour-blindness all attack
// hardest. Here chroma is whatever sRGB allows at each climbing lightness, which desaturates
// the top into pale coral rather than diving back into the dark.
//
// Two constraints bound the result and are worth recording, because both bite quickly:
//
//   - The dark end cannot go much below L 0.24. Veiling glare from ambient light lifts blacks,
//     so a ramp that starts too dark loses its low end outdoors exactly when someone is
//     standing on a beach looking at it.
//   - It cannot go much above it either. Past about L 0.28 the low stops collide with the
//     globe's own ocean blue (#175a82) and the overlay develops an invisible band where it
//     simply vanishes into the sphere underneath. At the chosen floor the closest approach is
//     9.9 dE.
//
// Measured against the ramp it replaces, composited at the real 0.85 over the real ocean, one
// 0.25m step across 0.25-3m: worst case 5.5 -> 7.9, uniformity (largest step over smallest)
// 4.26 -> 1.81, lightness reversals 35 -> 0. Uniformity is the number that matters most --
// professional oceanographic palettes sit near 2.0, and "the same range spread evenly" beats
// "more range" every time. Total arc drops 345 -> 240 and that is fine: arc is necessary, not
// sufficient, and the highest-arc ramp in common use is jet.
const STOPS = [
  [0, [0, 28, 73]],
  [0.4, [1, 51, 86]],
  [0.8, [3, 75, 99]],
  [1.2, [7, 100, 107]],
  [1.7, [12, 126, 108]],
  [2.3, [17, 155, 80]],
  [3, [120, 170, 19]],
  [4, [197, 175, 23]],
  [5.5, [253, 181, 90]],
  [8, [254, 210, 193]],
  [12, [255, 241, 242]],
];

export const WAVE_SCALE_MAX = STOPS[STOPS.length - 1][0];

// Linear interpolation between stops. Linear rather than perceptual: the stops are already
// placed on meaning rather than evenly, so the ramp's apparent pacing follows the sea instead
// of the numbers.
export function waveColor(metres) {
  if (metres == null || !Number.isFinite(metres) || metres < 0) return null;
  if (metres <= STOPS[0][0]) return STOPS[0][1].slice();
  const last = STOPS[STOPS.length - 1];
  if (metres >= last[0]) return last[1].slice();
  for (let i = 1; i < STOPS.length; i++) {
    const [hi, cHi] = STOPS[i];
    if (metres > hi) continue;
    const [lo, cLo] = STOPS[i - 1];
    const t = (metres - lo) / (hi - lo);
    return [
      Math.round(cLo[0] + (cHi[0] - cLo[0]) * t),
      Math.round(cLo[1] + (cHi[1] - cLo[1]) * t),
      Math.round(cLo[2] + (cHi[2] - cLo[2]) * t),
    ];
  }
  return last[1].slice();
}

// The same ramp, in discrete bands rather than a continuous blend.
//
// Windy does this on its globe -- their own published type declarations carry a `qualitative`
// flag documented as "globe: use discrete palette (not blending between colors)" -- and the
// evidence agrees with them for the task this map is actually for. A smooth ramp is better for
// reading the *shape* of a field; discrete bands are better for reading a *value* off it, and
// on a grid sampled every 1,100km there is very little real shape to read. The band edge is
// also a hard line of 11.6 dE or more, which is far easier to see than the same difference
// spread gradually across a few hundred kilometres of ocean.
//
// The bands are the stops themselves, so there is nothing new to keep in step: ten bands, six
// of them below 3m, already placed where a surfer's decisions are. That is also the count the
// level budget wants -- eight to twelve bands is the range a colour ramp can separate
// comfortably, and asking for more is what makes a map illegible.
//
// Each band paints the continuous ramp's colour at its *midpoint* rather than at its lower
// edge. Measured, that is the better of the two: uniformity 2.61 against 3.07, and it keeps
// the whole palette clear of the globe's own ocean blue by 10.5 dE rather than 9.9. It is also
// the more honest reading -- a band's colour should stand for the middle of what it covers,
// not its floor.
export const WAVE_BAND_EDGES = STOPS.map(([m]) => m);

export function waveColorBanded(metres) {
  if (metres == null || !Number.isFinite(metres) || metres < 0) return null;
  const last = STOPS.length - 1;
  if (metres >= STOPS[last][0]) return waveColor(STOPS[last][0]);
  for (let i = 1; i <= last; i++) {
    // Half-open bands: a height exactly on an edge belongs to the band above it, so 0.4m reads
    // as the start of the 0.4-0.8 band rather than the end of the one below.
    if (metres >= STOPS[i][0]) continue;
    return waveColor((STOPS[i - 1][0] + STOPS[i][0]) / 2);
  }
  return waveColor(STOPS[last][0]);
}

// The legend bar for the banded ramp: the same even spacing as the smooth one, but with hard
// edges, so the bar shows exactly the set of colours the globe can actually paint.
export function waveScaleBandGradient() {
  const last = STOPS.length - 1;
  const parts = [];
  for (let i = 0; i < last; i++) {
    const c = waveColor((STOPS[i][0] + STOPS[i + 1][0]) / 2);
    const rgb = 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
    parts.push(rgb + ' ' + ((i / last) * 100).toFixed(1) + '%');
    parts.push(rgb + ' ' + (((i + 1) / last) * 100).toFixed(1) + '%');
  }
  return 'linear-gradient(90deg, ' + parts.join(', ') + ')';
}

// Where a value sits along the colour sequence, 0 to 1.
//
// Deliberately not the same as where it sits between 0 and WAVE_SCALE_MAX. The stops are not
// evenly spaced in metres -- that uneven spacing is the entire point of the ramp -- so the
// legend bar paints the colour sequence evenly and puts each tick at its real position along
// it. Painting the bar linearly in metres instead would squeeze six of the ten colour steps
// into its left quarter, which is precisely the part a reader most needs to see.
//
// This is the standard way to label a non-linear scale: a uniform bar, unevenly spaced ticks
// carrying real values. The alternative -- relabelling the axis into ramp units -- would put
// numbers on the legend that mean nothing in the water.
export function waveRampPosition(metres) {
  const last = STOPS.length - 1;
  if (!(metres > STOPS[0][0])) return 0;
  if (metres >= STOPS[last][0]) return 1;
  for (let i = 1; i <= last; i++) {
    const hi = STOPS[i][0];
    if (metres > hi) continue;
    const lo = STOPS[i - 1][0];
    return (i - 1 + (metres - lo) / (hi - lo)) / last;
  }
  return 1;
}

// The legend's tick marks, in the units on screen, each with its position along the bar.
//
// Metric ticks are round metres; imperial ones are round feet, because "3.3ft" on a legend is
// a conversion showing its working rather than a label. Half a metre earns a tick of its own
// now -- it is the line between flat and something, and under the old ramp everything below it
// was one colour anyway.
export function waveScaleTicks(units) {
  const vals = units === 'imperial'
    ? [0, 1, 2, 3, 5, 10, 20, 30].map((ft) => ({ metres: ft / 3.28084, label: String(ft) }))
    : [0, 0.5, 1, 2, 3, 4, 6, 9].map((m) => ({ metres: m, label: String(m) }));
  return vals.map((t) => ({ ...t, pos: waveRampPosition(t.metres) }));
}

export function waveScaleUnitLabel(units) {
  return units === 'imperial' ? 'ft' : 'm';
}

// A CSS gradient of the ramp, for the legend bar -- so the bar and the globe are coloured by
// one definition and cannot drift apart.
//
// Stops are placed at even percentages, not at their height as a fraction of the maximum. The
// bar shows the colour sequence; waveScaleTicks says where the numbers fall on it. See
// waveRampPosition.
export function waveScaleGradient() {
  const last = STOPS.length - 1;
  const parts = STOPS.map(([, c], i) => {
    const pct = ((i / last) * 100).toFixed(1);
    return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ') ' + pct + '%';
  });
  return 'linear-gradient(90deg, ' + parts.join(', ') + ')';
}

// How old the grid is, said the way a person would.
export function gridAgeLabel(generatedAt, now = Date.now()) {
  if (!Number.isFinite(generatedAt)) return null;
  const mins = Math.max(0, Math.round((now - generatedAt) / 60000));
  if (mins < 90) return mins <= 1 ? 'just now' : mins + ' min ago';
  const hours = Math.round(mins / 60);
  if (hours < 36) return hours + 'h ago';
  return Math.round(hours / 24) + 'd ago';
}

// The line under the swell legend.
//
// It carries the age of the data and, when there is anything to say, why the map is not the map
// it should be. That last part exists because a silent fallback is indistinguishable from a
// stale build: the overlay still draws when the coastline it cuts itself to cannot be fetched,
// but it falls back to the wave grid's own 1,100km idea of where land is — which looks exactly
// like the bug the coastline was added to fix. If the caption says so, one glance settles which
// of the two is happening.
export function waveLegendCaption(meta, units, now = Date.now()) {
  const parts = ['Open-ocean wave height (' + waveScaleUnitLabel(units) + ')'];
  // While the week is animating, the map is not "now" and must not claim to be. The frame's own
  // time replaces the grid's age, because the age of the build is not the interesting fact when
  // the picture on screen is four days ahead of it.
  if (meta && meta.frameLabel) parts.push(meta.frameLabel);
  else parts.push(gridAgeLabel(meta && meta.generatedAt, now) || 'age unknown');
  if (meta && meta.stale) parts.push('last good data');
  if (meta && meta.coarse) parts.push('coarse edge — coastline unavailable');
  // Which way the arrows read. "Direction" is ambiguous for waves — the number in every marine
  // feed is where they come *from* — so the legend says which one is drawn rather than leaving
  // a surfer to work it out from a map they have never seen before.
  if (meta && meta.arrows) parts.push('arrows show where the swell is heading');
  // A chart with no arrows has two possible causes that look the same on screen: this grid was
  // built before directions were fetched at all, or it has them and none came through. The
  // first is a cache that will age out; the second is a fault. Saying which is a glance rather
  // than a round of guessing.
  else if (meta && meta.noDirections) parts.push('no wave directions in this grid yet');
  return parts.join(' · ');
}

// Where a swell drawn on the globe is heading.
//
// Open-Meteo reports `wave_direction` the way every marine source does: the compass bearing the
// waves are coming *from*. An arrow on a map reads as travel, though — Windy's wave arrows point
// downwave and so does everyone's intuition — so the arrows are drawn at the opposite bearing,
// and the legend says which it is rather than leaving it to be guessed.
export function swellTravelBearing(fromDeg) {
  if (fromDeg == null || !Number.isFinite(fromDeg)) return null;
  return ((fromDeg % 360) + 540) % 360;
}
