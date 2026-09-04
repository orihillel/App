import { HOUR_LABELS, DAY_LABELS } from './spots.js';

// Believable stand-in numbers shown the instant a spot opens, before the real Open-Meteo
// fetch resolves (or if it fails) — so the screen never looks blank or obviously fake-empty.
// The rating stays 'LOADING' (drives the "FETCHING…" badge and globe "···" label honestly);
// only the numbers/shape are dressed up.
export const PLACEHOLDER_HOURS = [
  { t: '5a', hour: 5, wave: '3-4', period: 11, swellDir: 'SW', swellDeg: 225, windSpd: 4, windDir: 'E', windDeg: 90, type: 'offshore', rating: 'LOADING' },
  { t: '7a', hour: 7, wave: '3-5', period: 12, swellDir: 'SW', swellDeg: 222, windSpd: 5, windDir: 'E', windDeg: 90, type: 'offshore', rating: 'LOADING' },
  { t: '9a', hour: 9, wave: '4-5', period: 12, swellDir: 'SW', swellDeg: 220, windSpd: 6, windDir: 'NE', windDeg: 45, type: 'offshore', rating: 'LOADING' },
  { t: '11a', hour: 11, wave: '3-5', period: 11, swellDir: 'SW', swellDeg: 218, windSpd: 8, windDir: 'N', windDeg: 0, type: 'cross', rating: 'LOADING' },
  { t: '1p', hour: 13, wave: '3-4', period: 10, swellDir: 'W', swellDeg: 260, windSpd: 11, windDir: 'W', windDeg: 270, type: 'onshore', rating: 'LOADING' },
  { t: '3p', hour: 15, wave: '2-4', period: 10, swellDir: 'W', swellDeg: 262, windSpd: 13, windDir: 'W', windDeg: 270, type: 'onshore', rating: 'LOADING' },
  { t: '5p', hour: 17, wave: '2-3', period: 9, swellDir: 'W', swellDeg: 258, windSpd: 10, windDir: 'SW', windDeg: 225, type: 'onshore', rating: 'LOADING' },
  { t: '7p', hour: 19, wave: '2-3', period: 10, swellDir: 'SW', swellDeg: 230, windSpd: 5, windDir: 'E', windDeg: 90, type: 'offshore', rating: 'LOADING' },
];
// A plausible-looking stand-in tide curve (real tide is fetched live below) so the
// TIDE card never looks flat/empty before data arrives.
export const PLACEHOLDER_TIDE_TODAY = HOUR_LABELS.map((_, i) => 2.6 + Math.sin((i / 7) * Math.PI * 2 - 0.6) * 1.7);
export const PLACEHOLDER_TIDE_NEXT = { type: 'High', hour: 14 };
export function nextTideEvent(tideFine, fromHour) {
  if (!tideFine || tideFine.length < 3) return null;
  for (let i = 1; i < tideFine.length - 1; i++) {
    if (tideFine[i].hour <= fromHour) continue;
    const prev = tideFine[i - 1].ft, cur = tideFine[i].ft, next = tideFine[i + 1].ft;
    if (cur > prev && cur > next) return { type: 'High', hour: tideFine[i].hour };
    if (cur < prev && cur < next) return { type: 'Low', hour: tideFine[i].hour };
  }
  return null;
}
export const PLACEHOLDER_CONTINUOUS = (() => {
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
