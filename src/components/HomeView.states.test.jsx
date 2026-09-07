import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HomeView } from './HomeView.jsx';

// The worst bug this app has had: when a fetch was slow or failed, the spot page filled itself
// with PLACEHOLDER_HOURS -- a believable 3-5ft at 12s from the SW, a sine-wave week, a tide
// curve -- rendered in exactly the same type as real data, with "Live data didn't load for
// this spot" printed directly beneath the numbers it had invented.
//
// These tests are the guard on that. They are not about wording; they assert that when the
// app has no reading, no reading appears.

const HOUR_ROW = {
  t: '7a', hour: 7, wave: '3-4', period: 12, swellDir: 'SW', swellDeg: 225,
  windSpd: 5, windDir: 'E', windDeg: 90, type: 'offshore', rating: 'GOOD', score: 5, trains: [],
};
const SPOT = { name: 'Maravi', region: 'Tel Aviv, Israel', blurb: 'A spot.', lat: 32.1, lon: 34.8, offshoreDeg: 90 };

function renderHome(props = {}) {
  const retry = vi.fn();
  const view = render(
    <HomeView
      units="imperial" toggleUnits={() => {}} openSearch={() => {}} openMenu={() => {}}
      spot={SPOT} isGoTo={false} makeGoTo={() => {}} showSpotNav={false}
      onPrevSpot={() => {}} onNextSpot={() => {}}
      h={null} dataState="loading" fetchedAt={null} retry={retry}
      waveChart={null} hourIdx={0} setHourIdx={() => {}} hourData={null}
      activeId="maravi" contData={null} contWaveLine={null} contTideLine={null} contWindLine={null}
      contSelected={null} contSelectedIdx={null} setContSelectedIdx={() => {}}
      tideToday={null} tide={null} tideNext={null}
      best={null} waterC={null} wetsuit={null} agreement={null} buoy={null}
      onLogSession={() => {}} calibration={null}
      {...props}
    />
  );
  return { ...view, retry };
}

// Everything the old placeholder set put on screen. If any of it shows up in a state where
// the app has no data, the bug is back.
function expectNoInventedNumbers() {
  const text = document.body.textContent;
  // A wave height range, a swell period, a wind speed, a tide height -- in any units.
  expect(text).not.toMatch(/\d+\s*-\s*\d+\s*(ft|m)\b/i);
  expect(text).not.toMatch(/\b\d+s\s+(N|NE|E|SE|S|SW|W|NW)\b/);
  expect(text).not.toMatch(/\b\d+\s*(mph|kph)\b/i);
  expect(text).not.toMatch(/Next (High|Low)/);
}

describe('HomeView data states', () => {
  it('shows no numbers at all while it is still checking', () => {
    renderHome({ dataState: 'loading' });
    expect(screen.getByText('CHECKING…')).toBeTruthy();
    expectNoInventedNumbers();
  });

  it('says plainly that there is no forecast, and offers the one useful action', () => {
    const { retry } = renderHome({ dataState: 'empty' });
    expect(screen.getByText('No forecast right now')).toBeTruthy();
    expectNoInventedNumbers();
    fireEvent.click(screen.getByText(/Try again/));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('never draws a chart out of nothing', () => {
    renderHome({ dataState: 'empty' });
    expect(screen.getByText('No data for today yet')).toBeTruthy();
    expect(screen.getByText('No data for this week yet')).toBeTruthy();
    // The old version drew a full week from PLACEHOLDER_CONTINUOUS -- a pure sine wave that
    // looked exactly like a real forecast. Both chart canvases (300-unit viewBoxes; the icons
    // around them are 24) are simply absent now.
    const charts = [...document.querySelectorAll('svg')].filter((el) => (el.getAttribute('viewBox') || '').startsWith('0 0 300'));
    expect(charts.length).toBe(0);
  });

  it('shows dashes rather than invented values in the summary cards', () => {
    renderHome({ dataState: 'empty' });
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBe(3); // swell, wind, tide
    expect(screen.getByText('Tide unavailable')).toBeTruthy();
  });

  it('shows real numbers, and the rating, once there are any', () => {
    renderHome({ dataState: 'ok', h: HOUR_ROW, hourData: [HOUR_ROW], waveChart: { d: 'M0,0', pts: [[0, 0]] } });
    expect(screen.getByText('GOOD')).toBeTruthy();
    expect(screen.getByText('AT 7A')).toBeTruthy();
    expect(screen.getByText('3-4')).toBeTruthy();
  });

  it('keeps a stale reading but marks it, rather than passing it off as current', () => {
    const fourHoursAgo = Date.now() - 4 * 60 * 60 * 1000;
    renderHome({ dataState: 'stale', h: HOUR_ROW, hourData: [HOUR_ROW], waveChart: { d: 'M0,0', pts: [[0, 0]] }, fetchedAt: fourHoursAgo });
    expect(screen.getByText('LAST KNOWN')).toBeTruthy();
    expect(screen.getByText('4 hr ago')).toBeTruthy();
    expect(screen.getByText(/check the water before you commit/i)).toBeTruthy();
    // The reading is still there -- showing it beats showing nothing -- but the rating badge
    // is not, because a rating is a judgement about conditions right now.
    expect(screen.getByText('3-4')).toBeTruthy();
    expect(screen.queryByText('GOOD')).toBeNull();
  });

  it('does not claim a best window or a water temperature off a stale reading', () => {
    renderHome({
      dataState: 'stale', h: HOUR_ROW, hourData: [HOUR_ROW], waveChart: { d: 'M0,0', pts: [[0, 0]] },
      fetchedAt: Date.now() - 60000,
      best: { startIdx: 0, label: '6–9a', rating: 'GOOD', wave: '3-5', windType: 'offshore' },
      waterC: 17, wetsuit: '3/2 wetsuit',
    });
    expect(screen.queryByText(/best today/)).toBeNull();
    expect(screen.queryByText(/wetsuit/)).toBeNull();
  });

  it('still tells you about the spot itself, which does not depend on the forecast', () => {
    renderHome({ dataState: 'empty' });
    expect(screen.getByText('A spot.')).toBeTruthy();
    expect(screen.getByText('Maravi')).toBeTruthy();
    expect(screen.getByText('Directions')).toBeTruthy();
  });

  it('gives every control a 44px hit area', () => {
    // Measured in the running app: all 21 interactive elements were under 44x44. jsdom has no
    // layout, so this asserts the declared minimums the styles set.
    renderHome({ dataState: 'ok', h: HOUR_ROW, hourData: [HOUR_ROW], waveChart: { d: 'M0,0', pts: [[0, 0]] } });
    const controls = [...document.querySelectorAll('button, a[href]')];
    expect(controls.length).toBeGreaterThan(5);
    for (const el of controls) {
      const label = el.getAttribute('aria-label') || el.textContent;
      const minH = parseFloat(el.style.minHeight);
      expect(minH >= 44, 'min-height of ' + label + ' is ' + el.style.minHeight).toBe(true);
    }
  });
});
