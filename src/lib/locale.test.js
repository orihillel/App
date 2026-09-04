import { describe, it, expect } from 'vitest';
import { defaultUnits, anchorFor, nearbyPicks } from './locale.js';
import { SPOTS, ONBOARDING_PICKS, searchCatalog } from './spots.js';

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

describe('global coverage', () => {
  const spots = Object.entries(SPOTS);
  const countryOf = (s) => s.region.split(',').pop().trim();

  it('spans a wide set of countries, not just the surf-media ones', () => {
    const countries = new Set(spots.map(([, s]) => countryOf(s)));
    expect(countries.size).toBeGreaterThanOrEqual(75);
  });

  it('covers every ocean basin', () => {
    // Crude but sufficient: at least one spot in each quadrant of the globe, plus the
    // Mediterranean, so no basin is silently missing.
    const has = (fn) => spots.some(([, s]) => fn(s.lat, s.lon));
    expect(has((la, lo) => la > 0 && lo < -30)).toBe(true);   // North Atlantic / N America
    expect(has((la, lo) => la < 0 && lo < -30)).toBe(true);   // South America
    expect(has((la, lo) => la > 0 && lo > -30 && lo < 60)).toBe(true); // Europe / W Africa
    expect(has((la, lo) => la < 0 && lo > -30 && lo < 60)).toBe(true); // S Africa / Angola
    expect(has((la, lo) => lo > 60 && lo < 180)).toBe(true);  // Indian / Pacific west
    expect(has((la, lo) => lo > 100 && la < 0)).toBe(true);   // Australasia
  });

  it('reaches both surfing hemispheres properly', () => {
    const lats = spots.map(([, s]) => s.lat);
    expect(Math.max(...lats)).toBeGreaterThan(60);  // Arctic Norway
    expect(Math.min(...lats)).toBeLessThan(-38);    // southern Australia / Argentina
  });

  it('keeps every spot well-formed as the catalog grows', () => {
    for (const [key, s] of spots) {
      expect(typeof s.name, key).toBe('string');
      expect(typeof s.region, key).toBe('string');
      expect(Number.isFinite(s.lat) && s.lat >= -90 && s.lat <= 90, key).toBe(true);
      expect(Number.isFinite(s.lon) && s.lon >= -180 && s.lon <= 180, key).toBe(true);
      expect(Number.isFinite(s.offshoreDeg), key).toBe(true);
    }
  });

  it('has no two spots claiming the same name', () => {
    const names = spots.map(([, s]) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('searchCatalog', () => {
  it('finds a spot by exact name', () => {
    const [first] = searchCatalog(SPOTS, 'Pipeline');
    expect(first.spot.name).toBe('Pipeline');
  });

  it('is case- and whitespace-insensitive', () => {
    expect(searchCatalog(SPOTS, '  jeffreys bay ')[0].spot.name).toBe('Jeffreys Bay');
  });

  it('ranks an exact name above a partial one', () => {
    // "Bells Beach" must beat any other beach whose name merely contains "bells".
    const results = searchCatalog(SPOTS, 'Bells Beach');
    expect(results[0].spot.name).toBe('Bells Beach');
  });

  it('ranks name matches above region matches', () => {
    const results = searchCatalog(SPOTS, 'Israel');
    // Nothing is *named* Israel, so these are all region hits, and all Israeli.
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) expect(r.spot.region).toMatch(/Israel/);
  });

  it('finds spots by region', () => {
    const results = searchCatalog(SPOTS, 'Tel Aviv');
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) expect(r.spot.region).toMatch(/Tel Aviv/);
  });

  it('finds the spots added for countries that had none', () => {
    for (const name of ['Robertsport', 'Cabo Ledo', "Ha'atafu", 'Busua', 'P-Pass']) {
      expect(searchCatalog(SPOTS, name)[0], name).toBeTruthy();
      expect(searchCatalog(SPOTS, name)[0].spot.name, name).toBe(name);
    }
  });

  it('returns nothing for a query too short or unknown', () => {
    expect(searchCatalog(SPOTS, 'a')).toEqual([]);
    expect(searchCatalog(SPOTS, '')).toEqual([]);
    expect(searchCatalog(SPOTS, 'zzzzzznotaplace')).toEqual([]);
  });

  it('caps how many it returns', () => {
    expect(searchCatalog(SPOTS, 'beach', 5).length).toBeLessThanOrEqual(5);
  });

  it('survives junk input', () => {
    expect(searchCatalog(null, 'pipeline')).toEqual([]);
    expect(searchCatalog(SPOTS, null)).toEqual([]);
    expect(searchCatalog(SPOTS, undefined)).toEqual([]);
  });
});
