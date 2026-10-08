// The wind layer's moving streaks: particles carried across the globe by the live wind.
//
// The wind used to be drawn as the swell is, as a lattice of arrows. An arrow says which way the
// wind is blowing at one point; it cannot show a field. The eye reads where the wind goes --
// round a low, along a front, funnelled down a coast -- from motion, which is why every wind map
// people know animates. Here a few thousand particles drift with the wind, each drawn as a short
// streak back along its path, bright at the head and fading at the tail, so the flow reads at a
// glance and a stronger wind is a longer, faster streak.
//
// All of it runs on the GPU. Where each particle is lives in a small float texture, one texel a
// particle; a full-screen pass moves every one of them by the wind under it on each frame, and
// the streaks are drawn straight from that texture. The CPU sets a handful of uniforms a frame.
//
// The particles live on the globe, not on the screen. A wind map that draws its trails into a
// screen-sized buffer and fades it frame by frame smears them across the screen the moment the
// view moves -- the usual answer is to wipe them on every drag, so they vanish exactly while you
// are looking for something. Here each particle is a latitude and a longitude, its streak is
// worked out from the wind at that point, and both turn and zoom with the globe like everything
// else drawn on it.
//
// What is on screen decides where they are. Every particle that dies is reborn somewhere in the
// patch of globe in view, so however far in or out you zoom, the same few thousand fill what you
// are looking at at the same density, and none are spent on the far side of the world.
//
// Pure arithmetic and shader source; the reference functions below are what the shaders follow
// line for line, and what lib/windparticles.test.js checks.

// One texel a particle, in a square texture this many texels across.
export const PARTICLE_STATE_SIZE = 64;
export const MAX_PARTICLES = PARTICLE_STATE_SIZE * PARTICLE_STATE_SIZE;

// How fast a particle crosses the screen, in CSS pixels a second for each km/h of wind, at the
// middle of the view. Real wind is far too slow to see at this scale -- a gale crosses a 2-degree
// cell in a couple of hours -- so the speed is set on the screen instead: a 20km/h breeze moves
// 30 pixels a second at any zoom, and a 50km/h gale 75.
export const PARTICLE_PX_PER_KPH = 1.5;
// Zoomed out past the default view the globe shrinks on screen, and a streak a fixed number of
// pixels long would cover more and more of it. Past this distance, the globe's first, the speed
// -- and so the length of the streaks -- shrinks with the globe instead.
export const PARTICLE_REF_DISTANCE = 3;
export function particlePxPerKph(distance) {
  if (!(distance > 1)) return PARTICLE_PX_PER_KPH;
  const size = (d) => Math.tan(Math.asin(1 / d)); // the globe's radius on screen, give or take a constant
  return PARTICLE_PX_PER_KPH * Math.min(1, size(distance) / size(PARTICLE_REF_DISTANCE));
}
// How much of its path a streak shows behind its head, in seconds of travel. A streak's length
// is then its speed: 15 pixels for that breeze, 37 for the gale.
export const PARTICLE_TRAIL_SECONDS = 0.5;
// How long a particle lives, in seconds, chosen at random between these. Long enough to see
// where it goes; short enough that the field keeps being re-sampled as you move around it.
export const PARTICLE_LIFE_MIN = 2.5;
export const PARTICLE_LIFE_MAX = 4.5;
// How long a particle takes to fade in after it is born, and out before it dies.
export const PARTICLE_FADE_IN = 0.4;
export const PARTICLE_FADE_OUT = 0.8;
// How many particles for the area on screen: one for each this many CSS square pixels of globe.
// Dense enough to show the field's shape, sparse enough that each streak can be followed.
export const PARTICLE_AREA_PX = 110;
// The width of a streak in CSS pixels, at its head and at its tail.
export const PARTICLE_HEAD_PX = 1.6;
export const PARTICLE_TAIL_PX = 0.5;
// How strong a wind has to be before its streaks are drawn at full strength, in km/h. Calm air
// barely moves its particles, and a field of dots that do not go anywhere reads as noise rather
// than as calm, so they fade toward nothing below this.
export const PARTICLE_FULL_KPH = 10;

// Light, like the arrows, and for the arrows' reason: the wind ramp starts at a deep purple, and
// a pale streak reads over all of it. sRGB bytes, written as they are.
export const PARTICLE_RGB = [0xf4, 0xf7, 0xf6];
export const PARTICLE_OPACITY = 0.9;

