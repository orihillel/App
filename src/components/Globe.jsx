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

    // How close in you can zoom (a smaller distance means the globe fills more of the screen,
    // spreading nearby markers further apart in screen space -- the point of zooming in at all
    // here, since it's what actually makes a tight cluster like the California spots tappable
    // individually instead of staying jammed into the same few pixels no matter how far you
    // zoom). The camera's near-clip plane has to be pulled in to match (below MIN_DISTANCE - R,
    // the closest the camera can ever get to the sphere's surface) or the near side of the
    // globe -- exactly the part you're zooming in to look at -- would start getting clipped.
    const MIN_DISTANCE = 1.12;
    const MAX_DISTANCE = 6;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.02, 20);
    const state = { distance: 3.0, rotX: 0.3, rotY: 0.6, dragging: false, lastX: 0, lastY: 0, pinchDist: null, raf: null, downX: 0, downY: 0, downTime: 0 };
    camera.position.set(0, 0, state.distance);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, logarithmicDepthBuffer: true });
    // outputEncoding/sRGBEncoding was renamed to outputColorSpace/SRGBColorSpace in newer
    // Three.js and removed entirely in later versions — set whichever this build actually has.
    if ('outputColorSpace' in renderer && THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;
    else if ('outputEncoding' in renderer && THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 3));
    container.appendChild(renderer.domElement);
    setGlobeError(false);

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
    const oceanMesh = new THREE.Mesh(new THREE.SphereGeometry(R, 96, 96), oceanMat);
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

    const markers = [];
    dataRef.current.order.forEach((id) => {
      const s = dataRef.current.spots[id];
      if (!s) return;
      const localPos = latLonToVector3(s.lat, s.lon, R * 1.045);
      const geo = new THREE.SphereGeometry(0.026, 12, 12);
      const mat = new THREE.MeshBasicMaterial({ color: '#33465C' });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(localPos);
      globeGroup.add(mesh);

      const label = document.createElement('div');
      label.className = 'tl-label';
      label.textContent = s.name;
      container.appendChild(label);

      markers.push({ id, mesh, label, basePos: localPos });
    });

    // Tapping a marker (as opposed to dragging to rotate) jumps straight to that spot's page.
    // "A tap" is a mousedown/up or touchstart/end pair with barely any movement between them
    // and not too much time elapsed — the same drag gesture that rotates the globe also passes
    // through mousedown/mouseup, so a distance+time threshold is what actually distinguishes
    // "flicked past this marker while rotating" from "meant to tap it".
    const raycaster = new THREE.Raycaster();
    const markerMeshes = markers.map((m) => m.mesh);
    function pickSpotAt(clientX, clientY) {
      const rect = renderer.domElement.getBoundingClientRect();
      const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera({ x: ndcX, y: ndcY }, camera);
      const hit = raycaster.intersectObjects(markerMeshes)[0];
      if (!hit) return;
      const marker = markers.find((m) => m.mesh === hit.object);
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
      state.rotY += dx * sensitivity;
      state.rotX = Math.max(-1.2, Math.min(1.2, state.rotX + dy * sensitivity));
    }
    // Percent-of-current-distance zoom (both wheel and pinch below) rather than a fixed step,
    // so zooming feels the same proportionally whether you're already in close or way out --
    // a fixed step is a huge relative jump once near MIN_DISTANCE and barely perceptible at
    // MAX_DISTANCE.
    const WHEEL_ZOOM_SPEED = 0.00085;
    function clampDistance(d) { return Math.max(MIN_DISTANCE, Math.min(MAX_DISTANCE, d)); }

    function updateLabels() {
      const camDir = camera.position.clone().normalize();
      markers.forEach((m) => {
        const worldPos = m.basePos.clone().applyEuler(globeGroup.rotation);
        const facing = worldPos.clone().normalize().dot(camDir);
        const zoomedIn = state.distance < 2.2;
        if (facing > 0.28 && zoomedIn) {
          const proj = worldPos.clone().project(camera);
          m.label.style.display = 'block';
          m.label.style.left = ((proj.x * 0.5 + 0.5) * width) + 'px';
          m.label.style.top = ((-proj.y * 0.5 + 0.5) * height) + 'px';
        } else {
          m.label.style.display = 'none';
        }
      });
    }

    function onMouseDown(e) {
      state.dragging = true; state.lastX = e.clientX; state.lastY = e.clientY;
      state.downX = e.clientX; state.downY = e.clientY; state.downTime = Date.now();
    }
    function onMouseMove(e) {
      if (!state.dragging) return;
      const dx = e.clientX - state.lastX, dy = e.clientY - state.lastY;
      state.lastX = e.clientX; state.lastY = e.clientY;
      applyDrag(dx, dy);
    }
    function onMouseUp(e) {
      state.dragging = false;
      if (isTap(state.downX, state.downY, state.downTime, e.clientX, e.clientY)) pickSpotAt(e.clientX, e.clientY);
    }
    function onWheel(e) {
      e.preventDefault();
      state.distance = clampDistance(state.distance * Math.exp(e.deltaY * WHEEL_ZOOM_SPEED));
    }
    function touchStart(e) {
      if (e.touches.length === 1) {
        state.dragging = true; state.lastX = e.touches[0].clientX; state.lastY = e.touches[0].clientY;
        state.downX = e.touches[0].clientX; state.downY = e.touches[0].clientY; state.downTime = Date.now();
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
        state.distance = clampDistance(state.distance * (state.pinchDist / d));
        state.pinchDist = d;
      }
    }
    function touchEnd(e) {
      state.dragging = false; state.pinchDist = null;
      const t = e.changedTouches && e.changedTouches[0];
      if (t && isTap(state.downX, state.downY, state.downTime, t.clientX, t.clientY)) pickSpotAt(t.clientX, t.clientY);
    }

    renderer.domElement.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false });
    renderer.domElement.addEventListener('touchstart', touchStart, { passive: true });
    renderer.domElement.addEventListener('touchmove', touchMove, { passive: false });
    renderer.domElement.addEventListener('touchend', touchEnd);

    function animate() {
      globeGroup.rotation.set(state.rotX, state.rotY, 0);
      camera.position.set(0, 0, state.distance);
      camera.lookAt(0, 0, 0);
      updateLabels();
      // Colors are recomputed every frame straight from the live data ref, rather than in a
      // separate effect keyed on [forecast, hourIdx, ...] — that indirection was the source of
      // the markers getting stuck on their initial gray color. This way there's nothing to fall
      // out of sync: every rendered frame reflects whatever is currently in `forecast`.
      const live = dataRef.current;
      markers.forEach((m) => {
        const sfm = live.forecast[m.id];
        const hrs = (sfm && sfm.hours) || PLACEHOLDER_HOURS;
        const hr = hrs[live.hourIdx];
        const rating = hr ? hr.rating : 'LOADING';
        const color = (rating === 'LOADING' || !hr || hr.score == null) ? '#33465C' : scoreToColor(hr.score);
        m.mesh.material.color.set(color);
        const spotObj = live.spots[m.id];
        m.label.textContent = (spotObj ? spotObj.name : m.id) + ' · ' + (rating === 'LOADING' ? '···' : rating);
      });
      renderer.render(scene, camera);
      state.raf = requestAnimationFrame(animate);
    }
    animate();

    return () => {
      cancelAnimationFrame(state.raf);
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
