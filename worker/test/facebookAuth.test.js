import { describe, it, expect, vi } from 'vitest';
import { verifyFacebookAccessToken } from '../src/facebookAuth.js';

const APP_ID = 'test-app-id';
const APP_SECRET = 'test-app-secret';

function fetchStub({ debugData, me, debugOk = true, meOk = true }) {
  return vi.fn(async (url) => {
    if (url.includes('/debug_token')) {
      return { ok: debugOk, json: async () => ({ data: debugData }) };
    }
    if (url.includes('/me')) {
      return { ok: meOk, json: async () => me };
    }
    throw new Error('Unexpected URL: ' + url);
  });
}

const validDebugData = { is_valid: true, app_id: APP_ID, expires_at: Math.floor(Date.now() / 1000) + 3600 };
const validMe = { id: '999888777', name: 'Ada Surfer', picture: { data: { url: 'https://example.com/ada.jpg' } } };

describe('verifyFacebookAccessToken', () => {
  it('accepts a token that debug_token confirms is valid and for this app', async () => {
    const fetchImpl = fetchStub({ debugData: validDebugData, me: validMe });
    const profile = await verifyFacebookAccessToken('token123', APP_ID, APP_SECRET, fetchImpl);
    expect(profile).toEqual({ sub: '999888777', name: 'Ada Surfer', picture: 'https://example.com/ada.jpg' });
    // Confirms the app-access-token shape (id|secret) is what's sent to debug_token.
    const debugCallUrl = fetchImpl.mock.calls.find(([url]) => url.includes('/debug_token'))[0];
    expect(debugCallUrl).toContain(encodeURIComponent(APP_ID + '|' + APP_SECRET));
  });

  it('rejects a token debug_token marks invalid', async () => {
    const fetchImpl = fetchStub({ debugData: { ...validDebugData, is_valid: false }, me: validMe });
    expect(await verifyFacebookAccessToken('token123', APP_ID, APP_SECRET, fetchImpl)).toBeNull();
  });

  it("rejects a token issued to a different app (a stolen/foreign token)", async () => {
    const fetchImpl = fetchStub({ debugData: { ...validDebugData, app_id: 'someone-elses-app' }, me: validMe });
    expect(await verifyFacebookAccessToken('token123', APP_ID, APP_SECRET, fetchImpl)).toBeNull();
  });

  it('rejects an expired token', async () => {
    const fetchImpl = fetchStub({ debugData: { ...validDebugData, expires_at: Math.floor(Date.now() / 1000) - 10 }, me: validMe });
    expect(await verifyFacebookAccessToken('token123', APP_ID, APP_SECRET, fetchImpl)).toBeNull();
  });

  it('treats expires_at: 0 as "never expires" (Facebook\'s convention for long-lived tokens)', async () => {
    const fetchImpl = fetchStub({ debugData: { ...validDebugData, expires_at: 0 }, me: validMe });
    expect(await verifyFacebookAccessToken('token123', APP_ID, APP_SECRET, fetchImpl)).not.toBeNull();
  });

  it('returns null if the debug_token call itself fails', async () => {
    const fetchImpl = fetchStub({ debugData: validDebugData, me: validMe, debugOk: false });
    expect(await verifyFacebookAccessToken('token123', APP_ID, APP_SECRET, fetchImpl)).toBeNull();
  });

  it('returns null if the /me call fails after a valid debug_token', async () => {
    const fetchImpl = fetchStub({ debugData: validDebugData, me: validMe, meOk: false });
    expect(await verifyFacebookAccessToken('token123', APP_ID, APP_SECRET, fetchImpl)).toBeNull();
  });

  it('returns null when required arguments are missing', async () => {
    const fetchImpl = fetchStub({ debugData: validDebugData, me: validMe });
    expect(await verifyFacebookAccessToken('', APP_ID, APP_SECRET, fetchImpl)).toBeNull();
    expect(await verifyFacebookAccessToken('token123', '', APP_SECRET, fetchImpl)).toBeNull();
    expect(await verifyFacebookAccessToken('token123', APP_ID, '', fetchImpl)).toBeNull();
  });
});
