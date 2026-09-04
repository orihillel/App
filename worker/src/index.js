import { fetchSpotForecast } from '../../src/lib/forecast.js';
import { checkAlertMatch } from '../../src/lib/alerts.js';
import { putSubscription, deleteSubscription, listSubscriptions } from './store.js';
import { sendPushNotification, buildNotificationPayload } from './push.js';
import { verifyGoogleIdToken } from './googleAuth.js';
import { verifyFacebookAccessToken } from './facebookAuth.js';
import { createSessionToken, verifySessionToken } from './session.js';
import { getUser, upsertUserProfile, putUserAppData } from './userStore.js';
import { LATEST_OBS_URL, parseLatestObs, nearestWaveStation, isFresh, toObservation } from './buoys.js';

// Don't re-notify for an alert that's still matching on every cron run — once it's fired,
// leave it alone for this long before it can fire again.
const NOTIFY_COOLDOWN_MS = 6 * 60 * 60 * 1000;

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}
function json(body, env, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders(env) } });
}

// Live buoy observations, proxied and cached.
//
// NDBC sends no CORS headers, so the browser cannot read this directly — and one fetch of the
// all-stations table here serves every user and every spot, which is the polite way to consume
// a free public service. Cached in KV so a busy minute is still one upstream request.
const BUOY_CACHE_KEY = 'ndbc:latest_obs';
const BUOY_CACHE_TTL_S = 600; // NDBC publishes roughly every 10 minutes

async function loadStations(env) {
  const cached = await env.SUBSCRIPTIONS.get(BUOY_CACHE_KEY);
  if (cached) return parseLatestObs(cached);
  const res = await fetch(LATEST_OBS_URL, { headers: { 'User-Agent': 'surfcast-surf-app' } });
  if (!res.ok) throw new Error('NDBC request failed: ' + res.status);
  const text = await res.text();
  await env.SUBSCRIPTIONS.put(BUOY_CACHE_KEY, text, { expirationTtl: BUOY_CACHE_TTL_S });
  return parseLatestObs(text);
}

