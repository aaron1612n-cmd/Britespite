// Camera director: follow-cam (chase / first person), auto cinematic camera, and replay.
// Free-fly stays the default; this takes over the camera only while a mode is active.
import * as THREE from 'three';
import { heightAt } from './terrain.js';
import { ST } from './sim.js';

const TAU = Math.PI * 2;
const lerpAng = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;
const damp = (rate, dt) => 1 - Math.exp(-rate * dt);

/** Rolling record of the last few seconds, replayed through a stand-in for the sim. */
export class Recorder {
  constructor(sim) {
    const n = sim.n; this.n = n;
    this.cap = Math.max(8, Math.min(160, Math.floor(48e6 / (19 * n))));
    this.interval = Math.max(0.05, 6 / this.cap);
    this.frames = []; this.head = 0; this.count = 0; this.t = 0; this.acc = 0;
    for (let i = 0; i < this.cap; i++) this.frames.push({ x: new Float32Array(n), z: new Float32Array(n), yaw: new Float32Array(n), animT: new Float32Array(n), clip: new Uint8Array(n), state: new Uint8Array(n), removed: new Uint8Array(n), t: 0 });
  }
  get seconds() { return this.count > 1 ? (this.count - 1) * this.interval : 0; }
  record(sim, dt) {
    this.acc += dt; this.t += dt; if (this.acc < this.interval) return; this.acc -= this.interval; if (this.acc > this.interval) this.acc = 0;
    const f = this.frames[this.head]; f.x.set(sim.x); f.z.set(sim.z); f.yaw.set(sim.yaw); f.animT.set(sim.animT); f.clip.set(sim.clip); f.state.set(sim.state); f.removed.set(sim.removed);
    this.head = (this.head + 1) % this.cap; this.count = Math.min(this.cap, this.count + 1);
  }
  /** frame k counted from the oldest (0) to the newest (count-1) */
  at(k) { return this.frames[(this.head - this.count + k + this.cap * 2) % this.cap]; }
}

/** Looks enough like a Sim for Battlefield.update(). Filled each frame by Replay.sample(). */
class ReplaySim {
  constructor(sim) {
    const n = sim.n; this.n = n; this.TICK = sim.TICK; this.world = sim.world; this.team = sim.team; this.seed = sim.seed; this.alive = sim.alive; this.hitEvents = [];
    for (const k of ['x', 'z', 'yaw', 'animT']) this[k] = new Float32Array(n);
    for (const k of ['clip', 'state', 'removed', 'prevClip']) this[k] = new Uint8Array(n);
    this.vx = new Float32Array(n); this.vz = new Float32Array(n); this.prevT = new Float32Array(n); this.blend = new Float32Array(n).fill(1);
  }
}

