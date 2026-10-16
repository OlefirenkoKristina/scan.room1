import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// A hand gripping the controller. WebXR gives no finger tracking while you hold controllers,
// but Quest controllers report which buttons your fingers touch / press (capacitive sensors),
// so the fingers are posed from that every frame, like Meta's own "hands on controllers":
//   index  — off the trigger: pointing; touching: resting on it; pulling: curled by trigger value
//   middle/ring/pinky — curl with the grip (squeeze) button
//   thumb  — lifted when it touches nothing; on top when touching stick / A·B / thumbrest; pressed down on a click
// The generic WebXR hand mesh has flat joint bones, so poses are simple forward kinematics.
// The hand is lined up with grip space: -Z along the fist (out of the index side), +Y toward the wrist.
const HAND_URL = 'https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@1.0/dist/profiles/generic-hand/';

// Angles in degrees, for the left hand (the right is mirrored).
// p/i/d = knuckle / middle / end joint bends, s = sideways swing of the index toward the trigger,
// tl = thumb lift onto the top face, tm/tp/td = thumb joint bends.
export const POSES = {
  // fitted so the finger pads land on the real Touch Plus trigger / thumbstick / buttons
  index: { point: { s: 75, p: 10, i: 0, d: 0 }, rest: { s: 75, p: 20, i: 20, d: 45 }, pull: { s: 65, p: 25, i: 30, d: 20 } },
  grip: { open: { p: 45, i: 40, d: 20 }, closed: { p: 90, i: 85, d: 35 } },
  thumb: {
    up: { tl: -55, tm: -100, tp: 70, td: 70 },    // touching nothing: hovering ~1.5 cm over the stick
    stick: { tl: -30, tm: -80, tp: 60, td: 70 },
    a: { tl: -30, tm: -80, tp: 90, td: 80 },      // A / X (the button nearer the hand)
    b: { tl: -30, tm: -60, tp: 60, td: 70 },      // B / Y, also used for the thumbrest
    pressDrop: 8,                                  // degrees the thumb sinks when a button / the stick is clicked
  },
  knuckle: [-0.036, -0.028, 0.03],               // middle-finger knuckle in (left) grip space
  // natural-hand touches: outer fingers curl a bit more (cascade), fingers fan out when relaxed
  // and close up when gripping (spread, deg, open -> closed), and a faint idle sway (deg)
  cascade: { middle: 1, ring: 1.06, pinky: 1.12 },
  spread: { index: [6, 0], middle: [0, 0], ring: [-6, -2], pinky: [-14, -5] },
  sway: 1.8,
};

const loader = new GLTFLoader();
const V = () => new THREE.Vector3();
const lerpPose = (a, b, t) => Object.fromEntries(Object.keys(a).map((k) => [k, a[k] + (b[k] - a[k]) * t]));

// Quest-style "ghost" hand: see-through grey body, bright rim at the silhouette, fading out
// toward the wrist. Works for both the held hand and the live tracked hand mesh.
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

const SEGS = ['phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip'];
const THUMB = ['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip'];

