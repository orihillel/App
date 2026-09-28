import { waveAvg, hourLabel12 } from './format.js';
import { DAY_LABELS } from './spots.js';

// Whether an alert's condition is met in a spot's forecast, and a human-readable reason why
// or why not. Pure — no React, no fetch — so it's shared between the client (checks live data
// while the tab is open, in App.jsx) and the push-notification Worker (checks in the
// background on a schedule; see worker/src/index.js). Keeping this one function shared means
// "would this alert fire" can never drift between the two.
export function checkAlertMatch(alert, spotForecast) {
  const sf = spotForecast;
  if (!sf) return null;
  if (alert && alert.kind === 'rating') return checkRatingAlert(alert, sf);
  if (alert.leadTime === '1h') {
    const hit = (sf.hours || []).find((hr) => waveAvg(hr.wave) >= alert.minWaveFt);
    return hit ? { hit: true, text: 'Matches today at ' + hit.t } : { hit: false, text: "No match in today's forecast" };
  }
  const offset = { '1d': 1, '2d': 2, '3d': 3 }[alert.leadTime] || 1;
  const cont = sf.continuous || [];
  // Each day has exactly 8 three-hourly samples (24hrs / 3), in order from today (offset 0).
  const daySamples = cont.slice(offset * 8, offset * 8 + 8);
  if (!daySamples.length) {
    const day = (sf.weekly || [])[offset];
    return day ? { hit: false, text: 'No wind data that far out yet — ' + day.day + ' wave-only: ' + Math.round(day.waveFt) + 'ft' } : null;
  }
  // Wave height threshold still has to be met, but now it also has to not be blown out —
  // a big number on an onshore-trashed day isn't actually a session worth an alert for.
  // surfFt, not waveFt: an alert is set in the numbers the app shows, which are breaking
  // heights. Falls back to waveFt for a forecast cached by a build that predates the transform.
  const heightOf = (p) => (p.surfFt != null ? p.surfFt : p.waveFt);
  const hit = daySamples.find((p) => heightOf(p) >= alert.minWaveFt && p.rating && p.rating !== 'POOR');
  if (hit) return { hit: true, text: 'Matches ' + hit.day + ' — ' + hit.rating.toLowerCase() + ' conditions' };
  const bigButBlownOut = daySamples.find((p) => heightOf(p) >= alert.minWaveFt);
  if (bigButBlownOut) return { hit: false, text: bigButBlownOut.day + ' has the size but wind looks poor' };
  return { hit: false, text: 'No match ' + daySamples[0].day + ' yet' };
}

// Alerts on the rating rather than on a height.
//
// A height alert asks the question the wrong way round. "4ft or bigger" is a clean day on a
// shortboard, too much on a first longboard, and says nothing about the wind -- which is why
// the height check above already had to bolt on "and not POOR". The rating is the app's
// whole answer to "is it worth going", already scored for this person's board and level
// (lib/surfer.js), so an alert on it asks the actual question: tell me when it is good *for
// me*.
//
// It is also limited to when you can go. A dawn session is no use to someone who cannot surf
// before work, and a Wednesday one is no use to someone who only surfs weekends; an alert that
// fires for either is one people learn to ignore.
export const RATING_RANK = { POOR: 0, FAIR: 1, GOOD: 2, FIRING: 3 };
export const DEFAULT_WINDOW = { fromHour: 6, toHour: 18 };
export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

export function meetsRating(rating, minRating) {
  const have = RATING_RANK[rating];
  const need = RATING_RANK[minRating] ?? RATING_RANK.GOOD;
  return have != null && have >= need;
}

function inWindow(alert, hour) {
  const from = Number.isFinite(alert.fromHour) ? alert.fromHour : DEFAULT_WINDOW.fromHour;
  const to = Number.isFinite(alert.toHour) ? alert.toHour : DEFAULT_WINDOW.toHour;
  return typeof hour === 'number' && hour >= from && hour <= to;
}

// `days` holds weekday numbers as DAY_LABELS counts them (0 = Sunday). Missing or empty means
// any day: an alert should never go quiet because a field was left out.
function dayAllowed(alert, dayLabel) {
  if (!Array.isArray(alert.days) || !alert.days.length || !dayLabel) return true;
  return alert.days.includes(DAY_LABELS.indexOf(dayLabel));
}

function ratingWord(rating) { return rating.charAt(0) + rating.slice(1).toLowerCase(); }

function checkRatingAlert(alert, sf) {
  const cont = sf.continuous || [];
  const minRating = alert.minRating || 'GOOD';
  if (alert.leadTime === '1h') {
    // Today: the spot's own sampled daylight hours, which carry the full rating (tide included).
    const today = cont.length ? cont[0].day : null;
    if (!dayAllowed(alert, today)) return { hit: false, text: 'Not one of your days' };
    const hours = (sf.hours || []).filter((h) => inWindow(alert, h.hour) && h.rating);
    if (!hours.length) return { hit: false, text: 'No reading in your hours today' };
    const hit = hours.find((h) => meetsRating(h.rating, minRating));
    if (hit) return { hit: true, text: ratingWord(hit.rating) + ' for you today at ' + hourLabel12(hit.hour) };
    return { hit: false, text: 'Best today in your hours: ' + ratingWord(bestOf(hours).rating).toLowerCase() };
  }
  const offset = { '1d': 1, '2d': 2, '3d': 3 }[alert.leadTime] || 1;
  // Each day has 8 three-hourly samples, in order from today (offset 0).
  const daySamples = cont.slice(offset * 8, offset * 8 + 8);
  if (!daySamples.length) return null;
  const day = daySamples[0].day;
  if (!dayAllowed(alert, day)) return { hit: false, text: day + ' is not one of your days' };
  const usable = daySamples.filter((p) => inWindow(alert, p.hour) && p.rating);
  if (!usable.length) return { hit: false, text: 'No reading in your hours on ' + day };
  const hit = usable.find((p) => meetsRating(p.rating, minRating));
  if (hit) return { hit: true, text: ratingWord(hit.rating) + ' for you ' + day + ' at ' + hourLabel12(hit.hour) };
  return { hit: false, text: 'Best on ' + day + ' in your hours: ' + ratingWord(bestOf(usable).rating).toLowerCase() };
}

function bestOf(rows) {
  return rows.reduce((a, b) => ((RATING_RANK[b.rating] ?? -1) > (RATING_RANK[a.rating] ?? -1) ? b : a));
}

// "Every day", "Weekdays", "Weekends", or the days themselves, for an alert's summary line.
export function daysLabel(days) {
  if (!Array.isArray(days) || !days.length || days.length === 7) return 'every day';
  const key = [...days].sort((a, b) => a - b).join(',');
  if (key === '1,2,3,4,5') return 'weekdays';
  if (key === '0,6') return 'weekends';
  return [...days].sort((a, b) => a - b).map((d) => DAY_LABELS[d]).join(' ');
}

