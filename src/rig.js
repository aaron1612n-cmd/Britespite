// Procedural clip authoring (keyframes + foot-planted gait + two-bone leg IK) baked to bone matrices.
import * as THREE from 'three';
import { BONES, NB, B, THIGH_LEN, SHIN_LEN } from './skeleton.js';
import { CLIPS, frameCount } from './clips.js';

const { Matrix4, Quaternion, Vector3, Euler } = THREE;
const V = (x, y, z) => new Vector3(x, y, z);

export const BASE = {
  px: 0, py: -0.03, pz: 0, prx: 0, pry: 0, prz: 0, crx: 0.02, cry: 0, crz: 0, hrx: 0, hry: 0, hrz: 0,
  ulx: -0.12, ulz: 0.05, flx: -1.85, urx: -0.35, urz: -0.05, frx: -1.0, spx: 0, spy: 0.95, spz: 0.3,
  lfx: 0.12, lfy: 0.08, lfz: 0.14, rfx: -0.12, rfy: 0.08, rfz: -0.1, lfp: 0, rfp: 0,
  ik: 1, tlx: 0, tlz: 0, slx: 0, trx: 0, trz: 0, srx: 0,
};
const CH = Object.keys(BASE);

function keyed(keys, dur, loop) {
  const n = keys.length;
  const vals = CH.map((c) => keys.map((k) => (k[c] !== undefined ? k[c] : BASE[c])));
  return (t) => {
    if (loop) t = ((t % dur) + dur) % dur; else t = Math.min(Math.max(t, 0), dur);
    let i = 0; while (i < n - 2 && t > keys[i + 1].t) i++;
    const t0 = keys[i].t, t1 = keys[i + 1].t, u = (t - t0) / (t1 - t0), h = t1 - t0;
    const P = {};
    CH.forEach((c, ci) => {
      const v = vals[ci];
      const pv = i > 0 ? v[i - 1] : (loop ? v[n - 2] : v[i]), pt = i > 0 ? keys[i - 1].t : (loop ? keys[n - 2].t - dur : t0 - h);
      const nv = i + 2 < n ? v[i + 2] : (loop ? v[1] : v[i + 1]), nt = i + 2 < n ? keys[i + 2].t : (loop ? keys[1].t + dur : t1 + h);
      const m0 = (v[i + 1] - pv) / (t1 - pt) * h, m1 = (nv - v[i]) / (nt - t0) * h;
      const u2 = u * u, u3 = u2 * u;
      P[c] = (2 * u3 - 3 * u2 + 1) * v[i] + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * v[i + 1] + (u3 - u2) * m1;
    });
    return P;
  };
}

function gait(g) {
  const foot = (p) => {
    p = ((p % 1) + 1) % 1; const s = g.stance, za = (g.v * s * g.T) / 2;
    if (p < s) return { z: za * (1 - (2 * p) / s), y: 0, pitch: 0 };
    const u = (p - s) / (1 - s), e = u * u * (3 - 2 * u);
    return { z: -za + 2 * za * e, y: g.lift * Math.sin(Math.PI * u), pitch: 0.35 * (1 - u) - 0.2 * u };
  };
  return (t) => {
    const ph = t / g.T, P = { ...BASE };
    const l = foot(ph), r = foot(ph + 0.5);
    P.lfx = 0.11; P.rfx = -0.11; P.lfz = l.z; P.rfz = r.z; P.lfy = 0.08 + l.y; P.rfy = 0.08 + r.y; P.lfp = l.pitch; P.rfp = r.pitch;
    P.py = -g.drop + g.bob * g.bobSign * Math.cos(4 * Math.PI * (ph - g.stance / 2));
    P.pry = g.twist * Math.sin(2 * Math.PI * ph); P.cry = -P.pry * 1.6; P.prz = 0.02 * Math.sin(2 * Math.PI * ph);
    P.px = 0.012 * Math.sin(2 * Math.PI * ph); P.prx = g.lean * 0.4; P.crx = g.lean;
    P.ulx = BASE.ulx + g.sway * Math.sin(2 * Math.PI * ph); P.urx = BASE.urx - g.sway * Math.sin(2 * Math.PI * ph);
    P.spx = 0.04 * Math.sin(2 * Math.PI * ph); P.spy = g.spy; P.spz = g.spz;
    return P;
  };
}

