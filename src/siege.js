// Siege layout + prop geometry. Pure data (no three.js) so the sim, the renderer and the tests share one source.
export const WALL_H = 7, HT = 1.5, GATE_HALF = 2.4, SPRING = 3.6, TOWER_R = 4.5, TOWER_H = 10, RUN = 2.2;
export const LADDER_LEN = Math.hypot(RUN, WALL_H + 0.5), LADDER_FOOT_Z = -(HT + RUN), LADDER_LEAN = Math.atan2(RUN, WALL_H + 0.5);
export const RAM = { stopZ: -4.75, headZ: 3.2, tailZ: -3.0, pivotY: 3.5, crew: 8, slotX: 2.4, slotZ0: -2.2, slotDz: 1.6 };
export const GATE_HP = 1400;

/** deterministic layout from the sim world size */
export function siegeParams(world) {
  const half = world - 3, gateTower = GATE_HALF + 1.5 + TOWER_R;
  const tx = [-gateTower, gateTower]; for (let x = 48; x < half - 20; x += 48) { tx.push(x, -x); }
  tx.push(-(half - 3), half - 3); tx.sort((a, b) => a - b);
  const ladders = [], edges = tx.filter((x) => Math.abs(x) < half - 4);
  for (let k = 0; k + 1 < tx.length; k++) {
    const a = tx[k] + TOWER_R + 3.5, b = tx[k + 1] - TOWER_R - 3.5; if (b - a < 4 || (a < 0 && b > 0)) continue;
    const cnt = Math.max(1, Math.floor((b - a) / 30));
    for (let m = 0; m < cnt; m++) ladders.push(a + ((m + 0.5) * (b - a)) / cnt);
  }
  return { world, half, towers: tx, ladders, edges };
}
export function siegeWorld(perSide) {
  const esc = Math.max(0, perSide - RAM.crew - Math.round(0.4 * (perSide - RAM.crew))), hold = Math.max(40, perSide >> 1);
  return Math.max(130, 40 + Math.ceil(esc / 80) * 1.2 + 70, 30 + Math.ceil(hold / 46) * 1.2 + 40);
}

