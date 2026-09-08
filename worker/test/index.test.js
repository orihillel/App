import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createFakeKv } from './fakeKv.js';
import { CATALOG } from '../../src/lib/spots.catalog.js';
import { putSubscription, getSubscription } from '../src/store.js';
import { GRID_KEY } from '../src/waveGrid.js';
import { gridCellCount, encodeHeights, encodeDirections, bytesToBase64 } from '../../src/lib/wavegrid.js';

vi.mock('../src/push.js', () => ({
  sendPushNotification: vi.fn(),
  buildNotificationPayload: (alert, match) => ({ title: alert.spotName, body: match.text, tag: 'alert-' + alert.id, url: './' }),
}));
// verifyGoogleIdToken/verifyFacebookAccessToken have their own dedicated, thoroughly-tested
// modules (test/googleAuth.test.js, test/facebookAuth.test.js) exercising the real
// cryptography/Graph-API-shaped logic -- mocked here so these route-level tests focus on the
// HTTP/session/storage flow around them, not re-verifying that logic.
vi.mock('../src/googleAuth.js', () => ({ verifyGoogleIdToken: vi.fn() }));
vi.mock('../src/facebookAuth.js', () => ({ verifyFacebookAccessToken: vi.fn() }));

// Imported after the mocks so index.js picks up the mocked modules.
const { default: worker, checkSubscription } = await import('../src/index.js');
const { sendPushNotification } = await import('../src/push.js');
const { verifyGoogleIdToken } = await import('../src/googleAuth.js');
const { verifyFacebookAccessToken } = await import('../src/facebookAuth.js');