// Which way and how fast the wind is moving, in km/h east and north, from its speed and the
// bearing it comes from -- which is how every source reports wind, and the opposite of where it
// is going (see windTravelBearing in lib/windscale.js). A westerly, from 270 degrees, blows east.
export function windVelocity(speedKph, fromDeg) {
  if (speedKph == null || fromDeg == null || !Number.isFinite(speedKph) || !Number.isFinite(fromDeg)) return null;
  const rad = (fromDeg * Math.PI) / 180;
  return [-speedKph * Math.sin(rad), -speedKph * Math.cos(rad)];
}

// The grid's speeds and directions as two grids of components, east and north, null wherever
// either is missing. Components rather than a speed and a bearing because components can be
// averaged: two winds at right angles average to one between them, slower, as they should.
export function velocityComponents(speeds, dirs) {
  const n = Math.min(speeds ? speeds.length : 0, dirs ? dirs.length : 0);
  const east = new Array(n);
  const north = new Array(n);
  for (let i = 0; i < n; i++) {
    const v = windVelocity(speeds[i], dirs[i]);
    east[i] = v ? v[0] : null;
    north[i] = v ? v[1] : null;
  }
  return { east, north };
}

// The wind's components, resampled onto a field layout (see lib/overlaygpu.js) as four channels
// a texel: R and G the east and north components summed over the cells with a reading, weighted
// as makeGridSampler weights them, B the total weight, A unused. The same shape as the arrows'
// directions, for the same reason -- the GPU's bilinear filter adds the sums up exactly as the
// CPU sampler would, and dividing by the weight in the shader gives the null-aware mean -- but
// these are velocities, not unit vectors, so the mean is the wind itself, speed and all.
//
// `out` is reused if given.
export function regularizeVelocity(east, north, layout, out) {
  const { width, height, cellA, cellB, towardB } = layout;
  if (!out) out = new Float32Array(width * height * 4);
  // Texel row 0 is the empty row below the grid, so grid row r is texel row r + 1.
  for (let i = 0, o = width * 4; i < cellA.length; i++, o += 4) {
    const wb = towardB[i];
    const wa = 1 - wb;
    const a = cellA[i];
    const b = cellB[i];
    let x = 0;
    let y = 0;
    let w = 0;
    if (wa > 0 && has(east, north, a)) { x += east[a] * wa; y += north[a] * wa; w += wa; }
    if (wb > 0 && has(east, north, b)) { x += east[b] * wb; y += north[b] * wb; w += wb; }
    out[o] = x;
    out[o + 1] = y;
    out[o + 2] = w;
  }
  return out;
}
function has(east, north, i) {
  const x = east ? east[i] : null;
  const y = north ? north[i] : null;
  return x != null && y != null && Number.isFinite(x) && Number.isFinite(y);
}

// How many degrees of arc a particle covers each second for each km/h of wind, so that it moves
// PARTICLE_PX_PER_KPH screen pixels a second at the middle of the view at any zoom.
//
// The arithmetic is the drag's (applyDrag in the globe): an arc of a radians straight under the
// camera is a units long and sits `distance - 1` from the camera, so it projects to
// a * focal / (distance - 1) pixels, where focal = (height / 2) / tan(halfFov).
export function degreesPerSecondPerKph(distance, halfFovRad, heightPx, pxPerKph = PARTICLE_PX_PER_KPH) {
  if (!(distance > 1) || !(heightPx > 0) || !(halfFovRad > 0)) return 0;
  const focal = heightPx / 2 / Math.tan(halfFovRad);
  const radiansPerPx = (distance - 1) / focal;
  return ((pxPerKph * radiansPerPx) * 180) / Math.PI;
}

// How far from the middle of the view the patch of globe on screen reaches, as an angle from the
// globe's centre. The corners of the screen, not its edges: the view is a rectangle, and a circle
// that only reached the top and bottom would leave the sides of a wide screen bare. Out to the
// horizon at most, which is all of the globe there is to see.
export function viewCapRadius(distance, halfFovRad, aspect = 1) {
  if (!(distance > 1)) return 0;
  const halfDiagonal = Math.atan(Math.tan(halfFovRad) * Math.hypot(1, aspect));
  const graze = Math.asin(1 / distance);
  if (halfDiagonal >= graze) return Math.acos(1 / distance);
  return Math.asin(Math.min(1, distance * Math.sin(halfDiagonal))) - halfDiagonal;
}

