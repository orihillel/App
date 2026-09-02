import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// AuthButtons imports lib/auth.js's config checks and login functions directly; mocking the
// module (rather than stubbing env vars + a real DOM script load, as lib/auth.test.js does for
// auth.js itself) keeps these tests focused on AuthButtons' own rendering/wiring logic.
vi.mock('../lib/auth.js', () => ({
  isGoogleConfigured: vi.fn(),
  isFacebookConfigured: vi.fn(),
  renderGoogleButton: vi.fn().mockResolvedValue(undefined),
  loginWithFacebook: vi.fn(),
  loginWithGoogleIdToken: vi.fn(),
  loginWithFacebookAccessToken: vi.fn(),
}));

const auth = await import('../lib/auth.js');
const { AuthButtons } = await import('./AuthButtons.jsx');

function renderButtons(overrides = {}) {
  const props = { onLoggedIn: vi.fn(), setToast: vi.fn(), ...overrides };
  render(<AuthButtons {...props} />);
  return props;
}

describe('AuthButtons', () => {
  afterEach(() => { vi.clearAllMocks(); });

  it('renders nothing when neither provider is configured', () => {
    auth.isGoogleConfigured.mockReturnValue(false);
    auth.isFacebookConfigured.mockReturnValue(false);
    const { container } = render(<AuthButtons onLoggedIn={vi.fn()} setToast={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders only the Meta button when just Facebook is configured', () => {
    auth.isGoogleConfigured.mockReturnValue(false);
    auth.isFacebookConfigured.mockReturnValue(true);
    renderButtons();
    expect(screen.getByText('Continue with Meta')).toBeInTheDocument();
    expect(auth.renderGoogleButton).not.toHaveBeenCalled();
  });

  it('renders a Google button container and calls renderGoogleButton when Google is configured', async () => {
    auth.isGoogleConfigured.mockReturnValue(true);
    auth.isFacebookConfigured.mockReturnValue(false);
    renderButtons();
    await waitFor(() => expect(auth.renderGoogleButton).toHaveBeenCalledTimes(1));
    expect(auth.renderGoogleButton.mock.calls[0][0]).toBeInstanceOf(HTMLElement);
  });

  it('calls onLoggedIn with the login result when the Google callback fires', async () => {
    auth.isGoogleConfigured.mockReturnValue(true);
    auth.isFacebookConfigured.mockReturnValue(false);
    const loginResult = { sessionToken: 'tok', profile: { name: 'Ada' }, appData: null, isNewAccount: true };
    auth.loginWithGoogleIdToken.mockResolvedValue(loginResult);
    const props = renderButtons();

    await waitFor(() => expect(auth.renderGoogleButton).toHaveBeenCalled());
    const onCredential = auth.renderGoogleButton.mock.calls[0][1];
    await onCredential('fake-id-token');

    expect(auth.loginWithGoogleIdToken).toHaveBeenCalledWith('fake-id-token');
    expect(props.onLoggedIn).toHaveBeenCalledWith(loginResult);
  });

  it('shows an error toast instead of calling onLoggedIn when the Google login fails', async () => {
    auth.isGoogleConfigured.mockReturnValue(true);
    auth.isFacebookConfigured.mockReturnValue(false);
    auth.loginWithGoogleIdToken.mockRejectedValue(new Error('Invalid Google credential'));
    const props = renderButtons();

    await waitFor(() => expect(auth.renderGoogleButton).toHaveBeenCalled());
    const onCredential = auth.renderGoogleButton.mock.calls[0][1];
    await onCredential('bad-token');

    expect(props.onLoggedIn).not.toHaveBeenCalled();
    expect(props.setToast).toHaveBeenCalledWith('Invalid Google credential');
  });

  it('clicking "Continue with Meta" logs in and calls onLoggedIn on success', async () => {
    auth.isGoogleConfigured.mockReturnValue(false);
    auth.isFacebookConfigured.mockReturnValue(true);
    auth.loginWithFacebook.mockResolvedValue('fb-access-token');
    const loginResult = { sessionToken: 'tok', profile: { name: 'Ada' }, appData: null, isNewAccount: true };
    auth.loginWithFacebookAccessToken.mockResolvedValue(loginResult);
    const props = renderButtons();

    fireEvent.click(screen.getByText('Continue with Meta'));
    await waitFor(() => expect(props.onLoggedIn).toHaveBeenCalledWith(loginResult));
    expect(auth.loginWithFacebookAccessToken).toHaveBeenCalledWith('fb-access-token');
  });

  it('shows an error toast when Facebook login is cancelled', async () => {
    auth.isGoogleConfigured.mockReturnValue(false);
    auth.isFacebookConfigured.mockReturnValue(true);
    auth.loginWithFacebook.mockRejectedValue(new Error('Facebook login was cancelled'));
    const props = renderButtons();

    fireEvent.click(screen.getByText('Continue with Meta'));
    await waitFor(() => expect(props.setToast).toHaveBeenCalledWith('Facebook login was cancelled'));
    expect(props.onLoggedIn).not.toHaveBeenCalled();
    expect(auth.loginWithFacebookAccessToken).not.toHaveBeenCalled();
  });
});
