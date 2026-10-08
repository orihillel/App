import { DataUtils } from 'three';
import { gridRows, GRID_MAX_LAT, MIN_DIRECTION_AGREEMENT } from './wavegrid.js';

// The globe's swell and wind overlay, drawn by the GPU.
//
// The overlay used to be painted on the CPU: every texel of a 720x360 canvas sampled from the
// grid and coloured, then the whole canvas uploaded as a texture. Fine for a picture painted
// once. The animated week repainted it on a 75 ms timer -- about 16 ms of main-thread work and
// 7 MB of garbage a tick on a desktop core, an upload every tick, and at most 13 new pictures a
// second however fast the screen was, held for uneven lengths.
//
// Now the numbers go to the GPU once and stay there. Each field is resampled onto a regular
// grid and uploaded as a small texture; a fragment shader turns numbers into colours through a
// lookup table built from the legend's own colour stops, and blends two forecast steps by a
// uniform. The arrows read the same moment from a texture of directions in their vertex
// shader. Playing the week is a few uniform writes per frame.
//
// Everything here is pure arithmetic, tested on its own. The shader source is at the bottom.

// The regular grid a field on a `step`-degree grid is resampled to.
//
// The grids are equal-area: rows of cells from -75 to 75 degrees, each row with fewer cells the
// further it is from the equator (see gridRows in lib/wavegrid.js). A texture cannot be sampled
// like that, so each field is resampled once, through the same arithmetic as the null-aware
// bilinear sampler the CPU painter and tap-to-read use, and the GPU's filter does the rest.
//
// The texture's rows sit exactly on the grid's rows. The first version spaced them evenly from
// pole to pole instead, which put every texel between two rows: each was already an average
// of its neighbours before the GPU averaged it again, and on the week's 5-degree grid a storm
// one cell across came out at between a quarter and a half of its height. Measured against the
// CPU's sampler on a stormy test field, swell heights were out by 0.76m at the 99th percentile,
// and directions read the same way were out by 21 degrees. With the rows aligned, interpolating
// between them is exactly what the CPU sampler does, and the error is down to a few
// centimetres and about a degree.
//
// Across a row the cells are spaced unevenly, so texels there are kept to a quarter of a cell
// at most (and 1.25 degrees on the coarse grids) -- the error comes from interpolating across
// the kinks at cell centres, and finer texels make those corners shorter.
//
// One empty row of texels each side of the grid. Past its last row the sampler's weight falls
// to zero over one row's spacing, and filtering toward an empty row is that same fade.
const MAX_TEXEL_LON = 1.25;
export function fieldLayout(step) {
  const rows = gridRows(step);
  const width = Math.round(360 / Math.min(step / 4, MAX_TEXEL_LON));
  // For each texel on a grid row, the two cells of that row its longitude falls between, and
  // how far along -- precomputed, because the week resamples 28 frames onto one layout. The
  // arithmetic is makeGridSampler's own, expression for expression, so a texel holds exactly
  // the number the sampler gives at its centre.
  const n = rows.length * width;
  const cellA = new Int32Array(n);
  const cellB = new Int32Array(n);
  const towardB = new Float64Array(n);
  let offset = 0;
  for (let r = 0, i = 0; r < rows.length; r++) {
    const { count, step: cellLon } = rows[r];
    for (let x = 0; x < width; x++, i++) {
      const lon = -180 + ((x + 0.5) / width) * 360;
      const fx = ((((lon + 180) % 360) + 360) % 360) / cellLon - 0.5;
      const i0 = Math.floor(fx);
      cellA[i] = offset + (((i0 % count) + count) % count);
      cellB[i] = offset + ((((i0 + 1) % count) + count) % count);
      towardB[i] = fx - i0;
    }
    offset += count;
  }
  return { step, width, height: rows.length + 2, lat0: -GRID_MAX_LAT - step, cellA, cellB, towardB };
}

// Where a latitude falls in a layout's texture, as v = (sphere's v) * a + b. The sphere's own v
// runs from 0 at the south pole to 1 at the north; texel row y is centred on lat0 + y * step.
export function layoutV(layout) {
  const { step, height, lat0 } = layout;
  return [180 / (step * height), ((-90 - lat0) / step + 0.5) / height];
}

