import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  solarPosition, subsolarPoint, sunDirection, frameTimeMs, nightShade, shadeNight, NIGHT_RGB, TWILIGHT,
} from './terminator.js';
import { latLonToVector3 } from './geo3d.js';

const utc = (iso) => Date.parse(iso);
// The sine of the sun's height above the horizon at a place and time.
function sunUpAt(lat, lon, ms) {
  const s = sunDirection(ms);
  const p = latLonToVector3(lat, lon, 1);
  return p.x * s[0] + p.y * s[1] + p.z * s[2];
}
// At sunrise and sunset the sun's centre is 0.833 degrees below the horizon: refraction lifts it
// into view, and it is the top edge that counts.
const HORIZON = Math.sin((-0.833 * Math.PI) / 180);

describe('solarPosition', () => {
  it('puts the sun over the tropics at the solstices', () => {
    expect(solarPosition(utc('2024-06-20T20:51Z')).declination).toBeCloseTo(23.44, 1);
    expect(solarPosition(utc('2024-12-21T09:20Z')).declination).toBeCloseTo(-23.44, 1);
  });

  it('puts the sun over the equator at the equinoxes', () => {
    expect(solarPosition(utc('2024-03-20T03:06Z')).declination).toBeCloseTo(0, 1);
    expect(solarPosition(utc('2024-09-22T12:44Z')).declination).toBeCloseTo(0, 1);
  });

  it('has the sundial running a quarter of an hour fast in November and slow in February', () => {
    expect(solarPosition(utc('2024-11-03T12:00Z')).equationOfTime).toBeCloseTo(16.4, 0);
    expect(solarPosition(utc('2024-02-11T12:00Z')).equationOfTime).toBeCloseTo(-14.2, 0);
  });
});

describe('subsolarPoint', () => {
  it('is over Greenwich at noon, give or take the equation of time', () => {
    const noon = utc('2024-04-15T12:00Z'); // when the equation of time is near zero
    expect(Math.abs(subsolarPoint(noon).lon)).toBeLessThan(0.5);
    // A quarter of a day later it is a quarter of the way round to the west.
    expect(subsolarPoint(utc('2024-04-15T18:00Z')).lon).toBeCloseTo(-90, 0);
    expect(subsolarPoint(utc('2024-04-15T00:00Z')).lon).toBeCloseTo(-180, 0);
  });

  it('keeps longitudes in [-180, 180)', () => {
    for (let h = 0; h < 48; h += 0.5) {
      const { lon } = subsolarPoint(utc('2024-01-01T00:00Z') + h * 3600e3);
      expect(lon).toBeGreaterThanOrEqual(-180);
      expect(lon).toBeLessThan(180);
    }
  });
});

describe('sunDirection', () => {
  it('is the subsolar point in the globe\'s own frame', () => {
    const ms = utc('2026-10-08T17:00Z');
    const { lat, lon } = subsolarPoint(ms);
    const v = latLonToVector3(lat, lon, 1);
    const s = sunDirection(ms);
    expect(s[0]).toBeCloseTo(v.x, 10);
    expect(s[1]).toBeCloseTo(v.y, 10);
    expect(s[2]).toBeCloseTo(v.z, 10);
  });

  it('rises and sets on time: London at midsummer, Sydney at midwinter', () => {
    // London, 21 June 2024: sunrise 04:43 BST, sunset 21:21 BST.
    expect(sunUpAt(51.5074, -0.1278, utc('2024-06-21T03:43Z'))).toBeCloseTo(HORIZON, 2);
    expect(sunUpAt(51.5074, -0.1278, utc('2024-06-21T20:21Z'))).toBeCloseTo(HORIZON, 2);
    // Sydney, 21 June 2024: sunrise 07:00 AEST, sunset 16:54 AEST.
    expect(sunUpAt(-33.8688, 151.2093, utc('2024-06-20T21:00Z'))).toBeCloseTo(HORIZON, 2);
    expect(sunUpAt(-33.8688, 151.2093, utc('2024-06-21T06:54Z'))).toBeCloseTo(HORIZON, 2);
  });

  it('lights the north pole all day at midsummer and leaves the south pole dark', () => {
    for (let h = 0; h < 24; h += 3) {
      const ms = utc('2024-06-21T00:00Z') + h * 3600e3;
      expect(sunUpAt(90, 0, ms)).toBeGreaterThan(TWILIGHT);
      expect(sunUpAt(-90, 0, ms)).toBeLessThan(-TWILIGHT);
    }
  });
});

