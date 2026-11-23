// Battlefield ground shared by the sim (worker) and the renderer.
// Presets: flat (default, gentle swell, no gameplay effect), hills, ford (river with a crossing), forest (tree edge).
// Everything is analytic, then cached on a 1 m grid so the sim can look up height / slope / water / forest cheaply.
export const TERRAINS = { flat: 'Open field', hills: 'Hills', ford: 'River ford', forest: 'Forest edge' };
export const WATER_Y = -0.05, RIVER_HALF = 9;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const gauss = (x, z, cx, cz, sx, sz, h) => h * Math.exp(-(((x - cx) / sx) ** 2 + ((z - cz) / sz) ** 2) / 2);
const base = (x, z) => 0.9 * Math.sin(x * 0.0046 + 1.3) * Math.cos(z * 0.0039 + 0.4) + 0.45 * Math.sin(x * 0.012 + z * 0.009) + 0.12 * Math.sin(x * 0.05) * Math.sin(z * 0.045);

let cfg = { id: 'flat', world: 300, fordHalf: 30 };
let cache = null;

function analyticHeight(x, z) {
  let h = base(x, z); const w = cfg.world;
  if (cfg.id === 'hills') {
    const f = 1 - smooth(w, w + 80, Math.max(Math.abs(x), Math.abs(z)));
    h += f * (gauss(x, z, -0.2 * w, -10, 0.18 * w, 30, 13) + gauss(x, z, 0.3 * w, 30, 0.1 * w, 24, 9) + gauss(x, z, 0.05 * w, -55, 28, 20, 6) + gauss(x, z, -0.1 * w, 60, 0.15 * w, 18, 4));
  } else if (cfg.id === 'ford') {
    const dz = Math.abs(z), flat = 1 - smooth(RIVER_HALF + 3, RIVER_HALF + 45, dz), chan = 1 - smooth(RIVER_HALF - 2, RIVER_HALF + 3, dz);
    const fm = 1 - smooth(cfg.fordHalf, cfg.fordHalf + 10, Math.abs(x)); // 1 on the crossing
    h = mix(h, 0.55, flat); h = mix(h, mix(-1.6, -0.35, fm), chan);
  }
  return h;
}
// density of trees 0..1 (forest edge: right half of the clash zone)
export function forestAt(x, z) {
  if (cfg.id !== 'forest') return 0;
  const ex = 0.04 * cfg.world + 7 * Math.sin(z * 0.06) + 4 * Math.sin(z * 0.15 + 1);
  return smooth(ex, ex + 14, x) * (1 - smooth(38, 62, Math.abs(z))) * (1 - smooth(cfg.world - 25, cfg.world, Math.abs(x)));
}
export const waterKind = (h) => (h >= WATER_Y ? 0 : h < -0.9 ? 2 : 1); // 0 dry, 1 wading, 2 deep

/** Build (or reuse) the terrain for a given world half-size. Returns the lookup grid. */
export function setTerrain(id = 'flat', world = 300) {
  if (!TERRAINS[id]) id = 'flat';
  if (cache && cfg.id === id && cfg.world === world) return cache;
  cfg = { id, world, fordHalf: clamp(world * 0.16, 22, 45) };
  const W = Math.ceil(world * 2) + 2, n = W * W, H = new Float32Array(n), Gx = new Float32Array(n), Gz = new Float32Array(n), K = new Uint8Array(n), F = new Uint8Array(n);
  for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) { const x = i - world + 0.5, z = j - world + 0.5, p = j * W + i; H[p] = analyticHeight(x, z); K[p] = waterKind(H[p]); F[p] = Math.round(forestAt(x, z) * 255); }
  for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) { const p = j * W + i, l = i > 0 ? p - 1 : p, r = i < W - 1 ? p + 1 : p, d = j > 0 ? p - W : p, u = j < W - 1 ? p + W : p; Gx[p] = (H[r] - H[l]) / (r - l || 1); Gz[p] = (H[u] - H[d]) / ((u - d) / W || 1); }
  cache = { id, world, W, H, Gx, Gz, K, F, fx: id !== 'flat', ford: id === 'ford' ? { half: RIVER_HALF, fh: cfg.fordHalf } : null };
  return cache;
}
export function cellOf(tr, x, z) { const i = clamp((x + tr.world) | 0, 0, tr.W - 1), j = clamp((z + tr.world) | 0, 0, tr.W - 1); return j * tr.W + i; }

/** Ground height, bilinear from the grid inside the world, analytic outside. */
// Siege scenarios level the ground so the wall walkway is a single height.
export const ground = { flat: false };
export function heightAt(x, z) {
  if (ground.flat) return 0;
  const t = cache; if (!t) return base(x, z);
  const gx = x + t.world - 0.5, gz = z + t.world - 0.5;
  if (gx < 0 || gz < 0 || gx >= t.W - 1 || gz >= t.W - 1) return analyticHeight(x, z);
  const i = gx | 0, j = gz | 0, fx = gx - i, fz = gz - j, p = j * t.W + i, H = t.H;
  return mix(mix(H[p], H[p + 1], fx), mix(H[p + t.W], H[p + t.W + 1], fx), fz);
}
export const analyticHeightAt = (x, z) => analyticHeight(x, z);

/** Deterministic tree positions [x,z,scale,rot]* for the forest preset. */
export function treeSpots(cap) {
  if (cfg.id !== 'forest') return new Float32Array(0);
  const w = cfg.world, area = (w + 10) * 124, S = Math.max(5, Math.sqrt(area / cap)); let s = 12345; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647); const out = [];
  for (let z = -62; z <= 62; z += S) for (let x = -0.1 * w; x <= w; x += S) {
    const px = x + (r() - 0.5) * S * 0.8, pz = z + (r() - 0.5) * S * 0.8, d = forestAt(px, pz);
    if (r() < d * 1.1 && out.length / 4 < cap) out.push(px, pz, 0.8 + r() * 0.8, r() * 6.283);
  }
  return new Float32Array(out);
}
