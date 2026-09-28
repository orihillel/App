import { describe, it, expect } from 'vitest';
import { mySpotIds, mySpotRows, mySpotsSummary, dayParts } from './myspots.js';
import { ORDER as SEED_ORDER } from './spots.js';

const seedA = SEED_ORDER[0];
const seedB = SEED_ORDER[1];

const SPOTS = {
  [seedA]: { name: 'Seed A', region: 'Somewhere' },
  [seedB]: { name: 'Seed B', region: 'Somewhere' },
  mine1: { name: 'Mine One', region: 'Elsewhere' },
  mine2: { name: 'Mine Two', region: 'Elsewhere' },
};

function hour(given = {}) {
  return { hour: 9, rating: 'FAIR', score: 1, wave: '2-3', period: 10, swellDir: 'SW', windSpd: 8, windDeg: 90, type: 'offshore', ...given };
}

describe('mySpotIds', () => {
  it('is the go-to spot plus what you added, never the whole catalog', () => {
    const ids = mySpotIds([seedA, seedB, 'mine1', 'mine2'], SPOTS, seedA);
    expect(ids).toEqual([seedA, 'mine1', 'mine2']);
  });

  it('puts the go-to spot first and does not list it twice when it is also one you added', () => {
    expect(mySpotIds(['mine1', 'mine2'], SPOTS, 'mine2')).toEqual(['mine2', 'mine1']);
  });

  it('drops ids with no spot behind them, including a go-to that no longer exists', () => {
    expect(mySpotIds(['mine1', 'ghost'], SPOTS, 'ghost')).toEqual(['mine1']);
  });

  it('includes built-in spots you saved, never twice', () => {
    expect(mySpotIds([seedA, seedB, 'mine1'], SPOTS, seedA, [seedB, seedA])).toEqual([seedA, seedB, 'mine1']);
  });

  it('survives a missing order list', () => {
    expect(mySpotIds(null, SPOTS, 'mine1')).toEqual(['mine1']);
  });
});

describe('mySpotRows', () => {
  it('keeps your order rather than ranking, so the list does not reshuffle under a thumb', () => {
    const forecast = {
      mine1: { hours: [hour({ score: 1 })] },
      mine2: { hours: [hour({ score: 9, rating: 'FIRING' })] },
    };
    expect(mySpotRows(['mine1', 'mine2'], SPOTS, forecast, 9).map((r) => r.id)).toEqual(['mine1', 'mine2']);
  });

  it('picks the hour nearest the clock', () => {
    const forecast = { mine1: { hours: [hour({ hour: 6, wave: '1-2' }), hour({ hour: 14, wave: '4-6' })] } };
    expect(mySpotRows(['mine1'], SPOTS, forecast, 13)[0].hour.wave).toBe('4-6');
    expect(mySpotRows(['mine1'], SPOTS, forecast, 7)[0].hour.wave).toBe('1-2');
  });

  it('reads a one-hour Worker reading exactly as it reads a full forecast', () => {
    const forecast = { mine1: { now: true, hours: [hour({ hour: 11, rating: 'GOOD' })] } };
    expect(mySpotRows(['mine1'], SPOTS, forecast, 11)[0].hour.rating).toBe('GOOD');
  });

  it('reports a spot with no reading yet as null rather than zero', () => {
    const [row] = mySpotRows(['mine1'], SPOTS, {}, 9);
    expect(row.hour).toBeNull();
    expect(row.score).toBeNull();
  });

  it('treats a non-numeric score as no reading, not as a score', () => {
    // NaN and a string both pass a bare truthiness or null check and then poison every
    // comparison downstream, which is what the explicit isFinite is for.
    for (const bad of [null, undefined, NaN, Infinity, '4']) {
      const forecast = { mine1: { hours: [hour({ score: bad })] } };
      expect(mySpotRows(['mine1'], SPOTS, forecast, 9)[0].score).toBeNull();
    }
  });

  it('drops rows whose spot is unknown rather than rendering a nameless card', () => {
    expect(mySpotRows(['mine1', 'ghost'], SPOTS, {}, 9).map((r) => r.id)).toEqual(['mine1']);
  });
});

