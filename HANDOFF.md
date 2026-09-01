# Tideline — handoff notes for Claude Code

This app was designed and built as a single-file React mockup inside a Claude.ai chat
session (originally `surf-app-mockup.jsx`, ~1,500 lines, default export `SurfMockup`). It's
a surf forecast app, inspired by Surfline, with **live data** — not a static design mock.

**Update:** it has since been scaffolded into a real Vite + React project — see
`README.md` for how to run it. `window.storage` has been replaced with real `localStorage`
persistence (`src/lib/storage.js`), the globe has been confirmed to render correctly in a
real browser (headless Chromium smoke test), and the original single ~1,500-line
`SurfMockup` component has been split: pure logic/data now live in `src/lib/`, each view
and the globe in its own file under `src/components/`, with `src/App.jsx` (exported as
`App`) left holding just state, effects, and orchestration. The app is now a PWA (installable,
works offline) and has real push notifications built (`worker/`, a Cloudflare Worker) —
**not yet deployed**, since that needs a human to create a Cloudflare account; see
`worker/README.md`. See "Known issues" below, updated accordingly. The rest of this document
is the original handoff as written from the chat session.

## What's already built

- **Home** — hero card for your "go-to" spot (current rating badge, wave height, swell/wind
  readout), an 8-slot hour scrubber (5am–7pm), a "wave height today" line chart, a
  continuous 7-day chart (wave height + tide + wind speed, with wind-direction arrows
  color-coded offshore-green to onshore-red), and a stats row (swell/wind/tide, all live).
- **Search** — geocodes any place name (Open-Meteo geocoding API) and auto-estimates
  offshore wind direction by finding the nearest OpenStreetMap coastline via the Overpass
  API, with a manual nudge override.
- **Globe** — an interactive 3D Three.js globe (drag to rotate, pinch/scroll to zoom),
  canvas-textured ocean + hand-approximated landmasses, markers colored by live rating.
  **See "Known issues" below — this has been genuinely unreliable to verify.**
- **Alerts** — spot + minimum wave height + lead time (1h/1d/2d/3d), matched against live
  forecast data. Multi-day alerts use the full scoring model (wind-aware), not just wave
  height. Optional real push notifications via a Cloudflare Worker backend — see "Known
  issues" below for status (built and tested, not yet deployed to a live account).
- **Profile** — go-to spot picker, units toggle, alert count, spot management (add/remove),
  data-source attribution.
- **Onboarding** — first-run flow to pick a go-to spot before landing on Home.
- **Units** — imperial/metric toggle; internal math always stays in feet/mph, conversion is
  display-only.

## Data sources (no API keys needed)

- `https://marine-api.open-meteo.com/v1/marine` — hourly wave height/direction/period,
  swell height/direction/period, and `sea_level_height_msl` (tide proxy — see caveat
  below); `daily=wave_height_max`; `forecast_days=7`.
- `https://api.open-meteo.com/v1/forecast` — hourly `wind_speed_10m` /
  `wind_direction_10m`; `forecast_days=7`.
- `https://geocoding-api.open-meteo.com/v1/search` — place name → lat/lon.
- Overpass API (OpenStreetMap) — nearest coastline way, used to estimate offshore wind
  direction via the "land on left, water on right" node-order convention.

## The rating algorithm

`conditionsScore()` returns a numeric score (roughly -5 to +10), bucketed by
`scoreToRating()` into POOR / FAIR / GOOD / FIRING. Factors, in order of how much they're
trusted:

1. Wind speed + direction relative to the spot's stored `offshoreDeg` (glassy <3mph scores
   well regardless of direction; offshore is best but gale-force offshore is penalized;
   onshore is worst and scales with speed).
2. Wave height.
3. Swell period (long-period groundswell scores higher than short-period wind chop).
4. Swell/shore alignment — approximated as the swell direction vs. the *opposite* of the
   spot's offshore wind angle. This is a rough proxy, not real per-spot swell-window data.
5. Tide position — distance from today's own mid-tide (not an absolute height, since
   "good tide" is spot-specific and there's no per-spot tide-window data). Deliberately the
   smallest weight (±1) since it's the least certain factor.

The globe's marker colors and the home page's rating badge both read this same score —
there's intentionally one source of truth, not separate logic per view.

## Known issues to fix for real, not work around

- ~~**`window.storage`**~~ — **Fixed.** Replaced with `localStorage` via `src/lib/storage.js`,
  same call shape so all call sites ported unchanged. Fine for a personal/single-device
  tool; move to a real backend/database if this needs to sync across devices.
