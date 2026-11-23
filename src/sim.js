// Headless battle simulation: spatial-hash combat for tens of thousands of spear soldiers.
import { CLIP, CLIPS } from './clips.js';
import { setTerrain, cellOf, heightAt } from './terrain.js';
import { slots, FORMATIONS } from './formations.js';
import { SiegeRules } from './siegerules.js';
import { Pacer } from './pacer.js';

export const ST = { MOVE: 0, ATTACK: 1, HIT: 2, DEAD: 3, CHEER: 4 };
const ROUTING = false; // soldiers fight on instead of running away
const MR = 2, ROUT_AT = 0.16, RALLY_AT = 0.5, CELL = 2, REACH = 2.3, SEP = 0.9, SEP2 = SEP * SEP, AGGRO = 26, TICK = 0.05;
export const ORD = { NONE: 0, ADVANCE: 1, HOLD: 2, FLANK: 3 };
const D_HIT = CLIPS[CLIP.HIT].dur;
export const UT = { HOPLITE: 0, HEAVY: 1, ARCHER: 2, JAVELIN: 3, COMMANDER: 4 };
export const TY = [
  { name: 'Hoplite', hp: [90, 120], spdMul: 1, reach: 2.3, dmg: [28, 50], cd: [0.4, 0.9], clip: CLIP.ATTACK, block: 0.1, range: 0, aggro: 26, rings: 13, kite: 0 },
  { name: 'Heavy shield-bearer', hp: [150, 190], spdMul: 0.8, reach: 2.2, dmg: [22, 40], cd: [0.5, 1.0], clip: CLIP.ATTACK, block: 0.3, range: 0, aggro: 24, rings: 13, kite: 0 },
  { name: 'Archer', hp: [60, 80], spdMul: 1.05, reach: 2.0, dmg: [16, 28], cd: [1.3, 1.9], clip: CLIP.SHOOT, block: 0, range: 52, speed: 40, kind: 0, aggro: 62, rings: 27, kite: 6 },
  { name: 'Javelin skirmisher', hp: [75, 95], spdMul: 1.1, reach: 2.0, dmg: [34, 52], cd: [1.8, 2.6], clip: CLIP.THROW, block: 0.05, range: 24, speed: 26, kind: 1, aggro: 34, rings: 15, kite: 0 },
  { name: 'Commander', hp: [210, 250], spdMul: 1, reach: 2.2, dmg: [35, 58], cd: [0.4, 0.8], clip: CLIP.ATTACK, block: 0.3, range: 0, aggro: 26, rings: 13, kite: 0 },
];
for (const t of TY) { t.dur = CLIPS[t.clip].dur; t.hit = CLIPS[t.clip].hit; t.stand = (t.range ? t.range : t.reach) * 0.92; }
export const COMPOSITIONS = {
  hoplites: { name: 'Hoplites only', hv: 0, ar: 0, jv: 0, cmd: 0 },
  balanced: { name: 'Mixed army', hv: 0.1, ar: 0.15, jv: 0.15, cmd: 1 },
  archers: { name: 'Archer heavy', hv: 0.05, ar: 0.4, jv: 0.05, cmd: 1 },
  skirmish: { name: 'Skirmishers', hv: 0, ar: 0.2, jv: 0.45, cmd: 1 },
  elite: { name: 'Shield bearers', hv: 0.5, ar: 0.1, jv: 0, cmd: 1 },
};
const MAXA = 6000, GRAV = 9.8;
function assignTypes(sl, N, kind) {
  const c = COMPOSITIONS[kind] || COMPOSITIONS.balanced, ut = new Uint8Array(N);
  const order = [...Array(N).keys()].sort((a, b) => sl.d[a] - sl.d[b] || Math.abs(sl.x[a]) - Math.abs(sl.x[b]));
  const nJ = Math.round(N * c.jv), nH = Math.round(N * c.hv), nA = Math.round(N * c.ar), nC = c.cmd ? Math.max(1, Math.round(N / 2500)) : 0;
  let p = 0; const put = (cnt, t) => { for (let k = 0; k < cnt && p < N; k++) ut[order[p++]] = t; };
  put(nJ, UT.JAVELIN); put(nH, UT.HEAVY); const hopStart = p; put(N - nJ - nH - nA, UT.HOPLITE); put(nA, UT.ARCHER);
  if (nC) { // commanders stand a third of the way back through the hoplites, spread across the width
    const a = hopStart + Math.floor((p - nA - hopStart) * 0.3), b = Math.min(p - nA, a + Math.max(nC * 4, Math.floor((p - nA - hopStart) * 0.25)));
    const cand = order.slice(a, b).filter((k) => ut[k] === UT.HOPLITE).sort((u, v) => sl.x[u] - sl.x[v]);
    for (let k = 0; k < nC && cand.length; k++) ut[cand[Math.floor(((k + 0.5) * cand.length) / nC)]] = UT.COMMANDER;
  }
  return ut;
}

