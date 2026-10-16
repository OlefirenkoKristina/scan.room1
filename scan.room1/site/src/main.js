import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const canvas = document.createElement('canvas');
const app = document.getElementById('app');
app.prepend(canvas);

// Lighting is baked into the textures in Blender (AgX look included),
// so no tone mapping / real-time lights: what you see is what Blender rendered.
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');     // headset height above the real floor = eye height in-scene

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14110f);
const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 100);
let baseFov = 60;                                // vertical fov on landscape; widened on portrait phones so the view isn't a tunnel

// ---- VR (WebXR): camera sits in a "rig" group. Outside VR we move the camera directly
// (rig stays at identity, so nothing changes). In VR the headset fully drives the camera's
// local pose each frame, so locomotion instead moves the rig underneath it. ----
const rig = new THREE.Group();
rig.add(camera);
scene.add(rig);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.95;

// ---- walk mode (WASD + mouse look), default; V toggles free orbit view ----
const walk = new PointerLockControls(camera, canvas);
const EYE = 1.5, RADIUS = 0.3, SPEED = 1.6, RUN = 3.2;
const keys = {};
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
// ---- phones are landscape by default: if the phone is held upright (and the browser
// can't lock orientation, e.g. iOS), the whole #app is turned 90° so it still shows landscape. ----
let rotated = false, W = innerWidth, H = innerHeight;
const joy = { x: 0, y: 0 };                      // touch joystick, -1..1 (y>0 = forward)
let walking = true, floorY = 0, room = null;
let solids = [], floors = [];                    // furniture is deliberately NOT in solids: you can walk through it
const ray = new THREE.Raycaster();
const hint = document.getElementById('hint');

// ---- VR headsets (Quest, Pico, etc.): no "Enter VR" button and no website UI — the page
// tries to open the immersive room by itself; if the browser insists on a user gesture,
// the very first trigger press / tap anywhere enters it. ----
const headsetUA = /OculusBrowser|Quest|Pico|Wolvic|VR/i.test(navigator.userAgent);
let vrCapable = false, vrPending = false;
const vrReady = (async () => {
  try { vrCapable = !!(navigator.xr && await navigator.xr.isSessionSupported('immersive-vr')); } catch { vrCapable = false; }
  if (!vrCapable && headsetUA && navigator.xr) vrCapable = true;   // some headset browsers under-report support
  if (vrCapable) {
    hint.textContent = 'Натисніть курок або торкніться, щоб увійти у кімнату';
    document.getElementById('modeBtn').style.display = 'none';
    navigator.xr.addEventListener?.('sessiongranted', enterVR);    // arriving from another VR page: enter right away
    enterVR();                                                      // works where no gesture is required
    for (const t of ['pointerdown', 'click', 'keydown', 'touchstart']) addEventListener(t, enterVR, true);
  }
  return vrCapable;
})();
async function enterVR() {
  if (!vrCapable || vrPending || renderer.xr.isPresenting) return;
  vrPending = true;
  try {
    const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] });
    await renderer.xr.setSession(session);
  } catch { /* needs a user gesture — the next tap/trigger press retries */ }
  vrPending = false;
}

