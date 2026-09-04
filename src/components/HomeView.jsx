import { Menu, Search, Star, Navigation, MapPin, RefreshCw, ChevronLeft, ChevronRight, Clock, Thermometer } from 'lucide-react';
import { COLORS } from '../lib/colors.js';
import { cToF } from '../lib/swell.js';
import { arcCentre } from '../lib/spotmodel.js';
import { degToCompass, windAngleColor, ratingBg, ratingText, windColor } from '../lib/rating.js';
import { formatWaveRange, formatWaveNum, formatHeight, formatSpeed, waveUnit, heightUnit, speedUnit, barHeight, hourLabel12 } from '../lib/format.js';

// Deep-links into Google Maps' turn-by-turn directions to this spot. Omitting `origin` makes
// Maps use the visitor's current location and omitting `travelmode` leaves driving/walking/
// transit as a in-Maps choice, rather than this app guessing one -- covers "get me there by
// car, on foot, or by transit" with one link. Works cross-platform: this URL scheme opens the
// native Google Maps app via a universal/app link on iOS and Android when it's installed, and
// falls back to Google Maps in the browser otherwise (including on desktop).
function directionsUrl(spot) {
  return `https://www.google.com/maps/dir/?api=1&destination=${spot.lat},${spot.lon}`;
}

