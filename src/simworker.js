import { Sim } from './sim.js';
let sim, paused = false, timer, next;
function loop() {
  if (!paused) { sim.tick(sim.TICK); if (sim.hitEvents.length) postMessage({ type: 'hits', hits: sim.hitEvents.slice(0, 24) }); }
  next += sim.TICK * 1000; const now = performance.now(); if (next < now - 250) next = now;
  timer = setTimeout(loop, Math.max(0, next - now));
}
onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') {
    clearTimeout(timer); sim = new Sim({ ...m.opts, shared: true }); const bufs = {};
    for (const k of sim.fieldNames) bufs[k] = sim[k].buffer;
    postMessage({ type: 'ready', n: sim.n, world: sim.world, perSide: sim.perSide, bufs });
    next = performance.now(); loop();
  } else if (m.type === 'pause') paused = m.v;
};
