import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ONBOARDING_PICKS } from '../lib/spots.js';
import { CATALOG as SPOTS } from '../lib/spots.catalog.js';
import { boardLabel, skillLabel } from '../lib/surfer.js';

import { OnboardingView } from './OnboardingView.jsx';
import { hasAlertsStep } from '../lib/push.js';

function renderOnboarding(overrides = {}) {
  const props = {
    spots: SPOTS, picks: [],
    togglePick: vi.fn(), openSearch: vi.fn(), openGlobePicker: vi.fn(),
    surferProfile: { board: 'shortboard', skill: 'intermediate' }, updateProfile: vi.fn(),
    pushState: 'ready', pushSubscribed: false, pushBusy: false, enablePush: vi.fn(() => Promise.resolve()),
    finish: vi.fn(),
    ...overrides,
  };
  const utils = render(<OnboardingView {...props} />);
  return { props, ...utils };
}

describe('OnboardingView: spots', () => {
  it('lists every onboarding pick by name', () => {
    renderOnboarding();
    ONBOARDING_PICKS.forEach((id) => {
      expect(screen.getByText(SPOTS[id].name)).toBeInTheDocument();
    });
  });

  it('ticks a spot when its card is clicked', () => {
    const { props } = renderOnboarding();
    fireEvent.click(screen.getByText(SPOTS.pipeline.name));
    expect(props.togglePick).toHaveBeenCalledWith('pipeline');
  });

  it('marks ticked spots as pressed and the first one as the go-to', () => {
    renderOnboarding({ picks: ['pipeline', 'trestles'] });
    const pipe = screen.getByText(SPOTS.pipeline.name).closest('button');
    const trestles = screen.getByText(SPOTS.trestles.name).closest('button');
    expect(pipe.getAttribute('aria-pressed')).toBe('true');
    expect(trestles.getAttribute('aria-pressed')).toBe('true');
    expect(pipe.textContent).toContain('GO-TO');
    expect(trestles.textContent).not.toContain('GO-TO');
  });

  it('lists a spot ticked from search even when it is not one of the suggestions', () => {
    renderOnboarding({ picks: ['mavericks'] });
    expect(screen.getByText(SPOTS.mavericks.name).closest('button').getAttribute('aria-pressed')).toBe('true');
  });

  it('will not continue with nothing ticked, but can be skipped', () => {
    renderOnboarding();
    expect(screen.getByText('Pick at least one spot').closest('button').disabled).toBe(true);
    fireEvent.click(screen.getByText('Skip for now'));
    expect(screen.getByText('What do you ride?')).toBeInTheDocument();
  });

  it('counts the ticked spots on the continue button', () => {
    renderOnboarding({ picks: ['pipeline', 'trestles'] });
    fireEvent.click(screen.getByText('Continue with 2 spots'));
    expect(screen.getByText('What do you ride?')).toBeInTheDocument();
  });

  it('opens search and the globe', () => {
    const { props } = renderOnboarding();
    fireEvent.click(screen.getByText('Search by name'));
    fireEvent.click(screen.getByText('Browse the globe'));
    expect(props.openSearch).toHaveBeenCalled();
    expect(props.openGlobePicker).toHaveBeenCalled();
  });
});

describe('OnboardingView: board and level', () => {
  function atBoardStep(overrides) {
    const r = renderOnboarding({ picks: ['pipeline'], ...overrides });
    fireEvent.click(screen.getByText('Continue with 1 spot'));
    return r;
  }

  it('sets the board and the level through the profile', () => {
    const { props } = atBoardStep();
    fireEvent.click(screen.getByText(boardLabel('longboard')));
    fireEvent.click(screen.getByText(skillLabel('beginner')));
    expect(props.updateProfile).toHaveBeenCalledWith({ board: 'longboard' });
    expect(props.updateProfile).toHaveBeenCalledWith({ skill: 'beginner' });
  });

  it('shows the current board as pressed', () => {
    atBoardStep({ surferProfile: { board: 'fish', skill: 'advanced' } });
    expect(screen.getByText(boardLabel('fish')).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(skillLabel('advanced')).getAttribute('aria-pressed')).toBe('true');
  });

  it('goes back to the spots', () => {
    atBoardStep();
    fireEvent.click(screen.getByText('Back'));
    expect(screen.getByText('Pick the spots you surf')).toBeInTheDocument();
  });
});

describe('OnboardingView: alerts', () => {
  function atAlertsStep(overrides) {
    const r = renderOnboarding({ picks: ['pipeline'], ...overrides });
    fireEvent.click(screen.getByText('Continue with 1 spot'));
    fireEvent.click(screen.getByText('Continue'));
    return r;
  }

  it('explains alerts before asking for permission, and asks only on a tap', () => {
    const { props } = atAlertsStep();
    expect(screen.getByText("Know when it's on")).toBeInTheDocument();
    expect(props.enablePush).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Turn on notifications'));
    expect(props.enablePush).toHaveBeenCalledTimes(1);
  });

  it('finishes after notifications are turned on', async () => {
    const { props } = atAlertsStep();
    fireEvent.click(screen.getByText('Turn on notifications'));
    await vi.waitFor(() => expect(props.finish).toHaveBeenCalled());
  });

  it('finishes without asking on "Not now"', () => {
    const { props } = atAlertsStep();
    fireEvent.click(screen.getByText('Not now'));
    expect(props.finish).toHaveBeenCalled();
    expect(props.enablePush).not.toHaveBeenCalled();
  });

  it('gives an iPhone in a Safari tab the Home Screen step instead of a button that cannot work', () => {
    const { props } = atAlertsStep({ pushState: 'ios-needs-install' });
    expect(screen.queryByText('Turn on notifications')).toBeNull();
    expect(screen.getByText(/Add to Home Screen/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Done'));
    expect(props.finish).toHaveBeenCalled();
  });

  it('skips the step entirely where there is no push to turn on', () => {
    const { props } = renderOnboarding({ picks: ['pipeline'], pushState: 'unconfigured' });
    fireEvent.click(screen.getByText('Continue with 1 spot'));
    fireEvent.click(screen.getByText('Continue'));
    expect(props.finish).toHaveBeenCalled();
    expect(screen.queryByText("Know when it's on")).toBeNull();
  });
});

describe('hasAlertsStep', () => {
  it('is shown only where push can be turned on, now or after installing', () => {
    expect(hasAlertsStep('ready')).toBe(true);
    expect(hasAlertsStep('ios-needs-install')).toBe(true);
    expect(hasAlertsStep('unconfigured')).toBe(false);
    expect(hasAlertsStep('unsupported')).toBe(false);
  });
});
