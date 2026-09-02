import { describe, it, expect } from 'vitest';
import { verifyGoogleIdToken } from '../src/googleAuth.js';

const CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
const KID = 'test-key-1';

function base64UrlEncode(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function base64UrlJson(obj) {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(obj)));
}

// Generates a throwaway RSA keypair, signs a Google-shaped ID token with it, and exports the
// public half as a JWK -- exercising the exact same RS256-over-Web-Crypto verification path
// `verifyGoogleIdToken` uses against the real Google JWKS, without needing network access or a
// real Google credential. Mirrors worker/test/push.test.js's "real crypto, throwaway keypair"
// approach for the same reason: this is the part actually worth verifying works.
async function signTestIdToken(payloadOverrides = {}) {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['sign', 'verify'],
  );
  const jwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  jwk.kid = KID;
  jwk.alg = 'RS256';
  jwk.use = 'sig';

  const header = { alg: 'RS256', kid: KID, typ: 'JWT' };
  const payload = {
    aud: CLIENT_ID, iss: 'https://accounts.google.com', sub: '1234567890',
    name: 'Ada Surfer', picture: 'https://example.com/ada.jpg', email: 'ada@example.com',
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...payloadOverrides,
  };
  const signingInput = base64UrlJson(header) + '.' + base64UrlJson(payload);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keyPair.privateKey, new TextEncoder().encode(signingInput));
  const token = signingInput + '.' + base64UrlEncode(new Uint8Array(signature));
  return { token, jwks: [jwk] };
}

function fetchStub(jwks) {
  return async () => ({ ok: true, json: async () => ({ keys: jwks }) });
}

describe('verifyGoogleIdToken', () => {
  it('accepts a genuinely signed, current token for the right audience', async () => {
    const { token, jwks } = await signTestIdToken();
    const profile = await verifyGoogleIdToken(token, CLIENT_ID, fetchStub(jwks));
    expect(profile).toEqual({ sub: '1234567890', name: 'Ada Surfer', picture: 'https://example.com/ada.jpg', email: 'ada@example.com' });
  });

  it('rejects a token for a different audience (client id)', async () => {
    const { token, jwks } = await signTestIdToken({ aud: 'someone-elses-client-id' });
    expect(await verifyGoogleIdToken(token, CLIENT_ID, fetchStub(jwks))).toBeNull();
  });

  it('rejects a token from an unrecognized issuer', async () => {
    const { token, jwks } = await signTestIdToken({ iss: 'https://evil.example.com' });
    expect(await verifyGoogleIdToken(token, CLIENT_ID, fetchStub(jwks))).toBeNull();
  });

  it('rejects an expired token', async () => {
    const { token, jwks } = await signTestIdToken({ exp: Math.floor(Date.now() / 1000) - 10 });
    expect(await verifyGoogleIdToken(token, CLIENT_ID, fetchStub(jwks))).toBeNull();
  });

  it('rejects a token whose signature does not match its claimed key', async () => {
    const { token } = await signTestIdToken();
    // A JWKS that doesn't contain the key this token claims to be signed with (kid mismatch).
    expect(await verifyGoogleIdToken(token, CLIENT_ID, fetchStub([]))).toBeNull();
  });

  it('rejects a token that was signed by a different keypair than the one published', async () => {
    const { token } = await signTestIdToken();
    // A second, unrelated keypair's public JWK claiming the *same* kid -- simulates a forged
    // signature: the published key doesn't actually match what signed this token.
    const { jwks: otherJwks } = await signTestIdToken();
    expect(await verifyGoogleIdToken(token, CLIENT_ID, fetchStub(otherJwks))).toBeNull();
  });

  it('rejects malformed input without throwing', async () => {
    expect(await verifyGoogleIdToken('not-a-jwt', CLIENT_ID, fetchStub([]))).toBeNull();
    expect(await verifyGoogleIdToken('', CLIENT_ID, fetchStub([]))).toBeNull();
    expect(await verifyGoogleIdToken(undefined, CLIENT_ID, fetchStub([]))).toBeNull();
  });

  it('returns null if the JWKS fetch itself fails', async () => {
    const { token } = await signTestIdToken();
    const failingFetch = async () => ({ ok: false, status: 500 });
    expect(await verifyGoogleIdToken(token, CLIENT_ID, failingFetch)).toBeNull();
  });
});
