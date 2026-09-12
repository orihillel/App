// The app's mark: a curling wave, in the spirit of Hokusai's "The Great Wave off Kanagawa"
// (1831, public domain) redrawn flat and bold enough to survive being shrunk to a 32px favicon.
//
// It is a generator rather than a hand-drawn path for a specific reason: a curling wave's crest
// is a spiral whose thickness tapers three times over (thin tail, thick belly, thin curling
// lip), and hand-placing enough bezier control points to make that read convincingly took two
// tries before it looked like a wave and not a flame (see PR history). A spiral is easy to get
// right with a formula and hard to get right by eye. The handful of numbers below -- where the
// sweep starts and ends, how far it curls in, how the thickness tapers -- are the actual
// tunable "source" of this mark; the polygon math after them is not something to hand-edit.
//
// Both the app icon and the link-preview card call this, so the two always show the same wave.

const NAVY = '#070F18';
const TEAL_BRIGHT = '#39E6C4';
const TEAL = '#2FA98C';
const FOAM = '#F4F7F6';
const GOLD = '#FFC24B';

// Smoothstep taper: thin tail -> thick belly -> thin curling tip. `bellyPos` is where along the
// sweep (0..1) the belly peaks -- just under halfway, so more of the curl is the thinning lip
// than the rising face, which is what makes it read as "cresting" rather than "swelling".
function taper(t, thinStart, thick, thinEnd, bellyPos = 0.42) {
  if (t < bellyPos) {
    const u = t / bellyPos;
    return thinStart + (thick - thinStart) * (u * u * (3 - 2 * u));
  }
  const u = (t - bellyPos) / (1 - bellyPos);
  return thick + (thinEnd - thick) * (u * u * (3 - 2 * u));
}

// A tapered spiral band, as a closed polygon: walk the centreline from thetaStart to thetaEnd
// (degrees, and past 360 is fine -- that is what makes the tip curl back over the belly),
// spiralling the radius in from rStart to rEnd, and at each step lay a point on either side of
// the centreline offset by half the local width. `steps` is a rendering density, not a design
// parameter -- enough that the polygon reads as a smooth curve once rasterised, no more.
function spiralBand({ cx, cy, thetaStart, thetaEnd, rStart, rEnd, widthAt, steps = 220 }) {
  const outer = [];
  const inner = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const theta = ((thetaStart + (thetaEnd - thetaStart) * t) * Math.PI) / 180;
    const r = rStart + (rEnd - rStart) * t;
    const w = widthAt(t) / 2;
    const dx = Math.cos(theta);
    const dy = Math.sin(theta);
    const px = cx + dx * r;
    const py = cy + dy * r;
    outer.push([px + dx * w, py + dy * w]);
    inner.push([px - dx * w, py - dy * w]);
  }
  return [...outer, ...inner.reverse()];
}

function pathFrom(points) {
  return 'M ' + points.map(([x, y]) => x.toFixed(1) + ' ' + y.toFixed(1)).join(' L ') + ' Z';
}

// The centreline alone, open rather than closed -- used for the foam highlight that traces just
// inside the outer edge of the curl.
function centreline({ cx, cy, thetaStart, thetaEnd, rStart, rEnd, steps = 200 }) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const theta = ((thetaStart + (thetaEnd - thetaStart) * t) * Math.PI) / 180;
    const r = rStart + (rEnd - rStart) * t;
    pts.push([cx + Math.cos(theta) * r, cy + Math.sin(theta) * r]);
  }
  return 'M ' + pts.map(([x, y]) => x.toFixed(1) + ' ' + y.toFixed(1)).join(' L ');
}

