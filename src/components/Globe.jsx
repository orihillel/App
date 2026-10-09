import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Repeat } from 'lucide-react';
import * as THREE from 'three';
import { COLORS } from '../lib/colors.js';
import { latLonToVector3, markerScaleForDistance, rotationToFace, shortestAngleTo, vector3ToLatLon } from '../lib/geo3d.js';
import { scoreToColor, degToCompass } from '../lib/rating.js';
import { formatReadingValue, formatReadingPlace, readingDescription } from '../lib/oceanreading.js';
import { coastlineTilesInSteps, coastlineLevel, coastlineOpacity } from '../lib/coastline.js';
import {
  base64ToBytes, decodeHeights, decodeSpeeds, decodeDirections, fillGridGaps, makeGridSampler,
  GRID_LAT_STEP, gridStepOf,
} from '../lib/wavegrid.js';
import { fibonacciSphere, arrowCountForDistance } from '../lib/swellarrows.js';
import { MARKER_RADIUS, MARKER_VERTEX, MARKER_FRAGMENT, surfaceFacing, markerShown, markerSizeFactor } from '../lib/markerdots.js';
import { BASEMAP, BASEMAP_MUTE_MS, muteBasemap } from '../lib/basemap.js';
import { ATMOSPHERE_RADIUS, ATMOSPHERE_VERTEX, ATMOSPHERE_FRAGMENT, starFade } from '../lib/atmosphere.js';
import { planFlight } from '../lib/flight.js';
import { sunDirection, frameTimeMs, shadeNight } from '../lib/terminator.js';
import { createGesture, gestureDown, gestureMove, gestureUp, gestureCancel } from '../lib/gestures.js';
import { fillLandRings, polygonsToPixelRings, topologyToPolygons, fetchLandMask, LAND_MASK } from '../lib/landmask.js';
import { waveColor, waveScaleGradient, waveScaleTicks, waveLegendCaption, WAVE_SCALE_MAX } from '../lib/wavescale.js';
import { windColor, windScaleGradient, windScaleTicks, windLegendCaption, WIND_SCALE_MAX } from '../lib/windscale.js';
import { fetchWaveGrid, fetchWaveFrames, fetchWindGrid } from '../lib/buoy.js';
import { pickHourAt } from '../lib/daylight.js';
import { cellSizeForDistance, clusterPoints } from '../lib/markercluster.js';
import { placeLabels, labelRank } from '../lib/labelplacement.js';
import { frameLabel, frameBuildLabel, weekFrameAt, advanceTimeline, stepFrame, nextSpeed, speedLabel, isTimelineKey } from '../lib/waveframes.js';
import {
  fieldLayout, layoutV, regularizeField, regularizeDirections, packHalf, packHalfRG, buildLut, LUT_SIZE, weekSlot,
  drawOverlay, ARROW_VERTEX, ARROW_FRAGMENT, ARROW_DRIFT_SECONDS,
} from '../lib/overlaygpu.js';
import { createFrameStats, recordFrame, summarizeFrames, perfLines, readPerfFlag } from '../lib/framestats.js';
import { createQualityGovernor, governorTick } from '../lib/quality.js';
import {
  velocityComponents, regularizeVelocity, degreesPerSecondPerKph, particlePxPerKph, viewCapRadius, particleCount, stateTexel,
  PARTICLE_STATE_SIZE, MAX_PARTICLES, PARTICLE_TRAIL_SECONDS,
  PARTICLE_UPDATE_VERTEX, PARTICLE_UPDATE_FRAGMENT, PARTICLE_DRAW_VERTEX, PARTICLE_DRAW_FRAGMENT,
} from '../lib/windparticles.js';
import { frameDelta, easeAlpha, decayFactor, blendVelocity, MAX_FRAME_MS, AMBIENT_MOTION_MS } from '../lib/motion.js';
import { ConditionScale } from './ConditionScale.jsx';

// How long one six-hour step of the week takes to play at 1x: the whole week in about twelve
// seconds, long enough to follow a swell across an ocean and short enough to watch twice.
//
// It used to be a timer as well: 450 ms a step cut into six 75 ms pictures, each a full CPU
// repaint of the overlay, because a repaint was all a phone could afford that often. The GPU
// now blends the two steps either side of the moment shown on every frame the screen draws
// (see lib/overlaygpu.js), so this is only a pace -- the motion between steps is continuous.
const STEP_MS = 450;

// The longest frame the playback clock counts in full. Motion clamps a frame at 100 ms (see
// lib/motion.js) so a stall does not fling the globe; playback is a clock, and clamping it that
// hard made the week play slower on a device drawing fewer than ten frames a second. A quarter
// of a second keeps real-time pace down to four frames a second, while a return from the
// background still does not jump the week a day ahead.
const PLAYBACK_MAX_FRAME_MS = 250;

// Interactive 3D globe of every saved spot, colored by live conditions. Owns its own WebGL
// lifecycle: mounting this component is equivalent to the parent switching to the globe view,
// unmounting it tears the scene down — so a plain mount-effect (deps: []) is enough, no need
// to watch a "view" prop the way the single-file version watched `view` state.
//
// `dataRef` is a ref (owned by the parent) whose `.current` is kept fresh every render with
// `{ spots, order, forecast, clockHour }` — read directly inside the animation loop so every
// rendered frame reflects whatever is currently in `forecast`, with no separate sync effect
// to fall out of date.
// What the overlay reads at one point, in words. The formatting lives in lib/oceanreading.js
// so the branch that matters -- a cell with no reading -- is covered by tests rather than by a
// screenshot.
function OceanReading({ reading, units, onClear }) {
  const value = formatReadingValue(reading.value, reading.layer, units);
  const place = formatReadingPlace(reading.lat, reading.lon);
  return (
    <div
      className="flex items-center"
      style={{
        gap: 10, marginBottom: 10, padding: '8px 10px', borderRadius: 8,
        background: COLORS.navyCard, border: '1px solid ' + COLORS.navyBorder,
      }}
    >
      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 19, color: COLORS.foam }}>
        {value || '—'}
      </span>
      <span style={{ fontSize: 11.5, color: COLORS.foamDim, flex: 1, lineHeight: 1.35 }}>
        {readingDescription(reading, degToCompass)}
        {place ? <><br /><span style={{ opacity: 0.75 }}>{place}</span></> : null}
      </span>
      <button
        className="tl-btn"
        onClick={onClear}
        aria-label="Clear reading"
        style={{ background: 'none', border: 'none', padding: 4, minWidth: 30, minHeight: 30, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <X size={14} color={COLORS.foamDim} />
      </button>
    </div>
  );
}

// The numbers under a legend bar.
//
// Positioned at each tick's own place along the ramp rather than spread evenly, because
// neither ramp is evenly spaced in its variable -- that uneven spacing is what gives the
// common band its contrast. Laying the labels out with space-between, which is what this used
// to do, put every one of them under a colour that was not the colour it named: on the swell
// bar "9" sat at the far right when 9m is 92.5% of the way along, and "1" sat a seventh of the
// way across when 1m is a quarter. The bar was right and the numbers on it were not.
//
// Ends are nudged inward so the first and last labels cannot hang off the edge of the bar.
function ScaleTicks({ ticks }) {
  return (
    <div style={{ position: 'relative', height: 12, marginTop: 4 }}>
      {ticks.map((t) => (
        <span
          key={t.label}
          style={{
            position: 'absolute',
            left: (t.pos * 100).toFixed(1) + '%',
            transform: 'translateX(' + (t.pos <= 0.01 ? '0' : t.pos >= 0.99 ? '-100%' : '-50%') + ')',
            fontSize: 9,
            color: COLORS.foamDim,
            whiteSpace: 'nowrap',
          }}
        >
          {t.label}
        </span>
      ))}
    </div>
  );
}

// Kept for the life of the page, across every time the globe is opened.
//
// The land mask is 8MB of coverage decoded from a compressed file, and the points the arrows
// stand on are six thousand points of a spiral, each tested against it; neither depends on
// anything but the files, and both were rebuilt every time the globe opened. The GPU textures
// cannot be kept the same way -- each open has its own WebGL context -- but the arrays they are
// made from can. A failed load is not kept, so the next open tries again.
let sharedLandMask = null; // Promise<{ mask, width, height } | null>
const sharedLattices = new WeakMap(); // land mask -> its sea lattice
let sharedLatticeNoMask = null;

