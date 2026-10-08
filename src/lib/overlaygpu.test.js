import { describe, it, expect } from 'vitest';
import { DataUtils } from 'three';
import { regularizeField, packHalfRG, weekTextureSize, buildLut, LUT_SIZE, weekSlot, OVERLAY_FRAGMENT } from './overlaygpu.js';
import { makeGridSampler, gridCellCount } from './wavegrid.js';
import { waveColor, WAVE_SCALE_MAX } from './wavescale.js';
import { windColor, WIND_SCALE_MAX } from './windscale.js';

describe('regularizeField', () => {
  const step = 5;
  const sampler = makeGridSampler(step);
  const n = gridCellCount(step);

  it('samples a uniform sea to the same value everywhere the grid reaches', () => {
    const { premul, cover } = regularizeField(new Array(n).fill(2.5), sampler, 72, 36);
    // Row 18 is just north of the equator: all covered, all 2.5.
    for (let x = 0; x < 72; x++) {
      expect(cover[18 * 72 + x]).toBe(1);
      expect(premul[18 * 72 + x]).toBeCloseTo(2.5);
    }
  });

  it('runs south to north, and leaves the poles beyond the grid empty', () => {
    const { cover } = regularizeField(new Array(n).fill(1), sampler, 72, 36);
    expect(cover[0]).toBe(0);            // row 0 is the south pole
    expect(cover[35 * 72]).toBe(0);      // the last row is the north pole
    expect(cover[18 * 72]).toBe(1);
  });

  it('matches the CPU sampler texel for texel', () => {
    // A field that varies, with a hole in it.
    const values = Array.from({ length: n }, (_, i) => (i % 17 === 0 ? null : (i % 23) / 4));
    const width = 144;
    const height = 72;
    const { premul, cover } = regularizeField(values, sampler, width, height);
    for (const [x, y] of [[0, 30], [10, 40], [71, 36], [100, 20], [143, 50]]) {
      const lat = -90 + ((y + 0.5) / height) * 180;
      const lon = -180 + ((x + 0.5) / width) * 360;
      const v = sampler.height(values, lat, lon);
      const i = y * width + x;
      if (v == null) expect(cover[i]).toBe(0);
      else { expect(cover[i]).toBe(1); expect(premul[i]).toBeCloseTo(v, 6); }
    }
  });

  it('copes with no data', () => {
    const { cover } = regularizeField(null, sampler, 4, 2);
    expect(Array.from(cover)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

describe('packHalfRG', () => {
  it('stores value-times-coverage and coverage as half floats, two to a texel', () => {
    const out = packHalfRG(Float32Array.from([2.5, 0, 12.3]), Float32Array.from([1, 0, 1]));
    expect(out.length).toBe(6);
    expect(DataUtils.fromHalfFloat(out[0])).toBeCloseTo(2.5, 3);
    expect(DataUtils.fromHalfFloat(out[1])).toBe(1);
    expect(out[2]).toBe(0);
    expect(out[3]).toBe(0);
    expect(DataUtils.fromHalfFloat(out[4])).toBeCloseTo(12.3, 2);
  });
});

describe('weekTextureSize', () => {
  it('resamples a week at its own grid spacing', () => {
    expect(weekTextureSize(5)).toEqual({ width: 72, height: 36 });
    expect(weekTextureSize(20)).toEqual({ width: 18, height: 9 });
  });
});

describe('buildLut', () => {
  it('holds the legend colour for each value, so the globe and the legend agree', () => {
    const lut = buildLut(waveColor, WAVE_SCALE_MAX);
    expect(lut.length).toBe(LUT_SIZE * 4);
    for (const metres of [0, 1.2, 3, WAVE_SCALE_MAX]) {
      const i = Math.round((metres / WAVE_SCALE_MAX) * (LUT_SIZE - 1));
      const c = waveColor((i / (LUT_SIZE - 1)) * WAVE_SCALE_MAX);
      expect(Array.from(lut.slice(i * 4, i * 4 + 4))).toEqual([...c, 255]);
    }
  });

  it('covers the wind ramp to its top', () => {
    const lut = buildLut(windColor, WIND_SCALE_MAX);
    const last = (LUT_SIZE - 1) * 4;
    expect(Array.from(lut.slice(last, last + 3))).toEqual(windColor(WIND_SCALE_MAX));
  });
});

describe('weekSlot', () => {
  it('shows the live map at now with nothing playing', () => {
    expect(weekSlot(0, 28, false)).toBeNull();
  });

  it('blends the two steps either side of the moment shown', () => {
    expect(weekSlot(3.25, 28, true)).toEqual({ i0: 3, i1: 4, t: 0.25 });
    expect(weekSlot(0, 28, true)).toEqual({ i0: 0, i1: 1, t: 0 });
  });

  it('holds the last step at and past the end', () => {
    expect(weekSlot(27, 28, false)).toEqual({ i0: 27, i1: 27, t: 0 });
    expect(weekSlot(27.4, 28, true)).toEqual({ i0: 27, i1: 27, t: 0 });
  });

  it('has nothing to show without frames', () => {
    expect(weekSlot(3, 0, true)).toBeNull();
  });
});

describe('OVERLAY_FRAGMENT', () => {
  it('does not convert colour spaces or tone-map, so the legend bytes reach the screen as they are', () => {
    expect(OVERLAY_FRAGMENT).not.toMatch(/colorspace_fragment|tonemapping_fragment/);
  });
});
