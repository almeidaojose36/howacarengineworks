// Twin-Turbo V8 teardown — procedural, physically based, deterministic renderer.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const P = new URLSearchParams(location.search);
const W = +(P.get('w') || 1920), H = +(P.get('h') || 1080);
const TL = await (await fetch('./timeline.json')).json();
const LINES = TL.lines;

// ---------------------------------------------------------------- utils
const D2R = Math.PI / 180;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const ease = t => { t = clamp(t); return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
const lerp = (a, b, t) => a + (b - a) * t;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const lineById = Object.fromEntries(LINES.map(l => [l.id, l]));
function wt(id, w) { const l = lineById[id]; if (!l) return 1e9; const x = l.words.find(q => q[0].toLowerCase().replace(/[^a-z0-9]/g, '').startsWith(w)); return x ? x[1] : l.start; }

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(1); renderer.setSize(W, H);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.82;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.localClippingEnabled = true;
document.body.appendChild(renderer.domElement);
const overlay = document.createElement('canvas'); overlay.width = W; overlay.height = H; document.body.appendChild(overlay);
const ctx = overlay.getContext('2d');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07080a);
scene.fog = new THREE.Fog(0x07080a, 26, 70);
const pmrem = new THREE.PMREMGenerator(renderer);
const envTex = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
scene.environment = envTex;
const camera = new THREE.PerspectiveCamera(35, W / H, 0.05, 400);

// lights: dark studio, key softbox + cool rim + warm kicker
const hemi = new THREE.HemisphereLight(0x9fb4c8, 0x0a0806, 0.25); scene.add(hemi);
const key = new THREE.DirectionalLight(0xfff1e0, 2.2); key.position.set(9, 16, 12); key.castShadow = true;
key.shadow.mapSize.set(1024, 1024); Object.assign(key.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 60 }); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
scene.add(key);
const rim = new THREE.DirectionalLight(0x8fb8ff, 2.2); rim.position.set(-12, 8, -14); scene.add(rim);
const kick = new THREE.PointLight(0xffa860, 30, 30, 2); kick.position.set(-8, 1, 6); scene.add(kick);
const glowLight = new THREE.PointLight(0xff5a1a, 0, 14, 2); scene.add(glowLight);

// floor
const floorMat = new THREE.MeshStandardMaterial({ color: 0x0c0d0f, roughness: 0.8, metalness: 0.0, envMapIntensity: 0.12 });
const floor = new THREE.Mesh(new THREE.CircleGeometry(80, 96), floorMat); floor.rotation.x = -Math.PI / 2; floor.position.y = -3.05; floor.receiveShadow = true; scene.add(floor);

// ---------------------------------------------------------------- procedural textures
function noiseCanvas(size, fn) { const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d'); const id = g.createImageData(size, size); for (let i = 0; i < size * size; i++) { const v = fn(i % size, (i / size) | 0); id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255; } g.putImageData(id, 0, 0); return c; }
function vnoise(scale) { const N = 64, gr = []; for (let i = 0; i < N * N; i++) gr.push(rnd()); return (x, y) => { x /= scale; y /= scale; const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi; const g = (a, b) => gr[((a % N + N) % N) + ((b % N + N) % N) * N]; const s = t => t * t * (3 - 2 * t); return lerp(lerp(g(xi, yi), g(xi + 1, yi), s(xf)), lerp(g(xi, yi + 1), g(xi + 1, yi + 1), s(xf)), s(yf)); }; }
const n1 = vnoise(24), n2 = vnoise(6);
const castTex = new THREE.CanvasTexture(noiseCanvas(256, (x, y) => 120 + 70 * n1(x, y) + 50 * (n2(x, y) - .5) + 30 * (rnd() - .5)));
castTex.wrapS = castTex.wrapT = THREE.RepeatWrapping; castTex.repeat.set(3, 3);
const brushTex = new THREE.CanvasTexture(noiseCanvas(256, (x, y) => 140 + 60 * (Math.sin(y * 0.9 + n2(x * .1, y) * 4) * .5) + 40 * (rnd() - .5)));
brushTex.wrapS = brushTex.wrapT = THREE.RepeatWrapping;
const finTex = new THREE.CanvasTexture(noiseCanvas(256, (x, y) => (x % 8 < 2 ? 40 : 200)));
finTex.wrapS = finTex.wrapT = THREE.RepeatWrapping; finTex.repeat.set(30, 1);

// ---------------------------------------------------------------- materials
const M = {
  cast: new THREE.MeshPhysicalMaterial({ color: 0xb9bcc0, metalness: 0.85, roughness: 0.48, roughnessMap: castTex, bumpMap: castTex, bumpScale: 0.6, transparent: true, clearcoat: 0.0 }),
  castDark: new THREE.MeshStandardMaterial({ color: 0x8c9096, metalness: 0.85, roughness: 0.55, roughnessMap: castTex, bumpMap: castTex, bumpScale: 0.5, transparent: true }),
  steel: new THREE.MeshStandardMaterial({ color: 0xc8cacd, metalness: 1, roughness: 0.22, roughnessMap: brushTex }),
  forged: new THREE.MeshStandardMaterial({ color: 0x8a8d92, metalness: 1, roughness: 0.32, roughnessMap: castTex }),
  polish: new THREE.MeshStandardMaterial({ color: 0xe6e8ea, metalness: 1, roughness: 0.08 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x1b1c1f, metalness: 0.5, roughness: 0.6 }),
  rubber: new THREE.MeshPhysicalMaterial({ color: 0x141416, metalness: 0, roughness: 0.75, clearcoat: 0.3, clearcoatRoughness: 0.6, transparent: true }),
  hot: new THREE.MeshStandardMaterial({ color: 0x5a4a40, metalness: 0.9, roughness: 0.45, roughnessMap: castTex, emissive: 0xff4a10, emissiveIntensity: 0, transparent: true }),
  turbineHousing: new THREE.MeshStandardMaterial({ color: 0x4a4744, metalness: 0.8, roughness: 0.6, roughnessMap: castTex, bumpMap: castTex, bumpScale: 0.8, emissive: 0xff4a10, emissiveIntensity: 0, transparent: true }),
  inconel: new THREE.MeshStandardMaterial({ color: 0x8a7f74, metalness: 1, roughness: 0.3, emissive: 0xff5010, emissiveIntensity: 0 }),
  fin: new THREE.MeshStandardMaterial({ color: 0x9a9ea3, metalness: 0.9, roughness: 0.4, roughnessMap: finTex, bumpMap: finTex, bumpScale: 2, transparent: true }),
  copper: new THREE.MeshStandardMaterial({ color: 0xb87333, metalness: 1, roughness: 0.3 }),
  ceramic: new THREE.MeshPhysicalMaterial({ color: 0xeeeae4, metalness: 0, roughness: 0.3, clearcoat: 1 }),
  cut: new THREE.MeshStandardMaterial({ color: 0x8a2016, metalness: 0.2, roughness: 0.62, roughnessMap: castTex, bumpMap: castTex, bumpScale: 0.3 }),
  honed: new THREE.MeshStandardMaterial({ color: 0xa5a9ae, metalness: 1, roughness: 0.18, roughnessMap: brushTex, side: THREE.DoubleSide }),
  oil: new THREE.MeshPhysicalMaterial({ color: 0xc98a00, metalness: 0, roughness: 0.04, transparent: true, opacity: 0.0, emissive: 0x8a5200, emissiveIntensity: 0.35, clearcoat: 1, depthWrite: false }),
};
for (const m of Object.values(M)) m.envMapIntensity = 0.55;
M.honed.envMapIntensity = 0.35;

// ---------------------------------------------------------------- geometry helpers
const g = {
  cyl: (r1, r2, h, s = 32) => new THREE.CylinderGeometry(r1, r2, h, s),
  box: (x, y, z) => new THREE.BoxGeometry(x, y, z),
};
function rbox(w, h, d, r = 0.08) { // rounded box via extruded rounded rect
  const s = new THREE.Shape(); const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h); s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  const geo = new THREE.ExtrudeGeometry(s, { depth: d - 2 * r * 0.6, bevelEnabled: true, bevelThickness: r * 0.6, bevelSize: r * 0.6, bevelSegments: 3, curveSegments: 6 });
  geo.translate(0, 0, -(d - 2 * r * 0.6) / 2); geo.computeVertexNormals(); return geo;
}
function mesh(geo, mat, parent, pos, rot) { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; if (pos) m.position.copy(pos); if (rot) m.rotation.set(rot[0], rot[1], rot[2]); if (parent) parent.add(m); return m; }
function tube(points, r, mat, parent, seg = 80) { const c = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.5); const m = mesh(new THREE.TubeGeometry(c, seg, r, 24, false), mat, parent); m.userData.curve = c; return m; }
function bolts(parent, pts, r = 0.06) { const geo = new THREE.CylinderGeometry(r, r, r * 1.2, 6); for (const p of pts) { const b = mesh(geo, M.steel, parent, p.pos); if (p.rot) b.rotation.set(...p.rot); } }

// ---------------------------------------------------------------- ENGINE
const E = new THREE.Group(); scene.add(E);
const R = 0.45, LROD = 1.55, BORE = 0.46; // crank radius, rod length, bore radius
const THROWZ = [1.65, 0.55, -0.55, -1.65];
const THROWOFF = [0, 90, 270, 180].map(a => a * D2R); // cross-plane
const BANKS = [-1, 1];
const DECK = R + LROD + 0.42;
const anchors = {}; const anchor = (name, obj, off = V(0, 0, 0)) => { const o = new THREE.Object3D(); o.position.copy(off); obj.add(o); anchors[name] = o; return o; };

// --- crankshaft
const crank = new THREE.Group(); E.add(crank);
{
  const mainG = g.cyl(0.28, 0.28, 0.32); mainG.rotateX(Math.PI / 2);
  const pinG = g.cyl(0.22, 0.22, 0.62); pinG.rotateX(Math.PI / 2);
  for (let i = 0; i <= 4; i++) mesh(mainG, M.polish, crank, V(0, 0, 2.2 - i * 1.1));
  const web = new THREE.Shape(); web.absarc(0, 0, 0.62, Math.PI * 1.08, Math.PI * 1.92, false); web.lineTo(0.2, R + 0.18); web.absarc(0, R, 0.3, 0, Math.PI, false); web.lineTo(-0.2, R + 0.18); web.closePath();
  const webG = new THREE.ExtrudeGeometry(web, { depth: 0.14, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 2, curveSegments: 24 });
  webG.translate(0, 0, -0.07);
  THROWZ.forEach((z, i) => {
    const th = new THREE.Group(); th.rotation.z = THROWOFF[i]; crank.add(th);
    mesh(pinG, M.polish, th, V(0, R, z));
    mesh(webG, M.forged, th, V(0, 0, z + 0.38)); mesh(webG, M.forged, th, V(0, 0, z - 0.38));
    anchor('crank' + i, th, V(0, 0, z));
  });
  // nose + flange
  const noseG = g.cyl(0.18, 0.18, 0.6); noseG.rotateX(Math.PI / 2); mesh(noseG, M.steel, crank, V(0, 0, 2.6));
  const damper = g.cyl(0.75, 0.75, 0.25, 64); damper.rotateX(Math.PI / 2); mesh(damper, M.forged, crank, V(0, 0, 2.85)); for (let k = 0; k < 4; k++) mesh(new THREE.TorusGeometry(0.76, 0.012, 6, 64), M.dark, crank, V(0, 0, 2.76 + k * 0.06));
  const fw = new THREE.Group(); crank.add(fw); fw.position.z = -2.55;
  const fwG = g.cyl(1.45, 1.45, 0.16, 96); fwG.rotateX(Math.PI / 2); mesh(fwG, M.steel, fw);
  const ringG = new THREE.TorusGeometry(1.5, 0.06, 6, 140); mesh(ringG, M.forged, fw);
  for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; mesh(g.cyl(0.07, 0.07, 0.2, 8).rotateX(Math.PI / 2), M.dark, fw, V(Math.cos(a) * 1.1, Math.sin(a) * 1.1, 0.05)); }
  anchor('crank', crank, V(0, 0, 0.6));
}

