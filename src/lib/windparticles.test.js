import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  windVelocity, velocityComponents, regularizeVelocity, degreesPerSecondPerKph, viewCapRadius,
  particleCount, stateTexel, toGlobe, toLatLon, pointInCap, advect, stepParticle, particlePxPerKph,
  PARTICLE_PX_PER_KPH, PARTICLE_REF_DISTANCE, PARTICLE_AREA_PX, PARTICLE_STATE_SIZE, MAX_PARTICLES, PARTICLE_LIFE_MIN,
  PARTICLE_LIFE_MAX, PARTICLE_FADE_IN, PARTICLE_FADE_OUT,
  PARTICLE_UPDATE_FRAGMENT, PARTICLE_DRAW_VERTEX, PARTICLE_DRAW_FRAGMENT,
} from './windparticles.js';
import { fieldLayout, layoutV } from './overlaygpu.js';
import { makeGridSampler, gridCells } from './wavegrid.js';
import { latLonToVector3, vector3ToLatLon } from './geo3d.js';
import { visibleAngularRadius } from './swellarrows.js';

const HALF_FOV = (22.5 * Math.PI) / 180; // the globe camera's 45 degrees, halved

// A seeded random number generator, so a failing run can be run again.
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The GPU's bilinear read of a layout's texture, as in lib/overlaygpu.test.js.
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

// A wind with some shape to it: a cyclone over the South Atlantic on a westerly background, and
// holes where land would be.
function cyclone(step) {
  const speeds = [];
  const dirs = [];
  gridCells(step).forEach((c, i) => {
    if (i % 23 === 0) { speeds.push(null); dirs.push(null); return; }
    const dLon = ((c.lon + 20 + 540) % 360) - 180;
    const dLat = c.lat + 40;
    const r = Math.hypot(dLon, dLat);
    // Clockwise round a southern low: the travel bearing is the bearing from the centre plus 90.
    const travel = (Math.atan2(dLon, dLat) * 180) / Math.PI - 90;
    const fromDeg = (travel + 180 + 720) % 360;
    speeds.push(r < 25 ? 15 + r : 12);
    dirs.push(r < 25 ? fromDeg : 270);
  });
  return { speeds, dirs };
}

describe('windVelocity', () => {
  it('blows away from where the wind comes from', () => {
    const westerly = windVelocity(20, 270);
    expect(westerly[0]).toBeCloseTo(20, 10); // east
    expect(westerly[1]).toBeCloseTo(0, 10);
    const northerly = windVelocity(20, 0);
    expect(northerly[0]).toBeCloseTo(0, 10);
    expect(northerly[1]).toBeCloseTo(-20, 10); // south
    const fromSouthWest = windVelocity(10, 225);
    expect(fromSouthWest[0]).toBeCloseTo(10 / Math.SQRT2, 10);
    expect(fromSouthWest[1]).toBeCloseTo(10 / Math.SQRT2, 10);
  });

  it('has nothing without a speed and a direction both', () => {
    expect(windVelocity(null, 90)).toBeNull();
    expect(windVelocity(12, null)).toBeNull();
    expect(windVelocity(NaN, 90)).toBeNull();
  });
});

describe('velocityComponents', () => {
  it('splits every cell, leaving a gap wherever either reading is missing', () => {
    const { east, north } = velocityComponents([10, null, 5, 8], [90, 90, null, 180]);
    expect(east[0]).toBeCloseTo(-10, 10); // from the east, so going west
    expect(north[0]).toBeCloseTo(0, 10);
    expect(east.slice(1, 3)).toEqual([null, null]);
    expect(north.slice(1, 3)).toEqual([null, null]);
    expect(north[3]).toBeCloseTo(8, 10); // from the south, so going north
  });
});

