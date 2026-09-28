import { describe, it, expect } from 'vitest';
import { checkAlertMatch, meetsRating, daysLabel } from './alerts.js';

function forecastWithHours(waves) {
  return { hours: waves.map((w, i) => ({ t: i + 'a', wave: w })) };
}
function forecastWithContinuous(days) {
  // 8 samples/day, matching the real shape (today = offset 0).
  const continuous = [];
  days.forEach((day, dayIdx) => {
    for (let i = 0; i < 8; i++) continuous.push({ day: 'Day' + dayIdx, waveFt: day.waveFt, surfFt: day.surfFt, rating: day.rating });
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

describe('which height an alert is measured against', () => {
  // An alert is set in the numbers on screen, and those are breaking heights. Matching the
  // model's offshore height instead would silently hold back alerts on exactly the days the
  // transform exists for -- long-period swell, where the two differ most.
  function week(days) {
    const continuous = [];
    days.forEach((day, dayIdx) => {
      for (let i = 0; i < 8; i++) continuous.push({ day: 'Day' + dayIdx, ...day });
    });
    return { continuous };
  }

  it('fires on the breaking height, not the offshore height underneath it', () => {
    const sf = week([
      { waveFt: 2, surfFt: 2, rating: 'FAIR' },
      { waveFt: 3, surfFt: 4.6, rating: 'GOOD' }, // offshore under the threshold, surf over it
    ]);
    const match = checkAlertMatch({ id: 'a', spotId: 's', minWaveFt: 4, leadTime: '1d' }, sf);
    expect(match.hit).toBe(true);
  });

  it('falls back to the offshore height for a forecast cached before the transform existed', () => {
    const sf = week([
      { waveFt: 2, rating: 'FAIR' },
      { waveFt: 5, rating: 'GOOD' }, // no surfFt at all
    ]);
    expect(checkAlertMatch({ id: 'a', spotId: 's', minWaveFt: 4, leadTime: '1d' }, sf).hit).toBe(true);
  });
});

describe('rating alerts', () => {
  // A week of 3-hourly samples starting on a Sunday, every sample rated `rating` unless the
  // override names that day index and hour.
  function week(rating, overrides = {}) {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const continuous = [];
    days.forEach((day, d) => {
      for (let i = 0; i < 8; i++) {
        const hour = i * 3;
        continuous.push({ day, hour, rating: overrides[d + ':' + hour] || rating });
      }
    });
    return { continuous };
  }
  const base = { kind: 'rating', minRating: 'GOOD', leadTime: '1d', fromHour: 6, toHour: 18, days: [] };

  it('fires when the rating reaches the minimum inside your hours', () => {
    const r = checkAlertMatch(base, week('FAIR', { '1:9': 'GOOD' }));
    expect(r.hit).toBe(true);
    expect(r.text).toBe('Good for you Mon at 9a');
  });

  it('ignores a good hour outside your window', () => {
    const r = checkAlertMatch(base, week('FAIR', { '1:3': 'FIRING', '1:21': 'FIRING' }));
    expect(r.hit).toBe(false);
    expect(r.text).toBe('Best on Mon in your hours: fair');
  });

  it('ignores a day you cannot surf', () => {
    const r = checkAlertMatch({ ...base, days: [0, 6] }, week('FIRING'));
    expect(r.hit).toBe(false);
    expect(r.text).toBe('Mon is not one of your days');
  });

  it('treats no days as every day rather than never', () => {
    expect(checkAlertMatch({ ...base, days: undefined }, week('GOOD')).hit).toBe(true);
  });

  it('holds out for firing when that is what was asked for', () => {
    expect(checkAlertMatch({ ...base, minRating: 'FIRING' }, week('GOOD')).hit).toBe(false);
    expect(checkAlertMatch({ ...base, minRating: 'FIRING' }, week('GOOD', { '1:12': 'FIRING' })).hit).toBe(true);
  });

  it('looks further out for a longer lead time', () => {
    const sf = week('POOR', { '3:12': 'GOOD' }); // Wednesday
    expect(checkAlertMatch({ ...base, leadTime: '1d' }, sf).hit).toBe(false);
    expect(checkAlertMatch({ ...base, leadTime: '3d' }, sf).text).toBe('Good for you Wed at 12p');
  });

  it('checks today from the day\'s own hours', () => {
    const sf = { ...week('POOR'), hours: [{ hour: 7, rating: 'FAIR' }, { hour: 16, rating: 'GOOD' }] };
    expect(checkAlertMatch({ ...base, leadTime: '1h' }, sf).text).toBe('Good for you today at 4p');
    expect(checkAlertMatch({ ...base, leadTime: '1h', toHour: 12 }, sf).hit).toBe(false);
  });

  it('has nothing to say without a forecast that far out', () => {
    expect(checkAlertMatch({ ...base, leadTime: '3d' }, { continuous: [] })).toBeNull();
  });

  it('leaves height alerts working exactly as before', () => {
    const sf = forecastWithContinuous([{ waveFt: 2, rating: 'FAIR' }, { waveFt: 5, rating: 'GOOD' }]);
    expect(checkAlertMatch({ leadTime: '1d', minWaveFt: 4 }, sf).hit).toBe(true);
  });
});

describe('meetsRating', () => {
  it('orders the ratings', () => {
    expect(meetsRating('FIRING', 'GOOD')).toBe(true);
    expect(meetsRating('GOOD', 'GOOD')).toBe(true);
    expect(meetsRating('FAIR', 'GOOD')).toBe(false);
    expect(meetsRating(null, 'GOOD')).toBe(false);
  });
});

describe('daysLabel', () => {
  it('names the common sets and lists the rest', () => {
    expect(daysLabel([0, 1, 2, 3, 4, 5, 6])).toBe('every day');
    expect(daysLabel([])).toBe('every day');
    expect(daysLabel([5, 4, 3, 2, 1])).toBe('weekdays');
    expect(daysLabel([6, 0])).toBe('weekends');
    expect(daysLabel([1, 3])).toBe('Mon Wed');
  });
});

