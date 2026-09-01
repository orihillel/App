import { buildPushPayload } from '@block65/webcrypto-web-push';

// Sends one Web Push message. `@block65/webcrypto-web-push` builds the request using only the
// Web Crypto API, unlike the more common `web-push` npm package, which leans on Node's
// `crypto`/`https`-proxy internals that don't reliably run in the Workers runtime — this one
// works natively here with no polyfills.
export async function sendPushNotification(subscription, notification, vapid) {
  const message = {
    data: JSON.stringify(notification),
    // Stale conditions data delivered hours late isn't worth showing — let the push service
    // drop it instead of queuing it indefinitely for a device that's offline right now.
    options: { ttl: 60 * 60 },
  };
  const payload = await buildPushPayload(message, subscription, vapid);
  return fetch(subscription.endpoint, payload);
}

// The JSON body src/sw.js's `push` event listener expects.
export function buildNotificationPayload(alert, match) {
  return {
    title: alert.spotName,
    body: match.text,
    tag: 'alert-' + alert.id, // replaces a still-unread notification for the same alert
    url: './',
  };
}