// ---------- tiny geometry builder: flat-shaded convex primitives with vertex colours ----------
const hash = (a, b, c) => { let h = Math.imul((a * 73856093) ^ (b * 19349663) ^ (c * 83492791), 2654435761); h ^= h >>> 15; return (h >>> 0) / 4294967296; };
function hexRGB(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; }
export class MeshBuilder {
  constructor() { this.pos = []; this.nrm = []; this.col = []; this.idx = []; this.prims = []; this.cur = null; this.jit = 0.07; }
  begin(name) { this.cur = { name, start: this.idx.length, pts: [], v0: this.pos.length / 3 }; }
  end() {
    const c = this.cur, p = c.pts, mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9], cen = [0, 0, 0];
    for (const q of p) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], q[k]); mx[k] = Math.max(mx[k], q[k]); cen[k] += q[k] / p.length; }
    this.prims.push({ name: c.name, i0: c.start, i1: this.idx.length, v0: c.v0, v1: this.pos.length / 3, min: mn, max: mx, center: cen }); this.cur = null; return this;
  }
  /** one convex face; winding is fixed so the normal points away from the primitive centre */
  face(pts, centre, hex) {
    const [a, b, c] = pts, ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const fc = [0, 0, 0]; for (const p of pts) { fc[0] += p[0] / pts.length; fc[1] += p[1] / pts.length; fc[2] += p[2] / pts.length; }
    if (nx * (fc[0] - centre[0]) + ny * (fc[1] - centre[1]) + nz * (fc[2] - centre[2]) < 0) { pts = pts.slice().reverse(); nx = -nx; ny = -ny; nz = -nz; }
    const base = this.pos.length / 3, rgb = hexRGB(hex), j = 1 + (hash(Math.round(fc[0] * 3), Math.round(fc[1] * 3), Math.round(fc[2] * 3)) - 0.5) * 2 * this.jit;
    for (const p of pts) { this.pos.push(p[0], p[1], p[2]); this.nrm.push(nx, ny, nz); this.col.push(rgb[0] * j, rgb[1] * j, rgb[2] * j); this.cur.pts.push(p); }
    for (let k = 1; k + 1 < pts.length; k++) this.idx.push(base, base + k, base + k + 1);
  }
  /** extrude a convex xy polygon between z0 and z1 */
  prism(name, poly, z0, z1, hex) {
    this.begin(name); const cen = [0, 0, (z0 + z1) / 2]; for (const [x, y] of poly) { cen[0] += x / poly.length; cen[1] += y / poly.length; }
    const f = (z) => poly.map(([x, y]) => [x, y, z]); this.face(f(z0), cen, hex); this.face(f(z1), cen, hex);
    for (let k = 0; k < poly.length; k++) { const a = poly[k], b = poly[(k + 1) % poly.length]; this.face([[a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [a[0], a[1], z1]], cen, hex); }
    return this.end();
  }
  box(name, cx, cy, cz, sx, sy, sz, hex, rotY = 0) {
    const c = Math.cos(rotY), s = Math.sin(rotY), hx = sx / 2, hz = sz / 2, poly = [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]].map(([x, z]) => [cx + x * c + z * s, cz - x * s + z * c]);
    this.begin(name); const cen = [cx, cy, cz], lo = cy - sy / 2, hi = cy + sy / 2;
    this.face(poly.map(([x, z]) => [x, lo, z]), cen, hex); this.face(poly.map(([x, z]) => [x, hi, z]), cen, hex);
    for (let k = 0; k < 4; k++) { const a = poly[k], b = poly[(k + 1) % 4]; this.face([[a[0], lo, a[1]], [b[0], lo, b[1]], [b[0], hi, b[1]], [a[0], hi, a[1]]], cen, hex); }
    return this.end();
  }
  /** cylinder or frustum along y (axis 'y') or z, optional tapered radius at the far end */
  cyl(name, axis, cx, cy, cz, r0, r1, len, seg, hex) {
    this.begin(name); const cen = [cx, cy, cz], ring = (rr, t) => { const o = []; for (let k = 0; k < seg; k++) { const a = (k / seg) * Math.PI * 2, u = Math.cos(a) * rr, w = Math.sin(a) * rr; o.push(axis === 'y' ? [cx + u, cy + t, cz + w] : axis === 'z' ? [cx + u, cy + w, cz + t] : [cx + t, cy + u, cz + w]); } return o; };
    const a = ring(r0, -len / 2), b = ring(r1, len / 2); this.face(a, cen, hex); this.face(b, cen, hex);
    for (let k = 0; k < seg; k++) { const k2 = (k + 1) % seg; this.face([a[k], a[k2], b[k2], b[k]], cen, hex); }
    return this.end();
  }
  arrays() { return { pos: new Float32Array(this.pos), nrm: new Float32Array(this.nrm), col: new Float32Array(this.col), idx: new Uint32Array(this.idx) }; }
}

const C = { stone: '#9c937f', stoneD: '#7d7566', stoneL: '#b3a98f', ring: '#c0b596', timber: '#6b4a2b', timberD: '#4a3320', iron: '#35322f', rope: '#8a7650', leaf: '#5a3e24' };
const arcPts = (r, cy, n) => Array.from({ length: n + 1 }, (_, k) => { const t = (k / n) * Math.PI / 2; return [r * Math.cos(t), cy + r * Math.sin(t)]; });

