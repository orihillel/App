import { ORDER as SEED_ORDER } from './spots.js';

// The spots that are actually yours, and how they are doing right now.
//
// The app could always answer "how is this one spot", eight hours deep, with a week chart and a
// tide curve. What it could not answer is the question people open a surf app to ask on a
// weekday morning: *which* of my spots, if any. You had to page through them one at a time with
// the prev/next arrows and hold four ratings in your head.
//
// "Best nearby" is not this. That ranks the catalog around wherever you are standing, which is
// the right answer on a trip and the wrong one at home -- it does not know that you only ever
// surf three of the twelve breaks within 40km, and it needs a location permission to say
// anything at all.

// `order` is not a favourites list -- it starts as the whole built-in catalog -- so "yours" is
// the go-to spot plus anything you searched for and added. The same distinction NavDrawer and
// ProfileView already draw, kept here so all three cannot drift apart.
export function mySpotIds(order, spots, goToId) {
  const added = (order || []).filter((id) => spots[id] && !SEED_ORDER.includes(id));
  return [goToId, ...added.filter((id) => id !== goToId)].filter((id) => spots[id]);
}

// Pick the hour closest to the clock, the way the nearby list does. A full forecast carries a
// day of sampled hours and a one-hour Worker reading carries exactly one; both work.
function pickHourAt(hours, clockHour) {
  if (!Array.isArray(hours) || !hours.length) return null;
  if (clockHour == null) return hours[0];
  let best = hours[0];
  let bestGap = Infinity;
  for (const h of hours) {
    if (typeof h.hour !== 'number') continue;
    const gap = Math.abs(h.hour - clockHour);
    if (gap < bestGap) { bestGap = gap; best = h; }
  }
  return best;
}

// Deliberately *not* sorted by score.
//
// Ranking them would make the list reorder under a thumb as readings land one by one, and it
// would put the go-to spot somewhere different every morning -- which is the opposite of what a
// list you check daily is for. Your order is your order; the ratings are what changes.
export function mySpotRows(ids, spots, forecast, clockHour) {
  return (ids || []).map((id) => {
    const entry = forecast && forecast[id];
    const hour = entry && entry.hours ? pickHourAt(entry.hours, clockHour) : null;
    return {
      id,
      spot: spots[id],
      hour,
      // A missing reading is its own state, not a zero. The row renders as still loading rather
      // than as flat, which is the distinction the whole app is built on.
      score: hour && Number.isFinite(hour.score) ? hour.score : null,
    };
  }).filter((r) => r.spot);
}

// The one-line summary above the list: how many of yours are worth the drive right now.
export function mySpotsSummary(rows) {
  const rated = (rows || []).filter((r) => r.hour && r.hour.rating);
  if (!rated.length) return null;
  const good = rated.filter((r) => r.hour.rating === 'GOOD' || r.hour.rating === 'FIRING');
  if (!good.length) return 'Nothing firing at your spots right now';
  const best = good.reduce((a, b) => (b.score > a.score ? b : a));
  return good.length === 1
    ? best.spot.name + ' is the pick right now'
    : best.spot.name + ' is the pick of ' + good.length + ' worth a look';
}
