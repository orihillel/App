import { describe, it, expect } from 'vitest';
import { nearestSpots, rankNearby, DEFAULT_MAX_KM } from './nearby.js';

// Roughly 1 degree of latitude ~ 111km, which makes the fixtures easy to reason about.
const SPOTS = {
  here:  { name: 'Here',  lat: 33.0, lon: -117.0 },
  near:  { name: 'Near',  lat: 33.2, lon: -117.0 }, // ~22km
  mid:   { name: 'Mid',   lat: 33.6, lon: -117.0 }, // ~67km
  far:   { name: 'Far',   lat: 35.0, lon: -117.0 }, // ~222km, past the cutoff
  broken:{ name: 'Broken', lat: null, lon: -117.0 },
};
const ORDER = ['far', 'mid', 'near', 'here', 'broken'];
const ORIGIN = { lat: 33.0, lon: -117.0 };

describe('nearestSpots', () => {
  it('returns spots inside the radius, closest first', () => {
    expect(nearestSpots(SPOTS, ORDER, ORIGIN).map((r) => r.id)).toEqual(['here', 'near', 'mid']);
  });

  it('drops anything past the radius, and lets the radius be set', () => {
    expect(nearestSpots(SPOTS, ORDER, ORIGIN, { maxKm: 30 }).map((r) => r.id)).toEqual(['here', 'near']);
    expect(nearestSpots(SPOTS, ORDER, ORIGIN, { maxKm: 500 }).map((r) => r.id)).toContain('far');
  });

  it('honours the limit, keeping the closest', () => {
    expect(nearestSpots(SPOTS, ORDER, ORIGIN, { limit: 2 }).map((r) => r.id)).toEqual(['here', 'near']);
  });

  it('skips a spot with no usable coordinates rather than sorting NaN', () => {
    expect(nearestSpots(SPOTS, ORDER, ORIGIN).map((r) => r.id)).not.toContain('broken');
  });

  it('carries the distance, which the ranking below breaks ties on', () => {
    const [first] = nearestSpots(SPOTS, ORDER, ORIGIN);
    expect(first.km).toBeCloseTo(0, 5);
  });

  it('answers empty for a missing or unusable location rather than throwing', () => {
    for (const bad of [null, undefined, {}, { lat: 33 }, { lat: NaN, lon: 1 }]) {
      expect(nearestSpots(SPOTS, ORDER, bad)).toEqual([]);
    }
    expect(nearestSpots(null, ORDER, ORIGIN)).toEqual([]);
  });

  it('falls back to every spot it has when given no order', () => {
    expect(nearestSpots(SPOTS, null, ORIGIN).map((r) => r.id)).toEqual(['here', 'near', 'mid']);
  });

  it('defaults to a radius worth driving', () => {
    expect(DEFAULT_MAX_KM).toBeGreaterThan(50);
  });
});

describe('rankNearby', () => {
  const cands = [{ id: 'a', km: 5 }, { id: 'b', km: 40 }, { id: 'c', km: 10 }];
  const hour = (score) => ({ hours: [{ hour: 9, score, rating: 'GOOD', wave: '3-5' }] });

  it('puts the best-scoring spot first, not the closest', () => {
    const fc = { a: hour(2), b: hour(7), c: hour(4) };
    expect(rankNearby(cands, fc, 9).map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });

  it('breaks a tie on distance, so the nearer of two equal spots wins', () => {
    const fc = { a: hour(5), b: hour(5), c: hour(5) };
    expect(rankNearby(cands, fc, 9).map((r) => r.id)).toEqual(['a', 'c', 'b']);
  });

  it('keeps a spot with no reading yet, at the bottom, in distance order', () => {
    // Dropping them would make rows appear and the list jump as answers arrive.
    const fc = { b: hour(1) };
    expect(rankNearby(cands, fc, 9).map((r) => r.id)).toEqual(['b', 'a', 'c']);
  });

  it('exposes the hour it ranked on, so the row can show it', () => {
    const [top] = rankNearby(cands, { a: hour(3) }, 9);
    expect(top.hour.wave).toBe('3-5');
    expect(top.score).toBe(3);
  });

  it('handles no forecast and no candidates at all', () => {
    expect(rankNearby(cands, null, 9).map((r) => r.id)).toEqual(['a', 'c', 'b']);
    expect(rankNearby(null, {}, 9)).toEqual([]);
  });
});
