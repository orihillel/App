// Client side of account login (Google / Meta) and cross-device sync of this app's own data.
// The companion Cloudflare Worker (worker/, the same one that runs push notifications) is
// what verifies a login credential and stores each account's synced data — see
// worker/README.md for the Google/Meta app setup this needs (that part can't be done from
// this repo alone). Without it configured, the login buttons this module backs simply don't
// render (see isGoogleConfigured/isFacebookConfigured), same "gracefully optional" pattern as
// push.js.
//
// Env vars are read at build time (Vite inlines import.meta.env.* into the bundle) and are all
// meant to be public — an OAuth client id identifies this app, it isn't a secret, same as the
// VAPID public key in push.js. VITE_PUSH_API_URL is reused here (not a separate URL) since
// login/sync live on the same Worker as push notifications.
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const FACEBOOK_APP_ID = import.meta.env.VITE_FACEBOOK_APP_ID;
const API_URL = import.meta.env.VITE_PUSH_API_URL;

export function isGoogleConfigured() {
  return Boolean(GOOGLE_CLIENT_ID && API_URL);
}
export function isFacebookConfigured() {
  return Boolean(FACEBOOK_APP_ID && API_URL);
}
export function isAuthConfigured() {
  return isGoogleConfigured() || isFacebookConfigured();
}

const SESSION_KEY = 'surf-session';

export function getSession() {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function saveSession(sessionToken, profile) {
  try { window.localStorage.setItem(SESSION_KEY, JSON.stringify({ sessionToken, profile })); } catch { /* best-effort */ }
}
export function logout() {
  try { window.localStorage.removeItem(SESSION_KEY); } catch { /* best-effort */ }
}

// Loads a third-party script at most once, however many times this is called — repeat callers
// just get the same in-flight/resolved promise back. Nothing is fetched until a login button
// actually needs it, so a visitor who never signs in never loads Google's or Meta's script.
const scriptPromises = new Map();
function loadScript(src) {
  if (!scriptPromises.has(src)) {
    scriptPromises.set(src, new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src;
      el.async = true;
      el.onload = () => resolve();
      el.onerror = () => reject(new Error('Failed to load ' + src));
      document.head.appendChild(el);
    }));
  }
  return scriptPromises.get(src);
}

// Renders Google's own "Sign in with Google" button into `container` (a DOM element) and calls
// `onCredential(idToken)` once the user completes it. Google's client library owns the whole
// consent UI; this app never sees the user's Google password, only the signed ID token
// afterward (which the Worker verifies — see worker/src/googleAuth.js).
export async function renderGoogleButton(container, onCredential) {
  await loadScript('https://accounts.google.com/gsi/client');
  window.google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: (response) => onCredential(response.credential),
  });
  window.google.accounts.id.renderButton(container, { theme: 'filled_black', size: 'large', shape: 'pill', width: 300 });
}

// Facebook's JS SDK expects a global `fbAsyncInit` callback it calls once loaded, rather than
// a promise — this wraps that into one, the same "load once, reuse the same promise" way as
// loadScript() above.
let fbInitPromise = null;
function loadFacebookSdk() {
  if (!fbInitPromise) {
    fbInitPromise = new Promise((resolve, reject) => {
      window.fbAsyncInit = () => {
        window.FB.init({ appId: FACEBOOK_APP_ID, version: 'v21.0', xfbml: false });
        resolve();
      };
      // Must start loading the script *while* setting up fbAsyncInit, not after waiting on
      // it — the script itself is what calls fbAsyncInit once loaded, so chaining this via
      // .then() on the promise above would deadlock (nothing left to trigger the resolve).
      // If the script tag itself fails (network error, blocked), reject rather than hang
      // forever waiting for an fbAsyncInit call that will now never come.
      loadScript('https://connect.facebook.net/en_US/sdk.js').catch(reject);
    });
  }
  return fbInitPromise;
}

// Opens Facebook's login popup and resolves with an access token, or throws if the user
// cancels/denies. Only asks for public_profile — this app has no use for anything more (no
// posting, no friends list, no email even).
export async function loginWithFacebook() {
  await loadFacebookSdk();
  return new Promise((resolve, reject) => {
    window.FB.login((response) => {
      if (response.authResponse && response.authResponse.accessToken) resolve(response.authResponse.accessToken);
      else reject(new Error('Facebook login was cancelled'));
    }, { scope: 'public_profile' });
  });
}

async function postJson(path, body) {
  const res = await fetch(API_URL + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ('Sign-in failed (' + res.status + ')'));
  return data;
}

// Exchanges a verified Google/Facebook credential for this app's own session, and stores it.
// The result's `appData` is null for a genuinely new account (nothing synced yet) or that
// account's previously-synced data otherwise — App.jsx's handleLoginResult decides which of
// "upload what's on this device" vs "replace it with what's synced" applies.
export async function loginWithGoogleIdToken(idToken) {
  const data = await postJson('/auth/google', { idToken });
  saveSession(data.sessionToken, data.profile);
  return data;
}
export async function loginWithFacebookAccessToken(accessToken) {
  const data = await postJson('/auth/facebook', { accessToken });
  saveSession(data.sessionToken, data.profile);
  return data;
}

// Re-fetches this account's synced data from the server — used on app load when a session is
// already stored locally, in case another device changed something since this one last synced.
// Throws on any failure (network, expired/invalid token, unreachable Worker); App.jsx's mount
// effect treats that as "couldn't refresh right now" and just keeps using local data, the same
// best-effort spirit as everything else here.
export async function fetchMyAccount(sessionToken) {
  const res = await fetch(API_URL + '/me', { headers: { Authorization: 'Bearer ' + sessionToken } });
  if (!res.ok) throw new Error('Not authenticated (' + res.status + ')');
  return res.json();
}

// Pushes this device's current app data (go-to spot, custom-added spots, alerts, units) up to
// the account so another device can pull it. Best-effort, fire-and-forget from callers, same
// as push.js's syncAlertsToPush — a logged-in user's data staying local-only if the Worker is
// briefly unreachable is a much smaller problem than surfacing sync errors for something this
// low-stakes.
export async function pushAppData(sessionToken, appData) {
  if (!API_URL || !sessionToken) return;
  try {
    await fetch(API_URL + '/me/data', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + sessionToken },
      body: JSON.stringify({ appData }),
    });
  } catch { /* best-effort */ }
}
