import { describe, it, expect } from 'vitest';
import { DataUtils } from 'three';
import {
  fieldLayout, layoutV, regularizeField, regularizeDirections, packHalf, packHalfRG, buildLut, LUT_SIZE, weekSlot,
  OVERLAY_FRAGMENT, ARROW_VERTEX, ARROW_FRAGMENT, arrowDrift, ARROW_DRIFT_TRAVEL, ARROW_DRIFT_SECONDS,
} from './overlaygpu.js';
import { makeGridSampler, gridCellCount, gridCells, gridRows, MIN_DIRECTION_AGREEMENT } from './wavegrid.js';
import { waveColor, WAVE_SCALE_MAX, swellTravelBearing } from './wavescale.js';
import { windColor, WIND_SCALE_MAX, windTravelBearing } from './windscale.js';

// What a texel of a layout is centred on.
function texelLatLon(layout, x, y) {
  return { lat: layout.lat0 + y * layout.step, lon: -180 + ((x + 0.5) / layout.width) * 360 };
}

// The GPU's side, in JavaScript: a bilinear read of a texture of `channels` channels at a
// latitude and longitude, wrapping round in longitude and clamped at the top and bottom, as the
// textures are set up in the globe. `v` is the sphere's own, mapped through layoutV as the
// shaders map it.
function gpuRead(data, channels, layout, lat, lon) {
  const [a, b] = layoutV(layout);
  const u = ((lon + 180) / 360) * layout.width - 0.5;
  const v = (((lat + 90) / 180) * a + b) * layout.height - 0.5;
  const x0 = Math.floor(u);
  const y0 = Math.floor(v);
  const out = new Array(channels).fill(0);
  for (const [y, wy] of [[y0, 1 - (v - y0)], [y0 + 1, v - y0]]) {
    const row = Math.max(0, Math.min(layout.height - 1, y));
    for (const [x, wx] of [[x0, 1 - (u - x0)], [x0 + 1, u - x0]]) {
      const col = ((x % layout.width) + layout.width) % layout.width;
      for (let c = 0; c < channels; c++) out[c] += data[(row * layout.width + col) * channels + c] * wx * wy;
    }
  }
  return out;
}

// A field with some structure to it: a storm on a background, and holes where land would be.
function stormyField(step, { holes = true } = {}) {
  return gridCells(step).map((c, i) => {
    if (holes && i % 29 === 0) return null;
    const d2 = (c.lat + 40) ** 2 + (((c.lon - 60 + 540) % 360) - 180) ** 2;
    return 1.5 + 4 * Math.exp(-d2 / 200) + 0.5 * Math.sin((c.lon * Math.PI) / 45);
  });
}
function swirlingDirections(step) {
  return gridCells(step).map((c, i) => (i % 31 === 0 ? null : (((Math.atan2(c.lat + 40, c.lon - 60) * 180) / Math.PI) * 2 + 720) % 360));
}

describe('fieldLayout', () => {
  it('gives each grid row a row of texels, with an empty row either side', () => {
    expect(fieldLayout(2).height).toBe(gridRows(2).length + 2);
    expect(fieldLayout(5).height).toBe(gridRows(5).length + 2);
    expect(fieldLayout(20).height).toBe(gridRows(20).length + 2);
  });

  it('spaces texels a quarter of a cell apart across a row, and never more than 1.25 degrees', () => {
    expect(fieldLayout(2).width).toBe(720);
    expect(fieldLayout(5).width).toBe(288);
    expect(fieldLayout(20).width).toBe(288);
  });
});

describe('layoutV', () => {
  it('maps each grid row\'s latitude to the centre of its row of texels', () => {
    for (const step of [2, 5, 20]) {
      const layout = fieldLayout(step);
      const [a, b] = layoutV(layout);
      gridRows(step).forEach((row, r) => {
        const v = ((row.lat + 90) / 180) * a + b;
        expect(v * layout.height).toBeCloseTo(r + 1 + 0.5, 9);
      });
    }
  });
});

