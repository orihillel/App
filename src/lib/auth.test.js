import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// auth.js reads import.meta.env.VITE_GOOGLE_CLIENT_ID / VITE_FACEBOOK_APP_ID / VITE_PUSH_API_URL
// into module-level constants at import time, so each test that needs a particular env
// combination stubs the env first, then resets the module registry and re-imports — same
// pattern as src/lib/push.test.js, and for the same reason (otherwise every test after the
// first would see whichever env was active on the very first import).
async function loadAuthModule() {
  vi.resetModules();
  return import('./auth.js');
}

describe('isGoogleConfigured / isFacebookConfigured / isAuthConfigured', () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it('are all false with nothing configured', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '');
    vi.stubEnv('VITE_FACEBOOK_APP_ID', '');
    vi.stubEnv('VITE_PUSH_API_URL', '');
    const { isGoogleConfigured, isFacebookConfigured, isAuthConfigured } = await loadAuthModule();
    expect(isGoogleConfigured()).toBe(false);
    expect(isFacebookConfigured()).toBe(false);
    expect(isAuthConfigured()).toBe(false);
  });

  it('Google alone configured turns on Google + overall, not Facebook', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');
    vi.stubEnv('VITE_FACEBOOK_APP_ID', '');
    vi.stubEnv('VITE_PUSH_API_URL', 'https://worker.example');
    const { isGoogleConfigured, isFacebookConfigured, isAuthConfigured } = await loadAuthModule();
    expect(isGoogleConfigured()).toBe(true);
    expect(isFacebookConfigured()).toBe(false);
    expect(isAuthConfigured()).toBe(true);
  });

  it('a provider id without the API URL is not configured -- both are required', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');
    vi.stubEnv('VITE_FACEBOOK_APP_ID', '');
    vi.stubEnv('VITE_PUSH_API_URL', '');
    const { isGoogleConfigured, isAuthConfigured } = await loadAuthModule();
    expect(isGoogleConfigured()).toBe(false);
    expect(isAuthConfigured()).toBe(false);
  });
});

describe('session storage', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('getSession is null when nothing has been saved', async () => {
    const { getSession } = await loadAuthModule();
    expect(getSession()).toBeNull();
  });

  it('a login saves a session getSession can read back, and logout clears it', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');
    vi.stubEnv('VITE_PUSH_API_URL', 'https://worker.example');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ sessionToken: 'tok123', profile: { name: 'Ada' }, appData: null, isNewAccount: true }),
    }));
    const { loginWithGoogleIdToken, getSession, logout } = await loadAuthModule();

    await loginWithGoogleIdToken('fake-id-token');
    expect(getSession()).toEqual({ sessionToken: 'tok123', profile: { name: 'Ada' } });

    logout();
    expect(getSession()).toBeNull();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
});

describe('loginWithGoogleIdToken / loginWithFacebookAccessToken', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); window.localStorage.clear(); });

  it('POSTs the id token to /auth/google and returns the server response', async () => {
    vi.stubEnv('VITE_PUSH_API_URL', 'https://worker.example');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ sessionToken: 'tok123', profile: { name: 'Ada' }, appData: null, isNewAccount: true }),
    }));
    const { loginWithGoogleIdToken } = await loadAuthModule();
    const result = await loginWithGoogleIdToken('fake-id-token');
    expect(result.sessionToken).toBe('tok123');
    expect(fetch).toHaveBeenCalledWith('https://worker.example/auth/google', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ idToken: 'fake-id-token' });
  });

  it('POSTs the access token to /auth/facebook and returns the server response', async () => {
    vi.stubEnv('VITE_PUSH_API_URL', 'https://worker.example');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ sessionToken: 'tok456', profile: { name: 'Ada' }, appData: null, isNewAccount: true }),
    }));
    const { loginWithFacebookAccessToken } = await loadAuthModule();
    const result = await loginWithFacebookAccessToken('fake-access-token');
    expect(result.sessionToken).toBe('tok456');
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ accessToken: 'fake-access-token' });
  });

  it('throws the server\'s error message on a non-ok response, and does not save a session', async () => {
    vi.stubEnv('VITE_PUSH_API_URL', 'https://worker.example');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: 'Invalid Google credential' }) }));
    const { loginWithGoogleIdToken, getSession } = await loadAuthModule();
    await expect(loginWithGoogleIdToken('bad-token')).rejects.toThrow('Invalid Google credential');
    expect(getSession()).toBeNull();
  });
});

