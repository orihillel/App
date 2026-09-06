import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchBuoyObservation, fetchWaveGrid, formatAge, compareToForecast, compareLabel } from './buoy.js';

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

// fetchWaveGrid copies fields out of the Worker's answer one by one, which is the same shape of
// code that lost the wave directions on the Worker's side of the wire: they were fetched,
// stored and then dropped by a response builder that nobody had added the new field to. This is
// the other half of that trip, and it had no test at all.
describe('fetchWaveGrid', () => {
  const GRID = {
    generatedAt: 1757160000000, cells: 406, data: 'aGVpZ2h0cw==', dirs: 'ZGlyZWN0aW9ucw==',
    stale: false, coverage: 1, build: { batchesDone: 5, batchesTotal: 5 },
  };
  const respond = (body, ok = true) => vi.fn(async () => ({ ok, json: async () => body }));

  beforeEach(() => vi.stubEnv('VITE_PUSH_API_URL', 'https://worker.test'));
  afterEach(() => vi.unstubAllEnvs());

  it('carries every field the globe reads, directions included', async () => {
    vi.stubGlobal('fetch', respond(GRID));
    const out = await fetchWaveGrid();
    expect(out.data).toBe(GRID.data);
    expect(out.dirs).toBe(GRID.dirs);
    expect(out.cells).toBe(GRID.cells);
    expect(out.generatedAt).toBe(GRID.generatedAt);
    expect(out.stale).toBe(false);
    expect(out.build).toEqual(GRID.build);
  });

  it('gives null directions for a grid that has none, rather than undefined', async () => {
    // The globe branches on this to decide whether to build the arrow field at all, and to say
    // "no wave directions in this grid yet" in the legend. Undefined would work by accident;
    // null is the answer it is actually checking for.
    const { dirs, ...withoutDirs } = GRID; // eslint-disable-line no-unused-vars
    vi.stubGlobal('fetch', respond(withoutDirs));
    expect((await fetchWaveGrid()).dirs).toBeNull();
  });

  it('ignores a dirs field that is not a string', async () => {
    vi.stubGlobal('fetch', respond({ ...GRID, dirs: { nope: true } }));
    expect((await fetchWaveGrid()).dirs).toBeNull();
  });

  it('keeps the build diagnostics when there is no grid to draw', async () => {
    vi.stubGlobal('fetch', respond({ grid: null, build: { lastError: 'rate limited' } }));
    const out = await fetchWaveGrid();
    expect(out.data).toBeNull();
    expect(out.build.lastError).toBe('rate limited');
  });

  it('returns nothing at all rather than throwing when the Worker is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await fetchWaveGrid()).toBeNull();
    vi.stubGlobal('fetch', respond({}, false));
    expect(await fetchWaveGrid()).toBeNull();
  });

  it('does not call out at all when no Worker is configured', async () => {
    vi.stubEnv('VITE_PUSH_API_URL', '');
    const fetchImpl = respond(GRID);
    vi.stubGlobal('fetch', fetchImpl);
    expect(await fetchWaveGrid()).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
