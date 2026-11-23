import { Sim } from './sim.js';
import { Pacer, BASE } from './pacer.js';
// Wall-clock paced sim loop. Runs ticks as they fall due, in time-boxed slices so orders / pause / speed messages are never starved.
let sim, paused = false, timer, speed = 1, pc, last = 0, tickWall = 0, gap = 50;
const mc = new MessageChannel(); let queued = false;
const soon = () => { if (!queued) { queued = true; mc.port2.postMessage(0); } };
mc.port1.onmessage = () => { queued = false; loop(); };
function loop() {
  clearTimeout(timer); const now = performance.now(); let wall = (now - last) / 1000; last = now;
  if (paused) { pc.owed = 0; timer = setTimeout(loop, 40); return; }
  pc.owed = (pc.owed || 0) + wall * speed; const h = BASE * pc.pick(speed); let done = 0;
  while (pc.owed >= h && performance.now() - now < 20) {
    const a = performance.now(); sim.tick(h); const b = performance.now(); pc.note(b - a); pc.owed -= h; done += h;
    gap = gap * 0.8 + (b - tickWall) * 0.2; tickWall = b; sim.meta[2] = gap;
    if (sim.hitEvents.length) postMessage({ type: 'hits', hits: sim.hitEvents.slice(0, 24) });
  }
  if (pc.owed > 2 * h) pc.owed = 2 * h; // behind: drop the backlog and report the real speed instead of spiralling
  pc.tally(done, wall); sim.meta[3] = h; sim.meta[4] = pc.achieved;
  if (pc.owed >= h) soon(); else timer = setTimeout(loop, Math.max(0, ((h - pc.owed) / speed) * 1000));
}
onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') {
    clearTimeout(timer); sim = new Sim({ ...m.opts, shared: true }); pc = new Pacer(sim.mode !== 'siege'); const bufs = {};
    for (const k of sim.fieldNames) bufs[k] = sim[k].buffer;
    postMessage({ type: 'ready', n: sim.n, world: sim.world, mode: sim.mode, perSide: sim.perSide, typeCount: sim.typeCount, bufs });
    last = tickWall = performance.now(); sim.meta[2] = gap = BASE * 1000 / speed; sim.meta[3] = BASE; sim.meta[4] = 1; loop();
  } else if (m.type === 'pause') { paused = m.v; last = performance.now(); }
  else if (m.type === 'order') sim.command(m.ids, m.kind, m.x, m.z);
  else if (m.type === 'speed') { speed = m.v; pc.m = 1; }
};
