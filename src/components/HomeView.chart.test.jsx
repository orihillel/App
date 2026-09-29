import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HomeView } from './HomeView.jsx';
import { WIND_BANDS } from '../lib/windchart.js';

const WIND_BAND_LABELS = WIND_BANDS.map((b) => b.label);

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

describe('the week wind chart', () => {
  const windy = [
    { ...CONT_ROW, hour: 6, windSpd: 5, windDeg: 90, dayStart: false },   // light, from E (offshore here)
    { ...CONT_ROW, hour: 12, windSpd: 25, windDeg: 270, dayStart: false }, // very strong, from W
  ];

  function renderWindy(extra = {}) {
    return renderHome({ contData: windy, contWaveLine: { d: 'M0,0', pts: [[10, 10], [290, 10]] }, contSelectedIdx: null, contSelected: null, ...extra });
  }

  it('draws an arrow per reading, each labelled with its speed, direction and strength', () => {
    renderWindy();
    expect(screen.getByText('WIND THIS WEEK')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mon 6a: 5 mph from E, light, offshore' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mon 12p: 25 mph from W, very strong, onshore' })).toBeTruthy();
  });

  it('draws a stronger wind as a bigger arrow', () => {
    renderWindy();
    const size = (name) => Number(screen.getByRole('button', { name }).querySelector('svg').getAttribute('width'));
    expect(size(/Mon 12p/)).toBeGreaterThan(size(/Mon 6a/));
  });

  it('keys the directions and says which one is offshore here', () => {
    renderWindy();
    expect(screen.getByText(/Arrows point where the wind is blowing/)).toBeTruthy();
    expect(screen.getByText(/Offshore here is wind from/)).toBeTruthy();
    WIND_BAND_LABELS.forEach((label) => expect(screen.getAllByText(new RegExp('^' + label)).length).toBeGreaterThan(0));
  });

  it('prints speeds in the reader\'s units', () => {
    renderWindy({ units: 'metric' });
    expect(screen.getByRole('button', { name: /Mon 12p: 40 kph from W/ })).toBeTruthy();
  });

  it('is left out when no reading carries wind', () => {
    renderHome();
    expect(screen.queryByText('WIND THIS WEEK')).toBeNull();
  });
});