- ~~**No real push notifications.**~~ — **Added**, with a real backend: a Cloudflare Worker
  (`worker/`) on a cron trigger checks every subscribed device's alerts against live
  conditions and pushes a notification via Web Push, using the same `checkAlertMatch`/
  `fetchSpotForecast` logic the app itself uses while the tab is open (imported directly by
  the Worker, so the two can't drift). Toggle in Profile. This is genuinely wired up and
  tested (68 frontend tests + 18 Worker tests, including one that exercises the real Web
  Push cryptography end-to-end against a throwaway keypair) — but **it is not live**: it
  needs a Cloudflare account, a deployed Worker, and a few config values only a human can
  provide (API tokens, VAPID keys, KV namespace). See `worker/README.md` for the full
  one-time setup. Until that's done, the Profile toggle just reads "Not available" and
  everything else works exactly as before.
- **Tide is a modeled sea-level curve**, not an authoritative tide table — Open-Meteo's own
  docs describe it as referenced to global mean sea level rather than chart datum, ~8km
  resolution. Good for shape/timing, not exact heights. Fine for this app's purposes, but
  don't present it as navigation-grade.
- **Globe landmass shapes are hand-approximated polygons**, not real geographic data — a
  real GeoJSON/TopoJSON coastline dataset was impractical to embed in the chat sandbox
  (several hundred KB minimum even simplified) but should be very doable in a real build
  environment with normal bundling.
- ~~**The globe's WebGL rendering has an open, unconfirmed reliability problem.**~~ —
  **Confirmed fixed / was a sandbox artifact.** Verified with a headless Chromium smoke test
  against the built Vite app: the globe renders correctly (landmasses, live-rated spot
  markers, drag/zoom) with no console errors. Also removed a leftover debug banner
  (`BUILD CHECK — v7`) that had been added in the chat sandbox to test whether preview
  updates were visible at all — confirms the original suspicion that this was a
  preview-caching issue in that sandbox, not an underlying code bug.
- ~~**36 seed spots** have hand-estimated lat/lon, offshore direction, and blurbs~~ — **Spot
  checked.** There are actually 44. Most of the hand-estimated values turned out accurate
  (many matched published coordinates almost exactly). Web-searched the ~10 lowest-confidence
  entries against Wikipedia/surf-forecast/WannaSurf sources and fixed what didn't hold up:
  G-Land and Popoyo's coordinates were each off by several km, La Entrada's was off by ~140km
  (wrong stretch of the Ecuadorian coast entirely — corrected to the real spot, near Olón),
  and Mui Ne / Darne / Masnou's offshore wind directions were wrong relative to their real
  coastline orientation or published local wind info. This was a targeted correction pass on
  the spots most likely to be wrong, not an exhaustive re-verification of all 44 — the
  remaining ones are still only as good as whatever training-data recall produced them.
- ~~**`src/App.jsx` is still one ~1,500-line file.**~~ — **Split.** `App.jsx` is now 356 lines
  (state, effects, and orchestration only). Pure logic/data moved to `src/lib/` (`rating.js`,
  `forecast.js`, `format.js`, `spots.js`, `placeholders.js`, `colors.js`, `geo3d.js`); each
  view and the globe moved to its own file under `src/components/`. Verified behavior-identical
  with a headless-browser walkthrough of every view (home, globe, alerts, profile, search,
  new-alert sheet) — no console errors, no visual differences.
- ~~**No test suite.**~~ — **Added.** Vitest + React Testing Library, `npm test`, wired into
  CI. Covers the `src/lib/` modules the component split isolated (the rating algorithm
  including its edge cases, unit formatting, tide-event detection, and `fetchSpotForecast`/
  `geocodePlace`/`findOffshoreDirection` against a mocked `fetch`) plus a few component
  smoke/interaction tests (`ConditionScale`, `BottomNav`, `OnboardingView`). Doesn't cover
  `Globe.jsx` — it's WebGL-heavy and jsdom has no real GPU context, so that one's still
  best verified with a real (or headless-Chromium) browser, same as the manual passes noted
  above.
- ~~**No linter.**~~ — **Added.** ESLint (flat config, `eslint.config.js`), `npm run lint`,
  wired into CI. Deliberately scoped to `eslint-plugin-react-hooks`'s two long-established
  rules (`rules-of-hooks`, `exhaustive-deps`) rather than its v7 "recommended" set, which
  pulls in a dozen-plus stricter React-Compiler-oriented static-analysis rules — a much
  bigger adoption than a first linting pass calls for. Fixed everything it found on the
  existing codebase before turning it on in CI: unused `React` default imports (the
  automatic JSX runtime doesn't need them), unused `catch (e)` bindings (switched to
  bare `catch {}` — all of them were intentionally-ignored best-effort persistence
  errors, already explained by comments), and one genuinely unused variable in
  `scripts/build-icons.mjs`.
- ~~**`three` pulls the production bundle over Vite's 500kB chunk-size warning.**~~ —
  **Fixed.** `Globe.jsx` (and `three` along with it) is now `React.lazy`-loaded, wrapped in
  `<Suspense>` with a small "Loading globe…" fallback. Verified with a network listener in a
  real browser: the globe chunk is not requested on initial page load, only once the user
  actually opens the globe view. Cut the initial bundle from 869.9KB to 249.8KB (78.2KB
  gzipped) — under the warning threshold with room to spare.

## Suggested next steps

1. ~~Scaffold a real project~~ / ~~port the mockup in~~ / ~~replace `window.storage`~~ /
   ~~re-test the globe~~ / ~~split `App.jsx` into components~~ / ~~add a test suite~~ /
   ~~add a linter~~ / ~~code-split the globe view~~ — **done**, see the Update note at the
   top of this file.
2. ~~Real backend for push notifications~~ — **built** (`worker/`, a Cloudflare Worker),
   **not yet deployed** — that needs a human to create a Cloudflare account and follow
   `worker/README.md`'s one-time setup. CI/deployment for the frontend itself was already
   done in step 1 (GitHub Pages).
