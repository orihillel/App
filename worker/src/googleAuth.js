// Verifies a Google "Sign In With Google" ID token (a standard signed JWT the Google Identity
// Services client-side script hands back after the user consents -- see src/lib/auth.js on the
// frontend). Verifying the RS256 signature ourselves via Web Crypto, rather than trusting the
// token's claims unchecked, is what makes this safe: without it, anyone could POST a
// self-issued token here claiming to be any Google user.
//
// Google publishes its signing keys at a stable JWKS URL and rotates them periodically (not on
// every request) -- fetching fresh each call is simpler than caching across a Worker's
// short-lived isolate, and this endpoint is designed to be hit frequently, so no caching here.
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

function base64UrlDecode(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (str.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
function decodeJson(base64Url) {
  return JSON.parse(new TextDecoder().decode(base64UrlDecode(base64Url)));
}

// Exported so tests can inject a fetch stub instead of hitting the real Google endpoint.
export async function fetchGoogleJwks(fetchImpl = fetch) {
  const res = await fetchImpl(GOOGLE_JWKS_URL);
  if (!res.ok) throw new Error('Failed to fetch Google JWKS: ' + res.status);
  const { keys } = await res.json();
  return keys;
}

// Returns { sub, name, picture, email } on success, or null for any reason the token isn't a
// valid, current credential for this app (bad signature, wrong audience/issuer, expired,
// malformed) -- callers treat all of those the same way (401), so there's no need to
// distinguish them here.
export async function verifyGoogleIdToken(idToken, clientId, fetchImpl = fetch) {
  if (typeof idToken !== 'string') return null;
  const parts = idToken.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;

  let header, payload;
  try {
    header = decodeJson(headerB64);
    payload = decodeJson(payloadB64);
  } catch {
    return null;
  }
  if (header.alg !== 'RS256') return null;
  if (payload.aud !== clientId) return null;
  if (!GOOGLE_ISSUERS.includes(payload.iss)) return null;
  if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;

  let keys;
  try {
    keys = await fetchGoogleJwks(fetchImpl);
  } catch {
    return null;
  }
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return null;

  try {
    const publicKey = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5', publicKey,
      base64UrlDecode(sigB64),
      new TextEncoder().encode(headerB64 + '.' + payloadB64),
    );
    if (!valid) return null;
  } catch {
    return null;
  }

  if (!payload.sub) return null;
  return { sub: payload.sub, name: payload.name || '', picture: payload.picture || '', email: payload.email || '' };
}
