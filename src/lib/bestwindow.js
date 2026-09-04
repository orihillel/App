import { hourLabel12 } from './format.js';

// "When should I go today?" — the one question the app exists to answer, which until now it
// made you work out for yourself by scrubbing the hour strip and comparing eight ratings.
//
// Everything needed was already being computed: conditionsScore() runs for every sampled hour.
// This just reads the conclusion off the numbers already there.

// Hours within this much of the day's best score count as part of the same window. One point on
// the conditionsScore scale is roughly "the wind picked up a little" — not enough to be worth
// splitting a session over, so a run that dips by one still reads as one good stretch.
const SAME_WINDOW_TOLERANCE = 1;

// Below this, nothing today is worth singling out; claiming a "best window" on a day that is
// poor start to finish is worse than saying nothing, because it reads as a recommendation.
const WORTH_CALLING_OUT = 2;

export function bestWindow(hours) {
  if (!Array.isArray(hours) || hours.length === 0) return null;
  const scored = hours.filter((h) => typeof h.score === 'number');
  if (scored.length === 0) return null;

  let best = -Infinity;
  for (const h of scored) if (h.score > best) best = h.score;
  if (best < WORTH_CALLING_OUT) return null;

  // The longest run at (or near) the day's best, rather than simply the single best hour: a
  // three-hour stretch you can plan around is more useful than one hour that happens to peak.
  const inWindow = hours.map((h) => typeof h.score === 'number' && h.score >= best - SAME_WINDOW_TOLERANCE);
  let bestStart = -1, bestLen = 0, runStart = -1;
  for (let i = 0; i <= inWindow.length; i++) {
    if (i < inWindow.length && inWindow[i]) {
      if (runStart === -1) runStart = i;
      continue;
    }
    if (runStart !== -1) {
      const len = i - runStart;
      // Ties go to the earlier run: mornings are usually the lighter-wind half of the day, and
      // an early call is more actionable than a late one.
      if (len > bestLen) { bestLen = len; bestStart = runStart; }
      runStart = -1;
    }
  }
  if (bestStart === -1) return null;

  const startHour = hours[bestStart].hour;
  const endHour = hours[bestStart + bestLen - 1].hour;
  const peak = hours.slice(bestStart, bestStart + bestLen)
    .reduce((a, b) => ((b.score || -Infinity) > (a.score || -Infinity) ? b : a));

  return {
    startIdx: bestStart,
    endIdx: bestStart + bestLen - 1,
    startHour,
    endHour,
    label: formatWindow(startHour, endHour),
    rating: peak.rating,
    score: best,
    wave: peak.wave,
    windType: peak.type,
    windSpd: peak.windSpd,
    windDir: peak.windDir,
  };
}

function formatWindow(startHour, endHour) {
  if (startHour === endHour) return hourLabel12(startHour);
  return hourLabel12(startHour) + '–' + hourLabel12(endHour);
}
