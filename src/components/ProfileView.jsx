import React from 'react';
import { X } from 'lucide-react';
import { COLORS } from '../lib/colors.js';
import { ORDER as SEED_ORDER } from '../lib/spots.js';

export function ProfileView({ order, spots, goToId, setGoToSpot, units, toggleUnits, alerts, openAlerts, removeSpot, onClose }) {
  return (
    <div>
      <div className="flex justify-between items-center px-6 pt-2 pb-3">
        <span style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, fontSize: 17, color: COLORS.foam }}>Profile</span>
        <button className="tl-btn" onClick={onClose} style={{ background: 'none', border: 'none', padding: 6 }} aria-label="Close profile"><X size={18} color={COLORS.foamDim} /></button>
      </div>

      <div style={{ padding: '0 20px' }}>
        <div style={{ fontSize: 10, color: COLORS.foamDim, letterSpacing: '0.08em', fontWeight: 600, marginBottom: 8 }}>GO-TO SPOT</div>
        <div className="flex overflow-x-auto no-scrollbar" style={{ gap: 8, marginBottom: 18 }}>
          {order.map((id) => {
            const s = spots[id];
            if (!s) return null;
            const isGo = id === goToId;
            return (
              <button key={id} className="tl-btn" onClick={() => setGoToSpot(id)}
                style={{ background: isGo ? COLORS.tealBright : COLORS.navyCard, color: isGo ? COLORS.navy : COLORS.foam, border: '1px solid ' + (isGo ? COLORS.tealBright : COLORS.navyBorder), borderRadius: 999, padding: '7px 13px', fontSize: 12.5, fontWeight: 600, flexShrink: 0, whiteSpace: 'nowrap' }}>
                {s.name}
              </button>
            );
          })}
        </div>

        <div style={{ fontSize: 10, color: COLORS.foamDim, letterSpacing: '0.08em', fontWeight: 600, marginBottom: 8 }}>UNITS</div>
        <div className="flex" style={{ gap: 8, marginBottom: 18 }}>
          <button className="tl-btn" onClick={() => { if (units !== 'imperial') toggleUnits(); }}
            style={{ flex: 1, background: units === 'imperial' ? COLORS.tealBright : COLORS.navyCard, color: units === 'imperial' ? COLORS.navy : COLORS.foam, border: '1px solid ' + (units === 'imperial' ? COLORS.tealBright : COLORS.navyBorder), borderRadius: 8, padding: '9px 0', fontSize: 12.5, fontWeight: 600 }}>
            Feet · mph
          </button>
          <button className="tl-btn" onClick={() => { if (units !== 'metric') toggleUnits(); }}
            style={{ flex: 1, background: units === 'metric' ? COLORS.tealBright : COLORS.navyCard, color: units === 'metric' ? COLORS.navy : COLORS.foam, border: '1px solid ' + (units === 'metric' ? COLORS.tealBright : COLORS.navyBorder), borderRadius: 8, padding: '9px 0', fontSize: 12.5, fontWeight: 600 }}>
            Meters · kph
          </button>
        </div>

        <div style={{ fontSize: 10, color: COLORS.foamDim, letterSpacing: '0.08em', fontWeight: 600, marginBottom: 8 }}>ALERTS</div>
        <button className="tl-btn" onClick={openAlerts} style={{ width: '100%', background: COLORS.navyCard, border: '1px solid ' + COLORS.navyBorder, borderRadius: 10, padding: '11px 13px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <span style={{ fontSize: 13, color: COLORS.foam }}>{alerts.length} active alert{alerts.length === 1 ? '' : 's'}</span>
          <span style={{ fontSize: 11, color: COLORS.tealBright, fontWeight: 600 }}>Manage →</span>
        </button>

        <div style={{ fontSize: 10, color: COLORS.foamDim, letterSpacing: '0.08em', fontWeight: 600, marginBottom: 8 }}>YOUR SPOTS ({order.length})</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 18 }}>
          {order.map((id) => {
            const s = spots[id];
            if (!s) return null;
            const isSeed = SEED_ORDER.includes(id);
            return (
              <div key={id} className="flex items-center justify-between" style={{ background: COLORS.navyCard, border: '1px solid ' + COLORS.navyBorder, borderRadius: 10, padding: '9px 12px' }}>
                <div>
                  <div style={{ fontSize: 13, color: COLORS.foam, fontWeight: 600 }}>{s.name}{id === goToId && <span style={{ color: COLORS.tealBright }}> ★</span>}</div>
                  <div style={{ fontSize: 10.5, color: COLORS.foamDim, marginTop: 1 }}>{s.region}</div>
                </div>
                {isSeed ? (
                  <span style={{ fontSize: 9.5, color: COLORS.foamDim, letterSpacing: '0.04em' }}>BUILT-IN</span>
                ) : (
                  <button className="tl-btn" onClick={() => removeSpot(id)} style={{ background: 'none', border: 'none', padding: 4 }} aria-label={'Remove ' + s.name}><X size={15} color={COLORS.foamDim} /></button>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ fontSize: 10, color: COLORS.foamDim, letterSpacing: '0.08em', fontWeight: 600, marginBottom: 8 }}>DATA</div>
        <div style={{ fontSize: 11, color: COLORS.foamDim, lineHeight: 1.6, paddingBottom: 20 }}>
          Wave, swell, wind, and tide data from Open-Meteo's Marine and Weather APIs. Tide is modeled sea-level height, not an official chart-datum tide table — timing is a good guide, but exact heights may not match a nautical almanac.
        </div>
      </div>
    </div>
  );
}