// --- banks: pistons, rods, liners, heads, cams, valves
const bankObjs = [];
const pistons = []; // {b, i, z, group, rod, phaseFire}
const pistonG = (() => {
  const parts = [];
  const crown = g.cyl(BORE - 0.01, BORE - 0.01, 0.62, 40); crown.translate(0, 0.0, 0); parts.push(crown);
  return mergeGeometries(parts);
})();
const ringGeo = new THREE.TorusGeometry(BORE - 0.008, 0.012, 6, 48); ringGeo.rotateX(Math.PI / 2);
const rodGeo = (() => { const s = new THREE.Shape(); s.moveTo(-0.11, 0); s.lineTo(-0.07, LROD); s.lineTo(0.07, LROD); s.lineTo(0.11, 0); s.closePath(); const e = new THREE.ExtrudeGeometry(s, { depth: 0.1, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 2 }); e.translate(0, 0, -0.05); return e; })();
const bigEndG = g.cyl(0.29, 0.29, 0.16, 32); bigEndG.rotateX(Math.PI / 2);
const smallEndG = g.cyl(0.14, 0.14, 0.16, 24); smallEndG.rotateX(Math.PI / 2);
const valveGeo = (() => { const pts = [V(0, 0, 0), V(0.17, 0, 0), V(0.17, 0.03, 0), V(0.05, 0.12, 0), V(0.035, 0.22, 0), V(0.035, 0.95, 0), V(0, 0.95, 0)].map(p => new THREE.Vector2(p.x, p.y)); return new THREE.LatheGeometry(pts, 28); })();
const springGeo = (() => { const pts = []; for (let i = 0; i <= 200; i++) { const a = i / 200 * Math.PI * 2 * 7; pts.push(V(Math.cos(a) * 0.1, i / 200 * 0.42, Math.sin(a) * 0.1)); } return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 400, 0.018, 6); })();
const lobeShape = (() => { const s = new THREE.Shape(); const n = 48; for (let i = 0; i <= n; i++) { const a = i / n * Math.PI * 2; const lift = Math.pow(Math.max(0, Math.cos(a)), 3) * 0.12; const r = 0.17 + lift; const x = Math.sin(a) * r, y = -Math.cos(a) * r; i ? s.lineTo(x, y) : s.moveTo(x, y); } const e = new THREE.ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: false, curveSegments: 4 }); e.translate(0, 0, -0.06); return e; })();
const valvesAll = [];
const camsAll = [];
BANKS.forEach((b, bi) => {
  const bank = new THREE.Group(); bank.rotation.z = -b * 45 * D2R; E.add(bank); bankObjs.push(bank);
  const out = b; // local +x*out = outboard
  // block half (X-ray-able)
  const blk = mesh(rbox(1.5, DECK - 0.4, 4.7, 0.1), M.cast, bank, V(0, 0.4 + (DECK - 0.4) / 2, 0)); blk.userData.xray = true;
  // ribs
  for (let i = 0; i < 5; i++) mesh(g.box(0.08, DECK - 0.7, 0.12), M.cast, bank, V(out * 0.78, 0.6 + (DECK - 0.7) / 2, 2.2 - i * 1.1)).userData.xray = true;
  // head
  const headH = 1.0;
  const head = mesh(rbox(1.62, headH, 4.8, 0.08), M.castDark, bank, V(0, DECK + headH / 2, 0)); head.userData.xray = true;
  anchor('head' + bi, bank, V(out * 0.82, DECK + 0.5, 0.6));
  // cam cover with ribs (lifts off later)
  const cover = new THREE.Group(); bank.add(cover); cover.position.y = DECK + headH; cover.userData.isCover = true;
  mesh(rbox(1.5, 0.42, 4.75, 0.16), M.dark, cover, V(0, 0.2, 0)).userData.cover = true;
  for (let i = 0; i < 6; i++) mesh(g.box(1.2, 0.05, 0.08), M.steel, cover, V(0, 0.43, 1.9 - i * 0.76));
  // coil packs
  for (let i = 0; i < 4; i++) mesh(rbox(0.28, 0.2, 0.36, 0.05), M.dark, cover, V(-out * 0.0, 0.5, THROWZ[i] - b * 0.25));
  // cams
  for (const side of [-1, 1]) { // -1 inboard intake, +1 outboard exhaust
    const cam = new THREE.Group(); cam.position.set(out * side * 0.33, DECK + headH - 0.05, 0); bank.add(cam);
    const shaft = g.cyl(0.08, 0.08, 4.7, 16); shaft.rotateX(Math.PI / 2); mesh(shaft, M.steel, cam);
    const sprocket = g.cyl(0.42, 0.42, 0.08, 40); sprocket.rotateX(Math.PI / 2); mesh(sprocket, M.forged, cam, V(0, 0, 2.45));
    camsAll.push({ cam, b, side, lobes: [] });
    anchor(`cam${bi}${side}`, cam, V(0, 0, 0.2));
  }
  // cylinders
  THROWZ.forEach((tz, i) => {
    const z = tz - b * 0.25;
    const liner = mesh(new THREE.CylinderGeometry(BORE + 0.04, BORE + 0.04, DECK - 0.9, 40, 1, true), M.castDark, bank, V(0, 0.9 + (DECK - 0.9) / 2, z)); liner.userData.xray = true;
    const pg = new THREE.Group(); bank.add(pg);
    const pm = mesh(pistonG, M.forged, pg, V(0, 0.0, 0)); pm.material = M.steel;
    for (let k = 0; k < 3; k++) mesh(ringGeo, M.dark, pg, V(0, 0.22 - k * 0.07, 0));
    const pin = g.cyl(0.08, 0.08, 0.7, 16); pin.rotateZ(Math.PI / 2); mesh(pin, M.polish, pg, V(0, -0.12, 0));
    const rod = new THREE.Group(); bank.add(rod);
    mesh(rodGeo, M.forged, rod); mesh(bigEndG, M.forged, rod); mesh(smallEndG, M.forged, rod, V(0, LROD, 0));
    const fire = mesh(new THREE.SphereGeometry(BORE * 0.95, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff7a20, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }), bank, V(0, DECK - 0.05, z));
    fire.scale.y = 0.45; fire.castShadow = false;
    const pistObj = { b, bi, i, z, pg, rod, fire, off: THROWOFF[i] };
    pistons.push(pistObj);
    if (bi === 0 && i === 0) anchor('piston', pg, V(0, 0.3, 0));
    if (bi === 0 && i === 0) anchor('valves', bank, V(0, DECK + 0.55, z));
    // valves: 2 intake (inboard), 2 exhaust (outboard)
    for (const side of [-1, 1]) for (const dz of [-0.17, 0.17]) {
      const vg = new THREE.Group(); bank.add(vg);
      const tilt = side * out * 0.18;
      vg.position.set(out * side * 0.2, DECK - 0.02, z + dz); vg.rotation.z = -tilt;
      mesh(valveGeo, M.inconel, vg).scale.set(0.8, 1, 0.8);
      const sp = mesh(springGeo, M.steel, vg, V(0, 0.5, 0)); sp.userData.spring = true;
      valvesAll.push({ vg, b, bi, i, side, base: vg.position.clone(), tilt, spring: sp, pist: pistObj });
    }
    // injector + plug (top of head)
    mesh(g.cyl(0.04, 0.05, 0.6, 12), M.steel, bank, V(-out * 0.48, DECK + 0.42, z), [0, 0, out * 0.6]);
  });
});
// lobes on cams (one per cylinder)
for (const c of camsAll) {
  const bi = BANKS.indexOf(c.b);
  THROWZ.forEach((tz, i) => { const z = tz - c.b * 0.25; for (const dz of [-0.17, 0.17]) { const lb = mesh(lobeShape, M.polish, c.cam, V(0, 0, z + dz)); c.lobes.push({ lb, i }); } });
}

// firing phase: each cylinder's firing TDC crank angle
{
  const tdcs = pistons.map(p => { let a = (-p.b * 45 * D2R - p.off) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a; });
  const used = {};
  pistons.forEach((p, k) => { const slot = Math.round(tdcs[k] / (Math.PI / 2)) % 4; p.fireA = tdcs[k] + (used[slot] ? 2 * Math.PI : 0); used[slot] = 1; });
}

const ANC0 = E.children.length;
// --- valley cover / intake plenum + runners
const intake = new THREE.Group(); E.add(intake);
{
  const pl = mesh(rbox(1.3, 0.75, 4.2, 0.25), M.cast, intake, V(0, 4.15, 0)); pl.userData.xray = true;
  anchor('intakeManifold', intake, V(0, 4.55, 0.4));
  for (const b of BANKS) THROWZ.forEach((tz, i) => {
    const z = tz - b * 0.25;
    const s = V(b * 0.4, 3.9, z), e = V(b * 1.15, 3.55, z), m = V(b * 0.85, 4.0, z);
    const t = tube([s, m, e], 0.14, M.cast, intake, 20); t.userData.xray = true;
  });
  // throttle body
  const tb = g.cyl(0.32, 0.32, 0.4, 32); tb.rotateX(Math.PI / 2); mesh(tb, M.polish, intake, V(0, 4.15, 2.25));
}
// --- intercoolers on top
const icGroup = new THREE.Group(); E.add(icGroup);
const ics = [];
for (const b of BANKS) {
  const ic = new THREE.Group(); ic.position.set(b * 1.05, 5.05, -0.1); icGroup.add(ic);
  const core = mesh(rbox(0.85, 0.55, 3.6, 0.06), M.fin, ic); core.userData.xray = true;
  const tankG = rbox(0.95, 0.68, 0.45, 0.18);
  mesh(tankG, M.cast, ic, V(0, 0, 1.95)).userData.xray = true; mesh(tankG, M.cast, ic, V(0, 0, -1.95)).userData.xray = true;
  for (let k = 0; k < 3; k++) mesh(g.box(0.98, 0.04, 0.05), M.dark, ic, V(0, 0.29, 1.2 - k * 1.2));
  ics.push(ic);
}
anchor('intercooler', icGroup, V(1.05, 5.35, -1.0));

// --- turbochargers
function bladeWheel(n, r, h, twist, mat, splitter) {
  const grp = new THREE.Group();
  const hub = new THREE.LatheGeometry([V(0.0, -h / 2), V(r * 0.45, -h / 2), V(r * 0.38, 0), V(r * 0.22, h / 2), V(0, h / 2)].map(p => new THREE.Vector2(p.x, p.y)), 32);
  mesh(hub, mat, grp);
  const mk = (len) => { const geo = new THREE.BoxGeometry(r * len, h * 0.95, 0.025, 8, 8, 1); const pos = geo.attributes.position; for (let k = 0; k < pos.count; k++) { const x = pos.getX(k) + r * len / 2 + r * (1 - len) * 0.25, y = pos.getY(k), z = pos.getZ(k); const a = twist * (y / h) * (1 - x / r * 0.3); const sweep = Math.pow(x / r, 2) * 0.6; const ny = y * (1 - 0.35 * (x / r)); pos.setXYZ(k, x, ny, z * Math.cos(a) + sweep * 0.2 + x * Math.sin(a) * 0.15); } geo.computeVertexNormals(); return geo; };
  const bg = mk(0.78), sg = mk(0.55);
  for (let k = 0; k < n; k++) { const bl = mesh(bg, mat, grp); bl.rotation.y = k / n * Math.PI * 2; if (splitter) { const s2 = mesh(sg, mat, grp); s2.rotation.y = (k + .5) / n * Math.PI * 2; } }
  return grp;
}
const turbos = []; const compMat = new THREE.MeshStandardMaterial({ color: 0xc4c7cb, metalness: 0.9, roughness: 0.35, roughnessMap: castTex, transparent: true });
for (const b of BANKS) {
  const T = new THREE.Group(); T.position.set(b * 3.15, -0.2, 1.0); E.add(T);
  // axis along z: compressor at +z (front), turbine at -z
  const axis = new THREE.Group(); axis.rotation.x = Math.PI / 2; T.add(axis); // local y -> world z
  const shaftR = new THREE.Group(); axis.add(shaftR);
  mesh(g.cyl(0.05, 0.05, 1.6, 12), M.polish, shaftR);
  const tw = bladeWheel(11, 0.5, 0.36, 0.9, M.inconel, false); tw.position.y = -0.55; tw.rotation.x = Math.PI; shaftR.add(tw);
  const cw = bladeWheel(7, 0.55, 0.42, -1.1, new THREE.MeshStandardMaterial({ color: 0xd6d9dc, metalness: 1, roughness: 0.15 }), true); cw.position.y = 0.6; shaftR.add(cw);
  // center housing (oil-fed)
  mesh(g.cyl(0.32, 0.32, 0.55, 32), M.forged, axis);
  // turbine housing: volute (cut-open on visible side)
  const vol = (rad0, rad1, tubeR0, tubeR1, mat, y, cutA) => { const pts = []; for (let k = 0; k <= 60; k++) { const a = k / 60 * (Math.PI * 2 - cutA); const rr = lerp(rad0, rad1, k / 60); pts.push(V(Math.cos(a) * rr, y, Math.sin(a) * rr)); } const c = new THREE.CatmullRomCurve3(pts); const geo = new THREE.TubeGeometry(c, 80, 1, 20, false); const pos = geo.attributes.position; const cp = c.getSpacedPoints(80); for (let k = 0; k < pos.count; k++) { const seg = Math.min(80, Math.floor(k / 21)); const center = cp[seg]; const tr = lerp(tubeR0, tubeR1, seg / 80); const v = V(pos.getX(k), pos.getY(k), pos.getZ(k)); const d = v.sub(center); pos.setXYZ(k, center.x + d.x * tr, center.y + d.y * tr, center.z + d.z * tr); } geo.computeVertexNormals(); const m = mesh(geo, mat, axis); m.material = mat; return m; };
  const th = vol(0.62, 0.85, 0.12, 0.3, M.turbineHousing, -0.55, 0.9); th.userData.hotShell = true;
  const ch = vol(0.68, 0.9, 0.1, 0.28, compMat, 0.6, 0.9);
  // compressor inlet bell (cut away = open ring)
  mesh(new THREE.TorusGeometry(0.48, 0.07, 12, 48).rotateX(Math.PI / 2), M.polish, axis, V(0, 0.95, 0));
  mesh(new THREE.CylinderGeometry(0.48, 0.56, 0.4, 40, 1, true), compMat, axis, V(0, 0.8, 0));
  // outlet downpipe
  const dp = tube([V(b * 3.15, -0.2, 0.2), V(b * 3.25, -0.6, -0.4), V(b * 3.1, -1.6, -1.4), V(b * 2.8, -2.2, -3.4), V(b * 2.6, -2.3, -6)], 0.26, M.hot, E, 60);
  dp.material = M.hot.clone(); turbos.push({ T, shaftR, tw, cw, b, th, dp });
  anchor('turbo' + (b < 0 ? 'L' : 'R'), T, V(0, 0, 0)); anchor('turbine' + (b < 0 ? 'L' : 'R'), T, V(0, 0, -0.55)); anchor('compressor' + (b < 0 ? 'L' : 'R'), T, V(0, 0, 0.6));
}
anchor('exhaustOutlet', E, V(-2.75, -2.25, -4.6));

