import { describe, it, expect } from 'vitest';
import { windBars, isOffshoreSide, MIN_SCALE_MPH, GLASSY_MPH } from './windchart.js';

// A beach facing west: wind from the east (90) blows off the land.
const OFFSHORE = 90;
const pt = (windSpd, windDeg, extra = {}) => ({ windSpd, windDeg, hour: 12, ...extra });

describe('isOffshoreSide', () => {
  it('puts wind from the land above the line and wind from the sea below', () => {
    expect(isOffshoreSide(90, OFFSHORE)).toBe(true);   // straight offshore
    expect(isOffshoreSide(270, OFFSHORE)).toBe(false); // straight onshore
    expect(isOffshoreSide(45, OFFSHORE)).toBe(true);
    expect(isOffshoreSide(225, OFFSHORE)).toBe(false);
  });

  it('counts dead cross-shore as not blowing in', () => {
    expect(isOffshoreSide(0, OFFSHORE)).toBe(true);
    expect(isOffshoreSide(180, OFFSHORE)).toBe(true);
  });

  it('wraps round north', () => {
    expect(isOffshoreSide(350, 10)).toBe(true);
    expect(isOffshoreSide(170, 350)).toBe(false);
  });
});

describe('windBars', () => {
  it('draws offshore bars up from the centre line and onshore bars down from it', () => {
    const { bars, mid } = windBars([pt(10, 90), pt(10, 270)], OFFSHORE, { height: 64 });
    expect(bars[0].offshore).toBe(true);
    expect(bars[0].y + bars[0].h).toBeCloseTo(mid); // ends at the line, extends upward
    expect(bars[1].offshore).toBe(false);
    expect(bars[1].y).toBe(mid);                     // starts at the line, extends downward
  });

  it('makes the stronger wind the taller bar, whichever side it is on', () => {
    const { bars } = windBars([pt(5, 90), pt(20, 270)], OFFSHORE);
    expect(bars[1].h).toBeGreaterThan(bars[0].h);
  });

  it('keeps full height for a cross-shore wind rather than zeroing it', () => {
    const { bars } = windBars([pt(20, 0), pt(20, 90)], OFFSHORE);
    expect(bars[0].h).toBeCloseTo(bars[1].h);
    expect(bars[0].color).not.toBe(bars[1].color); // the colour carries the angle
  });

  it('does not let a calm week look like a gale', () => {
    const { bars, top, mid } = windBars([pt(4, 90)], OFFSHORE, { height: 64 });
    expect(top).toBe(MIN_SCALE_MPH);
    expect(bars[0].h).toBeLessThan((mid - 2) / 3);
  });

  it('scales to the windiest reading when it is above the floor', () => {
    const { top } = windBars([pt(30, 90), pt(10, 90)], OFFSHORE);
    expect(top).toBe(30);
  });

  it('marks near-calm readings as glassy', () => {
    const { bars } = windBars([pt(GLASSY_MPH - 1, 270), pt(GLASSY_MPH, 270)], OFFSHORE);
    expect(bars[0].glassy).toBe(true);
    expect(bars[1].glassy).toBe(false);
  });

  it('lines bars up with the week chart above it', () => {
    // linePath in lib/format.js puts point i at pad + i * (width - 2 * pad) / (n - 1).
    const { bars } = windBars([pt(5, 90), pt(5, 90), pt(5, 90)], OFFSHORE, { width: 300, pad: 10 });
    expect(bars.map((b) => b.x)).toEqual([10, 150, 290]);
  });

  it('leaves a gap for a reading with no wind rather than shifting the rest', () => {
    const { bars } = windBars([pt(5, 90), { windSpd: null, windDeg: null }, pt(5, 90)], OFFSHORE, { width: 300, pad: 10 });
    expect(bars[1]).toBeNull();
    expect(bars[2].x).toBe(290);
  });

  it('draws nothing without a spot orientation or any readings', () => {
    expect(windBars([pt(5, 90)], undefined)).toBeNull();
    expect(windBars([], OFFSHORE)).toBeNull();
    expect(windBars(null, OFFSHORE)).toBeNull();
  });
});
