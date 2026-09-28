import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MySpotsView } from './MySpotsView.jsx';

const SPOT = { name: 'Maravi', region: 'Tel Aviv, Israel' };
const HOUR = { hour: 9, rating: 'FAIR', score: 3, wave: '2-3', period: 9, swellDir: 'W', windSpd: 6, windDeg: 90, type: 'offshore' };

function renderView(rows) {
  render(<MySpotsView rows={rows} summary="x" units="imperial" goToId="maravi" onSelectSpot={vi.fn()} onClose={vi.fn()} onRefresh={vi.fn()} />);
}

describe('MySpotsView day parts', () => {
  it('shows morning, midday and evening with their ratings', () => {
    renderView([{ id: 'maravi', spot: SPOT, hour: HOUR, score: 3, parts: [
      { id: 'morning', label: 'Morning', rating: 'GOOD', past: true },
      { id: 'midday', label: 'Midday', rating: 'FAIR', past: false },
      { id: 'evening', label: 'Evening', rating: null, past: false },
    ] }]);
    expect(screen.getByLabelText('Morning: good')).toBeTruthy();
    expect(screen.getByLabelText('Midday: fair')).toBeTruthy();
    expect(screen.getByLabelText('Evening: no reading')).toBeTruthy();
  });

  it('shows no parts for a spot with only a one-hour reading', () => {
    renderView([{ id: 'maravi', spot: SPOT, hour: HOUR, score: 3, parts: null }]);
    expect(screen.queryByText('Morning')).toBeNull();
  });
});
