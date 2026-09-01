// Client side of real (backend-driven) push notifications. The companion Cloudflare Worker
// (worker/) is the part that actually watches conditions and sends notifications while the
// app isn't open — this module only handles subscribing/unsubscribing the browser and keeping
// the Worker's copy of this device's alerts in sync. See worker/README.md for what has to be
// deployed (and by whom — this repo can't deploy itself) before any of this does anything.
//
// Both env vars are read at build time (Vite inlines import.meta.env.* into the bundle) and
// are meant to be public: a VAPID public key identifies who's allowed to push to a
// subscription, it's not a secret, and the API URL is just where requests go.
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;
const PUSH_API_URL = import.meta.env.VITE_PUSH_API_URL;

export function isPushConfigured() {
  return Boolean(VAPID_PUBLIC_KEY && PUSH_API_URL);
}

export function isPushSupported() {
  return isPushConfigured() && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// A PushManager applicationServerKey wants raw bytes, not the base64url string the VAPID key
// is generated/stored as — this is the standard conversion (same one every Web Push guide
// uses, there's no built-in for it).
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export async function getCurrentSubscription() {
  if (!isPushSupported()) return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    return await reg.pushManager.getSubscription();
  } catch {
    return null;
  }
}

// Denormalizes each alert with its spot's location — the Worker has no access to this app's
// SPOTS data (and couldn't, for a user's own custom-added spots anyway), so the alert payload
// carries what it needs to fetch and score that spot's forecast itself.
function alertsPayload(alerts, spots) {
  return alerts
    .map((a) => {
      const s = spots[a.spotId];
      if (!s) return null;
      return { id: a.id, spotId: a.spotId, spotName: s.name, lat: s.lat, lon: s.lon, offshoreDeg: s.offshoreDeg, minWaveFt: a.minWaveFt, leadTime: a.leadTime };
    })
    .filter(Boolean);
}

// Upserts this device's subscription + current alert list with the Worker. Safe to call
// whenever alerts change; a missing/unreachable Worker fails silently (best-effort, same as
// this app's other storage.set(...).catch(() => {}) calls) since there's no good in-app way
// to surface "your notification backend isn't deployed" to a user who never asked for it.
export async function syncAlertsToPush(subscription, alerts, spots) {
  if (!isPushConfigured() || !subscription) return;
  try {
    await fetch(PUSH_API_URL + '/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: subscription.toJSON(), alerts: alertsPayload(alerts, spots) }),
    });
  } catch { /* best-effort */ }
}

export async function subscribeToPush(alerts, spots) {
  if (!isPushSupported()) throw new Error('Push notifications are not supported or configured here');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission was not granted');
  const reg = await navigator.serviceWorker.ready;
  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });
  await syncAlertsToPush(subscription, alerts, spots);
  return subscription;
}

export async function unsubscribeFromPush() {
  const subscription = await getCurrentSubscription();
  if (!subscription) return;
  if (isPushConfigured()) {
    try {
      await fetch(PUSH_API_URL + '/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });
    } catch { /* best-effort */ }
  }
  await subscription.unsubscribe();
}
