import { describe, it, expect } from 'vitest';
import { distanceKm, bearingDeg, isEastward, stepDirection } from './spotnav.js';
import { CATALOG } from './spots.catalog.js';
import { ORDER } from './spots.js';

const SPOTS = {
  trestles: { name: 'Lower Trestles', lat: 33.3825, lon: -117.5972 },
  sanonofre: { name: 'San Onofre', lat: 33.3717, lon: -117.5656 },   // just east, ~3km
  huntington: { name: 'Huntington Beach', lat: 33.6553, lon: -118.0025 }, // northwest, ~48km
  blacks: { name: 'Blacks Beach', lat: 32.8891, lon: -117.2528 },    // southeast, ~63km
  nazare: { name: 'Nazaré', lat: 39.6033, lon: -9.0705 },            // far east, ~9,000km
};
const IDS = Object.keys(SPOTS);

describe('bearingDeg', () => {
  it('reads the four cardinal directions', () => {
    expect(bearingDeg(0, 0, 1, 0)).toBeCloseTo(0, 3);    // north
    expect(bearingDeg(0, 0, 0, 1)).toBeCloseTo(90, 3);   // east
    expect(bearingDeg(0, 0, -1, 0)).toBeCloseTo(180, 3); // south
    expect(bearingDeg(0, 0, 0, -1)).toBeCloseTo(270, 3); // west
  });

  it('crosses the antimeridian the short way', () => {
    // 179E to 179W is a short hop east, not most of a lap westward. Subtracting longitudes
    // would call this 358 degrees -- almost due west.
    expect(bearingDeg(0, 179, 0, -179)).toBeCloseTo(90, 1);
    expect(bearingDeg(0, -179, 0, 179)).toBeCloseTo(270, 1);
  });
});

describe('isEastward', () => {
  it('splits the compass at the north-south line', () => {
    expect(isEastward(0)).toBe(true);    // due north goes right
    expect(isEastward(90)).toBe(true);   // due east
    expect(isEastward(179)).toBe(true);
    expect(isEastward(180)).toBe(false); // due south goes left
    expect(isEastward(270)).toBe(false); // due west
    expect(isEastward(359)).toBe(false);
  });

  it('gives a north-south coast two working arrows', () => {
    // Israel's coast runs almost due north-south: nothing is meaningfully east or west of
    // anything, so an east/west test on longitude alone would leave both arrows dead.
    const north = bearingDeg(32.16, 34.79, 32.83, 34.97); // Herzliya -> Atlit, up the coast
    const south = bearingDeg(32.83, 34.97, 32.16, 34.79);
    expect(isEastward(north)).toBe(true);
    expect(isEastward(south)).toBe(false);
  });
});

describe('stepDirection', () => {
  it('goes to the nearest spot on the eastern side', () => {
    expect(stepDirection(SPOTS, IDS, 'trestles', 1)).toBe('sanonofre'); // 3km, just east
  });

  it('goes to the nearest spot on the western side', () => {
    expect(stepDirection(SPOTS, IDS, 'trestles', -1)).toBe('huntington'); // northwest, 48km
  });

  it('is its own inverse along a coast', () => {
    // The whole reason for using direction: east then west comes back, with no stored state.
    const east = stepDirection(SPOTS, IDS, 'trestles', 1);
    expect(stepDirection(SPOTS, IDS, east, -1)).toBe('trestles');
  });

  it('never sends you to the other side of the planet for one press', () => {
    // Nazaré is in the list and is 9,000km east; San Onofre is 3km east and wins.
    expect(stepDirection(SPOTS, IDS, 'trestles', 1)).not.toBe('nazare');
  });

  it('returns null when that side is empty rather than wrapping round', () => {
    const only = { a: { lat: 0, lon: 0 }, b: { lat: 0, lon: 10 } };
    expect(stepDirection(only, ['a', 'b'], 'a', 1)).toBe('b');  // east
    expect(stepDirection(only, ['a', 'b'], 'a', -1)).toBeNull(); // nothing west
  });

  it('skips spots with no usable position instead of throwing', () => {
    const spots = { ...SPOTS, ghost: { name: 'Ghost' } };
    expect(stepDirection(spots, [...IDS, 'ghost'], 'trestles', 1)).toBe('sanonofre');
  });

  it('has nowhere to go from a spot with no position of its own', () => {
    expect(stepDirection({ ...SPOTS, ghost: {} }, [...IDS, 'ghost'], 'ghost', 1)).toBeNull();
  });

  it('ignores a spot sitting exactly where you are', () => {
    const spots = { ...SPOTS, twin: { lat: 33.3825, lon: -117.5972 } };
    expect(stepDirection(spots, [...IDS, 'twin'], 'trestles', 1)).toBe('sanonofre');
  });

  it('walks the real Californian coast in both directions', () => {
    const east = stepDirection(CATALOG, ORDER, 'trestles', 1);
    const west = stepDirection(CATALOG, ORDER, 'trestles', -1);
    const a = CATALOG.trestles;
    expect(distanceKm(a.lat, a.lon, CATALOG[east].lat, CATALOG[east].lon)).toBeLessThan(100);
    expect(distanceKm(a.lat, a.lon, CATALOG[west].lat, CATALOG[west].lon)).toBeLessThan(100);
    expect(isEastward(bearingDeg(a.lat, a.lon, CATALOG[east].lat, CATALOG[east].lon))).toBe(true);
    expect(isEastward(bearingDeg(a.lat, a.lon, CATALOG[west].lat, CATALOG[west].lon))).toBe(false);
  });

  it('keeps moving rather than bouncing between two spots', () => {
    // Five presses east from Lower Trestles must reach five different places.
    let at = 'trestles';
    const seen = new Set([at]);
    for (let i = 0; i < 5; i++) { at = stepDirection(CATALOG, ORDER, at, 1); seen.add(at); }
    expect(seen.size).toBe(6);
  });

  it('both arrows work from every spot in the catalog', () => {
    // A dead arrow is what the last two attempts shipped; this asserts neither is ever dead.
    const dead = ORDER.filter((id) => !stepDirection(CATALOG, ORDER, id, 1) || !stepDirection(CATALOG, ORDER, id, -1));
    expect(dead, 'spots with a dead arrow').toEqual([]);
  });
});