describe('regularizeVelocity', () => {
  const step = 2;
  const layout = fieldLayout(step);
  const { speeds, dirs } = cyclone(step);
  const { east, north } = velocityComponents(speeds, dirs);
  const data = regularizeVelocity(east, north, layout);
  const sampler = makeGridSampler(step);

  it('holds, on each grid row, the sums whose mean is the CPU sampler\'s', () => {
    const rows = layout.height - 2;
    for (let r = 0; r < rows; r += 7) {
      for (let x = 0; x < layout.width; x += 37) {
        const o = ((r + 1) * layout.width + x) * 4;
        const lat = layout.lat0 + (r + 1) * step;
        const lon = -180 + ((x + 0.5) / layout.width) * 360;
        const e = sampler.height(east, lat, lon);
        const n = sampler.height(north, lat, lon);
        if (e == null) { expect(data[o + 2]).toBe(0); continue; }
        // To single precision, which is what the array holds.
        expect(data[o] / data[o + 2]).toBeCloseTo(e, 4);
        expect(data[o + 1] / data[o + 2]).toBeCloseTo(n, 4);
      }
    }
  });

  it('reads back through a bilinear filter as the wind the CPU sampler gives', () => {
    const rnd = seeded(7);
    let worst = 0;
    for (let k = 0; k < 2000; k++) {
      const lat = -74 + rnd() * 148;
      const lon = -180 + rnd() * 360;
      const [x, y, w] = gpuRead(data, 4, layout, lat, lon);
      const e = sampler.height(east, lat, lon);
      const n = sampler.height(north, lat, lon);
      if (e == null || !(w > 0.5)) continue;
      worst = Math.max(worst, Math.hypot(x / w - e, y / w - n));
    }
    // Interpolating between rows of sums rather than of means differs a little beside a gap;
    // within half a km/h is well under anything a streak can show.
    expect(worst).toBeLessThan(0.5);
  });

  it('averages opposing winds to a calm, not to either of them', () => {
    const tiny = fieldLayout(20);
    const cells = gridCells(20);
    const sp = cells.map(() => 20);
    // Alternate cells blow east and west.
    const dr = cells.map((c, i) => (i % 2 ? 90 : 270));
    const v = velocityComponents(sp, dr);
    const out = regularizeVelocity(v.east, v.north, tiny);
    const o = (2 * tiny.width + Math.round(tiny.width / 2)) * 4;
    expect(Math.abs(out[o] / out[o + 2])).toBeLessThan(20);
  });

  it('leaves the rows beyond the grid empty, and reuses the array it is given', () => {
    const again = regularizeVelocity(east, north, layout, new Float32Array(data.length).fill(0));
    expect(Array.from(again)).toEqual(Array.from(data));
    for (let x = 0; x < layout.width; x++) {
      expect(data[x * 4 + 2]).toBe(0);
      expect(data[((layout.height - 1) * layout.width + x) * 4 + 2]).toBe(0);
    }
  });
});

describe('degreesPerSecondPerKph', () => {
  it('moves a particle under the camera the same number of pixels a second at any zoom', () => {
    const height = 700;
    for (const distance of [1.015, 1.2, 1.8, 3, 6]) {
      const camera = new THREE.PerspectiveCamera(45, 0.6, 0.001, 20);
      camera.position.set(0, 0, distance);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();
      // Ten km/h for a tenth of a second, northward from the point under the camera, which is
      // latitude 0, longitude -90 in the globe's frame (latLonToVector3 puts it on +Z).
      const deg = degreesPerSecondPerKph(distance, HALF_FOV, height) * 10 * 0.1;
      const a = latLonToVector3(0, -90, 1).project(camera);
      const b = latLonToVector3(deg, -90, 1).project(camera);
      const px = Math.hypot(b.x - a.x, b.y - a.y) * (height / 2);
      expect(px).toBeCloseTo(PARTICLE_PX_PER_KPH * 10 * 0.1, 2);
    }
  });

  it('has nothing to say from inside the globe', () => {
    expect(degreesPerSecondPerKph(1, HALF_FOV, 700)).toBe(0);
    expect(degreesPerSecondPerKph(3, HALF_FOV, 0)).toBe(0);
  });
});

describe('particlePxPerKph', () => {
  it('holds steady zoomed in, and shrinks with the globe zoomed out', () => {
    expect(particlePxPerKph(1.02)).toBe(PARTICLE_PX_PER_KPH);
    expect(particlePxPerKph(PARTICLE_REF_DISTANCE)).toBe(PARTICLE_PX_PER_KPH);
    // From six radii out the globe looks a bit under half as wide as from three.
    const ratio = Math.tan(Math.asin(1 / 6)) / Math.tan(Math.asin(1 / 3));
    expect(particlePxPerKph(6)).toBeCloseTo(PARTICLE_PX_PER_KPH * ratio, 10);
  });
});

