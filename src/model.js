import * as THREE from 'three';
import { B, MAT } from './skeleton.js';

const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// weight of the lower bone: 0 above the joint band, 1 below it
const blend = (y, yj, band, up, dn) => [up, dn, ss(yj + band, yj - band, y)];

class Builder {
  constructor() { this.pos = []; this.nrm = []; this.mat = []; this.skin = []; this.idx = []; }
  add(geo, mat, skinFn) {
    const g = geo.index ? geo : geo; // all inputs indexed
    const p = g.attributes.position, n = g.attributes.normal, base = this.pos.length / 3;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      this.pos.push(x, y, z); this.nrm.push(n.getX(i), n.getY(i), n.getZ(i));
      this.mat.push(mat); const s = skinFn(x, y, z); this.skin.push(s[0], s[1], s[2]);
    }
    for (let i = 0; i < g.index.count; i++) this.idx.push(g.index.getX(i) + base);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('aMat', new THREE.Float32BufferAttribute(this.mat, 1));
    g.setAttribute('aSkin', new THREE.Float32BufferAttribute(this.skin, 3));
    g.setIndex(this.idx);
    return g;
  }
}

let LS = 3;
const limb = (x, yTop, yBot, rTop, rBot, segs, z = 0) => {
  const g = new THREE.CylinderGeometry(rTop, rBot, yTop - yBot, segs, LS, true);
  g.translate(x, (yTop + yBot) / 2, z); return g;
};
const ball = (c, r, ws, hs) => {
  const g = new THREE.SphereGeometry(1, ws, hs); g.scale(r[0], r[1], r[2]); g.translate(c[0], c[1], c[2]); return g;
};
// elliptical loft with closed ends
function loft(rings, segs) {
  const pos = [], idx = [];
  for (const r of rings) for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2; pos.push(Math.sin(a) * r.rx, r.y, Math.cos(a) * r.rz + (r.zc || 0));
  }
  const n = rings.length;
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < segs; i++) {
    const a = j * segs + i, b = j * segs + (i + 1) % segs, c = a + segs, d = b + segs;
    idx.push(a, c, b, b, c, d);
  }
  const bot = pos.length / 3; pos.push(0, rings[0].y, rings[0].zc || 0);
  const top = bot + 1; pos.push(0, rings[n - 1].y, rings[n - 1].zc || 0);
  for (let i = 0; i < segs; i++) {
    idx.push(bot, i, (i + 1) % segs);
    idx.push(top, (n - 1) * segs + (i + 1) % segs, (n - 1) * segs + i);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}

