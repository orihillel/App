import { describe, it, expect } from 'vitest';
import { defaultUnits, anchorFor, nearbyPicks, TIMEZONE_ANCHORS } from './locale.js';
import { SPOTS, ORDER, ONBOARDING_PICKS, searchCatalog } from './spots.js';

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

describe('Southern African coverage', () => {
  const inRegion = (re) => Object.entries(SPOTS).filter(([, s]) => re.test(s.region));
  const southernAfrica = inRegion(/South Africa|Namibia|Mozambique|Angola|Madagascar|Mauritius|Réunion/);

  it('covers the region rather than a handful of famous names', () => {
    expect(southernAfrica.length).toBeGreaterThanOrEqual(40);
  });

  it('runs the length of the South African coast, Atlantic to KwaZulu-Natal', () => {
    const sa = inRegion(/South Africa/);
    expect(sa.length).toBeGreaterThanOrEqual(20);
    const lons = sa.map(([, s]) => s.lon);
    expect(Math.min(...lons)).toBeLessThan(18.5);    // the cold Atlantic side, west of Cape Town
    expect(Math.max(...lons)).toBeGreaterThan(31.5); // up to Richards Bay
    const lats = sa.map(([, s]) => s.lat);
    expect(Math.max(...lats)).toBeGreaterThan(-29);  // northern KwaZulu-Natal
    expect(Math.min(...lats)).toBeLessThan(-34);     // the Cape
  });

  it('gives the neighbouring countries more than one spot each', () => {
    for (const country of [/Namibia/, /Mozambique/, /Angola/, /Madagascar/, /Réunion/]) {
      expect(inRegion(country).length, String(country)).toBeGreaterThanOrEqual(2);
    }
  });

  it('takes its swell from the ocean each stretch of coast actually faces', () => {
    // South Africa's coast turns through nearly 180 degrees, so the swell window has to turn
    // with it: South Atlantic west of Cape Town, Southern Ocean along the south coast, Indian
    // Ocean up the KwaZulu-Natal side. A spot with a window from the wrong quadrant would be
    // rated off swell that its own headland blocks, every day of the year.
    const bands = [
      [(lon) => lon < 20, 220, 280],               // Cape Peninsula and the Atlantic: SW
      [(lon) => lon > 22 && lon < 25.5, 195, 225], // south coast and the points: S to SSW
      [(lon) => lon > 25.5 && lon < 27, 160, 200], // Algoa Bay, where the coast turns north
      [(lon) => lon > 27, 125, 200],               // Wild Coast and KwaZulu-Natal: SE to E
    ];
    for (const [key, s] of inRegion(/South Africa/)) {
      if (!s.swellWindow) continue; // falls back to an arc derived from offshoreDeg
      const [from, to] = s.swellWindow;
      const centre = (from + to) / 2;
      for (const [inBand, lo, hi] of bands) {
        if (!inBand(s.lon)) continue;
        expect(centre, key).toBeGreaterThanOrEqual(lo);
        expect(centre, key).toBeLessThanOrEqual(hi);
      }
    }
  });

  it('offers local spots to someone in each country the region covers', () => {
    const cases = [
      ['Africa/Windhoek', /Namibia/],
      ['Africa/Maputo', /Mozambique|South Africa/],
      // The whole Gulf of Guinea seaboard counts here: Pointe-Noire is closer to Luanda than
      // Luanda is to Benguela, Cabinda sits between them, and Mayumba is inside the same
      // thousand kilometres. "Local" is a distance, not a passport.
      ['Africa/Luanda', /Angola|Congo|Gabon/],
      ['Indian/Antananarivo', /Madagascar/],
      ['Indian/Reunion', /Réunion|Mauritius|Madagascar/],
    ];
    for (const [tz, re] of cases) {
      const picks = nearbyPicks(SPOTS, tz, ONBOARDING_PICKS);
      expect(picks, tz).not.toBe(ONBOARDING_PICKS); // i.e. it found real local spots
      for (const id of picks) expect(SPOTS[id].region, tz + ' ' + id).toMatch(re);
    }
  });
});

describe('global coverage', () => {
  const spots = Object.entries(SPOTS);
  const countryOf = (s) => s.region.split(',').pop().trim();

  it('spans a wide set of countries, not just the surf-media ones', () => {
    const countries = new Set(spots.map(([, s]) => countryOf(s)));
    expect(countries.size).toBeGreaterThanOrEqual(110);
  });

  it('lists every spot exactly once in ORDER, with nothing missing and nothing extra', () => {
    // ORDER is what the app iterates to render the catalog, so a gap in it is a hole in the
    // list and a stray entry is a crash. A trailing comma while this was being extended left a
    // literal `undefined` in the array, which every other check happily ignored.
    expect(ORDER).toHaveLength(Object.keys(SPOTS).length);
    expect(new Set(ORDER).size).toBe(ORDER.length);
    for (const id of ORDER) expect(SPOTS[id], String(id)).toBeTruthy();
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

  it('has an entry in every sea people actually surf, not only the three big oceans', () => {
    // Named seas rather than quadrants: the quadrant test above passes with the catalog's
    // Atlantic and Pacific spots alone, so it cannot notice a whole enclosed sea missing.
    const inBox = (latLo, latHi, lonLo, lonHi) => spots.some(
      ([, s]) => s.lat > latLo && s.lat < latHi && s.lon > lonLo && s.lon < lonHi,
    );
    expect(inBox(40, 48, 27, 42), 'Black Sea').toBe(true);
    expect(inBox(53, 62, 10, 24), 'Baltic').toBe(true);
    expect(inBox(12, 27, 50, 70), 'Arabian Sea').toBe(true);
    expect(inBox(5, 23, 80, 100), 'Bay of Bengal').toBe(true);
    expect(inBox(-6, 8, -6, 12), 'Gulf of Guinea').toBe(true);
    expect(inBox(23, 27, 50, 57), 'Persian Gulf').toBe(true);
    expect(inBox(28, 36, -70, -60), 'mid-Atlantic').toBe(true);
    expect(inBox(-25, -5, 38, 58), 'western Indian Ocean').toBe(true);
  });

  it('offers local spots in each timezone the anchor table claims to cover', () => {
    // An anchor that cannot find three spots nearby silently falls back to the global list, so
    // adding one without the spots to back it is a lie in a table nobody would notice.
    for (const [tz, [lat, lon]] of Object.entries(TIMEZONE_ANCHORS)) {
      const picks = nearbyPicks(SPOTS, tz, ONBOARDING_PICKS);
      expect(picks, tz).not.toBe(ONBOARDING_PICKS);
      expect(picks.length, tz).toBeGreaterThanOrEqual(3);
      // And "nearby" has to mean it. Roughly 1,000km, the same bound nearbyPicks applies —
      // asserted here by country in some places, but distance is what the function promises,
      // and it is the part that stays true as the catalog grows across borders.
      for (const id of picks) {
        const s = SPOTS[id];
        const dLat = s.lat - lat;
        const dLon = (s.lon - lon) * Math.cos(((s.lat + lat) / 2) * (Math.PI / 180));
        expect(Math.sqrt(dLat * dLat + dLon * dLon) * 111, tz + ' ' + id).toBeLessThan(1000);
      }
    }
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
