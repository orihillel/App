# Tideline — handoff notes for Claude Code

This app was designed and built as a single-file React mockup inside a Claude.ai chat
session (originally `surf-app-mockup.jsx`, ~1,500 lines, default export `SurfMockup`). It's
a surf forecast app, inspired by Surfline, with **live data** — not a static design mock.

**Update:** it has since been scaffolded into a real Vite + React project — see
`README.md` for how to run it. The mockup now lives at `src/App.jsx` (exported as `App`),
`window.storage` has been replaced with real `localStorage` persistence
(`src/lib/storage.js`), and the globe has been confirmed to render correctly in a real
browser (headless Chromium smoke test) — see "Known issues" below, updated accordingly.
The rest of this document is the original handoff as written from the chat session.

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
  height. No real push notifications yet — see below.
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
- **No real push notifications.** Alerts currently only check live data while the tab is
  open and show what would match. Real notifications need a backend + push service (Web
  Push, APNs, or FCM depending on target platform). The app is now a PWA with a registered
  service worker (see README's PWA section), which is a prerequisite for Web Push on
  Android/desktop — still needs a backend to actually send anything, but the client-side
  piece this depends on now exists.
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
- **`src/App.jsx` is still one ~1,500-line file.** It now builds and runs correctly as-is,
  but splitting it into components (per spot card, per view, the globe, etc.) is still
  worth doing as it grows — see "Suggested next steps" below.

## Suggested next steps

1. ~~Scaffold a real project~~ / ~~port the mockup in~~ / ~~replace `window.storage`~~ /
   ~~re-test the globe~~ — **done**, see the Update note at the top of this file.
2. Split `src/App.jsx` into components as it grows (it's currently one file by inheritance
   from the chat environment, not by design).
3. Real backend for push notifications, CI/deployment, etc.
4. Consider trimming the production bundle — `three` pulls the build over Vite's 500kB
   chunk-size warning threshold; code-splitting the globe view (`React.lazy`) would keep it
   out of the initial bundle for users who never open it.
