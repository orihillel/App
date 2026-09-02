// KV access for user accounts. One entry per user, keyed by "<provider>:<providerUserId>"
// (e.g. "google:10987654321" or "facebook:123456789") -- a provider account, not an email, is
// the identity: this app never sees a password and never needs to reconcile "same email,
// different provider" itself.
//
// Value shape: { profile: { name, picture }, appData, updatedAt }
//   profile: display info from the provider, refreshed on every login
//   appData: this user's synced app state -- see App.jsx's `defaultAppData` for the shape
//     (goToId, customSpots, alerts, units). Deliberately NOT the full built-in spot catalog or
//     `order` list -- that's baked into the app itself and identical on every device, so
//     syncing it would just be waste.
//   updatedAt: ISO timestamp of the last write, returned to the client after a save

export async function getUser(env, userId) {
  const raw = await env.USERS.get(userId);
  return raw ? JSON.parse(raw) : null;
}

// Creates the record if it doesn't exist yet (profile + empty appData), or just refreshes the
// profile fields if it does -- a login should never silently wipe out previously-synced
// appData. Returns the resulting record either way, and whether this was a first-ever login
// for this account (the caller uses that to decide "upload local data" vs "download synced
// data" -- see App.jsx's handleLoginResult).
export async function upsertUserProfile(env, userId, profile) {
  const existing = await getUser(env, userId);
  const isNewAccount = !existing;
  const record = {
    profile,
    appData: existing ? existing.appData : null,
    updatedAt: existing ? existing.updatedAt : new Date().toISOString(),
  };
  await env.USERS.put(userId, JSON.stringify(record));
  return { record, isNewAccount };
}

export async function putUserAppData(env, userId, appData) {
  const existing = await getUser(env, userId);
  const record = { profile: existing ? existing.profile : {}, appData, updatedAt: new Date().toISOString() };
  await env.USERS.put(userId, JSON.stringify(record));
  return record;
}
