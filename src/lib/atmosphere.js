// The globe's surroundings: the rim of atmosphere round its edge, and the stars behind it.
//
// The glow used to be a sprite: a radial gradient on a square 2.7 radii across, drawn behind the
// globe and added onto whatever was there. It read as a soft teal haze, but a haze painted on a
// card stays the same shape and the same width however the globe is turned or zoomed, and its
// edge was the gradient's, not the planet's.
//
// Now it is a shell a little larger than the globe, drawn from the inside -- only its far wall,
// so the globe itself hides every part of it but the ring outside its own edge -- and shaded by
// how obliquely the line of sight passes through it, a Fresnel term like three-globe's GlowMesh.
// It is brightest against the planet's edge and thins to nothing at the shell's, the way a real
// atmosphere looks from orbit, and it is the right size at every zoom because it is geometry.

// The shell's radius, in globe radii. Real air is a sliver at this scale; a little more reads as
// air rather than as an outline.
export const ATMOSPHERE_RADIUS = 1.12;
// How the glow falls off from the globe's edge to the shell's: (cos / cos at the edge)^power,
// where cos is between the shell's normal and the line of sight. GlowMesh's own term,
// (0.1 + cos)^3.5, never got above 0.12 on a shell this thin -- the cosine at the globe's edge
// is only 0.45 -- and on this navy the rim all but vanished. Measured against the edge instead,
// the rim starts at full strength against the planet and thins to nothing at the shell.
export const ATMOSPHERE_POWER = 2.5;
// The colour: Mapbox's atmosphere blue (its `high-color`), a clear sky seen edge-on. sRGB bytes.
export const ATMOSPHERE_RGB = [0x24, 0x5c, 0xdf];
// How strongly it is drawn against the globe's edge.
export const ATMOSPHERE_OPACITY = 0.6;
// The cosine along a line of sight that just grazes the globe, where the rim is brightest. That
// line passes one globe radius from the centre, so it meets the shell at asin(1 / radius) to the
// normal there -- from any distance, since the grazing line is always one radius out.
export const ATMOSPHERE_EDGE_COS = Math.sqrt(1 - 1 / (ATMOSPHERE_RADIUS * ATMOSPHERE_RADIUS));

// How strongly the rim is drawn where the line of sight passes `b` globe radii from the centre,
// from 1 (grazing the globe) out to ATMOSPHERE_RADIUS (grazing the shell). The shader's
// arithmetic, with its cosine worked out from b.
export function atmosphereIntensity(b) {
  const sinA = Math.min(1, Math.max(0, b / ATMOSPHERE_RADIUS));
  const cos = Math.sqrt(1 - sinA * sinA);
  return Math.pow(Math.min(1, cos / ATMOSPHERE_EDGE_COS), ATMOSPHERE_POWER) * ATMOSPHERE_OPACITY;
}

const glslFloat = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
// sRGB bytes to the linear values a shader works in, so the colour on screen is the one named.
export function srgbToLinear(byte) {
  const c = byte / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export const ATMOSPHERE_VERTEX = /* glsl */ `
varying vec3 vNormal;
varying vec3 vWorld;
void main() {
  vNormal = normalize( mat3( modelMatrix ) * normal );
  vec4 world = modelMatrix * vec4( position, 1.0 );
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

// The far wall of the shell is what is drawn, so its normal points away from the camera: the
// cosine below is between that normal and the line of sight running on through it, largest
// where the line grazes the globe and falling to nothing where it grazes the shell.
export const ATMOSPHERE_FRAGMENT = /* glsl */ `
varying vec3 vNormal;
varying vec3 vWorld;
void main() {
  vec3 sight = normalize( vWorld - cameraPosition );
  float cosine = dot( normalize( vNormal ), sight );
  float intensity = pow( clamp( cosine / ${glslFloat(ATMOSPHERE_EDGE_COS)}, 0.0, 1.0 ), ${glslFloat(ATMOSPHERE_POWER)} );
  gl_FragColor = vec4( ${ATMOSPHERE_RGB.map((c) => glslFloat(srgbToLinear(c))).join(', ')}, intensity * ${glslFloat(ATMOSPHERE_OPACITY)} );
  #include <colorspace_fragment>
}
`;

// The stars, by zoom. Out in space they are the backdrop; closing in on the surface they are
// sky no one at that altitude would see, glimpsed past the globe's edge in the corners of the
// screen. They fade out as the camera comes down, as Mapbox's do, and are gone by the time the
// globe fills the screen.
export const STARS_FULL_DISTANCE = 2.6;
export const STARS_GONE_DISTANCE = 1.6;
export function starFade(distance) {
  const t = Math.min(1, Math.max(0, (distance - STARS_GONE_DISTANCE) / (STARS_FULL_DISTANCE - STARS_GONE_DISTANCE)));
  return t * t * (3 - 2 * t);
}