describe('viewCapRadius', () => {
  // The angle from the middle of the view to where a ray through the screen's corner meets the
  // globe, worked out the slow way.
  function cornerAngle(distance, aspect) {
    const camera = new THREE.PerspectiveCamera(45, aspect, 0.001, 20);
    camera.position.set(0, 0, distance);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(1, 1), camera);
    const hit = ray.ray.intersectSphere(new THREE.Sphere(new THREE.Vector3(), 1), new THREE.Vector3());
    return hit ? Math.acos(Math.min(1, hit.z)) : null;
  }

  it('reaches the corners of the screen, not just its edges', () => {
    for (const [distance, aspect] of [[1.015, 0.5], [1.05, 1], [1.2, 1.8], [1.4, 0.46]]) {
      const corner = cornerAngle(distance, aspect);
      expect(corner).not.toBeNull();
      expect(viewCapRadius(distance, HALF_FOV, aspect)).toBeCloseTo(corner, 6);
      // More than the vertical extent alone: that would leave the corners bare.
      expect(viewCapRadius(distance, HALF_FOV, aspect)).toBeGreaterThan(visibleAngularRadius(distance, HALF_FOV));
    }
  });

  it('is the horizon once the whole globe is in view', () => {
    expect(viewCapRadius(3, HALF_FOV, 0.5)).toBeCloseTo(Math.acos(1 / 3), 10);
    expect(viewCapRadius(6, HALF_FOV, 2)).toBeCloseTo(Math.acos(1 / 6), 10);
  });
});

describe('particleCount', () => {
  it('fills the globe on screen at one particle for each patch of pixels', () => {
    // From six radii out the globe is a disc well inside the screen.
    const focal = 380 / Math.tan(HALF_FOV);
    const disc = Math.tan(Math.asin(1 / 6)) * focal;
    expect(particleCount(6, HALF_FOV, 390, 760)).toBe(Math.round((Math.PI * disc * disc) / PARTICLE_AREA_PX));
  });

  it('stops at the screen, once the globe is bigger than it', () => {
    expect(particleCount(1.1, HALF_FOV, 390, 760)).toBe(Math.round((390 * 760) / PARTICLE_AREA_PX));
  });

  it('never asks for more particles than there are', () => {
    expect(particleCount(1.02, HALF_FOV, 2560, 1440)).toBe(MAX_PARTICLES);
  });

  it('grows with the globe as you zoom in', () => {
    expect(particleCount(3, HALF_FOV, 390, 760)).toBeGreaterThan(particleCount(5, HALF_FOV, 390, 760));
  });
});

describe('stateTexel', () => {
  it('finds each particle\'s texel, row by row', () => {
    expect(stateTexel(0)).toEqual([0.5 / PARTICLE_STATE_SIZE, 0.5 / PARTICLE_STATE_SIZE]);
    expect(stateTexel(PARTICLE_STATE_SIZE)).toEqual([0.5 / PARTICLE_STATE_SIZE, 1.5 / PARTICLE_STATE_SIZE]);
    expect(stateTexel(MAX_PARTICLES - 1)).toEqual([1 - 0.5 / PARTICLE_STATE_SIZE, 1 - 0.5 / PARTICLE_STATE_SIZE]);
  });
});

describe('toGlobe and toLatLon', () => {
  it('agree with the globe\'s own conversions', () => {
    const rnd = seeded(3);
    for (let k = 0; k < 500; k++) {
      const lat = -89 + rnd() * 178;
      const lon = -180 + rnd() * 359.99;
      const p = toGlobe(lat, lon);
      const v = latLonToVector3(lat, lon, 1);
      expect(p[0]).toBeCloseTo(v.x, 12);
      expect(p[1]).toBeCloseTo(v.y, 12);
      expect(p[2]).toBeCloseTo(v.z, 12);
      const back = toLatLon(p);
      const ref = vector3ToLatLon(v);
      expect(back.lat).toBeCloseTo(ref.lat, 9);
      expect(back.lon).toBeCloseTo(ref.lon, 9);
      expect(back.lon).toBeGreaterThanOrEqual(-180);
      expect(back.lon).toBeLessThan(180);
    }
  });
});

