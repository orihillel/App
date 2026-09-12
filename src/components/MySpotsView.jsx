import { X, Star, Navigation, RefreshCw } from 'lucide-react';
import { COLORS } from '../lib/colors.js';
import { ratingBg, ratingText, windColor } from '../lib/rating.js';
import { formatWaveRange, waveUnit, formatSpeed, speedUnit } from '../lib/format.js';

// "How are my spots doing", as a list. The ordering and the summary line are lib/myspots.js's;
// this only draws them.
export function MySpotsView({ rows, summary, units, goToId, onSelectSpot, onClose, onRefresh }) {
  return (
    <div>
      <header className="flex justify-between items-center px-6 pt-2 pb-1">
        <h1 style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, fontSize: 17, color: COLORS.foam, margin: 0 }}>Your spots</h1>
        <div className="flex items-center">
          <button className="tl-btn" onClick={onRefresh} aria-label="Refresh conditions"
            style={{ background: 'none', border: 'none', padding: 0, minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <RefreshCw size={18} color={COLORS.foamDim} />
          </button>
          <button className="tl-btn" onClick={onClose} aria-label="Close your spots"
            style={{ background: 'none', border: 'none', padding: 0, minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <X size={22} color={COLORS.foamDim} />
          </button>
        </div>
      </header>

      {summary ? (
        <p style={{ fontSize: 13, color: COLORS.foamDim, padding: '0 24px', margin: '0 0 12px', lineHeight: 1.45 }}>{summary}</p>
      ) : (
        <p style={{ fontSize: 13, color: COLORS.foamDim, padding: '0 24px', margin: '0 0 12px', lineHeight: 1.45 }}>Checking your spots…</p>
      )}

      {rows.length === 0 ? (
        <p style={{ fontSize: 13, color: COLORS.foamDim, padding: '0 24px', lineHeight: 1.5 }}>
          Nothing here yet. Star a spot as your go-to, or search for one and add it, and it will show up here.
        </p>
      ) : null}

      <ul style={{ listStyle: 'none', margin: 0, padding: '0 16px 16px' }}>
        {rows.map(({ id, spot, hour }) => (
          <li key={id} style={{ marginBottom: 8 }}>
            <button
              className="tl-btn w-full" onClick={() => onSelectSpot(id)}
              style={{ display: 'block', width: '100%', textAlign: 'left', background: COLORS.navyCard, border: '1px solid ' + COLORS.navyBorder, borderRadius: 12, padding: '12px 13px', minHeight: 44 }}
            >
              <span className="flex items-center justify-between" style={{ gap: 10 }}>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span className="flex items-center" style={{ gap: 6 }}>
                    {id === goToId ? <Star size={12} color={COLORS.tealBright} fill={COLORS.tealBright} style={{ flexShrink: 0 }} /> : null}
                    <span style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 600, fontSize: 15, color: COLORS.foam, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{spot.name}</span>
                  </span>
                  <span style={{ display: 'block', fontSize: 12, color: COLORS.foamDim, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{spot.region}</span>
                </span>
                {hour && hour.rating ? (
                  <span style={{ background: ratingBg(hour.rating), color: ratingText(hour.rating), fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 11, letterSpacing: '0.08em', padding: '3px 7px', borderRadius: 4, flexShrink: 0 }}>
                    {hour.rating}
                  </span>
                ) : (
                  <span className="tl-pulse" style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: COLORS.foamDim, flexShrink: 0 }}>···</span>
                )}
              </span>

              {hour ? (
                <span className="flex items-center" style={{ gap: 12, marginTop: 9 }}>
                  <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 17, color: COLORS.foam }}>
                    {formatWaveRange(hour.wave, units)}<span style={{ fontSize: 11, color: COLORS.foamDim, marginLeft: 3 }}>{waveUnit(units)}</span>
                  </span>
                  {hour.period != null ? (
                    <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12.5, color: COLORS.foamDim }}>{hour.period}s {hour.swellDir}</span>
                  ) : null}
                  {hour.windSpd != null ? (
                    <span className="flex items-center" style={{ gap: 5 }}>
                      <Navigation size={11} color={windColor(hour.type)} style={{ transform: 'rotate(' + hour.windDeg + 'deg)', flexShrink: 0 }} />
                      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12.5, color: windColor(hour.type) }}>
                        {formatSpeed(hour.windSpd, units)}{speedUnit(units)}
                      </span>
                    </span>
                  ) : null}
                </span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
