import { describe, it, expect } from 'vitest';
import {
  addSample, freshSamples, calibration, applyCalibration, calibrationLabel,
  recalibrateHours, recalibrateContinuous,
  MIN_SAMPLES, MAX_SAMPLES, MAX_SAMPLE_AGE_MS,
} from './calibration.js';
import { conditionsScore, scoreToRating } from './rating.js';
import { breakingHeightFt, surfRange } from './surf.js';

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
    // Pinned to the middle of an hour rather than Date.now(). Samples are bucketed by clock
    // hour, so a wall-clock `now` within two minutes of the top of an hour puts the third
    // sample in the *next* bucket and this fails — for about two minutes in every sixty. It
    // did exactly that at 20:59.
    const now = Date.parse('2026-09-05T14:30:00Z');
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

describe('recalibrateHours', () => {
  const SPOT = { offshoreDeg: 60 };

  // Shaped the way fetchSpotForecast actually builds an hour, including the fields it stores
  // purely so this function can read them back: waveFt, tidePosition, windMph. Fields taken
  // from `given` first, so an override actually feeds the score/wave it derives rather than
  // being spread on top of values computed from the defaults instead of it.
  function hour(given = {}) {
    const waveFt = given.waveFt ?? 3;
    const windMph = given.windMph ?? 8;
    const type = given.type ?? 'offshore';
    const period = given.period ?? 11;
    const swellDeg = given.swellDeg ?? 220;
    const tidePosition = given.tidePosition ?? 0.4;
    const trains = given.trains ?? [{ heightFt: 2.6, period: 13, deg: 210, dir: 'SSW', kind: 'groundswell' }];
    const dominant = trains[0] || null;
    const scorePeriod = dominant && dominant.period != null ? dominant.period : period;
    const scoreSwellDeg = dominant && dominant.deg != null ? dominant.deg : swellDeg;
    // waveFt is the offshore significant height; surfFt the breaking height derived from it,
    // which is what the card shows and what the score is built on. See lib/surf.js.
    const surfFt = breakingHeightFt(waveFt, scorePeriod);
    const score = conditionsScore(surfFt, windMph, type, scorePeriod, scoreSwellDeg, SPOT.offshoreDeg, tidePosition, SPOT);
    return {
      t: '7a', hour: 7, wave: surfRange(surfFt), period, swellDir: 'SW', swellDeg,
      windSpd: Math.round(windMph), windDir: 'ENE', windDeg: 60, type, score, rating: scoreToRating(score),
      trains, waveFt, surfFt, tidePosition, windMph,
      ...given,
    };
  }

  it('is a no-op when calibration is not ready', () => {
    const hours = [hour()];
    expect(recalibrateHours(hours, { ready: false }, SPOT)).toBe(hours);
    expect(recalibrateHours(hours, null, SPOT)).toBe(hours);
  });

  it('reproduces every field exactly at ratio 1 -- the property that makes trusting this safe', () => {
    const original = hour();
    const [out] = recalibrateHours([original], { ready: true, ratio: 1 }, SPOT);
    expect(out).toEqual(original);
  });

  it('corrects the swell trains too, since they sit on screen under the corrected height', () => {
    const original = hour({ trains: [
      { heightFt: 2.6, period: 13, deg: 210, dir: 'SSW', kind: 'groundswell' },
      { heightFt: 1.0, period: 6, deg: 280, dir: 'W', kind: 'windswell' },
    ] });
    const [out] = recalibrateHours([original], { ready: true, ratio: 1.5 }, SPOT);
    expect(out.trains[0].heightFt).toBeCloseTo(3.9, 10);
    expect(out.trains[1].heightFt).toBeCloseTo(1.5, 10);
    // Everything else about a train is untouched, and the order the score depends on holds.
    expect(out.trains[0].kind).toBe('groundswell');
    expect(out.trains[0].period).toBe(13);
    expect(out.trains[0].heightFt).toBeGreaterThan(out.trains[1].heightFt);
  });

  it('passes a missing or empty train list through rather than throwing', () => {
    expect(recalibrateHours([hour({ trains: [] })], { ready: true, ratio: 1.5 }, SPOT)[0].trains).toEqual([]);
    expect(recalibrateHours([hour({ trains: undefined })], { ready: true, ratio: 1.5 }, SPOT)[0].trains).toBeUndefined();
  });

  it('scales the offshore height by the ratio and re-derives the breaking height from it', () => {
    const [out] = recalibrateHours([hour({ waveFt: 3 })], { ready: true, ratio: 1.5 }, SPOT);
    expect(out.waveFt).toBeCloseTo(4.5, 5);
    // Not 4.5 * anything: the transform is re-run on the corrected offshore height, because it
    // is non-linear in height and scaling its output would be a different operation.
    expect(out.surfFt).toBeCloseTo(breakingHeightFt(4.5, 13), 5);
    expect(out.wave).toBe(surfRange(breakingHeightFt(4.5, 13)));
  });

  it('re-derives rather than scales, which is measurably not the same thing', () => {
    // Hb scales with H0^0.8, so correcting the offshore height by 1.5x moves the breaking
    // height by less than 1.5x. Applying the ratio to the transformed number would overshoot.
    const original = hour({ waveFt: 3 });
    const [out] = recalibrateHours([original], { ready: true, ratio: 1.5 }, SPOT);
    expect(out.surfFt).toBeLessThan(original.surfFt * 1.5);
    expect(out.surfFt).toBeGreaterThan(original.surfFt);
  });

  it('raises the rating when the correction pushes wave height into a bigger bucket', () => {
    // 2.4ft scores nothing for size; 1.5x makes it 3.6ft, which crosses the >=2.5 threshold.
    const small = hour({ waveFt: 2.4 });
    const boosted = recalibrateHours([small], { ready: true, ratio: 1.5 }, SPOT)[0];
    expect(boosted.score).toBeGreaterThan(small.score);
  });

  it('lowers the rating when the correction shrinks a spot that runs smaller than forecast', () => {
    const big = hour({ waveFt: 5 });
    const shrunk = recalibrateHours([big], { ready: true, ratio: 0.5 }, SPOT)[0];
    expect(shrunk.score).toBeLessThan(big.score);
  });

  it("scores against the dominant train's period and direction, not the hour's raw ones", () => {
    // Raw period/swellDeg say short-period wind chop from due north; the stored dominant train
    // says long-period groundswell from the SSW. The score at fetch time used the train --
    // recompute must keep doing that, or a calibrated hour would rate differently from how the
    // same numbers were rated the first time, for a reason with nothing to do with calibration.
    const h = hour({
      period: 6, swellDeg: 0,
      trains: [{ heightFt: 2.6, period: 14, deg: 210, dir: 'SSW', kind: 'groundswell' }],
    });
    const [out] = recalibrateHours([h], { ready: true, ratio: 1 }, SPOT);
    expect(out.score).toBe(h.score); // both built from the train, so ratio 1 must still match
    const viaRaw = conditionsScore(h.waveFt, h.windMph, h.type, h.period, h.swellDeg, SPOT.offshoreDeg, h.tidePosition, SPOT);
    expect(out.score).not.toBe(viaRaw); // and the raw fields would have scored it differently
  });

  it('uses the unrounded wind speed, not windSpd, so a threshold-straddling hour recomputes identically', () => {
    // 10.3mph is "still offshore but past the light-wind bonus" (<=10 fails); rounded to
    // windSpd=10 it would wrongly pass that check on recompute.
    const h = hour({ windMph: 10.3, windSpd: 10 });
    const [out] = recalibrateHours([h], { ready: true, ratio: 1 }, SPOT);
    expect(out.score).toBe(h.score);
  });

  it('keeps rating in step with the recomputed score, not the original one', () => {
    // The mutation this catches: score updates but rating is copied from the input hour, so a
    // corrected wave height sits next to a badge computed from the number underneath it -- the
    // exact inconsistency calibration existed to fix, reintroduced one field over.
    // 1.5ft offshore at 13s rates GOOD; corrected by 1.5x it rates FIRING. The pair has to
    // straddle a bucket or a copied rating would be indistinguishable from a recomputed one.
    const small = hour({ waveFt: 1.5 });
    const [out] = recalibrateHours([small], { ready: true, ratio: 1.5 }, SPOT);
    expect(small.rating).toBe('GOOD');
    expect(out.rating).toBe('FIRING');
    expect(out.rating).toBe(scoreToRating(out.score));
  });

  it('leaves an hour with no raw wave height untouched', () => {
    const placeholder = { hour: 9, wave: '—', score: null, rating: 'LOADING', waveFt: null };
    const [out] = recalibrateHours([placeholder], { ready: true, ratio: 1.4 }, SPOT);
    expect(out).toBe(placeholder);
  });
});

describe('recalibrateContinuous', () => {
  it('is a no-op when calibration is not ready', () => {
    const points = [{ waveFt: 3, score: 5, rating: 'GOOD' }];
    expect(recalibrateContinuous(points, { ready: false })).toBe(points);
  });

  it('scales waveFt and leaves every other field, including score and rating, untouched', () => {
    const point = { waveFt: 2, tideFt: 0.4, windSpd: 8, score: 5, rating: 'GOOD', day: 'Tue', hour: 7 };
    const [out] = recalibrateContinuous([point], { ready: true, ratio: 1.25 });
    expect(out.waveFt).toBeCloseTo(2.5, 5);
    expect(out.tideFt).toBe(point.tideFt);
    expect(out.score).toBe(point.score); // nothing on screen reads this; recomputing it is not the job
    expect(out.rating).toBe(point.rating);
  });

  it('leaves a point with no wave height untouched', () => {
    const point = { waveFt: null, tideFt: 0.2 };
    const [out] = recalibrateContinuous([point], { ready: true, ratio: 1.5 });
    expect(out).toBe(point);
  });
});
