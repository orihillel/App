import { describe, it, expect } from 'vitest';
import { createFakeKv } from './fakeKv.js';
import { getUser, upsertUserProfile, putUserAppData } from '../src/userStore.js';

function envWith(kv) {
  return { USERS: kv };
}

describe('userStore', () => {
  it('getUser returns null for an unknown id', async () => {
    const env = envWith(createFakeKv());
    expect(await getUser(env, 'google:nobody')).toBeNull();
  });

  it('upsertUserProfile creates a new account with empty appData and reports isNewAccount', async () => {
    const env = envWith(createFakeKv());
    const { record, isNewAccount } = await upsertUserProfile(env, 'google:123', { name: 'Ada', picture: 'p.jpg' });
    expect(isNewAccount).toBe(true);
    expect(record).toMatchObject({ profile: { name: 'Ada', picture: 'p.jpg' }, appData: null });
    expect(await getUser(env, 'google:123')).toEqual(record);
  });

  it('upsertUserProfile on an existing account refreshes the profile without touching appData', async () => {
    const env = envWith(createFakeKv());
    await upsertUserProfile(env, 'google:123', { name: 'Ada', picture: 'old.jpg' });
    await putUserAppData(env, 'google:123', { goToId: 'trestles', customSpots: [], alerts: [], units: 'imperial' });

    const { record, isNewAccount } = await upsertUserProfile(env, 'google:123', { name: 'Ada Updated', picture: 'new.jpg' });
    expect(isNewAccount).toBe(false);
    expect(record.profile).toEqual({ name: 'Ada Updated', picture: 'new.jpg' });
    expect(record.appData).toEqual({ goToId: 'trestles', customSpots: [], alerts: [], units: 'imperial' });
  });

  it('putUserAppData saves appData and preserves the existing profile', async () => {
    const env = envWith(createFakeKv());
    await upsertUserProfile(env, 'google:123', { name: 'Ada', picture: 'p.jpg' });
    const record = await putUserAppData(env, 'google:123', { goToId: 'pipeline', customSpots: [], alerts: [], units: 'metric' });
    expect(record.profile).toEqual({ name: 'Ada', picture: 'p.jpg' });
    expect(record.appData).toEqual({ goToId: 'pipeline', customSpots: [], alerts: [], units: 'metric' });
    expect(typeof record.updatedAt).toBe('string');

    const reread = await getUser(env, 'google:123');
    expect(reread).toEqual(record);
  });

  it('putUserAppData on a never-logged-in id still saves (defensive: profile defaults to {})', async () => {
    const env = envWith(createFakeKv());
    const record = await putUserAppData(env, 'google:ghost', { goToId: 'trestles', customSpots: [], alerts: [], units: 'imperial' });
    expect(record.profile).toEqual({});
  });
});
