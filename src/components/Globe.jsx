import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import * as THREE from 'three';
import { COLORS } from '../lib/colors.js';
import { latLonToVector3, markerScaleForDistance, rotationToFace, shortestAngleTo } from '../lib/geo3d.js';
import { scoreToColor } from '../lib/rating.js';
import { arcsToLineVertices, coastlineOpacity } from '../lib/coastline.js';
import {
  base64ToBytes, decodeHeights, decodeDirections, fillGridGaps, makeGridSampler,
  GRID_LAT_STEP,
} from '../lib/wavegrid.js';
import { fibonacciSphere, arrowCountForDistance, orientationAt } from '../lib/swellarrows.js';
import { fillLandRings, polygonsToPixelRings, topologyToPolygons } from '../lib/landmask.js';
import { waveColor, waveScaleGradient, waveScaleTicks, waveLegendCaption, swellTravelBearing } from '../lib/wavescale.js';
import { fetchWaveGrid, fetchWaveFrames } from '../lib/buoy.js';
import { pickHourAt } from '../lib/daylight.js';
import { cellSizeForDistance, clusterPoints } from '../lib/markercluster.js';
import { placeLabels, labelRank } from '../lib/labelplacement.js';
import { frameLabel, frameBuildLabel, lerpFrames } from '../lib/waveframes.js';
import { ConditionScale } from './ConditionScale.jsx';

// How long each frame of the animated week is held on screen.
//
// 450ms is a compromise measured rather than chosen: a frame costs a full repaint of the
// 720x360 overlay texture, and running faster than the repaint takes turns the animation into a
// backlog. At this cadence the whole week plays in about twelve seconds, which is long enough
// to follow a swell across an ocean and short enough to watch twice.
// How long one six-hour step of the week takes on screen, and how many pictures are drawn
// inside it.
//
// The frames are six hours apart because that is what the upstream budget allows to fetch -- but
// the eye does not have to be shown the same six steps the network was. Drawing straight from
// one frame to the next is 28 jumps and reads as a slideshow at any speed; interpolating six
// pictures inside each step turns the same data into motion, at no cost upstream at all.
//
// 450ms a step and 6 sub-steps is 75ms a picture -- about 13 a second -- and the whole week in
// twelve and a half seconds. The work behind each picture was measured at 23ms of JavaScript
// before this, and the sub-steps below are cheaper than that again.
const STEP_MS = 450;
const SUB_STEPS = 6;
const FRAME_MS = STEP_MS / SUB_STEPS;

// How coarsely an animation frame is sampled. 3 means every third texel in each direction, so a
// ninth of the work. See paintWaveCanvas for why that is not a ninth of the quality -- the
// picture is drawn from 186 numbers however finely it is sampled.
const ANIM_COARSEN = 3;