// How many particles to draw: one for every PARTICLE_AREA_PX of globe on screen. The globe's
// disc, worked out from how wide it looks from here, and never more than the screen itself.
export function particleCount(distance, halfFovRad, widthPx, heightPx, max = MAX_PARTICLES) {
  if (!(distance > 1) || !(widthPx > 0) || !(heightPx > 0)) return 0;
  const focal = heightPx / 2 / Math.tan(halfFovRad);
  const discPx = Math.tan(Math.asin(1 / distance)) * focal;
  const area = Math.min(Math.PI * discPx * discPx, widthPx * heightPx);
  return Math.max(1, Math.min(max, Math.round(area / PARTICLE_AREA_PX)));
}

// Where particle `i` lives in the state texture, as the coordinates of its texel's centre.
export function stateTexel(i, size = PARTICLE_STATE_SIZE) {
  return [((i % size) + 0.5) / size, (Math.floor(i / size) + 0.5) / size];
}

// A point on the unit globe, from latitude and longitude: latLonToVector3's arithmetic, without
// the THREE.Vector3, which is what the shaders' toGlobe does.
export function toGlobe(lat, lon) {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((lon + 180) * Math.PI) / 180;
  return [-Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta)];
}
// And back: vector3ToLatLon's, for a unit vector. Longitudes in [-180, 180).
export function toLatLon(p) {
  const lat = 90 - (Math.acos(Math.max(-1, Math.min(1, p[1]))) * 180) / Math.PI;
  const lon = (Math.atan2(p[2], -p[0]) * 180) / Math.PI - 180;
  return { lat, lon: lon - 360 * Math.floor((lon + 180) / 360) };
}

// Where a particle is born: a point spread evenly over a ring round `center` (a unit vector),
// between the angles whose cosines are `cosInner` and `cosOuter`, from two random numbers in
// [0, 1). With `cosInner` at 1 the ring is the whole patch in view. Even by area, not by angle,
// so a disc is not crowded at its middle: the cosine of the angle from the centre is spread
// evenly, which is what spreads a spherical cap's area evenly.
//
// The ring is for zooming out. The patch in view grows, the particles are all still in the
// middle of it, and they would take a whole lifetime to spread; instead the share of them the
// new ring should hold is reborn in the ring at once (see uGrowth in the update shader).
export function pointInCap(center, cosInner, cosOuter, r1, r2) {
  const c = center;
  const cosT = cosInner + (cosOuter - cosInner) * r1;
  const sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT));
  const phi = 2 * Math.PI * r2;
  // Any two directions square to the centre and to each other.
  const ref = Math.abs(c[1]) < 0.99 ? [0, 1, 0] : [1, 0, 0];
  const t1 = normalize(cross(c, ref));
  const t2 = cross(c, t1);
  const p = [0, 1, 2].map((k) => c[k] * cosT + (t1[k] * Math.cos(phi) + t2[k] * Math.sin(phi)) * sinT);
  return toLatLon(p);
}
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function normalize(a) {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
}

// One step of a particle's travel: `dt` seconds of a wind `v` (km/h east and north) at `scale`
// degrees a second per km/h. A degree of longitude is shorter the further from the equator, by
// the cosine of the latitude, so the same eastward wind covers more of them up there. The grid
// stops at 75 degrees, which keeps that cosine well clear of nothing; it is floored anyway.
export function advect(lat, lon, v, scale, dt) {
  const nextLat = lat + v[1] * scale * dt;
  const east = (v[0] * scale * dt) / Math.max(Math.cos((lat * Math.PI) / 180), 0.05);
  const l = lon + east + 180;
  return { lat: nextLat, lon: l - 360 * Math.floor(l / 360) - 180 };
}

