import { describe, it, expect, vi } from 'vitest';
import { spotUrl, shareText, shareSpot } from './share.js';

const LOC = { origin: 'https://example.test', pathname: '/App/' };
const SPOT = { id: 'trestles', name: 'Lower Trestles' };
const HOUR = { rating: 'GOOD', wave: '3-5' };

describe('spotUrl', () => {
  it('is absolute and uses the app\'s own origin and path', () => {
    expect(spotUrl('trestles', LOC)).toBe('https://example.test/App/#/spot/trestles');
  });

  it('escapes an id that would otherwise break the hash', () => {
    expect(spotUrl('custom 1/2', LOC)).toBe('https://example.test/App/#/spot/custom%201%2F2');
  });

  it('is null without a spot, so nothing offers to share nothing', () => {
    expect(spotUrl(null, LOC)).toBeNull();
    expect(spotUrl('', LOC)).toBeNull();
  });

  it('is null rather than a relative fragment when there is no origin to build from', () => {
    expect(spotUrl('trestles', { origin: '', pathname: '/App/' })).toBeNull();
  });
});

describe('shareText', () => {
  it('leads with the spot and carries the conditions', () => {
    expect(shareText(SPOT, HOUR)).toBe('Lower Trestles — GOOD · 3-5ft');
  });

  it('appends the link on its own line when given one', () => {
    expect(shareText(SPOT, HOUR, { url: 'https://x.test/#/spot/trestles' }))
      .toBe('Lower Trestles — GOOD · 3-5ft\nhttps://x.test/#/spot/trestles');
  });

  it('names the spot alone rather than inventing conditions it does not have', () => {
    expect(shareText(SPOT, null)).toBe('Lower Trestles');
    expect(shareText(SPOT, { rating: 'LOADING' })).toBe('Lower Trestles');
  });

  it('drops the rating rather than the height when only one is known', () => {
    expect(shareText(SPOT, { wave: '2-3' })).toBe('Lower Trestles — 2-3ft');
  });
});

describe('shareSpot', () => {
  const url = 'https://example.test/App/#/spot/trestles';

  it('prefers the OS share sheet, passing the link as a url rather than as text', async () => {
    const share = vi.fn(async () => {});
    expect(await shareSpot(SPOT, HOUR, { nav: { share }, url })).toBe('shared');
    expect(share).toHaveBeenCalledWith({
      title: 'Lower Trestles',
      text: 'Lower Trestles — GOOD · 3-5ft',
      url,
    });
  });

  it('reports a dismissed sheet as dismissed, not as a failure, and does not then copy', async () => {
    const err = new Error('cancelled'); err.name = 'AbortError';
    const writeText = vi.fn(async () => {});
    const share = vi.fn(async () => { throw err; });
    expect(await shareSpot(SPOT, HOUR, { nav: { share, clipboard: { writeText } }, url })).toBe('dismissed');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('falls back to the clipboard when a browser advertises share and then refuses', async () => {
    const writeText = vi.fn(async () => {});
    const share = vi.fn(async () => { throw new Error('NotAllowedError'); });
    expect(await shareSpot(SPOT, HOUR, { nav: { share, clipboard: { writeText } }, url })).toBe('copied');
    expect(writeText).toHaveBeenCalledWith(url);
  });

  it('copies the bare link, not the whole message, so pasting it gives a working URL', async () => {
    const writeText = vi.fn(async () => {});
    await shareSpot(SPOT, HOUR, { nav: { clipboard: { writeText } }, url });
    expect(writeText).toHaveBeenCalledWith(url);
  });

  it('reports unavailable when neither route exists, rather than claiming success', async () => {
    expect(await shareSpot(SPOT, HOUR, { nav: {}, url })).toBe('unavailable');
    expect(await shareSpot(SPOT, HOUR, { nav: null, url })).toBe('unavailable');
  });

  it('reports unavailable when the clipboard itself throws', async () => {
    const writeText = vi.fn(async () => { throw new Error('denied'); });
    expect(await shareSpot(SPOT, HOUR, { nav: { clipboard: { writeText } }, url })).toBe('unavailable');
  });

  it('does nothing at all without a link to share', async () => {
    const share = vi.fn(async () => {});
    expect(await shareSpot(SPOT, HOUR, { nav: { share }, url: null })).toBe('unavailable');
    expect(share).not.toHaveBeenCalled();
  });
});
