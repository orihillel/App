import { describe, it, expect } from 'vitest';
import { SEED_SPOTS, ORDER, ONBOARDING_PICKS, loadCatalog, addedSpotIds, yourSpotIds } from './spots.js';
import { CATALOG } from './spots.catalog.js';

// The catalog moved into its own chunk so the first render stops waiting on 30KB of spots it
// does not show. That split introduces exactly one new way to be wrong -- the seed copy
// drifting from the real entries -- and one new failure mode: a screen that renders before the
// catalog arrives. These are about both.

describe('the seeded spots', () => {
  it('are identical to their catalog entries, field for field', () => {
    // If someone corrects a spot's coordinates in the catalog and not here, the app would show
    // the old ones until the chunk loaded and then silently move the marker.
    for (const [id, seed] of Object.entries(SEED_SPOTS)) {
      expect(CATALOG[id], id + ' is not in the catalog at all').toBeTruthy();
      expect(seed, id + ' has drifted from the catalog').toEqual(CATALOG[id]);
    }
  });

  it('cover every screen that can appear before the catalog loads', () => {
    // Onboarding lists these by name, and the home screen opens on the default go-to spot.
    for (const id of ONBOARDING_PICKS) {
      expect(SEED_SPOTS[id], 'onboarding pick ' + id + ' would render blank').toBeTruthy();
    }
    expect(SEED_SPOTS.trestles, 'the default go-to spot must render immediately').toBeTruthy();
  });

  it('stay small enough to be worth seeding at all', () => {
    // The whole point is that this is a handful. If it creeps up to a hundred the split has
    // quietly stopped paying for itself.
    expect(Object.keys(SEED_SPOTS).length).toBeLessThan(20);
    expect(Object.keys(CATALOG).length).toBeGreaterThan(300);
  });
});

describe('loadCatalog', () => {
  it('resolves to the whole catalog', async () => {
    const catalog = await loadCatalog();
    expect(Object.keys(catalog).length).toBe(Object.keys(CATALOG).length);
    expect(catalog.mundaka).toEqual(CATALOG.mundaka);
  });

  it('is memoised, so several callers do not each parse a 400-entry object', async () => {
    // The promise, not the resolved value: import() hands back the same module namespace
    // either way, so comparing the CATALOG objects passes even with the memo removed. It has
    // to be the promise identity, which is the thing memoising actually changes.
    const first = loadCatalog();
    const second = loadCatalog();
    expect(first).toBe(second);
    await first;
    expect(loadCatalog()).toBe(first); // and still, after it has settled
  });
});

describe('ORDER', () => {
  it('names only spots that exist', () => {
    const missing = ORDER.filter((id) => !CATALOG[id]);
    expect(missing, 'ids in ORDER with no catalog entry').toEqual([]);
  });

  it('lists every catalog spot exactly once', () => {
    expect(new Set(ORDER).size).toBe(ORDER.length);
    expect(ORDER.length).toBe(Object.keys(CATALOG).length);
  });
});

// `order` starts as the whole 718-spot ORDER above, so it cannot be shown as-is anywhere that
// means to say "yours" -- NavDrawer, ProfileView and AlertSheet all draw this same line
// against ORDER, which is why it is one function rather than three slightly different filters.
describe('addedSpotIds', () => {
  it('is empty when nothing has been added on top of the built-in catalog', () => {
    expect(addedSpotIds(ORDER, CATALOG)).toEqual([]);
  });

  it('names an id that is in `order` but not in the built-in ORDER', () => {
    const spots = { ...CATALOG, herzliyamarina: { name: 'Herzliya Marina', region: 'Israel' } };
    const order = [...ORDER, 'herzliyamarina'];
    expect(addedSpotIds(order, spots)).toEqual(['herzliyamarina']);
  });

  it('drops an id from `order` that no longer resolves in `spots`', () => {
    // order can carry a stale id after a spot is removed; this is the guard that keeps a
    // dangling reference out of every list built from it.
    const order = [...ORDER, 'ghost'];
    expect(addedSpotIds(order, CATALOG)).toEqual([]);
  });
});

describe('yourSpotIds', () => {
  it('is just the go-to spot when nothing else has been added', () => {
    expect(yourSpotIds(ORDER, CATALOG, 'mundaka')).toEqual(['mundaka']);
  });

  it('puts the go-to spot first, then whatever was added', () => {
    const spots = { ...CATALOG, custom1: { name: 'Custom One', region: 'Nowhere' } };
    const order = [...ORDER, 'custom1'];
    expect(yourSpotIds(order, spots, 'mundaka')).toEqual(['mundaka', 'custom1']);
  });

  it('does not list the go-to spot twice when it is itself something added', () => {
    const spots = { ...CATALOG, custom1: { name: 'Custom One', region: 'Nowhere' } };
    const order = [...ORDER, 'custom1'];
    expect(yourSpotIds(order, spots, 'custom1')).toEqual(['custom1']);
  });

  it('drops the go-to spot if it does not resolve, rather than listing an id with no spot', () => {
    expect(yourSpotIds(ORDER, CATALOG, 'not-a-real-id')).toEqual([]);
  });
});