describe('regularizeField', () => {
  const step = 5;
  const layout = fieldLayout(step);
  const n = gridCellCount(step);
  const sampler = makeGridSampler(step);

  it('samples a uniform sea to the same value everywhere the grid reaches', () => {
    const { premul, cover } = regularizeField(new Array(n).fill(2.5), layout);
    for (let y = 1; y < layout.height - 1; y++) {
      for (const x of [0, 100, layout.width - 1]) {
        expect(cover[y * layout.width + x]).toBe(1);
        expect(premul[y * layout.width + x]).toBeCloseTo(2.5);
      }
    }
  });

  it('runs south to north, and leaves the rows beyond the grid empty', () => {
    const { cover } = regularizeField(new Array(n).fill(1), layout);
    expect(cover[0]).toBe(0);                                        // below -75
    expect(cover[(layout.height - 1) * layout.width]).toBe(0);       // above 75
    expect(texelLatLon(layout, 0, 1).lat).toBe(-75);                 // the first grid row
  });

  it('holds exactly what the CPU sampler gives at each texel', () => {
    const values = stormyField(step);
    const { premul, cover } = regularizeField(values, layout);
    for (let y = 0; y < layout.height; y++) {
      for (let x = 0; x < layout.width; x += 7) {
        const { lat, lon } = texelLatLon(layout, x, y);
        const v = sampler.height(values, lat, lon);
        const i = y * layout.width + x;
        if (v == null) expect(cover[i]).toBe(0);
        else { expect(cover[i]).toBe(1); expect(premul[i]).toBeCloseTo(v, 5); }
      }
    }
  });

  // The worst difference from the CPU sampler, over a spread of points, of the value the GPU
  // would read back through its bilinear filter.
  function worstReadBack(values) {
    const { premul, cover } = regularizeField(values, layout);
    const data = new Float32Array(premul.length * 2);
    premul.forEach((p, i) => { data[i * 2] = p; data[i * 2 + 1] = cover[i]; });
    let worst = 0;
    for (let lat = -72.3; lat < 73; lat += 1.7) {
      for (let lon = -179.1; lon < 180; lon += 2.3) {
        const cpu = sampler.height(values, lat, lon);
        const [r, g] = gpuRead(data, 2, layout, lat, lon);
        if (cpu == null || g < 0.999) continue; // the coverage edge is the shader's business
        worst = Math.max(worst, Math.abs(r / g - cpu));
      }
    }
    return worst;
  }

  it('reads back, through a bilinear filter, within centimetres of the CPU sampler', () => {
    // Between texels the GPU interpolates; with the rows aligned that is the sampler's own
    // arithmetic in latitude, and close to it across a row.
    expect(worstReadBack(stormyField(step, { holes: false }))).toBeLessThan(0.05);
  });

  it('stays close beside a cell with no reading', () => {
    // A texel holds the mean of whichever of its two cells have readings, so between rows the
    // GPU weighs a row with a missing cell as fully as one without. Gaps at sea are filled
    // before the overlay is resampled (fillGridGaps), so in practice this is the shoreline,
    // under the land mask -- but it should not stray far even where it shows.
    expect(worstReadBack(stormyField(step))).toBeLessThan(0.8);
  });

  it('reuses the arrays it is given, overwriting what was there', () => {
    const out = regularizeField(new Array(n).fill(3), layout);
    const again = regularizeField(null, layout, out);
    expect(again.premul).toBe(out.premul);
    expect(Array.from(again.cover).every((c) => c === 0)).toBe(true);
    expect(Array.from(again.premul).every((p) => p === 0)).toBe(true);
  });
});

describe('regularizeDirections', () => {
  const step = 5;
  const layout = fieldLayout(step);
  const sampler = makeGridSampler(step);
  const bearing = (x, y) => (((Math.atan2(x, y) * 180) / Math.PI) + 360) % 360;
  const shown = (x, y, w) => w > 1e-4 && Math.hypot(x, y) >= w * MIN_DIRECTION_AGREEMENT;

  it('holds the sums the CPU sampler takes its mean of, so the shader can make its test', () => {
    const dirs = swirlingDirections(step);
    const vectors = regularizeDirections(dirs, layout);
    for (let y = 0; y < layout.height; y++) {
      for (let x = 0; x < layout.width; x += 5) {
        const { lat, lon } = texelLatLon(layout, x, y);
        const cpu = sampler.direction(dirs, lat, lon);
        const o = (y * layout.width + x) * 4;
        const [vx, vy, w] = [vectors[o], vectors[o + 1], vectors[o + 2]];
        expect(shown(vx, vy, w)).toBe(cpu != null);
        if (cpu != null) expect(Math.abs(((bearing(vx, vy) - cpu + 540) % 360) - 180)).toBeLessThan(1e-3);
      }
    }
  });

  it('points within a few degrees of the CPU sampler anywhere, read through a bilinear filter', () => {
    const dirs = swirlingDirections(step);
    const vectors = regularizeDirections(dirs, layout);
    const errors = [];
    for (let lat = -72.3; lat < 73; lat += 1.3) {
      for (let lon = -179.1; lon < 180; lon += 1.9) {
        const cpu = sampler.direction(dirs, lat, lon);
        const [vx, vy, w] = gpuRead(vectors, 4, layout, lat, lon);
        if (cpu == null || !shown(vx, vy, w)) continue;
        errors.push(Math.abs(((bearing(vx, vy) - cpu + 540) % 360) - 180));
      }
    }
    errors.sort((a, b) => a - b);
    expect(errors.length).toBeGreaterThan(1000);
    expect(errors[Math.floor(errors.length * 0.99)]).toBeLessThan(3);
  });

  it('averages bearings either side of north to north, not to south', () => {
    const one = fieldLayout(20);
    const dirs = gridCells(20).map((c, i) => (i % 2 ? 350 : 10));
    const vectors = regularizeDirections(dirs, one);
    const o = (3 * one.width + 40) * 4;
    expect(bearing(vectors[o], vectors[o + 1])).toBeLessThan(11);
    expect(vectors[o + 1]).toBeGreaterThan(0);
  });

  it('draws nothing where there are no readings', () => {
    const vectors = regularizeDirections(null, layout);
    expect(Array.from(vectors).every((v) => v === 0)).toBe(true);
  });
});