async function handleBuoy(request, env) {
  const url = new URL(request.url);
  const lat = Number(url.searchParams.get('lat'));
  const lon = Number(url.searchParams.get('lon'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return json({ error: 'lat and lon required' }, env, 400);
  }
  try {
    const stations = await loadStations(env);
    const nearest = nearestWaveStation(stations, lat, lon);
    // No buoy in range, or the nearest one has gone quiet: say so plainly rather than
    // presenting a stale or distant reading as if it were this spot's conditions.
    if (!nearest || !isFresh(nearest.observedAt)) return json({ observation: null }, env);
    return json({ observation: toObservation(nearest) }, env);
  } catch {
    // NDBC being down must never take the app's own endpoints with it.
    return json({ observation: null }, env);
  }
}

async function handleSubscribe(request, env) {
  const { subscription, alerts } = await request.json();
  if (!subscription || !subscription.endpoint) return json({ error: 'Missing subscription' }, env, 400);
  await putSubscription(env, subscription.endpoint, subscription, Array.isArray(alerts) ? alerts : []);
  return json({ ok: true }, env);
}

async function handleUnsubscribe(request, env) {
  const { endpoint } = await request.json();
  if (!endpoint) return json({ error: 'Missing endpoint' }, env, 400);
  await deleteSubscription(env, endpoint);
  return json({ ok: true }, env);
}

// Account login (Google/Meta) and cross-device sync of this app's own low-stakes data (go-to
// spot, custom-added spots, alerts, units) -- see src/lib/auth.js on the frontend and
// worker/README.md for the provider setup this needs. Not a general-purpose auth system: the
// session token below is scoped to exactly two endpoints (GET/PUT /me*), and appData is a
// single small JSON blob per user, not a real per-record API.

async function issueSession(env, provider, providerProfile) {
  const userId = provider + ':' + providerProfile.sub;
  const { record, isNewAccount } = await upsertUserProfile(env, userId, { name: providerProfile.name, picture: providerProfile.picture });
  const sessionToken = await createSessionToken({ sub: userId }, env.SESSION_SECRET);
  return { sessionToken, profile: record.profile, appData: record.appData, isNewAccount };
}

async function handleGoogleAuth(request, env) {
  const { idToken } = await request.json();
  if (!idToken) return json({ error: 'Missing idToken' }, env, 400);
  if (!env.GOOGLE_CLIENT_ID) return json({ error: 'Google sign-in is not configured on this server' }, env, 501);
  const profile = await verifyGoogleIdToken(idToken, env.GOOGLE_CLIENT_ID);
  if (!profile) return json({ error: 'Invalid Google credential' }, env, 401);
  return json(await issueSession(env, 'google', profile), env);
}

async function handleFacebookAuth(request, env) {
  const { accessToken } = await request.json();
  if (!accessToken) return json({ error: 'Missing accessToken' }, env, 400);
  if (!env.FACEBOOK_APP_ID || !env.FACEBOOK_APP_SECRET) return json({ error: 'Facebook login is not configured on this server' }, env, 501);
  const profile = await verifyFacebookAccessToken(accessToken, env.FACEBOOK_APP_ID, env.FACEBOOK_APP_SECRET);
  if (!profile) return json({ error: 'Invalid Facebook credential' }, env, 401);
  return json(await issueSession(env, 'facebook', profile), env);
}

// Returns the session's user id (e.g. "google:123") if the request carries a valid, unexpired
// bearer token, or null otherwise -- callers respond 401 either way, so there's no need for a
// more specific error here.
async function requireSession(request, env) {
  const header = request.headers.get('Authorization') || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  const payload = await verifySessionToken(token, env.SESSION_SECRET);
  return payload ? payload.sub : null;
}

async function handleGetMe(request, env) {
  const userId = await requireSession(request, env);
  if (!userId) return json({ error: 'Not authenticated' }, env, 401);
  const record = await getUser(env, userId);
  if (!record) return json({ error: 'Account not found' }, env, 404);
  return json({ profile: record.profile, appData: record.appData }, env);
}

async function handlePutMeData(request, env) {
  const userId = await requireSession(request, env);
  if (!userId) return json({ error: 'Not authenticated' }, env, 401);
  const { appData } = await request.json();
  if (!appData || typeof appData !== 'object') return json({ error: 'Missing appData' }, env, 400);
  const record = await putUserAppData(env, userId, appData);
  return json({ ok: true, updatedAt: record.updatedAt }, env);
}

// Checks one subscription's alerts against live conditions and pushes notifications for
// whichever ones match and are past their cooldown. Exported (not just used from `scheduled`)
// so tests can exercise it directly against a fake env, and so a future manual-trigger route
// could reuse it without duplicating the logic.
export async function checkSubscription(env, endpoint, record) {
  const lastNotified = { ...record.lastNotified };
  let changed = false;

  for (const alert of record.alerts) {
    try {
      const spotForecast = await fetchSpotForecast({ lat: alert.lat, lon: alert.lon, offshoreDeg: alert.offshoreDeg });
      const match = checkAlertMatch(alert, spotForecast);
      if (!match || !match.hit) continue;

      const last = lastNotified[alert.id] ? new Date(lastNotified[alert.id]).getTime() : 0;
      if (Date.now() - last < NOTIFY_COOLDOWN_MS) continue;

      const res = await sendPushNotification(record.subscription, buildNotificationPayload(alert, match), {
        subject: env.VAPID_SUBJECT,
        publicKey: env.VAPID_PUBLIC_KEY,
        privateKey: env.VAPID_PRIVATE_KEY,
      });
      if (res.status === 404 || res.status === 410) {
        // The push service says this subscription is gone for good (unsubscribed, browser
        // data cleared, etc.) — stop sending to it rather than retrying forever.
        await deleteSubscription(env, endpoint);
        return;
      }
      lastNotified[alert.id] = new Date().toISOString();
      changed = true;
    } catch (e) {
      // One alert's forecast fetch or push failing shouldn't stop the rest of this
      // subscription's alerts, or the run's other subscriptions, from being checked.
      console.error('Alert check failed', { endpoint, alertId: alert.id, error: String(e) });
    }
  }

  // Write the updated cooldown timestamps directly (skipping putSubscription(), whose
  // "preserve existing lastNotified" behavior is for the subscribe-endpoint use case, not
  // this one — here `lastNotified` above already *is* that preserved value, updated).
  if (changed) await env.SUBSCRIPTIONS.put(endpoint, JSON.stringify({ subscription: record.subscription, alerts: record.alerts, lastNotified }));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(env) });
    if (request.method === 'POST' && url.pathname === '/subscribe') return handleSubscribe(request, env);
    if (request.method === 'POST' && url.pathname === '/unsubscribe') return handleUnsubscribe(request, env);
    if (request.method === 'POST' && url.pathname === '/auth/google') return handleGoogleAuth(request, env);
    if (request.method === 'POST' && url.pathname === '/auth/facebook') return handleFacebookAuth(request, env);
    if (request.method === 'GET' && url.pathname === '/me') return handleGetMe(request, env);
    if (request.method === 'PUT' && url.pathname === '/me/data') return handlePutMeData(request, env);
    if (request.method === 'GET' && url.pathname === '/buoy') return handleBuoy(request, env);
    if (request.method === 'GET' && url.pathname === '/health') return json({ ok: true }, env);
    return json({ error: 'Not found' }, env, 404);
  },

  // Cron trigger (see wrangler.toml) — the whole reason this Worker exists: check every
  // subscribed device's alerts against live conditions and push notifications for matches,
  // independent of whether the app is open anywhere.
  async scheduled(event, env, ctx) {
    for await (const { endpoint, record } of listSubscriptions(env)) {
      ctx.waitUntil(checkSubscription(env, endpoint, record));
    }
  },
};
