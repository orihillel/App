// A live cam, if one exists for this spot.
//
// There is no free, keyless, worldwide directory of surf cams to draw from -- checked before
// writing this, not assumed. Surfline runs the largest network (500+ cameras at 150 breaks) but
// it is a commercial product behind its own app and a subscription for anything beyond a
// handful of previews; Windy's webcams API covers general public webcams (traffic, ski resorts,
// beaches) rather than surf breaks specifically, needs an account and a token, and its actual
// coverage of any given break cannot be verified without signing up for it. Neither gives a
// catalog of 718 spots anything to embed.
//
// Even the 150 breaks Surfline itself covers can't be linked to reliably: their per-spot pages
// live under Surfline's own internal id, which has no relationship to this catalog's ids or
// names, and guessing at 150 of 718 URLs would put dead links next to the ones that happen to
// resolve -- worse than not offering the feature, the same reasoning that keeps a guessed
// swellWindow out of spots.catalog.js.
//
// So this is a search, not a claim that a cam exists: exactly the shape directionsUrl() already
// uses for "Directions" -- a deep link that works for every one of 718 spots because it never
// asserts anything about the destination, only asks a service to go find it. A search box is
// the most honest "maybe" this app can offer.
export function camSearchUrl(spot) {
  if (!spot || !spot.name) return null;
  const place = [spot.name, spot.region].filter(Boolean).join(', ');
  return 'https://www.google.com/search?q=' + encodeURIComponent(place + ' surf cam live');
}
