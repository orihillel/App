import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HomeView } from './HomeView.jsx';

// The week chart and the big number above it have to be the same quantity.
//
// They were not. The card has shown breaking height since lib/surf.js landed; the chart line
// and this readout stayed on `waveFt`, the raw offshore significant height the transform is
// applied to. On a short-period sea those differ by around 20%, so tapping the chart produced
// a height that disagreed with the headline for the same hour -- and, being a single number
// rather than a range, it was the one that looked precise.

const HOUR_ROW = {
  t: '7a', hour: 7, wave: '4-6', period: 12, swellDir: 'SW', swellDeg: 225,
  windSpd: 5, windDir: 'E', windDeg: 90, type: 'offshore', rating: 'GOOD', score: 5, trains: [],
};
const SPOT = { name: 'Maravi', region: 'Tel Aviv, Israel', blurb: 'A spot.', lat: 32.1, lon: 34.8, offshoreDeg: 90 };

// Deliberately far apart, so reading the wrong field cannot pass by rounding.
const CONT_ROW = {
  waveFt: 10, surfFt: 4, period: 12, tideFt: null,
  windSpd: null, windDeg: null, score: 5, rating: 'GOOD',
  day: 'Mon', hour: 7, dayStart: false,
};

function renderHome(props = {}) {
  return render(
    <HomeView
      units="imperial" toggleUnits={() => {}} openSearch={() => {}} openMenu={() => {}}
      spot={SPOT} isGoTo={false} makeGoTo={() => {}} showSpotNav={false}
      onPrevSpot={() => {}} onNextSpot={() => {}}
      h={HOUR_ROW} dataState="ok" fetchedAt={Date.now()} retry={() => {}}
      waveChart={{ d: 'M0,0', pts: [[0, 0]] }} hourIdx={0} setHourIdx={() => {}} hourData={[HOUR_ROW]}
      activeId="maravi"
      contData={[CONT_ROW]}
      contWaveLine={{ d: 'M0,0', pts: [[10, 10]] }}
      contTideLine={{ d: 'M0,0', pts: [[10, 10]] }}
      contWindLine={{ d: 'M0,0', pts: [[10, 10]] }}
      contSelected={CONT_ROW} contSelectedIdx={0} setContSelectedIdx={() => {}}
      tideToday={null} tide={null} tideNext={null}
      best={null} waterC={null} wetsuit={null} agreement={null} buoy={null}
      onLogSession={() => {}} calibration={null}
      {...props}
    />
  );
}

describe('the week chart readout', () => {
  it('reports the breaking height, not the offshore height under it', () => {
    renderHome();
    expect(screen.getByText(/Mon 7a · 4ft/)).toBeTruthy();
  });

  it('does not report the raw model value', () => {
    renderHome();
    expect(screen.queryByText(/Mon 7a · 10ft/)).toBeNull();
  });

  it('reads in the surfer\'s own wave-height scale, as the card does', () => {
    renderHome({ waveScale: 0.5 });
    expect(screen.getByText(/Mon 7a · 2ft/)).toBeTruthy();
  });
});
