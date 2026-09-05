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

// Stops in metres. Chosen on what the sea actually does: under half a metre is flat, 1-2m is
// an ordinary day nearly everywhere, 4m+ is a serious swell, and past 8m is a storm sea that
// only a handful of places on Earth can hold a rideable shape in.
const STOPS = [
  [0.0, [26, 35, 68]],
  [0.5, [32, 66, 128]],
  [1.0, [30, 110, 180]],
  [2.0, [32, 170, 176]],
  [3.0, [86, 190, 110]],
  [4.5, [226, 200, 78]],
  [6.0, [232, 140, 58]],
  [8.0, [216, 74, 68]],
  [12.0, [246, 220, 240]],
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

// The legend's tick marks, in the units on screen.
//
// Metric ticks are round metres; imperial ones are round feet, because "3.3ft" on a legend is
// a conversion showing its working rather than a label. Both stop where the ramp does.
export function waveScaleTicks(units) {
  if (units === 'imperial') {
    return [0, 3, 6, 10, 15, 20, 30].map((ft) => ({ metres: ft / 3.28084, label: String(ft) }));
  }
  return [0, 1, 2, 3, 4, 6, 9].map((m) => ({ metres: m, label: String(m) }));
}

export function waveScaleUnitLabel(units) {
  return units === 'imperial' ? 'ft' : 'm';
}

// A CSS gradient of the ramp, for the legend bar — so the bar and the globe are coloured by
// one definition and cannot drift apart.
export function waveScaleGradient() {
  const parts = STOPS.map(([m, c]) => {
    const pct = ((m / WAVE_SCALE_MAX) * 100).toFixed(1);
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
