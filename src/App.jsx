import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { storage } from './lib/storage.js';
import { COLORS } from './lib/colors.js';
import { SEED_SPOTS, ORDER, searchCatalog, loadCatalog } from './lib/spots.js';
import { fetchSpotForecast, fetchNowForSpots, fetchModelAgreement, geocodePlace, findOffshoreDirection } from './lib/forecast.js';
import { fetchBuoyObservation } from './lib/buoy.js';
import { defaultUnits } from './lib/locale.js';
import { addSample, calibration } from './lib/calibration.js';
import { makeSession, addSession, removeSession } from './lib/sessions.js';
import { linePath, waveAvg } from './lib/format.js';
import { nextTideEvent } from './lib/tides.js';
import { stepNearest } from './lib/spotnav.js';
import { checkAlertMatch } from './lib/alerts.js';
import { isPushSupported, getCurrentSubscription, subscribeToPush, unsubscribeFromPush, syncAlertsToPush } from './lib/push.js';
import { getSession, logout as clearStoredSession, fetchMyAccount, pushAppData } from './lib/auth.js';
import { OnboardingView } from './components/OnboardingView.jsx';
import { HomeView } from './components/HomeView.jsx';
import { AlertsView } from './components/AlertsView.jsx';
import { ProfileView } from './components/ProfileView.jsx';
import { SearchSheet } from './components/SearchSheet.jsx';
import { AlertSheet } from './components/AlertSheet.jsx';
import { BottomNav } from './components/BottomNav.jsx';
import { NavDrawer } from './components/NavDrawer.jsx';

const GLOBAL_CSS = `
/* The font @import used to live here, and that was the problem: this string only becomes a
   <style> tag once React renders, so the browser could not discover the fonts until the whole
   bundle had downloaded and run -- measured at 1174ms on a slow connection. It is a
   preconnect plus a stylesheet link in index.html now, which starts it immediately.

   The reset stays here as well as in index.html's boot styles, so the app is still correct if
   this component is rendered somewhere that never served that HTML -- a unit test, or an
   embed. The document had no reset at all until recently: it never needed one while the app
   sat inside a centred frame on a beige page, where the browser's default 8px body margin
   just widened the beige. Edge to edge, that margin pushes the whole app down and left. */
html, body { margin: 0; padding: 0; background: #070F18; }
.no-scrollbar::-webkit-scrollbar { display: none; }
.no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
.tl-btn { cursor: pointer; }
.tl-btn:focus-visible { outline: 2px solid #F4F7F6; outline-offset: 2px; border-radius: 8px; }
.tl-input:focus { outline: none; border-color: rgba(244,247,246,0.5) !important; }
.tl-label { position: absolute; pointer-events: none; transform: translate(-50%, -130%); white-space: nowrap;
  background: rgba(8,20,31,0.88); color: #F4F7F6; font-family: 'JetBrains Mono', monospace; font-size: 10px;
  padding: 3px 7px; border-radius: 8px; display: none; }
/* A cluster marker's count, centred on the dot rather than floating above it like a name. */
.tl-count { font-weight: 700; font-size: 11px; padding: 2px 6px; min-width: 9px; text-align: center;
  background: rgba(7,15,24,0.92); border: 1px solid rgba(244,247,246,0.28); }
@keyframes tl-pulse { 0%, 100% { opacity: 0.35; } 50% { opacity: 0.8; } }
.tl-pulse { animation: tl-pulse 1.4s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; animation: none !important; }
}

/* Every component was written against these class names (a leftover from the original
   chat-to-code mockup, which ran against a Tailwind CDN preview) but the scaffold step
   never actually wired up Tailwind or any stylesheet defining them -- so every layout
   built on them silently fell back to plain block/inline flow. This is the minimal set
   of classes actually referenced in src/, defined by hand at Tailwind's own spacing scale
   (1 unit = 0.25rem) so nothing needed to change at the call sites.
   See scripts/check-classnames.mjs for a check that keeps this list complete. */
.flex { display: flex; }
.grid { display: grid; }
.flex-col { flex-direction: column; }
.items-start { align-items: flex-start; }
.items-center { align-items: center; }
.items-end { align-items: flex-end; }
.items-baseline { align-items: baseline; }
.justify-between { justify-content: space-between; }
.justify-around { justify-content: space-around; }
.justify-center { justify-content: center; }
.justify-end { justify-content: flex-end; }
.overflow-x-auto { overflow-x: auto; }
.overflow-hidden { overflow: hidden; }
.relative { position: relative; }
.min-h-screen { min-height: 100vh; min-height: 100dvh; }
.w-full { width: 100%; }
.grid-cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.p-6 { padding: 1.5rem; }
.px-3 { padding-left: 0.75rem; padding-right: 0.75rem; }
.px-4 { padding-left: 1rem; padding-right: 1rem; }
.px-6 { padding-left: 1.5rem; padding-right: 1.5rem; }
.px-7 { padding-left: 1.75rem; padding-right: 1.75rem; }
.pt-2 { padding-top: 0.5rem; }
.pt-4 { padding-top: 1rem; }
.pb-1 { padding-bottom: 0.25rem; }
.pb-3 { padding-bottom: 0.75rem; }
.mx-4 { margin-left: 1rem; margin-right: 1rem; }
.mx-6 { margin-left: 1.5rem; margin-right: 1.5rem; }
`;

// Globe.jsx pulls in three (the app's single biggest dependency) purely for the globe view —
// most sessions probably never open it, so it's lazy-loaded instead of sitting in the initial
// bundle every visitor downloads. Globe.jsx has a named export, not a default one, hence the
// .then() mapping (React.lazy requires a module with a default export).
const Globe = lazy(() => import('./components/Globe.jsx').then((m) => ({ default: m.Globe })));