const lunge = { lfx: 0.14, lfz: 0.3, rfx: -0.14, rfz: -0.18 };
export const POSES = [
  keyed([{ t: 0 }, { t: 0.8, crx: 0.035, hry: 0.12, py: -0.035, px: 0.01 }, { t: 1.6, crx: 0.02, hry: -0.1, py: -0.03, px: -0.01 }, { t: 2.4 }], 2.4, true),
  gait({ T: 0.8, v: 1.4, stance: 0.58, lift: 0.1, drop: 0.075, bob: 0.014, bobSign: 1, twist: 0.07, lean: 0.04, sway: 0.05, spy: 0.95, spz: 0.3 }),
  gait({ T: 0.62, v: 3.6, stance: 0.35, lift: 0.22, drop: 0.13, bob: 0.04, bobSign: -1, twist: 0.1, lean: 0.28, sway: 0.1, spy: 0.35, spz: 0.95 }),
  keyed([
    { t: 0 },
    { t: 0.1, lfy: 0.16, lfz: 0.22, rfz: -0.14, crx: 0.06 },
    { t: 0.2, ...lunge, crx: 0.12, cry: -0.4, pz: -0.05, urx: 0.6, frx: -1.4, spy: 0.12, spz: 1, py: -0.06 },
    { t: 0.4, ...lunge, crx: 0.22, cry: 0.45, pz: 0.16, py: -0.1, urx: -1.35, frx: -0.1, ulx: -0.5, spy: 0.06, spz: 1 },
    { t: 0.52, ...lunge, crx: 0.2, cry: 0.4, pz: 0.14, py: -0.1, urx: -1.3, frx: -0.15, ulx: -0.5, spy: 0.06, spz: 1 },
    { t: 0.68, lfy: 0.14, lfz: 0.2, rfz: -0.12, crx: 0.08, py: -0.05, spy: 0.5, spz: 0.8 },
    { t: 0.85 }], 0.85, false),
  keyed([{ t: 0 }, { t: 0.1, pz: -0.1, prx: -0.1, crx: -0.3, hrx: -0.25, urx: 0.3, ulx: 0.2, frx: -0.6, spy: 0.8, spz: 0.55 }, { t: 0.25, pz: -0.06, crx: -0.15, hrx: -0.1 }, { t: 0.45 }], 0.45, false),
  keyed([
    { t: 0, ik: 0 },
    { t: 0.3, ik: 0, py: -0.25, prx: -0.12, crx: -0.1, hrx: -0.3, tlx: -0.6, trx: -0.6, slx: 1.2, srx: 1.2, urx: 0.2, ulx: 0.2 },
    { t: 0.75, ik: 0, py: -0.4, prx: -0.9, crx: -0.2, hrx: -0.3, tlx: -0.3, trx: -0.3, slx: 0.4, srx: 0.4, ulz: 0.8, urz: -0.8, ulx: 0.3, urx: 0.3, spx: 0.3, spy: 0.05, spz: 0.9 },
    { t: 1.5, ik: 0, py: -0.5, prx: -1.5, crx: -0.1, hrx: -0.1, tlz: 0.15, trz: -0.15, slx: 0.1, srx: 0.1, ulz: 1.0, urz: -1.0, ulx: 0.6, urx: 0.6, flx: -0.2, frx: -0.2, spx: 0.3, spy: 0.02, spz: 1 }], 1.5, false),
  keyed([
    { t: 0, ik: 0 },
    { t: 0.3, ik: 0, py: -0.25, prx: 0.15, crx: 0.25, hrx: 0.2, tlx: -0.6, trx: -0.6, slx: 1.2, srx: 1.2 },
    { t: 0.75, ik: 0, py: -0.4, prx: 0.9, crx: 0.2, hrx: -0.3, tlx: 0.1, trx: 0.1, slx: 0.3, srx: 0.3, ulz: 0.6, urz: -0.6, ulx: -0.8, urx: -0.8, spx: 0.3, spy: 0.05, spz: 0.9 },
    { t: 1.5, ik: 0, py: -0.5, prx: 1.5, crx: 0.1, hrx: -0.6, tlx: 0.2, trx: 0.2, slx: 0.2, srx: 0.2, ulz: 0.9, urz: -0.9, ulx: -1.4, urx: -1.4, flx: -0.3, frx: -0.3, spx: 0.3, spy: 0.02, spz: 1 }], 1.5, false),
  // shoot (archer): side-on stance, bow arm out, string hand drawn to the cheek, release at 0.55 s
  keyed([
    { t: 0 },
    { t: 0.14, lfx: 0.2, lfz: 0.1, rfx: -0.2, rfz: -0.1, lfy: 0.12, ulx: -1.2, flx: -0.2, urx: -0.3, urz: -0.9, frx: -1.8, cry: -0.35, pry: -0.15, crx: 0.04 },
    { t: 0.5, lfx: 0.2, lfz: 0.1, rfx: -0.2, rfz: -0.1, ulx: -1.5, flx: -0.05, urx: -0.3, urz: -1.3, frx: -2.5, cry: -0.7, pry: -0.3, crx: 0.04, hry: 0.5 },
    { t: 0.6, lfx: 0.2, lfz: 0.1, rfx: -0.2, rfz: -0.1, ulx: -1.5, flx: -0.05, urx: -0.3, urz: -1.15, frx: -1.9, cry: -0.55, pry: -0.25, hry: 0.5 },
    { t: 0.85, lfx: 0.2, lfz: 0.1, rfx: -0.2, rfz: -0.1, ulx: -1.2, flx: -0.2, urx: -0.3, urz: -0.5, frx: -1.5, cry: -0.2, pry: -0.1, hry: 0.2 },
    { t: 1.1 }], 1.1, false),
  // throw (javelin): wind-up behind the shoulder, overarm release at 0.42 s
  keyed([
    { t: 0 },
    { t: 0.22, lfx: 0.14, lfz: 0.28, rfx: -0.14, rfz: -0.2, urx: 0.7, frx: -0.5, cry: -0.45, crx: 0.1, py: -0.06, spy: 0.45, spz: 0.9 },
    { t: 0.42, lfx: 0.14, lfz: 0.28, rfx: -0.14, rfz: -0.2, urx: -2.4, frx: -0.15, cry: 0.45, crx: 0.25, pz: 0.12, py: -0.1, spy: 0.3, spz: 0.95 },
    { t: 0.6, lfx: 0.14, lfz: 0.28, rfx: -0.14, rfz: -0.2, urx: -1.3, frx: -0.6, cry: 0.3, crx: 0.2, pz: 0.1, py: -0.08, spy: 0.6, spz: 0.8 },
    { t: 0.85 }], 0.85, false),
  // cheer: spear and shield raised, hopping
  keyed([
    { t: 0, ulx: -2.7, flx: -0.2, ulz: 0.2, urx: -2.9, frx: -0.15, spy: 1, spz: 0.05, crx: -0.05 },
    { t: 0.3, py: 0.05, lfy: 0.17, rfy: 0.17, ulx: -2.7, flx: -0.2, ulz: 0.2, urx: -2.9, frx: -0.15, spy: 1, spz: 0.05, crx: -0.08 },
    { t: 0.6, py: -0.07, ulx: -2.5, flx: -0.3, ulz: 0.2, urx: -2.7, frx: -0.2, spy: 1, spz: 0.08, crx: 0.02 },
    { t: 0.9, py: 0.05, lfy: 0.17, rfy: 0.17, ulx: -2.7, flx: -0.2, ulz: 0.2, urx: -2.9, frx: -0.15, spy: 1, spz: 0.05, crx: -0.08 },
    { t: 1.2, ulx: -2.7, flx: -0.2, ulz: 0.2, urx: -2.9, frx: -0.15, spy: 1, spz: 0.05, crx: -0.05 }], 1.2, true),
];

