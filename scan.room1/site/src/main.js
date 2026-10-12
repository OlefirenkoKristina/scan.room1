import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const canvas = document.createElement('canvas');
document.body.prepend(canvas);

// Lighting is baked into the textures in Blender (AgX look included),
// so no tone mapping / real-time lights: what you see is what Blender rendered.
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14110f);
const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 100);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.95;

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

const pct = document.getElementById('pct'), barFill = document.querySelector('#bar i');
const base = import.meta.env.BASE_URL;

const camPromise = fetch(base + 'camera.json').then(r => r.json()).catch(() => null);

new GLTFLoader().load(base + 'room.glb', async (gltf) => {
  const camInfo = await camPromise;
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const old = o.material;
    // baked texture lives in emissiveMap -> plain unlit material, exact colours
    const map = old.emissiveMap || old.map;
    if (map && old.name !== 'Glass_web') {
      map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = renderer.capabilities.getMaxAnisotropy();
      o.material = new THREE.MeshBasicMaterial({ map, side: THREE.FrontSide, toneMapped: false });
      old.dispose();
    } else if (old.name === 'Glass_web') {
      o.material = new THREE.MeshBasicMaterial({ color: 0xcfe6ee, transparent: true, opacity: 0.12, depthWrite: false });
    } else {                                     // flat baked colour (thin window-frame bars etc.)
      o.material = new THREE.MeshBasicMaterial({ color: old.emissive.clone(), toneMapped: false });
      old.dispose();
    }
  });
  scene.add(gltf.scene);

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
    camera.fov = camInfo.camera.fov || 60; camera.updateProjectionMatrix();
  } else {
    camera.position.set(center.x, center.y, center.z + 3); controls.target.copy(center);
  }
  controls.update();
  document.getElementById('loader').classList.add('done');
}, (e) => {
  if (e.total) { const p = Math.round(e.loaded / e.total * 100); pct.textContent = `Завантаження… ${p}%`; barFill.style.width = p + '%'; }
}, (err) => { pct.textContent = 'Не вдалося завантажити сцену'; console.error(err); });

renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
