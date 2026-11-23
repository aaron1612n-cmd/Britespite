import * as THREE from 'three';
import { B, MAT, HF } from './skeleton.js';

const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const blend = (y, yj, band, up, dn) => [up, dn, ss(yj + band, yj - band, y)]; // weight of lower bone

class Builder {
  constructor() { this.pos = []; this.nrm = []; this.mat = []; this.skin = []; this.idx = []; this.tags = {}; }
  add(geo, mat, skinFn, tag) {
    const p = geo.attributes.position, n = geo.attributes.normal, base = this.pos.length / 3;
    if (tag) { const r = (this.tags[tag] = this.tags[tag] || []); r.push([base, base + p.count]); }
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      this.pos.push(x, y, z); this.nrm.push(n.getX(i), n.getY(i), n.getZ(i)); this.mat.push(mat);
      const s = skinFn(x, y, z); this.skin.push(s[0], s[1], s[2]);
    }
    for (let i = 0; i < geo.index.count; i++) this.idx.push(geo.index.getX(i) + base);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('aMat', new THREE.Float32BufferAttribute(this.mat, 1));
    g.setAttribute('aSkin', new THREE.Float32BufferAttribute(this.skin, 3));
    g.setIndex(this.idx); g.userData.tags = this.tags; return g;
  }
}

