import { describe, it, expect } from 'vitest';
import {
  addSample, freshSamples, calibration, applyCalibration, calibrationLabel,
  MIN_SAMPLES, MAX_SAMPLES, MAX_SAMPLE_AGE_MS,
} from './calibration.js';

const HOUR = 60 * 60 * 1000;
// n paired readings, one an hour apart, where the buoy reads `factor` times the forecast.
function samples(n, factor, { forecastFt = 4, now = Date.now() } = {}) {
  let list = [];
  for (let i = 0; i < n; i++) {
    list = addSample(list, { forecastFt, observedFt: forecastFt * factor, at: now - i * HOUR });
  }
  return list;
}

describe('addSample', () => {
  it('keeps the newest first', () => {
    const now = Date.now();
    let list = addSample([], { forecastFt: 4, observedFt: 4, at: now - HOUR });
    list = addSample(list, { forecastFt: 5, observedFt: 5, at: now });
    expect(list[0].f).toBe(5);
  });

  it('takes at most one sample an hour', () => {
    const now = Date.now();
    let list = addSample([], { forecastFt: 4, observedFt: 5, at: now });
    list = addSample(list, { forecastFt: 4, observedFt: 5, at: now + 60000 });
    list = addSample(list, { forecastFt: 4, observedFt: 5, at: now + 120000 });
    // The buoy only updates every 30-60 min; repeats of one reading must not be weighted
    // as though they were many independent observations.
    expect(list).toHaveLength(1);
  });

  it('ignores a pairing with nothing to compare', () => {
    expect(addSample([], { forecastFt: 0, observedFt: 4 })).toHaveLength(0);
    expect(addSample([], { forecastFt: 4, observedFt: 0 })).toHaveLength(0);
    expect(addSample([], { forecastFt: null, observedFt: null })).toHaveLength(0);
  });

  it('is capped so it cannot grow without limit', () => {
    expect(samples(MAX_SAMPLES + 30, 1.2)).toHaveLength(MAX_SAMPLES);
  });

  it('tolerates a missing or corrupt list', () => {
    expect(addSample(null, { forecastFt: 4, observedFt: 4 })).toHaveLength(1);
    expect(addSample(undefined, { forecastFt: 4, observedFt: 4 })).toHaveLength(1);
  });
});

describe('freshSamples', () => {
  it('drops samples too old to be evidence about this season', () => {
    const now = Date.now();
    const old = [{ f: 4, o: 5, at: now - MAX_SAMPLE_AGE_MS - HOUR }];
    expect(freshSamples(old, now)).toHaveLength(0);
  });
  it('survives junk entries', () => {
    expect(freshSamples([null, {}, { f: 0, o: 1, at: Date.now() }])).toHaveLength(0);
    expect(freshSamples('nonsense')).toEqual([]);
  });
});

describe('calibration', () => {
  it('says nothing until there is enough evidence', () => {
    const cal = calibration(samples(MIN_SAMPLES - 1, 1.3));
    expect(cal.ready).toBe(false);
    expect(cal.ratio).toBe(1);
    expect(cal.needed).toBe(MIN_SAMPLES);
  });

  it('learns that a spot runs bigger than forecast', () => {
    const cal = calibration(samples(20, 1.3));
    expect(cal.ready).toBe(true);
    expect(cal.ratio).toBeCloseTo(1.3, 1);
    expect(cal.percent).toBe(30);
  });

  it('learns that a spot runs smaller', () => {
    const cal = calibration(samples(20, 0.75));
    expect(cal.ready).toBe(true);
    expect(cal.percent).toBe(-25);
  });

  it('leaves an unbiased forecast alone', () => {
    expect(calibration(samples(20, 1)).ratio).toBe(1);
  });

  it('is not thrown off by one freak reading', () => {
    const now = Date.now();
    let list = samples(20, 1.2, { now });
    // A buoy dropout reading ten times the forecast.
    list = addSample(list, { forecastFt: 4, observedFt: 40, at: now + HOUR });
    expect(calibration(list, now + HOUR).ratio).toBeCloseTo(1.2, 1);
  });

  it('is not dominated by the rare big days', () => {
    const now = Date.now();
    // Ordinary days run true; two huge days ran double. The ordinary days are what matters.
    let list = [];
    for (let i = 0; i < 20; i++) list = addSample(list, { forecastFt: 3, observedFt: 3, at: now - i * HOUR });
    list = addSample(list, { forecastFt: 15, observedFt: 30, at: now - 30 * HOUR });
    list = addSample(list, { forecastFt: 15, observedFt: 30, at: now - 31 * HOUR });
    expect(calibration(list, now).ratio).toBeCloseTo(1, 1);
  });

  it('refuses a correction so large the pairing must be wrong', () => {
    // The wrong buoy, or a spot that simply does not track it.
    const cal = calibration(samples(20, 6));
    expect(cal.ready).toBe(false);
    expect(cal.rejected).toBe(true);
    expect(cal.ratio).toBe(1);
  });

  it('handles empty and junk input', () => {
    for (const v of [[], null, undefined, 'nope']) {
      expect(calibration(v).ready).toBe(false);
      expect(calibration(v).ratio).toBe(1);
    }
  });
});

describe('applyCalibration', () => {
  it('corrects the height once the bias is known', () => {
    const cal = calibration(samples(20, 1.25));
    expect(applyCalibration(4, cal)).toBeCloseTo(5, 1);
  });
  it('changes nothing while the bias is unknown', () => {
    expect(applyCalibration(4, calibration([]))).toBe(4);
    expect(applyCalibration(4, null)).toBe(4);
  });
  it('passes a missing height through', () => {
    expect(applyCalibration(null, calibration(samples(20, 1.3)))).toBeNull();
  });
});

describe('calibrationLabel', () => {
  it('reports a correction worth knowing about', () => {
    expect(calibrationLabel(calibration(samples(20, 1.3)))).toMatch(/30% bigger/);
    expect(calibrationLabel(calibration(samples(20, 0.7)))).toMatch(/30% smaller/);
  });
  it('stays quiet about a correction inside the noise of reading a wave', () => {
    expect(calibrationLabel(calibration(samples(20, 1.04)))).toBeNull();
  });
  it('stays quiet until it is settled', () => {
    expect(calibrationLabel(calibration(samples(3, 1.4)))).toBeNull();
    expect(calibrationLabel(null)).toBeNull();
  });
  it('says how much evidence it is based on', () => {
    expect(calibrationLabel(calibration(samples(20, 1.3)))).toMatch(/20 checks/);
  });
});
