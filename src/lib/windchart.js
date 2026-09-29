import { degToCompass, windType } from './rating.js';
import { windTravelBearing } from './windscale.js';

// The week's wind as a grid of arrows: one row a day, one column for each surfable time of day.
//
// Each arrow says three things at once, and each thing has its own channel so none has to be
// decoded from another:
//   - where it blows: the arrow points the way the wind is travelling, the same convention as
//     the wind arrows on the globe (see windTravelBearing in lib/windscale.js), and the compass
//     letters under it say where it comes from, the way every forecast names a wind;
//   - how hard: the arrow grows with the speed, and its colour steps through four named bands,
//     with the number itself printed underneath;
//   - what it does here: the key names the direction that is offshore at this spot.
//
// This replaced a bar chart that put offshore above a centre line and onshore below. It was
// accurate and did not read: a bar has no direction, so "which way is it blowing" -- the first
// thing anyone asks of a wind forecast -- was the one thing it could not show.

// The times of day shown. Three-hourly readings from dawn to evening; the night ones are left
// out because nobody surfs them, and seven rows of eight would not fit a phone.
export const WIND_HOURS = [6, 9, 12, 15, 18];

// Strength bands, in mph (what the forecast carries). Placed where wind changes a surf session
// rather than evenly: under 8 the surface stays clean whatever the direction, by 15 direction is
// everything, past 22 very little is rideable.
//
// Colours are the app's own accents plus one violet, checked for colour-blind separation on the
// card background; size and the printed number carry strength too, so colour never works alone.
export const WIND_BANDS = [
  { id: 'light', label: 'Light', maxMph: 8, color: '#39E6C4' },
  { id: 'moderate', label: 'Moderate', maxMph: 15, color: '#FFC24B' },
  { id: 'strong', label: 'Strong', maxMph: 22, color: '#FF6A47' },
  { id: 'very-strong', label: 'Very strong', maxMph: Infinity, color: '#E040FB' },
];

export function windBand(mph) {
  if (!Number.isFinite(mph)) return null;
  return WIND_BANDS.find((b) => mph < b.maxMph) || WIND_BANDS[WIND_BANDS.length - 1];
}

// Arrow length in px: a calm reading is still an arrow you can see the direction of, and the
// size stops growing at 30mph, past which nothing about the session changes.
export const ARROW_MIN = 11;
export const ARROW_MAX = 28;
export function arrowSize(mph) {
  if (!Number.isFinite(mph)) return ARROW_MIN;
  const t = Math.max(0, Math.min(1, mph / 30));
  return Math.round(ARROW_MIN + t * (ARROW_MAX - ARROW_MIN));
}

// One cell: everything the grid draws for a reading, or null for a gap.
function cellFor(p, idx, offshoreDeg) {
  if (!p || !Number.isFinite(p.windSpd) || !Number.isFinite(p.windDeg)) return null;
  const band = windBand(p.windSpd);
  return {
    idx,
    hour: p.hour,
    mph: p.windSpd,
    fromDeg: p.windDeg,
    travelDeg: windTravelBearing(p.windDeg),
    from: degToCompass(p.windDeg),
    band,
    size: arrowSize(p.windSpd),
    type: Number.isFinite(offshoreDeg) ? windType(p.windDeg, offshoreDeg) : null,
  };
}

// The readings laid out by day and hour. `idx` is each reading's position in `points`, so a tap
// on a cell can select the same moment on the wave chart above.
//
// Days are taken in the order they come, and a day that starts part-way (today, opened in the
// afternoon) keeps its empty morning cells rather than shifting its readings left under the
// wrong hours.
export function windGrid(points, offshoreDeg, { hours = WIND_HOURS, maxDays = 7 } = {}) {
  if (!Array.isArray(points) || !points.length) return null;
  const rows = [];
  let row = null;
  points.forEach((p, idx) => {
    if (!p || !p.day) return;
    if (!row || row.day !== p.day) {
      if (rows.length >= maxDays) { row = { day: p.day, full: true }; return; }
      row = { day: p.day, cells: hours.map(() => null) };
      rows.push(row);
    }
    if (row.full) return;
    const col = hours.indexOf(p.hour);
    if (col >= 0) row.cells[col] = cellFor(p, idx, offshoreDeg);
  });
  const kept = rows.filter((r) => r.cells.some(Boolean));
  return kept.length ? { hours, rows: kept } : null;
}

// The key's line about this spot: which way the wind has to come from to be offshore here.
export function offshoreFromLabel(offshoreDeg) {
  return Number.isFinite(offshoreDeg) ? degToCompass(offshoreDeg) : null;
}
