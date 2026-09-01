import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProfileView } from './ProfileView.jsx';

const SPOTS = {
  trestles: { name: 'Lower Trestles', region: 'San Clemente, CA' },
  'custom-1': { name: 'My Local Break', region: 'Added spot' },
};
const ORDER = ['trestles', 'custom-1'];

function renderProfile(overrides = {}) {
  const props = {
    order: ORDER, spots: SPOTS, goToId: 'trestles', setGoToSpot: vi.fn(),
    units: 'imperial', toggleUnits: vi.fn(), alerts: [], openAlerts: vi.fn(),
    removeSpot: vi.fn(), onClose: vi.fn(), onSelectSpot: vi.fn(),
    pushSupported: false, pushSubscribed: false, pushBusy: false, togglePush: vi.fn(),
    ...overrides,
  };
  render(<ProfileView {...props} />);
  return props;
}

describe('ProfileView spot list navigation', () => {
  it('navigates to a spot when its row in YOUR SPOTS is clicked', () => {
    const props = renderProfile();
    fireEvent.click(screen.getByLabelText('View My Local Break'));
    expect(props.onSelectSpot).toHaveBeenCalledWith('custom-1');
  });

  it('is keyboard-accessible (Enter navigates the same as a click)', () => {
    const props = renderProfile();
    fireEvent.keyDown(screen.getByLabelText('View Lower Trestles'), { key: 'Enter' });
    expect(props.onSelectSpot).toHaveBeenCalledWith('trestles');
  });

  it('removing a custom spot does not also navigate to it', () => {
    const props = renderProfile();
    fireEvent.click(screen.getByLabelText('Remove My Local Break'));
    expect(props.removeSpot).toHaveBeenCalledWith('custom-1');
    expect(props.onSelectSpot).not.toHaveBeenCalled();
  });

  it('built-in spots have no remove button but are still navigable', () => {
    const props = renderProfile();
    expect(screen.queryByLabelText('Remove Lower Trestles')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('View Lower Trestles'));
    expect(props.onSelectSpot).toHaveBeenCalledWith('trestles');
  });
});