// ---------- pose -> skin matrices ----------
const bindInv = BONES.map((b) => new Matrix4().makeTranslation(...b.pivot).invert());
const off = BONES.map((b) => (b.parent < 0 ? V(...b.pivot) : V(...b.pivot).sub(V(...BONES[b.parent].pivot))));
const eq = (x, y, z) => new Quaternion().setFromEuler(new Euler(x, y, z, 'XYZ'));
const basisQ = (X, Y, Z) => new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(X, Y, Z));

function aimQuat(dir, ref) { // bone +Y -> dir
  const Y = dir.clone().normalize(); const Z = ref.clone().addScaledVector(Y, -ref.dot(Y)).normalize(); return basisQ(new Vector3().crossVectors(Y, Z), Y, Z);
}
function legIK(H, A, pole) {
  const d = A.clone().sub(H); let dist = d.length(); const max = (THIGH_LEN + SHIN_LEN) * 0.9995; if (dist > max) { d.multiplyScalar(max / dist); dist = max; }
  const u = d.clone().divideScalar(dist);
  const ca = (THIGH_LEN * THIGH_LEN + dist * dist - SHIN_LEN * SHIN_LEN) / (2 * THIGH_LEN * dist), a = Math.acos(Math.min(1, Math.max(-1, ca)));
  const p = pole.clone().addScaledVector(u, -pole.dot(u)).normalize();
  const K = H.clone().addScaledVector(u, Math.cos(a) * THIGH_LEN).addScaledVector(p, Math.sin(a) * THIGH_LEN);
  const t = K.clone().sub(H).normalize(), s = H.clone().add(d).sub(K).normalize();
  const mk = (dn) => { const Y = dn.clone().negate(); const Z = pole.clone().addScaledVector(Y, -pole.dot(Y)).normalize(); return basisQ(new Vector3().crossVectors(Y, Z), Y, Z); };
  return { thigh: mk(t), shin: mk(s) };
}