const setMode = (w) => {
  walking = w; controls.enabled = !w;
  if (!w && walk.isLocked) walk.unlock();
  if (w) { camera.rotation.z = 0; }
  document.body.classList.toggle('walking', w);
  if (vrCapable) return;
  if (isTouch) { hint.textContent = w ? 'Правий палець — ходити · лівий — дивитись' : 'Один палець — обертати · щипок — наближення · два пальці — зсув'; return; }
  hint.textContent = w
    ? 'Клік — захопити мишу · WASD / стрілки — ходити · Shift — бігти · Esc — відпустити мишу · V — вільний огляд'
    : 'Ліва кнопка — обертати · колесо — наближення · права кнопка — зсув · V — ходити';
};
canvas.addEventListener('click', () => {
  if (vrCapable) return;
  if (walking && !walk.isLocked) walk.lock();
});
addEventListener('keydown', (e) => {
  if (e.code === 'KeyV' && !e.repeat) {
    if (walking) { setMode(false); controls.target.copy(camera.position).add(camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(2)); }
    else { setMode(true); }
    return;
  }
  keys[e.code] = true;
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

// ---- touch: right half = virtual joystick, left half = look around; button toggles walk / orbit ----
if (isTouch) {
  // while #app is rotated, re-dispatch touches in the app's own (landscape) coordinates,
  // so the joystick and OrbitControls see the same axes the user sees
  const remap = (e) => {
    if (!rotated || !e.isTrusted || e.target !== canvas) return;
    e.stopImmediatePropagation();
    canvas.dispatchEvent(new PointerEvent(e.type, {
      pointerId: e.pointerId, pointerType: e.pointerType, isPrimary: e.isPrimary,
      button: e.button, buttons: e.buttons, bubbles: true, cancelable: true,
      clientX: e.clientY, clientY: innerWidth - e.clientX,
    }));
  };
  for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) addEventListener(t, remap, true);
  // first tap: go fullscreen and lock landscape where the browser allows it (Android Chrome)
  canvas.addEventListener('pointerdown', () => {
    if (vrCapable || document.fullscreenElement || !document.documentElement.requestFullscreen) return;
    document.documentElement.requestFullscreen({ navigationUI: 'hide' })
      .then(() => screen.orientation?.lock?.('landscape')).catch(() => {});
  }, { once: true });

  const stick = document.getElementById('stick'), knob = stick.firstElementChild, R = 50;
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  let moveId = null, lookId = null, ox = 0, oy = 0, lx = 0, ly = 0;
  canvas.addEventListener('pointerdown', (e) => {
    if (!walking || vrCapable || e.pointerType === 'mouse') return;
    canvas.setPointerCapture(e.pointerId);
    if (e.clientX > W / 2 && moveId === null) {
      moveId = e.pointerId; ox = e.clientX; oy = e.clientY;
      stick.style.cssText = `display:block;left:${ox - R}px;top:${oy - R}px`; knob.style.transform = '';
    } else if (lookId === null) { lookId = e.pointerId; lx = e.clientX; ly = e.clientY; }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId === moveId) {
      let dx = e.clientX - ox, dy = e.clientY - oy; const d = Math.hypot(dx, dy);
      if (d > R) { dx *= R / d; dy *= R / d; }
      joy.x = dx / R; joy.y = -dy / R; knob.style.transform = `translate(${dx}px,${dy}px)`;
    } else if (e.pointerId === lookId) {
      euler.setFromQuaternion(camera.quaternion);
      euler.y -= (e.clientX - lx) * 0.005;
      euler.x = Math.max(-1.45, Math.min(1.45, euler.x - (e.clientY - ly) * 0.005));
      camera.quaternion.setFromEuler(euler); lx = e.clientX; ly = e.clientY;
    }
  });
  const up = (e) => {
    if (e.pointerId === moveId) { moveId = null; joy.x = joy.y = 0; stick.style.display = 'none'; }
    if (e.pointerId === lookId) lookId = null;
  };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  const btn = document.getElementById('modeBtn'); btn.style.display = 'block';
  btn.addEventListener('click', () => {
    if (walking) { setMode(false); controls.target.copy(camera.position).add(camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(2)); }
    else setMode(true);
    btn.textContent = walking ? 'Огляд' : 'Ходити';
  });
  btn.textContent = 'Огляд';
}

const fwd = new THREE.Vector3(), side = new THREE.Vector3(), move = new THREE.Vector3(), dirs = [];
function blocked(pos, dir) {                      // true if a wall/furniture is within RADIUS along dir
  ray.set(new THREE.Vector3(pos.x, floorY + 0.5, pos.z), dir); ray.near = 0; ray.far = RADIUS;
  return ray.intersectObjects(solids, false).length > 0;
}

