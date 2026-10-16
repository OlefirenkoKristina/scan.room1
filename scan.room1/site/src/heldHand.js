import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// A static hand gripping the controller. WebXR gives no hand pose while you hold
// controllers, so we take the generic WebXR hand mesh, curl it into a fist with simple
// forward kinematics on its (flat) joint bones, and line the fist up with the grip space:
// grip -Z runs along the fist (out of the index-finger side), +Y toward the wrist.
const HAND_URL = 'https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@1.0/dist/profiles/generic-hand/';
// curl angles (deg) per joint, tl = thumb lift onto the top face; `knuckle` = where the
// middle-finger knuckle sits in (left) grip space. Values are for the left hand; the right is mirrored.
export const GRIP_POSE = { p: 90, i: 85, d: 35, tl: -55, tm: -20, tp: 0, td: 30, knuckle: [-0.036, -0.028, 0.03] };

const loader = new GLTFLoader();
const V = () => new THREE.Vector3();

// Quest-style "ghost" hand: see-through grey body, bright rim at the silhouette, fading out
// toward the wrist. Works for both the static held hand and the live tracked hand mesh.
export function makeGhost(mesh) {
  const uniforms = { uWrist: { value: V() }, uDir: { value: new THREE.Vector3(0, 1, 0) } };
  const mat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: true });   // depthWrite: only the front layer shows, no overlapping fingers
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = 'varying vec3 vGhostN, vGhostV, vGhostW;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      vGhostN = normalize(normalMatrix * objectNormal);
      vGhostV = -mvPosition.xyz;
      vGhostW = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    sh.fragmentShader = 'uniform vec3 uWrist, uDir;\nvarying vec3 vGhostN, vGhostV, vGhostW;\n' + sh.fragmentShader.replace('#include <dithering_fragment>', `
      float rim = pow(1.0 - clamp(abs(dot(normalize(vGhostN), normalize(vGhostV))), 0.0, 1.0), 2.0);
      float fade = smoothstep(0.0, 0.055, dot(vGhostW - uWrist, uDir));
      gl_FragColor = vec4(mix(vec3(0.62, 0.66, 0.72), vec3(1.0), rim), (0.22 + 0.68 * rim) * fade);`);
  };
  mesh.material = mat;
  mesh.frustumCulled = false;                      // skinned bounds don't follow the bones
  mesh.renderOrder = 3;
  const wrist = mesh.skeleton.getBoneByName('wrist'), knuckle = mesh.skeleton.getBoneByName('middle-finger-phalanx-proximal');
  const k = V();
  mesh.onBeforeRender = () => {                    // fade axis follows the hand: wrist -> middle knuckle
    wrist.getWorldPosition(uniforms.uWrist.value);
    uniforms.uDir.value.copy(knuckle.getWorldPosition(k)).sub(uniforms.uWrist.value).normalize();
  };
}

function curl(root, pose) {                       // returns the palm normal (rest pose, armature space)
  const P = (n) => root.getObjectByName(n).position;
  const a = P('middle-finger-phalanx-proximal').clone().sub(P('wrist'));
  const b = P('pinky-finger-phalanx-proximal').clone().sub(P('index-finger-phalanx-proximal'));
  const n = V().crossVectors(a, b).normalize();
  if (n.dot(P('thumb-tip').clone().sub(P('middle-finger-metacarpal'))) < 0) n.negate();
  const chain = (names, angles, fixedAxis) => {    // bend joint k, carrying every joint after it along
    const axis = fixedAxis || V().crossVectors(P(names[1]).clone().sub(P(names[0])).normalize(), n).normalize();
    angles.forEach((deg, k) => {
      const pivot = P(names[k]).clone(), q = new THREE.Quaternion().setFromAxisAngle(axis, THREE.MathUtils.degToRad(deg));
      for (let j = k; j < names.length; j++) {
        const o = root.getObjectByName(names[j]);
        if (j > k) o.position.sub(pivot).applyQuaternion(q).add(pivot);
        o.quaternion.premultiply(q);
      }
    });
  };
  for (const f of ['index', 'middle', 'ring', 'pinky']) {
    chain(['phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip'].map((s) => `${f}-finger-${s}`), [pose.p, pose.i, pose.d]);
  }
  const thumb = ['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip'];
  const along = P('index-finger-phalanx-proximal').clone().sub(P('pinky-finger-phalanx-proximal')).normalize();
  chain(thumb, [pose.tl], along);                  // lift the whole thumb up onto the controller's top face
  chain(thumb, [pose.tm, pose.tp, pose.td]);
  return n;
}

export function createHeldHand(side, pose = GRIP_POSE) {
  if (side === 'right') pose = { ...pose, tl: -pose.tl, knuckle: [-pose.knuckle[0], pose.knuckle[1], pose.knuckle[2]] };
  const holder = new THREE.Group();
  loader.load(HAND_URL + side + '.glb', (gltf) => {
    const hand = gltf.scene;
    const P = (n) => hand.getObjectByName(n).position.clone();
    const n = curl(hand, pose);
    const Z = P('pinky-finger-phalanx-proximal').sub(P('index-finger-phalanx-proximal')).normalize();
    const X = side === 'left' ? n.clone() : n.clone().negate();   // palm faces the body's midline
    X.sub(Z.clone().multiplyScalar(X.dot(Z))).normalize();
    const Y = V().crossVectors(Z, X);
    const toGrip = new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(P('middle-finger-phalanx-proximal')).invert()
      .premultiply(new THREE.Matrix4().makeTranslation(...pose.knuckle));
    hand.matrixAutoUpdate = false; hand.matrix.copy(toGrip);
    hand.traverse((o) => { if (o.isSkinnedMesh) makeGhost(o); });
    holder.add(hand);
  });
  return holder;
}