// One particle through one update: the update shader's main(), line for line, with the GPU's
// textures and hash passed in. `s` is `{ lat, lon, age, life }`. `env` holds the uniforms --
// `center`, `viewCos`, `growthCos`, `growth`, `scale`, `dt` -- and `random()`, `wind(lat, lon)`
// giving `[east sum, north sum, weight]` as the velocity texture does, and `atSea(lat, lon,
// weight)`.
//
// A lifespan of zero is a particle never born; a negative one, a particle waiting out a life it
// cannot spend at sea. Why it waits rather than trying again at once is the shader's comment.
export function stepParticle(s, env) {
  let { lat, lon, age, life } = s;
  const p = toGlobe(lat, lon);
  const c = env.center;
  const inView = p[0] * c[0] + p[1] * c[1] + p[2] * c[2] >= env.viewCos;
  let reborn = false;
  let cosInner = 1;
  const cosOuter = env.viewCos;
  if (life === 0) {
    reborn = true;
  } else if (age >= Math.abs(life) || !inView) {
    reborn = true;
  } else if (env.random() < env.growth) {
    reborn = true;
    cosInner = env.growthCos;
  }

  if (reborn) {
    const at = pointInCap(c, cosInner, cosOuter, env.random(), env.random());
    const span = PARTICLE_LIFE_MIN + (PARTICLE_LIFE_MAX - PARTICLE_LIFE_MIN) * env.random();
    const startAge = life === 0 ? env.random() * span : 0;
    lat = at.lat;
    lon = at.lon;
    age = startAge;
    life = env.atSea(lat, lon, env.wind(lat, lon)[2]) ? span : -span;
  } else {
    age += env.dt;
    if (life > 0) {
      const f = env.wind(lat, lon);
      if (!env.atSea(lat, lon, f[2])) {
        life = -life;
      } else {
        const next = advect(lat, lon, [f[0] / f[2], f[1] / f[2]], env.scale, env.dt);
        lat = next.lat;
        lon = next.lon;
      }
    }
  }
  return { lat, lon, age, life };
}

const glslFloat = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));

// What both passes need: the wind at a point, and the globe's coordinates.
//
// The velocity texture is sampled where the overlay's colours are, through the same row mapping
// (layoutV), and the land mask where the overlay is cut with it.
const COMMON = /* glsl */ `
uniform sampler2D uVelocity;  // R, G = east, north km/h summed over the cells with a reading; B = weight
uniform vec2 uVelocityV;      // where its rows are: v = (sphere's v) * x + y
uniform sampler2D uLandMask;  // R = fraction of the texel that is land
uniform float uHasMask;

vec2 sphereUv( float lat, float lon ) {
  return vec2( ( lon + 180.0 ) / 360.0, ( lat + 90.0 ) / 180.0 );
}
vec3 windAt( float lat, float lon ) {
  vec2 at = sphereUv( lat, lon );
  return textureLod( uVelocity, vec2( at.x, at.y * uVelocityV.x + uVelocityV.y ), 0.0 ).rgb;
}
// Whether a particle may be here: over the sea, by the same mask and threshold the overlay is
// cut with, and where the field has readings. Without a mask the readings alone say where the
// sea is, as they do for the overlay, and a point needs most of its weight from them.
bool atSea( float lat, float lon, float weight ) {
  if ( uHasMask > 0.5 ) return weight > 0.05 && textureLod( uLandMask, sphereUv( lat, lon ), 0.0 ).r < 0.5;
  return weight > 0.5;
}
vec3 toGlobe( float lat, float lon ) {
  float phi = radians( 90.0 - lat );
  float theta = radians( lon + 180.0 );
  return vec3( -sin( phi ) * cos( theta ), cos( phi ), sin( phi ) * sin( theta ) );
}
`;

// The update pass: one fragment a particle, reading where it was and writing where it is. Its
// main() is stepParticle above, line for line.
//
// The state is four floats a particle: latitude, longitude, age and lifespan, both in seconds. A
// lifespan of zero is a particle never born -- the texture starts out all zeros -- and a negative
// one is a particle waiting out a life it cannot spend at sea (see below).
export const PARTICLE_UPDATE_VERTEX = /* glsl */ `
void main() {
  gl_Position = vec4( position.xy, 0.0, 1.0 );
}
`;

