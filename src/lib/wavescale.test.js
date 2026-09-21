import { describe, it, expect } from 'vitest';
import {
  waveColor, waveScaleTicks, waveScaleUnitLabel, waveScaleGradient, gridAgeLabel,
  waveLegendCaption, swellTravelBearing, WAVE_SCALE_MAX,
  waveColorBanded, waveScaleBandGradient, WAVE_BAND_EDGES,
} from './wavescale.js';

describe('waveColor', () => {
  it('gets darker and colder toward flat, brighter and warmer toward big', () => {
    const calm = waveColor(0.2);
    const big = waveColor(7);
    const sum = (c) => c[0] + c[1] + c[2];
    expect(sum(big)).toBeGreaterThan(sum(calm));
    expect(big[0]).toBeGreaterThan(calm[0]); // more red
    expect(calm[2]).toBeGreaterThan(calm[0]); // calm is blue-dominant
  });

  it('changes monotonically enough that neighbouring heights are distinguishable', () => {
    // A ramp with a flat stretch would render different swells as the same colour.
    let prev = waveColor(0);
    for (let m = 0.25; m <= WAVE_SCALE_MAX; m += 0.25) {
      const c = waveColor(m);
      expect(c).not.toEqual(prev);
      prev = c;
    }
  });

  it('interpolates between stops rather than banding', () => {
    // 1.25m sits strictly between two stops. 1.5m used to and no longer does -- it is a stop of
    // its own now, so asking it to lie between its neighbours tests the stop table, not the
    // interpolation this is about.
    const a = waveColor(1.0);
    const mid = waveColor(1.25);
    const b = waveColor(1.5);
    for (let i = 0; i < 3; i++) {
      const lo = Math.min(a[i], b[i]);
      const hi = Math.max(a[i], b[i]);
      expect(mid[i]).toBeGreaterThanOrEqual(lo);
      expect(mid[i]).toBeLessThanOrEqual(hi);
    }
    expect(mid).not.toEqual(a);
    expect(mid).not.toEqual(b);
  });

  it('clamps past the top of the ramp instead of running off it', () => {
    expect(waveColor(30)).toEqual(waveColor(WAVE_SCALE_MAX));
    expect(waveColor(WAVE_SCALE_MAX + 0.1)).toEqual(waveColor(WAVE_SCALE_MAX));
  });

  it('returns null for no-data, so land is never painted as calm sea', () => {
    // The single most important case: null must not become the 0m colour, or every continent
    // gets a coat of deep blue.
    for (const v of [null, undefined, NaN, -1, 'two']) expect(waveColor(v)).toBeNull();
    expect(waveColor(0)).not.toBeNull();
  });

  it('gives back a fresh array, so a caller cannot mutate the ramp', () => {
    const c = waveColor(0);
    c[0] = 999;
    expect(waveColor(0)[0]).not.toBe(999);
  });
});

describe('legend', () => {
  it('labels round numbers in whichever unit is on screen', () => {
    expect(waveScaleTicks('metric').map((t) => t.label)).toEqual(['0', '0.5', '1', '2', '3', '4', '6', '9']);
    expect(waveScaleTicks('imperial').map((t) => t.label)).toEqual(['0', '1', '2', '3', '5', '10', '20', '30']);
    expect(waveScaleUnitLabel('imperial')).toBe('ft');
    expect(waveScaleUnitLabel('metric')).toBe('m');
  });

  it('converts imperial ticks to the right position on the ramp', () => {
    const ten = waveScaleTicks('imperial').find((t) => t.label === '10');
    expect(ten.metres).toBeCloseTo(3.048, 2);
    // And it must land where that height is actually painted, not at ten-twelfths of the bar.
    expect(ten.pos).toBeCloseTo(0.605, 2);
  });

  it('keeps every tick inside the ramp it labels', () => {
    for (const units of ['metric', 'imperial']) {
      for (const t of waveScaleTicks(units)) {
        expect(t.metres).toBeGreaterThanOrEqual(0);
        expect(t.metres).toBeLessThanOrEqual(WAVE_SCALE_MAX);
      }
    }
  });

  it('builds a gradient from the same stops the globe is painted with', () => {
    const g = waveScaleGradient();
    expect(g.startsWith('linear-gradient(90deg,')).toBe(true);
    const c0 = waveColor(0);
    expect(g).toContain('rgb(' + c0[0] + ',' + c0[1] + ',' + c0[2] + ') 0.0%');
    expect(g).toContain('100.0%');
  });
});

