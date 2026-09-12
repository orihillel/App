import { fetchSpotForecast, fetchNowForSpots } from '../../src/lib/forecast.js';
import { CATALOG } from '../../src/lib/spots.catalog.js';
import { checkAlertMatch } from '../../src/lib/alerts.js';
import { fetchMarine } from '../../src/lib/marine.js';
import { outlookUrl } from '../../src/lib/outlook.js';
import { putSubscription, deleteSubscription, listSubscriptions } from './store.js';
import { sendPushNotification, buildNotificationPayload } from './push.js';
import { verifyGoogleIdToken } from './googleAuth.js';
import { verifyFacebookAccessToken } from './facebookAuth.js';
import { createSessionToken, verifySessionToken } from './session.js';
import { getUser, upsertUserProfile, putUserAppData } from './userStore.js';
import { loadAllStations, nearestWaveStation, isFresh, toObservation } from './buoySources.js';
import { loadTideStations, nearestTideStation, loadPredictions } from './noaaTide.js';
import { loadGrid } from './waveGrid.js';
import { loadFrames, advanceFrames } from './waveFrames.js';

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
// Live buoy observations, proxied and cached. Sources and caching live in buoySources.js —
// each network is fetched and cached separately so one being down or slow costs only itself.
// The lat/lon pair two endpoints take, read once and read strictly.
//
// Number('') and Number(null) are both 0, so reading these straight through Number() lets a
// missing or empty coordinate pass as a real one -- and 0,0 is a real place, in the Gulf of
// Guinea. A request with no coordinates was being answered about the ocean off Ghana rather
// than refused. Returns null when there is nothing usable, so callers can say 400.
function readCoords(url) {
  const latRaw = url.searchParams.get('lat');
  const lonRaw = url.searchParams.get('lon');
  if (!latRaw || !lonRaw) return null;
  const lat = Number(latRaw);
  const lon = Number(lonRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

async function handleBuoy(request, env) {
  const coords = readCoords(new URL(request.url));
  if (!coords) return json({ error: 'lat and lon required' }, env, 400);
  const { lat, lon } = coords;
  try {
    const stations = await loadAllStations(env);
    const nearest = nearestWaveStation(stations, lat, lon);
    // No buoy in range, or the nearest one has gone quiet: say so plainly rather than
    // presenting a stale or distant reading as if it were this spot's conditions.
    if (!nearest || !isFresh(nearest.observedAt)) return json({ observation: null }, env);
    return json({ observation: toObservation(nearest) }, env);
  } catch {
    // Every source being down must never take the app's own endpoints with it.
    return json({ observation: null }, env);
  }
}

// Real, harmonic tide predictions where NOAA has a station nearby — see noaaTide.js. Always a
// 200: no station in range, an upstream failure, or a malformed response all come back as
// `{ predictions: null }` rather than an error, because this is a pure enhancement over the
// modeled tide curve every spot already has. Nothing about the spot page depends on it.
async function handleTide(request, env) {
  const coords = readCoords(new URL(request.url));
  if (!coords) return json({ error: 'lat and lon required' }, env, 400);
  const { lat, lon } = coords;
  try {
    const stations = await loadTideStations(env);
    const nearest = nearestTideStation(stations, lat, lon);
    if (!nearest) return json({ predictions: null }, env);
    const predictions = await loadPredictions(env, nearest);
    if (!predictions.length) return json({ predictions: null }, env);
    return json({
      station: { id: nearest.id, name: nearest.name, km: Math.round(nearest.km * 10) / 10 },
      predictions,
    }, env);
  } catch {
    return json({ predictions: null }, env);
  }
}

// A spot's seven-day forecast, fetched from here rather than from each visitor's browser.
//
// Open-Meteo counts its free allowance per *location*, not per request, and the app knows 403
// spots. A browser that colours every marker spends hundreds of an allowance shared by everyone
// behind one address, and when it runs out the spot page's own two requests are refused along
// with the rest -- every spot reading "no forecast" while this Worker's endpoints, calling from
// Cloudflare's addresses, carried on answering. That is the bug this endpoint exists to end.
//
// Cached at the edge, so one upstream fetch per spot per half hour serves everyone who asks.
// The response is the two upstream payloads passed through untouched: the shaping of them into
// hours, tides and ratings lives in the app (src/lib/forecast.js) and stays there, so this
// cannot drift away from what the app expects to parse.
const FORECAST_TTL_S = 1800;

async function handleForecast(request, env) {
  const url = new URL(request.url);
  const coords = readCoords(url);
  if (!coords) return json({ error: 'lat and lon required' }, env, 400);
  const { lat, lon } = coords;

  // Keyed on the normalised coordinates alone. The incoming URL may carry anything else and
  // must not split the cache -- two visitors asking for the same spot are one upstream fetch.
  const cache = caches.default;
  const cacheKey = new Request(url.origin + '/forecast?lat=' + lat + '&lon=' + lon);
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const windUrl = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon +
    '&hourly=wind_speed_10m,wind_direction_10m&daily=sunrise,sunset&timezone=auto&forecast_days=7';

  let marineRes;
  let windRes;
  try {
    [marineRes, windRes] = await Promise.all([fetchMarine(lat, lon), fetch(windUrl)]);
  } catch {
    return json({ error: 'upstream unreachable' }, env, 502);
  }
  if (!marineRes.ok || !windRes.ok) {
    // The upstream status is passed on rather than flattened to one error, because the app
    // tells a rate limit apart from a rejected request and says different things about them.
    const bad = marineRes.ok ? windRes : marineRes;
    return json({ error: 'upstream', status: bad.status }, env, bad.status === 429 ? 429 : 502);
  }

  let marine;
  let wind;
  try {
    [marine, wind] = await Promise.all([marineRes.json(), windRes.json()]);
  } catch {
    return json({ error: 'upstream returned junk' }, env, 502);
  }

  const res = json({ marine, wind }, env);
  res.headers.set('Cache-Control', 'public, max-age=' + FORECAST_TTL_S);
  // Only a good answer is cached; an error must not be served for the next half hour.
  await cache.put(cacheKey, res.clone());
  return res;
}

// The long-range outlook, proxied and cached on the same terms as /forecast.
//
// It is a separate, far smaller upstream call than /forecast -- one daily variable over 16 days
// rather than thirteen hourly ones over 7 -- and it exists here for the same reason /forecast
// does: Open-Meteo is unreachable from some networks entirely, so a browser asking it directly
// simply fails for those people. See src/lib/outlook.js.
const OUTLOOK_TTL_S = 10800;

async function handleOutlook(request, env) {
  const url = new URL(request.url);
  const coords = readCoords(url);
  if (!coords) return json({ error: 'lat and lon required' }, env, 400);
  const { lat, lon } = coords;

  const cache = caches.default;
  const cacheKey = new Request(url.origin + '/outlook?lat=' + lat + '&lon=' + lon);
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  let upstream;
  try {
    upstream = await fetch(outlookUrl(lat, lon));
  } catch {
    return json({ error: 'upstream unreachable' }, env, 502);
  }
  if (!upstream.ok) {
    return json({ error: 'upstream', status: upstream.status }, env, upstream.status === 429 ? 429 : 502);
  }
  let body;
  try {
    body = await upstream.json();
  } catch {
    return json({ error: 'upstream returned junk' }, env, 502);
  }

  // Three hours rather than /forecast's thirty minutes. This is a daily maximum a week or more
  // out: it does not meaningfully change between model runs, and the whole point of the endpoint
  // is that it costs almost nothing to serve.
  const res = json(body, env);
  res.headers.set('Cache-Control', 'public, max-age=' + OUTLOOK_TTL_S);
  await cache.put(cacheKey, res.clone());
  return res;
}

// "Right now" readings for the globe's markers, fetched here and cached per spot.
//
// Open-Meteo bills by values returned, and one of these readings is 36 of them: ten marine
// current variables, two wind, and a 24-hour sea-level series that is what lets a marker be
// scored on tide the same way the spot page is. Every browser was fetching all of them for
// every spot in the catalog on every globe open -- 540 spots, 19,440 units, against a free
// allowance of 10,000 a day. One person opening the globe once spent more than a day's worth,
// which is exactly how the app came to sit on "no forecast" for an evening.
//
// Two things fix that, and this endpoint is both. Asking only for the spots someone is actually
// looking at (the globe reports them; see onVisibleSpots in Globe.jsx) turns hundreds into
// dozens. Caching each spot separately here means the second person to look at a coast, and the
// same person looking again, spends nothing: a cache key per spot rather than per request means
// any overlap between two viewers' screens is already paid for.
const CONDITIONS_TTL_S = 1800;

// A bound on one request, not on how much of the world can be seen: the globe asks again as it
// moves, and anything already cached comes back free.
const CONDITIONS_MAX_IDS = 150;

function conditionKey(origin, id) {
  return new Request(origin + '/__condition/' + encodeURIComponent(id));
}

async function handleConditions(request, env) {
  const url = new URL(request.url);
  const raw = (url.searchParams.get('ids') || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!raw.length) return json({ error: 'ids required' }, env, 400);

  // Unknown ids are dropped rather than refused: a visitor on an older build can ask about a
  // spot this one has retired, and the rest of their screen should still fill in.
  const ids = [...new Set(raw)].filter((id) => CATALOG[id]).slice(0, CONDITIONS_MAX_IDS);
  if (!ids.length) return json({ spots: {} }, env);

  const cache = caches.default;
  const spots = {};
  const misses = [];
  await Promise.all(ids.map(async (id) => {
    const hit = await cache.match(conditionKey(url.origin, id));
    if (hit) { spots[id] = await hit.json(); return; }
    misses.push(id);
  }));

  if (misses.length) {
    let fresh;
    try {
      fresh = await fetchNowForSpots(misses.map((id) => ({ id, spot: CATALOG[id] })));
    } catch { fresh = {}; }
    for (const [id, reading] of Object.entries(fresh)) {
      spots[id] = reading;
      const stored = json(reading, env);
      stored.headers.set('Cache-Control', 'public, max-age=' + CONDITIONS_TTL_S);
      // Not awaited into the response path: a slow cache write must not hold up the answer.
      await cache.put(conditionKey(url.origin, id), stored);
    }
  }

  // No Cache-Control on the envelope itself. The per-spot entries above are the cache; caching
  // the combined answer too would key it on this exact id list, which is never asked for twice.
  return json({ spots, cached: ids.length - misses.length, fetched: misses.length }, env);
}

// The global wave-height grid for the globe's ocean overlay. See waveGrid.js.
//
// Built inline rather than in the background. Background builds were tried three ways and none
// could be observed failing; this one either answers with a map or says why it could not.
async function handleWaveGrid(request, env) {
  try {
    const { grid, build } = await loadGrid(env);
    if (!grid) return json({ grid: null, build }, env);
    return json({
      generatedAt: grid.generatedAt, cells: grid.cells, data: grid.data,
      // The directions the arrows are drawn from. They were fetched, encoded and stored, and
      // then dropped right here: this response is an explicit field list, and adding a field to
      // the grid does not add it to the wire. The globe saw a grid with no directions and drew
      // no arrows, which looked like every other reason for no arrows.
      dirs: grid.dirs ?? null,
      stale: !!grid.stale, coverage: grid.coverage ?? null, build,
    }, env);
  } catch (e) {
    return json({ grid: null, build: { lastError: String((e && e.message) || e) } }, env);
  }
}

// The animated week. Separate from /wavegrid rather than folded into it: the two are built on
// different grids at different cadences, and an app that only wants the live overlay should not
// have to download 28 frames to get it.
async function handleWaveFrames(request, env) {
  try {
    const { frames, build } = await loadFrames(env);
    if (!frames) return json({ frames: null, build }, env);
    return json({
      generatedAt: frames.generatedAt,
      cells: frames.cells,
      latStep: frames.latStep,
      stepHours: frames.stepHours,
      // Named individually rather than spread, the same way /wavegrid learned to: adding a
      // field to the build does not add it to the wire, and the last time that was forgotten
      // the globe drew no arrows and looked like every other reason for no arrows.
      frames: frames.frames,
      stale: !!frames.stale,
      coverage: frames.coverage ?? null,
      build,
    }, env);
  } catch (e) {
    return json({ frames: null, build: { lastError: String((e && e.message) || e) } }, env);
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
    if (request.method === 'GET' && url.pathname === '/tide') return handleTide(request, env);
    if (request.method === 'GET' && url.pathname === '/forecast') return handleForecast(request, env);
    if (request.method === 'GET' && url.pathname === '/conditions') return handleConditions(request, env);
    if (request.method === 'GET' && url.pathname === '/outlook') return handleOutlook(request, env);
    if (request.method === 'GET' && url.pathname === '/wavegrid') return handleWaveGrid(request, env);
    if (request.method === 'GET' && url.pathname === '/wavegrid/frames') return handleWaveFrames(request, env);
    if (request.method === 'GET' && url.pathname === '/health') return json({ ok: true }, env);
    return json({ error: 'Not found' }, env, 404);
  },

  // Cron trigger (see wrangler.toml) — the whole reason this Worker exists: check every
  // subscribed device's alerts against live conditions and push notifications for matches,
  // independent of whether the app is open anywhere.
  async scheduled(event, env, ctx) {
    // Refresh the wave grid here rather than on a user's request. loadGrid only does upstream
    // work when the cache is older than the model's own update cadence, so this is a no-op on
    // most of the half-hourly runs — but it means the first person to open the globe after a
    // model run gets a warm cache instead of waiting on a thousand upstream points.
    // Keep the cache warm so the first person to open the overlay after a model run does not
    // pay for the build. It is only a warm-up: /wavegrid builds for itself if this never runs,
    // which is the difference from the version that depended on this firing.
    ctx.waitUntil(loadGrid(env).catch(() => {}));
    // One pass of the animated week. It cannot be built on demand: 28 frames is 5,208 units
    // against a per-minute allowance of about 600, so a single build gets three frames in and
    // is refused the rest. Each tick takes as many frames as a minute affords and appends them,
    // so the week assembles over a handful of ticks and no pass ever exceeds the limit. A pass
    // over a week that is already complete and fresh costs nothing.
    ctx.waitUntil(advanceFrames(env).catch(() => {}));
    for await (const { endpoint, record } of listSubscriptions(env)) {
      ctx.waitUntil(checkSubscription(env, endpoint, record));
    }
  },
};