describe('packHalf', () => {
  it('stores signed values as half floats, with nothing and one exact', () => {
    const out = packHalf(Float32Array.from([0, 1, -0.6, 0.25]));
    expect(out[0]).toBe(0);
    expect(DataUtils.fromHalfFloat(out[1])).toBe(1);
    expect(DataUtils.fromHalfFloat(out[2])).toBeCloseTo(-0.6, 3);
    expect(DataUtils.fromHalfFloat(out[3])).toBe(0.25);
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

describe('the arrow shaders', () => {
  it('make the same agreement test as the CPU sampler', () => {
    expect(ARROW_VERTEX).toContain('d.b * ' + MIN_DIRECTION_AGREEMENT + ' )');
  });

  it('turn every bearing round, which is what both layers mean by their arrows', () => {
    // The fields say where the swell or wind comes from; both layers draw where it goes. The
    // shader reverses every bearing rather than asking each layer, so this pins both to that.
    for (const from of [0, 45, 190, 359]) {
      expect(swellTravelBearing(from)).toBe((from + 180) % 360);
      expect(windTravelBearing(from)).toBe((from + 180) % 360);
    }
    expect(ARROW_VERTEX).toMatch(/forward = -\(/);
  });

  it('draw the arrows in the pale tint, untouched by colour management', () => {
    expect(ARROW_FRAGMENT).toContain('vec4( 0.9568627450980393, 0.9686274509803922, 0.9647058823529412, 0.72 * vAlpha )');
    expect(ARROW_FRAGMENT).not.toMatch(/colorspace_fragment|tonemapping_fragment/);
  });
});

describe('arrowDrift', () => {
  it('glides from half its travel behind its point to half ahead', () => {
    expect(arrowDrift(0).offset).toBeCloseTo(-ARROW_DRIFT_TRAVEL / 2, 10);
    expect(arrowDrift(0.5).offset).toBeCloseTo(0, 10);
    expect(arrowDrift(1).offset).toBeCloseTo(ARROW_DRIFT_TRAVEL / 2, 10);
    let last = -Infinity;
    for (let t = 0; t <= 1; t += 0.01) {
      expect(arrowDrift(t).offset).toBeGreaterThan(last);
      last = arrowDrift(t).offset;
    }
  });

  it('is invisible at both ends, so the jump back to the start is never seen', () => {
    expect(arrowDrift(0).fade).toBe(0);
    expect(arrowDrift(1).fade).toBe(0);
    expect(arrowDrift(0.02).fade).toBeLessThan(0.1);
    expect(arrowDrift(0.98).fade).toBeLessThan(0.1);
  });

  it('is fully drawn through the middle of the glide', () => {
    for (const t of [0.3, 0.5, 0.65]) expect(arrowDrift(t).fade).toBe(1);
  });

  it('moves a few pixels a second at the default zoom, not a blur', () => {
    // Arrows there are about 0.016 globe radii a unit, seen from two radii away by a 45 degree
    // camera on a 460px-tall screen: about 4.4 pixels a unit.
    const pxPerUnit = (0.016 / 2) * (230 / Math.tan((22.5 * Math.PI) / 180));
    const pxPerSecond = (ARROW_DRIFT_TRAVEL / ARROW_DRIFT_SECONDS) * pxPerUnit;
    expect(pxPerSecond).toBeGreaterThan(2);
    expect(pxPerSecond).toBeLessThan(8);
  });
});

describe('the arrow shaders\' glide', () => {
  it('follow arrowDrift', () => {
    expect(ARROW_VERTEX).toContain('float offset = ( t - 0.5 ) * ' + ARROW_DRIFT_TRAVEL.toFixed(1));
    expect(ARROW_VERTEX).toContain('uTime / ' + ARROW_DRIFT_SECONDS);
  });

  it('hold the arrows still and whole with the motion off', () => {
    expect(ARROW_VERTEX).toContain('vAlpha = mix( 1.0, fade, uMotion )');
    expect(ARROW_VERTEX).toContain('offset * uMotion');
  });
});
