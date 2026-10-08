import { describe, it, expect } from 'vitest';
import {
  surfaceFacing, markerFade, markerShown, markerSizeFactor, MARKER_FADE_START, MARKER_FADE_END,
  MARKER_FADED_SIZE, MARKER_VERTEX, MARKER_FRAGMENT,
} from './markerdots.js';

// A point on the unit globe, `deg` degrees round from the point straight under a camera on +Z.
const at = (deg) => [Math.sin((deg * Math.PI) / 180), 0, Math.cos((deg * Math.PI) / 180)];

describe('surfaceFacing', () => {
  it('is 1 straight under the camera and 0 on the horizon', () => {
    expect(surfaceFacing(0, 0, 1, 0, 0, 3)).toBeCloseTo(1, 10);
    // From three radii out the horizon is where the line to the camera grazes the globe:
    // acos(1/3) round from the middle.
    const horizon = (Math.acos(1 / 3) * 180) / Math.PI;
    expect(surfaceFacing(...at(horizon), 0, 0, 3)).toBeCloseTo(0, 10);
  });

  it('is negative round the back', () => {
    expect(surfaceFacing(...at(80), 0, 0, 3)).toBeLessThan(0);
    expect(surfaceFacing(0, 0, -1, 0, 0, 3)).toBeLessThan(0);
  });

  it('catches the spots the old label test let through, just behind the horizon', () => {
    // The old test compared the angle from the middle alone: anything within acos(0.28) = 73.7
    // degrees counted as facing, but from three radii out the horizon is at 70.5.
    const p = at(72);
    expect(p[2]).toBeGreaterThan(0.28); // what the old test saw
    expect(surfaceFacing(...p, 0, 0, 3)).toBeLessThan(0); // and it is out of sight
  });

  it('does not divide by nothing', () => {
    expect(surfaceFacing(0, 0, 0, 0, 0, 3)).toBe(0);
    expect(surfaceFacing(0, 0, 3, 0, 0, 3)).toBe(0);
  });
});

describe('markerFade', () => {
  it('is gone beyond the band and whole inside it', () => {
    expect(markerFade(MARKER_FADE_START - 0.01)).toBe(0);
    expect(markerFade(-1)).toBe(0);
    expect(markerFade(MARKER_FADE_END + 0.01)).toBe(1);
    expect(markerFade(1)).toBe(1);
  });

  it('is half way at the middle of the band, and smooth', () => {
    expect(markerFade((MARKER_FADE_START + MARKER_FADE_END) / 2)).toBeCloseTo(0.5, 10);
    let last = -1;
    for (let f = MARKER_FADE_START; f <= MARKER_FADE_END; f += 0.01) {
      expect(markerFade(f)).toBeGreaterThanOrEqual(last);
      last = markerFade(f);
    }
  });

  it('only touches a thin ring at the edge of the globe at the default zoom', () => {
    // Where the band falls on screen from three radii out, as a share of the globe's radius
    // there: the dots are whole until 90% of the way out.
    const screenRadius = (deg) => {
      const t = (deg * Math.PI) / 180;
      return Math.sin(t) / (3 - Math.cos(t));
    };
    const edge = screenRadius((Math.acos(1 / 3) * 180) / Math.PI);
    let whole = 0;
    for (let deg = 0; deg < 70.5; deg += 0.1) if (markerFade(surfaceFacing(...at(deg), 0, 0, 3)) === 1) whole = deg;
    expect(screenRadius(whole) / edge).toBeGreaterThan(0.9);
  });
});

describe('markerShown', () => {
  it('counts a dot once it is at least half faded in', () => {
    const mid = (MARKER_FADE_START + MARKER_FADE_END) / 2;
    expect(markerShown(mid + 0.001)).toBe(true);
    expect(markerShown(mid - 0.001)).toBe(false);
    expect(markerShown(1)).toBe(true);
    expect(markerShown(0)).toBe(false);
  });
});

describe('markerSizeFactor', () => {
  it('shrinks a dot as it fades, down to its faded size', () => {
    expect(markerSizeFactor(1)).toBe(1);
    expect(markerSizeFactor(0)).toBe(MARKER_FADED_SIZE);
    expect(markerSizeFactor((MARKER_FADE_START + MARKER_FADE_END) / 2)).toBeCloseTo((1 + MARKER_FADED_SIZE) / 2, 10);
  });
});

describe('the marker shaders', () => {
  it('fade and shrink on the same band as the code that places labels and takes taps', () => {
    expect(MARKER_VERTEX).toContain(`smoothstep( ${MARKER_FADE_START}, ${MARKER_FADE_END}, facing )`);
    expect(MARKER_VERTEX).toContain(`mix( ${MARKER_FADED_SIZE}, 1.0, fade )`);
  });

  it('convert the colour for output the way three\'s own flat material does', () => {
    expect(MARKER_FRAGMENT).toContain('#include <colorspace_fragment>');
  });
});
