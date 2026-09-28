import { useState } from 'react';
import { X, Search } from 'lucide-react';
import { COLORS } from '../lib/colors.js';
import { formatWaveNum, heightUnit, leadTimeLabel, hourLabel12 } from '../lib/format.js';
import { yourSpotIds, searchCatalog, DAY_LABELS } from '../lib/spots.js';
import { DEFAULT_WINDOW, ALL_DAYS } from '../lib/alerts.js';
import { boardLabel, skillLabel, DEFAULT_PROFILE } from '../lib/surfer.js';

const LABEL = { fontSize: 10.5, color: COLORS.foamDim, letterSpacing: '0.06em', fontWeight: 600, marginBottom: 8 };
// The hours a window can start or end on. Nobody surfs by headlamp, and the forecast's
// three-hourly samples past nine at night would only ever say "dark".
const HOURS = Array.from({ length: 18 }, (_, i) => i + 4); // 4a .. 9p
function pill(on) {
  return { flex: 1, background: on ? COLORS.tealBright : COLORS.navy, color: on ? COLORS.navy : COLORS.foam, border: 'none', borderRadius: 10, padding: '9px 0', fontSize: 12.5, fontWeight: 600, minHeight: 40 };
}

export function AlertSheet({ order, spots, goToId, savedIds = [], alertDraft, setAlertDraft, units, saveAlert, onClose, surferProfile = DEFAULT_PROFILE }) {
  // Nothing typed lists what is actually yours -- the go-to spot and anything you added --
  // and typing reaches the rest of the catalog. `order` starts as the entire built-in
  // catalog (see lib/spots.js), so showing it as-is here was a single-row horizontal strip
  // of every one of those spots with nothing to filter it: the very problem ProfileView's
  // go-to picker solved once already, reappearing in the one other place a spot gets chosen
  // from scratch instead of by tapping something already on screen.
  const [spotQuery, setSpotQuery] = useState('');
  const catalogSize = Object.keys(spots).length;
  // The go-to spot and anything added -- not the same thing as whatever this particular alert
  // is currently set to. Picking a spot via search (below) does not change your go-to spot, so
  // once someone has searched for one that is neither their go-to nor something they added,
  // clearing the query back to this list would show nothing selected at all -- the tap
  // registered (saveAlert gets the right id either way) but the sheet looked like it had not.
  // Pinning the current selection in front, when it is not here already, keeps this list
  // answering "what will this alert watch" rather than only "what is generally mine".
  const favoriteSpots = yourSpotIds(order, spots, goToId, savedIds);
  const spotChoices = spotQuery.trim().length >= 2
    ? searchCatalog(spots, spotQuery, 8).map((m) => m.id)
    : spots[alertDraft.spotId] && !favoriteSpots.includes(alertDraft.spotId)
      ? [alertDraft.spotId, ...favoriteSpots]
      : favoriteSpots;

  const isRating = alertDraft.kind === 'rating';
  const minRating = alertDraft.minRating || 'GOOD';
  const fromHour = Number.isFinite(alertDraft.fromHour) ? alertDraft.fromHour : DEFAULT_WINDOW.fromHour;
  const toHour = Number.isFinite(alertDraft.toHour) ? alertDraft.toHour : DEFAULT_WINDOW.toHour;
  const days = Array.isArray(alertDraft.days) ? alertDraft.days : ALL_DAYS;
  // A rating alert with no days could never fire; that is a mistake to stop, not to save.
  const canSave = !isRating || days.length > 0;

  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(5,12,20,0.6)', display: 'flex', alignItems: 'flex-end', zIndex: 10 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', background: COLORS.navyCard, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: '18px 20px 26px', maxHeight: '85%', overflowY: 'auto' }}>
        <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
          <h2 style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, fontSize: 16, color: COLORS.foam, margin: 0 }}>New alert</h2>
          <button className="tl-btn" onClick={onClose} style={{ background: 'none', border: 'none', padding: 4 }}><X size={18} color={COLORS.foamDim} /></button>
        </div>

        <div style={{ fontSize: 10.5, color: COLORS.foamDim, letterSpacing: '0.06em', fontWeight: 600, marginBottom: 8 }}>SPOT</div>
        <div className="flex items-center" style={{ gap: 10, minHeight: 46, background: COLORS.navy, border: '1px solid ' + COLORS.foamFaint, borderRadius: 12, padding: '0 13px', marginBottom: 8 }}>
          <Search size={17} color={COLORS.foamDim} style={{ flexShrink: 0 }} />
          <input
            className="tl-input" value={spotQuery} onChange={(e) => setSpotQuery(e.target.value)}
            placeholder={'Search ' + catalogSize + ' spots…'} aria-label="Search spots for this alert"
            style={{ flex: 1, minWidth: 0, background: 'none', border: 'none', color: COLORS.foam, fontSize: 14, padding: '12px 0' }} />
          {spotQuery ? (
            <button className="tl-btn" onClick={() => setSpotQuery('')} aria-label="Clear search"
              style={{ background: 'none', border: 'none', padding: 4, minWidth: 32, minHeight: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <X size={15} color={COLORS.foamDim} />
            </button>
          ) : null}
        </div>
        <div role="group" aria-label="Spot choices" style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
          {spotChoices.length === 0 ? (
            <div style={{ fontSize: 12.5, color: COLORS.foamDim, padding: '6px 2px' }}>No spot matches that.</div>
          ) : spotChoices.map((id) => {
            const s = spots[id];
            const selected = alertDraft.spotId === id;
            return (
              <button key={id} className="tl-btn" onClick={() => { setAlertDraft({ ...alertDraft, spotId: id }); setSpotQuery(''); }}
                aria-pressed={selected}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', borderRadius: 10, padding: '9px 13px',
                  background: selected ? 'rgba(57,230,196,0.10)' : COLORS.navy,
                  border: '1px solid ' + (selected ? COLORS.tealBright : COLORS.navyBorder),
                }}>
                <span style={{ display: 'block', fontFamily: 'Space Grotesk, sans-serif', fontWeight: 600, fontSize: 13.5, color: COLORS.foam }}>{s.name}</span>
                <span style={{ display: 'block', fontSize: 11, color: COLORS.foamDim, marginTop: 1 }}>{s.region}</span>
              </button>
            );
          })}
        </div>

        <div style={LABEL}>ALERT ME WHEN</div>
        <div className="flex" role="group" aria-label="Alert kind" style={{ gap: 8, marginBottom: 16 }}>
          <button className="tl-btn" aria-pressed={isRating} onClick={() => setAlertDraft({ ...alertDraft, kind: 'rating' })} style={pill(isRating)}>It's good for me</button>
          <button className="tl-btn" aria-pressed={!isRating} onClick={() => setAlertDraft({ ...alertDraft, kind: 'size' })} style={pill(!isRating)}>It hits a size</button>
        </div>

        {isRating ? (
          <>
            <div className="flex" role="group" aria-label="Minimum rating" style={{ gap: 8, marginBottom: 8 }}>
              {[['GOOD', 'Good or better'], ['FIRING', 'Firing only']].map(([r, label]) => (
                <button key={r} className="tl-btn" aria-pressed={minRating === r} onClick={() => setAlertDraft({ ...alertDraft, minRating: r })} style={pill(minRating === r)}>{label}</button>
              ))}
            </div>
            <div style={{ fontSize: 11.5, color: COLORS.foamDim, marginBottom: 16, lineHeight: 1.45 }}>
              Rated for your {boardLabel(surferProfile.board).toLowerCase()} at {skillLabel(surferProfile.skill).toLowerCase()} level: the same rating the app shows you. Change it in Profile.
            </div>

            <div style={LABEL}>HOURS YOU CAN SURF</div>
            <div className="flex items-center" style={{ gap: 8, marginBottom: 16 }}>
              <select className="tl-input" aria-label="From" value={fromHour}
                onChange={(e) => { const v = Number(e.target.value); setAlertDraft({ ...alertDraft, fromHour: v, toHour: Math.max(v, toHour) }); }}
                style={SELECT}>
                {HOURS.map((h) => <option key={h} value={h}>{hourLabel12(h)}</option>)}
              </select>
              <span style={{ color: COLORS.foamDim, fontSize: 13 }}>to</span>
              <select className="tl-input" aria-label="To" value={toHour}
                onChange={(e) => { const v = Number(e.target.value); setAlertDraft({ ...alertDraft, toHour: v, fromHour: Math.min(v, fromHour) }); }}
                style={SELECT}>
                {HOURS.map((h) => <option key={h} value={h}>{hourLabel12(h)}</option>)}
              </select>
            </div>

            <div style={LABEL}>DAYS YOU CAN SURF</div>
            <div className="flex" role="group" aria-label="Days you can surf" style={{ gap: 5, marginBottom: 6 }}>
              {DAY_LABELS.map((label, d) => {
                const on = days.includes(d);
                return (
                  <button key={label} className="tl-btn" aria-pressed={on} aria-label={label}
                    onClick={() => setAlertDraft({ ...alertDraft, days: toggleDay(days, d) })}
                    style={{ ...pill(on), fontSize: 11.5, padding: '9px 0' }}>
                    {label.charAt(0)}
                  </button>
                );
              })}
            </div>
            <div className="flex" style={{ gap: 14, marginBottom: 16 }}>
              {[['Every day', ALL_DAYS], ['Weekdays', [1, 2, 3, 4, 5]], ['Weekends', [0, 6]]].map(([label, set]) => (
                <button key={label} className="tl-btn" onClick={() => setAlertDraft({ ...alertDraft, days: set })}
                  style={{ background: 'none', border: 'none', padding: '6px 0', minHeight: 32, color: COLORS.tealBright, fontSize: 12, fontWeight: 600 }}>
                  {label}
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
          <div style={{ fontSize: 10.5, color: COLORS.foamDim, letterSpacing: '0.06em', fontWeight: 600, marginBottom: 8 }}>MINIMUM WAVE HEIGHT</div>
          <div className="flex" style={{ gap: 8, marginBottom: 16 }}>
            {[2, 3, 4, 5, 6].map((ft) => (
              <button key={ft} className="tl-btn" onClick={() => setAlertDraft({ ...alertDraft, minWaveFt: ft })}
                style={{ flex: 1, background: alertDraft.minWaveFt === ft ? COLORS.tealBright : COLORS.navy, color: alertDraft.minWaveFt === ft ? COLORS.navy : COLORS.foam, border: 'none', borderRadius: 10, padding: '9px 0', fontSize: 12.5, fontWeight: 600 }}>
                {formatWaveNum(ft, units)}{heightUnit(units)}+
              </button>
            ))}
          </div>
          </>
        )}

        <div style={{ fontSize: 10.5, color: COLORS.foamDim, letterSpacing: '0.06em', fontWeight: 600, marginBottom: 8 }}>NOTIFY ME</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
          {['1h', '1d', '2d', '3d'].map((lt) => (
            <button key={lt} className="tl-btn" onClick={() => setAlertDraft({ ...alertDraft, leadTime: lt })}
              style={{ background: alertDraft.leadTime === lt ? COLORS.tealBright : COLORS.navy, color: alertDraft.leadTime === lt ? COLORS.navy : COLORS.foam, border: 'none', borderRadius: 10, padding: '10px 13px', fontSize: 13, fontWeight: 600, textAlign: 'left' }}>
              {leadTimeLabel(lt)}
            </button>
          ))}
        </div>

        <button className="tl-btn" onClick={saveAlert} disabled={!canSave} style={{ width: '100%', background: COLORS.tealBright, border: 'none', borderRadius: 12, padding: '11px 13px', color: COLORS.navy, fontWeight: 700, fontSize: 14, opacity: canSave ? 1 : 0.45 }}>
          {canSave ? 'Save alert' : 'Pick at least one day'}
        </button>
      </div>
    </div>
  );
}

const SELECT = { flex: 1, minHeight: 44, background: COLORS.navy, color: COLORS.foam, border: '1px solid ' + COLORS.navyBorder, borderRadius: 10, padding: '0 10px', fontSize: 14 };

function toggleDay(days, d) {
  return days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort((a, b) => a - b);
}