// A field's values, resampled onto its layout.
//
// Two channels, premultiplied: R is the value times its coverage, G the coverage (1 where there
// is a reading, 0 where there is none). The GPU's bilinear filter then averages both, and R/G is
// exactly the null-aware average -- a coastal texel between sea and "no reading" takes the sea's
// value instead of dipping toward zero, which is what averaging a plain value channel would do.
// Rows run south to north, the way a texture's v coordinate does.
//
// `out` is reused if given -- the week resamples 28 frames, and each would otherwise be two
// more arrays for the collector. Every texel on a grid row is written; the empty rows never are.
export function regularizeField(values, layout, out) {
  const { width, height, cellA, cellB, towardB } = layout;
  const premul = out ? out.premul : new Float32Array(width * height);
  const cover = out ? out.cover : new Float32Array(width * height);
  // Texel row 0 is the empty row below the grid, so grid row r is texel row r + 1.
  for (let i = 0, o = width; i < cellA.length; i++, o++) {
    const wb = towardB[i];
    const wa = 1 - wb;
    const a = values ? values[cellA[i]] : null;
    const b = values ? values[cellB[i]] : null;
    let total = 0;
    let weight = 0;
    if (wa > 0 && a != null && Number.isFinite(a)) { total += a * wa; weight += wa; }
    if (wb > 0 && b != null && Number.isFinite(b)) { total += b * wb; weight += wb; }
    premul[o] = weight > 0 ? total / weight : 0;
    cover[o] = weight > 0 ? 1 : 0;
  }
  return { premul, cover };
}

// A direction field, resampled onto its layout as vectors: four channels a texel, R and G the
// east and north parts of the bearing's unit vector and B the weight, all summed over the
// cells with a reading exactly as makeGridSampler's direction() sums them (A is unused).
//
// Kept as sums rather than as an angle, for the reasons the sampler gives: an angle cannot be
// filtered (350 and 10 degrees average to due south), and the sums can -- the GPU's bilinear
// filter adds them up just as the sampler would have, and the arrow shader takes the bearing
// of the result and makes the sampler's own test of whether they agree enough to draw.
//
// `out` is reused if given, as for regularizeField.
export function regularizeDirections(degrees, layout, out) {
  const { width, height, cellA, cellB, towardB } = layout;
  if (!out) out = new Float32Array(width * height * 4);
  // Each cell's unit vector once, rather than a sine and a cosine per neighbour per texel.
  const n = degrees ? degrees.length : 0;
  const east = new Float64Array(n);
  const north = new Float64Array(n);
  const has = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const deg = degrees[i];
    if (deg == null || !Number.isFinite(deg)) continue;
    const rad = (deg * Math.PI) / 180;
    east[i] = Math.sin(rad);
    north[i] = Math.cos(rad);
    has[i] = 1;
  }
  for (let i = 0, o = width * 4; i < cellA.length; i++, o += 4) {
    const wb = towardB[i];
    const wa = 1 - wb;
    const a = cellA[i];
    const b = cellB[i];
    let x = 0;
    let y = 0;
    let w = 0;
    if (wa > 0 && has[a]) { x += east[a] * wa; y += north[a] * wa; w += wa; }
    if (wb > 0 && has[b]) { x += east[b] * wb; y += north[b] * wb; w += wb; }
    out[o] = x;
    out[o + 1] = y;
    out[o + 2] = w;
  }
  return out;
}

