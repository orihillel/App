import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConditionScale } from './ConditionScale.jsx';

describe('ConditionScale', () => {
  it('shows all four rating labels by default', () => {
    render(<ConditionScale score={5} />);
    expect(screen.getByText('POOR')).toBeInTheDocument();
    expect(screen.getByText('FAIR')).toBeInTheDocument();
    expect(screen.getByText('GOOD')).toBeInTheDocument();
    expect(screen.getByText('FIRING')).toBeInTheDocument();
  });

  it('hides the labels in compact mode', () => {
    render(<ConditionScale score={5} compact />);
    expect(screen.queryByText('POOR')).not.toBeInTheDocument();
  });

  it('renders without a score (no marker) rather than crashing', () => {
    render(<ConditionScale />);
    expect(screen.getByText('FIRING')).toBeInTheDocument();
  });
});
