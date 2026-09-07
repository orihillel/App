import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

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

describe('ProfileView go-to picker', () => {
  // It used to be a horizontal strip of every spot in `order`: measured at 403 pills in the
  // running app, with no search and no grouping, so choosing one meant swiping past hundreds.
  // The catalog is the `spots` map; `order` is the much shorter list of spots that are yours.
  // The bulk entries are therefore in `spots` and NOT in `order` -- an id in `order` that is
  // not a seed id is by definition one the user added, which is why it belongs in the picker.
  const BIG = { ...SPOTS };
  for (let i = 0; i < 40; i++) BIG['bulk-' + i] = { name: 'Bulk Spot ' + i, region: 'Nowhere' };
  const BIG_ORDER = ORDER;

  it('lists what is yours, not the whole catalog', () => {
    renderProfile({ spots: BIG, order: BIG_ORDER });
    const picker = screen.getByRole('group', { name: 'Go-to spot choices' });
    expect(within(picker).getByText('Lower Trestles')).toBeTruthy();   // the go-to
    expect(within(picker).getByText('My Local Break')).toBeTruthy();   // added by hand
    expect(within(picker).queryByText('Bulk Spot 7')).toBeNull();      // catalog, not yours
  });

  it('reaches the rest of the catalog by typing rather than by swiping', () => {
    renderProfile({ spots: BIG, order: BIG_ORDER });
    fireEvent.change(screen.getByLabelText(/Search spots to set your go-to/), { target: { value: 'Bulk Spot 7' } });
    const picker = screen.getByRole('group', { name: 'Go-to spot choices' });
    expect(within(picker).getByText('Bulk Spot 7')).toBeTruthy();
    expect(within(picker).queryByText('My Local Break')).toBeNull();   // filtered out while searching
  });

  it('says so when nothing matches, instead of showing an empty gap', () => {
    renderProfile({ spots: BIG, order: BIG_ORDER });
    fireEvent.change(screen.getByLabelText(/Search spots to set your go-to/), { target: { value: 'zzzznotaspot' } });
    expect(screen.getByText('No spot matches that.')).toBeTruthy();
  });

  it('sets the go-to spot and clears the search', () => {
    const props = renderProfile({ spots: BIG, order: BIG_ORDER });
    const input = screen.getByLabelText(/Search spots to set your go-to/);
    fireEvent.change(input, { target: { value: 'Bulk Spot 3' } });
    fireEvent.click(within(screen.getByRole('group', { name: 'Go-to spot choices' })).getByText('Bulk Spot 3'));
    expect(props.setGoToSpot).toHaveBeenCalledWith('bulk-3');
    expect(input.value).toBe('');
  });

  it('marks which one is the go-to', () => {
    renderProfile();
    const picker = screen.getByRole('group', { name: 'Go-to spot choices' });
    expect(within(picker).getByText('Lower Trestles').closest('button').getAttribute('aria-pressed')).toBe('true');
    expect(within(picker).getByText('My Local Break').closest('button').getAttribute('aria-pressed')).toBe('false');
  });
});

describe('ProfileView layout', () => {
  const HEADINGS = ['GO-TO SPOT', 'UNITS', 'ALERTS', 'PUSH NOTIFICATIONS', 'YOUR SESSIONS', 'DATA'];

  it('renders every section heading identically', () => {
    // YOUR SESSIONS was written out separately from the rest and sat in a container that added
    // its own '0 24px' on top of the page padding, putting it 24px right of every other
    // heading -- 82px against 58px, measured in the browser. One shared component now.
    renderProfile();
    const styles = new Set();
    for (const text of HEADINGS) {
      const el = screen.getByText((_, node) => node.textContent.trim() === text && node.children.length === 0);
      styles.add(el.style.cssText.replace(/\s+/g, ' '));
    }
    expect(styles.size, [...styles].join('  ||  ')).toBe(1);
  });

  it('puts no section in a container that indents it past the others', () => {
    renderProfile();
    for (const text of HEADINGS) {
      const el = screen.getByText((_, node) => node.textContent.trim() === text && node.children.length === 0);
      let n = el.parentElement, extra = null;
      while (n && n !== document.body) {
        if (n.style && (n.style.paddingLeft || n.style.padding)) { extra = n; break; }
        n = n.parentElement;
      }
      // Exactly one padded ancestor is allowed: the page container every section shares.
      const padded = [];
      let m = el.parentElement;
      while (m && m !== document.body) {
        if (m.style && (m.style.paddingLeft || m.style.padding)) padded.push(m.style.padding || m.style.paddingLeft);
        m = m.parentElement;
      }
      expect(padded.length, text + ' has padded ancestors: ' + JSON.stringify(padded)).toBeLessThanOrEqual(1);
      expect(extra === null || padded.length === 1).toBe(true);
    }
  });
});
