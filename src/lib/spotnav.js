// Which spot the arrows on the spot page go to next.
//
// Two rules, and they are the ones you would give someone holding a map: the right arrow goes
// to the nearest spot on the eastern side, the left arrow to the nearest on the western side.
// Due north counts as east and due south as west, so the arrows still work on a coast running
// north to south -- Israel, Portugal, Chile -- where almost nothing is truly east or west of
// anything else.
//
// Two earlier attempts at this are worth recording, because both were worse in ways that were
// not obvious until the thing was used:
//
//   - stepping through the catalog's own list, which is roughly the order spots were added.
//     From Lower Trestles the next arrow went to Pipeline in Hawaii and Teahupo'o in Tahiti.
//   - ordering every spot by distance from an anchor and walking that. Forward was right, but
//     the list runs from where you stand to the far side of the planet, so pressing back at
//     the start wrapped to its last entry: Réunion, 18,500km away.
//
// Direction is what both were missing. It also makes the arrows their own inverses without any
// stored state: the spot east of you is the one you came from when you head back west.

const R_KM = 6371;
const DEG = Math.PI / 180;

// Great-circle distance. The cheap flat approximation is fine for ranking neighbours a few
// kilometres apart and wrong for the rest of a global catalog -- it has no idea the antimeridian
// wraps, so a spot in Fiji and one in Samoa come out half a planet apart.
export function distanceKm(aLat, aLon, bLat, bLon) {
  const dLat = (bLat - aLat) * DEG;
  const dLon = (bLon - aLon) * DEG;
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(aLat * DEG) * Math.cos(bLat * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

// Initial compass bearing from a to b, 0 = due north, clockwise, in degrees.
//
// Spherical rather than a longitude subtraction, which is what keeps the antimeridian honest:
// from 179°E to 179°W is a short hop east, not most of the way round the world westward.
export function bearingDeg(aLat, aLon, bLat, bLon) {
  const p1 = aLat * DEG, p2 = bLat * DEG;
  const dl = (bLon - aLon) * DEG;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(y, x) / DEG) + 360) % 360;
}

// Is `b` on the side of `a` the right arrow moves towards?
//
// The compass is split in half at the north-south line: bearings from due north round through
// east to just before due south are the eastern side. Due north is deliberately on this side
// and due south on the other, so that on a north-south coast the arrows become "up the coast"
// and "down the coast" rather than both going nowhere.
export function isEastward(bearing) {
  return bearing < 180;
}

// The nearest spot on one side of where you are: `delta > 0` for east, `delta < 0` for west.
// Returns null when that side is empty -- the app dims the arrow rather than leaving it inert.
export function stepDirection(spots, ids, currentId, delta) {
  const here = spots && spots[currentId];
  if (!here || !Number.isFinite(here.lat) || !Number.isFinite(here.lon)) return null;
  if (!Array.isArray(ids)) return null;
  const wantEast = delta > 0;

  let bestId = null;
  let bestKm = Infinity;
  for (const id of ids) {
    if (id === currentId) continue;
    const s = spots[id];
    if (!s || !Number.isFinite(s.lat) || !Number.isFinite(s.lon)) continue;
    if (s.lat === here.lat && s.lon === here.lon) continue; // no bearing to speak of
    if (isEastward(bearingDeg(here.lat, here.lon, s.lat, s.lon)) !== wantEast) continue;
    const km = distanceKm(here.lat, here.lon, s.lat, s.lon);
    if (km < bestKm) { bestKm = km; bestId = id; }
  }
  return bestId;
}
