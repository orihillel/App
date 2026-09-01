# Tideline — handoff notes for Claude Code

This app was designed and built as a single-file React mockup inside a Claude.ai chat
session (`surf-app-mockup.jsx`, ~1,500 lines, default export `SurfMockup`). It's a surf
forecast app, inspired by Surfline, with **live data** — not a static design mock. The goal
now is to turn it into a real, deployable app.

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

- **`window.storage`** is a Claude.ai-artifact-only persistence API (used for saved spots,
  alerts, units, and the onboarding flag). It does not exist outside that sandbox. Needs to
  become real persistence — `localStorage` for a quick port, or a real backend/database if
  this is going further than a personal tool.
- **No real push notifications.** Alerts currently only check live data while the tab is
  open and show what would match. Real notifications need a backend + push service (Web
  Push, APNs, or FCM depending on target platform).
- **Tide is a modeled sea-level curve**, not an authoritative tide table — Open-Meteo's own
  docs describe it as referenced to global mean sea level rather than chart datum, ~8km
  resolution. Good for shape/timing, not exact heights. Fine for this app's purposes, but
  don't present it as navigation-grade.
- **Globe landmass shapes are hand-approximated polygons**, not real geographic data — a
  real GeoJSON/TopoJSON coastline dataset was impractical to embed in the chat sandbox
  (several hundred KB minimum even simplified) but should be very doable in a real build
  environment with normal bundling.
- **The globe's WebGL rendering has an open, *unconfirmed* reliability problem.** Across
  several rounds of fixes in the chat sandbox (texture filtering, pixel ratio, marker color
  sync, deprecated Three.js APIs), the user consistently reported no visible change — even
  after changes that should have been obviously different (e.g., an unmissable colored
  banner added purely to test whether updates were even being seen). That pattern points
  more at a preview-caching issue in that specific sandboxed environment than at the
  underlying code, but this was never conclusively resolved. **Recommend testing the globe
  fresh in a real browser before assuming anything about its state** — it may render
  correctly out of the gate.
- **36 seed spots** have hand-estimated lat/lon, offshore direction, and blurbs — reasonable
  approximations, not verified against authoritative sources.

## Suggested first steps

1. Scaffold a real project (Vite + React is the closest match to how this is already
   written — plain JSX, no framework-specific patterns yet).
2. Port `surf-app-mockup.jsx` in as the starting point; split it into components as it
   grows (it's currently one file by necessity of the chat environment, not by design).
3. Replace `window.storage` calls with `localStorage` (fastest path) or real persistence.
4. Re-test the globe in a normal browser before deciding whether it needs more work.
5. From there: real backend for push notifications, CI/deployment, etc.
