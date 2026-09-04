import { describe, it, expect } from 'vitest';
import {
  makeSession, clampStars, addSession, removeSession, ratingAccuracy, sessionStats, MAX_SESSIONS,
} from './sessions.js';

describe('makeSession', () => {
  it('records what the app predicted alongside what you thought', () => {
    const s = makeSession({ spotId: 'trestles', spotName: 'Lower Trestles', rating: 'GOOD', waveFt: 3.75, stars: 4 });
    expect(s.rating).toBe('GOOD');
    expect(s.waveFt).toBe(3.8);
    expect(s.stars).toBe(4);
    expect(s.spotId).toBe('trestles');
  });
  it('defaults the date to today', () => {
    expect(makeSession({ spotId: 'a' }).date).toBe(new Date().toISOString().slice(0, 10));
  });
  it('gives every session a distinct id', () => {
    const ids = new Set(Array.from({ length: 50 }, () => makeSession({ spotId: 'a' }).id));
    expect(ids.size).toBe(50);
  });
  it('caps the note so one entry cannot bloat the synced blob', () => {
    expect(makeSession({ spotId: 'a', note: 'x'.repeat(500) }).note).toHaveLength(280);
  });
  it('survives missing fields', () => {
    const s = makeSession({});
    expect(s.rating).toBeNull();
    expect(s.waveFt).toBeNull();
    expect(s.note).toBe('');
  });
});

describe('clampStars', () => {
  it('holds to 1..5', () => {
    expect(clampStars(0)).toBe(1);
    expect(clampStars(9)).toBe(5);
    expect(clampStars(3)).toBe(3);
    expect(clampStars(3.4)).toBe(3);
  });
  it('defaults to the middle for nonsense', () => {
    expect(clampStars(undefined)).toBe(3);
    expect(clampStars('abc')).toBe(3);
  });
});

describe('addSession / removeSession', () => {
  it('puts the newest first', () => {
    const a = makeSession({ spotId: 'a' });
    const b = makeSession({ spotId: 'b' });
    expect(addSession([a], b)[0].spotId).toBe('b');
  });
  it('caps the list so it cannot grow without limit', () => {
    let list = [];
    for (let i = 0; i < MAX_SESSIONS + 25; i++) list = addSession(list, makeSession({ spotId: 'a' }));
    expect(list).toHaveLength(MAX_SESSIONS);
  });
  it('tolerates a missing or corrupt list', () => {
    expect(addSession(null, makeSession({ spotId: 'a' }))).toHaveLength(1);
    expect(addSession(undefined, makeSession({ spotId: 'a' }))).toHaveLength(1);
    expect(removeSession(null, 'x')).toEqual([]);
  });
  it('removes by id only', () => {
    const a = makeSession({ spotId: 'a' });
    const b = makeSession({ spotId: 'b' });
    const left = removeSession([a, b], a.id);
    expect(left).toHaveLength(1);
    expect(left[0].id).toBe(b.id);
  });
});

describe('ratingAccuracy', () => {
  const s = (rating, stars) => makeSession({ spotId: 'a', rating, stars });

  it('says nothing until there is enough to mean anything', () => {
    expect(ratingAccuracy([])).toBeNull();
    expect(ratingAccuracy([s('GOOD', 4), s('GOOD', 4)])).toBeNull();
  });

  it('groups your scores by what the app predicted', () => {
    const result = ratingAccuracy([s('FIRING', 5), s('FIRING', 5), s('POOR', 1), s('POOR', 2)]);
    expect(result.total).toBe(4);
    const firing = result.rows.find((r) => r.rating === 'FIRING');
    const poor = result.rows.find((r) => r.rating === 'POOR');
    expect(firing.avgStars).toBe(5);
    expect(poor.avgStars).toBe(1.5);
    expect(firing.avgStars).toBeGreaterThan(poor.avgStars);
  });

  it('can show the rating disagreeing with reality, which is the point', () => {
    // If "FIRING" days keep scoring badly, the rating is not working at your spots.
    const result = ratingAccuracy([s('FIRING', 1), s('FIRING', 2), s('FAIR', 5), s('FAIR', 4)]);
    expect(result.rows[0].rating).toBe('FAIR');
  });

  it('ignores sessions with nothing to compare', () => {
    const result = ratingAccuracy([s('GOOD', 4), s('GOOD', 4), s('GOOD', 4), makeSession({ spotId: 'a' })]);
    expect(result.total).toBe(3);
  });
});

describe('sessionStats', () => {
  it('is empty-safe', () => {
    expect(sessionStats([])).toEqual({ total: 0, spots: 0, bestSpot: null, avgStars: null });
    expect(sessionStats(null).total).toBe(0);
  });
  it('counts sessions, distinct spots and your most-surfed', () => {
    const list = [
      makeSession({ spotId: 'a', spotName: 'Trestles', stars: 4 }),
      makeSession({ spotId: 'a', spotName: 'Trestles', stars: 2 }),
      makeSession({ spotId: 'b', spotName: 'Blacks', stars: 3 }),
    ];
    const stats = sessionStats(list);
    expect(stats.total).toBe(3);
    expect(stats.spots).toBe(2);
    expect(stats.bestSpot).toEqual({ name: 'Trestles', sessions: 2 });
    expect(stats.avgStars).toBe(3);
  });
});