// ---- VR locomotion: left thumbstick walks (relative to where the headset looks),
// right thumbstick turns the rig smoothly. Eye height itself comes from the headset's own
// local-floor tracking, so we only move the rig along the floor plane. ----
const VR_SPEED = 0.8;                             // m/s at full stick — slow, calm walking pace
const VR_TURN = THREE.MathUtils.degToRad(45);     // max turn speed, rad/s (smooth turn instead of 45° snaps)
const DEAD = 0.2, EASE = 5;                       // stick dead-zone; how fast speed eases in/out (1/s)
const vrFwd = new THREE.Vector3(), vrSide = new THREE.Vector3(), vrMove = new THREE.Vector3();
const vrVel = new THREE.Vector3(), headPos = new THREE.Vector3();
let vrYawRate = 0;
function axesOf(gp) {                              // 'xr-standard' gamepads report the thumbstick on axes[2],[3]
  return gp.axes.length >= 4 ? [gp.axes[2], gp.axes[3]] : [gp.axes[0], gp.axes[1]];
}
const curve = (v) => Math.abs(v) < DEAD ? 0 : Math.sign(v) * ((Math.abs(v) - DEAD) / (1 - DEAD)) ** 2;   // gentle near centre
function updateXR(dt) {
  if (!room) return;
  const session = renderer.xr.getSession();
  vrMove.set(0, 0, 0); let turn = 0;
  for (const src of session.inputSources) {
    if (!src.gamepad || !src.handedness) continue;
    const [ax, ay] = axesOf(src.gamepad);
    if (src.handedness === 'left') {
      camera.getWorldDirection(vrFwd); vrFwd.y = 0; vrFwd.normalize();
      vrSide.crossVectors(vrFwd, camera.up).normalize();
      vrMove.addScaledVector(vrFwd, -curve(ay)).addScaledVector(vrSide, curve(ax));
      if (vrMove.lengthSq() > 1) vrMove.normalize();
      vrMove.multiplyScalar(VR_SPEED);
    } else if (src.handedness === 'right') {
      turn = -curve(ax) * VR_TURN;
    }
  }
  const k = 1 - Math.exp(-EASE * dt);              // ease velocity and turn rate toward the stick, no jerks
  vrVel.lerp(vrMove, k); vrYawRate += (turn - vrYawRate) * k;
  for (const axis of ['x', 'z']) {
    const step = new THREE.Vector3(); step[axis] = vrVel[axis] * dt;
    if (Math.abs(step[axis]) > 1e-6 && !blocked(rig.position, step.clone().normalize())) rig.position[axis] += step[axis];
  }
  if (Math.abs(vrYawRate) > 1e-4) {                // turn around the head, not the rig origin, so the view doesn't swing
    camera.getWorldPosition(headPos);
    const a = vrYawRate * dt, dx = rig.position.x - headPos.x, dz = rig.position.z - headPos.z;
    const c = Math.cos(a), s = Math.sin(a);
    rig.position.x = headPos.x + dx * c + dz * s;
    rig.position.z = headPos.z - dx * s + dz * c;
    rig.rotation.y += a;
  }
  ray.set(new THREE.Vector3(rig.position.x, rig.position.y + 5, rig.position.z), new THREE.Vector3(0, -1, 0));
  ray.near = 0; ray.far = 10;
  const hit = ray.intersectObjects(floors, false)[0];
  if (hit) rig.position.y = hit.point.y;
}

function placeRig() {                               // put the VR "feet" where the walk camera stands, facing the same way
  rig.position.set(camera.position.x, 0, camera.position.z);
  ray.set(new THREE.Vector3(rig.position.x, camera.position.y + 5, rig.position.z), new THREE.Vector3(0, -1, 0));
  ray.near = 0; ray.far = 10;
  const hit = ray.intersectObjects(floors, false)[0];
  rig.position.y = hit ? hit.point.y : 0;
  rig.rotation.y = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ').y;
}
renderer.xr.addEventListener('sessionstart', () => {
  if (walking && walk.isLocked) walk.unlock();
  hint.style.display = 'none';
  document.getElementById('modeBtn').style.display = 'none';
  if (room) placeRig();                              // otherwise done once the room finishes loading
});
renderer.xr.addEventListener('sessionend', () => {
  hint.style.display = '';
  if (isTouch && !vrCapable) document.getElementById('modeBtn').style.display = 'block';
  rig.position.set(0, 0, 0); rig.rotation.set(0, 0, 0);
});
function updateWalk(dt) {
  if (!room || !(walk.isLocked || isTouch)) return;
  const f = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0) + joy.y;
  const r = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0) + joy.x;
  if (f || r) {
    camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
    side.crossVectors(fwd, camera.up).normalize();
    move.set(0, 0, 0).addScaledVector(fwd, f).addScaledVector(side, r);
    move.multiplyScalar(1 / Math.max(1, move.length()))          // keep analog speed, cap diagonals at 1
        .multiplyScalar((keys.ShiftLeft || keys.ShiftRight ? RUN : SPEED) * dt);
    for (const axis of ['x', 'z']) {              // slide along walls: test each axis separately
      const step = new THREE.Vector3(); step[axis] = move[axis];
      if (step[axis] !== 0 && !blocked(camera.position, step.clone().normalize())) camera.position[axis] += step[axis];
    }
  }
  ray.set(new THREE.Vector3(camera.position.x, camera.position.y, camera.position.z), new THREE.Vector3(0, -1, 0));
  ray.near = 0; ray.far = EYE + 1;
  const hit = ray.intersectObjects(floors, false)[0];
  if (hit) floorY = hit.point.y;
  camera.position.y = floorY + EYE;
}

