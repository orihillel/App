// This Worker's own session tokens -- issued after a Google/Facebook login succeeds, sent
// back by the client as `Authorization: Bearer <token>` on /me and /me/data. Deliberately not
// a full JWT library: just enough of the compact JWS shape (base64url(header).base64url(payload)
// .base64url(HMAC-SHA256 signature)) to be self-contained and verifiable with nothing but Web
// Crypto, matching this repo's existing "no Node-only crypto internals" stance (see push.js).
//
// Stateless by design -- SESSION_SECRET (a `wrangler secret put` value, never committed) is the
// only thing that can forge or verify one. There's no server-side revocation list; logging out
// is purely a client-side "forget this token" action. That's an acceptable tradeoff for what
// this token gates (syncing this app's own low-stakes data), not something guarding payments or
// PII beyond a name/photo already public on the provider's own profile.

const encoder = new TextEncoder();

function base64UrlEncode(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function base64UrlDecode(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (str.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

// `payload` should at minimum carry `sub` (the user id, "google:<id>" or "facebook:<id>").
export async function createSessionToken(payload, secret, ttlSeconds = 60 * 60 * 24 * 30) {
  // "SC1" (Surfcast v1), not "JWT" -- this isn't one. Safe to have renamed from the old "TL1":
  // verifySessionToken never inspects `typ`, it verifies the HMAC over the header and payload
  // exactly as they arrived, so tokens issued under the old tag keep working until they expire.
  const header = { alg: 'HS256', typ: 'SC1' };
  const body = { ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const signingInput = base64UrlEncode(encoder.encode(JSON.stringify(header))) + '.' + base64UrlEncode(encoder.encode(JSON.stringify(body)));
  const key = await hmacKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(signingInput));
  return signingInput + '.' + base64UrlEncode(new Uint8Array(signature));
}

// Returns the payload if the token is well-formed, correctly signed, and unexpired; null
// otherwise. Never throws -- every failure mode (malformed, wrong signature, expired, garbage
// input) is just "not a valid session", which callers treat uniformly as 401.
export async function verifySessionToken(token, secret) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  try {
    const key = await hmacKey(secret);
    const valid = await crypto.subtle.verify('HMAC', key, base64UrlDecode(sigB64), encoder.encode(headerB64 + '.' + payloadB64));
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadB64)));
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