describe('gridAgeLabel', () => {
  const now = Date.parse('2026-09-05T12:00:00Z');
  it('says how old the data is in the largest sensible unit', () => {
    expect(gridAgeLabel(now - 30 * 1000, now)).toBe('just now');
    expect(gridAgeLabel(now - 25 * 60000, now)).toBe('25 min ago');
    expect(gridAgeLabel(now - 5 * 3600000, now)).toBe('5h ago');
    expect(gridAgeLabel(now - 3 * 86400000, now)).toBe('3d ago');
  });
  it('never reports the future as a negative age', () => {
    expect(gridAgeLabel(now + 60000, now)).toBe('just now');
  });
  it('returns nothing rather than "NaN min ago" on junk', () => {
    for (const v of [null, undefined, 'yesterday', NaN]) expect(gridAgeLabel(v, now)).toBeNull();
  });
});

describe('waveLegendCaption', () => {
  const now = Date.parse('2026-09-06T12:00:00Z');
  const fresh = { generatedAt: now - 2 * 3600000 };

  it('names the units and how old the data is', () => {
    expect(waveLegendCaption(fresh, 'metric', now)).toBe('Open-ocean wave height (m) · 2h ago');
    expect(waveLegendCaption(fresh, 'imperial', now)).toBe('Open-ocean wave height (ft) · 2h ago');
  });

  it('says when the map on screen is the last one that worked', () => {
    expect(waveLegendCaption({ ...fresh, stale: true }, 'metric', now)).toContain('last good data');
  });

  it('says when the chart is cut to the wave grid rather than to the coastline', () => {
    // The case this exists for. The overlay still draws when the coastline cannot be fetched,
    // but with the grid's own 1,100km edge — which looks exactly like a build that predates
    // the coastline mask entirely. Without this line the two are indistinguishable on screen.
    expect(waveLegendCaption({ ...fresh, coarse: true }, 'metric', now))
      .toBe('Open-ocean wave height (m) · 2h ago · coarse edge — coastline unavailable');
  });

  it('says nothing extra when the map is the map it should be', () => {
    const caption = waveLegendCaption({ ...fresh, coarse: false, stale: false }, 'metric', now);
    expect(caption).not.toContain('coarse');
    expect(caption).not.toContain('last good');
  });

  it('still reads as a sentence when the age is unknown or the meta is missing', () => {
    expect(waveLegendCaption({}, 'metric', now)).toBe('Open-ocean wave height (m) · age unknown');
    expect(waveLegendCaption(null, 'metric', now)).toBe('Open-ocean wave height (m) · age unknown');
  });
});

describe('swellTravelBearing', () => {
  it('turns "coming from" into "heading toward", which is how an arrow reads', () => {
    // Every marine feed reports the bearing waves come *from*; an arrow on a map means travel.
    expect(swellTravelBearing(0)).toBe(180);
    expect(swellTravelBearing(270)).toBe(90);   // a westerly swell runs east
    expect(swellTravelBearing(225)).toBe(45);   // a south-westerly runs north-east
  });

  it('stays on the compass rather than running past it', () => {
    for (const d of [0, 90, 180, 270, 359.9, 360, 720, -90]) {
      const got = swellTravelBearing(d);
      expect(got, String(d)).toBeGreaterThanOrEqual(0);
      expect(got, String(d)).toBeLessThan(360);
    }
  });

  it('has nothing to say about a missing direction', () => {
    for (const d of [null, undefined, NaN, 'south']) expect(swellTravelBearing(d)).toBeNull();
  });
});

