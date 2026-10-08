import { describe, it, expect } from 'vitest';
import { REFERENCE_FRAME_MS, MAX_FRAME_MS, frameDelta, easeAlpha, decayFactor, blendVelocity } from './motion.js';

const F60 = 1000 / 60;
const F120 = 1000 / 120;
const F30 = 1000 / 30;

// Runs an eased approach to 1 for `ms` milliseconds of frames `dt` long.
function easeFor(ms, dt, perFrame = 0.28) {
  let x = 0;
  for (let t = 0; t < ms - 1e-9; t += dt) x += (1 - x) * easeAlpha(perFrame, dt);
  return x;
}

// A flick coasting for `ms`: position covered, with velocity in units per ms.
function coastFor(ms, dt, v0 = 0.001, friction = 0.94) {
  let v = v0;
  let x = 0;
  for (let t = 0; t < ms - 1e-9; t += dt) { x += v * dt; v *= decayFactor(friction, dt); }
  return x;
}

describe('frameDelta', () => {
  it('measures the gap between frames', () => {
    expect(frameDelta(1016.7, 1000)).toBeCloseTo(16.7, 5);
  });
  it('treats the first frame as an ordinary 60 Hz one', () => {
    expect(frameDelta(5000, null)).toBe(REFERENCE_FRAME_MS);
  });
  it('clamps a stall so the globe does not jump', () => {
    expect(frameDelta(5000, 1000)).toBe(MAX_FRAME_MS);
  });
  it('does not go backwards', () => {
    expect(frameDelta(1000, 1000)).toBe(REFERENCE_FRAME_MS);
  });
});

describe('easeAlpha', () => {
  it('is the tuned per-frame fraction at 60 Hz', () => {
    expect(easeAlpha(0.28, F60)).toBeCloseTo(0.28, 10);
  });
  it('arrives at the same place at 30, 60 and 120 Hz', () => {
    const at60 = easeFor(100, F60);
    expect(easeFor(100, F120)).toBeCloseTo(at60, 10);
    expect(easeFor(100, F30)).toBeCloseTo(at60, 10);
  });
  it('handles the edges', () => {
    expect(easeAlpha(0, F60)).toBe(0);
    expect(easeAlpha(1, F60)).toBe(1);
  });
});

describe('decayFactor', () => {
  it('is the tuned per-frame friction at 60 Hz', () => {
    expect(decayFactor(0.94, F60)).toBeCloseTo(0.94, 10);
  });
  it('lets a flick travel about as far at 120 Hz and 30 Hz as at 60', () => {
    const at60 = coastFor(3000, F60);
    // Within 4%: a discrete step can only approximate the continuous curve, but the old code
    // was off by a factor of two at 120 Hz.
    expect(Math.abs(coastFor(3000, F120) / at60 - 1)).toBeLessThan(0.04);
    expect(Math.abs(coastFor(3000, F30) / at60 - 1)).toBeLessThan(0.04);
  });
  it('lasts the same time whatever the frame rate', () => {
    // Speed after half a second, as a fraction of the start.
    const after = (dt) => { let v = 1; for (let t = 0; t < 500 - 1e-9; t += dt) v *= decayFactor(0.94, dt); return v; };
    expect(after(F120)).toBeCloseTo(after(F60), 10);
  });
});

describe('blendVelocity', () => {
  it('keeps the tuned share of the old estimate per 60 Hz frame', () => {
    expect(blendVelocity(1, 0, F60)).toBeCloseTo(0.6, 10);
  });
  it('smooths over the same time at 120 Hz as at 60', () => {
    let at120 = 1;
    at120 = blendVelocity(at120, 0, F120);
    at120 = blendVelocity(at120, 0, F120);
    expect(at120).toBeCloseTo(blendVelocity(1, 0, F60), 10);
  });
});
