import { describe, it, expect } from 'vitest';
import { inArc, arcCentre, swellWindowFor, swellExposure, tideFit } from './spotmodel.js';
import { conditionsScore } from './rating.js';
import { SPOTS } from './spots.js';

describe('inArc', () => {
  it('handles a plain arc', () => {
    expect(inArc(210, 190, 240)).toBe(true);
    expect(inArc(180, 190, 240)).toBe(false);
    expect(inArc(250, 190, 240)).toBe(false);
  });
  it('handles an arc that wraps through north', () => {
    expect(inArc(350, 340, 50)).toBe(true);
    expect(inArc(10, 340, 50)).toBe(true);
    expect(inArc(180, 340, 50)).toBe(false);
  });
  it('is false for a missing direction', () => expect(inArc(null, 0, 90)).toBe(false));
});

describe('arcCentre', () => {
  it('finds the middle of a plain arc', () => expect(arcCentre(190, 240)).toBe(215));
  it('finds the middle of an arc wrapping through north', () => expect(arcCentre(340, 50)).toBe(15));
});

describe('swellWindowFor', () => {
  it('uses an explicit window when the spot has one', () => {
    const w = swellWindowFor({ swellWindow: [190, 240], offshoreDeg: 325 });
    expect(w.explicit).toBe(true);
    expect(w.ideal).toBe(215);
  });
  it('derives the physically exposed arc from offshoreDeg otherwise', () => {
    // Offshore wind blows land-to-sea, so the shore faces the opposite way, and land blocks
    // anything more than a right angle off that.
    const w = swellWindowFor({ offshoreDeg: 90 });
    expect(w.explicit).toBe(false);
    expect(w.ideal).toBe(270);
    expect(w.from).toBe(180);
    expect(w.to).toBe(0);
  });
  it('returns nothing with no data at all', () => {
    expect(swellWindowFor(null)).toBeNull();
    expect(swellWindowFor({})).toBeNull();
  });
});

describe('swellExposure', () => {
  it('is full inside an explicit window', () => {
    const w = swellWindowFor({ swellWindow: [190, 240] });
    for (const deg of [190, 215, 240]) expect(swellExposure(deg, w)).toBe(1);
  });
  it('softens rather than cliff-edges just outside a known window', () => {
    const w = swellWindowFor({ swellWindow: [190, 240] });
    expect(swellExposure(260, w)).toBeGreaterThan(-1); // refraction still gets some in
    expect(swellExposure(35, w)).toBe(-1);             // genuinely the wrong side
  });
  it('tapers across a derived arc instead of jumping', () => {
    const w = swellWindowFor({ offshoreDeg: 90 }); // faces 270
    expect(swellExposure(270, w)).toBe(1);
    expect(swellExposure(225, w)).toBe(1);
    expect(swellExposure(202, w)).toBeGreaterThan(0);
    expect(swellExposure(202, w)).toBeLessThan(1);
    expect(swellExposure(90, w)).toBe(-1); // straight offshore: blocked by the land
  });
});

describe('tideFit', () => {
  it('rewards the tide a spot actually wants', () => {
    expect(tideFit('low', 0)).toBe(1);
    expect(tideFit('low', 1)).toBe(-1);
    expect(tideFit('high', 1)).toBe(1);
    expect(tideFit('mid', 0.5)).toBe(1);
    expect(tideFit('mid', 0)).toBe(-1);
  });
  it('stays neutral for a break that is not fussy', () => {
    for (const t of [0, 0.25, 0.5, 1]) expect(tideFit('all', t)).toBe(0);
  });
  it('falls back to a half-weight mid-tide guess with no data', () => {
    expect(tideFit(undefined, 0.5)).toBe(0.5);
    expect(tideFit(undefined, 0)).toBe(-0.5);
  });
  it('is neutral with no tide reading', () => expect(tideFit('low', null)).toBe(0));
});

describe('the bug this replaces', () => {
  // The old rule set the ideal swell direction to offshoreDeg + 180 and docked 2 points for
  // anything more than 70 degrees off it. That assumes swell arrives perpendicular to the
  // beach, which is exactly what points and reefs do not do.
  it('no longer penalises a classic Jeffreys Bay swell', () => {
    const jbay = SPOTS.jbay;
    expect(jbay.offshoreDeg).toBe(325);      // old rule expected swell from 145
    expect(jbay.swellWindow).toEqual([190, 240]); // the real window is south-west

    const oldIdeal = (jbay.offshoreDeg + 180) % 360;
    expect(Math.abs(220 - oldIdeal)).toBeGreaterThan(70); // the old rule's -2 band

    const w = swellWindowFor(jbay);
    expect(swellExposure(220, w)).toBe(1);
  });

  it('scores a J-Bay day on its own swell higher than on the old assumed direction', () => {
    const jbay = SPOTS.jbay;
    const real = conditionsScore(5, 6, 'offshore', 14, 220, jbay.offshoreDeg, 0.5, jbay);
    const assumed = conditionsScore(5, 6, 'offshore', 14, 145, jbay.offshoreDeg, 0.5, jbay);
    expect(real).toBeGreaterThan(assumed);
  });

  it('still blocks swell that genuinely cannot reach a spot', () => {
    const jbay = SPOTS.jbay;
    // From the north-east, i.e. from over the land behind the point.
    const blocked = conditionsScore(5, 6, 'offshore', 14, 40, jbay.offshoreDeg, 0.5, jbay);
    const open = conditionsScore(5, 6, 'offshore', 14, 220, jbay.offshoreDeg, 0.5, jbay);
    expect(blocked).toBeLessThan(open);
  });
});

describe('spot data integrity', () => {
  const withWindow = Object.entries(SPOTS).filter(([, s]) => s.swellWindow);

  it('annotates a meaningful share of the catalog', () => {
    expect(withWindow.length).toBeGreaterThanOrEqual(50);
  });

  it('has well-formed windows and tides throughout', () => {
    for (const [key, s] of withWindow) {
      expect(Array.isArray(s.swellWindow), key).toBe(true);
      expect(s.swellWindow, key).toHaveLength(2);
      for (const d of s.swellWindow) {
        expect(Number.isFinite(d), key).toBe(true);
        expect(d >= 0 && d <= 360, key).toBe(true);
      }
      expect(['low', 'mid', 'high', 'all'], key).toContain(s.bestTide);
    }
  });

  it('leaves every un-annotated spot still scoreable through the derived arc', () => {
    for (const [key, s] of Object.entries(SPOTS)) {
      if (s.swellWindow) continue;
      const w = swellWindowFor(s);
      expect(w, key).not.toBeNull();
      expect(Number.isFinite(w.ideal), key).toBe(true);
    }
  });
});