function makeEnv(overrides = {}) {
  return {
    SUBSCRIPTIONS: createFakeKv(),
    USERS: createFakeKv(),
    VAPID_SUBJECT: 'mailto:test@example.com',
    VAPID_PUBLIC_KEY: 'test-public',
    VAPID_PRIVATE_KEY: 'test-private',
    ALLOWED_ORIGIN: 'https://example.github.io',
    GOOGLE_CLIENT_ID: 'test-client-id',
    FACEBOOK_APP_ID: 'test-app-id',
    FACEBOOK_APP_SECRET: 'test-app-secret',
    SESSION_SECRET: 'test-session-secret',
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

  // GET /wavegrid builds its response from an explicit field list, which is exactly how the
  // wave directions went missing: they were fetched, encoded and stored in KV, and then dropped
  // on the way out because nobody added them here. The globe received a grid with no directions
  // and drew no arrows — indistinguishable from every other reason for no arrows.
  //
  // So this asserts the *whole* shape the app reads, not just the field that broke. Adding a
  // field to the stored grid without adding it to the wire now fails here.
  describe('GET /wavegrid', () => {
    // Nothing in here may reach the real Open-Meteo, and the first version of these tests did.
    // It passed on a machine with no egress — the route could not build, so it answered with
    // diagnostics, which is what the test asserted — and failed on CI, where the fetch
    // succeeded and the route answered with a real grid instead. A test whose result depends
    // on the runner's network is not a test; this one also failed the deploy of the very fix
    // it was written to protect, so the arrows stayed missing after the merge.
    let realFetch;
    beforeEach(() => {
      realFetch = globalThis.fetch;
      globalThis.fetch = vi.fn(async () => { throw new Error('no upstream in tests'); });
    });
    afterEach(() => { globalThis.fetch = realFetch; });

    const stored = (extra = {}) => ({
      generatedAt: Date.now(), cells: gridCellCount(), coverage: 1,
      data: bytesToBase64(encodeHeights(new Array(gridCellCount()).fill(2))),
      dirs: bytesToBase64(encodeDirections(new Array(gridCellCount()).fill(225))),
      ...extra,
    });

    it('sends every field the app reads, directions included', async () => {
      const env = makeEnv();
      const grid = stored();
      await env.SUBSCRIPTIONS.put(GRID_KEY, JSON.stringify(grid));
      const res = await worker.fetch(new Request('https://worker.example/wavegrid'), env);
      expect(res.status).toBe(200);
      const body = await res.json();
      // Named individually rather than as a snapshot: the point is that each one survives the
      // trip, and a snapshot would be updated without anyone noticing which field moved.
      expect(body.data).toBe(grid.data);
      expect(body.dirs).toBe(grid.dirs);
      expect(body.cells).toBe(grid.cells);
      expect(body.generatedAt).toBe(grid.generatedAt);
      expect(body.stale).toBe(false);
      expect(body.coverage).toBe(1);
      expect(globalThis.fetch).not.toHaveBeenCalled(); // answered from KV, as a fresh grid should be
    });

    it('sends dirs as null rather than omitting it when a grid predates them', async () => {
      // Such a grid is rebuilt rather than served fresh, but when the rebuild cannot run it is
      // still the best answer there is — heights with no arrows beats a blank globe. The app
      // tests `typeof data.dirs === 'string'`, so the key has to be there and be null, not
      // absent, and the legend then says the grid carries no directions.
      const env = makeEnv();
      const { dirs, ...noDirs } = stored({ generatedAt: Date.now() - 60 * 60 * 1000 }); // eslint-disable-line no-unused-vars
      await env.SUBSCRIPTIONS.put(GRID_KEY, JSON.stringify(noDirs));
      const res = await worker.fetch(new Request('https://worker.example/wavegrid'), env);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(globalThis.fetch).toHaveBeenCalled(); // it did try to replace it
      expect(body.data).toBe(noDirs.data); // and fell back to the heights it had
      expect('dirs' in body).toBe(true);
      expect(body.dirs).toBeNull();
      expect(body.stale).toBe(true);
    });

    it('answers with the build diagnostics, not a bare error, when there is nothing to serve', async () => {
      const env = makeEnv();
      const res = await worker.fetch(new Request('https://worker.example/wavegrid'), env);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.grid).toBeNull();
      expect(body.build).toBeTruthy();
      expect(body.build.lastError).toBeTruthy(); // says what went wrong, not just that it did
    });
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

const GOOGLE_PROFILE = { sub: '1111', name: 'Ada Surfer', picture: 'https://example.com/ada.jpg', email: 'ada@example.com' };
const FACEBOOK_PROFILE = { sub: '2222', name: 'Ada Surfer', picture: 'https://example.com/ada-fb.jpg' };
const APP_DATA = { goToId: 'pipeline', customSpots: [], alerts: [], units: 'metric' };

function authedRequest(url, sessionToken, init = {}) {
  return new Request(url, { ...init, headers: { ...(init.headers || {}), Authorization: 'Bearer ' + sessionToken } });
}

describe('account login and sync routes', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('POST /auth/google with a valid credential creates a new account and returns a session', async () => {
    verifyGoogleIdToken.mockResolvedValue(GOOGLE_PROFILE);
    const env = makeEnv();
    const res = await worker.fetch(new Request('https://worker.example/auth/google', { method: 'POST', body: JSON.stringify({ idToken: 'fake-token' }) }), env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isNewAccount).toBe(true);
    expect(body.appData).toBeNull();
    expect(body.profile).toEqual({ name: GOOGLE_PROFILE.name, picture: GOOGLE_PROFILE.picture });
    expect(typeof body.sessionToken).toBe('string');
  });

  it('POST /auth/google with an invalid credential is 401', async () => {
    verifyGoogleIdToken.mockResolvedValue(null);
    const res = await worker.fetch(new Request('https://worker.example/auth/google', { method: 'POST', body: JSON.stringify({ idToken: 'bad' }) }), makeEnv());
    expect(res.status).toBe(401);
  });

  it('POST /auth/google without idToken is 400', async () => {
    const res = await worker.fetch(new Request('https://worker.example/auth/google', { method: 'POST', body: JSON.stringify({}) }), makeEnv());
    expect(res.status).toBe(400);
    expect(verifyGoogleIdToken).not.toHaveBeenCalled();
  });

  it('POST /auth/google is 501 when GOOGLE_CLIENT_ID is not configured', async () => {
    const env = makeEnv({ GOOGLE_CLIENT_ID: undefined });
    const res = await worker.fetch(new Request('https://worker.example/auth/google', { method: 'POST', body: JSON.stringify({ idToken: 'x' }) }), env);
    expect(res.status).toBe(501);
    expect(verifyGoogleIdToken).not.toHaveBeenCalled();
  });

  it('POST /auth/facebook with a valid credential creates a new account and returns a session', async () => {
    verifyFacebookAccessToken.mockResolvedValue(FACEBOOK_PROFILE);
    const res = await worker.fetch(new Request('https://worker.example/auth/facebook', { method: 'POST', body: JSON.stringify({ accessToken: 'fake-token' }) }), makeEnv());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isNewAccount).toBe(true);
    expect(body.profile).toEqual({ name: FACEBOOK_PROFILE.name, picture: FACEBOOK_PROFILE.picture });
  });

  it('POST /auth/facebook with an invalid credential is 401', async () => {
    verifyFacebookAccessToken.mockResolvedValue(null);
    const res = await worker.fetch(new Request('https://worker.example/auth/facebook', { method: 'POST', body: JSON.stringify({ accessToken: 'bad' }) }), makeEnv());
    expect(res.status).toBe(401);
  });

  it('POST /auth/facebook is 501 when app credentials are not configured', async () => {
    const env = makeEnv({ FACEBOOK_APP_SECRET: undefined });
    const res = await worker.fetch(new Request('https://worker.example/auth/facebook', { method: 'POST', body: JSON.stringify({ accessToken: 'x' }) }), env);
    expect(res.status).toBe(501);
    expect(verifyFacebookAccessToken).not.toHaveBeenCalled();
  });

  it('a Google login and a Facebook login for the same person are two separate accounts', async () => {
    verifyGoogleIdToken.mockResolvedValue(GOOGLE_PROFILE);
    verifyFacebookAccessToken.mockResolvedValue({ ...FACEBOOK_PROFILE, sub: GOOGLE_PROFILE.sub }); // same provider-side id, different provider
    const env = makeEnv();
    const googleRes = await worker.fetch(new Request('https://worker.example/auth/google', { method: 'POST', body: JSON.stringify({ idToken: 'g' }) }), env);
    const fbRes = await worker.fetch(new Request('https://worker.example/auth/facebook', { method: 'POST', body: JSON.stringify({ accessToken: 'f' }) }), env);
    const { sessionToken: googleSession } = await googleRes.json();
    const { sessionToken: fbSession } = await fbRes.json();
    expect(googleSession).not.toBe(fbSession);
    expect(env.USERS._store.size).toBe(2);
  });

  it('GET /me without a bearer token is 401', async () => {
    const res = await worker.fetch(new Request('https://worker.example/me'), makeEnv());
    expect(res.status).toBe(401);
  });

  it('GET /me with a garbage bearer token is 401', async () => {
    const res = await worker.fetch(authedRequest('https://worker.example/me', 'not-a-real-token'), makeEnv());
    expect(res.status).toBe(401);
  });

  it('a session from login can GET its own /me record', async () => {
    verifyGoogleIdToken.mockResolvedValue(GOOGLE_PROFILE);
    const env = makeEnv();
    const loginRes = await worker.fetch(new Request('https://worker.example/auth/google', { method: 'POST', body: JSON.stringify({ idToken: 'g' }) }), env);
    const { sessionToken } = await loginRes.json();

    const meRes = await worker.fetch(authedRequest('https://worker.example/me', sessionToken), env);
    expect(meRes.status).toBe(200);
    const body = await meRes.json();
    expect(body.profile).toEqual({ name: GOOGLE_PROFILE.name, picture: GOOGLE_PROFILE.picture });
    expect(body.appData).toBeNull();
  });

  it('PUT /me/data requires auth, saves appData, and GET /me reflects it afterward', async () => {
    verifyGoogleIdToken.mockResolvedValue(GOOGLE_PROFILE);
    const env = makeEnv();
    const { sessionToken } = await (await worker.fetch(new Request('https://worker.example/auth/google', { method: 'POST', body: JSON.stringify({ idToken: 'g' }) }), env)).json();

    const unauthedPut = await worker.fetch(new Request('https://worker.example/me/data', { method: 'PUT', body: JSON.stringify({ appData: APP_DATA }) }), env);
    expect(unauthedPut.status).toBe(401);

    const putRes = await worker.fetch(authedRequest('https://worker.example/me/data', sessionToken, { method: 'PUT', body: JSON.stringify({ appData: APP_DATA }) }), env);
    expect(putRes.status).toBe(200);
    const putBody = await putRes.json();
    expect(putBody.ok).toBe(true);
    expect(typeof putBody.updatedAt).toBe('string');

    const meRes = await worker.fetch(authedRequest('https://worker.example/me', sessionToken), env);
    expect((await meRes.json()).appData).toEqual(APP_DATA);
  });

  it('logging in again on an account with saved appData reports isNewAccount: false and returns it', async () => {
    verifyGoogleIdToken.mockResolvedValue(GOOGLE_PROFILE);
    const env = makeEnv();
    const first = await (await worker.fetch(new Request('https://worker.example/auth/google', { method: 'POST', body: JSON.stringify({ idToken: 'g' }) }), env)).json();
    await worker.fetch(authedRequest('https://worker.example/me/data', first.sessionToken, { method: 'PUT', body: JSON.stringify({ appData: APP_DATA }) }), env);

    const second = await (await worker.fetch(new Request('https://worker.example/auth/google', { method: 'POST', body: JSON.stringify({ idToken: 'g' }) }), env)).json();
    expect(second.isNewAccount).toBe(false);
    expect(second.appData).toEqual(APP_DATA);
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

// The endpoint that exists so browsers stop spending Open-Meteo's per-location allowance --
// see handleForecast. A fake edge cache, because caches.default is a Workers global.
describe('GET /forecast', () => {
  let store;
  beforeEach(() => {
    store = new Map();
    globalThis.caches = {
      default: {
        match: async (req) => store.get(typeof req === 'string' ? req : req.url) || undefined,
        put: async (req, res) => { store.set(typeof req === 'string' ? req : req.url, res); },
      },
    };
  });
  afterEach(() => { delete globalThis.caches; vi.unstubAllGlobals(); });

  function okUpstream() {
    return vi.fn(async (url) => new Response(
      JSON.stringify(String(url).includes('marine') ? { hourly: { wave_height: [1] } } : { hourly: { wind_speed_10m: [3] } }),
      { status: 200 },
    ));
  }

  it('returns both upstream payloads under one roof', async () => {
    vi.stubGlobal('fetch', okUpstream());
    const res = await worker.fetch(new Request('https://worker.example/forecast?lat=33.3&lon=-117.5'), makeEnv());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.marine.hourly.wave_height).toEqual([1]);
    expect(body.wind.hourly.wind_speed_10m).toEqual([3]);
  });

  it('rejects coordinates it cannot use rather than asking upstream about NaN', async () => {
    const spy = okUpstream();
    vi.stubGlobal('fetch', spy);
    const res = await worker.fetch(new Request('https://worker.example/forecast?lat=&lon=-117.5'), makeEnv());
    expect(res.status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });

  it('serves the second asker from cache, so one spot is one upstream fetch', async () => {
    const spy = okUpstream();
    vi.stubGlobal('fetch', spy);
    const url = 'https://worker.example/forecast?lat=33.3&lon=-117.5';
    await worker.fetch(new Request(url), makeEnv());
    const calls = spy.mock.calls.length;
    const second = await worker.fetch(new Request(url), makeEnv());
    expect(spy.mock.calls.length).toBe(calls); // no further upstream traffic
    expect((await second.json()).marine.hourly.wave_height).toEqual([1]);
  });

  it('passes a rate limit through as 429, so the app can say so', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 429 })));
    const res = await worker.fetch(new Request('https://worker.example/forecast?lat=1&lon=2'), makeEnv());
    expect(res.status).toBe(429);
    expect((await res.json()).status).toBe(429);
  });

  it('never caches a failure, or the next half hour serves it too', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
    const url = 'https://worker.example/forecast?lat=5&lon=6';
    await worker.fetch(new Request(url), makeEnv());
    expect(store.size).toBe(0);

    vi.stubGlobal('fetch', okUpstream());
    const res = await worker.fetch(new Request(url), makeEnv());
    expect(res.status).toBe(200);
  });
});

