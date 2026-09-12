// The fortnight after the week.
//
// Open-Meteo serves up to 16 days and the app was asking for 7, which is the one number in the
// whole forecast that was short for no reason. "Is that swell still coming Thursday week" and
// "which week should I book" are both real questions and neither could be asked.
//
// It is a *separate, much smaller* request rather than a bigger version of the existing one, for
// two reasons that happen to point the same way.
//
// The billing one: Open-Meteo charges locations x variables x days, and the spot fetch asks for
// thirteen marine variables. Stretching that to 16 days takes one spot fetch from 105 units to
// 240, and the free tier allows roughly 600 a minute -- so opening three spots in a minute would
// trip the limit. That is not a hypothetical: pricing the per-minute limit wrong is exactly what
// made the globe animation unavailable for a day. Asking for one daily variable over 16 days
// costs 16 units, which is less than a sixth of what the existing call already spends.
//
// The honest one: past about a week the models stop agreeing on anything finer than "big or
// small". The app already says so -- the confidence badge exists because two models can differ
// by a factor of two at range. Serving hour-by-hour swell trains for day 14 would dress that
// uncertainty up as detail. A daily maximum is the most this data can actually support, so it is
// all this asks for and all it shows.

// The upstream cap. Asking for more is rejected outright rather than truncated.
export const MAX_FORECAST_DAYS = 16;

// Where the detailed forecast ends and this takes over. Kept as a name rather than a literal 7
// because forecast.js's own horizon is the thing it has to match.
export const DETAILED_DAYS = 7;

export function outlookUrl(lat, lon) {
  return 'https://marine-api.open-meteo.com/v1/marine?latitude=' + lat + '&longitude=' + lon +
    '&daily=wave_height_max&timezone=auto&forecast_days=' + MAX_FORECAST_DAYS;
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Only the days past the detailed window. The first week is already on screen in far more
// detail, and showing it twice at two resolutions invites the two to disagree on screen.
export function parseOutlook(body, { skip = DETAILED_DAYS } = {}) {
  const daily = (body && body.daily) || {};
  // No isArray guard on these two. `|| []` covers missing, and anything else junk is already
  // caught per item below -- a non-array has no usable length, a non-numeric height fails the
  // null check, and an unparseable date fails the date check. A mutation test proved the guard
  // could not be made to fire, so it is gone and the "malformed body" test holds the invariant
  // instead.
  const times = daily.time || [];
  const maxima = daily.wave_height_max || [];
  const out = [];
  for (let i = skip; i < times.length; i++) {
    const m = maxima[i];
    if (m == null) continue;
    const d = new Date(times[i] + 'T00:00:00');
    if (Number.isNaN(d.getTime())) continue;
    out.push({
      date: times[i],
      day: DAY_LABELS[d.getDay()],
      // Offshore significant height, in feet, exactly as `weekly` carries it. Deliberately not
      // run through breakingHeightFt: that transform needs the period carrying the energy, and
      // a daily maximum does not come with one. Inventing a period to feed it would be a made-up
      // number, which is the one thing this app does not do.
      waveFt: m * 3.28084,
    });
  }
  return out;
}

// Through the Worker when one is configured, exactly as the main forecast is.
//
// Not an optimisation. The Worker exists because Open-Meteo is unreachable from some networks
// and regions entirely, and a direct call from here would simply fail for those people -- which
// is what the first version of this did, and what forecast.test.js's routing tests caught.
// Routing it here also means the Worker's edge cache serves one upstream fetch per spot to
// everyone who asks, the same way /forecast and /conditions already do.
//
// A 404 means the Worker predates this endpoint, so go direct. Any other refusal is passed on as
// "nothing to show": asking Open-Meteo again from the browser would be refused too and would
// spend one more of the very allowance that is exhausted.
async function fetchOutlookBody(spot, fetchImpl) {
  const base = import.meta.env.VITE_PUSH_API_URL;
  if (base) {
    let res = null;
    try {
      res = await fetchImpl(base + '/outlook?lat=' + spot.lat + '&lon=' + spot.lon);
    } catch { /* Worker unreachable -- fall through and ask Open-Meteo directly */ }
    if (res && res.ok) return res.json();
    if (res && res.status !== 404) return null;
  }
  const res = await fetchImpl(outlookUrl(spot.lat, spot.lon));
  // Checked before the body is read, not after. An upstream that answers 429 or 502 with
  // something JSON-shaped must not have that shape mistaken for a forecast -- the app's whole
  // posture is that it shows nothing rather than a number it made up.
  if (!res.ok) return null;
  return res.json();
}

export async function fetchOutlook(spot, { fetchImpl = fetch } = {}) {
  if (!spot || !Number.isFinite(spot.lat) || !Number.isFinite(spot.lon)) return [];
  try {
    return parseOutlook(await fetchOutlookBody(spot, fetchImpl));
  } catch {
    // A pure bonus on top of a forecast that already works, on the same footing as the buoy
    // panel and the model-agreement badge: never allowed to fail the page.
    return [];
  }
}

// Bar heights for the outlook strip, scaled to the tallest day in it rather than to a fixed
// ceiling: a flat fortnight should still show its shape instead of fourteen identical stubs, and
// a big one should not clip. A floor keeps the smallest day visible as a bar rather than as
// nothing at all, which would read as missing data.
export const OUTLOOK_BAR_MAX_PX = 34;
export const OUTLOOK_BAR_MIN_PX = 3;

export function outlookBarHeight(waveFt, days) {
  if (!Number.isFinite(waveFt) || !Array.isArray(days) || !days.length) return OUTLOOK_BAR_MIN_PX;
  const heights = days.map((d) => d.waveFt).filter((v) => Number.isFinite(v));
  const max = heights.length ? Math.max(...heights) : 0;
  if (!(max > 0)) return OUTLOOK_BAR_MIN_PX;
  return Math.max(OUTLOOK_BAR_MIN_PX, Math.round((waveFt / max) * OUTLOOK_BAR_MAX_PX));
}