export function createHeldHand(side) {
  const mirror = side === 'right' ? -1 : 1;
  const holder = new THREE.Group();
  // smoothed finger state, 0..1: index touch / index pull / grip / thumb weights per spot / thumb press
  const st = { it: 1, ip: 0, g: 1, up: 0, stick: 0, a: 0, b: 1, tp: 0 };
  let apply = null, time = Math.random() * 10;
  const phase = { index: 0, middle: 1.7, ring: 3.1, pinky: 4.4, thumb: 2.3 };
  holder.userData.update = (gamepad, dt) => {
    if (!apply) return;
    const b = gamepad?.buttons || [];
    const touched = (i) => !!(b[i] && (b[i].touched || b[i].pressed));
    const target = {
      it: touched(0) ? 1 : 0,
      ip: b[0]?.value || 0,
      g: b[1] ? Math.max(b[1].value, b[1].touched ? 0.15 : 0) : 1,
      up: 0, stick: 0, a: 0, b: 0,
      tp: [3, 4, 5].some((i) => b[i]?.pressed) ? 1 : 0,
    };
    // xr-standard: 3 thumbstick, 4 A/X, 5 B/Y, 6 thumbrest
    target[touched(3) ? 'stick' : touched(4) ? 'a' : (touched(5) || touched(6)) ? 'b' : 'up'] = 1;
    const k = 1 - Math.exp(-14 * dt);              // quick but not jumpy
    for (const key in st) st[key] += (target[key] - st[key]) * k;
    time += dt;
    apply(st);
  };

  loader.load(HAND_URL + side + '.glb', (gltf) => {
    const hand = gltf.scene;
    const bone = {};
    hand.traverse((o) => { if (o.isBone) bone[o.name] = o; });
    const rest = Object.fromEntries(Object.entries(bone).map(([n, o]) => [n, [o.position.clone(), o.quaternion.clone()]]));
    const P = (n) => bone[n].position;

    // fixed hand axes, from the rest pose
    const a = P('middle-finger-phalanx-proximal').clone().sub(P('wrist'));
    const c = P('pinky-finger-phalanx-proximal').clone().sub(P('index-finger-phalanx-proximal'));
    const n = V().crossVectors(a, c).normalize();  // palm normal
    if (n.dot(P('thumb-tip').clone().sub(P('middle-finger-metacarpal'))) < 0) n.negate();
    const along = c.clone().negate().normalize();  // pinky -> index
    const bendAxis = {};
    for (const f of ['index', 'middle', 'ring', 'pinky']) {
      bendAxis[f] = V().crossVectors(P(`${f}-finger-phalanx-intermediate`).clone().sub(P(`${f}-finger-phalanx-proximal`)).normalize(), n).normalize();
    }
    const thumbAxis = () => V().crossVectors(P(THUMB[1]).clone().sub(P(THUMB[0])).normalize(), n).normalize();

    const q = new THREE.Quaternion();
    const rot = (names, k, axis, deg) => {         // bend joint k of a chain, carrying every joint after it along
      if (!deg) return;
      const pivot = P(names[k]).clone();
      q.setFromAxisAngle(axis, THREE.MathUtils.degToRad(deg));
      for (let j = k; j < names.length; j++) {
        const o = bone[names[j]];
        if (j > k) o.position.sub(pivot).applyQuaternion(q).add(pivot);
        o.quaternion.premultiply(q);
      }
    };
    const swing = new THREE.Quaternion(), axis = V();
    const finger = (f, pose) => {
      const names = SEGS.map((s) => `${f}-finger-${s}`);
      const sw = (pose.s || 0) * mirror;           // swing within the palm plane (toward the index side)
      rot(names, 0, n, sw);
      axis.copy(bendAxis[f]).applyQuaternion(swing.setFromAxisAngle(n, THREE.MathUtils.degToRad(sw)));
      rot(names, 0, axis, pose.p); rot(names, 1, axis, pose.i); rot(names, 2, axis, pose.d);
    };

    apply = (s) => {
      for (const nme in rest) { bone[nme].position.copy(rest[nme][0]); bone[nme].quaternion.copy(rest[nme][1]); }
      const I = POSES.index, G = POSES.grip, T = POSES.thumb;
      // idle sway: slow, out of phase per finger, fading out as the finger is clamped down
      const sway = (f, amount) => POSES.sway * amount * Math.sin(time * 1.1 + phase[f]);
      const fan = (f, closed) => POSES.spread[f][0] + (POSES.spread[f][1] - POSES.spread[f][0]) * closed;
      const ip = lerpPose(lerpPose(I.point, I.rest, s.it), I.pull, s.ip), iw = sway('index', 1 - 0.7 * s.ip);
      finger('index', { ...ip, s: ip.s + fan('index', s.it), p: ip.p + iw, i: ip.i + iw * 0.7 });
      const g = lerpPose(G.open, G.closed, s.g);
      for (const f of ['middle', 'ring', 'pinky']) {
        const c = POSES.cascade[f], w = sway(f, 1 - 0.75 * s.g);
        finger(f, { s: fan(f, s.g), p: g.p * c + w, i: g.i * c + w * 0.7, d: g.d * c + w * 0.4 });
      }
      const w = s.up + s.stick + s.a + s.b || 1, t = { tl: 0, tm: 0, tp: 0, td: 0 };
      for (const spot of ['up', 'stick', 'a', 'b']) for (const key in t) t[key] += T[spot][key] * s[spot] / w;
      t.tl += T.pressDrop * s.tp + sway('thumb', s.up) * 1.5;
      rot(THUMB, 0, along, t.tl * mirror);         // lift the whole thumb onto the controller's top face
      const ta = thumbAxis();
      rot(THUMB, 0, ta, t.tm); rot(THUMB, 1, ta, t.tp); rot(THUMB, 2, ta, t.td);
    };

    // line the hand up with grip space (knuckle positions don't depend on the finger pose)
    const X = mirror > 0 ? n.clone() : n.clone().negate();   // palm faces the body's midline
    const Z = along.clone().negate();
    X.sub(Z.clone().multiplyScalar(X.dot(Z))).normalize();
    const Y = V().crossVectors(Z, X);
    const k = POSES.knuckle;
    hand.matrixAutoUpdate = false;
    hand.matrix.makeBasis(X, Y, Z).setPosition(P('middle-finger-phalanx-proximal')).invert()
      .premultiply(new THREE.Matrix4().makeTranslation(k[0] * mirror, k[1], k[2]));
    hand.traverse((o) => { if (o.isSkinnedMesh) makeGhost(o); });
    apply(st);
    holder.add(hand);
  });
  return holder;
}
