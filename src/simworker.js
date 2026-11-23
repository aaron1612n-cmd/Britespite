import { Sim } from './sim.js';
let sim, paused = false, timer, next, speed = 1;
function loop() {
  if (!paused) { sim.tick(sim.TICK); if (sim.hitEvents.length) postMessage({ type: 'hits', hits: sim.hitEvents.slice(0, 24) }); }
  const iv = (sim.TICK * 1000) / speed; sim.meta[2] = iv; next += iv; const now = performance.now(); if (next < now - 250) next = now;
  timer = setTimeout(loop, Math.max(0, next - now));
}
onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') {
    clearTimeout(timer); sim = new Sim({ ...m.opts, shared: true }); const bufs = {};
    for (const k of sim.fieldNames) bufs[k] = sim[k].buffer;
    postMessage({ type: 'ready', n: sim.n, world: sim.world, mode: sim.mode, perSide: sim.perSide, typeCount: sim.typeCount, bufs });
    next = performance.now(); loop();
  } else if (m.type === 'pause') paused = m.v;
  else if (m.type === 'order') sim.command(m.ids, m.kind, m.x, m.z);
  else if (m.type === 'speed') speed = m.v;
};
