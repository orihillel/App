// Whether the swell is building, holding, or dropping around the hour on screen.
//
// The height on the card answers "how big is it"; it cannot answer "am I too late". A 4ft
// reading on the way up and a 4ft reading on the way down are the same number and opposite
// decisions, and the app had no way of saying which -- the same gap the tide square had before
// it learned to say Pushing or Pulling, and this is the swell's version of that.
//
// Measured across the samples either side of the hour rather than from the hour itself, so it
// describes the trend through that moment rather than one step of it. Those samples are the
// spot's own daylight hours, two to three apart, which makes the window about five hours -- long
// enough that a wobble in one hour of a model does not flip the arrow, short enough to still be
// about today.

// Under this, "building" would be a claim the data does not support. Half a foot across five
// hours is a swell holding steady, and the fraction takes over on bigger days where half a foot
// genuinely is nothing.
export const STEADY_FT = 0.5;
export const STEADY_FRACTION = 0.08;

export function swellTrend(hours, idx) {
  if (!Array.isArray(hours) || !hours.length || !Number.isFinite(idx)) return null;
  const i = Math.min(Math.max(0, Math.round(idx)), hours.length - 1);

  // surfFt is the breaking height the card shows; waveFt is the offshore height a forecast
  // cached before that existed would carry. Either answers "is there more of it than before".
  const at = (k) => {
    const h = hours[k];
    if (!h) return null;
    const v = h.surfFt != null ? h.surfFt : h.waveFt;
    return Number.isFinite(v) ? v : null;
  };

  const cur = at(i);
  if (cur == null) return null;

  // The nearest usable sample on each side, not strictly the adjacent one: an hour that failed
  // to parse should cost the reading precision, not silence it.
  let from = null;
  let to = null;
  for (let k = i - 1; k >= 0 && from == null; k--) from = at(k);
  for (let k = i + 1; k < hours.length && to == null; k++) to = at(k);

  // At the ends of the day there is only one neighbour, so the hour itself stands in for the
  // missing side. With neither, nothing is known about a direction and saying "steady" would be
  // inventing one.
  if (from == null && to == null) return null;
  const a = from == null ? cur : from;
  const b = to == null ? cur : to;

  const delta = b - a;
  const deadband = Math.max(STEADY_FT, cur * STEADY_FRACTION);
  if (Math.abs(delta) < deadband) return 'Steady';
  return delta > 0 ? 'Building' : 'Dropping';
}
