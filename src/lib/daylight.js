import { hourLabel12 } from './format.js';

// Which hours of the day are worth forecasting for a given spot.
//
// This used to be the fixed list [5, 7, 9, 11, 13, 15, 17, 19] — every spot, every date. That
// is roughly right for a mid-latitude summer and wrong everywhere else, and it is badly wrong
// for the spots at the ends of the catalog: Unstad sits at 68.3°N, inside the Arctic Circle,
// where the sun does not rise at all for most of December. The app was offering a Norwegian
// surfer a forecast for eight hours of darkness, and hiding the few hours of light it had.
//
// So the sample points come from the spot's own sunrise and sunset instead. The window opens an
// hour before sunrise, because first light is when people actually paddle out and it is often
// the best of the day (lightest wind), and closes at sunset.

export const DEFAULT_HOUR_COUNT = 8;

// Local clock hour, as a fraction, from an ISO timestamp like "2026-09-04T06:41". Open-Meteo
// returns these already converted to the spot's own timezone (timezone=auto), so the wall-clock
// reading is the local one and no timezone maths is needed here.
export function isoLocalHour(iso) {
  if (typeof iso !== 'string') return null;
  const m = /T(\d{2}):(\d{2})/.exec(iso);
  if (!m) return null;
  return Number(m[1]) + Number(m[2]) / 60;
}

// Evenly spaced whole hours across the daylight window, oldest first.
//
// Returns fewer than `count` hours rather than repeating one when the day is too short to hold
// that many distinct ones — an Arctic winter day with four hours of light gives four points,
// not eight copies of noon. Callers must not assume a fixed length.
export function daylightHours(sunriseIso, sunsetIso, count = DEFAULT_HOUR_COUNT) {
  const sunrise = isoLocalHour(sunriseIso);
  const sunset = isoLocalHour(sunsetIso);

  // No usable sun times: either the API omitted them, or it is polar night/day where sunrise
  // and sunset are meaningless. Fall back to a window centred on midday — during polar night
  // there is still usable twilight around noon, which is exactly when people surf up there.
  if (sunrise == null || sunset == null || !(sunset > sunrise)) {
    return spanHours(6, 20, count);
  }
  const start = Math.max(0, Math.floor(sunrise) - 1); // an hour before sunrise: first light
  const end = Math.min(23, Math.ceil(sunset));
  return spanHours(start, end, count);
}

function spanHours(start, end, count) {
  if (end <= start) return [Math.max(0, Math.min(23, start))];
  const span = end - start;
  // One sample per whole hour is the finest this is ever worth showing, so a short day yields
  // a short list instead of duplicates.
  const n = Math.max(1, Math.min(count, span + 1));
  const out = [];
  for (let i = 0; i < n; i++) {
    const h = Math.round(start + (span * i) / (n - 1 || 1));
    if (!out.includes(h)) out.push(h);
  }
  return out;
}

export function hourLabels(hours) {
  return hours.map((h) => hourLabel12(h));
}

// The sample at (or nearest to) a given clock hour.
//
// The globe used to colour each marker with `hours[hourIdx]` — the Nth sample of that spot's
// day. That silently broke when hours became daylight-derived and per-spot:
//
//  1. Arrays are no longer all 8 long. A short winter day yields fewer, so an index chosen at
//     a spot with a long day is out of range at one with a short day, and every such marker
//     fell through to the "no data" grey. Reproduced at 6-hour days: 15 of 15 loaded spots
//     rendered grey.
//  2. Even in range it was the wrong sample. Index 3 is late morning at one spot and mid
//     afternoon at another, so the globe was not showing one moment in time at all.
//
// Selecting by clock hour fixes both: every marker shows the same time of day, and a spot
// whose window does not reach that hour shows its closest one rather than nothing.
export function pickHourAt(hours, clockHour) {
  if (!Array.isArray(hours) || hours.length === 0) return null;
  if (!Number.isFinite(clockHour)) return hours[0];
  let best = null;
  let bestGap = Infinity;
  for (const h of hours) {
    if (!h || !Number.isFinite(h.hour)) continue;
    const gap = Math.abs(h.hour - clockHour);
    if (gap < bestGap) { bestGap = gap; best = h; }
  }
  // Nothing carried an hour (placeholder rows before the first fetch): fall back to the first.
  return best || hours[0];
}