// The mark's own geometry, in a 512x512 box, centred so it can be scaled and repositioned by
// the caller. Wrapped in a <g transform> rather than parameterising every number above, which
// would make the spiral math harder to read for no benefit -- scale-and-translate is what SVG
// transforms are for.
export function waveMarkGroup({ cx = 256, cy = 256, scale = 1 } = {}) {
  const bx = 240, by = 300; // the spiral's own centre, in the 512-box the numbers below assume

  const wave = spiralBand({
    cx: bx, cy: by,
    thetaStart: 152, thetaEnd: 430,
    rStart: 198, rEnd: 78,
    widthAt: (t) => taper(t, 26, 118, 20),
  });
  const foam = centreline({ cx: bx, cy: by, thetaStart: 150, thetaEnd: 395, rStart: 200, rEnd: 95 });

  // Two flecks of spray flicking off the curling lip -- the "claw" the reference image's
  // foam tips echo. Positioned by eye against the rendered wave rather than derived, the way
  // the sun above the crest already is.
  const claws = [
    { x: bx + Math.cos((398 * Math.PI) / 180) * 102, y: by + Math.sin((398 * Math.PI) / 180) * 102, r: 9.5 },
    { x: bx + Math.cos((420 * Math.PI) / 180) * 122, y: by + Math.sin((420 * Math.PI) / 180) * 122, r: 6.5 },
  ];

  return `<g transform="translate(${cx - 256 * scale} ${cy - 256 * scale}) scale(${scale})">
    <path d="${pathFrom(wave)}" fill="${TEAL_BRIGHT}"/>
    <path d="${foam}" fill="none" stroke="${FOAM}" stroke-width="9" stroke-linecap="round" opacity="0.92"/>
    <path d="M -20 372 C 60 340, 130 340, 190 372 C 250 404, 330 404, 390 372 C 430 350, 480 350, 532 368 L 532 560 L -20 560 Z" fill="${TEAL}" opacity="0.55"/>
    ${claws.map((c) => `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="${c.r}" fill="${FOAM}"/>`).join('\n    ')}
    <circle cx="382" cy="120" r="22" fill="${GOLD}"/>
  </g>`;
}

// How far the recognisable part of the mark -- the wave and the sun, not the decorative swell
// background -- reaches from the icon's centre, at scale 1 in the 512-unit box every icon is
// authored in. Computed from the same geometry the mark actually draws, not eyeballed, so it
// cannot go stale if the spiral's numbers above change.
const MARK_RADIUS = (() => {
  const bx = 240, by = 300, boxCentre = [256, 256];
  const dist = (x, y) => Math.hypot(x - boxCentre[0], y - boxCentre[1]);
  let max = 0;
  const wave = spiralBand({
    cx: bx, cy: by, thetaStart: 152, thetaEnd: 430, rStart: 198, rEnd: 78,
    widthAt: (t) => taper(t, 26, 118, 20),
  });
  for (const [x, y] of wave) max = Math.max(max, dist(x, y));
  max = Math.max(max, dist(382, 120) + 22); // the sun
  return max;
})();

// Android's maskable-icon safe zone is the centred circle at 40% of the icon's size (an 80%
// diameter) -- content outside it may be cropped by whatever shape the launcher masks it into.
// The regular icon is full-bleed by design (the tail and the background swell run to the edge);
// the maskable one keeps the same artwork but shrinks and centres it to clear that zone, on the
// same navy field, which is the standard way a full-bleed mark is adapted for masking.
const SAFE_ZONE_FRACTION = 0.4;
const SAFE_MARGIN = 0.96; // a little inside the theoretical limit, not flush against it
const MASKABLE_SCALE = Math.min(1, (512 * SAFE_ZONE_FRACTION * SAFE_MARGIN) / MARK_RADIUS);

// The standalone icon: the mark alone on its navy field, in a fixed 512-unit box -- every raster
// size is just this resized by sharp (see build-icons.mjs), the same way a single source image
// serves several `<img>` sizes. `maskableSafe` picks the inset variant described above.
export function waveMarkSvg({ maskableSafe = false } = {}) {
  const scale = maskableSafe ? MASKABLE_SCALE : 1;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${NAVY}"/>
  ${waveMarkGroup({ cx: 256, cy: 256, scale })}
</svg>`;
}
