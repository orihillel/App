import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { storage } from './lib/storage.js';
import { COLORS } from './lib/colors.js';
import { SPOTS, ORDER } from './lib/spots.js';
import { fetchSpotForecast, geocodePlace, findOffshoreDirection } from './lib/forecast.js';
import { linePath, waveAvg } from './lib/format.js';
import { PLACEHOLDER_HOURS, PLACEHOLDER_TIDE_TODAY, PLACEHOLDER_TIDE_NEXT, PLACEHOLDER_CONTINUOUS, nextTideEvent } from './lib/placeholders.js';
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

const GLOBAL_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500;600;700&display=swap');
.no-scrollbar::-webkit-scrollbar { display: none; }
.no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
.tl-btn { cursor: pointer; }
.tl-btn:focus-visible { outline: 2px solid #F4F7F6; outline-offset: 2px; border-radius: 8px; }
.tl-input:focus { outline: none; border-color: rgba(244,247,246,0.5) !important; }
.tl-label { position: absolute; pointer-events: none; transform: translate(-50%, -130%); white-space: nowrap;
  background: rgba(8,20,31,0.88); color: #F4F7F6; font-family: 'JetBrains Mono', monospace; font-size: 10px;
  padding: 3px 7px; border-radius: 8px; display: none; }
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
.min-h-screen { min-height: 100vh; }
.w-full { width: 100%; }
.grid-cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.p-6 { padding: 1.5rem; }
.px-6 { padding-left: 1.5rem; padding-right: 1.5rem; }
.px-7 { padding-left: 1.75rem; padding-right: 1.75rem; }
.pt-2 { padding-top: 0.5rem; }
.pt-4 { padding-top: 1rem; }
.pb-1 { padding-bottom: 0.25rem; }
.pb-3 { padding-bottom: 0.75rem; }
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
  const [spots, setSpots] = useState(SPOTS);
  const [order, setOrder] = useState(ORDER);
  const [activeId, setActiveId] = useState('trestles');
  const [goToId, setGoToId] = useState('trestles');
  const [hourIdx, setHourIdx] = useState(1);
  const [contSelectedIdx, setContSelectedIdx] = useState(null);
  const [toast, setToast] = useState('');
  const [forecast, setForecast] = useState({});
  const [loadingIds, setLoadingIds] = useState(() => new Set(ORDER));
  const [errorIds, setErrorIds] = useState(() => new Set());
  const [view, setView] = useState('home');

  const [searchOpen, setSearchOpen] = useState(false);
  const [onboarded, setOnboarded] = useState(true);
  // Lets onboarding borrow the same Globe used post-onboarding, so picking a go-to spot can be
  // done visually (tap a marker) instead of only by typing into search. Separate from `view`
  // since onboarding has its own gate (`!onboarded`) ahead of the normal view switch below.
  const [onboardingGlobeOpen, setOnboardingGlobeOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchStep, setSearchStep] = useState('query');
  const [searchError, setSearchError] = useState('');
  const [pending, setPending] = useState(null);

  const [alerts, setAlerts] = useState([]);
  const [alertSheetOpen, setAlertSheetOpen] = useState(false);
  const [alertDraft, setAlertDraft] = useState(null);
  const [units, setUnits] = useState('imperial');

  // Account login (Google/Meta) + cross-device sync — see src/lib/auth.js and worker/README.md.
  // Entirely optional: with no session, the app behaves exactly as it always has (local-only).
  const [session, setSession] = useState(() => getSession());

  // Read by the Globe component's animation loop so every rendered frame reflects whatever is
  // currently in `forecast`, without a separate effect keyed on [forecast, hourIdx, ...] that
  // could fall out of sync (see Globe.jsx).
  const dataRef = useRef({ spots, order, forecast, hourIdx });
  useEffect(() => { dataRef.current = { spots, order, forecast, hourIdx }; });

  const loadSpotData = useCallback(async (id, spotObj) => {
    setLoadingIds((prev) => new Set(prev).add(id));
    setErrorIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
    try {
      const result = await fetchSpotForecast(spotObj);
      setForecast((prev) => ({ ...prev, [id]: result }));
    } catch {
      setErrorIds((prev) => new Set(prev).add(id));
    } finally {
      setLoadingIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const chunkSize = 5;
      for (let i = 0; i < ORDER.length; i += chunkSize) {
        if (cancelled) return;
        const chunk = ORDER.slice(i, i + chunkSize);
        await Promise.all(chunk.map((id) => loadSpotData(id, SPOTS[id])));
      }
    })();
    return () => { cancelled = true; };
  }, [loadSpotData]);

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
    setActiveId(id);
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
  function currentAppData(overrides = {}) {
    return {
      goToId,
      customSpots: order.filter((id) => !ORDER.includes(id)).map((id) => spots[id]).filter(Boolean),
      alerts,
      units,
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

  // live feed: keep every spot's forecast current, not just a one-time fetch on open
  useEffect(() => {
    const interval = setInterval(() => {
      dataRef.current.order.forEach((id) => { loadSpotData(id, dataRef.current.spots[id]); });
    }, 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, [loadSpotData]);

  const spot = spots[activeId];
  const spotForecast = forecast[activeId];
  const hourData = (spotForecast && spotForecast.hours) || PLACEHOLDER_HOURS;
  const contData = (spotForecast && spotForecast.continuous && spotForecast.continuous.length ? spotForecast.continuous : PLACEHOLDER_CONTINUOUS);
  const contWaveLine = linePath(contData.map((p) => p.waveFt), 300, 70, 10);
  const contTideLine = linePath(contData.map((p) => (p.tideFt != null ? p.tideFt : 0)), 300, 70, 10);
  const contWindLine = linePath(contData.map((p) => (p.windSpd != null ? p.windSpd : 0)), 300, 70, 10);
  const contSelected = contSelectedIdx != null ? contData[contSelectedIdx] : null;
  // The sampled hours are no longer a fixed list of eight — a short winter day at a
  // high-latitude spot yields fewer — so an index chosen for one spot can overshoot the next.
  const safeHourIdx = Math.min(hourIdx, hourData.length - 1);
  const h = hourData[safeHourIdx];
  const isGoTo = activeId === goToId;
  const tideToday = (spotForecast && spotForecast.tideToday && spotForecast.tideToday.every((v) => v != null)) ? spotForecast.tideToday : PLACEHOLDER_TIDE_TODAY;
  const tideNext = (spotForecast && spotForecast.tideFine && spotForecast.tideFine.length) ? nextTideEvent(spotForecast.tideFine, h.hour) : PLACEHOLDER_TIDE_NEXT;
  const tide = linePath(tideToday, 100, 34, 4);
  const waveChart = linePath(hourData.map((hr) => waveAvg(hr.wave)), 300, 56, 8);
  const isLoading = loadingIds.has(activeId);
  const hasError = errorIds.has(activeId);

  function makeGoTo() { if (!isGoTo) { setGoToId(activeId); setToast(spot.name + ' set as your go-to spot'); } }
  function openSearch() { setSearchOpen(true); }
  function handleNav(label) {
    if (label === 'home') { setView('home'); setActiveId(goToId); setHourIdx(1); }
    else if (label === 'map') { setView('globe'); }
    else if (label === 'alerts') { setView('alerts'); }
    else if (label === 'profile') { setView('profile'); }
    else { setToast('Part of the full app — not in this preview'); }
  }
  // Jump straight to a specific spot's page — from tapping a spot in Profile's list or a
  // marker on the globe. Resets the hour like handleNav('home') does, since this is "go look
  // at this spot" rather than "step through what I'm already comparing" (see stepSpot below).
  function viewSpot(id) {
    setActiveId(id);
    setView('home');
    setHourIdx(1);
  }
  // Prev/Next arrows on a spot's own page, to browse every saved spot in order without
  // leaving Home. Wraps around in both directions; doesn't reset the hour, so stepping
  // through spots at (say) "9a" keeps comparing all of them at that same hour.
  function stepSpot(delta) {
    const i = order.indexOf(activeId);
    const next = order[(i + delta + order.length) % order.length];
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
    if (!searchQuery.trim()) return;
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
    setActiveId(id);
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
    if (activeId === id) setActiveId(nextOrder[0]);
    if (goToId === id) setGoToId(nextOrder[0]);
    try {
      const res = await storage.get('surf-spots');
      const existing = res && res.value ? JSON.parse(res.value) : [];
      const next = existing.filter((s) => s.id !== id);
      await storage.set('surf-spots', JSON.stringify(next));
    } catch { /* best-effort */ }
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-6" style={{ background: '#E9E7DF' }}>
      <style>{GLOBAL_CSS}</style>
      <div className="relative overflow-hidden" style={{ width: '100%', maxWidth: 390, borderRadius: 44, background: COLORS.navy, border: '6px solid #08141F', boxShadow: '0 30px 60px -20px rgba(11,28,46,0.45)', fontFamily: 'Inter, sans-serif' }}>

        <div className="flex justify-between items-center px-7 pt-4 pb-1" style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: COLORS.foam, opacity: 0.85 }}>
          <span>9:41</span>
          <div className="flex items-center" style={{ gap: 4 }}>
            <div className="flex items-end" style={{ gap: 2 }}>
              <div style={{ width: 3, height: 4, background: COLORS.foam, borderRadius: 1 }} />
              <div style={{ width: 3, height: 6, background: COLORS.foam, borderRadius: 1 }} />
              <div style={{ width: 3, height: 8, background: COLORS.foam, borderRadius: 1 }} />
              <div style={{ width: 3, height: 10, background: COLORS.foam, borderRadius: 1 }} />
            </div>
            <div style={{ width: 20, height: 10, border: '1.5px solid ' + COLORS.foam, borderRadius: 3, padding: 1.5, marginLeft: 3 }}>
              <div style={{ width: '70%', height: '100%', background: COLORS.foam, borderRadius: 1 }} />
            </div>
          </div>
        </div>

        {!onboarded ? (
          onboardingGlobeOpen ? (
            <Suspense fallback={<GlobeLoading />}>
              <Globe order={order} dataRef={dataRef} onClose={closeOnboardingGlobe} onSelectSpot={pickOnboardingSpotFromGlobe}
                title="Pick your go-to spot" hint="Tap a marker to set it as your go-to spot · drag to rotate, pinch or scroll to zoom" />
            </Suspense>
          ) : (
            <OnboardingView activeId={activeId} pickOnboardingSpot={pickOnboardingSpot} openSearch={openSearch} openGlobePicker={openOnboardingGlobe} completeOnboarding={completeOnboarding}
              onLoggedIn={handleLoginResult} setToast={setToast} />
          )
        ) : view === 'globe' ? (
          <Suspense fallback={<GlobeLoading />}>
            <Globe order={order} dataRef={dataRef} onClose={() => handleNav('home')} onSelectSpot={viewSpot} />
          </Suspense>
        ) : view === 'alerts' ? (
          <AlertsView alerts={alerts} spots={spots} units={units} checkAlertMatch={(alert) => checkAlertMatch(alert, forecast[alert.spotId])} openNewAlert={openNewAlert} deleteAlert={deleteAlert} onClose={() => handleNav('home')} />
        ) : view === 'profile' ? (
          <ProfileView order={order} spots={spots} goToId={goToId} setGoToSpot={setGoToSpot} units={units} toggleUnits={toggleUnits} alerts={alerts} openAlerts={() => handleNav('alerts')} removeSpot={removeSpot} onClose={() => handleNav('home')} onSelectSpot={viewSpot}
            pushSupported={isPushSupported()} pushSubscribed={!!pushSubscription} pushBusy={pushBusy} togglePush={togglePush}
            session={session} onLoggedIn={handleLoginResult} onLogOut={handleLogOut} setToast={setToast} />
        ) : (
          <HomeView
            setToast={setToast} units={units} toggleUnits={toggleUnits} openSearch={openSearch}
            spot={spot} isGoTo={isGoTo} makeGoTo={makeGoTo} showSpotNav={order.length > 1} onPrevSpot={() => stepSpot(-1)} onNextSpot={() => stepSpot(1)}
            h={h} isLoading={isLoading} hasError={hasError} retry={() => loadSpotData(activeId, spot)}
            waveChart={waveChart} hourIdx={safeHourIdx} setHourIdx={setHourIdx} hourData={hourData}
            best={spotForecast ? spotForecast.best : null}
            activeId={activeId} contData={contData} contWaveLine={contWaveLine} contTideLine={contTideLine} contWindLine={contWindLine}
            contSelected={contSelected} contSelectedIdx={contSelectedIdx} setContSelectedIdx={setContSelectedIdx}
            tideToday={tideToday} tide={tide} tideNext={tideNext}
          />
        )}

        <div style={{ position: 'relative', height: 0 }}>
          {toast && (
            <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', bottom: 74, background: 'rgba(8,20,31,0.94)', color: COLORS.foam, fontSize: 12, padding: '9px 16px', borderRadius: 999, whiteSpace: 'nowrap', boxShadow: '0 8px 20px rgba(0,0,0,0.3)', zIndex: 5 }}>
              {toast}
            </div>
          )}
        </div>

        {onboarded && <BottomNav view={view} handleNav={handleNav} />}

        {searchOpen && (
          <SearchSheet
            searchQuery={searchQuery} setSearchQuery={setSearchQuery} runSearch={runSearch}
            searchStep={searchStep} setSearchStep={setSearchStep} searchError={searchError}
            pending={pending} setPending={setPending} nudge={nudge} confirmAddSpot={confirmAddSpot}
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
