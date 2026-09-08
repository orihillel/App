import { useState } from 'react';
import { Menu, Search, Star, Navigation, MapPin, RefreshCw, ChevronLeft, ChevronRight, Clock, Thermometer, AlertTriangle, Plus, TrendingUp } from 'lucide-react';
import { COLORS } from '../lib/colors.js';
import { cToF } from '../lib/swell.js';
import { arcCentre } from '../lib/spotmodel.js';
import { formatAge, compareToForecast, compareLabel } from '../lib/buoy.js';
import { calibrationLabel } from '../lib/calibration.js';
import { degToCompass, windAngleColor, ratingBg, ratingText, windColor } from '../lib/rating.js';
import { formatWaveRange, formatWaveNum, formatHeight, formatSpeed, waveUnit, heightUnit, speedUnit, barHeight, hourLabel12, waveAvg } from '../lib/format.js';

// Deep-links into Google Maps' turn-by-turn directions to this spot. Omitting `origin` makes
// Maps use the visitor's current location and omitting `travelmode` leaves driving/walking/
// transit as a in-Maps choice, rather than this app guessing one -- covers "get me there by
// car, on foot, or by transit" with one link. Works cross-platform: this URL scheme opens the
// native Google Maps app via a universal/app link on iOS and Android when it's installed, and
// falls back to Google Maps in the browser otherwise (including on desktop).
function directionsUrl(spot) {
  return `https://www.google.com/maps/dir/?api=1&destination=${spot.lat},${spot.lon}`;
}

// 44x44 is the floor. An audit of the running app found all 21 of its interactive elements
// under it -- header icons at 30x33, the units toggle at 29x24 -- which is what Apple's HIG
// asks for and what WCAG 2.5.5 wants. The icons did not change size; the hit area grew around
// them, so nothing looks bigger and everything is easier to hit with cold wet hands.
const TAP = {
  background: 'none', border: 'none', padding: 0,
  minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center',
  flexShrink: 0,
};

