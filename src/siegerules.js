// Siege rules layered on the battle sim: wall + gate collision, ladder climbing, battering ram, defenders on the wall.
// Sim hooks: layout(), pre(dt), steer(), post(i), fall(i), canReach(), dmgMul(), searchR().
import { CLIP } from './clips.js';
import { ST } from './sim.js';
import { siegeParams, siegeWorld, WALL_H, HT, GATE_HALF, TOWER_R, RAM, GATE_HP, LADDER_FOOT_Z, RUN, ramSwing, RAM_HIT_PHASE } from './siege.js';

export const ROLE = { FREE: 0, CREW: 1, LADDER: 2, POST: 3, HOLD: 4, FALL: 5 };
// sg[] slots shared with the renderer
export const SG = { GATE_HP: 0, GATE_OPEN: 1, RAM_X: 2, RAM_Z: 3, SWING: 4, LADDER_UP: 5, HITS: 6, CREW: 7, SHAKE: 8, POSTS: 9 };
const CLIMB_T = 5.6, RAISE_AT = 10, RAISE_T = 6;

export class SiegeRules {
  constructor(sim) {
    this.s = sim; this.P = siegeParams(sim.world); this.ox = 0; this.oz = 0; this.osp = 0; this.stoneT = 3; this.phase = 0;
    this.crew = new Int32Array(RAM.crew).fill(-1); this.ladNext = new Float32Array(this.P.ladders.length);
    this.defN = Math.max(40, sim.perSide >> 1);
  }
  static world(perSide) { return siegeWorld(perSide); }
  get open() { return this.s.sg[SG.GATE_OPEN] >= 0.6; }
  layout() {
    const s = this.s, N = s.perSide, P = this.P, sg = s.sg, L = P.ladders.length, rnd = s.rand;
    const init = (i, t, x, z, role) => {
      s.team[i] = t; s.x[i] = x + (rnd() - 0.5) * 0.3; s.z[i] = z + (rnd() - 0.5) * 0.3; s.yaw[i] = t === 0 ? 0 : Math.PI;
      s.hp[i] = 90 + rnd() * 30; s.spd[i] = 0.9 + rnd() * 0.2; s.seed[i] = rnd(); s.animT[i] = rnd() * 0.8; s.clip[i] = CLIP.IDLE; s.prevClip[i] = CLIP.IDLE; s.cd[i] = rnd() * 0.5;
      s.role[i] = role; s.lad[i] = -1; s.prog[i] = -1; s.elev[i] = 0;
    };
    sg[SG.GATE_HP] = GATE_HP; sg[SG.RAM_X] = 0; sg[SG.RAM_Z] = -24; sg[SG.CREW] = RAM.crew;
    const lm = Math.round(0.4 * (N - RAM.crew)), cols = 6, rowsMax = Math.ceil(Math.ceil(lm / L) / cols);
    for (let k = 0; k < N; k++) {
      if (k < RAM.crew) { init(k, 0, this.slotX(k), sg[SG.RAM_Z] + RAM.slotZ0 + (k >> 1) * RAM.slotDz, ROLE.CREW); this.crew[k] = k; continue; }
      const m = k - RAM.crew;
      if (m < lm) { const l = m % L, g = (m / L) | 0; init(k, 0, P.ladders[l] + ((g % cols) - (cols - 1) / 2) * 1.2, -(34 + ((g / cols) | 0) * 1.2), ROLE.LADDER); s.lad[k] = l; }
      else { const e = m - lm, f = e % 80, r = (e / 80) | 0; init(k, 0, (f - 39.5) * 1.2, -(34 + rowsMax * 1.2 + 6 + r * 1.2), ROLE.FREE); }
    }
    // wall-top slots (two rows), skipping the towers
    const slots = [], near = (x) => P.towers.some((t) => Math.abs(x - t) < TOWER_R + 0.9);
    for (let x = -P.half + 6; x < P.half - 6; x += 1.3) if (!near(x)) { slots.push([x, -0.65]); slots.push([x + 0.6, 0.35]); }
    slots.sort((a, b) => a[0] - b[0]);
    const D = this.defN, posts = Math.min(Math.round(D * 0.45), slots.length), hold = D - posts, hf = 46;
    for (let k = 0; k < posts; k++) { const sl = slots[Math.floor((k * slots.length) / posts)], i = N + k; init(i, 1, sl[0], sl[1], ROLE.POST); s.elev[i] = WALL_H; }
    for (let k = 0; k < hold; k++) init(N + posts + k, 1, ((k % hf) - (hf - 1) / 2) * 1.2, 7 + ((k / hf) | 0) * 1.2, ROLE.HOLD);
    for (let k = D; k < N; k++) { const i = N + k; init(i, 1, 0, 0, ROLE.HOLD); s.removed[i] = 1; s.state[i] = ST.DEAD; s.hp[i] = 0; }
    s.alive[1] = D; sg[SG.POSTS] = posts;
  }
  slotX(k) { return (k & 1 ? 1 : -1) * RAM.slotX; }
  pre(dt) {
    const s = this.s, sg = s.sg, t = s.time;
    sg[SG.LADDER_UP] = Math.min(1, Math.max(0, (t - RAISE_AT) / RAISE_T));
    // crew upkeep every second: replace the fallen, count the live defenders on the wall
    if (s.tickCount % 20 === 0) {
      let posts = 0; const n = s.n;
      for (let i = 0; i < n; i++) if (s.role[i] === ROLE.POST && s.team[i] === 1 && s.state[i] !== ST.DEAD && !s.removed[i]) posts++;
      sg[SG.POSTS] = posts;
      for (let k = 0; k < RAM.crew; k++) {
        const id = this.crew[k]; if (id >= 0 && s.state[id] !== ST.DEAD && !s.removed[id]) continue;
        let best = -1, bd = 1e9; if (sg[SG.GATE_OPEN] > 0) continue;
        for (let i = 0; i < n; i++) if (s.team[i] === 0 && s.role[i] === ROLE.FREE && s.state[i] !== ST.DEAD && !s.removed[i]) { const d = (s.x[i] - sg[SG.RAM_X]) ** 2 + (s.z[i] - sg[SG.RAM_Z]) ** 2; if (d < bd) { bd = d; best = i; } }
        if (best >= 0 && bd < 80 * 80) { s.role[best] = ROLE.CREW; this.crew[k] = best; } else this.crew[k] = -1;
      }
    }
    let alive = 0, near = 0;
    for (let k = 0; k < RAM.crew; k++) { const id = this.crew[k]; if (id < 0 || s.state[id] === ST.DEAD || s.removed[id]) continue; alive++; const tx = this.slotX(k) + sg[SG.RAM_X], tz = sg[SG.RAM_Z] + RAM.slotZ0 + (k >> 1) * RAM.slotDz; if ((s.x[id] - tx) ** 2 + (s.z[id] - tz) ** 2 < 6) near++; }
    sg[SG.CREW] = alive;
    if (sg[SG.GATE_HP] > 0) {
      if (sg[SG.RAM_Z] < RAM.stopZ) { sg[SG.RAM_Z] = Math.min(RAM.stopZ, sg[SG.RAM_Z] + 1.15 * Math.min(1, near / (RAM.crew * 0.5)) * dt); }
      else if (alive > 0) {
        const p0 = this.phase; this.phase = (this.phase + dt / 2.6) % 1; sg[SG.SWING] = ramSwing(this.phase);
        if (p0 < RAM_HIT_PHASE && this.phase >= RAM_HIT_PHASE) { sg[SG.GATE_HP] = Math.max(0, sg[SG.GATE_HP] - 135); sg[SG.HITS]++; sg[SG.SHAKE] = 1; if (s.hitEvents.length < 64) s.hitEvents.push({ x: sg[SG.RAM_X], z: -HT, kill: true }); }
      }
      // defenders drop stones on the crew while the ram works at the gate
      if (sg[SG.RAM_Z] > -24 && sg[SG.POSTS] >= 5 && alive > 0 && (this.stoneT -= dt) <= 0) {
        this.stoneT = Math.min(5, Math.max(0.9, 1.5 * (120 / Math.max(20, sg[SG.POSTS]))));
        const id = this.crew[(s.rand() * RAM.crew) | 0]; if (id >= 0 && s.state[id] !== ST.DEAD && !s.removed[id]) s.damage(id, 40 + s.rand() * 30, id);
      }
    } else {
      sg[SG.GATE_OPEN] = Math.min(1, sg[SG.GATE_OPEN] + dt / 0.9); sg[SG.SWING] = 0;
      if (sg[SG.GATE_OPEN] >= 0.6) { for (let k = 0; k < RAM.crew; k++) { const id = this.crew[k]; if (id >= 0) { s.role[id] = ROLE.FREE; this.crew[k] = -1; } } }
      if (sg[SG.RAM_Z] > -16) sg[SG.RAM_Z] -= 3 * dt; // the ram is dragged clear of the doorway
    }
    sg[SG.SHAKE] = Math.max(0, sg[SG.SHAKE] - dt * 4);
  }
  side(i) { const s = this.s; if (s.elev[i] > 1) return 2; const z = s.z[i]; return z < -HT ? -1 : z > HT ? 1 : 0; }
  canReach(i, j) {
    const s = this.s, si = this.side(i), sj = this.side(j);
    if (si === 2 || sj === 2) { const dx = s.x[i] - s.x[j], dz = s.z[i] - s.z[j]; return dx * dx + dz * dz < 20; }
    return si === sj || si === 0 || sj === 0 || this.open;
  }
  dmgMul(i, j) { const d = this.s.elev[i] - this.s.elev[j]; return d > 2 ? 1.35 : d < -2 ? 0.7 : 1; }
  searchR(i) { const r = this.s.role[i]; return r === ROLE.POST || (r === ROLE.HOLD && !this.open) ? 3 : 13; }
  goto(i, tx, tz, sp) { const s = this.s, dx = tx - s.x[i], dz = tz - s.z[i], d = Math.hypot(dx, dz); if (d < 0.5) { this.ox = this.oz = 0; this.osp = 0; return; } this.ox = dx / d; this.oz = dz / d; this.osp = sp; }
  /** steering override: (dx,dz,sp) are the sim's own choice, result in this.ox/oz/osp */
  steer(i, j, dx, dz, sp) {
    const s = this.s, r = s.role[i], sg = s.sg; this.ox = dx; this.oz = dz; this.osp = sp;
    if (r === ROLE.POST) { if (this.open && j < 0) s.role[i] = ROLE.FALL; if (!(this.open && j >= 0)) { this.ox = this.oz = 0; this.osp = 0; } return; } // with the gate down and nobody left to fight, climb down
    if (r === ROLE.CREW) {
      let k = 0; while (k < RAM.crew && this.crew[k] !== i) k++;
      if (k < RAM.crew) { const tx = this.slotX(k) + sg[SG.RAM_X], tz = sg[SG.RAM_Z] + RAM.slotZ0 + (k >> 1) * RAM.slotDz, d = Math.hypot(tx - s.x[i], tz - s.z[i]); this.goto(i, tx, tz, Math.min(3.4, 1.2 + d * 2.5)); if (d < 0.2) this.osp = 0; }
      return;
    }
    if (r === ROLE.LADDER) {
      if (s.prog[i] >= 0) { this.ox = 0; this.oz = 1; this.osp = 0.6; return; }
      if (j >= 0 && sp > 0 && Math.hypot(s.x[j] - s.x[i], s.z[j] - s.z[i]) < 5) return;
      const l = s.lad[i], lx = this.P.ladders[l], up = sg[SG.LADDER_UP] >= 1;
      this.goto(i, lx + (s.seed[i] - 0.5) * 0.4, up ? LADDER_FOOT_Z - 0.5 : -14 - s.seed[i] * 6, 1.8); return;
    }
    if (r === ROLE.HOLD) {
      if (!this.open) { this.ox = this.oz = 0; this.osp = 0; return; }
      if (j < 0) { this.goto(i, (s.seed[i] - 0.5) * 6, 3, 1.6); return; }
    }
    const si = this.side(i);
    if (this.open && (si === -1 || si === 1)) {
      const sj = j >= 0 ? this.side(j) : 0;
      if (j < 0 && s.team[i] === 1) return;
      if (j < 0 && si === 1) { this.goto(i, s.x[i] * 0.9, s.z[i] + 10, 1.6); return; }
      else if (j >= 0 && (sj === si || sj === 2)) return; // same side: fight normally
      // go through the doorway to reach the other side
      const gx = Math.max(-(GATE_HALF - 0.5), Math.min(GATE_HALF - 0.5, s.x[i] * 0.2));
      if (Math.abs(s.z[i]) > 4) this.goto(i, gx, si * 4, Math.max(1.8, sp)); else this.goto(i, gx, -si * 8, Math.max(1.8, sp));
      return;
    }
    if (j < 0 && s.team[i] === 0 && !this.open) this.goto(i, (s.seed[i] - 0.5) * 26, -8 - ((s.seed[i] * 37) % 1) * 16, 1.6);
  }
  /** after movement: wall/tower collision, ladders, wall top */
  post(i, dt) {
    const s = this.s, r = s.role[i], sg = s.sg;
    if (r === ROLE.LADDER && s.prog[i] >= 0) {
      const l = s.lad[i], p = (s.prog[i] += dt / (CLIMB_T + s.seed[i]));
      if (p >= 1) { s.role[i] = ROLE.POST; s.prog[i] = -1; s.elev[i] = WALL_H; s.x[i] = this.P.ladders[l] + (s.seed[i] - 0.5) * 0.8; s.z[i] = -0.55 + (s.seed[i] - 0.5) * 0.5; s.yaw[i] = 0; return; }
      s.x[i] = this.P.ladders[l]; s.z[i] = LADDER_FOOT_Z + RUN * p; s.elev[i] = p * (WALL_H + 0.3); s.yaw[i] = 0; return;
    }
    if (r === ROLE.FALL) { s.elev[i] = Math.max(0, s.elev[i] - 4 * dt); if (s.elev[i] <= 0) s.role[i] = ROLE.FREE; }
    if (r === ROLE.POST) { s.elev[i] = WALL_H; if (s.z[i] < -1.0) s.z[i] = -1.0; else if (s.z[i] > 1.0) s.z[i] = 1.0; return; }
    if (r === ROLE.LADDER && sg[SG.LADDER_UP] >= 1) {
      const l = s.lad[i];
      if (Math.abs(s.x[i] - this.P.ladders[l]) < 0.8 && Math.abs(s.z[i] - (LADDER_FOOT_Z - 0.5)) < 1.1 && s.time >= this.ladNext[l] && s.state[i] === ST.MOVE) { s.prog[i] = 0; this.ladNext[l] = s.time + 1.8; }
    }
    // wall band: closed gate or beyond the doorway is solid
    const x = s.x[i], z = s.z[i], pad = HT + 0.3;
    if (s.elev[i] > 1) return;
    if (z > -pad && z < pad && !(this.open && Math.abs(x) < GATE_HALF - 0.25)) s.z[i] = z < 0 ? -pad : pad;
    for (const t of this.P.towers) { const dx = s.x[i] - t, dz = s.z[i], d = Math.hypot(dx, dz); if (d < TOWER_R + 0.35) { const k = (TOWER_R + 0.35) / (d || 1); s.x[i] = t + (d ? dx * k : TOWER_R + 0.35); s.z[i] = d ? dz * k : 0; } }
  }
  /** dead units: climbers fall from the ladder */
  fall(i, dt) {
    const s = this.s; if (s.prog[i] >= 0) { s.prog[i] = -1; s.role[i] = ROLE.FALL; }
    if (s.role[i] === ROLE.FALL) { s.elev[i] = Math.max(0, s.elev[i] - 10 * dt); if (s.elev[i] === 0) s.role[i] = ROLE.FREE; }
  }
}
