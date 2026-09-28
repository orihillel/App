import { useState } from 'react';
import { Search, Map, Check, Bell } from 'lucide-react';
import { COLORS } from '../lib/colors.js';
import { ONBOARDING_PICKS } from '../lib/spots.js';
import { nearbyPicks } from '../lib/locale.js';
import { hasAlertsStep } from '../lib/push.js';
import { BOARD_IDS, SKILL_IDS, boardLabel, skillLabel, DEFAULT_PROFILE } from '../lib/surfer.js';

// First run, in the order the answers are useful.
//
// It used to ask one question -- your go-to spot -- and drop you on it. Two things were missing.
// Most people surf more than one break, and "which of mine is on today" is the question the
// My spots screen answers, which it could only do for spots added by hand. And every rating in
// the app is scored for a board and a level it had never asked about, so a longboarder's first
// look at the app was a shortboarder's forecast.
//
// So: spots, then board and level, then what alerts do. The browser's permission prompt comes
// only after that explanation and only on a tap, because a prompt that appears before anyone
// knows what it is for is the one people say no to, and on most browsers "no" is permanent.
// Sign-in, where the build has one, still comes before all of this (see App.jsx).

const HEADING = { fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, fontSize: 20, color: COLORS.foam, margin: 0 };
const LABEL = { fontSize: 10, color: COLORS.foamDim, letterSpacing: '0.08em', fontWeight: 600, marginBottom: 10 };
const LEAD = { fontSize: 13, color: COLORS.foamDim, marginTop: 10, lineHeight: 1.5 };
const PRIMARY = { width: '100%', background: COLORS.tealBright, color: COLORS.navy, border: 'none', borderRadius: 10, minHeight: 48, fontSize: 15, fontWeight: 700 };
const QUIET = { width: '100%', marginTop: 8, background: 'none', border: 'none', color: COLORS.foamDim, fontSize: 13, minHeight: 44, padding: 0 };
const OUTLINE = { flex: 1, gap: 6, background: 'none', border: '1px solid ' + COLORS.navyBorder, borderRadius: 10, minHeight: 46, color: COLORS.tealBright, fontWeight: 700, fontSize: 14 };

function chip(on) {
  return { background: on ? COLORS.tealBright : COLORS.navyCard, color: on ? COLORS.navy : COLORS.foam, border: '1px solid ' + (on ? COLORS.tealBright : COLORS.navyBorder), borderRadius: 8, minHeight: 44, fontSize: 14, fontWeight: 600 };
}

function Steps({ at, total }) {
  return (
    <div aria-label={'Step ' + (at + 1) + ' of ' + total} role="img" className="flex justify-center" style={{ gap: 6, marginBottom: 18 }}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} style={{ width: i === at ? 18 : 6, height: 6, borderRadius: 3, background: i === at ? COLORS.tealBright : COLORS.navyBorder }} />
      ))}
    </div>
  );
}

