// Who is asking.
//
// Every rating in this app used to be a statement about the ocean alone: 6ft at 14s scored the
// same whether a beginner on a soft-top or a bodyboarder was reading it. That is the assumption
// `conditionsScore` was built on -- `waveFt >= 4` earned +2 and nothing above it ever cost
// anything -- and it is wrong in the ordinary case rather than the edge case. A 6ft day is
// unsurfable for a beginner, the wrong tool for a longboard, and the best day of the week for a
// bodyboard. One number cannot be right for all three.
//
// So the score now takes a profile, and the profile reshapes three terms: how big the surf
// wants to be, how much the period matters, and how much the wind hurts. Nothing else. The
// swell window, the tide fit and the spot model are properties of the *place* and stay exactly
// as they were -- a point break faces the direction it faces no matter who paddles out.

// The ideal band is in breaking feet (what the app displays), not offshore significant height.
//
// `lo`/`hi` bound the range the board is actually built for. Outside it the score falls off
// linearly at `under`/`over` points per foot, which is deliberately crude: the honest claim is
// "further outside the band is worse", not that the falloff has a known shape.
//
// The asymmetry between `under` and `over` is where most of the character lives. A longboard in
// surf below its band is still a pleasant session; a longboard in surf above its band is the
// wrong board in the water. A shortboard is the reverse.
const BOARDS = {
  shortboard: {
    label: 'Shortboard',
    lo: 3, hi: 8, under: 1.6, over: 0.9,
    // A shortboard needs the wave to have push. Short-period wind swell does not carry it, so
    // the period term stays at full weight.
    periodWeight: 1, windWeight: 1,
  },
  longboard: {
    label: 'Longboard',
    lo: 1.5, hi: 4, under: 0.5, over: 1.1,
    // Glide, not push: a log works in weak surf that a shortboard cannot catch, so period
    // matters much less. More board in the air also means more of a sail in a cross-wind.
    periodWeight: 0.6, windWeight: 1.15,
  },
  fish: {
    label: 'Fish / groveler',
    lo: 2, hi: 5, under: 0.8, over: 0.8,
    // The board exists specifically to make weak, gutless surf rideable.
    periodWeight: 0.7, windWeight: 1,
  },
  bodyboard: {
    label: 'Bodyboard',
    lo: 2.5, hi: 10, under: 1.2, over: 0.25,
    // The one craft that genuinely prefers it heavier and steeper, and the one least bothered by
    // wind -- there is almost nothing above the waterline to blow around.
    periodWeight: 1, windWeight: 0.8,
  },
  sup: {
    label: 'SUP',
    lo: 1, hi: 3.5, under: 0.3, over: 1.4,
    // Standing on a very large board is a wind problem before it is a wave problem. This is the
    // highest wind weight in the list and it is the defining constraint of the craft.
    periodWeight: 0.6, windWeight: 1.5,
  },
  foil: {
    label: 'Foil',
    lo: 0.5, hi: 3, under: 0.25, over: 1.5,
    // A foil draws from swell that has barely broken, so it works on days nothing else does --
    // and a foil in a crowded head-high lineup is a hazard rather than a good time.
    periodWeight: 0.4, windWeight: 1.2,
  },
  softtop: {
    label: 'Soft-top / learning',
    lo: 1, hi: 2.5, under: 0.2, over: 2.4,
    // Nothing here is about performance. Above the band the problem is getting out, getting
    // back, and what happens in between, so the falloff is the steepest of any board.
    periodWeight: 0.5, windWeight: 0.9,
  },
};

// Skill moves the band rather than adding a flat bonus, because it does not change what is
// *pleasant* -- it changes what is *manageable*. An advanced surfer is bored by the bottom of
// the band and comfortable well above the top; a beginner's ceiling is far lower and the drop
// beyond it far steeper. Neither changes how much they mind an onshore wind.
const SKILLS = {
  beginner: { label: 'Beginner', loMul: 0.7, hiMul: 0.6, overMul: 2 },
  intermediate: { label: 'Intermediate', loMul: 1, hiMul: 1, overMul: 1 },
  advanced: { label: 'Advanced', loMul: 1.2, hiMul: 1.5, overMul: 0.5 },
};

export const BOARD_IDS = Object.keys(BOARDS);
export const SKILL_IDS = Object.keys(SKILLS);
export function boardLabel(id) { return (BOARDS[id] || BOARDS[DEFAULT_PROFILE.board]).label; }
export function skillLabel(id) { return (SKILLS[id] || SKILLS[DEFAULT_PROFILE.skill]).label; }

// The profile a user has before they choose one. Shortboard/intermediate is not a neutral
// choice -- there is no such thing -- but it is the one the old unconditional scoring already
// encoded, so nobody's ratings move until they tell the app something about themselves.
export const DEFAULT_PROFILE = { board: 'shortboard', skill: 'intermediate' };

export function normalizeProfile(profile) {
  const p = profile && typeof profile === 'object' ? profile : {};
  return {
    board: BOARDS[p.board] ? p.board : DEFAULT_PROFILE.board,
    skill: SKILLS[p.skill] ? p.skill : DEFAULT_PROFILE.skill,
  };
}

// The band, with skill applied. Exported because the FIRING cap in rating.js needs the bottom of
// it: "too small to be firing" is a fact about the surfer, not about the ocean.
export function bandFor(profile) {
  const { board, skill } = normalizeProfile(profile);
  const b = BOARDS[board];
  const s = SKILLS[skill];
  // No clamp keeping hi above lo. Every board here has hi well clear of lo and no skill
  // multiplier comes close to crossing them, so a clamp would be a branch that can never run --
  // and a test that walks every board x skill combination asserting hi >= lo catches a future
  // config that does invert, which a silent runtime clamp would have hidden instead.
  return { lo: b.lo * s.loMul, hi: b.hi * s.hiMul, under: b.under, over: b.over * s.overMul };
}

export function weightsFor(profile) {
  const b = BOARDS[normalizeProfile(profile).board];
  return { periodWeight: b.periodWeight, windWeight: b.windWeight };
}

// Inside the band is worth the same +2 the old `waveFt >= 4` was worth, so a profile that wants
// what is in the water scores as well as the old model ever let anything score.
const IN_BAND = 2;

// The two floors are deliberately not the same number, and the asymmetry is the whole point.
//
// Surf below your band is a wasted drive: everything else about the day can still be lovely, so
// -3 leaves room for a glassy long-period morning to come out FAIR or better. Surf above your
// band is a different kind of problem. A beginner on a soft-top in 8ft is not having a mediocre
// session, they are having a bad time or not getting out at all, and no amount of offshore wind
// changes that -- which is exactly what a symmetric floor got wrong: glass (+3), groundswell
// (+2) and a square swell window (+2) added up to 7, enough to drag that day back to GOOD.
// -8 is deep enough that being badly over your head outvotes every other term combined.
const FLOOR_UNDER = -3;
const FLOOR_OVER = -8;

export function sizeFit(surfFt, profile) {
  if (surfFt == null || !Number.isFinite(surfFt)) return 0;
  const { lo, hi, under, over } = bandFor(profile);
  if (surfFt >= lo && surfFt <= hi) return IN_BAND;
  if (surfFt < lo) return Math.max(FLOOR_UNDER, IN_BAND - (lo - surfFt) * under);
  return Math.max(FLOOR_OVER, IN_BAND - (surfFt - hi) * over);
}
