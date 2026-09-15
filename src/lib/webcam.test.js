import { describe, it, expect } from 'vitest';
import { camSearchUrl } from './webcam.js';

describe('camSearchUrl', () => {
  it('searches by spot name and region', () => {
    expect(camSearchUrl({ name: 'Lower Trestles', region: 'San Clemente, CA' }))
      .toBe('https://www.google.com/search?q=Lower%20Trestles%2C%20San%20Clemente%2C%20CA%20surf%20cam%20live');
  });

  it('falls back to the name alone when there is no region', () => {
    expect(camSearchUrl({ name: 'Lower Trestles' }))
      .toBe('https://www.google.com/search?q=Lower%20Trestles%20surf%20cam%20live');
  });

  it('is null without a spot, so nothing offers to search for nothing', () => {
    expect(camSearchUrl(null)).toBeNull();
    expect(camSearchUrl(undefined)).toBeNull();
  });

  it('is null for a spot with no name', () => {
    expect(camSearchUrl({ region: 'San Clemente, CA' })).toBeNull();
    expect(camSearchUrl({})).toBeNull();
  });

  it('encodes characters that would otherwise break the query string', () => {
    expect(camSearchUrl({ name: 'Rincon & Points North' }))
      .toBe('https://www.google.com/search?q=Rincon%20%26%20Points%20North%20surf%20cam%20live');
  });
});
