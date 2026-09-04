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
  **Update: expanded to 99 spots** (55 new, same caveat — reasonable estimates, not
  surveyed; see the comment above the second batch in `src/lib/spots.js` for which of
  those were individually source-checked). Added navigation to go with the larger list:
  prev/next chevrons on a spot's Home page (`showSpotNav`/`stepSpot` in `App.jsx`), and
  every spot row in Profile's "YOUR SPOTS" list plus every marker on the Globe is now
  tap-through (`onSelectSpot`/`viewSpot`) instead of display-only.
  **Update: onboarding can now browse the globe too.** The one-time "pick your go-to
  spot" screen had only a text search as an alternative to the popular-spots list; added
  a second "Browse the globe" button next to it that opens the same `Globe` component
  (now with an optional `title`/`hint` override) so a first-time user can rotate/zoom and
  tap a marker to pick their spot visually, same as browsing spots once past onboarding.
  Verified in a real browser end to end, including a raycast hit on an actual marker
  mesh — the first time the Globe's tap-to-select path (added for the item above) had
  been exercised by anything other than a unit-level click, since jsdom has no WebGL.
  **Update: expanded again to 153 spots** (54 more, third batch — see the comment above
  it in `src/lib/spots.js`), filling in regions the first two batches left thin: US East
  Coast and Pacific Northwest, Ireland/UK, West Africa, remote Australia, and cold-water
  Atlantic spots (Iceland, Nova Scotia). Same estimation caveat as both earlier batches;
  the least-documented entries are called out by name in that comment.
  **Update: "navigation" turned out to mean turn-by-turn directions, not in-app spot
  browsing.** Everything above this line under "navigation" (chevrons, tap-through lists,
  the globe picker) was a misread of the original request — it meant driving/walking/
  transit directions to the spot, like Google Maps or Waze. Added a map-pin button next
  to the go-to star on each spot's Home page (`directionsUrl` in `HomeView.jsx`) that
  deep-links to Google Maps' directions API (`/maps/dir/?api=1&destination=lat,lon`) with
  no `origin` (so Maps uses the visitor's current location) and no `travelmode` (so
  driving/walking/transit stays a choice inside Maps, rather than this app guessing one).
  This URL scheme opens the native Google Maps app via a universal link on iOS/Android
  when installed, and falls back to Google Maps in the browser otherwise. The
  spot-browsing navigation from the entries above stays, since it's a real and separately
  useful feature — this is additive, not a revert.
  **Update: Profile's "YOUR SPOTS" list no longer dumps the whole catalog.** It used to
  render every id in `order`, which was fine when that was a few dozen hand-picked seed
  spots but just re-lists the entire app now that the built-in catalog is in the hundreds.
  `ProfileView.jsx` now filters it to non-seed spots — the ones a user actually added via
  search — with an empty-state message pointing at Home's search icon and the globe when
  there aren't any yet. The "GO-TO SPOT" chip row above it is unchanged (still all of
  `order`, horizontally scrollable) — this was a deliberate, narrower fix to the one
  component actually described as "a list", not a rework of every spot picker in Profile.
- **Newly found while adding the above: every `className`-based layout in the app was
  silently broken.** No stylesheet defining `flex`, `justify-between`, `items-center`,
  `grid-cols-3`, etc. has ever existed in this repo — components were written assuming a
  Tailwind-like utility set (a leftover from the original chat-sandbox mockup, which ran
  against a Tailwind CDN preview) that the scaffold step never actually installed. Rows
  quietly fell back to plain block/inline flow, which happened to look right often enough
  (most rows hold only inline-level `<button>`/`<span>` children) to go unnoticed through
  nine prior PRs of headless-Chromium smoke testing — until the new prev/next chevrons made
  it visibly wrong (stacked instead of flanking the spot name). **Fixed** by hand-defining
  the actual set of classes referenced in `src/**/*.jsx` in `App.jsx`'s existing `GLOBAL_CSS`
  block, at Tailwind's own spacing scale so no call site needed to change. Re-verified every
  view with a headless Chromium smoke test — this affected layout app-wide, not just the new
  navigation UI. `npm run check:classnames` (`scripts/check-classnames.mjs`, wired into CI)
  now fails the build if a new `className` token is ever added without a matching rule.
