// Tide events read off the modeled sea-level curve.
//
// This function used to live in placeholders.js, alongside a set of invented wave heights,
// a sine-wave tide curve and a fake week of swell that the app rendered whenever the real
// fetch was slow or failed. Those are gone (see HomeView for what replaced them); this was
// the only thing in that file computed from real data, so it moved here.
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

// What the tide is doing right now, in the words people actually use on a beach: it is high,
// low, pushing in, or pulling out.
//
// "Next High 3p" answers what happens later. It does not answer what is happening now, and the
// two can look alike at a glance -- a tide two hours off its high and a tide two hours past it
// both read "Next Low 6p" while behaving oppositely, which is the difference between a spot
// that is filling in and one that is draining out.
//
// A turn is a sample higher (or lower) than the hours either side of it, the same test
// nextTideEvent uses, so the two cannot disagree about where the highs and lows are. Everything
// else is going one way or the other, and which way is the sign of the slope across that hour.
export function tideState(tideFine, hour) {
  if (!Array.isArray(tideFine) || tideFine.length < 2 || !Number.isFinite(hour)) return null;

  // The sample nearest the hour asked about, rather than one at exactly that hour: the curve is
  // hourly and the hours the spot page shows are its own daylight samples, which need not line
  // up with it.
  let i = 0;
  let bestGap = Infinity;
  for (let k = 0; k < tideFine.length; k++) {
    const t = tideFine[k];
    if (!t || !Number.isFinite(t.hour) || !Number.isFinite(t.ft)) continue;
    const gap = Math.abs(t.hour - hour);
    if (gap < bestGap) { bestGap = gap; i = k; }
  }
  const cur = tideFine[i];
  if (!cur || !Number.isFinite(cur.ft)) return null;
  const prev = i > 0 ? tideFine[i - 1] : null;
  const next = i < tideFine.length - 1 ? tideFine[i + 1] : null;

  if (prev && next && Number.isFinite(prev.ft) && Number.isFinite(next.ft)) {
    if (cur.ft > prev.ft && cur.ft > next.ft) return 'High';
    if (cur.ft < prev.ft && cur.ft < next.ft) return 'Low';
  }

  // Not a turn, so it is on its way somewhere. Measured across both neighbours where there are
  // two, and against the one there is at the ends of the day.
  const from = prev && Number.isFinite(prev.ft) ? prev.ft : cur.ft;
  const to = next && Number.isFinite(next.ft) ? next.ft : cur.ft;
  if (to > from) return 'Pushing';
  if (to < from) return 'Pulling';
  return null;
}
