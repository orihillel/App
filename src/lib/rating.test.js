import { describe, it, expect } from 'vitest';
import { degToCompass, angDiff, windType, windAngleColor, conditionsScore, scoreToRating, rateConditions, scoreToColor } from './rating.js';

describe('degToCompass', () => {
  it('maps cardinal and intercardinal degrees to their labels', () => {
    expect(degToCompass(0)).toBe('N');
    expect(degToCompass(90)).toBe('E');
    expect(degToCompass(180)).toBe('S');
    expect(degToCompass(270)).toBe('W');
    expect(degToCompass(45)).toBe('NE');
  });
  it('wraps negative and >360 degrees the same as their normalized value', () => {
    expect(degToCompass(-90)).toBe(degToCompass(270));
    expect(degToCompass(360 + 45)).toBe('NE');
  });
});

describe('angDiff', () => {
  it('is the short way around the circle, never more than 180', () => {
    expect(angDiff(10, 20)).toBe(10);
    expect(angDiff(350, 10)).toBe(20);
    expect(angDiff(0, 180)).toBe(180);
    expect(angDiff(0, 190)).toBe(170);
  });
});

describe('windType', () => {
  it('classifies within 50deg of offshore as offshore, within 50 of onshore as onshore, else cross', () => {
    expect(windType(90, 90)).toBe('offshore'); // wind blowing exactly along offshoreDeg
    expect(windType(140, 90)).toBe('offshore'); // 50deg off, boundary still offshore
    expect(windType(270, 90)).toBe('onshore'); // dead opposite
    expect(windType(230, 90)).toBe('onshore'); // 140deg off, boundary still onshore
    expect(windType(180, 90)).toBe('cross'); // 90deg off, in between
  });
});

describe('windAngleColor', () => {
  it('is pure green at dead-offshore and pure red at dead-onshore', () => {
    expect(windAngleColor(90, 90)).toBe('hsl(120, 72%, 50%)');
    expect(windAngleColor(270, 90)).toBe('hsl(0, 72%, 50%)');
  });
});

describe('conditionsScore', () => {
  it('scores light offshore wind, solid size, and a long-period groundswell highly', () => {
    // Real numbers a spot might see on a good day: 5ft @ 8mph offshore, 13s period, swell
    // arriving from the ideal window (opposite the offshore direction), mid-tide.
    const score = conditionsScore(5, 8, 'offshore', 13, 270, 90, 0.5);
    expect(score).toBeGreaterThanOrEqual(6);
    expect(scoreToRating(score)).toBe('FIRING');
  });

  it('scores strong onshore wind on small short-period surf poorly', () => {
    const score = conditionsScore(1.5, 18, 'onshore', 6, null, null, null);
    expect(score).toBeLessThan(0);
    expect(scoreToRating(score)).toBe('POOR');
  });

  it('treats sub-3mph wind as glassy regardless of its labeled type', () => {
    // 'onshore' direction, but under the glassy threshold — should score like the calm case,
    // not get penalized as if it were meaningfully onshore.
    const glassyOnshore = conditionsScore(3, 2, 'onshore', null, null, null, null);
    const glassyOffshore = conditionsScore(3, 2, 'offshore', null, null, null, null);
    expect(glassyOnshore).toBe(glassyOffshore);
  });

  it('penalizes gale-force wind even when technically offshore', () => {
    const lightOffshore = conditionsScore(4, 8, 'offshore', null, null, null, null);
    const galeOffshore = conditionsScore(4, 25, 'offshore', null, null, null, null);
    expect(galeOffshore).toBeLessThan(lightOffshore);
  });

  it('rewards long-period groundswell over short-period wind chop at the same height', () => {
    const groundswell = conditionsScore(4, 8, 'offshore', 14, null, null, null);
    const windswell = conditionsScore(4, 8, 'offshore', 6, null, null, null);
    expect(groundswell).toBeGreaterThan(windswell);
  });

  it('rewards swell arriving from the window opposite the offshore direction', () => {
    const onWindow = conditionsScore(4, 8, 'offshore', 10, 270, 90, null); // 180deg from offshoreDeg
    const offWindow = conditionsScore(4, 8, 'offshore', 10, 90, 90, null); // same as offshoreDeg — wrong side
    expect(onWindow).toBeGreaterThan(offWindow);
  });

  it('favors mid-tide over a tide extreme, all else equal', () => {
    const midTide = conditionsScore(4, 8, 'offshore', null, null, null, 0.5);
    const extremeTide = conditionsScore(4, 8, 'offshore', null, null, null, 0.95);
    expect(midTide).toBeGreaterThan(extremeTide);
  });

  it('leaves optional factors out of the score entirely when null', () => {
    // period/swellDeg/offshoreDeg/tidePosition all null — should reduce to just wind+wave.
    const withNulls = conditionsScore(4, 8, 'offshore', null, null, null, null);
    const windAndWaveOnly = 3 /* offshore <=10mph */ + 2 /* wave >= 4 */;
    expect(withNulls).toBe(windAndWaveOnly);
  });
});

describe('scoreToRating', () => {
  it('buckets at the documented thresholds', () => {
    expect(scoreToRating(6)).toBe('FIRING');
    expect(scoreToRating(5.9)).toBe('GOOD');
    expect(scoreToRating(3)).toBe('GOOD');
    expect(scoreToRating(2.9)).toBe('FAIR');
    expect(scoreToRating(0)).toBe('FAIR');
    expect(scoreToRating(-0.1)).toBe('POOR');
  });
});

describe('rateConditions', () => {
  it('is conditionsScore piped through scoreToRating', () => {
    expect(rateConditions(5, 8, 'offshore', 13, 270, 90)).toBe(
      scoreToRating(conditionsScore(5, 8, 'offshore', 13, 270, 90))
    );
  });
});

describe('scoreToColor', () => {
  it('returns red at the low end and green at the high end of the score range', () => {
    expect(scoreToColor(-5)).toBe('hsl(0, 68%, 50%)');
    expect(scoreToColor(10)).toBe('hsl(140, 68%, 50%)');
  });
  it('clamps out-of-range scores instead of producing hues outside 0-140', () => {
    expect(scoreToColor(-100)).toBe(scoreToColor(-5));
    expect(scoreToColor(100)).toBe(scoreToColor(10));
  });
  it('never emits an invalid hsl() for NaN/undefined — that silently breaks Three.js color parsing', () => {
    expect(scoreToColor(NaN)).toBe(scoreToColor(0));
    expect(scoreToColor(undefined)).toBe(scoreToColor(0));
    expect(scoreToColor(NaN)).not.toMatch(/NaN/);
  });
});
