import { X, Navigation, ChevronLeft, ChevronRight } from 'lucide-react';
import { COLORS } from '../lib/colors.js';
import { degToCompass } from '../lib/rating.js';

export function SearchSheet({ searchQuery, setSearchQuery, runSearch, searchStep, setSearchStep, searchError, pending, setPending, nudge, confirmAddSpot, matches = [], onSelectMatch, onSearchAnyway, onClose }) {
  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(5,12,20,0.6)', display: 'flex', alignItems: 'flex-end', zIndex: 10 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', background: COLORS.navyCard, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: '18px 20px 26px', maxHeight: '82%', overflowY: 'auto' }}>
        <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
          <span style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, fontSize: 16, color: COLORS.foam }}>{searchStep === 'matches' ? 'Spots' : 'Find a spot'}</span>
          <button className="tl-btn" onClick={onClose} style={{ background: 'none', border: 'none', padding: 4 }}><X size={18} color={COLORS.foamDim} /></button>
        </div>
        {searchStep === 'query' && (
          <div>
            <input className="tl-input" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }}
              placeholder="Try “Malibu” or “Jeffreys Bay”"
              style={{ width: '100%', boxSizing: 'border-box', background: COLORS.navy, border: '1px solid ' + COLORS.foamFaint, borderRadius: 12, padding: '11px 13px', color: COLORS.foam, fontSize: 14, fontFamily: 'Inter, sans-serif' }} />
            <button className="tl-btn" onClick={runSearch} style={{ width: '100%', marginTop: 10, background: COLORS.tealBright, border: 'none', borderRadius: 12, padding: '11px 13px', color: COLORS.navy, fontWeight: 700, fontSize: 14 }}>Search</button>
            <div style={{ fontSize: 10.5, color: COLORS.foamDim, marginTop: 10, lineHeight: 1.4 }}>Any coastal place works — I'll pull live wave/wind data and guess which wind direction is offshore from the coastline shape.</div>
          </div>
        )}
        {/* Catalog matches come first: with 300+ built-in spots, searching for one that is
            already here used to geocode it and offer to add a duplicate. */}
        {searchStep === 'matches' && (
          <div>
            {matches.map(({ id, spot }) => (
              <button key={id} className="tl-btn w-full" onClick={() => onSelectMatch && onSelectMatch(id)}
                style={{ display: 'block', width: '100%', textAlign: 'left', background: COLORS.navy, border: '1px solid ' + COLORS.foamFaint, borderRadius: 12, padding: '10px 13px', marginBottom: 8 }}>
                <div style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 600, fontSize: 14, color: COLORS.foam }}>{spot.name}</div>
                <div style={{ fontSize: 11.5, color: COLORS.foamDim, marginTop: 2 }}>{spot.region}</div>
              </button>
            ))}
            <button className="tl-btn" onClick={() => onSearchAnyway && onSearchAnyway()}
              style={{ width: '100%', marginTop: 4, background: 'none', border: '1px solid ' + COLORS.navyBorder, borderRadius: 12, padding: '9px 13px', color: COLORS.foamDim, fontSize: 12.5 }}>
              Not what you meant? Add a new place instead
            </button>
          </div>
        )}
        {searchStep === 'loading' && <div className="tl-pulse" style={{ fontSize: 13, color: COLORS.foamDim, padding: '10px 0' }}>Looking it up…</div>}
        {searchStep === 'error' && (
          <div>
            <div style={{ fontSize: 13, color: COLORS.foam, marginBottom: 12 }}>{searchError}</div>
            <button className="tl-btn" onClick={() => setSearchStep('query')} style={{ background: COLORS.foamFaint, border: 'none', borderRadius: 12, padding: '9px 13px', color: COLORS.foam, fontSize: 13, fontWeight: 600 }}>Try again</button>
          </div>
        )}
        {searchStep === 'confirm' && pending && (
          <div>
            <div style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 600, fontSize: 15, color: COLORS.foam }}>{pending.name}</div>
            <div style={{ fontSize: 11.5, color: COLORS.foamDim, marginTop: 2 }}>{pending.region}</div>
            {!pending.guessed && (
              <div style={{ fontSize: 11, color: COLORS.gold, marginTop: 10, background: 'rgba(240,184,77,0.12)', padding: '7px 9px', borderRadius: 10 }}>
                Couldn't detect a coastline nearby — adjust the direction below if it looks wrong.
              </div>
            )}
            <div className="flex items-center justify-center" style={{ gap: 18, marginTop: 16 }}>
              <button className="tl-btn" onClick={() => nudge(-15)} style={{ background: COLORS.navy, border: 'none', borderRadius: 999, width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><ChevronLeft size={16} color={COLORS.foam} /></button>
              <div style={{ width: 64, height: 64, borderRadius: 999, border: '1.5px dashed ' + COLORS.foamFaint, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Navigation size={22} color={COLORS.tealBright} style={{ transform: 'rotate(' + pending.offshoreDeg + 'deg)' }} />
              </div>
              <button className="tl-btn" onClick={() => nudge(15)} style={{ background: COLORS.navy, border: 'none', borderRadius: 999, width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><ChevronRight size={16} color={COLORS.foam} /></button>
            </div>
            <div style={{ textAlign: 'center', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: COLORS.foamDim, marginTop: 8 }}>Offshore wind ≈ {degToCompass(pending.offshoreDeg)} ({pending.offshoreDeg}°)</div>
            <button className="tl-btn" onClick={confirmAddSpot} style={{ width: '100%', marginTop: 16, background: COLORS.tealBright, border: 'none', borderRadius: 12, padding: '11px 13px', color: COLORS.navy, fontWeight: 700, fontSize: 14 }}>Add & show conditions</button>
            <button className="tl-btn" onClick={() => { setSearchStep('query'); setPending(null); }} style={{ width: '100%', marginTop: 8, background: 'none', border: 'none', color: COLORS.foamDim, fontSize: 12.5, padding: '6px 0' }}>← Search a different spot</button>
          </div>
        )}
      </div>
    </div>
  );
}
