import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OnboardingView } from './OnboardingView.jsx';
import { ONBOARDING_PICKS, SPOTS } from '../lib/spots.js';

describe('OnboardingView', () => {
  it('lists every onboarding pick by name', () => {
    render(<OnboardingView activeId="trestles" pickOnboardingSpot={() => {}} openSearch={() => {}} openGlobePicker={() => {}} completeOnboarding={() => {}} />);
    ONBOARDING_PICKS.forEach((id) => {
      expect(screen.getByText(SPOTS[id].name)).toBeInTheDocument();
    });
  });

  it('picks a spot when its card is clicked', () => {
    const pickOnboardingSpot = vi.fn();
    render(<OnboardingView activeId="trestles" pickOnboardingSpot={pickOnboardingSpot} openSearch={() => {}} openGlobePicker={() => {}} completeOnboarding={() => {}} />);
    fireEvent.click(screen.getByText(SPOTS.pipeline.name));
    expect(pickOnboardingSpot).toHaveBeenCalledWith('pipeline');
  });

  it('opens search when "Search by name" is clicked', () => {
    const openSearch = vi.fn();
    render(<OnboardingView activeId="trestles" pickOnboardingSpot={() => {}} openSearch={openSearch} openGlobePicker={() => {}} completeOnboarding={() => {}} />);
    fireEvent.click(screen.getByText('Search by name'));
    expect(openSearch).toHaveBeenCalled();
  });

  it('opens the globe picker when "Browse the globe" is clicked', () => {
    const openGlobePicker = vi.fn();
    render(<OnboardingView activeId="trestles" pickOnboardingSpot={() => {}} openSearch={() => {}} openGlobePicker={openGlobePicker} completeOnboarding={() => {}} />);
    fireEvent.click(screen.getByText('Browse the globe'));
    expect(openGlobePicker).toHaveBeenCalled();
  });

  it('skips onboarding with the current active spot when "Skip for now" is clicked', () => {
    const completeOnboarding = vi.fn();
    render(<OnboardingView activeId="trestles" pickOnboardingSpot={() => {}} openSearch={() => {}} openGlobePicker={() => {}} completeOnboarding={completeOnboarding} />);
    fireEvent.click(screen.getByText('Skip for now'));
    expect(completeOnboarding).toHaveBeenCalledWith('trestles');
  });
});
