import { describe, it, expect, vi } from 'vitest';
import { locate, REASONS } from './geolocate.js';

const pos = (latitude, longitude) => ({ coords: { latitude, longitude } });

describe('locate', () => {
  it('resolves with coordinates on success', async () => {
    const geo = { getCurrentPosition: (ok) => ok(pos(33.1, -117.4)) };
    expect(await locate({ geo })).toEqual({ ok: true, lat: 33.1, lon: -117.4 });
  });

  it('reports a denied prompt as its own reason, since it is the one the user can fix', async () => {
    const geo = { getCurrentPosition: (_ok, fail) => fail({ code: 1 }) };
    expect(await locate({ geo })).toEqual({ ok: false, reason: 'denied', message: REASONS.denied });
  });

  it('distinguishes no-fix from timeout', async () => {
    expect((await locate({ geo: { getCurrentPosition: (_o, f) => f({ code: 2 }) } })).reason).toBe('unavailable');
    expect((await locate({ geo: { getCurrentPosition: (_o, f) => f({ code: 3 }) } })).reason).toBe('timeout');
  });

  it('resolves rather than hanging when the browser never calls back', async () => {
    vi.useFakeTimers();
    const promise = locate({ geo: { getCurrentPosition: () => {} }, timeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(1100);
    expect(await promise).toEqual({ ok: false, reason: 'timeout', message: REASONS.timeout });
    vi.useRealTimers();
  });

  it('says so when there is no geolocation at all', async () => {
    expect(await locate({ geo: null })).toEqual({ ok: false, reason: 'unsupported', message: REASONS.unsupported });
    expect((await locate({ geo: {} })).reason).toBe('unsupported');
  });

  it('treats a success callback with no usable coordinates as no fix', async () => {
    expect((await locate({ geo: { getCurrentPosition: (ok) => ok({}) } })).reason).toBe('unavailable');
    expect((await locate({ geo: { getCurrentPosition: (ok) => ok(pos(NaN, 1)) } })).reason).toBe('unavailable');
  });

  it('does not throw when a webview rejects the call synchronously', async () => {
    const geo = { getCurrentPosition: () => { throw new Error('not allowed'); } };
    expect((await locate({ geo })).reason).toBe('unsupported');
  });
});
