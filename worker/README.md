# Tideline push-notification Worker

The backend half of real push notifications (see the "PUSH NOTIFICATIONS" toggle in the app's
Profile tab). It exists because the frontend alone can't notify you about anything while it
isn't open — this Cloudflare Worker runs on a schedule, checks every subscribed device's
alerts against live conditions, and pushes a notification when one matches.

Claude Code can write and test this code, but **can't deploy it or create the Cloudflare
account it needs** — that's this document. Nothing here costs money at this app's scale
(Cloudflare's free tier covers it comfortably: cron triggers, ~100k requests/day, KV storage
all well under the free limits for a personal-scale app).

## Architecture

- **`src/index.js`** — a `fetch` handler (`POST /subscribe`, `POST /unsubscribe`, `GET
  /health`) and a `scheduled` handler (the cron job) that iterates every stored subscription,
  checks its alerts, and sends push notifications for matches (with a 6-hour cooldown per
  alert so a still-matching alert doesn't re-fire every run).
- **`src/store.js`** — Workers KV access, one entry per push subscription.
- **`src/push.js`** — sends a Web Push message via
  [`@block65/webcrypto-web-push`](https://www.npmjs.com/package/@block65/webcrypto-web-push),
  chosen specifically because it uses only the Web Crypto API — the far more common `web-push`
  npm package leans on Node's `crypto`/`https`-proxy internals that don't reliably run in the
  Workers runtime.
- It imports `../../src/lib/forecast.js` and `../../src/lib/alerts.js` **directly from the
  main app** — the same `fetchSpotForecast` and `checkAlertMatch` the frontend uses while the
  tab is open. One shared implementation means "would this alert fire" can never drift between
  what you see live in the app and what the Worker decides in the background.

## One-time setup

You'll need a free [Cloudflare account](https://dash.cloudflare.com/sign-up).

1. **Install dependencies and the Wrangler CLI:**
   ```bash
   cd worker
   npm install
   npx wrangler login   # opens a browser to authorize the CLI against your account
   ```

2. **Create the KV namespace** subscriptions are stored in:
   ```bash
   npx wrangler kv namespace create SUBSCRIPTIONS
   ```
   Copy the `id` it prints into `wrangler.toml`'s `[[kv_namespaces]]` block, replacing
   `REPLACE_WITH_YOUR_KV_NAMESPACE_ID`.

3. **Generate a VAPID keypair** (identifies this Worker to push services — not tied to your
   Cloudflare account, just a keypair):
   ```bash
   npx web-push generate-vapid-keys
   ```
   - Put the **public** key in `wrangler.toml`'s `VAPID_PUBLIC_KEY` (replacing
     `REPLACE_WITH_YOUR_VAPID_PUBLIC_KEY`) — public keys are safe to commit.
   - Set the **private** key as a secret, never committed:
     ```bash
     npx wrangler secret put VAPID_PRIVATE_KEY
     # paste the private key when prompted
     ```

4. **Edit `wrangler.toml`**:
   - `VAPID_SUBJECT` — a `mailto:` or `https:` URL you control (shown to push services if
     they need to contact you about this VAPID identity).
   - `ALLOWED_ORIGIN` — your GitHub Pages origin, e.g. `https://<owner>.github.io` (CORS: only
     this origin may call `/subscribe` and `/unsubscribe`).

5. **Deploy:**
   ```bash
   npx wrangler deploy
   ```
   Note the `https://tideline-push.<your-subdomain>.workers.dev` URL it prints — that's your
   `VITE_PUSH_API_URL`.

## Wiring up the frontend

The app needs two build-time env vars (see `src/lib/push.js`) — both are meant to be public,
safe to commit or put in a repo variable:

- `VITE_VAPID_PUBLIC_KEY` — the same public key from step 3 above.
- `VITE_PUSH_API_URL` — the Worker URL from step 5 (no trailing slash).

Set them wherever the frontend gets built:
- **Locally**: create `.env.local` at the repo root (gitignored by Vite's default patterns)
  with both `VITE_...` lines.
- **GitHub Pages deploy** (`.github/workflows/deploy.yml`): add them as repository variables
  (Settings → Secrets and variables → Actions → Variables) and reference them as `env:` in the
  build step, or bake them into the workflow file directly since they're not secret.

Without both set, the Profile toggle just shows "Not available" — the rest of the app works
identically either way (this is intentionally optional, not a hard dependency).

## Deploying the Worker from CI

`.github/workflows/deploy-worker.yml` deploys the Worker automatically on every push to `main`
that touches `worker/**`, using [`cloudflare/wrangler-action`](https://github.com/cloudflare/wrangler-action).
It needs two repository secrets (Settings → Secrets and variables → Actions → Secrets):

- `CLOUDFLARE_API_TOKEN` — create one at Cloudflare dashboard → My Profile → API Tokens →
  "Edit Cloudflare Workers" template (scope it to this account if offered the choice).
- `CLOUDFLARE_ACCOUNT_ID` — found in the dashboard's right sidebar on any domain/Workers page.

The `VAPID_PRIVATE_KEY` secret (step 3 above) is set directly on the Worker via `wrangler
secret put` and isn't something CI needs to touch — it persists across deploys.

## Local development

```bash
cd worker
npm run dev          # wrangler dev — runs the Worker locally via Miniflare
npm test             # the test suite (plain Node/vitest + a fake in-memory KV — see below)
```

For `wrangler dev` to have VAPID keys locally, create `worker/.dev.vars` (gitignored):
```
VAPID_PRIVATE_KEY=your-private-key-here
```

To manually fire the cron job without waiting 30 minutes, either use the Cloudflare dashboard
(Workers & Pages → this Worker → Triggers → "Trigger Cron"), or run `wrangler dev
--test-scheduled` and hit `http://localhost:8787/__scheduled` locally.

## About the test suite

`npm test` runs entirely in plain Node — no live Cloudflare account or deployment needed, and
no `@cloudflare/vitest-pool-workers` (its current release had version-mismatched, undocumented
breaking API changes as of when this was written; the actual Worker logic here is plain JS
with no Workers-only APIs beyond `fetch`, which is mocked, so a real Workers runtime isn't
needed to test it correctly). A hand-written in-memory KV (`test/fakeKv.js`) stands in for the
real binding. `test/push.test.js` does exercise real cryptography (generates a throwaway
VAPID+subscription keypair and verifies `@block65/webcrypto-web-push` produces a genuinely
valid, decodable signed JWT and encrypted payload) — that's the part most worth verifying
actually works, since it's the reason this library was chosen over the more common `web-push`
package.

What this **can't** verify locally: real KV's actual consistency/latency behavior, cron
scheduling, and — most importantly — an end-to-end push notification actually arriving on a
real device. After deploying, subscribe from the app and create an alert you're confident will
match soon (or temporarily lower a threshold) to confirm the whole pipeline works for real.
