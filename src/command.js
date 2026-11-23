// Commander layer: select a group of Crimson soldiers (box / tap) and order it to advance, hold or flank.
import * as THREE from 'three';
import { ORD } from './sim.js';
import { heightAt } from './terrain.js';

const SIDE = 0;            // the side the player commands (Crimson, marches toward +z)
const FORWARD = 70, FLANK_OUT = 70, FLANK_FWD = 55, TAP_R = 14, MAXDOTS = 500;
const NAMES = { [ORD.NONE]: 'Free', [ORD.ADVANCE]: 'Advancing', [ORD.HOLD]: 'Holding', [ORD.FLANK]: 'Flanking' };

export class Commander {
  constructor({ camera, canvas, fly, getSim, onMode }) {
    Object.assign(this, { camera, canvas, fly, getSim, onMode });
    this.on = false; this.ids = []; this.box = null; this.ping = null; this.dest = null; this.destKind = 0; this.msg = '';
    this.fx = document.getElementById('cmdfx'); this.g = this.fx.getContext('2d');
    this.panel = document.getElementById('cmd'); this.label = document.getElementById('cmdlabel');
    this.v = new THREE.Vector3(); this.ray = new THREE.Raycaster(); this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.bind(); this.setOn(false);
  }
  bind() {
    const q = (id) => document.getElementById(id);
    q('cmdtoggle').onclick = () => this.setOn(!this.on);
    q('c-adv').onclick = () => this.issue(ORD.ADVANCE); q('c-hold').onclick = () => this.issue(ORD.HOLD);
    q('c-fl').onclick = () => this.issue(ORD.FLANK, -1); q('c-fr').onclick = () => this.issue(ORD.FLANK, 1);
    q('c-all').onclick = () => this.selectAll(); q('c-clr').onclick = () => this.clear();
    this.fly.onCmd = (t, e) => this.pointer(t, e);
    addEventListener('keydown', (e) => {
      if (e.repeat || e.target instanceof HTMLSelectElement) return;
      if (e.code === 'Tab') { e.preventDefault(); this.setOn(!this.on); return; }
      if (!this.on) return;
      const k = { Digit4: () => this.issue(ORD.ADVANCE), Digit5: () => this.issue(ORD.HOLD), Digit6: () => this.issue(ORD.FLANK, -1), Digit7: () => this.issue(ORD.FLANK, 1), Digit9: () => this.selectAll(), Digit0: () => this.clear(), Escape: () => this.clear() }[e.code];
      if (k) { e.preventDefault(); k(); }
    });
    addEventListener('resize', () => this.size()); this.size();
  }
  size() { const r = Math.min(devicePixelRatio || 1, 2); this.fx.width = innerWidth * r; this.fx.height = innerHeight * r; this.r = r; }
  setOn(on) {
    this.on = on; this.fly.setCmd(on); this.panel.hidden = !on; this.fx.style.display = on || this.ids.length ? 'block' : 'none';
    document.getElementById('cmdtoggle').setAttribute('aria-pressed', on); this.canvas.style.cursor = on ? 'crosshair' : '';
    if (on) this.say(this.ids.length ? '' : 'Drag a box around Crimson soldiers, or tap a squad.'); else this.say('');
    this.onMode && this.onMode(on);
  }
  say(m) { this.msg = m; this.label.textContent = m; }
  // ---- picking
  groundAt(px, py) {
    const ndc = new THREE.Vector2((px / innerWidth) * 2 - 1, -(py / innerHeight) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera); const p = new THREE.Vector3();
    for (let h = 0, i = 0; i < 3; i++) { this.plane.constant = -h; if (!this.ray.ray.intersectPlane(this.plane, p)) return null; h = heightAt(p.x, p.z); }
    return p;
  }
  alive(sim, i) { return sim.team[i] === SIDE && sim.state[i] !== 3 && !sim.removed[i]; }
  selectRect(x0, y0, x1, y1) {
    const sim = this.getSim(); if (!sim) return; const v = this.v, W = innerWidth, H = innerHeight, out = [];
    this.camera.updateMatrixWorld(); this.camera.matrixWorldInverse.copy(this.camera.matrixWorld).invert();
    const lx = Math.min(x0, x1), hx = Math.max(x0, x1), ly = Math.min(y0, y1), hy = Math.max(y0, y1);
    for (let i = 0; i < sim.n; i++) {
      if (!this.alive(sim, i)) continue;
      v.set(sim.x[i], heightAt(sim.x[i], sim.z[i]) + 1, sim.z[i]).project(this.camera); if (v.z > 1) continue;
      const sx = (v.x * 0.5 + 0.5) * W, sy = (-v.y * 0.5 + 0.5) * H;
      if (sx >= lx && sx <= hx && sy >= ly && sy <= hy) out.push(i);
    }
    this.set(out);
  }
  selectAround(px, py) {
    const sim = this.getSim(), g = this.groundAt(px, py); if (!sim || !g) return this.set([]);
    const out = [], r2 = TAP_R * TAP_R;
    for (let i = 0; i < sim.n; i++) { if (!this.alive(sim, i)) continue; const dx = sim.x[i] - g.x, dz = sim.z[i] - g.z; if (dx * dx + dz * dz < r2) out.push(i); }
    this.set(out);
  }
  selectAll() { const sim = this.getSim(); if (!sim) return; const out = []; for (let i = 0; i < sim.n; i++) if (this.alive(sim, i)) out.push(i); this.set(out); }
  set(ids) { this.ids = ids; this.dest = null; this.say(ids.length ? '' : 'Nobody there. Try a bigger box.'); this.refresh(); }
  clear() { this.ids = []; this.dest = null; this.say('Selection cleared.'); this.refresh(); }
  // ---- orders
  centroid(sim) { let cx = 0, cz = 0, m = 0; for (const i of this.ids) { cx += sim.x[i]; cz += sim.z[i]; m++; } return m ? { x: cx / m, z: cz / m } : null; }
  issue(kind, side = 0, at = null) {
    const sim = this.getSim(); this.prune(); if (!sim || !this.ids.length) { this.say('Select soldiers first.'); return; }
    const c = this.centroid(sim), fwd = SIDE === 0 ? 1 : -1; let x = c.x, z = c.z;
    if (kind === ORD.ADVANCE) { if (at) { x = at.x; z = at.z; } else z += fwd * FORWARD; }
    else if (kind === ORD.FLANK) { x += -fwd * side * FLANK_OUT; z += fwd * FLANK_FWD; }
    const lim = sim.world - 8; x = Math.max(-lim, Math.min(lim, x)); z = Math.max(-lim, Math.min(lim, z));
    sim.command(this.ids, kind, x, z);
    this.dest = kind === ORD.HOLD ? null : { x, z }; this.destKind = kind; this.from = { x: c.x, z: c.z };
    this.ping = { x: kind === ORD.HOLD ? c.x : x, z: kind === ORD.HOLD ? c.z : z, t: performance.now() };
    this.say(`${kind === ORD.FLANK ? (side < 0 ? 'flanking left' : 'flanking right') : NAMES[kind].toLowerCase()}`); this.refresh();
  }
  prune() { const sim = this.getSim(); if (sim) this.ids = this.ids.filter((i) => this.alive(sim, i)); }
  refresh() {
    const n = this.ids.length; document.getElementById('cmdcount').textContent = n ? n.toLocaleString() : '0';
    for (const id of ['c-adv', 'c-hold', 'c-fl', 'c-fr', 'c-clr']) document.getElementById(id).disabled = !n;
    this.fx.style.display = this.on || n ? 'block' : 'none';
  }
  // ---- pointer (called by FlyCam while in command mode)
  pointer(t, e) {
    if (t === 'down') {
      if (e.button === 2) { // right click: send the selection to that point
        const g = this.groundAt(e.clientX, e.clientY); if (g && this.ids.length) this.issue(ORD.ADVANCE, 0, g); return;
      }
      this.box = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY };
    } else if (t === 'move' && this.box && this.box.id === e.pointerId) { this.box.x1 = e.clientX; this.box.y1 = e.clientY; }
    else if ((t === 'up' || t === 'cancel') && this.box && this.box.id === e.pointerId) {
      const b = this.box; this.box = null; if (t === 'cancel') return;
      if (Math.hypot(b.x1 - b.x0, b.y1 - b.y0) < 10) this.selectAround(b.x1, b.y1); else this.selectRect(b.x0, b.y0, b.x1, b.y1);
    }
  }
  // ---- overlay, once per frame
  project(x, z, out) { this.v.set(x, heightAt(x, z) + 0.5, z).project(this.camera); if (this.v.z > 1) return false; out[0] = (this.v.x * 0.5 + 0.5) * innerWidth; out[1] = (-this.v.y * 0.5 + 0.5) * innerHeight; return true; }
  draw(reduced) {
    const g = this.g, r = this.r, sim = this.getSim(); g.setTransform(r, 0, 0, r, 0, 0); g.clearRect(0, 0, innerWidth, innerHeight);
    if (!sim || !(this.on || this.ids.length)) return;
    const acc = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#d8a63a', p = [0, 0];
    this.camera.updateMatrixWorld();
    const n = this.ids.length, step = Math.max(1, Math.floor(n / MAXDOTS));
    g.fillStyle = acc; g.strokeStyle = '#14120f'; g.lineWidth = 1;
    for (let k = 0; k < n; k += step) { const i = this.ids[k]; if (sim.state[i] === 3 || !this.project(sim.x[i], sim.z[i], p)) continue; g.beginPath(); g.arc(p[0], p[1], 3.2, 0, 6.283); g.fill(); g.stroke(); }
    if (n) {
      const c = this.centroid(sim); if (c && this.project(c.x, c.z, p) && this.dest) {
        const q = [0, 0]; if (this.project(this.dest.x, this.dest.z, q)) {
          g.strokeStyle = acc; g.lineWidth = 3; g.setLineDash([10, 8]); g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); g.stroke(); g.setLineDash([]);
          const a = Math.atan2(q[1] - p[1], q[0] - p[0]); g.fillStyle = acc; g.beginPath(); g.moveTo(q[0], q[1]); g.lineTo(q[0] - 16 * Math.cos(a - 0.4), q[1] - 16 * Math.sin(a - 0.4)); g.lineTo(q[0] - 16 * Math.cos(a + 0.4), q[1] - 16 * Math.sin(a + 0.4)); g.closePath(); g.fill();
        }
      }
    }
    if (this.ping) { // the one motion moment: a ring that closes on the order point
      const age = (performance.now() - this.ping.t) / 700;
      if (age < 1 && this.project(this.ping.x, this.ping.z, p)) { const k = reduced ? 0.5 : 1 - age; g.strokeStyle = acc; g.lineWidth = 3; g.globalAlpha = reduced ? 1 - age : 1; g.beginPath(); g.arc(p[0], p[1], 10 + 46 * k, 0, 6.283); g.stroke(); g.globalAlpha = 1; } else if (age >= 1) this.ping = null;
    }
    if (this.box) { const b = this.box; g.strokeStyle = acc; g.lineWidth = 2; g.fillStyle = 'rgba(216,166,58,0.16)'; g.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0); g.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0); }
  }
  tick() { // 4×/s: drop dead, report state
    if (!this.ids.length) return; const before = this.ids.length; this.prune(); if (this.ids.length !== before) this.refresh();
    const sim = this.getSim(); if (this.ids.length && !this.msg.startsWith('Select')) { const o = sim.ord[this.ids[0]]; this.label.textContent = `selected · ${NAMES[o] || ''}`; }
  }
}
