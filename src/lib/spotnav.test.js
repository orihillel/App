import { describe, it, expect } from 'vitest';
import { distanceKm, nearestFirst, stepNearest, stepIn } from './spotnav.js';
import { CATALOG } from './spots.catalog.js';
import { ORDER } from './spots.js';

const SPOTS = {
  trestles: { name: 'Lower Trestles', lat: 33.3825, lon: -117.5972 },
  blacks: { name: 'Blacks Beach', lat: 32.8891, lon: -117.2528 },   // ~65km from Trestles
  malibu: { name: 'Malibu', lat: 34.0367, lon: -118.6779 },          // ~130km
  pipeline: { name: 'Pipeline', lat: 21.6647, lon: -158.0538 },      // ~4,000km
  nazare: { name: 'Nazaré', lat: 39.6033, lon: -9.0705 },            // ~9,000km
};
const IDS = ['trestles', 'blacks', 'malibu', 'pipeline', 'nazare'];

describe('distanceKm', () => {
  it('measures a known separation', () => {
    // Trestles to Blacks Beach is about 65km down the same coast.
    expect(distanceKm(33.3825, -117.5972, 32.8891, -117.2528)).toBeGreaterThan(55);
    expect(distanceKm(33.3825, -117.5972, 32.8891, -117.2528)).toBeLessThan(75);
  });

  it('knows the antimeridian wraps', () => {
    // The flat approximation this replaced put these on opposite sides of the planet.
    expect(distanceKm(-16, 179.5, -16, -179.5)).toBeLessThan(150);
  });

  it('is zero for a spot and itself', () => {
    expect(distanceKm(10, 20, 10, 20)).toBeCloseTo(0, 6);
  });
});

describe('nearestFirst', () => {
  it('puts the anchor first, then the coast around it', () => {
    expect(nearestFirst(SPOTS, IDS, 'trestles')).toEqual(['trestles', 'blacks', 'malibu', 'pipeline', 'nazare']);
  });

  it('reorders when you move: the same catalog looks different from Portugal', () => {
    const fromPortugal = nearestFirst(SPOTS, IDS, 'nazare');
    expect(fromPortugal[0]).toBe('nazare');
    // Pipeline is last from here and second-from-last from Trestles -- the ordering genuinely
    // depends on where you are standing, which is the point. (Trestles edges out Malibu from
    // Portugal by about a degree of longitude, so the top of the list is not simply reversed.)
    expect(fromPortugal[fromPortugal.length - 1]).toBe('pipeline');
    expect(nearestFirst(SPOTS, IDS, 'trestles')[fromPortugal.length - 1]).toBe('nazare');
  });

  it('keeps a spot with no coordinates rather than dropping it', () => {
    const spots = { ...SPOTS, mystery: { name: 'Somewhere' } };
    const out = nearestFirst(spots, [...IDS, 'mystery'], 'trestles');
    expect(out).toContain('mystery');
    expect(out[out.length - 1]).toBe('mystery'); // last, not lost
    expect(out.length).toBe(6);
  });

  it('falls back to the given order when the anchor itself has no position', () => {
    const spots = { ...SPOTS, ghost: { name: 'Ghost' } };
    expect(nearestFirst(spots, IDS, 'ghost')).toEqual(IDS);
  });

  it('is stable: building it twice gives the same sequence', () => {
    // Two spots at an identical position must not swap between presses, or the arrows would
    // step forward and land back where they started.
    const spots = { ...SPOTS, twinA: { lat: 0, lon: 0 }, twinB: { lat: 0, lon: 0 } };
    const ids = [...IDS, 'twinA', 'twinB'];
    expect(nearestFirst(spots, ids, 'trestles')).toEqual(nearestFirst(spots, ids, 'trestles'));
  });

  it('handles the real catalog without losing a spot', () => {
    const out = nearestFirst(CATALOG, ORDER, 'trestles');
    expect(out.length).toBe(ORDER.length);
    expect(new Set(out).size).toBe(ORDER.length);
    expect(out[0]).toBe('trestles');
  });

  it('actually puts Californian spots next to Trestles, which is the whole point', () => {
    // The old order gave Pipeline (Hawaii) and Teahupo'o (Tahiti) four and five steps away.
    const next5 = nearestFirst(CATALOG, ORDER, 'trestles').slice(1, 6);
    for (const id of next5) {
      expect(distanceKm(CATALOG.trestles.lat, CATALOG.trestles.lon, CATALOG[id].lat, CATALOG[id].lon),
        id + ' is not nearby').toBeLessThan(200);
    }
  });

  it('returns nothing for nothing', () => {
    expect(nearestFirst(SPOTS, [], 'trestles')).toEqual([]);
    expect(nearestFirst(SPOTS, null, 'trestles')).toEqual([]);
  });
});

describe('stepNearest', () => {
  it('steps forward to the nearest spot, then the next nearest', () => {
    expect(stepNearest(SPOTS, IDS, 'trestles', 'trestles', 1)).toBe('blacks');
    expect(stepNearest(SPOTS, IDS, 'trestles', 'blacks', 1)).toBe('malibu');
  });

  it('goes back exactly the way it came', () => {
    const forward = stepNearest(SPOTS, IDS, 'trestles', 'trestles', 1);
    expect(stepNearest(SPOTS, IDS, 'trestles', forward, -1)).toBe('trestles');
  });

  it('does not send you to the far side of the planet for pressing back', () => {
    // The reported bug, and the reason clamping replaced wrapping. In a list ordered by
    // distance the last entry is the furthest spot on Earth -- from Lower Trestles that is
    // Réunion, 18,500km away -- so wrapping made the back arrow a teleport.
    expect(stepNearest(SPOTS, IDS, 'trestles', 'trestles', -1)).toBeNull();
  });

  it('stops at the far end too, rather than teleporting home', () => {
    expect(stepNearest(SPOTS, IDS, 'trestles', 'nazare', 1)).toBeNull();
  });

  it('clamps against the real catalog, not just a five-spot fixture', () => {
    expect(stepNearest(CATALOG, ORDER, 'trestles', 'trestles', -1)).toBeNull();
    expect(stepNearest(CATALOG, ORDER, 'trestles', 'trestles', 1)).not.toBeNull();
  });

  it('never bounces between two spots, which chaining nearest-to-current would', () => {
    // From Blacks the nearest spot is Trestles, so a chain would go Trestles -> Blacks ->
    // Trestles forever. Anchored ordering keeps moving outward.
    let at = 'trestles';
    const seen = [at];
    for (let i = 0; i < 4; i++) { at = stepNearest(SPOTS, IDS, 'trestles', at, 1); seen.push(at); }
    expect(new Set(seen).size).toBe(5);
  });

  it('recovers when the current spot is no longer in the list', () => {
    expect(stepNearest(SPOTS, IDS, 'trestles', 'deleted-spot', 1)).toBe('blacks');
  });

  it('returns null with nothing to step through', () => {
    expect(stepNearest(SPOTS, [], 'trestles', 'trestles', 1)).toBeNull();
  });
});

describe('stepIn', () => {
  it('clamps at both ends', () => {
    const list = ['a', 'b', 'c'];
    expect(stepIn(list, 'a', -1)).toBeNull();
    expect(stepIn(list, 'c', 1)).toBeNull();
    expect(stepIn(list, 'b', -1)).toBe('a');
    expect(stepIn(list, 'b', 1)).toBe('c');
  });

  it('has nowhere to go in an empty list', () => {
    expect(stepIn([], 'a', 1)).toBeNull();
    expect(stepIn(null, 'a', 1)).toBeNull();
  });
});