function GlobeLoading() {
  return (
    <div style={{ height: 420, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span className="tl-pulse" style={{ fontSize: 12.5, color: COLORS.foamDim }}>Loading globe…</span>
    </div>
  );
}

export default function App() {
  // Seeded, not the full catalog. The 400-spot list is 30KB gzipped -- 27% of everything the
  // browser downloaded before the app could start -- to render a screen that shows one spot,
  // so it now arrives in its own chunk just after the first paint (see the effect below).
  // SEED_SPOTS covers every screen that can appear before it lands: the go-to default and the
  // onboarding picks.
  const [spots, setSpots] = useState(SEED_SPOTS);
  const [order, setOrder] = useState(() => ORDER.filter((id) => SEED_SPOTS[id]));
  const [catalogReady, setCatalogReady] = useState(false);
  const [activeId, setActiveId] = useState('trestles');
  // Where the spot arrows measure "nearby" from.
  //
  // It is the spot you arrived at deliberately -- by search, the globe, your go-to -- and it
  // stays put while you step, so the arrows fan outward from there instead of chaining
  // nearest-to-current, which bounces between the same two spots forever. See lib/spotnav.js.
  const [navAnchorId, setNavAnchorId] = useState('trestles');
  // Model agreement, cached per spot. Fetched only for the spot being looked at — it is a
  // second request per spot, and doing it for all 230 during the bulk load would double that
  // traffic for a signal nobody is reading on 229 of them.
  const [agreement, setAgreement] = useState({});
  // Live buoy reading, cached per spot and fetched only for the spot being viewed — same
  // reasoning as the model agreement above.
  const [buoy, setBuoy] = useState({});
  // Logged sessions: what you actually surfed, kept alongside what the app predicted at the
  // time so a rating can be checked against reality over a season. See lib/sessions.js.
  const [sessions, setSessions] = useState([]);
  // Paired (forecast, buoy) readings per spot. Models carry persistent local biases — a grid
  // cell offshore of a spot that sits behind a headland reads high there every time — and that
  // part of the error is systematic, so it can be measured and subtracted. See lib/calibration.js.
  const [calSamples, setCalSamples] = useState({});
  const [goToId, setGoToId] = useState('trestles');
  const [hourIdx, setHourIdx] = useState(1);
  const [contSelectedIdx, setContSelectedIdx] = useState(null);
  const [toast, setToast] = useState('');
  const [forecast, setForecast] = useState({});
  // Empty, not the whole catalog.
  //
  // This used to start as `new Set(ORDER)` — every spot marked "fetching" up front — which was
  // right only while the loader called loadSpotData for every spot in turn, each clearing its
  // own entry. The batched backfill does not, so seeding it left every spot but the first stuck
  // on FETCHING forever, and the guard below then refused to fetch them at all. A spot is now
  // marked loading by the thing that actually loads it.
  const [loadingIds, setLoadingIds] = useState(() => new Set());
  const [errorIds, setErrorIds] = useState(() => new Set());
  const [view, setView] = useState('home');

  const [searchOpen, setSearchOpen] = useState(false);
  const [onboarded, setOnboarded] = useState(true);
  // Lets onboarding borrow the same Globe used post-onboarding, so picking a go-to spot can be
  // done visually (tap a marker) instead of only by typing into search. Separate from `view`
  // since onboarding has its own gate (`!onboarded`) ahead of the normal view switch below.
  const [onboardingGlobeOpen, setOnboardingGlobeOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchStep, setSearchStep] = useState('query');
  const [searchError, setSearchError] = useState('');
  const [pending, setPending] = useState(null);
  const [searchMatches, setSearchMatches] = useState([]);

  const [alerts, setAlerts] = useState([]);
  const [alertSheetOpen, setAlertSheetOpen] = useState(false);
  const [alertDraft, setAlertDraft] = useState(null);
  // Metric unless the browser says otherwise — the app is used far outside the US, and this
  // toggle drives wind speed and water temperature as well as wave height. A stored preference
  // (loaded just below) always wins over the guess. See lib/locale.js.
  const [units, setUnits] = useState(defaultUnits);

  // Account login (Google/Meta) + cross-device sync — see src/lib/auth.js and worker/README.md.
  // Entirely optional: with no session, the app behaves exactly as it always has (local-only).
  const [session, setSession] = useState(() => getSession());

  // Read by the Globe component's animation loop so every rendered frame reflects whatever is
  // currently in `forecast`, without a separate effect keyed on [forecast, hourIdx, ...] that
  // could fall out of sync (see Globe.jsx).
  // The globe's code, fetched while the phone is idle rather than when the globe is tapped.
  //
  // That chunk is 175KB and measured just over a second of download on a slow connection --
  // a second in which tapping the globe did nothing visible. Nothing else needs the network by
  // this point, so it costs nobody anything to have it already there.
  //
  // Not unconditionally, though: this is 175KB for a view plenty of sessions never open. Data
  // Saver is an explicit request not to do this, and on 2g the bandwidth is better spent on the
  // forecast someone is actually waiting for. requestIdleCallback waits for a genuinely quiet
  // moment; the timeout stops it waiting forever on a busy page, and the setTimeout fallback
  // covers Safari, which still has no requestIdleCallback.
  useEffect(() => {
    const net = typeof navigator !== 'undefined' ? navigator.connection : null;
    if (net && (net.saveData || /^(slow-)?2g$/.test(net.effectiveType || ''))) return;
    const prefetch = () => { import('./components/Globe.jsx').catch(() => { /* tapping it will retry */ }); };
    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(prefetch, { timeout: 4000 });
      return () => cancelIdleCallback(id);
    }
    const id = setTimeout(prefetch, 2500);
    return () => clearTimeout(id);
  }, []);

  // The rest of the catalog, once the app is on screen.
  //
  // Deliberately an effect rather than a static import: a static one would put it back in the
  // main bundle and undo the split. Everything downstream already copes with a partial map --
  // the drawer, profile and globe all filter on `spots[id]` -- so the only visible difference
  // in the tens of milliseconds before this resolves is a shorter list.
  useEffect(() => {
    let cancelled = false;
    loadCatalog()
      .then((catalog) => {
        if (cancelled) return;
        // `prev` wins over the catalog: it holds anything restored from storage or added by
        // hand, and those must not be overwritten by a catalog entry of the same id.
        setSpots((prev) => ({ ...catalog, ...prev }));
        setOrder((prev) => [...ORDER, ...prev.filter((id) => !ORDER.includes(id))]);
        setCatalogReady(true);
      })
      .catch(() => { /* the seeded spots still work; a reload retries */ });
    return () => { cancelled = true; };
  }, []);

  // Read by the bulk loader, which must not re-run when either changes.
  const activeIdRef = useRef(activeId);
  const goToIdRef = useRef(goToId);
  activeIdRef.current = activeId;
  goToIdRef.current = goToId;
  const dataRef = useRef({ spots, order, forecast, clockHour: null });
  useEffect(() => {
    // The globe colours every marker for one moment in time, so it needs the clock hour, not the
    // index. `hourIdx` only indexes the *active* spot's daylight window, and since PR #22 those
    // windows differ per spot: the same index is a different time of day elsewhere, and off the
    // end entirely at a spot with a shorter day.
    const own = (forecast[activeId] && forecast[activeId].hours) || null;
    const sel = own && own.length ? own[Math.min(hourIdx, own.length - 1)] : null;
    dataRef.current = { spots, order, forecast, clockHour: sel ? sel.hour : null };
  });

  // Two effects can ask for the same spot in the same commit — the mount loader and the
  // "whatever is on screen" one both want the active spot — and neither sees the other's
  // setState until the next render. A ref is checked synchronously, so the second caller drops
  // out instead of firing a duplicate pair of requests.
  const inFlight = useRef(new Set());
  const loadSpotData = useCallback(async (id, spotObj) => {
    if (inFlight.current.has(id)) return;
    inFlight.current.add(id);
    setLoadingIds((prev) => new Set(prev).add(id));
    setErrorIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
    try {
      const result = await fetchSpotForecast(spotObj);
      // When the next refresh fails, this is what lets the page say "4h 20m ago" instead of
      // quietly presenting stale numbers as current ones.
      setForecast((prev) => ({ ...prev, [id]: { ...result, fetchedAt: Date.now() } }));
    } catch {
      setErrorIds((prev) => new Set(prev).add(id));
    } finally {
      inFlight.current.delete(id);
      setLoadingIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
    }
  }, []);

  // Only the spot on screen and the go-to spot get a full forecast. Everything else gets one
  // "right now" reading, batched.
  //
  // This used to call fetchSpotForecast for all of ORDER — two requests each, seven days of
  // hourly data, eleven marine variables — which measured at **809 requests on a single app
  // open** against a free tier allowing 600 a minute and 10,000 a day. It was already over
  // budget at 348 spots; at 403 the app simply stopped being able to fetch, which is what a
  // rate limit looks like from the inside. See fetchNowForSpots for the arithmetic.
  const backfillWarned = useRef(false);
  const loadBackfill = useCallback(async () => {
    // From the live map rather than the module: before the catalog chunk lands this is the
    // seed set, which is why the backfill is re-run once it arrives.
    const known = dataRef.current.spots;
    const rest = ORDER.filter((id) => known[id] && id !== activeIdRef.current && id !== goToIdRef.current);
    const results = await fetchNowForSpots(rest.map((id) => ({ id, spot: known[id] })));
    // Every batch refused and nothing to show for it is a different thing from a calm sea, and
    // grey markers alone do not say which. Said once, not on every refresh — a rate limit that
    // lasts an hour should not produce four toasts an hour.
    if (!Object.keys(results).length && results.failedBatches.length && !backfillWarned.current) {
      backfillWarned.current = true;
      setToast('Could not load conditions for the other spots');
    }
    setForecast((prev) => {
      const next = { ...prev };
      for (const [id, value] of Object.entries(results)) {
        // Never let a one-hour reading overwrite a real forecast: the spot page reads fields
        // this cannot supply, and the globe is happy with either.
        if (!next[id] || next[id].now) next[id] = value;
      }
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // The spot being looked at first, then the go-to spot, then the rest of the catalog in
      // one batched pass — the detail view is what someone is actually waiting for.
      const known = dataRef.current.spots;
      const first = [...new Set([activeIdRef.current, goToIdRef.current].filter((id) => id && known[id]))];
      await Promise.all(first.map((id) => loadSpotData(id, known[id])));
      if (cancelled) return;
      await loadBackfill();
    })();
    return () => { cancelled = true; };
    // catalogReady is a dependency on purpose: the first pass runs against the seed set, and
    // this runs again with the real catalog so every marker on the globe gets a reading.
  }, [loadSpotData, loadBackfill, catalogReady]);

  // Marked in a ref the moment a request starts, not when it finishes. This effect depends on
  // `forecast`, which changes on every one of the 230 spots loading in the background, so a
  // guard that only checked the stored result would refire dozens of times before the first
  // response landed — measured at 20 requests for one spot.
  const agreementRequested = useRef(new Set());
  useEffect(() => {
    const spotObj = spots[activeId];
    const full = forecast[activeId] && !forecast[activeId].now ? forecast[activeId] : null;
    const hours = full && full.hours;
    // Model agreement compares a series; the batched one-hour reading is not one, so this
    // waits for the real forecast rather than asking about a single point.
    if (!spotObj || !hours || agreementRequested.current.has(activeId)) return;
    agreementRequested.current.add(activeId);
    (async () => {
      // Never allowed to fail the page: a null result just means no badge.
      let result = null;
      try {
        result = await fetchModelAgreement(spotObj, hours.map((hr) => hr.hour));
      } catch { /* leave it null */ }
      setAgreement((prev) => ({ ...prev, [activeId]: result }));
    })();
  }, [activeId, spots, forecast]);

  // Whatever spot is on screen gets fetched now, regardless of where the background backfill
  // has got to. Reordering the queue only helps the spot that was active when the loader
  // started; switching spots (picking one in onboarding, stepping through with the arrows,
  // tapping a marker) has to jump the queue too, or you sit on FETCHING while 247 other
  // forecasts load ahead of the one you asked for.
  useEffect(() => {
    const spotObj = spots[activeId];
    // A `now` entry is the batched one-hour reading the globe colours markers from. It is not
    // a forecast — no chart, no week, no tide, no best window — so the spot page still has to
    // fetch properly. Treating it as "already loaded" would leave every spot but the first two
    // showing placeholders forever.
    const loaded = forecast[activeId] && !forecast[activeId].now;
    // `errorIds` is in the guard because this effect depends on `forecast` and `loadingIds`,
    // both of which change when a fetch *fails* — so without it a spot whose forecast cannot
    // be fetched is retried the instant the last attempt gives up, forever, which is a request
    // storm aimed at an API that has just said no. It stops instead, and HomeView's retry
    // button is how it gets asked again.
    if (!spotObj || loaded || loadingIds.has(activeId) || errorIds.has(activeId)) return;
    loadSpotData(activeId, spotObj);
  }, [activeId, spots, forecast, loadingIds, errorIds, loadSpotData]);

  const buoyRequested = useRef(new Set());
  useEffect(() => {
    const spotObj = spots[activeId];
    if (!spotObj || buoyRequested.current.has(activeId)) return;
    buoyRequested.current.add(activeId);
    (async () => {
      let result = null;
      try { result = await fetchBuoyObservation(spotObj); } catch { /* no panel */ }
      setBuoy((prev) => ({ ...prev, [activeId]: result }));
      // A buoy reading beside the forecast for the same moment is one calibration sample.
      // Read through dataRef (refreshed every render) rather than closing over `forecast`:
      // this effect must not re-run on each of the 248 background spot loads, and a captured
      // `forecast` would be the one from whenever the request started.
      const fc = dataRef.current.forecast[activeId];
      const nowHour = fc && fc.hours && fc.hours.find((hr) => hr.hour === new Date().getHours());
      if (result && result.waveFt != null && nowHour) {
        setCalSamples((prev) => {
          const next = { ...prev, [activeId]: addSample(prev[activeId], {
            forecastFt: waveAvg(nowHour.wave), observedFt: result.waveFt,
          }) };
          storage.set('surf-calibration', JSON.stringify(next)).catch(() => {});
          return next;
        });
      }
    })();
  }, [activeId, spots]);

  useEffect(() => {
    (async () => {
      try {
        const res = await storage.get('surf-sessions');
        const saved = res && res.value ? JSON.parse(res.value) : [];
        if (Array.isArray(saved) && saved.length) setSessions(saved);
        const cal = await storage.get('surf-calibration');
        const savedCal = cal && cal.value ? JSON.parse(cal.value) : null;
        if (savedCal && typeof savedCal === 'object') setCalSamples(savedCal);
      } catch { /* nothing logged yet, or unreadable: start empty */ }
    })();
  }, []);

  // load any spots saved earlier ("database")
  useEffect(() => {
    (async () => {
      try {
        const res = await storage.get('surf-spots');
        const saved = res && res.value ? JSON.parse(res.value) : [];
        if (Array.isArray(saved) && saved.length) {
          setSpots((prev) => { const merged = { ...prev }; saved.forEach((s) => { merged[s.id] = s; }); return merged; });
          setOrder((prev) => { const ids = saved.map((s) => s.id).filter((id) => !prev.includes(id)); return [...prev, ...ids]; });
          saved.forEach((s) => loadSpotData(s.id, s));
        }
      } catch { /* nothing saved yet */ }
    })();
  }, [loadSpotData]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(''), 1700);
    return () => clearTimeout(id);
  }, [toast]);

  useEffect(() => { setContSelectedIdx(null); }, [activeId]);

  useEffect(() => {
    (async () => {
      try {
        const res = await storage.get('surf-alerts');
        const saved = res && res.value ? JSON.parse(res.value) : [];
        if (Array.isArray(saved)) setAlerts(saved);
      } catch { /* nothing saved yet */ }
    })();
    (async () => {
      try {
        const res = await storage.get('surf-units');
        if (res && (res.value === 'metric' || res.value === 'imperial')) setUnits(res.value);
      } catch { /* nothing saved yet */ }
    })();
    (async () => {
      try {
        const res = await storage.get('surf-onboarded');
        if (!res || res.value !== 'true') setOnboarded(false);
      } catch { setOnboarded(false); } // missing key = never onboarded
    })();
  }, []);

  function toggleUnits() {
    const next = units === 'imperial' ? 'metric' : 'imperial';
    setUnits(next);
    storage.set('surf-units', next).catch(() => {});
  }

  function completeOnboarding(id) {
    setGoToId(id);
    setOnboarded(true);
    storage.set('surf-onboarded', 'true').catch(() => {});
  }
  function pickOnboardingSpot(id) {
    focusSpot(id);
    completeOnboarding(id);
  }
  function openOnboardingGlobe() { setOnboardingGlobeOpen(true); }
  function closeOnboardingGlobe() { setOnboardingGlobeOpen(false); }
  function pickOnboardingSpotFromGlobe(id) {
    setOnboardingGlobeOpen(false);
    pickOnboardingSpot(id);
  }

  // Replaces local state with an account's synced data (goToId, custom-added spots, alerts,
  // units) — used both right after login and when refreshing an existing session on load.
  // Deliberately does NOT touch built-in seed spots: those are baked into the app itself and
  // identical on every device, only what a user actually added is worth syncing (same
  // philosophy as Profile's "YOUR SPOTS" list — see HANDOFF.md).
  function applyRemoteAppData(appData) {
    if (!appData) return;
    if (appData.goToId) setGoToId(appData.goToId);
    if (appData.units === 'metric' || appData.units === 'imperial') setUnits(appData.units);
    if (Array.isArray(appData.alerts)) { setAlerts(appData.alerts); persistAlertsLocally(appData.alerts); }
    if (Array.isArray(appData.sessions)) { setSessions(appData.sessions); persistSessionsLocally(appData.sessions); }
    if (Array.isArray(appData.customSpots) && appData.customSpots.length) {
      setSpots((prev) => { const merged = { ...prev }; appData.customSpots.forEach((s) => { merged[s.id] = s; }); return merged; });
      setOrder((prev) => { const ids = appData.customSpots.map((s) => s.id).filter((id) => !prev.includes(id)); return [...prev, ...ids]; });
      appData.customSpots.forEach((s) => loadSpotData(s.id, s));
      storage.set('surf-spots', JSON.stringify(appData.customSpots)).catch(() => {});
    }
  }
  // Called after a successful Google/Facebook login (from Onboarding or Profile — see
  // AuthButtons.jsx). A brand-new account (or one with nothing synced yet) gets seeded from
  // whatever's already on this device, rather than looking like it just erased everything;
  // an account with real synced data replaces local state with it, the ordinary "sign in to
  // get your stuff back" expectation.
  function handleLoginResult(result) {
    setSession({ sessionToken: result.sessionToken, profile: result.profile });
    const hasRemoteData = !result.isNewAccount && result.appData;
    if (hasRemoteData) applyRemoteAppData(result.appData);
    else pushAppData(result.sessionToken, currentAppData());
    if (!onboarded) completeOnboarding(hasRemoteData && result.appData.goToId ? result.appData.goToId : activeId);
    setToast('Signed in as ' + (result.profile.name || 'your account'));
  }
  // Logging out only forgets this device's session token — the data itself stays right where
  // it already lives, in local storage, exactly as if the account were never involved.
  function handleLogOut() {
    clearStoredSession();
    setSession(null);
    setToast('Signed out — your spots and alerts stay on this device');
  }
  async function persistSessionsLocally(next) {
    try { await storage.set('surf-sessions', JSON.stringify(next)); } catch { /* best-effort */ }
  }
  function logSession({ stars, note }) {
    const hr = hourData[safeHourIdx];
    const entry = makeSession({
      spotId: activeId,
      spotName: spot.name,
      // What the app predicted for the hour being looked at, captured now so it can be
      // compared with how it actually was later.
      rating: hr && hr.rating !== 'LOADING' ? hr.rating : null,
      waveFt: hr ? waveAvg(hr.wave) : null,
      stars,
      note,
    });
    const next = addSession(sessions, entry);
    setSessions(next);
    persistSessionsLocally(next);
    setToast('Session logged at ' + spot.name);
  }
  function deleteSession(id) {
    const next = removeSession(sessions, id);
    setSessions(next);
    persistSessionsLocally(next);
  }

  function currentAppData(overrides = {}) {
    return {
      goToId,
      customSpots: order.filter((id) => !ORDER.includes(id)).map((id) => spots[id]).filter(Boolean),
      alerts,
      units,
      sessions,
      ...overrides,
    };
  }
  // If a session was already stored from a previous visit, pull this account's latest synced
  // data in case another device changed something since — best-effort, same as everything else
  // account-related: an expired token or unreachable Worker just means this device keeps using
  // whatever it already has locally, not an error the user needs to see.
  useEffect(() => {
    if (!session) return;
    fetchMyAccount(session.sessionToken).then(({ appData }) => applyRemoteAppData(appData)).catch(() => {});
    // Mount-once: re-running this on every `session` change would also fire right after
    // login, redundantly re-fetching data handleLoginResult already just applied.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Keeps a logged-in account's synced data current as this device's own data changes.
  // Debounced so a burst of edits (e.g. nudging a new spot's offshore direction back and
  // forth before saving) doesn't fire a request per keystroke-equivalent change.
  useEffect(() => {
    if (!session) return;
    const t = setTimeout(() => pushAppData(session.sessionToken, currentAppData()), 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, goToId, order, spots, alerts, units]);

  async function persistAlertsLocally(next) {
    try { await storage.set('surf-alerts', JSON.stringify(next)); } catch { /* best-effort */ }
  }
  async function persistAlerts(next) {
    await persistAlertsLocally(next);
    // Keep the push-notification backend's copy of this device's alerts current — a no-op
    // if push isn't subscribed or configured (syncAlertsToPush checks both).
    syncAlertsToPush(pushSubscription, next, spots);
  }

  // Real (backend-driven) push notifications — see src/lib/push.js and worker/. Reflects
  // actual subscription state (checked from the browser, not a flag this app made up) so it
  // stays correct even if permission was revoked outside the app.
  const [pushSubscription, setPushSubscription] = useState(null);
  const [pushBusy, setPushBusy] = useState(false);
  useEffect(() => { getCurrentSubscription().then(setPushSubscription); }, []);
  async function togglePush() {
    setPushBusy(true);
    try {
      if (pushSubscription) {
        await unsubscribeFromPush();
        setPushSubscription(null);
      } else {
        const sub = await subscribeToPush(alerts, spots);
        setPushSubscription(sub);
      }
    } catch (e) {
      setToast(e.message || 'Could not update push notifications');
    } finally {
      setPushBusy(false);
    }
  }

  // Live feed: the spot on screen in full, the rest as one batched pass.
  //
  // This used to re-fetch a seven-day forecast for every spot in the catalog every ten minutes
  // — 806 requests a cycle, ~116,000 a day against a 10,000-a-day allowance. Fifteen minutes is
  // also closer to honest: the wave model behind this runs four times a day.
  useEffect(() => {
    const interval = setInterval(() => {
      const id = activeIdRef.current;
      if (id && dataRef.current.spots[id]) loadSpotData(id, dataRef.current.spots[id]);
      loadBackfill();
    }, 15 * 60 * 1000);
    return () => clearInterval(interval);
  }, [loadSpotData, loadBackfill]);

  const spot = spots[activeId];
  // The spot page reads a full forecast only. A `now` entry exists for the globe's markers and
  // carries a single hour; letting it through here would render a chart from one point and a
  // week from none, which reads as broken data rather than as loading.
  const spotForecast = forecast[activeId] && !forecast[activeId].now ? forecast[activeId] : null;
  // Every value below is either a real measurement or null. There is no third option any more.
  //
  // It used to be a third option, and it was the worst bug in the app. When a fetch was slow
  // or failed, these fell back to PLACEHOLDER_HOURS and friends: a believable 3-5ft at 12s
  // from the SW, a sine-wave week, a tide curve, all rendered in exactly the same type as
  // real data with nothing to tell them apart. The card said "Live data didn't load for this
  // spot" directly beneath numbers it had invented. In a weather app that is bad; in a surf
  // app someone drives to the coast on it.
  const hourData = (spotForecast && spotForecast.hours && spotForecast.hours.length) ? spotForecast.hours : null;
  const contData = (spotForecast && spotForecast.continuous && spotForecast.continuous.length) ? spotForecast.continuous : null;
  const contWaveLine = contData ? linePath(contData.map((p) => p.waveFt), 300, 70, 10) : null;
  const contTideLine = contData ? linePath(contData.map((p) => (p.tideFt != null ? p.tideFt : 0)), 300, 70, 10) : null;
  const contWindLine = contData ? linePath(contData.map((p) => (p.windSpd != null ? p.windSpd : 0)), 300, 70, 10) : null;
  const contSelected = contData && contSelectedIdx != null ? contData[contSelectedIdx] : null;
  // The sampled hours are no longer a fixed list of eight — a short winter day at a
  // high-latitude spot yields fewer — so an index chosen for one spot can overshoot the next.
  const safeHourIdx = hourData ? Math.min(hourIdx, hourData.length - 1) : 0;
  const h = hourData ? hourData[safeHourIdx] : null;
  const isGoTo = activeId === goToId;
  const spotCalibration = calibration(calSamples[activeId]);
  const tideToday = (spotForecast && spotForecast.tideToday && spotForecast.tideToday.every((v) => v != null)) ? spotForecast.tideToday : null;
  const tideNext = (h && spotForecast && spotForecast.tideFine && spotForecast.tideFine.length) ? nextTideEvent(spotForecast.tideFine, h.hour) : null;
  const tide = tideToday ? linePath(tideToday, 100, 34, 4) : null;
  const waveChart = hourData ? linePath(hourData.map((hr) => waveAvg(hr.wave)), 300, 56, 8) : null;
  const hasError = errorIds.has(activeId);
  // The four states the spot page can be in, named once here rather than re-derived from
  // three booleans at every call site. "stale" is the interesting one: the fetch failed but a
  // real reading from earlier survives, and showing it with its age beats showing nothing.
  const dataState = h ? (hasError ? 'stale' : 'ok') : (hasError ? 'empty' : 'loading');

  function makeGoTo() { if (!isGoTo) { setGoToId(activeId); setToast(spot.name + ' set as your go-to spot'); } }
  function openSearch() { setSearchOpen(true); }
  function handleNav(label) {
    if (label === 'home') { setView('home'); focusSpot(goToId); setHourIdx(1); }
    else if (label === 'map') { setView('globe'); }
    else if (label === 'alerts') { setView('alerts'); }
    else if (label === 'profile') { setView('profile'); }
    else { setToast('Part of the full app — not in this preview'); }
  }
  // Jump straight to a specific spot's page — from tapping a spot in Profile's list or a
  // marker on the globe. Resets the hour like handleNav('home') does, since this is "go look
  // at this spot" rather than "step through what I'm already comparing" (see stepSpot below).
  function viewSpot(id) {
    focusSpot(id);
    setView('home');
    setHourIdx(1);
  }
  // Prev/Next arrows on a spot's own page, to browse every saved spot in order without
  // leaving Home. Wraps around in both directions; doesn't reset the hour, so stepping
  // through spots at (say) "9a" keeps comparing all of them at that same hour.
  // The arrows walk the catalog by distance from the anchor, not by the order spots happen to
  // be listed in. That list is roughly the sequence they were added, so from Lower Trestles the
  // next arrow used to go Blacks, Rincon, The Wedge, then Pipeline in Hawaii -- while nobody
  // comparing surf is asking what was entered after this one.
  // Arriving at a spot deliberately -- search, the globe, your go-to, adding one -- moves the
  // point the arrows measure "nearby" from. Stepping with the arrows does not, which is what
  // keeps the sequence stable and reversible while you walk it.
  function focusSpot(id) { setActiveId(id); setNavAnchorId(id); }

  function stepSpot(delta) {
    const next = stepNearest(spots, order, navAnchorId, activeId, delta);
    if (next) setActiveId(next);
  }

  function openNewAlert() {
    setAlertDraft({ spotId: goToId, minWaveFt: 3, leadTime: '1d' });
    setAlertSheetOpen(true);
  }
  function closeAlertSheet() { setAlertSheetOpen(false); setAlertDraft(null); }
  function saveAlert() {
    if (!alertDraft) return;
    const next = [...alerts, { id: 'alert-' + Date.now(), ...alertDraft }];
    setAlerts(next);
    persistAlerts(next);
    closeAlertSheet();
  }
  function deleteAlert(id) {
    const next = alerts.filter((a) => a.id !== id);
    setAlerts(next);
    persistAlerts(next);
  }

  function closeSearch() { setSearchOpen(false); setSearchStep('query'); setSearchQuery(''); setSearchError(''); setPending(null); }
  async function runSearch() {
    const q = searchQuery.trim();
    if (!q) return;
    // Look in the catalog before geocoding. This sheet only ever geocoded, which was fine when
    // the built-in list was a few dozen spots you could scroll — with 317 there is otherwise no
    // way to find one by name, and searching "Pipeline" would offer to add a *second* Pipeline
    // as a custom spot rather than taking you to the one already here.
    const found = searchCatalog(spots, q);
    if (found.length) { setSearchMatches(found); setSearchStep('matches'); return; }
    setSearchMatches([]);
    setSearchStep('loading');
    try {
      const place = await geocodePlace(searchQuery.trim());
      let offshoreDeg = 0, guessed = true;
      try { offshoreDeg = await findOffshoreDirection(place.lat, place.lon); } catch { guessed = false; }
      setPending({ ...place, offshoreDeg, guessed });
      setSearchStep('confirm');
    } catch {
      setSearchError("Couldn't find that place — try a different spelling.");
      setSearchStep('error');
    }
  }
  function selectSearchMatch(id) {
    focusSpot(id);
    setView('home');
    setSearchOpen(false);
    setSearchStep('query');
    setSearchQuery('');
    setSearchMatches([]);
  }
  function searchAnywayAsNewPlace() {
    setSearchMatches([]);
    setSearchStep('query');
  }
  function nudge(delta) { setPending((prev) => prev && ({ ...prev, offshoreDeg: (prev.offshoreDeg + delta + 360) % 360 })); }
  async function confirmAddSpot() {
    if (!pending) return;
    const id = 'custom-' + Date.now();
    const newSpot = {
      id, name: pending.name, region: pending.region || 'Added spot',
      blurb: pending.guessed ? 'Offshore direction estimated from the coastline shape.' : "Coastline not found nearby — direction wasn't auto-detected, adjust if it looks off.",
      lat: pending.lat, lon: pending.lon, offshoreDeg: pending.offshoreDeg,
    };
    setSpots((prev) => ({ ...prev, [id]: newSpot }));
    setOrder((prev) => [...prev, id]);
    focusSpot(id);
    closeSearch();
    loadSpotData(id, newSpot);
    if (!onboarded) completeOnboarding(id);
    try {
      let existing = [];
      try { const res = await storage.get('surf-spots'); existing = res && res.value ? JSON.parse(res.value) : []; } catch { existing = []; }
      existing.push(newSpot);
      await storage.set('surf-spots', JSON.stringify(existing));
    } catch { /* saving is best-effort */ }
  }

  function setGoToSpot(id) {
    setGoToId(id);
    const s = spots[id];
    if (s) setToast(s.name + ' set as your go-to spot');
  }

  async function removeSpot(id) {
    if (order.length <= 1) { setToast('Keep at least one spot'); return; }
    const nextOrder = order.filter((oid) => oid !== id);
    setOrder(nextOrder);
    setSpots((prev) => { const next = { ...prev }; delete next[id]; return next; });
    if (activeId === id) focusSpot(nextOrder[0]);
    if (goToId === id) setGoToId(nextOrder[0]);
    try {
      const res = await storage.get('surf-spots');
      const existing = res && res.value ? JSON.parse(res.value) : [];
      const next = existing.filter((s) => s.id !== id);
      await storage.set('surf-spots', JSON.stringify(next));
    } catch { /* best-effort */ }
  }

  // The app fills the device, rather than drawing a picture of one.
  //
  // What used to be here was the original chat-to-code mockup's shell: a beige page, a 6px
  // bezel with 44px corners, and a painted "9:41" status bar with fake signal and battery
  // glyphs. On a phone that cost about an eighth of the width and a tenth of the height, and
  // sat the fake clock directly above the real one; on a desktop the app was 28% of the
  // window and the rest was beige. index.html has always carried viewport-fit=cover and
  // apple-mobile-web-app-status-bar-style=black-translucent, so the app was built to go
  // edge to edge — the frame was the only thing stopping it.
  //
  // The safe-area insets are what replaces the painted bar: real space for the real status
  // bar and the home indicator, on the devices that have them, and zero elsewhere.
  return (
    <div className="min-h-screen w-full flex justify-center" style={{ background: COLORS.navy }}>
      <style>{GLOBAL_CSS}</style>
      <div className="relative overflow-hidden" style={{ width: '100%', maxWidth: 480, height: '100dvh', background: COLORS.navy, fontFamily: 'Inter, sans-serif', display: 'flex', flexDirection: 'column' }}>

        {/* Only this scrolls. The nav below stays put, which it did not when the whole frame
            was one scrolling column and a tall spot page pushed it off the bottom. */}
        <div className="no-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        {!onboarded ? (
          onboardingGlobeOpen ? (
            <Suspense fallback={<GlobeLoading />}>
              <Globe order={order} dataRef={dataRef} onClose={closeOnboardingGlobe} onSelectSpot={pickOnboardingSpotFromGlobe}
                title="Pick your go-to spot" hint="Tap a marker to set it as your go-to spot · drag to rotate, pinch or scroll to zoom" />
            </Suspense>
          ) : (
            <OnboardingView spots={spots} activeId={activeId} pickOnboardingSpot={pickOnboardingSpot} openSearch={openSearch} openGlobePicker={openOnboardingGlobe} completeOnboarding={completeOnboarding}
              onLoggedIn={handleLoginResult} setToast={setToast} />
          )
        ) : view === 'globe' ? (
          <Suspense fallback={<GlobeLoading />}>
            <Globe order={order} dataRef={dataRef} onClose={() => handleNav('home')} onSelectSpot={viewSpot} units={units} />
          </Suspense>
        ) : view === 'alerts' ? (
          <AlertsView alerts={alerts} spots={spots} units={units} checkAlertMatch={(alert) => checkAlertMatch(alert, forecast[alert.spotId])} openNewAlert={openNewAlert} deleteAlert={deleteAlert} onClose={() => handleNav('home')} />
        ) : view === 'profile' ? (
          <ProfileView order={order} spots={spots} goToId={goToId} setGoToSpot={setGoToSpot} units={units} toggleUnits={toggleUnits} alerts={alerts} openAlerts={() => handleNav('alerts')} removeSpot={removeSpot} onClose={() => handleNav('home')} onSelectSpot={viewSpot}
            pushSupported={isPushSupported()} pushSubscribed={!!pushSubscription} pushBusy={pushBusy} togglePush={togglePush}
            session={session} onLoggedIn={handleLoginResult} onLogOut={handleLogOut} setToast={setToast}
            sessions={sessions} deleteSession={deleteSession} />
        ) : (
          <HomeView
            units={units} toggleUnits={toggleUnits} openSearch={openSearch} openMenu={() => setMenuOpen(true)}
            spot={spot} isGoTo={isGoTo} makeGoTo={makeGoTo} showSpotNav={order.length > 1} onPrevSpot={() => stepSpot(-1)} onNextSpot={() => stepSpot(1)}
            h={h} dataState={dataState} fetchedAt={spotForecast ? spotForecast.fetchedAt : null} retry={() => loadSpotData(activeId, spot)}
            waveChart={waveChart} hourIdx={safeHourIdx} setHourIdx={setHourIdx} hourData={hourData}
            best={spotForecast ? spotForecast.best : null}
            waterC={spotForecast ? spotForecast.waterC : null} wetsuit={spotForecast ? spotForecast.wetsuit : null}
            agreement={agreement[activeId] || null}
            buoy={buoy[activeId] || null}
            onLogSession={logSession} calibration={spotCalibration}
            activeId={activeId} contData={contData} contWaveLine={contWaveLine} contTideLine={contTideLine} contWindLine={contWindLine}
            contSelected={contSelected} contSelectedIdx={contSelectedIdx} setContSelectedIdx={setContSelectedIdx}
            tideToday={tideToday} tide={tide} tideNext={tideNext}
          />
        )}
        </div>

        <div style={{ position: 'relative', height: 0 }}>
          {toast && (
            <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', bottom: 74, background: 'rgba(8,20,31,0.94)', color: COLORS.foam, fontSize: 12, padding: '9px 16px', borderRadius: 999, whiteSpace: 'nowrap', boxShadow: '0 8px 20px rgba(0,0,0,0.3)', zIndex: 5 }}>
              {toast}
            </div>
          )}
        </div>

        {onboarded && <BottomNav view={view} handleNav={handleNav} />}

        {menuOpen && (
          <NavDrawer
            spots={spots} order={order} goToId={goToId} activeId={activeId}
            onSelectSpot={viewSpot} openSearch={openSearch} onNavigate={handleNav}
            units={units} toggleUnits={toggleUnits} alertCount={alerts.length}
            onClose={() => setMenuOpen(false)}
          />
        )}

        {searchOpen && (
          <SearchSheet
            searchQuery={searchQuery} setSearchQuery={setSearchQuery} runSearch={runSearch}
            searchStep={searchStep} setSearchStep={setSearchStep} searchError={searchError}
            pending={pending} setPending={setPending} nudge={nudge} confirmAddSpot={confirmAddSpot}
            matches={searchMatches} onSelectMatch={selectSearchMatch} onSearchAnyway={searchAnywayAsNewPlace}
            onClose={closeSearch}
          />
        )}

        {alertSheetOpen && alertDraft && (
          <AlertSheet order={order} spots={spots} alertDraft={alertDraft} setAlertDraft={setAlertDraft} units={units} saveAlert={saveAlert} onClose={closeAlertSheet} />
        )}
      </div>
    </div>
  );
}
