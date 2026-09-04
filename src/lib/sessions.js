// A log of the sessions you actually surfed.
//
// Everything else in this app is about deciding whether to go. This is the other half — what
// happened when you did — and it is the feature that turns a forecast checker into something
// you keep coming back to. Surfline built session tracking for exactly that reason.
//
// The point is not a diary. It is that a logged session pins a rating to a memory: the app said
// GOOD and you agreed, or it said GOOD and it was blown out, and over a season that is the only
// honest way to find out whether the rating is any use at your spots. So each entry keeps what
// the app predicted alongside what you thought of it.

export const MAX_SESSIONS = 500;

export function makeSession({ spotId, spotName, date, rating, waveFt, stars, note }) {
  return {
    id: 's_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
    spotId,
    spotName,
    date: date || new Date().toISOString().slice(0, 10),
    // What the app thought at the time, so a rating can be checked against reality later.
    rating: rating || null,
    waveFt: waveFt != null ? +Number(waveFt).toFixed(1) : null,
    // What you thought: 1–5.
    stars: clampStars(stars),
    note: typeof note === 'string' ? note.slice(0, 280) : '',
    loggedAt: Date.now(),
  };
}

export function clampStars(stars) {
  const n = Math.round(Number(stars));
  if (!Number.isFinite(n)) return 3;
  return Math.max(1, Math.min(5, n));
}

// Newest first, and capped — this rides along in the synced blob, so it cannot grow without
// limit. 500 sessions is more than a decade of surfing twice a week.
export function addSession(sessions, session) {
  const list = Array.isArray(sessions) ? sessions : [];
  return [session, ...list].slice(0, MAX_SESSIONS);
}

export function removeSession(sessions, id) {
  return (Array.isArray(sessions) ? sessions : []).filter((s) => s.id !== id);
}

// Only sessions that recorded what the app predicted can say anything about the rating.
export function ratingAccuracy(sessions) {
  const usable = (Array.isArray(sessions) ? sessions : []).filter((s) => s.rating && s.stars != null);
  if (usable.length < 3) return null; // too few to mean anything
  const byRating = {};
  for (const s of usable) {
    (byRating[s.rating] ||= []).push(s.stars);
  }
  const rows = Object.entries(byRating).map(([rating, stars]) => ({
    rating,
    sessions: stars.length,
    avgStars: +(stars.reduce((a, b) => a + b, 0) / stars.length).toFixed(1),
  }));
  rows.sort((a, b) => b.avgStars - a.avgStars);
  return { total: usable.length, rows };
}

export function sessionStats(sessions) {
  const list = Array.isArray(sessions) ? sessions : [];
  if (list.length === 0) return { total: 0, spots: 0, bestSpot: null, avgStars: null };
  const counts = {};
  let starSum = 0, starN = 0;
  for (const s of list) {
    if (s.spotName) counts[s.spotName] = (counts[s.spotName] || 0) + 1;
    if (s.stars != null) { starSum += s.stars; starN += 1; }
  }
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return {
    total: list.length,
    spots: entries.length,
    bestSpot: entries.length ? { name: entries[0][0], sessions: entries[0][1] } : null,
    avgStars: starN ? +(starSum / starN).toFixed(1) : null,
  };
}