export function Globe({ order, dataRef, onClose, onSelectSpot, onVisibleSpots, title = 'All spots', hint, units = 'metric' }) {
  const containerRef = useRef(null);
  // The wave overlay is off by default. It is a second reading of the same globe -- where the
  // swell is, rather than which spots are good -- and defaulting it on would bury the markers
  // that are the point of this screen under a wash of colour.
  const [wavesOn, setWavesOn] = useState(false);
  const [waveMeta, setWaveMeta] = useState(null);
  // Which reading of the ocean is painted: the swell, or the wind over it. Both are drawn by
  // the same machinery -- one texture, one mask, one arrow field -- because they are the same
  // shape of data, and only the numbers, the ramp and which way an arrow means change.
  const [layer, setLayer] = useState('swell'); // swell | wind
  const [windMeta, setWindMeta] = useState(null);
  const [windState, setWindState] = useState('idle'); // idle | loading | ready | unavailable
  // The animated week. `frames` is the decoded set, `frameIdx` the frame nearest the moment on
  // screen, `playing` whether it is running.
  const [frames, setFrames] = useState(null);
  // The playhead itself: a continuous position through the week, in forecast steps. It lives in
  // a ref because the render loop advances it on every frame it draws, and putting that through
  // React state would re-render this whole component sixty or more times a second to move a
  // picture React does not draw. React gets `frameIdx`, which changes once a step, for the
  // scrubber and the label; the loop reports it when it changes.
  const timelineRef = useRef({ pos: 0, playing: false, speed: 1, loop: false });
  const [frameIdx, setFrameIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  // Playback speed and repeat -- see advanceTimeline in lib/waveframes.js.
  const [speed, setSpeed] = useState(1);
  const [loop, setLoop] = useState(false);
  const [framesState, setFramesState] = useState('idle'); // idle | loading | ready | unavailable
  const [framesBuild, setFramesBuild] = useState(null);
  // Hands a decoded week to the WebGL effect, which uploads it to the GPU once.
  const setWeekRef = useRef(null);
  // The three.js scene is built once in a mount effect, so React state cannot reach it. Same
  // Read through a ref for the same reason dataRef exists: the render loop is set up once, and
  // closing over the prop would pin whichever version of it existed at mount.
  const visibleCbRef = useRef(onVisibleSpots);
  visibleCbRef.current = onVisibleSpots;

  // bridge the parent uses for forecast data: a ref the render loop reads.
  const wavesOnRef = useRef(false);
  wavesOnRef.current = wavesOn;
  // Same bridge as wavesOnRef: the WebGL effect is built once at mount and cannot read state.
  const layerRef = useRef('swell');
  layerRef.current = layer;
  // The effect hands these out so the controls can ask for a layer without reaching into it.
  const applyLayerRef = useRef(null);
  const loadWindRef = useRef(null);
  // The render loop skips frames when nothing has moved, which is what keeps an idle globe off
  // the battery. Toggling the overlay changes what should be drawn without moving anything, so
  // it has to say so explicitly or the screen would not update until the next drag.
  const markDirtyRef = useRef(null);
  useEffect(() => { if (markDirtyRef.current) markDirtyRef.current(); }, [wavesOn]);

  // Moves the playhead to `p` from a control -- the scrubber, an arrow key, a rewind. The render
  // loop picks the new position up on the frame this asks for.
  const seek = useCallback((p) => {
    timelineRef.current.pos = p;
    setFrameIdx(Math.round(p));
    if (markDirtyRef.current) markDirtyRef.current();
  }, []);
  // Where the slider is while a finger is on it, between forecast steps; null otherwise. The
  // slider used to move a whole six-hour step at a time, so dragging it flicked from one picture
  // to the next. Now the map blends between the steps either side of the thumb as it moves,
  // exactly as it does while the week plays, and settles on the nearest step when let go, so
  // the time under the slider is the time on the map.
  const [scrub, setScrub] = useState(null);
  const scrubRef = useRef(null);
  const moveScrub = useCallback((at) => {
    scrubRef.current = at;
    setScrub(at);
    seek(at);
  }, [seek]);
  const endScrub = useCallback(() => {
    const at = scrubRef.current;
    if (at == null) return;
    scrubRef.current = null;
    setScrub(null);
    seek(Math.round(at));
  }, [seek]);
  // Play, speed and repeat are React state, for the buttons; the loop reads them from the ref.
  useEffect(() => {
    const tl = timelineRef.current;
    tl.playing = playing;
    tl.speed = speed;
    tl.loop = loop;
    if (markDirtyRef.current) markDirtyRef.current();
  }, [playing, speed, loop]);
  // Nothing painted, nothing to have read.
  useEffect(() => { if (!wavesOn) setReading(null); }, [wavesOn]);

  // Turning the overlay off ends the animation and rewinds to now. Otherwise "Show live swell"
  // would bring back whatever hour was last on screen -- a map of Thursday, labelled live.
  useEffect(() => {
    if (!wavesOn) { setPlaying(false); seek(0); }
  }, [wavesOn, seek]);

  // Pick a layer, fetching it first if this is the first time it has been asked for.
  //
  // The week's animation belongs to the swell alone -- a wind week is another 5,000 units a day
  // against an allowance the swell week already half spends -- so leaving it playing under the
  // wind would animate swell frames with a wind legend over them. It stops and rewinds instead,
  // and the control disappears rather than sitting there doing nothing.
  const selectLayer = useCallback((next) => {
    setLayer(next);
    // A reading is of one layer at one moment. Carrying it across a switch would leave a wave
    // height sitting under the wind legend.
    setReading(null);
    // The week belongs to the layer that fetched it. Switching drops it and rewinds to now, so
    // the animation cannot carry on painting one layer's frames under the other's legend --
    // the same mistake the arrows used to make.
    // Stopped here as well as through state: the render loop reads the ref, and could otherwise
    // draw the old layer's week for a frame before React's update reaches it.
    timelineRef.current.playing = false;
    setPlaying(false);
    seek(0);
    setFrames(null);
    setFramesState('idle');
    setFramesBuild(null);
    if (next === 'wind' && loadWindRef.current) loadWindRef.current();
    if (applyLayerRef.current) applyLayerRef.current(next);
  }, [seek]);

  // Turning the overlay off returns to the swell. The layer is a reading of the live map, and
  // coming back to "Show live swell" on the wind would contradict the button that opened it.
  //
  // Through selectLayer, not setLayer alone. Setting the state moved the pressed button to
  // Swell and left the wind painted on the sphere: the picture only changes when the layer is
  // applied, and nothing applied it. The result was wind colours under the Swell button.
  //
  // Below selectLayer rather than beside the other overlay effects: a dependency array is read
  // during render, and naming a const above its declaration is a ReferenceError, not a warning.
  useEffect(() => {
    if (!wavesOn && layerRef.current !== 'swell') selectLayer('swell');
  }, [wavesOn, selectLayer]);

  // Fetch and decode the week, once, the first time the animation is asked for.
  //
  // Decoded here rather than in the WebGL effect because it is pure array work with no WebGL in
  // it. The effect then resamples the whole week onto the GPU once (see setWeek there), so
  // moving through it costs a uniform write rather than a decode or a repaint.
  const loadFramesOnce = useCallback(async () => {
    if (framesState === 'loading' || framesState === 'ready') return;
    // Which week. Read from the ref rather than closed over, so a layer switch mid-flight
    // cannot decode the wind's bytes as swell -- which would not throw, it would just draw a
    // week of nonsense.
    const forLayer = layerRef.current;
    // 'unavailable' is deliberately not a stopping state: it usually means the week is still
    // being assembled, which fixes itself a few minutes later.
    setFramesState('loading');
    const res = await fetchWaveFrames(forLayer === 'wind' ? 'wind' : 'wave');
    if (!res || !res.frames) {
      // Why, not just whether. The overlay beside this has said "Fetched 2 of 5 batches · HTTP
      // 429" since the round of guessing that taught it to; this said "unavailable" and sent
      // the next failure straight back to guessing.
      setFramesBuild((res && res.build) || null);
      setFramesState('unavailable');
      setFrames(null);
      return;
    }
    setFramesBuild(null);
    const step = res.latStep;
    // A response without the step it was sampled on cannot be decoded safely, and guessing
    // would paint the wrong ocean rather than fail.
    if (!Number.isFinite(step)) { setFramesState('unavailable'); setFrames(null); return; }
    // Wind is packed as km/h a byte and swell as decimetres. Decoding one with the other's
    // reader does not fail, it silently scales the whole week by ten.
    const decodeValues = forLayer === 'wind' ? decodeSpeeds : decodeHeights;
    setFrames({
      layer: forLayer,
      latStep: step,
      stepHours: res.stepHours,
      stale: res.stale,
      list: res.frames.map((f) => ({
        t: f.t,
        heights: decodeValues(base64ToBytes(f.data)),
        dirs: typeof f.dirs === 'string' ? decodeDirections(base64ToBytes(f.dirs)) : null,
      })),
    });
    seek(0);
    setFramesState('ready');
  }, [framesState, seek]);

  // Playing the week is the render loop's job (see updateOverlayTime in the WebGL effect): it
  // advances the playhead by the time each frame took, and stops it at the end unless repeat
  // is on. Nothing here ticks.

  // Left and right arrows step the week one frame at a time on a keyboard, pausing it: the
  // desktop equivalent of dragging the scrubber, without having to find and focus it first.
  const timelineReady = wavesOn && framesState === 'ready' && !!frames;
  useEffect(() => {
    if (!timelineReady) return undefined;
    const last = frames.list.length - 1;
    function onKey(e) {
      if (!isTimelineKey(e)) return;
      e.preventDefault();
      setPlaying(false);
      seek(stepFrame(timelineRef.current.pos, e.key === 'ArrowRight' ? 1 : -1, last));
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [timelineReady, frames, seek]);

  // The week goes to the GPU once, when it arrives, and is dropped when it goes (a layer switch
  // drops it). Which moment of it is drawn is decided per frame by the render loop. Kept in a ref
  // as well, so a globe rebuilt on a new GPU context (see the WebGL effect) can hand it over again.
  const weekForGpuRef = useRef(null);
  useEffect(() => {
    weekForGpuRef.current = framesState === 'ready' ? frames : null;
    if (setWeekRef.current) setWeekRef.current(weekForGpuRef.current);
  }, [frames, framesState]);

  // What the last tap on the ocean read. Held as state rather than drawn into the scene so it
  // is selectable text at a real font size -- the entire point of it is to be legible when the
  // colours are not.
  const [reading, setReading] = useState(null);
  const [globeError, setGlobeError] = useState(false);
  // Bumped to throw the whole WebGL scene away and build it again, on a new context. Only ever
  // needed when the browser takes the GPU context and does not give it back (see the effect).
  const [glEpoch, setGlEpoch] = useState(0);
  // The size the canvas was last drawn at. The container takes its height from the canvas in it,
  // so a rebuild -- which removes the old canvas before making the new one -- would otherwise
  // measure a container collapsed to its minimum and build a smaller globe.
  const glSizeRef = useRef(null);
  // And where the camera was, so a rebuilt globe comes back looking at the same place.
  const glViewRef = useRef(null);
  // How many spots currently have a live reading, so the legend can say what its colour scale
  // actually covers instead of implying it covers everything.
  const [liveCount, setLiveCount] = useState(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    // Wrapping all of setup in try/catch: if WebGL context creation or anything else here
    // throws, we've had no way to see that failure before now — it would just leave a blank
    // or broken canvas with nothing telling us why. This at least surfaces it.
    try {
    // The size it is drawn at, in CSS pixels. Not fixed: see resizeTo below.
    let width = container.clientWidth || (glSizeRef.current && glSizeRef.current.width) || 340;
    let height = Math.max(container.clientHeight, (glSizeRef.current && glSizeRef.current.height) || 0) || 420;
    glSizeRef.current = { width, height };
    const R = 1;

    // How close in you can zoom. Smaller = the globe fills more of the screen, which spreads
    // nearby markers further apart in screen space -- the actual point of zooming here, since
    // it's what makes a tight cluster (the California spots, say) separable and tappable one
    // by one.
    //
    // Markers are centred exactly ON the surface (not on a raised shell) so that a dot sits at
    // its real coordinates from every angle. They used to sit at R*1.045 -- 4.5% of Earth's
    // radius, about 287km of altitude -- and an object at altitude does not project to the same
    // screen point as the ground beneath it unless you are looking straight down at it. Every
    // other viewing angle offsets it, and the offset swings around as you rotate, so the dots
    // visibly slid across the terrain while dragging. Measured against each marker's true
    // lat/lon on the surface, that gap was a median 55px and up to 100px at the closest zoom.
    // Centring on the surface makes it identically zero at every angle and every zoom.
    //
    // Each dot is a flat disc facing the camera, centred on that point (see lib/markerdots.js),
    // and it fades out over a band just inside the horizon rather than floating clear of the
    // globe's silhouette or being sliced by it.
    const MARKER_SHELL = R;
    // How close the camera may get, in Earth radii from the centre. 1.08 showed a 426km-wide
    // view; 1.015 shows 79km, which is what it takes to separate spots on a busy coast -- two
    // breaks 5km apart go from 14px apart to 74px, i.e. from one blob to two things you can
    // aim at. The floor is not arbitrary: the coastline data below is quantized to a ~401m
    // grid, which at this distance is ~6 screen pixels, and going deeper would just magnify
    // that grid into visible stair-steps. Zoom as far as the data supports, and no further.
    const MIN_DISTANCE = 1.015;
    const MAX_DISTANCE = 6;
    // The coastline layer is pointless at globe view and essential up close, so it fades in
    // across the range where the imagery starts running out of pixels rather than switching on
    // at a threshold, which would read as a glitch mid-pinch.
    const COASTLINE_FADE_START = 1.7;
    const COASTLINE_FADE_END = 1.15;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.02, 20);
    // The near plane is recomputed every frame from the current zoom rather than pinned to one
    // value that has to work for the whole range. Pinned, it's a bad trade at both ends: large
    // enough to keep depth precision when zoomed out means slicing the front off the globe when
    // zoomed in, and small enough for the closest zoom wastes most of the depth buffer's
    // precision at every other zoom. Tracking the distance keeps the range tight at all times,
    // which is what makes an ordinary depth buffer (no logarithmic one) enough.
    function updateNearPlane() {
      const clearance = Math.max(state.distance - MARKER_SHELL, 0.004);
      camera.near = Math.max(clearance * 0.5, 0.002);
      camera.updateProjectionMatrix();
    }
    // rot*/distance are what's rendered this frame; target* is where input has asked them to
    // go, and vel* carries flick momentum after release (see the easing in animate()).
    const state = {
      distance: 3.0, targetDistance: 3.0,
      rotX: 0.3, rotY: 0.6, targetRotX: 0.3, targetRotY: 0.6, velX: 0, velY: 0,
      dragging: false, raf: null,
      lastMoveAt: 0, // performance.now() of the last drag movement, for velocity and the still-release test
      dataDirty: true, // set when marker colors/labels change, so an idle frame still redraws once
    };
    if (glViewRef.current) {
      const v = glViewRef.current;
      state.rotX = state.targetRotX = v.rotX;
      state.rotY = state.targetRotY = v.rotY;
      state.distance = state.targetDistance = v.distance;
    }
    camera.position.set(0, 0, state.distance);
    markDirtyRef.current = () => { state.dataDirty = true; };

    // logarithmicDepthBuffer is deliberately OFF. It makes every shader write gl_FragDepth,
    // which disables the GPU's early-Z rejection — a serious cost everywhere and a brutal one
    // on the tile-based GPUs in phones, which is where this app actually runs. It was only
    // needed because the near/far range was wide; the per-frame near plane below keeps that
    // range tight enough that an ordinary 24-bit depth buffer has precision to spare.
    // At most 2x the CSS resolution, with MSAA always on.
    //
    // This was 3x, with MSAA off at 3x on the reasoning that 9:1 supersampling resolves edges
    // about as well. It does, but at 2.25 times the pixels: on a 390x844 iPhone, 3x is 3.0
    // million pixels shaded every frame against 1.3 million at 2x, and the globe also draws
    // thousands of markers, a translucent overlay and close to a million coastline vertices up
    // close. Phones' tile-based GPUs resolve 4x MSAA cheaply, so 2x with MSAA keeps edges smooth
    // for well under half the fill cost. A 2x cap is the usual advice for three.js on phones.
    let pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    // Opaque, drawing its own background in the page's colour. A transparent canvas is blended
    // onto the page by the browser on every frame, and anything translucent drawn over empty
    // background -- the glow round the globe, the stars -- left the canvas itself translucent
    // there, premultiplied alpha the compositor then had to undo.
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setClearColor(COLORS.navy, 1);
    // outputEncoding/sRGBEncoding was renamed to outputColorSpace/SRGBColorSpace in newer
    // Three.js and removed entirely in later versions — set whichever this build actually has.
    if ('outputColorSpace' in renderer && THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;
    else if ('outputEncoding' in renderer && THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.setSize(width, height);
    // Capped at 2x (see above). This was raised to 3x once because coastlines looked soft
    // zoomed in on a 3x phone; that was with MSAA off. With it on, 2x keeps the edges clean.
    renderer.setPixelRatio(pixelRatio);
    // And lowered from there, a step at a time, on a device that cannot keep up -- raised again
    // once it can. See lib/quality.js; applied from the frame loop below.
    let currentPixelRatio = pixelRatio;
    let quality = createQualityGovernor({ max: pixelRatio, min: Math.min(1, pixelRatio) });
    function applyPixelRatio(ratio) {
      currentPixelRatio = ratio;
      renderer.setPixelRatio(ratio);
      renderer.setSize(width, height);
      state.dataDirty = true; // the canvas was cleared by the resize: draw it again
    }
    container.appendChild(renderer.domElement);
    setGlobeError(false);

    // The canvas follows its container: a phone turned on its side, a window resized, the address
    // bar sliding away. It used to keep the size it was created at and let the browser stretch it
    // to fit, which drew the globe as an oval and put every label and tap off by the stretch.
    function resizeTo(w, h) {
      if (!(w > 0) || !(h > 0) || (w === width && h === height)) return;
      width = w;
      height = h;
      glSizeRef.current = { width, height };
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      state.dataDirty = true;
    }
    const resizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => resizeTo(container.clientWidth, container.clientHeight))
      : null;
    if (resizeObserver) resizeObserver.observe(container);
    // And the screen's own density: a window dragged onto another monitor, or the page zoomed.
    // The quality governor starts again from the new ceiling, since what it learned was about
    // the old one.
    let densityQuery = null;
    function onDensityChange() {
      if (cancelled) return;
      pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      quality = createQualityGovernor({ max: pixelRatio, min: Math.min(1, pixelRatio) });
      applyPixelRatio(pixelRatio);
      watchDensity();
    }
    function watchDensity() {
      if (typeof window.matchMedia !== 'function') return;
      densityQuery = window.matchMedia('(resolution: ' + (window.devicePixelRatio || 1) + 'dppx)');
      if (typeof densityQuery.addEventListener === 'function') densityQuery.addEventListener('change', onDensityChange, { once: true });
    }
    watchDensity();

    // The GPU context can be taken away -- iOS does it to a page sent to the background -- and
    // given back. three.js asks for it back, and rebuilds its own state when it returns; but this
    // globe only draws when something changes, so it has to be told to draw again, or the canvas
    // stays blank until someone happens to touch it. If the context does not come back at all,
    // the whole scene is built again on a new one.
    const CONTEXT_RESTORE_WAIT_MS = 3000;
    let contextLost = false;
    let contextTimer = null;
    function waitForContext() {
      clearTimeout(contextTimer);
      // A hidden page is not given its context back until it is shown again: wait for that.
      if (document.hidden) return;
      contextTimer = setTimeout(() => {
        if (contextLost && !cancelled) setGlEpoch((n) => n + 1);
      }, CONTEXT_RESTORE_WAIT_MS);
    }
    function onContextLost() {
      if (cancelled) return;
      contextLost = true;
      waitForContext();
    }
    function onContextRestored() {
      if (cancelled) return;
      contextLost = false;
      clearTimeout(contextTimer);
      state.dataDirty = true;
    }
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', onContextRestored);

    // The on-screen performance display: off unless the page was opened with ?perf=1 (and
    // remembered after that; ?perf=0 forgets it). See lib/framestats.js for what it measures.
    // Written straight to the DOM twice a second rather than through React state, because a
    // display that re-rendered this component to report frame times would be measuring itself.
    let perfStore = null;
    try { perfStore = window.localStorage; } catch { /* blocked storage: the URL alone decides */ }
    const perf = readPerfFlag(window.location.search, perfStore)
      ? { stats: createFrameStats(), drawn: 0, shownDrawn: 0, paintMs: null, hud: document.createElement('div'), timer: null }
      : null;
    const showPerf = () => {
      const drawnSince = perf.drawn - perf.shownDrawn;
      perf.shownDrawn = perf.drawn;
      const info = renderer.info.render;
      perf.hud.textContent = perfLines(drawnSince ? summarizeFrames(perf.stats) : null, {
        idle: !drawnSince,
        calls: info.calls, triangles: info.triangles, lines: info.lines,
        pixelRatio: currentPixelRatio, pixelRatioMax: pixelRatio,
        width: renderer.domElement.width, height: renderer.domElement.height,
        paintMs: perf.paintMs,
      }).join('\n');
    };
    if (perf) {
      perf.hud.setAttribute('data-perf-hud', '');
      Object.assign(perf.hud.style, {
        position: 'absolute', top: '6px', left: '6px', zIndex: '5', pointerEvents: 'none',
        background: 'rgba(5,12,20,0.78)', color: '#F4F7F6', borderRadius: '6px', padding: '5px 7px',
        font: '10.5px/1.45 "JetBrains Mono", ui-monospace, monospace', whiteSpace: 'pre',
      });
      container.appendChild(perf.hud);
      showPerf();
      perf.timer = setInterval(showPerf, 500);
    }

    // Set by cleanup so async work (the satellite texture below) can tell it arrived too late.
    let cancelled = false;

    const globeGroup = new THREE.Group();
    scene.add(globeGroup);

    // The drawn world map, built after the globe is already on screen rather than before.
    //
    // A CPU profile of a globe open put 337ms in texSubImage2D -- handing this 2048x1024
    // canvas and its mipmap chain to the GPU -- and every millisecond of it was spent before
    // the first frame, so the tap did nothing visible for a third of a second. The sphere is
    // now created with a flat ocean colour, drawn immediately, and the map is swapped in when
    // it is ready. That is the same progressive path the satellite imagery already takes, one
    // step earlier.
    //
    // The land outlines come with it: landmasses.json is 31.9KB gzipped, 18% of the globe
    // chunk, and it is used for nothing but this canvas -- so importing it here keeps it out
    // of the chunk whose download the globe is waiting on.
    const oceanMat = new THREE.MeshPhongMaterial({
      // Mid-ocean, from the middle stop of the gradient below, so the swap changes detail
      // rather than colour.
      color: 0x175a82, shininess: 14, specular: 0x1a3a4a,
      // The shading across a dark ocean is a long, slow gradient, which eight bits a channel
      // draw as visible bands. Dithering breaks them up for the cost of one noise lookup.
      dithering: true,
    });
    // Quietened under an overlay: see muteBasemap in lib/basemap.js. `uMute` is eased toward 1
    // while an overlay is shown and back to 0 when it goes, and the land mask arrives with the
    // overlay.
    const muteUniforms = {
      uMute: { value: 0 },
      uMuteMask: { value: null },
      uMuteHasMask: { value: 0 },
    };
    // And shaded by night where the sun has set, at the moment on screen: see lib/terminator.js.
    const sunUniforms = { uSunDir: { value: new THREE.Vector3(0, 0, 1) } };
    // And with the overlay painted on top of all that, last, so it is neither muted, lit nor
    // darkened by night: see drawOverlay in lib/overlaygpu.js. The order of these patches is the
    // order their code runs in.
    oceanMat.onBeforeCompile = (shader) => {
      muteBasemap(shader, muteUniforms);
      shadeNight(shader, sunUniforms);
      drawOverlay(shader, overlayUniforms);
    };
    let mapTexture = null;

    // Whenever a texture goes on, the tint has to come off with it.
    //
    // MeshPhongMaterial multiplies `color` by `map`, so leaving the ocean blue set once a real
    // map is applied renders the whole globe through a dark blue filter -- caught by comparing
    // frames before and after this change, where the after-globe was visibly darker. White is
    // what the material used before it had a placeholder colour to show.
    function setOceanMap(tex) {
      oceanMat.map = tex;
      oceanMat.color.setHex(0xffffff);
      oceanMat.needsUpdate = true;
    }

    // Anisotropic filtering for the base map: up to 8 samples, not the GPU's maximum. Most report
    // 16, and the second eight samples a texel are bought only where the sphere turns away at the
    // steepest angles -- the last sliver before the horizon, foreshortened past reading anyway --
    // at the cost of texture bandwidth on every frame, which is what a phone has least of.
    function baseMapAnisotropy() {
      return Math.min(8, renderer.capabilities.getMaxAnisotropy());
    }

    function drawWorldMap(LANDMASSES) {
      // Left at 2048x1024, though the drawing cost is no longer the reason. Drawing this map
      // measures 12ms at 2048 and 40ms at 4096 -- both cheap, and cheaper still since the
      // wraparound handling below stopped redrawing every ring three times. What is not cheap
      // is handing a 4096x2048 canvas to the GPU: the upload plus mipmap chain is ~32MB, and
      // it is paid on every globe open for a map that real imagery replaces moments later. The
      // resolution that matters when zoomed in comes from the satellite texture below, and
      // from the device pixel ratio above.
      const mapW = 2048, mapH = 1024;
      // Stroke widths below were picked against a 2048-wide canvas; keeping them relative to it
      // means changing mapW does not silently halve the weight of every coastline and grid line.
      const mapScale = mapW / 2048;
      const mapCanvas = document.createElement('canvas');
      mapCanvas.width = mapW; mapCanvas.height = mapH;
      const mctx = mapCanvas.getContext('2d');
      const oceanGrad = mctx.createLinearGradient(0, 0, 0, mapH);
      oceanGrad.addColorStop(0, '#0a2440');
      oceanGrad.addColorStop(0.5, '#175a82');
      oceanGrad.addColorStop(1, '#0a2440');
      mctx.fillStyle = oceanGrad;
      mctx.fillRect(0, 0, mapW, mapH);
      function toPx(lat, lon) { return [((lon + 180) / 360) * mapW, ((90 - lat) / 180) * mapH]; }
      mctx.fillStyle = '#5c8c56';
      mctx.strokeStyle = 'rgba(18,36,26,0.5)';
      mctx.lineWidth = 2.5 * mapScale;
      LANDMASSES.forEach((pts) => {
        // A handful of rings (Russia, Antarctica, Fiji) were unwrapped past
        // ±180° during data prep so their coastline stays contiguous — that
        // pushes some of their x coordinates outside the canvas, and they have
        // to be painted again shifted a full map-width to cover the wraparound.
        //
        // That used to be done for every ring unconditionally: three full
        // fill+stroke passes each, of which two land entirely off-canvas for
        // all but a handful of them. Testing the ring's x-extent against the
        // canvas first skips those, which is what makes the resolution above
        // affordable -- it is roughly a third of the drawing work.
        let minX = Infinity, maxX = -Infinity;
        for (const [, lon] of pts) {
          const x = ((lon + 180) / 360) * mapW;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
        }
        [-mapW, 0, mapW].forEach((xOffset) => {
          if (maxX + xOffset < 0 || minX + xOffset > mapW) return; // nothing on canvas
          mctx.beginPath();
          pts.forEach(([lat, lon], i) => {
            const [x, y] = toPx(lat, lon);
            const px = x + xOffset;
            if (i === 0) mctx.moveTo(px, y); else mctx.lineTo(px, y);
          });
          mctx.closePath();
          mctx.fill();
          mctx.stroke();
        });
      });
      mctx.strokeStyle = 'rgba(244,247,246,0.13)';
      mctx.lineWidth = 1 * mapScale;
      for (let lat = -60; lat <= 60; lat += 30) {
        const [, y] = toPx(lat, 0);
        mctx.beginPath(); mctx.moveTo(0, y); mctx.lineTo(mapW, y); mctx.stroke();
      }
      for (let lon = -150; lon <= 180; lon += 30) {
        const [x] = toPx(0, lon);
        mctx.beginPath(); mctx.moveTo(x, 0); mctx.lineTo(x, mapH); mctx.stroke();
      }
      const tex = new THREE.CanvasTexture(mapCanvas);
      // The colours above are sRGB, as every canvas colour is. Without saying so, the shader read
      // them as linear and the map came out washed out -- pale mint land on a grey-blue sea, and
      // a visible jump in colour from the ocean placeholder it replaces, which is set from the
      // same hex value and was converted correctly.
      tex.colorSpace = THREE.SRGBColorSpace;
      // A flat texture wrapped on a sphere gets viewed at steep angles near the edges of what's
      // visible, which is exactly the case anisotropic filtering is for — without it, those
      // regions look noticeably blurrier/blockier than the center, which reads as "pixelated".
      tex.anisotropy = baseMapAnisotropy();
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = true;
      return tex;
    }

    // Real satellite imagery, layered on as progressive enhancement over the drawn map above.
    //
    // The drawn map stays the base because it is instant, works offline (this is a PWA), and
    // never fails. The satellite image is then fetched in the background and swapped in if and
    // when it arrives -- so a slow network, a blocked request, a missing CORS header or an
    // offline launch all degrade to exactly the globe that shipped before, rather than to a
    // blank sphere.
    //
    // NASA's Blue Marble is used because it is public domain (NASA imagery carries no
    // copyright) and needs no API key or account. Google Maps/Earth tiles deliberately are not:
    // they require a billing-enabled API key, and their terms don't permit using the tiles
    // outside Google's own SDKs, so they cannot ship in a static app like this one.
    //
    // NOTE: nasa.gov is blocked by the sandbox this was written in, so nothing here could be
    // fetched to check. An earlier version of this list guessed at `land_shallow_topo_4096` and
    // `_8192` filenames by pattern; those are unconfirmed and were replaced. The upgrade below
    // is the Blue Marble Next Generation topo/bathy image, whose filename is corroborated by
    // its widespread use in three.js and R globe examples -- still not fetched from here, which
    // is why the loader keeps falling back rather than trusting it.
    //
    // 2048 loads first and is swapped in as soon as it arrives, then the larger one is swapped
    // over it. Ordering matters: 2048 is ~1MB against several for the big one, so going
    // straight for the large image would leave anyone on a slow connection looking at the drawn
    // map for the whole download instead of getting real imagery quickly and sharper imagery
    // shortly after. The upgrade is worth fetching because 2048 wraps to only ~2900px of
    // texture around the equator, against a globe reaching ~2950 CSS px of on-screen
    // circumference at the closest zoom -- and ~8800 device px once the pixel ratio above is
    // taken into account. That under-sampling is exactly what makes coastlines look soft when
    // you zoom in; 5400x2700 is 2.6x the linear detail, i.e. ~7x the pixels.
    //
    // All of that is now the fallback. See loadBasemap below for what comes first.
    const SATELLITE_BASE_URL = 'https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57752/land_shallow_topo_2048.jpg';
    const SATELLITE_UPGRADE_URLS = [
      'https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73909/world.topo.bathy.200412.3x5400x2700.jpg',
    ];
    let satelliteTexture = null;
    const textureLoader = new THREE.TextureLoader();
    textureLoader.setCrossOrigin('anonymous'); // required to use the pixels as a WebGL texture

    function applySatellite(tex) {
      if ('colorSpace' in tex && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = baseMapAnisotropy();
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      // A compressed texture brings its own mipmaps, and the GPU cannot generate them for one.
      if (!tex.isCompressedTexture) tex.generateMipmaps = true;
      // Whatever the sphere was showing is now covered for good and can be released -- the
      // drawn map on the first swap, the smaller image on an upgrade.
      const previous = satelliteTexture || mapTexture;
      satelliteTexture = tex;
      setOceanMap(tex);
      // Real imagery is already lit by the sun in the photograph; the drawn map needed the
      // shading to read as a sphere at all, so dial the specular highlight back to keep the
      // continents from looking wet.
      oceanMat.shininess = 6;
      oceanMat.needsUpdate = true;
      state.dataDirty = true; // make sure an idle globe redraws to show it
      if (previous) previous.dispose();
    }

    function loadUpgrade(i) {
      if (cancelled || i >= SATELLITE_UPGRADE_URLS.length) return;
      textureLoader.load(
        SATELLITE_UPGRADE_URLS[i],
        (tex) => { if (cancelled) { tex.dispose(); return; } applySatellite(tex); },
        undefined,
        () => loadUpgrade(i + 1), // too big, missing, or blocked: try the next size down
      );
    }

    function loadNasaImagery() {
      if (cancelled) return;
      textureLoader.load(
        SATELLITE_BASE_URL,
        (tex) => {
          if (cancelled) { tex.dispose(); return; }
          applySatellite(tex);
          loadUpgrade(0);
        },
        undefined,
        // Offline, blocked, or moved: keep the drawn map, which is already on screen. Still worth
        // trying the larger images -- only this one URL might be the broken thing.
        () => loadUpgrade(0),
      );
    }

    // The base map as it is meant to arrive: the same Blue Marble imagery, prebuilt as a
    // GPU-compressed texture and shipped with the app (see scripts/build-basemap.mjs).
    //
    // The 5400x2700 JPEG above was the heaviest single thing the globe did. A JPEG has to be
    // decompressed to raw pixels before a GPU can use it, so that one image was ~78MB of
    // texture memory with its mipmaps -- on a phone -- and handing it over was measured at
    // 250ms of main-thread time in a single call, freezing whatever was on screen. This file
    // stays compressed on the GPU: it is transcoded off the main thread, in a worker, into
    // whichever compressed format this GPU reads, and uploaded with its mipmaps already built.
    // It is 4096x2048, about three quarters of the JPEG's detail across; up close, the shape
    // of the shore comes from the vector coastline drawn over it.
    //
    // NASA's own JPEGs remain the fallback, for a browser where this cannot load or transcode.
    let basemapLoader = null;
    function releaseBasemapLoader() {
      if (basemapLoader) { basemapLoader.dispose(); basemapLoader = null; }
    }
    function loadBasemap() {
      // Loaded on demand: the loader and its transcoder are only wanted once, after first paint.
      import('three/examples/jsm/loaders/KTX2Loader.js')
        .then(({ KTX2Loader }) => {
          if (cancelled) return;
          basemapLoader = new KTX2Loader().detectSupport(renderer);
          const base = ((import.meta.env && import.meta.env.BASE_URL) || '/').replace(/\/$/, '');
          basemapLoader.load(
            base + '/' + BASEMAP.file,
            (tex) => {
              // The workers hold a transcoder each; one image is all they were for.
              releaseBasemapLoader();
              if (cancelled) { tex.dispose(); return; }
              applySatellite(tex);
            },
            undefined,
            () => { releaseBasemapLoader(); loadNasaImagery(); },
          );
        })
        .catch(() => { releaseBasemapLoader(); loadNasaImagery(); });
    }
    loadBasemap();
    // 64x48 was chosen back when the globe was never larger than the viewport, where it is
    // indeed indistinguishable from a finer mesh. That stopped being true once the zoom range
    // opened up: at the closest zoom the sphere is ~939px across in a 362px viewport, so a
    // horizontal segment spans several pixels and the silhouette reads as visibly faceted.
    // 128x96 is ~24k triangles -- still trivial for one mesh, and the only mesh that scales
    // with zoom -- and holds a smooth edge across the whole range.
    // 256x192 rather than 128x96 now that the zoom goes deeper. This is not about the
    // silhouette any more but about the surface: a sphere approximated by flat quads sags below
    // the true surface at each quad's centre, and the coastline lines below sit just above the
    // true surface. At 128x96 that sag is ~4.4e-4 of a radius, close enough to the lines' own
    // offset to let the terrain poke through them. Doubling the segments quarters the sag to
    // ~1.1e-4, comfortably clear, for ~98k triangles -- still one mesh and still trivial.
    const oceanMesh = new THREE.Mesh(new THREE.SphereGeometry(R, 256, 192), oceanMat);
    globeGroup.add(oceanMesh);

    // High-resolution vector coastline. See lib/coastline.js for why this exists at all: no
    // single global texture can be sharp at this zoom, and lines have no resolution to run out
    // of. Fetched lazily the first time the camera comes near enough to show it, so the globe's
    // first paint never waits on 743KB that a user who only ever looks at the whole Earth
    // would not have needed.
    //
    // Drawn as ribbons a fixed width on screen rather than as hairlines, in tiles so that only
    // the ones in view are drawn, and in two levels of detail: every point, or every fourth
    // wherever that cannot be told apart (see coastlineTiles and coastlineLevel in
    // lib/coastline.js).
    const COASTLINE_SHELL = R * 1.0006;
    // CSS pixels: LineSegments2 measures its width against the canvas's CSS size.
    const COASTLINE_WIDTH_PX = 1.25;
    const COASTLINE_COARSE_STRIDE = 4;
    // ~400k segments, two levels and four hundred meshes are built this many milliseconds at a
    // time, between frames, so the pinch that brought the camera close never stalls on them.
    const COASTLINE_SLICE_MS = 5;
    // { material, fine: [{ mesh, center, reach }], coarse: [...], coarseError }
    let coastline = null;
    let coastLevel = null; // which of the two was last drawn, or null
    let coastlineRequested = false;
    let coastlineTimer = null;

    // The coastline file, fetched at most once however many layers want it.
    //
    // Two do now: the lines, and the mask that cuts the wave overlay to the shore. Sharing one
    // promise means turning the overlay on while zoomed in costs 753KB rather than twice that,
    // and — the part that matters — the chart's edge and the drawn coastline can never be
    // assembled from different data.
    let coastlinePromise = null;
    function loadCoastlineTopology() {
      if (!coastlinePromise) {
        const base = (import.meta.env && import.meta.env.BASE_URL) || '/';
        // The name is versioned deliberately — see scripts/build-coastline.mjs. Files in
        // public/ are not content-hashed, so a changed file at an unchanged URL leaves stale
        // copies in browser caches, and a stale coastline costs the wave overlay its mask
        // without saying so.
        const url = base.replace(/\/$/, '') + '/coastline-10m-v2.json';
        const get = () => fetch(url).then((r) => (r.ok ? r.json() : null));
        // 753KB over a phone connection drops sometimes. One retry, because the alternative
        // for the overlay is a whole zoom range's worth of coastline it cannot draw.
        coastlinePromise = get()
          .catch(() => get())
          // Offline, or the asset missing: every layer that wants it degrades rather than
          // fails, so there is nothing more to retry.
          .catch(() => null);
      }
      return coastlinePromise;
    }

    // Live wave-height overlay: the ocean painted by how big the sea is right now.
    //
    // Drawn by the globe's own material, after its lighting, from textures of numbers (see
    // drawOverlay in lib/overlaygpu.js). It used to be a second sphere laid just above the
    // surface; it is toggled by a uniform now, and land is still untouched.
    //
    // Three separate concerns, and they want three different resolutions:
    //
    //   - the swell field is resampled to a small texture of numbers whose rows sit on the
    //     grid's own rows, which the GPU filters and colours per screen pixel (see
    //     lib/overlaygpu.js);
    //   - where land *is* comes from the coastline, at 4096x2048 — about 10km a texel;
    //   - how hard the boundary between them looks is not a resolution at all. The mask holds
    //     the *fraction* of each texel that is land, and the shader thresholds it at a half
    //     with a screen-space-width falloff, so the chart ends in about one screen pixel at
    //     every zoom. Baking the mask into the chart's alpha instead — the obvious way, and the
    //     first way this was written — makes the edge exactly as soft as a texel is wide, which
    //     at the closest zoom is a couple of hundred device pixels of blur.
    // Whether the overlay has a field to draw: set once the first grid and the land mask arrive.
    let overlayReady = false;
    let waveMaskTexture = null;
    let waveRequested = false;
    // The two live readings, decoded and kept, so switching layers is a uniform change rather
    // than a refetch. Each is `{ values, raw, dirs, step }`, plus its textures once it has been
    // drawn (see buildLiveTextures).
    let liveLayers = {};
    // The animated week, on the GPU: `{ layer, list, step, count, texture, dirTexture }`. See
    // setWeek.
    let week = null;
    // One colour table per layer, built from the legend's ramp the first time it is needed.
    const luts = {};
    // Exactly what is on the sphere right now: the live grid, or a frame of the animated week.
    // Tap-to-read samples this rather than the live grid, because during the animation those
    // are different fields and reading the wrong one would answer a question nobody asked --
    // "what is it there now" when the screen is showing Thursday.
    let painted = null;
    // makeGridSampler precomputes row offsets, and the live grid and the week use different
    // steps, so the two samplers are built once each rather than per tap.
    const samplers = new Map();
    function samplerFor(step) {
      if (!samplers.has(step)) samplers.set(step, makeGridSampler(step));
      return samplers.get(step);
    }
    // The texture layout for each grid step, for the same reason: it is a table the size of the
    // texture, and the week resamples 28 frames onto one.
    const layouts = new Map();
    function layoutFor(step) {
      if (!layouts.has(step)) layouts.set(step, fieldLayout(step));
      return layouts.get(step);
    }
    let windRequested = false;
    // Each layer's ramp, and the value at its top. Read through drawFor() so the live overlay
    // and the animated week cannot disagree about which layer is showing.
    const LAYER_DRAW = {
      swell: { colorFn: waveColor, max: WAVE_SCALE_MAX },
      wind: { colorFn: windColor, max: WIND_SCALE_MAX },
    };
    function drawFor(name) {
      return LAYER_DRAW[name] || LAYER_DRAW.swell;
    }

    // What the overlay and the arrows both read: which moment of the forecast is on screen, and
    // where each texture's rows sit. The same uniform objects in both materials, so the arrows
    // cannot show a different moment from the colour under them.
    const fieldUniforms = {
      uWeekOn: { value: 0 },
      uLayer0: { value: 0 },
      uLayer1: { value: 0 },
      uMix: { value: 0 },
      uLiveV: { value: new THREE.Vector2(1, 0) },
      uWeekV: { value: new THREE.Vector2(1, 0) },
    };
    // The overlay's own, in the globe's material (see drawOverlay).
    const overlayUniforms = {
      ...fieldUniforms,
      uOverlayOn: { value: 0 },
      uLive: { value: null },
      uWeek: { value: null },
      uLut: { value: null },
      uLutMax: { value: 1 },
      uLandMask: { value: null },
      uHasMask: { value: 0 },
      // 0.62 was costing about a third of every ramp's separation. The overlay is blended over
      // the base map, so a translucent one is a blend toward the sea under it -- and the darker
      // half of a ramp, which is where most of the world's sea state actually sits, gets pulled
      // hardest. Raising it to 0.85 lifted the worst adjacent pair from 11.8 to 16.2 on the
      // swell layer and 6.0 to 8.3 on the wind, for nothing but a number. Still short of opaque
      // so the globe's own shading reads through and it still looks like a sphere rather than a
      // flat map.
      uOpacity: { value: 0.85 },
    };

    // The arrows over the colour: which way each patch of swell is travelling.
    //
    // Instanced flat arrows lying tangent to the sphere, not marks painted into the texture —
    // geometry stays sharp at every zoom, where a painted arrow would be a smear a few texels
    // across. How many are drawn depends on the camera distance (see lib/swellarrows.js), so
    // the on-screen density holds roughly steady instead of thinning to nothing as you close in.
    // Each is turned to the field's direction by its vertex shader (see lib/overlaygpu.js).
    const ARROW_SHELL = R * 1.0009; // above the overlay and the coastline, so it is never buried
    const ARROW_FIELD = 6000;      // the cap; how many of them are drawn is a function of zoom
    let arrowMesh = null;
    // Whether the field on screen has directions at all. A grid cached before the Worker fetched
    // them has none, and its arrows are hidden rather than left pointing the previous layer's way.
    let dirsShown = false;
    const arrowMat = new THREE.ShaderMaterial({
      uniforms: {
        ...fieldUniforms,
        uDirLive: { value: null },
        uDirWeek: { value: null },
        uShell: { value: ARROW_SHELL },
        uScale: { value: 0 },
        uTime: { value: 0 },
        uMotion: { value: 0 },
      },
      vertexShader: ARROW_VERTEX,
      fragmentShader: ARROW_FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    // Numbers resampled onto a layout (see lib/overlaygpu.js), as a texture the GPU filters:
    // two channels for a field's values, four for its directions.
    function setFieldSampling(tex) {
      tex.wrapS = THREE.RepeatWrapping; // the map joins itself at the antimeridian
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.magFilter = THREE.LinearFilter;
      tex.minFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;
      tex.needsUpdate = true;
      return tex;
    }
    function fieldTexture(data, layout, format) {
      return setFieldSampling(new THREE.DataTexture(data, layout.width, layout.height, format, THREE.HalfFloatType));
    }
    // The week's: one forecast step per layer of a texture array.
    function fieldArrayTexture(data, layout, depth, format) {
      const tex = new THREE.DataArrayTexture(data, layout.width, layout.height, depth);
      tex.format = format;
      tex.type = THREE.HalfFloatType;
      return setFieldSampling(tex);
    }
    // A live layer's textures, built the first time the layer is drawn.
    function buildLiveTextures(set, step) {
      const layout = layoutFor(step);
      const { premul, cover } = regularizeField(set.values, layout);
      set.texture = fieldTexture(packHalfRG(premul, cover), layout, THREE.RGFormat);
      set.dirTexture = set.dirs
        ? fieldTexture(packHalf(regularizeDirections(set.dirs, layout)), layout, THREE.RGBAFormat)
        : null;
      // The wind itself, speed and direction together, for its particles.
      set.velTexture = set.velocity
        ? fieldTexture(packHalf(regularizeVelocity(set.velocity.east, set.velocity.north, layout)), layout, THREE.RGBAFormat)
        : null;
      set.v = layoutV(layout);
    }
    // Whether a direction field has anything in it at all.
    function hasReadings(dirs) {
      return Array.isArray(dirs) && dirs.some((d) => d != null);
    }
    // The layer's colour table: sRGB bytes straight from the legend's ramp, with no colour space
    // attached, so they reach the screen untouched.
    function lutFor(name) {
      if (!luts[name]) {
        const draw = drawFor(name);
        const tex = new THREE.DataTexture(buildLut(draw.colorFn, draw.max), LUT_SIZE, 1, THREE.RGBAFormat);
        tex.magFilter = THREE.LinearFilter;
        tex.minFilter = THREE.LinearFilter;
        tex.generateMipmaps = false;
        tex.needsUpdate = true;
        luts[name] = tex;
      }
      return luts[name];
    }

    // Where land is, as coverage: `{ mask, width, height }`, the fraction of each texel that is
    // land in one byte, north at row 0. The overlay is cut to the coastline with it, and the
    // arrows are kept to the sea with it.
    //
    // Shipped prebuilt (see scripts/build-landmask.mjs). Building it here meant the first "show
    // swell" fetched the whole 3MB vector coastline and filled four thousand rings into a 34MB
    // canvas before anything appeared -- about a second of main-thread work on a desktop when
    // measured, so more on a phone. The prebuilt file is about a quarter of that download, and
    // the work is a decompression of a few tens of milliseconds.
    //
    // Drawn here from the coastline only when the file cannot be had -- a browser without
    // DecompressionStream (Safari before 16.4), or the file missing -- since the mask is the
    // same either way and a slower one is better than none.
    function loadLandMask() {
      if (!sharedLandMask) {
        const base = ((import.meta.env && import.meta.env.BASE_URL) || '/').replace(/\/$/, '');
        sharedLandMask = fetchLandMask(base + '/' + LAND_MASK.file)
          .catch(() => null)
          .then((prebuilt) => prebuilt || loadCoastlineTopology().then(drawLandMask))
          .catch(() => null)
          .then((land) => {
            if (!land) sharedLandMask = null; // not worth keeping a failure
            return land;
          });
      }
      return sharedLandMask;
    }

    // The fallback: the coastline's land polygons filled into a canvas.
    function drawLandMask(topo) {
      const polygons = topo ? topologyToPolygons(topo) : [];
      if (!polygons.length) return null;
      try {
        return drawLandMaskAt(polygons, LAND_MASK.width, LAND_MASK.height);
      } catch {
        // A device that cannot spare 34MB of canvas for a moment. Half the resolution is a
        // quarter of the memory and still a coastline.
        try {
          return drawLandMaskAt(polygons, LAND_MASK.width / 2, LAND_MASK.height / 2);
        } catch {
          return null; // no mask; the grid's own coarse edge is used instead
        }
      }
    }
    // The canvas is read back in bands: one getImageData over eight million pixels would ask for
    // another 34MB in one go, at the moment the page can least afford it.
    function drawLandMaskAt(polygons, width, height) {
      const cv = document.createElement('canvas');
      cv.width = width;
      cv.height = height;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#fff';
      fillLandRings(ctx, polygonsToPixelRings(polygons, width, height), width);

      const mask = new Uint8Array(width * height);
      const band = Math.max(1, Math.floor(2 ** 21 / width)); // ~2M pixels a read
      for (let y0 = 0; y0 < height; y0 += band) {
        const rows = Math.min(band, height - y0);
        const px = ctx.getImageData(0, y0, width, rows).data;
        // Alpha, not red: getImageData is unpremultiplied, so a half-covered edge pixel comes
        // back opaque white at half alpha. Alpha is the coverage; red is just white.
        for (let i = 0, o = y0 * width; i < rows * width; i++, o++) mask[o] = px[i * 4 + 3];
      }
      // Let the canvas go before the texture is uploaded rather than after.
      cv.width = cv.height = 1;
      return { mask, width, height };
    }

    // The mask as a texture: a single channel, which at this size is 8MB of texture memory
    // against a canvas texture's 34MB, on a device that is usually a phone. The coverage array
    // is kept as well: the arrows ask it whether a point is at sea, which is both exact and
    // free, where a point-in-polygon test against four thousand rings would be neither.
    function landMaskTexture({ mask, width, height }) {
      const tex = new THREE.DataTexture(mask, width, height, THREE.RedFormat);
      tex.flipY = true; // north at row 0; flipped so v runs south to north like the sphere's
      tex.wrapS = THREE.RepeatWrapping;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = true;
      tex.needsUpdate = true;
      return tex;
    }

    // A flat arrow in its own XY plane, pointing along +Y: a shaft and a head, three triangles.
    // One instance per point, each carrying only where it stands. Which way it points, and
    // whether it is drawn at all, its vertex shader reads from the field.
    function arrowGeometry(points) {
      const geo = new THREE.InstancedBufferGeometry();
      const v = new Float32Array([
        -0.13, -0.85, 0, 0.13, -0.85, 0, 0.13, 0.12, 0, -0.13, 0.12, 0, // shaft
        -0.46, 0.05, 0, 0.46, 0.05, 0, 0, 0.9, 0,                        // head
      ]);
      geo.setAttribute('position', new THREE.BufferAttribute(v, 3));
      geo.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6]);
      const latLon = new Float32Array(points.length * 2);
      points.forEach((p, i) => {
        latLon[i * 2] = p.lat;
        latLon[i * 2 + 1] = p.lon;
      });
      geo.setAttribute('aLatLon', new THREE.InstancedBufferAttribute(latLon, 2));
      geo.instanceCount = points.length;
      return geo;
    }

    // Is this point at sea, according to the same coverage mask the overlay is cut with?
    function isWater(mask, width, height, lat, lon) {
      if (!mask) return true;
      const x = Math.min(width - 1, Math.max(0, Math.floor(((lon + 180) / 360) * width)));
      const y = Math.min(height - 1, Math.max(0, Math.floor(((90 - lat) / 180) * height)));
      return mask[y * width + x] < 128;
    }

    // The points the arrows stand on: the lattice from lib/swellarrows.js, culled to the sea.
    //
    // Built once, with the land mask. Every layer and every frame of the week uses the same
    // points -- only the directions differ, and those are the shader's business -- so nothing
    // here is rebuilt when a layer is switched or the week plays. The lattice's order is kept,
    // because its sequence is arranged so that any prefix still covers the whole globe: that is
    // what lets the draw count follow the zoom without rebuilding anything. A point with no
    // direction to show at the moment on screen is drawn at zero size, so one prefix serves
    // every field.
    function seaLattice(land) {
      const cached = land ? sharedLattices.get(land) : sharedLatticeNoMask;
      if (cached) return cached;
      const lattice = fibonacciSphere(ARROW_FIELD).filter((p) => !land || isWater(land.mask, land.width, land.height, p.lat, p.lon));
      if (land) sharedLattices.set(land, lattice); else sharedLatticeNoMask = lattice;
      return lattice;
    }

    // Arrows hold a roughly constant size on screen, so they stay legible zoomed out and do not
    // become billboards zoomed in. Apparent size is world size over depth, so the world size
    // tracks the depth.
    function arrowScaleForDistance(distance) {
      return 0.016 * Math.max(distance - R, 0.02) / (3 - R);
    }

    // The arrows' glide (see ARROW_VERTEX in lib/overlaygpu.js): how far into it they are, in
    // seconds, and how much of it is showing -- eased up to 1 while anyone is looking and back
    // down to 0, the arrows at rest on their points, once the globe has been left alone.
    const ARROW_SETTLE_MS = 700;
    let arrowTime = 0;
    let arrowMotion = 0;
    // The wind's particles show its direction better than arrows can, and both at once is
    // clutter: while they are drawn, the arrows step aside.
    function arrowsShown() {
      return !!arrowMesh && wavesOnRef.current && dirsShown && !particlesWanted();
    }
    // Whether the arrows are gliding or settling, which keeps the frame loop drawing.
    function arrowsMoving() {
      return !reducedMotion && arrowsShown() && (motionAllowed() || arrowMotion > 0);
    }

    function updateArrows(dtMs) {
      if (!arrowMesh) return;
      arrowMesh.visible = arrowsShown();
      if (!arrowMesh.visible) { arrowMotion = 0; return; }
      const wanted = !reducedMotion && motionAllowed() ? 1 : 0;
      const step = dtMs / ARROW_SETTLE_MS;
      arrowMotion = wanted > arrowMotion ? Math.min(wanted, arrowMotion + step) : Math.max(wanted, arrowMotion - step);
      // Wrapped at a whole number of glides, which the shader cannot tell from not wrapping, so
      // the time never grows large enough to cost the shader its precision.
      if (arrowMotion > 0) arrowTime = (arrowTime + dtMs / 1000) % (ARROW_DRIFT_SECONDS * 1000);
      arrowMat.uniforms.uTime.value = arrowTime;
      arrowMat.uniforms.uMotion.value = arrowMotion;
      // The camera's own half-FOV, so the count follows what is actually on screen rather than
      // a hard-coded guess at it.
      const geo = arrowMesh.geometry;
      geo.instanceCount = Math.min(geo.getAttribute('aLatLon').count, arrowCountForDistance(state.distance, {
        halfFovRad: (camera.fov * Math.PI) / 360,
      }));
      // Every frame, smoothly. It used to be thousands of instance matrices re-laid-out
      // whenever the size had drifted by 4%, so a zoom resized the arrows in 4% jumps.
      arrowMat.uniforms.uScale.value = arrowScaleForDistance(state.distance);
    }

    function ensureWaveOverlay() {
      if (waveRequested || !wavesOnRef.current) return;
      waveRequested = true;
      Promise.all([fetchWaveGrid(), loadLandMask()])
        .then(([grid, land]) => {
          if (cancelled) return;
          if (!grid || !grid.data) { setWaveMeta({ ok: false, build: grid && grid.build }); return; }
          waveMaskTexture = land ? landMaskTexture(land) : null;
          const raw = decodeHeights(base64ToBytes(grid.data));
          // The grid says how coarse it is. It used to be assumed from a shared constant, which
          // was fine only while every layer was built at the same step -- the swell grid is 2
          // degrees now because the Worker samples it from a published file, while the wind
          // grid is still 10 because it is still one API call per cell. Assuming either would
          // paint one layer's numbers on the other's geography.
          const swellStep = gridStepOf(grid);
          // Directions are optional: a grid cached before the Worker started fetching them has
          // heights and nothing else, and the colours are worth drawing on their own.
          const directions = grid.dirs ? decodeDirections(base64ToBytes(grid.dirs)) : null;
          // Kept so switching back from the wind is a uniform change rather than another fetch.
          // `values` is what gets painted, with gaps filled so the overlay has no holes behind
          // the coastline mask -- and only when there is a mask to stop the fill at the shore.
          // Without one, "no reading" is the only thing marking out land at all, and filling it
          // would paint swell across every continent. `raw` is what gets *read*: the gap fill
          // invents a plausible height for a land cell from its sea neighbours, which is
          // exactly right for a picture and exactly wrong for a number. Tapping Nevada must say
          // "no reading", not borrow the Pacific's swell.
          liveLayers.swell = {
            values: waveMaskTexture ? fillGridGaps(raw, 2, swellStep) : raw,
            raw,
            dirs: directions,
            step: swellStep,
          };
          // Numbers in, colours out, per screen pixel, in the globe's own material: see
          // drawOverlay in lib/overlaygpu.js. The layer's own textures and colour table are
          // filled in by applyLiveLayer below.
          overlayUniforms.uLandMask.value = waveMaskTexture;
          overlayUniforms.uHasMask.value = waveMaskTexture ? 1 : 0;
          overlayReady = true;

          const lattice = seaLattice(land);
          if (lattice.length) {
            arrowMesh = new THREE.Mesh(arrowGeometry(lattice), arrowMat);
            arrowMesh.renderOrder = 2; // over the overlay and the coastline, never under them
            // The geometry is one small arrow at the centre of the globe; only the shader knows
            // where its copies end up, so bounds-based culling would hide all of them.
            arrowMesh.frustumCulled = false;
            globeGroup.add(arrowMesh);
          }

          // The first draw takes the same path as every layer switch after it, so the colours,
          // the arrows and what tap-to-read reads are set up in one place. (It used to be built
          // separately here, and once forgot to tell tap-to-read, which then stayed silent
          // until the layer had been switched at least once.)
          applyLiveLayer('swell');

          setWaveMeta({
            ok: true, generatedAt: grid.generatedAt, stale: grid.stale, coarse: !waveMaskTexture,
            arrows: !!arrowMesh && hasReadings(directions),
            // Two different reasons for a chart with no arrows on it, and they look identical:
            // the grid was cached before directions were fetched at all, or it carries them and
            // none survived. Saying which one turns a guess into a glance.
            noDirections: !grid.dirs,
          });
        })
        .catch(() => setWaveMeta({ ok: false }));
    }

    // Show whichever live layer is selected.
    //
    // The mesh, the coastline mask and the arrows' lattice are built once and reused, and each
    // layer's numbers go to the GPU once: a layer is the same picture drawn from different
    // numbers through a different colour table, so switching is a few uniform writes rather
    // than a repaint. Returns whether it could draw, so a caller that asked for a layer with no
    // data can say so instead of leaving the previous layer up under the new label -- which
    // would be the worst outcome available: the wind map, captioned as swell.
    function applyLiveLayer(name) {
      const set = liveLayers[name];
      const draw = LAYER_DRAW[name] && drawFor(name);
      if (!set || !draw || !overlayReady) return false;
      const step = set.step || GRID_LAT_STEP;
      if (!set.texture) {
        const buildStart = perf ? performance.now() : 0;
        buildLiveTextures(set, step);
        if (perf) perf.paintMs = performance.now() - buildStart;
      }
      const u = overlayUniforms;
      u.uLive.value = set.texture;
      u.uLut.value = lutFor(name);
      u.uLutMax.value = draw.max;
      fieldUniforms.uWeekOn.value = 0;
      fieldUniforms.uLiveV.value.fromArray(set.v);
      // The arrows read the same uniforms; only their directions are the layer's own. A layer
      // with none shows no arrows, rather than the last layer's left pointing on under its name.
      arrowMat.uniforms.uDirLive.value = set.dirTexture;
      dirsShown = !!set.dirTexture;
      shownKey = 'live:' + name;
      noteInput(); // a layer just shown is being looked at: its particles, if any, should move
      painted = { read: set.raw || set.values, dirs: set.dirs, step, layer: name, frame: null };
      state.dataDirty = true;
      if (markDirtyRef.current) markDirtyRef.current();
      return true;
    }
    applyLayerRef.current = applyLiveLayer;

    // The animated week, uploaded to the GPU once: every forecast step resampled onto the same
    // regular grid and stacked as the layers of one texture array, its directions likewise. A
    // frame of the animation is then two layers blended by a uniform -- no repaint, no upload,
    // no garbage -- and the arrows turn through the same blend.
    function setWeek(next) {
      if (week) {
        week.texture.dispose();
        if (week.dirTexture) week.dirTexture.dispose();
        week = null;
      }
      shownKey = null;
      if (next && Array.isArray(next.list) && next.list.length && Number.isFinite(next.latStep)) {
        const buildStart = perf ? performance.now() : 0;
        const step = next.latStep;
        const layout = layoutFor(step);
        const count = next.list.length;
        const texels = layout.width * layout.height;
        const values = new Uint16Array(texels * 2 * count);
        // A week built before the Worker fetched directions has none, and draws no arrows.
        const dirs = next.list.some((f) => f.dirs) ? new Uint16Array(texels * 4 * count) : null;
        // One scratch field and one scratch set of vectors, refilled for each step.
        const field = { premul: new Float32Array(texels), cover: new Float32Array(texels) };
        const vectors = new Float32Array(texels * 4);
        for (let k = 0; k < count; k++) {
          const frame = next.list[k];
          // Gaps filled exactly as the live field's are, and only when the coastline mask is
          // there to stop the fill at the shore.
          regularizeField(waveMaskTexture ? fillGridGaps(frame.heights, 2, step) : frame.heights, layout, field);
          packHalfRG(field.premul, field.cover, values.subarray(k * texels * 2, (k + 1) * texels * 2));
          if (dirs) {
            regularizeDirections(frame.dirs, layout, vectors);
            packHalf(vectors, dirs.subarray(k * texels * 4, (k + 1) * texels * 4));
          }
        }
        week = {
          layer: next.layer || 'swell',
          list: next.list,
          step,
          count,
          v: layoutV(layout),
          texture: fieldArrayTexture(values, layout, count, THREE.RGFormat),
          dirTexture: dirs ? fieldArrayTexture(dirs, layout, count, THREE.RGBAFormat) : null,
        };
        if (perf) perf.paintMs = performance.now() - buildStart;
      }
      state.dataDirty = true;
    }
    setWeekRef.current = setWeek;

    // Which moment of the forecast the overlay shows, decided on every frame the loop runs.
    //
    // While the week plays, the playhead moves on by the time this frame took, so it keeps
    // real-time pace at 30, 60 or 120 Hz, and the shader blends the two steps either side of
    // it. React hears only when the nearest step changes, for the scrubber and the label.
    // Returns whether the picture changed or is moving, so the loop keeps drawing. The arrows
    // read the same uniforms, so they move with the colours on every frame.
    let shownKey = null;
    let lastFrameIdx = 0;
    function updateOverlayTime(dt) {
      if (!overlayReady || !wavesOnRef.current) return false;
      const tl = timelineRef.current;
      let advancing = false;
      if (week && tl.playing) {
        const next = advanceTimeline(tl.pos, week.count - 1, dt, { speed: tl.speed, stepMs: STEP_MS, loop: tl.loop });
        tl.pos = next.pos;
        if (next.ended) { tl.playing = false; setPlaying(false); }
        advancing = true;
      }
      const slot = week ? weekSlot(tl.pos, week.count, tl.playing) : null;
      const key = slot ? 'week:' + slot.i0 + ':' + slot.i1 + ':' + slot.t + ':' + tl.playing : 'live:' + layerRef.current;
      if (key === shownKey) return advancing;
      if (!slot) {
        // Back to the live field, and its arrows.
        applyLiveLayer(layerRef.current);
      } else {
        shownKey = key;
        const u = overlayUniforms;
        u.uWeek.value = week.texture;
        u.uLut.value = lutFor(week.layer);
        u.uLutMax.value = drawFor(week.layer).max;
        fieldUniforms.uWeekOn.value = 1;
        fieldUniforms.uLayer0.value = slot.i0;
        fieldUniforms.uLayer1.value = slot.i1;
        fieldUniforms.uMix.value = slot.t;
        fieldUniforms.uWeekV.value.fromArray(week.v);
        arrowMat.uniforms.uDirWeek.value = week.dirTexture;
        dirsShown = !!week.dirTexture;
      }
      const idx = slot ? Math.min(week.count - 1, Math.round(tl.pos)) : 0;
      if (idx !== lastFrameIdx) { lastFrameIdx = idx; setFrameIdx(idx); }
      return true;
    }

    // Exactly what is on the sphere right now, for tap-to-read: the frame of the week on screen
    // (blended, if it is between two), or the live field.
    function shownField() {
      const tl = timelineRef.current;
      if (week) {
        const frame = weekFrameAt(week.list, tl.pos, tl.playing);
        if (frame) return { read: frame.heights, dirs: frame.dirs, step: week.step, layer: week.layer, frame: frame.t || null };
      }
      return painted;
    }

    // Fetch the wind grid, once, the first time the layer is asked for.
    //
    // On demand rather than alongside the swell, because it is a second pass over the upstream
    // API: a viewer who only ever looks at the swell should not spend a wind build they never
    // see. See worker/src/windGrid.js for the budget this is protecting.
    function ensureWindLayer() {
      if (windRequested) return;
      windRequested = true;
      setWindState('loading');
      fetchWindGrid()
        .then((grid) => {
          if (cancelled) return;
          if (!grid || !grid.data) {
            setWindState('unavailable');
            setWindMeta({ ok: false, build: grid && grid.build });
            // Retryable: a cooldown or a half-built grid resolves on its own, and a viewer who
            // asked early should be able to ask again.
            windRequested = false;
            return;
          }
          const windStep = gridStepOf(grid);
          const speeds = decodeSpeeds(base64ToBytes(grid.data));
          const dirs = grid.dirs ? decodeDirections(base64ToBytes(grid.dirs)) : null;
          // The wind as east and north components, for its particles (see lib/windparticles.js),
          // with gaps filled exactly as the colours' are so the streaks run to the same shore.
          const velocity = dirs && particlesPossible ? velocityComponents(speeds, dirs) : null;
          liveLayers.wind = {
            // Gaps are filled only when the coastline mask is there to stop the fill at the
            // shore, exactly as the swell does -- without one, "no reading" is the only thing
            // marking out land and filling it paints the map over every continent.
            values: waveMaskTexture ? fillGridGaps(speeds, 2, windStep) : speeds,
            // Unfilled, for tap-to-read. See the swell layer above.
            raw: speeds,
            dirs,
            step: windStep,
            velocity: velocity && waveMaskTexture
              ? { east: fillGridGaps(velocity.east, 2, windStep), north: fillGridGaps(velocity.north, 2, windStep) }
              : velocity,
          };
          setWindMeta({
            ok: true, generatedAt: grid.generatedAt, stale: grid.stale, coarse: !waveMaskTexture,
            arrows: !!dirs, noDirections: !grid.dirs,
            // Drawn as moving streaks rather than arrows: see the particles below.
            particles: !!velocity,
          });
          setWindState('ready');
          if (layerRef.current === 'wind') applyLiveLayer('wind');
        })
        .catch(() => { windRequested = false; setWindState('unavailable'); setWindMeta({ ok: false }); });
    }
    loadWindRef.current = ensureWindLayer;

    // The wind's particles: a few thousand streaks carried across the globe by the live wind,
    // in place of its arrows. See lib/windparticles.js.
    //
    // Where every particle is lives in a float texture the GPU both reads and writes, which
    // needs float render targets -- in WebGL2 that is EXT_color_buffer_float, offered nearly
    // everywhere. Without it, and for anyone whose system asks for less motion, the wind keeps
    // its arrows, exactly as before.
    const reducedMotion = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const particlesPossible = !reducedMotion && renderer.extensions.has('EXT_color_buffer_float');
    // How long the particles take to fade in when the wind is shown, in milliseconds.
    const PARTICLE_FADE_MS = 400;
    let particles = null;
    // The last time anyone touched the globe. The particles, and the arrows' glide, run for
    // AMBIENT_MOTION_MS after it (see lib/motion.js), then hold still so a globe left open stops
    // drawing.
    let lastInputAt = performance.now();
    function noteInput() { lastInputAt = performance.now(); }
    function motionAllowed() { return performance.now() - lastInputAt < AMBIENT_MOTION_MS; }

    // Whether the particles belong on screen: the overlay shows the live wind, and the wind came
    // with directions to make them from.
    function particlesWanted() {
      const set = liveLayers.wind;
      return particlesPossible && wavesOnRef.current && shownKey === 'live:wind' && !!(set && set.velTexture);
    }
    // And whether they are moving, which keeps the frame loop drawing.
    function particlesRunning() {
      return particlesWanted() && motionAllowed();
    }

    // Two state textures, read from one and written to the other in turn; the pass that moves
    // the particles; and the streaks. Built the first time the wind is shown.
    function buildParticles() {
      const target = () => new THREE.WebGLRenderTarget(PARTICLE_STATE_SIZE, PARTICLE_STATE_SIZE, {
        type: THREE.FloatType,
        format: THREE.RGBAFormat,
        // Each texel is one particle, read exactly: a float texture cannot be filtered on every
        // device, and an average of two particles is not a particle.
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        generateMipmaps: false,
        depthBuffer: false,
        stencilBuffer: false,
      });
      // The wind and the mask, shared by both passes.
      const field = {
        uVelocity: { value: null },
        uVelocityV: { value: new THREE.Vector2(1, 0) },
        uLandMask: { value: waveMaskTexture },
        uHasMask: { value: waveMaskTexture ? 1 : 0 },
      };
      const updateMat = new THREE.ShaderMaterial({
        uniforms: {
          ...field,
          uState: { value: null },
          uViewCenter: { value: new THREE.Vector3(0, 0, 1) },
          uViewCos: { value: 0 },
          uGrowthCos: { value: 0 },
          uGrowth: { value: 0 },
          uScale: { value: 0 },
          uDt: { value: 0 },
          uFrame: { value: 0 },
        },
        vertexShader: PARTICLE_UPDATE_VERTEX,
        fragmentShader: PARTICLE_UPDATE_FRAGMENT,
        depthTest: false,
        depthWrite: false,
      });
      // One triangle over the whole target: every texel, so every particle, gets a fragment.
      const updateGeo = new THREE.BufferGeometry();
      updateGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
      const updateMesh = new THREE.Mesh(updateGeo, updateMat);
      updateMesh.frustumCulled = false;
      const updateScene = new THREE.Scene();
      updateScene.add(updateMesh);

      // A streak is a strip of two triangles: x is 0 at the head and 1 at the tail, y the side.
      const drawGeo = new THREE.InstancedBufferGeometry();
      drawGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 0, 1, 0, 1, -1, 0, 1, 1, 0], 3));
      drawGeo.setIndex([0, 2, 1, 1, 2, 3]);
      const texels = new Float32Array(MAX_PARTICLES * 2);
      for (let i = 0; i < MAX_PARTICLES; i++) texels.set(stateTexel(i), i * 2);
      drawGeo.setAttribute('aTexel', new THREE.InstancedBufferAttribute(texels, 2));
      drawGeo.instanceCount = 0;
      const drawMat = new THREE.ShaderMaterial({
        uniforms: {
          ...field,
          uState: { value: null },
          uShell: { value: R },
          uTrail: { value: 0 },
          uViewport: { value: new THREE.Vector2(1, 1) },
          uPixelRatio: { value: 1 },
          uOpacity: { value: 0 },
        },
        vertexShader: PARTICLE_DRAW_VERTEX,
        fragmentShader: PARTICLE_DRAW_FRAGMENT,
        transparent: true,
        // Nothing hides a streak but the globe, and round the back its shader has faded it out
        // -- the markers' rule. A strip faces whichever way its streak happens to run.
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const drawMesh = new THREE.Mesh(drawGeo, drawMat);
      drawMesh.renderOrder = 2; // where the arrows they replace were: over the overlay, under the markers
      drawMesh.frustumCulled = false; // the geometry is a unit strip; only the shader knows where
      drawMesh.visible = false;
      globeGroup.add(drawMesh);
      return {
        targets: [target(), target()], read: 0, field, updateMat, updateGeo, updateScene,
        updateCamera: new THREE.Camera(), drawGeo, drawMat, drawMesh,
        frame: 0, opacity: 0, viewCos: null,
      };
    }

    const particleView = new THREE.Quaternion();
    // Called on every frame drawn, before the scene is: moves the particles on by `dtMs` if they
    // are running, and sets the streaks up to draw where they are now.
    function stepParticles(dtMs, running) {
      if (!particlesWanted()) {
        if (particles && particles.drawMesh.visible) {
          particles.drawMesh.visible = false;
          particles.opacity = 0; // so they fade in again next time
        }
        return;
      }
      if (!particles) particles = buildParticles();
      const p = particles;
      const set = liveLayers.wind;
      p.field.uVelocity.value = set.velTexture;
      p.field.uVelocityV.value.fromArray(set.v);
      p.field.uLandMask.value = waveMaskTexture;
      p.field.uHasMask.value = waveMaskTexture ? 1 : 0;

      const halfFov = (camera.fov * Math.PI) / 360;
      // The patch of globe in view, a little past the screen's corners so particles drift in
      // from beyond the edge rather than appearing at it -- and never past the horizon.
      const cap = Math.min(Math.acos(1 / state.distance), viewCapRadius(state.distance, halfFov, width / height) * 1.1);
      const viewCos = Math.cos(cap);
      const scale = degreesPerSecondPerKph(state.distance, halfFov, height, particlePxPerKph(state.distance));
      // A first update even when idle: there has to be something to draw.
      if (running || p.frame === 0) {
        const u = p.updateMat.uniforms;
        // The point straight under the camera, in the globe's own frame: the camera sits on +Z,
        // and the globe is turned.
        particleView.setFromEuler(globeGroup.rotation).invert();
        u.uViewCenter.value.set(0, 0, 1).applyQuaternion(particleView);
        u.uViewCos.value = viewCos;
        // Zooming out: the share of particles the new ring of view should hold are reborn in it.
        // Its area over the whole view's, with a cap's area going as one minus its cosine.
        if (p.viewCos != null && viewCos < p.viewCos) {
          u.uGrowthCos.value = p.viewCos;
          u.uGrowth.value = 1 - (1 - p.viewCos) / (1 - viewCos);
        } else {
          u.uGrowthCos.value = viewCos;
          u.uGrowth.value = 0;
        }
        u.uScale.value = scale;
        u.uDt.value = running ? dtMs / 1000 : 0;
        p.frame = (p.frame % 1000000) + 1;
        u.uFrame.value = p.frame;
        u.uState.value = p.targets[p.read].texture;
        const write = 1 - p.read;
        renderer.setRenderTarget(p.targets[write]);
        renderer.render(p.updateScene, p.updateCamera);
        renderer.setRenderTarget(null);
        p.read = write;
        p.viewCos = viewCos;
      }

      const d = p.drawMat.uniforms;
      d.uState.value = p.targets[p.read].texture;
      d.uTrail.value = PARTICLE_TRAIL_SECONDS * scale;
      d.uViewport.value.set(renderer.domElement.width, renderer.domElement.height);
      d.uPixelRatio.value = currentPixelRatio;
      p.opacity = Math.min(1, p.opacity + dtMs / PARTICLE_FADE_MS);
      d.uOpacity.value = p.opacity;
      p.drawGeo.instanceCount = particleCount(state.distance, halfFov, width, height);
      p.drawMesh.visible = true;
      // Still fading in: keep drawing until it has, even if the particles themselves are frozen.
      if (p.opacity < 1) state.dataDirty = true;
    }

    function disposeParticles() {
      if (!particles) return;
      particles.targets.forEach((t) => t.dispose());
      particles.updateGeo.dispose();
      particles.updateMat.dispose();
      particles.drawGeo.dispose();
      particles.drawMat.dispose();
      particles = null;
    }

    // The coastline's tiles (see coastlineTilesInSteps) made into meshes, a step at a time like
    // the tiles themselves; null if there is no coastline to draw.
    function* buildCoastline(topo, { LineSegments2, LineSegmentsGeometry, LineMaterial }) {
      const tiles = yield* coastlineTilesInSteps(topo, COASTLINE_SHELL, latLonToVector3, { coarseStride: COASTLINE_COARSE_STRIDE });
      if (!tiles.fine.length) return null;
      const material = new LineMaterial({
        color: 0x8fe9d4,
        linewidth: COASTLINE_WIDTH_PX,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const built = { material, fine: [], coarse: [], coarseError: tiles.coarseError };
      for (const level of ['fine', 'coarse']) {
        for (const tile of tiles[level]) {
          const geo = new LineSegmentsGeometry();
          geo.setPositions(tile.positions);
          const mesh = new LineSegments2(geo, material);
          // Drawn after the globe and writing no depth, so it never fights the surface it sits
          // on -- but still depth-*tested*, which is what hides the far side of the world.
          mesh.renderOrder = 1;
          mesh.visible = false;
          built[level].push({ mesh, center: new THREE.Vector3().fromArray(tile.center), reach: tile.reach });
          yield;
        }
      }
      return built;
    }

    function ensureCoastline() {
      if (coastlineRequested || state.distance > COASTLINE_FADE_START) return;
      coastlineRequested = true;
      // The ribbon classes are only wanted once the camera is this close: loaded on demand, like
      // the base map's transcoder.
      Promise.all([
        loadCoastlineTopology(),
        import('three/examples/jsm/lines/LineSegments2.js'),
        import('three/examples/jsm/lines/LineSegmentsGeometry.js'),
        import('three/examples/jsm/lines/LineMaterial.js'),
      ])
        .then(([topo, ...classes]) => {
          if (cancelled || !topo) return;
          const job = buildCoastline(topo, Object.assign({}, ...classes));
          const slice = () => {
            coastlineTimer = null;
            if (cancelled) return;
            let step;
            try {
              const until = performance.now() + COASTLINE_SLICE_MS;
              do step = job.next(); while (!step.done && performance.now() < until);
            } catch {
              return; // as below
            }
            if (!step.done) {
              coastlineTimer = setTimeout(slice, 0);
              return;
            }
            if (!step.value) return;
            coastline = step.value;
            for (const t of [...coastline.fine, ...coastline.coarse]) globeGroup.add(t.mesh);
            state.dataDirty = true;
          };
          slice();
        })
        // The fetch already swallows its own failures; this catches anything that goes wrong
        // building the geometry. The globe is fully usable without the lines, so there is
        // nothing to report and nothing to retry.
        .catch(() => {});
    }

    // How many CSS pixels an angle at the globe's centre spans on screen right under the camera,
    // where the globe is magnified most: what coastlineLevel weighs the coarse level against.
    function coastPxPerRadian() {
      return (R * height) / (2 * (state.distance - R) * Math.tan((camera.fov * Math.PI) / 360));
    }

    // Which coastline tiles to draw this frame: the level wanted, and of that only the tiles on
    // the camera's side of the globe -- three already skips the ones outside the view.
    const coastView = new THREE.Quaternion();
    const coastEuler = new THREE.Euler();
    const coastToCamera = new THREE.Vector3();
    function showCoastline(level) {
      coastLevel = level;
      // The camera's direction in the globe's own frame, and how far round from it the coastline
      // can be seen: to the horizon, and a little past it, since the lines sit just above the
      // surface.
      coastView.setFromEuler(coastEuler.set(state.rotX, state.rotY, 0)).invert();
      coastToCamera.set(0, 0, 1).applyQuaternion(coastView);
      const sight = Math.acos(R / state.distance) + Math.acos(R / COASTLINE_SHELL);
      for (const name of ['fine', 'coarse']) {
        for (const t of coastline[name]) {
          t.mesh.visible = name === level && t.center.dot(coastToCamera) > Math.cos(Math.min(Math.PI, sight + t.reach));
        }
      }
    }

    // The lights, at the strength they were tuned for.
    //
    // These levels were picked by eye in the original mockup, which ran on three.js r128. Lights
    // there carried a hidden factor of pi that cancelled the 1/pi in the material's diffuse term,
    // so an intensity of 1 lit a surface at its own colour. three.js dropped that factor in r155
    // (lights are in physical units now), and on r185 the same numbers lit the globe at a third
    // of the strength they were chosen for: the satellite image came out at about two thirds of
    // its own brightness where the sun is highest, and a third of it on the far side. Scaling by
    // pi gives back the lighting that was designed.
    const TUNED_UNDER_R128 = Math.PI;
    scene.add(new THREE.AmbientLight(0xbcd4e0, 0.55 * TUNED_UNDER_R128));
    const dirLight = new THREE.DirectionalLight(0xfff2d8, 0.95 * TUNED_UNDER_R128);
    dirLight.position.set(3, 2, 4);
    scene.add(dirLight);
    const fillLight = new THREE.DirectionalLight(0x4fccb8, 0.18 * TUNED_UNDER_R128);
    fillLight.position.set(-3, -1, -2);
    scene.add(fillLight);

    // starfield backdrop
    const starCount = 260;
    const starPositions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const r = 7 + Math.random() * 2.5;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      starPositions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      starPositions[i * 3 + 2] = r * Math.cos(phi);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    // THREE.PointsMaterial with no sprite texture renders each point as a hard-edged square —
    // at this small a size that reads as "pixelated" flecks rather than soft stars, so give it
    // a small radial-gradient dot texture instead.
    const starDotCanvas = document.createElement('canvas');
    starDotCanvas.width = 32; starDotCanvas.height = 32;
    const sdctx = starDotCanvas.getContext('2d');
    const starDotGrad = sdctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    starDotGrad.addColorStop(0, 'rgba(255,255,255,1)');
    starDotGrad.addColorStop(0.4, 'rgba(255,255,255,0.8)');
    starDotGrad.addColorStop(1, 'rgba(255,255,255,0)');
    sdctx.fillStyle = starDotGrad;
    sdctx.fillRect(0, 0, 32, 32);
    const starDotTexture = new THREE.CanvasTexture(starDotCanvas);
    const STAR_OPACITY = 0.85;
    const starMat = new THREE.PointsMaterial({ map: starDotTexture, color: 0xdfeaf2, size: 0.05, transparent: true, opacity: STAR_OPACITY, sizeAttenuation: true, depthWrite: false });
    const stars = new THREE.Points(starGeo, starMat);
    scene.add(stars);

    // The base map's mute (see muteUniforms): eased toward 1 while an overlay is drawn, and back.
    function updateMute(dtMs) {
      muteUniforms.uMuteMask.value = waveMaskTexture;
      muteUniforms.uMuteHasMask.value = waveMaskTexture ? 1 : 0;
      const wanted = wavesOnRef.current && overlayReady ? 1 : 0;
      const u = muteUniforms.uMute;
      if (u.value === wanted) return;
      const step = dtMs / BASEMAP_MUTE_MS;
      u.value = wanted > u.value ? Math.min(wanted, u.value + step) : Math.max(wanted, u.value - step);
      state.dataDirty = true; // keep drawing until the fade is done
    }

    // The moment the globe is showing, for its day and night: the forecast step on screen while
    // the week is shown -- blended between two steps exactly as the overlay is, so the night sweeps
    // round smoothly as it plays -- and otherwise now.
    function shownTime() {
      const u = fieldUniforms;
      if (wavesOnRef.current && week && u.uWeekOn.value > 0.5) {
        const a = week.list[u.uLayer0.value];
        const b = week.list[u.uLayer1.value];
        const ta = frameTimeMs(a && a.t);
        const tb = frameTimeMs(b && b.t);
        if (ta != null && tb != null) return { ms: ta + (tb - ta) * u.uMix.value, live: false };
      }
      return { ms: Date.now(), live: true };
    }
    // When the night last drawn was for, and whether that was now. The live map's night creeps on
    // a quarter of a degree a minute, which an idle globe -- one that draws nothing until it is
    // touched -- would otherwise never show: it is redrawn every couple of minutes to keep up.
    const SUN_REDRAW_MS = 120000;
    let sunShownAt = 0;
    let sunLive = true;
    const sunWorld = new THREE.Vector3();
    function updateSun() {
      const shown = shownTime();
      const d = sunDirection(shown.ms);
      sunUniforms.uSunDir.value.set(d[0], d[1], d[2]);
      // The shell is in world space, and the globe is turned.
      sunWorld.set(d[0], d[1], d[2]).applyQuaternion(globeGroup.quaternion);
      atmosphereMat.uniforms.uSunDir.value.copy(sunWorld);
      sunShownAt = shown.ms;
      sunLive = shown.live;
    }

    // The atmosphere: a shell a little larger than the globe, drawn from the inside so only the
    // ring outside the globe's edge shows. See lib/atmosphere.js.
    const atmosphereGeo = new THREE.SphereGeometry(R * ATMOSPHERE_RADIUS, 96, 64);
    const atmosphereMat = new THREE.ShaderMaterial({
      // Where the sun is, in world space: the shell does not turn with the globe.
      uniforms: { uSunDir: { value: new THREE.Vector3(0, 0, 1) } },
      vertexShader: ATMOSPHERE_VERTEX,
      fragmentShader: ATMOSPHERE_FRAGMENT,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
    });
    const atmosphere = new THREE.Mesh(atmosphereGeo, atmosphereMat);
    scene.add(atmosphere);

    // Every spot marker in one instanced draw instead of one mesh each. With 150+ spots that's
    // the difference between 150+ draw calls per frame and exactly one — the single biggest
    // reason the globe got progressively less smooth as the spot catalog grew from 44 to 153.
    // Each instance is a flat dot, two triangles, turned to face the camera and faded toward
    // the horizon by its shader (see lib/markerdots.js).
    // Markers pile up on the coastlines that carry the most spots. Zoomed out, California,
    // Central America and southwest France are each an indistinct blob of overlapping dots,
    // and a tap gets whichever one the raycaster happened to hit first -- so spots within a
    // cell of a grid merge into one marker carrying a count, and the cell shrinks as you zoom
    // until, close enough, nothing merges at all. Tapping a cluster turns the globe to it and
    // zooms a step, which is what splits it. The grid maths lives in lib/markercluster.js.
    const allSpots = [];
    dataRef.current.order.forEach((id) => {
      const s = dataRef.current.spots[id];
      if (!s || !Number.isFinite(s.lat) || !Number.isFinite(s.lon)) return;
      allSpots.push({ id, lat: s.lat, lon: s.lon });
    });

    // A small pool of label elements, lent to markers while their labels are on screen.
    //
    // It used to be one element per spot, made up front -- 3,518 hidden divs at the full catalog,
    // every one of them given new text whenever its reading changed -- for a screen that shows at
    // most MAX_LABELS names at a time. Now there are enough for those and for the ones still
    // fading out, each lent to a marker when its label appears and handed back when it has gone.
    // Clusters re-form on every zoom step, and the pool means that never creates or destroys a
    // DOM node either.
    const LABEL_POOL_SIZE = 30;
    const labelPool = Array.from({ length: LABEL_POOL_SIZE }, () => {
      const el = document.createElement('div');
      el.className = 'tl-label';
      // Anchored at the container's origin; updateLabels() moves it purely via transform.
      el.style.left = '0';
      el.style.top = '0';
      el.style.display = 'none';
      el.owner = null;
      container.appendChild(el);
      return el;
    });
    const freeLabels = labelPool.slice();
    // Hand an element back: hidden, unowned, ready for the next marker.
    function returnLabel(el) {
      stopLabelFade(el);
      el.style.display = 'none';
      if (el.owner) { el.owner.label = null; el.owner = null; }
      if (!freeLabels.includes(el)) freeLabels.push(el);
    }
    // Lend one to a marker, dressed for it. When every element is busy -- more labels fading out
    // than the pool holds, in a fast spin -- one that is fading out is taken back for it; if none
    // is, the label waits for the next frame.
    function lendLabel(m) {
      if (!freeLabels.length) {
        const fading = labelPool.find((e) => e.owner && !e.owner.labelShown);
        if (!fading) return null;
        returnLabel(fading);
      }
      const el = freeLabels.pop();
      el.owner = m;
      m.label = el;
      el.className = m.count > 1 ? 'tl-label tl-count' : 'tl-label';
      el.textContent = m.labelText;
      el.title = m.labelTitle;
      el.setAttribute('aria-label', m.labelTitle);
      return el;
    }

    // One quad, two units across, instanced once per marker. Allocated for every spot and then
    // drawn with `instanceCount` set to however many markers the current zoom produces.
    const markerSlots = Math.max(allSpots.length, 1);
    const markerGeo = new THREE.InstancedBufferGeometry();
    markerGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    markerGeo.setIndex([0, 1, 2, 0, 2, 3]);
    // Where each marker is, its colour and its size. The positions are fixed for a zoom level --
    // the globe group is what rotates -- and the size at a given zoom is one uniform, so only
    // the colours change between rebuilds.
    const markerCenters = new THREE.InstancedBufferAttribute(new Float32Array(markerSlots * 3), 3);
    const markerColors = new THREE.InstancedBufferAttribute(new Float32Array(markerSlots * 3), 3);
    const markerSizes = new THREE.InstancedBufferAttribute(new Float32Array(markerSlots), 1);
    markerColors.setUsage(THREE.DynamicDrawUsage);
    markerGeo.setAttribute('aCenter', markerCenters);
    markerGeo.setAttribute('aColor', markerColors);
    markerGeo.setAttribute('aSize', markerSizes);
    markerGeo.instanceCount = 0;
    const markerMat = new THREE.ShaderMaterial({
      uniforms: { uRadius: { value: MARKER_RADIUS } },
      vertexShader: MARKER_VERTEX,
      fragmentShader: MARKER_FRAGMENT,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const markerMesh = new THREE.Mesh(markerGeo, markerMat);
    // Over the overlay, the coastline and the arrows (renderOrder 0-2): the thing you tap goes
    // on top. Nothing hides a dot but the globe, and round the back the shader has faded it out.
    markerMesh.renderOrder = 3;
    // The geometry is one quad at the centre of the globe; the shader puts each copy in place.
    markerMesh.frustumCulled = false;

    let markers = [];
    let clusterCellDeg = -1;
    let lastReadingCount = -1;

    // Markers shrink *on screen* as you zoom in, rather than holding a fixed world size.
    //
    // Built at a fixed world radius they stayed physically the same size while the geography
    // grew around them, so up close one dot covered far more ground than the island it marked
    // -- a dot bigger than Hawaii. Scaling the world radius in step with the camera's distance
    // to the marker shell (not to the globe's centre -- the same distinction that bit the drag
    // sensitivity above) cancels the perspective divide exactly and holds a constant on-screen
    // size. That stopped the growth, but constant is still not small enough to fix the actual
    // complaint: the usable zoom range only magnifies the globe about 2.8x (338px across at the
    // default zoom, 939px at the closest), so at full zoom the Big Island is ~16px wide and
    // Oahu ~5px, against a dot frozen at ~13.5px. The dot still swallows the island.
    //
    // So the size has to actively come down as you close in. Raising the depth ratio to a power
    // slightly above 1 leaves an on-screen size proportional to ratio^(exp-1) instead of
    // constant, and solving that for the size wanted at the closest zoom gives the exponent --
    // no hand-tuned magic number, and it stays correct if MIN_DISTANCE moves. Measured: 13.5px
    // at the default zoom down to ~5px at the closest, so the dot reads as a mark *on* a place
    // rather than a blob covering it.
    //
    // Capped at 1x so this only ever shrinks: the reference is the default zoom, which already
    // looked right, and zoomed further out a constant screen size would turn 153 spots into a
    // chunky, overlapping mess on a small globe.
    // The curve itself lives in lib/geo3d.js, where it's unit-testable without a GPU.
    const MARKER_SCALING = {
      shell: MARKER_SHELL,
      refDistance: 3.0,   // the initial zoom, whose marker size is the reference
      minDistance: MIN_DISTANCE,
      closeShrink: 0.38,  // on-screen size at the closest zoom, as a fraction of the default
    };
    // A lone spot's radius at this zoom. One uniform for every dot, set every frame: it used to
    // be a matrix per marker, rewritten whenever the size had moved by more than 1%.
    function markerRadius() {
      return MARKER_RADIUS * markerScaleForDistance(state.distance, MARKER_SCALING);
    }
    function updateMarkerScale() {
      markerMat.uniforms.uRadius.value = markerRadius();
    }
    // A cluster is drawn bigger than a lone spot, by log rather than by count, so sixty spots
    // reads as more than two without becoming a dot the size of a country.
    function clusterScale(count) {
      return count > 1 ? Math.min(2.1, 1 + Math.log10(count) * 0.85) : 1;
    }
    const instanceColor = new THREE.Color();
    function setMarkerColor(i, css) {
      instanceColor.set(css); // converted to linear, as three's own materials keep colours
      markerColors.setXYZ(i, instanceColor.r, instanceColor.g, instanceColor.b);
    }
    // Every slot starts grey, including the ones no current cluster uses, so a marker can
    // never appear carrying a colour left over from a different zoom level.
    for (let i = 0; i < markerSlots; i++) setMarkerColor(i, '#33465C');
    globeGroup.add(markerMesh);

    // Re-form the clusters for the current zoom. Called from the frame loop, and cheap to call
    // there because it does nothing until the cell size has actually moved.
    function rebuildMarkers(cellDeg) {
      clusterCellDeg = cellDeg;
      const clusters = clusterPoints(allSpots, cellDeg);
      markers = clusters.map((c) => ({
        id: c.ids[0], ids: c.ids, count: c.count, lat: c.lat, lon: c.lon,
        basePos: latLonToVector3(c.lat, c.lon, MARKER_SHELL),
        worldPos: new THREE.Vector3(), // scratch, reused every frame instead of .clone()
        // Its label element, lent while the label is on screen (see lendLabel).
        label: null, labelText: '', labelTitle: '', labelShown: false,
      }));
      for (let i = 0; i < markers.length; i++) {
        const p = markers[i].basePos;
        markerCenters.setXYZ(i, p.x, p.y, p.z);
        markerSizes.setX(i, clusterScale(markers[i].count));
      }
      markerCenters.needsUpdate = true;
      markerSizes.needsUpdate = true;
      markerGeo.instanceCount = markers.length;
      // Every pooled label is hidden here, not just the slots this zoom leaves unused.
      //
      // The elements are pooled and reused, but `markers` is rebuilt from scratch on each zoom
      // step -- so a marker object arrives with labelShown false while the element it inherited
      // is still displayed from the previous arrangement. updateLabels then skips hiding it,
      // because as far as that marker knows it was never shown, and the label stays on screen
      // for a spot that is no longer there. Measured while fixing the overlap: 22 labels
      // visible against a cap of 14, the extra eight all stale. Clearing the pool on rebuild
      // makes the next frame's placement authoritative.
      for (let i = 0; i < labelPool.length; i++) returnLabel(labelPool[i]);
      refreshMarkerData();
      state.dataDirty = true;
    }
    function updateClusters() {
      const cell = cellSizeForDistance(state.distance);
      if (clusterCellDeg < 0) { rebuildMarkers(cell); return; }
      // Only on a real change: a slow pinch would otherwise rebuild four hundred markers and
      // their labels on every frame of the gesture.
      if (Math.abs(cell - clusterCellDeg) < Math.max(0.35, clusterCellDeg * 0.12)) return;
      rebuildMarkers(cell);
    }

    // Tapping a marker (as opposed to dragging to rotate) jumps straight to that spot's page.
    // "A tap" is a press and release with barely any movement between them and not too much time
    // elapsed -- the same drag gesture that rotates the globe also goes down and up, so a
    // distance+time threshold is what actually distinguishes "flicked past this marker while
    // rotating" from "meant to tap it". See lib/gestures.js.
    // A ceiling as well as a collision test. Even perfectly tiled, forty names is not a map you
    // can read -- it is a wall of text with a globe behind it.
    const MAX_LABELS = 14;
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    // How far off a dot a tap can land and still count as meant for it, in CSS pixels --
    // roughly half a fingertip.
    const TAP_TOLERANCE_PX = 22;
    // How far in one tap on a cluster. Enough that the cell size drops and the cluster splits,
    // gentle enough that you can still tell where you were.
    const CLUSTER_ZOOM_STEP = 0.55;
    const pickScratch = new THREE.Vector3();
    const pickView = new THREE.Vector3();
    // Which dot a tap was meant for, worked out on screen rather than by casting a ray at the
    // dots, which are drawn by their shader where no ray can find them.
    //
    // A tap inside a dot takes that dot. Failing that, the nearest one within a fingertip's
    // radius: dots shrink on screen as you zoom in (see updateMarkerScale), and a ~5px dot at the
    // closest zoom is far smaller than anyone can reliably tap, so the dot stays a small mark of
    // a point while the thing you actually hit stays finger-sized. Dots fading out toward the
    // horizon cannot be picked, by the same rule that takes their labels away.
    function pickSpotAt(clientX, clientY) {
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      const px = clientX - rect.left;
      const py = clientY - rect.top;
      const cam = camera.position;
      // CSS pixels per globe radius at a depth of one radius, to turn a dot's size into pixels.
      const pxPerUnit = rect.height / 2 / Math.tan((camera.fov * Math.PI) / 360);
      const radius = markerRadius();
      let bestMarker = null;
      let bestScore = Infinity;
      for (let i = 0; i < markers.length; i++) {
        const m = markers[i];
        pickScratch.copy(m.basePos).applyEuler(globeGroup.rotation);
        const facing = surfaceFacing(pickScratch.x, pickScratch.y, pickScratch.z, cam.x, cam.y, cam.z);
        if (!markerShown(facing)) continue; // faded out toward the horizon, or round the back
        const depth = -pickView.copy(pickScratch).applyMatrix4(camera.matrixWorldInverse).z;
        if (!(depth > 0)) continue; // behind the camera
        pickScratch.project(camera);
        const distance = Math.hypot((pickScratch.x * 0.5 + 0.5) * rect.width - px, (-pickScratch.y * 0.5 + 0.5) * rect.height - py);
        const dotPx = ((radius * clusterScale(m.count) * markerSizeFactor(facing)) / depth) * pxPerUnit;
        if (distance > Math.max(TAP_TOLERANCE_PX, dotPx)) continue;
        // Inside a dot beats beside one; between two, the edge the tap is further inside.
        const score = distance - dotPx;
        if (score < bestScore) { bestScore = score; bestMarker = m; }
      }
      if (bestMarker) { chooseMarker(bestMarker); return; }
      readOceanAt(ndc);
    }

    // What the overlay says at the point under the finger.
    //
    // The reason this exists is that colour runs out long before the data does. A ramp gets
    // eight or nine levels out of a small patch at best, and measured under 50,000 lux -- a
    // phone held on a beach in sun -- the swell ramp keeps about a third of its contrast and
    // the step from a 1m sea to a 1.5m one falls to around 4 dE, under the threshold at which
    // anyone can see it. A number survives all of that, and survives colour-blindness and the
    // shifting surround that makes matching a patch against a legend unreliable anyway.
    //
    // It reads what is on the sphere (shownField), so during the animated week it answers for
    // the moment on screen, blended between steps if that is what is showing.
    const readScratch = new THREE.Vector3();
    function readOceanAt(ndcPoint) {
      const shown = shownField();
      if (!wavesOnRef.current || !shown || !oceanMesh) { setReading(null); return; }
      raycaster.setFromCamera(ndcPoint, camera);
      const hit = raycaster.intersectObject(oceanMesh)[0];
      if (!hit) { setReading(null); return; }
      // The hit is in world space and the globe is turned; undoing that rotation is what makes
      // the coordinates mean anything.
      const here = vector3ToLatLon(globeGroup.worldToLocal(readScratch.copy(hit.point)));
      if (!here) { setReading(null); return; }
      const sampler = samplerFor(shown.step);
      const value = sampler.height(shown.read, here.lat, here.lon);
      // No reading is a real answer and the honest one: land, ice, or a cell the upstream model
      // has nothing for. Inventing a zero here would paint every continent as flat calm.
      if (value == null) {
        setReading({ lat: here.lat, lon: here.lon, layer: shown.layer, value: null });
        return;
      }
      setReading({
        lat: here.lat,
        lon: here.lon,
        layer: shown.layer,
        value,
        fromDeg: shown.dirs ? sampler.direction(shown.dirs, here.lat, here.lon) : null,
        frame: shown.frame,
      });
    }

    // Tapping one spot opens it. Tapping a cluster cannot -- it stands for anything up to
    // several dozen -- so it turns the globe to that patch of coast and zooms a step closer,
    // which is the thing that breaks the cluster back into its members. Two or three taps
    // walks you down from a continent to a single break.
    //
    // It flies there, on the path in lib/flight.js, rather than handing the new position to the
    // per-frame easing a wheel notch uses. Under reduced motion it jumps.
    let flight = null;
    const flightView = new THREE.Quaternion();
    const flightEuler = new THREE.Euler();
    function chooseMarker(m) {
      if (m.count <= 1) { onSelectSpot(m.id); return; }
      const toDistance = clampDistance(state.targetDistance * CLUSTER_ZOOM_STEP);
      const { rotX, rotY } = rotationToFace(m.lat, m.lon);
      state.velX = 0; state.velY = 0;
      if (reducedMotion) {
        // The short way round: without this, a cluster just past the antimeridian sends the
        // globe most of a turn to reach a point a few degrees away.
        state.rotX = state.targetRotX = rotX;
        state.rotY = state.targetRotY = shortestAngleTo(state.rotY, rotY);
        state.distance = state.targetDistance = toDistance;
        state.dataDirty = true;
        return;
      }
      // Where the camera looks now, in the globe's own frame: it sits on +Z, and the globe is
      // turned.
      flightView.setFromEuler(flightEuler.set(state.rotX, state.rotY, 0)).invert();
      const from = new THREE.Vector3(0, 0, 1).applyQuaternion(flightView);
      const to = latLonToVector3(m.lat, m.lon, 1);
      flight = {
        start: performance.now(),
        plan: planFlight({
          fromDir: [from.x, from.y, from.z],
          toDir: [to.x, to.y, to.z],
          fromDistance: state.distance,
          toDistance,
          tanHalfFov,
        }),
      };
    }
    // The flight's pose for this frame, written straight to the globe's position and its target
    // both, so the ordinary easing has nothing left to do. Returns whether one is under way.
    function flyStep(now) {
      if (!flight) return false;
      const k = flight.plan.duration > 0 ? (now - flight.start) / flight.plan.duration : 1;
      const pose = flight.plan.pose(Math.min(1, k));
      const here = vector3ToLatLon({ x: pose.dir[0], y: pose.dir[1], z: pose.dir[2] });
      if (here) {
        const { rotX, rotY } = rotationToFace(here.lat, here.lon);
        state.rotX = state.targetRotX = rotX;
        state.rotY = state.targetRotY = shortestAngleTo(state.rotY, rotY);
      }
      state.distance = state.targetDistance = pose.distance;
      if (k >= 1) flight = null;
      return true;
    }

    // Drag-to-rotate sensitivity that scales with how zoomed in you are, so the globe actually
    // tracks your finger instead of feeling disconnected from it. This used to be a flat
    // 0.005rad-per-pixel regardless of zoom -- fine at the default distance, but once you zoom
    // in close (the whole point of MIN_DISTANCE above) the globe fills far more of the screen,
    // so that same fixed rotation sweeps the visible surface across way more pixels than you
    // actually dragged: it massively overshoots, feeling twitchy and imprecise right when
    // you're trying to carefully aim at a specific nearby marker. Derived from the perspective
    // projection itself -- a small rotation dTheta moves a point on the sphere by an arc length
    // of R*dTheta, which projects to about (R*dTheta) * (height/2) / (distance*tanHalfFov)
    // screen pixels -- solved for dTheta per pixel so a drag of N pixels rotates the point
    // under your cursor by very close to N pixels on screen, at any zoom level.
    const tanHalfFov = Math.tan((camera.fov * Math.PI) / 360);
    function applyDrag(dx, dy) {
      // The depth that matters is the camera's distance to the *surface you're grabbing*, not
      // to the globe's centre. Using the centre distance (as this did) overshoots by a factor
      // of d/(d-R), which is 1.5x at the default zoom but 13x at the closest -- the surface is
      // only 0.08 units from the camera there while the centre is 1.08. That is why dragging
      // still felt wild up close even after the sensitivity was made zoom-aware: it was
      // zoom-aware against the wrong reference depth.
      const surfaceDistance = Math.max(state.distance - R, 0.02);
      const sensitivity = (surfaceDistance * tanHalfFov) / (height / 2);
      const rotY = dx * sensitivity;
      const rotX = dy * sensitivity;
      state.targetRotY += rotY;
      state.targetRotX = Math.max(-1.2, Math.min(1.2, state.targetRotX + rotX));
      // Remember the last bit of movement as velocity, so releasing mid-drag hands off into a
      // coasting flick rather than stopping dead. Blended with the previous value so one noisy
      // final pointer sample can't send the globe spinning off.
      //
      // In radians per millisecond, from the time between events. It used to be radians per
      // event, which made a flick depend on how often the screen delivered touches: half as
      // fast on a 120 Hz phone, whose events carry half the movement each. The floor stops two
      // events coalesced into the same millisecond from reading as a near-infinite speed.
      const now = performance.now();
      const dt = Math.max(now - state.lastMoveAt, 4);
      state.lastMoveAt = now;
      state.velY = blendVelocity(state.velY, rotY / dt, dt);
      state.velX = blendVelocity(state.velX, rotX / dt, dt);
    }
    // Lifting a finger that had stopped is not a flick. Without this, the last movement before
    // the pause was still sitting in the velocity and the globe set off on its own the moment
    // you let go of it.
    const STILL_RELEASE_MS = 80;
    function settleOnRelease() {
      if (performance.now() - state.lastMoveAt > STILL_RELEASE_MS) { state.velX = 0; state.velY = 0; }
    }
    // Percent-of-current-distance zoom (both wheel and pinch below) rather than a fixed step,
    // so zooming feels the same proportionally whether you're already in close or way out --
    // a fixed step is a huge relative jump once near MIN_DISTANCE and barely perceptible at
    // MAX_DISTANCE.
    const WHEEL_ZOOM_SPEED = 0.00085;
    function clampDistance(d) { return Math.max(MIN_DISTANCE, Math.min(MAX_DISTANCE, d)); }

    // Label positioning, rewritten to be allocation-free and to touch the DOM only when
    // something actually changed. The old version cloned three Vector3s per marker per frame
    // (~460 throwaway allocations a frame at 153 spots, all of it GC pressure) and wrote
    // style.display on every marker every frame whether or not it had changed. Now each marker
    // reuses one scratch vector, and a hidden marker that's still hidden costs nothing.
    // Labels are chosen by whether they fit, not by how far you have zoomed.
    //
    // The rule here used to be "closer than 2.2 shows every name", on the stated assumption that
    // by then they would not overlap. They do: zoomed to a continent there are dozens of spots
    // in frame, and the screen filled with overlapping pills several deep, hiding the map under
    // them. No threshold can fix that, because how many labels are in frame depends on where you
    // point the globe -- a hundred spots crowd California, four sit in the whole South Atlantic.
    //
    // So every frame the visible markers are projected, ranked by how near the middle of the
    // screen they are (the middle being what someone deliberately zoomed in on), and laid out
    // greedily, skipping any that would land on one already placed. See lib/labelplacement.js.
    // Which spots are on screen, told to the parent so it can fetch readings for those and no
    // others.
    //
    // One reading costs 36 billed values at Open-Meteo, so fetching the whole catalog on every
    // globe open spent more than a day's free allowance in one go -- see loadConditionsFor in
    // App.jsx. What is actually being looked at is a far smaller set, and it is already
    // computed: updateLabels projects every marker and culls to the frustum each frame, so
    // `labelWanted` is exactly the answer.
    //
    // Reported on a timer rather than per frame, and only when the set has actually changed,
    // because this fires a network request at the other end and a drag is sixty frames a second.
    // Ranked nearest-the-middle-first and capped, so a world view fills in what someone is
    // pointing at rather than a random third of the planet; moving the globe asks for the rest.
    const VISIBLE_REPORT_MS = 1200;
    const VISIBLE_MAX_SPOTS = 120;
    let lastReportAt = 0;
    let lastReportKey = '';
    // The globe only draws while something changes, and this is called from a drawn frame --
    // so a report throttled away during the last moments of a drag would otherwise never be
    // made, and the spots the drag ended on would never be fetched. A throttled call leaves one
    // trailing report behind instead, made from the last frame drawn.
    let reportTimer = null;
    function reportVisibleSpots() {
      const cb = visibleCbRef.current;
      if (!cb) return;
      const now = performance.now();
      if (now - lastReportAt < VISIBLE_REPORT_MS) {
        if (!reportTimer) {
          reportTimer = setTimeout(() => { reportTimer = null; reportVisibleSpots(); }, VISIBLE_REPORT_MS - (now - lastReportAt) + 20);
        }
        return;
      }
      lastReportAt = now;

      const onScreen = [];
      for (const m of markers) {
        if (!m.labelWanted) continue;
        const dx = m.screenX - width / 2;
        const dy = m.screenY - height / 2;
        onScreen.push({ m, d2: dx * dx + dy * dy });
      }
      onScreen.sort((a, b) => a.d2 - b.d2);

      const ids = [];
      for (const { m } of onScreen) {
        // A cluster stands for many spots and is coloured by the best of them, so its whole
        // membership is what has to be known -- but not at the cost of blowing the cap on one
        // dot, hence the budget check rather than a skip.
        for (const id of m.ids) {
          if (ids.length >= VISIBLE_MAX_SPOTS) break;
          ids.push(id);
        }
        if (ids.length >= VISIBLE_MAX_SPOTS) break;
      }
      if (!ids.length) return;
      const key = ids.join(',');
      if (key === lastReportKey) return;
      lastReportKey = key;
      cb(ids);
    }

    // Labels fade in and out rather than popping, over Mapbox's 300 ms. A label comes and goes
    // whenever another wins its space or its dot turns away, and during a drag that is several a
    // second: switched on and off they flickered; faded, they settle. Through the Web Animations
    // API, which runs on the compositor and needs no extra frames drawn here; under reduced
    // motion, or where it is missing, they switch as before.
    const LABEL_FADE_IN_MS = 300;
    const LABEL_FADE_OUT_MS = 200;
    function labelOpacity(el) {
      const timing = el.fade && el.fade.effect && el.fade.effect.getComputedTiming();
      if (!timing || timing.progress == null) return el.style.display === 'none' ? 0 : 1;
      return el.fade.from + (el.fade.to - el.fade.from) * timing.progress;
    }
    function stopLabelFade(el) {
      if (!el.fade) return;
      el.fade.onfinish = null;
      el.fade.cancel();
      el.fade = null;
    }
    function fadeLabel(el, to, ms) {
      const from = labelOpacity(el);
      stopLabelFade(el);
      el.style.display = 'block';
      if (reducedMotion || typeof el.animate !== 'function' || from === to) {
        if (to === 0) returnLabel(el);
        return;
      }
      // From wherever a fade it interrupts had got to, for the rest of the time, so a label that
      // changes its mind half way never jumps.
      const anim = el.animate([{ opacity: from }, { opacity: to }], {
        duration: ms * Math.abs(to - from), easing: to ? 'ease-out' : 'ease-in', fill: 'forwards',
      });
      anim.from = from;
      anim.to = to;
      el.fade = anim;
      anim.onfinish = () => {
        if (el.fade !== anim) return;
        el.fade = null;
        anim.cancel(); // its last frame is the element's own style now
        if (to === 0) returnLabel(el); // gone: back to the pool
      };
    }
    function fadeLabelIn(el) { fadeLabel(el, 1, LABEL_FADE_IN_MS); }
    function fadeLabelOut(el) { fadeLabel(el, 0, LABEL_FADE_OUT_MS); }

    const labelCandidates = [];
    const labelShow = new Set();
    function updateLabels() {
      labelCandidates.length = 0;
      const cam = camera.position;

      for (let i = 0; i < markers.length; i++) {
        const m = markers[i];
        const p = m.worldPos.copy(m.basePos).applyEuler(globeGroup.rotation);
        // Only where its dot is drawn: once the dot is at least half faded in (see
        // lib/markerdots.js). The test used to be on the angle from the middle of the view
        // alone, which from the default zoom put labels on spots just behind the horizon.
        let onScreen = markerShown(surfaceFacing(p.x, p.y, p.z, cam.x, cam.y, cam.z));
        if (onScreen) {
          m.worldPos.project(camera); // in place, on the world position just computed above
          // Facing the camera is not the same as being on screen. Zoomed out they amount to the
          // same thing, but zoomed in the camera only covers a few degrees of arc while the
          // facing test still passes for most of the hemisphere -- so without this check, spots
          // well outside the view get labels placed far outside the canvas, which then spill
          // over the header and nav (the container doesn't clip). Cull to the frustum instead.
          onScreen = m.worldPos.z < 1 && Math.abs(m.worldPos.x) <= 1 && Math.abs(m.worldPos.y) <= 1;
        }
        if (!onScreen) { m.labelWanted = false; continue; }
        m.labelWanted = true;
        m.screenX = (m.worldPos.x * 0.5 + 0.5) * width;
        m.screenY = (-m.worldPos.y * 0.5 + 0.5) * height;
        // Measured once per label, when its text changes, and cached: offsetWidth forces layout,
        // and doing that for hundreds of labels every frame is exactly the stutter this file has
        // spent so long removing. A hidden element measures 0, so a label that has never been
        // shown is given a size estimated from its text until it has been drawn once.
        if (m.label && m.label.style.display === 'block' && m.labelText === m.measuredFor) {
          if (!m.labelW) { m.labelW = m.label.offsetWidth; m.labelH = m.label.offsetHeight; }
        } else if (m.labelText !== m.measuredFor) {
          m.measuredFor = m.labelText; m.labelW = 0; m.labelH = 0;
        }
        const w = m.labelW || (m.count > 1 ? 26 : String(m.labelText || '').length * 6.2 + 14);
        const h = m.labelH || 18;
        labelCandidates.push({
          id: i,
          // The anchor differs: a count sits centred on its dot, a name floats above it.
          x: m.screenX - w / 2,
          y: m.count > 1 ? m.screenY - h / 2 : m.screenY - h * 1.3,
          w, h,
          rank: labelRank(m.screenX, m.screenY, width, height, { isCluster: m.count > 1 }),
        });
      }

      labelShow.clear();
      for (const id of placeLabels(labelCandidates, { maxLabels: MAX_LABELS })) labelShow.add(id);

      reportVisibleSpots();

      for (let i = 0; i < markers.length; i++) {
        const m = markers[i];
        const show = m.labelWanted && labelShow.has(i);
        if (!show) {
          if (m.labelShown) { m.labelShown = false; if (m.label) fadeLabelOut(m.label); }
          // On its way out: it goes on following its dot until it has gone.
          if (m.label && m.label.fade && m.labelWanted) {
            const anchor = m.count > 1 ? 'translate(-50%, -50%)' : 'translate(-50%, -130%)';
            m.label.style.transform = `${anchor} translate(${m.screenX}px, ${m.screenY}px)`;
          }
          continue;
        }
        if (!m.labelShown) {
          if (!m.label && !lendLabel(m)) continue; // the pool is busy: next frame
          fadeLabelIn(m.label); m.labelShown = true;
          // Placed this frame from an estimated size; it is measured on the next one (above).
          // That next frame has to happen even if nothing else moves, or a label wider than
          // its estimate keeps overlapping its neighbour until the globe is touched again.
          if (!m.labelW) state.dataDirty = true;
        }
        // transform rather than left/top: this is a compositor-only property, so moving a label
        // doesn't force the browser into a layout pass for every visible label every frame.
        const anchor = m.count > 1 ? 'translate(-50%, -50%)' : 'translate(-50%, -130%)';
        m.label.style.transform = `${anchor} translate(${m.screenX}px, ${m.screenY}px)`;
      }
    }

    // One stream of pointers for mouse, pen and touch alike: see lib/gestures.js for what counts
    // as a drag, a pinch and a tap. Pointer capture keeps a drag going when it leaves the canvas,
    // which the mouse used to get from listeners on the whole window.
    const gesture = createGesture();
    const canvas = renderer.domElement;
    canvas.style.touchAction = 'none';
    function onPointerDown(e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      noteInput();
      flight = null; // a hand on the globe takes it back
      try { canvas.setPointerCapture(e.pointerId); } catch { /* a pointer that cannot be captured still drags */ }
      const act = gestureDown(gesture, e.pointerId, e.clientX, e.clientY, performance.now());
      if (act.type === 'grab') {
        state.dragging = true;
        state.velX = 0; state.velY = 0; // grabbing it stops any coast in progress
        state.lastMoveAt = performance.now();
      } else if (act.type === 'pinch-start') {
        // A second finger: the drag is over, and so is whatever speed it had built up -- left
        // in, the globe set off on its own the moment the pinch ended.
        state.dragging = false;
        state.velX = 0; state.velY = 0;
      }
    }
    function onPointerMove(e) {
      const act = gestureMove(gesture, e.pointerId, e.clientX, e.clientY);
      if (act.type === 'drag') {
        noteInput();
        applyDrag(act.dx, act.dy);
      } else if (act.type === 'pinch') {
        noteInput();
        // Scaled by how much the spread between the fingers changed rather than by pixels, so
        // pinching feels the same at every zoom, as the wheel does. Fingers parting zoom in.
        state.targetDistance = clampDistance(state.targetDistance * act.ratio);
      }
    }
    function onPointerUp(e) {
      const act = gestureUp(gesture, e.pointerId, e.clientX, e.clientY, performance.now());
      if (act.type !== 'release') {
        if (gesture.mode === 'hold') state.dragging = false;
        return;
      }
      state.dragging = false;
      settleOnRelease();
      if (act.tap) {
        state.velX = 0; state.velY = 0; // a tap is not a flick
        pickSpotAt(act.tap.x, act.tap.y);
      }
    }
    // The system took the pointer away -- an incoming call, a notification pulled down, a system
    // gesture. Not a release and certainly not a tap: without this, `dragging` stayed true and the
    // globe kept treating the next unrelated touch as the end of the old drag.
    function onPointerCancel(e) {
      if (gestureCancel(gesture, e.pointerId).type === 'cancel') {
        state.dragging = false;
        state.velX = 0; state.velY = 0;
      }
    }
    function onWheel(e) {
      e.preventDefault();
      noteInput();
      flight = null;
      state.targetDistance = clampDistance(state.targetDistance * Math.exp(e.deltaY * WHEEL_ZOOM_SPEED));
    }

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerCancel);
    // Capture can end without a pointerup -- the element hidden, the window losing focus. A
    // pointer already released is no longer tracked, so this is a no-op after an ordinary up.
    canvas.addEventListener('lostpointercapture', onPointerCancel);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    // Marker colors and label text come from live forecast data, which changes on the order of
    // minutes — not per frame. The old loop recomputed and rewrote all of it every single frame
    // (153 material writes plus 153 DOM textContent writes, ~9,000 DOM writes a second), which
    // is most of why dragging stuttered. Now it runs on a timer, and only writes the DOM for
    // markers whose text actually changed.
    function refreshMarkerData() {
      const live = dataRef.current;
      let colorsChanged = false;
      let textChanged = false;
      let spotsWithReading = 0;
      for (let i = 0; i < markers.length; i++) {
        const m = markers[i];
        // A cluster takes the colour of its best member. That is the question someone scanning
        // a globe is asking -- is there anything worth surfing along that coast -- and the
        // legend says so rather than leaving it to be guessed at.
        let bestScore = null;
        let bestRating = null;
        for (const id of m.ids) {
          const sfm = live.forecast[id];
          // No forecast means no hour, and the marker stays grey. It used to fall back to a
          // set of invented hours whose rating happened to be 'LOADING', which reached the same
          // grey by a route that made the legend's "grey = no reading yet" a lie.
          // By clock hour, not array index: each spot's hours come from its own daylight window,
          // so index N is a different time of day at each spot — and out of range entirely at one
          // with a shorter day, which left those markers grey.
          const hr = pickHourAt((sfm && sfm.hours) || null, live.clockHour);
          if (!hr || hr.score == null || hr.rating === 'LOADING') continue;
          spotsWithReading++;
          if (bestScore == null || hr.score > bestScore) { bestScore = hr.score; bestRating = hr.rating; }
        }
        // Only written when it changed. This runs every second, and it used to rewrite every
        // colour and mark the globe for a redraw each time, so a globe nobody was touching still
        // drew a full frame once a second, forever.
        const color = bestScore == null ? '#33465C' : scoreToColor(bestScore);
        if (color !== m.color) {
          setMarkerColor(i, color);
          m.color = color;
          colorsChanged = true;
        }
        const spotObj = live.spots[m.id];
        const text = m.count > 1
          ? String(m.count)
          : (spotObj ? spotObj.name : m.id) + ' · ' + (bestRating || '···');
        // The chip carries the number; the rest is for anyone reading it with a screen reader
        // or hovering, where "61" alone says nothing.
        const title = m.count > 1
          ? m.count + ' spots' + (bestRating ? ' · best ' + bestRating : ' · no readings yet')
          : text;
        if (title !== m.labelTitle) {
          m.labelTitle = title;
          if (m.label) { m.label.title = title; m.label.setAttribute('aria-label', title); }
        }
        // New text can change a label's size, and so where labels fit: worth a redraw.
        if (text !== m.labelText) { m.labelText = text; if (m.label) m.label.textContent = text; textChanged = true; }
      }
      if (colorsChanged) markerColors.needsUpdate = true;
      // What the legend reports. "124 of 403" is the difference between a colour scale that
      // describes the globe and one that describes a quarter of it while looking the same.
      if (spotsWithReading !== lastReadingCount) {
        lastReadingCount = spotsWithReading;
        setLiveCount(spotsWithReading);
      }
      if (colorsChanged || textChanged) state.dataDirty = true; // something to show: draw once
    }
    updateClusters(); // builds the first set of markers, and colours them
    function startDataTimer() {
      return setInterval(() => {
        refreshMarkerData();
        if (sunLive && Date.now() - sunShownAt > SUN_REDRAW_MS) state.dataDirty = true;
      }, 1000);
    }
    let dataTimer = startDataTimer();

    // Smoothing. Input writes to the *target* rotation/distance; each frame eases the rendered
    // values toward it. That's what makes this feel smooth rather than stepwise: a wheel notch
    // glides instead of snapping, and a flick keeps coasting (momentum) instead of stopping
    // dead the instant you lift your finger.
    //
    // The constants are per 60 Hz frame and applied per unit of time (see lib/motion.js). They
    // used to be applied per frame, so a 120 Hz phone eased twice as fast and stopped a flick in
    // half the distance, Low Power Mode's 30 fps moved everything at half speed, and a run of
    // slow frames stretched a fling out over seconds.
    const EASE = 0.28;          // fraction of the remaining gap closed per 60 Hz frame
    const FRICTION = 0.94;      // share of flick speed kept per 60 Hz frame
    const MIN_VELOCITY = 0.0000012; // rad/ms; below this, momentum has visually stopped -- drop it
    const SETTLED = 0.00005; // gap below which easing has visually arrived
    let lastTick = null;     // the previous animation frame's timestamp, drawn or not
    let lastDrawnAt = null;  // the previous *drawn* frame's timestamp, for the perf display
    let drewLastTick = false; // whether the previous tick drew, for the quality governor
    function animate(ts) {
      const now = typeof ts === 'number' ? ts : performance.now();
      const playDt = frameDelta(now, lastTick, PLAYBACK_MAX_FRAME_MS);
      const dt = Math.min(playDt, MAX_FRAME_MS);
      const tickMs = lastTick == null ? 0 : now - lastTick;
      lastTick = now;
      const overlayMoving = updateOverlayTime(playDt);
      const particlesMoving = particlesRunning();
      const arrowsGliding = arrowsMoving();
      const flying = flyStep(now);
      const coasting = !state.dragging && (Math.abs(state.velX) > MIN_VELOCITY || Math.abs(state.velY) > MIN_VELOCITY);
      if (coasting) {
        state.targetRotY += state.velY * dt;
        state.targetRotX = Math.max(-1.2, Math.min(1.2, state.targetRotX + state.velX * dt));
        const keep = decayFactor(FRICTION, dt);
        state.velX *= keep;
        state.velY *= keep;
      } else if (!state.dragging) {
        state.velX = 0; state.velY = 0;
      }

      const dRotX = state.targetRotX - state.rotX;
      const dRotY = state.targetRotY - state.rotY;
      const dDist = state.targetDistance - state.distance;
      const cameraMoving = flying || coasting || state.dragging
        || Math.abs(dRotX) > SETTLED || Math.abs(dRotY) > SETTLED || Math.abs(dDist) > SETTLED;
      const moving = cameraMoving || overlayMoving || particlesMoving || arrowsGliding;
      // The globe has just come to rest on the coarse coastline it drew while moving, close
      // enough for the difference to show: one more frame, to put the full one back.
      if (!cameraMoving && coastLevel === 'coarse' && coastlineLevel(coastline.coarseError, coastPxPerRadian(), false) === 'fine') {
        state.dataDirty = true;
      }

      // Nothing moved and no data changed: skip the frame entirely rather than re-rendering an
      // identical image. A globe sitting still cost exactly as much as one being dragged before
      // this, which on a phone is battery burned for no visible result.
      if (!moving && !state.dataDirty) {
        lastDrawnAt = null; // the next drawn frame follows a pause, not a frame
        // A tick that does nothing arrives once a refresh: how the governor learns the screen.
        governorTick(quality, { intervalMs: tickMs, drew: false, prevDrew: drewLastTick });
        drewLastTick = false;
        state.raf = requestAnimationFrame(animate);
        return;
      }
      state.dataDirty = false;
      const workStart = perf ? performance.now() : 0;

      const ease = easeAlpha(EASE, dt);
      state.rotX += dRotX * ease;
      state.rotY += dRotY * ease;
      state.distance += dDist * ease;
      // Snap the last sliver so easing actually terminates instead of asymptotically crawling,
      // which would keep the "moving" test true (and the renderer busy) forever.
      if (Math.abs(state.targetRotX - state.rotX) <= SETTLED) state.rotX = state.targetRotX;
      if (Math.abs(state.targetRotY - state.rotY) <= SETTLED) state.rotY = state.targetRotY;
      if (Math.abs(state.targetDistance - state.distance) <= SETTLED) state.distance = state.targetDistance;

      globeGroup.rotation.set(state.rotX, state.rotY, 0);
      camera.position.set(0, 0, state.distance);
      camera.lookAt(0, 0, 0);
      updateNearPlane();
      updateMarkerScale();
      updateClusters();
      updateLabels();
      ensureCoastline();
      ensureWaveOverlay();
      overlayUniforms.uOverlayOn.value = overlayReady && wavesOnRef.current ? 1 : 0;
      stepParticles(dt, particlesMoving);
      updateArrows(dt);
      // The stars give way as the camera comes down to the surface (see lib/atmosphere.js).
      const starsShown = starFade(state.distance);
      starMat.opacity = STAR_OPACITY * starsShown;
      stars.visible = starsShown > 0;
      updateMute(dt);
      updateSun();
      if (coastline) {
        const o = coastlineOpacity(state.distance, COASTLINE_FADE_START, COASTLINE_FADE_END);
        coastline.material.opacity = o;
        showCoastline(o > 0 ? coastlineLevel(coastline.coarseError, coastPxPerRadian(), cameraMoving) : null);
      }
      renderer.render(scene, camera);
      if (perf) {
        if (lastDrawnAt != null) recordFrame(perf.stats, now - lastDrawnAt, performance.now() - workStart);
        perf.drawn++;
      }
      lastDrawnAt = now;
      const nextRatio = governorTick(quality, { intervalMs: tickMs, drew: true, prevDrew: drewLastTick });
      drewLastTick = true;
      if (nextRatio != null) applyPixelRatio(nextRatio);
      state.raf = requestAnimationFrame(animate);
    }
    animate();

    // A hidden page draws nothing -- the browser stops the frame loop -- but the timers went on:
    // the marker refresh every second, the performance display twice a second. They stop with
    // it now, and everything picks up again when the page is shown, starting with a fresh frame.
    function onVisibility() {
      if (cancelled) return;
      if (document.hidden) {
        clearInterval(dataTimer);
        dataTimer = null;
        if (perf && perf.timer) { clearInterval(perf.timer); perf.timer = null; }
        cancelAnimationFrame(state.raf);
        state.raf = null;
        clearTimeout(contextTimer);
        return;
      }
      if (!dataTimer) dataTimer = startDataTimer();
      if (perf && !perf.timer) { showPerf(); perf.timer = setInterval(showPerf, 500); }
      // Whatever happened while it was hidden is not one long frame.
      lastTick = null;
      lastDrawnAt = null;
      state.dataDirty = true;
      if (state.raf == null) state.raf = requestAnimationFrame(animate);
      if (contextLost) waitForContext();
    }
    document.addEventListener('visibilitychange', onVisibility);

    // A globe rebuilt on a new GPU context (see waitForContext) starts from nothing, but what the
    // controls say is shown is still React's: the week, and the wind layer if that is selected.
    if (weekForGpuRef.current) setWeek(weekForGpuRef.current);
    if (wavesOnRef.current && layerRef.current === 'wind') ensureWindLayer();

    // The drawn map is built only now, with the sphere already on screen.
    //
    // Two nested rAFs rather than one: the first schedules a frame, the second runs after that
    // frame has been composited, so the globe is genuinely visible before this starts drawing
    // a 2048x1024 canvas and handing it to the GPU.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      // If real imagery beat it here there is nothing to draw: the satellite photo replaces
      // this map entirely, so building it would be work nobody ever sees.
      if (cancelled || satelliteTexture) return;
      import('../data/landmasses.json')
        .then((m) => {
          if (cancelled || satelliteTexture) return;
          mapTexture = drawWorldMap(m.default);
          setOceanMap(mapTexture);
          state.dataDirty = true;
        })
        .catch(() => { /* the flat ocean colour is a whole globe, just a plainer one */ });
    }));

    return () => {
      cancelled = true;
      glViewRef.current = { rotX: state.rotX, rotY: state.rotY, distance: state.distance };
      markDirtyRef.current = null;
      cancelAnimationFrame(state.raf);
      clearInterval(dataTimer);
      clearTimeout(contextTimer);
      clearTimeout(coastlineTimer);
      document.removeEventListener('visibilitychange', onVisibility);
      if (resizeObserver) resizeObserver.disconnect();
      if (densityQuery && typeof densityQuery.removeEventListener === 'function') densityQuery.removeEventListener('change', onDensityChange);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', onContextRestored);
      if (reportTimer) clearTimeout(reportTimer);
      if (perf) { clearInterval(perf.timer); if (perf.hud.parentNode) perf.hud.parentNode.removeChild(perf.hud); }
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      canvas.removeEventListener('lostpointercapture', onPointerCancel);
      canvas.removeEventListener('wheel', onWheel);
      // The pool, not `markers`: markers holds only the clusters the current zoom produced, so
      // tearing down from it orphans every label belonging to a set that has since re-formed.
      // (Measured: 751 label nodes alive after two mounts, against 403 spots.)
      labelPool.forEach((el) => { stopLabelFade(el); if (el.parentNode) el.parentNode.removeChild(el); });
      starGeo.dispose(); starMat.dispose(); starDotTexture.dispose();
      atmosphereGeo.dispose(); atmosphereMat.dispose();
      if (mapTexture) mapTexture.dispose();
      oceanMat.dispose(); oceanMesh.geometry.dispose();
      if (satelliteTexture) satelliteTexture.dispose();
      releaseBasemapLoader();
      markerGeo.dispose(); markerMat.dispose();
      // ~12MB of line vertices across the two levels: the one set of buffers here big enough
      // that leaking it across a few open/close cycles of the globe would be felt on a phone.
      if (coastline) {
        for (const t of [...coastline.fine, ...coastline.coarse]) t.mesh.geometry.dispose();
        coastline.material.dispose();
      }
      for (const set of Object.values(liveLayers)) {
        if (set.texture) set.texture.dispose();
        if (set.dirTexture) set.dirTexture.dispose();
        if (set.velTexture) set.velTexture.dispose();
      }
      disposeParticles();
      for (const name of Object.keys(luts)) luts[name].dispose();
      if (week) {
        week.texture.dispose();
        if (week.dirTexture) week.dirTexture.dispose();
      }
      setWeekRef.current = null;
      if (arrowMesh) arrowMesh.geometry.dispose();
      arrowMat.dispose();
      if (waveMaskTexture) waveMaskTexture.dispose();
      renderer.dispose();
      // And the context itself, now, rather than whenever the collector gets round to it. Every
      // globe opened used to leave one behind -- measured 2, 3, 4 on successive opens -- and
      // browsers start taking contexts away from the page past a limit of about sixteen, the
      // oldest first, which in a long session could be the one on screen.
      try { renderer.forceContextLoss(); } catch { /* already gone */ }
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
    };
    } catch {
      // WebGL genuinely isn't working here — surface that instead of leaving a blank canvas
      // with no indication of why nothing rendered.
      setGlobeError(true);
      return undefined;
    }
    // Mount-once: this component is only ever rendered while the globe view is active, so
    // mounting/unmounting it already does what watching a "view" prop used to do. The one
    // exception is glEpoch, bumped to rebuild the scene when the GPU context is gone for good.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glEpoch]);

  return (
    // A column, so the canvas takes whatever height is left rather than a fixed 420px box that
    // left dead space on a tall phone and overflowed a short one.
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <div className="flex justify-between items-center px-4" style={{ paddingBottom: 2 }}>
        <h1 style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, fontSize: 22, color: COLORS.foam, paddingLeft: 6, margin: 0 }}>{title}</h1>
        <button className="tl-btn" onClick={onClose} style={{ background: 'none', border: 'none', padding: 0, minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }} aria-label="Close globe"><X size={22} color={COLORS.foamDim} /></button>
      </div>
      <div style={{ padding: '0 20px 6px', fontSize: 13, color: COLORS.foamDim, lineHeight: 1.45 }}>
        {hint || `${order.length} spot${order.length === 1 ? '' : 's'} you've found · tap a marker to view it · drag to rotate, pinch or scroll to zoom`}
      </div>
      <div ref={containerRef} style={{ position: 'relative', width: '100%', flex: 1, minHeight: 300, touchAction: 'none' }} />
      {globeError && (
        <div style={{ margin: '0 20px', padding: '14px 16px', background: COLORS.navyCard, border: '1px solid ' + COLORS.navyBorder, borderRadius: 10, fontSize: 12, color: COLORS.foamDim, lineHeight: 1.5 }}>
          3D rendering failed to start in this preview — that's a real signal, not just a display glitch. Let me know and I'll switch this view to the flat map instead.
        </div>
      )}
      <div className="mx-6" style={{ padding: '10px 0 4px' }}>
        {/* Directly under the globe rather than beside the legend it relates to: a tap has to
            produce something you can see without scrolling, or the feature may as well not
            exist on a phone. */}
        {wavesOn && reading && (
          <OceanReading reading={reading} units={units} onClear={() => setReading(null)} />
        )}
        <button
          className="tl-btn"
          onClick={() => setWavesOn((v) => !v)}
          aria-pressed={wavesOn}
          style={{
            width: '100%', minHeight: 44, marginBottom: 10, borderRadius: 8, fontSize: 14,
            background: wavesOn ? COLORS.navyCard : 'none',
            border: '1px solid ' + (wavesOn ? COLORS.tealBright : COLORS.navyBorder),
            color: wavesOn ? COLORS.tealBright : COLORS.foamDim,
          }}
        >
          {wavesOn ? 'Hide live overlay' : 'Show live swell'}
        </button>
        {/* Which reading of the ocean is painted. Only offered once the overlay is on, because
            it switches what that overlay draws and there is nothing to switch until then. */}
        {wavesOn && waveMeta && waveMeta.ok && (
          <div role="group" aria-label="Overlay layer" className="flex" style={{ gap: 8, marginBottom: 10 }}>
            {[['swell', 'Swell'], ['wind', 'Wind']].map(([id, label]) => {
              const on = layer === id;
              return (
                <button
                  key={id} className="tl-btn" aria-pressed={on}
                  onClick={() => selectLayer(id)}
                  style={{
                    flex: 1, minHeight: 44, borderRadius: 8, fontSize: 14, fontWeight: 600,
                    background: on ? COLORS.navyCard : 'none',
                    border: '1px solid ' + (on ? COLORS.tealBright : COLORS.navyBorder),
                    color: on ? COLORS.tealBright : COLORS.foamDim,
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}
        {/* The animated week. Only offered once the live overlay is actually drawn: it plays on
            that overlay's own sphere, so there is nothing for it to animate until then. */}
        {wavesOn && waveMeta && waveMeta.ok && (layer === 'swell' || (windMeta && windMeta.ok)) && (
          <div style={{ marginBottom: 10 }}>
            {framesState === 'ready' && frames ? (
              <div>
                <div className="flex items-center" style={{ gap: 10 }}>
                  <button
                    className="tl-btn"
                    onClick={() => {
                      // Replay from the start when the week has already run to its end,
                      // rather than pressing play on a frame that cannot advance.
                      if (timelineRef.current.pos >= frames.list.length - 1) seek(0);
                      setPlaying((v) => !v);
                    }}
                    aria-label={playing ? 'Pause the forecast' : 'Play the forecast'}
                    style={{
                      minWidth: 44, minHeight: 44, borderRadius: 8, flexShrink: 0,
                      background: COLORS.navyCard, border: '1px solid ' + COLORS.tealBright,
                      color: COLORS.tealBright, fontSize: 15, fontWeight: 700,
                    }}
                  >
                    {playing ? '❚❚' : '▶'}
                  </button>
                  <input
                    type="range" min={0} max={frames.list.length - 1} step="any" value={scrub ?? frameIdx}
                    aria-label="Forecast hour"
                    onChange={(e) => { setPlaying(false); moveScrub(Number(e.target.value)); }}
                    onPointerUp={endScrub}
                    onTouchEnd={endScrub}
                    onKeyUp={endScrub}
                    onBlur={endScrub}
                    style={{ flex: 1, minWidth: 0, accentColor: COLORS.tealBright, minHeight: 44 }}
                  />
                  <button
                    className="tl-btn"
                    onClick={() => setSpeed(nextSpeed)}
                    aria-label={'Playback speed ' + speed + ' times, change'}
                    style={{
                      minWidth: 44, minHeight: 44, borderRadius: 8, flexShrink: 0,
                      background: 'none', border: '1px solid ' + COLORS.navyBorder,
                      color: speed === 1 ? COLORS.foamDim : COLORS.tealBright,
                      fontFamily: 'JetBrains Mono, monospace', fontSize: 13, fontWeight: 700,
                    }}
                  >
                    {speedLabel(speed)}
                  </button>
                  <button
                    className="tl-btn"
                    onClick={() => setLoop((v) => !v)}
                    aria-pressed={loop}
                    aria-label="Repeat the week"
                    style={{
                      minWidth: 44, minHeight: 44, borderRadius: 8, flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: loop ? COLORS.navyCard : 'none',
                      border: '1px solid ' + (loop ? COLORS.tealBright : COLORS.navyBorder),
                    }}
                  >
                    <Repeat size={16} color={loop ? COLORS.tealBright : COLORS.foamDim} />
                  </button>
                </div>
                <div style={{ fontSize: 11, color: COLORS.foamDim, textAlign: 'center', marginTop: 2 }}>
                  {frameLabel(frames.list[frameIdx] && frames.list[frameIdx].t, Date.now())}
                  {frameIdx === 0 ? ' · now' : ' · +' + frameIdx * (frames.stepHours || 6) + 'h'}
                </div>
              </div>
            ) : (
              <button
                className="tl-btn"
                onClick={loadFramesOnce}
                // Retryable. The week is assembled on a schedule, so "not ready" is a state
                // that resolves on its own -- disabling the button meant a viewer who pressed
                // it early could not press it again when it finished, for as long as the tab
                // stayed open.
                disabled={framesState === 'loading'}
                style={{
                  width: '100%', minHeight: 44, borderRadius: 8, fontSize: 13,
                  background: 'none', border: '1px solid ' + COLORS.navyBorder,
                  color: COLORS.foamDim,
                  opacity: framesState === 'loading' ? 0.6 : 1,
                }}
              >
                {framesState === 'loading' ? 'Loading the week…'
                  : framesState === 'unavailable' ? frameBuildLabel(framesBuild)
                    : 'Animate the week'}
              </button>
            )}
            {framesState === 'unavailable' && framesBuild && (framesBuild.lastStatus || framesBuild.lastError) && (
              <div style={{ fontSize: 10, color: COLORS.foamDim, textAlign: 'center', marginTop: 4, lineHeight: 1.5 }}>
                {framesBuild.lastStatus ? 'HTTP ' + framesBuild.lastStatus : ''}
                {framesBuild.lastError ? (framesBuild.lastStatus ? ' · ' : '') + String(framesBuild.lastError).slice(0, 120) : ''}
              </div>
            )}
          </div>
        )}
        {/* The wind layer's own legend, and its own failure states. A separate branch rather
            than a parameterised one: the two layers fail for different reasons and have
            different things to say about it, and collapsing them would mean the wind's
            problems being described in the swell's words. */}
        {wavesOn && layer === 'wind' && (
          <div style={{ marginBottom: 12 }}>
            {windState === 'loading' ? (
              <div style={{ fontSize: 10, color: COLORS.foamDim, textAlign: 'center' }}>Loading wind map…</div>
            ) : windMeta && windMeta.ok ? (
              <>
                <div style={{ height: 8, borderRadius: 4, background: windScaleGradient() }} />
                <ScaleTicks ticks={windScaleTicks(units)} />
                <div style={{ fontSize: 9.5, color: COLORS.foamDim, marginTop: 5, textAlign: 'center' }}>
                  {windLegendCaption(
                    framesState === 'ready' && frames && frames.layer === 'wind' && frameIdx > 0
                      ? { ...windMeta, particles: false, frameLabel: 'forecast for ' + frameLabel(frames.list[frameIdx] && frames.list[frameIdx].t, Date.now()) }
                      // The week is drawn with arrows: the streaks belong to the live wind alone.
                      : playing ? { ...windMeta, particles: false } : windMeta,
                    units,
                  )}
                </div>
                <div style={{ fontSize: 9, color: COLORS.foamDim, marginTop: 3, textAlign: 'center', opacity: 0.8 }}>
                  Strong is not the same as bad — a hard offshore is the best wind there is, and which way it blows only means something at a spot.
                </div>
              </>
            ) : (
              <div style={{ fontSize: 10, color: COLORS.foamDim, textAlign: 'center', lineHeight: 1.5 }}>
                Wind map unavailable right now — the swell layer and the rest of the globe are unaffected.
                {windMeta && windMeta.build && (
                  <div style={{ marginTop: 3, opacity: 0.8 }}>
                    {'Fetched ' + (windMeta.build.batchesDone ?? 0) + ' of ' + (windMeta.build.batchesTotal ?? 0) + ' batches'}
                    {windMeta.build.lastStatus ? ' · HTTP ' + windMeta.build.lastStatus : ''}
                    {windMeta.build.lastError ? ' · ' + String(windMeta.build.lastError).slice(0, 120) : ''}
                    {windMeta.build.cooling && (
                      <div style={{ marginTop: 2 }}>
                        {'Not retrying for another '
                          + Math.max(1, Math.ceil((windMeta.build.retryInSeconds || 0) / 60))
                          + ' min — retrying now would only spend more of the same limit.'}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {wavesOn && layer === 'swell' && (
          <div style={{ marginBottom: 12 }}>
            {waveMeta && waveMeta.ok === false ? (
              <div style={{ fontSize: 10, color: COLORS.foamDim, textAlign: 'center', lineHeight: 1.5 }}>
                Swell map unavailable right now — the rest of the globe is unaffected.
                {waveMeta.build && (
                  <div style={{ marginTop: 3, opacity: 0.8 }}>
                    {'Fetched ' + (waveMeta.build.batchesDone ?? 0) + ' of ' + (waveMeta.build.batchesTotal ?? 0) + ' batches'}
                    {waveMeta.build.lastStatus ? ' · HTTP ' + waveMeta.build.lastStatus : ''}
                    {waveMeta.build.lastError ? ' · ' + String(waveMeta.build.lastError).slice(0, 120) : ''}
                    {/* A cooldown is a wait, not a fault, and saying so stops it reading as a
                        dead feature — and stops the retrying that caused it. */}
                    {waveMeta.build.cooling && (
                      <div style={{ marginTop: 2 }}>
                        {'Not retrying for another '
                          + Math.max(1, Math.ceil((waveMeta.build.retryInSeconds || 0) / 60))
                          + ' min — retrying now would only spend more of the same limit.'}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : !waveMeta ? (
              <div style={{ fontSize: 10, color: COLORS.foamDim, textAlign: 'center' }}>Loading swell map…</div>
            ) : (
              <>
                <div style={{ height: 8, borderRadius: 4, background: waveScaleGradient() }} />
                <ScaleTicks ticks={waveScaleTicks(units)} />
                <div style={{ fontSize: 9.5, color: COLORS.foamDim, marginTop: 5, textAlign: 'center' }}>
                  {waveLegendCaption(
                    framesState === 'ready' && frames && frameIdx > 0
                      ? { ...waveMeta, frameLabel: 'forecast for ' + frameLabel(frames.list[frameIdx] && frames.list[frameIdx].t, Date.now()) }
                      : waveMeta,
                    units,
                  )}
                </div>
                <div style={{ fontSize: 9, color: COLORS.foamDim, marginTop: 3, textAlign: 'center', opacity: 0.8 }}>
                  Big is not the same as good — the spot colours below already account for wind, tide and swell direction.
                </div>
              </>
            )}
          </div>
        )}
        <ConditionScale />
        {/* This used to read "Spot color = live conditions right now" full stop, which is a
            promise the view often cannot keep: on a cold open almost every marker is grey,
            and during a rate limit most of them stay that way. Saying how many spots the
            scale actually speaks for costs one clause and makes the grey legible. */}
        <div style={{ fontSize: 11.5, color: COLORS.foamDim, marginTop: 7, textAlign: 'center', lineHeight: 1.45 }}>
          {liveCount == null
            ? 'Spot colour = live conditions right now'
            : liveCount === 0
              ? 'No live conditions yet — every marker is grey until readings arrive'
              : 'Spot colour = live conditions right now, loaded for ' + liveCount + ' of ' + order.length + ' spots'
                /* Not a ceiling, which the old wording ("for 120 of 540 spots") read as. Readings
                   are fetched for what is on screen and cached per spot, so the count climbs as
                   you travel rather than stopping where it started. */
                + (liveCount < order.length ? '. Keep rotating and the rest fill in.' : '')}
        </div>
        <div style={{ fontSize: 11, color: COLORS.foamDim, marginTop: 5, textAlign: 'center', lineHeight: 1.45, opacity: 0.85 }}>
          A numbered marker is a group of spots — tap it to open it up. Its colour is the best of them.
        </div>
      </div>
    </div>
  );
}