// --- exhaust manifolds (glowing)
const exManifolds = [], exCurves = [];
for (const b of BANKS) {
  const grp = new THREE.Group(); E.add(grp);
  const col = []; const colX = b * 2.5, colY = 1.0;
  const bankRot = -b * 45 * D2R;
  const toWorld = (lx, ly, lz) => V(lx * Math.cos(bankRot) - ly * Math.sin(bankRot), lx * Math.sin(bankRot) + ly * Math.cos(bankRot), lz);
  THROWZ.forEach((tz, i) => {
    const z = tz - b * 0.25;
    const port = toWorld(b * 0.85, DECK + 0.45, z);
    const pts = [port, port.clone().add(V(b * 0.35, -0.25, 0)), V(colX, colY + 0.1, z * 0.85), V(colX + b * 0.15, 0.6, lerp(z, 1.0, 0.6))];
    const t = tube(pts, 0.13, M.hot, grp, 30); exCurves.push({ curve: t.userData.curve, b, i });
  });
  // collector into turbine inlet
  const coll = tube([V(colX, colY, -1.9), V(colX, colY, 0), V(b * 2.7, 0.4, 0.6), V(b * 3.15, 0.2, 0.45)], 0.2, M.hot, grp, 40);
  exManifolds.push(grp);
  anchor('exhaustManifold' + (b < 0 ? 'L' : 'R'), grp, V(colX, colY + 0.2, -0.4));
}

// --- charge air hoses (compressor outlet -> up -> intercooler front tank)
const chargeCurves = [], filters = [];
for (const b of BANKS) {
  const pts = [V(b * 3.15, 0.75, 1.6), V(b * 3.25, 2.4, 2.3), V(b * 2.6, 4.6, 2.9), V(b * 1.4, 5.4, 2.7), V(b * 1.05, 5.15, 2.2)];
  const h = tube(pts, 0.24, M.rubber, E, 60); h.userData.hose = true;
  // clamps
  for (const u of [0.05, 0.95]) { const p = h.userData.curve.getPointAt(u), tg = h.userData.curve.getTangentAt(u); const c = mesh(new THREE.TorusGeometry(0.26, 0.035, 8, 32), M.steel, E, p); c.lookAt(p.clone().add(tg)); }
  chargeCurves.push(h.userData.curve);
  // intake filter inlet in front of compressor
  const fl = new THREE.Group(); fl.position.set(b * 3.15, -0.2, 2.45); E.add(fl); filters.push(fl);
  mesh(g.cyl(0.5, 0.42, 0.7, 64).rotateX(Math.PI / 2), M.fin, fl); mesh(g.cyl(0.52, 0.52, 0.06, 48).rotateX(Math.PI / 2), M.polish, fl, V(0, 0, 0.36)); mesh(g.cyl(0.3, 0.3, 0.07, 32).rotateX(Math.PI / 2), M.steel, fl, V(0, 0, 0.38));
}
anchor('chargeHose', E, V(2.6, 4.6, 2.9));

const ANC1 = E.children.length;
// --- oil pan
const pan = new THREE.Group(); E.add(pan);
{
  const p = mesh(rbox(3.0, 1.2, 4.6, 0.2), M.castDark, pan, V(0, -1.45, 0)); p.userData.xray = true;
  for (let i = 0; i < 9; i++) mesh(g.box(0.06, 0.5, 4.3), M.castDark, pan, V(-1.2 + i * 0.3, -2.1, 0)).userData.xray = true;
  const oil = mesh(rbox(2.7, 0.5, 4.3, 0.18), M.oil, pan, V(0, -1.75, 0)); oil.castShadow = false;
  anchor('oilPan', pan, V(1.2, -1.6, 1.5));
}
// lower block / girdle
mesh(rbox(2.4, 0.9, 4.7, 0.15), M.cast, E, V(0, -0.35, 0)).userData.xray = true;
// timing cover + belt
mesh(rbox(3.6, 3.8, 0.25, 0.2), M.castDark, E, V(0, 2.1, 2.55)).userData.xray = true;

// --- transmission
const trans = new THREE.Group(); E.add(trans);
const gears = [];
{
  const bell = new THREE.LatheGeometry([V(1.75, 0), V(1.8, 0.4), V(1.5, 1.6), V(1.0, 2.2), V(0.9, 2.3)].map(p => new THREE.Vector2(p.x, p.y)), 64);
  bell.rotateX(-Math.PI / 2); const bm = mesh(bell, M.cast, trans, V(0, 0, -2.7)); bm.userData.xray = true; bm.material = M.cast;
  const body = g.cyl(1.0, 0.85, 3.6, 48); body.rotateX(Math.PI / 2); const bd = mesh(body, M.cast, trans, V(0, -0.1, -6.6)); bd.userData.xray = true;
  for (let i = 0; i < 9; i++) { const rib = new THREE.TorusGeometry(lerp(1.0, 0.86, i / 8) + 0.02, 0.05, 8, 48); const r = mesh(rib, M.cast, trans, V(0, -0.1, -4.9 - i * 0.4)); r.userData.xray = true; }
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; mesh(g.box(0.08, 0.12, 3.4), M.cast, trans, V(Math.cos(a) * 0.98, -0.1 + Math.sin(a) * 0.98, -6.6), [0, 0, a]).userData.xray = true; }
  const out = g.cyl(0.18, 0.18, 1.2, 16); out.rotateX(Math.PI / 2); const outM = mesh(out, M.polish, trans, V(0, -0.1, -8.9));
  const flange = g.cyl(0.4, 0.4, 0.12, 24); flange.rotateX(Math.PI / 2); mesh(flange, M.forged, trans, V(0, -0.1, -9.5));
  // internal gears (visible in x-ray)
  const mkGear = (r, teeth) => { const s = new THREE.Shape(); for (let k = 0; k <= teeth * 2; k++) { const a = k / (teeth * 2) * Math.PI * 2; const rr = k % 2 ? r : r * 0.88; k ? s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); } const e = new THREE.ExtrudeGeometry(s, { depth: 0.18, bevelEnabled: false }); e.translate(0, 0, -0.09); return e; };
  const specs = [[0.55, 24, 0.3, -5.0], [0.35, 16, -0.45, -5.0], [0.45, 20, 0.3, -5.6], [0.45, 20, -0.48, -5.6], [0.35, 16, 0.3, -6.2], [0.55, 24, -0.55, -6.2], [0.3, 13, 0.3, -6.8], [0.6, 26, -0.6, -6.8]];
  for (const [r, n, y, z] of specs) { const gr = mesh(mkGear(r, n), M.steel, trans, V(0, -0.1 + y * 0.9, z)); gr.scale.setScalar(0.85); gears.push({ gr, dir: y > 0 ? 1 : -1, ratio: 0.55 / r }); }
  trans.userData.gearsVisible = 0;
  anchor('transmission', trans, V(0.9, 0.7, -6.4));
}
// engine mounts / stand (dark)
for (const s of [-1, 1]) mesh(rbox(0.3, 1.8, 0.3, 0.05), M.dark, E, V(s * 1.4, -2.15, -1.0));

const ANC = E.children.slice(ANC0, ANC1).map(o => { const b = new THREE.Box3().setFromObject(o); const c = b.getCenter(V(0,0,0)); const d = V(Math.sign(c.x) * 1.0, c.y > 3 ? 1.6 : -0.2, 0.35).normalize(); return { o, d, p0: o.position.clone() }; });
// collect xray meshes
const xrayMeshes = []; E.traverse(o => { if (o.isMesh && o.userData.xray) { o.material = o.material.clone(); o.material.userData.base = o.material.opacity; xrayMeshes.push(o); } });
// covers & hoses for teardown
const covers = []; E.traverse(o => { if (o.userData.isCover) covers.push(o); });

// ---------------------------------------------------------------- FLOW PARTICLES
const spriteTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,.75)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
function flowSystem(curves, color, count, size, speed, jitter) {
  const geo = new THREE.BufferGeometry(); const pos = new Float32Array(count * 3); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color, size, map: spriteTex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; scene.add(pts);
  const meta = []; for (let i = 0; i < count; i++) meta.push({ c: i % curves.length, ph: rnd(), j: V(rnd() - .5, rnd() - .5, rnd() - .5).multiplyScalar(jitter), sp: 0.7 + rnd() * 0.6 });
  const lens = curves.map(c => c.getLength());
  return { pts, mat, update(t, vis) { mat.opacity = vis; pts.visible = vis > 0.01; if (!pts.visible) return; for (let i = 0; i < count; i++) { const m = meta[i]; const c = curves[m.c]; const u = (m.ph + t * speed * m.sp / lens[m.c]) % 1; if (this.hide && this.hide(m.c)) { pos[i * 3 + 1] = -999; continue; } const p = c.getPointAt(u); pos[i * 3] = p.x + m.j.x; pos[i * 3 + 1] = p.y + m.j.y; pos[i * 3 + 2] = p.z + m.j.z; } geo.attributes.position.needsUpdate = true; } };
}
// AIR path: compressor -> hose -> IC -> plenum -> runners
const airCurves = [];
for (const [bi, b] of BANKS.entries()) THROWZ.forEach((tz, i) => {
  const z = tz - b * 0.25; const hp = chargeCurves[bi].getSpacedPoints(10);
  airCurves.push(new THREE.CatmullRomCurve3([V(b * 3.15, -0.2, 2.9), V(b * 3.15, -0.2, 1.7), ...hp, V(b * 1.05, 5.05, 1.4), V(b * 1.05, 5.05, -1.6), V(b * 0.4, 4.4, -1.8), V(0, 4.15, -0.8), V(0, 4.1, z), V(b * 0.6, 4.0, z), V(b * 1.15, 3.5, z)]));
});
// EXHAUST: manifold runners -> collector -> turbine -> downpipe
const exFlowCurves = exCurves.map(({ curve, b }) => { const pts = curve.getSpacedPoints(12); const T = turbos[b < 0 ? 0 : 1]; const dp = T.dp.userData.curve.getSpacedPoints(14); return new THREE.CatmullRomCurve3([...pts, V(b * 2.7, 0.4, 0.6), V(b * 3.15, 0.25, 0.4), V(b * 3.15, -0.2, 0.42), ...dp]); });
// OIL: pan -> pump -> galleries -> crank mains, up to cams, turbo feed lines
const oilCurves = [];
for (let k = 0; k < 5; k++) { const z = 2.2 - k * 1.1; oilCurves.push(new THREE.CatmullRomCurve3([V(0.3, -1.9, 2.0), V(0.6, -1.0, 2.3), V(0.9, -0.5, 1.2), V(0.9, -0.5, z), V(0.3, -0.3, z), V(0, 0, z)])); }
for (const b of BANKS) { const bankRot = -b * 45 * D2R; const tw = (lx, ly, lz) => V(lx * Math.cos(bankRot) - ly * Math.sin(bankRot), lx * Math.sin(bankRot) + ly * Math.cos(bankRot), lz); oilCurves.push(new THREE.CatmullRomCurve3([V(0.3, -1.9, 2.0), V(0.6, -1.0, 2.3), V(b * 0.9, -0.5, 1.8), tw(b * 0.7, 1.0, 1.8), tw(b * 0.7, DECK + 0.6, 1.9), tw(0, DECK + 0.95, 1.9), tw(0, DECK + 0.95, -2.0)])); }
for (const b of BANKS) oilCurves.push(new THREE.CatmullRomCurve3([V(0.3, -1.9, 2.0), V(0.6, -1.0, 2.3), V(b * 1.3, -0.6, 1.4), V(b * 2.3, -0.1, 1.0), V(b * 3.15, 0.35, 1.0), V(b * 3.15, 0.05, 1.0)]));
const oilTubes = oilCurves.map(c => { const m = mesh(new THREE.TubeGeometry(c, 60, 0.045, 8), new THREE.MeshStandardMaterial({ color: 0xf5b800, emissive: 0xf5a000, emissiveIntensity: 0.5, transparent: true, opacity: 0, roughness: 0.2, depthWrite: false }), scene); m.castShadow = false; return m; });
const FLOW = {
  air: flowSystem(airCurves, 0x2a9dff, 1600, 0.16, 3.2, 0.12),
  ex: flowSystem(exFlowCurves, 0xff4500, 1400, 0.2, 3.6, 0.1),
  oil: flowSystem(oilCurves, 0xffc21a, 900, 0.11, 1.6, 0.03),
};

