import { Search, Map } from 'lucide-react';
import { COLORS } from '../lib/colors.js';
import { SPOTS, ONBOARDING_PICKS } from '../lib/spots.js';
import { isAuthConfigured } from '../lib/auth.js';
import { AuthButtons } from './AuthButtons.jsx';

export function OnboardingView({ activeId, pickOnboardingSpot, openSearch, openGlobePicker, completeOnboarding, onLoggedIn, setToast }) {
  return (
    <div style={{ padding: '26px 24px 24px' }}>
      <div style={{ textAlign: 'center', marginBottom: 26 }}>
        <div style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, fontSize: 20, color: COLORS.foam, letterSpacing: '0.1em' }}>SURFCAST</div>
        <div style={{ fontSize: 13, color: COLORS.foamDim, marginTop: 12, lineHeight: 1.5 }}>Pick your go-to spot. It's the first thing you'll see every time you open the app.</div>
      </div>

      {isAuthConfigured() && (
        <div style={{ marginBottom: 22 }}>
          <AuthButtons onLoggedIn={onLoggedIn} setToast={setToast} />
          <div className="flex items-center" style={{ gap: 10, margin: '16px 0' }}>
            <div style={{ flex: 1, height: 1, background: COLORS.navyBorder }} />
            <span style={{ fontSize: 10.5, color: COLORS.foamDim, letterSpacing: '0.06em' }}>OR PICK MANUALLY</span>
            <div style={{ flex: 1, height: 1, background: COLORS.navyBorder }} />
          </div>
        </div>
      )}

      <div style={{ fontSize: 10, color: COLORS.foamDim, letterSpacing: '0.08em', fontWeight: 600, marginBottom: 10 }}>POPULAR SPOTS</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
        {ONBOARDING_PICKS.map((id) => {
          const s = SPOTS[id];
          if (!s) return null;
          return (
            <button key={id} className="tl-btn" onClick={() => pickOnboardingSpot(id)}
              style={{ background: COLORS.navyCard, border: '1px solid ' + COLORS.navyBorder, borderRadius: 10, padding: '12px 14px', textAlign: 'left' }}>
              <div style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 600, fontSize: 14, color: COLORS.foam }}>{s.name}</div>
              <div style={{ fontSize: 11, color: COLORS.foamDim, marginTop: 1 }}>{s.region}</div>
            </button>
          );
        })}
      </div>

      <div className="flex" style={{ gap: 8 }}>
        <button className="tl-btn flex items-center justify-center" onClick={openSearch}
          style={{ flex: 1, gap: 6, background: 'none', border: '1px solid ' + COLORS.navyBorder, borderRadius: 10, padding: '11px 0', color: COLORS.tealBright, fontWeight: 700, fontSize: 12.5 }}>
          <Search size={14} /> Search by name
        </button>
        <button className="tl-btn flex items-center justify-center" onClick={openGlobePicker}
          style={{ flex: 1, gap: 6, background: 'none', border: '1px solid ' + COLORS.navyBorder, borderRadius: 10, padding: '11px 0', color: COLORS.tealBright, fontWeight: 700, fontSize: 12.5 }}>
          <Map size={14} /> Browse the globe
        </button>
      </div>
      <button className="tl-btn" onClick={() => completeOnboarding(activeId)} style={{ width: '100%', marginTop: 14, background: 'none', border: 'none', color: COLORS.foamDim, fontSize: 12, padding: '6px 0' }}>
        Skip for now
      </button>
    </div>
  );
}
