# Surfcast push-notification Worker

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

This Worker also handles account login ("Continue with Google" / "Continue with Meta" on the
app's first screen and in Profile) and syncing an account's data across devices:

- **`src/googleAuth.js`** — verifies a Google "Sign In With Google" ID token by checking its
  RS256 signature against Google's published JWKS, using nothing but Web Crypto (same
  no-Node-internals reasoning as `push.js`).
- **`src/facebookAuth.js`** — verifies a Facebook (Meta) Login access token via a server-side
  round trip to the Graph API's `/debug_token` (confirming it's genuinely valid and issued to
  *this* app) and `/me` (fetching the profile).
- **`src/session.js`** — this Worker's own lightweight signed session tokens (HMAC-SHA256,
  not a full JWT library), issued after a Google/Facebook login succeeds and sent back by the
  client as `Authorization: Bearer <token>` on `/me` and `/me/data`.
- **`src/userStore.js`** — KV access for accounts: one entry per user, storing their profile
  and their synced app data (go-to spot, custom-added spots, alerts, units — deliberately
  *not* the built-in spot catalog, which is identical on every device already).

## Live buoy observations (`GET /buoy?lat=&lon=`)

Returns the most recent reading from the nearest NOAA NDBC buoy that is actually reporting
waves, or `{"observation": null}` when there isn't one worth showing.

This endpoint exists in the Worker for two reasons. NDBC serves no CORS headers, so a browser
cannot read it directly; and one fetch of NDBC's all-stations table here serves every user and
every spot, which is the polite way to consume a free public service. The response is cached in
KV for 10 minutes, roughly NDBC's own publishing interval, so a busy minute is still one
upstream request.

It returns `null` rather than something misleading when:

- no wave-reporting buoy is within 250km (a buoy further away is measuring a different piece of
  ocean, and showing it beside a spot would imply a correspondence that doesn't exist);
- the nearest buoy's last reading is over three hours old (stations drop out, and a stale number
  presented as live is worse than nothing);
- NDBC is unreachable — which must never take the app's own endpoints down with it.

No configuration or API key is needed. The frontend calls it via `VITE_PUSH_API_URL` (the same
base URL as push and auth) and simply shows no buoy panel if that isn't set.

## One-time setup

You'll need a free [Cloudflare account](https://dash.cloudflare.com/sign-up).

1. **Install dependencies and the Wrangler CLI:**
   ```bash
   cd worker
   npm install
   npx wrangler login   # opens a browser to authorize the CLI against your account
   ```

2. **Create the two KV namespaces** this Worker uses:
   ```bash
   npx wrangler kv namespace create SUBSCRIPTIONS
   npx wrangler kv namespace create USERS
   ```
   Copy each `id` it prints into `wrangler.toml`'s matching `[[kv_namespaces]]` block,
   replacing `REPLACE_WITH_YOUR_KV_NAMESPACE_ID` / `REPLACE_WITH_YOUR_USERS_KV_NAMESPACE_ID`.

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