const _m = new Matrix4(), _t = new Matrix4();
export function poseMatrices(P) {
  const q = new Array(NB), W = new Array(NB), R = new Array(NB); // R = world rotation quats
  const comp = (i, parentW, rot) => { const m = new Matrix4().makeTranslation(off[i].x, off[i].y, off[i].z); if (parentW) m.premultiply(parentW); return m.multiply(new Matrix4().makeRotationFromQuaternion(rot)); };
  q[0] = eq(P.prx, P.pry, P.prz);
  W[0] = new Matrix4().makeTranslation(BONES[0].pivot[0] + P.px, BONES[0].pivot[1] + P.py, BONES[0].pivot[2] + P.pz).multiply(new Matrix4().makeRotationFromQuaternion(q[0]));
  R[0] = q[0].clone();
  const setB = (i, rot) => { q[i] = rot; W[i] = comp(i, W[BONES[i].parent], rot); R[i] = R[BONES[i].parent].clone().multiply(rot); };
  setB(1, eq(P.crx, P.cry, P.crz)); setB(2, eq(P.hrx, P.hry, P.hrz));
  setB(3, eq(P.ulx, 0, P.ulz)); setB(4, eq(P.flx, 0, 0)); setB(5, eq(P.urx, 0, P.urz)); setB(6, eq(P.frx, 0, 0));
  const yaw = P.pry, pole = V(Math.sin(yaw), 0, Math.cos(yaw));
  const yawQ = eq(0, yaw, 0);
  for (const s of [1, -1]) {
    const T = s > 0 ? B.THIGH_L : B.THIGH_R, S = s > 0 ? B.SHIN_L : B.SHIN_R, F = s > 0 ? B.FOOT_L : B.FOOT_R;
    const tgt = s > 0 ? V(P.lfx, P.lfy, P.lfz) : V(P.rfx, P.rfy, P.rfz), fp = s > 0 ? P.lfp : P.rfp;
    const H = V(0, 0, 0).copy(off[T]).applyMatrix4(W[0]);
    const ik = legIK(H, tgt, pole);
    const fkT = eq(s > 0 ? P.tlx : P.trx, 0, s > 0 ? P.tlz : P.trz), fkS = eq(s > 0 ? P.slx : P.srx, 0, 0);
    const ikT = R[0].clone().invert().multiply(ik.thigh);
    const lt = fkT.clone().slerp(ikT, P.ik); setB(T, lt);
    const ikS = R[T].clone().invert().multiply(ik.shin);
    setB(S, fkS.clone().slerp(ikS, P.ik));
    const footWorld = yawQ.clone().multiply(eq(fp, 0, 0));
    const ikF = R[S].clone().invert().multiply(footWorld);
    setB(F, new Quaternion().slerp(ikF, P.ik));
  }
  const aim = V(P.spx, P.spy, P.spz);
  const sw = aimQuat(aim, V(1, 0, 0));
  setB(B.SPEAR, R[B.FARM_R].clone().invert().multiply(sw));
  const out = new Float32Array(NB * 12);
  for (let i = 0; i < NB; i++) {
    _m.multiplyMatrices(W[i], bindInv[i]); const e = _m.elements;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) out[i * 12 + r * 4 + c] = e[c * 4 + r];
  }
  return out;
}

/** CPU skin of a built soldier geometry with baked matrices (for tests and ground fitting). */
export function skinVertices(geo, mats, out) {
  const p = geo.attributes.position, s = geo.attributes.aSkin, n = p.count;
  out = out || new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = s.getX(i) * 12, b = s.getY(i) * 12, w = s.getZ(i);
    for (let r = 0; r < 3; r++) {
      const va = mats[a + r * 4] * x + mats[a + r * 4 + 1] * y + mats[a + r * 4 + 2] * z + mats[a + r * 4 + 3];
      const vb = mats[b + r * 4] * x + mats[b + r * 4 + 1] * y + mats[b + r * 4 + 2] * z + mats[b + r * 4 + 3];
      out[i * 3 + r] = va * (1 - w) + vb * w;
    }
  }
  return out;
}

/** Bake every clip. Returns frames laid out clip by clip. */
export function bakeAll(fullGeo) {
  const frames = []; const info = [];
  CLIPS.forEach((c, ci) => {
    const n = frameCount(c), first = frames.length;
    for (let f = 0; f < n; f++) {
      const t = c.loop ? (f * c.dur) / n : (f * c.dur) / (n - 1);
      const m = poseMatrices(POSES[ci](t));
      if (c.name.startsWith('die')) { // fit to ground so bodies rest on the terrain
        const sk = skinVertices(fullGeo, m); let minY = Infinity; for (let i = 1; i < sk.length; i += 3) minY = Math.min(minY, sk[i]);
        for (let b = 0; b < NB; b++) m[b * 12 + 7] -= minY;
      }
      frames.push(m);
    }
    info.push({ first, count: n, dur: c.dur, loop: c.loop });
  });
  const data = new Float32Array(frames.length * NB * 12);
  frames.forEach((m, i) => data.set(m, i * NB * 12));
  return { data, info, totalFrames: frames.length };
}
