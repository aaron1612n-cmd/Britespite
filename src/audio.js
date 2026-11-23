// Tiny synthesized battle audio. Starts only after a user gesture; muted by default.
export class BattleAudio {
  constructor() { this.ctx = null; this.muted = true; this.last = 0; this.rumble = 0; }
  start() {
    if (this.ctx) return; const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const c = (this.ctx = new AC()); this.master = c.createGain(); this.master.gain.value = this.muted ? 0 : 0.7; this.master.connect(c.destination);
    const len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0); let l = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; l = (l + 0.04 * w) / 1.04; d[i] = l * 6; }
    this.noise = buf;
    const src = c.createBufferSource(); src.buffer = buf; src.loop = true; const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500;
    this.bed = c.createGain(); this.bed.gain.value = 0; src.connect(lp); lp.connect(this.bed); this.bed.connect(this.master); src.start();
  }
  setMuted(m) { this.muted = m; if (!m) this.start(); if (this.ctx) { this.master.gain.setTargetAtTime(m ? 0 : 0.7, this.ctx.currentTime, 0.05); if (!m && this.ctx.state === 'suspended') this.ctx.resume(); } }
  /** activity 0..1 drives the crowd bed; events = nearby hit loudness list */
  update(activity, hits) {
    if (!this.ctx || this.muted) return; const t = this.ctx.currentTime;
    this.bed.gain.setTargetAtTime(0.05 + 0.35 * activity, t, 0.3);
    for (const v of hits) { if (t - this.last < 0.04) break; this.last = t; this.clank(v); }
  }
  clank(v) {
    const c = this.ctx, t = c.currentTime, s = c.createBufferSource(); s.buffer = this.noise; s.playbackRate.value = 1.5 + Math.random();
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900 + Math.random() * 2200; f.Q.value = 3; const g = c.createGain();
    g.gain.setValueAtTime(0.35 * v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12); s.connect(f); f.connect(g); g.connect(this.master); s.start(t, Math.random()); s.stop(t + 0.15);
  }
}