export const PARTICLE_UPDATE_FRAGMENT = /* glsl */ `
uniform sampler2D uState;     // where every particle was: lat, lon, age, life
uniform vec3 uViewCenter;     // the point straight under the camera, in the globe's own frame
uniform float uViewCos;       // the cosine of the angle out to the edge of the view (viewCapRadius)
uniform float uGrowthCos;     // the same, before the view last grew; equal to uViewCos if it did not
uniform float uGrowth;        // the share of particles to be reborn in the new ring
uniform float uScale;         // degrees a second per km/h (degreesPerSecondPerKph)
uniform float uDt;            // seconds since the last update
uniform float uFrame;         // counts updates, so each one draws new random numbers
${COMMON}

// A small, well-mixed hash (PCG), so every particle on every frame gets its own random numbers
// without a texture of noise.
uint pcg( uint v ) {
  uint state = v * 747796405u + 2891336453u;
  uint word = ( ( state >> ( ( state >> 28u ) + 4u ) ) ^ state ) * 277803737u;
  return ( word >> 22u ) ^ word;
}
float random( inout uint seed ) {
  seed = pcg( seed );
  return float( seed ) * ( 1.0 / 4294967296.0 );
}

// pointInCap in lib/windparticles.js, line for line.
vec2 pointInCap( vec3 c, float cosInner, float cosOuter, float r1, float r2 ) {
  float cosT = cosInner + ( cosOuter - cosInner ) * r1;
  float sinT = sqrt( max( 0.0, 1.0 - cosT * cosT ) );
  float phi = 6.283185307179586 * r2;
  vec3 ref = abs( c.y ) < 0.99 ? vec3( 0.0, 1.0, 0.0 ) : vec3( 1.0, 0.0, 0.0 );
  vec3 t1 = normalize( cross( c, ref ) );
  vec3 t2 = cross( c, t1 );
  vec3 p = c * cosT + ( t1 * cos( phi ) + t2 * sin( phi ) ) * sinT;
  float lat = 90.0 - degrees( acos( clamp( p.y, -1.0, 1.0 ) ) );
  float lon = degrees( atan( p.z, -p.x ) ) - 180.0;
  return vec2( lat, lon - 360.0 * floor( ( lon + 180.0 ) / 360.0 ) );
}

void main() {
  vec4 s = texture2D( uState, gl_FragCoord.xy / ${glslFloat(PARTICLE_STATE_SIZE)} );
  float lat = s.x;
  float lon = s.y;
  float age = s.z;
  float life = s.w;
  uint index = uint( gl_FragCoord.y ) * ${PARTICLE_STATE_SIZE}u + uint( gl_FragCoord.x );
  uint seed = pcg( pcg( uint( uFrame ) ) + index );

  bool inView = dot( toGlobe( lat, lon ), uViewCenter ) >= uViewCos;
  bool reborn = false;
  float cosInner = 1.0;
  float cosOuter = uViewCos;
  if ( life == 0.0 ) {
    reborn = true; // never born
  } else if ( age >= abs( life ) || !inView ) {
    // Its time is up, or the view has moved off it: born again somewhere in view.
    reborn = true;
  } else if ( random( seed ) < uGrowth ) {
    // The view has just grown; this one goes to fill the new ring at its edge.
    reborn = true;
    cosInner = uGrowthCos;
  }

  if ( reborn ) {
    vec2 at = pointInCap( uViewCenter, cosInner, cosOuter, random( seed ), random( seed ) );
    float span = mix( ${glslFloat(PARTICLE_LIFE_MIN)}, ${glslFloat(PARTICLE_LIFE_MAX)}, random( seed ) );
    // The very first particles start part way through their lives, or every one of them would
    // reach the end of its life on the same frame, and go on doing so in step forever.
    float startAge = life == 0.0 ? random( seed ) * span : 0.0;
    lat = at.x;
    lon = at.y;
    age = startAge;
    // Born on land, or where there is no wind: it waits out the life it would have had, unseen,
    // before trying again. Trying again at once would mean every particle born on a continent
    // was straight away reborn elsewhere -- in the bit of sea that is in view -- and a view of
    // a coast would pack the whole field into the strip of water along it.
    life = atSea( lat, lon, windAt( lat, lon ).b ) ? span : -span;
  } else {
    age += uDt;
    if ( life > 0.0 ) {
      vec3 f = windAt( lat, lon );
      if ( !atSea( lat, lon, f.b ) ) {
        // Blown ashore, or out of the field: it waits out the rest of its life, unseen.
        life = -life;
      } else {
        // advect in lib/windparticles.js.
        vec2 v = f.rg / f.b;
        float east = v.x * uScale * uDt / max( cos( radians( lat ) ), 0.05 );
        lat += v.y * uScale * uDt;
        float l = lon + east + 180.0;
        lon = l - 360.0 * floor( l / 360.0 ) - 180.0;
      }
    }
  }
  gl_FragColor = vec4( lat, lon, age, life );
}
`;

