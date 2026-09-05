// Where the person opening the app probably is, and what that implies.
//
// The app shipped with two assumptions baked in for a user in California: imperial units, and an
// onboarding list of seven world-famous breaks with nothing within 9,000km of most people. Both
// are cheap to get right from what the browser already knows.

// Only three countries use imperial measure day to day, and only the US in any numbers. Feet are
// common for surf everywhere, but this toggle also drives wind speed and water temperature, so
// metric is the right default outside the US — and it is what the toggle switches away from in
// one tap for anyone who prefers otherwise.
const IMPERIAL_REGIONS = new Set(['US', 'LR', 'MM']);

export function defaultUnits(locale) {
  const tag = locale || browserLocale();
  const region = regionOf(tag);
  return region && IMPERIAL_REGIONS.has(region) ? 'imperial' : 'metric';
}

function browserLocale() {
  try {
    return (typeof navigator !== 'undefined' && navigator.language) || undefined;
  } catch {
    return undefined;
  }
}

function regionOf(tag) {
  if (!tag) return null;
  try {
    // Handles both "en-US" and locales that only resolve a region through maximize(), like "en".
    const loc = new Intl.Locale(tag);
    return (loc.maximize ? loc.maximize().region : loc.region) || null;
  } catch {
    const m = /[-_]([A-Za-z]{2})\b/.exec(tag);
    return m ? m[1].toUpperCase() : null;
  }
}

// Rough centre of the surfing coastline for timezones the catalog actually covers. This exists
// only to sort the catalog by distance, so a few dozen kilometres of imprecision costs nothing —
// and an unlisted timezone simply falls back to the global list rather than guessing badly.
const TIMEZONE_ANCHORS = {
  'Asia/Jerusalem': [32.09, 34.77],   // Tel Aviv
  'Asia/Tel_Aviv': [32.09, 34.77],
  'Asia/Gaza': [31.52, 34.44],
  'Asia/Hebron': [31.52, 34.44],
  'Africa/Cairo': [31.20, 29.90],
  'Europe/Lisbon': [38.96, -9.42],
  'Europe/Madrid': [43.41, -2.70],
  'Europe/Paris': [43.66, -1.44],
  'Europe/London': [50.42, -5.10],
  'Europe/Dublin': [53.20, -9.60],
  'Europe/Oslo': [62.03, 5.10],
  'Europe/Copenhagen': [57.04, 8.48],
  'Europe/Berlin': [54.90, 8.30],
  'Europe/Amsterdam': [52.11, 4.28],
  'Africa/Casablanca': [30.55, -9.71],
  'Africa/Johannesburg': [-34.05, 24.91],
  'Africa/Windhoek': [-22.68, 14.52],
  'Africa/Maputo': [-25.97, 32.85],
  'Africa/Luanda': [-9.00, 13.00],
  'Indian/Antananarivo': [-24.50, 45.50],
  'Indian/Mauritius': [-20.35, 57.45],
  'Indian/Reunion': [-21.10, 55.28],
  'Australia/Sydney': [-33.89, 151.28],
  'Australia/Brisbane': [-28.16, 153.55],
  'Australia/Melbourne': [-38.37, 144.28],
  'Australia/Perth': [-33.97, 115.08],
  'Pacific/Auckland': [-37.80, 174.87],
  'Pacific/Honolulu': [21.66, -158.05],
  'Asia/Jakarta': [-8.83, 115.09],
  'Asia/Makassar': [-8.83, 115.09],
  'Asia/Tokyo': [35.31, 140.38],
  'Asia/Manila': [9.80, 126.17],
  'Asia/Colombo': [6.84, 81.83],
  'America/Los_Angeles': [33.38, -117.60],
  'America/New_York': [40.58, -73.66],
  'America/Lima': [-7.70, -79.45],
  'America/Santiago': [-34.39, -71.99],
  'America/Sao_Paulo': [-23.79, -45.57],
  'America/Mexico_City': [15.87, -97.08],
  'America/Costa_Rica': [9.95, -85.68],
};

export function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

export function anchorFor(timeZone) {
  return TIMEZONE_ANCHORS[timeZone || browserTimeZone()] || null;
}

function distanceSq(aLat, aLon, bLat, bLon) {
  // Plain squared distance with a longitude correction — this only ranks, never reports, so
  // there is no reason to pay for a great-circle formula.
  const dLat = aLat - bLat;
  const dLon = (aLon - bLon) * Math.cos(((aLat + bLat) / 2) * (Math.PI / 180));
  return dLat * dLat + dLon * dLon;
}

// The spots to offer first on the onboarding screen.
//
// Falls back to `fallback` (the hand-picked global list) whenever the timezone is unknown, so
// somewhere the catalog covers thinly never ends up recommending seven spots on another
// continent purely because they happen to be the nearest of a bad set.
export function nearbyPicks(spots, timeZone, fallback, count = 7) {
  const anchor = anchorFor(timeZone);
  if (!anchor || !spots) return fallback;
  const [lat, lon] = anchor;
  const ranked = Object.entries(spots)
    .filter(([, s]) => typeof s.lat === 'number' && typeof s.lon === 'number')
    .map(([id, s]) => ({ id, d: distanceSq(lat, lon, s.lat, s.lon) }))
    .sort((a, b) => a.d - b.d);
  // Roughly 1000km, beyond which "nearby" is not a fair description.
  const near = ranked.filter((r) => r.d < 81).slice(0, count);
  return near.length >= 3 ? near.map((r) => r.id) : fallback;
}
