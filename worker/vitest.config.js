import { defineConfig } from 'vitest/config';

// Plain Node vitest — no real Workers runtime. The Worker's actual behavior (KV
// read/write/list semantics, HTTP routing, alert-matching) is all plain JS with no
// Workers-only APIs beyond `fetch`, which is mocked in tests the same way the main app's
// src/lib/forecast.test.js mocks it. A fake in-memory KV namespace (test/fakeKv.js) stands in
// for the real binding. What this can't verify is Cloudflare-specific runtime behavior itself
// (real KV eventual consistency, cron scheduling, the actual edge) — there's no way to do that
// without a live deployment, which this repo can't create on its own; see worker/README.md.
export default defineConfig({
  test: {
    environment: 'node',
  },
});