export function HomeView({
  setToast, units, toggleUnits, openSearch,
  spot, isGoTo, makeGoTo, showSpotNav, onPrevSpot, onNextSpot,
  h, isLoading, hasError, retry,
  waveChart, hourIdx, setHourIdx, hourData, best, waterC, wetsuit,
  activeId, contData, contWaveLine, contTideLine, contWindLine, contSelected, contSelectedIdx, setContSelectedIdx,
  tideToday, tide, tideNext,
}) {
  return (
    <>
      <div className="flex justify-between items-center px-6 pt-2 pb-3">
        <button className="tl-btn" style={{ background: 'none', border: 'none', padding: 6 }} onClick={() => setToast('Menu — not in this preview')} aria-label="Menu"><Menu size={18} color={COLORS.foamDim} /></button>
        <span style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 600, fontSize: 13, letterSpacing: '0.14em', color: COLORS.foam, opacity: 0.9 }}>TIDELINE</span>
        <div className="flex items-center" style={{ gap: 8 }}>
          <button className="tl-btn" onClick={toggleUnits} aria-label="Toggle units" style={{ background: 'none', border: '1px solid ' + COLORS.navyBorder, borderRadius: 4, padding: '3px 7px' }}>
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, fontWeight: 700, color: COLORS.foamDim, letterSpacing: '0.04em' }}>{units === 'metric' ? 'M' : 'FT'}</span>
          </button>
          <button className="tl-btn" style={{ background: 'none', border: 'none', padding: 6 }} onClick={openSearch} aria-label="Search for a spot"><Search size={18} color={COLORS.foamDim} /></button>
        </div>
      </div>

      <div className="flex justify-between items-start px-6 pb-3">
        <div className="flex items-start" style={{ gap: 2, minWidth: 0 }}>
          {showSpotNav && (
            <button className="tl-btn" style={{ background: 'none', border: 'none', padding: 6, flexShrink: 0 }} onClick={onPrevSpot} aria-label="Previous spot"><ChevronLeft size={18} color={COLORS.foamDim} /></button>
          )}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, fontSize: 22, color: COLORS.foam, lineHeight: 1.1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{spot.name}</div>
            <div style={{ fontSize: 12.5, color: COLORS.foamDim, marginTop: 3 }}>{spot.region}</div>
            {isGoTo && <div style={{ fontSize: 10.5, color: COLORS.tealBright, marginTop: 5, fontWeight: 600, letterSpacing: '0.06em' }}>YOUR GO-TO SPOT</div>}
          </div>
          {showSpotNav && (
            <button className="tl-btn" style={{ background: 'none', border: 'none', padding: 6, flexShrink: 0 }} onClick={onNextSpot} aria-label="Next spot"><ChevronRight size={18} color={COLORS.foamDim} /></button>
          )}
        </div>
        <div className="flex items-start" style={{ gap: 2, flexShrink: 0 }}>
          <button className="tl-btn" style={{ background: 'none', border: 'none', padding: 6 }} onClick={() => window.open(directionsUrl(spot), '_blank', 'noopener,noreferrer')} aria-label={'Get directions to ' + spot.name}>
            <MapPin size={20} color={COLORS.foamDim} />
          </button>
          <button className="tl-btn" style={{ background: 'none', border: 'none', padding: 6 }} onClick={makeGoTo} aria-label="Set as go-to spot">
            <Star size={22} color={isGoTo ? COLORS.gold : COLORS.foamDim} fill={isGoTo ? COLORS.gold : 'none'} />
          </button>
        </div>
      </div>

      <div className="mx-6 relative overflow-hidden" style={{ borderRadius: 14, padding: '18px 18px 20px', background: COLORS.navyCard, border: '1px solid ' + COLORS.navyBorder }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: ratingBg(h.rating), opacity: isLoading ? 0.4 : 1, transition: 'background 300ms ease' }} />
        <div className="relative" style={{ zIndex: 1 }}>
          <div className="flex items-center" style={{ gap: 8 }}>
            <span className={isLoading ? 'tl-pulse' : ''} style={{ background: ratingBg(h.rating), color: ratingText(h.rating), fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 11, letterSpacing: '0.08em', padding: '3px 8px', borderRadius: 4 }}>
              {isLoading ? 'FETCHING…' : h.rating}
            </span>
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11.5, color: COLORS.foamDim }}>AT {h.t.toUpperCase()}</span>
          </div>
          <div className="flex items-baseline" style={{ gap: 8, marginTop: 12 }}>
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 52, color: COLORS.foam, lineHeight: 1, letterSpacing: '-0.01em' }}>{formatWaveRange(h.wave, units)}</span>
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 16, color: COLORS.foamDim, letterSpacing: '0.04em' }}>{waveUnit(units)}</span>
          </div>
          <div className="flex items-center" style={{ gap: 14, marginTop: 12 }}>
            {/* Only when there are no trains to show below — otherwise this is the same
                swell said twice, once with less detail. */}
            {!(h.trains && h.trains.length) ? (
              <div className="flex items-center" style={{ gap: 5 }}>
                <Navigation size={13} color={COLORS.tealBright} style={{ transform: 'rotate(' + h.swellDeg + 'deg)' }} />
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: COLORS.foam }}>{h.period}s {h.swellDir}</span>
              </div>
            ) : null}
            <div className="flex items-center" style={{ gap: 5 }}>
              <Navigation size={13} color={COLORS.tealBright} style={{ transform: 'rotate(' + h.windDeg + 'deg)' }} />
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: COLORS.foam }}>{formatSpeed(h.windSpd, units)}{speedUnit(units)} {h.windDir}</span>
            </div>
          </div>
          {/* Sea state is not one wave: a long-period groundswell from a distant storm and a
              short-period wind swell raised locally arrive together, often from different
              directions. Collapsing them into one height and one period (which is what this
              card used to show) hides the difference between a clean day and a junk one at
              the same size. See lib/swell.js. */}
          {h.trains && h.trains.length ? (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 5 }}>
              {h.trains.map((tr, i) => (
                <div key={i} className="flex items-center" style={{ gap: 6 }}>
                  <Navigation size={11} color={i === 0 ? COLORS.tealBright : COLORS.foamDim} style={{ transform: 'rotate(' + tr.deg + 'deg)', flexShrink: 0 }} />
                  <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11.5, color: COLORS.foam }}>
                    {formatWaveNum(tr.heightFt, units)}{heightUnit(units)} {tr.period}s {tr.dir}
                  </span>
                  <span style={{ fontSize: 10.5, color: COLORS.foamDim }}>{tr.kind}</span>
                </div>
              ))}
            </div>
          ) : null}
          {/* The answer to the question people actually opened the app to ask. Every number
              behind it was already being computed per hour; nothing surfaced the conclusion,
              so you had to scrub the hour strip and compare eight ratings yourself. Tapping it
              jumps the rest of the page to that hour. Absent on a day with nothing worth
              singling out — see lib/bestwindow.js. */}
          {best && !isLoading && !hasError ? (
            <button
              className="tl-btn flex items-center"
              onClick={() => setHourIdx(best.startIdx)}
              style={{ gap: 7, marginTop: 14, width: '100%', textAlign: 'left', background: 'rgba(0,0,0,0.22)', border: '1px solid ' + COLORS.navyBorder, borderRadius: 8, padding: '8px 10px' }}
            >
              <Clock size={13} color={ratingBg(best.rating)} />
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11.5, color: COLORS.foam, fontWeight: 700 }}>{best.label}</span>
              <span style={{ fontSize: 11.5, color: COLORS.foamDim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                best today · {formatWaveRange(best.wave, units)}{heightUnit(units)} {best.windType}
              </span>
            </button>
          ) : null}
          {hasError ? (
            <div style={{ marginTop: 12, fontSize: 11.5, color: COLORS.foam, background: 'rgba(0,0,0,0.28)', padding: '8px 10px', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span>Live data didn't load for this spot.</span>
              <button className="tl-btn" onClick={retry} style={{ background: COLORS.foam, color: COLORS.navy, border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                <RefreshCw size={11} /> Retry
              </button>
            </div>
          ) : (
            <>
              {waterC != null ? (
                <div className="flex items-center" style={{ gap: 6, marginTop: 12 }}>
                  <Thermometer size={12} color={COLORS.foamDim} />
                  <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11.5, color: COLORS.foam }}>
                    {units === 'metric' ? Math.round(waterC) + '°C' : Math.round(cToF(waterC)) + '°F'}
                  </span>
                  {wetsuit ? <span style={{ fontSize: 11, color: COLORS.foamDim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{wetsuit}</span> : null}
                </div>
              ) : null}
              {spot.swellWindow ? (
                <div style={{ fontSize: 11, color: COLORS.foamDim, marginTop: 10, fontFamily: 'JetBrains Mono, monospace' }}>
                  Needs {degToCompass(arcCentre(spot.swellWindow[0], spot.swellWindow[1]))} swell
                  {spot.bestTide && spot.bestTide !== 'all' ? ' · best at ' + spot.bestTide + ' tide' : ''}
                </div>
              ) : null}
              <div style={{ fontSize: 12, color: COLORS.foamDim, marginTop: 12, lineHeight: 1.4, maxWidth: 260 }}>{spot.blurb}</div>
            </>
          )}
        </div>
      </div>

      <div className="mx-6" style={{ marginTop: 14, background: COLORS.navyCard, border: '1px solid ' + COLORS.navyBorder, borderRadius: 10, padding: '12px 14px' }}>
        <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
          <span style={{ fontSize: 10, color: COLORS.foamDim, letterSpacing: '0.08em', fontWeight: 600 }}>WAVE HEIGHT TODAY</span>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: COLORS.foamDim }}>{formatWaveRange(h.wave, units)}{heightUnit(units)} now</span>
        </div>
        <svg viewBox="0 0 300 56" style={{ width: '100%', height: 46 }}>
          <path d={waveChart.d} fill="none" stroke={COLORS.tealBright} strokeWidth="2" />
          {waveChart.pts.map((p, i) => (
            <circle key={i} cx={p[0]} cy={p[1]} r={i === hourIdx ? 3.5 : 2} fill={i === hourIdx ? COLORS.coral : COLORS.foamDim} style={{ cursor: 'pointer' }} onClick={() => setHourIdx(i)} />
          ))}
        </svg>
        <div className="flex justify-between" style={{ marginTop: 2 }}>
          {hourData.map((hr, i) => (
            <span key={hr.t} style={{ fontSize: 9, color: i === hourIdx ? COLORS.foam : COLORS.foamDim, fontWeight: i === hourIdx ? 600 : 400, fontFamily: 'JetBrains Mono, monospace' }}>{hr.t}</span>
          ))}
        </div>
      </div>

      <div className="mx-6" style={{ marginTop: 10, background: COLORS.navyCard, border: '1px solid ' + COLORS.navyBorder, borderRadius: 10, padding: '12px 14px' }}>
        <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
          <span style={{ fontSize: 10, color: COLORS.foamDim, letterSpacing: '0.08em', fontWeight: 600 }}>WAVE HEIGHT THIS WEEK</span>
          <div className="flex items-center" style={{ gap: 9 }}>
            <span className="flex items-center" style={{ gap: 4, fontSize: 9, color: COLORS.foamDim }}><span style={{ width: 10, height: 2, background: COLORS.tealBright, display: 'inline-block', borderRadius: 1 }} />height</span>
            <span className="flex items-center" style={{ gap: 4, fontSize: 9, color: COLORS.foamDim }}><span style={{ width: 10, height: 0, borderTop: '1.5px dashed ' + COLORS.gold, display: 'inline-block' }} />tide</span>
            <span className="flex items-center" style={{ gap: 4, fontSize: 9, color: COLORS.foamDim }}><span style={{ width: 10, height: 0, borderTop: '1.5px dotted ' + COLORS.coral, display: 'inline-block' }} />wind</span>
          </div>
        </div>
        <svg viewBox="0 0 300 70" style={{ width: '100%', height: 66 }}>
          <defs>
            <linearGradient id={'weekFill-' + activeId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={COLORS.tealBright} stopOpacity="0.32" />
              <stop offset="100%" stopColor={COLORS.tealBright} stopOpacity="0" />
            </linearGradient>
          </defs>
          {contData.map((p, i) => p.dayStart && (
            <line key={'gl' + i} x1={contWaveLine.pts[i][0]} y1="6" x2={contWaveLine.pts[i][0]} y2="70" stroke={COLORS.foamFaint} strokeWidth="1" strokeDasharray="1,3" />
          ))}
          <path d={contWaveLine.d + ' L' + contWaveLine.pts[contWaveLine.pts.length - 1][0] + ',70 L' + contWaveLine.pts[0][0] + ',70 Z'} fill={'url(#weekFill-' + activeId + ')'} stroke="none" />
          <path d={contTideLine.d} fill="none" stroke={COLORS.gold} strokeWidth="1.2" strokeDasharray="2,2" opacity="0.8" />
          <path d={contWindLine.d} fill="none" stroke={COLORS.coral} strokeWidth="1.2" strokeDasharray="1,2" opacity="0.8" />
          <path d={contWaveLine.d} fill="none" stroke={COLORS.tealBright} strokeWidth="2" />
          {contData.map((p, i) => p.dayStart && p.windDeg != null && spot && (() => {
            const arrowColor = windAngleColor(p.windDeg, spot.offshoreDeg);
            return (
              <g key={'wd' + i} transform={'translate(' + contWaveLine.pts[i][0] + ',9) rotate(' + p.windDeg + ')'}>
                <line x1="0" y1="4" x2="0" y2="-4" stroke={arrowColor} strokeWidth="1.1" />
                <path d="M0,-5 L-2,-2 L2,-2 Z" fill={arrowColor} />
              </g>
            );
          })())}
          {contSelected && (
            <circle cx={contWaveLine.pts[contSelectedIdx][0]} cy={contWaveLine.pts[contSelectedIdx][1]} r="3.5" fill={COLORS.coral} />
          )}
          <rect x="0" y="0" width="300" height="70" fill="transparent" style={{ cursor: 'pointer' }} onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const x = ((e.clientX - rect.left) / rect.width) * 300;
            let nearest = 0, best = Infinity;
            contWaveLine.pts.forEach((pt, i) => { const d = Math.abs(pt[0] - x); if (d < best) { best = d; nearest = i; } });
            setContSelectedIdx(nearest);
          }} />
        </svg>
        <div style={{ position: 'relative', height: 13, marginTop: 1 }}>
          {contData.map((p, i) => p.dayStart && (
            <span key={'dl' + i} style={{ position: 'absolute', left: (contWaveLine.pts[i][0] / 300) * 100 + '%', transform: 'translateX(-50%)', fontSize: 9, color: COLORS.foamDim, fontFamily: 'JetBrains Mono, monospace' }}>{p.day}</span>
          ))}
        </div>
        <div style={{ marginTop: 4, fontSize: 11, color: contSelected ? COLORS.foam : COLORS.foamDim, fontFamily: 'JetBrains Mono, monospace', minHeight: 14 }}>
          {contSelected ? (contSelected.day + ' ' + hourLabel12(contSelected.hour) + ' · ' + formatWaveNum(contSelected.waveFt, units) + heightUnit(units) + (contSelected.tideFt != null ? ' · ' + formatHeight(contSelected.tideFt, units) + heightUnit(units) + ' tide' : '') + (contSelected.windSpd != null ? ' · ' + formatSpeed(contSelected.windSpd, units) + speedUnit(units) + ' ' + degToCompass(contSelected.windDeg) : '')) : 'Tap the chart for a specific time'}
        </div>
      </div>

      <div className="flex overflow-x-auto no-scrollbar px-6" style={{ gap: 8, marginTop: 14 }}>
        {hourData.map((hr, i) => {
          const selected = i === hourIdx;
          return (
            <button key={hr.t} className="tl-btn flex flex-col items-center justify-end" onClick={() => setHourIdx(i)}
              style={{ background: selected ? COLORS.foamFaint : 'transparent', border: 'none', borderRadius: 14, padding: '8px 9px 7px', minWidth: 40, flexShrink: 0 }}>
              <div style={{ width: 6, height: barHeight(hr.wave), background: ratingBg(hr.rating), borderRadius: 3, marginBottom: 6 }} />
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: selected ? COLORS.foam : COLORS.foamDim, fontWeight: selected ? 600 : 400 }}>{hr.t}</span>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-3 px-6" style={{ gap: 8, marginTop: 14 }}>
        <div style={{ background: COLORS.navyCard, border: '1px solid ' + COLORS.navyBorder, borderRadius: 10, padding: '10px 11px' }}>
          <div style={{ fontSize: 10, color: COLORS.foamDim, letterSpacing: '0.08em', fontWeight: 600 }}>SWELL</div>
          <div style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, fontSize: 15, color: COLORS.foam, marginTop: 5 }}>{formatWaveRange(h.wave, units)}{heightUnit(units)}</div>
          <div style={{ fontSize: 10.5, color: COLORS.foamDim, marginTop: 2 }}>{h.period}s {h.swellDir}</div>
        </div>
        <div style={{ background: COLORS.navyCard, border: '1px solid ' + COLORS.navyBorder, borderRadius: 10, padding: '10px 11px' }}>
          <div style={{ fontSize: 10, color: COLORS.foamDim, letterSpacing: '0.08em', fontWeight: 600 }}>WIND</div>
          <div style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, fontSize: 15, color: COLORS.foam, marginTop: 5 }}>{formatSpeed(h.windSpd, units)}{speedUnit(units)}</div>
          <div style={{ fontSize: 10.5, color: windColor(h.type), marginTop: 2, fontWeight: 600 }}>{h.windDir} · {h.type}</div>
        </div>
        <div style={{ background: COLORS.navyCard, border: '1px solid ' + COLORS.navyBorder, borderRadius: 10, padding: '10px 11px' }}>
          <div style={{ fontSize: 10, color: COLORS.foamDim, letterSpacing: '0.08em', fontWeight: 600 }}>TIDE</div>
          <div style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, fontSize: 15, color: COLORS.foam, marginTop: 5 }}>{tideToday[hourIdx] != null ? formatHeight(tideToday[hourIdx], units) : '–'}{heightUnit(units)}</div>
          <svg viewBox="0 0 100 34" style={{ width: '100%', height: 20, marginTop: 3 }}>
            <path d={tide.d} fill="none" stroke={COLORS.foamDim} strokeWidth="1.5" />
            <circle cx={tide.pts[hourIdx][0]} cy={tide.pts[hourIdx][1]} r="2.6" fill={COLORS.coral} />
          </svg>
          <div style={{ fontSize: 9, color: COLORS.foamDim, marginTop: 2 }}>{tideNext ? 'Next ' + tideNext.type + ' ' + hourLabel12(tideNext.hour) : 'Tide unavailable'}</div>
        </div>
      </div>
    </>
  );
}
