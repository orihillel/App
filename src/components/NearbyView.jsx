import { X, MapPin, Navigation, RefreshCw } from 'lucide-react';
import { COLORS } from '../lib/colors.js';
import { ratingBg, ratingText, degToCompass } from '../lib/rating.js';
import { formatWaveRange, waveUnit, formatSpeed, speedUnit } from '../lib/format.js';

function km(distance, units) {
  return units === 'metric'
    ? Math.round(distance) + ' km'
    : Math.round(distance * 0.621371) + ' mi';
}

// "Where should I go right now", as a list. The ordering is lib/nearby.js's; this only draws it.
export function NearbyView({ rows, units, status, message, onRetry, onSelectSpot, onClose, spots, radiusLabel }) {
  return (
    <div>
      <div className="flex justify-between items-center px-6 pt-2 pb-3">
        <h1 style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, fontSize: 17, color: COLORS.foam, margin: 0 }}>Best nearby</h1>
        <button className="tl-btn" onClick={onClose} aria-label="Close nearby"
          style={{ background: 'none', border: 'none', padding: 0, minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <X size={22} color={COLORS.foamDim} />
        </button>
      </div>

      {status === 'locating' && (
        <div style={{ padding: '0 20px' }}>
          <div className="tl-pulse" style={{ fontSize: 12.5, color: COLORS.foamDim }}>Finding your location…</div>
        </div>
      )}

      {status === 'error' && (
        <div style={{ padding: '0 20px' }}>
          <div style={{ fontSize: 12.5, color: COLORS.foamDim, lineHeight: 1.5, marginBottom: 12 }}>{message}</div>
          <button className="tl-btn" onClick={onRetry}
            style={{ background: COLORS.navyCard, border: '1px solid ' + COLORS.navyBorder, borderRadius: 10, color: COLORS.foam, fontSize: 13, fontWeight: 600, padding: '10px 14px', minHeight: 44 }}>
            <span className="flex items-center" style={{ gap: 7 }}><RefreshCw size={14} color={COLORS.foamDim} /> Try again</span>
          </button>
        </div>
      )}

      {status === 'empty' && (
        <div style={{ padding: '0 20px', fontSize: 12.5, color: COLORS.foamDim, lineHeight: 1.5 }}>
          No spots in the catalog within {radiusLabel} of you. The globe has the full list if you
          want to look further out.
        </div>
      )}

      {status === 'ready' && (
        <>
          <div style={{ padding: '0 20px 10px', fontSize: 11.5, color: COLORS.foamDim, lineHeight: 1.45 }}>
            Spots within {radiusLabel}, best conditions first — same rating the rest of the app uses.
          </div>
          <div style={{ padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {rows.map((row) => {
              const spot = spots[row.id];
              if (!spot) return null;
              const h = row.hour;
              return (
                <button key={row.id} className="tl-btn" onClick={() => onSelectSpot(row.id)}
                  style={{ textAlign: 'left', width: '100%', background: COLORS.navyCard, border: '1px solid ' + COLORS.navyBorder, borderRadius: 10, padding: '12px 14px' }}>
                  <div className="flex items-start justify-between" style={{ gap: 10 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 600, fontSize: 14, color: COLORS.foam, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{spot.name}</div>
                      <div className="flex items-center" style={{ gap: 5, marginTop: 3 }}>
                        <MapPin size={11} color={COLORS.foamDim} />
                        <span style={{ fontSize: 11.5, color: COLORS.foamDim }}>{km(row.km, units)} away</span>
                      </div>
                    </div>
                    {/* A spot whose reading has not arrived is still listed -- it is genuinely
                        nearby, and dropping rows as answers land would make the list jump under
                        a thumb. It says so rather than showing a blank badge. */}
                    {h ? (
                      <span style={{ background: ratingBg(h.rating), color: ratingText(h.rating), fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 11, letterSpacing: '0.08em', padding: '3px 8px', borderRadius: 4, flexShrink: 0 }}>
                        {h.rating}
                      </span>
                    ) : (
                      <span className="tl-pulse" style={{ fontSize: 10.5, color: COLORS.foamDim, flexShrink: 0 }}>checking…</span>
                    )}
                  </div>
                  {h && (
                    <div className="flex items-center" style={{ gap: 12, marginTop: 9, flexWrap: 'wrap' }}>
                      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 15, fontWeight: 700, color: COLORS.foam }}>
                        {formatWaveRange(h.wave, units)}<span style={{ fontSize: 11, color: COLORS.foamDim, marginLeft: 3 }}>{waveUnit(units)}</span>
                      </span>
                      {h.period != null && <span style={{ fontSize: 12, color: COLORS.foamDim }}>{h.period}s</span>}
                      {h.windSpd != null && (
                        <span className="flex items-center" style={{ gap: 4 }}>
                          <Navigation size={11} color={COLORS.foamDim} style={{ transform: 'rotate(' + (h.windDeg || 0) + 'deg)' }} />
                          <span style={{ fontSize: 12, color: COLORS.foamDim }}>
                            {formatSpeed(h.windSpd, units)}{speedUnit(units)} {h.windDir || degToCompass(h.windDeg)}
                          </span>
                        </span>
                      )}
                      {h.type && <span style={{ fontSize: 12, color: COLORS.foamDim }}>{h.type}</span>}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
