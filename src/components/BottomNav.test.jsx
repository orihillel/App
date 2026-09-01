import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BottomNav } from './BottomNav.jsx';

describe('BottomNav', () => {
  it('renders all four nav targets and calls handleNav with the right label on click', () => {
    const handleNav = vi.fn();
    render(<BottomNav view="home" handleNav={handleNav} />);

    fireEvent.click(screen.getByLabelText('Globe'));
    expect(handleNav).toHaveBeenCalledWith('map');

    fireEvent.click(screen.getByLabelText('Alerts'));
    expect(handleNav).toHaveBeenCalledWith('alerts');

    fireEvent.click(screen.getByLabelText('Profile'));
    expect(handleNav).toHaveBeenCalledWith('profile');

    fireEvent.click(screen.getByLabelText('Home'));
    expect(handleNav).toHaveBeenCalledWith('home');

    expect(handleNav).toHaveBeenCalledTimes(4);
  });
});
