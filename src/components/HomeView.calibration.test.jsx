import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HomeView } from './HomeView.jsx';
import { calibration, addSample } from '../lib/calibration.js';

// The end-to-end browser check for this can't run reliably: stubbing Open-Meteo for a
// 248-spot catalog saturates Playwright's request interception, so the active spot is still
// fetching when the assertion runs. Rendering the view directly is deterministic and tests
// the same thing — that a learned bias reaches the screen.

const HOUR = 60 * 60 * 1000;
function biasedSamples(n, factor) {
  const now = Date.now();
  let list = [];
  for (let i = 0; i < n; i++) {
    list = addSample(list, { forecastFt: 4, observedFt: 4 * factor, at: now - i * HOUR });
  }
  return list;
}

const HOUR_ROW = {
  t: '7a', hour: 7, wave: '3-4', period: 12, swellDir: 'SW', swellDeg: 225,
  windSpd: 5, windDir: 'E', windDeg: 90, type: 'offshore', rating: 'GOOD', score: 5, trains: [],
};

function renderHome(props = {}) {
  return render(
    <HomeView
      setToast={() => {}} units="imperial" toggleUnits={() => {}} openSearch={() => {}}
      spot={{ name: 'Maravi', region: 'Tel Aviv, Israel', blurb: 'A spot.' }}
      isGoTo={false} makeGoTo={() => {}} showSpotNav={false}
      onPrevSpot={() => {}} onNextSpot={() => {}}
      h={HOUR_ROW} isLoading={false} hasError={false} retry={() => {}}
      waveChart={{ d: '', pts: [[0, 0]] }} hourIdx={0} setHourIdx={() => {}} hourData={[HOUR_ROW]}
      activeId="maravi" contData={[{ waveFt: 3, tideFt: 1, windSpd: 5, windDeg: 90, day: 'Tue', hour: 7 }]}
      contWaveLine={{ d: '', pts: [[0, 0]] }} contTideLine={{ d: '', pts: [[0, 0]] }}
      contWindLine={{ d: '', pts: [[0, 0]] }} contSelected={null} contSelectedIdx={null}
      setContSelectedIdx={() => {}}
      tideToday={[1]} tide={{ d: '', pts: [[0, 0]] }} tideNext={null}
      best={null} waterC={null} wetsuit={null} agreement={null} buoy={null}
      onLogSession={() => {}}
      {...props}
    />
  );
}

describe('HomeView calibration line', () => {
  it('reports a learned bias on the forecast card', () => {
    renderHome({ calibration: calibration(biasedSamples(20, 1.3)) });
    expect(screen.getByText(/Runs 30% bigger than forecast here/)).toBeTruthy();
    expect(screen.getByText(/20 checks/)).toBeTruthy();
  });

  it('reports a spot that runs smaller', () => {
    renderHome({ calibration: calibration(biasedSamples(20, 0.7)) });
    expect(screen.getByText(/Runs 30% smaller than forecast here/)).toBeTruthy();
  });

  it('says nothing until there is enough evidence', () => {
    renderHome({ calibration: calibration(biasedSamples(3, 1.4)) });
    expect(screen.queryByText(/Runs \d+%/)).toBeNull();
  });

  it('says nothing about a correction inside the noise', () => {
    renderHome({ calibration: calibration(biasedSamples(20, 1.03)) });
    expect(screen.queryByText(/Runs \d+%/)).toBeNull();
  });

  it('says nothing with no calibration at all', () => {
    renderHome();
    expect(screen.queryByText(/Runs \d+%/)).toBeNull();
  });

  it('stays out of the way while the forecast is still loading', () => {
    // A correction shown beside placeholder numbers would be describing nothing.
    renderHome({ calibration: calibration(biasedSamples(20, 1.3)), isLoading: true });
    expect(screen.queryByText(/Runs \d+%/)).toBeNull();
  });

  it('shows the bias even when the buoy is offline, since it is learned history', () => {
    renderHome({ calibration: calibration(biasedSamples(20, 1.3)), buoy: null });
    expect(screen.getByText(/Runs 30% bigger/)).toBeTruthy();
  });
});