// The draw pass: one streak a particle, a strip of two triangles from its head back along the
// wind under it. Four vertices, each knowing only which end it is (position.x: 0 at the head, 1
// at the tail) and which side (position.y: -1 or 1); the instance says which particle.
//
// The width is set on the screen, in pixels, not on the globe: a streak drawn as a strip on the
// sphere would be a hair zoomed out and a ribbon zoomed in. The two ends are projected first and
// the strip is widened across the line between them.
export const PARTICLE_DRAW_VERTEX = /* glsl */ `
attribute vec2 aTexel;        // which particle: its texel in the state texture
uniform sampler2D uState;
uniform float uShell;         // the radius the streaks are drawn at
uniform float uTrail;         // how far back a streak reaches, in degrees per km/h of wind
uniform vec2 uViewport;       // the drawing buffer, in device pixels
uniform float uPixelRatio;    // device pixels to a CSS pixel
uniform float uOpacity;       // the whole layer's, for fading it in
varying float vAlpha;
${COMMON}

void main() {
  vec4 s = textureLod( uState, aTexel, 0.0 );
  float lat = s.x;
  float lon = s.y;
  float age = s.z;
  float life = s.w;
  vec3 f = windAt( lat, lon );
  vec2 v = f.b > 1e-4 ? f.rg / f.b : vec2( 0.0 );

  // The tail: where the wind under the head would have carried it from.
  float tailLat = lat - v.y * uTrail;
  float tailLon = lon - v.x * uTrail / max( cos( radians( lat ) ), 0.05 );
  vec4 headWorld = modelMatrix * vec4( toGlobe( lat, lon ) * uShell, 1.0 );
  vec4 head = projectionMatrix * viewMatrix * headWorld;
  vec4 tail = projectionMatrix * viewMatrix * modelMatrix * vec4( toGlobe( tailLat, tailLon ) * uShell, 1.0 );

  vec2 headPx = head.xy / head.w * uViewport * 0.5;
  vec2 tailPx = tail.xy / tail.w * uViewport * 0.5;
  vec2 along = headPx - tailPx;
  float pxLength = length( along );
  along = pxLength > 1e-3 ? along / pxLength : vec2( 1.0, 0.0 );
  vec2 across = vec2( -along.y, along.x );

  float t = position.x;
  vec4 clip = mix( head, tail, t );
  float halfWidth = 0.5 * uPixelRatio * mix( ${glslFloat(PARTICLE_HEAD_PX)}, ${glslFloat(PARTICLE_TAIL_PX)}, t );
  clip.xy += across * position.y * halfWidth / ( uViewport * 0.5 ) * clip.w;
  gl_Position = clip;

  // Faded in after birth and out before death; toward the horizon, as the markers are, so a
  // streak never hangs off the globe's edge; and toward calm, where a streak is a dot.
  float living = life > 0.0
    ? smoothstep( 0.0, ${glslFloat(PARTICLE_FADE_IN)}, age ) * ( 1.0 - smoothstep( life - ${glslFloat(PARTICLE_FADE_OUT)}, life, age ) )
    : 0.0;
  vec3 normal = normalize( headWorld.xyz );
  float facing = dot( normal, normalize( cameraPosition - headWorld.xyz ) );
  float limb = smoothstep( 0.02, 0.2, facing );
  float strength = smoothstep( 0.0, ${glslFloat(PARTICLE_FULL_KPH)}, length( v ) );
  vAlpha = living * limb * strength * uOpacity * ( 1.0 - t );
  // Nothing to draw: collapse it rather than draw a transparent strip.
  if ( living * limb * strength <= 0.0 ) gl_Position = vec4( 0.0, 0.0, 2.0, 1.0 );
}
`;

export const PARTICLE_DRAW_FRAGMENT = /* glsl */ `
varying float vAlpha;
void main() {
  gl_FragColor = vec4( ${PARTICLE_RGB.map((c) => glslFloat(c / 255)).join(', ')}, vAlpha * ${glslFloat(PARTICLE_OPACITY)} );
}
`;
