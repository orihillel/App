import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createFakeKv } from './fakeKv.js';
import { putSubscription, getSubscription } from '../src/store.js';

vi.mock('../src/push.js', () => ({
  sendPushNotification: vi.fn(),
  buildNotificationPayload: (alert, match) => ({ title: alert.spotName, body: match.text, tag: 'alert-' + alert.id, url: './' }),
}));

// Imported after the mock so index.js picks up the mocked push module.
const { default: worker, checkSubscription } = await import('../src/index.js');
const { sendPushNotification } = await import('../src/push.js');

function makeEnv(overrides = {}) {
  return {
    SUBSCRIPTIONS: createFakeKv(),
    VAPID_SUBJECT: 'mailto:test@example.com',
    VAPID_PUBLIC_KEY: 'test-public',
    VAPID_PRIVATE_KEY: 'test-private',
    ALLOWED_ORIGIN: 'https://example.github.io',
    ...overrides,
  };
}

const SUBSCRIPTION_JSON = { endpoint: 'https://push.example/abc', keys: { p256dh: 'x', auth: 'y' } };
const ALERT = { id: 'a1', spotId: 'trestles', spotName: 'Lower Trestles', lat: 33.38, lon: -117.6, offshoreDeg: 60, minWaveFt: 3, leadTime: '1h' };

describe('HTTP routes', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('POST /subscribe stores the subscription and returns ok', async () => {
    const env = makeEnv();
    const req = new Request('https://worker.example/subscribe', {
      method: 'POST',
      body: JSON.stringify({ subscription: SUBSCRIPTION_JSON, alerts: [ALERT] }),
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);
    expect(await getSubscription(env, SUBSCRIPTION_JSON.endpoint)).toEqual({ subscription: SUBSCRIPTION_JSON, alerts: [ALERT], lastNotified: {} });
  });

  it('POST /subscribe without a subscription is a 400, not a stored garbage entry', async () => {
    const env = makeEnv();
    const res = await worker.fetch(new Request('https://worker.example/subscribe', { method: 'POST', body: JSON.stringify({}) }), env);
    expect(res.status).toBe(400);
  });

  it('POST /unsubscribe removes a stored subscription', async () => {
    const env = makeEnv();
    await putSubscription(env, SUBSCRIPTION_JSON.endpoint, SUBSCRIPTION_JSON, [ALERT]);
    const res = await worker.fetch(new Request('https://worker.example/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: SUBSCRIPTION_JSON.endpoint }) }), env);
    expect(res.status).toBe(200);
    expect(await getSubscription(env, SUBSCRIPTION_JSON.endpoint)).toBeNull();
  });

  it('GET /health responds ok', async () => {
    const res = await worker.fetch(new Request('https://worker.example/health'), makeEnv());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('responds 404 for an unknown route', async () => {
    const res = await worker.fetch(new Request('https://worker.example/nope'), makeEnv());
    expect(res.status).toBe(404);
  });

  it('answers CORS preflight and sets Access-Control-Allow-Origin from env', async () => {
    const env = makeEnv({ ALLOWED_ORIGIN: 'https://someone.github.io' });
    const res = await worker.fetch(new Request('https://worker.example/subscribe', { method: 'OPTIONS' }), env);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://someone.github.io');
  });
});

describe('checkSubscription (the cron logic)', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  function stubForecastFetch({ waveM = 2, windMs = 3, windDeg = 60 } = {}) {
    // Mirrors the shape fetchSpotForecast() (src/lib/forecast.js) expects from Open-Meteo.
    vi.stubGlobal('fetch', vi.fn((url) => {
      const isMarine = String(url).includes('marine-api');
      const hourly = isMarine
        ? { time: Array(24).fill('2026-01-01T00:00'), wave_height: Array(24).fill(waveM), wave_direction: Array(24).fill(200), sea_level_height_msl: Array(24).fill(1) }
        : { wind_speed_10m: Array(24).fill(windMs), wind_direction_10m: Array(24).fill(windDeg) };
      const body = isMarine ? { hourly, daily: { time: [], wave_height_max: [] } } : { hourly };
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    }));
  }

  it('sends a push and records lastNotified when an alert matches', async () => {
    stubForecastFetch({ waveM: 2, windMs: 2, windDeg: ALERT.offshoreDeg }); // strong offshore, decent size -> should match a 3ft/1h alert
    sendPushNotification.mockResolvedValue(new Response(null, { status: 201 }));
    const env = makeEnv();

    await checkSubscription(env, SUBSCRIPTION_JSON.endpoint, { subscription: SUBSCRIPTION_JSON, alerts: [ALERT], lastNotified: {} });

    expect(sendPushNotification).toHaveBeenCalledTimes(1);
    const [sentSub, payload] = sendPushNotification.mock.calls[0];
    expect(sentSub).toEqual(SUBSCRIPTION_JSON);
    expect(payload.title).toBe('Lower Trestles');

    const stored = await getSubscription(env, SUBSCRIPTION_JSON.endpoint);
    expect(stored.lastNotified.a1).toBeTruthy();
  });

  it('does not re-send within the cooldown window even if still matching', async () => {
    stubForecastFetch({ waveM: 2, windMs: 2, windDeg: ALERT.offshoreDeg });
    const env = makeEnv();
    const recentlyNotified = { a1: new Date().toISOString() };

    await checkSubscription(env, SUBSCRIPTION_JSON.endpoint, { subscription: SUBSCRIPTION_JSON, alerts: [ALERT], lastNotified: recentlyNotified });

    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it('does not send when conditions do not match', async () => {
    stubForecastFetch({ waveM: 0.2, windMs: 15, windDeg: (ALERT.offshoreDeg + 180) % 360 }); // tiny + onshore
    const env = makeEnv();

    await checkSubscription(env, SUBSCRIPTION_JSON.endpoint, { subscription: SUBSCRIPTION_JSON, alerts: [ALERT], lastNotified: {} });

    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it('deletes the subscription when the push service reports it gone (410)', async () => {
    stubForecastFetch({ waveM: 2, windMs: 2, windDeg: ALERT.offshoreDeg });
    sendPushNotification.mockResolvedValue(new Response(null, { status: 410 }));
    const env = makeEnv();
    await putSubscription(env, SUBSCRIPTION_JSON.endpoint, SUBSCRIPTION_JSON, [ALERT]);

    await checkSubscription(env, SUBSCRIPTION_JSON.endpoint, { subscription: SUBSCRIPTION_JSON, alerts: [ALERT], lastNotified: {} });

    expect(await getSubscription(env, SUBSCRIPTION_JSON.endpoint)).toBeNull();
  });

  it('keeps checking other alerts on this subscription if one alert errors', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('boom', { status: 500 }))));
    const env = makeEnv();
    const secondAlert = { ...ALERT, id: 'a2', spotName: 'Pipeline' };

    // Should not throw despite every forecast fetch failing.
    await expect(checkSubscription(env, SUBSCRIPTION_JSON.endpoint, { subscription: SUBSCRIPTION_JSON, alerts: [ALERT, secondAlert], lastNotified: {} })).resolves.toBeUndefined();
    expect(sendPushNotification).not.toHaveBeenCalled();
  });
});