function resize() {
  rotated = isTouch && !vrCapable && innerHeight > innerWidth;
  W = rotated ? innerHeight : innerWidth; H = rotated ? innerWidth : innerHeight;
  app.style.width = W + 'px'; app.style.height = H + 'px';
  app.style.transform = rotated ? `translateX(${innerWidth}px) rotate(90deg)` : '';
  renderer.setSize(W, H, false);
  camera.aspect = W / H;
  applyFov();
}
function applyFov() {
  const a = camera.aspect, hMin = 75 * Math.PI / 180;
  camera.fov = a >= 1 ? baseFov : Math.max(baseFov, 2 * Math.atan(Math.tan(hMin / 2) / a) * 180 / Math.PI);
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();
vrReady.then(resize);

const pct = document.getElementById('pct'), barFill = document.querySelector('#bar i');
const base = import.meta.env.BASE_URL;
const ASSET_VER = '3';                           // bump when room.glb / camera.json change, so browsers don't keep a cached copy

const camPromise = fetch(base + 'camera.json?v=' + ASSET_VER).then(r => r.json()).catch(() => null);

new GLTFLoader().load(base + 'room.glb?v=' + ASSET_VER, async (gltf) => {
  const camInfo = await camPromise;
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const old = o.material;
    // baked texture lives in emissiveMap -> plain unlit material, exact colours
    const map = old.emissiveMap || old.map;
    const isFilm = old.name.startsWith('Glass_web');
    if (isFilm) {                                // frosted film (window glass, wardrobe doors): static milky see-through
      o.material = new THREE.MeshBasicMaterial({
        color: o.name === 'Wardrobe_film' ? 0xf4f1ea : 0xcfe6ee, transparent: true,
        opacity: o.name === 'Wardrobe_film' ? 0.4 : 0.12, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,   // no z-fighting with the frame behind
      });
      o.renderOrder = 1; old.dispose();
    } else if (o.name === 'Openings002') {      // window sill/frame: flat white, pulled forward so it can't flicker against neighbours
      o.material = new THREE.MeshBasicMaterial({
        color: 0xf2efe9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      });
      old.dispose();
    } else if (map) {
      map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = renderer.capabilities.getMaxAnisotropy();
      o.material = new THREE.MeshBasicMaterial({ map, side: THREE.FrontSide, toneMapped: false });
      old.dispose();
    } else {                                     // flat baked colour (thin window-frame bars etc.)
      o.material = new THREE.MeshBasicMaterial({ color: old.emissive.clone(), toneMapped: false });
      old.dispose();
    }
  });
  scene.add(gltf.scene); room = gltf.scene;
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    if (/^Floor/.test(o.name)) floors.push(o);
    else if (/^(Wall|Openings)/.test(o.name)) solids.push(o);
  });

  const box = new THREE.Box3().setFromObject(gltf.scene);
  const center = box.getCenter(new THREE.Vector3());
  if (camInfo) {                                 // start where the Blender camera is (Z-up -> Y-up)
    const [x, y, z] = camInfo.camera.loc;
    camera.position.set(x, z, -y);
    const q = camInfo.camera.quat;               // w,x,y,z in Blender space
    const zUpToYUp = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    const qb = zUpToYUp.multiply(new THREE.Quaternion(q[1], q[2], q[3], q[0]));
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(qb);
    controls.target.copy(camera.position).add(fwd.multiplyScalar(2));
    baseFov = camInfo.camera.fov || 60; applyFov();
  } else {
    camera.position.set(center.x, center.y, center.z + 3); controls.target.copy(center);
  }
  controls.update();
  // start walking from the Blender camera spot, looking the same way, at eye height
  ray.set(camera.position.clone(), new THREE.Vector3(0, -1, 0)); ray.near = 0; ray.far = 10;
  const fh = ray.intersectObjects(floors, false)[0];
  floorY = fh ? fh.point.y : box.min.y; camera.position.y = floorY + EYE;
  camera.lookAt(camera.position.x + (controls.target.x - camera.position.x), camera.position.y, camera.position.z + (controls.target.z - camera.position.z));
  setMode(true);
  if (renderer.xr.isPresenting) placeRig();          // entered VR while the room was still loading
  document.getElementById('loader').classList.add('done');
}, (e) => {
  if (e.total) { const p = Math.round(e.loaded / e.total * 100); pct.textContent = `Завантаження… ${p}%`; barFill.style.width = p + '%'; }
}, (err) => { pct.textContent = 'Не вдалося завантажити сцену'; console.error(err); });

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (renderer.xr.isPresenting) updateXR(dt);
  else if (walking) updateWalk(dt);
  else controls.update();
  renderer.render(scene, camera);
});
