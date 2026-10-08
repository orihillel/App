// Day and night on the globe: where the sun is overhead at the moment on screen, and the shading
// that puts the night side in shadow.
//
// The globe used to be lit by a lamp fixed beside the camera, so whichever side faced you was
// always in daylight. A surf forecast is a forecast for a time of day, though -- a swell that
// arrives at 3am is a swell nobody surfs -- and the globe now says what time it is the way the
// planet does: the half of it facing away from the sun is darker, with a soft band of twilight
// between. It follows the moment the overlay is showing: now for the live map, and while the week
// plays, each forecast step's own time, so the night sweeps round the globe as the days go by.
//
// Only the base map is shaded. The overlay, the arrows, the particles and the markers are data,
// and their colours have to mean the same thing at midnight as at noon; they are never touched.
// The lamp beside the camera stays as well, because it is what makes the globe read as round --
// the night side is dimmed on top of it, not left unlit.
//
// The sun's position is NOAA's solar calculator (the "Astronomical Algorithms" series of Jean
// Meeus, which globe.gl's day-night example also uses through the solar-calculator package):
// good to a small fraction of a degree, far finer than a twilight band several degrees wide.

const RAD = Math.PI / 180;

// Julian centuries since the J2000.0 epoch, from a Unix time in milliseconds.
export function julianCentury(ms) {
  return (ms / 86400000 + 2440587.5 - 2451545) / 36525;
}

// The sun's declination (degrees north of the equator it is overhead) and the equation of time
// (minutes by which the sundial runs ahead of the clock) at `ms`.
export function solarPosition(ms) {
  const T = julianCentury(ms);
  const L0 = (((280.46646 + T * (36000.76983 + T * 0.0003032)) % 360) + 360) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = Math.sin(M * RAD) * (1.914602 - T * (0.004817 + 0.000014 * T))
    + Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * T)
    + Math.sin(3 * M * RAD) * 0.000289;
  const omega = 125.04 - 1934.136 * T;
  const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const epsilon0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const epsilon = epsilon0 + 0.00256 * Math.cos(omega * RAD);
  const declination = Math.asin(Math.sin(epsilon * RAD) * Math.sin(lambda * RAD)) / RAD;
  const y = Math.tan((epsilon / 2) * RAD) ** 2;
  const equationOfTime = (4 / RAD) * (
    y * Math.sin(2 * L0 * RAD)
    - 2 * e * Math.sin(M * RAD)
    + 4 * e * y * Math.sin(M * RAD) * Math.cos(2 * L0 * RAD)
    - 0.5 * y * y * Math.sin(4 * L0 * RAD)
    - 1.25 * e * e * Math.sin(2 * M * RAD)
  );
  return { declination, equationOfTime };
}

// Where on Earth the sun is straight overhead at `ms`. The longitude is where it is solar noon:
// noon at Greenwich at 12:00 UTC, fifteen degrees further west for every hour after, shifted by
// however far the sundial is running ahead of the clock that day.
export function subsolarPoint(ms) {
  const { declination, equationOfTime } = solarPosition(ms);
  const utcHours = (((ms / 3600000) % 24) + 24) % 24;
  const lon = (12 - utcHours - equationOfTime / 60) * 15;
  return { lat: declination, lon: ((((lon + 180) % 360) + 360) % 360) - 180 };
}

// The direction of the sun from the globe's centre, in the globe's own frame: the same axes as
// latLonToVector3 in lib/geo3d.js, so it can be compared with any point of the globe directly.
export function sunDirection(ms) {
  const { lat, lon } = subsolarPoint(ms);
  const phi = (90 - lat) * RAD;
  const theta = (lon + 180) * RAD;
  return [-Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta)];
}

// A forecast step's time, from the "YYYY-MM-DDTHH:MM" the Worker writes. It has no zone and means
// UTC (see frameLabel in lib/waveframes.js), so the Z is added rather than letting the browser
// read it as local time. Null for anything unreadable.
export function frameTimeMs(iso) {
  if (typeof iso !== 'string' || !iso) return null;
  const ms = new Date(/[Zz]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + 'Z').getTime();
  return Number.isFinite(ms) ? ms : null;
}

// How deep the night is: the base map's light is multiplied by this on the night side, channel
// by channel, in linear terms. A little over 40% of the daytime brightness as the eye judges it,
// and bluer than it is dim, so it reads as night rather than as shadow, while coastlines and
// terrain still show through. It was 60% at first, the usual advice for keeping a base map
// readable, and on screen it did not read as night at all: a desert in the middle of the night
// side looked like a desert in the afternoon, because nothing on the same globe was brighter
// than it to compare against.
export const NIGHT_RGB = [0.13, 0.15, 0.24];
// The twilight band, as the sine of the sun's height: from this far below the horizon to this
// far above it, about four degrees each way, the shading eases from night to day -- wide enough
// to be soft, narrow enough to be seen as a line.
export const TWILIGHT = 0.07;

// What a point's light is multiplied by, given the sine of the sun's height there (the dot product
// of the point's direction with the sun's): 1 in daylight, NIGHT_RGB at night, smooth between.
export function nightShade(sunUp) {
  const t = Math.min(1, Math.max(0, (sunUp + TWILIGHT) / (2 * TWILIGHT)));
  const day = t * t * (3 - 2 * t);
  return NIGHT_RGB.map((n) => n + (1 - n) * day);
}

const glslFloat = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));

// Patches the base map's MeshPhongMaterial shader -- the argument three passes to onBeforeCompile
// -- to shade its night side. `uniforms.uSunDir` is sunDirection's vector. The shading goes on
// the finished light, after the lamps and their highlight, so the night side's sheen is dimmed
// with everything else. Returns whether the shader could be patched; if three renames the chunks
// it hooks, the globe is left in daylight rather than failing to draw.
export function shadeNight(shader, uniforms) {
  const vertexHook = '#include <begin_vertex>';
  const fragmentHook = '#include <opaque_fragment>';
  if (!shader.vertexShader.includes(vertexHook) || !shader.fragmentShader.includes(fragmentHook)) return false;
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = 'varying vec3 vNightPos;\n' + shader.vertexShader.replace(
    vertexHook,
    vertexHook + '\n\tvNightPos = position;',
  );
  shader.fragmentShader = 'uniform vec3 uSunDir;\nvarying vec3 vNightPos;\n' + shader.fragmentShader.replace(
    fragmentHook,
    /* glsl */ `{
		// nightShade in lib/terminator.js. The globe is centred on its origin, so a point's own
		// direction is its normal.
		float sunUp = dot( normalize( vNightPos ), uSunDir );
		float day = smoothstep( ${glslFloat(-TWILIGHT)}, ${glslFloat(TWILIGHT)}, sunUp );
		outgoingLight *= mix( vec3( ${NIGHT_RGB.map(glslFloat).join(', ')} ), vec3( 1.0 ), day );
	}
	` + fragmentHook,
  );
  return true;
}
