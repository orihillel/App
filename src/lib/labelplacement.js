// Deciding which map labels can actually be drawn without landing on top of each other.
//
// The globe used to show a name for every marker that faced the camera once you were closer
// than a fixed distance, on the assumption -- written into the code as a comment -- that being
// zoomed in far enough meant the names would not overlap. They do. Zoomed to a continent there
// are dozens of spots in frame and the screen fills with overlapping black pills, several deep,
// with the map invisible underneath.
//
// Nothing about a zoom threshold can fix that, because the number of labels in frame depends on
// where you are looking, not how close you are: a hundred spots crowd the Californian coast and
// four sit in the whole South Atlantic. So the question is asked per frame in screen space
// instead -- given these boxes, which of them fit? -- which is the same greedy approach a
// cartographer's label placer uses.

// Choose the labels to draw, best-first, skipping any that would collide with one already
// placed.
//
// `candidates` are `{ id, x, y, w, h, rank }` with x/y the box's top-left corner in CSS pixels
// and `rank` a priority where lower wins. Returns the ids to show, in the order placed.
//
// Greedy rather than optimal on purpose. Maximising the number of non-overlapping labels is a
// packing problem; doing it properly per frame at 60fps is not worth it, and it would also be
// the wrong answer -- a label near what you are looking at matters more than two in the corner,
// and greedy-by-priority gives exactly that.
export function placeLabels(candidates, { maxLabels = 14, padding = 2 } = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];
  const ordered = candidates.slice().sort((a, b) => a.rank - b.rank);
  const placed = [];
  const boxes = [];
  for (const c of ordered) {
    if (placed.length >= maxLabels) break;
    if (!Number.isFinite(c.x) || !Number.isFinite(c.y) || !(c.w > 0) || !(c.h > 0)) continue;
    const box = { l: c.x - padding, r: c.x + c.w + padding, t: c.y - padding, b: c.y + c.h + padding };
    let clash = false;
    for (const other of boxes) {
      if (box.l < other.r && box.r > other.l && box.t < other.b && box.b > other.t) { clash = true; break; }
    }
    if (clash) continue;
    boxes.push(box);
    placed.push(c.id);
  }
  return placed;
}

// How much a label deserves its place, lower being better.
//
// Distance from the middle of the screen, because the middle is what someone has deliberately
// zoomed in on -- that is the whole of the user-facing request this solves: show the names of
// the group I am looking at, not of every group on the globe. Clusters are offset ahead of
// single spots so a count, which stands for many spots and is unreadable as a bare dot, never
// loses its place to one name that happens to sit closer to the centre.
export function labelRank(x, y, viewportWidth, viewportHeight, { isCluster = false } = {}) {
  const dx = x - viewportWidth / 2;
  const dy = y - viewportHeight / 2;
  return Math.hypot(dx, dy) + (isCluster ? 0 : 100000);
}
