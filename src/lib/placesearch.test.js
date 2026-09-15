import { describe, it, expect } from 'vitest';
import { foldText, spotSearchText } from './placesearch.js';

describe('foldText', () => {
  it('strips the accents an English keyboard cannot type', () => {
    expect(foldText('Nazaré')).toBe('nazare');
    expect(foldText('São Paulo')).toBe('sao paulo');
    expect(foldText('Þorlákshöfn')).toBe('thorlakshofn');
    expect(foldText('Klitmøller')).toBe('klitmoller');
    expect(foldText('Chałupy')).toBe('chalupy');
    expect(foldText('Għajn Tuffieħa')).toBe('ghajn tuffieha');
    expect(foldText('Borestranden æ')).toBe('borestranden ae');
  });

  it('closes up apostrophes and the ʻokina rather than splitting the word', () => {
    // "Peʻahi" is typed "Peahi", not "Pe ahi" -- a space here would make the spot unreachable.
    expect(foldText('Peʻahi (Jaws)')).toBe('peahi jaws');
    expect(foldText("Ha'atafu")).toBe('haatafu');
    expect(foldText('Llico’s')).toBe('llicos');
  });

  it('turns every other separator into a single space', () => {
    expect(foldText('P-Pass')).toBe('p pass');
    expect(foldText('  Tel   Aviv,  Israel ')).toBe('tel aviv israel');
    expect(foldText('Killers (Todos Santos)')).toBe('killers todos santos');
  });

  it('survives junk input', () => {
    expect(foldText(null)).toBe('');
    expect(foldText(undefined)).toBe('');
    expect(foldText('')).toBe('');
    expect(foldText('!!!')).toBe('');
  });
});

describe('spotSearchText', () => {
  it('carries the name and every part of the region', () => {
    const text = spotSearchText({ name: 'Acadia', region: 'Herzliya, Israel' });
    expect(text).toContain('acadia');
    expect(text).toContain('herzliya');
    expect(text).toContain('israel');
  });

  it('adds the country a region only implies', () => {
    // "San Clemente, CA" never says California or USA, and both are things people type.
    const text = spotSearchText({ name: 'Lower Trestles', region: 'San Clemente, CA' });
    expect(text).toContain('california');
    expect(text).toContain('united states');
  });

  it('knows a state, a territory and an overseas region belong to their country', () => {
    expect(spotSearchText({ name: 'x', region: 'Oahu, Hawaii' })).toContain('united states');
    expect(spotSearchText({ name: 'x', region: 'Cornwall, England' })).toContain('united kingdom');
    expect(spotSearchText({ name: 'x', region: 'Lanzarote, Canary Islands' })).toContain('spain');
    expect(spotSearchText({ name: 'x', region: 'Saint-Leu, Réunion' })).toContain('france');
  });

  it('matches an alias on a whole segment, never a fragment of a word', () => {
    // "CA" must not fire inside Cascais, or every Portuguese spot claims to be Californian.
    expect(spotSearchText({ name: 'Guincho', region: 'Cascais, Portugal' })).not.toContain('california');
  });

  it('survives a spot with no region, and junk input', () => {
    expect(spotSearchText({ name: 'Somewhere' })).toBe('somewhere');
    expect(spotSearchText(null)).toBe('');
  });

  it('returns the same text for a repeated lookup of one spot', () => {
    // The result is cached per spot object; a second call must not differ from the first.
    const spot = { name: 'Nazaré', region: 'Portugal' };
    expect(spotSearchText(spot)).toBe(spotSearchText(spot));
  });
});
