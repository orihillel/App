// The globe's spot markers, drawn as flat dots.
//
// They used to be spheres: an InstancedMesh of 12x12-segment balls, half-buried in the globe,
// 264 triangles each. Up close nothing clusters, so every spot in the catalogue gets its own --
// 3,518 of them, 928,752 triangles, for dots five to thirteen pixels wide. A sphere drawn flat
// and unlit is a disc anyway, so each one is now a single quad that faces the camera and a
// fragment shader that cuts a smooth circle out of it: two triangles a spot.
//
// They also used to pop. A ball half-buried in the globe is cut off by the horizon as it turns
// away, so markers shrank to slivers and vanished at the edge of the globe and, rotating the
// other way, appeared out of nowhere. Now each dot fades and shrinks a little over a band just
// inside the horizon instead, and the labels and taps follow the same rule, so a label is never
// left floating beside a dot that has gone.

// The dot's radius at the reference zoom, in globe radii -- the old sphere's radius, so the dots
// are the same size on screen as the balls were.
export const MARKER_RADIUS = 0.026;

// How squarely a point on the globe faces the camera: the cosine of the angle between the surface
// normal there and the line from it to the camera. 1 straight on, 0 on the horizon, negative
// round the back. The globe is centred on the origin, so the normal is the point's own direction.
//
// Not the same as the angle from the point straight under the camera, which is what the label
// test used before: from a camera three radii out the horizon is 70 degrees from the middle, and
// a test on that angle alone put labels on spots just behind it.
export function surfaceFacing(px, py, pz, cx, cy, cz) {
  const pl = Math.hypot(px, py, pz);
  const tx = cx - px;
  const ty = cy - py;
  const tz = cz - pz;
  const tl = Math.hypot(tx, ty, tz);
  if (!(pl > 0) || !(tl > 0)) return 0;
  return (px * tx + py * ty + pz * tz) / (pl * tl);
}

// The band, in that facing, over which a dot fades out toward the horizon. At the default zoom
// it is the outer few per cent of the disc on screen -- far enough in that a dot is gone before
// the horizon would cut it, and thin enough that nothing in the middle of the view changes. Up
// close the camera never sees that near the horizon at all.
export const MARKER_FADE_START = 0.15;
export const MARKER_FADE_END = 0.35;

// How visible a dot is: 0 beyond the band, 1 inside it, smooth between.
export function markerFade(facing) {
  const t = Math.min(1, Math.max(0, (facing - MARKER_FADE_START) / (MARKER_FADE_END - MARKER_FADE_START)));
  return t * t * (3 - 2 * t);
}

// Whether a dot counts as on the globe for its label and for taps: once it is at least half
// faded in, so a label never sits beside a dot too faint to see, and a tap cannot pick one.
export function markerShown(facing) {
  return markerFade(facing) >= 0.5;
}

// How much smaller a dot is drawn as it fades -- it shrinks as well as fading, the way a mark on
// a curved surface foreshortens, rather than turning into a ghost of its full size.
export const MARKER_FADED_SIZE = 0.7;
export function markerSizeFactor(facing) {
  return MARKER_FADED_SIZE + (1 - MARKER_FADED_SIZE) * markerFade(facing);
}

const glslFloat = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));

// The dots' shaders. Each instance is one spot, or one cluster of them: where it is on the
// globe, its colour, and how much bigger than a lone spot it is drawn. The quad is two units
// across in its own space, so a corner's position is also its offset in radii.
//
// No depth test: a dot is never hidden behind anything but the globe itself, and round the back
// of the globe it is already faded out. Drawn last, over the overlay, the coastline and the
// arrows, which is where the thing you tap belongs.
export const MARKER_VERTEX = /* glsl */ `
attribute vec3 aCenter;   // where the spot is, on the globe, in the globe's own frame
attribute vec3 aColor;    // its colour, linear
attribute float aSize;    // how much bigger than a lone spot (clusters are drawn larger)
uniform float uRadius;    // a lone spot's radius at this zoom, in globe radii
varying vec2 vCorner;
varying vec3 vColor;
varying float vFade;

void main() {
  vec4 world = modelMatrix * vec4( aCenter, 1.0 );
  vec3 normal = normalize( world.xyz );
  float facing = dot( normal, normalize( cameraPosition - world.xyz ) );
  float fade = smoothstep( ${glslFloat(MARKER_FADE_START)}, ${glslFloat(MARKER_FADE_END)}, facing );
  float radius = uRadius * aSize * mix( ${glslFloat(MARKER_FADED_SIZE)}, 1.0, fade );
  vec4 view = viewMatrix * world;
  view.xy += position.xy * radius;
  gl_Position = projectionMatrix * view;
  // Faded out entirely: collapse it to nothing rather than draw a transparent quad.
  if ( fade <= 0.0 ) gl_Position = vec4( 0.0, 0.0, 2.0, 1.0 );
  vCorner = position.xy;
  vColor = aColor;
  vFade = fade;
}
`;

// A circle with an edge one screen pixel soft, at the dot's own colour. The colour is linear,
// as three's materials keep it, and goes through the same output conversion as the flat
// material the spheres used, so a dot is the same bytes as the legend's swatch.
export const MARKER_FRAGMENT = /* glsl */ `
varying vec2 vCorner;
varying vec3 vColor;
varying float vFade;

void main() {
  float r = length( vCorner );
  float edge = max( fwidth( r ), 1e-4 );
  float inside = 1.0 - smoothstep( 1.0 - edge, 1.0, r );
  if ( inside <= 0.0 ) discard;
  gl_FragColor = vec4( vColor, inside * vFade );
  #include <colorspace_fragment>
}
`;