4. **Set up "Continue with Google"** (skip this and step 5 if you only want one provider —
   each works independently; the button for an unconfigured provider just doesn't render):
   - Go to the [Google Cloud Console credentials page](https://console.cloud.google.com/apis/credentials),
     create a project if you don't have one, and create an **OAuth client ID** of type
     **Web application**.
   - Under **Authorized JavaScript origins**, add your GitHub Pages origin (e.g.
     `https://<owner>.github.io`) and `http://localhost:5173` if you want it working in local
     dev too. No redirect URI is needed — this app uses Google's client-side "Sign In With
     Google" button, not a server redirect flow.
   - Copy the **Client ID** it gives you (looks like `123...apps.googleusercontent.com`) into
     `wrangler.toml`'s `GOOGLE_CLIENT_ID` — this is safe to commit, it identifies the app, not
     a secret.

5. **Set up "Continue with Meta"**:
   - Create an app at the [Meta for Developers dashboard](https://developers.facebook.com/apps/),
     add the **Facebook Login** product to it, and under its settings add your GitHub Pages
     origin as a valid OAuth redirect/JavaScript origin the same way as Google above.
   - Copy the **App ID** into `wrangler.toml`'s `FACEBOOK_APP_ID` (safe to commit) and the
     **App Secret** as a Worker secret, never committed:
     ```bash
     npx wrangler secret put FACEBOOK_APP_SECRET
     ```
   - **Important:** a new Meta app only works for its own developers/admins and accounts
     you've explicitly added as testers (App Dashboard → Roles → Test Users, or add a real
     account under Roles → Roles) until you submit it for **App Review** (Meta's process for
     letting the general public use Facebook Login) and it's approved. Until then, the button
     will render and work for you, but a random visitor's login attempt will fail — that's
     expected, not a bug in this code.

6. **Generate a session secret** (signs this Worker's own login sessions — see
   `src/session.js` — unrelated to either provider's credentials):
   ```bash
   npx wrangler secret put SESSION_SECRET
   # paste any long random string when prompted, e.g. from: openssl rand -base64 32
   ```

7. **Edit `wrangler.toml`**:
   - `VAPID_SUBJECT` — a `mailto:` or `https:` URL you control (shown to push services if
     they need to contact you about this VAPID identity).
   - `ALLOWED_ORIGIN` — your GitHub Pages origin, e.g. `https://<owner>.github.io` (CORS: only
     this origin may call this Worker's endpoints).

8. **Deploy:**
   ```bash
   npx wrangler deploy
   ```
   Note the `https://tideline-push.<your-subdomain>.workers.dev` URL it prints — that's your
   `VITE_PUSH_API_URL`.

   The `tideline-push` in that URL is the Worker's service name (`name` in `wrangler.toml`),
   which was kept when the app was renamed to Surfcast. It is not cosmetic: changing it makes
   `wrangler deploy` publish a *second* Worker under the new name rather than renaming this
   one, leaving the old URL serving until `VITE_PUSH_API_URL` is repointed. Rename it on
   purpose, with that migration in mind — not as part of renaming the app.

## Wiring up the frontend

The app needs a few build-time env vars — all meant to be public, safe to commit or put in a
repo variable:

- `VITE_VAPID_PUBLIC_KEY` — the same public key from step 3 above (see `src/lib/push.js`).
- `VITE_PUSH_API_URL` — the Worker URL from step 8 (no trailing slash) — used for both push
  notifications and account login/sync, since they're the same Worker.
- `VITE_GOOGLE_CLIENT_ID` — the Client ID from step 4, if you set up Google (see
  `src/lib/auth.js`). Omit it and the Google button just doesn't render.
- `VITE_FACEBOOK_APP_ID` — the App ID from step 5, if you set up Meta. Omit it and the Meta
  button just doesn't render.

Set them wherever the frontend gets built:
- **Locally**: create `.env.local` at the repo root (gitignored by Vite's default patterns)
  with the `VITE_...` lines you need.
- **GitHub Pages deploy** (`.github/workflows/deploy.yml`): add them as repository variables
  (Settings → Secrets and variables → Actions → Variables) and reference them as `env:` in the
  build step, or bake them into the workflow file directly since they're not secret.

Without `VITE_VAPID_PUBLIC_KEY`/`VITE_PUSH_API_URL` set, the Profile push toggle just shows
"Not available"; without `VITE_GOOGLE_CLIENT_ID`/`VITE_FACEBOOK_APP_ID`, the corresponding
login button just doesn't render. The rest of the app works identically either way — every
piece here is intentionally optional, not a hard dependency.

## Deploying the Worker from CI

`.github/workflows/deploy-worker.yml` deploys the Worker automatically on every push to `main`
that touches `worker/**`, using [`cloudflare/wrangler-action`](https://github.com/cloudflare/wrangler-action).
It needs two repository secrets (Settings → Secrets and variables → Actions → Secrets):

- `CLOUDFLARE_API_TOKEN` — create one at Cloudflare dashboard → My Profile → API Tokens →
  "Edit Cloudflare Workers" template (scope it to this account if offered the choice).
- `CLOUDFLARE_ACCOUNT_ID` — found in the dashboard's right sidebar on any domain/Workers page.

The `VAPID_PRIVATE_KEY`, `FACEBOOK_APP_SECRET`, and `SESSION_SECRET` secrets (steps 3, 5, and
6 above) are set directly on the Worker via `wrangler secret put` and aren't something CI needs
to touch — they persist across deploys.

## Local development

```bash
cd worker
npm run dev          # wrangler dev — runs the Worker locally via Miniflare
npm test             # the test suite (plain Node/vitest + a fake in-memory KV — see below)
```

For `wrangler dev` to have secrets locally, create `worker/.dev.vars` (gitignored):
```
VAPID_PRIVATE_KEY=your-private-key-here
FACEBOOK_APP_SECRET=your-facebook-app-secret-here
SESSION_SECRET=any-long-random-string-here
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
package. `test/googleAuth.test.js` does the same for Google ID token verification (a real
throwaway RSA keypair signs a Google-shaped token, verified against a mocked JWKS response);
`test/session.test.js` covers this Worker's own session tokens; `test/facebookAuth.test.js`
covers the Graph API verification flow against a mocked `fetch`.

What this **can't** verify locally: real KV's actual consistency/latency behavior, cron
scheduling, and — most importantly — an end-to-end push notification actually arriving on a
real device. After deploying, subscribe from the app and create an alert you're confident will
match soon (or temporarily lower a threshold) to confirm the whole pipeline works for real.
