# Surfcast

Wave forecast app — live surf conditions, an interactive 3D globe of spots, and
wind/tide-aware alerts. Built with React + Vite.

## Getting started

```bash
npm install
npm run dev       # local dev server
npm run build     # production build to dist/
npm run preview   # serve the production build locally
npm test          # run the test suite once (also runs in CI)
npm run test:watch # run tests in watch mode while developing
npm run lint      # eslint (also runs in CI)
```

## Project structure

- `src/App.jsx` — top-level state, effects, and orchestration; renders one of
  the view components below depending on app state.
- `src/components/` — one file per view (`HomeView`, `Globe`, `AlertsView`,
  `ProfileView`, `OnboardingView`), the two bottom-sheet modals
  (`SearchSheet`, `AlertSheet`), and small shared pieces (`BottomNav`,
  `ConditionScale`).
- `src/lib/` — pure logic and data, no React: `forecast.js` (Open-Meteo
  fetching), `rating.js` (the conditions-scoring algorithm), `format.js`
  (unit conversion/formatting), `spots.js` (seed spot data), `placeholders.js`
  (pre-fetch stand-in data), `colors.js`, `geo3d.js`, and `storage.js`
  (`localStorage`-backed persistence for saved spots, alerts, units,
  onboarding state).
- `src/main.jsx` — entry point.
- `src/sw.js` — the service worker source (offline caching + push notification handling).
- `worker/` — the push-notification backend, a separate Cloudflare Worker package with its
  own `package.json`/tests/deploy pipeline. See `worker/README.md`.

See `HANDOFF.md` for the data sources, rating algorithm, and known issues.

No API keys are required — see `HANDOFF.md` for the data sources in use.

## PWA

The app is installable (add to home screen on iOS/Android, or install from
the browser on desktop) and has an offline shell: the app itself, and the
last forecast data it fetched, are cached by a service worker
(`vite-plugin-pwa`), so it still opens with no connection. Icons are
generated from `scripts/icon-source.svg` via `npm run build:icons`.

## Push notifications

Real, backend-driven push notifications for alerts (delivered even when the app is closed) —
toggle in Profile. The frontend piece (`src/lib/push.js`, `src/sw.js`) is always present but
degrades gracefully to "Not available" until its backend is deployed: see `worker/README.md`
for the one-time Cloudflare setup this needs (a free account; nothing here can deploy itself).
