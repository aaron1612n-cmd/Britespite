// Main-thread view onto a Sim running in a worker over SharedArrayBuffers.
const TYPES = { x: Float32Array, z: Float32Array, vx: Float32Array, vz: Float32Array, yaw: Float32Array, hp: Float32Array, stateT: Float32Array, cd: Float32Array, animT: Float32Array, prevT: Float32Array, blend: Float32Array, spd: Float32Array, team: Uint8Array, state: Uint8Array, clip: Uint8Array, prevClip: Uint8Array, removed: Uint8Array, hitDone: Uint8Array, seed: Float32Array, ord: Uint8Array, ox: Float32Array, oz: Float32Array, alive: Int32Array, deaths: Int32Array, meta: Float64Array };
export class RemoteSim {
  constructor(opts) {
    this.TICK = 0.05; this.hitEvents = []; this.paused = false; this.opts = opts; this.worker = new Worker(new URL('./simworker.js', import.meta.url), { type: 'module' });
    this.ready = new Promise((res) => {
      this.worker.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'ready') { this.n = m.n; this.world = m.world; this.perSide = m.perSide; for (const k in TYPES) this[k] = new TYPES[k](m.bufs[k]); res(this); }
        else if (m.type === 'hits') this.hitEvents = m.hits;
      };
    });
    this.worker.postMessage({ type: 'init', opts });
    this.acc = 0;
  }
  advance() { this.hitEvents.length = 0; const a = (performance.timeOrigin + performance.now() - this.meta[0]) / (this.meta[2] || this.TICK * 1000); this.acc = Math.min(1, Math.max(0, a)) * this.TICK; return this.paused ? 0 : Math.min(1.2, Math.max(0, a)); }
  command(ids, kind, x, z) { const a = Int32Array.from(ids); this.worker.postMessage({ type: 'order', ids: a, kind, x, z }, [a.buffer]); return ids.length; }
  setSpeed(v) { this.worker.postMessage({ type: 'speed', v }); }
  setPaused(v) { this.paused = v; this.worker.postMessage({ type: 'pause', v }); }
  winner() { return this.alive[0] === 0 ? 1 : this.alive[1] === 0 ? 0 : -1; }
  terminate() { this.worker.terminate(); }
}
