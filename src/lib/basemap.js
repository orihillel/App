// The globe's base map: NASA's Blue Marble, prebuilt as a GPU-compressed texture by
// scripts/build-basemap.mjs and loaded by the globe (see loadBasemap in components/Globe.jsx).
//
// One definition for both, so the file the script writes and the file the globe asks for cannot
// drift apart. The name carries a version because the service worker keeps the file
// cache-first: new contents need a new name, or every cached copy keeps the old ones.
export const BASEMAP = { file: 'basemap-4096x2048-v1.ktx2', width: 4096, height: 2048 };

// The base map, quietened under an overlay.
//
// Satellite greens and browns are the globe's best look on its own, and the worst thing to read
// a colour scale against: the overlay is drawn at 0.85, so every legend colour shifts with the
// photograph under it, and busy land beside a vivid scale fights it for attention. Basemaps made
// to carry data -- CARTO's Positron and Dark Matter are the usual examples -- are quiet on
// purpose. So while an overlay is shown the photograph cross-fades to a dark, flat sea and slate
// land that keeps the photograph's light and shade, and back again when the overlay goes. The
// overlay's own colours are never touched; only what is under and around them.
//
// Done in the base material's own shader (see muteBasemap), after the map is read and before it
// is lit, so the globe keeps its shading and the fade is one uniform.
export const MUTED_SEA_RGB = [0x0b, 0x17, 0x25];
export const MUTED_LAND_DARK_RGB = [0x26, 0x30, 0x3b];
export const MUTED_LAND_LIGHT_RGB = [0x76, 0x82, 0x8f];
// How long the cross-fade takes, in milliseconds.
export const BASEMAP_MUTE_MS = 350;

const glslFloat = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
function linear(byte) {
  const c = byte / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
const glslColor = (rgb) => 'vec3( ' + rgb.map((c) => glslFloat(linear(c))).join(', ') + ' )';

// The muted colour for a texel of the map, given its colour (linear) and how much of it is land.
// Slate for land, from dark to light with the photograph's own brightness so mountains, deserts
// and ice still read; flat dark water for sea. The shader's arithmetic, for the tests.
export function mutedColor(rgb, land) {
  const lum = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  const t = Math.min(1, Math.max(0, Math.sqrt(lum) * 1.4));
  const slate = MUTED_LAND_DARK_RGB.map((c, i) => linear(c) + (linear(MUTED_LAND_LIGHT_RGB[i]) - linear(c)) * t);
  return MUTED_SEA_RGB.map((c, i) => linear(c) + (slate[i] - linear(c)) * land);
}

// Patches a MeshPhongMaterial's shader -- the argument three passes to onBeforeCompile -- to
// cross-fade its map toward the muted colours by `uniforms.uMute` (0 the photograph, 1 muted).
// `uMuteMask` is the land mask (one channel, the share of each texel that is land, rows south
// first like the sphere's own v) and `uMuteHasMask` says whether there is one; without it land
// and sea cannot be told apart, and the whole map goes to one slate ramp by brightness.
//
// Returns whether the shader could be patched. The chunks it hooks are three's; if a release
// renames them the map is left as it is rather than the globe failing to draw.
export function muteBasemap(shader, uniforms) {
  const vertexHook = '#include <uv_vertex>';
  const fragmentHook = '#include <map_fragment>';
  if (!shader.vertexShader.includes(vertexHook) || !shader.fragmentShader.includes(fragmentHook)) return false;
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = 'varying vec2 vMuteUv;\n' + shader.vertexShader.replace(
    vertexHook,
    vertexHook + '\n\tvMuteUv = uv;',
  );
  shader.fragmentShader = [
    'uniform float uMute;',
    'uniform sampler2D uMuteMask;',
    'uniform float uMuteHasMask;',
    'varying vec2 vMuteUv;',
  ].join('\n') + '\n' + shader.fragmentShader.replace(fragmentHook, fragmentHook + /* glsl */ `
	if ( uMute > 0.0 ) {
		float lum = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
		vec3 slate = mix( ${glslColor(MUTED_LAND_DARK_RGB)}, ${glslColor(MUTED_LAND_LIGHT_RGB)}, clamp( sqrt( lum ) * 1.4, 0.0, 1.0 ) );
		float land = 1.0;
		if ( uMuteHasMask > 0.5 ) {
			// The overlay's own coastline: thresholded at a half, a screen pixel soft.
			float coverage = texture2D( uMuteMask, vMuteUv ).r - 0.5;
			float edge = max( fwidth( coverage ), 1e-5 );
			land = smoothstep( -edge, edge, coverage );
		}
		vec3 muted = mix( ${glslColor(MUTED_SEA_RGB)}, slate, land );
		diffuseColor.rgb = mix( diffuseColor.rgb, muted, uMute );
	}`);
  return true;
}
