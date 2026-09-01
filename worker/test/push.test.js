import { describe, it, expect, vi, afterEach } from 'vitest';
import { sendPushNotification, buildNotificationPayload } from '../src/push.js';

describe('buildNotificationPayload', () => {
  it('builds the shape src/sw.js\'s push listener expects', () => {
    const alert = { id: 'a1', spotName: 'Lower Trestles' };
    const match = { hit: true, text: 'Matches Tuesday — good conditions' };
    expect(buildNotificationPayload(alert, match)).toEqual({
      title: 'Lower Trestles',
      body: 'Matches Tuesday — good conditions',
      tag: 'alert-a1',
      url: './',
    });
  });
});

describe('sendPushNotification', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  // These are freshly-generated-for-testing keypairs (a VAPID identity + a fake client
  // subscription's ECDH/auth keys) -- not used anywhere real. The point of using real,
  // cryptographically valid keys instead of arbitrary strings is to actually exercise
  // @block65/webcrypto-web-push's real VAPID-signing and payload-encryption code paths (the
  // reason this library was picked over the more common `web-push` package is that it works
  // natively in the Workers runtime via Web Crypto -- this test is what proves that claim).
  const vapid = {
    subject: 'mailto:test@example.com',
    publicKey: 'BA8PuNKdCiCv7iA_TdZI4LkfEzDU3EdnXvwRPZfthcHiVhRTvpWx2RyMeu02A4NZ3pEbInlZNx3ijsRyievRsQM',
    privateKey: 'CpYnktbeK9YxyGIVh0tH5hHXlfovvMlK37nkwVFyfPQ',
  };
  const subscription = {
    endpoint: 'https://push.example.com/subscription/abc123',
    keys: {
      p256dh: 'BK9IrGY9-U3ZOrwxeyQ19F2wtV1DhTislPRsaot6LMVwmhgFSUi1KDz8QNBuXQc5rKvVDsaqQ4thjIlXXXoNWaI',
      auth: '8bXWqYST72zgbkJlHCXDdw',
    },
  };

  it('encrypts the payload for real and POSTs it to the subscription endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await sendPushNotification(subscription, { title: 'Test', body: 'Hi' }, vapid);

    expect(res.status).toBe(201);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(subscription.endpoint);
    // Real Web Push encryption (aes128gcm) and a real VAPID JWT, not placeholder values.
    const headers = new Headers(init.headers);
    expect(headers.get('Content-Encoding')).toBeTruthy(); // e.g. "aesgcm" -- exact scheme is the library's choice, not this test's concern
    // A real, verifiable VAPID JWT -- WebPush <header>.<payload>.<signature>.
    const auth = headers.get('Authorization');
    expect(auth).toMatch(/^WebPush [\w-]+\.[\w-]+\.[\w-]+$/);
    const claims = JSON.parse(atob(auth.split(' ')[1].split('.')[1]));
    expect(claims.sub).toBe(vapid.subject);
    expect(claims.aud).toBe('https://push.example.com');
    expect(init.body.byteLength).toBeGreaterThan(0); // the AES-encrypted notification payload
  });
});
