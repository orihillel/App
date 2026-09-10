import { describe, it, expect } from 'vitest';
import { shouldRefetchOnResume } from './refresh.js';

const MAX = 15 * 60 * 1000;
const T = 1_800_000_000_000;

describe('shouldRefetchOnResume', () => {
  it('refetches when the app comes back after longer than the refresh window', () => {
    expect(shouldRefetchOnResume({ fetchedAt: T, now: T + MAX, maxAgeMs: MAX })).toBe(true);
    expect(shouldRefetchOnResume({ fetchedAt: T, now: T + 8 * 60 * 60 * 1000, maxAgeMs: MAX })).toBe(true);
  });

  it('does not refetch for a glance away and back', () => {
    expect(shouldRefetchOnResume({ fetchedAt: T, now: T + 30_000, maxAgeMs: MAX })).toBe(false);
    expect(shouldRefetchOnResume({ fetchedAt: T, now: T + MAX - 1, maxAgeMs: MAX })).toBe(false);
  });

  it('ignores the event fired on the way out, not just the way in', () => {
    expect(shouldRefetchOnResume({ visibilityState: 'hidden', fetchedAt: T, now: T + 10 * MAX, maxAgeMs: MAX })).toBe(false);
  });

  it('refetches when the age cannot be established at all', () => {
    for (const bad of [undefined, null, NaN, 'earlier']) {
      expect(shouldRefetchOnResume({ fetchedAt: bad, now: T, maxAgeMs: MAX })).toBe(true);
    }
    expect(shouldRefetchOnResume({ fetchedAt: T, now: T, maxAgeMs: undefined })).toBe(true);
    expect(shouldRefetchOnResume({ fetchedAt: T, now: T, maxAgeMs: 0 })).toBe(true);
  });

  it('refetches rather than trusting a clock that has gone backwards', () => {
    // Otherwise a device correcting its time makes the cached entry look permanently fresh.
    expect(shouldRefetchOnResume({ fetchedAt: T, now: T - 60_000, maxAgeMs: MAX })).toBe(true);
  });
});
