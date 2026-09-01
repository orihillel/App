import { waveAvg } from './format.js';

// Whether an alert's condition is met in a spot's forecast, and a human-readable reason why
// or why not. Pure — no React, no fetch — so it's shared between the client (checks live data
// while the tab is open, in App.jsx) and the push-notification Worker (checks in the
// background on a schedule; see worker/src/index.js). Keeping this one function shared means
// "would this alert fire" can never drift between the two.
export function checkAlertMatch(alert, spotForecast) {
  const sf = spotForecast;
  if (!sf) return null;
  if (alert.leadTime === '1h') {
    const hit = (sf.hours || []).find((hr) => waveAvg(hr.wave) >= alert.minWaveFt);
    return hit ? { hit: true, text: 'Matches today at ' + hit.t } : { hit: false, text: "No match in today's forecast" };
  }
  const offset = { '1d': 1, '2d': 2, '3d': 3 }[alert.leadTime] || 1;
  const cont = sf.continuous || [];
  // Each day has exactly 8 three-hourly samples (24hrs / 3), in order from today (offset 0).
  const daySamples = cont.slice(offset * 8, offset * 8 + 8);
  if (!daySamples.length) {
    const day = (sf.weekly || [])[offset];
    return day ? { hit: false, text: 'No wind data that far out yet — ' + day.day + ' wave-only: ' + Math.round(day.waveFt) + 'ft' } : null;
  }
  // Wave height threshold still has to be met, but now it also has to not be blown out —
  // a big number on an onshore-trashed day isn't actually a session worth an alert for.
  const hit = daySamples.find((p) => p.waveFt >= alert.minWaveFt && p.rating && p.rating !== 'POOR');
  if (hit) return { hit: true, text: 'Matches ' + hit.day + ' — ' + hit.rating.toLowerCase() + ' conditions' };
  const bigButBlownOut = daySamples.find((p) => p.waveFt >= alert.minWaveFt);
  if (bigButBlownOut) return { hit: false, text: bigButBlownOut.day + ' has the size but wind looks poor' };
  return { hit: false, text: 'No match ' + daySamples[0].day + ' yet' };
}
