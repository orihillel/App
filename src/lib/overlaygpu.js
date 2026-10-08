import { DataUtils } from 'three';

// The globe's swell and wind overlay, drawn by the GPU.
//
// The overlay used to be painted on the CPU: every texel of a 720x360 canvas sampled from the
// grid and coloured, then the whole canvas uploaded as a texture. Fine for a picture painted
// once. The animated week repainted it on a 75 ms timer -- about 16 ms of main-thread work and
// 7 MB of garbage a tick on a desktop core, an upload every tick, and at most 13 new pictures a
// second however fast the screen was, held for uneven lengths.
//
// Now the numbers go to the GPU once and stay there. Each field is resampled onto a regular
// latitude/longitude grid and uploaded as a small two-channel texture; a fragment shader turns
// numbers into colours through a lookup table built from the legend's own colour stops, and
// blends two forecast steps by a uniform. Playing the week is one uniform write per frame.
//
// Everything here is pure arithmetic, tested on its own. The shader source is at the bottom.

// The grids are equal-area: rows of cells from -75 to 75 degrees, each row with fewer cells the
// further it is from the equator (see gridRows in lib/wavegrid.js). A texture cannot be sampled
// like that, so each field is resampled once onto a regular grid, through the same null-aware
// bilinear sampler the CPU painter and tap-to-read use.
//
// Two channels, premultiplied: R is the value times its coverage, G the coverage (1 where there
// is a reading, 0 where there is none). The GPU's bilinear filter then averages both, and R/G is
// exactly the null-aware average -- a coastal texel between sea and "no reading" takes the sea's
// value instead of dipping toward zero, which is what averaging a plain value channel would do.
// Rows run south to north (row 0 at -90), the way a texture's v coordinate does.
export function regularizeField(values, sampler, width, height) {
  const n = width * height;
  const premul = new Float32Array(n);
  const cover = new Float32Array(n);
  if (!values || !sampler) return { premul, cover };
  for (let y = 0; y < height; y++) {
    const lat = -90 + ((y + 0.5) / height) * 180;
    for (let x = 0; x < width; x++) {
      const v = sampler.height(values, lat, -180 + ((x + 0.5) / width) * 360);
      if (v == null || !Number.isFinite(v)) continue;
      const i = y * width + x;
      premul[i] = v;
      cover[i] = 1;
    }
  }
  return { premul, cover };
}

// Half floats, two to a texel. Sixteen-bit float textures are filterable in every WebGL2
// implementation, where 32-bit ones are not on iPhones -- and the field must be filtered on the
// GPU or it shows its grid. Half precision carries a wave height to well under a centimetre.
const HALF_ONE = DataUtils.toHalfFloat(1);
export function packHalfRG(premul, cover, out = new Uint16Array(premul.length * 2)) {
  for (let i = 0, o = 0; i < premul.length; i++, o += 2) {
    out[o] = premul[i] === 0 ? 0 : DataUtils.toHalfFloat(premul[i]);
    out[o + 1] = cover[i] === 1 ? HALF_ONE : cover[i] === 0 ? 0 : DataUtils.toHalfFloat(cover[i]);
  }
  return out;
}

// The texture size a week of frames on a `step`-degree grid is resampled to: the grid's own
// spacing. 5 degrees is 72x36 -- 28 frames of it are under 300 KB, and resampling all of them
// takes a few milliseconds, once.
export function weekTextureSize(step) {
  const cell = Math.max(0.5, step);
  return { width: Math.round(360 / cell), height: Math.round(180 / cell) };
}

// The colour lookup table, from the same function the legend's colours come from, so a value
// and its swatch on the legend are the same bytes. `size` entries from 0 to `maxValue`, where the
// ramp stops changing; anything above takes the last colour, exactly as the ramp itself does.
export const LUT_SIZE = 1024;
export function buildLut(colorFn, maxValue, size = LUT_SIZE) {
  const lut = new Uint8Array(size * 4);
  for (let i = 0; i < size; i++) {
    const c = colorFn((i / (size - 1)) * maxValue);
    if (!c) continue; // a value the ramp will not colour stays transparent
    const o = i * 4;
    lut[o] = c[0]; lut[o + 1] = c[1]; lut[o + 2] = c[2]; lut[o + 3] = 255;
  }
  return lut;
}

// Which two forecast steps the overlay blends at `pos` through a week of `count` frames, and by
// how much -- or null for the live map. Null at "now" with nothing playing, for the reason given
// at weekFrameAt in lib/waveframes.js: the week's first frame is the same moment on a coarser
// grid, and showing it there would swap a sharp picture for a blocky one.
export function weekSlot(pos, count, playing) {
  if (!(count > 0)) return null;
  if (!playing && !(pos > 0)) return null;
  const last = count - 1;
  const p = Math.max(0, Math.min(last, pos || 0));
  const i0 = Math.floor(p);
  const i1 = Math.min(last, i0 + 1);
  return { i0, i1, t: i1 === i0 ? 0 : p - i0 };
}

// The overlay's shaders.
//
// Written against three.js's GLSL ES 3.00 compatibility layer: `varying`, `texture2D` and
// `gl_FragColor` are mapped for it, and `texture()` reads the week's texture array.
//
// Deliberately no colorspace or tone-mapping chunks. The lookup table holds sRGB bytes and they
// go to the canvas untouched, which is what keeps the globe's colours identical to the legend's.
export const OVERLAY_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`;

export const OVERLAY_FRAGMENT = /* glsl */ `
uniform sampler2D uLive;        // the live field: R = value x coverage, G = coverage
uniform sampler2DArray uWeek;   // the week, one forecast step per layer, same channels
uniform sampler2D uLut;         // ${LUT_SIZE}x1 colour ramp
uniform sampler2D uLandMask;    // R = fraction of the texel that is land
uniform float uLutMax;          // the value at the top of the ramp
uniform float uWeekOn;          // 0 draws the live field, 1 the week
uniform float uLayer0;          // the two steps either side of the moment shown...
uniform float uLayer1;
uniform float uMix;             // ...and how far between them
uniform float uOpacity;
uniform float uHasMask;
varying vec2 vUv;

void main() {
  vec2 f;
  if ( uWeekOn > 0.5 ) {
    f = mix( texture( uWeek, vec3( vUv, uLayer0 ) ).rg, texture( uWeek, vec3( vUv, uLayer1 ) ).rg, uMix );
  } else {
    f = texture2D( uLive, vUv ).rg;
  }
  float cover = f.g;
  float value = cover > 1e-4 ? f.r / cover : 0.0;
  float u = clamp( value / uLutMax, 0.0, 1.0 );
  vec3 rgb = texture2D( uLut, vec2( u * ${(LUT_SIZE - 1) / LUT_SIZE} + ${0.5 / LUT_SIZE}, 0.5 ) ).rgb;

  // Wherever any reading reaches, fully drawn; fading over about a screen pixel where the
  // readings stop, rather than over a whole grid cell.
  float edge = max( fwidth( cover ), 1e-4 );
  float alpha = clamp( cover / edge, 0.0, 1.0 );

  // Cut to the coastline. The mask holds the fraction of each texel that is land, thresholded
  // at a half with a falloff one screen pixel wide, so the chart ends as crisply as the
  // coastline drawn over it at every zoom.
  if ( uHasMask > 0.5 ) {
    float landCoverage = texture2D( uLandMask, vUv ).r - 0.5;
    float landEdge = max( fwidth( landCoverage ), 1e-5 );
    alpha *= 1.0 - smoothstep( -landEdge, landEdge, landCoverage );
  }
  gl_FragColor = vec4( rgb, alpha * uOpacity );
}
`;
