// The app's URL, as a hash route.
//
// Until this existed there was no URL at all: every screen lived at the same address, which
// cost three things that are not obviously related but all come from the same gap. A spot could
// not be linked to or bookmarked -- there was nothing to copy. The phone's back button left the
// app instead of going back a screen, because as far as the browser was concerned nothing had
// happened. And a push notification, having gone to the trouble of telling you a specific spot
// is firing, could only open the app on whatever spot you last looked at.
//
// A hash rather than real paths because this is served from GitHub Pages under a project
// subpath, where a deep path would need the server to rewrite unknown URLs back to index.html
// and Pages will not. A hash never reaches the server, so #/spot/trestles works from a cold
// open, a bookmark, or a notification with no configuration at all.

const VIEWS = ['globe', 'alerts', 'profile', 'nearby', 'myspots'];

// Anything unrecognised is home rather than an error: these strings arrive from a person's
// address bar and an old notification as readily as from this app, and the worst outcome for
// a typo is the screen you would have got with no hash at all.
export function parseHash(hash) {
  const raw = typeof hash === 'string' ? hash.replace(/^#/, '') : '';
  const parts = raw.split('/').filter(Boolean);
  if (!parts.length) return { view: 'home', spotId: null };
  if (parts[0] === 'spot' && parts[1]) {
    let id = parts[1];
    // A malformed escape ("%zz") makes decodeURIComponent throw rather than return anything.
    try { id = decodeURIComponent(id); } catch { /* keep it raw; an unknown id is handled above */ }
    return { view: 'home', spotId: id };
  }
  if (VIEWS.includes(parts[0])) return { view: parts[0], spotId: null };
  return { view: 'home', spotId: null };
}

export function buildHash({ view, spotId } = {}) {
  if (VIEWS.includes(view)) return '#/' + view;
  if (spotId) return '#/spot/' + encodeURIComponent(spotId);
  return '#/';
}
