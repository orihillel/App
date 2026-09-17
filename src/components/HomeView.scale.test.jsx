import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HomeView } from './HomeView.jsx';

// The wave-height setting is only worth anything if it reaches the number people actually read:
// the big one on the spot card. The transform itself is covered in lib/format.test.js -- what
// these assert is the wiring, that the preference is threaded all the way from Profile to this
// card, and that the heights which are *not* the surf forecast stay where they are.

const HOUR_ROW = {
  t: '7a', hour: 7, wave: '4-6', period: 12, swellDir: 'SW', swellDeg: 225,
  windSpd: 5, windDir: 'E', windDeg: 90, type: 'offshore', rating: 'GOOD', score: 5, trains: [],
};
const SPOT = { name: 'Maravi', region: 'Tel Aviv, Israel', blurb: 'A spot.', lat: 32.1, lon: 34.8, offshoreDeg: 90 };

function renderHome(props = {}) {
  return render(
    <HomeView
      units="imperial" toggleUnits={() => {}} openSearch={() => {}} openMenu={() => {}}
      spot={SPOT} isGoTo={false} makeGoTo={() => {}} showSpotNav={false}
      onPrevSpot={() => {}} onNextSpot={() => {}}
      h={HOUR_ROW} dataState="ok" fetchedAt={Date.now()} retry={() => {}}
      waveChart={{ d: 'M0,0', pts: [[0, 0]] }} hourIdx={0} setHourIdx={() => {}} hourData={[HOUR_ROW]}
      activeId="maravi" contData={null} contWaveLine={null} contTideLine={null} contWindLine={null}
      contSelected={null} contSelectedIdx={null} setContSelectedIdx={() => {}}
      tideToday={null} tide={null} tideNext={null}
      best={null} waterC={null} wetsuit={null} agreement={null} buoy={null}
      onLogSession={() => {}} calibration={null}
      {...props}
    />
  );
}

describe('HomeView wave-height scale', () => {
  it('prints the forecast unchanged when no preference is set', () => {
    renderHome();
    expect(screen.getAllByText('4-6').length).toBeGreaterThan(0);
  });

  it('prints the forecast unchanged at the default scale', () => {
    renderHome({ waveScale: 1 });
    expect(screen.getAllByText('4-6').length).toBeGreaterThan(0);
  });

  it('reads the card in the scale the surfer set', () => {
    renderHome({ waveScale: 0.5 });
    expect(screen.getAllByText('2-3').length).toBeGreaterThan(0);
    expect(screen.queryByText('4-6')).toBeNull();
  });

  it('reads bigger as well as smaller', () => {
    renderHome({ waveScale: 1.5 });
    expect(screen.getAllByText('6-9').length).toBeGreaterThan(0);
  });

  it('leaves a buoy reading alone, because that one is a measurement', () => {
    // Scaling a number a buoy actually recorded would turn a preference into a false claim
    // about the ocean, and the card sets this one next to the forecast on purpose.
    renderHome({ waveScale: 0.5, buoy: { waveFt: 8, periodS: 12, station: '46053', observedAt: Date.now() } });
    expect(screen.getByText(/^8ft$/)).toBeTruthy();
  });
});