export function HomeView({
  units, toggleUnits, openSearch, openMenu,
  spot, isGoTo, makeGoTo, showSpotNav, onPrevSpot, onNextSpot, canPrevSpot = true, canNextSpot = true,
  h, dataState, fetchedAt, retry, errorReason,
  waveChart, hourIdx, setHourIdx, hourData, best, waterC, wetsuit, agreement, buoy, onLogSession, calibration,
  activeId, contData, contWaveLine, contTideLine, contWindLine, contSelected, contSelectedIdx, setContSelectedIdx,
  tideToday, tide, tideNext,
}) {
  // Local to this view: the log panel is a transient bit of UI, not app state worth lifting.
  const [logging, setLogging] = useState(false);
  const [stars, setStars] = useState(3);
  const [note, setNote] = useState('');
  function submitLog() {
    onLogSession({ stars, note });
    setLogging(false); setStars(3); setNote('');
  }
  const stale = dataState === 'stale';
  return (
    <>
      <div className="flex justify-between items-center px-4" style={{ paddingBottom: 2 }}>
        <button className="tl-btn" style={TAP} onClick={openMenu} aria-label="Menu"><Menu size={22} color={COLORS.foamDim} /></button>
        <span style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 600, fontSize: 14, letterSpacing: '0.14em', color: COLORS.foam, opacity: 0.9 }}>SURFCAST</span>
        <div className="flex items-center">
          <button className="tl-btn" onClick={toggleUnits} aria-label="Toggle units" style={{ ...TAP, minWidth: 46, border: '1px solid ' + COLORS.navyBorder, borderRadius: 6 }}>
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 700, color: COLORS.foamDim, letterSpacing: '0.04em' }}>{units === 'metric' ? 'M' : 'FT'}</span>
          </button>
          <button className="tl-btn" style={TAP} onClick={openSearch} aria-label="Search for a spot"><Search size={22} color={COLORS.foamDim} /></button>
        </div>
      </div>

      {/* The directions pin used to sit here, next to the star. At this type size four
          controls crowded the spot name into an ellipsis, and an unlabelled pin that leaves
          the app was the weakest of them -- it now reads "Directions" inside the card below,
          where it says what it does. */}
      <div className="flex justify-between items-center px-3" style={{ paddingBottom: 8 }}>
        <div className="flex items-center" style={{ minWidth: 0 }}>
          {/* Left goes to the nearest spot west of here, right to the nearest east. Dimmed and
              disabled when that side of the map is empty -- an arrow that silently does nothing
              reads as broken. */}
          {showSpotNav && (
            <button
              className="tl-btn" style={{ ...TAP, opacity: canPrevSpot ? 1 : 0.3, cursor: canPrevSpot ? 'pointer' : 'default' }}
              onClick={onPrevSpot} disabled={!canPrevSpot} aria-label="Previous spot"
            >
              <ChevronLeft size={22} color={COLORS.foamDim} />
            </button>
          )}
          <div style={{ minWidth: 0, paddingLeft: showSpotNav ? 0 : 8 }}>
            <div style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, fontSize: 26, color: COLORS.foam, lineHeight: 1.1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{spot.name}</div>
            <div style={{ fontSize: 14, color: COLORS.foamDim, marginTop: 3 }}>{spot.region}</div>
            {isGoTo && <div style={{ fontSize: 11.5, color: COLORS.tealBright, marginTop: 5, fontWeight: 600, letterSpacing: '0.06em' }}>YOUR GO-TO SPOT</div>}
          </div>
          {showSpotNav && (
            <button
              className="tl-btn" style={{ ...TAP, opacity: canNextSpot ? 1 : 0.3, cursor: canNextSpot ? 'pointer' : 'default' }}
              onClick={onNextSpot} disabled={!canNextSpot} aria-label="Next spot"
            >
              <ChevronRight size={22} color={COLORS.foamDim} />
            </button>
          )}
        </div>
        <button className="tl-btn" style={TAP} onClick={makeGoTo} aria-label="Set as go-to spot">
          <Star size={24} color={isGoTo ? COLORS.gold : COLORS.foamDim} fill={isGoTo ? COLORS.gold : 'none'} />
        </button>
      </div>

      {/* The forecast card, in whichever of its four states applies. The one thing it will
          never do again is show a number the app made up. */}
      <div className="mx-4 relative overflow-hidden" style={{ borderRadius: 14, padding: '16px 16px 18px', background: COLORS.navyCard, border: '1px solid ' + COLORS.navyBorder }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: dataState === 'loading' ? COLORS.foamFaint : dataState === 'empty' ? COLORS.gold : stale ? COLORS.gold : ratingBg(h.rating), transition: 'background 300ms ease' }} />
        <div className="relative" style={{ zIndex: 1 }}>

          {dataState === 'loading' && <Skeleton />}

          {dataState === 'empty' && <NoForecast retry={retry} reason={errorReason} />}

          {(dataState === 'ok' || stale) && (
            <>
              {stale ? (
                <StaleHeader fetchedAt={fetchedAt} retry={retry} />
              ) : (
                <div className="flex items-center" style={{ gap: 8 }}>
                  <span style={{ background: ratingBg(h.rating), color: ratingText(h.rating), fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 12, letterSpacing: '0.08em', padding: '4px 9px', borderRadius: 4 }}>
                    {h.rating}
                  </span>
                  <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13, color: COLORS.foamDim }}>AT {h.t.toUpperCase()}</span>
                </div>
              )}

              <div style={{ opacity: stale ? 0.72 : 1 }}>
                <div className="flex items-baseline" style={{ gap: 8, marginTop: 12 }}>
                  <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: stale ? 34 : 54, color: COLORS.foam, lineHeight: 1, letterSpacing: '-0.01em' }}>{formatWaveRange(h.wave, units)}</span>
                  <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: stale ? 15 : 18, color: COLORS.foamDim, letterSpacing: '0.04em' }}>{waveUnit(units)}</span>
                </div>

                {/* Sea state is not one wave: a long-period groundswell from a distant storm and a
                    short-period wind swell raised locally arrive together, often from different
                    directions. Collapsing them into one height and one period hides the difference
                    between a clean day and a junk one at the same size. See lib/swell.js. */}
                {h.trains && h.trains.length ? (
                  <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {h.trains.map((tr, i) => (
                      <div key={i} className="flex items-center" style={{ gap: 7 }}>
                        <Navigation size={13} color={i === 0 ? COLORS.tealBright : COLORS.foamDim} style={{ transform: 'rotate(' + tr.deg + 'deg)', flexShrink: 0 }} />
                        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13, color: COLORS.foam }}>
                          {formatWaveNum(tr.heightFt, units)}{heightUnit(units)} {tr.period}s {tr.dir}
                        </span>
                        <span style={{ fontSize: 12, color: COLORS.foamDim }}>{tr.kind}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center" style={{ gap: 7, marginTop: 12 }}>
                    <Navigation size={13} color={COLORS.tealBright} style={{ transform: 'rotate(' + h.swellDeg + 'deg)', flexShrink: 0 }} />
                    <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13, color: COLORS.foam }}>{h.period}s {h.swellDir}</span>
                  </div>
                )}

                <div className="flex items-center" style={{ gap: 7, marginTop: 10 }}>
                  <Navigation size={13} color={COLORS.tealBright} style={{ transform: 'rotate(' + h.windDeg + 'deg)', flexShrink: 0 }} />
                  <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13, color: COLORS.foam }}>{formatSpeed(h.windSpd, units)}{speedUnit(units)} {h.windDir}</span>
                  <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13, color: windColor(h.type), fontWeight: 600 }}>{h.type}</span>
                </div>
              </div>

              {/* The answer to the question people actually opened the app to ask. Every number
                  behind it was already being computed per hour; nothing surfaced the conclusion,
                  so you had to scrub the hour strip and compare eight ratings yourself. Tapping it
                  jumps the rest of the page to that hour. Absent on a day with nothing worth
                  singling out — see lib/bestwindow.js. */}
              {best && !stale ? (
                <button
                  className="tl-btn flex items-center"
                  onClick={() => setHourIdx(best.startIdx)}
                  style={{ gap: 8, marginTop: 14, width: '100%', minHeight: 44, textAlign: 'left', background: 'rgba(0,0,0,0.22)', border: '1px solid ' + COLORS.navyBorder, borderRadius: 8, padding: '0 12px' }}
                >
                  <Clock size={14} color={ratingBg(best.rating)} style={{ flexShrink: 0 }} />
                  <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13, color: COLORS.foam, fontWeight: 700 }}>{best.label}</span>
                  <span style={{ fontSize: 13, color: COLORS.foamDim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    best today · {formatWaveRange(best.wave, units)}{heightUnit(units)} {best.windType}
                  </span>
                </button>
              ) : null}

              {/* The consistent part of the model's error at this spot, learned from buoy readings
                  and reported here rather than in the buoy panel: it qualifies the forecast above,
                  and it still holds on a day the buoy happens to be offline. */}
              {calibrationLabel(calibration) && !stale ? (
                <div className="flex items-center" style={{ gap: 7, marginTop: 12 }}>
                  <TrendingUp size={12} color={COLORS.tealBright} style={{ flexShrink: 0 }} />
                  <span style={{ fontSize: 12.5, color: COLORS.foamDim }}>{calibrationLabel(calibration)}</span>
                </div>
              ) : null}

              {/* Every number here is a model output, and a model is a guess. Two days out the
                  major models agree within inches; seven days out they can differ by a factor of
                  two, and showing that as one confident number is misleading exactly when it
                  matters. Only rendered when they actually disagree. */}
              {agreement && agreement.level !== 'high' && !stale ? (
                <div className="flex items-center" style={{ gap: 7, marginTop: 12 }}>
                  <AlertTriangle size={12} color={agreement.level === 'low' ? COLORS.coral : COLORS.gold} style={{ flexShrink: 0 }} />
                  <span style={{ fontSize: 12.5, color: COLORS.foamDim }}>{agreement.label}</span>
                </div>
              ) : null}

              {waterC != null && !stale ? (
                <div className="flex items-center" style={{ gap: 7, marginTop: 12 }}>
                  <Thermometer size={13} color={COLORS.foamDim} style={{ flexShrink: 0 }} />
                  <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13, color: COLORS.foam }}>
                    {units === 'metric' ? Math.round(waterC) + '°C' : Math.round(cToF(waterC)) + '°F'}
                  </span>
                  {wetsuit ? <span style={{ fontSize: 12.5, color: COLORS.foamDim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{wetsuit}</span> : null}
                </div>
              ) : null}
            </>
          )}

          {spot.swellWindow ? (
            <div style={{ fontSize: 12.5, color: COLORS.foamDim, marginTop: 12, fontFamily: 'JetBrains Mono, monospace' }}>
              Needs {degToCompass(arcCentre(spot.swellWindow[0], spot.swellWindow[1]))} swell
              {spot.bestTide && spot.bestTide !== 'all' ? ' · best at ' + spot.bestTide + ' tide' : ''}
            </div>
          ) : null}
          {/* True whether or not the forecast loaded, so it shows in every state. */}
          <div style={{ fontSize: 15, color: COLORS.foamDim, marginTop: 12, lineHeight: 1.45 }}>{spot.blurb}</div>

          <a
            className="tl-btn flex items-center" href={directionsUrl(spot)} target="_blank" rel="noopener noreferrer"
            style={{ gap: 9, marginTop: 10, minHeight: 44, textDecoration: 'none', borderTop: '1px solid ' + COLORS.navyBorder, paddingTop: 4 }}
          >
            <MapPin size={17} color={COLORS.tealBright} style={{ flexShrink: 0 }} />
            <span style={{ fontSize: 15, fontWeight: 600, color: COLORS.tealBright }}>Directions</span>
            <span style={{ fontSize: 13.5, color: COLORS.foamDim }}>opens in Maps</span>
          </a>
        </div>
      </div>

      {/* Logging what you actually surfed. The value is not the diary: each entry keeps the
          rating the app gave at the time, so over a season you can see whether the rating is
          worth anything at your spots. See lib/sessions.js. */}
      <div className="mx-4" style={{ marginTop: 14 }}>
        {logging ? (
          <div style={{ background: COLORS.navyCard, border: '1px solid ' + COLORS.navyBorder, borderRadius: 10, padding: '12px 14px' }}>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11.5, letterSpacing: '0.1em', color: COLORS.foamDim, fontWeight: 700, marginBottom: 8 }}>HOW WAS IT?</div>
            <div className="flex items-center" style={{ marginBottom: 8 }}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} className="tl-btn" aria-label={n + ' stars'} onClick={() => setStars(n)} style={{ ...TAP, minWidth: 46 }}>
                  <Star size={22} color={n <= stars ? COLORS.gold : COLORS.navyBorder} fill={n <= stars ? COLORS.gold : 'none'} />
                </button>
              ))}
            </div>
            <input
              value={note} onChange={(e) => setNote(e.target.value)} maxLength={280}
              placeholder="Anything worth remembering?"
              style={{ width: '100%', background: 'rgba(0,0,0,0.25)', border: '1px solid ' + COLORS.navyBorder, borderRadius: 6, padding: '11px 10px', color: COLORS.foam, fontSize: 15, marginBottom: 10, boxSizing: 'border-box' }}
            />
            <div className="flex items-center" style={{ gap: 8 }}>
              <button className="tl-btn" onClick={submitLog} style={{ background: COLORS.foam, color: COLORS.navy, border: 'none', borderRadius: 8, minHeight: 44, padding: '0 18px', fontSize: 14.5, fontWeight: 600 }}>Save</button>
              <button className="tl-btn" onClick={() => setLogging(false)} style={{ background: 'none', color: COLORS.foamDim, border: '1px solid ' + COLORS.navyBorder, borderRadius: 8, minHeight: 44, padding: '0 18px', fontSize: 14.5 }}>Cancel</button>
            </div>
          </div>
        ) : (
          <button className="tl-btn flex items-center justify-center" onClick={() => setLogging(true)} style={{ gap: 7, width: '100%', minHeight: 46, background: 'none', border: '1px solid ' + COLORS.navyBorder, borderRadius: 10, color: COLORS.foamDim, fontSize: 14 }}>
            <Plus size={15} /> Log a session here
          </button>
        )}
      </div>

      {/* The only measurement on this page. Everything else is a model's opinion about the
          future; this is an instrument in the water reporting what the ocean is doing right
          now, which is what lets someone judge how much to trust today's forecast. */}
      {buoy ? (
        <div className="mx-4" style={{ marginTop: 14, background: COLORS.navyCard, border: '1px solid ' + COLORS.navyBorder, borderRadius: 10, padding: '12px 14px' }}>
          <div className="flex items-center justify-between" style={{ marginBottom: 7 }}>
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11.5, letterSpacing: '0.1em', color: COLORS.foamDim, fontWeight: 700 }}>LIVE BUOY {buoy.station}</span>
            <span style={{ fontSize: 12, color: COLORS.foamDim }}>{buoy.km}km · {formatAge(buoy.ageMinutes)}</span>
          </div>
          <div className="flex items-baseline" style={{ gap: 9 }}>
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 22, color: COLORS.foam }}>
              {formatWaveNum(buoy.waveFt, units)}{heightUnit(units)}
            </span>
            {buoy.period ? <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 14, color: COLORS.foamDim }}>{buoy.period}s</span> : null}
            {buoy.dirDeg != null ? <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 14, color: COLORS.foamDim }}>{degToCompass(buoy.dirDeg)}</span> : null}
          </div>
          {h && compareLabel(compareToForecast(buoy.waveFt, waveAvg(h.wave))) ? (
            <div style={{ fontSize: 12.5, color: COLORS.foamDim, marginTop: 5 }}>
              {compareLabel(compareToForecast(buoy.waveFt, waveAvg(h.wave)))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mx-4" style={{ marginTop: 14, background: COLORS.navyCard, border: '1px solid ' + COLORS.navyBorder, borderRadius: 10, padding: '12px 14px' }}>
        <div className="flex items-center justify-between" style={{ marginBottom: 5 }}>
          <span style={{ fontSize: 12, color: COLORS.foamDim, letterSpacing: '0.08em', fontWeight: 600 }}>WAVE HEIGHT TODAY</span>
          {h ? <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13, color: COLORS.foamDim }}>{formatWaveRange(h.wave, units)}{heightUnit(units)} now</span> : null}
        </div>
        {hourData && waveChart ? (
          <>
            <svg viewBox="0 0 300 56" style={{ width: '100%', height: 48 }}>
              <path d={waveChart.d} fill="none" stroke={COLORS.tealBright} strokeWidth="2" />
              {waveChart.pts.map((p, i) => (
                <circle key={i} cx={p[0]} cy={p[1]} r={i === hourIdx ? 4 : 2.5} fill={i === hourIdx ? COLORS.coral : COLORS.foamDim} style={{ cursor: 'pointer' }} onClick={() => setHourIdx(i)} />
              ))}
            </svg>
            <div className="flex justify-between" style={{ marginTop: 3 }}>
              {hourData.map((hr, i) => (
                <span key={hr.t} style={{ fontSize: 12, color: i === hourIdx ? COLORS.foam : COLORS.foamDim, fontWeight: i === hourIdx ? 600 : 400, fontFamily: 'JetBrains Mono, monospace' }}>{hr.t}</span>
              ))}
            </div>
          </>
        ) : (
          <EmptyChart height={62} label={dataState === 'loading' ? 'Loading today…' : 'No data for today yet'} loading={dataState === 'loading'} />
        )}
      </div>

      <div className="mx-4" style={{ marginTop: 10, background: COLORS.navyCard, border: '1px solid ' + COLORS.navyBorder, borderRadius: 10, padding: '12px 14px' }}>
        <div className="flex items-center justify-between" style={{ marginBottom: 5 }}>
          <span style={{ fontSize: 12, color: COLORS.foamDim, letterSpacing: '0.08em', fontWeight: 600 }}>WAVE HEIGHT THIS WEEK</span>
          {contData ? (
            <div className="flex items-center" style={{ gap: 9 }}>
              <span className="flex items-center" style={{ gap: 4, fontSize: 11, color: COLORS.foamDim }}><span style={{ width: 10, height: 2, background: COLORS.tealBright, display: 'inline-block', borderRadius: 1 }} />height</span>
              <span className="flex items-center" style={{ gap: 4, fontSize: 11, color: COLORS.foamDim }}><span style={{ width: 10, height: 0, borderTop: '1.5px dashed ' + COLORS.gold, display: 'inline-block' }} />tide</span>
              <span className="flex items-center" style={{ gap: 4, fontSize: 11, color: COLORS.foamDim }}><span style={{ width: 10, height: 0, borderTop: '1.5px dotted ' + COLORS.coral, display: 'inline-block' }} />wind</span>
            </div>
          ) : null}
        </div>
        {contData && contWaveLine ? (
          <>
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
                let nearest = 0, best2 = Infinity;
                contWaveLine.pts.forEach((pt, i) => { const d = Math.abs(pt[0] - x); if (d < best2) { best2 = d; nearest = i; } });
                setContSelectedIdx(nearest);
              }} />
            </svg>
            <div style={{ position: 'relative', height: 15, marginTop: 1 }}>
              {contData.map((p, i) => p.dayStart && (
                <span key={'dl' + i} style={{ position: 'absolute', left: (contWaveLine.pts[i][0] / 300) * 100 + '%', transform: 'translateX(-50%)', fontSize: 11.5, color: COLORS.foamDim, fontFamily: 'JetBrains Mono, monospace' }}>{p.day}</span>
              ))}
            </div>
            <div style={{ marginTop: 4, fontSize: 12.5, color: contSelected ? COLORS.foam : COLORS.foamDim, fontFamily: 'JetBrains Mono, monospace', minHeight: 16 }}>
              {contSelected ? (contSelected.day + ' ' + hourLabel12(contSelected.hour) + ' · ' + formatWaveNum(contSelected.waveFt, units) + heightUnit(units) + (contSelected.tideFt != null ? ' · ' + formatHeight(contSelected.tideFt, units) + heightUnit(units) + ' tide' : '') + (contSelected.windSpd != null ? ' · ' + formatSpeed(contSelected.windSpd, units) + speedUnit(units) + ' ' + degToCompass(contSelected.windDeg) : '')) : 'Tap the chart for a specific time'}
            </div>
          </>
        ) : (
          <EmptyChart height={78} label={dataState === 'loading' ? 'Loading this week…' : 'No data for this week yet'} loading={dataState === 'loading'} />
        )}
      </div>

      {hourData ? (
        <div className="flex overflow-x-auto no-scrollbar px-4" style={{ gap: 8, marginTop: 14 }}>
          {hourData.map((hr, i) => {
            const selected = i === hourIdx;
            return (
              <button key={hr.t} className="tl-btn flex flex-col items-center justify-end" onClick={() => setHourIdx(i)}
                style={{ background: selected ? COLORS.foamFaint : 'transparent', border: 'none', borderRadius: 14, padding: '8px 0 7px', minWidth: 48, minHeight: 64, flexShrink: 0 }}>
                <div style={{ width: 7, height: barHeight(hr.wave), background: ratingBg(hr.rating), borderRadius: 4, marginBottom: 8 }} />
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: selected ? COLORS.foam : COLORS.foamDim, fontWeight: selected ? 600 : 400 }}>{hr.t}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="grid grid-cols-3 px-4" style={{ gap: 8, marginTop: 14, paddingBottom: 14 }}>
        <Stat label="SWELL" value={h ? formatWaveRange(h.wave, units) + heightUnit(units) : null} sub={h ? h.period + 's ' + h.swellDir : null} />
        <Stat label="WIND" value={h ? formatSpeed(h.windSpd, units) + speedUnit(units) : null} sub={h ? h.windDir + ' · ' + h.type : null} subColor={h ? windColor(h.type) : null} />
        <div style={{ background: COLORS.navyCard, border: '1px solid ' + COLORS.navyBorder, borderRadius: 10, padding: '10px 11px' }}>
          <div style={{ fontSize: 11.5, color: COLORS.foamDim, letterSpacing: '0.08em', fontWeight: 600 }}>TIDE</div>
          <div style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, fontSize: 18, color: tideToday ? COLORS.foam : COLORS.foamDim, marginTop: 5 }}>
            {tideToday && tideToday[hourIdx] != null ? formatHeight(tideToday[hourIdx], units) + heightUnit(units) : '—'}
          </div>
          {tide ? (
            <svg viewBox="0 0 100 34" style={{ width: '100%', height: 20, marginTop: 3 }}>
              <path d={tide.d} fill="none" stroke={COLORS.foamDim} strokeWidth="1.5" />
              {tide.pts[hourIdx] ? <circle cx={tide.pts[hourIdx][0]} cy={tide.pts[hourIdx][1]} r="2.6" fill={COLORS.coral} /> : null}
            </svg>
          ) : null}
          <div style={{ fontSize: 11, color: COLORS.foamDim, marginTop: 2 }}>{tideNext ? 'Next ' + tideNext.type + ' ' + hourLabel12(tideNext.hour) : 'Tide unavailable'}</div>
        </div>
      </div>
    </>
  );
}