describe('fetchMyAccount', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it('sends the session token as a bearer header and returns the parsed body', async () => {
    vi.stubEnv('VITE_PUSH_API_URL', 'https://worker.example');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ profile: { name: 'Ada' }, appData: { goToId: 'pipeline' } }) }));
    const { fetchMyAccount } = await loadAuthModule();
    const result = await fetchMyAccount('tok123');
    expect(result.appData).toEqual({ goToId: 'pipeline' });
    expect(fetch).toHaveBeenCalledWith('https://worker.example/me', { headers: { Authorization: 'Bearer tok123' } });
  });

  it('throws on a non-ok response (expired/invalid session)', async () => {
    vi.stubEnv('VITE_PUSH_API_URL', 'https://worker.example');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    const { fetchMyAccount } = await loadAuthModule();
    await expect(fetchMyAccount('bad-token')).rejects.toThrow();
  });
});

describe('pushAppData', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  const APP_DATA = { goToId: 'pipeline', customSpots: [], alerts: [], units: 'metric' };

  it('PUTs appData with a bearer header', async () => {
    vi.stubEnv('VITE_PUSH_API_URL', 'https://worker.example');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    const { pushAppData } = await loadAuthModule();
    await pushAppData('tok123', APP_DATA);
    expect(fetch).toHaveBeenCalledWith('https://worker.example/me/data', expect.objectContaining({
      method: 'PUT',
      headers: expect.objectContaining({ Authorization: 'Bearer tok123' }),
      body: JSON.stringify({ appData: APP_DATA }),
    }));
  });

  it('is a silent no-op without a session token or configured API URL', async () => {
    vi.stubEnv('VITE_PUSH_API_URL', '');
    vi.stubGlobal('fetch', vi.fn());
    const { pushAppData } = await loadAuthModule();
    await pushAppData(null, APP_DATA);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('never throws when the Worker is unreachable -- sync is best-effort, not core app function', async () => {
    vi.stubEnv('VITE_PUSH_API_URL', 'https://worker.example');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const { pushAppData } = await loadAuthModule();
    await expect(pushAppData('tok123', APP_DATA)).resolves.toBeUndefined();
  });
});

describe('renderGoogleButton', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); document.head.innerHTML = ''; });

  it('loads the Google script once, initializes with the configured client id, and renders into the container', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');
    vi.stubEnv('VITE_PUSH_API_URL', 'https://worker.example');
    const initialize = vi.fn();
    const renderButton = vi.fn();
    vi.stubGlobal('google', { accounts: { id: { initialize, renderButton } } });

    // jsdom doesn't actually fetch/execute injected <script> tags -- firing `onload`
    // synchronously right after append simulates "the script finished loading" without a
    // real network request, which is all this module's promise is waiting on.
    const appendChildSpy = vi.spyOn(document.head, 'appendChild').mockImplementation((el) => {
      el.onload && el.onload();
      return el;
    });

    const { renderGoogleButton } = await loadAuthModule();
    const container = document.createElement('div');
    const onCredential = vi.fn();
    await renderGoogleButton(container, onCredential);

    expect(appendChildSpy).toHaveBeenCalledTimes(1);
    expect(initialize).toHaveBeenCalledWith(expect.objectContaining({ client_id: 'test-client-id' }));
    expect(renderButton).toHaveBeenCalledWith(container, expect.any(Object));

    // The callback initialize() was given should forward the credential to onCredential.
    initialize.mock.calls[0][0].callback({ credential: 'the-id-token' });
    expect(onCredential).toHaveBeenCalledWith('the-id-token');
  });
});

describe('loginWithFacebook', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); document.head.innerHTML = ''; delete window.fbAsyncInit; });

  it('initializes the SDK with the configured app id and resolves with the access token on success', async () => {
    vi.stubEnv('VITE_FACEBOOK_APP_ID', 'test-app-id');
    vi.stubEnv('VITE_PUSH_API_URL', 'https://worker.example');
    const fbInit = vi.fn();
    const login = vi.fn((callback) => callback({ authResponse: { accessToken: 'fb-token-123' } }));

    vi.spyOn(document.head, 'appendChild').mockImplementation((el) => {
      // Mirrors the real Facebook SDK: it calls the global fbAsyncInit once loaded.
      window.FB = { init: fbInit, login };
      window.fbAsyncInit();
      return el;
    });

    const { loginWithFacebook } = await loadAuthModule();
    const token = await loginWithFacebook();
    expect(token).toBe('fb-token-123');
    expect(fbInit).toHaveBeenCalledWith(expect.objectContaining({ appId: 'test-app-id' }));
  });

  it('rejects when the user cancels or denies the login', async () => {
    vi.stubEnv('VITE_FACEBOOK_APP_ID', 'test-app-id');
    vi.stubEnv('VITE_PUSH_API_URL', 'https://worker.example');
    const login = vi.fn((callback) => callback({})); // no authResponse -- cancelled/denied

    vi.spyOn(document.head, 'appendChild').mockImplementation((el) => {
      window.FB = { init: vi.fn(), login };
      window.fbAsyncInit();
      return el;
    });

    const { loginWithFacebook } = await loadAuthModule();
    await expect(loginWithFacebook()).rejects.toThrow('cancelled');
  });
});
