// The browser's location, as a promise that always resolves.
//
// navigator.geolocation predates promises and reports failure through a second callback with
// its own numeric codes, none of which mean anything to a person. It can also simply never call
// back at all -- a denied-then-ignored prompt, or a device with no fix -- so a timeout is not
// optional here.
//
// Resolves to { ok: true, lat, lon } or { ok: false, reason } rather than rejecting, because
// every caller wants to show a sentence either way and none of these are exceptional: refusing
// to share your location is an ordinary answer.
export const DEFAULT_TIMEOUT_MS = 10000;

export const REASONS = {
  unsupported: 'This browser cannot share a location.',
  denied: 'Location access was denied. You can allow it in your browser settings and try again.',
  unavailable: "Your device couldn't get a location fix right now.",
  timeout: 'Getting your location took too long.',
};

export function locate({ geo, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const api = geo || (typeof navigator !== 'undefined' ? navigator.geolocation : null);
  if (!api || typeof api.getCurrentPosition !== 'function') {
    return Promise.resolve({ ok: false, reason: 'unsupported', message: REASONS.unsupported });
  }
  return new Promise((resolve) => {
    // Whichever lands first wins. No guard against the loser arriving later: a promise resolves
    // once and ignores the rest, so a callback that turns up after the timeout cannot replace an
    // answer the screen has already acted on. A `settled` flag here would read as though it were
    // holding that guarantee up, and a mutation test that removed it changed nothing.
    const timer = setTimeout(() => resolve({ ok: false, reason: 'timeout', message: REASONS.timeout }), timeoutMs);
    const done = (value) => { clearTimeout(timer); resolve(value); };
    try {
      api.getCurrentPosition(
        (pos) => {
          const lat = pos && pos.coords ? pos.coords.latitude : NaN;
          const lon = pos && pos.coords ? pos.coords.longitude : NaN;
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
            done({ ok: false, reason: 'unavailable', message: REASONS.unavailable });
            return;
          }
          done({ ok: true, lat, lon });
        },
        (err) => {
          // 1 = PERMISSION_DENIED, 3 = TIMEOUT; everything else is "no fix".
          const code = err && err.code;
          const reason = code === 1 ? 'denied' : code === 3 ? 'timeout' : 'unavailable';
          done({ ok: false, reason, message: REASONS[reason] });
        },
        { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 5 * 60 * 1000 },
      );
    } catch {
      // Some embedded webviews throw synchronously rather than calling the error callback.
      done({ ok: false, reason: 'unsupported', message: REASONS.unsupported });
    }
  });
}
