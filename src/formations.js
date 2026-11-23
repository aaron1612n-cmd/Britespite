// Army layouts. Each returns slots {x, d}: x across the front, d = depth behind the front rank (metres).
export const FORMATIONS = {
  block:  { name: 'Phalanx block', sp: 1.2,  spd: 1.0,  def: 0.06 },
  line:   { name: 'Long line',     sp: 1.2,  spd: 1.0,  def: 0.0 },
  column: { name: 'Column',        sp: 1.2,  spd: 1.12, def: -0.05 },
  wedge:  { name: 'Wedge',         sp: 1.3,  spd: 1.05, def: 0.0 },
  loose:  { name: 'Loose skirmish', sp: 2.4, spd: 1.1,  def: -0.05 },
  wall:   { name: 'Shield wall',   sp: 0.95, spd: 0.75, def: 0.18 },
};
export const FORMATION_KEYS = Object.keys(FORMATIONS);

export function slots(kind, N, rand) {
  const f = FORMATIONS[kind] || FORMATIONS.block, sp = f.sp, x = new Float32Array(N), d = new Float32Array(N);
  const grid = (files) => { for (let k = 0; k < N; k++) { x[k] = ((k % files) - (files - 1) / 2) * sp; d[k] = ((k / files) | 0) * sp; } };
  if (kind === 'line') grid(Math.ceil(Math.sqrt(N * 9)));
  else if (kind === 'column') grid(Math.max(3, Math.ceil(Math.sqrt(N / 7))));
  else if (kind === 'wall') grid(Math.ceil(Math.sqrt(N * 12)));
  else if (kind === 'wedge') {
    let k = 0; for (let r = 0; k < N; r++) for (let i = 0; i <= 2 * r && k < N; i++, k++) { x[k] = (i - r) * sp; d[k] = r * sp * 0.9; }
  } else if (kind === 'loose') { // jittered grid: scattered but never stacked
    const files = Math.ceil(Math.sqrt(N * 2.2));
    for (let k = 0; k < N; k++) { x[k] = ((k % files) - (files - 1) / 2) * sp + (rand() - 0.5) * 1.3; d[k] = Math.max(0, ((k / files) | 0) * sp + (rand() - 0.5) * 1.3); }
  } else grid(Math.ceil(Math.sqrt(N * 2.8)));
  let maxX = 0, maxD = 0; for (let k = 0; k < N; k++) { maxX = Math.max(maxX, Math.abs(x[k])); maxD = Math.max(maxD, d[k]); }
  return { x, d, halfWidth: maxX, depth: maxD };
}
