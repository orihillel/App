import { describe, it, expect } from 'vitest';
import {
  formatWaveRange, formatWaveNum, formatHeight, formatSpeed,
  waveUnit, heightUnit, speedUnit, leadTimeLabel,
  barHeight, hourLabel12, waveAvg, linePath,
} from './format.js';

describe('formatWaveRange', () => {
  it('passes an imperial range through unchanged', () => {
    expect(formatWaveRange('3-5', 'imperial')).toBe('3-5');
  });
  it('converts both sides of the range to meters, one decimal place', () => {
    expect(formatWaveRange('3-5', 'metric')).toBe('0.9-1.5');
  });
  it('returns the input as-is if it is not a valid "n-n" range', () => {
    expect(formatWaveRange('not-a-range', 'imperial')).toBe('not-a-range');
  });
});

describe('formatWaveNum / formatHeight / formatSpeed', () => {
  it('rounds feet to a whole number, converts to meters at one decimal', () => {
    expect(formatWaveNum(4.6, 'imperial')).toBe(5);
    expect(formatWaveNum(4, 'metric')).toBe('1.2');
  });
  it('keeps one decimal place in imperial, converts in metric', () => {
    expect(formatHeight(3, 'imperial')).toBe('3.0');
    expect(formatHeight(3, 'metric')).toBe('0.9');
  });
  it('rounds mph to kph in metric, passes mph through in imperial', () => {
    expect(formatSpeed(10, 'imperial')).toBe(10);
    expect(formatSpeed(10, 'metric')).toBe(16);
  });
});

describe('unit labels', () => {
  it('switch between imperial and metric labels', () => {
    expect(waveUnit('imperial')).toBe('FT');
    expect(waveUnit('metric')).toBe('M');
    expect(heightUnit('imperial')).toBe('ft');
    expect(heightUnit('metric')).toBe('m');
    expect(speedUnit('imperial')).toBe('mph');
    expect(speedUnit('metric')).toBe('kph');
  });
});

describe('leadTimeLabel', () => {
  it('has a label for every alert lead time', () => {
    expect(leadTimeLabel('1h')).toBe('1 hour before');
    expect(leadTimeLabel('1d')).toBe('1 day before');
    expect(leadTimeLabel('2d')).toBe('2 days before');
    expect(leadTimeLabel('3d')).toBe('3 days before');
  });
});

describe('barHeight', () => {
  it('grows with the average of the wave range', () => {
    expect(barHeight('2-4')).toBeGreaterThan(barHeight('1-2'));
  });
  it('falls back to a fixed height for an unparsable value', () => {
    expect(barHeight('flat')).toBe(10);
  });
});

describe('hourLabel12', () => {
  it('converts 24h to 12h with am/pm suffix, midnight/noon as 12', () => {
    expect(hourLabel12(0)).toBe('12a');
    expect(hourLabel12(9)).toBe('9a');
    expect(hourLabel12(12)).toBe('12p');
    expect(hourLabel12(15)).toBe('3p');
    expect(hourLabel12(23)).toBe('11p');
  });
});

describe('waveAvg', () => {
  it('averages a valid range', () => {
    expect(waveAvg('2-4')).toBe(3);
  });
  it('returns 0 for an unparsable value', () => {
    expect(waveAvg('n/a')).toBe(0);
  });
});

describe('linePath', () => {
  it('produces one point per value, first and last at the horizontal padding bounds', () => {
    const { pts, d } = linePath([1, 2, 3], 100, 50, 10);
    expect(pts).toHaveLength(3);
    expect(pts[0][0]).toBe(10); // left pad
    expect(pts[2][0]).toBe(90); // width - pad
    expect(d.startsWith('M')).toBe(true);
    expect(d).toContain('L');
  });
  it('does not divide by zero when every value is identical', () => {
    const { pts } = linePath([5, 5, 5], 100, 50, 10);
    expect(pts.every((p) => Number.isFinite(p[1]))).toBe(true);
  });
});
