import { describe, it, expect } from 'vitest';
import { checkAlertMatch } from './alerts.js';

function forecastWithHours(waves) {
  return { hours: waves.map((w, i) => ({ t: i + 'a', wave: w })) };
}
function forecastWithContinuous(days) {
  // 8 samples/day, matching the real shape (today = offset 0).
  const continuous = [];
  days.forEach((day, dayIdx) => {
    for (let i = 0; i < 8; i++) continuous.push({ day: 'Day' + dayIdx, waveFt: day.waveFt, rating: day.rating });
  });
  return { continuous, weekly: days.map((d, i) => ({ day: 'Day' + i, waveFt: d.waveFt })) };
}

describe('checkAlertMatch', () => {
  it('returns null when there is no forecast for the spot yet', () => {
    expect(checkAlertMatch({ leadTime: '1h', minWaveFt: 3 }, null)).toBeNull();
  });

  describe('1h lead time (today)', () => {
    it('matches when any hour meets the wave threshold', () => {
      const result = checkAlertMatch({ leadTime: '1h', minWaveFt: 4 }, forecastWithHours(['2-3', '4-5', '3-4']));
      expect(result.hit).toBe(true);
      expect(result.text).toContain('1a');
    });
    it('does not match when no hour meets it', () => {
      const result = checkAlertMatch({ leadTime: '1h', minWaveFt: 10 }, forecastWithHours(['2-3', '4-5']));
      expect(result.hit).toBe(false);
    });
  });

  describe('multi-day lead time', () => {
    it('matches a future day that has both size and a non-poor rating', () => {
      const sf = forecastWithContinuous([
        { waveFt: 2, rating: 'FAIR' }, // today, offset 0 — not checked for '1d'
        { waveFt: 5, rating: 'GOOD' }, // tomorrow, offset 1
      ]);
      const result = checkAlertMatch({ leadTime: '1d', minWaveFt: 4 }, sf);
      expect(result.hit).toBe(true);
      expect(result.text).toContain('GOOD'.toLowerCase());
    });

    it('reports size-but-blown-out separately from no-match, so the two failure modes read differently', () => {
      const sf = forecastWithContinuous([
        { waveFt: 2, rating: 'FAIR' },
        { waveFt: 5, rating: 'POOR' }, // big enough, but poor conditions
      ]);
      const result = checkAlertMatch({ leadTime: '1d', minWaveFt: 4 }, sf);
      expect(result.hit).toBe(false);
      expect(result.text).toMatch(/wind looks poor/);
    });

    it('falls back to wave-only weekly data when there is no wind data that far out', () => {
      const sf = { continuous: [], weekly: [{ day: 'Today', waveFt: 2 }, { day: 'Tomorrow', waveFt: 5 }] };
      const result = checkAlertMatch({ leadTime: '1d', minWaveFt: 4 }, sf);
      expect(result.hit).toBe(false);
      expect(result.text).toContain('5ft');
    });

    it('returns null when neither continuous nor weekly data reaches that far out', () => {
      const sf = { continuous: [], weekly: [{ day: 'Today', waveFt: 2 }] }; // no index 1
      expect(checkAlertMatch({ leadTime: '1d', minWaveFt: 4 }, sf)).toBeNull();
    });
  });
});
