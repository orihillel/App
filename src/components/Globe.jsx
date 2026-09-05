import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import * as THREE from 'three';
import { COLORS } from '../lib/colors.js';
import { latLonToVector3, markerScaleForDistance } from '../lib/geo3d.js';
import { scoreToColor } from '../lib/rating.js';
import { arcsToLineVertices, coastlineOpacity } from '../lib/coastline.js';
import { pickHourAt } from '../lib/daylight.js';
import { PLACEHOLDER_HOURS } from '../lib/placeholders.js';
import LANDMASSES from '../data/landmasses.json';
import { ConditionScale } from './ConditionScale.jsx';

// Interactive 3D globe of every saved spot, colored by live conditions. Owns its own WebGL
// lifecycle: mounting this component is equivalent to the parent switching to the globe view,
// unmounting it tears the scene down — so a plain mount-effect (deps: []) is enough, no need
// to watch a "view" prop the way the single-file version watched `view` state.
//
// `dataRef` is a ref (owned by the parent) whose `.current` is kept fresh every render with
// `{ spots, order, forecast, clockHour }` — read directly inside the animation loop so every
// rendered frame reflects whatever is currently in `forecast`, with no separate sync effect
// to fall out of date.
export function Globe({ order, dataRef, onClose, onSelectSpot, title = 'All spots', hint }) {
  const containerRef = useRef(null);
  const [globeError, setGlobeError] = useState(false);

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

    // Left at 2048x1024, though the drawing cost is no longer the reason. Drawing this map
    // measures 12ms at 2048 and 40ms at 4096 -- both cheap, and cheaper still since the
    // wraparound handling below stopped redrawing every ring three times. What is not cheap is
    // handing a 4096x2048 canvas to the GPU: the upload plus mipmap chain is ~32MB, and it is
    // paid on every globe open for a map that real imagery replaces moments later. The
    // resolution that matters when zoomed in comes from the satellite texture below, and from
    // the device pixel ratio above.
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
    const mapTexture = new THREE.CanvasTexture(mapCanvas);
    // A flat texture wrapped on a sphere gets viewed at steep angles near the edges of what's
    // visible, which is exactly the case anisotropic filtering is for — without it, those
    // regions look noticeably blurrier/blockier than the center, which reads as "pixelated".
    mapTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    mapTexture.minFilter = THREE.LinearMipmapLinearFilter;
    mapTexture.magFilter = THREE.LinearFilter;
    mapTexture.generateMipmaps = true;
    const oceanMat = new THREE.MeshPhongMaterial({ map: mapTexture, shininess: 14, specular: 0x1a3a4a });

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
      oceanMat.map = tex;
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

    function ensureCoastline() {
      if (coastlineRequested || state.distance > COASTLINE_FADE_START) return;
      coastlineRequested = true;
      const base = (import.meta.env && import.meta.env.BASE_URL) || '/';
      fetch(base.replace(/\/$/, '') + '/coastline-10m.json')
        .then((r) => (r.ok ? r.json() : null))
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
        // Offline, or the asset missing: the globe is fully usable without it, so there is
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
    const markers = [];
    dataRef.current.order.forEach((id) => {
      const s = dataRef.current.spots[id];
      if (!s) return;
      const label = document.createElement('div');
      label.className = 'tl-label';
      label.textContent = s.name;
      // Anchored at the container's origin; updateLabels() moves it purely via transform.
      label.style.left = '0';
      label.style.top = '0';
      container.appendChild(label);
      markers.push({
        id, label,
        basePos: latLonToVector3(s.lat, s.lon, MARKER_SHELL),
        worldPos: new THREE.Vector3(), // scratch, reused every frame instead of .clone()
        labelText: '', labelShown: false, // last-written DOM state, so we only touch the DOM on change
      });
    });

    const markerGeo = new THREE.SphereGeometry(0.026, 12, 12);
    const markerMat = new THREE.MeshBasicMaterial();
    const markerMesh = new THREE.InstancedMesh(markerGeo, markerMat, Math.max(markers.length, 1));
    const instanceDummy = new THREE.Object3D();
    markers.forEach((m, i) => {
      instanceDummy.position.copy(m.basePos);
      instanceDummy.updateMatrix();
      markerMesh.setMatrixAt(i, instanceDummy.matrix);
    });
    markerMesh.instanceMatrix.needsUpdate = true;
    // Positions never change (the globe group is what rotates) but the scale does, per zoom
    // level — see updateMarkerScale below — so the matrix buffer is rewritten occasionally.
    markerMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

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
        instanceDummy.scale.setScalar(scale);
        instanceDummy.updateMatrix();
        markerMesh.setMatrixAt(i, instanceDummy.matrix);
      }
      markerMesh.instanceMatrix.needsUpdate = true;
    }
    updateMarkerScale();
    const instanceColor = new THREE.Color();
    markers.forEach((_, i) => markerMesh.setColorAt(i, instanceColor.set('#33465C')));
    if (markerMesh.instanceColor) markerMesh.instanceColor.needsUpdate = true;
    globeGroup.add(markerMesh);

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
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    // How far off a dot a tap can land and still count as meant for it, in CSS pixels --
    // roughly half a fingertip.
    const TAP_TOLERANCE_PX = 22;
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
        if (marker) onSelectSpot(marker.id);
        return;
      }
      // Nothing exactly under the finger. Dots shrink on screen as you zoom in (see
      // updateMarkerScale), and a ~5px dot at the closest zoom is far smaller than anyone can
      // reliably tap -- so shrinking the ray target along with the dot would trade one problem
      // for another. Fall back to the nearest marker within a fingertip's radius: the dot stays
      // a small visual mark of a point while the thing you actually hit stays finger-sized.
      let bestId = null;
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
        if (distance < bestDistance) { bestDistance = distance; bestId = m.id; }
      }
      if (bestId != null) onSelectSpot(bestId);
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
    function updateLabels() {
      camDir.copy(camera.position).normalize();
      const zoomedIn = state.distance < 2.2;
      for (let i = 0; i < markers.length; i++) {
        const m = markers[i];
        let show = zoomedIn && m.worldPos.copy(m.basePos).applyEuler(globeGroup.rotation).dot(camDir) > FACING_THRESHOLD;
        if (show) {
          m.worldPos.project(camera); // in place, on the world position just computed above
          // Facing the camera is not the same as being on screen. Zoomed out they amount to the
          // same thing, but zoomed in the camera only covers a few degrees of arc while the
          // facing test still passes for most of the hemisphere -- so without this check, spots
          // well outside the view get labels placed far outside the canvas, which then spill
          // over the header and nav (the container doesn't clip). Cull to the frustum instead.
          show = m.worldPos.z < 1 && Math.abs(m.worldPos.x) <= 1 && Math.abs(m.worldPos.y) <= 1;
        }
        if (!show) {
          if (m.labelShown) { m.label.style.display = 'none'; m.labelShown = false; }
          continue;
        }
        if (!m.labelShown) { m.label.style.display = 'block'; m.labelShown = true; }
        // transform rather than left/top: this is a compositor-only property, so moving a label
        // doesn't force the browser into a layout pass for every visible label every frame.
        m.label.style.transform = `translate(-50%, -130%) translate(${(m.worldPos.x * 0.5 + 0.5) * width}px, ${(-m.worldPos.y * 0.5 + 0.5) * height}px)`;
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
      for (let i = 0; i < markers.length; i++) {
        const m = markers[i];
        const sfm = live.forecast[m.id];
        const hrs = (sfm && sfm.hours) || PLACEHOLDER_HOURS;
        // By clock hour, not array index: each spot's hours come from its own daylight window,
        // so index N is a different time of day at each spot — and out of range entirely at one
        // with a shorter day, which left those markers grey.
        const hr = pickHourAt(hrs, live.clockHour);
        const rating = hr ? hr.rating : 'LOADING';
        const color = (rating === 'LOADING' || !hr || hr.score == null) ? '#33465C' : scoreToColor(hr.score);
        markerMesh.setColorAt(i, instanceColor.set(color));
        colorsChanged = true;
        const spotObj = live.spots[m.id];
        const text = (spotObj ? spotObj.name : m.id) + ' · ' + (rating === 'LOADING' ? '···' : rating);
        if (text !== m.labelText) { m.label.textContent = text; m.labelText = text; }
      }
      if (colorsChanged && markerMesh.instanceColor) markerMesh.instanceColor.needsUpdate = true;
      state.dataDirty = true; // colors/labels may have changed, so the next frame must draw
    }
    refreshMarkerData();
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
      updateLabels();
      ensureCoastline();
      if (coastlineMesh) {
        const o = coastlineOpacity(state.distance, COASTLINE_FADE_START, COASTLINE_FADE_END);
        coastlineMat.opacity = o;
        coastlineMesh.visible = o > 0;
      }
      renderer.render(scene, camera);
      state.raf = requestAnimationFrame(animate);
    }
    animate();

    return () => {
      cancelled = true;
      cancelAnimationFrame(state.raf);
      clearInterval(dataTimer);
      renderer.domElement.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      renderer.domElement.removeEventListener('wheel', onWheel);
      renderer.domElement.removeEventListener('touchstart', touchStart);
      renderer.domElement.removeEventListener('touchmove', touchMove);
      renderer.domElement.removeEventListener('touchend', touchEnd);
      markers.forEach((m) => { if (m.label.parentNode) m.label.parentNode.removeChild(m.label); });
      starGeo.dispose(); starMat.dispose(); starDotTexture.dispose();
      glowTexture.dispose(); glowMat.dispose();
      mapTexture.dispose(); oceanMat.dispose(); oceanMesh.geometry.dispose();
      if (satelliteTexture) satelliteTexture.dispose();
      markerGeo.dispose(); markerMat.dispose(); markerMesh.dispose();
      // ~10MB of line vertices: the one buffer here big enough that leaking it across a few
      // open/close cycles of the globe would actually be felt on a phone.
      if (coastlineMesh) coastlineMesh.geometry.dispose();
      coastlineMat.dispose();
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
    <div>
      <div className="flex justify-between items-center px-6 pt-2 pb-3">
        <span style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, fontSize: 17, color: COLORS.foam }}>{title}</span>
        <button className="tl-btn" onClick={onClose} style={{ background: 'none', border: 'none', padding: 6 }} aria-label="Close globe"><X size={18} color={COLORS.foamDim} /></button>
      </div>
      <div style={{ padding: '0 20px 6px', fontSize: 11, color: COLORS.foamDim }}>
        {hint || `${order.length} spot${order.length === 1 ? '' : 's'} you've found · tap a marker to view it · drag to rotate, pinch or scroll to zoom`}
      </div>
      <div ref={containerRef} style={{ position: 'relative', width: '100%', height: 420, touchAction: 'none' }} />
      {globeError && (
        <div style={{ margin: '0 20px', padding: '14px 16px', background: COLORS.navyCard, border: '1px solid ' + COLORS.navyBorder, borderRadius: 10, fontSize: 12, color: COLORS.foamDim, lineHeight: 1.5 }}>
          3D rendering failed to start in this preview — that's a real signal, not just a display glitch. Let me know and I'll switch this view to the flat map instead.
        </div>
      )}
      <div className="mx-6" style={{ padding: '10px 0 4px' }}>
        <ConditionScale />
        <div style={{ fontSize: 9.5, color: COLORS.foamDim, marginTop: 6, textAlign: 'center' }}>Spot color = live conditions right now</div>
      </div>
    </div>
  );
}
