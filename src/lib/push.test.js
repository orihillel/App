import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// push.js reads import.meta.env.VITE_VAPID_PUBLIC_KEY / VITE_PUSH_API_URL into module-level
// constants at import time, so each test that needs a particular env combination stubs the
// env first, then resets the module registry and re-imports — otherwise every test after the
// first would see whichever env was active on the very first import.
async function loadPushModule() {
  vi.resetModules();
  return import('./push.js');
}

const SPOTS = { trestles: { name: 'Lower Trestles', lat: 33.38, lon: -117.6, offshoreDeg: 60 } };
const ALERTS = [{ id: 'a1', spotId: 'trestles', minWaveFt: 3, leadTime: '1d' }];

describe('isPushConfigured / isPushSupported', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it('is false when the VAPID key or API URL env vars are missing', async () => {
    vi.stubEnv('VITE_VAPID_PUBLIC_KEY', '');
    vi.stubEnv('VITE_PUSH_API_URL', '');
    const { isPushConfigured, isPushSupported } = await loadPushModule();
    expect(isPushConfigured()).toBe(false);
    expect(isPushSupported()).toBe(false);
  });

  it('is configured, but not "supported" without browser Push API surfaces present', async () => {
    vi.stubEnv('VITE_VAPID_PUBLIC_KEY', 'test-public-key');
    vi.stubEnv('VITE_PUSH_API_URL', 'https://worker.example');
    const { isPushConfigured, isPushSupported } = await loadPushModule();
    expect(isPushConfigured()).toBe(true);
    // jsdom doesn't implement PushManager/Notification, so this should read false here even
    // though it's configured -- the two checks are deliberately separate.
    expect(isPushSupported()).toBe(false);
  });
});

describe('subscribeToPush / unsubscribeFromPush / syncAlertsToPush', () => {
  let fakeSubscription;
  let fakeRegistration;

  beforeEach(() => {
    // A syntactically real base64url-encoded 65-byte string (the shape of an actual VAPID
    // public key -- an uncompressed P-256 point) so urlBase64ToUint8Array's atob() call
    // succeeds; the content itself is arbitrary since nothing here does real cryptography.
    vi.stubEnv('VITE_VAPID_PUBLIC_KEY', 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0-P0A');
    vi.stubEnv('VITE_PUSH_API_URL', 'https://worker.example');

    fakeSubscription = {
      endpoint: 'https://push.example/abc123',
      toJSON: () => ({ endpoint: 'https://push.example/abc123', keys: { p256dh: 'x', auth: 'y' } }),
      unsubscribe: vi.fn().mockResolvedValue(true),
    };
    fakeRegistration = {
      pushManager: {
        subscribe: vi.fn().mockResolvedValue(fakeSubscription),
        getSubscription: vi.fn().mockResolvedValue(fakeSubscription),
      },
    };

    vi.stubGlobal('navigator', {
      serviceWorker: { ready: Promise.resolve(fakeRegistration) },
    });
    vi.stubGlobal('PushManager', function () {}); // presence check only
    vi.stubGlobal('Notification', { requestPermission: vi.fn().mockResolvedValue('granted') });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it('requests permission, subscribes, and syncs the denormalized alert list to the Worker', async () => {
    const { subscribeToPush } = await loadPushModule();
    const sub = await subscribeToPush(ALERTS, SPOTS);
    expect(sub).toBe(fakeSubscription);
    expect(Notification.requestPermission).toHaveBeenCalled();
    expect(fakeRegistration.pushManager.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ userVisibleOnly: true })
    );
    expect(fetch).toHaveBeenCalledWith(
      'https://worker.example/subscribe',
      expect.objectContaining({ method: 'POST' })
    );
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.subscription.endpoint).toBe('https://push.example/abc123');
    // Denormalized with the spot's own data, not just an id the Worker can't resolve.
    expect(body.alerts).toEqual([
      { id: 'a1', spotId: 'trestles', spotName: 'Lower Trestles', lat: 33.38, lon: -117.6, offshoreDeg: 60, minWaveFt: 3, leadTime: '1d' },
    ]);
  });

  it('throws instead of subscribing when permission is denied', async () => {
    Notification.requestPermission.mockResolvedValue('denied');
    const { subscribeToPush } = await loadPushModule();
    await expect(subscribeToPush(ALERTS, SPOTS)).rejects.toThrow('permission');
    expect(fakeRegistration.pushManager.subscribe).not.toHaveBeenCalled();
  });

  it('drops alerts whose spot no longer exists rather than sending a broken entry', async () => {
    const { subscribeToPush } = await loadPushModule();
    await subscribeToPush([...ALERTS, { id: 'a2', spotId: 'deleted-spot', minWaveFt: 4, leadTime: '1h' }], SPOTS);
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.alerts).toHaveLength(1);
  });

  it('unsubscribes locally and tells the Worker to forget this endpoint', async () => {
    const { unsubscribeFromPush } = await loadPushModule();
    await unsubscribeFromPush();
    expect(fetch).toHaveBeenCalledWith(
      'https://worker.example/unsubscribe',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ endpoint: 'https://push.example/abc123' }) })
    );
    expect(fakeSubscription.unsubscribe).toHaveBeenCalled();
  });

  it('is a no-op when there is no existing subscription to remove', async () => {
    fakeRegistration.pushManager.getSubscription.mockResolvedValue(null);
    const { unsubscribeFromPush } = await loadPushModule();
    await unsubscribeFromPush();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('never throws when the Worker is unreachable -- push is opt-in extra, not core app function', async () => {
    fetch.mockRejectedValue(new Error('network down'));
    const { subscribeToPush } = await loadPushModule();
    await expect(subscribeToPush(ALERTS, SPOTS)).resolves.toBe(fakeSubscription);
  });
});
