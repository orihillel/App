// Reading the surf the way you read it.
//
// Every forecast publishes one number for a wave and no two surfers agree on it. This app is at
// least explicit about what its number means -- the breaking face, significant height up to the
// H(1/10) set, see lib/surf.js -- but that is still a model of a coastline, not a measurement of
// the peak you paddle for, and someone who has surfed one break for ten years has a calibration
// the app cannot derive. Until now there was nowhere to put it.
//
// This is a reading preference and nothing more. It changes the heights on screen; it does not
// change the ocean, the ratings, the board band those ratings are measured against, which hours
// an alert fires on, or the per-spot correction learned from buoys (lib/calibration.js). That
// separation is the whole design: a number someone nudged to taste must never flow back into the
// parts of the app that claim to be evidence. Everything stored stays in the model's own feet,
// and the scale is applied at the edge where a height is rendered or typed in.
export const MIN_SCALE = 0.5;
export const MAX_SCALE = 1.5;
export const SCALE_STEP = 0.05;
export const DEFAULT_SCALE = 1;

// Snapped to whole percent rather than to SCALE_STEP: stepping by 0.05 in binary floating point
// lands on 1.0000000000000002 for the default, and a default that is not exactly 1 would make
// every untouched install take the rescaling path instead of the identity one.
// Absent is not the same as small. `Number(null)` and `Number('')` are both 0, which the clamp
// below would happily read as "half size" -- so a missing stored value, or an account synced
// from a device that never set one, would silently halve every height in the app.
export function normalizeScale(v) {
  if (v == null || v === '') return DEFAULT_SCALE;
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_SCALE;
  return Math.round(Math.min(MAX_SCALE, Math.max(MIN_SCALE, n)) * 100) / 100;
}

// A threshold travels the other way. An alert is collected in the heights this person reads --
// the sheet's buttons say 2, 3, 4 -- and matched by the Worker against a forecast it fetched
// itself, in the model's feet, with no idea who subscribed. Converting on the way in means an
// alert set before this setting existed still means what it always meant, and one set at 85%
// fires on the size that reads as 3ft to whoever asked for 3ft.
export function toModelFt(readFt, scale) {
  return readFt / normalizeScale(scale);
}

export function scaleLabel(scale) {
  return Math.round(normalizeScale(scale) * 100) + '%';
}

// What the setting is doing, in the units the person reading it uses, or null at 100% where
// there is nothing to explain. Saying "bigger"/"smaller" rather than only a percentage because
// the direction is the part that is easy to get backwards.
export function scaleDescription(scale) {
  const s = normalizeScale(scale);
  if (s === DEFAULT_SCALE) return null;
  const pct = Math.abs(Math.round((s - 1) * 100));
  return s < 1 ? pct + '% smaller than the forecast' : pct + '% bigger than the forecast';
}