// Elliptical sections stacked along Y: {y, rx, rz, cx, cz}. Smooth normals, closed ends.
function loft(rings, segs, caps = true) {
  const pos = [], idx = [], n = rings.length;
  for (const r of rings) for (let i = 0; i < segs; i++) { const a = (i / segs) * Math.PI * 2; pos.push((r.cx || 0) + Math.sin(a) * r.rx, r.y, (r.cz || 0) + Math.cos(a) * r.rz); }
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < segs; i++) { const a = j * segs + i, b = j * segs + (i + 1) % segs, c = a + segs, d = b + segs; idx.push(a, c, b, b, c, d); }
  if (caps) {
    const bot = pos.length / 3; pos.push(rings[0].cx || 0, rings[0].y, rings[0].cz || 0); const top = bot + 1; pos.push(rings[n - 1].cx || 0, rings[n - 1].y, rings[n - 1].cz || 0);
    for (let i = 0; i < segs; i++) { idx.push(bot, i, (i + 1) % segs); idx.push(top, (n - 1) * segs + (i + 1) % segs, (n - 1) * segs + i); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
// tapered tube along a polyline (bows, banners)
function tube(pts, radii, segs, flat = 1) {
  const pos = [], idx = [], n = pts.length, V = (a) => new THREE.Vector3(...a);
  for (let i = 0; i < n; i++) {
    const t = V(pts[Math.min(n - 1, i + 1)]).sub(V(pts[Math.max(0, i - 1)])).normalize(), up = Math.abs(t.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const u = new THREE.Vector3().crossVectors(t, up).normalize(), w = new THREE.Vector3().crossVectors(t, u);
    for (let k = 0; k < segs; k++) { const a = (k / segs) * Math.PI * 2, c = Math.cos(a) * radii[i], s = Math.sin(a) * radii[i]; const sf = s * flat; pos.push(pts[i][0] + u.x * c + w.x * sf, pts[i][1] + u.y * c + w.y * sf, pts[i][2] + u.z * c + w.z * sf); }
  }
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < segs; i++) { const a = j * segs + i, bb = j * segs + (i + 1) % segs, c = a + segs, d = bb + segs; idx.push(a, c, bb, bb, c, d); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
const ball = (c, r, ws, hs, rot) => { const g = new THREE.SphereGeometry(1, ws, hs); g.scale(r[0], r[1], r[2]); if (rot) { g.rotateX(rot[0] || 0); g.rotateZ(rot[1] || 0); } g.translate(c[0], c[1], c[2]); return g; };

/** detail 0 = full, 1 = mid (fewer segments, no fine facial/hand detail) */
export const SHIELD_PLANE_Y = 0.8; // rim plane in left-forearm bind space; everything held behind it has larger y

export const UNIT_TYPES = ['hoplite', 'heavy', 'archer', 'javelin', 'commander', 'cavalry'];

export function buildSoldier(detail = 0, type = 0) {
  const HV = type === 1, AR = type === 2, JV = type === 3, CM = type === 4, CV = type === 5, LIGHT = AR || JV, ARMOR = !LIGHT;
  const hi = detail === 0, S = hi ? 12 : 5, E = hi ? [10, 7] : [5, 3];
  const b = new Builder(), one = (bone) => () => [bone, bone, 0];
  const PEL = one(B.PELVIS), HD = one(B.HEAD);
  const bodySkin = (x, y) => (y < 1.04 ? [B.PELVIS, B.PELVIS, 0] : [B.PELVIS, B.CHEST, ss(1.04, 1.2, y)]);

  // ---- torso: bare muscular body under a bronze muscle cuirass
  const torso = loft([
    { y: 0.92, rx: 0.16, rz: 0.1 }, { y: 1.02, rx: 0.165, rz: 0.108 }, { y: 1.12, rx: 0.14, rz: 0.1 }, { y: 1.24, rx: 0.165, rz: 0.11 },
    { y: 1.36, rx: 0.19, rz: 0.12 }, { y: 1.46, rx: 0.2, rz: 0.115 }, { y: 1.52, rx: 0.13, rz: 0.09 }, { y: 1.57, rx: 0.052, rz: 0.055 }], S + 2);
  b.add(torso, LIGHT ? MAT.TUNIC : MAT.SKIN, bodySkin);
  const cuirass = loft([
    { y: 1.0, rx: 0.172, rz: 0.114 }, { y: 1.12, rx: 0.148, rz: 0.106 }, { y: 1.24, rx: 0.172, rz: 0.118 }, { y: 1.36, rx: 0.198, rz: 0.13 }, { y: 1.46, rx: 0.205, rz: 0.12 }, { y: 1.5, rx: 0.16, rz: 0.1 }], S + 2);
  if (ARMOR) b.add(cuirass, CM ? MAT.GOLD : MAT.BRONZE, bodySkin);
  // belt and pteryges (leather strips) + tunic skirt
  const belt = loft([{ y: 0.94, rx: 0.172, rz: 0.116 }, { y: 1.0, rx: 0.176, rz: 0.12 }], S + 2, false); b.add(belt, MAT.LEATHER, PEL);
  const skirt = new THREE.CylinderGeometry(0.19, 0.25, 0.3, S + 3, 1, true); skirt.translate(0, 0.82, 0); b.add(skirt, MAT.TUNIC, PEL);
  const strips = []; if (hi && ARMOR && !CV) { const N = 12, pos = [], idx = [];
    for (let k = 0; k < N; k++) { const a = (k / N) * Math.PI * 2, w = Math.PI / N * 0.8, i0 = pos.length / 3;
      for (const [rad, y, da] of [[0.205, 0.95, -w], [0.205, 0.95, w], [0.255, 0.74, w * 0.9], [0.255, 0.74, -w * 0.9]]) pos.push(Math.sin(a + da) * rad, y, Math.cos(a + da) * rad);
      idx.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); b.add(g, MAT.TAN, PEL); }
  // cape on the back
  if (type === 0 || CM) { const k = CM ? 1.3 : 1, g = loft([{ y: 1.5, rx: 0.17, rz: 0.012, cz: -0.115 }, { y: 1.2, rx: 0.2 * k, rz: 0.012, cz: -0.15 }, { y: 0.9, rx: 0.23 * k, rz: 0.012, cz: -0.19 }, { y: CM ? 0.5 : 0.78, rx: 0.2 * k, rz: 0.01, cz: -0.2 }], 6, false);
    b.add(g, MAT.ACCENT, (x, y) => [B.CHEST, B.PELVIS, ss(1.3, 1.0, y)]); }

  // ---- neck + head
  b.add(loft([{ y: 1.5, rx: 0.056, rz: 0.058 }, { y: 1.62, rx: 0.048, rz: 0.05 }], S, false), MAT.SKIN, (x, y) => blend(y, 1.56, 0.05, B.CHEST, B.HEAD));
  b.add(ball([0, 1.695, 0.008], [0.076, 0.105, 0.092], E[0] + 2, E[1] + 1), MAT.SKIN, HD); // skull
  b.add(ball([0, 1.635, 0.035], [0.062, 0.062, 0.062], E[0], E[1]), MAT.SKIN, HD); // jaw
  b.add(ball([0, 1.605, 0.06], [0.04, 0.032, 0.03], 6, 4), MAT.HAIR, HD); // beard
  if (hi) b.add(ball([0, 1.665, 0.1], [0.014, 0.028, 0.026], 6, 4), MAT.SKIN, HD); // nose
  if (hi) {
    for (const s of [1, -1]) {
      b.add(ball([0.032 * s, 1.703, 0.088], [0.012, 0.008, 0.01], 5, 4), MAT.EYE, HD); // eye
      b.add(ball([0.034 * s, 1.72, 0.084], [0.022, 0.007, 0.012], 5, 4, [0, 0.2 * s]), MAT.HAIR, HD); // brow
      b.add(ball([0.077 * s, 1.69, -0.002], [0.01, 0.026, 0.018], 5, 4), MAT.SKIN, HD); // ear
    }
  }
  if (AR) { // soft pointed cap
    b.add(loft([{ y: 1.74, rx: 0.098, rz: 0.108, cz: 0.0 }, { y: 1.8, rx: 0.088, rz: 0.098 }, { y: 1.88, rx: 0.05, rz: 0.06, cz: -0.02 }, { y: 1.95, rx: 0.012, rz: 0.015, cz: -0.06 }], S, true), MAT.LEATHER, HD);
  } else if (JV) { // cropped hair and headband
    const hair = new THREE.SphereGeometry(1, S + 2, E[1], 0, Math.PI * 2, 0, 1.55); hair.scale(0.088, 0.1, 0.1); hair.translate(0, 1.72, -0.005); b.add(hair, MAT.HAIR, HD);
    b.add(loft([{ y: 1.725, rx: 0.081, rz: 0.097 }, { y: 1.745, rx: 0.081, rz: 0.097 }], S + 2, false), MAT.ACCENT, HD);
  } else {
  const dome = new THREE.SphereGeometry(1, S + 4, E[1], 0, Math.PI * 2, 0, 1.78); dome.scale(0.093, 0.108, 0.108); dome.translate(0, 1.715, 0.002); b.add(dome, CM ? MAT.GOLD : MAT.BRONZE, HD);
  const guard = new THREE.CylinderGeometry(0.097, 0.118, 0.085, S, 1, true, Math.PI * 0.62, Math.PI * 0.76); guard.translate(0, 1.66, -0.004); b.add(guard, MAT.BRONZE, HD);
  for (const s of [1, -1]) b.add(ball([0.079 * s, 1.655, 0.045], [0.012, 0.055, 0.05], 6, 4), MAT.BRONZE, HD);
  b.add(ball([0, 1.7, 0.1], [0.011, 0.045, 0.012], 5, 4), MAT.BRONZE, HD); // nasal guard
  b.add(ball([0, 1.865, -0.01], [0.014, 0.052, 0.14], 7, 5), MAT.ACCENT, HD); // crest
  b.add(ball([0, 1.825, -0.14], [0.013, 0.075, 0.028], 5, 4), MAT.ACCENT, HD); // plume tail

    if (HV) b.add(ball([0, 1.645, 0.088], [0.07, 0.062, 0.03], 8, 5), MAT.BRONZE, HD); // closed face plate
    if (CM) b.add(ball([0, 1.9, -0.01], [0.15, 0.05, 0.045], 8, 5), MAT.ACCENT, HD); // transverse crest
  }
  // ---- arms (bare, deltoid/biceps/forearm taper) + hands
  for (const s of [1, -1]) {
    const U = s > 0 ? B.UARM_L : B.UARM_R, F = s > 0 ? B.FARM_L : B.FARM_R, x = 0.21 * s;
    const upper = (a, y) => (y > 1.42 ? blend(y, 1.45, 0.05, B.CHEST, U) : blend(y, 1.18, 0.07, U, F));
    b.add(ball([x, 1.465, 0], [0.066, 0.062, 0.062], E[0], E[1]), MAT.SKIN, () => [B.CHEST, U, 0.55]);
    b.add(loft([{ y: 1.47, rx: 0.052, rz: 0.054, cx: x }, { y: 1.38, rx: 0.056, rz: 0.058, cx: x }, { y: 1.28, rx: 0.049, rz: 0.05, cx: x }, { y: 1.19, rx: 0.04, rz: 0.04, cx: x }], S, false), MAT.SKIN, upper);
    b.add(ball([x, 1.18, 0], [0.042, 0.042, 0.042], E[0], E[1]), MAT.SKIN, () => [U, F, 0.5]);
    b.add(loft([{ y: 1.18, rx: 0.04, rz: 0.04, cx: x }, { y: 1.09, rx: 0.043, rz: 0.042, cx: x }, { y: 0.99, rx: 0.035, rz: 0.034, cx: x }, { y: 0.9, rx: 0.029, rz: 0.026, cx: x }], S, false), MAT.SKIN, (a, y) => blend(y, 1.18, 0.07, U, F));
    const hz = s > 0 ? 0.0 : 0.03; // right hand closes around the spear
    b.add(ball([x, 0.885, hz], [0.032, 0.045, 0.026], E[0], E[1]), MAT.SKIN, one(F), s > 0 ? 'handL' : 'handR');
  }
  // shield on the left forearm, held with the hand behind its rim plane
  if (!AR) {
    const rad = JV || CV ? 0.27 : 0.4, R = JV || CV ? 0.4 : 0.62, th = Math.asin(rad / R), apexY = SHIELD_PLANE_Y - R * (1 - Math.cos(th)), oval = HV;
    const sh = new THREE.SphereGeometry(R, hi ? 24 : 10, hi ? 6 : 2, 0, Math.PI * 2, 0, th); if (oval) sh.scale(0.66, 1, 1.35); sh.rotateX(Math.PI); sh.translate(0.21, apexY + R, 0);
    b.add(sh, MAT.ACCENT, one(B.FARM_L), 'shield');
    const rim = new THREE.TorusGeometry(rad, 0.022, 5, hi ? 28 : 14); rim.rotateX(Math.PI / 2); if (oval) rim.scale(0.66, 1, 1.35); rim.translate(0.21, SHIELD_PLANE_Y, 0); b.add(rim, CM ? MAT.GOLD : MAT.BRONZE, one(B.FARM_L), 'shield');
    b.add(ball([0.21, apexY + 0.004, 0], [0.06, 0.022, 0.06], 8, 3), CM ? MAT.GOLD : MAT.BRONZE, one(B.FARM_L), 'shield');
    if (hi && !JV && !CV) { const ring = new THREE.TorusGeometry(0.27, 0.011, 4, 24); ring.rotateX(Math.PI / 2); if (oval) ring.scale(0.66, 1, 1.35); ring.translate(0.21, apexY + 0.085, 0); b.add(ring, CM ? MAT.GOLD : MAT.BRONZE, one(B.FARM_L), 'shield'); }
  } else { // self bow: limbs run along local Z (up when the arm is raised), tips curve forward (-Y)
    const pts = [], rad = [], N = hi ? 9 : 5; for (let k = 0; k <= N; k++) { const z = -0.55 + (1.1 * k) / N; pts.push([0.21, 0.87 - 0.16 * (z / 0.55) ** 2 * (-1) * -1 + 0, z]); rad.push(0.008 + 0.012 * (1 - Math.abs(z / 0.55))); }
    b.add(tube(pts, rad, hi ? 5 : 3), MAT.WOOD, one(B.FARM_L), 'bow');
    b.add(tube([[0.21, pts[0][1], -0.55], [0.21, pts[N][1], 0.55]], [0.004, 0.004], 3), MAT.TAN, one(B.FARM_L), 'bow');
    b.add(ball([0.21, 0.87, 0], [0.028, 0.045, 0.028], 6, 4), MAT.LEATHER, one(B.FARM_L), 'bow'); // grip wrap
  }
  if (AR) { // quiver on the back
    const q = new THREE.CylinderGeometry(0.055, 0.045, 0.5, hi ? 8 : 5, 1, true); q.rotateZ(0.25); q.translate(-0.08, 1.3, -0.17); b.add(q, MAT.LEATHER, one(B.CHEST));
    for (const k of [-0.03, 0.0, 0.03]) { const c = new THREE.ConeGeometry(0.014, 0.07, 4); c.translate(-0.08 + k - 0.05, 1.62, -0.17); b.add(c, MAT.BRONZE, one(B.CHEST)); }
  }
  if (CM) { // standard on the back: pole + flag
    b.add(tube([[0, 0.95, -0.16], [0, 2.7, -0.16]], [0.02, 0.016], 5), MAT.WOOD, one(B.CHEST));
    const fl = new THREE.BufferGeometry(); fl.setAttribute('position', new THREE.Float32BufferAttribute([0, 2.68, -0.16, 0.6, 2.68, -0.16, 0.6, 2.3, -0.16, 0, 2.3, -0.16], 3)); fl.setIndex([0, 1, 2, 0, 2, 3]); fl.computeVertexNormals(); b.add(fl, MAT.ACCENT, one(B.CHEST));
    const tp = new THREE.ConeGeometry(0.03, 0.12, 5); tp.translate(0, 2.76, -0.16); b.add(tp, MAT.GOLD, one(B.CHEST));
  }

  // ---- legs: quadriceps, knee, calf, greaves, sandals
  for (const s of [1, -1]) {
    const T = s > 0 ? B.THIGH_L : B.THIGH_R, Sh = s > 0 ? B.SHIN_L : B.SHIN_R, F = s > 0 ? B.FOOT_L : B.FOOT_R, x = 0.1 * s;
    const thighSkin = (a, y) => (y > 0.9 ? blend(y, 0.96, 0.06, B.PELVIS, T) : blend(y, 0.52, 0.07, T, Sh));
    b.add(loft([{ y: 0.99, rx: 0.088, rz: 0.092, cx: x }, { y: 0.86, rx: 0.088, rz: 0.1, cx: x, cz: 0.008 }, { y: 0.7, rx: 0.075, rz: 0.086, cx: x, cz: 0.006 }, { y: 0.58, rx: 0.056, rz: 0.06, cx: x }, { y: 0.52, rx: 0.052, rz: 0.054, cx: x }], S, false), MAT.SKIN, thighSkin);
    b.add(ball([x, 0.52, 0.004], [0.054, 0.056, 0.056], E[0], E[1]), MAT.SKIN, () => [T, Sh, 0.5]);
    const shinSkin = (a, y) => (y < 0.15 ? blend(y, 0.1, 0.04, Sh, F) : blend(y, 0.52, 0.07, T, Sh));
    b.add(loft([{ y: 0.52, rx: 0.052, rz: 0.054, cx: x }, { y: 0.42, rx: 0.058, rz: 0.068, cx: x, cz: -0.012 }, { y: 0.28, rx: 0.045, rz: 0.048, cx: x, cz: -0.004 }, { y: 0.16, rx: 0.033, rz: 0.035, cx: x }, { y: 0.09, rx: 0.036, rz: 0.038, cx: x }], S, false), MAT.SKIN, shinSkin);
    if (ARMOR) b.add(loft([{ y: 0.5, rx: 0.062, rz: 0.066, cx: x, cz: 0.006 }, { y: 0.4, rx: 0.066, rz: 0.075, cx: x, cz: -0.004 }, { y: 0.28, rx: 0.052, rz: 0.056, cx: x, cz: 0.0 }, { y: 0.17, rx: 0.043, rz: 0.046, cx: x }], S, false), MAT.BRONZE, one(Sh)); // greave
    b.add(ball([x, 0.045, 0.045], [0.044, 0.036, 0.112], E[0], E[1]), MAT.LEATHER, one(F)); // sandal/boot
    if (hi) { b.add(ball([x, 0.08, -0.03], [0.04, 0.032, 0.04], 8, 5), MAT.LEATHER, one(F)); b.add(ball([x, 0.1, 0.02], [0.04, 0.012, 0.045], 8, 4), MAT.TAN, one(F)); }
  }
  // ---- weapon in the right hand (rigid to the spear bone, pivot at the hand)
  const hx = -0.21, hz = 0.03;
  if (!AR) {
    const top = HV ? 1.75 : JV ? 1.5 : CV ? 2.6 : 2.25, rr = HV ? 0.019 : JV ? 0.0115 : 0.0155;
    if (CM) { // xiphos
      b.add(loft([{ y: 0.98, rx: 0.02, rz: 0.006, cx: hx, cz: hz }, { y: 1.25, rx: 0.03, rz: 0.007, cx: hx, cz: hz }, { y: 1.5, rx: 0.022, rz: 0.006, cx: hx, cz: hz }, { y: 1.62, rx: 0.002, rz: 0.002, cx: hx, cz: hz }], hi ? 6 : 4, false), MAT.BRONZE, one(B.SPEAR));
      b.add(ball([hx, 0.98, hz], [0.07, 0.014, 0.02], 6, 3), MAT.GOLD, one(B.SPEAR)); b.add(ball([hx, 0.84, hz], [0.022, 0.07, 0.022], 6, 4), MAT.LEATHER, one(B.SPEAR));
    } else {
      const shaft = new THREE.CylinderGeometry(rr, rr, top, hi ? 6 : 4, 1, true); shaft.translate(hx, top / 2, hz); b.add(shaft, MAT.WOOD, one(B.SPEAR));
      const L = JV ? 0.8 : 1;
      const leaf = loft([{ y: top - 0.01, rx: 0.017, rz: 0.017, cx: hx, cz: hz }, { y: top + 0.05 * L, rx: 0.036 * L, rz: 0.011, cx: hx, cz: hz }, { y: top + 0.15 * L, rx: 0.03 * L, rz: 0.009, cx: hx, cz: hz }, { y: top + 0.3 * L, rx: 0.002, rz: 0.002, cx: hx, cz: hz }], hi ? 6 : 4, false); b.add(leaf, MAT.BRONZE, one(B.SPEAR));
      if (!JV) { const butt = new THREE.ConeGeometry(0.019, 0.14, 5); butt.rotateX(Math.PI); butt.translate(hx, -0.07, hz); b.add(butt, MAT.BRONZE, one(B.SPEAR)); }
      if (hi) { const grip = new THREE.CylinderGeometry(rr + 0.005, rr + 0.005, 0.16, 6, 1, true); grip.translate(hx, 0.88, hz); b.add(grip, MAT.LEATHER, one(B.SPEAR)); }
    }
  }
  if (CV) { const n = b.pos.length / 3; b.tags.rider = [[0, n]]; addHorse(b, hi); b.tags.horse = [[n, b.pos.length / 3]]; }
  const out = b.build(); if (CV) out.userData.cav = true; return out;
}

// ---------- horse ----------
/** Barrel cross-sections along z: half width, half height, centre height. */
export const HORSE_BARREL = [[-1.04, 0.15, 0.19, 1.3], [-0.9, 0.25, 0.28, 1.3], [-0.65, 0.295, 0.31, 1.27], [-0.3, 0.305, 0.33, 1.2], [0.05, 0.31, 0.35, 1.15], [0.4, 0.3, 0.36, 1.19], [0.7, 0.26, 0.36, 1.25], [0.95, 0.19, 0.3, 1.25], [1.08, 0.1, 0.2, 1.22]];
export function barrelAt(z) {
  const R = HORSE_BARREL; if (z <= R[0][0] || z >= R[R.length - 1][0]) return null;
  let i = 0; while (z > R[i + 1][0]) i++; const u = (z - R[i][0]) / (R[i + 1][0] - R[i][0]), a = R[i], c = R[i + 1];
  return { rx: a[1] + (c[1] - a[1]) * u, ry: a[2] + (c[2] - a[2]) * u, cy: a[3] + (c[3] - a[3]) * u };
}
// Elliptical sections stacked along Z: {z, rx, ry, cy, cx}; a0..a1 is the arc swept from the top (0 = back, PI = belly).
function loftZ(rings, segs, caps = true, a0 = 0, a1 = Math.PI * 2) {
  const pos = [], idx = [], n = rings.length, per = a1 - a0 >= Math.PI * 2 - 1e-6 ? segs : segs + 1;
  for (const r of rings) for (let i = 0; i < per; i++) { const a = a0 + ((a1 - a0) * i) / segs; pos.push((r.cx || 0) + Math.sin(a) * r.rx, r.cy + Math.cos(a) * r.ry, r.z); }
  const wrap = per === segs;
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < segs; i++) { const a = j * per + i, b = j * per + (wrap ? (i + 1) % segs : i + 1), c = a + per, d = b + per; idx.push(a, b, c, b, d, c); }
  if (caps && wrap) { const f = pos.length / 3; pos.push(rings[0].cx || 0, rings[0].cy, rings[0].z); pos.push(rings[n - 1].cx || 0, rings[n - 1].cy, rings[n - 1].z);
    for (let i = 0; i < segs; i++) { idx.push(f, (i + 1) % segs, i); idx.push(f + 1, (n - 1) * segs + i, (n - 1) * segs + (i + 1) % segs); } }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
const SOCK = { a: true, d: true }; // white socks on the near fore and off hind
function addHorse(b, hi) {
  const HS = hi ? 14 : 5, E = hi ? [9, 6] : [5, 3], bodySk = (x, y, z) => [B.RUMP, B.FORE, ss(-0.15, 0.4, z)];
  const barrel = HORSE_BARREL.map(([z, rx, ry, cy]) => ({ z, rx, ry, cy }));
  b.add(loftZ(barrel, HS), MAT.COAT, bodySk);
  // muscle masses: buttocks, shoulders, gaskin hint, chest
  for (const s of [1, -1]) {
    b.add(ball([0.15 * s, 1.34, -0.9], [0.14, 0.17, 0.15], E[0], E[1]), MAT.COAT, bodySk);
    b.add(ball([0.255 * s, 1.18, 0.5], [0.07, 0.2, 0.2], E[0], E[1]), MAT.COAT, bodySk);
  }
  b.add(ball([0, 1.2, 0.93], [0.17, 0.25, 0.14], E[0], E[1]), MAT.COAT, bodySk);
  b.add(ball([0, 1.34, -0.98], [0.2, 0.22, 0.14], E[0], E[1]), MAT.COAT, bodySk); // rounded croup
  // neck, head
  const neckSk = (x, y) => (y < 1.78 ? [B.FORE, B.NECK, ss(1.4, 1.62, y)] : [B.NECK, B.HHEAD, ss(1.95, 2.12, y)]);
  b.add(tube([[0, 1.43, 0.72], [0, 1.62, 0.93], [0, 1.83, 1.14], [0, 2.02, 1.33]], [0.22, 0.17, 0.125, 0.1], HS, 0.72), MAT.COAT, neckSk);
  const HD = () => [B.HHEAD, B.HHEAD, 0];
  b.add(tube([[0, 2.04, 1.35], [0, 1.9, 1.5], [0, 1.74, 1.64], [0, 1.6, 1.76]], [0.1, 0.095, 0.07, 0.055], HS, 0.85), MAT.COAT, HD);
  b.add(ball([0, 1.88, 1.43], [0.105, 0.125, 0.125], E[0], E[1]), MAT.COAT, HD); // jaw + cheek
  b.add(ball([0, 1.595, 1.78], [0.052, 0.05, 0.066], E[0], E[1]), MAT.COAT, HD); // muzzle
  for (const s of [1, -1]) {
    const ear = new THREE.ConeGeometry(0.032, 0.15, 4); ear.rotateX(0.35); ear.translate(0.06 * s, 2.12, 1.33); b.add(ear, MAT.COAT, HD);
    if (hi) { b.add(ball([0.088 * s, 1.93, 1.5], [0.012, 0.015, 0.017], 5, 4), MAT.EYE, HD); b.add(ball([0.035 * s, 1.6, 1.82], [0.012, 0.016, 0.012], 4, 3), MAT.EYE, HD); }
    // cheek strap
    b.add(tube([[0.085 * s, 2.0, 1.4], [0.092 * s, 1.88, 1.52], [0.07 * s, 1.72, 1.7]], [0.006, 0.006, 0.006], 3), MAT.LEATHER, HD);
  }
  if (hi) b.add(tube([[-0.07, 1.74, 1.66], [-0.06, 1.72, 1.74], [0, 1.705, 1.8], [0.06, 1.72, 1.74], [0.07, 1.74, 1.66]], [0.006, 0.006, 0.006, 0.006, 0.006], 3), MAT.LEATHER, HD);
  // mane along the crest, forelock
  const mk = hi ? 8 : 4;
  for (let k = 0; k < mk; k++) { const u = k / (mk - 1), y = 1.5 + u * 0.56, z = 0.74 + u * 0.6; b.add(ball([0, y + 0.1, z - 0.13], [0.02, 0.075, 0.05], 5, 3, [-0.45, 0]), MAT.MANE, neckSk); }
  b.add(ball([0, 2.12, 1.4], [0.025, 0.07, 0.05], 5, 3), MAT.MANE, HD);
  // tail
  b.add(tube([[0, 1.53, -1.0], [0, 1.4, -1.18], [0, 1.08, -1.3], [0, 0.72, -1.27]], [0.05, 0.08, 0.065, 0.025], hi ? 7 : 4), MAT.MANE, (x, y, z) => [B.RUMP, B.TAIL, ss(-1.02, -1.12, z)]);
  // saddle cloth in team colour, saddle, girth
  const at = (z, g) => { const r = barrelAt(z); return { z, rx: r.rx + g, ry: r.ry + g, cy: r.cy }; };
  b.add(loftZ([-0.4, -0.2, 0, 0.2, 0.34].map((z) => at(z, 0.014)), HS, false, -2.3, 2.3), MAT.ACCENT, bodySk);
  b.add(ball([0, 1.505, -0.06], [0.22, 0.05, 0.3], E[0], E[1]), MAT.LEATHER, bodySk);
  b.add(ball([0, 1.555, 0.2], [0.06, 0.07, 0.04], 6, 4), MAT.LEATHER, bodySk); b.add(ball([0, 1.55, -0.31], [0.16, 0.06, 0.05], 6, 4), MAT.LEATHER, bodySk);
  b.add(loftZ([at(0.22, 0.026), at(0.27, 0.026)], HS, false), MAT.LEATHER, bodySk);
  // legs
  const legs = { a: [B.FL_U, B.FL_L, B.FL_H, B.FORE, 1, true], b: [B.FR_U, B.FR_L, B.FR_H, B.FORE, -1, true], c: [B.BL_U, B.BL_L, B.BL_H, B.RUMP, 1, false], d: [B.BR_U, B.BR_L, B.BR_H, B.RUMP, -1, false] };
  const LS = hi ? 9 : 5;
  for (const k in legs) {
    const [U, L, H, par, sx, front] = legs[k], x = 0.2 * sx, cz = front ? HF.fz : HF.bz, yTop = front ? HF.shoulder : HF.hip, yk = front ? HF.knee : HF.hock, yf = HF.fet;
    const sk = (px, y) => (y > yk + 0.06 ? blend(y, yTop, 0.1, par, U) : y > yf + 0.05 ? blend(y, yk, 0.05, U, L) : blend(y, yf, 0.04, L, H));
    const coat = SOCK[k] ? (y) => (y < 0.42 ? MAT.BLAZE : MAT.COAT) : () => MAT.COAT;
    const rings = front
      ? [{ y: 1.32, rx: 0.12, rz: 0.17, cx: x, cz }, { y: 1.1, rx: 0.095, rz: 0.13, cx: x, cz }, { y: 0.85, rx: 0.072, rz: 0.095, cx: x, cz }, { y: 0.68, rx: 0.06, rz: 0.075, cx: x, cz }, { y: 0.6, rx: 0.05, rz: 0.062, cx: x, cz }, { y: 0.5, rx: 0.038, rz: 0.044, cx: x, cz }, { y: 0.32, rx: 0.034, rz: 0.04, cx: x, cz }, { y: 0.22, rx: 0.04, rz: 0.044, cx: x, cz }]
      : [{ y: 1.38, rx: 0.14, rz: 0.21, cx: x, cz: cz - 0.03 }, { y: 1.14, rx: 0.115, rz: 0.17, cx: x, cz: cz - 0.03 }, { y: 0.92, rx: 0.085, rz: 0.12, cx: x, cz: cz - 0.02 }, { y: 0.74, rx: 0.062, rz: 0.088, cx: x, cz: cz - 0.02 }, { y: 0.64, rx: 0.05, rz: 0.085, cx: x, cz: cz - 0.035 }, { y: 0.54, rx: 0.038, rz: 0.048, cx: x, cz }, { y: 0.32, rx: 0.034, rz: 0.04, cx: x, cz }, { y: 0.22, rx: 0.04, rz: 0.044, cx: x, cz }];
    const sock = SOCK[k]; for (const r of rings) { r.rx *= 1.2; r.rz *= 1.15; }
    b.add(loft(rings.filter((r) => r.y > 0.45 || !sock), LS, false), MAT.COAT, sk);
    if (sock) b.add(loft(rings.filter((r) => r.y <= 0.5), LS, false), MAT.BLAZE, sk);
    b.add(ball([x, yk, cz - (front ? 0 : 0.03)], front ? [0.052, 0.06, 0.066] : [0.05, 0.075, 0.09], E[0], E[1]), MAT.COAT, sk); // knee / hock
    b.add(loft([{ y: 0.24, rx: 0.04, rz: 0.044, cx: x, cz }, { y: 0.2, rx: 0.046, rz: 0.05, cx: x, cz }, { y: 0.14, rx: 0.038, rz: 0.044, cx: x, cz: cz + 0.01 }, { y: 0.09, rx: 0.04, rz: 0.046, cx: x, cz: cz + 0.015 }], LS, false), sock ? MAT.BLAZE : MAT.COAT, sk); // fetlock + pastern
    b.add(loft([{ y: 0.1, rx: 0.046, rz: 0.054, cx: x, cz: cz + 0.015 }, { y: 0.05, rx: 0.058, rz: 0.07, cx: x, cz: cz + 0.025 }, { y: 0.0, rx: 0.064, rz: 0.08, cx: x, cz: cz + 0.032 }], LS, true), MAT.HOOF, sk); // hoof
  }
}
