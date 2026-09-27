import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('./AuthButtons.jsx', () => ({
  AuthButtons: ({ onLoggedIn }) => <button onClick={() => onLoggedIn({ ok: true })}>auth-buttons-stub</button>,
}));

const { SignInView } = await import('./SignInView.jsx');

describe('SignInView', () => {
  it('shows the sign-in buttons and wires them to onLoggedIn', () => {
    const onLoggedIn = vi.fn();
    render(<SignInView onLoggedIn={onLoggedIn} setToast={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Sign in to get started' })).toBeInTheDocument();
    screen.getByText('auth-buttons-stub').click();
    expect(onLoggedIn).toHaveBeenCalledWith({ ok: true });
  });

  it('offers no way past it without signing in', () => {
    render(<SignInView onLoggedIn={vi.fn()} setToast={vi.fn()} />);
    expect(screen.queryByText(/skip/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/without/i)).not.toBeInTheDocument();
  });
});
