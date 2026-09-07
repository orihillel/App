import { Home, Map, Bell, User } from 'lucide-react';
import { COLORS } from '../lib/colors.js';

// The bar is outside the scrolling column now (see App.jsx), so it stays put instead of being
// pushed off the bottom by a tall spot page.
//
// Each button is 44x44 rather than 32x35. The icon is the same size it always was — the hit
// area grew around it, which is the whole change. An audit of the running app found every one
// of its 21 interactive elements under 44x44; this is the floor Apple's HIG asks for and what
// WCAG 2.5.5 wants, and it matters more here than in most apps because the person tapping is
// often doing it with cold wet hands in bright sun.
const TAP = {
  background: 'none', border: 'none', padding: 0,
  minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center',
};

export function BottomNav({ view, handleNav }) {
  const items = [
    [Home, 'Home', 'home', view === 'home'],
    [Map, 'Globe', 'map', view === 'globe'],
    [Bell, 'Alerts', 'alerts', view === 'alerts'],
    [User, 'Profile', 'profile', view === 'profile'],
  ];
  return (
    <div
      className="flex justify-around items-center"
      style={{
        flexShrink: 0, padding: '6px 16px', borderTop: '1px solid ' + COLORS.foamFaint,
        background: COLORS.navy,
        // Real room for the home indicator on the phones that have one, nothing on the ones
        // that don't — this is what the painted status bar was pretending to account for.
        paddingBottom: 'calc(10px + env(safe-area-inset-bottom, 8px))',
      }}
    >
      {items.map(([Icon, label, target, active]) => (
        <button key={label} className="tl-btn" style={TAP} onClick={() => handleNav(target)} aria-label={label} aria-current={active ? 'page' : undefined}>
          <Icon size={22} color={active ? COLORS.coral : COLORS.foamDim} />
        </button>
      ))}
    </div>
  );
}