/** detail 0 = full, 1 = mid (fewer segments) */
export function buildSoldier(detail = 0) {
  const R = detail === 0 ? 10 : 5, H = detail === 0 ? 8 : 3; LS = detail === 0 ? 3 : 2;
  const b = new Builder();
  const pel = () => [B.PELVIS, B.PELVIS, 0];

  // torso (tunic) + skirt
  const torso = loft([
    { y: 0.9, rx: 0.165, rz: 0.105 }, { y: 1.0, rx: 0.17, rz: 0.11 }, { y: 1.12, rx: 0.145, rz: 0.1 },
    { y: 1.28, rx: 0.185, rz: 0.12 }, { y: 1.42, rx: 0.205, rz: 0.125 }, { y: 1.5, rx: 0.19, rz: 0.11 },
    { y: 1.56, rx: 0.07, rz: 0.07 }], R + 2);
  b.add(torso, MAT.TUNIC, (x, y) => y < 1.04 ? pel() : [B.PELVIS, B.CHEST, ss(1.04, 1.2, y)]);
  const skirt = new THREE.CylinderGeometry(0.2, 0.255, 0.26, R + 4, 1, true); skirt.translate(0, 0.82, 0);
  b.add(skirt, MAT.TUNIC, pel);
  const belt = new THREE.CylinderGeometry(0.178, 0.178, 0.06, R + 2, 1, true); belt.translate(0, 0.96, 0);
  b.add(belt, MAT.LEATHER, pel);

  // neck + head + helmet
  b.add(limb(0, 1.62, 1.5, 0.05, 0.055, R), MAT.SKIN, (x, y) => blend(y, 1.56, 0.04, B.CHEST, B.HEAD));
  b.add(ball([0, 1.7, 0.012], [0.085, 0.105, 0.1], R + 2, H), MAT.SKIN, () => [B.HEAD, B.HEAD, 0]);
  if (detail === 0) b.add(ball([0, 1.69, 0.108], [0.016, 0.026, 0.026], 6, 4), MAT.SKIN, () => [B.HEAD, B.HEAD, 0]);
  const helm = new THREE.SphereGeometry(1, R + 4, H, 0, Math.PI * 2, 0, 1.95); helm.scale(0.1, 0.125, 0.118); helm.translate(0, 1.71, 0.0);
  b.add(helm, MAT.BRONZE, () => [B.HEAD, B.HEAD, 0]);
  b.add(ball([0, 1.855, -0.03], [0.014, 0.06, 0.15], 6, 5), MAT.ACCENT, () => [B.HEAD, B.HEAD, 0]);
  b.add(ball([0, 1.8, -0.15], [0.012, 0.09, 0.03], 5, 4), MAT.ACCENT, () => [B.HEAD, B.HEAD, 0]);

  // arms
  for (const s of [1, -1]) {
    const U = s > 0 ? B.UARM_L : B.UARM_R, F = s > 0 ? B.FARM_L : B.FARM_R, x = 0.21 * s;
    b.add(ball([x, 1.48, 0], [0.062, 0.062, 0.062], R, H), MAT.TUNIC, () => [B.CHEST, U, 0.5]);
    const upper = (xx, y) => y > 1.42 ? blend(y, 1.45, 0.05, B.CHEST, U) : blend(y, 1.18, 0.07, U, F);
    b.add(limb(x, 1.48, 1.18, 0.05, 0.042, R), MAT.SKIN, (a, y) => upper(a, y));
    b.add(limb(x, 1.48, 1.34, 0.054, 0.05, R), MAT.TUNIC, (a, y) => upper(a, y)); // sleeve
    b.add(ball([x, 1.18, 0], [0.043, 0.043, 0.043], R, H), MAT.SKIN, () => [U, F, 0.5]);
    b.add(limb(x, 1.18, 0.9, 0.041, 0.031, R), MAT.SKIN, (a, y) => blend(y, 1.18, 0.07, U, F));
    b.add(ball([x, 0.88, s > 0 ? 0 : 0.03], [0.036, 0.04, 0.036], R, H), MAT.SKIN, () => [F, F, 0]);
  }
  // shield on left forearm (disc axis = forearm axis; face points down the forearm)
  const face = new THREE.CylinderGeometry(0.36, 0.36, 0.05, detail ? 12 : 28); face.translate(0.21, 1.06, 0);
  const rim = new THREE.CylinderGeometry(0.385, 0.385, 0.06, detail ? 12 : 28); rim.translate(0.21, 1.075, 0);
  const boss = new THREE.SphereGeometry(0.07, detail ? 5 : 8, detail ? 2 : 4, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2); boss.translate(0.21, 1.03, 0);
  b.add(face, MAT.ACCENT, () => [B.FARM_L, B.FARM_L, 0]);
  b.add(rim, MAT.BRONZE, () => [B.FARM_L, B.FARM_L, 0]);
  b.add(boss, MAT.BRONZE, () => [B.FARM_L, B.FARM_L, 0]);

  // legs
  for (const s of [1, -1]) {
    const T = s > 0 ? B.THIGH_L : B.THIGH_R, S = s > 0 ? B.SHIN_L : B.SHIN_R, F = s > 0 ? B.FOOT_L : B.FOOT_R, x = 0.1 * s;
    const thighSkin = (a, y) => y > 0.9 ? blend(y, 0.96, 0.06, B.PELVIS, T) : blend(y, 0.52, 0.07, T, S);
    b.add(limb(x, 0.98, 0.52, 0.085, 0.058, R), MAT.SKIN, thighSkin);
    b.add(ball([x, 0.52, 0], [0.058, 0.058, 0.058], R, H), MAT.SKIN, () => [T, S, 0.5]);
    b.add(limb(x, 0.52, 0.1, 0.056, 0.036, R), MAT.SKIN, (a, y) => y < 0.14 ? blend(y, 0.1, 0.04, S, F) : blend(y, 0.52, 0.07, T, S));
    b.add(limb(x, 0.5, 0.17, 0.064, 0.047, R), MAT.BRONZE, () => [S, S, 0]); // greave
    b.add(ball([x, 0.05, 0.05], [0.052, 0.045, 0.125], R, H), MAT.LEATHER, () => [F, F, 0]); // boot
  }

  // spear (rigid to its own bone, pivot at right hand)
  const hx = -0.21, hz = 0.04;
  b.add(limb(hx, 2.25, 0.0, 0.0145, 0.0145, 5, hz), MAT.WOOD, () => [B.SPEAR, B.SPEAR, 0]);
  const tip = new THREE.ConeGeometry(0.032, 0.28, 6); tip.translate(hx, 2.39, hz);
  b.add(tip, MAT.BRONZE, () => [B.SPEAR, B.SPEAR, 0]);
  const butt = new THREE.ConeGeometry(0.02, 0.1, 5); butt.rotateX(Math.PI); butt.translate(hx, -0.05, hz);
  b.add(butt, MAT.BRONZE, () => [B.SPEAR, B.SPEAR, 0]);
  return b.build();
}
