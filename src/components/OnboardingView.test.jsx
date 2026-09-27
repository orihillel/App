import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ONBOARDING_PICKS } from '../lib/spots.js';
import { CATALOG as SPOTS } from '../lib/spots.catalog.js';

import { OnboardingView } from './OnboardingView.jsx';

function renderOnboarding(overrides = {}) {
  const props = {
    spots: SPOTS,
    activeId: 'trestles', pickOnboardingSpot: vi.fn(), openSearch: vi.fn(), openGlobePicker: vi.fn(),
    completeOnboarding: vi.fn(),
    ...overrides,
  };
  render(<OnboardingView {...props} />);
  return props;
}

describe('OnboardingView', () => {
  it('lists every onboarding pick by name', () => {
    renderOnboarding();
    ONBOARDING_PICKS.forEach((id) => {
      expect(screen.getByText(SPOTS[id].name)).toBeInTheDocument();
    });
  });

  it('picks a spot when its card is clicked', () => {
    const props = renderOnboarding();
    fireEvent.click(screen.getByText(SPOTS.pipeline.name));
    expect(props.pickOnboardingSpot).toHaveBeenCalledWith('pipeline');
  });

  it('opens search when "Search by name" is clicked', () => {
    const props = renderOnboarding();
    fireEvent.click(screen.getByText('Search by name'));
    expect(props.openSearch).toHaveBeenCalled();
  });

  it('opens the globe picker when "Browse the globe" is clicked', () => {
    const props = renderOnboarding();
    fireEvent.click(screen.getByText('Browse the globe'));
    expect(props.openGlobePicker).toHaveBeenCalled();
  });

  it('skips onboarding with the current active spot when "Skip for now" is clicked', () => {
    const props = renderOnboarding();
    fireEvent.click(screen.getByText('Skip for now'));
    expect(props.completeOnboarding).toHaveBeenCalledWith('trestles');
  });
});
