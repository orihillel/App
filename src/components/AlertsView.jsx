import React from 'react';
import { X } from 'lucide-react';
import { COLORS } from '../lib/colors.js';
import { formatWaveNum, heightUnit, leadTimeLabel } from '../lib/format.js';

export function AlertsView({ alerts, spots, units, checkAlertMatch, openNewAlert, deleteAlert, onClose }) {
  return (
    <div>
      <div className="flex justify-between items-center px-6 pt-2 pb-3">
        <span style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, fontSize: 17, color: COLORS.foam }}>Alerts</span>
        <button className="tl-btn" onClick={onClose} style={{ background: 'none', border: 'none', padding: 6 }} aria-label="Close alerts"><X size={18} color={COLORS.foamDim} /></button>
      </div>
      <div style={{ padding: '0 20px 12px' }}>
        <button className="tl-btn" onClick={openNewAlert} style={{ width: '100%', background: COLORS.tealBright, border: 'none', borderRadius: 12, padding: '11px 13px', color: COLORS.navy, fontWeight: 700, fontSize: 14 }}>+ New alert</button>
      </div>
      <div style={{ padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {alerts.length === 0 && (
          <div style={{ fontSize: 12.5, color: COLORS.foamDim, padding: '10px 2px', lineHeight: 1.5 }}>No alerts yet. Pick a spot, a minimum wave height, and how far ahead you want the heads-up.</div>
        )}
        {alerts.map((a) => {
          const s = spots[a.spotId];
          const match = checkAlertMatch(a);
          return (
            <div key={a.id} style={{ background: COLORS.navyCard, border: '1px solid ' + COLORS.navyBorder, borderRadius: 10, padding: '12px 14px' }}>
              <div className="flex items-start justify-between">
                <div>
                  <div style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 600, fontSize: 14, color: COLORS.foam }}>{s ? s.name : 'Unknown spot'}</div>
                  <div style={{ fontSize: 11.5, color: COLORS.foamDim, marginTop: 2 }}>{leadTimeLabel(a.leadTime)} · {formatWaveNum(a.minWaveFt, units)}{heightUnit(units)}+</div>
                </div>
                <button className="tl-btn" onClick={() => deleteAlert(a.id)} style={{ background: 'none', border: 'none', padding: 4 }}><X size={15} color={COLORS.foamDim} /></button>
              </div>
              <div style={{ fontSize: 11.5, color: match && match.hit ? COLORS.tealBright : COLORS.foamDim, marginTop: 8, fontWeight: match && match.hit ? 600 : 400 }}>
                {match ? match.text : 'Waiting for forecast data…'}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ padding: '14px 20px 4px', fontSize: 10.5, color: COLORS.foamDim, lineHeight: 1.5 }}>
        This checks live forecast data while you have the app open and shows you what would match. Actual push notifications when the app is closed need a real backend — that's Claude Code territory, not this preview.
      </div>
    </div>
  );
}