// ---------------------------------------------------------------- SINGLE CYLINDER MACRO RIG (big, cutaway)
const C = new THREE.Group(); C.position.set(60, 0, 0); scene.add(C);
const CS = { bore: 1.0, R: 0.9, L: 2.6 };
const cyl = {};
{
  const deck = CS.R + CS.L + 0.42; cyl.deck = deck;
  // ---- block: back half bore + cut-section walls (museum cutaway: cut faces painted red)
  const backWall = new THREE.Mesh(new THREE.CylinderGeometry(CS.bore + 0.02, CS.bore + 0.02, deck - 1.4, 64, 1, true, Math.PI / 2, Math.PI), M.honed); backWall.position.set(0, 1.4 + (deck - 1.4) / 2, 0); C.add(backWall); backWall.receiveShadow = true;
  const ext = (pts, holes, depth, mats, yOff = 0) => { const s = new THREE.Shape(pts.map(p => new THREE.Vector2(p[0], p[1]))); for (const h of holes || []) s.holes.push(new THREE.Path(h.map(p => new THREE.Vector2(p[0], p[1])))); const geo = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 16 }); geo.translate(0, yOff, -depth); const m = mesh(geo, mats[1], C); m.material = mats; return m; };
  const curvePts = (a, c, b, n = 12) => { const out = []; for (let i = 0; i <= n; i++) { const t = i / n; out.push([(1 - t) * (1 - t) * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0], (1 - t) * (1 - t) * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1]]); } return out; };
  for (const sx of [-1, 1]) {
    const P = [[-1.95, -1.7], [-1.6, -1.7], [-1.6, 0.9], [-1.02, 1.4], [-1.02, deck], [-1.95, deck]].map(p => [p[0] * sx, p[1]]);
    if (sx > 0) P.reverse();
    const jacket = [[-1.62, 1.8], [-1.3, 1.8], [-1.3, deck - 0.3], [-1.62, deck - 0.3]].map(p => [p[0] * sx, p[1]]); if (sx > 0) jacket.reverse();
    ext(P, [jacket], 2.4, [M.cut, M.cast]);
  }
  // ---- head (local y from deck): three section pieces leave real port + chamber cavities
  const headH = 3.3; cyl.headH = headH;
  const roof = x => 0.45 * (1 - Math.abs(x)); // pent roof
  const inLow = curvePts([-0.78, roof(-0.78)], [-1.25, 0.32], [-1.95, 0.6]);
  const inUp = curvePts([-0.18, roof(-0.18)], [-0.9, 0.9], [-1.95, 1.3]);
  const A = [[-1.95, 0], [-1.0, 0], ...inLow.map(p => p), [-1.95, 0.6]];
  const exLow = inLow.map(p => [-p[0], p[1]]), exUp = inUp.map(p => [-p[0], p[1]]);
  const Cc = [[1.95, 0], [1.95, 0.6], ...exLow.slice().reverse(), [1.0, 0]];
  const B = [...inUp, [-1.95, 1.95], [1.95, 1.95], ...exUp.slice().reverse(), [0, 0.45]];
  for (const P of [A, B, Cc]) ext(P, [], 2.4, [M.cut, M.castDark], deck);
  for (const sx of [-1, 1]) { const T = [[-1.95, 1.95], [-1.55, 1.95], [-1.55, headH], [-1.95, headH]].map(p => [p[0] * sx, p[1]]); if (sx > 0) T.reverse(); ext(T, [], 2.4, [M.cut, M.castDark], deck); }
  // back wall of valvetrain cavity
  mesh(g.box(3.1, headH - 1.95, 0.1), M.castDark, C, V(0, deck + (1.95 + headH) / 2, -2.35));
  // intake runner + exhaust pipe (cut in half)
  const half = (curve, r, mat) => { const geo = new THREE.TubeGeometry(curve, 40, r, 24, false); const m = mesh(geo, mat, C); m.material = mat.clone(); m.material.side = THREE.DoubleSide; m.material.clippingPlanes = [new THREE.Plane(V(0, 0, -1), 0)]; return m; };
  half(new THREE.CatmullRomCurve3([V(-5.2, deck + 1.9, -0.4), V(-3.4, deck + 1.3, -0.4), V(-1.95, deck + 0.95, -0.4)]), 0.38, M.cast);
  const exh = half(new THREE.CatmullRomCurve3([V(1.95, deck + 0.95, -0.4), V(3.4, deck + 1.15, -0.4), V(5.2, deck + 1.0, -0.4)]), 0.38, M.hot); cyl.exhMat = exh.material;
  cyl.intakePath = new THREE.CatmullRomCurve3([V(-5.2, deck + 1.9, -0.3), V(-3.2, deck + 1.25, -0.3), V(-1.6, deck + 0.85, -0.3), V(-0.75, deck + 0.55, -0.3), V(-0.47, deck + 0.2, -0.3), V(-0.35, deck - 0.4, -0.4)]);
  cyl.exhaustPath = new THREE.CatmullRomCurve3([V(0.35, deck - 0.4, -0.4), V(0.47, deck + 0.2, -0.3), V(0.75, deck + 0.55, -0.3), V(1.6, deck + 0.85, -0.3), V(3.4, deck + 1.15, -0.3), V(5.2, deck + 1.0, -0.3)]);
  // valves (stem axis tilted outward), springs, buckets, cams — all in the section plane
  cyl.valves = []; cyl.cams = [];
  const TILT = 0.22, VS = 2.3;
  for (const dir of [-1, 1]) {
    const rz = -dir * TILT; const mouth = V(dir * 0.47, deck + roof(0.47) - 0.05, -0.15);
    const vg = new THREE.Group(); vg.position.copy(mouth); vg.rotation.z = rz; C.add(vg);
    const v = mesh(valveGeo, M.inconel, vg); v.scale.set(1.75, VS, 1.75);
    const stemTop = 0.95 * VS;
    const springBase = (1.95 - (mouth.y - deck)) / Math.cos(TILT);
    const sp = mesh(springGeo, M.steel, vg, V(0, springBase, 0)); sp.scale.set(2.2, (stemTop - springBase - 0.05) / 0.42, 2.2); sp.userData.h0 = (stemTop - springBase - 0.05) / 0.42;
    mesh(g.cyl(0.25, 0.2, 0.07, 24), M.polish, vg, V(0, stemTop - 0.05, 0));
    mesh(g.cyl(0.27, 0.27, 0.26, 32), M.polish, vg, V(0, stemTop + 0.1, 0));
    const camC = mouth.clone().add(V(-Math.sin(rz) * (stemTop + 0.23 + 0.37), Math.cos(rz) * (stemTop + 0.23 + 0.37), 0));
    // valve guide boss
    const cg = new THREE.Group(); cg.position.copy(camC); C.add(cg);
    const sh = g.cyl(0.15, 0.15, 2.4, 24); sh.rotateX(Math.PI / 2); mesh(sh, M.steel, cg, V(0, 0, -1.05));
    const lb = mesh(lobeShape, M.polish, cg, V(0, 0, -0.15)); lb.scale.set(2.2, 2.2, 3);
    cyl.valves.push({ vg, dir, sp, base: mouth.clone(), rz }); cyl.cams.push({ cg, dir, rz });
  }
  // cam carrier (back half, translucent dark)
  // injector & spark plug
  const inj = new THREE.Group(); inj.position.set(-0.98, deck + 0.04, 0.05); inj.rotation.z = 1.0; C.add(inj);
  mesh(g.cyl(0.07, 0.05, 1.2, 20), M.steel, inj, V(0, 0.6, 0)); mesh(g.cyl(0.16, 0.16, 0.5, 24), M.dark, inj, V(0, 1.4, 0));
  cyl.injTip = anchor('injector', inj, V(0, 0, 0));
  const plug = new THREE.Group(); plug.position.set(0, deck + 0.42, -0.05); C.add(plug);
  mesh(g.cyl(0.08, 0.08, 0.4, 16), M.ceramic, plug, V(0, 0.2, 0)); mesh(g.cyl(0.18, 0.18, 0.35, 6), M.steel, plug, V(0, 0.55, 0)); mesh(g.cyl(0.13, 0.13, 1.6, 20), M.ceramic, plug, V(0, 1.5, 0));
  mesh(g.cyl(0.02, 0.02, 0.1, 8), M.steel, plug, V(0, -0.02, 0));
  anchor('sparkPlug', plug, V(0, -0.05, 0));
  // piston, rod, crank throw
  cyl.piston = new THREE.Group(); C.add(cyl.piston);
  const pBody = new THREE.LatheGeometry([V(0, 0.35), V(0.6, 0.38), V(0.97, 0.36), V(0.98, 0.3), V(0.98, -0.85), V(0.9, -0.88)].map(p => new THREE.Vector2(p.x, p.y)), 64, Math.PI / 2, Math.PI);
  mesh(pBody, M.steel, cyl.piston);
  const pcut = new THREE.Shape(); pcut.moveTo(-0.98, 0.3); pcut.lineTo(-0.98, -0.85); pcut.lineTo(-0.8, -0.85); pcut.lineTo(-0.8, 0.12); pcut.lineTo(0.8, 0.12); pcut.lineTo(0.8, -0.85); pcut.lineTo(0.98, -0.85); pcut.lineTo(0.98, 0.3); pcut.quadraticCurveTo(0.6, 0.38, 0, 0.35); pcut.quadraticCurveTo(-0.6, 0.38, -0.98, 0.3);
  mesh(new THREE.ShapeGeometry(pcut), M.cut, cyl.piston, V(0, 0, 0.001));
  for (let k = 0; k < 3; k++) mesh(new THREE.CylinderGeometry(0.985, 0.985, 0.04, 64, 1, true, Math.PI / 2, Math.PI), M.dark, cyl.piston, V(0, 0.2 - k * 0.11, 0));
  mesh(g.cyl(0.18, 0.18, 1.6, 24).rotateZ(Math.PI / 2), M.polish, cyl.piston, V(0, -0.35, -0.0));
  anchor('cylPiston', cyl.piston, V(0.75, 0.2, 0));
  cyl.rod = new THREE.Group(); C.add(cyl.rod);
  const rs = new THREE.Shape(); rs.moveTo(-0.22, 0); rs.lineTo(-0.13, CS.L); rs.lineTo(0.13, CS.L); rs.lineTo(0.22, 0); rs.closePath();
  const rg = new THREE.ExtrudeGeometry(rs, { depth: 0.25, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05 }); rg.translate(0, 0, -0.125);
  mesh(rg, M.forged, cyl.rod); mesh(g.cyl(0.5, 0.5, 0.3, 40).rotateX(Math.PI / 2), M.forged, cyl.rod); mesh(g.cyl(0.28, 0.28, 0.3, 32).rotateX(Math.PI / 2), M.forged, cyl.rod, V(0, CS.L, 0));
  anchor('conRod', cyl.rod, V(0.2, CS.L * 0.5, 0));
  cyl.crank = new THREE.Group(); cyl.crank.position.set(0, 0, -0.1); C.add(cyl.crank);
  mesh(g.cyl(0.42, 0.42, 3.2, 40).rotateX(Math.PI / 2), M.polish, cyl.crank, V(0, 0, -0.4));
  const cw = new THREE.Shape(); cw.absarc(0, 0, 1.25, Math.PI * 1.1, Math.PI * 1.9, false); cw.lineTo(0.42, CS.R + 0.3); cw.absarc(0, CS.R, 0.55, 0, Math.PI, false); cw.closePath();
  const cwg = new THREE.ExtrudeGeometry(cw, { depth: 0.3, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, curveSegments: 32 });
  mesh(cwg, M.forged, cyl.crank, V(0, 0, 0.32)); mesh(cwg, M.forged, cyl.crank, V(0, 0, -0.62 - 0.3));
  mesh(g.cyl(0.4, 0.4, 0.7, 32).rotateX(Math.PI / 2), M.polish, cyl.crank, V(0, CS.R, 0));
  anchor('cylCrank', cyl.crank, V(0, -0.6, 0.5));
  anchor('cylHead', C, V(1.5, deck + 1.5, 0.02));
  anchor('cylCam', cyl.cams[1].cg, V(0, 0.2, 0.5));
  anchor('cylValve', cyl.valves[0].vg, V(0, 0.9, 0.1));
  anchor('cylValveEx', cyl.valves[1].vg, V(0, 0.9, 0.1));
  // gas volume
  cyl.gas = mesh(new THREE.CylinderGeometry(CS.bore - 0.01, CS.bore - 0.01, 1, 48, 1, false, Math.PI / 2, Math.PI), new THREE.MeshBasicMaterial({ color: 0x2a7fff, transparent: true, opacity: 0.0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }), C);
  cyl.gas.castShadow = false;
  cyl.flash = new THREE.PointLight(0xff8a30, 0, 10, 2); cyl.flash.position.set(0, deck - 0.3, 0.6); C.add(cyl.flash);
  // particles in macro rig
  const N = 900; const geo = new THREE.BufferGeometry(); cyl.pPos = new Float32Array(N * 3); cyl.pCol = new Float32Array(N * 3); geo.setAttribute('position', new THREE.BufferAttribute(cyl.pPos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(cyl.pCol, 3));
  cyl.pMeta = []; for (let i = 0; i < N; i++) cyl.pMeta.push({ r: Math.sqrt(rnd()) * 0.92, a: rnd() * Math.PI, h: rnd(), ph: rnd(), fuel: i < 260 });
  cyl.points = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.075, map: spriteTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  cyl.points.frustumCulled = false; C.add(cyl.points);
  // crankcase floor (dark)
  
  // stand-in light for macro rig
  const cl = new THREE.SpotLight(0xffffff, 120, 30, 0.6, 0.6); cl.position.set(4, 12, 10); cl.target.position.set(0, 3, 0); C.add(cl); C.add(cl.target); cl.castShadow = true; cl.shadow.mapSize.set(512, 512);
}
const cylParticleColors = { air: new THREE.Color(0x3aa0ff), hot: new THREE.Color(0xffd0a0), fuel: new THREE.Color(0xeaf6ff), fire: new THREE.Color(0xff6a10), exh: new THREE.Color(0x8a5a4a) };

