import { useEffect, useRef } from 'react';
import { X, Search, Globe2, Bell, User, MapPin, Plus, Star } from 'lucide-react';
import { COLORS } from '../lib/colors.js';
import { SPOTS, ORDER as SEED_ORDER } from '../lib/spots.js';

// The navigation drawer behind the header's hamburger.
//
// The button has been there since the original mockup and did nothing but raise a toast that
// said so. What belongs behind it was decided by looking at what Surfline, Magic Seaweed and
// Windy all put in theirs, and keeping only the entries this app can actually honour:
//
//   - every one of them opens on saved spots. Surfline calls them Favorites, Windy calls them
//     Favourites, and it is the first thing in both;
//   - all three carry search, a map, units, and an account/settings door;
//   - Surfline adds alerts and sessions; Windy adds an about/credits line.
//
// What is deliberately *not* here: cams, premium tiers, photo feeds, editorial and travel
// booking. Those are the parts of those menus that exist because those apps sell something.
// A menu entry that opens a "not in this preview" toast is worse than no entry at all — that
// is exactly what this replaces.
//
// "Your spots" needs one clarification, because the app's own model differs from Surfline's.
// `order` is not a favourites list: it starts as the whole built-in catalog, so listing it
// here would be four hundred rows of "yours" that you never chose. What is genuinely yours is
// the go-to spot and anything you searched for and added, which is what this shows — the same
// distinction ProfileView already draws.
// Substituted by Vite at build time; the fallbacks keep the component renderable anywhere the
// define is not applied, such as a bare unit-test runner.
const buildId = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';
const buildDate = typeof __BUILD_DATE__ === 'string' ? __BUILD_DATE__ : 'local';

export function NavDrawer({
  spots, order, goToId, activeId, onSelectSpot, openSearch, onNavigate,
  units, toggleUnits, alertCount = 0, onClose,
}) {
  const panel = useRef(null);

  useEffect(() => {
    // Escape closes, as it does for any dialog, and focus moves into the drawer so a keyboard
    // or screen-reader user is not left behind on the page underneath.
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    if (panel.current) panel.current.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const added = order.filter((id) => spots[id] && !SEED_ORDER.includes(id));
  const yours = [goToId, ...added.filter((id) => id !== goToId)].filter((id) => spots[id]);
  const catalogSize = Object.keys(SPOTS).length;
  const countries = new Set(Object.values(SPOTS).map((s) => s.region.split(',').pop().trim())).size;

  const go = (fn) => () => { onClose(); fn(); };

  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(5,12,20,0.6)', display: 'flex', zIndex: 12 }}>
      <div
        ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Menu"
        onClick={(e) => e.stopPropagation()}
        className="no-scrollbar"
        style={{
          width: '86%', maxWidth: 320, height: '100%', background: COLORS.navy,
          borderRight: '1px solid ' + COLORS.navyBorder, overflowY: 'auto', outline: 'none',
          boxShadow: '18px 0 40px -12px rgba(0,0,0,0.55)',
        }}
      >
        <div className="flex items-center justify-between px-6" style={{ paddingTop: 18, paddingBottom: 16 }}>
          <span style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 600, fontSize: 13, letterSpacing: '0.14em', color: COLORS.foam }}>SURFCAST</span>
          <button className="tl-btn" onClick={onClose} aria-label="Close menu" style={{ background: 'none', border: 'none', padding: 0, minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <X size={22} color={COLORS.foamDim} />
          </button>
        </div>

        <div style={{ padding: '0 20px 26px' }}>
          <Heading>YOUR SPOTS</Heading>
          {yours.map((id) => (
            <Row
              key={id}
              icon={id === goToId ? <Star size={15} color={COLORS.tealBright} /> : <MapPin size={15} color={COLORS.foamDim} />}
              label={spots[id].name}
              sub={spots[id].region}
              trailing={id === goToId ? 'GO-TO' : null}
              active={id === activeId}
              onClick={go(() => onSelectSpot(id))}
            />
          ))}
          {added.length === 0 && (
            <div style={{ fontSize: 11, color: COLORS.foamDim, lineHeight: 1.45, margin: '2px 0 8px' }}>
              Search for anywhere on the coast and it joins this list.
            </div>
          )}
          <Row icon={<Plus size={15} color={COLORS.tealBright} />} label="Add a spot" onClick={go(openSearch)} />

          <Heading>EXPLORE</Heading>
          <Row icon={<Search size={15} color={COLORS.foamDim} />} label="Search spots" onClick={go(openSearch)} />
          <Row
            icon={<Globe2 size={15} color={COLORS.foamDim} />}
            label="Globe" sub={catalogSize + ' spots in ' + countries + ' countries'}
            onClick={go(() => onNavigate('map'))}
          />

          <Heading>PLAN</Heading>
          <Row
            icon={<Bell size={15} color={COLORS.foamDim} />}
            label="Alerts" sub={alertCount ? alertCount + ' active' : 'None set yet'}
            onClick={go(() => onNavigate('alerts'))}
          />

          <Heading>SETTINGS</Heading>
          <div className="flex" style={{ gap: 8, marginBottom: 10 }}>
            {[['imperial', 'Feet · mph'], ['metric', 'Meters · kph']].map(([value, label]) => (
              <button
                key={value} className="tl-btn" onClick={() => { if (units !== value) toggleUnits(); }}
                aria-pressed={units === value}
                style={{
                  flex: 1, background: units === value ? COLORS.tealBright : COLORS.navyCard,
                  color: units === value ? COLORS.navy : COLORS.foam,
                  border: '1px solid ' + (units === value ? COLORS.tealBright : COLORS.navyBorder),
                  borderRadius: 8, minHeight: 44, fontSize: 14, fontWeight: 600,
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <Row
            icon={<User size={15} color={COLORS.foamDim} />}
            label="Profile" sub="Account, sessions, notifications"
            onClick={go(() => onNavigate('profile'))}
          />

          {/* The build on screen. Three separate changes have been reported as "not working"
              when the real answer was that they had not been merged and deployed yet, and
              nothing in the app could tell those two apart. This can. */}
          <div style={{ borderTop: '1px solid ' + COLORS.navyBorder, marginTop: 18, paddingTop: 14, fontSize: 10, color: COLORS.foamDim, lineHeight: 1.6 }}>
            <div>Forecast by Open-Meteo · coastline by Natural Earth</div>
            <div>{'Build ' + buildId + ' · ' + buildDate}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Heading({ children }) {
  return (
    <div style={{ fontSize: 12, color: COLORS.foamDim, letterSpacing: '0.08em', fontWeight: 600, margin: '18px 0 8px' }}>
      {children}
    </div>
  );
}

function Row({ icon, label, sub, trailing, active, onClick }) {
  return (
    <button
      className="tl-btn w-full" onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 11, width: '100%', textAlign: 'left',
        background: active ? COLORS.navyCard : 'none',
        border: '1px solid ' + (active ? COLORS.navyBorder : 'transparent'),
        borderRadius: 10, minHeight: 48, padding: '0 10px', marginBottom: 2,
      }}
    >
      <span style={{ flexShrink: 0, display: 'flex' }}>{icon}</span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: 'block', fontSize: 15, color: COLORS.foam, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        {sub && <span style={{ display: 'block', fontSize: 12.5, color: COLORS.foamDim, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</span>}
      </span>
      {trailing && (
        <span style={{ flexShrink: 0, fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: COLORS.tealBright }}>{trailing}</span>
      )}
    </button>
  );
}