function Stat({ label, value, sub, subColor }) {
  return (
    <div style={{ background: COLORS.navyCard, border: '1px solid ' + COLORS.navyBorder, borderRadius: 10, padding: '10px 11px' }}>
      <div style={{ fontSize: 11.5, color: COLORS.foamDim, letterSpacing: '0.08em', fontWeight: 600 }}>{label}</div>
      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, fontSize: 18, color: value ? COLORS.foam : COLORS.foamDim, marginTop: 5 }}>{value || '—'}</div>
      {sub ? <div style={{ fontSize: 11.5, color: subColor || COLORS.foamDim, marginTop: 2, fontWeight: subColor ? 600 : 400 }}>{sub}</div> : null}
    </div>
  );
}

// Nothing has arrived yet. Bars where the numbers will land, so the layout does not jump when
// they do -- and so the screen says "working on it" without saying anything about the surf.
function Skeleton() {
  const bar = (w, h2, mt) => <div className="tl-pulse" style={{ width: w, height: h2, marginTop: mt, background: 'rgba(244,247,246,0.09)', borderRadius: 5 }} />;
  return (
    <>
      <div className="flex items-center" style={{ gap: 8 }}>
        <span style={{ background: '#33465C', color: COLORS.foamDim, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 12, letterSpacing: '0.08em', padding: '4px 9px', borderRadius: 4 }}>CHECKING…</span>
      </div>
      {bar(148, 50, 14)}
      {bar(190, 13, 18)}
      {bar(150, 13, 9)}
      {bar(118, 13, 9)}
    </>
  );
}