// Half floats. Sixteen-bit float textures are filterable in every WebGL2 implementation, where
// 32-bit ones are not on iPhones -- and the fields must be filtered on the GPU or they show
// their grid. Half precision carries a wave height to well under a centimetre and a bearing to
// a tenth of a degree.
const HALF_ONE = DataUtils.toHalfFloat(1);
function toHalf(v) {
  return v === 0 ? 0 : v === 1 ? HALF_ONE : DataUtils.toHalfFloat(v);
}
export function packHalf(src, out = new Uint16Array(src.length)) {
  for (let i = 0; i < src.length; i++) out[i] = toHalf(src[i]);
  return out;
}
// Value and coverage, interleaved two to a texel.
export function packHalfRG(premul, cover, out = new Uint16Array(premul.length * 2)) {
  for (let i = 0, o = 0; i < premul.length; i++, o += 2) {
    out[o] = toHalf(premul[i]);
    out[o + 1] = toHalf(cover[i]);
  }
  return out;
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
// Written against three.js's GLSL ES 3.00 compatibility layer: `attribute`, `varying`,
// `texture2D` and `gl_FragColor` are mapped for it, and `texture()` reads the week's texture
// array.
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
uniform vec2 uLiveV;            // where each texture's rows are: v = vUv.y * x + y (layoutV)
uniform vec2 uWeekV;
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
    vec2 at = vec2( vUv.x, vUv.y * uWeekV.x + uWeekV.y );
    f = mix( texture( uWeek, vec3( at, uLayer0 ) ).rg, texture( uWeek, vec3( at, uLayer1 ) ).rg, uMix );
  } else {
    f = texture2D( uLive, vec2( vUv.x, vUv.y * uLiveV.x + uLiveV.y ) ).rg;
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

// The arrows: one flat arrow per point of a fixed lattice over the sea, each turned by its
// vertex shader to the direction the field gives at that point at the moment shown.
//
// They used to be oriented on the CPU: a direction sampled and a matrix built per arrow, and a
// 384KB buffer uploaded, whenever the field changed. While the week played that was a few
// times a second, and the arrows stepped along behind the colours rather than moving with
// them. Here they read the same two forecast steps through the same blend as the overlay's
// colours, on every frame, at no cost to the CPU.
//
// The frame each arrow lies in is orientationAt's from lib/swellarrows.js, line for line --
// see there for why north and east have the signs they do.
//
// The direction fields say where the swell or wind comes from, as every source reports them,
// and both layers draw where it is going (swellTravelBearing, windTravelBearing): the shader
// turns every bearing round, and a test pins both layers to that.
//
// And they move. A static arrow says which way; one that glides forward a little and fades, over
// and over, says the sea is going that way -- the wave glyphs on Windy's swell map do the same.
// Each arrow runs the loop below on its own phase, so the field shimmers rather than pulsing in
// step, and all of it is the vertex shader's arithmetic on a time uniform. `uMotion` blends from
// the still arrows to the moving ones, so they can settle back to rest instead of freezing
// half-faded when the globe stops drawing.

// How long one glide takes, in seconds, and how far an arrow goes in it, in the arrow's own units
// (it is 1.75 of them from tail to tip): about one arrow length, a few pixels a second.
export const ARROW_DRIFT_SECONDS = 2.4;
export const ARROW_DRIFT_TRAVEL = 2.0;
// The share of the glide spent fading in at the start, and out at the end.
export const ARROW_DRIFT_FADE_IN = 0.25;
export const ARROW_DRIFT_FADE_OUT = 0.3;

// Where an arrow is in its glide at `t`, from 0 to 1: how far along its direction it has gone,
// from half the travel behind its point on the lattice to half ahead, and how visible it is. Gone
// at both ends, so the jump from the end of one glide back to the start of the next is never
// seen. The shader's arithmetic, line for line.
export function arrowDrift(t) {
  const offset = (t - 0.5) * ARROW_DRIFT_TRAVEL;
  const fade = smoothstep(0, ARROW_DRIFT_FADE_IN, t) * (1 - smoothstep(1 - ARROW_DRIFT_FADE_OUT, 1, t));
  return { offset, fade };
}
function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

const glslNum = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));

