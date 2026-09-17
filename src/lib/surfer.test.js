import { describe, it, expect } from 'vitest';
import { DEFAULT_PROFILE, BOARD_IDS, SKILL_IDS, normalizeProfile, bandFor, weightsFor, sizeFit,
  boardLabel, skillLabel, windBandFor, windFit } from './surfer.js';

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

  it('makes period matter least to a foil and most to a shortboard, among paddled craft', () => {
    const p = (board) => weightsFor({ board }).periodWeight;
    const paddled = BOARD_IDS.filter((id) => !windBandFor({ board: id }));
    expect(p('foil')).toBe(Math.min(...paddled.map(p)));
    expect(p('shortboard')).toBe(Math.max(...BOARD_IDS.map(p)));
  });

  it('makes period matter even less to anything the wind powers', () => {
    // A craft that makes its own speed does not need the wave to have any. None of them should
    // care about swell period more than the paddled craft that cares about it least.
    const p = (board) => weightsFor({ board }).periodWeight;
    for (const id of BOARD_IDS.filter((b) => windBandFor({ board: b }))) {
      expect(p(id), id).toBeLessThanOrEqual(p('foil'));
    }
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

// The four wind-powered craft invert the single most important term in the score. Everything a
// surfer wants from the wind, they do not: a glassy morning is the best day of a surfer's week
// and the one day a kite cannot leave the beach.
describe('wind-powered craft', () => {
  const POWERED = ['wingfoil', 'windsurf', 'kitesurf', 'kitefoil'];
  const PADDLED = ['shortboard', 'longboard', 'fish', 'bodyboard', 'sup', 'foil', 'softtop'];

  it('gives a wind band to exactly the craft that ride the wind', () => {
    for (const id of POWERED) expect(windBandFor({ board: id }), id).toBeTruthy();
    for (const id of PADDLED) expect(windBandFor({ board: id }), id).toBeNull();
  });

  it('every band is ordered and inside what anyone actually sails in', () => {
    for (const id of POWERED) {
      const { lo, hi } = windBandFor({ board: id });
      expect(hi, id).toBeGreaterThan(lo);
      expect(lo, id).toBeGreaterThan(5);
      expect(hi, id).toBeLessThan(45);
    }
  });

  it('needs the least wind on a foil and the most on a rig', () => {
    // A foil flies in what nobody else can use; a sail needs real wind to plane at all.
    const lo = (id) => windBandFor({ board: id }).lo;
    expect(lo('kitefoil')).toBe(Math.min(...POWERED.map(lo)));
    expect(lo('windsurf')).toBe(Math.max(...POWERED.map(lo)));
  });

  describe('windFit', () => {
    const band = { lo: 12, hi: 32 };

    it('treats glass as the day you cannot go, not the best day of the week', () => {
      const flat = windFit(1, 'offshore', band);
      expect(flat.points).toBeLessThan(0);
      expect(flat.text).toContain('nothing to ride');
    });

    it('falls away fast below the band rather than easing off', () => {
      // Half the minimum is not half a session.
      expect(windFit(6, 'cross', band).points).toBeLessThan(windFit(11, 'cross', band).points);
      expect(windFit(11, 'cross', band).points).toBeLessThan(windFit(15, 'cross', band).points);
    });

    it('rewards being in the band, best of all cross-shore', () => {
      expect(windFit(20, 'cross', band).points).toBeGreaterThan(0);
      expect(windFit(20, 'cross', band).points).toBeGreaterThan(windFit(20, 'onshore', band).points);
    });

    it('penalises an offshore inside the band, because that one is a hazard', () => {
      // Lose power on a straight offshore and what is blowing you flat is blowing you out to
      // sea. Every school refuses to launch in it; the app should not be recommending it.
      expect(windFit(20, 'offshore', band).points).toBeLessThan(0);
      expect(windFit(20, 'offshore', band).text).toContain('off the beach');
    });

    it('turns against being overpowered above the band', () => {
      expect(windFit(40, 'cross', band).points).toBeLessThan(windFit(30, 'cross', band).points);
      expect(windFit(50, 'cross', band).points).toBeLessThan(0);
    });

    it('has a floor at both ends, so wind alone cannot swamp every other term', () => {
      expect(windFit(0, 'cross', band).points).toBeGreaterThan(-10);
      expect(windFit(200, 'cross', band).points).toBeGreaterThan(-10);
    });

    it('says nothing at all for a craft with no band, so the surf model still runs', () => {
      expect(windFit(20, 'cross', null)).toBeNull();
      expect(windFit(null, 'cross', band)).toBeNull();
      expect(windFit(NaN, 'cross', band)).toBeNull();
    });
  });
});
