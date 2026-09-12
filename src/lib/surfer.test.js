import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PROFILE, BOARD_IDS, SKILL_IDS, normalizeProfile, bandFor, weightsFor, sizeFit,
  boardLabel, skillLabel,
} from './surfer.js';

describe('normalizeProfile', () => {
  it('falls back to the default for anything it does not recognise', () => {
    for (const junk of [null, undefined, 'shortboard', 42, {}, { board: 'jetski', skill: 'pro' }]) {
      expect(normalizeProfile(junk)).toEqual(DEFAULT_PROFILE);
    }
  });

  it('keeps a valid board even when the skill is junk, and vice versa', () => {
    expect(normalizeProfile({ board: 'foil', skill: 'nope' }))
      .toEqual({ board: 'foil', skill: DEFAULT_PROFILE.skill });
    expect(normalizeProfile({ board: 'nope', skill: 'beginner' }))
      .toEqual({ board: DEFAULT_PROFILE.board, skill: 'beginner' });
  });

  it('accepts every id it advertises', () => {
    for (const board of BOARD_IDS) for (const skill of SKILL_IDS) {
      expect(normalizeProfile({ board, skill })).toEqual({ board, skill });
    }
  });
});

describe('bandFor', () => {
  it('reproduces the 3ft FIRING floor the old hard-coded constant set, for the default profile', () => {
    // rating.js used to carry `FIRING_MIN_WAVE_FT = 3`. That constant is now the bottom of the
    // default profile's band, so this pins the two together: if the default band's floor moves,
    // the meaning of FIRING silently moves with it.
    expect(bandFor(DEFAULT_PROFILE).lo).toBe(3);
  });

  it('lowers the ceiling for a beginner and raises it for an advanced surfer', () => {
    const beginner = bandFor({ board: 'shortboard', skill: 'beginner' });
    const inter = bandFor({ board: 'shortboard', skill: 'intermediate' });
    const advanced = bandFor({ board: 'shortboard', skill: 'advanced' });
    expect(beginner.hi).toBeLessThan(inter.hi);
    expect(advanced.hi).toBeGreaterThan(inter.hi);
    expect(beginner.lo).toBeLessThan(inter.lo);
    expect(advanced.lo).toBeGreaterThan(inter.lo);
  });

  it('makes a beginner fall off faster above the band and an advanced surfer slower', () => {
    const beginner = bandFor({ board: 'softtop', skill: 'beginner' });
    const advanced = bandFor({ board: 'softtop', skill: 'advanced' });
    expect(beginner.over).toBeGreaterThan(advanced.over);
  });

  it('never returns an inverted band, however the multipliers land', () => {
    for (const board of BOARD_IDS) for (const skill of SKILL_IDS) {
      const b = bandFor({ board, skill });
      expect(b.hi).toBeGreaterThanOrEqual(b.lo);
      expect(b.lo).toBeGreaterThan(0);
    }
  });

  it('wants smaller surf for a foil than for a shortboard', () => {
    expect(bandFor({ board: 'foil' }).hi).toBeLessThan(bandFor({ board: 'shortboard' }).hi);
    expect(bandFor({ board: 'foil' }).lo).toBeLessThan(bandFor({ board: 'shortboard' }).lo);
  });

  it('wants bigger surf for a bodyboard than for a longboard', () => {
    expect(bandFor({ board: 'bodyboard' }).hi).toBeGreaterThan(bandFor({ board: 'longboard' }).hi);
  });
});

describe('weightsFor', () => {
  it('makes a SUP the most wind-averse craft and a bodyboard the least', () => {
    const w = (board) => weightsFor({ board }).windWeight;
    const all = BOARD_IDS.map(w);
    expect(w('sup')).toBe(Math.max(...all));
    expect(w('bodyboard')).toBe(Math.min(...all));
  });

  it('makes period matter least to a foil and most to a shortboard', () => {
    const p = (board) => weightsFor({ board }).periodWeight;
    const all = BOARD_IDS.map(p);
    expect(p('foil')).toBe(Math.min(...all));
    expect(p('shortboard')).toBe(Math.max(...all));
  });

  it('leaves the default profile on neutral weights, so nothing is scaled until asked', () => {
    expect(weightsFor(DEFAULT_PROFILE)).toEqual({ periodWeight: 1, windWeight: 1 });
  });
});

