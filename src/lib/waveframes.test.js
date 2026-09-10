import { describe, it, expect } from 'vitest';
import { frameLabel, frameBuildLabel } from './waveframes.js';

describe('frameLabel', () => {
  it('reads a UTC frame in the viewer\'s own clock', () => {
    // The container runs UTC, so these are directly checkable here.
    expect(frameLabel('2026-09-10T15:00')).toBe('Thu 3pm');
    expect(frameLabel('2026-09-10T00:00')).toBe('Thu 12am');
    expect(frameLabel('2026-09-10T12:00')).toBe('Thu 12pm');
  });

  it('treats a zoneless timestamp as UTC, which is what the build writes', () => {
    // Without this the label is silently wrong by the viewer's offset, and right only in London.
    expect(frameLabel('2026-09-10T15:00')).toBe(frameLabel('2026-09-10T15:00Z'));
  });

  it('says today and tomorrow where they apply', () => {
    const now = Date.parse('2026-09-10T09:00:00Z');
    expect(frameLabel('2026-09-10T18:00', now)).toBe('Today 6pm');
    expect(frameLabel('2026-09-11T06:00', now)).toBe('Tomorrow 6am');
    expect(frameLabel('2026-09-13T06:00', now)).toBe('Sun 6am');
  });

  it('answers empty for junk rather than printing NaN', () => {
    for (const bad of ['', null, undefined, 'not a date', 42]) expect(frameLabel(bad)).toBe('');
  });
});

describe('frameBuildLabel', () => {
  it('says how far along the week is, because "not yet" is not "broken"', () => {
    // The week assembles a couple of frames at a time on a schedule, so this is the normal
    // state for the first couple of hours after a deploy.
    expect(frameBuildLabel({ building: true, ready: 9, wanted: 28 }))
      .toBe('Building the week — 9 of 28 hours ready');
    expect(frameBuildLabel({ building: true, ready: 0, wanted: 28 }))
      .toBe('Building the week — no hours ready yet');
  });

  it('distinguishes a refused request from a build still in progress', () => {
    expect(frameBuildLabel({ aborted: 'timestep-overrun' })).toMatch(/refused the request/);
  });

  it('falls back to a plain sentence when it knows nothing', () => {
    expect(frameBuildLabel(null)).toBe('Animation unavailable right now');
    expect(frameBuildLabel({})).toBe('Animation unavailable right now');
  });
});
