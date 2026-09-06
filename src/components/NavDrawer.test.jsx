import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { NavDrawer } from './NavDrawer.jsx';
import { SPOTS, ORDER } from '../lib/spots.js';

const CUSTOM = { name: 'Herzliya Marina', region: 'Herzliya, Israel', lat: 32.16, lon: 34.79, offshoreDeg: 90 };

function renderDrawer(props = {}) {
  const handlers = {
    onSelectSpot: vi.fn(), openSearch: vi.fn(), onNavigate: vi.fn(),
    toggleUnits: vi.fn(), onClose: vi.fn(),
  };
  const spots = { ...SPOTS, mycustom: CUSTOM };
  const { unmount } = render(
    <NavDrawer
      spots={spots} order={[...ORDER, 'mycustom']} goToId="jbay" activeId="jbay"
      units="metric" alertCount={2}
      {...handlers} {...props}
    />
  );
  return { ...handlers, unmount };
}

describe('NavDrawer', () => {
  it('opens on your own spots, the way Surfline and Windy both open on favourites', () => {
    renderDrawer();
    expect(screen.getByText('YOUR SPOTS')).toBeTruthy();
    expect(screen.getByText('Jeffreys Bay')).toBeTruthy();
    expect(screen.getByText('GO-TO')).toBeTruthy();
    expect(screen.getByText('Herzliya Marina')).toBeTruthy();
  });

  it('does not call the whole built-in catalog "yours"', () => {
    // `order` starts as the entire catalog, so listing it would be four hundred rows of spots
    // the user never chose — and would bury the one they actually surf. Only the go-to spot
    // and anything they added themselves belongs here.
    renderDrawer();
    expect(screen.queryByText('Pipeline')).toBeNull();
    expect(screen.queryByText('Uluwatu')).toBeNull();
    expect(Object.keys(SPOTS).length).toBeGreaterThan(100); // i.e. the above is a real filter
  });

  it('says how to get a spot into the list when you have added none', () => {
    renderDrawer({ order: ORDER });
    expect(screen.getByText(/Search for anywhere on the coast/)).toBeTruthy();
  });

  it('opens a spot and closes itself', () => {
    const h = renderDrawer();
    fireEvent.click(screen.getByText('Herzliya Marina'));
    expect(h.onSelectSpot).toHaveBeenCalledWith('mycustom');
    expect(h.onClose).toHaveBeenCalled();
  });

  it('reaches the globe, alerts and profile, closing behind each', () => {
    for (const [label, view] of [['Globe', 'map'], ['Alerts', 'alerts'], ['Profile', 'profile']]) {
      const h = renderDrawer();
      fireEvent.click(screen.getByText(label));
      expect(h.onNavigate, label).toHaveBeenCalledWith(view);
      expect(h.onClose, label).toHaveBeenCalled();
      h.unmount();
    }
  });

  it('offers search from two places, because adding a spot and finding one feel different', () => {
    const h = renderDrawer();
    fireEvent.click(screen.getByText('Add a spot'));
    fireEvent.click(screen.getByText('Search spots'));
    expect(h.openSearch).toHaveBeenCalledTimes(2);
  });

  it('has no entry that does nothing — which is the whole bug it replaces', () => {
    // The hamburger used to raise "Menu — not in this preview". A menu of dead entries is
    // worse than no menu, so every button in here has to reach something.
    const h = renderDrawer();
    const { unmount, ...calls } = h; // eslint-disable-line no-unused-vars
    // The one exception is the selected half of the units control, which is inert because it
    // is already on — a segmented control, not a dead link.
    const buttons = screen.getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') !== 'true');
    expect(buttons.length).toBeGreaterThan(6);
    for (const button of buttons) {
      const before = Object.values(calls).reduce((n, fn) => n + fn.mock.calls.length, 0);
      fireEvent.click(button);
      const after = Object.values(calls).reduce((n, fn) => n + fn.mock.calls.length, 0);
      expect(after, button.textContent || button.getAttribute('aria-label')).toBeGreaterThan(before);
    }
  });

  it('shows the units in force and switches to the other one', () => {
    const h = renderDrawer({ units: 'metric' });
    const metric = screen.getByText('Meters · kph');
    const imperial = screen.getByText('Feet · mph');
    expect(metric.getAttribute('aria-pressed')).toBe('true');
    expect(imperial.getAttribute('aria-pressed')).toBe('false');
    // Tapping the one already in force must not toggle it off into the other unit.
    fireEvent.click(metric);
    expect(h.toggleUnits).not.toHaveBeenCalled();
    fireEvent.click(imperial);
    expect(h.toggleUnits).toHaveBeenCalledTimes(1);
  });

  it('carries the counts that make an entry worth tapping', () => {
    renderDrawer({ alertCount: 2 });
    expect(screen.getByText('2 active')).toBeTruthy();
    const globe = screen.getByText('Globe').closest('button');
    expect(within(globe).getByText(new RegExp(Object.keys(SPOTS).length + ' spots'))).toBeTruthy();
  });

  it('says "none set yet" rather than "0 active"', () => {
    renderDrawer({ alertCount: 0 });
    expect(screen.getByText('None set yet')).toBeTruthy();
  });

  it('closes on Escape and on the scrim, but not when the panel itself is clicked', () => {
    const h = renderDrawer();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(h.onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('dialog'));
    expect(h.onClose).toHaveBeenCalledTimes(1); // the panel swallows its own clicks

    fireEvent.click(screen.getByRole('dialog').parentElement);
    expect(h.onClose).toHaveBeenCalledTimes(2);
  });

  it('is a labelled dialog that takes focus, so a keyboard user is not left behind it', () => {
    renderDrawer();
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBe('Menu');
    expect(document.activeElement).toBe(dialog);
  });

  it('credits where the data comes from, the way Windy\'s menu does', () => {
    renderDrawer();
    expect(screen.getByText(/Open-Meteo/)).toBeTruthy();
    expect(screen.getByText(/Natural Earth/)).toBeTruthy();
  });

  it('names the build it is running, so "is this deployed yet?" is answerable on screen', () => {
    // Three changes in a row were reported as broken when they simply had not been merged and
    // deployed, and nothing in the app distinguished the two. Vite substitutes the commit at
    // build time; under the test runner it falls back rather than rendering "undefined".
    renderDrawer();
    const line = screen.getByText(/^Build /);
    expect(line.textContent).toMatch(/^Build [0-9a-f]{7}|^Build dev/);
    expect(line.textContent).not.toMatch(/undefined/);
  });
});