describe('waveLegendCaption with arrows', () => {
  const now = Date.parse('2026-09-06T12:00:00Z');
  const fresh = { generatedAt: now - 3600000 };

  it('says which way the arrows read, because "direction" is ambiguous for waves', () => {
    expect(waveLegendCaption({ ...fresh, arrows: true }, 'metric', now))
      .toContain('arrows show where the swell is heading');
  });

  it('says nothing about arrows when there are none to explain', () => {
    expect(waveLegendCaption(fresh, 'metric', now)).not.toContain('arrows');
  });

  it('says when the grid itself carries no directions, which looks the same on screen', () => {
    // Two causes, one appearance: a grid cached before directions were fetched, or one that has
    // them and produced none. The first ages out on its own; the second is a fault.
    expect(waveLegendCaption({ ...fresh, noDirections: true }, 'metric', now))
      .toContain('no wave directions in this grid yet');
  });

  it('does not say that when the arrows are there', () => {
    const caption = waveLegendCaption({ ...fresh, arrows: true, noDirections: false }, 'metric', now);
    expect(caption).toContain('heading');
    expect(caption).not.toContain('no wave directions');
  });
});

describe('waveLegendCaption while the week is animating', () => {
  const meta = { ok: true, generatedAt: Date.now(), arrows: true };
  it('says which hour is on screen instead of how old the build is', () => {
    // A map four days ahead must not be captioned "just now".
    const cap = waveLegendCaption({ ...meta, frameLabel: 'forecast for Sun 6am' }, 'imperial');
    expect(cap).toContain('forecast for Sun 6am');
    expect(cap).not.toContain('just now');
  });
  it('falls back to the build age when no frame is being shown', () => {
    expect(waveLegendCaption(meta, 'imperial')).toContain('just now');
  });
});