const hyp = (a, b) => Math.sqrt(a * a + b * b); // Math.hypot is several times slower in V8
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export class Sim {
  constructor({ shared = false, formations = ['block', 'block'], terrain = 'flat', comps = ['balanced', 'balanced'], perSide = 1000, seed = 1, spacing = 1.2, gap = 160, world = 900, corpseLife = 18, corpseCap = 4000, mode = 'open' } = {}) {
    this.formations = formations; this.slots = [slots(formations[0], perSide, rng(seed * 7 + 1)), slots(formations[1], perSide, rng(seed * 7 + 2))];
    this.comps = comps; this.fSpd = formations.map((k) => FORMATIONS[k].spd); this.fDef = formations.map((k) => FORMATIONS[k].def);
    world = Math.max(120, Math.max(this.slots[0].halfWidth, this.slots[1].halfWidth, gap / 2 + Math.max(this.slots[0].depth, this.slots[1].depth)) + 70);
    if (mode === 'siege') { world = SiegeRules.world(perSide); terrain = 'flat'; }
    this.mode = mode; this.terrainId = terrain; this.tr = setTerrain(terrain, world);
    this.perSide = perSide; this.n = perSide * 2; this.world = world; this.corpseLife = corpseLife; this.corpseCap = corpseCap;
    const n = this.n; const A = (T, m) => (shared ? new T(new SharedArrayBuffer(m * T.BYTES_PER_ELEMENT)) : new T(m)); this.rand = rng(seed); this.time = 0; this.tickCount = 0; this.acc = 0; this.TICK = TICK;
    this.x = A(Float32Array, n); this.z = A(Float32Array, n); this.vx = A(Float32Array, n); this.vz = A(Float32Array, n);
    this.yaw = A(Float32Array, n); this.hp = A(Float32Array, n); this.stateT = A(Float32Array, n); this.cd = A(Float32Array, n);
    this.animT = A(Float32Array, n); this.prevT = A(Float32Array, n); this.blend = A(Float32Array, n).fill(1);
    this.spd = A(Float32Array, n); this.team = A(Uint8Array, n); this.state = A(Uint8Array, n); this.clip = A(Uint8Array, n);
    this.ord = A(Uint8Array, n); this.ox = A(Float32Array, n); this.oz = A(Float32Array, n); this.prevClip = A(Uint8Array, n); this.removed = A(Uint8Array, n); this.hitDone = A(Uint8Array, n); this.seed = A(Float32Array, n);
    this.utype = A(Uint8Array, n); this.apos = A(Float32Array, MAXA * 4); this.adir = A(Float32Array, MAXA * 4);
    this.avel = new Float32Array(MAXA * 3); this.ateam = new Uint8Array(MAXA); this.admg = new Float32Array(MAXA); this.ashooter = new Int32Array(MAXA); this.ahead = 0; this.buffT = new Int32Array(n).fill(-99); this.cmdList = [];
    this.elev = A(Float32Array, n); this.prog = A(Float32Array, n).fill(-1); this.role = A(Uint8Array, n); this.lad = A(Int8Array, n).fill(-1); this.sg = A(Float32Array, 16);
    this.tgt = A(Int32Array, n).fill(-1); this.deadQ = []; this.deadHead = 0;
    this.alive = A(Int32Array, 2); this.alive[0] = this.alive[1] = perSide; this.deaths = A(Int32Array, 2);
    this.meta = A(Float64Array, 8); this.stepDt = TICK; this.achieved = 1; this.hits = 0; this.hitEvents = []; // {x,z,kill}
    this.fieldNames = ['x','z','vx','vz','yaw','hp','stateT','cd','animT','prevT','blend','spd','team','state','clip','prevClip','removed','hitDone','seed','ord','ox','oz','alive','deaths','meta','elev','prog','role','lad','sg'];
    this.cells = Math.ceil((world * 2) / CELL); this.cellStart = new Int32Array(this.cells * this.cells + 1); this.order = new Int32Array(n); this.sx = new Float32Array(n); this.sz = new Float32Array(n); this.sf = new Uint8Array(n);
    this.cellOf = new Int32Array(n); this.frontZ = [0, 0]; this.cenX = [0, 0]; this.cenZ = [0, 0]; this.over = -1; // over: -1 running, else winning team
    // morale (sim-internal, not shared): 1 = steady, below ROUT_AT the unit breaks and runs
    this.morale = new Float32Array(n).fill(1); this.rout = new Uint8Array(n); this.nsT = new Uint8Array(n); this.fled = [0, 0]; this.routing = [0, 0];
    if (mode === 'siege') { this.siege = new SiegeRules(this); this.siege.layout(); } else this.layout(spacing, gap);
    this.typeCount = [0, 0, 0, 0, 0]; for (let i = 0; i < this.n; i++) this.typeCount[this.utype[i]]++;
  }
  layout(spacing, gap) {
    const N = this.perSide;
    for (let t = 0; t < 2; t++) {
      const sl = this.slots[t], types = assignTypes(sl, N, this.comps[t]), dir = t === 0 ? 1 : -1, jit = t === 0 && this.formations[0] === 'loose' || t === 1 && this.formations[1] === 'loose' ? 0 : 0.3;
      for (let k = 0; k < N; k++) {
        const i = t * N + k; this.team[i] = t; this.x[i] = (t === 0 ? 1 : -1) * sl.x[k] + (this.rand() - 0.5) * jit;
        this.z[i] = -dir * (gap / 2 + sl.d[k]) + (this.rand() - 0.5) * jit; this.yaw[i] = t === 0 ? 0 : Math.PI;
        const ty = TY[types[k]]; this.utype[i] = types[k]; if (types[k] === UT.COMMANDER) this.cmdList.push(i);
        this.hp[i] = ty.hp[0] + this.rand() * (ty.hp[1] - ty.hp[0]); this.spd[i] = (0.9 + this.rand() * 0.2) * ty.spdMul; this.seed[i] = this.rand();
        this.animT[i] = this.rand() * 0.8; this.clip[i] = CLIP.IDLE; this.prevClip[i] = CLIP.IDLE; this.cd[i] = this.rand() * 0.5;
      }
    }
  }
  cellIdx(x, z) {
    let cx = ((x + this.world) / CELL) | 0, cz = ((z + this.world) / CELL) | 0; const c = this.cells;
    cx = cx < 0 ? 0 : cx >= c ? c - 1 : cx; cz = cz < 0 ? 0 : cz >= c ? c - 1 : cz; return cz * c + cx;
  }
  buildGrid() {
    const n = this.n, cs = this.cellStart, c = this.cells; cs.fill(0);
    let f0 = -1e9, f1 = 1e9; const sx = [0, 0], sz = [0, 0], cn = [0, 0];
    for (let i = 0; i < n; i++) {
      if (this.removed[i] || this.state[i] === ST.DEAD) { this.cellOf[i] = -1; continue; }
      const ci = this.cellIdx(this.x[i], this.z[i]); this.cellOf[i] = ci; cs[ci + 1]++;
      const tm = this.team[i]; if (!this.rout[i]) { sx[tm] += this.x[i]; sz[tm] += this.z[i]; cn[tm]++; }
      if (this.team[i] === 0) { if (this.z[i] > f0) f0 = this.z[i]; } else if (this.z[i] < f1) f1 = this.z[i];
    }
    this.frontZ[0] = f0; this.frontZ[1] = f1; for (let t = 0; t < 2; t++) if (cn[t]) { this.cenX[t] = sx[t] / cn[t]; this.cenZ[t] = sz[t] / cn[t]; }
    for (let i = 0; i < cs.length - 1; i++) cs[i + 1] += cs[i];
    const fill = this._fill || (this._fill = new Int32Array(cs.length)); fill.set(cs);
    const order = this.order, sx2 = this.sx, sz2 = this.sz, sf = this.sf, X = this.x, Z = this.z, T = this.team, R = this.rout;
    for (let i = 0; i < n; i++) { const ci = this.cellOf[i]; if (ci >= 0) order[fill[ci]++] = i; }
    // cell-ordered snapshot of position + (team | routing << 1): neighbour scans read these sequentially instead of chasing ids
    for (let k = 0, m = cs[cs.length - 1]; k < m; k++) { const j = order[k]; sx2[k] = X[j]; sz2[k] = Z[j]; sf[k] = T[j] | (R[j] << 1); }
  }
  nearestEnemy(i, maxR = 13) {
    const c = this.cells, ci = this.cellOf[i], cx = ci % c, cz = (ci / c) | 0, me = this.team[i], px = this.x[i], pz = this.z[i];
    const { cellStart, order, sf, sx, sz } = this; let best = -1, bd = 1e12, found = -1; const sg = this.siege; if (sg) maxR = sg.searchR(i);
    for (let r = 0; r <= maxR; r++) {
      if (found >= 0 && r > found + 1) break;
      const z0 = cz - r < 0 ? 0 : cz - r, z1 = cz + r >= c ? c - 1 : cz + r;
      for (let zz = z0; zz <= z1; zz++) {
        const edge = zz === cz - r || zz === cz + r, step = edge ? 1 : 2 * r || 1;
        for (let dx = -r; dx <= r; dx += step) {
          const xx = cx + dx; if (xx < 0 || xx >= c) continue;
          const cc = zz * c + xx;
          for (let k = cellStart[cc], e = cellStart[cc + 1]; k < e; k++) {
            if ((sf[k] & 1) === me) continue;
            const ex = sx[k] - px, ez = sz[k] - pz, d = ex * ex + ez * ez;
            if (d < bd) { const j = order[k]; if (sg && !sg.canReach(i, j)) continue; bd = d; best = j; }
          }
        }
      }
      if (best >= 0 && found < 0) found = r;
    }
    return best;
  }
  /** a death shakes friends within a few metres (further for the dead's own side) */
  shock(j) {
    const c = this.cells, ci = this.cellOf[j]; if (ci < 0) return; const cx = ci % c, cz = (ci / c) | 0, me = this.team[j], px = this.x[j], pz = this.z[j];
    for (let zz = Math.max(0, cz - MR); zz <= Math.min(c - 1, cz + MR); zz++) for (let xx = Math.max(0, cx - MR); xx <= Math.min(c - 1, cx + MR); xx++) {
      const cc = zz * c + xx;
      for (let k = this.cellStart[cc], e = this.cellStart[cc + 1]; k < e; k++) { const f = this.order[k]; if (this.team[f] !== me || f === j) continue;
        const d2 = (this.x[f] - px) ** 2 + (this.z[f] - pz) ** 2; if (d2 < 36) this.morale[f] -= 0.05 * (1 - d2 / 36) * (1.3 - this.seed[f] * 0.5); }
    }
  }
  /** local odds: outnumbered, flanked, friends routing/dying, and how bruised the whole army is */
  moraleCheck(i, dt) {
    const c = this.cells, ci = this.cellOf[i], cx = ci % c, cz = (ci / c) | 0, me = this.team[i], px = this.x[i], pz = this.z[i], dir = me === 0 ? 1 : -1;
    let F = 1, E = 0, rear = 0, panic = 0; const { cellStart, order, sx, sz, sf } = this;
    for (let zz = Math.max(0, cz - MR); zz <= Math.min(c - 1, cz + MR); zz++) for (let xx = Math.max(0, cx - MR); xx <= Math.min(c - 1, cx + MR); xx++) {
      const cc = zz * c + xx;
      for (let k = cellStart[cc], e = cellStart[cc + 1]; k < e; k++) {
        const ex = sx[k] - px, ez = sz[k] - pz, d2 = ex * ex + ez * ez; if (d2 > 36 || order[k] === i) continue;
        const f = sf[k];
        if ((f & 1) === me) { if (f & 2) panic++; else F++; }
        else if (!(f & 2)) { E++; if (ez * dir < 0 && d2 < 16 && -ez * dir > 0.6 * Math.sqrt(d2)) rear++; } }
    }
    const lost = Math.max(0, this.deaths[me] + this.fled[me] - 0.3 * this.perSide) / this.perSide; // army-level wear
    let p = 0;
    if (E > 0) { const ratio = (E + 0.3) / F; if (ratio > 1.5) p += (ratio - 1.5) * 0.22; if (rear) p += 0.12 * Math.min(rear, 4); p += lost * 0.8; }
    if (E > 0 || panic > 3) p += Math.min(panic, 6) * 0.012;
    const courage = 0.75 + this.seed[i] * 0.5;
    if (p > 0) this.morale[i] -= (p / courage) * dt;
    else if (E === 0 || (E + 0.3) / F < 0.8) this.morale[i] += (this.rout[i] ? 0.07 : 0.05) * dt * (E === 0 ? 1.5 : 0.3);
    if (this.morale[i] > 1) this.morale[i] = 1;
    if (ROUTING && !this.rout[i] && this.morale[i] < ROUT_AT) { this.rout[i] = 1; this.routing[me]++; }
    else if (this.rout[i] && this.morale[i] > RALLY_AT) { this.rout[i] = 0; this.routing[me]--; }
  }
  setClip(i, c, startT = 0) {
    if (this.clip[i] === c) return;
    this.prevClip[i] = this.clip[i]; this.prevT[i] = this.animT[i]; this.blend[i] = 0; this.clip[i] = c; this.animT[i] = startT;
  }
  damage(j, dmg, from) {
    this.hp[j] -= dmg; this.hits++;
    if (this.hitEvents.length < 64) this.hitEvents.push({ x: this.x[j], z: this.z[j], kill: this.hp[j] <= 0 });
    if (this.hp[j] <= 0) {
      this.state[j] = ST.DEAD; this.stateT[j] = 0; this.vx[j] = this.vz[j] = 0;
      this.setClip(j, this.seed[j] < 0.5 ? CLIP.DIE_BACK : CLIP.DIE_FWD, 0);
      this.alive[this.team[j]]--; this.deaths[this.team[j]]++; this.deadQ.push(j); if (this.rout[j]) { this.rout[j] = 0; this.routing[this.team[j]]--; } this.shock(j);
    } else if (this.state[j] !== ST.ATTACK) {
      this.state[j] = ST.HIT; this.stateT[j] = 0; this.setClip(j, CLIP.HIT, 0);
      const dx = this.x[j] - this.x[from], dz = this.z[j] - this.z[from], l = hyp(dx, dz) || 1; this.vx[j] = (dx / l) * 1.5; this.vz[j] = (dz / l) * 1.5;
    }
  }
  /** Commander order for a group of soldiers. (x,z) is the group's destination centre; each soldier keeps its offset from the group centroid. */
  command(ids, kind, x = 0, z = 0) {
    let cx = 0, cz = 0, m = 0;
    for (let k = 0; k < ids.length; k++) { const i = ids[k]; if (i < 0 || i >= this.n || this.state[i] === ST.DEAD || this.removed[i]) continue; cx += this.x[i]; cz += this.z[i]; m++; }
    if (!m) return 0; cx /= m; cz /= m;
    for (let k = 0; k < ids.length; k++) {
      const i = ids[k]; if (i < 0 || i >= this.n || this.state[i] === ST.DEAD || this.removed[i]) continue;
      this.ord[i] = kind; this.ox[i] = x + (this.x[i] - cx); this.oz[i] = z + (this.z[i] - cz);
      if (kind === ORD.HOLD) { this.ox[i] = this.x[i]; this.oz[i] = this.z[i]; }
    }
    return m;
  }
  /** advance by real dt at `speed` x. Time-boxed so a heavy tick can never freeze the page; widens the step when it cannot keep up (see pacer.js). */
  advance(dt, speed = 1) {
    const pc = this.pacer || (this.pacer = new Pacer(this.mode !== 'siege')), t0 = performance.now(); this.owed = (this.owed || 0) + dt * speed;
    const h = TICK * pc.pick(speed); let done = 0;
    while (this.owed >= h && performance.now() - t0 < 14) { const a = performance.now(); this.tick(h); pc.note(performance.now() - a); this.owed -= h; done += h; }
    if (this.owed > 2 * h) this.owed = 2 * h; // cannot keep up: drop the backlog, report the real speed
    pc.tally(done, dt); this.stepDt = h; this.meta[3] = h; this.meta[4] = pc.achieved; this.achieved = pc.achieved; this.acc = this.owed; return this.owed / h;
  }
  tick(dt) {
    const n = this.n, c = this.cells; this.time += dt; this.tickCount++; this.meta[0] = performance.timeOrigin + performance.now(); this.meta[1] = this.tickCount; this.hitEvents.length = 0;
    if (this.siege) this.siege.pre(dt);
    this.buildGrid(); this.stepArrows(dt); if ((this.tickCount & 3) === 0) this.aura();
    if (this.over < 0 && (this.alive[0] === 0 || this.alive[1] === 0)) this.endBattle();
    const { x, z, vx, vz, yaw, team, state, stateT, cd, tgt, spd, clip, morale, rout, cellStart, order } = this, sxs = this.sx, szs = this.sz, W = this.world, MS = n > 30000 ? 8 : 4, MM = MS - 1;
    for (let i = 0; i < n; i++) {
      const st = state[i]; if (st === ST.DEAD || st === ST.CHEER || this.removed[i]) continue;
      stateT[i] += dt; cd[i] -= dt; const me = team[i], dir = me === 0 ? 1 : -1;
      // morale: every MS-th tick. Steady soldiers well behind the enemy front with nobody routing cannot change state, so skip them.
      if (((this.tickCount + i) & MM) === 0 && st !== ST.HIT && !this.siege && (morale[i] < 1 || rout[i] || this.routing[me] > 0 || (me === 0 ? this.frontZ[1] - z[i] : z[i] - this.frontZ[0]) < 14)) this.moraleCheck(i, dt * MS);
      let desX = 0, desZ = 0, sp = 0;
      const ty = TY[this.utype[i]];
      if (st === ST.ATTACK) {
        const j = tgt[i];
        if (j >= 0 && state[j] !== ST.DEAD) { const ex = x[j] - x[i], ez = z[j] - z[i]; this.turn(i, Math.atan2(ex, ez), dt, 8); }
        if (!this.hitDone[i] && stateT[i] >= ty.hit) {
          this.hitDone[i] = 1; const buffed = this.tickCount - this.buffT[i] <= 2 ? 1 : 0;
          if (ty.range) this.fire(i, j, ty, buffed);
          else if (j >= 0 && state[j] !== ST.DEAD) { const ex = x[j] - x[i], ez = z[j] - z[i]; if (ex * ex + ez * ez < (ty.reach + 0.5) ** 2 && this.rand() < 0.8 - TY[this.utype[j]].block - this.fDef[team[j]] + 0.05 * buffed) this.damage(j, (ty.dmg[0] + this.rand() * (ty.dmg[1] - ty.dmg[0])) * (1 + 0.2 * buffed) * (this.tr.fx ? this.combatMul(i, j) : 1) * (this.siege ? this.siege.dmgMul(i, j) : 1), i); }
        }
        if (stateT[i] >= ty.dur) { state[i] = ST.MOVE; cd[i] = ty.cd[0] + this.rand() * (ty.cd[1] - ty.cd[0]); }
      } else if (st === ST.HIT) {
        if (stateT[i] >= D_HIT) { state[i] = ST.MOVE; }
      } else if (this.rout[i]) {
        // broken: sprint for the rear, bending away from whoever is nearest; leave the field at the back edge
        const j = tgt[i]; let ax = 0;
        if (j >= 0 && state[j] !== ST.DEAD) { const ex = x[i] - x[j]; ax = ex > 0 ? 0.5 : -0.5; }
        desX = ax; desZ = -dir; const l = hyp(desX, desZ); desX /= l; desZ /= l; sp = 3.7 * spd[i];
        this.turn(i, Math.atan2(desX, desZ), dt, 9);
        const a = Math.min(1, 6 * dt); vx[i] += (desX * sp - vx[i]) * a; vz[i] += (desZ * sp - vz[i]) * a;
        if (-z[i] * dir > this.world - 12 && this.morale[i] < RALLY_AT) { this.removed[i] = 1; this.rout[i] = 0; this.routing[me]--; this.alive[me]--; this.fled[me]++; continue; }
        if (((this.tickCount + i) & 7) === 0) tgt[i] = this.nearestEnemy(i, 8);
      } else {
        let j = tgt[i];
        const miss = j < 0 ? !this.siege : state[j] === ST.DEAD; // no target / target died: look again now
        if (miss || ((this.tickCount + i) & 7) === 0) {
          const ahead = (me === 0 ? this.frontZ[1] - z[i] : z[i] - this.frontZ[0]);
          const dj = miss || j < 0 ? 0 : (x[j] - x[i]) ** 2 + (z[j] - z[i]) ** 2;
          if (ahead > ty.aggro) j = -1;
          else if (dj > 0 && dj < 12 && this.rand() < 0.75) { /* engaged with someone close: stay on them */ }
          else if (dj > 100 && ((this.tickCount + i) & 15) !== 0) { /* still closing on a distant target: look again later */ }
          else if (miss && j < 0 && this.nsT[i] > 0) { this.nsT[i]--; } // searched and found nobody a moment ago
          else { j = this.nearestEnemy(i, ty.rings); this.nsT[i] = j < 0 ? 6 : 0; }
          tgt[i] = j;
        }
        const o = this.ord[i];
        if (o !== ORD.NONE) {
          // commanded: fight only what is near, otherwise obey the order
          const ex = j >= 0 ? x[j] - x[i] : 0, ez = j >= 0 ? z[j] - z[i] : 0, d = j >= 0 ? hyp(ex, ez) : 1e9;
          const engage = ty.range ? ty.stand : o === ORD.HOLD ? REACH * 1.4 : o === ORD.ADVANCE ? 9 : REACH * 1.05;
          if (d < engage) {
            this.turn(i, Math.atan2(ex, ez), dt, 7);
            if (d < ty.stand) { if (cd[i] <= 0) { state[i] = ST.ATTACK; stateT[i] = 0; this.hitDone[i] = 0; } }
            else { sp = 1.6; desX = ex / d; desZ = ez / d; }
          } else if (o === ORD.HOLD) {
            const hx = this.ox[i] - x[i], hz = this.oz[i] - z[i], hd = hyp(hx, hz);
            if (hd > 1.2) { sp = 1.4; desX = hx / hd; desZ = hz / hd; this.turn(i, Math.atan2(hx, hz), dt, 6); } else if (j >= 0 && d < 40) this.turn(i, Math.atan2(ex, ez), dt, 3);
          } else {
            const px = this.ox[i] - x[i], pz = this.oz[i] - z[i], pd = hyp(px, pz);
            if (pd < 2.5) { this.ord[i] = o === ORD.FLANK ? ORD.NONE : ORD.HOLD; this.ox[i] = x[i]; this.oz[i] = z[i]; }
            else { sp = pd > 7 ? 3.4 : 1.6; desX = px / pd; desZ = pz / pd; this.turn(i, Math.atan2(px, pz), dt, 6); }
          }
        } else if (j >= 0) {
          const ex = x[j] - x[i], ez = z[j] - z[i], d = hyp(ex, ez);
          this.turn(i, Math.atan2(ex, ez), dt, 7);
          if (d < ty.stand) { sp = 0; if (cd[i] <= 0) { state[i] = ST.ATTACK; stateT[i] = 0; this.hitDone[i] = 0; } if (ty.kite && d < ty.kite) { sp = 1.4; desX = -ex / d; desZ = -ez / d; } }
          else { sp = d > (ty.range ? ty.range * 1.5 : 7) ? 3.4 : 1.6; desX = ex / d; desZ = ez / d; }
        } else { sp = 1.4; const ox = 1 - me, ex = this.cenX[ox] - x[i], ez = this.cenZ[ox] - z[i], l = hyp(ex, ez) || 1; desX = ex / l; desZ = ez / l; this.turn(i, Math.atan2(desX, desZ), dt, 4); }
        if (this.tr.ford && sp > 0) { const q = this.fordSteer(i, desX, desZ, j >= 0 ? hyp(x[j] - x[i], z[j] - z[i]) : 99, dir); desX = q[0]; desZ = q[1]; }
        if (this.siege) { this.siege.steer(i, j, desX, desZ, sp); desX = this.siege.ox; desZ = this.siege.oz; sp = this.siege.osp; }
        sp *= spd[i] * this.fSpd[me]; if (this.tr.fx && sp > 0) sp *= this.moveMul(i, desX, desZ);
        const a = Math.min(1, 5 * dt); vx[i] += (desX * sp - vx[i]) * a; vz[i] += (desZ * sp - vz[i]) * a;
      }
      if (st === ST.ATTACK) { vx[i] *= 0.7; vz[i] *= 0.7; }
      if (st === ST.HIT) { vx[i] *= 0.88; vz[i] *= 0.88; }
      // SEP is under half a cell, so only the cell we are in plus the nearer neighbour on each axis can hold a contact (2x2, not 3x3)
      const ci = this.cellOf[i], cx = ci % c, cz = (ci / c) | 0, px = x[i], pz = z[i]; let sx = 0, sz = 0;
      const x0 = px + W - cx * CELL < CELL / 2 ? cx - 1 : cx, z0 = pz + W - cz * CELL < CELL / 2 ? cz - 1 : cz;
      for (let zz = z0; zz <= z0 + 1; zz++) { if (zz < 0 || zz >= c) continue;
        for (let xx = x0; xx <= x0 + 1; xx++) { if (xx < 0 || xx >= c) continue; const cc = zz * c + xx;
          for (let k = cellStart[cc], e = cellStart[cc + 1]; k < e; k++) {
            const ex = px - sxs[k], ez = pz - szs[k], d2 = ex * ex + ez * ez; if (d2 >= SEP2) continue; const j = order[k]; if (j === i) continue;
            if (!(this.siege && Math.abs(this.elev[i] - this.elev[j]) > 1.5)) { const d = Math.sqrt(d2) || 0.001, push = (SEP - d) / SEP; sx += (ex / d) * push; sz += (ez / d) * push; if (d2 === 0) { sx += (i & 1) - 0.5; } } } } }
      x[i] += vx[i] * dt + sx * 0.32; z[i] += vz[i] * dt + sz * 0.32;
      if (x[i] < -this.world + 5) x[i] = -this.world + 5; else if (x[i] > this.world - 5) x[i] = this.world - 5;
      if (z[i] < -this.world + 5) z[i] = -this.world + 5; else if (z[i] > this.world - 5) z[i] = this.world - 5;
      if (this.siege) this.siege.post(i, dt);
      // animation selection
      const s = Math.sqrt(vx[i] * vx[i] + vz[i] * vz[i]);
      if (state[i] === ST.ATTACK) this.setClip(i, ty.clip, 0);
      else if (state[i] === ST.HIT) this.setClip(i, CLIP.HIT, 0);
      else if (s > 2.6) this.setClip(i, CLIP.RUN, (this.animT[i] % 1) * 0.62);
      else if (s > 0.35) this.setClip(i, CLIP.WALK, (this.animT[i] % 1) * 0.8);
      else if (s < 0.2 && this.clip[i] !== CLIP.IDLE) this.setClip(i, CLIP.IDLE, this.rand() * 2);
    }
    // clip time + blending, corpse retirement
    for (let i = 0; i < n; i++) {
      if (this.removed[i]) continue; const cl = CLIPS[clip[i]];
      if (cl.speed) this.animT[i] += dt * Math.max(0.4, Math.min(1.8, Math.sqrt(vx[i] * vx[i] + vz[i] * vz[i]) / cl.speed)); else this.animT[i] += dt;
      if (cl.loop) { if (this.animT[i] > cl.dur) this.animT[i] -= cl.dur; } else if (this.animT[i] > cl.dur) this.animT[i] = cl.dur;
      if (this.blend[i] < 1) this.blend[i] = Math.min(1, this.blend[i] + dt / 0.18);
      if (state[i] === ST.DEAD) { stateT[i] += dt; if (this.siege) this.siege.fall(i, dt); if (stateT[i] > this.corpseLife) this.removed[i] = 1; }
    }
    while (this.deadQ.length - this.deadHead > this.corpseCap) this.removed[this.deadQ[this.deadHead++]] = 1;
    if (this.deadHead > 4096) { this.deadQ = this.deadQ.slice(this.deadHead); this.deadHead = 0; }
  }
  /** Loose an arrow or javelin from i at j, leading the target and arcing under gravity. */
  fire(i, j, ty, buffed) {
    const k = this.ahead; this.ahead = (this.ahead + 1) % MAXA;
    const x0 = this.x[i], z0 = this.z[i], y0 = heightAt(x0, z0) + 1.45; let tx = this.x[i] + Math.sin(this.yaw[i]) * 20, tz = this.z[i] + Math.cos(this.yaw[i]) * 20;
    if (j >= 0 && this.state[j] !== ST.DEAD) { tx = this.x[j]; tz = this.z[j]; const d0 = Math.hypot(tx - x0, tz - z0), T0 = d0 / ty.speed; tx += this.vx[j] * T0; tz += this.vz[j] * T0; }
    const d = Math.max(2, Math.hypot(tx - x0, tz - z0)), T = d / ty.speed, wob = d * 0.012, ex = tx + (this.rand() - 0.5) * wob * 2, ez = tz + (this.rand() - 0.5) * wob * 2;
    const ty1 = heightAt(ex, ez) + 1.0, vy = (ty1 - y0 + 0.5 * GRAV * T * T) / T;
    this.avel[k * 3] = (ex - x0) / T; this.avel[k * 3 + 1] = vy; this.avel[k * 3 + 2] = (ez - z0) / T; this.ateam[k] = this.team[i]; this.ashooter[k] = i;
    this.admg[k] = (ty.dmg[0] + this.rand() * (ty.dmg[1] - ty.dmg[0])) * (1 + 0.2 * buffed);
    this.apos[k * 4] = x0; this.apos[k * 4 + 1] = y0; this.apos[k * 4 + 2] = z0; this.apos[k * 4 + 3] = ty.kind; this.adir[k * 4 + 3] = 1;
  }
  stepArrows(dt) {
    const c = this.cells;
    for (let k = 0; k < MAXA; k++) {
      if (this.adir[k * 4 + 3] === 0) continue;
      const v = this.avel, p = this.apos; v[k * 3 + 1] -= GRAV * dt; p[k * 4] += v[k * 3] * dt; p[k * 4 + 1] += v[k * 3 + 1] * dt; p[k * 4 + 2] += v[k * 3 + 2] * dt;
      const l = Math.hypot(v[k * 3], v[k * 3 + 1], v[k * 3 + 2]) || 1; this.adir[k * 4] = v[k * 3] / l; this.adir[k * 4 + 1] = v[k * 3 + 1] / l; this.adir[k * 4 + 2] = v[k * 3 + 2] / l;
      const gy = heightAt(p[k * 4], p[k * 4 + 2]);
      if (v[k * 3 + 1] < 0 && p[k * 4 + 1] < gy + 1.1) {
        let hit = -1; const ci = this.cellIdx(p[k * 4], p[k * 4 + 2]), cx = ci % c, cz = (ci / c) | 0;
        for (let dz = -1; dz <= 1 && hit < 0; dz++) for (let dx = -1; dx <= 1 && hit < 0; dx++) { const xx = cx + dx, zz = cz + dz; if (xx < 0 || zz < 0 || xx >= c || zz >= c) continue; const cc = zz * c + xx;
          for (let q = this.cellStart[cc]; q < this.cellStart[cc + 1]; q++) { const j = this.order[q]; if (this.team[j] === this.ateam[k] || this.state[j] === ST.DEAD) continue;
            const ex = this.x[j] - p[k * 4], ez = this.z[j] - p[k * 4 + 2]; if (ex * ex + ez * ez < 1.0) { hit = j; break; } } }
        if (hit >= 0 && this.rand() > TY[this.utype[hit]].block * 0.9) this.damage(hit, this.admg[k], this.ashooter[k]);
        if (hit >= 0 || p[k * 4 + 1] < gy + 0.05) this.adir[k * 4 + 3] = 0;
      } else if (p[k * 4 + 1] < gy - 0.5) this.adir[k * 4 + 3] = 0;
    }
  }
  /** Commanders rally troops within 24 m (extra damage and accuracy). */
  aura() {
    const c = this.cells;
    for (const i of this.cmdList) {
      if (this.state[i] === ST.DEAD || this.removed[i]) continue; const ci = this.cellOf[i]; if (ci < 0) continue; const cx = ci % c, cz = (ci / c) | 0;
      for (let dz = -12; dz <= 12; dz++) { const zz = cz + dz; if (zz < 0 || zz >= c) continue; for (let dx = -12; dx <= 12; dx++) { const xx = cx + dx; if (xx < 0 || xx >= c) continue; const cc = zz * c + xx;
        for (let k = this.cellStart[cc]; k < this.cellStart[cc + 1]; k++) { const j = this.order[k]; if (this.team[j] === this.team[i]) this.buffT[j] = this.tickCount; } } }
    }
  }
  /** One side is wiped out: survivors stop marching and cheer instead of walking off the map. */
  endBattle() {
    this.over = this.alive[0] === 0 ? 1 : 0;
    for (let i = 0; i < this.n; i++) {
      if (this.removed[i] || this.state[i] === ST.DEAD) continue;
      this.state[i] = ST.CHEER; this.vx[i] = this.vz[i] = 0; this.tgt[i] = -1;
      this.setClip(i, CLIP.CHEER, this.rand() * 1.2);
    }
  }
  /** terrain speed: uphill and trees slow, water slows most (wading 0.62, deep 0.38) */
  moveMul(i, dx, dz) {
    const tr = this.tr, c = cellOf(tr, this.x[i], this.z[i]), k = tr.K[c]; let m = k === 2 ? 0.38 : k === 1 ? 0.62 : 1;
    m *= 1 - 0.45 * (tr.F[c] / 255);
    const l = hyp(dx, dz); if (l > 0.01) { const up = (tr.Gx[c] * dx + tr.Gz[c] * dz) / l; m *= Math.max(0.5, Math.min(1.15, 1 - 2.5 * up)); }
    return m;
  }
  /** terrain combat: high ground hits harder, trees give cover, fighting waist-deep in water is clumsy */
  combatMul(i, j) {
    const tr = this.tr, a = cellOf(tr, this.x[i], this.z[i]), b = cellOf(tr, this.x[j], this.z[j]);
    let m = Math.max(0.7, Math.min(1.45, 1 + 0.045 * (tr.H[a] - tr.H[b])));
    m *= 1 - 0.3 * (tr.F[b] / 255); if (tr.K[a] === 2) m *= 0.6; else if (tr.K[a] === 1) m *= 0.85; return m;
  }
  /** armies funnel toward the ford when the river is between them and the enemy */
  fordSteer(i, dx, dz, d, dir) {
    const f = this.tr.ford, x = this.x[i], z = this.z[i], dist = -z * dir - f.half;
    if (dist < -2 || dist > 80 || d < 18 || Math.abs(x) < f.fh - 6) return [dx, dz];
    const ex = (Math.max(-(f.fh - 8), Math.min(f.fh - 8, x)) - x), ez = -dir * (f.half + 2) - z, l = hyp(ex, ez) || 1, w = 0.85 * (1 - dist / 80);
    const ox = dx * (1 - w) + (ex / l) * w, oz = dz * (1 - w) + (ez / l) * w, ol = hyp(ox, oz) || 1; return [ox / ol, oz / ol];
  }
  turn(i, target, dt, rate) {
    let d = target - this.yaw[i]; d -= 6.283185307179586 * Math.round(d / 6.283185307179586); const m = rate * dt;
    this.yaw[i] += Math.max(-m, Math.min(m, d));
  }
  winner() { return this.over; }
  hash() { let h = 2166136261; for (let i = 0; i < this.n; i += 7) { h = Math.imul(h ^ ((this.x[i] * 100) | 0), 16777619); h = Math.imul(h ^ ((this.hp[i]) | 0), 16777619); } return h >>> 0; }
}
