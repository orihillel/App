import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { AlertSheet } from './AlertSheet.jsx';

// 'trestles' is a real seed id in the actual src/lib/spots.js ORDER the component imports, so
// it exercises the built-in/added distinction even though this fixture doesn't repeat that
// 718-spot catalog. 'custom-1'/'custom-2' stand in for spots a user searched for and added.
const SPOTS = {
  trestles: { name: 'Lower Trestles', region: 'San Clemente, CA' },
  pipeline: { name: 'Pipeline', region: 'Oahu, Hawaii' },
  'custom-1': { name: 'My Local Break', region: 'Added spot' },
};
const ORDER = ['trestles', 'pipeline', 'custom-1'];

function renderSheet(overrides = {}) {
  const props = {
    order: ORDER, spots: SPOTS, goToId: 'trestles',
    alertDraft: { spotId: 'trestles', minWaveFt: 3, leadTime: '1d' },
    setAlertDraft: vi.fn(), units: 'imperial', saveAlert: vi.fn(), onClose: vi.fn(),
    ...overrides,
  };
  render(<AlertSheet {...props} />);
  return props;
}

describe('AlertSheet spot picker', () => {
  // It used to be a horizontal strip of every id in `order`, which starts as the entire
  // built-in catalog -- so picking a spot for an alert meant swiping past hundreds of them
  // with no way to search, the exact bug ProfileView's go-to picker fixed once already.
  it('lists what is yours, not the whole catalog', () => {
    renderSheet();
    const picker = screen.getByRole('group', { name: 'Spot choices' });
    expect(within(picker).getByText('Lower Trestles')).toBeTruthy(); // the go-to
    expect(within(picker).getByText('My Local Break')).toBeTruthy(); // added by hand
    expect(within(picker).queryByText('Pipeline')).toBeNull();       // catalog, not yours
  });

  it('reaches the rest of the catalog by typing rather than by swiping', () => {
    renderSheet();
    fireEvent.change(screen.getByLabelText('Search spots for this alert'), { target: { value: 'Pipeline' } });
    const picker = screen.getByRole('group', { name: 'Spot choices' });
    expect(within(picker).getByText('Pipeline')).toBeTruthy();
    expect(within(picker).queryByText('My Local Break')).toBeNull(); // filtered out while searching
  });

  it('says so when nothing matches, instead of showing an empty gap', () => {
    renderSheet();
    fireEvent.change(screen.getByLabelText('Search spots for this alert'), { target: { value: 'zzzznotaspot' } });
    expect(screen.getByText('No spot matches that.')).toBeTruthy();
  });

  it('selects a spot and clears the search', () => {
    const props = renderSheet();
    const input = screen.getByLabelText('Search spots for this alert');
    fireEvent.change(input, { target: { value: 'Pipeline' } });
    fireEvent.click(within(screen.getByRole('group', { name: 'Spot choices' })).getByText('Pipeline'));
    expect(props.setAlertDraft).toHaveBeenCalledWith({ spotId: 'pipeline', minWaveFt: 3, leadTime: '1d' });
    expect(input.value).toBe('');
  });

  it('marks which spot is currently selected', () => {
    renderSheet({ alertDraft: { spotId: 'custom-1', minWaveFt: 3, leadTime: '1d' } });
    const picker = screen.getByRole('group', { name: 'Spot choices' });
    expect(within(picker).getByText('My Local Break').closest('button').getAttribute('aria-pressed')).toBe('true');
    expect(within(picker).getByText('Lower Trestles').closest('button').getAttribute('aria-pressed')).toBe('false');
  });

  // Picking a spot via search does not change the go-to spot, so once someone has selected one
  // that is neither their go-to nor something they added, the favourites list on its own would
  // show nothing selected the moment the query is cleared -- the tap registered, but the sheet
  // looked like it had not.
  it('keeps the just-picked spot visible once the search that found it is cleared', () => {
    // 'pipeline' is in SPOTS/CATALOG for this fixture but not in ORDER, so it is neither the
    // go-to spot nor anything added -- exactly the spot a search would be needed to reach.
    renderSheet({ alertDraft: { spotId: 'pipeline', minWaveFt: 3, leadTime: '1d' } });
    const picker = screen.getByRole('group', { name: 'Spot choices' });
    const pipelineBtn = within(picker).getByText('Pipeline').closest('button');
    expect(pipelineBtn.getAttribute('aria-pressed')).toBe('true');
    // The favourites are still there, right after it, not replaced by it.
    expect(within(picker).getByText('Lower Trestles')).toBeTruthy();
    expect(within(picker).getByText('My Local Break')).toBeTruthy();
  });
});

describe('AlertSheet, the rest of the form', () => {
  it('renders every section', () => {
    renderSheet();
    expect(screen.getByText('New alert')).toBeTruthy();
    expect(screen.getByText('MINIMUM WAVE HEIGHT')).toBeTruthy();
    expect(screen.getByText('NOTIFY ME')).toBeTruthy();
    expect(screen.getByText('Save alert')).toBeTruthy();
  });

  it('sets a minimum wave height', () => {
    const props = renderSheet();
    fireEvent.click(screen.getByText('4ft+'));
    expect(props.setAlertDraft).toHaveBeenCalledWith({ spotId: 'trestles', minWaveFt: 4, leadTime: '1d' });
  });

  it('sets a lead time', () => {
    const props = renderSheet();
    fireEvent.click(screen.getByText('2 days before'));
    expect(props.setAlertDraft).toHaveBeenCalledWith({ spotId: 'trestles', minWaveFt: 3, leadTime: '2d' });
  });

  it('saves the alert', () => {
    const props = renderSheet();
    fireEvent.click(screen.getByText('Save alert'));
    expect(props.saveAlert).toHaveBeenCalled();
  });
});