// The fault that made adjacent sea states hard to tell apart on the globe: the ramp folded back
// on itself in lightness. 3m green and 6m orange measured within 0.003 of each other, and an 8m
// red was darker than a 2m teal -- so above 2m the only thing separating one height from the
// next was hue, which is exactly what a translucent overlay over a blue globe destroys.
describe('the ramp reads as magnitude, not just as hue', () => {
  // The globe's ocean colour and the overlay's opacity, from Globe.jsx. What reaches the eye is
  // the blend of the two, and the blend is where a ramp's separation is won or lost.
  const OCEAN = [23, 90, 130];
  const OPACITY = 0.85;

  function srgbToLinear(u) {
    const v = u / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }

  // CIE Lab distance, which is the ordinary way to ask "can someone tell these apart".
  function onGlobeDistance(a, b) {
    const blend = (c) => c.map((v, i) => OPACITY * v + (1 - OPACITY) * OCEAN[i]);
    const lab = (c) => {
      const [R, G, B] = blend(c).map(srgbToLinear);
      let X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
      let Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
      let Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
      const g = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
      X = g(X); Y = g(Y); Z = g(Z);
      return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
    };
    const [l1, a1, b1] = lab(a), [l2, a2, b2] = lab(b);
    return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
  }

  // OKLCH lightness: the channel that survives compositing over the ocean underneath.
  function lightness([r, g, b]) {
    const f = (u) => { u /= 255; return u <= 0.04045 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4); };
    const R = f(r), G = f(g), B = f(b);
    const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
    const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
    const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
    return 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
  }

  // Up to 4.5m -- which is every sea anyone in this catalog paddles out into -- lightness alone
  // carries the magnitude, so the ramp keeps working when the overlay is blended over the ocean
  // and the hue is half washed out.
  it('never gets darker as the surf gets bigger, through the whole surfable range', () => {
    for (let m = 0; m < 4.5; m += 0.25) {
      const lo = lightness(waveColor(m));
      const hi = lightness(waveColor(m + 0.25));
      expect(hi, m + 'm -> ' + (m + 0.25) + 'm').toBeGreaterThan(lo);
    }
  });

  // The number that actually decides whether a reader can tell two sea states apart: the
  // distance between them *as painted*, which is the ramp composited over the ocean sphere at
  // the overlay's opacity -- not the raw colours, which nobody ever sees.
  it('keeps half-metre steps apart once the overlay is blended over the globe', () => {
    for (let m = 0.5; m < 4; m += 0.5) {
      // Well past the ~2 that counts as "just noticeably different": this has to survive being
      // read off a moving sphere at a glance.
      expect(onGlobeDistance(waveColor(m), waveColor(m + 0.5)), m + 'm -> ' + (m + 0.5) + 'm')
        .toBeGreaterThan(8);
    }
  });

  // Lightness used to turn over above 4.5m -- yellow lighter than orange lighter than red, 35
  // consecutive reversals -- and the old version of this test asserted that hue took the job
  // over and the separation held. It did hold, but ordering carried by hue alone is the weakest
  // arrangement available: hue is what translucent compositing, ambient light and
  // colour-blindness each attack first. The ramp now climbs in lightness from end to end, so
  // the guarantee can be the strong one instead of the consolation.
  it('climbs in lightness the whole way, with no reversal anywhere', () => {
    let prev = null;
    for (let m = 0; m <= WAVE_SCALE_MAX; m += 0.1) {
      const L = lightness(waveColor(m));
      if (prev !== null) {
        // OKLCH lightness runs 0-1, so this slack is 8-bit rounding noise. The reversals this
        // replaces ran to about -0.03 a step and -0.31 in total.
        expect(L, 'lightness fell at ' + m.toFixed(1) + 'm').toBeGreaterThan(prev - 0.002);
      }
      prev = L;
    }
  });

  it('still separates the big sea states, now by lightness rather than only by hue', () => {
    for (const [a, b] of [[4.5, 6], [6, 8], [8, 12]]) {
      expect(onGlobeDistance(waveColor(a), waveColor(b)), a + 'm -> ' + b + 'm')
        .toBeGreaterThan(8);
    }
  });
});