/** crenellated curtain wall, round towers and the arched gate opening (one static mesh) */
export function buildWall(P) {
  const b = new MeshBuilder(), h = P.half, GX = GATE_HALF + 0.45;
  // wall body either side of the gate, plinth and string course
  for (const s of [-1, 1]) {
    const x0 = GX, x1 = h, cx = s * (x0 + x1) / 2, w = x1 - x0;
    b.box('wall', cx, (WALL_H - 3) / 2, 0, w, WALL_H + 3, HT * 2, C.stone);
    b.box('plinth', cx, -0.8, 0, w, 4.4, HT * 2 + 0.5, C.stoneD);
    b.box('course', cx, 3.4, 0, w, 0.22, HT * 2 + 0.16, C.stoneL);
    b.box('parapet', cx, WALL_H + 0.4, HT - 0.17, w, 0.8, 0.34, C.stoneL);
  }
  b.box('floor', 0, -1.5, 0, GX * 2, 3, HT * 2, C.stoneD);
  b.box('jambL', -GATE_HALF - 0.225, SPRING / 2, 0, 0.45, SPRING, HT * 2, C.ring); b.box('jambR', GATE_HALF + 0.225, SPRING / 2, 0, 0.45, SPRING, HT * 2, C.ring);
  const inner = arcPts(GATE_HALF, SPRING, 8), outer = arcPts(GATE_HALF + 0.45, SPRING, 8), topY = 6.6;
  for (const s of [-1, 1]) for (let k = 0; k < 8; k++) {
    const m = (p) => [s * p[0], p[1]], P0 = inner[k], P1 = inner[k + 1], Q0 = outer[k], Q1 = outer[k + 1];
    b.prism('voussoir', [P0, Q0, Q1, P1].map(m), -HT, HT, C.ring);
    b.prism('spandrel', [[Q0[0], Q0[1]], [Q0[0], topY], [Q1[0], topY], [Q1[0], Q1[1]]].map(m), -HT, HT, C.stone);
  }
  b.box('lintel', 0, (topY + WALL_H) / 2, 0, GX * 2, WALL_H - topY, HT * 2, C.stone);
  b.box('gateParapet', 0, WALL_H + 0.4, HT - 0.17, GX * 2, 0.8, 0.34, C.stoneL);
  // merlons along the outer edge, then towers
  const near = (x) => P.towers.some((t) => Math.abs(x - t) < TOWER_R + 0.5);
  for (let x = -h + 1.5; x < h - 1; x += 2.6) if (!near(x)) b.box('merlon', x, WALL_H + 0.65, -HT + 0.175, 1.4, 1.3, 0.35, C.stoneL);
  for (const tx of P.towers) {
    b.cyl('tower', 'y', tx, (TOWER_H - 3) / 2, 0, TOWER_R + 0.3, TOWER_R, TOWER_H + 3, 14, C.stone);
    b.cyl('towerCrown', 'y', tx, TOWER_H - 0.25, 0, TOWER_R + 0.45, TOWER_R + 0.45, 0.5, 14, C.stoneD);
    b.cyl('towerBand', 'y', tx, 4.2, 0, TOWER_R + 0.12, TOWER_R + 0.12, 0.2, 14, C.stoneL);
    for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; b.box('towerMerlon', tx + Math.cos(a) * (TOWER_R + 0.2), TOWER_H + 0.55, Math.sin(a) * (TOWER_R + 0.2), 1.5, 1.1, 0.4, C.stoneL, -a + Math.PI / 2); }
  }
  return b;
}

/** one gate leaf with its hinge at the local origin, extending towards +x */
export function buildLeaf() {
  const b = new MeshBuilder(), r = GATE_HALF, ar = [];
  for (let k = 0; k <= 8; k++) { const t = Math.PI / 2 + (k / 8) * (Math.PI / 2); ar.push([r + r * Math.cos(t), SPRING + r * Math.sin(t)]); }
  b.prism('leaf', [[0, 0], [r, 0], ...ar], -HT, -HT + 0.28, C.leaf);
  for (const y of [0.7, 2.0, 3.3]) b.box('band', r / 2, y, -HT - 0.02, r, 0.16, 0.12, C.iron);
  b.box('stud', r - 0.18, 1.7, -HT - 0.08, 0.28, 0.28, 0.1, C.iron);
  return b;
}

