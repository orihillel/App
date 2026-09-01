import { X } from 'lucide-react';
import { COLORS } from '../lib/colors.js';
import { formatWaveNum, heightUnit, leadTimeLabel } from '../lib/format.js';

export function AlertSheet({ order, spots, alertDraft, setAlertDraft, units, saveAlert, onClose }) {
  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(5,12,20,0.6)', display: 'flex', alignItems: 'flex-end', zIndex: 10 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', background: COLORS.navyCard, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: '18px 20px 26px', maxHeight: '85%', overflowY: 'auto' }}>
        <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
          <span style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, fontSize: 16, color: COLORS.foam }}>New alert</span>
          <button className="tl-btn" onClick={onClose} style={{ background: 'none', border: 'none', padding: 4 }}><X size={18} color={COLORS.foamDim} /></button>
        </div>

        <div style={{ fontSize: 10.5, color: COLORS.foamDim, letterSpacing: '0.06em', fontWeight: 600, marginBottom: 8 }}>SPOT</div>
        <div className="flex overflow-x-auto no-scrollbar" style={{ gap: 8, marginBottom: 16 }}>
          {order.map((id) => (
            <button key={id} className="tl-btn" onClick={() => setAlertDraft({ ...alertDraft, spotId: id })}
              style={{ background: alertDraft.spotId === id ? COLORS.tealBright : COLORS.navy, color: alertDraft.spotId === id ? COLORS.navy : COLORS.foam, border: 'none', borderRadius: 999, padding: '7px 13px', fontSize: 12.5, fontWeight: 600, flexShrink: 0, whiteSpace: 'nowrap' }}>
              {spots[id].name}
            </button>
          ))}
        </div>

        <div style={{ fontSize: 10.5, color: COLORS.foamDim, letterSpacing: '0.06em', fontWeight: 600, marginBottom: 8 }}>MINIMUM WAVE HEIGHT</div>
        <div className="flex" style={{ gap: 8, marginBottom: 16 }}>
          {[2, 3, 4, 5, 6].map((ft) => (
            <button key={ft} className="tl-btn" onClick={() => setAlertDraft({ ...alertDraft, minWaveFt: ft })}
              style={{ flex: 1, background: alertDraft.minWaveFt === ft ? COLORS.tealBright : COLORS.navy, color: alertDraft.minWaveFt === ft ? COLORS.navy : COLORS.foam, border: 'none', borderRadius: 10, padding: '9px 0', fontSize: 12.5, fontWeight: 600 }}>
              {formatWaveNum(ft, units)}{heightUnit(units)}+
            </button>
          ))}
        </div>

        <div style={{ fontSize: 10.5, color: COLORS.foamDim, letterSpacing: '0.06em', fontWeight: 600, marginBottom: 8 }}>NOTIFY ME</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
          {['1h', '1d', '2d', '3d'].map((lt) => (
            <button key={lt} className="tl-btn" onClick={() => setAlertDraft({ ...alertDraft, leadTime: lt })}
              style={{ background: alertDraft.leadTime === lt ? COLORS.tealBright : COLORS.navy, color: alertDraft.leadTime === lt ? COLORS.navy : COLORS.foam, border: 'none', borderRadius: 10, padding: '10px 13px', fontSize: 13, fontWeight: 600, textAlign: 'left' }}>
              {leadTimeLabel(lt)}
            </button>
          ))}
        </div>

        <button className="tl-btn" onClick={saveAlert} style={{ width: '100%', background: COLORS.tealBright, border: 'none', borderRadius: 12, padding: '11px 13px', color: COLORS.navy, fontWeight: 700, fontSize: 14 }}>Save alert</button>
      </div>
    </div>
  );
}
