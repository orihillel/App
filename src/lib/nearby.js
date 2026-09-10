import { distanceKm } from './spotnav.js';
import { pickHourAt } from './daylight.js';

// "Where should I go?" rather than "how is my spot?".
//
// The app could already answer the second question well and could not be asked the first at
// all -- you picked a spot and it told you about that spot. But nobody surfs one break: the
// actual morning decision is which of the handful within driving distance is worth the drive,
// and every part needed to answer it was already here. Spots have coordinates, conditionsScore
// already ranks a spot against its own swell window and tide, and the Worker already serves
// cached current readings for whatever the globe puts on screen. Nothing was joining them up.

// Far enough to be worth driving on a good day, close enough that the list is still about
// "near me". Beyond this a spot is a trip rather than a session.
export const DEFAULT_MAX_KM = 150;
// The list is meant to be read at a glance, standing in a kitchen. It is also the number of
// spots asked about, so it is a cost as well as a design choice.
export const DEFAULT_LIMIT = 12;

// The candidates: closest first, before anything is known about conditions. This is what gets
// asked about, which is why it is separate from the ranking below.
export function nearestSpots(spots, order, origin, { maxKm = DEFAULT_MAX_KM, limit = DEFAULT_LIMIT } = {}) {
  if (!spots || !origin || !Number.isFinite(origin.lat) || !Number.isFinite(origin.lon)) return [];
  const ids = Array.isArray(order) && order.length ? order : Object.keys(spots);
  const out = [];
  for (const id of ids) {
    const s = spots[id];
    if (!s || !Number.isFinite(s.lat) || !Number.isFinite(s.lon)) continue;
    const km = distanceKm(origin.lat, origin.lon, s.lat, s.lon);
    if (!Number.isFinite(km) || km > maxKm) continue;
    out.push({ id, km });
  }
  out.sort((a, b) => a.km - b.km);
  return out.slice(0, limit);
}

// The same candidates, best first.
//
// A spot with no reading yet sorts last rather than being dropped: it is genuinely nearby, the
// reading is probably in flight, and removing rows as answers arrive would make the list jump
// under a thumb. Ties break on distance, so among equally good spots the near one wins -- which
// is the whole reason distance is carried this far.
export function rankNearby(candidates, forecast, clockHour) {
  const rows = (candidates || []).map((c) => {
    const entry = forecast && forecast[c.id];
    const hour = entry && entry.hours ? pickHourAt(entry.hours, clockHour) : null;
    return { ...c, hour, score: hour && Number.isFinite(hour.score) ? hour.score : null };
  });
  rows.sort((a, b) => {
    if (a.score == null && b.score == null) return a.km - b.km;
    if (a.score == null) return 1;
    if (b.score == null) return -1;
    if (b.score !== a.score) return b.score - a.score;
    return a.km - b.km;
  });
  return rows;
}