describe('sizeFit', () => {
  it('scores the top of the range for anything inside the band', () => {
    const { lo, hi } = bandFor(DEFAULT_PROFILE);
    const inside = sizeFit((lo + hi) / 2, DEFAULT_PROFILE);
    expect(sizeFit(lo, DEFAULT_PROFILE)).toBe(inside);
    expect(sizeFit(hi, DEFAULT_PROFILE)).toBe(inside);
    expect(inside).toBeGreaterThan(0);
  });

  it('falls away on both sides of the band', () => {
    const { lo, hi } = bandFor(DEFAULT_PROFILE);
    expect(sizeFit(lo - 0.5, DEFAULT_PROFILE)).toBeLessThan(sizeFit(lo, DEFAULT_PROFILE));
    expect(sizeFit(lo - 1.5, DEFAULT_PROFILE)).toBeLessThan(sizeFit(lo - 0.5, DEFAULT_PROFILE));
    expect(sizeFit(hi + 0.5, DEFAULT_PROFILE)).toBeLessThan(sizeFit(hi, DEFAULT_PROFILE));
    expect(sizeFit(hi + 3, DEFAULT_PROFILE)).toBeLessThan(sizeFit(hi + 0.5, DEFAULT_PROFILE));
  });

  it('punishes being over your head far harder than being under-gunned', () => {
    // The asymmetry that stopped a glassy 8ft morning reading GOOD for a beginner on a foamie.
    const p = { board: 'softtop', skill: 'beginner' };
    const { lo, hi } = bandFor(p);
    expect(sizeFit(hi + 6, p)).toBeLessThan(sizeFit(Math.max(0, lo - 6), p));
  });

  it('floors deep enough above the band to outvote a perfect day everywhere else', () => {
    // Glass (+3), groundswell (+2) and a square swell window (+2) come to +7. The over-floor has
    // to beat that on its own or an unmanageable day can still be rated well.
    const p = { board: 'softtop', skill: 'beginner' };
    expect(sizeFit(bandFor(p).hi + 20, p)).toBeLessThan(-7);
  });

  it('stops short of that floor below the band, where a small day is only a wasted drive', () => {
    // Pinned to the exact value rather than a bound, because the two floors only mean anything
    // relative to the +7 a perfect day scores everywhere else: the over-floor has to beat it and
    // the under-floor has to lose to it. A loose assertion here passed happily with both floors
    // set to the same number, which is the one thing this is meant to rule out.
    const p = { board: 'shortboard', skill: 'advanced' };
    expect(sizeFit(0, p)).toBe(-3);
    expect(sizeFit(0, p)).toBeGreaterThan(sizeFit(bandFor(p).hi + 20, p));
  });

  it('never runs away to an unbounded number', () => {
    for (const board of BOARD_IDS) for (const skill of SKILL_IDS) {
      for (const ft of [0, 0.1, 100, 1000]) {
        expect(Number.isFinite(sizeFit(ft, { board, skill }))).toBe(true);
      }
    }
  });

  it('scores nothing rather than NaN when the height is missing or not a number', () => {
    for (const bad of [null, undefined, NaN, Infinity]) {
      expect(sizeFit(bad, DEFAULT_PROFILE)).toBe(0);
    }
  });

  it('rates the same 2ft morning better for a longboard than a shortboard, and 8ft the reverse', () => {
    // The single claim the whole feature rests on.
    expect(sizeFit(2, { board: 'longboard' })).toBeGreaterThan(sizeFit(2, { board: 'shortboard' }));
    expect(sizeFit(8, { board: 'shortboard' })).toBeGreaterThan(sizeFit(8, { board: 'longboard' }));
  });
});

describe('labels', () => {
  it('names every id, and falls back rather than returning undefined', () => {
    for (const id of BOARD_IDS) expect(boardLabel(id)).toBeTruthy();
    for (const id of SKILL_IDS) expect(skillLabel(id)).toBeTruthy();
    expect(boardLabel('nope')).toBe(boardLabel(DEFAULT_PROFILE.board));
    expect(skillLabel('nope')).toBe(skillLabel(DEFAULT_PROFILE.skill));
  });
});
