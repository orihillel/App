import { describe, it, expect } from 'vitest';
import { formatReadingValue, formatReadingPlace, readingDescription } from './oceanreading.js';
import { degToCompass } from './rating.js';

describe('formatReadingValue', () => {
  it('reads wave height to a decimal, because the interesting range is 0-3m', () => {
    expect(formatReadingValue(1.4, 'swell', 'metric')).toBe('1.4m');
    expect(formatReadingValue(0.2, 'swell', 'metric')).toBe('0.2m');
  });

  it('reads wind as whole numbers, because a decimal there is false precision', () => {
    expect(formatReadingValue(18.4, 'wind', 'metric')).toBe('18kph');
    expect(formatReadingValue(18.4, 'wind', 'imperial')).toBe('11mph');
  });

  it('converts for an imperial reader', () => {
    expect(formatReadingValue(1, 'swell', 'imperial')).toBe('3.3ft');
  });

  // The case the whole module exists for.
  it('says nothing at all where the grid has nothing', () => {
    for (const v of [null, undefined, NaN]) {
      expect(formatReadingValue(v, 'swell', 'metric')).toBeNull();
      expect(formatReadingValue(v, 'wind', 'imperial')).toBeNull();
    }
  });
});

describe('formatReadingPlace', () => {
  it('names the hemisphere rather than leaning on a minus sign', () => {
    expect(formatReadingPlace(32.163, 34.797)).toBe('32.2N 34.8E');
    expect(formatReadingPlace(-33.9, -151.2)).toBe('33.9S 151.2W');
  });

  it('puts the equator and the prime meridian on the positive side', () => {
    expect(formatReadingPlace(0, 0)).toBe('0.0N 0.0E');
  });

  it('has nothing to say about a point that is not one', () => {
    expect(formatReadingPlace(NaN, 0)).toBeNull();
    expect(formatReadingPlace(0, undefined)).toBeNull();
  });
});

describe('readingDescription', () => {
  it('says which layer, and which way it is coming from', () => {
    expect(readingDescription({ value: 1.4, layer: 'swell', fromDeg: 315 }, degToCompass))
      .toBe('swell from NW');
    expect(readingDescription({ value: 20, layer: 'wind', fromDeg: 90 }, degToCompass))
      .toBe('wind from E');
  });

  it('drops the direction rather than guessing when the grid carries none', () => {
    expect(readingDescription({ value: 1.4, layer: 'swell', fromDeg: null }, degToCompass))
      .toBe('swell');
  });

  // Land must never borrow its neighbour's swell. The globe paints a gap-filled grid so the
  // overlay has no holes behind the coastline mask, and reads the unfilled one for exactly
  // this reason.
  it('reports no reading rather than a number, wherever there is none', () => {
    expect(readingDescription({ value: null, layer: 'swell' }, degToCompass))
      .toBe('No reading here — land, ice, or outside the model');
    expect(readingDescription({ value: NaN, layer: 'wind' }, degToCompass))
      .toBe('No reading here — land, ice, or outside the model');
  });

  it('has nothing to say about no reading at all', () => {
    expect(readingDescription(null, degToCompass)).toBeNull();
  });
});
