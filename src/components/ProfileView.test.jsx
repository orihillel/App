import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../lib/auth.js', () => ({ isAuthConfigured: vi.fn() }));
vi.mock('./AuthButtons.jsx', () => ({ AuthButtons: () => <div data-testid="auth-buttons-stub" /> }));

const { isAuthConfigured } = await import('../lib/auth.js');
const { ProfileView } = await import('./ProfileView.jsx');

// 'trestles' is a real seed id (in the actual src/lib/spots.js SEED_ORDER the component
// imports), so it exercises the built-in filtering even though this fixture doesn't repeat
// that catalog. 'custom-1'/'custom-2' are not seed ids, so they stand in for spots a user
// added themselves.
const SPOTS = {
  trestles: { name: 'Lower Trestles', region: 'San Clemente, CA' },
  'custom-1': { name: 'My Local Break', region: 'Added spot' },
  'custom-2': { name: 'Second Local Break', region: 'Added spot' },
};
const ORDER = ['trestles', 'custom-1', 'custom-2'];

function renderProfile(overrides = {}) {
  const props = {
    order: ORDER, spots: SPOTS, goToId: 'trestles', setGoToSpot: vi.fn(),
    units: 'imperial', toggleUnits: vi.fn(), alerts: [], openAlerts: vi.fn(),
    removeSpot: vi.fn(), onClose: vi.fn(), onSelectSpot: vi.fn(),
    pushSupported: false, pushSubscribed: false, pushBusy: false, togglePush: vi.fn(),
    session: null, onLoggedIn: vi.fn(), onLogOut: vi.fn(), setToast: vi.fn(),
    ...overrides,
  };
  render(<ProfileView {...props} />);
  return props;
}

describe('ProfileView YOUR SPOTS list', () => {
  beforeEach(() => { isAuthConfigured.mockReturnValue(false); });

  it('only lists spots the user added, not built-in seed spots', () => {
    renderProfile();
    expect(screen.getByText('YOUR SPOTS (2)')).toBeInTheDocument();
    expect(screen.getByLabelText('View My Local Break')).toBeInTheDocument();
    expect(screen.getByLabelText('View Second Local Break')).toBeInTheDocument();
    expect(screen.queryByLabelText('View Lower Trestles')).not.toBeInTheDocument();
  });

  it('shows an empty-state message when no spots have been added', () => {
    renderProfile({ order: ['trestles'] });
    expect(screen.getByText('YOUR SPOTS (0)')).toBeInTheDocument();
    expect(screen.getByText(/Spots you add show up here/)).toBeInTheDocument();
  });

  it('navigates to an added spot when its row is clicked', () => {
    const props = renderProfile();
    fireEvent.click(screen.getByLabelText('View My Local Break'));
    expect(props.onSelectSpot).toHaveBeenCalledWith('custom-1');
  });

  it('is keyboard-accessible (Enter navigates the same as a click)', () => {
    const props = renderProfile();
    fireEvent.keyDown(screen.getByLabelText('View Second Local Break'), { key: 'Enter' });
    expect(props.onSelectSpot).toHaveBeenCalledWith('custom-2');
  });

  it('removing an added spot does not also navigate to it', () => {
    const props = renderProfile();
    fireEvent.click(screen.getByLabelText('Remove My Local Break'));
    expect(props.removeSpot).toHaveBeenCalledWith('custom-1');
    expect(props.onSelectSpot).not.toHaveBeenCalled();
  });
});

describe('ProfileView ACCOUNT section', () => {
  beforeEach(() => { isAuthConfigured.mockReturnValue(false); });

  it('is not shown at all when logged out and no login provider is configured', () => {
    renderProfile();
    expect(screen.queryByText('ACCOUNT')).not.toBeInTheDocument();
  });

  it('shows a sign-in prompt when logged out but a login provider is configured', () => {
    isAuthConfigured.mockReturnValue(true);
    renderProfile();
    expect(screen.getByText('ACCOUNT')).toBeInTheDocument();
    expect(screen.getByTestId('auth-buttons-stub')).toBeInTheDocument();
    expect(screen.getByText(/Sign in to keep your go-to spot/)).toBeInTheDocument();
  });

  it('shows the account name, sync note, and a log-out button when logged in', () => {
    // Shown even if isAuthConfigured() is false (e.g. env changed after this session logged
    // in) -- an existing session is what decides this, not current configuration.
    const session = { sessionToken: 'tok123', profile: { name: 'Ada Surfer', picture: '' } };
    const props = renderProfile({ session });
    expect(screen.getByText('ACCOUNT')).toBeInTheDocument();
    expect(screen.getByText('Ada Surfer')).toBeInTheDocument();
    expect(screen.getByText('Synced across your devices')).toBeInTheDocument();
    expect(screen.queryByTestId('auth-buttons-stub')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Log out'));
    expect(props.onLogOut).toHaveBeenCalled();
  });
});