// ---------------------------------------------------------------- ENGINE STATE UPDATE
function liftCurve(psi, open, close) { // psi deg 0..720; returns 0..1
  let x = ((psi - open) % 720 + 720) % 720; const dur = ((close - open) % 720 + 720) % 720; if (x > dur) return 0; return Math.pow(Math.sin(x / dur * Math.PI), 1.4);
}
const EX_OPEN = 140, EX_CLOSE = 370, IN_OPEN = 350, IN_CLOSE = 580;
function updateEngine(alpha, S) {
  crank.rotation.z = alpha;
  for (const p of pistons) {
    const a = alpha + p.off; const px = -R * Math.sin(a), py = R * Math.cos(a);
    const br = -p.b * 45 * D2R; // bank rotation; to local = rotate by -br
    const lx = px * Math.cos(-br) - py * Math.sin(-br), ly = px * Math.sin(-br) + py * Math.cos(-br);
    const s = ly + Math.sqrt(LROD * LROD - lx * lx);
    p.pg.position.set(0, s, p.z);
    p.rod.position.set(lx, ly, p.z); p.rod.rotation.z = Math.atan2(lx, s - ly) * 1; // rotate so +y points to piston pin
    p.rod.rotation.z = -Math.atan2(0 - lx, s - ly);
    // cycle phase
    let psi = ((alpha - p.fireA) / D2R) % 720; if (psi < 0) psi += 720; p.psi = psi;
    const f = psi < 70 ? Math.exp(-psi / 22) : 0; p.fire.material.opacity = f * S.fire; p.fire.position.y = s + 0.4; p.fire.scale.set(1, 0.3 + 0.5 * (1 - f), 1);
  }
  for (const v of valvesAll) {
    const lift = v.side * v.b < 0 || true ? (v.side < 0 ? liftCurve(v.pist.psi, IN_OPEN, IN_CLOSE) : liftCurve(v.pist.psi, EX_OPEN, EX_CLOSE)) : 0;
    const d = lift * 0.11; const dir = V(Math.sin(v.tilt), -Math.cos(v.tilt), 0);
    v.vg.position.copy(v.base).addScaledVector(dir, d); v.spring.scale.y = 1 - lift * 0.22; v.spring.position.y = 0.5 + 0;
  }
  for (const c of camsAll) { for (const { lb, i } of c.lobes) { const p = pistons.find(q => q.b === c.b && q.i === i); const mid = c.side < 0 ? (IN_OPEN + IN_CLOSE) / 2 : (EX_OPEN + EX_CLOSE) / 2; lb.rotation.z = ((p.psi - mid) / 2) * D2R * (c.b) + Math.PI; } }
  // flywheel / gears
  for (const gg of gears) gg.gr.rotation.z = alpha * gg.ratio * gg.dir * 0.6;
}

// ---------------------------------------------------------------- MACRO CYLINDER UPDATE
const roofY = x => 0.45 * (1 - Math.abs(x));
function updateCyl(psi, t, S) {
  // psi 0 = firing TDC
  const a = psi * D2R; // crank angle
  const px = -CS.R * Math.sin(a), py = CS.R * Math.cos(a);
  const s = py + Math.sqrt(CS.L * CS.L - px * px);
  cyl.crank.rotation.z = a;
  cyl.piston.position.set(0, s, 0);
  cyl.rod.position.set(px, py, 0.05); cyl.rod.rotation.z = Math.atan2(px, s - py);
  const crown = s + 0.36, top = cyl.deck + 0.02; const h = Math.max(0.05, top - crown);
  cyl.gas.position.set(0, crown + h / 2, 0); cyl.gas.scale.set(1, h, 1);
  const inL = liftCurve(psi, IN_OPEN, IN_CLOSE), exL = liftCurve(psi, EX_OPEN, EX_CLOSE);
  for (const v of cyl.valves) { const L = v.dir < 0 ? inL : exL; const d = L * 0.26; v.vg.position.set(v.base.x + Math.sin(v.rz) * d, v.base.y - Math.cos(v.rz) * d, v.base.z); v.sp.scale.y = v.sp.userData.h0 * (1 - L * 0.22); }
  for (const c of cyl.cams) { const mid = c.dir < 0 ? (IN_OPEN + IN_CLOSE) / 2 : (EX_OPEN + EX_CLOSE) / 2; c.cg.rotation.z = c.rz + ((psi - mid) / 2) * D2R; }
  // gas colour by phase
  const comb = psi < 140 ? Math.exp(-psi / 35) : 0;
  const compHeat = psi > 540 ? (psi - 540) / 180 : 0;
  let col = new THREE.Color(0x2a7fff), op = 0.18 * S.gas;
  if (psi >= 540 || psi < 2) { col.lerp(new THREE.Color(0xffb070), compHeat * 0.35); op = (0.18 + 0.25 * compHeat) * S.gas; }
  if (psi < 180) { col = new THREE.Color(0xff6010).lerp(new THREE.Color(0x6a2a18), clamp(psi / 170)); op = (0.15 + 0.6 * comb) * S.gas; }
  else if (psi < 360) { col = new THREE.Color(0x6a2a18); op = 0.18 * S.gas * (1 - clamp((psi - 300) / 60)); }
  cyl.gas.material.color.copy(col); cyl.gas.material.opacity = op;
  cyl.flash.intensity = comb * 60 * S.gas;
  cyl.exhMat.emissiveIntensity = (psi > 150 && psi < 380 ? 0.6 : 0.25) * S.gas;
  // particles
  const P = cyl.pPos, Cc = cyl.pCol; let k = 0;
  for (const m of cyl.pMeta) {
    let x, y, z, c = cylParticleColors.air, vis = 1;
    const inside = () => { x = Math.cos(m.a) * m.r * CS.bore; z = -Math.abs(Math.sin(m.a)) * m.r * CS.bore; y = crown + 0.04 + m.h * (h - 0.08) + roofY(x) * m.h; };
    if (m.fuel) {
      // spray during 690..720 from injector tip
      const sprayT = psi >= 680 ? (psi - 680) / 40 : -1;
      if (sprayT >= 0 && sprayT <= 1) { const tip = V(-0.95, cyl.deck + 0.02, -0.1); const dir = V(0.85, -0.4 - m.r * 0.4, -0.1 - m.ph * 0.5).normalize(); const dist = sprayT * (0.4 + m.h * 1.0); x = tip.x + dir.x * dist + (m.ph - .5) * dist * 0.5; y = Math.max(crown + 0.05, tip.y + dir.y * dist); z = tip.z + dir.z * dist - m.r * 0.4 * dist; c = cylParticleColors.fuel; }
      else if (psi < 120) { inside(); c = cylParticleColors.fire; vis = Math.exp(-psi / 60); }
      else vis = 0;
    } else {
      if (psi >= IN_OPEN && psi < 540) { // intake: stream in from port, fill
        const fillT = clamp((psi - IN_OPEN) / 190); const u = (m.ph + t * 0.6) % 1;
        if (m.h > fillT) { const p = cyl.intakePath.getPointAt(u); x = p.x + (m.r - .5) * 0.4; y = p.y + (m.h - .5) * 0.3; z = p.z + (m.ph - .5) * 0.5; }
        else inside();
        c = cylParticleColors.air;
      } else if (psi >= 540) { inside(); c = cylParticleColors.air.clone().lerp(cylParticleColors.hot, compHeat * 0.6); }
      else if (psi < 180) { inside(); c = cylParticleColors.fire.clone().lerp(cylParticleColors.exh, clamp(psi / 170)); }
      else { // exhaust out the port
        const outT = clamp((psi - 180) / 170); if (m.h < outT) { const u = clamp((outT - m.h) * 1.6 + m.ph * 0.2); const p = cyl.exhaustPath.getPointAt(Math.min(1, u)); x = p.x + (m.r - .5) * 0.4; y = p.y + (m.ph - .5) * 0.3; z = p.z + (m.ph - .5) * 0.5; vis = 1 - u; } else inside(); c = cylParticleColors.exh.clone().lerp(cylParticleColors.fire, 0.4);
      }
    }
    vis *= S.gas;
    P[k * 3] = x ?? 0; P[k * 3 + 1] = y ?? -50; P[k * 3 + 2] = z ?? 0;
    Cc[k * 3] = c.r * vis; Cc[k * 3 + 1] = c.g * vis; Cc[k * 3 + 2] = c.b * vis; k++;
  }
  cyl.points.geometry.attributes.position.needsUpdate = true; cyl.points.geometry.attributes.color.needsUpdate = true;
  return { s, comb };
}

