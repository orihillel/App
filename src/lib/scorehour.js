import { conditionsScore, scoreBreakdown, scoreToRating } from './rating.js';
import { breakingHeightFt, surfRange } from './surf.js';

// Scoring one hour, in one place.
//
// This arithmetic -- pick the dominant train, take its period and direction, derive the breaking
// height from the offshore height *with that period*, then score -- was written out three times:
// once in forecast.js when the week is built, once more there for the current conditions, and
// again in calibration.js when a correction re-derives it. The order of those steps is load
// bearing (the transform is non-linear in height, and it depends on the period carrying the
// energy, so it has to happen after the dominant train is picked and before anything is scored),
// and three copies of a load-bearing order is three chances for one of them to drift.
//
// It became worth factoring out when the score gained a fourth input -- who is reading it. A
// profile that is threaded through two of the three copies is worse than no profile at all,
// because the disagreement would show up as a spot whose rating changes when a calibration
// sample lands rather than when the surf does.

// The period and direction the score should use: the dominant train's where there is one, the
// hour's own where there is not.
export function scoringInputs(hour) {
  const dominant = (hour.trains && hour.trains[0]) || null;
  return {
    period: dominant && dominant.period != null ? dominant.period : hour.period,
    swellDeg: dominant && dominant.deg != null ? dominant.deg : hour.swellDeg,
  };
}

// Re-derive surfFt/wave/score/rating for an hour from the raw fields it already carries.
//
// `waveFt` is the offshore significant height and stays the input; `surfFt` is what the screen
// shows. Callers that have corrected `waveFt` pass the corrected value in and get everything
// downstream of it recomputed consistently.
export function scoreHour(hour, spot, profile, waveFtOverride) {
  const waveFt = waveFtOverride != null ? waveFtOverride : hour.waveFt;
  if (waveFt == null) return hour;
  const { period, swellDeg } = scoringInputs(hour);
  const surfFt = breakingHeightFt(waveFt, period);
  const score = conditionsScore(
    surfFt, hour.windMph, hour.type, period, swellDeg,
    spot && spot.offshoreDeg, hour.tidePosition, spot, profile,
  );
  return { ...hour, waveFt, surfFt, wave: surfRange(surfFt), score, rating: scoreToRating(score) };
}

// The same hour, with the score's working shown -- what the card uses to say why.
export function explainHour(hour, spot, profile) {
  if (!hour || hour.surfFt == null) return null;
  const { period, swellDeg } = scoringInputs(hour);
  return scoreBreakdown(
    hour.surfFt, hour.windMph, hour.type, period, swellDeg,
    spot && spot.offshoreDeg, hour.tidePosition, spot, profile,
  );
}

// Rescore a whole day against a (possibly new) profile, without re-fetching anything.
//
// Changing your board does not change the ocean, so a profile change must never trigger a
// network round trip: every number the score needs is already on each hour. This is also why
// hours carry `windMph` and `tidePosition` at full precision rather than only the rounded
// values the screen shows.
export function rescoreHours(hours, spot, profile) {
  if (!Array.isArray(hours)) return hours;
  return hours.map((h) => scoreHour(h, spot, profile));
}

// The rating, in a sentence.
//
// A badge that says GOOD and nothing else asks to be taken on faith, and the one thing this app
// has never done is ask for that. Every term is already itemised by scoreBreakdown, so saying
// which ones decided it costs nothing and turns the badge into something a person can argue
// with -- which is the point. If the app says POOR because the tide is wrong and you know the
// bank holds up anyway, you can now see that is what it meant.
//
// Deliberately short. Two things carrying the rating and the one thing holding it back is the
// most that reads as a sentence rather than a table; everything else is already on the card.
const MAX_LIFTS = 2;

export function explainText(breakdown) {
  if (!breakdown || !Array.isArray(breakdown.terms)) return null;
  const named = breakdown.terms.filter((t) => t.text);
  // Biggest mover first, so the sentence leads with whatever actually decided the rating.
  const byWeight = [...named].sort((a, b) => Math.abs(b.points) - Math.abs(a.points));
  const lifts = byWeight.filter((t) => t.points > 0).slice(0, MAX_LIFTS).map((t) => t.text);
  const drag = byWeight.find((t) => t.points < 0);

  if (!lifts.length && !drag) return null;
  if (!lifts.length) return sentence(capitalise(drag.text));
  if (!drag) return sentence(capitalise(join(lifts)));
  return sentence(capitalise(join(lifts)) + ', but ' + drag.text);
}

function join(parts) {
  return parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1] : parts[0];
}
function capitalise(text) { return text.charAt(0).toUpperCase() + text.slice(1); }
function sentence(text) { return text + '.'; }
