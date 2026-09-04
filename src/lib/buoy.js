// The live buoy reading for a spot, via the companion Worker.
//
// Every other number in the app is a forecast — a model's opinion about the future. This is a
// measurement: an instrument in the water, reporting what the ocean is doing right now. Showing
// it next to the forecast is the honest way to let someone judge how much to trust the model
// today, and it is the one place a small app can beat the big ones, whose advantage is cameras
// rather than data.
//
// It goes through the Worker because NDBC serves no CORS headers, so the browser cannot read it
// directly. See worker/src/buoys.js.

// Read per call rather than into a module-level const (which is how push.js does it), so the
// value can be stubbed in tests and so a build without the Worker configured degrades at the
// call rather than being baked in at import time. Reading one env var per call costs nothing.
function workerBase() {
  return import.meta.env.VITE_PUSH_API_URL;
}

export async function fetchBuoyObservation(spot) {
  // No Worker configured (the app runs perfectly well without one): no buoy panel.
  const base = workerBase();
  if (!base || !spot) return null;
  try {
    const url = base.replace(/\/$/, '') + '/buoy?lat=' + spot.lat + '&lon=' + spot.lon;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.observation ? data.observation : null;
  } catch {
    // Offline, or the Worker is down. The forecast does not depend on this.
    return null;
  }
}

// "22 min ago" / "2 hr ago" — the age matters as much as the reading. A number with no time on
// it invites being read as current when it might be hours old.
export function formatAge(minutes) {
  if (minutes == null) return null;
  if (minutes < 1) return 'just now';
  if (minutes < 60) return minutes + ' min ago';
  const hours = Math.round(minutes / 60);
  return hours + (hours === 1 ? ' hr ago' : ' hr ago');
}

// How the buoy compares with what the model predicted for right now. This is the actual value
// of showing it: not the raw number, but whether today's forecast is running true.
export function compareToForecast(observedFt, forecastFt) {
  if (observedFt == null || forecastFt == null) return null;
  const mean = (observedFt + forecastFt) / 2;
  if (!(mean > 0.01)) return 'matching';
  const diff = (observedFt - forecastFt) / mean;
  if (Math.abs(diff) <= 0.25) return 'matching';
  return diff > 0 ? 'bigger' : 'smaller';
}

export function compareLabel(comparison) {
  switch (comparison) {
    case 'matching': return 'forecast running true';
    case 'bigger': return 'running bigger than forecast';
    case 'smaller': return 'running smaller than forecast';
    default: return null;
  }
}
