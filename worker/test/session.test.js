import { describe, it, expect } from 'vitest';
import { createSessionToken, verifySessionToken } from '../src/session.js';

describe('session tokens', () => {
  it('round-trips a payload signed and verified with the same secret', async () => {
    const token = await createSessionToken({ sub: 'google:123' }, 'test-secret');
    const payload = await verifySessionToken(token, 'test-secret');
    expect(payload).toMatchObject({ sub: 'google:123' });
    expect(typeof payload.iat).toBe('number');
    expect(typeof payload.exp).toBe('number');
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await createSessionToken({ sub: 'google:123' }, 'test-secret');
    expect(await verifySessionToken(token, 'wrong-secret')).toBeNull();
  });

  it('rejects a tampered payload even with the right secret', async () => {
    const token = await createSessionToken({ sub: 'google:123' }, 'test-secret');
    const [header, , sig] = token.split('.');
    const tamperedPayload = Buffer.from(JSON.stringify({ sub: 'google:999', iat: 0, exp: 9999999999 })).toString('base64url');
    expect(await verifySessionToken([header, tamperedPayload, sig].join('.'), 'test-secret')).toBeNull();
  });

  it('rejects an expired token', async () => {
    const token = await createSessionToken({ sub: 'google:123' }, 'test-secret', -1);
    expect(await verifySessionToken(token, 'test-secret')).toBeNull();
  });

  it('rejects malformed input without throwing', async () => {
    expect(await verifySessionToken('not-a-token', 'test-secret')).toBeNull();
    expect(await verifySessionToken('', 'test-secret')).toBeNull();
    expect(await verifySessionToken(undefined, 'test-secret')).toBeNull();
    expect(await verifySessionToken('a.b.c', 'test-secret')).toBeNull();
  });
});