// The fetch failed and there is no earlier reading to fall back on. This says so, and offers
// the one useful action, rather than filling the space with invented numbers.
function NoForecast({ retry, reason }) {
  return (
    <>
      <div className="flex items-center" style={{ gap: 9 }}>
        <AlertTriangle size={17} color={COLORS.gold} style={{ flexShrink: 0 }} />
        <span style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 17, fontWeight: 600, color: COLORS.foam }}>No forecast right now</span>
      </div>
      <div style={{ fontSize: 15, color: COLORS.foamDim, marginTop: 9, lineHeight: 1.45 }}>
        {reason || 'Couldn\u2019t reach the forecast service.'} Nothing here is a guess — better to show you nothing than a number we made up.
      </div>
      <button className="tl-btn flex items-center justify-center" onClick={retry} style={{ gap: 9, marginTop: 14, width: '100%', minHeight: 48, background: COLORS.foam, color: COLORS.navy, border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 600 }}>
        <RefreshCw size={17} /> Try again
      </button>
    </>
  );
}

// The refresh failed but a real reading from earlier survives. Showing it beats showing
// nothing, as long as nobody can mistake it for current -- hence the label, the age in words
// rather than a bare timestamp, and the smaller, dimmer numbers below.
function StaleHeader({ fetchedAt, retry }) {
  const age = fetchedAt ? formatAge(Math.max(0, Math.round((Date.now() - fetchedAt) / 60000))) : null;
  return (
    <>
      <div className="flex items-center justify-between" style={{ gap: 8 }}>
        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 12, letterSpacing: '0.08em', color: COLORS.gold }}>LAST KNOWN</span>
        {age ? <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: COLORS.foamDim }}>{age}</span> : null}
      </div>
      <div style={{ fontSize: 13.5, color: COLORS.foamDim, marginTop: 7, lineHeight: 1.4 }}>
        Couldn&apos;t refresh. Conditions move — check the water before you commit.
      </div>
      <button className="tl-btn flex items-center justify-center" onClick={retry} style={{ gap: 8, marginTop: 10, width: '100%', minHeight: 44, background: 'rgba(0,0,0,0.22)', color: COLORS.foam, border: '1px solid ' + COLORS.navyBorder, borderRadius: 8, fontSize: 14, fontWeight: 600 }}>
        <RefreshCw size={15} /> Try again
      </button>
    </>
  );
}

function EmptyChart({ height, label, loading }) {
  return (
    <div
      className={loading ? 'tl-pulse' : ''}
      style={{
        height, marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: loading ? 'none' : '1px dashed rgba(244,247,246,0.22)',
        background: loading ? 'rgba(244,247,246,0.09)' : 'none',
        borderRadius: 8, color: COLORS.foamDim, fontSize: 13,
      }}
    >
      {loading ? '' : label}
    </div>
  );
}
