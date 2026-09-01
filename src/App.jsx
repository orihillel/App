import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Menu, Search, Star, Home, Map, Bell, User, Navigation, RefreshCw, X, ChevronLeft, ChevronRight } from 'lucide-react';
import * as THREE from 'three';
import { storage } from './lib/storage.js';
import LANDMASSES from './data/landmasses.json';

const GLOBAL_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500;600;700&display=swap');
.no-scrollbar::-webkit-scrollbar { display: none; }
.no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
.tl-btn { cursor: pointer; }
.tl-btn:focus-visible { outline: 2px solid #F4F7F6; outline-offset: 2px; border-radius: 8px; }
.tl-input:focus { outline: none; border-color: rgba(244,247,246,0.5) !important; }
.tl-label { position: absolute; pointer-events: none; transform: translate(-50%, -130%); white-space: nowrap;
  background: rgba(8,20,31,0.88); color: #F4F7F6; font-family: 'JetBrains Mono', monospace; font-size: 10px;
  padding: 3px 7px; border-radius: 8px; display: none; }
@keyframes tl-pulse { 0%, 100% { opacity: 0.35; } 50% { opacity: 0.8; } }
.tl-pulse { animation: tl-pulse 1.4s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; animation: none !important; }
}
`;

// "Instrument panel" palette — darker base, sharper accents, a dedicated bezel/border
// tone for the gauge-like panel outlines that replace the old soft drop-shadow cards.
const COLORS = {
  navy: '#070F18', navyCard: '#0F2136', navyBorder: 'rgba(244,247,246,0.14)',
  coral: '#FF6A47', gold: '#FFC24B',
  teal: '#2FA98C', tealBright: '#39E6C4', poor: '#E1573F', foam: '#F4F7F6',
  foamDim: 'rgba(244,247,246,0.58)', foamFaint: 'rgba(244,247,246,0.14)',
};

const HOUR_LABELS = ['5a', '7a', '9a', '11a', '1p', '3p', '5p', '7p'];
const HOUR_INDICES = [5, 7, 9, 11, 13, 15, 17, 19];

const SPOTS = {
  trestles: { name: 'Lower Trestles', region: 'San Clemente, CA', blurb: 'Cobblestone point wrapping into long, workable walls. Best before the wind fills in.', lat: 33.3825, lon: -117.5972, offshoreDeg: 60 },
  blacks: { name: 'Blacks Beach', region: 'La Jolla, CA', blurb: 'Deep submarine canyon keeps it offshore-groomed most of the day. Powerful and hollow.', lat: 32.8991, lon: -117.2528, offshoreDeg: 90 },
  rincon: { name: 'Rincon', region: 'Santa Barbara, CA', blurb: 'Long, playful walls peeling down the point. Small today, but silky smooth.', lat: 34.3739, lon: -119.4763, offshoreDeg: 350 },
  wedge: { name: 'The Wedge', region: 'Newport Beach, CA', blurb: 'Ledgy, close-interval peaks off the jetty. Heavy, and not for the faint of heart.', lat: 33.5952, lon: -117.8822, offshoreDeg: 30 },
  pipeline: { name: 'Pipeline', region: 'Oahu, Hawaii', blurb: "World-famous reef barrel on the North Shore. Heavy, shallow, and unforgiving when it's on.", lat: 21.6647, lon: -158.0538, offshoreDeg: 200 },
  teahupoo: { name: "Teahupo'o", region: 'Tahiti, French Polynesia', blurb: 'One of the heaviest, thickest waves on the planet, breaking over shallow coral.', lat: -17.8570, lon: -149.2680, offshoreDeg: 20 },
  jbay: { name: 'Jeffreys Bay', region: 'Eastern Cape, South Africa', blurb: 'Long, high-speed right point — one of the best walls in the world when it lines up.', lat: -34.0489, lon: 24.9087, offshoreDeg: 325 },
  uluwatu: { name: 'Uluwatu', region: 'Bali, Indonesia', blurb: "Dramatic reef break beneath a clifftop temple, with several sections down the point.", lat: -8.8290, lon: 115.0870, offshoreDeg: 50 },
  snapper: { name: 'Snapper Rocks', region: 'Gold Coast, Australia', blurb: 'The Superbank — impossibly long, fast right points when the sand banks line up.', lat: -28.1590, lon: 153.5470, offshoreDeg: 250 },
  nazare: { name: 'Nazaré', region: 'Portugal', blurb: 'Home to some of the biggest waves ever surfed, thanks to an underwater canyon offshore.', lat: 39.6033, lon: -9.0705, offshoreDeg: 85 },
  chicama: { name: 'Chicama', region: 'La Libertad, Peru', blurb: 'The longest left-hand point wave in the world — rides can last over a minute.', lat: -7.7000, lon: -79.4500, offshoreDeg: 135 },
  raglan: { name: 'Raglan', region: 'Waikato, New Zealand', blurb: 'Classic left point break, one of the most consistent walls in the Southern Hemisphere.', lat: -37.8010, lon: 174.8710, offshoreDeg: 95 },
  puertoescondido: { name: 'Puerto Escondido', region: 'Oaxaca, Mexico', blurb: "Nicknamed the Mexican Pipeline — a powerful, sandy-bottom beach break barrel.", lat: 15.8720, lon: -97.0767, offshoreDeg: 15 },
  hossegor: { name: 'Hossegor', region: 'France', blurb: 'Punchy, powerful Atlantic beach breaks that host a stop on the world tour.', lat: 43.6640, lon: -1.4400, offshoreDeg: 90 },
  mundaka: { name: 'Mundaka', region: 'Basque Country, Spain', blurb: 'A world-class left river-mouth wave that peels around a sandbar.', lat: 43.4070, lon: -2.6990, offshoreDeg: 180 },
  cloudbreak: { name: 'Cloudbreak', region: 'Mamanuca Islands, Fiji', blurb: 'A world-class reef pass left, breaking over shallow coral in the open ocean.', lat: -17.8600, lon: 177.2000, offshoreDeg: 130 },
  skeletonbay: { name: 'Skeleton Bay', region: 'Namibia', blurb: 'A freakishly long, mechanical sand-point left along a remote desert coastline.', lat: -22.9590, lon: 14.4930, offshoreDeg: 165 },
  pavones: { name: 'Pavones', region: 'Golfo Dulce, Costa Rica', blurb: 'One of the longest lefts in the world, wrapping into a jungle-lined bay.', lat: 8.3830, lon: -83.1500, offshoreDeg: 25 },
  fistral: { name: 'Fistral Beach', region: 'Newquay, Cornwall, UK', blurb: "The UK's best-known beach break, exposed to the full force of the Atlantic.", lat: 50.4160, lon: -5.1020, offshoreDeg: 90 },
  anchorpoint: { name: 'Anchor Point', region: 'Taghazout, Morocco', blurb: 'A classic North African right point, long and mellow when it wraps in clean.', lat: 30.5460, lon: -9.7100, offshoreDeg: 85 },
  margaretriver: { name: 'Margaret River', region: 'Western Australia', blurb: 'Powerful, chilly reef and point breaks along a wild stretch of coastline.', lat: -33.9750, lon: 115.0750, offshoreDeg: 90 },
  montauk: { name: 'Montauk', region: 'New York, USA', blurb: 'Classic East Coast beach and reef breaks at the tip of Long Island.', lat: 41.0500, lon: -71.9200, offshoreDeg: 330 },
  arugambay: { name: 'Arugam Bay', region: 'Sri Lanka', blurb: "A long, sandy-bottomed right point on Sri Lanka's east coast.", lat: 6.8400, lon: 81.8300, offshoreDeg: 270 },
  gland: { name: 'G-Land', region: 'East Java, Indonesia', blurb: 'A legendary, remote left reef break inside a jungle bay.', lat: -8.7304, lon: 114.3526, offshoreDeg: 35 },
  siargao: { name: 'Siargao (Cloud 9)', region: 'Philippines', blurb: 'A hollow, powerful reef pass that put the Philippines on the surfing map.', lat: 9.8000, lon: 126.1660, offshoreDeg: 270 },
  ericeira: { name: 'Ericeira', region: 'Portugal', blurb: 'A World Surfing Reserve with a cluster of quality points and reefs.', lat: 38.9630, lon: -9.4160, offshoreDeg: 90 },
  desertpoint: { name: 'Desert Point', region: 'Lombok, Indonesia', blurb: 'One of the fastest, longest tube rides on Earth, over sharp reef.', lat: -8.8900, lon: 116.0400, offshoreDeg: 60 },
  tofino: { name: 'Tofino', region: 'Vancouver Island, Canada', blurb: 'Cold-water Pacific beach breaks framed by old-growth rainforest.', lat: 49.1530, lon: -125.9066, offshoreDeg: 90 },
  joaquina: { name: 'Joaquina', region: 'Florianópolis, Brazil', blurb: 'A popular sandy beach break on Floripa island, consistent and crowd-friendly.', lat: -27.6280, lon: -48.4480, offshoreDeg: 270 },
  puntadelobos: { name: 'Punta de Lobos', region: 'Pichilemu, Chile', blurb: "A powerful, rocky left point on Chile's rugged central coast.", lat: -34.4110, lon: -72.0270, offshoreDeg: 90 },
  shonan: { name: 'Shonan', region: 'Kanagawa, Japan', blurb: "Tokyo's home break — accessible and consistent, a train ride from the city.", lat: 35.3060, lon: 139.4870, offshoreDeg: 0 },
  kovalam: { name: 'Kovalam', region: 'Kerala, India', blurb: "A mellow beach break on India's southwestern coast, warm water year-round.", lat: 8.4004, lon: 76.9787, offshoreDeg: 90 },
  caesarea: { name: 'Caesarea', region: 'Israel', blurb: 'A Mediterranean reef break beside the ruins of an ancient Roman harbor.', lat: 32.5000, lon: 34.9040, offshoreDeg: 90 },
  elcotillo: { name: 'El Cotillo', region: 'Fuerteventura, Canary Islands', blurb: "Wind-sculpted beach breaks on the island's rugged north coast.", lat: 28.6800, lon: -14.0080, offshoreDeg: 165 },
  popoyo: { name: 'Popoyo', region: 'Nicaragua', blurb: "A hollow reef break on Nicaragua's Pacific coast, offshore almost every morning.", lat: 11.4731, lon: -86.1270, offshoreDeg: 90 },
  santacatalina: { name: 'Santa Catalina', region: 'Panama', blurb: "A powerful, rocky point break on Panama's Pacific coast.", lat: 7.6330, lon: -81.2680, offshoreDeg: 85 },
  deadmans: { name: 'Deadmans', region: 'Denmark', blurb: "A cold-water North Sea break in Denmark's surf region, best with a groundswell and light wind.", lat: 57.0500, lon: 8.5100, offshoreDeg: 90 },
  muine: { name: 'Mui Ne', region: 'Vietnam', blurb: 'A wind-exposed stretch of coast better known for kitesurfing, but surfable too.', lat: 10.9330, lon: 108.2830, offshoreDeg: 293 },
  laentrada: { name: 'La Entrada', region: 'Ecuador', blurb: "A sandy beach break at the north end of the Olón beach stretch, gentle and beginner-friendly.", lat: -1.7700, lon: -80.7700, offshoreDeg: 90 },
  montoya: { name: 'Montoya', region: 'Punta del Este, Uruguay', blurb: "A rocky point near Punta del Este, one of Uruguay's better-known breaks.", lat: -34.9500, lon: -54.9300, offshoreDeg: 350 },
  darne: { name: 'Darne', region: 'Mauritius', blurb: "A remote left reef break behind Île des Deux Cocos, inside the island's fringing coral.", lat: -20.4200, lon: 57.7000, offshoreDeg: 0 },
  capesolander: { name: 'Cape Solander', region: 'Sydney, Australia', blurb: "An exposed ledge break on the cliffs at Sydney's Kurnell headland.", lat: -34.0010, lon: 151.2330, offshoreDeg: 270 },
  masnou: { name: 'Masnou', region: 'Catalonia, Spain', blurb: 'A Mediterranean beach break just north of Barcelona, small but rideable on a good day.', lat: 41.4780, lon: 2.3160, offshoreDeg: 315 },
  capomarina: { name: 'Capo Marina', region: 'Genoa, Italy', blurb: 'A rocky point break on the Ligurian coast near Genoa.', lat: 44.4000, lon: 8.9500, offshoreDeg: 5 },
};
const ORDER = ['trestles', 'blacks', 'rincon', 'wedge', 'pipeline', 'teahupoo', 'jbay', 'uluwatu', 'snapper', 'nazare', 'chicama', 'raglan', 'puertoescondido', 'hossegor', 'mundaka', 'cloudbreak', 'skeletonbay', 'pavones', 'fistral', 'anchorpoint', 'margaretriver', 'montauk', 'arugambay', 'gland', 'siargao', 'ericeira', 'desertpoint', 'tofino', 'joaquina', 'puntadelobos', 'shonan', 'kovalam', 'caesarea', 'elcotillo', 'popoyo', 'santacatalina', 'deadmans', 'muine', 'laentrada', 'montoya', 'darne', 'capesolander', 'masnou', 'capomarina'];
const ONBOARDING_PICKS = ['trestles', 'pipeline', 'jbay', 'uluwatu', 'nazare', 'snapper', 'mundaka'];

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
function degToCompass(deg) {
  const idx = Math.round((((deg % 360) + 360) % 360) / 22.5) % 16;
  return COMPASS[idx];
}
function angDiff(a, b) { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }
function windType(windDeg, offshoreDeg) {
  const diff = angDiff(windDeg, offshoreDeg);
  if (diff <= 50) return 'offshore';
  if (diff >= 130) return 'onshore';
  return 'cross';
}
// Same offshore/onshore angle used for the rating, but as a smooth green→yellow→red
// gradient instead of three buckets, for the wind-direction arrows on the week chart.
function windAngleColor(windDeg, offshoreDeg) {
  const diff = angDiff(windDeg, offshoreDeg); // 0 = straight offshore, 180 = straight onshore
  const hue = 120 - (diff / 180) * 120; // 120° green -> 0° red
  return 'hsl(' + Math.round(hue) + ', 72%, 50%)';
}
// Scored rather than a simple nested if/else, so wind direction, wind speed, wave size,
// swell period, and swell/shore alignment all pull the rating up or down together instead
// of one factor (wind direction) overriding everything else. Split into a raw numeric score
// plus a bucketing step so the globe can use the continuous score for a color gradient while
// everything else keeps using the FIRING/GOOD/FAIR/POOR label.
function conditionsScore(waveFt, windMph, type, period, swellDeg, offshoreDeg, tidePosition) {
  let score = 0;

  if (windMph < 3) {
    score += 3; // glassy — direction barely matters at this speed
  } else if (type === 'offshore') {
    if (windMph <= 10) score += 3;
    else if (windMph <= 18) score += 1; // still offshore, but strong enough to hold you back
    else score -= 1; // gale-force offshore creates its own chop and makes paddling out hard
  } else if (type === 'cross') {
    if (windMph <= 8) score += 1;
    else if (windMph <= 15) score += 0;
    else score -= 2;
  } else {
    if (windMph <= 6) score += 1; // light onshore, barely textured
    else if (windMph <= 12) score -= 1;
    else score -= 3;
  }

  if (waveFt >= 4) score += 2;
  else if (waveFt >= 2.5) score += 1;

  if (period != null) {
    if (period >= 12) score += 2; // long-period groundswell — powerful, well-groomed
    else if (period >= 9) score += 1;
    else if (period < 7) score -= 1; // short-period wind swell — weak, choppy
  }

  // Approximate "does the swell actually hit this spot" using the same offshore-direction
  // data collected when the spot was added — the ideal swell window is roughly opposite the
  // offshore wind direction. Coastlines aren't perfectly straight, so this is a rough proxy,
  // not a substitute for real per-spot swell-window data.
  if (swellDeg != null && offshoreDeg != null) {
    const idealSwellDeg = (offshoreDeg + 180) % 360;
    const off = angDiff(swellDeg, idealSwellDeg);
    if (off <= 35) score += 2;
    else if (off <= 70) score += 0;
    else score -= 2;
  }

  // Tide: with no per-spot "works best at X tide" data, the only generically defensible
  // signal is distance from today's own mid-tide — many breaks get too full/soft at peak
  // high and too shallow/exposed at peak low, while mid-tide is the safest broad guess.
  // Kept deliberately small (±1) since this is the least certain factor in the score.
  if (tidePosition != null) {
    const distFromMid = Math.abs(tidePosition - 0.5); // 0 = exactly mid, 0.5 = a dead extreme
    if (distFromMid <= 0.15) score += 1;
    else if (distFromMid >= 0.4) score -= 1;
  }

  return score;
}
function scoreToRating(score) {
  if (score >= 6) return 'FIRING';
  if (score >= 3) return 'GOOD';
  if (score >= 0) return 'FAIR';
  return 'POOR';
}
function rateConditions(waveFt, windMph, type, period, swellDeg, offshoreDeg) {
  return scoreToRating(conditionsScore(waveFt, windMph, type, period, swellDeg, offshoreDeg));
}
// Continuous POOR→FIRING gradient (red→green) for the globe markers, built from the same
// raw score the rating badges bucket into four labels. Guarded against NaN/undefined: an
// invalid hsl() string (e.g. "hsl(NaN, ...)") fails Three.js's color parser silently, which
// would leave a marker stuck on whatever color it had before — this makes sure that can't happen.
function scoreToColor(score) {
  const s = Number.isFinite(score) ? score : 0;
  const t = Math.max(0, Math.min(1, (s + 5) / 15)); // score roughly spans -5..10
  const hue = t * 140; // 0° red -> 140° green
  return 'hsl(' + Math.round(hue) + ', 68%, 50%)';
}

// Believable stand-in numbers shown the instant a spot opens, before the real Open-Meteo
// fetch resolves (or if it fails) — so the screen never looks blank or obviously fake-empty.
// The rating stays 'LOADING' (drives the "FETCHING…" badge and globe "···" label honestly);
// only the numbers/shape are dressed up.
const PLACEHOLDER_HOURS = [
  { t: '5a', wave: '3-4', period: 11, swellDir: 'SW', swellDeg: 225, windSpd: 4, windDir: 'E', windDeg: 90, type: 'offshore', rating: 'LOADING' },
  { t: '7a', wave: '3-5', period: 12, swellDir: 'SW', swellDeg: 222, windSpd: 5, windDir: 'E', windDeg: 90, type: 'offshore', rating: 'LOADING' },
  { t: '9a', wave: '4-5', period: 12, swellDir: 'SW', swellDeg: 220, windSpd: 6, windDir: 'NE', windDeg: 45, type: 'offshore', rating: 'LOADING' },
  { t: '11a', wave: '3-5', period: 11, swellDir: 'SW', swellDeg: 218, windSpd: 8, windDir: 'N', windDeg: 0, type: 'cross', rating: 'LOADING' },
  { t: '1p', wave: '3-4', period: 10, swellDir: 'W', swellDeg: 260, windSpd: 11, windDir: 'W', windDeg: 270, type: 'onshore', rating: 'LOADING' },
  { t: '3p', wave: '2-4', period: 10, swellDir: 'W', swellDeg: 262, windSpd: 13, windDir: 'W', windDeg: 270, type: 'onshore', rating: 'LOADING' },
  { t: '5p', wave: '2-3', period: 9, swellDir: 'W', swellDeg: 258, windSpd: 10, windDir: 'SW', windDeg: 225, type: 'onshore', rating: 'LOADING' },
  { t: '7p', wave: '2-3', period: 10, swellDir: 'SW', swellDeg: 230, windSpd: 5, windDir: 'E', windDeg: 90, type: 'offshore', rating: 'LOADING' },
];
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// A plausible-looking stand-in tide curve (real tide is fetched live below) so the
// TIDE card never looks flat/empty before data arrives.
const PLACEHOLDER_TIDE_TODAY = HOUR_LABELS.map((_, i) => 2.6 + Math.sin((i / 7) * Math.PI * 2 - 0.6) * 1.7);
const PLACEHOLDER_TIDE_NEXT = { type: 'High', hour: 14 };
function nextTideEvent(tideFine, fromHour) {
  if (!tideFine || tideFine.length < 3) return null;
  for (let i = 1; i < tideFine.length - 1; i++) {
    if (tideFine[i].hour <= fromHour) continue;
    const prev = tideFine[i - 1].ft, cur = tideFine[i].ft, next = tideFine[i + 1].ft;
    if (cur > prev && cur > next) return { type: 'High', hour: tideFine[i].hour };
    if (cur < prev && cur < next) return { type: 'Low', hour: tideFine[i].hour };
  }
  return null;
}
const PLACEHOLDER_CONTINUOUS = (() => {
  const pts = [];
  const now = new Date();
  for (let i = 0; i < 56; i++) {
    const hour = (i * 3) % 24;
    const dayOffset = Math.floor((i * 3) / 24);
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset);
    const wave = 3.3 + Math.sin(i / 4.5) * 1.4 + Math.sin(i / 13 + 1) * 0.7;
    const tide = 2.6 + Math.sin(((i * 3) / 12.4) * Math.PI * 2) * 1.7;
    const windSpd = 9 + Math.sin(i / 5 + 2) * 6;
    const windDeg = (90 + Math.sin(i / 9) * 60 + 360) % 360;
    pts.push({
      waveFt: Math.max(1.2, wave),
      tideFt: tide,
      windSpd: Math.round(Math.max(2, windSpd)),
      windDeg: Math.round(windDeg),
      day: DAY_LABELS[d.getDay()],
      hour,
      dayStart: hour < 3,
    });
  }
  return pts;
})();

async function fetchSpotForecast(spot) {
  const marineUrl = 'https://marine-api.open-meteo.com/v1/marine?latitude=' + spot.lat + '&longitude=' + spot.lon +
    '&hourly=wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period,sea_level_height_msl&daily=wave_height_max&timezone=auto&forecast_days=7';
  const windUrl = 'https://api.open-meteo.com/v1/forecast?latitude=' + spot.lat + '&longitude=' + spot.lon +
    '&hourly=wind_speed_10m,wind_direction_10m&timezone=auto&forecast_days=7';
  const [marineRes, windRes] = await Promise.all([fetch(marineUrl), fetch(windUrl)]);
  if (!marineRes.ok || !windRes.ok) throw new Error('Forecast request failed');
  const marine = await marineRes.json();
  const wind = await windRes.json();

  // Today's tide range, computed up front so each hour can be scored by how close it sits
  // to today's own mid-tide (see conditionsScore) — not an absolute tide height.
  const mhForTide = marine.hourly || {};
  const seaToday = HOUR_INDICES.map((idx) => (mhForTide.sea_level_height_msl ? mhForTide.sea_level_height_msl[idx] : null));
  const validTidesToday = seaToday.filter((v) => v != null);
  const tMin = validTidesToday.length ? Math.min(...validTidesToday) : null;
  const tMax = validTidesToday.length ? Math.max(...validTidesToday) : null;

  const hours = HOUR_INDICES.map((idx, i) => {
    const mh = marine.hourly || {};
    const wh = mh.wave_height ? mh.wave_height[idx] : null;
    const wp = mh.wave_period ? mh.wave_period[idx] : null;
    const wdir = mh.wave_direction ? mh.wave_direction[idx] : null;
    const sp = mh.swell_wave_period ? mh.swell_wave_period[idx] : null;
    const sd = mh.swell_wave_direction ? mh.swell_wave_direction[idx] : null;
    const whh = wind.hourly || {};
    const ws = whh.wind_speed_10m ? whh.wind_speed_10m[idx] : null;
    const wdd = whh.wind_direction_10m ? whh.wind_direction_10m[idx] : null;
    if (wh == null || ws == null || wdd == null) throw new Error('Incomplete forecast data');
    const waveFt = wh * 3.28084;
    const windMph = ws * 0.621371;
    const period = sp != null ? Math.round(sp) : Math.round(wp != null ? wp : 0);
    const swellDeg = sd != null ? sd : (wdir != null ? wdir : 0);
    const type = windType(wdd, spot.offshoreDeg);
    const tideVal = seaToday[i];
    const tidePosition = (tideVal != null && tMin != null && tMax != null && tMax > tMin) ? (tideVal - tMin) / (tMax - tMin) : null;
    const score = conditionsScore(waveFt, windMph, type, period, swellDeg, spot.offshoreDeg, tidePosition);
    const base = Math.max(1, Math.round(waveFt));
    return {
      t: HOUR_LABELS[i], wave: Math.max(1, base - 1) + '-' + (base + 1), period,
      swellDir: degToCompass(swellDeg), swellDeg, windSpd: Math.round(windMph),
      windDir: degToCompass(wdd), windDeg: wdd, type, score, rating: scoreToRating(score),
    };
  });

  const daily = marine.daily || {};
  const dayTimes = daily.time || [];
  const dayWave = daily.wave_height_max || [];
  const weekly = dayTimes.map((dateStr, i) => {
    const waveM = dayWave[i];
    const d = new Date(dateStr + 'T00:00:00');
    return { day: DAY_LABELS[d.getDay()], waveFt: waveM != null ? waveM * 3.28084 : 0 };
  });

  const hAll = marine.hourly || {};
  const timesAll = hAll.time || [];
  const waveAll = hAll.wave_height || [];
  const periodAll = hAll.swell_wave_period || hAll.wave_period || [];
  const swellDirAll = hAll.swell_wave_direction || hAll.wave_direction || [];
  const windAllH = wind.hourly || {};
  const windSpeedAll = windAllH.wind_speed_10m || [];
  const windDirAll = windAllH.wind_direction_10m || [];
  // Live sea-level curve from the same marine call — this is a modeled tide (referenced to
  // global mean sea level, not a nautical chart datum), so heights won't match an official
  // tide table exactly, but the rise/fall shape and high/low timing are real.
  const seaAll = hAll.sea_level_height_msl || [];
  const continuous = [];
  for (let idx = 0; idx < timesAll.length; idx += 3) {
    if (waveAll[idx] == null) continue;
    const d = new Date(timesAll[idx]);
    const cWaveFt = waveAll[idx] * 3.28084;
    const cWindMph = windSpeedAll[idx] != null ? windSpeedAll[idx] * 0.621371 : null;
    const cWindDeg = windDirAll[idx] != null ? windDirAll[idx] : null;
    const cPeriod = periodAll[idx] != null ? Math.round(periodAll[idx]) : null;
    const cSwellDeg = swellDirAll[idx] != null ? swellDirAll[idx] : null;
    const cType = cWindDeg != null ? windType(cWindDeg, spot.offshoreDeg) : null;
    // No per-day tide range computed out here (would mean tracking a min/max per day across
    // the whole week), so this leaves tide out of the week-ahead score — the same score used
    // for today already includes it, just not this longer-range one.
    const cScore = cWindMph != null ? conditionsScore(cWaveFt, cWindMph, cType, cPeriod, cSwellDeg, spot.offshoreDeg, null) : null;
    continuous.push({
      waveFt: cWaveFt,
      tideFt: seaAll[idx] != null ? seaAll[idx] * 3.28084 : null,
      windSpd: cWindMph != null ? Math.round(cWindMph) : null,
      windDeg: cWindDeg,
      score: cScore,
      rating: cScore != null ? scoreToRating(cScore) : null,
      day: DAY_LABELS[d.getDay()],
      hour: d.getHours(),
      dayStart: d.getHours() < 2,
    });
  }

  const tideToday = HOUR_INDICES.map((idx) => (seaAll[idx] != null ? seaAll[idx] * 3.28084 : null));
  const tideFine = [];
  for (let i = 0; i < Math.min(24, timesAll.length); i++) {
    if (seaAll[i] == null) continue;
    tideFine.push({ hour: i, ft: seaAll[i] * 3.28084 });
  }

  return { hours, weekly, continuous, tideToday, tideFine };
}

async function geocodePlace(query) {
  const url = 'https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(query) + '&count=1&language=en&format=json';
  const res = await fetch(url);
  if (!res.ok) throw new Error('Geocoding failed');
  const data = await res.json();
  if (!data.results || !data.results.length) throw new Error('No results');
  const r = data.results[0];
  const region = [r.admin1, r.country].filter(Boolean).join(', ');
  return { name: r.name, region, lat: r.latitude, lon: r.longitude };
}

function toRad(d) { return (d * Math.PI) / 180; }
function toDeg(r) { return (r * 180) / Math.PI; }
function bearingBetween(lat1, lon1, lat2, lon2) {
  const p1 = toRad(lat1), p2 = toRad(lat2), dl = toRad(lon2 - lon1);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}
function metersXY(lat, lon, refLat) {
  const R = 6371000;
  return [toRad(lon) * Math.cos(toRad(refLat)) * R, toRad(lat) * R];
}
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}
async function findOffshoreDirection(lat, lon) {
  const q = '[out:json][timeout:20];way["natural"="coastline"](around:4000,' + lat + ',' + lon + ');out geom;';
  const url = 'https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(q);
  const res = await fetch(url);
  if (!res.ok) throw new Error('Coastline lookup failed');
  const data = await res.json();
  const ways = (data.elements || []).filter((el) => el.geometry && el.geometry.length > 1);
  if (!ways.length) throw new Error('No coastline found nearby');
  const [px, py] = metersXY(lat, lon, lat);
  let best = null;
  ways.forEach((way) => {
    const g = way.geometry;
    for (let i = 0; i < g.length - 1; i++) {
      const [ax, ay] = metersXY(g[i].lat, g[i].lon, lat);
      const [bx, by] = metersXY(g[i + 1].lat, g[i + 1].lon, lat);
      const d = segDist(px, py, ax, ay, bx, by);
      if (!best || d < best.d) best = { d, a: g[i], b: g[i + 1] };
    }
  });
  if (!best) throw new Error('No coastline segment found');
  const alongBearing = bearingBetween(best.a.lat, best.a.lon, best.b.lat, best.b.lon);
  const seaward = (alongBearing + 90) % 360;
  return Math.round((seaward + 180) % 360);
}

function ratingBg(r) {
  if (r === 'FIRING') return COLORS.tealBright;
  if (r === 'GOOD') return COLORS.teal;
  if (r === 'FAIR') return COLORS.gold;
  if (r === 'LOADING') return '#33465C';
  return COLORS.poor;
}
function ratingText(r) {
  if (r === 'POOR') return COLORS.foam;
  if (r === 'LOADING') return COLORS.foamDim;
  return COLORS.navy;
}
function formatWaveRange(str, units) {
  const parts = String(str).split('-').map(Number);
  if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) return str;
  if (units === 'metric') return (parts[0] * 0.3048).toFixed(1) + '-' + (parts[1] * 0.3048).toFixed(1);
  return parts[0] + '-' + parts[1];
}
function formatWaveNum(ft, units) {
  return units === 'metric' ? (ft * 0.3048).toFixed(1) : Math.round(ft);
}
function formatHeight(ft, units) {
  return units === 'metric' ? (ft * 0.3048).toFixed(1) : ft.toFixed(1);
}
function formatSpeed(mph, units) {
  return units === 'metric' ? Math.round(mph * 1.60934) : mph;
}
function waveUnit(units) { return units === 'metric' ? 'M' : 'FT'; }
function heightUnit(units) { return units === 'metric' ? 'm' : 'ft'; }
function speedUnit(units) { return units === 'metric' ? 'kph' : 'mph'; }
function windColor(type) {
  if (type === 'offshore') return COLORS.tealBright;
  if (type === 'onshore') return COLORS.coral;
  return COLORS.gold;
}
function barHeight(wave) {
  const parts = String(wave).split('-').map(Number);
  if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) return 10;
  const avg = (parts[0] + parts[1]) / 2;
  return 8 + avg * 3;
}
function hourLabel12(h) {
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return h12 + (h < 12 ? 'a' : 'p');
}
function waveAvg(wave) {
  const parts = String(wave).split('-').map(Number);
  if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) return 0;
  return (parts[0] + parts[1]) / 2;
}
function linePath(values, width, height, pad) {
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * (width - pad * 2) + pad;
    const y = height - pad - ((v - min) / range) * (height - pad * 2);
    return [x, y];
  });
  const d = pts.map((p, i) => (i === 0 ? 'M' + p[0] + ',' + p[1] : 'L' + p[0] + ',' + p[1])).join(' ');
  return { pts, d };
}
// ---------- Flat instrument-chart map — equirectangular projection, plain SVG.
// (Replaces an earlier 3D WebGL globe that never rendered its live marker colors reliably;
// this is plain React state driving plain SVG, so there's no separate sync step to go stale.)
// Real coastline polygons (Natural Earth 110m land, via world-atlas) — see
// scripts/build-landmasses.mjs. Each ring is a closed loop of [lat, lon]
// points, already detailed enough to draw directly with no synthetic
// smoothing (unlike the hand-approximated polygons this replaced).
function latLonToVector3(lat, lon, radius) {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  );
}

// A labeled, color-coded POOR→FAIR→GOOD→FIRING scale with a marker at the exact score
// position — same continuous score the globe's gradient uses, just shown as a bar instead
// of a hue. Reused on the home hero and in the globe's legend so both speak the same visual
// language instead of the globe using a gradient and the home page using a flat text badge.
function ConditionScale({ score, compact }) {
  const hasScore = score != null && Number.isFinite(score);
  const t = Math.max(0, Math.min(1, ((hasScore ? score : 0) + 5) / 15));
  const segments = [
    { label: 'POOR', color: COLORS.poor },
    { label: 'FAIR', color: COLORS.gold },
    { label: 'GOOD', color: COLORS.teal },
    { label: 'FIRING', color: COLORS.tealBright },
  ];
  return (
    <div>
      <div style={{ display: 'flex', height: compact ? 5 : 6, borderRadius: 3, overflow: 'visible', position: 'relative' }}>
        {segments.map((s, i) => (
          <div key={s.label} style={{ flex: 1, background: s.color, borderRadius: i === 0 ? '3px 0 0 3px' : i === segments.length - 1 ? '0 3px 3px 0' : 0 }} />
        ))}
        {hasScore && (
          <div style={{ position: 'absolute', left: (t * 100) + '%', top: -3, width: 2, height: (compact ? 5 : 6) + 6, background: COLORS.foam, borderRadius: 1, transform: 'translateX(-1px)', boxShadow: '0 0 0 1px rgba(7,15,24,0.6)' }} />
        )}
      </div>
      {!compact && (
        <div className="flex justify-between" style={{ marginTop: 4 }}>
          {segments.map((s) => (
            <span key={s.label} style={{ fontSize: 8.5, color: COLORS.foamDim, letterSpacing: '0.03em' }}>{s.label}</span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [spots, setSpots] = useState(SPOTS);
  const [order, setOrder] = useState(ORDER);
  const [activeId, setActiveId] = useState('trestles');
  const [goToId, setGoToId] = useState('trestles');
  const [hourIdx, setHourIdx] = useState(1);
  const [contSelectedIdx, setContSelectedIdx] = useState(null);
  const [toast, setToast] = useState('');
  const [forecast, setForecast] = useState({});
  const [loadingIds, setLoadingIds] = useState(() => new Set(ORDER));
  const [errorIds, setErrorIds] = useState(() => new Set());
  const [view, setView] = useState('home');

  const [searchOpen, setSearchOpen] = useState(false);
  const [onboarded, setOnboarded] = useState(true);
  const [globeError, setGlobeError] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchStep, setSearchStep] = useState('query');
  const [searchError, setSearchError] = useState('');
  const [pending, setPending] = useState(null);

  const [alerts, setAlerts] = useState([]);
  const [alertSheetOpen, setAlertSheetOpen] = useState(false);
  const [alertDraft, setAlertDraft] = useState(null);
  const [units, setUnits] = useState('imperial');

  const globeContainerRef = useRef(null);
  const dataRef = useRef({ spots, order, forecast, hourIdx });
  useEffect(() => { dataRef.current = { spots, order, forecast, hourIdx }; });

  const loadSpotData = useCallback(async (id, spotObj) => {
    setLoadingIds((prev) => new Set(prev).add(id));
    setErrorIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
    try {
      const result = await fetchSpotForecast(spotObj);
      setForecast((prev) => ({ ...prev, [id]: result }));
    } catch (e) {
      setErrorIds((prev) => new Set(prev).add(id));
    } finally {
      setLoadingIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const chunkSize = 5;
      for (let i = 0; i < ORDER.length; i += chunkSize) {
        if (cancelled) return;
        const chunk = ORDER.slice(i, i + chunkSize);
        await Promise.all(chunk.map((id) => loadSpotData(id, SPOTS[id])));
      }
    })();
    return () => { cancelled = true; };
  }, [loadSpotData]);

  // load any spots saved earlier ("database")
  useEffect(() => {
    (async () => {
      try {
        const res = await storage.get('surf-spots');
        const saved = res && res.value ? JSON.parse(res.value) : [];
        if (Array.isArray(saved) && saved.length) {
          setSpots((prev) => { const merged = { ...prev }; saved.forEach((s) => { merged[s.id] = s; }); return merged; });
          setOrder((prev) => { const ids = saved.map((s) => s.id).filter((id) => !prev.includes(id)); return [...prev, ...ids]; });
          saved.forEach((s) => loadSpotData(s.id, s));
        }
      } catch (e) { /* nothing saved yet */ }
    })();
  }, [loadSpotData]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(''), 1700);
    return () => clearTimeout(id);
  }, [toast]);

  useEffect(() => { setContSelectedIdx(null); }, [activeId]);

  useEffect(() => {
    (async () => {
      try {
        const res = await storage.get('surf-alerts');
        const saved = res && res.value ? JSON.parse(res.value) : [];
        if (Array.isArray(saved)) setAlerts(saved);
      } catch (e) { /* nothing saved yet */ }
    })();
    (async () => {
      try {
        const res = await storage.get('surf-units');
        if (res && (res.value === 'metric' || res.value === 'imperial')) setUnits(res.value);
      } catch (e) { /* nothing saved yet */ }
    })();
    (async () => {
      try {
        const res = await storage.get('surf-onboarded');
        if (!res || res.value !== 'true') setOnboarded(false);
      } catch (e) { setOnboarded(false); } // missing key = never onboarded
    })();
  }, []);

  function toggleUnits() {
    const next = units === 'imperial' ? 'metric' : 'imperial';
    setUnits(next);
    storage.set('surf-units', next).catch(() => {});
  }

  function completeOnboarding(id) {
    setGoToId(id);
    setOnboarded(true);
    storage.set('surf-onboarded', 'true').catch(() => {});
  }
  function pickOnboardingSpot(id) {
    setActiveId(id);
    completeOnboarding(id);
  }

  async function persistAlerts(next) {
    try { await storage.set('surf-alerts', JSON.stringify(next)); } catch (e) { /* best-effort */ }
  }

  // live feed: keep every spot's forecast current, not just a one-time fetch on open
  useEffect(() => {
    const interval = setInterval(() => {
      dataRef.current.order.forEach((id) => { loadSpotData(id, dataRef.current.spots[id]); });
    }, 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, [loadSpotData]);

  const spot = spots[activeId];
  const spotForecast = forecast[activeId];
  const hourData = (spotForecast && spotForecast.hours) || PLACEHOLDER_HOURS;
  const contData = (spotForecast && spotForecast.continuous && spotForecast.continuous.length ? spotForecast.continuous : PLACEHOLDER_CONTINUOUS);
  const contWaveLine = linePath(contData.map((p) => p.waveFt), 300, 70, 10);
  const contTideLine = linePath(contData.map((p) => (p.tideFt != null ? p.tideFt : 0)), 300, 70, 10);
  const contWindLine = linePath(contData.map((p) => (p.windSpd != null ? p.windSpd : 0)), 300, 70, 10);
  const contSelected = contSelectedIdx != null ? contData[contSelectedIdx] : null;
  const h = hourData[hourIdx];
  const isGoTo = activeId === goToId;
  const others = order.filter((id) => id !== activeId);
  const tideToday = (spotForecast && spotForecast.tideToday && spotForecast.tideToday.every((v) => v != null)) ? spotForecast.tideToday : PLACEHOLDER_TIDE_TODAY;
  const tideNext = (spotForecast && spotForecast.tideFine && spotForecast.tideFine.length) ? nextTideEvent(spotForecast.tideFine, HOUR_INDICES[hourIdx]) : PLACEHOLDER_TIDE_NEXT;
  const tide = linePath(tideToday, 100, 34, 4);
  const waveChart = linePath(hourData.map((hr) => waveAvg(hr.wave)), 300, 56, 8);
  const isLoading = loadingIds.has(activeId);
  const hasError = errorIds.has(activeId);

  function makeGoTo() { if (!isGoTo) { setGoToId(activeId); setToast(spot.name + ' set as your go-to spot'); } }
  function handleNav(label) {
    if (label === 'home') { setView('home'); setActiveId(goToId); setHourIdx(1); }
    else if (label === 'map') { setView('globe'); }
    else if (label === 'alerts') { setView('alerts'); }
    else if (label === 'profile') { setView('profile'); }
    else { setToast('Part of the full app — not in this preview'); }
  }

  function leadTimeLabel(lt) {
    if (lt === '1h') return '1 hour before';
    if (lt === '1d') return '1 day before';
    if (lt === '2d') return '2 days before';
    return '3 days before';
  }
  function checkAlertMatch(alert) {
    const sf = forecast[alert.spotId];
    if (!sf) return null;
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
    const hit = daySamples.find((p) => p.waveFt >= alert.minWaveFt && p.rating && p.rating !== 'POOR');
    if (hit) return { hit: true, text: 'Matches ' + hit.day + ' — ' + hit.rating.toLowerCase() + ' conditions' };
    const bigButBlownOut = daySamples.find((p) => p.waveFt >= alert.minWaveFt);
    if (bigButBlownOut) return { hit: false, text: bigButBlownOut.day + ' has the size but wind looks poor' };
    return { hit: false, text: 'No match ' + daySamples[0].day + ' yet' };
  }
  function openNewAlert() {
    setAlertDraft({ spotId: goToId, minWaveFt: 3, leadTime: '1d' });
    setAlertSheetOpen(true);
  }
  function closeAlertSheet() { setAlertSheetOpen(false); setAlertDraft(null); }
  function saveAlert() {
    if (!alertDraft) return;
    const next = [...alerts, { id: 'alert-' + Date.now(), ...alertDraft }];
    setAlerts(next);
    persistAlerts(next);
    closeAlertSheet();
  }
  function deleteAlert(id) {
    const next = alerts.filter((a) => a.id !== id);
    setAlerts(next);
    persistAlerts(next);
  }

  function closeSearch() { setSearchOpen(false); setSearchStep('query'); setSearchQuery(''); setSearchError(''); setPending(null); }
  async function runSearch() {
    if (!searchQuery.trim()) return;
    setSearchStep('loading');
    try {
      const place = await geocodePlace(searchQuery.trim());
      let offshoreDeg = 0, guessed = true;
      try { offshoreDeg = await findOffshoreDirection(place.lat, place.lon); } catch (e) { guessed = false; }
      setPending({ ...place, offshoreDeg, guessed });
      setSearchStep('confirm');
    } catch (e) {
      setSearchError("Couldn't find that place — try a different spelling.");
      setSearchStep('error');
    }
  }
  function nudge(delta) { setPending((prev) => prev && ({ ...prev, offshoreDeg: (prev.offshoreDeg + delta + 360) % 360 })); }
  async function confirmAddSpot() {
    if (!pending) return;
    const id = 'custom-' + Date.now();
    const newSpot = {
      id, name: pending.name, region: pending.region || 'Added spot',
      blurb: pending.guessed ? 'Offshore direction estimated from the coastline shape.' : "Coastline not found nearby — direction wasn't auto-detected, adjust if it looks off.",
      lat: pending.lat, lon: pending.lon, offshoreDeg: pending.offshoreDeg,
    };
    setSpots((prev) => ({ ...prev, [id]: newSpot }));
    setOrder((prev) => [...prev, id]);
    setActiveId(id);
    closeSearch();
    loadSpotData(id, newSpot);
    if (!onboarded) completeOnboarding(id);
    try {
      let existing = [];
      try { const res = await storage.get('surf-spots'); existing = res && res.value ? JSON.parse(res.value) : []; } catch (e) { existing = []; }
      existing.push(newSpot);
      await storage.set('surf-spots', JSON.stringify(existing));
    } catch (e) { /* saving is best-effort */ }
  }

  function setGoToSpot(id) {
    setGoToId(id);
    const s = spots[id];
    if (s) setToast(s.name + ' set as your go-to spot');
  }

  async function removeSpot(id) {
    if (order.length <= 1) { setToast('Keep at least one spot'); return; }
    const nextOrder = order.filter((oid) => oid !== id);
    setOrder(nextOrder);
    setSpots((prev) => { const next = { ...prev }; delete next[id]; return next; });
    if (activeId === id) setActiveId(nextOrder[0]);
    if (goToId === id) setGoToId(nextOrder[0]);
    try {
      const res = await storage.get('surf-spots');
      const existing = res && res.value ? JSON.parse(res.value) : [];
      const next = existing.filter((s) => s.id !== id);
      await storage.set('surf-spots', JSON.stringify(next));
    } catch (e) { /* best-effort */ }
  }

  // ---- Globe lifecycle ----
  useEffect(() => {
    if (view !== 'globe' || !globeContainerRef.current) return undefined;
    const container = globeContainerRef.current;
    // Wrapping all of setup in try/catch: if WebGL context creation or anything else here
    // throws, we've had no way to see that failure before now — it would just leave a blank
    // or broken canvas with nothing telling us why. This at least surfaces it.
    try {
    const width = container.clientWidth || 340;
    const height = container.clientHeight || 420;
    const R = 1;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.4, 20);
    const state = { distance: 3.0, rotX: 0.3, rotY: 0.6, dragging: false, lastX: 0, lastY: 0, pinchDist: null, raf: null };
    camera.position.set(0, 0, state.distance);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, logarithmicDepthBuffer: true });
    // outputEncoding/sRGBEncoding was renamed to outputColorSpace/SRGBColorSpace in newer
    // Three.js and removed entirely in later versions — set whichever this build actually has.
    if ('outputColorSpace' in renderer && THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;
    else if ('outputEncoding' in renderer && THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 3));
    container.appendChild(renderer.domElement);
    setGlobeError(false);

    const globeGroup = new THREE.Group();
    scene.add(globeGroup);

    const mapW = 2048, mapH = 1024;
    const mapCanvas = document.createElement('canvas');
    mapCanvas.width = mapW; mapCanvas.height = mapH;
    const mctx = mapCanvas.getContext('2d');
    const oceanGrad = mctx.createLinearGradient(0, 0, 0, mapH);
    oceanGrad.addColorStop(0, '#0a2440');
    oceanGrad.addColorStop(0.5, '#175a82');
    oceanGrad.addColorStop(1, '#0a2440');
    mctx.fillStyle = oceanGrad;
    mctx.fillRect(0, 0, mapW, mapH);
    function toPx(lat, lon) { return [((lon + 180) / 360) * mapW, ((90 - lat) / 180) * mapH]; }
    mctx.fillStyle = '#5c8c56';
    mctx.strokeStyle = 'rgba(18,36,26,0.5)';
    mctx.lineWidth = 2.5;
    LANDMASSES.forEach((pts) => {
      // A handful of rings (Russia, Antarctica, Fiji) were unwrapped past
      // ±180° during data prep so their coastline stays contiguous — that
      // pushes some of their x coordinates outside the canvas. Painting
      // each ring three times, shifted a full map-width left/right, covers
      // the wraparound correctly wherever it actually lands on-canvas.
      [-mapW, 0, mapW].forEach((xOffset) => {
        mctx.beginPath();
        pts.forEach(([lat, lon], i) => {
          const [x, y] = toPx(lat, lon);
          const px = x + xOffset;
          if (i === 0) mctx.moveTo(px, y); else mctx.lineTo(px, y);
        });
        mctx.closePath();
        mctx.fill();
        mctx.stroke();
      });
    });
    mctx.strokeStyle = 'rgba(244,247,246,0.13)';
    mctx.lineWidth = 1;
    for (let lat = -60; lat <= 60; lat += 30) {
      const [, y] = toPx(lat, 0);
      mctx.beginPath(); mctx.moveTo(0, y); mctx.lineTo(mapW, y); mctx.stroke();
    }
    for (let lon = -150; lon <= 180; lon += 30) {
      const [x] = toPx(0, lon);
      mctx.beginPath(); mctx.moveTo(x, 0); mctx.lineTo(x, mapH); mctx.stroke();
    }
    const mapTexture = new THREE.CanvasTexture(mapCanvas);
    // A flat texture wrapped on a sphere gets viewed at steep angles near the edges of what's
    // visible, which is exactly the case anisotropic filtering is for — without it, those
    // regions look noticeably blurrier/blockier than the center, which reads as "pixelated".
    mapTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    mapTexture.minFilter = THREE.LinearMipmapLinearFilter;
    mapTexture.magFilter = THREE.LinearFilter;
    mapTexture.generateMipmaps = true;
    const oceanMat = new THREE.MeshPhongMaterial({ map: mapTexture, shininess: 14, specular: 0x1a3a4a });
    const oceanMesh = new THREE.Mesh(new THREE.SphereGeometry(R, 96, 96), oceanMat);
    globeGroup.add(oceanMesh);

    scene.add(new THREE.AmbientLight(0xbcd4e0, 0.55));
    const dirLight = new THREE.DirectionalLight(0xfff2d8, 0.95);
    dirLight.position.set(3, 2, 4);
    scene.add(dirLight);
    const fillLight = new THREE.DirectionalLight(0x4fccb8, 0.18);
    fillLight.position.set(-3, -1, -2);
    scene.add(fillLight);

    // starfield backdrop
    const starCount = 260;
    const starPositions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const r = 7 + Math.random() * 2.5;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      starPositions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      starPositions[i * 3 + 2] = r * Math.cos(phi);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    // THREE.PointsMaterial with no sprite texture renders each point as a hard-edged square —
    // at this small a size that reads as "pixelated" flecks rather than soft stars, so give it
    // a small radial-gradient dot texture instead (same technique as the atmosphere glow below).
    const starDotCanvas = document.createElement('canvas');
    starDotCanvas.width = 32; starDotCanvas.height = 32;
    const sdctx = starDotCanvas.getContext('2d');
    const starDotGrad = sdctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    starDotGrad.addColorStop(0, 'rgba(255,255,255,1)');
    starDotGrad.addColorStop(0.4, 'rgba(255,255,255,0.8)');
    starDotGrad.addColorStop(1, 'rgba(255,255,255,0)');
    sdctx.fillStyle = starDotGrad;
    sdctx.fillRect(0, 0, 32, 32);
    const starDotTexture = new THREE.CanvasTexture(starDotCanvas);
    const starMat = new THREE.PointsMaterial({ map: starDotTexture, color: 0xdfeaf2, size: 0.05, transparent: true, opacity: 0.85, sizeAttenuation: true, depthWrite: false });
    const stars = new THREE.Points(starGeo, starMat);
    scene.add(stars);

    // soft teal atmosphere glow behind the globe
    const glowCanvas = document.createElement('canvas');
    glowCanvas.width = 256; glowCanvas.height = 256;
    const gctx = glowCanvas.getContext('2d');
    const glowGrad = gctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    glowGrad.addColorStop(0, 'rgba(79,204,184,0.5)');
    glowGrad.addColorStop(0.45, 'rgba(79,204,184,0.2)');
    glowGrad.addColorStop(1, 'rgba(79,204,184,0)');
    gctx.fillStyle = glowGrad;
    gctx.fillRect(0, 0, 256, 256);
    const glowTexture = new THREE.CanvasTexture(glowCanvas);
    const glowMat = new THREE.SpriteMaterial({ map: glowTexture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const glowSprite = new THREE.Sprite(glowMat);
    glowSprite.scale.set(2.7, 2.7, 1);
    scene.add(glowSprite);

    const markers = [];
    order.forEach((id) => {
      const s = spots[id];
      if (!s) return;
      const localPos = latLonToVector3(s.lat, s.lon, R * 1.045);
      const geo = new THREE.SphereGeometry(0.026, 12, 12);
      const mat = new THREE.MeshBasicMaterial({ color: '#33465C' });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(localPos);
      globeGroup.add(mesh);

      const label = document.createElement('div');
      label.className = 'tl-label';
      label.textContent = s.name;
      container.appendChild(label);

      markers.push({ id, mesh, label, basePos: localPos });
    });

    function updateLabels() {
      const camDir = camera.position.clone().normalize();
      markers.forEach((m) => {
        const worldPos = m.basePos.clone().applyEuler(globeGroup.rotation);
        const facing = worldPos.clone().normalize().dot(camDir);
        const zoomedIn = state.distance < 2.2;
        if (facing > 0.28 && zoomedIn) {
          const proj = worldPos.clone().project(camera);
          m.label.style.display = 'block';
          m.label.style.left = ((proj.x * 0.5 + 0.5) * width) + 'px';
          m.label.style.top = ((-proj.y * 0.5 + 0.5) * height) + 'px';
        } else {
          m.label.style.display = 'none';
        }
      });
    }

    function onMouseDown(e) { state.dragging = true; state.lastX = e.clientX; state.lastY = e.clientY; }
    function onMouseMove(e) {
      if (!state.dragging) return;
      const dx = e.clientX - state.lastX, dy = e.clientY - state.lastY;
      state.lastX = e.clientX; state.lastY = e.clientY;
      state.rotY += dx * 0.005;
      state.rotX = Math.max(-1.2, Math.min(1.2, state.rotX + dy * 0.005));
    }
    function onMouseUp() { state.dragging = false; }
    function onWheel(e) {
      e.preventDefault();
      state.distance = Math.max(1.5, Math.min(6, state.distance + e.deltaY * 0.0025));
    }
    function touchStart(e) {
      if (e.touches.length === 1) { state.dragging = true; state.lastX = e.touches[0].clientX; state.lastY = e.touches[0].clientY; }
      else if (e.touches.length === 2) { state.pinchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); }
    }
    function touchMove(e) {
      e.preventDefault();
      if (e.touches.length === 1 && state.dragging) {
        const dx = e.touches[0].clientX - state.lastX, dy = e.touches[0].clientY - state.lastY;
        state.lastX = e.touches[0].clientX; state.lastY = e.touches[0].clientY;
        state.rotY += dx * 0.005;
        state.rotX = Math.max(-1.2, Math.min(1.2, state.rotX + dy * 0.005));
      } else if (e.touches.length === 2 && state.pinchDist != null) {
        const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        const delta = state.pinchDist - d;
        state.distance = Math.max(1.5, Math.min(6, state.distance + delta * 0.01));
        state.pinchDist = d;
      }
    }
    function touchEnd() { state.dragging = false; state.pinchDist = null; }

    renderer.domElement.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false });
    renderer.domElement.addEventListener('touchstart', touchStart, { passive: true });
    renderer.domElement.addEventListener('touchmove', touchMove, { passive: false });
    renderer.domElement.addEventListener('touchend', touchEnd);

    function animate() {
      globeGroup.rotation.set(state.rotX, state.rotY, 0);
      camera.position.set(0, 0, state.distance);
      camera.lookAt(0, 0, 0);
      updateLabels();
      // Colors are recomputed every frame straight from the live data ref, rather than in a
      // separate effect keyed on [forecast, hourIdx, ...] — that indirection was the source of
      // the markers getting stuck on their initial gray color. This way there's nothing to fall
      // out of sync: every rendered frame reflects whatever is currently in `forecast`.
      const live = dataRef.current;
      markers.forEach((m) => {
        const sfm = live.forecast[m.id];
        const hrs = (sfm && sfm.hours) || PLACEHOLDER_HOURS;
        const hr = hrs[live.hourIdx];
        const rating = hr ? hr.rating : 'LOADING';
        const color = (rating === 'LOADING' || !hr || hr.score == null) ? '#33465C' : scoreToColor(hr.score);
        m.mesh.material.color.set(color);
        const spotObj = live.spots[m.id];
        m.label.textContent = (spotObj ? spotObj.name : m.id) + ' · ' + (rating === 'LOADING' ? '···' : rating);
      });
      renderer.render(scene, camera);
      state.raf = requestAnimationFrame(animate);
    }
    animate();

    return () => {
      cancelAnimationFrame(state.raf);
      renderer.domElement.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      renderer.domElement.removeEventListener('wheel', onWheel);
      renderer.domElement.removeEventListener('touchstart', touchStart);
      renderer.domElement.removeEventListener('touchmove', touchMove);
      renderer.domElement.removeEventListener('touchend', touchEnd);
      markers.forEach((m) => { if (m.label.parentNode) m.label.parentNode.removeChild(m.label); });
      starGeo.dispose(); starMat.dispose(); starDotTexture.dispose();
      glowTexture.dispose(); glowMat.dispose();
      mapTexture.dispose(); oceanMat.dispose(); oceanMesh.geometry.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
    };
    } catch (e) {
      // WebGL genuinely isn't working here — surface that instead of leaving a blank canvas
      // with no indication of why nothing rendered.
      setGlobeError(true);
      return undefined;
    }
  }, [view]);

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-6" style={{ background: '#E9E7DF' }}>
      <style>{GLOBAL_CSS}</style>
      <div className="relative overflow-hidden" style={{ width: '100%', maxWidth: 390, borderRadius: 44, background: COLORS.navy, border: '6px solid #08141F', boxShadow: '0 30px 60px -20px rgba(11,28,46,0.45)', fontFamily: 'Inter, sans-serif' }}>

        <div className="flex justify-between items-center px-7 pt-4 pb-1" style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: COLORS.foam, opacity: 0.85 }}>
          <span>9:41</span>
          <div className="flex items-center" style={{ gap: 4 }}>
            <div className="flex items-end" style={{ gap: 2 }}>
              <div style={{ width: 3, height: 4, background: COLORS.foam, borderRadius: 1 }} />
              <div style={{ width: 3, height: 6, background: COLORS.foam, borderRadius: 1 }} />
              <div style={{ width: 3, height: 8, background: COLORS.foam, borderRadius: 1 }} />
              <div style={{ width: 3, height: 10, background: COLORS.foam, borderRadius: 1 }} />
            </div>
            <div style={{ width: 20, height: 10, border: '1.5px solid ' + COLORS.foam, borderRadius: 3, padding: 1.5, marginLeft: 3 }}>
              <div style={{ width: '70%', height: '100%', background: COLORS.foam, borderRadius: 1 }} />
            </div>
          </div>
        </div>

        {!onboarded ? (
          <div style={{ padding: '26px 24px 24px' }}>
            <div style={{ textAlign: 'center', marginBottom: 26 }}>
              <div style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, fontSize: 20, color: COLORS.foam, letterSpacing: '0.1em' }}>TIDELINE</div>
              <div style={{ fontSize: 13, color: COLORS.foamDim, marginTop: 12, lineHeight: 1.5 }}>Pick your go-to spot. It's the first thing you'll see every time you open the app.</div>
            </div>

            <div style={{ fontSize: 10, color: COLORS.foamDim, letterSpacing: '0.08em', fontWeight: 600, marginBottom: 10 }}>POPULAR SPOTS</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
              {ONBOARDING_PICKS.map((id) => {
                const s = SPOTS[id];
                if (!s) return null;
                return (
                  <button key={id} className="tl-btn" onClick={() => pickOnboardingSpot(id)}
                    style={{ background: COLORS.navyCard, border: '1px solid ' + COLORS.navyBorder, borderRadius: 10, padding: '12px 14px', textAlign: 'left' }}>
                    <div style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 600, fontSize: 14, color: COLORS.foam }}>{s.name}</div>
                    <div style={{ fontSize: 11, color: COLORS.foamDim, marginTop: 1 }}>{s.region}</div>
                  </button>
                );
              })}
            </div>

            <button className="tl-btn" onClick={() => setSearchOpen(true)} style={{ width: '100%', background: 'none', border: '1px solid ' + COLORS.navyBorder, borderRadius: 10, padding: '11px 0', color: COLORS.tealBright, fontWeight: 700, fontSize: 13 }}>
              Search for a different spot
            </button>
            <button className="tl-btn" onClick={() => completeOnboarding(activeId)} style={{ width: '100%', marginTop: 14, background: 'none', border: 'none', color: COLORS.foamDim, fontSize: 12, padding: '6px 0' }}>
              Skip for now
            </button>
          </div>
        ) : view === 'globe' ? (
          <div>
            <div className="flex justify-between items-center px-6 pt-2 pb-3">
              <span style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, fontSize: 17, color: COLORS.foam }}>All spots</span>
              <button className="tl-btn" onClick={() => handleNav('home')} style={{ background: 'none', border: 'none', padding: 6 }} aria-label="Close globe"><X size={18} color={COLORS.foamDim} /></button>
            </div>
            <div style={{ padding: '0 20px 6px', fontSize: 11, color: COLORS.foamDim }}>
              {order.length} spot{order.length === 1 ? '' : 's'} you've found · drag to rotate, pinch or scroll to zoom
            </div>
            <div ref={globeContainerRef} style={{ position: 'relative', width: '100%', height: 420, touchAction: 'none' }} />
            {globeError && (
              <div style={{ margin: '0 20px', padding: '14px 16px', background: COLORS.navyCard, border: '1px solid ' + COLORS.navyBorder, borderRadius: 10, fontSize: 12, color: COLORS.foamDim, lineHeight: 1.5 }}>
                3D rendering failed to start in this preview — that's a real signal, not just a display glitch. Let me know and I'll switch this view to the flat map instead.
              </div>
            )}
            <div className="mx-6" style={{ padding: '10px 0 4px' }}>
              <ConditionScale />
              <div style={{ fontSize: 9.5, color: COLORS.foamDim, marginTop: 6, textAlign: 'center' }}>Spot color = live conditions right now</div>
            </div>
          </div>
        ) : view === 'alerts' ? (
          <div>
            <div className="flex justify-between items-center px-6 pt-2 pb-3">
              <span style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, fontSize: 17, color: COLORS.foam }}>Alerts</span>
              <button className="tl-btn" onClick={() => handleNav('home')} style={{ background: 'none', border: 'none', padding: 6 }} aria-label="Close alerts"><X size={18} color={COLORS.foamDim} /></button>
            </div>
            <div style={{ padding: '0 20px 12px' }}>
              <button className="tl-btn" onClick={openNewAlert} style={{ width: '100%', background: COLORS.tealBright, border: 'none', borderRadius: 12, padding: '11px 13px', color: COLORS.navy, fontWeight: 700, fontSize: 14 }}>+ New alert</button>
            </div>
            <div style={{ padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {alerts.length === 0 && (
                <div style={{ fontSize: 12.5, color: COLORS.foamDim, padding: '10px 2px', lineHeight: 1.5 }}>No alerts yet. Pick a spot, a minimum wave height, and how far ahead you want the heads-up.</div>
              )}
              {alerts.map((a) => {
                const s = spots[a.spotId];
                const match = checkAlertMatch(a);
                return (
                  <div key={a.id} style={{ background: COLORS.navyCard, border: '1px solid ' + COLORS.navyBorder, borderRadius: 10, padding: '12px 14px' }}>
                    <div className="flex items-start justify-between">
                      <div>
                        <div style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 600, fontSize: 14, color: COLORS.foam }}>{s ? s.name : 'Unknown spot'}</div>
                        <div style={{ fontSize: 11.5, color: COLORS.foamDim, marginTop: 2 }}>{leadTimeLabel(a.leadTime)} · {formatWaveNum(a.minWaveFt, units)}{heightUnit(units)}+</div>
                      </div>
                      <button className="tl-btn" onClick={() => deleteAlert(a.id)} style={{ background: 'none', border: 'none', padding: 4 }}><X size={15} color={COLORS.foamDim} /></button>
                    </div>
                    <div style={{ fontSize: 11.5, color: match && match.hit ? COLORS.tealBright : COLORS.foamDim, marginTop: 8, fontWeight: match && match.hit ? 600 : 400 }}>
                      {match ? match.text : 'Waiting for forecast data…'}
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ padding: '14px 20px 4px', fontSize: 10.5, color: COLORS.foamDim, lineHeight: 1.5 }}>
              This checks live forecast data while you have the app open and shows you what would match. Actual push notifications when the app is closed need a real backend — that's Claude Code territory, not this preview.
            </div>
          </div>
        ) : view === 'profile' ? (
          <div>
            <div className="flex justify-between items-center px-6 pt-2 pb-3">
              <span style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, fontSize: 17, color: COLORS.foam }}>Profile</span>
              <button className="tl-btn" onClick={() => handleNav('home')} style={{ background: 'none', border: 'none', padding: 6 }} aria-label="Close profile"><X size={18} color={COLORS.foamDim} /></button>
            </div>

            <div style={{ padding: '0 20px' }}>
              <div style={{ fontSize: 10, color: COLORS.foamDim, letterSpacing: '0.08em', fontWeight: 600, marginBottom: 8 }}>GO-TO SPOT</div>
              <div className="flex overflow-x-auto no-scrollbar" style={{ gap: 8, marginBottom: 18 }}>
                {order.map((id) => {
                  const s = spots[id];
                  if (!s) return null;
                  const isGo = id === goToId;
                  return (
                    <button key={id} className="tl-btn" onClick={() => setGoToSpot(id)}
                      style={{ background: isGo ? COLORS.tealBright : COLORS.navyCard, color: isGo ? COLORS.navy : COLORS.foam, border: '1px solid ' + (isGo ? COLORS.tealBright : COLORS.navyBorder), borderRadius: 999, padding: '7px 13px', fontSize: 12.5, fontWeight: 600, flexShrink: 0, whiteSpace: 'nowrap' }}>
                      {s.name}
                    </button>
                  );
                })}
              </div>

              <div style={{ fontSize: 10, color: COLORS.foamDim, letterSpacing: '0.08em', fontWeight: 600, marginBottom: 8 }}>UNITS</div>
              <div className="flex" style={{ gap: 8, marginBottom: 18 }}>
                <button className="tl-btn" onClick={() => { if (units !== 'imperial') toggleUnits(); }}
                  style={{ flex: 1, background: units === 'imperial' ? COLORS.tealBright : COLORS.navyCard, color: units === 'imperial' ? COLORS.navy : COLORS.foam, border: '1px solid ' + (units === 'imperial' ? COLORS.tealBright : COLORS.navyBorder), borderRadius: 8, padding: '9px 0', fontSize: 12.5, fontWeight: 600 }}>
                  Feet · mph
                </button>
                <button className="tl-btn" onClick={() => { if (units !== 'metric') toggleUnits(); }}
                  style={{ flex: 1, background: units === 'metric' ? COLORS.tealBright : COLORS.navyCard, color: units === 'metric' ? COLORS.navy : COLORS.foam, border: '1px solid ' + (units === 'metric' ? COLORS.tealBright : COLORS.navyBorder), borderRadius: 8, padding: '9px 0', fontSize: 12.5, fontWeight: 600 }}>
                  Meters · kph
                </button>
              </div>

              <div style={{ fontSize: 10, color: COLORS.foamDim, letterSpacing: '0.08em', fontWeight: 600, marginBottom: 8 }}>ALERTS</div>
              <button className="tl-btn" onClick={() => handleNav('alerts')} style={{ width: '100%', background: COLORS.navyCard, border: '1px solid ' + COLORS.navyBorder, borderRadius: 10, padding: '11px 13px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
                <span style={{ fontSize: 13, color: COLORS.foam }}>{alerts.length} active alert{alerts.length === 1 ? '' : 's'}</span>
                <span style={{ fontSize: 11, color: COLORS.tealBright, fontWeight: 600 }}>Manage →</span>
              </button>

              <div style={{ fontSize: 10, color: COLORS.foamDim, letterSpacing: '0.08em', fontWeight: 600, marginBottom: 8 }}>YOUR SPOTS ({order.length})</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 18 }}>
                {order.map((id) => {
                  const s = spots[id];
                  if (!s) return null;
                  const isSeed = ORDER.includes(id);
                  return (
                    <div key={id} className="flex items-center justify-between" style={{ background: COLORS.navyCard, border: '1px solid ' + COLORS.navyBorder, borderRadius: 10, padding: '9px 12px' }}>
                      <div>
                        <div style={{ fontSize: 13, color: COLORS.foam, fontWeight: 600 }}>{s.name}{id === goToId && <span style={{ color: COLORS.tealBright }}> ★</span>}</div>
                        <div style={{ fontSize: 10.5, color: COLORS.foamDim, marginTop: 1 }}>{s.region}</div>
                      </div>
                      {isSeed ? (
                        <span style={{ fontSize: 9.5, color: COLORS.foamDim, letterSpacing: '0.04em' }}>BUILT-IN</span>
                      ) : (
                        <button className="tl-btn" onClick={() => removeSpot(id)} style={{ background: 'none', border: 'none', padding: 4 }} aria-label={'Remove ' + s.name}><X size={15} color={COLORS.foamDim} /></button>
                      )}
                    </div>
                  );
                })}
              </div>

              <div style={{ fontSize: 10, color: COLORS.foamDim, letterSpacing: '0.08em', fontWeight: 600, marginBottom: 8 }}>DATA</div>
              <div style={{ fontSize: 11, color: COLORS.foamDim, lineHeight: 1.6, paddingBottom: 20 }}>
                Wave, swell, wind, and tide data from Open-Meteo's Marine and Weather APIs. Tide is modeled sea-level height, not an official chart-datum tide table — timing is a good guide, but exact heights may not match a nautical almanac.
              </div>
            </div>
          </div>
        ) : (
        <>
        <div className="flex justify-between items-center px-6 pt-2 pb-3">
          <button className="tl-btn" style={{ background: 'none', border: 'none', padding: 6 }} onClick={() => setToast('Menu — not in this preview')} aria-label="Menu"><Menu size={18} color={COLORS.foamDim} /></button>
          <span style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 600, fontSize: 13, letterSpacing: '0.14em', color: COLORS.foam, opacity: 0.9 }}>TIDELINE</span>
          <div className="flex items-center" style={{ gap: 8 }}>
            <button className="tl-btn" onClick={toggleUnits} aria-label="Toggle units" style={{ background: 'none', border: '1px solid ' + COLORS.navyBorder, borderRadius: 4, padding: '3px 7px' }}>
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, fontWeight: 700, color: COLORS.foamDim, letterSpacing: '0.04em' }}>{units === 'metric' ? 'M' : 'FT'}</span>
            </button>
            <button className="tl-btn" style={{ background: 'none', border: 'none', padding: 6 }} onClick={() => setSearchOpen(true)} aria-label="Search for a spot"><Search size={18} color={COLORS.foamDim} /></button>
          </div>
        </div>

        <div className="flex justify-between items-start px-6 pb-3">
          <div>
            <div style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, fontSize: 22, color: COLORS.foam, lineHeight: 1.1 }}>{spot.name}</div>
            <div style={{ fontSize: 12.5, color: COLORS.foamDim, marginTop: 3 }}>{spot.region}</div>
            {isGoTo && <div style={{ fontSize: 10.5, color: COLORS.tealBright, marginTop: 5, fontWeight: 600, letterSpacing: '0.06em' }}>YOUR GO-TO SPOT</div>}
          </div>
          <button className="tl-btn" style={{ background: 'none', border: 'none', padding: 6 }} onClick={makeGoTo} aria-label="Set as go-to spot">
            <Star size={22} color={isGoTo ? COLORS.gold : COLORS.foamDim} fill={isGoTo ? COLORS.gold : 'none'} />
          </button>
        </div>

        <div className="mx-6 relative overflow-hidden" style={{ borderRadius: 14, padding: '18px 18px 20px', background: COLORS.navyCard, border: '1px solid ' + COLORS.navyBorder }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: ratingBg(h.rating), opacity: isLoading ? 0.4 : 1, transition: 'background 300ms ease' }} />
          <div className="relative" style={{ zIndex: 1 }}>
            <div className="flex items-center" style={{ gap: 8 }}>
              <span className={isLoading ? 'tl-pulse' : ''} style={{ background: ratingBg(h.rating), color: ratingText(h.rating), fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 11, letterSpacing: '0.08em', padding: '3px 8px', borderRadius: 4 }}>
                {isLoading ? 'FETCHING…' : h.rating}
              </span>
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11.5, color: COLORS.foamDim }}>AT {h.t.toUpperCase()}</span>
            </div>
            <div className="flex items-baseline" style={{ gap: 8, marginTop: 12 }}>
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 52, color: COLORS.foam, lineHeight: 1, letterSpacing: '-0.01em' }}>{formatWaveRange(h.wave, units)}</span>
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 16, color: COLORS.foamDim, letterSpacing: '0.04em' }}>{waveUnit(units)}</span>
            </div>
            <div className="flex items-center" style={{ gap: 14, marginTop: 12 }}>
              <div className="flex items-center" style={{ gap: 5 }}>
                <Navigation size={13} color={COLORS.tealBright} style={{ transform: 'rotate(' + h.swellDeg + 'deg)' }} />
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: COLORS.foam }}>{h.period}s {h.swellDir}</span>
              </div>
              <div className="flex items-center" style={{ gap: 5 }}>
                <Navigation size={13} color={COLORS.tealBright} style={{ transform: 'rotate(' + h.windDeg + 'deg)' }} />
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: COLORS.foam }}>{formatSpeed(h.windSpd, units)}{speedUnit(units)} {h.windDir}</span>
              </div>
            </div>
            {hasError ? (
              <div style={{ marginTop: 12, fontSize: 11.5, color: COLORS.foam, background: 'rgba(0,0,0,0.28)', padding: '8px 10px', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span>Live data didn't load for this spot.</span>
                <button className="tl-btn" onClick={() => loadSpotData(activeId, spot)} style={{ background: COLORS.foam, color: COLORS.navy, border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <RefreshCw size={11} /> Retry
                </button>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: COLORS.foamDim, marginTop: 12, lineHeight: 1.4, maxWidth: 260 }}>{spot.blurb}</div>
            )}
          </div>
        </div>

        <div className="mx-6" style={{ marginTop: 14, background: COLORS.navyCard, border: '1px solid ' + COLORS.navyBorder, borderRadius: 10, padding: '12px 14px' }}>
          <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
            <span style={{ fontSize: 10, color: COLORS.foamDim, letterSpacing: '0.08em', fontWeight: 600 }}>WAVE HEIGHT TODAY</span>
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: COLORS.foamDim }}>{formatWaveRange(h.wave, units)}{heightUnit(units)} now</span>
          </div>
          <svg viewBox="0 0 300 56" style={{ width: '100%', height: 46 }}>
            <path d={waveChart.d} fill="none" stroke={COLORS.tealBright} strokeWidth="2" />
            {waveChart.pts.map((p, i) => (
              <circle key={i} cx={p[0]} cy={p[1]} r={i === hourIdx ? 3.5 : 2} fill={i === hourIdx ? COLORS.coral : COLORS.foamDim} style={{ cursor: 'pointer' }} onClick={() => setHourIdx(i)} />
            ))}
          </svg>
          <div className="flex justify-between" style={{ marginTop: 2 }}>
            {hourData.map((hr, i) => (
              <span key={hr.t} style={{ fontSize: 9, color: i === hourIdx ? COLORS.foam : COLORS.foamDim, fontWeight: i === hourIdx ? 600 : 400, fontFamily: 'JetBrains Mono, monospace' }}>{hr.t}</span>
            ))}
          </div>
        </div>

        <div className="mx-6" style={{ marginTop: 10, background: COLORS.navyCard, border: '1px solid ' + COLORS.navyBorder, borderRadius: 10, padding: '12px 14px' }}>
          <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
            <span style={{ fontSize: 10, color: COLORS.foamDim, letterSpacing: '0.08em', fontWeight: 600 }}>WAVE HEIGHT THIS WEEK</span>
            <div className="flex items-center" style={{ gap: 9 }}>
              <span className="flex items-center" style={{ gap: 4, fontSize: 9, color: COLORS.foamDim }}><span style={{ width: 10, height: 2, background: COLORS.tealBright, display: 'inline-block', borderRadius: 1 }} />height</span>
              <span className="flex items-center" style={{ gap: 4, fontSize: 9, color: COLORS.foamDim }}><span style={{ width: 10, height: 0, borderTop: '1.5px dashed ' + COLORS.gold, display: 'inline-block' }} />tide</span>
              <span className="flex items-center" style={{ gap: 4, fontSize: 9, color: COLORS.foamDim }}><span style={{ width: 10, height: 0, borderTop: '1.5px dotted ' + COLORS.coral, display: 'inline-block' }} />wind</span>
            </div>
          </div>
          <svg viewBox="0 0 300 70" style={{ width: '100%', height: 66 }}>
            <defs>
              <linearGradient id={'weekFill-' + activeId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={COLORS.tealBright} stopOpacity="0.32" />
                <stop offset="100%" stopColor={COLORS.tealBright} stopOpacity="0" />
              </linearGradient>
            </defs>
            {contData.map((p, i) => p.dayStart && (
              <line key={'gl' + i} x1={contWaveLine.pts[i][0]} y1="6" x2={contWaveLine.pts[i][0]} y2="70" stroke={COLORS.foamFaint} strokeWidth="1" strokeDasharray="1,3" />
            ))}
            <path d={contWaveLine.d + ' L' + contWaveLine.pts[contWaveLine.pts.length - 1][0] + ',70 L' + contWaveLine.pts[0][0] + ',70 Z'} fill={'url(#weekFill-' + activeId + ')'} stroke="none" />
            <path d={contTideLine.d} fill="none" stroke={COLORS.gold} strokeWidth="1.2" strokeDasharray="2,2" opacity="0.8" />
            <path d={contWindLine.d} fill="none" stroke={COLORS.coral} strokeWidth="1.2" strokeDasharray="1,2" opacity="0.8" />
            <path d={contWaveLine.d} fill="none" stroke={COLORS.tealBright} strokeWidth="2" />
            {contData.map((p, i) => p.dayStart && p.windDeg != null && spot && (() => {
              const arrowColor = windAngleColor(p.windDeg, spot.offshoreDeg);
              return (
                <g key={'wd' + i} transform={'translate(' + contWaveLine.pts[i][0] + ',9) rotate(' + p.windDeg + ')'}>
                  <line x1="0" y1="4" x2="0" y2="-4" stroke={arrowColor} strokeWidth="1.1" />
                  <path d="M0,-5 L-2,-2 L2,-2 Z" fill={arrowColor} />
                </g>
              );
            })())}
            {contSelected && (
              <circle cx={contWaveLine.pts[contSelectedIdx][0]} cy={contWaveLine.pts[contSelectedIdx][1]} r="3.5" fill={COLORS.coral} />
            )}
            <rect x="0" y="0" width="300" height="70" fill="transparent" style={{ cursor: 'pointer' }} onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const x = ((e.clientX - rect.left) / rect.width) * 300;
              let nearest = 0, best = Infinity;
              contWaveLine.pts.forEach((pt, i) => { const d = Math.abs(pt[0] - x); if (d < best) { best = d; nearest = i; } });
              setContSelectedIdx(nearest);
            }} />
          </svg>
          <div style={{ position: 'relative', height: 13, marginTop: 1 }}>
            {contData.map((p, i) => p.dayStart && (
              <span key={'dl' + i} style={{ position: 'absolute', left: (contWaveLine.pts[i][0] / 300) * 100 + '%', transform: 'translateX(-50%)', fontSize: 9, color: COLORS.foamDim, fontFamily: 'JetBrains Mono, monospace' }}>{p.day}</span>
            ))}
          </div>
          <div style={{ marginTop: 4, fontSize: 11, color: contSelected ? COLORS.foam : COLORS.foamDim, fontFamily: 'JetBrains Mono, monospace', minHeight: 14 }}>
            {contSelected ? (contSelected.day + ' ' + hourLabel12(contSelected.hour) + ' · ' + formatWaveNum(contSelected.waveFt, units) + heightUnit(units) + (contSelected.tideFt != null ? ' · ' + formatHeight(contSelected.tideFt, units) + heightUnit(units) + ' tide' : '') + (contSelected.windSpd != null ? ' · ' + formatSpeed(contSelected.windSpd, units) + speedUnit(units) + ' ' + degToCompass(contSelected.windDeg) : '')) : 'Tap the chart for a specific time'}
          </div>
        </div>

        <div className="flex overflow-x-auto no-scrollbar px-6" style={{ gap: 8, marginTop: 14 }}>
          {hourData.map((hr, i) => {
            const selected = i === hourIdx;
            return (
              <button key={hr.t} className="tl-btn flex flex-col items-center justify-end" onClick={() => setHourIdx(i)}
                style={{ background: selected ? COLORS.foamFaint : 'transparent', border: 'none', borderRadius: 14, padding: '8px 9px 7px', minWidth: 40, flexShrink: 0 }}>
                <div style={{ width: 6, height: barHeight(hr.wave), background: ratingBg(hr.rating), borderRadius: 3, marginBottom: 6 }} />
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: selected ? COLORS.foam : COLORS.foamDim, fontWeight: selected ? 600 : 400 }}>{hr.t}</span>
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-3 px-6" style={{ gap: 8, marginTop: 14 }}>
          <div style={{ background: COLORS.navyCard, border: '1px solid ' + COLORS.navyBorder, borderRadius: 10, padding: '10px 11px' }}>
            <div style={{ fontSize: 10, color: COLORS.foamDim, letterSpacing: '0.08em', fontWeight: 600 }}>SWELL</div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, fontSize: 15, color: COLORS.foam, marginTop: 5 }}>{formatWaveRange(h.wave, units)}{heightUnit(units)}</div>
            <div style={{ fontSize: 10.5, color: COLORS.foamDim, marginTop: 2 }}>{h.period}s {h.swellDir}</div>
          </div>
          <div style={{ background: COLORS.navyCard, border: '1px solid ' + COLORS.navyBorder, borderRadius: 10, padding: '10px 11px' }}>
            <div style={{ fontSize: 10, color: COLORS.foamDim, letterSpacing: '0.08em', fontWeight: 600 }}>WIND</div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, fontSize: 15, color: COLORS.foam, marginTop: 5 }}>{formatSpeed(h.windSpd, units)}{speedUnit(units)}</div>
            <div style={{ fontSize: 10.5, color: windColor(h.type), marginTop: 2, fontWeight: 600 }}>{h.windDir} · {h.type}</div>
          </div>
          <div style={{ background: COLORS.navyCard, border: '1px solid ' + COLORS.navyBorder, borderRadius: 10, padding: '10px 11px' }}>
            <div style={{ fontSize: 10, color: COLORS.foamDim, letterSpacing: '0.08em', fontWeight: 600 }}>TIDE</div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, fontSize: 15, color: COLORS.foam, marginTop: 5 }}>{tideToday[hourIdx] != null ? formatHeight(tideToday[hourIdx], units) : '–'}{heightUnit(units)}</div>
            <svg viewBox="0 0 100 34" style={{ width: '100%', height: 20, marginTop: 3 }}>
              <path d={tide.d} fill="none" stroke={COLORS.foamDim} strokeWidth="1.5" />
              <circle cx={tide.pts[hourIdx][0]} cy={tide.pts[hourIdx][1]} r="2.6" fill={COLORS.coral} />
            </svg>
            <div style={{ fontSize: 9, color: COLORS.foamDim, marginTop: 2 }}>{tideNext ? 'Next ' + tideNext.type + ' ' + hourLabel12(tideNext.hour) : 'Tide unavailable'}</div>
          </div>
        </div>

        </>
        )}

        <div style={{ position: 'relative', height: 0 }}>
          {toast && (
            <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', bottom: 74, background: 'rgba(8,20,31,0.94)', color: COLORS.foam, fontSize: 12, padding: '9px 16px', borderRadius: 999, whiteSpace: 'nowrap', boxShadow: '0 8px 20px rgba(0,0,0,0.3)', zIndex: 5 }}>
              {toast}
            </div>
          )}
        </div>

        {onboarded && (
        <div className="flex justify-around items-center" style={{ marginTop: 18, padding: '14px 20px 20px', borderTop: '1px solid ' + COLORS.foamFaint }}>
          <button className="tl-btn" style={{ background: 'none', border: 'none', padding: 6 }} onClick={() => handleNav('home')} aria-label="Home"><Home size={20} color={view === 'home' ? COLORS.coral : COLORS.foamDim} /></button>
          <button className="tl-btn" style={{ background: 'none', border: 'none', padding: 6 }} onClick={() => handleNav('map')} aria-label="Globe"><Map size={20} color={view === 'globe' ? COLORS.coral : COLORS.foamDim} /></button>
          <button className="tl-btn" style={{ background: 'none', border: 'none', padding: 6 }} onClick={() => handleNav('alerts')} aria-label="Alerts"><Bell size={20} color={view === 'alerts' ? COLORS.coral : COLORS.foamDim} /></button>
          <button className="tl-btn" style={{ background: 'none', border: 'none', padding: 6 }} onClick={() => handleNav('profile')} aria-label="Profile"><User size={20} color={view === 'profile' ? COLORS.coral : COLORS.foamDim} /></button>
        </div>
        )}

        {searchOpen && (
          <div onClick={closeSearch} style={{ position: 'absolute', inset: 0, background: 'rgba(5,12,20,0.6)', display: 'flex', alignItems: 'flex-end', zIndex: 10 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', background: COLORS.navyCard, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: '18px 20px 26px', maxHeight: '82%', overflowY: 'auto' }}>
              <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
                <span style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, fontSize: 16, color: COLORS.foam }}>Add a spot</span>
                <button className="tl-btn" onClick={closeSearch} style={{ background: 'none', border: 'none', padding: 4 }}><X size={18} color={COLORS.foamDim} /></button>
              </div>
              {searchStep === 'query' && (
                <div>
                  <input className="tl-input" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }}
                    placeholder="Try “Malibu” or “Jeffreys Bay”"
                    style={{ width: '100%', boxSizing: 'border-box', background: COLORS.navy, border: '1px solid ' + COLORS.foamFaint, borderRadius: 12, padding: '11px 13px', color: COLORS.foam, fontSize: 14, fontFamily: 'Inter, sans-serif' }} />
                  <button className="tl-btn" onClick={runSearch} style={{ width: '100%', marginTop: 10, background: COLORS.tealBright, border: 'none', borderRadius: 12, padding: '11px 13px', color: COLORS.navy, fontWeight: 700, fontSize: 14 }}>Search</button>
                  <div style={{ fontSize: 10.5, color: COLORS.foamDim, marginTop: 10, lineHeight: 1.4 }}>Any coastal place works — I'll pull live wave/wind data and guess which wind direction is offshore from the coastline shape.</div>
                </div>
              )}
              {searchStep === 'loading' && <div className="tl-pulse" style={{ fontSize: 13, color: COLORS.foamDim, padding: '10px 0' }}>Looking it up…</div>}
              {searchStep === 'error' && (
                <div>
                  <div style={{ fontSize: 13, color: COLORS.foam, marginBottom: 12 }}>{searchError}</div>
                  <button className="tl-btn" onClick={() => setSearchStep('query')} style={{ background: COLORS.foamFaint, border: 'none', borderRadius: 12, padding: '9px 13px', color: COLORS.foam, fontSize: 13, fontWeight: 600 }}>Try again</button>
                </div>
              )}
              {searchStep === 'confirm' && pending && (
                <div>
                  <div style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 600, fontSize: 15, color: COLORS.foam }}>{pending.name}</div>
                  <div style={{ fontSize: 11.5, color: COLORS.foamDim, marginTop: 2 }}>{pending.region}</div>
                  {!pending.guessed && (
                    <div style={{ fontSize: 11, color: COLORS.gold, marginTop: 10, background: 'rgba(240,184,77,0.12)', padding: '7px 9px', borderRadius: 10 }}>
                      Couldn't detect a coastline nearby — adjust the direction below if it looks wrong.
                    </div>
                  )}
                  <div className="flex items-center justify-center" style={{ gap: 18, marginTop: 16 }}>
                    <button className="tl-btn" onClick={() => nudge(-15)} style={{ background: COLORS.navy, border: 'none', borderRadius: 999, width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><ChevronLeft size={16} color={COLORS.foam} /></button>
                    <div style={{ width: 64, height: 64, borderRadius: 999, border: '1.5px dashed ' + COLORS.foamFaint, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Navigation size={22} color={COLORS.tealBright} style={{ transform: 'rotate(' + pending.offshoreDeg + 'deg)' }} />
                    </div>
                    <button className="tl-btn" onClick={() => nudge(15)} style={{ background: COLORS.navy, border: 'none', borderRadius: 999, width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><ChevronRight size={16} color={COLORS.foam} /></button>
                  </div>
                  <div style={{ textAlign: 'center', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: COLORS.foamDim, marginTop: 8 }}>Offshore wind ≈ {degToCompass(pending.offshoreDeg)} ({pending.offshoreDeg}°)</div>
                  <button className="tl-btn" onClick={confirmAddSpot} style={{ width: '100%', marginTop: 16, background: COLORS.tealBright, border: 'none', borderRadius: 12, padding: '11px 13px', color: COLORS.navy, fontWeight: 700, fontSize: 14 }}>Add & show conditions</button>
                  <button className="tl-btn" onClick={() => { setSearchStep('query'); setPending(null); }} style={{ width: '100%', marginTop: 8, background: 'none', border: 'none', color: COLORS.foamDim, fontSize: 12.5, padding: '6px 0' }}>← Search a different spot</button>
                </div>
              )}
            </div>
          </div>
        )}

        {alertSheetOpen && alertDraft && (
          <div onClick={closeAlertSheet} style={{ position: 'absolute', inset: 0, background: 'rgba(5,12,20,0.6)', display: 'flex', alignItems: 'flex-end', zIndex: 10 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', background: COLORS.navyCard, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: '18px 20px 26px', maxHeight: '85%', overflowY: 'auto' }}>
              <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
                <span style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, fontSize: 16, color: COLORS.foam }}>New alert</span>
                <button className="tl-btn" onClick={closeAlertSheet} style={{ background: 'none', border: 'none', padding: 4 }}><X size={18} color={COLORS.foamDim} /></button>
              </div>

              <div style={{ fontSize: 10.5, color: COLORS.foamDim, letterSpacing: '0.06em', fontWeight: 600, marginBottom: 8 }}>SPOT</div>
              <div className="flex overflow-x-auto no-scrollbar" style={{ gap: 8, marginBottom: 16 }}>
                {order.map((id) => (
                  <button key={id} className="tl-btn" onClick={() => setAlertDraft({ ...alertDraft, spotId: id })}
                    style={{ background: alertDraft.spotId === id ? COLORS.tealBright : COLORS.navy, color: alertDraft.spotId === id ? COLORS.navy : COLORS.foam, border: 'none', borderRadius: 999, padding: '7px 13px', fontSize: 12.5, fontWeight: 600, flexShrink: 0, whiteSpace: 'nowrap' }}>
                    {spots[id].name}
                  </button>
                ))}
              </div>

              <div style={{ fontSize: 10.5, color: COLORS.foamDim, letterSpacing: '0.06em', fontWeight: 600, marginBottom: 8 }}>MINIMUM WAVE HEIGHT</div>
              <div className="flex" style={{ gap: 8, marginBottom: 16 }}>
                {[2, 3, 4, 5, 6].map((ft) => (
                  <button key={ft} className="tl-btn" onClick={() => setAlertDraft({ ...alertDraft, minWaveFt: ft })}
                    style={{ flex: 1, background: alertDraft.minWaveFt === ft ? COLORS.tealBright : COLORS.navy, color: alertDraft.minWaveFt === ft ? COLORS.navy : COLORS.foam, border: 'none', borderRadius: 10, padding: '9px 0', fontSize: 12.5, fontWeight: 600 }}>
                    {formatWaveNum(ft, units)}{heightUnit(units)}+
                  </button>
                ))}
              </div>

              <div style={{ fontSize: 10.5, color: COLORS.foamDim, letterSpacing: '0.06em', fontWeight: 600, marginBottom: 8 }}>NOTIFY ME</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
                {['1h', '1d', '2d', '3d'].map((lt) => (
                  <button key={lt} className="tl-btn" onClick={() => setAlertDraft({ ...alertDraft, leadTime: lt })}
                    style={{ background: alertDraft.leadTime === lt ? COLORS.tealBright : COLORS.navy, color: alertDraft.leadTime === lt ? COLORS.navy : COLORS.foam, border: 'none', borderRadius: 10, padding: '10px 13px', fontSize: 13, fontWeight: 600, textAlign: 'left' }}>
                    {leadTimeLabel(lt)}
                  </button>
                ))}
              </div>

              <button className="tl-btn" onClick={saveAlert} style={{ width: '100%', background: COLORS.tealBright, border: 'none', borderRadius: 12, padding: '11px 13px', color: COLORS.navy, fontWeight: 700, fontSize: 14 }}>Save alert</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
