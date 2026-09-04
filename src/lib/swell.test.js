import { describe, it, expect } from 'vitest';
import { classifyTrain, describeTrain, swellTrains, wetsuitFor, cToF } from './swell.js';

describe('classifyTrain', () => {
  it('separates travelled swell from locally made wind swell', () => {
    expect(classifyTrain(16)).toBe('groundswell');
    expect(classifyTrain(12)).toBe('groundswell');
    expect(classifyTrain(11)).toBe('mid-period');
    expect(classifyTrain(9)).toBe('mid-period');
    expect(classifyTrain(8)).toBe('windswell');
    expect(classifyTrain(4)).toBe('windswell');
  });
  it('falls back to a neutral label with no period', () => {
    expect(classifyTrain(null)).toBe('swell');
    expect(classifyTrain(undefined)).toBe('swell');
  });
});

describe('describeTrain', () => {
  it('rounds the period and names the direction', () => {
    const t = describeTrain(3.2, 13.6, 225);
    expect(t.period).toBe(14);
    expect(t.dir).toBe('SW');
    expect(t.kind).toBe('groundswell');
  });
  it('drops a train too small to be worth naming', () => {
    expect(describeTrain(0.3, 12, 225)).toBeNull();
    expect(describeTrain(null, 12, 225)).toBeNull();
  });
  it('survives a missing period or direction', () => {
    const t = describeTrain(2, null, null);
    expect(t.period).toBeNull();
    expect(t.dir).toBeNull();
    expect(t.kind).toBe('swell');
  });
});

describe('swellTrains', () => {
  it('lists both trains, biggest first', () => {
    const trains = swellTrains({
      swellHeightFt: 2, swellPeriod: 14, swellDeg: 225,
      windWaveHeightFt: 3, windWavePeriod: 6, windWaveDeg: 270,
    });
    expect(trains).toHaveLength(2);
    expect(trains[0].heightFt).toBe(3);
    expect(trains[0].kind).toBe('windswell');
    expect(trains[1].kind).toBe('groundswell');
  });

  it('keeps the distinction the old single number threw away', () => {
    // Same height, completely different days.
    const clean = swellTrains({ swellHeightFt: 2, swellPeriod: 14, swellDeg: 225 });
    const junk = swellTrains({ windWaveHeightFt: 2, windWavePeriod: 6, windWaveDeg: 270 });
    expect(clean[0].kind).toBe('groundswell');
    expect(junk[0].kind).toBe('windswell');
  });

  it('drops the negligible train instead of listing a ripple', () => {
    const trains = swellTrains({
      swellHeightFt: 3, swellPeriod: 14, swellDeg: 225,
      windWaveHeightFt: 0.2, windWavePeriod: 4, windWaveDeg: 270,
    });
    expect(trains).toHaveLength(1);
    expect(trains[0].kind).toBe('groundswell');
  });

  it('returns an empty list when there is nothing in the water', () => {
    expect(swellTrains({})).toEqual([]);
  });
});

describe('wetsuitFor', () => {
  it('gets colder as the water does', () => {
    expect(wetsuitFor(2)).toMatch(/6\/5/);
    expect(wetsuitFor(8)).toMatch(/5\/4/);
    expect(wetsuitFor(12)).toMatch(/4\/3/);
    expect(wetsuitFor(15)).toMatch(/3\/2/);
    expect(wetsuitFor(19)).toMatch(/2mm/);
    expect(wetsuitFor(26)).toMatch(/Boardshorts/);
  });
  it('never returns undefined for any real water temperature', () => {
    for (let c = -2; c <= 35; c += 0.5) expect(typeof wetsuitFor(c)).toBe('string');
  });
  it('says nothing without a reading', () => {
    expect(wetsuitFor(null)).toBeNull();
    expect(wetsuitFor(undefined)).toBeNull();
    expect(wetsuitFor(NaN)).toBeNull();
  });
});

describe('cToF', () => {
  it('converts', () => {
    expect(cToF(0)).toBe(32);
    expect(cToF(100)).toBe(212);
    expect(Math.round(cToF(18))).toBe(64);
  });
  it('passes null through', () => expect(cToF(null)).toBeNull());
});