// Coordinates, read strictly, on every endpoint that takes them. Number('') and Number(null)
// are both 0, and 0,0 is a real place -- so a request with no coordinates used to be answered
// about the Gulf of Guinea rather than refused.
describe('coordinate validation', () => {
  const BAD = ['?lat=&lon=-117.5', '?lon=-117.5', '?lat=33.3', '', '?lat=abc&lon=-117.5', '?lat=91&lon=0', '?lat=0&lon=181'];

  beforeEach(() => {
    globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
  });
  afterEach(() => { delete globalThis.caches; vi.unstubAllGlobals(); });

  for (const path of ['/buoy', '/forecast']) {
    it(`${path} refuses coordinates it cannot use, and asks nothing upstream`, async () => {
      const spy = vi.fn(async () => new Response('{}', { status: 200 }));
      vi.stubGlobal('fetch', spy);
      for (const qs of BAD) {
        const res = await worker.fetch(new Request('https://worker.example' + path + qs), makeEnv());
        expect(res.status, `${path}${qs}`).toBe(400);
      }
      expect(spy).not.toHaveBeenCalled();
    });
  }

  it('still accepts 0,0 when it is actually asked for', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => new Response(
      JSON.stringify(String(url).includes('marine') ? { hourly: {} } : { hourly: {} }), { status: 200 },
    )));
    const res = await worker.fetch(new Request('https://worker.example/forecast?lat=0&lon=0'), makeEnv());
    expect(res.status).toBe(200);
  });
});

