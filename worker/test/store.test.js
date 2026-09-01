import { describe, it, expect } from 'vitest';
import { createFakeKv } from './fakeKv.js';
import { getSubscription, putSubscription, deleteSubscription, listSubscriptions } from '../src/store.js';

const SUB = { endpoint: 'https://push.example/1', keys: { p256dh: 'x', auth: 'y' } };
const ALERTS = [{ id: 'a1', spotId: 'trestles', spotName: 'Lower Trestles', lat: 33.38, lon: -117.6, offshoreDeg: 60, minWaveFt: 3, leadTime: '1d' }];

describe('subscription store', () => {
  it('round-trips through put/get', async () => {
    const env = { SUBSCRIPTIONS: createFakeKv() };
    await putSubscription(env, SUB.endpoint, SUB, ALERTS);
    const record = await getSubscription(env, SUB.endpoint);
    expect(record).toEqual({ subscription: SUB, alerts: ALERTS, lastNotified: {} });
  });

  it('returns null for an endpoint that was never stored', async () => {
    const env = { SUBSCRIPTIONS: createFakeKv() };
    expect(await getSubscription(env, 'https://push.example/never-seen')).toBeNull();
  });

  it('preserves lastNotified across a re-subscribe (alert list edit) instead of resetting cooldowns', async () => {
    const env = { SUBSCRIPTIONS: createFakeKv() };
    await putSubscription(env, SUB.endpoint, SUB, ALERTS);
    // Simulate a cooldown having been recorded by the cron check.
    const record = await getSubscription(env, SUB.endpoint);
    record.lastNotified = { a1: '2026-01-01T00:00:00.000Z' };
    await env.SUBSCRIPTIONS.put(SUB.endpoint, JSON.stringify(record));

    // User edits their alert list -> frontend re-syncs via /subscribe.
    const newAlerts = [...ALERTS, { id: 'a2', spotId: 'pipeline', spotName: 'Pipeline', lat: 21.66, lon: -158.05, offshoreDeg: 200, minWaveFt: 4, leadTime: '1h' }];
    await putSubscription(env, SUB.endpoint, SUB, newAlerts);

    const updated = await getSubscription(env, SUB.endpoint);
    expect(updated.alerts).toEqual(newAlerts);
    expect(updated.lastNotified).toEqual({ a1: '2026-01-01T00:00:00.000Z' });
  });

  it('deletes a subscription', async () => {
    const env = { SUBSCRIPTIONS: createFakeKv() };
    await putSubscription(env, SUB.endpoint, SUB, ALERTS);
    await deleteSubscription(env, SUB.endpoint);
    expect(await getSubscription(env, SUB.endpoint)).toBeNull();
  });

  it('lists every stored subscription', async () => {
    const env = { SUBSCRIPTIONS: createFakeKv() };
    await putSubscription(env, 'https://push.example/1', SUB, ALERTS);
    await putSubscription(env, 'https://push.example/2', { ...SUB, endpoint: 'https://push.example/2' }, []);

    const seen = [];
    for await (const entry of listSubscriptions(env)) seen.push(entry.endpoint);
    expect(seen.sort()).toEqual(['https://push.example/1', 'https://push.example/2']);
  });
});
