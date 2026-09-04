import { describe, it, expect } from 'vitest';
import { relativeSpread, confidenceFromSpread, confidenceForSeries, confidenceLabel } from './confidence.js';

describe('relativeSpread', () => {
  it('measures disagreement against the size of the wave', () => {
    // Half a foot apart means something very different at 1ft than at 10ft.
    expect(relativeSpread(1.25, 0.75)).toBeCloseTo(0.5, 5);
    expect(relativeSpread(10.25, 9.75)).toBeCloseTo(0.05, 5);
  });
  it('is zero when the models agree exactly', () => {
    expect(relativeSpread(4, 4)).toBe(0);
  });
  it('reports no disagreement when both models say flat', () => {
    expect(relativeSpread(0, 0)).toBe(0);
  });
  it('is null when either model is missing', () => {
    expect(relativeSpread(null, 3)).toBeNull();
    expect(relativeSpread(3, null)).toBeNull();
  });
});

describe('confidenceFromSpread', () => {
  it('maps spread to a level', () => {
    expect(confidenceFromSpread(0)).toBe('high');
    expect(confidenceFromSpread(0.2)).toBe('high');
    expect(confidenceFromSpread(0.3)).toBe('medium');
    expect(confidenceFromSpread(0.45)).toBe('medium');
    expect(confidenceFromSpread(0.8)).toBe('low');
  });
  it('is null with nothing to compare', () => {
    expect(confidenceFromSpread(null)).toBeNull();
  });
});

describe('confidenceForSeries', () => {
  it('reports high when the models track each other all day', () => {
    expect(confidenceForSeries([3, 3.2, 3.4], [3.1, 3.2, 3.3])).toBe('high');
  });

  it('takes the worst hour, not the average', () => {
    // Agreeing for most of the day does not make a divergent afternoon safe to hide.
    expect(confidenceForSeries([3, 3, 3, 6], [3, 3, 3, 2])).toBe('low');
  });

  it('handles series of different lengths', () => {
    expect(confidenceForSeries([3, 3, 3], [3, 3])).toBe('high');
  });

  it('skips gaps rather than treating them as disagreement', () => {
    expect(confidenceForSeries([3, null, 3], [3, 4, 3])).toBe('high');
  });

  it('is null with no usable input', () => {
    expect(confidenceForSeries([], [])).toBeNull();
    expect(confidenceForSeries(null, [1])).toBeNull();
    expect(confidenceForSeries([null], [null])).toBeNull();
  });
});

describe('confidenceLabel', () => {
  it('phrases low confidence as advice, not a number', () => {
    expect(confidenceLabel('low')).toMatch(/maybe/i);
  });
  it('has a label for every level and nothing otherwise', () => {
    for (const l of ['high', 'medium', 'low']) expect(typeof confidenceLabel(l)).toBe('string');
    expect(confidenceLabel(null)).toBeNull();
    expect(confidenceLabel('nonsense')).toBeNull();
  });
});