/** ladder standing upright, foot at the origin, length LADDER_LEN along +y */
export function buildLadder() {
  const b = new MeshBuilder(); b.jit = 0.04;
  for (const s of [-1, 1]) b.box('rail', s * 0.29, LADDER_LEN / 2, 0, 0.09, LADDER_LEN, 0.09, C.timber);
  for (let y = 0.35; y < LADDER_LEN - 0.1; y += 0.42) b.box('rung', 0, y, 0, 0.62, 0.06, 0.07, C.timberD);
  return b;
}

/** battering ram: wheeled hood (static in its own frame) */
export function buildRamFrame() {
  const b = new MeshBuilder(), z0 = RAM.tailZ + 0.6, z1 = RAM.headZ - 0.8; b.jit = 0.05;
  for (const s of [-1, 1]) {
    b.box('beam', s * 1.5, 0.95, (z0 + z1) / 2, 0.22, 0.3, z1 - z0, C.timberD);
    for (const z of [z0 + 0.3, z1 - 0.3]) { b.box('post', s * 1.5, 1.9, z, 0.2, 2.1, 0.2, C.timber); b.cyl('wheel', 'x', s * 1.5 + s * 0.25, 0.5, z, 0.5, 0.5, 0.14, 10, C.iron); b.box('axle', s * 1.62, 0.5, z, 0.34, 0.12, 0.12, C.iron); b.box('hanger', s * 1.5, 0.7, z, 0.14, 0.5, 0.14, C.timberD); }
  }
  for (const z of [z0 + 0.3, z1 - 0.3]) b.box('crossbeam', 0, 0.95, z, 3.0, 0.3, 0.2, C.timberD);
  const y0 = 2.95, ridge = RAM.pivotY + 0.2;
  b.prism('roofL', [[-1.9, y0], [0, ridge], [0, ridge + 0.14], [-1.9, y0 + 0.14]], z0 - 0.1, z1 + 0.1, C.timber);
  b.prism('roofR', [[1.9, y0], [0, ridge], [0, ridge + 0.14], [1.9, y0 + 0.14]], z0 - 0.1, z1 + 0.1, C.timber);
  for (const s of [-1, 1]) for (const z of [z0 + 0.3, z1 - 0.3]) b.box('eave', s * 1.5, 3.0, z, 0.26, 0.2, 0.26, C.timberD);
  return b;
}
/** the swinging log; origin = pivot under the ridge, head at +z */
export function buildRamLog() {
  const b = new MeshBuilder(), L = RAM.headZ - RAM.tailZ, cy = -2.0; b.jit = 0.05;
  b.cyl('log', 'z', 0, cy, (RAM.headZ + RAM.tailZ) / 2 - 0.35, 0.36, 0.34, L - 0.7, 10, C.timber);
  b.cyl('head', 'z', 0, cy, RAM.headZ - 0.35, 0.44, 0.5, 0.7, 10, C.iron);
  b.cyl('band', 'z', 0, cy, RAM.headZ - 1.2, 0.4, 0.4, 0.14, 10, C.iron);
  for (const z of [-1.0, 1.0]) b.box('rope', 0, cy / 2 + 0.2, z, 0.07, -cy - 0.3, 0.07, C.rope);
  return b;
}

/** ram swing angle (radians, positive pulls the head back) and the phase the head strikes */
export const RAM_HIT_PHASE = 0.72;
export function ramSwing(p) {
  if (p < 0.62) return 0.46 * Math.sin((p / 0.62) * Math.PI / 2);
  if (p < RAM_HIT_PHASE) return 0.46 * (1 - (p - 0.62) / (RAM_HIT_PHASE - 0.62));
  return 0.05 * (1 - (p - RAM_HIT_PHASE) / (1 - RAM_HIT_PHASE));
}
/** ladder angle from vertical (negative = lying away from the wall) for raise progress t in 0..1 */
export function ladderAngle(t) { const e = t * t * (3 - 2 * t); return -Math.PI / 2 + (Math.PI / 2 + LADDER_LEAN) * e; }