describe('pointInCap', () => {
  const center = toGlobe(-30, 140);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  it('stays inside the cap, and spreads evenly over its area', () => {
    const rnd = seeded(11);
    const cosOuter = Math.cos((40 * Math.PI) / 180);
    // The cap that holds half of the outer one's area.
    const cosHalf = (1 + cosOuter) / 2;
    let inner = 0;
    const n = 20000;
    for (let k = 0; k < n; k++) {
      const p = pointInCap(center, 1, cosOuter, rnd(), rnd());
      const d = dot(toGlobe(p.lat, p.lon), center);
      expect(d).toBeGreaterThanOrEqual(cosOuter - 1e-9);
      if (d >= cosHalf) inner++;
    }
    expect(inner / n).toBeCloseTo(0.5, 1);
  });

  it('keeps to a ring when asked for one', () => {
    const rnd = seeded(12);
    const cosInner = Math.cos((20 * Math.PI) / 180);
    const cosOuter = Math.cos((40 * Math.PI) / 180);
    for (let k = 0; k < 2000; k++) {
      const p = pointInCap(center, cosInner, cosOuter, rnd(), rnd());
      const d = dot(toGlobe(p.lat, p.lon), center);
      expect(d).toBeLessThanOrEqual(cosInner + 1e-9);
      expect(d).toBeGreaterThanOrEqual(cosOuter - 1e-9);
    }
  });

  it('works round the poles too', () => {
    const rnd = seeded(13);
    for (const c of [[0, 1, 0], [0, -1, 0]]) {
      for (let k = 0; k < 200; k++) {
        const p = pointInCap(c, 1, Math.cos(0.3), rnd(), rnd());
        expect(dot(toGlobe(p.lat, p.lon), c)).toBeGreaterThanOrEqual(Math.cos(0.3) - 1e-9);
      }
    }
  });
});

describe('advect', () => {
  it('goes the way the wind goes', () => {
    const north = advect(10, 20, [0, 10], 0.5, 1);
    expect(north.lat).toBeCloseTo(15, 10);
    expect(north.lon).toBeCloseTo(20, 10);
    const west = advect(0, 20, [-10, 0], 0.5, 1);
    expect(west.lon).toBeCloseTo(15, 10);
  });

  it('covers the same distance at any latitude, so more degrees of longitude toward the poles', () => {
    const equator = advect(0, 0, [10, 0], 0.5, 1);
    const sixty = advect(60, 0, [10, 0], 0.5, 1);
    expect(sixty.lon).toBeCloseTo(equator.lon * 2, 9);
  });

  it('crosses the antimeridian without a jump', () => {
    const next = advect(0, 179, [10, 0], 0.5, 1);
    expect(next.lon).toBeCloseTo(-176, 9);
    const back = advect(0, -179, [-10, 0], 0.5, 1);
    expect(back.lon).toBeCloseTo(176, 9);
  });
});