describe('mySpotsSummary', () => {
  const rows = (ratings) => ratings.map(([id, rating, score]) => ({
    id, spot: SPOTS[id], hour: hour({ rating, score }), score,
  }));

  it('names the best spot when more than one is worth a look, and counts them', () => {
    const s = mySpotsSummary(rows([['mine1', 'GOOD', 4], ['mine2', 'FIRING', 8]]));
    expect(s).toBe('Mine Two is the pick of 2 worth a look');
  });

  it('names the highest-scoring spot, not whichever came last in your order', () => {
    // The list is deliberately in your order rather than ranked, so the best one is routinely
    // not the last one -- picking the last would be right only by accident.
    const s = mySpotsSummary(rows([['mine2', 'FIRING', 8], ['mine1', 'GOOD', 4]]));
    expect(s).toBe('Mine Two is the pick of 2 worth a look');
  });

  it('drops the count when only one is worth a look', () => {
    const s = mySpotsSummary(rows([['mine1', 'GOOD', 4], ['mine2', 'POOR', -2]]));
    expect(s).toBe('Mine One is the pick right now');
  });

  it('says so plainly when nothing is firing rather than promoting the least bad option', () => {
    expect(mySpotsSummary(rows([['mine1', 'FAIR', 1], ['mine2', 'POOR', -2]])))
      .toBe('Nothing firing at your spots right now');
  });

  it('counts FIRING as worth a look alongside GOOD', () => {
    expect(mySpotsSummary(rows([['mine1', 'FIRING', 7]]))).toBe('Mine One is the pick right now');
  });

  it('says nothing at all until at least one reading has landed', () => {
    expect(mySpotsSummary([])).toBeNull();
    expect(mySpotsSummary([{ id: 'mine1', spot: SPOTS.mine1, hour: null, score: null }])).toBeNull();
    expect(mySpotsSummary(null)).toBeNull();
  });

  it('ignores spots still loading when picking the best of the ones that have answered', () => {
    const mixed = [
      { id: 'mine1', spot: SPOTS.mine1, hour: hour({ rating: 'GOOD', score: 4 }), score: 4 },
      { id: 'mine2', spot: SPOTS.mine2, hour: null, score: null },
    ];
    expect(mySpotsSummary(mixed)).toBe('Mine One is the pick right now');
  });
});

describe('dayParts', () => {
  const H = (hour, rating, score) => ({ hour, rating, score });
  const DAY = [H(6, 'GOOD', 5), H(8, 'FAIR', 3), H(10, 'POOR', 1), H(12, 'POOR', 1), H(14, 'FAIR', 2), H(16, 'FAIR', 3), H(18, 'FIRING', 7)];

  it('rates morning, midday and evening by their best hour', () => {
    const parts = dayParts(DAY, 7);
    expect(parts.map((p) => p.id)).toEqual(['morning', 'midday', 'evening']);
    expect(parts.map((p) => p.rating)).toEqual(['GOOD', 'FAIR', 'FIRING']);
    expect(parts[2].hour).toBe(18);
  });

  it('dims a part the clock has already passed', () => {
    const parts = dayParts(DAY, 15);
    expect(parts.map((p) => p.past)).toEqual([true, true, false]);
    expect(dayParts(DAY, null).some((p) => p.past)).toBe(false);
  });

  it('leaves a part with no daylight hours empty rather than borrowing', () => {
    // A short winter day: nothing before eleven.
    const parts = dayParts([H(11, 'GOOD', 5), H(15, 'POOR', 1)], 9);
    expect(parts[0].rating).toBeNull();
    expect(parts[1].rating).toBe('GOOD');
    expect(parts[2].rating).toBe('POOR');
  });

  it('has nothing to split without hours', () => {
    expect(dayParts(null, 9)).toBeNull();
    expect(dayParts([], 9)).toBeNull();
  });
});

describe('mySpotRows day parts', () => {
  it('splits a full forecast into parts and leaves a one-hour reading without', () => {
    const forecast = {
      mine1: { hours: [{ hour: 7, rating: 'GOOD', score: 5 }, { hour: 17, rating: 'POOR', score: 1 }] },
      mine2: { now: true, hours: [{ hour: 9, rating: 'FAIR', score: 3 }] },
    };
    const rows = mySpotRows(['mine1', 'mine2'], SPOTS, forecast, 9);
    expect(rows[0].parts.map((p) => p.rating)).toEqual(['GOOD', null, 'POOR']);
    expect(rows[1].parts).toBeNull();
  });
});