// The objective the ramp was rebuilt against, asserted as numbers so it cannot quietly drift
// back. "Uniformity" is the largest step across the common band divided by the smallest: the
// professional oceanographic palettes sit near 2.0, and the thing that makes a ramp readable is
// the same range spread evenly, not more range. The ramp this replaced measured 4.26, with its
// worst step at 5.5 -- below the 5-7 that counts as just-noticeable for a patch the size of a
// grid cell, which is why most of the ocean looked like one colour.
describe('the ramp spends its contrast where the ocean actually is', () => {
  const OCEAN = [23, 90, 130];
  const lin = (u) => { const v = u / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const blend = (c) => c.map((v, i) => Math.round(0.85 * v + 0.15 * OCEAN[i]));
  function lab(c) {
    const [R, G, B] = blend(c).map(lin);
    const g = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const X = g((R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047);
    const Y = g(R * 0.2126 + G * 0.7152 + B * 0.0722);
    const Z = g((R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883);
    return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
  }
  const dE = (a, b) => { const p = lab(a), q = lab(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };

  // 62.6% of the world's sea states are under 2.5m, so this is the band that decides whether
  // the map is worth looking at.
  function commonBandSteps() {
    const ds = [];
    for (let m = 0.25; m + 0.25 <= 3 + 1e-9; m += 0.25) ds.push(dE(waveColor(m), waveColor(m + 0.25)));
    return ds.sort((a, b) => a - b);
  }

  it('keeps every quarter-metre step in the common band above the small-patch threshold', () => {
    expect(commonBandSteps()[0]).toBeGreaterThan(7);
  });

  it('spreads the band evenly rather than spending it all in one jump', () => {
    const ds = commonBandSteps();
    expect(ds[ds.length - 1] / ds[0]).toBeLessThan(2.5);
  });

  // Found by measurement, and it disqualifies several otherwise-excellent published ramps
  // (viridis and haline both pass straight through this blue): if any colour on the ramp
  // matches the sphere it is drawn on, the overlay develops a band where it simply vanishes.
  it('never collides with the globe underneath it', () => {
    let closest = Infinity;
    for (let m = 0; m <= WAVE_SCALE_MAX; m += 0.05) closest = Math.min(closest, dE(waveColor(m), OCEAN));
    expect(closest).toBeGreaterThan(8);
  });
});

// Windy paints its globe in discrete bands rather than a blend -- their published type
// declarations carry a `qualitative` flag documented as "globe: use discrete palette (not
// blending between colors)" -- and the evidence agrees for the task this map is for. These
// assert the band structure rather than the specific colours, which the ramp tests above
// already cover.
describe('waveColorBanded', () => {
  const OCEAN = [23, 90, 130];
  const lin = (u) => { const v = u / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const blend = (c) => c.map((v, i) => Math.round(0.85 * v + 0.15 * OCEAN[i]));
  function lab(c) {
    const [R, G, B] = blend(c).map(lin);
    const g = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const X = g((R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047);
    const Y = g(R * 0.2126 + G * 0.7152 + B * 0.0722);
    const Z = g((R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883);
    return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
  }
  const dE = (a, b) => { const p = lab(a), q = lab(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };

  it('paints one flat colour across a band', () => {
    // Everything inside 0.4-0.8 is the same colour; that flatness is the whole point.
    expect(waveColorBanded(0.41)).toEqual(waveColorBanded(0.79));
    expect(waveColorBanded(0.5)).toEqual(waveColorBanded(0.79));
  });

  it('puts a height exactly on an edge in the band above it', () => {
    // Half-open bands. Without this, 0.4m reads as the top of the band below rather than the
    // bottom of its own, and every edge in the legend is off by one band.
    expect(waveColorBanded(0.4)).not.toEqual(waveColorBanded(0.39));
    expect(waveColorBanded(0.4)).toEqual(waveColorBanded(0.5));
  });

  it('separates neighbouring bands by far more than a viewer could miss', () => {
    const edges = WAVE_BAND_EDGES;
    for (let i = 1; i < edges.length - 1; i++) {
      const below = waveColorBanded((edges[i - 1] + edges[i]) / 2);
      const above = waveColorBanded((edges[i] + edges[i + 1]) / 2);
      // Small-patch just-noticeable is 5-7; a band edge should be unmissable.
      expect(dE(below, above), edges[i] + 'm edge').toBeGreaterThan(9);
    }
  });

  it('gives as many bands as the level budget allows, and no more', () => {
    // 8-12 is the range a ramp can separate comfortably. Asking for more is what makes a map
    // illegible, and the bands are the stops, so this guards the stop table too.
    const n = WAVE_BAND_EDGES.length - 1;
    expect(n).toBeGreaterThanOrEqual(8);
    expect(n).toBeLessThanOrEqual(12);
  });

  it('clamps past the top and says nothing about no data, exactly as the smooth ramp does', () => {
    expect(waveColorBanded(30)).toEqual(waveColorBanded(WAVE_SCALE_MAX));
    for (const v of [null, undefined, NaN, -1, 'two']) expect(waveColorBanded(v)).toBeNull();
  });

  it('builds a legend bar of hard-edged bands, each colour appearing twice', () => {
    const g = waveScaleBandGradient();
    expect(g.startsWith('linear-gradient(90deg,')).toBe(true);
    const first = waveColorBanded(0.1);
    const rgb = 'rgb(' + first[0] + ',' + first[1] + ',' + first[2] + ')';
    // Twice is what makes the edge hard rather than a blend into the next band.
    expect(g.split(rgb).length - 1).toBe(2);
  });
});