describe('frameTimeMs', () => {
  it('reads a forecast step\'s zoneless time as UTC', () => {
    expect(frameTimeMs('2026-10-07T12:00')).toBe(Date.UTC(2026, 9, 7, 12));
    expect(frameTimeMs('2026-10-07T12:00Z')).toBe(Date.UTC(2026, 9, 7, 12));
  });

  it('has nothing to say about nonsense', () => {
    expect(frameTimeMs('')).toBeNull();
    expect(frameTimeMs(null)).toBeNull();
    expect(frameTimeMs('next tuesday')).toBeNull();
  });
});

describe('nightShade', () => {
  it('leaves daylight alone and dims the night', () => {
    expect(nightShade(0.5)).toEqual([1, 1, 1]);
    expect(nightShade(-0.5)).toEqual(NIGHT_RGB);
    expect(nightShade(0).map((c, i) => c - (NIGHT_RGB[i] + 1) / 2).every((d) => Math.abs(d) < 1e-12)).toBe(true);
  });

  it('eases through twilight', () => {
    let last = 0;
    for (let s = -2 * TWILIGHT; s <= 2 * TWILIGHT; s += TWILIGHT / 10) {
      const g = nightShade(s)[1];
      expect(g).toBeGreaterThanOrEqual(last);
      last = g;
    }
  });

  it('dims the night side to a little over 40% as the eye judges it, toward blue', () => {
    const lum = 0.2126 * NIGHT_RGB[0] + 0.7152 * NIGHT_RGB[1] + 0.0722 * NIGHT_RGB[2];
    const seen = lum ** (1 / 2.2); // linear light to how bright it looks, near enough
    expect(seen).toBeGreaterThan(0.38);
    expect(seen).toBeLessThan(0.5);
    expect(NIGHT_RGB[2]).toBeGreaterThan(NIGHT_RGB[0]);
  });
});

describe('shadeNight', () => {
  const phong = () => ({ ...THREE.ShaderLib.phong, uniforms: THREE.UniformsUtils.clone(THREE.ShaderLib.phong.uniforms) });

  it('shades the finished light, after the lamps and their highlight', () => {
    const shader = phong();
    const uniforms = { uSunDir: { value: new THREE.Vector3(0, 0, 1) } };
    expect(shadeNight(shader, uniforms)).toBe(true);
    expect(shader.uniforms.uSunDir).toBe(uniforms.uSunDir);
    const frag = shader.fragmentShader;
    const at = frag.indexOf('outgoingLight *= mix(');
    expect(at).toBeGreaterThan(frag.indexOf('vec3 outgoingLight ='));
    expect(at).toBeLessThan(frag.indexOf('#include <opaque_fragment>'));
    expect(shader.vertexShader).toContain('vNightPos = position;');
  });

  it('follows nightShade', () => {
    const shader = phong();
    shadeNight(shader, { uSunDir: { value: null } });
    expect(shader.fragmentShader).toContain('smoothstep( -' + TWILIGHT + ', ' + TWILIGHT + ', sunUp )');
    expect(shader.fragmentShader).toContain('vec3( ' + NIGHT_RGB.join(', ') + ' )');
  });

  it('leaves a shader it does not recognise alone', () => {
    const shader = { vertexShader: 'void main() {}', fragmentShader: 'void main() {}', uniforms: {} };
    expect(shadeNight(shader, { uSunDir: { value: null } })).toBe(false);
    expect(shader.fragmentShader).toBe('void main() {}');
  });
});
