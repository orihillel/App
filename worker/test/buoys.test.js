import { describe, it, expect } from 'vitest';
import {
  parseLatestObs, haversineKm, nearestWaveStation, isFresh, toObservation, MAX_AGE_MS,
} from '../src/buoys.js';

// A realistic slice of NDBC's latest_obs.txt, including the two header lines, a station with
// full wave data, one reporting wind only (MM for every wave column), and a short/ragged line.
const SAMPLE = `#STN     LAT      LON  YYYY MM DD hh mm WDIR WSPD  GST WVHT   DPD   APD MWD   PRES  PTDY  ATMP  WTMP  DEWP  VIS   TIDE
#text    deg      deg   yr  mo dy hr mn degT  m/s  m/s    m   sec   sec degT    hPa   hPa  degC  degC  degC  nmi     ft
46224   33.179 -117.471 2026 09 04 07 40  270  3.0  4.0  1.3  13.0   9.0 265 1015.2    MM  18.0  19.4  14.0   MM     MM
46086   32.499 -118.034 2026 09 04 07 50  250  5.0  6.0  1.9  14.0  10.0 270 1014.0    MM  17.0  18.9  13.0   MM     MM
LJAC1   32.867 -117.257 2026 09 04 07 30  300  2.0  3.0   MM    MM    MM  MM 1015.0    MM  19.0  20.1  15.0   MM     MM
51201   21.669 -158.116 2026 09 04 07 30   50  4.0  5.0  2.4  15.0  11.0 315 1013.0    MM  25.0  26.2  20.0   MM     MM
ragged 1.0
`;

describe('parseLatestObs', () => {
  it('reads the stations that have complete rows', () => {
    const rows = parseLatestObs(SAMPLE);
    expect(rows.map((r) => r.station)).toEqual(['46224', '46086', 'LJAC1', '51201']);
  });

  it('parses the wave fields off the right columns', () => {
    const [first] = parseLatestObs(SAMPLE);
    expect(first.lat).toBe(33.179);
    expect(first.lon).toBe(-117.471);
    expect(first.waveHeightM).toBe(1.3);
    expect(first.dominantPeriodS).toBe(13);
    expect(first.meanWaveDirDeg).toBe(265);
    expect(first.waterTempC).toBe(19.4);
  });

  it('turns MM into null rather than NaN', () => {
    const rows = parseLatestObs(SAMPLE);
    const windOnly = rows.find((r) => r.station === 'LJAC1');
    expect(windOnly.waveHeightM).toBeNull();
    expect(windOnly.dominantPeriodS).toBeNull();
    expect(windOnly.waterTempC).toBe(20.1); // still has a temperature
  });

  it('reads the timestamp as UTC', () => {
    const [first] = parseLatestObs(SAMPLE);
    expect(first.observedAt).toBe(Date.UTC(2026, 8, 4, 7, 40));
  });

  it('skips headers and malformed lines instead of throwing', () => {
    expect(parseLatestObs(SAMPLE).some((r) => r.station === 'ragged')).toBe(false);
    expect(parseLatestObs('')).toEqual([]);
    expect(parseLatestObs(null)).toEqual([]);
    expect(parseLatestObs('#only a header')).toEqual([]);
  });
});

describe('haversineKm', () => {
  it('is zero for the same point', () => {
    expect(haversineKm(33, -117, 33, -117)).toBe(0);
  });
  it('gets a known distance about right', () => {
    // San Diego to Los Angeles, roughly 180km.
    const km = haversineKm(32.72, -117.16, 34.05, -118.24);
    expect(km).toBeGreaterThan(160);
    expect(km).toBeLessThan(200);
  });
});

describe('nearestWaveStation', () => {
  const stations = parseLatestObs(SAMPLE);

  it('picks the closest station that actually reports waves', () => {
    // LJAC1 is nearest to this point but reports no wave height, so it must be skipped.
    const best = nearestWaveStation(stations, 32.9, -117.25);
    expect(best.station).toBe('46224');
  });

  it('never returns a station with no wave reading', () => {
    const best = nearestWaveStation(stations, 32.867, -117.257);
    expect(best.waveHeightM).not.toBeNull();
  });

  it('returns nothing rather than a buoy in a different ocean', () => {
    // Hawaii's buoy is thousands of km from California; presenting it beside a Californian
    // spot would imply a correspondence that does not exist.
    expect(nearestWaveStation(stations, 51.5, -0.12)).toBeNull();
    expect(nearestWaveStation(stations, 33.179, -117.471, 1)).not.toBeNull();
  });

  it('finds the Hawaiian buoy for a Hawaiian spot', () => {
    const best = nearestWaveStation(stations, 21.66, -158.05);
    expect(best.station).toBe('51201');
  });

  it('copes with an empty station list', () => {
    expect(nearestWaveStation([], 33, -117)).toBeNull();
  });
});

describe('isFresh', () => {
  const now = Date.UTC(2026, 8, 4, 9, 0);
  it('accepts a recent reading', () => {
    expect(isFresh(Date.UTC(2026, 8, 4, 8, 40), now)).toBe(true);
  });
  it('rejects a stale one rather than passing it off as live', () => {
    expect(isFresh(now - MAX_AGE_MS - 1, now)).toBe(false);
  });
  it('tolerates small clock skew but not a real future timestamp', () => {
    expect(isFresh(now + 5 * 60000, now)).toBe(true);
    expect(isFresh(now + 6 * 60 * 60000, now)).toBe(false);
  });
  it('rejects a missing timestamp', () => {
    expect(isFresh(null, now)).toBe(false);
  });
});

describe('toObservation', () => {
  const now = Date.UTC(2026, 8, 4, 8, 0);
  it('converts to the units the app displays and reports its age', () => {
    const station = nearestWaveStation(parseLatestObs(SAMPLE), 33.179, -117.471);
    const obs = toObservation(station, now);
    expect(obs.station).toBe('46224');
    expect(obs.waveFt).toBeCloseTo(4.3, 1);
    expect(obs.period).toBe(13);
    expect(obs.km).toBe(0);
    expect(obs.ageMinutes).toBe(20);
  });
  it('passes null through', () => expect(toObservation(null)).toBeNull());
});
