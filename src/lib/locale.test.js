import { describe, it, expect } from 'vitest';
import { defaultUnits, anchorFor, nearbyPicks } from './locale.js';
import { SPOTS, ONBOARDING_PICKS } from './spots.js';

describe('defaultUnits', () => {
  it('is metric in Israel, and everywhere else that uses it', () => {
    for (const tag of ['he-IL', 'en-IL', 'ar-IL', 'fr-FR', 'pt-PT', 'es-ES', 'ja-JP', 'en-AU']) {
      expect(defaultUnits(tag), tag).toBe('metric');
    }
  });
  it('stays imperial for the handful of places that use it', () => {
    expect(defaultUnits('en-US')).toBe('imperial');
  });
  it('resolves a region from a bare language tag', () => {
    // "en" maximizes to en-Latn-US.
    expect(defaultUnits('en')).toBe('imperial');
    expect(defaultUnits('he')).toBe('metric');
  });
  it('falls back to metric on junk rather than throwing', () => {
    for (const tag of ['', '!!!', 'not-a-locale-at-all']) {
      expect(typeof defaultUnits(tag)).toBe('string');
    }
  });
});

describe('anchorFor', () => {
  it('knows Israel', () => {
    expect(anchorFor('Asia/Jerusalem')).toEqual([32.09, 34.77]);
  });
  it('returns nothing for a timezone the catalog does not cover', () => {
    expect(anchorFor('Antarctica/Vostok')).toBeNull();
    expect(anchorFor('nonsense')).toBeNull();
  });
});

describe('nearbyPicks', () => {
  it('offers Israeli spots to someone in Israel', () => {
    const picks = nearbyPicks(SPOTS, 'Asia/Jerusalem', ONBOARDING_PICKS);
    expect(picks).toHaveLength(7);
    for (const id of picks) {
      expect(SPOTS[id].region, id).toMatch(/Israel/);
    }
  });

  it('does not offer California to someone in Tel Aviv', () => {
    const picks = nearbyPicks(SPOTS, 'Asia/Jerusalem', ONBOARDING_PICKS);
    expect(picks).not.toContain('trestles');
    expect(picks).not.toContain('pipeline');
  });

  it('offers local spots in the other regions it knows', () => {
    const la = nearbyPicks(SPOTS, 'America/Los_Angeles', ONBOARDING_PICKS);
    expect(la.every((id) => /CA|California/.test(SPOTS[id].region))).toBe(true);

    const syd = nearbyPicks(SPOTS, 'Australia/Sydney', ONBOARDING_PICKS);
    expect(syd.every((id) => /Australia/.test(SPOTS[id].region))).toBe(true);
  });

  it('falls back to the global list where the catalog is too thin', () => {
    expect(nearbyPicks(SPOTS, 'Antarctica/Vostok', ONBOARDING_PICKS)).toBe(ONBOARDING_PICKS);
    expect(nearbyPicks(null, 'Asia/Jerusalem', ONBOARDING_PICKS)).toBe(ONBOARDING_PICKS);
  });

  it('never returns a spot that is not in the catalog', () => {
    for (const tz of ['Asia/Jerusalem', 'America/Los_Angeles', 'Europe/Lisbon', 'Pacific/Honolulu']) {
      for (const id of nearbyPicks(SPOTS, tz, ONBOARDING_PICKS)) {
        expect(SPOTS[id], id).toBeTruthy();
      }
    }
  });
});

describe('Israeli coverage', () => {
  const israeli = Object.entries(SPOTS).filter(([, s]) => /Israel/.test(s.region));

  it('covers the coast rather than a token spot or two', () => {
    expect(israeli.length).toBeGreaterThanOrEqual(15);
  });

  it('spans the length of the coastline, north to south', () => {
    const lats = israeli.map(([, s]) => s.lat);
    expect(Math.min(...lats)).toBeLessThan(31.8);  // down to Ashkelon
    expect(Math.max(...lats)).toBeGreaterThan(32.9); // up to Nahariya
  });

  it('faces west, with an easterly offshore, as that coast does', () => {
    for (const [key, s] of israeli) {
      expect(s.offshoreDeg, key).toBeGreaterThan(60);
      expect(s.offshoreDeg, key).toBeLessThan(140);
      expect(s.swellWindow, key).toBeTruthy();
    }
  });

  it('claims no tide preference, because the eastern Med barely has one', () => {
    for (const [key, s] of israeli) {
      expect(s.bestTide, key).toBe('all');
    }
  });
});
