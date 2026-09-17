import { describe, it, expect } from 'vitest';
import {
  MIN_SCALE, MAX_SCALE, DEFAULT_SCALE,
  normalizeScale, scaleLabel, scaleDescription, toModelFt,
} from './waveheight.js';
import { formatWaveNum } from './format.js';

describe('normalizeScale', () => {
  it('is exactly 1 by default, so an untouched install takes the identity path', () => {
    // Not a pedantic check: formatWaveRange multiplies by this, and a default of
    // 1.0000000000000002 would rescale every height in the app for someone who never
    // touched the setting.
    expect(normalizeScale(1)).toBe(1);
    expect(DEFAULT_SCALE).toBe(1);
  });

  it('keeps a value the slider can actually express', () => {
    expect(normalizeScale(0.85)).toBe(0.85);
    expect(normalizeScale(1.25)).toBe(1.25);
  });

  it('clamps to the ends of the slider', () => {
    expect(normalizeScale(0.1)).toBe(MIN_SCALE);
    expect(normalizeScale(9)).toBe(MAX_SCALE);
  });

  it('never returns zero, so converting an alert threshold cannot divide by it', () => {
    for (const v of [0, -1, -0.5, MIN_SCALE]) expect(normalizeScale(v)).toBeGreaterThan(0);
  });

  it('falls back to the default rather than propagating junk', () => {
    // null and '' matter most: both are Number() 0, so without a guard a missing stored value
    // would clamp to MIN_SCALE and halve every height in the app.
    for (const v of [null, undefined, '', 'nonsense', NaN, Infinity, -Infinity, {}]) {
      expect(normalizeScale(v), String(v)).toBe(DEFAULT_SCALE);
    }
  });

  it('reads a string back the way storage wrote it', () => {
    expect(normalizeScale('0.85')).toBe(0.85);
  });
});

describe('toModelFt', () => {
  it('is a no-op at the default scale, so existing alerts are untouched', () => {
    expect(toModelFt(3, 1)).toBe(3);
  });

  it('round-trips: a threshold set at 3 reads back as 3', () => {
    // The whole point of storing model feet. The sheet says "3ft+", the Worker matches the
    // model's own number, and the alerts list has to show the surfer 3 again.
    for (const scale of [0.5, 0.7, 0.85, 1, 1.15, 1.5]) {
      for (const read of [2, 3, 4, 5, 6]) {
        expect(formatWaveNum(toModelFt(read, scale), 'imperial', scale), scale + '/' + read).toBe(read);
      }
    }
  });

  it('asks the model for more when the surfer reads small, and less when they read big', () => {
    // Reading 15% under the forecast means 3ft to them is more than 3ft to the model.
    expect(toModelFt(3, 0.5)).toBe(6);
    expect(toModelFt(3, 1.5)).toBe(2);
  });

  it('cannot divide by zero, however junk the stored scale is', () => {
    for (const bad of [0, null, undefined, NaN, 'nonsense']) {
      expect(Number.isFinite(toModelFt(3, bad)), String(bad)).toBe(true);
    }
  });
});

describe('scaleLabel', () => {
  it('is a whole percent', () => {
    expect(scaleLabel(1)).toBe('100%');
    expect(scaleLabel(0.85)).toBe('85%');
    expect(scaleLabel(1.5)).toBe('150%');
  });
});

describe('scaleDescription', () => {
  it('says nothing at all when nothing is being changed', () => {
    expect(scaleDescription(1)).toBeNull();
  });

  it('names the direction, which is the part that is easy to get backwards', () => {
    expect(scaleDescription(0.85)).toBe('15% smaller than the forecast');
    expect(scaleDescription(1.2)).toBe('20% bigger than the forecast');
  });
});
