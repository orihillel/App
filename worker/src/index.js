import { fetchSpotForecast } from '../../src/lib/forecast.js';
import { checkAlertMatch } from '../../src/lib/alerts.js';
import { putSubscription, deleteSubscription, listSubscriptions } from './store.js';
import { sendPushNotification, buildNotificationPayload } from './push.js';

// Don't re-notify for an alert that's still matching on every cron run — once it's fired,
// leave it alone for this long before it can fire again.
const NOTIFY_COOLDOWN_MS = 6 * 60 * 60 * 1000;

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
function json(body, env, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders(env) } });
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