// Interactive 3D globe of every saved spot, colored by live conditions. Owns its own WebGL
// lifecycle: mounting this component is equivalent to the parent switching to the globe view,
// unmounting it tears the scene down — so a plain mount-effect (deps: []) is enough, no need
// to watch a "view" prop the way the single-file version watched `view` state.
//
// `dataRef` is a ref (owned by the parent) whose `.current` is kept fresh every render with
// `{ spots, order, forecast, clockHour }` — read directly inside the animation loop so every
// rendered frame reflects whatever is currently in `forecast`, with no separate sync effect
// to fall out of date.
export function Globe({ order, dataRef, onClose, onSelectSpot, onVisibleSpots, title = 'All spots', hint, units = 'metric' }) {
  const containerRef = useRef(null);
  // The wave overlay is off by default. It is a second reading of the same globe -- where the
  // swell is, rather than which spots are good -- and defaulting it on would bury the markers
  // that are the point of this screen under a wash of colour.
  const [wavesOn, setWavesOn] = useState(false);
  const [waveMeta, setWaveMeta] = useState(null);
  // The animated week. `frames` is the decoded set, `frameIdx` which one is drawn, `playing`
  // whether the timer is advancing it. Held here rather than in the WebGL effect so the
  // controls can read them; the effect exposes one imperative function to draw a frame.
  const [frames, setFrames] = useState(null);
  // A continuous position through the week rather than an index, so the picture can sit between
  // two frames. The scrubber and the label still work in whole frames.
  const [pos, setPos] = useState(0);
  const frameIdx = Math.round(pos);
  const [playing, setPlaying] = useState(false);
  const [framesState, setFramesState] = useState('idle'); // idle | loading | ready | unavailable
  const [framesBuild, setFramesBuild] = useState(null);
  const applyFrameRef = useRef(null);
  // The three.js scene is built once in a mount effect, so React state cannot reach it. Same
  // Read through a ref for the same reason dataRef exists: the render loop is set up once, and
  // closing over the prop would pin whichever version of it existed at mount.
  const visibleCbRef = useRef(onVisibleSpots);
  visibleCbRef.current = onVisibleSpots;

  // bridge the parent uses for forecast data: a ref the render loop reads.
  const wavesOnRef = useRef(false);
  wavesOnRef.current = wavesOn;
  // The render loop skips frames when nothing has moved, which is what keeps an idle globe off
  // the battery. Toggling the overlay changes what should be drawn without moving anything, so
  // it has to say so explicitly or the screen would not update until the next drag.
  const markDirtyRef = useRef(null);
  useEffect(() => { if (markDirtyRef.current) markDirtyRef.current(); }, [wavesOn]);

  // Turning the overlay off ends the animation and rewinds to now. Otherwise "Show live swell"
  // would bring back whatever hour was last on screen -- a map of Thursday, labelled live.
  useEffect(() => {
    if (!wavesOn) { setPlaying(false); setPos(0); }
  }, [wavesOn]);

  // Fetch and decode the week, once, the first time the animation is asked for.
  //
  // Decoded here rather than in the WebGL effect because it is pure array work with no WebGL in
  // it, and because doing it once up front means a frame change costs a repaint rather than a
  // decode. 28 frames of 186 cells is about five thousand numbers -- the whole week is smaller
  // than one of the textures it paints.
  const loadFramesOnce = useCallback(async () => {
    if (framesState === 'loading' || framesState === 'ready') return;
    // 'unavailable' is deliberately not a stopping state: it usually means the week is still
    // being assembled, which fixes itself a few minutes later.
    setFramesState('loading');
    const res = await fetchWaveFrames();
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
    setFrames({
      latStep: step,
      stepHours: res.stepHours,
      stale: res.stale,
      list: res.frames.map((f) => ({
        t: f.t,
        heights: decodeHeights(base64ToBytes(f.data)),
        dirs: typeof f.dirs === 'string' ? decodeDirections(base64ToBytes(f.dirs)) : null,
      })),
    });
    setPos(0);
    setFramesState('ready');
  }, [framesState]);

  // Advance while playing, and stop at the end of the week rather than looping: a swell that
  // jumps back to Monday reads as a glitch, not as a repeat.
  useEffect(() => {
    if (!playing || !frames || framesState !== 'ready') return undefined;
    const timer = setInterval(() => {
      setPos((p) => Math.min(frames.list.length - 1, p + 1 / SUB_STEPS));
    }, FRAME_MS);
    return () => clearInterval(timer);
  }, [playing, frames, framesState]);

  useEffect(() => {
    if (playing && frames && pos >= frames.list.length - 1) setPlaying(false);
  }, [playing, frames, pos]);

  // Draw whichever frame is selected. Also the path back to "now" when the animation is turned
  // off, which redraws frame zero rather than leaving the last frame of the week on screen.
  useEffect(() => {
    if (framesState !== 'ready' || !frames || !applyFrameRef.current) return;
    const last = frames.list.length - 1;
    const i = Math.min(last, Math.floor(pos));
    const t = pos - i;
    // Exactly on a frame, draw it; between two, draw the blend. See lib/waveframes.js.
    const frame = t > 0 && i < last ? lerpFrames(frames.list[i], frames.list[i + 1], t) : frames.list[i];
    applyFrameRef.current(frame, frames.latStep);
  }, [frames, pos, framesState]);
  const [globeError, setGlobeError] = useState(false);
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
    const width = container.clientWidth || 340;
    const height = container.clientHeight || 420;
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
    // The dot is then half-buried, which costs nothing visually: the marker sphere's centre
    // lies on the globe's surface, so the two spheres intersect in a circle of exactly the
    // marker's radius, and with a flat (unlit) material the visible hemisphere renders as the
    // same disc as the whole sphere did. It also fixes the limb: dots near the horizon used to
    // float clear of the globe's silhouette, and now they're correctly cut off by it.
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
      dragging: false, lastX: 0, lastY: 0, pinchDist: null, raf: null, downX: 0, downY: 0, downTime: 0,
      dataDirty: true, // set when marker colors/labels change, so an idle frame still redraws once
    };
    camera.position.set(0, 0, state.distance);
    markDirtyRef.current = () => { state.dataDirty = true; };

    // logarithmicDepthBuffer is deliberately OFF. It makes every shader write gl_FragDepth,
    // which disables the GPU's early-Z rejection — a serious cost everywhere and a brutal one
    // on the tile-based GPUs in phones, which is where this app actually runs. It was only
    // needed because the near/far range was wide; the per-frame near plane below keeps that
    // range tight enough that an ordinary 24-bit depth buffer has precision to spare.
    // At 3x device pixel ratio the scene is already supersampled 9:1 against CSS pixels, which
    // resolves edges about as well as MSAA does -- so paying for both is close to pure waste.
    // Dropping MSAA at 3x buys back most of what the higher resolution costs.
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 3);
    const renderer = new THREE.WebGLRenderer({ antialias: pixelRatio < 3, alpha: true });
    // outputEncoding/sRGBEncoding was renamed to outputColorSpace/SRGBColorSpace in newer
    // Three.js and removed entirely in later versions — set whichever this build actually has.
    if ('outputColorSpace' in renderer && THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;
    else if ('outputEncoding' in renderer && THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.setSize(width, height);
    // Render at the screen's real pixel density, up to 3x (set just above the renderer).
    //
    // This was capped at 2 on the reasoning that the extra pixels were "not visible at this
    // size". That was true of the globe it was written for -- a small, barely-zoomable sphere.
    // It is not true now: the zoom range magnifies the globe about 2.8x, and a 3x phone was
    // being handed two-thirds of its native resolution, which is exactly what makes coastlines
    // look soft when you zoom in. Every edge on screen -- the silhouette, the coastlines, the
    // marker dots -- is sampled at 1.5x fewer pixels per axis than the display can show.
    renderer.setPixelRatio(pixelRatio);
    container.appendChild(renderer.domElement);
    setGlobeError(false);

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
    });
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
      // A flat texture wrapped on a sphere gets viewed at steep angles near the edges of what's
      // visible, which is exactly the case anisotropic filtering is for — without it, those
      // regions look noticeably blurrier/blockier than the center, which reads as "pixelated".
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
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
    const SATELLITE_BASE_URL = 'https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57752/land_shallow_topo_2048.jpg';
    const SATELLITE_UPGRADE_URLS = [
      'https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73909/world.topo.bathy.200412.3x5400x2700.jpg',
    ];
    let satelliteTexture = null;
    const textureLoader = new THREE.TextureLoader();
    textureLoader.setCrossOrigin('anonymous'); // required to use the pixels as a WebGL texture

    function applySatellite(tex) {
      if ('colorSpace' in tex && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = true;
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
    const COASTLINE_SHELL = R * 1.0006;
    const coastlineMat = new THREE.LineBasicMaterial({
      color: 0x8fe9d4, transparent: true, opacity: 0, depthWrite: false,
    });
    let coastlineMesh = null;
    let coastlineRequested = false;

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
    // Built as an equirectangular canvas and wrapped on a sphere just above the surface, rather
    // than blended into the ocean material, so it can be toggled without rebuilding anything
    // and so land stays untouched.
    //
    // Three separate concerns, and they want three different resolutions:
    //
    //   - the swell field is interpolated from a 10-degree grid and has nothing finer to say
    //     than half a degree, so it is painted at 720x360 and left to filter smoothly;
    //   - where land *is* comes from the coastline, at 4096x2048 — about 10km a texel;
    //   - how hard the boundary between them looks is not a resolution at all. The mask holds
    //     the *fraction* of each texel that is land, and the shader thresholds it at a half
    //     with a screen-space-width falloff, so the chart ends in about one screen pixel at
    //     every zoom. Baking the mask into the chart's alpha instead — the obvious way, and the
    //     first way this was written — makes the edge exactly as soft as a texel is wide, which
    //     at the closest zoom is a couple of hundred device pixels of blur.
    const WAVE_SHELL = R * 1.0003; // under the coastline's 1.0006, so lines still draw on top
    const WAVE_TEX_W = 720;
    const WAVE_TEX_H = 360;
    const LAND_MASK_W = 4096;
    const LAND_MASK_H = 2048;
    let waveMesh = null;
    let waveTexture = null;
    let waveMaskTexture = null;
    let waveRequested = false;
    // Held for the animation: the canvas the overlay's texture wraps, and the land mask the
    // arrows are culled against. Both are built once with the live overlay and reused by every
    // frame, so a frame costs a repaint rather than a rebuild.
    let waveCanvasCtx = null;
    let waveImageData = null;
    let waveLand = null;

    // The arrows over the colour: which way each patch of swell is travelling.
    //
    // Instanced flat arrows lying tangent to the sphere, not marks painted into the texture —
    // geometry stays sharp at every zoom, where a painted arrow would be a smear a few texels
    // across. How many are drawn depends on the camera distance (see lib/swellarrows.js), so
    // the on-screen density holds roughly steady instead of thinning to nothing as you close in.
    const ARROW_SHELL = R * 1.0009; // above the overlay and the coastline, so it is never buried
    const ARROW_FIELD = 6000;      // the cap; how many of them are drawn is a function of zoom
    let arrowMesh = null;
    let arrowPoints = null;
    let arrowScaleAt = 0;

    // Painting and wrapping are separate because the animation repaints the same canvas 28
    // times. Allocating a texture per frame would hand the GPU 28 uploads and the collector 28
    // canvases for a picture that is the same size every time.
    // `coarsen` samples every nth texel and fills the n-by-n block with the result.
    //
    // The static overlay is painted once and can afford every texel. An animation frame cannot:
    // 259,200 texels was a quarter-second freeze on every step, and the source it is drawn from
    // is 186 cells. Sampling at half resolution asks 64,800 questions of 186 numbers instead of
    // 259,200, and the answer still passes through a mipmapped linear filter on its way to a
    // sphere, so the difference on screen is far smaller than the difference in cost.
    function paintWaveCanvas(ctx, heights, step, coarsen = 1) {
      // One buffer for the life of the overlay. createImageData allocates a megabyte, and doing
      // that 28 times hands the collector a megabyte of garbage per animation.
      if (!waveImageData || waveImageData.width !== WAVE_TEX_W) {
        waveImageData = ctx.createImageData(WAVE_TEX_W, WAVE_TEX_H);
      }
      const px = waveImageData.data;
      // One sampler for the whole texture rather than rebuilding the grid's row table inside
      // every texel below. See lib/wavegrid.js's makeGridSampler.
      const sampler = makeGridSampler(step);
      const n = Math.max(1, coarsen | 0);
      for (let y = 0; y < WAVE_TEX_H; y += n) {
        // Texel centres, and latitude runs north-to-south down an equirectangular image.
        const lat = 90 - ((y + 0.5) / WAVE_TEX_H) * 180;
        const yMax = Math.min(WAVE_TEX_H, y + n);
        for (let x = 0; x < WAVE_TEX_W; x += n) {
          const lon = -180 + ((x + 0.5) / WAVE_TEX_W) * 360;
          const c = waveColor(sampler.height(heights, lat, lon));
          const xMax = Math.min(WAVE_TEX_W, x + n);
          for (let yy = y; yy < yMax; yy++) {
            let o = (yy * WAVE_TEX_W + x) * 4;
            for (let xx = x; xx < xMax; xx++, o += 4) {
              if (!c) { px[o + 3] = 0; continue; } // nothing to say here: draw nothing
              px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255;
            }
          }
        }
      }
      ctx.putImageData(waveImageData, 0, 0);
    }

    function buildWaveTexture(heights, step) {
      const cv = document.createElement('canvas');
      cv.width = WAVE_TEX_W;
      cv.height = WAVE_TEX_H;
      const ctx = cv.getContext('2d');
      paintWaveCanvas(ctx, heights, step);
      waveCanvasCtx = ctx;
      const tex = new THREE.CanvasTexture(cv);
      if ('colorSpace' in tex && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = THREE.RepeatWrapping; // the map joins itself at the antimeridian
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = true;
      return tex;
    }

    // How much of each texel is land, as one byte a texel.
    //
    // A single channel rather than a canvas texture: at this size the difference is 8MB against
    // 34MB of texture memory, on a device that is usually a phone. The canvas is read back in
    // bands for the same reason — one getImageData over eight million pixels would ask for
    // another 34MB in one go, at the moment the page can least afford it.
    function buildLandMaskTexture(polygons, width, height) {
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

      const tex = new THREE.DataTexture(mask, width, height, THREE.RedFormat);
      tex.flipY = true; // match the canvas textures: image row 0 is the north pole
      tex.wrapS = THREE.RepeatWrapping;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = true;
      tex.needsUpdate = true;
      // The coverage array comes back too: the arrow field asks it whether a point is at sea,
      // which is both exact and free, where a point-in-polygon test against four thousand rings
      // would be neither.
      return { texture: tex, mask, width, height };
    }

    // The chart's alpha, cut by the mask in the fragment shader instead of in the canvas.
    //
    // `fwidth` is how far the coverage value moves between neighbouring *screen* pixels, so the
    // falloff is one pixel wide whether a texel covers ten kilometres or a tenth of the screen.
    // That is the whole difference between an edge that stays as crisp as the coastline drawn
    // over it and one that dissolves as you zoom in.
    function cutToCoastline(material, maskTexture) {
      material.onBeforeCompile = (shader) => {
        shader.uniforms.landMask = { value: maskTexture };
        shader.fragmentShader = 'uniform sampler2D landMask;\n' + shader.fragmentShader.replace(
          '#include <alphamap_fragment>',
          [
            '#include <alphamap_fragment>',
            'float landCoverage = texture2D( landMask, vMapUv ).r - 0.5;',
            'float landEdge = max( fwidth( landCoverage ), 1e-5 );',
            'diffuseColor.a *= 1.0 - smoothstep( -landEdge, landEdge, landCoverage );',
          ].join('\n'),
        );
      };
      material.customProgramCacheKey = () => 'wave-overlay-land-mask';
    }

    // A flat arrow in its own XY plane, pointing along +Y: a shaft and a head, six triangles.
    function arrowGeometry() {
      const geo = new THREE.BufferGeometry();
      const v = new Float32Array([
        -0.13, -0.85, 0, 0.13, -0.85, 0, 0.13, 0.12, 0, -0.13, 0.12, 0, // shaft
        -0.46, 0.05, 0, 0.46, 0.05, 0, 0, 0.9, 0,                        // head
      ]);
      geo.setAttribute('position', new THREE.BufferAttribute(v, 3));
      geo.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6]);
      return geo;
    }

    // Is this point at sea, according to the same coverage mask the overlay is cut with?
    function isWater(mask, width, height, lat, lon) {
      if (!mask) return true;
      const x = Math.min(width - 1, Math.max(0, Math.floor(((lon + 180) / 360) * width)));
      const y = Math.min(height - 1, Math.max(0, Math.floor(((90 - lat) / 180) * height)));
      return mask[y * width + x] < 128;
    }

    // The arrow field, built once: every point that is at sea and has a direction to show.
    //
    // Order is preserved from lib/swellarrows.js, whose sequence is arranged so that any prefix
    // still covers the whole globe — that is what lets the draw count follow the zoom without
    // rebuilding anything.
    function buildArrowField(directions, land, step) {
      const points = [];
      const sampler = makeGridSampler(step);
      for (const p of fibonacciSphere(ARROW_FIELD)) {
        if (land && !isWater(land.mask, land.width, land.height, p.lat, p.lon)) continue;
        const from = sampler.direction(directions, p.lat, p.lon);
        const bearing = swellTravelBearing(from);
        if (bearing == null) continue;
        points.push({ ...p, bearing });
      }
      return points;
    }

    // One instance matrix per arrow. Rebuilt only when the size changes, not every frame.
    function layOutArrows(scale) {
      const m = new THREE.Matrix4();
      const x = new THREE.Vector3();
      const y = new THREE.Vector3();
      const z = new THREE.Vector3();
      const pos = new THREE.Vector3();
      for (let i = 0; i < arrowPoints.length; i++) {
        const p = arrowPoints[i];
        const { normal, forward, side } = orientationAt(p.lat, p.lon, p.bearing);
        x.set(side[0], side[1], side[2]).multiplyScalar(scale);
        y.set(forward[0], forward[1], forward[2]).multiplyScalar(scale);
        z.set(normal[0], normal[1], normal[2]);
        m.makeBasis(x, y, z);
        pos.set(normal[0], normal[1], normal[2]).multiplyScalar(ARROW_SHELL);
        m.setPosition(pos);
        arrowMesh.setMatrixAt(i, m);
      }
      arrowMesh.instanceMatrix.needsUpdate = true;
    }

    // Arrows hold a roughly constant size on screen, so they stay legible zoomed out and do not
    // become billboards zoomed in. Apparent size is world size over depth, so the world size
    // tracks the depth.
    function arrowScaleForDistance(distance) {
      return 0.016 * Math.max(distance - R, 0.02) / (3 - R);
    }

    function updateArrows() {
      if (!arrowMesh) return;
      arrowMesh.visible = wavesOnRef.current;
      if (!arrowMesh.visible) return;
      // The camera's own half-FOV, so the count follows what is actually on screen rather than
      // a hard-coded guess at it.
      arrowMesh.count = Math.min(arrowPoints.length, arrowCountForDistance(state.distance, {
        halfFovRad: (camera.fov * Math.PI) / 360,
      }));
      const scale = arrowScaleForDistance(state.distance);
      // Only re-laid-out when the size has moved enough to see, rather than on every frame of
      // an easing zoom: this is three thousand matrix builds.
      if (Math.abs(scale - arrowScaleAt) > arrowScaleAt * 0.04) {
        arrowScaleAt = scale;
        layOutArrows(scale);
      }
    }

    function ensureWaveOverlay() {
      if (waveRequested || !wavesOnRef.current) return;
      waveRequested = true;
      Promise.all([fetchWaveGrid(), loadCoastlineTopology()])
        .then(([grid, topo]) => {
          if (cancelled) return;
          if (!grid || !grid.data) { setWaveMeta({ ok: false, build: grid && grid.build }); return; }
          const polygons = topo ? topologyToPolygons(topo) : [];
          let land = null;
          if (polygons.length) {
            try {
              land = buildLandMaskTexture(polygons, LAND_MASK_W, LAND_MASK_H);
            } catch {
              // A device that cannot spare 34MB of canvas for a moment. Half the resolution is
              // a quarter of the memory and still a coastline.
              try {
                land = buildLandMaskTexture(polygons, LAND_MASK_W / 2, LAND_MASK_H / 2);
              } catch { /* no mask; the grid's own coarse edge is used below */ }
            }
          }
          waveMaskTexture = land ? land.texture : null;
          waveLand = land;
          const raw = decodeHeights(base64ToBytes(grid.data));
          // Gaps are only filled when there is a mask to stop the fill at the shore. Without
          // one, "no reading" is the only thing marking out land at all, and filling it would
          // paint swell across every continent.
          waveTexture = buildWaveTexture(waveMaskTexture ? fillGridGaps(raw) : raw, GRID_LAT_STEP);
          const material = new THREE.MeshBasicMaterial({
            map: waveTexture, transparent: true, opacity: 0.62, depthWrite: false,
          });
          if (waveMaskTexture) cutToCoastline(material, waveMaskTexture);
          waveMesh = new THREE.Mesh(
            // Must match the ocean sphere's tessellation, not the old 128x96. A coarser
            // overlay sags further at each quad's centre than its own 3e-4 offset clears
            // (0.999865 against the ocean's vertices at 1.0), so the globe pokes through it in
            // a regular diamond stipple that reads as a rendering artifact — because it is one.
            new THREE.SphereGeometry(WAVE_SHELL, 256, 192),
            material,
          );
          globeGroup.add(waveMesh);

          // Directions are optional: a grid cached before the Worker started fetching them has
          // heights and nothing else, and the colours are worth drawing on their own.
          const directions = grid.dirs ? decodeDirections(base64ToBytes(grid.dirs)) : null;
          arrowPoints = directions ? buildArrowField(directions, land, GRID_LAT_STEP) : [];
          if (arrowPoints.length) {
            arrowMesh = new THREE.InstancedMesh(
              arrowGeometry(),
              // Light, not dark. The colour ramp starts at a very dark navy — flat water is
              // (26,35,68) — and a dark arrow is invisible on exactly the calm ocean that
              // covers most of the map. A pale arrow reads against everything up to the top of
              // the scale, where the ramp turns pale itself and 10m+ seas are vanishingly rare.
              new THREE.MeshBasicMaterial({
                color: 0xf4f7f6, transparent: true, opacity: 0.72, depthWrite: false,
                side: THREE.DoubleSide,
              }),
              arrowPoints.length,
            );
            arrowMesh.renderOrder = 2; // over the overlay and the coastline, never under them
            arrowMesh.frustumCulled = false;
            arrowScaleAt = 0;
            globeGroup.add(arrowMesh);
          }

          setWaveMeta({
            ok: true, generatedAt: grid.generatedAt, stale: grid.stale, coarse: !waveMaskTexture,
            arrows: !!(arrowPoints && arrowPoints.length),
            // Two different reasons for a chart with no arrows on it, and they look identical:
            // the grid was cached before directions were fetched at all, or it carries them and
            // none survived. Saying which one turns a guess into a glance.
            noDirections: !grid.dirs,
          });
          state.dataDirty = true;
        })
        .catch(() => setWaveMeta({ ok: false }));
    }

    // Draw one frame of the animated week.
    //
    // Repaints the overlay's existing canvas and rebuilds the arrow field, rather than building
    // a texture and a mesh per frame. `step` is the frame grid's, which is coarser than the
    // live overlay's -- passing the wrong one does not throw, it paints one ocean's swell onto
    // another, which is why it travels with the data rather than being assumed here.
    function applyWaveFrame(frame, step) {
      if (!frame || !waveCanvasCtx || !waveTexture) return;
      const heights = waveMaskTexture ? fillGridGaps(frame.heights, 2, step) : frame.heights;
      paintWaveCanvas(waveCanvasCtx, heights, step, ANIM_COARSEN);
      // A mipmap chain is worth building for a picture that is drawn thousands of times and
      // uploaded once. An animation frame is the other way round, and rebuilding the chain on
      // every one of them is the single most expensive thing about a frame change -- measured
      // at an order of magnitude more than all the JavaScript that produced the picture.
      if (waveTexture.generateMipmaps) {
        waveTexture.generateMipmaps = false;
        waveTexture.minFilter = THREE.LinearFilter;
      }
      waveTexture.needsUpdate = true;

      // Arrows are rebuilt in place when the count is unchanged, which it is for every frame
      // after the first: the field is a fixed set of points on a sphere, and only the bearings
      // move. A frame whose directions are missing leaves the last ones alone rather than
      // clearing the sky.
      if (frame.dirs && arrowMesh) {
        const next = buildArrowField(frame.dirs, waveLand, step);
        if (next.length === arrowPoints.length) {
          arrowPoints = next;
          arrowScaleAt = 0; // force the next layout pass to re-orient every instance
        }
      }
      state.dataDirty = true;
      if (markDirtyRef.current) markDirtyRef.current();
    }
    applyFrameRef.current = applyWaveFrame;

    function ensureCoastline() {
      if (coastlineRequested || state.distance > COASTLINE_FADE_START) return;
      coastlineRequested = true;
      loadCoastlineTopology()
        .then((topo) => {
          if (cancelled || !topo) return;
          const positions = arcsToLineVertices(topo, COASTLINE_SHELL, latLonToVector3);
          if (!positions.length) return;
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
          coastlineMesh = new THREE.LineSegments(geo, coastlineMat);
          // Drawn after the globe and writing no depth, so it never fights the surface it sits
          // on -- but still depth-*tested*, which is what hides the far side of the world.
          coastlineMesh.renderOrder = 1;
          globeGroup.add(coastlineMesh);
          state.dataDirty = true;
        })
        // The fetch already swallows its own failures; this catches anything that goes wrong
        // building the geometry. The globe is fully usable without the lines, so there is
        // nothing to report and nothing to retry.
        .catch(() => {});
    }

    scene.add(new THREE.AmbientLight(0xbcd4e0, 0.55));
    const dirLight = new THREE.DirectionalLight(0xfff2d8, 0.95);
    dirLight.position.set(3, 2, 4);
    scene.add(dirLight);
    const fillLight = new THREE.DirectionalLight(0x4fccb8, 0.18);
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
    // a small radial-gradient dot texture instead (same technique as the atmosphere glow below).
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
    const starMat = new THREE.PointsMaterial({ map: starDotTexture, color: 0xdfeaf2, size: 0.05, transparent: true, opacity: 0.85, sizeAttenuation: true, depthWrite: false });
    const stars = new THREE.Points(starGeo, starMat);
    scene.add(stars);

    // soft teal atmosphere glow behind the globe
    const glowCanvas = document.createElement('canvas');
    glowCanvas.width = 256; glowCanvas.height = 256;
    const gctx = glowCanvas.getContext('2d');
    const glowGrad = gctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    glowGrad.addColorStop(0, 'rgba(79,204,184,0.5)');
    glowGrad.addColorStop(0.45, 'rgba(79,204,184,0.2)');
    glowGrad.addColorStop(1, 'rgba(79,204,184,0)');
    gctx.fillStyle = glowGrad;
    gctx.fillRect(0, 0, 256, 256);
    const glowTexture = new THREE.CanvasTexture(glowCanvas);
    const glowMat = new THREE.SpriteMaterial({ map: glowTexture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const glowSprite = new THREE.Sprite(glowMat);
    glowSprite.scale.set(2.7, 2.7, 1);
    scene.add(glowSprite);

    // One InstancedMesh for every spot marker instead of one Mesh each. With 150+ spots that's
    // the difference between 150+ draw calls per frame and exactly one — the single biggest
    // reason the globe got progressively less smooth as the spot catalog grew from 44 to 153.
    // Per-marker color still works (setColorAt writes into a per-instance color attribute),
    // and Raycaster handles InstancedMesh natively, reporting which instance was hit.
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

    // One label element per possible marker, made once and reused. Clusters re-form on every
    // zoom step, and creating and destroying four hundred DOM nodes for that would be the
    // expensive part of the whole feature.
    const labelPool = allSpots.map(() => {
      const el = document.createElement('div');
      el.className = 'tl-label';
      // Anchored at the container's origin; updateLabels() moves it purely via transform.
      el.style.left = '0';
      el.style.top = '0';
      el.style.display = 'none';
      container.appendChild(el);
      return el;
    });

    const markerGeo = new THREE.SphereGeometry(0.026, 12, 12);
    const markerMat = new THREE.MeshBasicMaterial();
    // Allocated for every spot and then drawn with `count` set to however many markers the
    // current zoom actually produces -- an InstancedMesh cannot be resized, but it can be
    // told to draw fewer than it holds.
    const markerMesh = new THREE.InstancedMesh(markerGeo, markerMat, Math.max(allSpots.length, 1));
    const instanceDummy = new THREE.Object3D();
    // Positions never change (the globe group is what rotates) but the scale does, per zoom
    // level — see updateMarkerScale below — so the matrix buffer is rewritten occasionally.
    markerMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

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
    let lastMarkerScale = -1;
    function updateMarkerScale() {
      const scale = markerScaleForDistance(state.distance, MARKER_SCALING);
      // Rewriting 153 matrices is cheap but not free, and a sub-pixel change isn't visible.
      // The threshold is relative, not absolute: zoomed right in the scale itself is ~0.005, so
      // an absolute epsilon would swallow every remaining change and freeze the dots mid-shrink.
      if (lastMarkerScale > 0 && Math.abs(scale - lastMarkerScale) <= scale * 0.01) return;
      lastMarkerScale = scale;
      for (let i = 0; i < markers.length; i++) {
        instanceDummy.position.copy(markers[i].basePos);
        // A cluster is drawn bigger than a lone spot, by log rather than by count, so sixty
        // spots reads as more than two without becoming a dot the size of a country.
        instanceDummy.scale.setScalar(scale * clusterScale(markers[i].count));
        instanceDummy.updateMatrix();
        markerMesh.setMatrixAt(i, instanceDummy.matrix);
      }
      markerMesh.instanceMatrix.needsUpdate = true;
    }
    function clusterScale(count) {
      return count > 1 ? Math.min(2.1, 1 + Math.log10(count) * 0.85) : 1;
    }
    const instanceColor = new THREE.Color();
    // Every slot starts grey, including the ones no current cluster uses, so a marker can
    // never appear carrying a colour left over from a different zoom level.
    for (let i = 0; i < Math.max(allSpots.length, 1); i++) markerMesh.setColorAt(i, instanceColor.set('#33465C'));
    if (markerMesh.instanceColor) markerMesh.instanceColor.needsUpdate = true;
    globeGroup.add(markerMesh);

    // Re-form the clusters for the current zoom. Called from the frame loop, and cheap to call
    // there because it does nothing until the cell size has actually moved.
    function rebuildMarkers(cellDeg) {
      clusterCellDeg = cellDeg;
      const clusters = clusterPoints(allSpots, cellDeg);
      markers = clusters.map((c, i) => ({
        id: c.ids[0], ids: c.ids, count: c.count, lat: c.lat, lon: c.lon,
        basePos: latLonToVector3(c.lat, c.lon, MARKER_SHELL),
        worldPos: new THREE.Vector3(), // scratch, reused every frame instead of .clone()
        label: labelPool[i], labelText: '', labelTitle: '', labelShown: false,
      }));
      // A cluster's label is a count chip centred on the dot, not a name floating above it.
      for (let i = 0; i < markers.length; i++) {
        const wanted = markers[i].count > 1 ? 'tl-label tl-count' : 'tl-label';
        if (markers[i].label.className !== wanted) markers[i].label.className = wanted;
      }
      markerMesh.count = markers.length;
      // Every pooled label is hidden here, not just the slots this zoom leaves unused.
      //
      // The elements are pooled and reused, but `markers` is rebuilt from scratch on each zoom
      // step -- so a marker object arrives with labelShown false while the element it inherited
      // is still displayed from the previous arrangement. updateLabels then skips hiding it,
      // because as far as that marker knows it was never shown, and the label stays on screen
      // for a spot that is no longer there. Measured while fixing the overlap: 22 labels
      // visible against a cap of 14, the extra eight all stale. Clearing the pool on rebuild
      // makes the next frame's placement authoritative.
      for (let i = 0; i < labelPool.length; i++) {
        if (labelPool[i].style.display !== 'none') labelPool[i].style.display = 'none';
      }
      lastMarkerScale = -1; // the matrices belong to the previous set; rewrite all of them
      updateMarkerScale();
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
    // "A tap" is a mousedown/up or touchstart/end pair with barely any movement between them
    // and not too much time elapsed — the same drag gesture that rotates the globe also passes
    // through mousedown/mouseup, so a distance+time threshold is what actually distinguishes
    // "flicked past this marker while rotating" from "meant to tap it".
    const camDir = new THREE.Vector3();
    // Rotating a point never changes its length, so every marker's world position has the same
    // constant length -- which means the "is this marker facing the camera" test can compare the
    // raw dot product against a pre-scaled threshold instead of normalizing a vector per marker.
    const FACING_THRESHOLD = 0.28 * MARKER_SHELL;
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
    function pickSpotAt(clientX, clientY) {
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      // Against an InstancedMesh a hit identifies itself by instanceId, which is the marker's
      // index — no scanning a list of meshes to find which one was hit.
      const hit = raycaster.intersectObject(markerMesh)[0];
      if (hit && hit.instanceId != null) {
        const marker = markers[hit.instanceId];
        if (marker) chooseMarker(marker);
        return;
      }
      // Nothing exactly under the finger. Dots shrink on screen as you zoom in (see
      // updateMarkerScale), and a ~5px dot at the closest zoom is far smaller than anyone can
      // reliably tap -- so shrinking the ray target along with the dot would trade one problem
      // for another. Fall back to the nearest marker within a fingertip's radius: the dot stays
      // a small visual mark of a point while the thing you actually hit stays finger-sized.
      let bestMarker = null;
      let bestDistance = TAP_TOLERANCE_PX;
      const px = clientX - rect.left;
      const py = clientY - rect.top;
      camDir.copy(camera.position).normalize();
      for (let i = 0; i < markers.length; i++) {
        const m = markers[i];
        pickScratch.copy(m.basePos).applyEuler(globeGroup.rotation);
        if (pickScratch.dot(camDir) <= FACING_THRESHOLD) continue; // round the back of the globe
        pickScratch.project(camera);
        if (pickScratch.z >= 1) continue; // behind the camera
        const dx = (pickScratch.x * 0.5 + 0.5) * rect.width - px;
        const dy = (-pickScratch.y * 0.5 + 0.5) * rect.height - py;
        const distance = Math.hypot(dx, dy);
        if (distance < bestDistance) { bestDistance = distance; bestMarker = m; }
      }
      if (bestMarker) chooseMarker(bestMarker);
    }

    // Tapping one spot opens it. Tapping a cluster cannot -- it stands for anything up to
    // several dozen -- so it turns the globe to that patch of coast and zooms a step closer,
    // which is the thing that breaks the cluster back into its members. Two or three taps
    // walks you down from a continent to a single break.
    function chooseMarker(m) {
      if (m.count <= 1) { onSelectSpot(m.id); return; }
      const { rotX, rotY } = rotationToFace(m.lat, m.lon);
      // The short way round: without this, a cluster just past the antimeridian sends the
      // globe most of a turn to reach a point a few degrees away.
      state.targetRotX = shortestAngleTo(state.targetRotX, rotX);
      state.targetRotY = shortestAngleTo(state.targetRotY, rotY);
      state.targetDistance = clampDistance(state.targetDistance * CLUSTER_ZOOM_STEP);
    }
    function isTap(downX, downY, downTime, upX, upY) {
      return Math.hypot(upX - downX, upY - downY) < 6 && Date.now() - downTime < 500;
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
      state.velY = state.velY * 0.6 + rotY * 0.4;
      state.velX = state.velX * 0.6 + rotX * 0.4;
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
    function reportVisibleSpots() {
      const cb = visibleCbRef.current;
      if (!cb) return;
      const now = performance.now();
      if (now - lastReportAt < VISIBLE_REPORT_MS) return;
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

    const labelCandidates = [];
    const labelShow = new Set();
    function updateLabels() {
      camDir.copy(camera.position).normalize();
      labelCandidates.length = 0;

      for (let i = 0; i < markers.length; i++) {
        const m = markers[i];
        let onScreen = m.worldPos.copy(m.basePos).applyEuler(globeGroup.rotation).dot(camDir) > FACING_THRESHOLD;
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
        if (m.label.style.display === 'block' && m.labelText === m.measuredFor) {
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
          if (m.labelShown) { m.label.style.display = 'none'; m.labelShown = false; }
          continue;
        }
        if (!m.labelShown) { m.label.style.display = 'block'; m.labelShown = true; }
        // transform rather than left/top: this is a compositor-only property, so moving a label
        // doesn't force the browser into a layout pass for every visible label every frame.
        const anchor = m.count > 1 ? 'translate(-50%, -50%)' : 'translate(-50%, -130%)';
        m.label.style.transform = `${anchor} translate(${m.screenX}px, ${m.screenY}px)`;
      }
    }

    function onMouseDown(e) {
      state.dragging = true; state.lastX = e.clientX; state.lastY = e.clientY;
      state.downX = e.clientX; state.downY = e.clientY; state.downTime = Date.now();
      state.velX = 0; state.velY = 0; // grabbing it stops any coast in progress
    }
    function onMouseMove(e) {
      if (!state.dragging) return;
      const dx = e.clientX - state.lastX, dy = e.clientY - state.lastY;
      state.lastX = e.clientX; state.lastY = e.clientY;
      applyDrag(dx, dy);
    }
    function onMouseUp(e) {
      state.dragging = false;
      if (isTap(state.downX, state.downY, state.downTime, e.clientX, e.clientY)) {
        state.velX = 0; state.velY = 0; // a tap is not a flick
        pickSpotAt(e.clientX, e.clientY);
      }
    }
    function onWheel(e) {
      e.preventDefault();
      state.targetDistance = clampDistance(state.targetDistance * Math.exp(e.deltaY * WHEEL_ZOOM_SPEED));
    }
    function touchStart(e) {
      if (e.touches.length === 1) {
        state.dragging = true; state.lastX = e.touches[0].clientX; state.lastY = e.touches[0].clientY;
        state.downX = e.touches[0].clientX; state.downY = e.touches[0].clientY; state.downTime = Date.now();
        state.velX = 0; state.velY = 0; // grabbing it stops any coast in progress
      } else if (e.touches.length === 2) { state.pinchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); }
    }
    function touchMove(e) {
      e.preventDefault();
      if (e.touches.length === 1 && state.dragging) {
        const dx = e.touches[0].clientX - state.lastX, dy = e.touches[0].clientY - state.lastY;
        state.lastX = e.touches[0].clientX; state.lastY = e.touches[0].clientY;
        applyDrag(dx, dy);
      } else if (e.touches.length === 2 && state.pinchDist != null) {
        const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        // Same percent-of-distance reasoning as the wheel handler: scale by how much the ratio
        // between fingers changed, not the raw pixel delta, so pinching feels consistent at any
        // zoom level. Fingers spreading apart (d grows past the last reading) zooms in, matching
        // this gesture's meaning everywhere else on a touch device.
        state.targetDistance = clampDistance(state.targetDistance * (state.pinchDist / d));
        state.pinchDist = d;
      }
    }
    function touchEnd(e) {
      state.dragging = false; state.pinchDist = null;
      const t = e.changedTouches && e.changedTouches[0];
      if (t && isTap(state.downX, state.downY, state.downTime, t.clientX, t.clientY)) {
        state.velX = 0; state.velY = 0; // a tap is not a flick
        pickSpotAt(t.clientX, t.clientY);
      }
    }

    renderer.domElement.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false });
    renderer.domElement.addEventListener('touchstart', touchStart, { passive: true });
    renderer.domElement.addEventListener('touchmove', touchMove, { passive: false });
    renderer.domElement.addEventListener('touchend', touchEnd);

    // Marker colors and label text come from live forecast data, which changes on the order of
    // minutes — not per frame. The old loop recomputed and rewrote all of it every single frame
    // (153 material writes plus 153 DOM textContent writes, ~9,000 DOM writes a second), which
    // is most of why dragging stuttered. Now it runs on a timer, and only writes the DOM for
    // markers whose text actually changed.
    function refreshMarkerData() {
      const live = dataRef.current;
      let colorsChanged = false;
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
        markerMesh.setColorAt(i, instanceColor.set(bestScore == null ? '#33465C' : scoreToColor(bestScore)));
        colorsChanged = true;
        const spotObj = live.spots[m.id];
        const text = m.count > 1
          ? String(m.count)
          : (spotObj ? spotObj.name : m.id) + ' · ' + (bestRating || '···');
        // The chip carries the number; the rest is for anyone reading it with a screen reader
        // or hovering, where "61" alone says nothing.
        const title = m.count > 1
          ? m.count + ' spots' + (bestRating ? ' · best ' + bestRating : ' · no readings yet')
          : text;
        if (title !== m.labelTitle) { m.label.title = title; m.label.setAttribute('aria-label', title); m.labelTitle = title; }
        if (text !== m.labelText) { m.label.textContent = text; m.labelText = text; }
      }
      if (colorsChanged && markerMesh.instanceColor) markerMesh.instanceColor.needsUpdate = true;
      // What the legend reports. "124 of 403" is the difference between a colour scale that
      // describes the globe and one that describes a quarter of it while looking the same.
      if (spotsWithReading !== lastReadingCount) {
        lastReadingCount = spotsWithReading;
        setLiveCount(spotsWithReading);
      }
      state.dataDirty = true; // colors/labels may have changed, so the next frame must draw
    }
    updateClusters(); // builds the first set of markers, and colours them
    const dataTimer = setInterval(refreshMarkerData, 1000);

    // Smoothing. Input writes to the *target* rotation/distance; each frame eases the rendered
    // values toward it. That's what makes this feel smooth rather than stepwise: a wheel notch
    // glides instead of snapping, and a flick keeps coasting (momentum) instead of stopping
    // dead the instant you lift your finger. Eased per-frame by a fixed fraction, so it stays
    // responsive (most of the gap closes within a couple of frames) without the raw jitter of
    // applying pointer deltas straight to the camera.
    const EASE = 0.28;          // fraction of the remaining gap closed per frame
    const FRICTION = 0.94;      // how quickly flick momentum bleeds off
    const MIN_VELOCITY = 0.00002; // below this, momentum has visually stopped — drop it
    const SETTLED = 0.00005; // gap below which easing has visually arrived
    function animate() {
      const coasting = !state.dragging && (Math.abs(state.velX) > MIN_VELOCITY || Math.abs(state.velY) > MIN_VELOCITY);
      if (coasting) {
        state.targetRotY += state.velY;
        state.targetRotX = Math.max(-1.2, Math.min(1.2, state.targetRotX + state.velX));
        state.velX *= FRICTION;
        state.velY *= FRICTION;
      } else if (!state.dragging) {
        state.velX = 0; state.velY = 0;
      }

      const dRotX = state.targetRotX - state.rotX;
      const dRotY = state.targetRotY - state.rotY;
      const dDist = state.targetDistance - state.distance;
      const moving = coasting || state.dragging
        || Math.abs(dRotX) > SETTLED || Math.abs(dRotY) > SETTLED || Math.abs(dDist) > SETTLED;

      // Nothing moved and no data changed: skip the frame entirely rather than re-rendering an
      // identical image. A globe sitting still cost exactly as much as one being dragged before
      // this, which on a phone is battery burned for no visible result.
      if (!moving && !state.dataDirty) {
        state.raf = requestAnimationFrame(animate);
        return;
      }
      state.dataDirty = false;

      state.rotX += dRotX * EASE;
      state.rotY += dRotY * EASE;
      state.distance += dDist * EASE;
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
      if (waveMesh) waveMesh.visible = wavesOnRef.current;
      updateArrows();
      if (coastlineMesh) {
        const o = coastlineOpacity(state.distance, COASTLINE_FADE_START, COASTLINE_FADE_END);
        coastlineMat.opacity = o;
        coastlineMesh.visible = o > 0;
      }
      renderer.render(scene, camera);
      state.raf = requestAnimationFrame(animate);
    }
    animate();

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
      markDirtyRef.current = null;
      cancelAnimationFrame(state.raf);
      clearInterval(dataTimer);
      renderer.domElement.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      renderer.domElement.removeEventListener('wheel', onWheel);
      renderer.domElement.removeEventListener('touchstart', touchStart);
      renderer.domElement.removeEventListener('touchmove', touchMove);
      renderer.domElement.removeEventListener('touchend', touchEnd);
      // The pool, not `markers`: markers holds only the clusters the current zoom produced, so
      // tearing down from it orphans every label belonging to a set that has since re-formed.
      // (Measured: 751 label nodes alive after two mounts, against 403 spots.)
      labelPool.forEach((el) => { if (el.parentNode) el.parentNode.removeChild(el); });
      starGeo.dispose(); starMat.dispose(); starDotTexture.dispose();
      glowTexture.dispose(); glowMat.dispose();
      if (mapTexture) mapTexture.dispose();
      oceanMat.dispose(); oceanMesh.geometry.dispose();
      if (satelliteTexture) satelliteTexture.dispose();
      markerGeo.dispose(); markerMat.dispose(); markerMesh.dispose();
      // ~10MB of line vertices: the one buffer here big enough that leaking it across a few
      // open/close cycles of the globe would actually be felt on a phone.
      if (coastlineMesh) coastlineMesh.geometry.dispose();
      coastlineMat.dispose();
      if (waveMesh) { waveMesh.geometry.dispose(); waveMesh.material.dispose(); }
      if (arrowMesh) { arrowMesh.geometry.dispose(); arrowMesh.material.dispose(); arrowMesh.dispose(); }
      if (waveTexture) waveTexture.dispose();
      if (waveMaskTexture) waveMaskTexture.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
    };
    } catch {
      // WebGL genuinely isn't working here — surface that instead of leaving a blank canvas
      // with no indication of why nothing rendered.
      setGlobeError(true);
      return undefined;
    }
    // Mount-once: this component is only ever rendered while the globe view is active, so
    // mounting/unmounting it already does what watching a "view" prop used to do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          {wavesOn ? 'Hide live swell' : 'Show live swell'}
        </button>
        {/* The animated week. Only offered once the live overlay is actually drawn: it repaints
            that overlay's own texture, so there is nothing for it to animate until then. */}
        {wavesOn && waveMeta && waveMeta.ok && (
          <div style={{ marginBottom: 10 }}>
            {framesState === 'ready' && frames ? (
              <div>
                <div className="flex items-center" style={{ gap: 10 }}>
                  <button
                    className="tl-btn"
                    onClick={() => {
                      // Replay from the start when the week has already run to its end,
                      // rather than pressing play on a frame that cannot advance.
                      if (pos >= frames.list.length - 1) setPos(0);
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
                    type="range" min={0} max={frames.list.length - 1} step={1} value={frameIdx}
                    aria-label="Forecast hour"
                    onChange={(e) => { setPlaying(false); setPos(Number(e.target.value)); }}
                    style={{ flex: 1, accentColor: COLORS.tealBright, minHeight: 44 }}
                  />
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
        {wavesOn && (
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
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                  {waveScaleTicks(units).map((t) => (
                    <span key={t.label} style={{ fontSize: 9, color: COLORS.foamDim }}>{t.label}</span>
                  ))}
                </div>
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
