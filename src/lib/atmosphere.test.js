import { describe, it, expect } from 'vitest';
import {
  atmosphereIntensity, srgbToLinear, starFade, ATMOSPHERE_FRAGMENT, ATMOSPHERE_OPACITY, ATMOSPHERE_RADIUS,
  ATMOSPHERE_EDGE_COS, STARS_FULL_DISTANCE, STARS_GONE_DISTANCE,
} from './atmosphere.js';

describe('atmosphereIntensity', () => {
  it('is at full strength against the globe\'s edge and nothing at the shell\'s', () => {
    expect(atmosphereIntensity(1)).toBeCloseTo(ATMOSPHERE_OPACITY, 10);
    expect(atmosphereIntensity(ATMOSPHERE_RADIUS)).toBe(0);
  });

  it('thins steadily outward', () => {
    let last = Infinity;
    for (let b = 1; b <= ATMOSPHERE_RADIUS; b += 0.005) {
      expect(atmosphereIntensity(b)).toBeLessThanOrEqual(last);
      last = atmosphereIntensity(b);
    }
    // Still clearly there half way out, which GlowMesh's own term was not anywhere.
    expect(atmosphereIntensity((1 + ATMOSPHERE_RADIUS) / 2)).toBeGreaterThan(0.2);
  });

  it('measures the edge from the right cosine', () => {
    // The grazing line passes one radius from the centre: asin(1 / R) to the shell's normal.
    expect(ATMOSPHERE_EDGE_COS).toBeCloseTo(Math.cos(Math.asin(1 / ATMOSPHERE_RADIUS)), 12);
    expect(ATMOSPHERE_FRAGMENT).toContain('cosine / ' + ATMOSPHERE_EDGE_COS);
  });
});

describe('srgbToLinear', () => {
  it('decodes sRGB bytes exactly as three does', () => {
    expect(srgbToLinear(0)).toBe(0);
    expect(srgbToLinear(255)).toBeCloseTo(1, 12);
    expect(srgbToLinear(10)).toBeCloseTo(10 / 255 / 12.92, 12);
    expect(srgbToLinear(128)).toBeCloseTo(0.21586, 4);
  });
});

describe('the atmosphere shader', () => {
  it('goes through the output colour conversion, so its colour is the one named', () => {
    expect(ATMOSPHERE_FRAGMENT).toContain('#include <colorspace_fragment>');
  });
});

describe('starFade', () => {
  it('shows the stars from orbit and hides them near the surface', () => {
    expect(starFade(6)).toBe(1);
    expect(starFade(STARS_FULL_DISTANCE)).toBe(1);
    expect(starFade(STARS_GONE_DISTANCE)).toBe(0);
    expect(starFade(1.015)).toBe(0);
  });

  it('fades smoothly between', () => {
    let last = 0;
    for (let d = STARS_GONE_DISTANCE; d <= STARS_FULL_DISTANCE; d += 0.05) {
      expect(starFade(d)).toBeGreaterThanOrEqual(last);
      last = starFade(d);
    }
    expect(starFade((STARS_GONE_DISTANCE + STARS_FULL_DISTANCE) / 2)).toBeCloseTo(0.5, 10);
  });
});
