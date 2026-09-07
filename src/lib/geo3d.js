import * as THREE from 'three';

export function latLonToVector3(lat, lon, radius) {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  );
}

// How much to scale a marker's world radius at a given camera distance, so that its size *on
// screen* shrinks as you zoom in.
//
// In a perspective projection apparent size is worldSize/depth, where the depth that matters is
// the camera's distance to the shell the markers sit on -- not to the globe's centre. Scaling
// the world radius by exactly that depth would cancel the divide and hold a constant on-screen
// size; raising the depth ratio to a power above 1 instead leaves the on-screen size
// proportional to ratio^(exponent-1), i.e. shrinking as you close in.
//
// `closeShrink` says how big a dot should be at the closest zoom as a fraction of its size at
// the reference (default) zoom, and the exponent is solved from it -- so the curve lands on that
// number exactly, with no hand-tuned constant to drift out of date if the zoom range moves.
//
// Capped at 1 so this only ever shrinks: zoomed further out than the reference, a constant
// on-screen size would turn a large catalog of spots into a chunky, overlapping mess.
export function markerScaleForDistance(distance, { shell, refDistance, minDistance, closeShrink }) {
  const refDepth = refDistance - shell;
  const minDepthRatio = (minDistance - shell) / refDepth;
  const exponent = 1 + Math.log(closeShrink) / Math.log(minDepthRatio);
  const depthRatio = Math.max((distance - shell) / refDepth, 1e-4);
  return Math.min(Math.pow(depthRatio, exponent), 1);
}

// The on-screen size that scale produces, relative to the size at the reference distance --
// which is the number the shrink is actually specified in terms of.
export function markerScreenSizeRatio(distance, opts) {
  const refDepth = opts.refDistance - opts.shell;
  const depth = Math.max(distance - opts.shell, 1e-6);
  return (markerScaleForDistance(distance, opts) / depth) * refDepth;
}

// The globe rotation that brings a point round to face the camera.
//
// Used when you tap a cluster of markers: the globe turns that patch of coast to the middle of
// the screen and zooms a step closer, which is what splits the cluster into its members. The
// globe applies these as `rotation.set(rotX, rotY, 0)` in three's default XYZ order, so this
// solves Rx(rotX)*Ry(rotY)*v = (0, 0, +r) -- the +Z axis being where the camera sits.
//
// Deriving the signs by staring at the rotation matrices is exactly how a globe ends up
// spinning to the antipode of the thing you tapped, so geo3d.test.js checks it the honest way:
// rotate the real vector with three's own Euler and assert where it lands.
export function rotationToFace(lat, lon) {
  const v = latLonToVector3(lat, lon, 1);
  const rotY = Math.atan2(-v.x, v.z);
  const rotX = Math.atan2(v.y, Math.hypot(v.x, v.z));
  return { rotX, rotY };
}

// The shortest way round to a target angle from where the globe currently sits.
//
// Without this a tap near the antimeridian can send the globe the long way round -- two thirds
// of a turn to reach a point that was a few degrees away.
export function shortestAngleTo(current, target) {
  const TAU = Math.PI * 2;
  let delta = (target - current) % TAU;
  if (delta > Math.PI) delta -= TAU;
  if (delta < -Math.PI) delta += TAU;
  return current + delta;
}
