// Sim tick benchmark: node scripts/bench.mjs [perSide ...]   (default 10000 25000 50000 = 20k/50k/100k soldiers)
// "march" = armies advancing, "melee" = lines locked in combat (gap 8 m, 120 warm-up ticks, then measured).
import { Sim } from '../src/sim.js';
const sizes = process.argv.slice(2).map(Number); if (!sizes.length) sizes.push(10000, 25000, 50000);
// best of 4 chunks of k/4 ticks (the machine is noisy)
const run = (s, k) => { let best = 1e9; for (let c = 0; c < 4; c++) { const t = performance.now(); for (let i = 0; i < k / 4; i++) s.tick(0.05); best = Math.min(best, (performance.now() - t) / (k / 4)); } return best; };
for (const n of sizes) {
  const a = new Sim({ perSide: n, seed: 3 }), march = run(a, 40);
  const b = new Sim({ perSide: n, seed: 3, gap: 8 }); run(b, 120); const melee = run(b, 40);
  console.log(`${(n * 2 / 1000)}k soldiers: march ${march.toFixed(1)}  melee ${melee.toFixed(1)} ms/tick  (alive ${b.alive[0] + b.alive[1]})`);
}