export function OnboardingView({
  spots, picks = [], togglePick, openSearch, openGlobePicker,
  surferProfile = DEFAULT_PROFILE, updateProfile,
  pushState, pushSubscribed = false, pushBusy = false, enablePush,
  finish,
}) {
  const [step, setStep] = useState(0);
  const withAlerts = hasAlertsStep(pushState);
  const total = withAlerts ? 3 : 2;
  const next = () => (step + 1 < total ? setStep(step + 1) : finish());

  if (step === 0) {
    // Nearby spots first, falling back to the global list wherever the catalog is too thin to
    // be useful -- see lib/locale.js. Ranked over the spots the app currently holds: the seed
    // set for the first few tens of milliseconds and the full catalog after, so the list
    // sharpens into genuinely nearby breaks once the catalog chunk lands. Anything ticked from
    // search or the globe is listed above them, so it can be seen and unticked here.
    const nearby = nearbyPicks(spots, undefined, ONBOARDING_PICKS);
    const listed = [...picks.filter((id) => !nearby.includes(id)), ...nearby].filter((id) => spots[id]);
    return (
      <div style={{ padding: '26px 24px 24px' }}>
        <Steps at={0} total={total} />
        <div style={{ textAlign: 'center', marginBottom: 22 }}>
          <h1 style={HEADING}>Pick the spots you surf</h1>
          <div style={LEAD}>Tick every break you surf. The first one you pick is your go-to — the spot the app opens on.</div>
        </div>

        <div style={LABEL}>SPOTS</div>
        <div role="group" aria-label="Spots to pick" style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
          {listed.map((id) => {
            const s = spots[id];
            const on = picks.includes(id);
            const isGoTo = picks[0] === id;
            return (
              <button key={id} className="tl-btn flex items-center" aria-pressed={on} onClick={() => togglePick(id)}
                style={{ gap: 12, background: on ? 'rgba(57,230,196,0.10)' : COLORS.navyCard, border: '1px solid ' + (on ? COLORS.tealBright : COLORS.navyBorder), borderRadius: 10, padding: '12px 14px', textAlign: 'left' }}>
                <span aria-hidden="true" style={{ width: 22, height: 22, borderRadius: 6, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: on ? COLORS.tealBright : 'none', border: '1.5px solid ' + (on ? COLORS.tealBright : COLORS.foamDim) }}>
                  {on ? <Check size={15} color={COLORS.navy} strokeWidth={3} /> : null}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontFamily: 'Space Grotesk, sans-serif', fontWeight: 600, fontSize: 14, color: COLORS.foam }}>{s.name}</span>
                  <span style={{ display: 'block', fontSize: 11, color: COLORS.foamDim, marginTop: 1 }}>{s.region}</span>
                </span>
                {isGoTo ? <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: COLORS.tealBright, flexShrink: 0 }}>GO-TO</span> : null}
              </button>
            );
          })}
        </div>

        <div className="flex" style={{ gap: 8, marginBottom: 18 }}>
          <button className="tl-btn flex items-center justify-center" onClick={openSearch} style={OUTLINE}>
            <Search size={14} /> Search by name
          </button>
          <button className="tl-btn flex items-center justify-center" onClick={openGlobePicker} style={OUTLINE}>
            <Map size={14} /> Browse the globe
          </button>
        </div>

        <button className="tl-btn" onClick={next} disabled={!picks.length} style={{ ...PRIMARY, opacity: picks.length ? 1 : 0.45 }}>
          {picks.length ? 'Continue with ' + picks.length + (picks.length === 1 ? ' spot' : ' spots') : 'Pick at least one spot'}
        </button>
        <button className="tl-btn" onClick={next} style={QUIET}>Skip for now</button>
      </div>
    );
  }

  if (step === 1) {
    return (
      <div style={{ padding: '26px 24px 24px' }}>
        <Steps at={1} total={total} />
        <div style={{ textAlign: 'center', marginBottom: 22 }}>
          <h1 style={HEADING}>What do you ride?</h1>
          <div style={LEAD}>Every rating in the app is scored for your board and level. A small day that is poor on a shortboard can be good on a longboard.</div>
        </div>

        <div style={LABEL}>YOUR BOARD</div>
        <div role="group" aria-label="Your board" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
          {BOARD_IDS.map((id) => {
            const on = surferProfile.board === id;
            return (
              <button key={id} className="tl-btn" aria-pressed={on} onClick={() => updateProfile({ board: id })} style={{ ...chip(on), padding: '0 13px' }}>
                {boardLabel(id)}
              </button>
            );
          })}
        </div>

        <div style={LABEL}>YOUR LEVEL</div>
        <div role="group" aria-label="Your level" className="flex" style={{ gap: 8, marginBottom: 22 }}>
          {SKILL_IDS.map((id) => {
            const on = surferProfile.skill === id;
            return (
              <button key={id} className="tl-btn" aria-pressed={on} onClick={() => updateProfile({ skill: id })} style={{ ...chip(on), flex: 1 }}>
                {skillLabel(id)}
              </button>
            );
          })}
        </div>

        <button className="tl-btn" onClick={next} style={PRIMARY}>Continue</button>
        <div style={{ fontSize: 12, color: COLORS.foamDim, textAlign: 'center', marginTop: 10, lineHeight: 1.5 }}>You can change this any time in Profile.</div>
        <button className="tl-btn" onClick={() => setStep(0)} style={QUIET}>Back</button>
      </div>
    );
  }

  // Alerts, explained before anything is asked for.
  return (
    <div style={{ padding: '26px 24px 24px' }}>
      <Steps at={2} total={total} />
      <div style={{ textAlign: 'center', marginBottom: 22 }}>
        <div aria-hidden="true" style={{ width: 52, height: 52, borderRadius: 999, margin: '0 auto 14px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(57,230,196,0.12)' }}>
          <Bell size={24} color={COLORS.tealBright} />
        </div>
        <h1 style={HEADING}>Know when it's on</h1>
        <div style={LEAD}>Set an alert on any of your spots, with the size you want and how far ahead, and Surfcast will tell you when the forecast gets there — even with the app closed.</div>
        <div style={LEAD}>Nothing is sent until you set an alert.</div>
      </div>

      {pushSubscribed ? (
        <>
          <div style={{ fontSize: 13, color: COLORS.tealBright, textAlign: 'center', marginBottom: 14, fontWeight: 600 }}>Notifications are on.</div>
          <button className="tl-btn" onClick={finish} style={PRIMARY}>Done</button>
        </>
      ) : pushState === 'ready' ? (
        <>
          <div style={{ fontSize: 12, color: COLORS.foamDim, textAlign: 'center', marginBottom: 14, lineHeight: 1.5 }}>Your browser will ask for permission next.</div>
          <button className="tl-btn" disabled={pushBusy}
            onClick={async () => { await enablePush(); finish(); }}
            style={{ ...PRIMARY, opacity: pushBusy ? 0.6 : 1 }}>
            {pushBusy ? 'Working…' : 'Turn on notifications'}
          </button>
          <button className="tl-btn" onClick={finish} style={QUIET}>Not now</button>
        </>
      ) : (
        // iOS keeps push away from a Safari tab and gives it only to a web app on the Home
        // Screen, so the honest thing here is the step, not a button that cannot work.
        <>
          <div style={{ fontSize: 12.5, color: COLORS.foam, background: COLORS.navyCard, border: '1px solid ' + COLORS.navyBorder, borderRadius: 10, padding: '11px 13px', marginBottom: 14, lineHeight: 1.5 }}>
            On iPhone, add Surfcast to your Home Screen first: tap Share, then Add to Home Screen. Open it from there and turn notifications on in Profile.
          </div>
          <button className="tl-btn" onClick={finish} style={PRIMARY}>Done</button>
        </>
      )}
      <button className="tl-btn" onClick={() => setStep(1)} style={QUIET}>Back</button>
    </div>
  );
}
