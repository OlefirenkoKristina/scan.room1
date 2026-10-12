import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const loadingEl = document.getElementById('loading');
const overlayEl = document.getElementById('overlay');
const hudEl = document.getElementById('hud');
const crosshairEl = document.getElementById('crosshair');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x202024);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 100);
camera.position.set(0, 1.6, 2.5);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.75;
document.body.appendChild(renderer.domElement);

const pmremGenerator = new THREE.PMREMGenerator(renderer);
const envTexture = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environment = envTexture;
scene.environmentIntensity = 0.4;

scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 0.45));
const sun = new THREE.DirectionalLight(0xfff2e0, 1.1);
sun.position.set(2, 4, 1.5);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
scene.add(sun);
const fill = new THREE.PointLight(0xffe9c7, 0.35, 10);
fill.position.set(-1, 2, -1);
scene.add(fill);

const collidables = [];
let floorY = 0;
let roomBox = new THREE.Box3();

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://unpkg.com/three@0.169.0/examples/jsm/libs/draco/');

const loader = new GLTFLoader();
loader.setDRACOLoader(dracoLoader);
const NON_COLLIDABLE = new Set(['Outside_Backdrop']);

loader.load('room.glb', (gltf) => {
  const model = gltf.scene;
  model.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = !NON_COLLIDABLE.has(obj.name);
      obj.receiveShadow = true;
      if (!NON_COLLIDABLE.has(obj.name)) {
        collidables.push(obj);
      }
    }
  });
  scene.add(model);
  model.updateMatrixWorld(true);

  roomBox.makeEmpty();
  const meshBox = new THREE.Box3();
  for (const mesh of collidables) {
    meshBox.setFromObject(mesh);
    roomBox.union(meshBox);
  }
  floorY = roomBox.min.y;
  camera.position.set(
    (roomBox.min.x + roomBox.max.x) / 2,
    floorY + EYE_HEIGHT,
    (roomBox.min.z + roomBox.max.z) * 0.25
  );

  loadingEl.style.display = 'none';
  overlayEl.style.display = 'flex';
}, undefined, (err) => {
  loadingEl.textContent = 'Помилка завантаження моделі: ' + err.message;
  console.error(err);
});

const EYE_HEIGHT = 1.65;
const RADIUS = 0.28;
const WALK_SPEED = 2.2;
const RUN_SPEED = 4.2;

const controls = new PointerLockControls(camera, renderer.domElement);
scene.add(controls.getObject());

overlayEl.addEventListener('click', () => controls.lock());
controls.addEventListener('lock', () => {
  overlayEl.style.display = 'none';
  hudEl.style.display = 'block';
  crosshairEl.style.display = 'block';
});
controls.addEventListener('unlock', () => {
  overlayEl.style.display = 'flex';
  hudEl.style.display = 'none';
  crosshairEl.style.display = 'none';
});

const move = { forward: false, back: false, left: false, right: false, run: false, up: false, down: false };

document.addEventListener('keydown', (e) => {
  switch (e.code) {
    case 'KeyW': case 'ArrowUp': move.forward = true; break;
    case 'KeyS': case 'ArrowDown': move.back = true; break;
    case 'KeyA': case 'ArrowLeft': move.left = true; break;
    case 'KeyD': case 'ArrowRight': move.right = true; break;
    case 'ShiftLeft': case 'ShiftRight': move.run = true; break;
    case 'Space': move.up = true; break;
    case 'KeyC': move.down = true; break;
  }
});
document.addEventListener('keyup', (e) => {
  switch (e.code) {
    case 'KeyW': case 'ArrowUp': move.forward = false; break;
    case 'KeyS': case 'ArrowDown': move.back = false; break;
    case 'KeyA': case 'ArrowLeft': move.left = false; break;
    case 'KeyD': case 'ArrowRight': move.right = false; break;
    case 'ShiftLeft': case 'ShiftRight': move.run = false; break;
    case 'Space': move.up = false; break;
    case 'KeyC': move.down = false; break;
  }
});

const raycaster = new THREE.Raycaster();
const forwardDir = new THREE.Vector3();
const rightDir = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

function tryMove(deltaVec) {
  if (deltaVec.lengthSq() === 0) return;
  const dist = deltaVec.length();
  const dir = deltaVec.clone().normalize();
  const origin = controls.getObject().position.clone();

  raycaster.set(origin, dir);
  raycaster.far = dist + RADIUS;
  const hits = collidables.length ? raycaster.intersectObjects(collidables, false) : [];
  if (hits.length > 0 && hits[0].distance < dist + RADIUS) {
    return; // blocked
  }
  controls.getObject().position.add(deltaVec);
}

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);

  if (controls.isLocked) {
    const speed = (move.run ? RUN_SPEED : WALK_SPEED) * dt;

    camera.getWorldDirection(forwardDir);
    forwardDir.y = 0;
    forwardDir.normalize();
    rightDir.crossVectors(forwardDir, UP).normalize();

    const delta = new THREE.Vector3();
    if (move.forward) delta.add(forwardDir);
    if (move.back) delta.sub(forwardDir);
    if (move.right) delta.add(rightDir);
    if (move.left) delta.sub(rightDir);

    if (delta.lengthSq() > 0) {
      delta.normalize().multiplyScalar(speed);
      // move along each axis separately so sliding along walls works
      tryMove(new THREE.Vector3(delta.x, 0, 0));
      tryMove(new THREE.Vector3(0, 0, delta.z));
    }

    const obj = controls.getObject();
    if (move.up) obj.position.y = Math.min(obj.position.y + 1.2 * dt, floorY + 2.1);
    if (move.down) obj.position.y = Math.max(obj.position.y - 1.2 * dt, floorY + 0.6);

    // keep within loose room bounds as a safety net
    if (roomBox.isEmpty() === false) {
      const margin = 0.05;
      obj.position.x = THREE.MathUtils.clamp(obj.position.x, roomBox.min.x + margin, roomBox.max.x - margin);
      obj.position.z = THREE.MathUtils.clamp(obj.position.z, roomBox.min.z + margin, roomBox.max.z - margin);
      if (!move.up && !move.down) obj.position.y = floorY + EYE_HEIGHT;
    }
  }

  renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
