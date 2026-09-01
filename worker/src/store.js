// KV access for subscriptions. One KV entry per browser push subscription, keyed by its
// endpoint URL (unique per subscription by definition, and short enough to be a fine KV key).
//
// Value shape: { subscription, alerts, lastNotified }
//   subscription: the PushSubscription JSON from the browser (endpoint + keys.p256dh/auth)
//   alerts: this device's alert list, denormalized with each alert's spot location — see
//     src/lib/push.js's alertsPayload() on the frontend for why (the Worker has no access to
//     the frontend's spot database)
//   lastNotified: { [alertId]: isoTimestamp } — cooldown tracking so a still-matching alert
//     doesn't get re-pushed every single cron run

export async function getSubscription(env, endpoint) {
  const raw = await env.SUBSCRIPTIONS.get(endpoint);
  return raw ? JSON.parse(raw) : null;
}

export async function putSubscription(env, endpoint, subscription, alerts) {
  // Preserve lastNotified across a re-subscribe/alert-list sync — otherwise every alert edit
  // would reset the cooldown and could re-notify immediately for something already just sent.
  const existing = await getSubscription(env, endpoint);
  const record = { subscription, alerts, lastNotified: (existing && existing.lastNotified) || {} };
  await env.SUBSCRIPTIONS.put(endpoint, JSON.stringify(record));
  return record;
}

export async function deleteSubscription(env, endpoint) {
  await env.SUBSCRIPTIONS.delete(endpoint);
}

// Yields every stored subscription record, transparently paging through KV's list() cursor
// (a single list() call caps out at 1000 keys) so the cron handler sees all of them regardless
// of how many devices are subscribed.
export async function* listSubscriptions(env) {
  let cursor;
  do {
    const page = await env.SUBSCRIPTIONS.list({ cursor });
    for (const key of page.keys) {
      const record = await getSubscription(env, key.name);
      if (record) yield { endpoint: key.name, record };
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
}