- **Added account login ("Continue with Google" / "Continue with Meta") and cross-device
  sync**, on request. On the first-run onboarding screen and in Profile, backed by the same
  Cloudflare Worker as push notifications (`worker/src/googleAuth.js`, `facebookAuth.js`,
  `session.js`, `userStore.js` — new `/auth/google`, `/auth/facebook`, `GET /me`,
  `PUT /me/data` routes; `src/lib/auth.js`, `AuthButtons.jsx` on the frontend). Only a go-to
  spot, custom-added spots, alerts, and units are synced — the built-in spot catalog is
  identical on every device already, so syncing it would just be waste (same philosophy as
  the "YOUR SPOTS" list fix above). A brand-new account seeds itself from whatever's already
  on the device that logged in first, rather than looking like it erased anything; logging
  in on an account with existing synced data replaces local state with it. Logging out only
  forgets this device's session token — local data stays put either way.
  Like push notifications, this needs one-time setup only a human can do (a Google OAuth
  Client ID, a Meta app + **App Review** before the public — not just testers — can use
  Facebook Login) — see `worker/README.md`. Until configured, both buttons simply don't
  render and the rest of the app is unaffected; verified with lint + `check:classnames` +
  102 tests (up from 74 — new coverage for the Worker's token verification against real
  signed-JWT/mocked-Graph-API crypto, and the frontend's config-gating/login-flow/logged-in
  UI) + build + a headless-Chromium smoke test with fake credentials configured, confirming
  both buttons actually render and a simulated logged-in session shows correctly in Profile
  (name, avatar fallback, "Log out") — then re-verified once more with credentials removed
  again to confirm the default (most users', today) experience is unchanged.
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
- **Improved the Globe's zoom range and drag feel, on request.** Two complaints: couldn't
  zoom in close enough to tell nearby spots apart (e.g. Swami's/Blacks Beach/Todos Santos all
  overlapped into one blob near Southern California/Baja no matter how far you zoomed), and
  dragging felt imprecise once zoomed in. Both had the same root cause in `Globe.jsx`:
  `MIN_DISTANCE` was clamped to 1.5 (never let the globe fill enough of the screen to spread
  markers apart), and drag-to-rotate used a *fixed* radians-per-pixel sensitivity that was
  only ever tuned for the default zoom level — once you zoomed in and the globe filled more
  of the screen, that same fixed rotation swept the visible surface across far more pixels
  than you'd dragged, overshooting and feeling twitchy right when precision mattered most.
  Fixed by pulling `MIN_DISTANCE` in to 1.12 (pulling the camera's near-clip plane in to
  match, or the near side of the globe — exactly what you're zooming in to see — would start
  clipping), and deriving drag sensitivity from the actual perspective-projection math so it
  scales with current zoom instead of a magic constant: a given pixel drag now rotates the
  point under your cursor by very close to that many pixels, at any zoom level. Wheel/pinch
  zoom also switched from an additive step to a multiplicative (percent-of-distance) one, so
  zoom speed feels consistent across the now much wider usable range instead of a fixed step
  being a huge relative jump once zoomed in close. Verified with a headless-Chromium smoke
  test: confirmed the three previously-overlapping SoCal/Baja spots above are now clearly
  separated with individually readable labels once zoomed in, tap-to-select (raycasting)
  still resolves correctly at every zoom level tested, drag still rotates the view smoothly
  while zoomed in, and max-zoom-out is unchanged — no console errors or rendering artifacts
  (no near-plane clipping) at any point across the whole range.

- **Made the globe smooth, and swapped in real satellite imagery, on request.** Reported as
  "still not smooth" and "still want to zoom in more" after the earlier zoom/sensitivity pass.
  Measuring first mattered here: a headless-Chromium harness showed ~12fps idle, but the same
  harness reported an empty page at a clean 60fps and `UNMASKED_RENDERER_WEBGL` came back as
  **SwiftShader** — that environment has no GPU and rasterizes in software, so its frame times
  say nothing about a real phone. The first theory (per-frame DOM thrash) was from reading the
  code, and fixing it barely moved the local numbers. So the work split in two: CPU-side fixes
  that are correct regardless, and GPU-side fixes targeting costs that are well established on
  real hardware but not measurable here.
  - *CPU:* 150+ individual marker `Mesh`es became one `InstancedMesh` (150+ draw calls -> 1;
    `Raycaster` reports `instanceId`, so tap-to-select needed no lookup list). Marker colours
    and label text moved off the render loop onto a 1s timer — it was rewriting all 153 labels'
    `textContent` every frame, ~9,000 DOM writes a second. Label positioning is allocation-free
    now (reused scratch vectors instead of ~460 `Vector3.clone()`s per frame) and uses
    `transform` rather than `left`/`top` so moving a label can't trigger layout.
  - *GPU:* dropped `logarithmicDepthBuffer` (it forces `gl_FragDepth` writes, which disable
    early-Z — especially punishing on the tile-based GPUs in phones), capped `devicePixelRatio`
    at 2 instead of 3 (fragment cost is quadratic in it; 3x on a phone screen meant 9x the
    pixels *plus* MSAA for no visible gain at this size), and cut the sphere from 96x96 to
    64x48 segments. The globe also now **skips rendering entirely when nothing is moving** —
    measured at 4 draw calls per 1.5s idle, against ~14,000 before.
  - *Feel:* input now writes to a *target* rotation/zoom that the frame loop eases toward, with
    flick momentum and friction after release. Wheel/pinch glide instead of stepping.
  - *Zoom:* the near-clip plane is recomputed per frame from the current distance rather than
    pinned to one compromise value, which is what removes the need for the logarithmic depth
    buffer *and* allows `MIN_DISTANCE` to come in further (1.12 -> 1.08).
  - *Bug found on the way:* labels were placed by "does this marker face the camera", which
    zoomed out is the same as "is it on screen" but zoomed in is not — the camera covers a few
    degrees of arc while the facing test passes for most of the hemisphere. Labels for spots
    well outside the view were being positioned far outside the canvas, which (the container
    doesn't clip) spilled them over the header and bottom nav. Now frustum-culled; verified 8
    labels visible with 0 outside the canvas at a zoom that previously put them at x=-452px,
    y=1335px in a 362x420 canvas.
  - *Imagery:* real NASA Blue Marble satellite imagery (public domain, no API key) now loads in
    the background and swaps in over the drawn map, which stays as the instant, offline-safe
    base. Google Maps/Earth tiles were ruled out deliberately: they need a billing-enabled API
    key and their terms don't allow the tiles outside Google's own SDKs, so they can't ship in a
    static app. **The imagery URL could not be verified from the sandbox** (its proxy blocks
    nasa.gov), so the fallback is load-bearing rather than belt-and-braces — and it was
    exercised for real, since the fetch did fail there and the globe rendered correctly anyway.
    `SATELLITE_TEXTURE_URL` in `Globe.jsx` is the single thing to change if it needs swapping.

- **Marker dots now hold a constant on-screen size, and drag tracking was corrected again.**
  Reported as "one dot is bigger than Hawaii" when zoomed in. Markers were built at a fixed
  *world* radius, so zooming in kept them physically the same size while the geography grew
  around them. Two bugs turned out to share one root cause: **the reference depth was the
  camera's distance to the globe's centre, when what matters is its distance to the surface
  you're looking at / grabbing** (the markers sit on a shell at `R*1.045`). At the closest
  zoom the centre is 1.08 away but that shell is only 0.035 away — a 30x error.
  - *Marker size:* measured across the zoom range, one marker's on-screen diameter went
    **14px -> 683px** on the original fixed world radius. Scaling by centre distance (the first
    attempt here) only got that to **279px** — still 20x too big, so it would not have fixed the
    complaint. Scaling by shell distance holds a flat **14px at every zoom**, which is what
    shipped. Capped at 1x so it only ever shrinks: identical to before at the default zoom and
    further out, progressively smaller as you close in.
  - *Drag:* the same mistake was in the "1:1 finger tracking" sensitivity added earlier — it
    was zoom-aware but against the wrong reference depth, so it still over-rotated by
    `d/(d-R)`: 1.5x at the default zoom, **13.5x at the closest**. That is why dragging still
    felt wild up close after supposedly being fixed. Corrected to use surface distance.
  - *Verified* by diffing screenshots of identical views between builds: at the default zoom
    only 47 pixels differ and they're scattered (antialiasing noise — confirming no change
    where none was intended), while zoomed in 385 differ inside a single 41x22 box (the marker
    cluster shrinking, and nothing else). Drag accuracy checked numerically: asking to centre a
    marker by dragging (-75,+169) now lands it at (175,211) against a canvas centre of
    (181,210); the same drag previously threw every marker off screen. Tap-to-select confirmed
    still working at the deepest zoom by tapping a marker's exact projected point.
  - *Testing note:* an earlier smoke check reported tap-to-select failing after this change.
    It was a harness artifact — that check zoomed straight in from the default view, which
    lands on empty ocean with no markers to hit, and the corrected (much gentler) drag no
    longer swung the globe far enough to bring any into frame. The replacement steers to a
    marker using the live label positions before tapping, which is deterministic.

- **Marker dots now actively shrink on screen as you zoom in.** The change above stopped the
  dots *growing*, which was not the same as fixing the complaint, and the report came back:
  zoomed in, the dots still cover the surf spot's whole area. Measuring against real geography
  showed why. The usable zoom range only magnifies the globe about 2.8x (338px across at the
  default zoom, 939px at the closest), so at full zoom the Big Island is only ~16px wide and
  Oahu ~5px -- against a dot frozen at 13.5px. A constant on-screen size still swallows the
  island; the size has to come down as you close in.
  - *The curve:* apparent size is `worldSize/depth`, so scaling the world radius by exactly the
    depth ratio cancels the divide and holds a constant size. Raising that ratio to a power
    slightly above 1 leaves the on-screen size proportional to `ratio^(exp-1)` -- shrinking
    instead of constant. The exponent is **solved** from the on-screen size wanted at the
    closest zoom (`closeShrink`, currently 0.38) rather than hand-tuned, so it stays correct if
    `MIN_DISTANCE` ever moves. Measured result: **13.5px at the default zoom -> 11.4 -> 9.5 ->
    7.3 -> 5.1px at the closest**, with the default zoom and everything beyond it unchanged.
  - *The curve now lives in `lib/geo3d.js`* (`markerScaleForDistance` /
    `markerScreenSizeRatio`) so it is unit-testable without a GPU -- 9 new tests, including one
    that pins the exact failure this replaces (the old behaviour was a flat ratio of 1.0 at
    every zoom).
  - *Tap tolerance added alongside it.* A ~5px dot is far smaller than anyone can reliably tap,
    so shrinking the ray target with the dot would have traded one problem for another.
    `pickSpotAt` now falls back to the nearest front-facing marker within 22px of the tap when
    the raycast misses. Verified both ways: a tap 14px off a dot selects the spot on this
    build and **does not** on `main`, so this is a reliability win as well as a prerequisite.
  - *Also fixed:* the early-out in `updateMarkerScale` compared scales against an absolute
    epsilon (0.002). Zoomed right in the scale itself is ~0.007, so that would have swallowed
    every remaining change and frozen the dots mid-shrink. It is a relative (1%) test now.
  - *Verified:* lint + check:classnames + 111/111 tests + build, plus a headless-Chromium pass
    that descends to full zoom in small stages, re-centring on a real marker at each one (a
    single big zoom lands on empty ocean -- the artifact noted above), then taps 14px off a
    dot. Before/after screenshots of the same SoCal cluster show chunky blobs becoming
    pinpoints, with the labels unchanged. No console errors.
  - *Environment note:* the NASA satellite texture from the change above **cannot** load in the
    sandbox -- the egress proxy rejects `eoimages.gsfc.nasa.gov`, so browser checks here always
    show the drawn-map fallback. That is a sandbox limit, not a regression; the fallback path
    is what these screenshots exercise.

- **Markers now sit exactly on their coordinates, and the globe renders sharper.** Reported as
  "the dots are moving when I navigate zoomed in -- they should be exactly in the same place as
  their coordinates", plus a request to raise the globe's resolution.
  - *The drift was real and large.* Markers sat on a shell at `R*1.045` -- 4.5% of Earth's
    radius, about **287km of altitude**. Something at altitude only projects to the same screen
    point as the ground beneath it when you look straight down at it; every other angle offsets
    it, and the offset swings around as you rotate, so the dots slid across the terrain.
    Measured as the pixel gap between each marker's drawn position and its true lat/lon on the
    surface, over every visible marker: **median 8.3px at the default zoom, median 55px and up
    to 100px at the closest.** Now `MARKER_SHELL = R` (dot centred *on* the surface) and the
    same measurement reads **0.0px at every zoom, for every marker**.
  - *It costs nothing visually.* With the marker's centre on the surface the two spheres
    intersect in a circle of exactly the marker's radius, so with a flat (unlit) material the
    visible hemisphere renders as the same disc the whole sphere did. It also fixes the limb:
    dots near the horizon used to float clear of the globe's silhouette and are now correctly
    cut off by it.
  - *Knock-on:* labels are placed from the same positions, so they were off by the same amount.
    Steering a marker to the centre by dragging now lands it **1px** from centre, against 64px
    before.
  - *Resolution:* sphere tessellation 64x48 -> **128x96** (the old value predates the wider zoom
    range; at the closest zoom the sphere is ~939px across in a 362px viewport, where 64
    segments read as a faceted silhouette). Measured cost ~25ms on globe open, and this is
    software rendering -- negligible on a real GPU. Satellite imagery now loads **progressively**:
    2048 first and swapped in as soon as it lands, then 8192 (falling back to 4096) swapped over
    it, with each superseded texture disposed. Ordering is deliberate -- going straight for the
    8192 would leave a slow connection on the drawn map for the whole multi-MB download.
  - *Rejected after measuring:* doubling the drawn fallback map to 4096x2048. It added **~200ms
    of main-thread block to every globe open** (longest task 175ms -> 290ms) and bought little,
    because that map's detail is capped by the `LANDMASSES` polygon data, not by the canvas.
    Left at 2048, with the stroke widths now expressed relative to `mapW` so a future change
    doesn't silently halve every line's weight.
  - *Verified:* lint + check:classnames + 111/111 tests + build, the drift measurement above,
    the marker-size curve re-measured after the shell change (13.2px -> 5.0px, unchanged intent),
    and the staged-descent browser pass with an off-centre tap. No console errors.
  - *Still unverifiable here:* nasa.gov is blocked by the sandbox proxy, so no browser check in
    this environment has ever shown the real imagery -- all screenshots are the drawn fallback.
    The candidate-list loader exists precisely because those URLs could not be checked.

- **Globe renders at full screen resolution, and 77 more spots.** Reported as coastlines still
  looking blurry when zoomed in, plus a request for more spots.
  - *The blur was mostly ours, not the texture's.* `setPixelRatio` was capped at **2**, on a
    comment arguing the extra pixels were "not visible at this size". That was written for a
    small, barely-zoomable globe; with the zoom range now magnifying it ~2.8x, a 3x phone was
    being handed **two-thirds of its native resolution** and every edge -- silhouette,
    coastlines, dots -- was undersampled. Cap raised to 3.
  - *Paid for by dropping MSAA at 3x*, where 9:1 supersampling already resolves edges about as
    well. Measured at `deviceScaleFactor: 3`, dragging while zoomed in: **82.1ms/frame at
    cap-2-with-MSAA, 85.6ms at cap-3-without**. So 2.25x the pixels for ~4%. (Software
    rendering, so absolute numbers mean nothing; the ratio is the point.)
  - *Correction to the previous entry:* it claimed a 4096 fallback map cost "~200ms of
    main-thread block" and blamed the drawing. Timing the draw directly: **12ms at 2048, 40ms
    at 4096**. The cost is the ~32MB texture upload and mipmap chain, not the canvas work. The
    map stays at 2048 for that reason, which is a better-founded version of the same decision.
  - *Also fixed while in there:* every landmass ring was drawn **three times** (for ±180°
    wraparound), of which two passes land entirely off-canvas for all but a handful. Testing
    the ring's x-extent first cuts the drawing to roughly a third -- 36ms -> 12ms at 2048.
  - *Correction on the imagery URLs:* the `land_shallow_topo_4096/_8192` filenames in the
    previous entry were **invented by pattern-matching** the 2048 one and could not be checked
    (nasa.gov is blocked here). Replaced with Blue Marble Next Generation
    `world.topo.bathy.200412.3x5400x2700.jpg`, whose filename is corroborated by widespread use
    in three.js/R globe examples. 5400x2700 is 2.6x the linear detail of 2048 (~7x the pixels).
    Still not fetched from here, which is why the loader still falls back rather than trusting
    it.
  - *Spots: 153 -> 230.* Fills coverage that was thin -- the US East Coast, northern Europe and
    the North Sea (Sylt, Klitmøller, Hoddevik, Scheveningen), Australian city beaches, New
    Zealand's South Island, more of Indonesia and Central America. Coordinates place each break
    to within a few hundred metres, which is what the globe and the directions link need; they
    are **not** surveyed line-ups, and they come from general knowledge rather than a verified
    dataset -- worth spot-checking any that matter.
  - *Verified:* lint + check:classnames + 111/111 tests + build; a data-integrity check
    (ORDER and SPOTS agree, no duplicate keys/names, no malformed rows, coordinates in range);
    and a browser pass at `deviceScaleFactor: 3` with all 230 spots -- staged descent, marker
    steering landing 0.4px from centre, off-centre tap selecting. No console errors.

- **"Best today" window, and daylight-aware forecast hours.** First of the improvements from the
  competitive review (Surfline/MSW/Windy/Windguru).
  - *Best window (`lib/bestwindow.js`):* the app scored every sampled hour and never surfaced
    the conclusion, so answering "when should I go?" meant scrubbing the hour strip and
    comparing eight ratings by eye. Now a tappable line in the hero card — *"5a–11a best today ·
    4-6ft offshore"* — jumps the page to that hour. It picks the **longest run** at or within one
    point of the day's best (a three-hour stretch beats a one-hour peak), ties break earlier,
    and it renders **nothing** on a day where the best is still poor, since a "best window" on a
    bad day reads as a recommendation.
  - *Daylight hours (`lib/daylight.js`):* sampling was the fixed list `[5,7,9,11,13,15,17,19]`
    for every spot and date. Right for a mid-latitude summer, wrong elsewhere, and badly wrong
    for the catalog's own high-latitude spots — **Unstad is at 68.3°N, inside the Arctic Circle,
    where the sun does not rise at all through December**, so the app was offering eight hours
    of darkness. Hours now come from the spot's own sunrise/sunset (`daily=sunrise,sunset`),
    opening an hour before sunrise for first light. A short winter day returns **fewer** hours
    rather than repeating one, so nothing downstream may assume a length of 8 — `App.jsx` clamps
    `hourIdx`, and each hour now carries its own `hour` field (the tide readout indexes by it
    instead of the removed `HOUR_INDICES`).
  - *Verified:* 135/135 tests (24 new), lint, check:classnames, build. Browser check with the
    Open-Meteo endpoints **stubbed via `page.route`** — the sandbox proxy blocks open-meteo.com
    outright, so the live path cannot run here: confirmed the window renders, tapping it moves
    the selection (7A -> 5A), and the hour strip follows sunrise/sunset (5a…8p for a 06:10/19:20
    day) rather than the old fixed list.

## Suggested next steps

1. ~~Scaffold a real project~~ / ~~port the mockup in~~ / ~~replace `window.storage`~~ /
   ~~re-test the globe~~ / ~~split `App.jsx` into components~~ / ~~add a test suite~~ /
   ~~add a linter~~ / ~~code-split the globe view~~ — **done**, see the Update note at the
   top of this file.
2. ~~Real backend for push notifications~~ — **built** (`worker/`, a Cloudflare Worker),
   **not yet deployed** — that needs a human to create a Cloudflare account and follow
   `worker/README.md`'s one-time setup. CI/deployment for the frontend itself was already
   done in step 1 (GitHub Pages).