export const ARROW_VERTEX = /* glsl */ `
attribute vec2 aLatLon;           // where the arrow stands: latitude, longitude, in degrees
uniform sampler2D uDirLive;       // the live directions: R, G = east, north sums; B = weight
uniform sampler2DArray uDirWeek;  // the week's, one forecast step per layer
uniform vec2 uLiveV;              // the textures' rows, as for the overlay (layoutV)
uniform vec2 uWeekV;
uniform float uWeekOn;
uniform float uLayer0;
uniform float uLayer1;
uniform float uMix;
uniform float uShell;             // the radius the arrows lie at
uniform float uScale;             // their size, which follows the zoom
uniform float uTime;              // seconds, for the glide
uniform float uMotion;            // 0 holds every arrow still at its point, 1 sets them gliding
varying float vAlpha;

// Each arrow's own place in the glide: a hash of which arrow it is (PCG).
float arrowPhase( uint id ) {
  uint state = id * 747796405u + 2891336453u;
  uint word = ( ( state >> ( ( state >> 28u ) + 4u ) ) ^ state ) * 277803737u;
  return float( ( word >> 22u ) ^ word ) * ( 1.0 / 4294967296.0 );
}

void main() {
  float lat = aLatLon.x;
  float lon = aLatLon.y;
  vec2 at = vec2( ( lon + 180.0 ) / 360.0, ( lat + 90.0 ) / 180.0 );
  vec3 d;
  if ( uWeekOn > 0.5 ) {
    vec2 w = vec2( at.x, at.y * uWeekV.x + uWeekV.y );
    d = mix( textureLod( uDirWeek, vec3( w, uLayer0 ), 0.0 ).rgb, textureLod( uDirWeek, vec3( w, uLayer1 ), 0.0 ).rgb, uMix );
  } else {
    d = textureLod( uDirLive, vec2( at.x, at.y * uLiveV.x + uLiveV.y ), 0.0 ).rgb;
  }

  // The CPU sampler's own test: nothing to draw where there is no reading, or where the
  // readings around the point disagree so much that their mean is mostly cancellation.
  float len = length( d.rg );
  float shown = ( d.b > 1e-4 && len >= d.b * ${MIN_DIRECTION_AGREEMENT} ) ? 1.0 : 0.0;

  float phi = radians( 90.0 - lat );
  float theta = radians( lon + 180.0 );
  float sinPhi = sin( phi );
  float cosPhi = cos( phi );
  float sinTheta = sin( theta );
  float cosTheta = cos( theta );
  vec3 normal = vec3( -sinPhi * cosTheta, cosPhi, sinPhi * sinTheta );
  vec3 north = vec3( cosPhi * cosTheta, sinPhi, -cosPhi * sinTheta );
  vec3 east = vec3( sinTheta, 0.0, cosTheta );

  // Where it is going: the reverse of where it comes from.
  vec3 forward = -( east * d.r + north * d.g ) / max( len, 1e-6 );
  vec3 side = cross( forward, normal );

  // arrowDrift in lib/overlaygpu.js.
  float t = fract( uTime / ${glslNum(ARROW_DRIFT_SECONDS)} + arrowPhase( uint( gl_InstanceID ) ) );
  float offset = ( t - 0.5 ) * ${glslNum(ARROW_DRIFT_TRAVEL)};
  float fade = smoothstep( 0.0, ${glslNum(ARROW_DRIFT_FADE_IN)}, t ) * ( 1.0 - smoothstep( ${glslNum(1 - ARROW_DRIFT_FADE_OUT)}, 1.0, t ) );
  vAlpha = mix( 1.0, fade, uMotion );

  vec3 p = normal * uShell + ( side * position.x + forward * ( position.y + offset * uMotion ) ) * ( uScale * shown );
  gl_Position = projectionMatrix * modelViewMatrix * vec4( p, 1.0 );
}
`;

// Light, not dark. The colour ramp starts at a very dark navy -- flat water is (0,28,73) -- and
// a dark arrow is invisible on exactly the calm ocean that covers most of the map. A pale arrow
// reads against everything up to the top of the scale, where the ramp turns pale itself and
// 10m+ seas are vanishingly rare. sRGB bytes, written as they are, like the overlay's.
export const ARROW_RGB = [0xf4, 0xf7, 0xf6];
export const ARROW_OPACITY = 0.72;
export const ARROW_FRAGMENT = /* glsl */ `
varying float vAlpha;
void main() {
  gl_FragColor = vec4( ${ARROW_RGB.map((c) => glslNum(c / 255)).join(', ')}, ${glslNum(ARROW_OPACITY)} * vAlpha );
}
`;
