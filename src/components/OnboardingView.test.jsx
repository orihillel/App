import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ONBOARDING_PICKS, SPOTS } from '../lib/spots.js';

vi.mock('../lib/auth.js', () => ({ isAuthConfigured: vi.fn() }));
vi.mock('./AuthButtons.jsx', () => ({ AuthButtons: () => <div data-testid="auth-buttons-stub" /> }));

const { isAuthConfigured } = await import('../lib/auth.js');
const { OnboardingView } = await import('./OnboardingView.jsx');

function renderOnboarding(overrides = {}) {
  const props = {
    activeId: 'trestles', pickOnboardingSpot: vi.fn(), openSearch: vi.fn(), openGlobePicker: vi.fn(),
    completeOnboarding: vi.fn(), onLoggedIn: vi.fn(), setToast: vi.fn(),
    ...overrides,
  };
  render(<OnboardingView {...props} />);
  return props;
}

describe('OnboardingView', () => {
  beforeEach(() => { isAuthConfigured.mockReturnValue(false); });

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

  it('does not show a sign-in section when no login provider is configured', () => {
    renderOnboarding();
    expect(screen.queryByTestId('auth-buttons-stub')).not.toBeInTheDocument();
    expect(screen.queryByText('OR PICK MANUALLY')).not.toBeInTheDocument();
  });

  it('shows the sign-in section and a divider above the manual picker when a login provider is configured', () => {
    isAuthConfigured.mockReturnValue(true);
    renderOnboarding();
    expect(screen.getByTestId('auth-buttons-stub')).toBeInTheDocument();
    expect(screen.getByText('OR PICK MANUALLY')).toBeInTheDocument();
  });
});
