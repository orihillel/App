import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchBuoyObservation, formatAge, compareToForecast, compareLabel } from './buoy.js';

describe('formatAge', () => {
  it('reads naturally across the range', () => {
    expect(formatAge(0)).toBe('just now');
    expect(formatAge(22)).toBe('22 min ago');
    expect(formatAge(59)).toBe('59 min ago');
    expect(formatAge(60)).toBe('1 hr ago');
    expect(formatAge(150)).toBe('3 hr ago');
  });
  it('says nothing without an age', () => expect(formatAge(null)).toBeNull());
});

describe('compareToForecast', () => {
  it('calls a close match true', () => {
    expect(compareToForecast(4, 4)).toBe('matching');
    expect(compareToForecast(4.4, 4)).toBe('matching');
  });
  it('flags a forecast running under or over', () => {
    expect(compareToForecast(6, 4)).toBe('bigger');
    expect(compareToForecast(2, 4)).toBe('smaller');
  });
  it('judges relative to size, not absolute feet', () => {
    // One foot out matters at 2ft and does not at 12ft.
    expect(compareToForecast(3, 2)).toBe('bigger');
    expect(compareToForecast(13, 12)).toBe('matching');
  });
  it('is null when either side is missing', () => {
    expect(compareToForecast(null, 4)).toBeNull();
    expect(compareToForecast(4, null)).toBeNull();
  });
  it('does not divide by zero on a flat day', () => {
    expect(compareToForecast(0, 0)).toBe('matching');
  });
});

describe('compareLabel', () => {
  it('has a phrase for each comparison', () => {
    expect(compareLabel('matching')).toMatch(/true/);
    expect(compareLabel('bigger')).toMatch(/bigger/);
    expect(compareLabel('smaller')).toMatch(/smaller/);
    expect(compareLabel(null)).toBeNull();
  });
});

describe('fetchBuoyObservation', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    vi.stubEnv('VITE_PUSH_API_URL', 'https://worker.example.com');
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it('returns null rather than throwing when the Worker is unreachable', async () => {
    fetch.mockRejectedValue(new Error('offline'));
    await expect(fetchBuoyObservation({ lat: 33, lon: -117 })).resolves.toBeNull();
  });

  it('returns null on a non-ok response', async () => {
    fetch.mockResolvedValue({ ok: false, json: async () => ({}) });
    await expect(fetchBuoyObservation({ lat: 33, lon: -117 })).resolves.toBeNull();
  });

  it('returns null when no buoy is in range', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ observation: null }) });
    await expect(fetchBuoyObservation({ lat: 33, lon: -117 })).resolves.toBeNull();
  });

  it('passes a real observation through', async () => {
    const observation = { station: '46224', km: 19, waveFt: 4.3, period: 13, ageMinutes: 22 };
    fetch.mockResolvedValue({ ok: true, json: async () => ({ observation }) });
    await expect(fetchBuoyObservation({ lat: 33, lon: -117 })).resolves.toEqual(observation);
  });

  it('does not call out at all without a spot', async () => {
    await expect(fetchBuoyObservation(null)).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('stays silent when no Worker is configured', async () => {
    vi.stubEnv('VITE_PUSH_API_URL', '');
    await expect(fetchBuoyObservation({ lat: 33, lon: -117 })).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
