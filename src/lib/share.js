import { buildHash } from './router.js';

// Sending a spot to someone.
//
// The deep links have worked since routing landed -- #/spot/trestles opens that spot from a cold
// start, a bookmark or a notification -- and nothing in the app ever offered you one. The single
// most common thing a surfer does with a forecast is send it to the person they are going with,
// and the only way to do that was to copy the address bar, which on iOS Safari in standalone
// mode is not on screen at all.

// The canonical link for a spot, absolute so it survives being pasted anywhere.
//
// Built from the page's own origin and path rather than a hard-coded domain, so a link copied
// from a local build points at the local build and a link from the deployed app points at the
// deployed app. The hash is buildHash's, not a second spelling of the same route.
export function spotUrl(spotId, { origin, pathname } = {}) {
  if (!spotId) return null;
  const loc = typeof window !== 'undefined' ? window.location : null;
  const base = (origin != null ? origin : loc && loc.origin) || '';
  const path = (pathname != null ? pathname : loc && loc.pathname) || '/';
  if (!base) return null;
  return base + path + buildHash({ spotId });
}

// What the message says. Conditions when there are any, the spot alone when there are not --
// never a placeholder, and never a rating with no numbers behind it.
export function shareText(spot, hour, { url } = {}) {
  const parts = [spot && spot.name].filter(Boolean);
  if (hour && hour.rating && hour.wave) parts.push(hour.rating + ' · ' + hour.wave + 'ft');
  else if (hour && hour.wave) parts.push(hour.wave + 'ft');
  const line = parts.join(' — ');
  return url ? line + '\n' + url : line;
}

// Outcomes, named rather than booleans, because the caller says something different for each:
// 'shared' is the OS sheet (which reports nothing about what the user picked, and a dismissal is
// not a failure), 'copied' needs a toast because nothing visible happened otherwise, and
// 'unavailable' means neither route exists and the caller should say so rather than fail silently.
export async function shareSpot(spot, hour, { nav, url } = {}) {
  const n = nav || (typeof navigator !== 'undefined' ? navigator : null);
  const link = url !== undefined ? url : spotUrl(spot && spot.id);
  if (!link) return 'unavailable';
  const text = shareText(spot, hour, {});

  if (n && typeof n.share === 'function') {
    try {
      // `url` as its own field rather than glued into `text`: the share sheet renders a link
      // preview from it, and the apps people forward to treat a real url field as a link rather
      // than as characters that happen to look like one.
      await n.share({ title: spot.name, text, url: link });
      return 'shared';
    } catch (e) {
      // AbortError is the user closing the sheet. Reporting that as a failure, or silently
      // falling back to copying, would both be wrong: they decided not to share.
      if (e && e.name === 'AbortError') return 'dismissed';
      // Anything else (a browser that advertises share and then refuses, a non-secure context)
      // falls through to the clipboard rather than dead-ending.
    }
  }

  if (n && n.clipboard && typeof n.clipboard.writeText === 'function') {
    try {
      await n.clipboard.writeText(link);
      return 'copied';
    } catch { /* falls through */ }
  }
  return 'unavailable';
}
