// When a forecast on screen is old enough to be worth fetching again.
//
// Extracted from the effect that uses it so the rule can be tested: App.jsx holds orchestration,
// and a decision with four edge cases in it is not orchestration.
//
// The case this exists for is a PWA opened from a phone's Home Screen. A setInterval only runs
// while the page is alive, and a backgrounded tab has its timers throttled and then suspended --
// so checking the surf in the morning, locking the phone, and opening it again that afternoon
// showed the morning's forecast, rated and labelled exactly as confidently as when it was
// fetched, with nothing refetching and nothing saying how old it was.
export function shouldRefetchOnResume({ visibilityState = 'visible', fetchedAt, now = Date.now(), maxAgeMs } = {}) {
  // Coming back is the trigger, not leaving: a visibilitychange also fires on the way out.
  if (visibilityState !== 'visible') return false;
  // Never fetched, or a stored entry from a build that did not stamp one. Nothing is known about
  // its age, and refetching is the answer that cannot be wrong.
  if (!Number.isFinite(fetchedAt)) return true;
  if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) return true;
  // A clock that has gone backwards would make any entry look infinitely fresh, which is the one
  // direction this must not fail in.
  const age = now - fetchedAt;
  if (age < 0) return true;
  return age >= maxAgeMs;
}
