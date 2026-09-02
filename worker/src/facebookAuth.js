// Verifies a Facebook (Meta) Login access token -- the client-side Facebook JS SDK's
// FB.login() hands one back after the user consents (see src/lib/auth.js on the frontend).
// Unlike a Google ID token, a Facebook access token isn't a self-verifying signed JWT, so
// confirming it's genuinely valid *and issued to this app* (not some other app's token) needs
// a server-side round trip to Meta's own Graph API: /debug_token, using this app's own
// id|secret as the inspecting credential, is the documented way to do that.
//
// Requires a Meta app (App ID + App Secret from developers.facebook.com) that's gone through
// Meta's app review before the public can use it -- until then, Facebook Login only works for
// accounts added as testers in that app's dashboard. See worker/README.md.
const GRAPH_BASE = 'https://graph.facebook.com';

// Exported so tests can inject a fetch stub instead of hitting the real Graph API.
export async function verifyFacebookAccessToken(accessToken, appId, appSecret, fetchImpl = fetch) {
  if (!accessToken || !appId || !appSecret) return null;

  let debugData;
  try {
    const appToken = appId + '|' + appSecret;
    const debugRes = await fetchImpl(
      `${GRAPH_BASE}/debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${encodeURIComponent(appToken)}`,
    );
    if (!debugRes.ok) return null;
    const debugBody = await debugRes.json();
    debugData = debugBody.data;
  } catch {
    return null;
  }
  if (!debugData || !debugData.is_valid || String(debugData.app_id) !== String(appId)) return null;
  if (debugData.expires_at && debugData.expires_at !== 0 && debugData.expires_at < Math.floor(Date.now() / 1000)) return null;

  try {
    const meRes = await fetchImpl(
      `${GRAPH_BASE}/me?fields=id,name,picture&access_token=${encodeURIComponent(accessToken)}`,
    );
    if (!meRes.ok) return null;
    const me = await meRes.json();
    if (!me.id) return null;
    return { sub: me.id, name: me.name || '', picture: (me.picture && me.picture.data && me.picture.data.url) || '' };
  } catch {
    return null;
  }
}
