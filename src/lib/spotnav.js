// Which spot the arrows on the spot page go to next.
//
// They used to step through `order`, which is the catalog's own list -- roughly the sequence
// spots were added in. On screen that reads as arbitrary: from Lower Trestles in California the
// next arrow went to Blacks Beach, then Rincon, then The Wedge, then Pipeline in Hawaii and
// Teahupo'o in Tahiti. Nobody comparing surf is asking "what was entered after this one"; they
// are asking what else is nearby.
//
// So the arrows walk the catalog ordered by distance from an anchor -- the spot you arrived at
// by searching, tapping the globe, or opening your go-to. Pressing forward repeatedly fans out
// from there: nearest, second nearest, third.
//
// Ordering by distance from a fixed anchor rather than chaining nearest-to-current is what makes
// the arrows reversible. Chaining looks natural for one press and then traps you: from A the
// nearest is B, and from B the nearest is very often A again, so the arrows bounce between two
// spots forever. An anchor gives one stable sequence that back steps through exactly as it came.

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

// `ids` ordered by how far each spot is from the anchor, the anchor itself first.
//
// Anything without usable coordinates keeps its original relative position at the end rather
// than being dropped: an arrow that silently skips a spot you added is worse than one that
// visits it late.
export function nearestFirst(spots, ids, anchorId) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const anchor = spots && spots[anchorId];
  if (!anchor || !Number.isFinite(anchor.lat) || !Number.isFinite(anchor.lon)) return ids.slice();

  const located = [];
  const unlocated = [];
  ids.forEach((id, i) => {
    const s = spots[id];
    if (!s) return;
    if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon)) { unlocated.push({ id, i }); return; }
    located.push({ id, i, km: id === anchorId ? -1 : distanceKm(anchor.lat, anchor.lon, s.lat, s.lon) });
  });
  // Ties broken by the original index so the sequence is the same every time it is built --
  // two spots on the same beach must not swap places between one press and the next.
  located.sort((a, b) => a.km - b.km || a.i - b.i);
  unlocated.sort((a, b) => a.i - b.i);
  return [...located.map((e) => e.id), ...unlocated.map((e) => e.id)];
}

// The id `delta` steps away from `currentId` along that ordering, wrapping at both ends.
export function stepNearest(spots, ids, anchorId, currentId, delta) {
  const ordered = nearestFirst(spots, ids, anchorId);
  if (ordered.length === 0) return null;
  const at = ordered.indexOf(currentId);
  // Not in the list at all (a spot just removed, say): start from the anchor's own position.
  const from = at === -1 ? 0 : at;
  return ordered[(from + delta + ordered.length * Math.abs(delta || 1)) % ordered.length];
}