describe('stepParticle', () => {
  const center = toGlobe(0, -90); // the camera looking straight at 0, -90
  const capDeg = 40;
  const viewCos = Math.cos((capDeg * Math.PI) / 180);
  const still = () => [0, 0, 1];

  function field(n, env, steps) {
    let ps = Array.from({ length: n }, () => ({ lat: 0, lon: 0, age: 0, life: 0 }));
    for (let k = 0; k < steps; k++) ps = ps.map((p) => stepParticle(p, env));
    return ps;
  }

  it('starts every particle somewhere in view, at a different point of its life', () => {
    const env = { center, viewCos, growthCos: viewCos, growth: 0, scale: 0.5, dt: 1 / 60, random: seeded(1), wind: still, atSea: () => true };
    const ps = field(2000, env, 1);
    const dot = (p) => { const v = toGlobe(p.lat, p.lon); return v[0] * center[0] + v[1] * center[1] + v[2] * center[2]; };
    for (const p of ps) {
      expect(dot(p)).toBeGreaterThanOrEqual(viewCos - 1e-9);
      expect(p.life).toBeGreaterThanOrEqual(PARTICLE_LIFE_MIN);
      expect(p.life).toBeLessThanOrEqual(PARTICLE_LIFE_MAX);
    }
    // Ages spread over their lives, so they do not all die together.
    const share = ps.map((p) => p.age / p.life);
    const early = share.filter((s) => s < 0.5).length / ps.length;
    expect(early).toBeGreaterThan(0.4);
    expect(early).toBeLessThan(0.6);
  });

  it('keeps the same density over the sea however much of the view is land', () => {
    // Land wherever the point is east of longitude -90: half the view.
    const half = { center, viewCos, growthCos: viewCos, growth: 0, scale: 0.5, dt: 1 / 20, random: seeded(2), wind: still, atSea: (lat, lon) => lon < -90 };
    const ps = field(4000, half, 200); // ten seconds: a few lifetimes
    const living = ps.filter((p) => p.life > 0);
    for (const p of living) expect(p.lon).toBeLessThan(-90);
    // About half of them: the sea's share of the view. Not all of them packed into half of it.
    expect(living.length / ps.length).toBeGreaterThan(0.42);
    expect(living.length / ps.length).toBeLessThan(0.58);
  });

  it('is reborn in view once the view moves off it', () => {
    const env = { center, viewCos, growthCos: viewCos, growth: 0, scale: 0.5, dt: 1 / 60, random: seeded(4), wind: still, atSea: () => true };
    const p = stepParticle({ lat: 0, lon: 90, age: 0.5, life: 3 }, env); // the far side of the globe
    const v = toGlobe(p.lat, p.lon);
    expect(v[0] * center[0] + v[1] * center[1] + v[2] * center[2]).toBeGreaterThanOrEqual(viewCos - 1e-9);
    expect(p.age).toBe(0);
  });

  it('drifts with the wind, and waits unseen once blown ashore', () => {
    const env = { center, viewCos, growthCos: viewCos, growth: 0, scale: 0.5, dt: 0.1, random: seeded(5), wind: () => [20, 0, 2], atSea: (lat, lon) => lon < -80 };
    let p = { lat: 0, lon: -81, age: 0.5, life: 3 };
    p = stepParticle(p, env); // 10 km/h east for a tenth of a second: half a degree
    expect(p.lon).toBeCloseTo(-80.5, 9);
    expect(p.life).toBe(3);
    p = stepParticle(p, env);
    p = stepParticle(p, env); // now ashore: it stops, and stops being drawn
    expect(p.life).toBe(-3);
    const where = p.lon;
    p = stepParticle(p, env);
    expect(p.lon).toBe(where);
    expect(p.life).toBe(-3);
  });

  it('fills the new edge of the view at once when it grows, rather than over a lifetime', () => {
    const small = Math.cos((20 * Math.PI) / 180);
    const random = seeded(6);
    const env = { center, viewCos: small, growthCos: small, growth: 0, scale: 0.5, dt: 1 / 20, random, wind: still, atSea: () => true };
    let ps = field(6000, env, 80);
    // One frame of zooming out: the view's area grows from the small cap to the large one.
    const share = 1 - (1 - small) / (1 - viewCos);
    const grow = { ...env, viewCos, growthCos: small, growth: share };
    ps = ps.map((p) => stepParticle(p, grow));
    const dot = (p) => { const v = toGlobe(p.lat, p.lon); return v[0] * center[0] + v[1] * center[1] + v[2] * center[2]; };
    const inner = ps.filter((p) => dot(p) >= small).length;
    // As many to each part of the view as its share of the area.
    expect(inner / ps.length).toBeCloseTo((1 - small) / (1 - viewCos), 1);
  });
});

describe('the particle shaders', () => {
  it('give particles the lives the reference does', () => {
    expect(PARTICLE_UPDATE_FRAGMENT).toContain('mix( ' + PARTICLE_LIFE_MIN + ', ' + PARTICLE_LIFE_MAX + ',');
  });

  it('fade a streak in and out over the times the reference gives', () => {
    expect(PARTICLE_DRAW_VERTEX).toContain('smoothstep( 0.0, ' + PARTICLE_FADE_IN + ', age )');
    expect(PARTICLE_DRAW_VERTEX).toContain('life - ' + PARTICLE_FADE_OUT);
  });

  it('write the streaks\' colour untouched by colour management, like the arrows', () => {
    expect(PARTICLE_DRAW_FRAGMENT).not.toContain('colorspace');
    expect(PARTICLE_DRAW_FRAGMENT).not.toContain('tonemapping');
  });

  it('do not name a variable after a built-in they also call', () => {
    // GLSL lets a local shadow a built-in function, after which calling it fails to compile --
    // and a shader that fails to compile draws nothing and says so only in the console.
    for (const src of [PARTICLE_UPDATE_FRAGMENT, PARTICLE_DRAW_VERTEX]) {
      for (const fn of ['length', 'normalize', 'dot', 'cross', 'mix', 'random']) {
        if (new RegExp('\\b' + fn + '\\s*\\(').test(src)) expect(src).not.toMatch(new RegExp('\\b(float|vec[234]|uint|int)\\s+' + fn + '\\b(?!\\s*\\()'));
      }
    }
  });
});