// The endpoint that exists so a globe open stops costing more than a day's Open-Meteo
// allowance. Readings are cached per spot, not per request, which is what makes two viewers
// looking at the same coast cost one fetch.
describe('GET /conditions', () => {
  let store;
  beforeEach(() => {
    store = new Map();
    // Clones on the way in and on the way out, because the real Cache API hands back a fresh
    // Response for every match. Returning the stored object itself made the second read of a
    // cached entry fail with "Body has already been read" -- a property of the fake, not of the
    // handler, and exactly the kind of thing that sends you debugging the wrong file.
    globalThis.caches = {
      default: {
        match: async (req) => {
          const hit = store.get(typeof req === 'string' ? req : req.url);
          return hit ? hit.clone() : undefined;
        },
        put: async (req, res) => { store.set(typeof req === 'string' ? req : req.url, res.clone()); },
      },
    };
  });
  afterEach(() => { delete globalThis.caches; vi.unstubAllGlobals(); });

  // Multi-location current readings, shaped the way Open-Meteo answers them.
  function upstream() {
    return vi.fn(async (url) => {
      const n = (new URL(String(url)).searchParams.get('latitude') || '').split(',').length;
      const marine = String(url).includes('marine');
      const one = () => (marine
        ? { current: { time: '2026-09-08T12:00', wave_height: 1.4, wave_period: 11, wave_direction: 270, swell_wave_height: 1, swell_wave_direction: 270, swell_wave_period: 12, sea_surface_temperature: 18 } }
        : { current: { wind_speed_10m: 4, wind_direction_10m: 90 } });
      return new Response(JSON.stringify(Array.from({ length: n }, one)), { status: 200 });
    });
  }

  it('returns a reading for each id asked about', async () => {
    vi.stubGlobal('fetch', upstream());
    const res = await worker.fetch(new Request('https://worker.example/conditions?ids=trestles,pipeline'), makeEnv());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body.spots).sort()).toEqual(['pipeline', 'trestles']);
    expect(body.spots.trestles.now).toBe(true);
  });

  it('asks upstream once per spot, however many people ask for it', async () => {
    const spy = upstream();
    vi.stubGlobal('fetch', spy);
    await worker.fetch(new Request('https://worker.example/conditions?ids=trestles,pipeline'), makeEnv());
    const after = spy.mock.calls.length;
    // A second viewer, overlapping on one spot: only the new one costs anything.
    await worker.fetch(new Request('https://worker.example/conditions?ids=trestles,jbay'), makeEnv());
    const second = spy.mock.calls.slice(after).map((c) => String(c[0]));
    expect(second.length).toBeGreaterThan(0);
    for (const u of second) {
      expect(u).not.toContain(String(CATALOG.pipeline.lat));
    }
    const third = await worker.fetch(new Request('https://worker.example/conditions?ids=trestles,pipeline,jbay'), makeEnv());
    expect(spy.mock.calls.length).toBe(after + second.length); // everything already cached
    expect(Object.keys((await third.json()).spots).length).toBe(3);
  });

  it('refuses a request with no ids rather than fetching the whole catalog', async () => {
    const spy = upstream();
    vi.stubGlobal('fetch', spy);
    const res = await worker.fetch(new Request('https://worker.example/conditions'), makeEnv());
    expect(res.status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });

  it('caps how many spots one request can ask for', async () => {
    const spy = upstream();
    vi.stubGlobal('fetch', spy);
    const ids = Object.keys(CATALOG).slice(0, 400).join(',');
    const res = await worker.fetch(new Request('https://worker.example/conditions?ids=' + ids), makeEnv());
    const body = await res.json();
    expect(Object.keys(body.spots).length).toBeLessThanOrEqual(150);
  });

  it('drops ids it does not recognise instead of failing the whole request', async () => {
    vi.stubGlobal('fetch', upstream());
    const res = await worker.fetch(new Request('https://worker.example/conditions?ids=trestles,notaspot'), makeEnv());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body.spots)).toEqual(['trestles']);
  });

  it('answers with what it has when upstream fails, rather than throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 429 })));
    const res = await worker.fetch(new Request('https://worker.example/conditions?ids=trestles'), makeEnv());
    expect(res.status).toBe(200);
    expect((await res.json()).spots).toEqual({});
  });
});
