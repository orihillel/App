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
