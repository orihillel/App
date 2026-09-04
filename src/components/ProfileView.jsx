import { X, Trash2 } from 'lucide-react';
import { COLORS } from '../lib/colors.js';
import { ORDER as SEED_ORDER } from '../lib/spots.js';
import { isAuthConfigured } from '../lib/auth.js';
import { sessionStats, ratingAccuracy } from '../lib/sessions.js';
import { ratingBg } from '../lib/rating.js';
import { AuthButtons } from './AuthButtons.jsx';

export function ProfileView({ order, spots, goToId, setGoToSpot, units, toggleUnits, alerts, openAlerts, removeSpot, onClose, onSelectSpot, pushSupported, pushSubscribed, pushBusy, togglePush, session, onLoggedIn, onLogOut, setToast, sessions = [], deleteSession }) {
  // "Your spots" used to mean the whole `order` list, back when that list was a small,
  // hand-picked seed set (a few dozen). Now that the built-in catalog itself runs into the
  // hundreds, dumping all of `order` here just re-lists the entire app -- Search and the
  // Globe are how you browse/find a spot; this section is for managing what you personally
  // added on top of that, so it's filtered down to non-seed spots only.
  const addedIds = order.filter((id) => spots[id] && !SEED_ORDER.includes(id));
  const stats = sessionStats(sessions);
  const accuracy = ratingAccuracy(sessions);
  return (
    <div>
      <div className="flex justify-between items-center px-6 pt-2 pb-3">
        <span style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, fontSize: 17, color: COLORS.foam }}>Profile</span>
        <button className="tl-btn" onClick={onClose} style={{ background: 'none', border: 'none', padding: 6 }} aria-label="Close profile"><X size={18} color={COLORS.foamDim} /></button>
      </div>

      <div style={{ padding: '0 20px' }}>
        {(session || isAuthConfigured()) && (
          <>
            <div style={{ fontSize: 10, color: COLORS.foamDim, letterSpacing: '0.08em', fontWeight: 600, marginBottom: 8 }}>ACCOUNT</div>
            {session ? (
              <div className="flex items-center justify-between" style={{ background: COLORS.navyCard, border: '1px solid ' + COLORS.navyBorder, borderRadius: 10, padding: '9px 12px', marginBottom: 18 }}>
                <div className="flex items-center" style={{ gap: 10, minWidth: 0 }}>
                  {session.profile.picture ? (
                    <img src={session.profile.picture} alt="" width={32} height={32} style={{ borderRadius: 999, flexShrink: 0 }} />
                  ) : (
                    <div style={{ width: 32, height: 32, borderRadius: 999, background: COLORS.tealBright, flexShrink: 0 }} />
                  )}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: COLORS.foam, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{session.profile.name || 'Signed in'}</div>
                    <div style={{ fontSize: 10.5, color: COLORS.tealBright, marginTop: 1 }}>Synced across your devices</div>
                  </div>
                </div>
                <button className="tl-btn" onClick={onLogOut} style={{ background: 'none', border: 'none', padding: 4, flexShrink: 0, color: COLORS.foamDim, fontSize: 11.5, fontWeight: 600 }}>Log out</button>
              </div>
            ) : (
              <div style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 11, color: COLORS.foamDim, marginBottom: 10, lineHeight: 1.4 }}>
                  Sign in to keep your go-to spot, added spots, and alerts synced across devices.
                </div>
                <AuthButtons onLoggedIn={onLoggedIn} setToast={setToast} />
              </div>
            )}
          </>
        )}

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

        <div style={{ fontSize: 10, color: COLORS.foamDim, letterSpacing: '0.08em', fontWeight: 600, marginBottom: 8 }}>PUSH NOTIFICATIONS</div>
        {pushSupported ? (
          <button className="tl-btn" onClick={togglePush} disabled={pushBusy}
            style={{ width: '100%', background: pushSubscribed ? COLORS.tealBright : COLORS.navyCard, color: pushSubscribed ? COLORS.navy : COLORS.foam, border: '1px solid ' + (pushSubscribed ? COLORS.tealBright : COLORS.navyBorder), borderRadius: 10, padding: '11px 13px', fontSize: 13, fontWeight: 600, marginBottom: 4, opacity: pushBusy ? 0.6 : 1 }}>
            {pushBusy ? 'Working…' : pushSubscribed ? 'On — get alerted even when the app is closed' : 'Off — turn on to get alerted when the app is closed'}
          </button>
        ) : (
          <div style={{ fontSize: 11, color: COLORS.foamDim, marginBottom: 4, lineHeight: 1.5 }}>Not available in this browser, or the notification backend isn't configured.</div>
        )}
        <div style={{ fontSize: 10.5, color: COLORS.foamDim, marginBottom: 18, lineHeight: 1.4 }}>
          When on, your alerts are also checked in the background and pushed to this device — not just while the app is open.
        </div>
      {/* Sessions. The list is the visible part; the reason it exists is the accuracy table
          under it, which is the only honest way to find out whether the app's rating means
          anything at the spots you actually surf. See lib/sessions.js. */}
      <div style={{ padding: '0 24px', marginTop: 22 }}>
        <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.1em', color: COLORS.foamDim, fontWeight: 700 }}>YOUR SESSIONS</span>
          {stats.total ? <span style={{ fontSize: 10.5, color: COLORS.foamDim }}>{stats.total} logged · {stats.spots} spots{stats.avgStars ? ' · ' + stats.avgStars + '★ avg' : ''}</span> : null}
        </div>
        {sessions.length === 0 ? (
          <div style={{ fontSize: 12, color: COLORS.foamDim, lineHeight: 1.4 }}>
            Nothing logged yet. Log one from a spot page and this fills in — including whether the
            rating matched what you found.
          </div>
        ) : (
          <>
            {sessions.slice(0, 8).map((entry) => (
              <div key={entry.id} className="flex items-center justify-between" style={{ padding: '8px 0', borderBottom: '1px solid ' + COLORS.navyBorder }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, color: COLORS.foam, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.spotName || 'Unknown spot'}</div>
                  <div style={{ fontSize: 10.5, color: COLORS.foamDim, marginTop: 2 }}>
                    {entry.date}{entry.rating ? ' · app said ' + entry.rating : ''}{entry.note ? ' · ' + entry.note : ''}
                  </div>
                </div>
                <div className="flex items-center" style={{ gap: 8, flexShrink: 0 }}>
                  <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: COLORS.gold }}>{'★'.repeat(entry.stars)}</span>
                  <button className="tl-btn" aria-label="Delete session" onClick={() => deleteSession && deleteSession(entry.id)} style={{ background: 'none', border: 'none', color: COLORS.foamDim, padding: 2 }}>
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
            {accuracy ? (
              <div style={{ marginTop: 12, background: COLORS.navyCard, border: '1px solid ' + COLORS.navyBorder, borderRadius: 10, padding: '10px 12px' }}>
                <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.1em', color: COLORS.foamDim, fontWeight: 700, marginBottom: 6 }}>
                  IS THE RATING RIGHT? ({accuracy.total} sessions)
                </div>
                {accuracy.rows.map((row) => (
                  <div key={row.rating} className="flex items-center justify-between" style={{ padding: '3px 0' }}>
                    <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: ratingBg(row.rating) }}>{row.rating}</span>
                    <span style={{ fontSize: 11, color: COLORS.foamDim }}>{row.avgStars}★ over {row.sessions}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </>
        )}
      </div>


        <div style={{ fontSize: 10, color: COLORS.foamDim, letterSpacing: '0.08em', fontWeight: 600, marginBottom: 8 }}>YOUR SPOTS ({addedIds.length})</div>
        {addedIds.length === 0 ? (
          <div style={{ fontSize: 11, color: COLORS.foamDim, marginBottom: 18, lineHeight: 1.5 }}>
            Spots you add show up here to manage. To browse the built-in catalog, use the search icon on Home or the globe in the bottom nav.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 18 }}>
            {addedIds.map((id) => {
              const s = spots[id];
              return (
                // A div, not a <button> -- it contains its own nested remove button below, and
                // a button can't nest inside a button. onClick + role/tabIndex make it keyboard-
                // and screen-reader-accessible as one anyway.
                <div key={id} className="tl-btn flex items-center justify-between" role="button" tabIndex={0}
                  onClick={() => onSelectSpot(id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelectSpot(id); }}
                  aria-label={'View ' + s.name}
                  style={{ background: COLORS.navyCard, border: '1px solid ' + COLORS.navyBorder, borderRadius: 10, padding: '9px 12px' }}>
                  <div>
                    <div style={{ fontSize: 13, color: COLORS.foam, fontWeight: 600 }}>{s.name}{id === goToId && <span style={{ color: COLORS.tealBright }}> ★</span>}</div>
                    <div style={{ fontSize: 10.5, color: COLORS.foamDim, marginTop: 1 }}>{s.region}</div>
                  </div>
                  <button className="tl-btn" onClick={(e) => { e.stopPropagation(); removeSpot(id); }} style={{ background: 'none', border: 'none', padding: 4 }} aria-label={'Remove ' + s.name}><X size={15} color={COLORS.foamDim} /></button>
                </div>
              );
            })}
          </div>
        )}

        <div style={{ fontSize: 10, color: COLORS.foamDim, letterSpacing: '0.08em', fontWeight: 600, marginBottom: 8 }}>DATA</div>
        <div style={{ fontSize: 11, color: COLORS.foamDim, lineHeight: 1.6, paddingBottom: 20 }}>
          Wave, swell, wind, and tide data from Open-Meteo's Marine and Weather APIs. Tide is modeled sea-level height, not an official chart-datum tide table — timing is a good guide, but exact heights may not match a nautical almanac.
        </div>
      </div>
    </div>
  );
}