export class CamDirector {
  /** mode: 'free' | 'follow' | 'cine'. Replay is a layer on top of any mode. */
  constructor({ camera, fly, reduced }) {
    this.cam = camera; this.fly = fly; this.reduced = reduced;
    this.mode = 'free'; this.view = 'chase'; this.target = -1; this.deadFor = 0; this.onChange = () => {};
    this.pos = new THREE.Vector3(); this.look = new THREE.Vector3(); this.yawS = 0; this.fresh = true;
    this.shot = null; this.shotT = 0; this.focus = new THREE.Vector3(); this.focusN = 0; this.scanT = 0; this.hot = null;
    this.rec = null; this.replay = null; this.rsim = null; this.speed = 0.4; this.rt = 0;
  }
  reset(sim) { this.setMode('free'); this.rec = new Recorder(sim); this.rsim = new ReplaySim(sim); this.replay = null; this.target = -1; this.onChange(); }
  get active() { return this.mode !== 'free'; }
  get replaying() { return !!this.replay; }
  setMode(m) {
    if (m === this.mode) return; const was = this.mode; this.mode = m; this.fresh = true; this.shot = null;
    if (was !== 'free' && m === 'free') this.handBack();
    if (m !== 'follow') this.target = -1;
    this.onChange();
  }
  handBack() { const p = this.cam.position; this.fly.lookAt(p.x, p.y, p.z, p.x - Math.sin(this.cam.rotation.y) * Math.cos(this.cam.rotation.x), p.y + Math.sin(this.cam.rotation.x), p.z - Math.cos(this.cam.rotation.y) * Math.cos(this.cam.rotation.x)); this.fly.vel.set(0, 0, 0); }
  toggleView() { this.view = this.view === 'chase' ? 'first' : 'chase'; this.fresh = true; this.onChange(); }
  follow(i, sim) { if (i < 0) return; this.target = i; this.team = sim.team[i]; this.setMode('follow'); this.fresh = true; this.deadFor = 0; this.onChange(); }
  /** nearest soldier to a screen point (px,py in CSS px), within `maxPx`. */
  pick(src, px, py, w, h, maxPx = 36) {
    const cam = this.cam; cam.updateMatrixWorld(); const inv = cam.matrixWorldInverse, pm = cam.projectionMatrix.elements, e = inv.elements;
    let best = -1, bd = maxPx * maxPx;
    for (let i = 0; i < src.n; i++) {
      if (src.removed[i] || src.state[i] === ST.DEAD) continue;
      const X = src.x[i], Z = src.z[i], Y = heightAt(X, Z) + 1;
      const vx = e[0] * X + e[4] * Y + e[8] * Z + e[12], vy = e[1] * X + e[5] * Y + e[9] * Z + e[13], vz = e[2] * X + e[6] * Y + e[10] * Z + e[14];
      if (vz > -1) continue; const sx = (vx * pm[0] / -vz * 0.5 + 0.5) * w, sy = (0.5 - vy * pm[5] / -vz * 0.5) * h;
      const d = (sx - px) ** 2 + (sy - py) ** 2 + (vz * vz) * 1e-6; if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  /** nearest living soldier of the same team (used when the followed one falls) */
  nextAlly(src, i) {
    const t = src.team[i], x = src.x[i], z = src.z[i]; let best = -1, bd = 1e12;
    for (let j = 0; j < src.n; j++) { if (src.team[j] !== t || src.removed[j] || src.state[j] === ST.DEAD) continue; const d = (src.x[j] - x) ** 2 + (src.z[j] - z) ** 2; if (d < bd) { bd = d; best = j; } }
    return best;
  }
  // ---- replay
  startReplay() {
    if (!this.rec || this.rec.count < 3) return false;
    this.replay = { t: 0, len: this.rec.seconds }; this.speed = 0.4; if (this.mode === 'free') this.setMode('cine'); this.fresh = true; this.scanT = 9; this.onChange(); return true;
  }
  stopReplay() { if (!this.replay) return; this.replay = null; this.fresh = true; this.scanT = 9; this.onChange(); }
  cycleSpeed() { this.speed = this.speed === 0.4 ? 0.15 : this.speed === 0.15 ? 1 : 0.4; this.onChange(); }
  sample(replay) {
    const r = this.rec, o = this.rsim, k = Math.min(r.count - 1.001, replay.t / r.interval), i = Math.floor(k), f = k - i, A = r.at(i), B = r.at(i + 1);
    for (let j = 0; j < o.n; j++) {
      o.x[j] = A.x[j] + (B.x[j] - A.x[j]) * f; o.z[j] = A.z[j] + (B.z[j] - A.z[j]) * f; o.yaw[j] = lerpAng(A.yaw[j], B.yaw[j], f);
      o.animT[j] = A.animT[j] + f * r.interval; o.clip[j] = A.clip[j]; o.state[j] = A.state[j]; o.removed[j] = A.removed[j];
    }
  }
  /** per frame. Returns the sim-like source to render, or null to render live. */
  update(dt, live, alpha) {
    let src = live, a = alpha;
    if (this.replay) {
      const rp = this.replay; rp.t += dt * this.speed;
      if (rp.t >= rp.len) { this.stopReplay(); } else { this.sample(rp); src = this.rsim; a = 0; }
    }
    if (this.mode === 'follow') this.updateFollow(dt, src, a); else if (this.mode === 'cine') this.updateCine(dt, src, a);
    return src === live ? null : src;
  }
  unitPos(src, i, a, out) { const d = a * src.TICK; out.set(src.x[i] + (src.vx ? src.vx[i] : 0) * d, 0, src.z[i] + (src.vz ? src.vz[i] : 0) * d); out.y = heightAt(out.x, out.z); return out; }
  place(p, look, dt, rate) {
    if (this.fresh || this.reduced) { this.pos.copy(p); this.look.copy(look); this.fresh = false; }
    else { const k = damp(rate, dt); this.pos.lerp(p, k); this.look.lerp(look, k); }
    this.cam.position.copy(this.pos); this.cam.lookAt(this.look);
    const g = heightAt(this.pos.x, this.pos.z) + 0.8; if (this.cam.position.y < g) this.cam.position.y = g;
  }
  updateFollow(dt, src, a) {
    let i = this.target; if (i < 0) return;
    if (src.state[i] === ST.DEAD || src.removed[i]) { this.deadFor += dt; if (this.deadFor > 1.8) { const j = this.nextAlly(src, i); if (j >= 0) { this.target = j; this.deadFor = 0; i = j; this.onChange(); } } } else this.deadFor = 0;
    const p = this.unitPos(src, i, a, this._p || (this._p = new THREE.Vector3())), yaw = src.yaw[i];
    this.yawS = this.fresh ? yaw : lerpAng(this.yawS, yaw, damp(this.reduced ? 99 : 4, dt));
    const sx = Math.sin(this.yawS), sz = Math.cos(this.yawS), dead = src.state[i] === ST.DEAD;
    const eye = this._e || (this._e = new THREE.Vector3()), at = this._a || (this._a = new THREE.Vector3());
    if (this.view === 'first' && !dead) { eye.set(p.x + sx * 0.25, p.y + 1.62, p.z + sz * 0.25); at.set(p.x + sx * 12, p.y + 1.5, p.z + sz * 12); this.place(eye, at, dt, 14); }
    else { eye.set(p.x - sx * 7, p.y + 3.4, p.z - sz * 7); at.set(p.x + sx * 5, p.y + 1.3, p.z + sz * 5); this.place(eye, at, dt, 5); }
  }
  // ---- cinematic
  scan(src) {
    // busiest 24 m cell by fighting soldiers (sampled), then its centre of mass
    const C = 24, cells = new Map(), step = Math.max(1, Math.floor(src.n / 40000)); let best = null;
    for (let i = 0; i < src.n; i += step) {
      const s = src.state[i]; if (src.removed[i] || (s !== ST.ATTACK && s !== ST.HIT)) continue;
      const key = Math.floor(src.x[i] / C) * 4096 + Math.floor(src.z[i] / C); let c = cells.get(key); if (!c) cells.set(key, (c = { n: 0, x: 0, z: 0 }));
      c.n++; c.x += src.x[i]; c.z += src.z[i]; if (!best || c.n > best.n) best = c;
    }
    this.hot = best ? { x: best.x / best.n, z: best.z / best.n, n: best.n } : null;
  }
  newShot(src) {
    const h = this.hot || { x: 0, z: -60 }, kinds = ['orbit', 'low', 'high', 'side'];
    this.shot = { kind: kinds[(Math.random() * kinds.length) | 0], a: Math.random() * TAU, dir: Math.random() < 0.5 ? -1 : 1, t: 0, len: 7 + Math.random() * 4 }; this.fresh = true; this.shotT = 0;
    if (this.reduced) this.shot.len = 9;
  }
  updateCine(dt, src, a) {
    this.scanT += dt; if (this.scanT > 1 || (!this.hot && this.scanT > 0.3)) { this.scanT = 0; this.scan(src); }
    if (!this.shot || (this.shotT += dt) > this.shot.len) this.newShot(src);
    const s = this.shot, h = this.hot || { x: 0, z: -60, n: 0 }; s.t += dt;
    const fy = heightAt(h.x, h.z) + 1.2, f = this.focus; if (this.focusN === 0 || this.fresh) { f.set(h.x, fy, h.z); this.focusN = 1; } else f.lerp(this._h || (this._h = new THREE.Vector3()).set(h.x, fy, h.z), damp(0.8, dt));
    // orbit speed: none under reduced motion (hold, then cut)
    const w = this.reduced ? 0 : 0.12 * s.dir, ang = s.a + w * s.t;
    const eye = this._ce || (this._ce = new THREE.Vector3()), r = s.kind === 'high' ? 70 : s.kind === 'low' ? 14 : s.kind === 'side' ? 32 : 40, ey = s.kind === 'high' ? 55 : s.kind === 'low' ? 1.8 : s.kind === 'side' ? 7 : 16;
    const slide = s.kind === 'side' && !this.reduced ? (s.t - s.len / 2) * 2.2 : 0;
    eye.set(f.x + Math.sin(ang) * r + Math.cos(ang) * slide, 0, f.z + Math.cos(ang) * r - Math.sin(ang) * slide); eye.y = Math.max(heightAt(eye.x, eye.z) + 1.5, f.y + ey - 1.2);
    this.place(eye, f, dt, 2.5);
  }
  /** keep the camera glued to the pose while a mode drives it; true if the user took over */
  userTookOver() { const k = this.fly; return k.keys.size > 0 || Math.abs(k.stick.x) + Math.abs(k.stick.y) > 0.1 || k.climb !== 0; }
}
