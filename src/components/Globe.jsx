import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import * as THREE from 'three';
import { COLORS } from '../lib/colors.js';
import { latLonToVector3 } from '../lib/geo3d.js';
import { scoreToColor } from '../lib/rating.js';
import { PLACEHOLDER_HOURS } from '../lib/placeholders.js';
import LANDMASSES from '../data/landmasses.json';
import { ConditionScale } from './ConditionScale.jsx';

// Interactive 3D globe of every saved spot, colored by live conditions. Owns its own WebGL
// lifecycle: mounting this component is equivalent to the parent switching to the globe view,
// unmounting it tears the scene down — so a plain mount-effect (deps: []) is enough, no need
// to watch a "view" prop the way the single-file version watched `view` state.
//
// `dataRef` is a ref (owned by the parent) whose `.current` is kept fresh every render with
// `{ spots, order, forecast, hourIdx }` — read directly inside the animation loop so every
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
    // by one. Markers sit on a shell at R*1.045, so this has to stay clear of that.
    const MARKER_SHELL = R * 1.045;
    const MIN_DISTANCE = 1.08;
    const MAX_DISTANCE = 6;

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
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    // outputEncoding/sRGBEncoding was renamed to outputColorSpace/SRGBColorSpace in newer
    // Three.js and removed entirely in later versions — set whichever this build actually has.
    if ('outputColorSpace' in renderer && THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;
    else if ('outputEncoding' in renderer && THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.setSize(width, height);
    // Capped at 2 rather than 3: fragment cost scales with the square of this, so on a 3x
    // phone screen the old cap rendered 9x the pixels of CSS resolution (with MSAA on top of
    // that) for a difference that is not visible at this size. This is the single biggest
    // GPU saving here.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.appendChild(renderer.domElement);
    setGlobeError(false);

    // Set by cleanup so async work (the satellite texture below) can tell it arrived too late.
    let cancelled = false;

    const globeGroup = new THREE.Group();
    scene.add(globeGroup);

    const mapW = 2048, mapH = 1024;
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
    mctx.lineWidth = 2.5;
    LANDMASSES.forEach((pts) => {
      // A handful of rings (Russia, Antarctica, Fiji) were unwrapped past
      // ±180° during data prep so their coastline stays contiguous — that
      // pushes some of their x coordinates outside the canvas. Painting
      // each ring three times, shifted a full map-width left/right, covers
      // the wraparound correctly wherever it actually lands on-canvas.
      [-mapW, 0, mapW].forEach((xOffset) => {
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
    mctx.lineWidth = 1;
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
    // NOTE: this URL could not be verified from the sandbox this was written in (its proxy
    // blocks nasa.gov), so the fallback above is doing real work, not just belt-and-braces.
    // If the imagery never appears, this constant is the one thing to check -- any
    // equirectangular (2:1) image URL that allows cross-origin reads will work here.
    const SATELLITE_TEXTURE_URL = 'https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57752/land_shallow_topo_2048.jpg';
    let satelliteTexture = null;
    const textureLoader = new THREE.TextureLoader();
    textureLoader.setCrossOrigin('anonymous'); // required to use the pixels as a WebGL texture
    textureLoader.load(
      SATELLITE_TEXTURE_URL,
      (tex) => {
        if (cancelled) { tex.dispose(); return; }
        if ('colorSpace' in tex && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = true;
        satelliteTexture = tex;
        oceanMat.map = tex;
        // Real imagery is already lit by the sun in the photograph; the drawn map needed the
        // shading to read as a sphere at all, so dial the specular highlight back to keep the
        // continents from looking wet.
        oceanMat.shininess = 6;
        oceanMat.needsUpdate = true;
        state.dataDirty = true; // make sure an idle globe redraws to show it
      },
      undefined,
      () => { /* offline, blocked, or moved: keep the drawn map, which is already on screen */ },
    );
    // 96x96 segments was ~18k triangles for a sphere that is never larger than the viewport;
    // 64x48 is ~6k and visually identical here, silhouette included.
    const oceanMesh = new THREE.Mesh(new THREE.SphereGeometry(R, 64, 48), oceanMat);
    globeGroup.add(oceanMesh);

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
        basePos: latLonToVector3(s.lat, s.lon, R * 1.045),
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
    // Markers never move relative to the globe (the globe group is what rotates), so the matrix
    // buffer is written once here and never touched again.
    markerMesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    const instanceColor = new THREE.Color();
    markers.forEach((_, i) => markerMesh.setColorAt(i, instanceColor.set('#33465C')));
    if (markerMesh.instanceColor) markerMesh.instanceColor.needsUpdate = true;
    globeGroup.add(markerMesh);

    // Tapping a marker (as opposed to dragging to rotate) jumps straight to that spot's page.
    // "A tap" is a mousedown/up or touchstart/end pair with barely any movement between them
    // and not too much time elapsed — the same drag gesture that rotates the globe also passes
    // through mousedown/mouseup, so a distance+time threshold is what actually distinguishes
    // "flicked past this marker while rotating" from "meant to tap it".
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    function pickSpotAt(clientX, clientY) {
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      // Against an InstancedMesh a hit identifies itself by instanceId, which is the marker's
      // index — no scanning a list of meshes to find which one was hit.
      const hit = raycaster.intersectObject(markerMesh)[0];
      if (!hit || hit.instanceId == null) return;
      const marker = markers[hit.instanceId];
      if (marker) onSelectSpot(marker.id);
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
      const sensitivity = (state.distance * tanHalfFov) / (height / 2);
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
    const camDir = new THREE.Vector3();
    // Rotating a point never changes its length, so every marker's world position has the same
    // constant length -- which means the "is this marker facing the camera" test can compare the
    // raw dot product against a pre-scaled threshold instead of normalizing a vector per marker.
    const FACING_THRESHOLD = 0.28 * R * 1.045;
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
        const hr = hrs[live.hourIdx];
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
      updateLabels();
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
