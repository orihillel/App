import { describe, it, expect } from 'vitest';
import { parseHash, buildHash } from './router.js';

describe('parseHash', () => {
  it('reads the three named views', () => {
    expect(parseHash('#/globe')).toEqual({ view: 'globe', spotId: null });
    expect(parseHash('#/alerts')).toEqual({ view: 'alerts', spotId: null });
    expect(parseHash('#/profile')).toEqual({ view: 'profile', spotId: null });
  });

  it('reads a spot route, which is home showing that spot', () => {
    expect(parseHash('#/spot/trestles')).toEqual({ view: 'home', spotId: 'trestles' });
  });

  it('decodes an id that needed escaping', () => {
    expect(parseHash('#/spot/' + encodeURIComponent('my spot/2')).spotId).toBe('my spot/2');
  });

  it('falls back to home for anything it does not recognise, rather than erroring', () => {
    // These arrive from address bars and old notifications, not only from this app.
    for (const h of ['', '#', '#/', '#/nonsense', '#/spot', '#//', undefined, null, 42]) {
      expect(parseHash(h)).toEqual({ view: 'home', spotId: null });
    }
  });

  it('does not throw on a malformed escape sequence', () => {
    expect(() => parseHash('#/spot/%zz')).not.toThrow();
    expect(parseHash('#/spot/%zz').view).toBe('home');
  });
});

describe('buildHash', () => {
  it('round-trips every route through parseHash', () => {
    for (const route of [
      { view: 'home', spotId: null },
      { view: 'home', spotId: 'trestles' },
      { view: 'globe', spotId: null },
      { view: 'alerts', spotId: null },
      { view: 'profile', spotId: null },
    ]) {
      expect(parseHash(buildHash(route))).toEqual(route);
    }
  });

  it('escapes an id that would otherwise break the route', () => {
    expect(parseHash(buildHash({ view: 'home', spotId: 'a/b' })).spotId).toBe('a/b');
  });

  it('ignores a spot id on a view that is not a spot', () => {
    expect(buildHash({ view: 'globe', spotId: 'trestles' })).toBe('#/globe');
  });

  it('answers for junk input', () => {
    expect(buildHash()).toBe('#/');
    expect(buildHash({})).toBe('#/');
  });
});