// ---------------------------------------------------------------- POST
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(W / 2, H / 2), 0.3, 0.45, 0.92); composer.addPass(bloom);
const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, vig: { value: 1.0 }, fade: { value: 1 }, ca: { value: 0.0015 } },
  vertexShader: 'varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float time, vig, fade, ca; varying vec2 vUv;
  float h(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
  void main(){ vec2 d=vUv-.5; float r=dot(d,d);
    vec3 c; c.r=texture2D(tDiffuse,vUv+d*ca*r*8.).r; c.g=texture2D(tDiffuse,vUv).g; c.b=texture2D(tDiffuse,vUv-d*ca*r*8.).b;
    c*=mix(1.0, smoothstep(0.85,0.15,r*1.6), vig*0.85);
    c=mix(c, c*vec3(1.02,1.0,0.97), .5);
    c+= (h(vUv*1000.+time)-.5)*0.025;
    gl_FragColor=vec4(c*fade,1.0);}`
});
composer.addPass(new OutputPass());
composer.addPass(grade);

// ---------------------------------------------------------------- DIRECTION
// timeline lookup
function lineAt(t) { let cur = null; for (const l of LINES) { if (l.start <= t + 0.05) cur = l; else break; } return cur || LINES[0]; }
// segments of consecutive tags
const SEG = []; for (const l of LINES) { const last = SEG[SEG.length - 1]; if (last && last.tag === l.tag) { last.lines.push(l); last.end = l.start + l.dur; } else SEG.push({ tag: l.tag, start: l.start - (SEG.length ? 0.9 : 1.2), end: l.start + l.dur, lines: [l] }); }
for (let i = 0; i < SEG.length; i++) SEG[i].next = SEG[i + 1] ? SEG[i + 1].start : TL.total;
SEG[0].start = 0;
const segAt = t => { let s = SEG[0]; for (const x of SEG) if (x.start <= t) s = x; return s; };

const orbit = (tgt, rad, az, el, fov = 35) => ({ pos: V(tgt.x + rad * Math.cos(el) * Math.sin(az), tgt.y + rad * Math.sin(el), tgt.z + rad * Math.cos(el) * Math.cos(az)), tgt, fov });
const wp = name => anchors[name].getWorldPosition(V(0, 0, 0));
const CY = V(60, 3.6, 0);
// base state
const base = () => ({ xray: 0, flows: { air: 0, ex: 0, oil: 0 }, glow: 0.0, covers: 0, fire: 0.0, gas: 0, cylMode: 0, rpm: 0.35, transX: 0, oilFill: 0, turboFocus: 0, labels: [] });

// shot functions: (u, tl, seg, t) => {cam, state}
const SHOTS = {
  cold(u, tl, sg, t) {
    const st = base(); st.rpm = 0.5; st.fire = 1; st.hideCovers = t < lineById.o3.start - 0.3;
    // beats keyed to lines
    const o3 = lineById.o3.start, o4 = lineById.o4.start, o5 = lineById.o5.start, o2 = lineById.o2.start;
    let cam;
    if (t < o2 - 0.3) { // macro inside V: x-ray, piston firing glimpses
      st.xray = 0.85; st.glow = 0.4;
      cam = orbit(V(-0.8, 2.6, 0.6), lerp(9, 7.5, ease(t / o2)), -0.35 + t * 0.03, 0.55, 30);
    } else if (t < o3 - 0.3) { // piston crown hammer, low angle
      st.xray = 0.9; const k = (t - o2) / (o3 - o2);
      cam = orbit(V(-1.2, 2.4, 1.2), lerp(6.4, 5.6, k), -0.95 + k * 0.15, 0.4, 28);
    } else if (t < o4 - 0.3) { // exterior beauty, slow push
      const k = (t - o3) / (o4 - o3); st.covers = 0; st.glow = 0.15;
      cam = orbit(V(0, 1.6, -1.0), lerp(19, 16, ease(k)), 0.85 + k * 0.25, 0.22, 32);
    } else if (t < o5 - 0.3) { // cut open: three rivers keyed to words
      const k = (t - o4) / (o5 - o4); st.xray = sstep(o4, o4 + 1.5, t) * 0.88;
      st.flows.air = sstep(wt('o4', 'icecold') - .2, wt('o4', 'icecold') + .5, t);
      st.flows.ex = sstep(wt('o4', 'whitehot') - .2, wt('o4', 'whitehot') + .5, t); st.glow = 0.2 + st.flows.ex * 0.8;
      st.flows.oil = sstep(wt('o4', 'pressurized') - .2, wt('o4', 'pressurized') + .5, t);
      cam = orbit(V(0, 1.5, -0.5), lerp(17, 15, k), 0.55 - k * 0.5, 0.2, 34);
    } else { // pull out into hero, turbos spinning
      const k = clamp((t - o5) / (sg.end - o5)); st.xray = 0.88; st.flows = { air: 1, ex: 1, oil: 1 }; st.glow = 1; st.rpm = 0.9;
      cam = orbit(V(0, 1.4, -1.2), lerp(15, 21, ease(k)), -0.1 - k * 0.9, lerp(0.2, 0.32, k), 34);
    }
    return { cam, st };
  },
  title(u, tl, sg, t) { const st = base(); st.xray = 0.0; st.glow = 0.15; st.rpm = 0.25; return { cam: orbit(V(0, 1.4, -1.5), 20, 2.4 + u * 0.3, 0.25, 30), st, dim: 1 }; },
  ch1(u, tl, sg, t) {
    const st = base(); st.rpm = 0.3;
    const L = id => lineById[id].start;
    st.covers = 0; st.xray = sstep(L('a1') + 1, L('a1') + 4, t) * 0.75;
    st.teardown = sstep(L('a1'), L('a1') + 2.5, t);
    let cam;
    if (t < L('a2')) { cam = orbit(V(0, 1.2, -1), lerp(18, 15, ease(u * 3)), 0.6 + (t - L('a1')) * 0.04, 0.18, 32); st.labels = [['Engine block', 'head0', L('a1') + 1.5]]; }
    else if (t < L('a3')) { const k = (t - L('a2')) / (L('a3') - L('a2')); cam = { pos: V(lerp(2, 0, k), 2.2, lerp(15, 13.5, k)), tgt: V(0, 1.6, 0), fov: 32 }; st.vguide = sstep(L('a2') + 2, L('a2') + 3, t) * (1 - sstep(L('a3') - 1, L('a3'), t)); st.xray = 0.85; st.labels = [['Bank A', 'head0', L('a2') + 2.5], ['Bank B', 'head1', L('a2') + 2.8]]; }
    else if (t < L('a4')) { const k = (t - L('a3')) / (L('a4') - L('a3')); st.xray = 0.92; st.rpm = 0.4; cam = orbit(V(0, 0, 0.2), lerp(9, 7.5, k), 0.9 - k * 0.5, -0.05 + k * 0.1, 32); st.labels = [['Crankshaft', 'crank', L('a3') + 0.8]]; }
    else if (t < L('a5')) { const k = (t - L('a4')) / (L('a5') - L('a4')); st.xray = 0.92; st.oilFill = 1; st.flows.oil = sstep(L('a4') + 3, L('a4') + 5, t); cam = orbit(V(0, -1.2, 0.5), lerp(10, 8.5, k), 0.6 + k * 0.3, -0.1, 32); st.labels = [['Oil pan', 'oilPan', L('a4') + 0.5]]; }
    else { const k = clamp((t - L('a5')) / (sg.end - L('a5') + 1)); st.xray = 0.9; st.fire = 1; cam = orbit(V(-1.2, 2.4, 1.3), lerp(10, 3.2, ease(k)), lerp(-0.4, -0.9, k), lerp(0.3, 0.1, k), 30); }
    return { cam, st };
  },
  ch2(u, tl, sg, t) {
    const st = base(); st.cylMode = 1; st.gas = 1; const L = id => lineById[id].start;
    st.cylPsi = ((t - sg.start) * 70) % 720; st.cylPsi = 360 + ((t - sg.start) * 90) % 720;
    let cam;
    if (t < L('b2')) { const k = (t - sg.start) / (L('b2') - sg.start); cam = { pos: V(60 + lerp(4, 2, k), lerp(8.0, 7.4, k), lerp(14, 12, k)), tgt: V(60, 5.0, -0.6), fov: 32 }; st.labels = [['Cylinder head', 'cylHead', L('b1') + 0.6], ['Camshaft', 'cylCam', wt('b1', 'camshaft')], ['Valves', 'cylValve', wt('b1', 'valves')]]; }
    else { const k = (t - L('b2')) / (sg.end - L('b2')); cam = { pos: V(60 + lerp(1, 0, k), 3.4, lerp(21, 20.5, k)), tgt: V(60, 2.7, -0.6), fov: 34 }; }
    return { cam, st };
  },
};
// four-stroke beat shots share a framing; crank angle driven by narration
const beat = (from, to, extra) => (u, tl, sg, t) => {
  const st = base(); st.cylMode = 1; st.gas = 1;
  const e = ease(clamp((t - sg.lines[0].start - 0.4) / (sg.end - sg.lines[0].start - 0.6)));
  st.cylPsi = (lerp(from, to, e) + 720) % 720;
  const cam = { pos: V(60 + lerp(1.2, -0.6, u), 3.6, lerp(17.2, 16.4, u)), tgt: V(60, 2.9, -0.6), fov: 34 };
  if (extra) extra(st, t, cam, u);
  return { cam, st };
};
SHOTS.intake = beat(358, 540, st => { st.labels = [['Intake valves', 'cylValve', lineById.b3.start + 1], ['Piston', 'cylPiston', wt('b3', 'piston')]]; st.stroke = 1; });
SHOTS.compress = beat(540, 690, st => { st.stroke = 2; st.stat = ['10 : 1', 'compression ratio', wt('b4', 'squeezing')]; });
SHOTS.inject = (u, tl, sg, t) => { const st = base(); st.cylMode = 1; st.gas = 1; const k = clamp((t - sg.start - 0.5) / (sg.end - sg.start - 0.8)); st.cylPsi = lerp(690, 719.5, ease(k)); st.stroke = 2; st.labels = [['Direct injector', 'injector', wt('b5', 'direct')], ['Spark plug', 'sparkPlug', wt('b5', 'spark')]]; return { cam: { pos: V(60 + lerp(-1.6, -1.0, u), lerp(5.6, 5.3, u), lerp(7.5, 6.6, u)), tgt: V(59.8, 4.4, -0.4), fov: 30 }, st }; };
SHOTS.power = beat(0, 180, (st, t, cam, u) => { st.stroke = 3; st.labels = [['Connecting rod', 'conRod', wt('b6', 'connecting')], ['Crankshaft', 'cylCrank', wt('b6', 'crankshaft')]]; const L = lineById.b6.start; const k = clamp((t - L) / 1.2); cam.pos.add(V((Math.sin(t * 90) * 0.06) * (1 - k), (Math.cos(t * 77) * 0.06) * (1 - k), 0)); });
SHOTS.exhaust = beat(180, 360, st => { st.stroke = 4; st.labels = [['Exhaust valves', 'cylValveEx', lineById.b7.start + 1.2]]; });
SHOTS.ch2fire = (u, tl, sg, t) => { const st = base(); st.xray = 0.92; st.fire = 1; st.rpm = lerp(0.25, 0.5, u); st.firingCounter = 1; st.hideCovers = 1; const L = lineById.b9.start; st.teardown = 1 - ease(sstep(L + 0.8, L + 4.0, t)); let cam; if (t < L) cam = orbit(V(0, 2.6, 0), lerp(13, 11, u * 1.5), lerp(0.15, -0.15, u * 1.5), 0.55, 32); else { const k = clamp((t - L) / (sg.end - L)); cam = orbit(V(-2.5, 0.8, 0.6), lerp(12, 8, ease(k)), lerp(-0.4, -1.1, k), 0.15, 32); st.glow = lerp(0.25, 0.9, k); st.flows.ex = k; st.rpm = lerp(0.5, 0.9, k); } return { cam, st }; };
SHOTS.ch3 = (u, tl, sg, t) => {
  const st = base(); st.xray = 0.75; st.rpm = 0.8; const L = id => lineById[id].start; let cam;
  if (t < L('c2')) { const k = (t - sg.start) / (L('c2') - sg.start); st.flows.ex = 1; st.glow = 0.6; st.wasteMeter = sstep(wt('c1', 'third') - 0.5, wt('c1', 'third') + 0.5, t); cam = orbit(V(-1.5, -0.5, -2.5), lerp(16, 14, k), -0.9 - k * 0.3, 0.1, 34); }
  else if (t < L('c3')) { const k = (t - L('c2')) / (L('c3') - L('c2')); st.flows.ex = 1; st.glow = lerp(0.6, 1.6, k); st.labels = [['Exhaust manifold', 'exhaustManifoldL', L('c2') + 0.8]]; st.stat = ['900 °C', 'exhaust gas temperature', wt('c2', 'nine')]; cam = orbit(V(-2.4, 1.0, -0.4), lerp(7.5, 6.2, k), -1.3 + k * 0.25, 0.25, 30); }
  else { const k = (t - L('c3')) / (sg.end - L('c3')); st.flows.ex = 1; st.glow = 1.5; st.labels = [['Turbo — left bank', 'turboL', wt('c3', 'one')], ['Turbo — right bank', 'turboR', wt('c3', 'right')]]; cam = orbit(V(0, 0.2, 0.8), lerp(14, 13, k), lerp(0.1, -0.1, k), 0.05, 34); }
  return { cam, st };
};
SHOTS.turbine = (u, tl, sg, t) => {
  const st = base(); st.xray = 0.6; st.flows.ex = 1; st.glow = 0.75; const L = id => lineById[id].start; st.turboFocus = 1;
  st.turboRpm = sstep(L('c4') + 1, wt('c4', 'hundred') + 1.5, t);
  st.rpm = 0.9; let cam;
  if (t < L('c5')) { const k = (t - L('c4')) / (L('c5') - L('c4')); st.labels = [['Turbine wheel', 'turbineL', wt('c4', 'turbine')], ['Exhaust outlet', 'exhaustOutlet', wt('c4', 'exhaust')]]; st.stat = [null, 'turbine speed', wt('c4', 'hundred'), 'rpm']; cam = { pos: V(lerp(-6.4, -5.4, ease(k)), lerp(1.8, 1.3, k), lerp(-3.4, -2.6, k)), tgt: V(-3.15, -0.25, 0.45), fov: 28 }; }
  else { const k = (t - L('c5')) / (sg.end - L('c5')); st.shaftHi = 1; st.labels = [['Common shaft', 'turboL', L('c5') + 1]]; cam = { pos: V(lerp(-7.6, -7.2, k), lerp(0.4, 0.8, k), lerp(0.8, 2.2, k)), tgt: V(-3.15, -0.2, 1.0), fov: 28 }; }
  return { cam, st };
};
SHOTS.compressor = (u, tl, sg, t) => { const st = base(); st.xray = 0.6; st.flows.air = 1; st.flows.ex = 0.6; st.glow = 0.6; st.turboRpm = 1; st.turboFocus = 1; st.rpm = 0.9; const L = id => lineById[id].start; let cam; if (t < L('d2')) { const k = (t - L('d1')) / (L('d2') - L('d1')); st.labels = [['Compressor wheel', 'compressorL', wt('d1', 'compressor')]]; st.stat = ['Mach 1+', 'blade tip speed', wt('d1', 'faster')]; cam = { pos: V(lerp(-5.2, -4.4, k), lerp(0.6, 0.3, k), lerp(5.6, 4.7, k)), tgt: V(-3.15, -0.2, 1.6), fov: 30 }; } else { const k = (t - L('d2')) / (sg.end - L('d2')); st.stat = ['1.5 bar', 'boost pressure', L('d2') + 0.5]; cam = orbit(V(0, 1.6, 0), lerp(16, 17, k), lerp(-0.5, -0.2, k), 0.25, 34); } return { cam, st }; };
SHOTS.ch4 = (u, tl, sg, t) => {
  const st = base(); st.xray = 0.7; st.flows.air = 1; st.glow = 0.7; st.rpm = 0.8; st.turboRpm = 1; const L = id => lineById[id].start; let cam;
  if (t < L('d4')) { const k = (t - L('d3')) / (L('d4') - L('d3')); st.airHot = 1; st.stat = ['150 °C', 'air leaving the compressor', wt('d3', 'scorching')]; cam = orbit(V(-3.0, 1.2, 1.8), lerp(8, 7, k), -0.6 + k * 0.2, 0.2, 32); }
  else if (t < L('d5')) { const k = (t - L('d4')) / (L('d5') - L('d4')); st.airHot = 1 - k * 0.5; st.labels = [['Charge air hose', 'chargeHose', wt('d4', 'charge')], ['Intercooler', 'intercooler', wt('d4', 'intercoolers')]]; cam = orbit(V(1.5, 4.0, 1.5), lerp(10, 9, k), 0.9 - k * 0.6, 0.45, 32); }
  else if (t < L('d6')) { const k = (t - L('d5')) / (L('d6') - L('d5')); st.airHot = 0; st.icXray = 1; st.stat = ['50 °C', 'after the intercooler', wt('d5', 'cold')]; cam = orbit(V(1.05, 5.1, 0), lerp(5, 4.2, k), 0.3 + k * 0.2, 0.55, 30); }
  else { const k = (t - L('d6')) / (sg.end - L('d6')); st.airHot = 0; st.labels = [['Intake manifold', 'intakeManifold', wt('d6', 'intake')]]; st.fire = 1; cam = orbit(V(0, 3.4, -0.2), lerp(9.5, 8.5, k), lerp(0.2, -0.4, k), 0.7, 32); }
  return { cam, st };
};
SHOTS.ch5 = (u, tl, sg, t) => {
  const st = base(); st.xray = 0.93; st.flows.oil = 1; st.oilFill = 1; st.rpm = 0.5; st.oilMode = 1; st.teardown = 1; const L = id => lineById[id].start; let cam;
  if (t < L('e2')) { st.flows.air = 0.25; st.flows.ex = 0.25; st.oilMode = sstep(L('e1') + 2, L('e1') + 4, t); cam = orbit(V(0, 1.0, 0), lerp(17, 15, u * 2), 0.7 + u * 0.3, 0.15, 34); }
  else if (t < L('e3')) { const k = (t - L('e2')) / (L('e3') - L('e2')); st.labels = [['Oil pump', 'oilPan', wt('e2', 'pump')]]; st.stat = ['4–5 bar', 'oil pressure', wt('e2', 'pressure')]; cam = orbit(V(0.5, -0.8, 1.5), lerp(9, 8, k), 1.0 - k * 0.3, -0.05, 32); }
  else { const k = (t - L('e3')) / (sg.end - L('e3')); st.labels = [['Crank bearings', 'crank1', wt('e3', 'crankshaft')], ['Pistons', 'piston', wt('e3', 'pistons')], ['Camshafts', 'cam0-1', wt('e3', 'camshafts')]]; cam = orbit(V(0, 1.8, 0.4), lerp(12, 11, k), lerp(0.4, -0.3, k), lerp(0.05, 0.35, k), 34); }
  return { cam, st };
};
SHOTS.ch5turbo = (u, tl, sg, t) => { const st = base(); st.xray = 0.9; st.flows.oil = 1; st.oilMode = 1; st.turboRpm = 1; st.turboFocus = 1; st.rpm = 0.6; st.teardown = 1 - ease(sstep(sg.start, sg.start + 2.2, t)); st.labels = [['Turbo oil feed', 'turboL', wt('e4', 'thin')]]; st.stat = ['0.005 mm', 'oil film under the shaft', wt('e4', 'microscopic') - 0.3]; const k = u; return { cam: { pos: V(lerp(-5.6, -4.6, ease(k)), lerp(1.4, 0.7, k), lerp(-0.6, 0.6, k)), tgt: V(-3.15, -0.1, 0.9), fov: lerp(32, 28, ease(k)) }, st }; };
SHOTS.ch6 = (u, tl, sg, t) => {
  const st = base(); st.xray = 0.6; st.rpm = 0.6; st.fire = 1; const L = id => lineById[id].start; let cam;
  if (t < L('f2')) { const k = (t - L('f1')) / (L('f2') - L('f1')); st.xray = 0.9; st.rpm = 0.35; cam = orbit(V(0, 1.5, 0), lerp(10, 9.5, k), 0.0, 0.05, 32); }
  else if (t < L('f3')) { const k = (t - L('f2')) / (L('f3') - L('f2')); st.transX = sstep(L('f2') + 2, L('f2') + 4, t); st.labels = [['Transmission', 'transmission', wt('f2', 'transmission')]]; cam = orbit(V(0, 0.4, lerp(-2, -5.5, ease(k))), lerp(13, 12, k), lerp(1.2, 1.7, k), 0.25, 34); }
  else { const k = (t - L('f3')) / (sg.end - L('f3')); st.transX = 1; st.gearsX = 1; st.stat = ['× 3.5', 'torque multiplication in 1st gear', wt('f3', 'multiply')]; cam = orbit(V(0, -0.1, -6.2), lerp(7.5, 6.8, k), lerp(1.5, 2.0, k), 0.5, 32); }
  return { cam, st };
};
SHOTS.finale = (u, tl, sg, t) => {
  const st = base(); st.rpm = 0.9; st.turboRpm = 1; st.fire = 1; st.glow = 1.3; const L = id => lineById[id].start;
  st.xray = 0.88; st.flows = { air: sstep(wt('f4', 'two'), wt('f4', 'two') + .6, t) * 0 + sstep(wt('f4', 'air') - .2, wt('f4', 'air') + .5, t), ex: sstep(wt('f4', 'fire') - .2, wt('f4', 'fire') + .5, t), oil: sstep(wt('f4', 'oil') - .2, wt('f4', 'oil') + .5, t) };
  const k = clamp((t - sg.start) / (TL.total - sg.start));
  st.endCard = sstep(lineById.f5.start + lineById.f5.dur + 0.3, lineById.f5.start + lineById.f5.dur + 1.3, t);
  return { cam: orbit(V(0, 1.4, -1.8), lerp(14, 22, ease(k)), lerp(-0.6, 0.9, k), lerp(0.18, 0.3, k), 34), st };
};
for (let i = 1; i <= 6; i++) SHOTS['title' + i] = SHOTS.title;

function evalShot(sg, t) { const fn = SHOTS[sg.tag] || SHOTS.title; const u = clamp((t - sg.start) / (sg.next - sg.start)); return fn(u, null, sg, t); }

// ---------------------------------------------------------------- OVERLAY (labels, captions, stats, titles)
const FONT = '"Inter Display","Inter",sans-serif';
const CHAPTERS = { title1: ['01', 'The Metal Skeleton'], title2: ['02', 'Four Strokes, One Cylinder'], title3: ['03', 'The Hot Side'], title4: ['04', 'The Cold Side'], title5: ['05', 'The Hidden River'], title6: ['06', 'Explosions Into Motion'] };
const labelState = {};
function proj(v) { const p = v.clone().project(camera); return { x: (p.x * .5 + .5) * W, y: (-p.y * .5 + .5) * H, z: p.z }; }
function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
const S1 = W / 1920;
function drawLabels(list, t, segEnd) {
  let slot = 0;
  for (const [text, an, t0] of list) {
    if (!anchors[an]) continue;
    const a = sstep(t0, t0 + 0.45, t) * (1 - sstep(segEnd - 0.5, segEnd, t)); if (a <= 0) continue;
    const p = proj(wp(an)); if (p.z > 1) continue;
    const side = p.x > W * 0.55 ? 1 : -1;
    const lx = p.x + side * 150 * S1, ly = p.y - (110 + slot * 18) * S1; slot++;
    const grow = ease(sstep(t0, t0 + 0.4, t));
    ctx.save(); ctx.globalAlpha = a;
    ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 2 * S1;
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(lerp(p.x, lx, grow), lerp(p.y, ly, grow)); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(p.x, p.y, 5 * S1, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1.5 * S1; ctx.beginPath(); ctx.arc(p.x, p.y, (9 + 6 * Math.sin(t * 4)) * S1, 0, Math.PI * 2); ctx.stroke();
    ctx.font = `600 ${34 * S1}px ${FONT}`; const tw = ctx.measureText(text).width; const bx = side > 0 ? lx : lx - tw - 36 * S1, by = ly - 30 * S1;
    ctx.globalAlpha = a * grow;
    ctx.fillStyle = 'rgba(10,12,16,.62)'; roundRect(bx, by, tw + 36 * S1, 58 * S1, 10 * S1); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.fillText(text, bx + 18 * S1, by + 30 * S1);
    ctx.restore();
  }
}
function drawStat(stat, t, segEnd, st) {
  if (!stat) return; const [big, small, t0, unit] = stat; const a = sstep(t0, t0 + 0.4, t) * (1 - sstep(segEnd - 0.5, segEnd, t)); if (a <= 0) return;
  let text = big;
  if (big === null) { const v = Math.round(ease(clamp((t - t0) / 2.2)) * 100000); text = v.toLocaleString('en-US'); }
  ctx.save(); ctx.globalAlpha = a; const x = 110 * S1, y = 190 * S1; const dy = (1 - ease(sstep(t0, t0 + 0.5, t))) * 20 * S1;
  ctx.font = `700 ${120 * S1}px ${FONT}`; ctx.fillStyle = '#fff'; ctx.textBaseline = 'alphabetic'; ctx.fillText(text, x, y + 80 * S1 + dy);
  const w = ctx.measureText(text).width;
  if (unit) { ctx.font = `600 ${44 * S1}px ${FONT}`; ctx.fillStyle = '#ffb347'; ctx.fillText(unit, x + w + 16 * S1, y + 80 * S1 + dy); }
  ctx.fillStyle = '#ffb347'; ctx.fillRect(x, y + 104 * S1 + dy, 60 * S1, 4 * S1);
  ctx.font = `500 ${34 * S1}px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.fillText(small.toUpperCase(), x, y + 156 * S1 + dy);
  ctx.restore();
}
function drawCaptions(t) {
  const l = lineAt(t); if (!l || l.tag.startsWith('title')) return;
  if (t > l.start + l.dur + 0.4) return;
  // chunk into groups of ~6 words
  const chunks = []; let cur = [];
  for (const w of l.words) { cur.push(w); if (cur.length >= 6 || /[.,!?]$/.test(w[0]) && cur.length >= 3) { chunks.push(cur); cur = []; } }
  if (cur.length) chunks.push(cur);
  let ch = chunks.find(c => t < c[c.length - 1][2] + 0.15) || chunks[chunks.length - 1];
  ctx.save(); ctx.font = `700 ${46 * S1}px ${FONT}`; ctx.textBaseline = 'middle';
  const sp = ctx.measureText(' ').width; const widths = ch.map(w => ctx.measureText(w[0]).width); const total = widths.reduce((a, b) => a + b, 0) + sp * (ch.length - 1);
  let x = W / 2 - total / 2; const y = H - 120 * S1;
  ch.forEach((w, i) => { const active = t >= w[1] - 0.05; const now = t >= w[1] - 0.05 && t < w[2] + 0.1; ctx.lineWidth = 8 * S1; ctx.strokeStyle = 'rgba(0,0,0,.75)'; ctx.lineJoin = 'round'; ctx.strokeText(w[0], x, y); ctx.fillStyle = now ? '#ffc93c' : active ? '#ffffff' : 'rgba(255,255,255,.55)'; ctx.fillText(w[0], x, y); x += widths[i] + sp; });
  ctx.restore();
}
function drawTitle(sg, t) {
  const c = CHAPTERS[sg.tag]; if (!c) return; const a = sstep(sg.start, sg.start + 0.6, t) * (1 - sstep(sg.next - 0.6, sg.next, t));
  ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(0, 0, W, H);
  const k = ease(sstep(sg.start + 0.1, sg.start + 1.1, t));
  ctx.textAlign = 'center'; ctx.fillStyle = '#ffb347'; ctx.font = `600 ${40 * S1}px ${FONT}`; ctx.fillText('CHAPTER ' + c[0], W / 2, H / 2 - 70 * S1);
  ctx.fillStyle = '#fff'; ctx.font = `700 ${104 * S1}px ${FONT}`; ctx.fillText(c[1], W / 2, H / 2 + 40 * S1 + (1 - k) * 20 * S1);
  ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.fillRect(W / 2 - 260 * S1 * k, H / 2 + 90 * S1, 520 * S1 * k, 2 * S1);
  ctx.restore();
}
function drawStrokeHUD(st, t) {
  if (!st.stroke) return; const names = ['INTAKE', 'COMPRESSION', 'POWER', 'EXHAUST'];
  ctx.save(); const x0 = W / 2 - 4 * 190 * S1 / 2, y = 70 * S1;
  names.forEach((n, i) => { const on = st.stroke === i + 1; ctx.fillStyle = on ? (i === 2 ? '#ff6a1a' : i === 0 ? '#2a9dff' : i === 1 ? '#7fb8ff' : '#b0705a') : 'rgba(255,255,255,.08)'; roundRect(x0 + i * 190 * S1, y, 180 * S1, 46 * S1, 8 * S1); ctx.fill(); ctx.fillStyle = on ? '#fff' : 'rgba(255,255,255,.45)'; ctx.font = `700 ${22 * S1}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(`${i + 1}  ${n}`, x0 + i * 190 * S1 + 90 * S1, y + 24 * S1); });
  ctx.restore();
}
function drawFlowLegend(st) {
  const items = [['Compressed air', '#2a9dff', st.flows.air], ['Exhaust gas', '#ff4500', st.flows.ex], ['Engine oil', '#f5b800', st.flows.oil]].filter(i => i[2] > 0.02);
  if (!items.length || st.cylMode) return; ctx.save(); let y = H - 230 * S1;
  for (const [n, c, a] of items) { ctx.globalAlpha = a; ctx.fillStyle = c; ctx.fillRect(W - 330 * S1, y, 36 * S1, 6 * S1); ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.font = `500 ${24 * S1}px ${FONT}`; ctx.textBaseline = 'middle'; ctx.fillText(n, W - 280 * S1, y + 3 * S1); y += 40 * S1; }
  ctx.restore();
}
function drawWaste(a) { if (a <= 0) return; ctx.save(); ctx.globalAlpha = a; const x = 110 * S1, y = 200 * S1; ctx.font = `700 ${110 * S1}px ${FONT}`; ctx.fillStyle = '#fff'; ctx.fillText('≈ 33%', x, y + 80 * S1); ctx.font = `500 ${32 * S1}px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.fillText('OF FUEL ENERGY LOST AS EXHAUST HEAT', x, y + 140 * S1); const bw = 520 * S1; ctx.fillStyle = 'rgba(255,255,255,.15)'; ctx.fillRect(x, y + 170 * S1, bw, 14 * S1); ctx.fillStyle = '#ff4500'; ctx.fillRect(x, y + 170 * S1, bw * 0.33 * ease(a), 14 * S1); ctx.restore(); }
function drawVGuide(a) { if (!a) return; const c = proj(V(0, 0, 0)); const l = proj(V(-2.8, 2.8, 0)), r = proj(V(2.8, 2.8, 0)); ctx.save(); ctx.globalAlpha = a; ctx.setLineDash([12 * S1, 10 * S1]); ctx.strokeStyle = '#ffb347'; ctx.lineWidth = 3 * S1; ctx.beginPath(); ctx.moveTo(l.x, l.y); ctx.lineTo(c.x, c.y); ctx.lineTo(r.x, r.y); ctx.stroke(); ctx.setLineDash([]); ctx.font = `700 ${46 * S1}px ${FONT}`; ctx.fillStyle = '#ffb347'; ctx.textAlign = 'center'; ctx.fillText('90°', c.x, c.y - 120 * S1); ctx.restore(); }
function drawFiring(st, t) { if (!st.firingCounter) return; ctx.save(); const order = pistons.slice().sort((a, b) => a.fireA - b.fireA); const x0 = 110 * S1, y = 110 * S1; ctx.font = `600 ${26 * S1}px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.fillText('FIRING ORDER', x0, y); order.forEach((p, i) => { const f = p.psi < 90 ? 1 - p.psi / 90 : 0; ctx.fillStyle = `rgba(255,${120 + 80 * (1 - f)},40,${0.15 + 0.85 * f})`; ctx.beginPath(); ctx.arc(x0 + 22 * S1 + i * 54 * S1, y + 48 * S1, 20 * S1, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `700 ${20 * S1}px ${FONT}`; ctx.fillText(String(i + 1), x0 + 22 * S1 + i * 54 * S1, y + 49 * S1); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; }); ctx.restore(); }
function drawEnd(a) { if (a <= 0) return; ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, 0, W, H); ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.font = `700 ${92 * S1}px ${FONT}`; ctx.fillText('AIR. FIRE. OIL.', W / 2, H / 2 - 10 * S1); ctx.font = `500 ${34 * S1}px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.fillText('@deepteardown  ·  How Everyday Tech Works', W / 2, H / 2 + 60 * S1); ctx.restore(); }

// ---------------------------------------------------------------- FRAME
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();
let alphaAcc = 0, lastT = 0, turboAng = 0, simT = 0;
function integrateTo(t) { // deterministic: depends only on t
  if (t < simT) { simT = 0; alphaAcc = 0; turboAng = 0; }
  const h = 1 / 60;
  while (simT + h <= t) { const st = evalShot(segAt(simT), simT).st; alphaAcc += h * st.rpm * Math.PI * 2; const tr = st.turboRpm ?? (st.flows.ex > 0.5 ? 0.6 : 0.15); turboAng += h * lerp(2, 38, tr); simT += h; }
}
function applyState(st, t, dt) {
  // engine rotation (integrated, deterministic because frames are rendered sequentially)
  integrateTo(t);
  updateEngine(alphaAcc, st);
  for (const T of turbos) T.shaftR.rotation.y = turboAng * T.b;
  // xray
  for (const m of xrayMeshes) { m.material.opacity = 1 - st.xray; m.material.transparent = st.xray > 0.01; m.material.depthWrite = st.xray < 0.5; m.castShadow = st.xray < 0.5; }
  M.fin.opacity = st.icXray ? 0.35 : 1 - st.xray * 0.5; M.rubber.opacity = 1 - st.xray * 0.55; M.rubber.depthWrite = st.xray < 0.4;
  // glow
  const gl = st.glow * (0.85 + 0.15 * Math.sin(t * 7));
  M.hot.emissiveIntensity = gl * 0.9; M.turbineHousing.emissiveIntensity = gl * 0.35; M.inconel.emissiveIntensity = st.turboFocus ? gl * 0.25 : 0;
  M.hot.emissive.setHex(0xff3a08);
  glowLight.intensity = gl * 25; glowLight.position.set(-2.6, 0.6, 0.2);
  // oil
  M.oil.opacity = st.oilFill * 0.6;
  const tdh = (st.teardown || 0) > 0.3; FLOW.oil.hide = c => tdh && c >= 7; oilTubes.forEach((o, i) => { o.material.opacity = (tdh && i >= 7) ? 0 : st.flows.oil * 0.55; });
  // air hot tint
  FLOW.air.mat.color.setHex(0x2a9dff).lerp(new THREE.Color(0xff8a40), (st.airHot || 0) * 0.85);
  FLOW.air.update(t, st.flows.air * 0.95); FLOW.ex.update(t, st.flows.ex * 0.95); FLOW.oil.update(t, st.flows.oil);
  for (const f of filters) f.visible = !st.turboFocus; M.turbineHousing.opacity = st.turboFocus ? 0.22 : 1; M.turbineHousing.depthWrite = !st.turboFocus; compMat.opacity = st.turboFocus ? 0.2 : 1; compMat.depthWrite = !st.turboFocus; for (const T of turbos) { T.dp.material.emissiveIntensity = M.hot.emissiveIntensity; T.dp.material.opacity = st.turboFocus ? 0.25 : 1; T.dp.material.transparent = true; T.dp.material.depthWrite = !st.turboFocus; }
  for (const c of covers) c.visible = !st.hideCovers;
  const td = st.teardown || 0; for (const a of ANC) { a.o.position.copy(a.p0).addScaledVector(a.d, ease(td) * 14); a.o.visible = td < 0.98; }
  // transmission x-ray gears
  for (const gg of gears) gg.gr.visible = (st.gearsX || 0) > 0.5;
  for (const m of xrayMeshes) if (m.parent === trans) { m.material.opacity = 1 - Math.max(st.xray * 0.6, (st.gearsX || 0) * 0.85); m.material.transparent = true; m.material.depthWrite = !(st.gearsX); }
  // rigs visibility
  C.visible = st.cylMode > 0.5; E.visible = !C.visible; key.castShadow = E.visible;
  for (const f of Object.values(FLOW)) f.pts.visible = f.pts.visible && E.visible;
  for (const o of oilTubes) o.visible = E.visible;
  if (C.visible) updateCyl(st.cylPsi ?? 0, t, st);
  floor.visible = true; floor.position.y = C.visible ? -1.72 : -3.05;
}
function blendCam(a, b, k) { return { pos: a.pos.clone().lerp(b.pos, k), tgt: a.tgt.clone().lerp(b.tgt, k), fov: lerp(a.fov, b.fov, k) }; }

window.renderFrame = function (t) {
  const dt = Math.max(0, t - lastT); lastT = t;
  const sg = segAt(t); const idx = SEG.indexOf(sg);
  let { cam, st, dim } = evalShot(sg, t);
  // camera blend from previous shot (only when staying in the same rig)
  const BL = 1.1;
  if (idx > 0 && t - sg.start < BL) {
    const prev = SEG[idx - 1]; const pr = evalShot(prev, t);
    const sameRig = (pr.st.cylMode > 0.5) === (st.cylMode > 0.5);
    if (sameRig && !sg.tag.startsWith('title') && !prev.tag.startsWith('title')) { const k = ease((t - sg.start) / BL); cam = blendCam(pr.cam, cam, k); }
  }
  camera.position.copy(cam.pos); camera.lookAt(cam.tgt); camera.fov = cam.fov; camera.updateProjectionMatrix();
  applyState(st, t, dt);
  // fades: in at start, dip at rig changes, out at end
  let fade = sstep(0, 1.2, t) * (1 - sstep(TL.total - 1.2, TL.total, t));
  if (idx > 0) { const prev = SEG[idx - 1]; const pr = evalShot(prev, Math.max(prev.start, sg.start - 0.01)); if ((pr.st.cylMode > 0.5) !== (st.cylMode > 0.5)) fade *= sstep(sg.start, sg.start + 0.45, t); }
  const nx = SEG[idx + 1]; if (nx) { const nr = evalShot(nx, nx.start + 0.01); if ((nr.st.cylMode > 0.5) !== (st.cylMode > 0.5)) fade *= 1 - sstep(nx.start - 0.35, nx.start, t); }
  grade.uniforms.fade.value = fade; grade.uniforms.time.value = t % 100;
  bloom.strength = 0.28 + 0.2 * clamp(st.glow - 0.5);
  composer.render();
  // overlay
  ctx.clearRect(0, 0, W, H);
  ctx.globalAlpha = 1;
  const segEnd = sg.next;
  if (dim) drawTitle(sg, t);
  drawVGuide(st.vguide || 0);
  drawLabels(st.labels, t, segEnd);
  drawStat(st.stat, t, segEnd, st);
  drawWaste((st.wasteMeter || 0) * (1 - sstep(lineById.c2.start - 0.3, lineById.c2.start, t)));
  drawStrokeHUD(st, t);
  drawFiring(st, t);
  drawFlowLegend(st);
  drawCaptions(t);
  drawEnd(st.endCard || 0);
  // channel bug
  ctx.save(); ctx.globalAlpha = 0.55 * fade; ctx.font = `600 ${22 * S1}px ${FONT}`; ctx.fillStyle = '#fff'; ctx.textAlign = 'right'; ctx.fillText('@deepteardown', W - 50 * S1, 56 * S1); ctx.restore();
  if (fade < 1) { ctx.save(); ctx.globalCompositeOperation = 'source-atop'; ctx.fillStyle = `rgba(0,0,0,${1 - fade})`; ctx.fillRect(0, 0, W, H); ctx.restore(); }
};
// composite to single JPEG
const out = document.createElement('canvas'); out.width = W; out.height = H; const octx = out.getContext('2d');
window.grab = async function (q = 0.93) { octx.drawImage(renderer.domElement, 0, 0); octx.drawImage(overlay, 0, 0); const b = await new Promise(r => out.toBlob(r, 'image/jpeg', q)); const buf = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000)); return btoa(s); };
window.TOTAL = TL.total; window.READY = true;
