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
    hand.traverse((o) => {
      if (!o.isMesh) return;
      o.frustumCulled = false;                     // skinned bounds don't follow the curled bones
      o.material = new THREE.MeshStandardMaterial({ color: 0xd9b49c, roughness: 0.75 });
    });
    holder.add(hand);
  });
  return holder;
}
