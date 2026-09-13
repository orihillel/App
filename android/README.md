# Surfcast — Android (Trusted Web Activity)

This wraps the live PWA at `https://orihillel.github.io/App/` as a real Android app: a
[Trusted Web Activity](https://developer.chrome.com/docs/android/trusted-web-activity/) opens
the site full-screen inside Chrome, with no browser chrome — same app, same code, a real icon
on the home screen and a real Play Store listing.

## What's here, and how it got here

- **`twa-manifest.json`** — the project's configuration, in
  [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap)'s own schema. Normally
  `bubblewrap init --manifest=<url>` writes this by reading the site's own
  `manifest.webmanifest` and fetching the current Android/Chrome version info from Google's
  servers. Both of those hosts (`dl.google.com` for the Android SDK, and the live site's own
  domain) are blocked by this environment's network egress policy, so `init` couldn't complete
  here. This file was authored by hand instead — matching the same values the site's real
  `manifest.webmanifest` already has (name, colors, icons, `display: standalone`) — and then
  **validated against Bubblewrap's own `TwaManifest.validate()`**, so it's confirmed to be a
  file Bubblewrap itself accepts as correct, not a guess at the shape.
- **`assetlinks.json`** — proves to Chrome that this Android app and the website are the same
  thing, which is what lets Chrome hide the URL bar. Generated with Bubblewrap's own
  `DigitalAssetLinks.generateAssetLinks()` (not hand-typed), from a real signing certificate's
  SHA-256 fingerprint. **Where this has to be hosted matters — see below.**
- **The signing keystore is not here.** `surfcast-upload-key.jks` was generated locally with
  `keytool` (a real RSA-2048 keypair, ~27-year validity — the standard Play Store recommends),
  and its fingerprint is what `assetlinks.json` above is built from. It was **not committed** —
  see `.gitignore` — because whoever holds it can publish updates to this app's Play Store
  listing under its identity for as long as the app exists. It was handed over once, directly,
  outside the repository. If you don't have it, it needs to be regenerated (see below) and
  `assetlinks.json` regenerated to match.

## Before you build: two decisions this repo can't make for you

1. **The package ID.** `twa-manifest.json` currently has `"packageId": "com.surfcast.app"` — a
   placeholder. Change it to whatever reverse-domain id you actually want
   (`com.yourname.surfcast`, say) **before** the first Play Store upload — Google ties a
   listing to its package id permanently; it cannot be changed afterwards, only replaced with a
   whole new listing.
2. **Where `assetlinks.json` is hosted.** Chrome's verification fetches it from
   `https://<host>/.well-known/assetlinks.json` — **at the domain root**, not under `/App/`.
   This repo serves the app at `orihillel.github.io/App/`, a project subpath, and a project
   repo on GitHub Pages cannot serve files at the domain root — only a repo literally named
   `orihillel.github.io` can. A copy of the same file is already committed at
   `public/.well-known/assetlinks.json` in the main app repo for when either of these applies:
   - **A custom domain**, pointed at this GitHub Pages site via a `CNAME` file — then this
     repo *does* serve from the domain root, and that copy is already in the right place.
   - **A root `orihillel.github.io` repo**, if you have or create one — copy
     `assetlinks.json` there instead.

   Until one of those is true, the TWA will still open the site, but Chrome will show it in a
   regular tab with the URL bar rather than as a trusted full-screen app.

## Finishing the build

Everything above is real and ready; what's missing is compiling it into a signed `.aab`
(Android App Bundle), which needs the Android SDK's build tools — genuinely unavailable in this
sandbox, not just slow to fetch. Two ways to finish it, in order of how much local setup they need:

### Zero local tooling: PWABuilder

1. Go to [pwabuilder.com](https://www.pwabuilder.com/), enter
   `https://orihillel.github.io/App/`, and let it read the manifest.
2. On the Android package step, it will offer to generate a signed package for you, or let you
   upload the existing `surfcast-upload-key.jks` so the app bundle is signed with the same
   fingerprint `assetlinks.json` already expects (recommended — keeps this file correct).
3. Download the resulting `.aab` and upload it to
   [Play Console](https://play.google.com/console) directly.

### Full local build: Bubblewrap + Android Studio

1. Install [Android Studio](https://developer.android.com/studio) (or just its command-line
   SDK tools) locally — this gives you the `build-tools`/`aapt2`/`zipalign` this sandbox
   couldn't reach.
2. `npm install -g @bubblewrap/cli`, then from this directory: `bubblewrap build`. It reads
   `twa-manifest.json`, asks for the keystore password, and produces `app-release-bundle.aab`.
3. Upload that to Play Console.

Either way, the Play Console side — creating the $25 developer account, the store listing
(icon, screenshots, description, the Data Safety questionnaire, the privacy policy URL below),
and the actual "publish" — needs a human with real payment details and an account; nothing in
this repository can do that part.

## Related setup

- **Privacy policy**: `https://orihillel.github.io/App/privacy.html` — required by the Play
  Console listing form. Has a placeholder contact email; update it before publishing (see the
  file itself).
- **Push notifications, Google/Meta login**: the Worker backend these features need is
  documented in `worker/README.md`, separately from the Android packaging above.
