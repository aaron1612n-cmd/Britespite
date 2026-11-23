// Procedural battle audio (WebAudio, no asset files). Positional: every event is panned and
// filtered by where it happened relative to the free camera. Voice-capped so huge armies stay cheap.
// Starts only after a user gesture; muted by default.
const MAX_VOICES = 20, PER_FRAME = 5, HEAR = 220;
const rnd = (a, b) => a + Math.random() * (b - a);

export class BattleAudio {
  constructor() { this.ctx = null; this.muted = true; this.paused = false; this.voices = 0; this.intensity = 0; this.lastHorn = -99; this.hornedStart = false; }
  start() {
    if (this.ctx) return; const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const c = (this.ctx = new AC()); this.master = c.createGain(); this.master.gain.value = this.muted ? 0 : 0.7;
    const comp = c.createDynamicsCompressor(); this.master.connect(comp); comp.connect(c.destination);
    const len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0); let l = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; l = (l + 0.04 * w) / 1.04; d[i] = l * 6; }
    this.noise = buf; const white = c.createBuffer(1, len, c.sampleRate), wd = white.getChannelData(0); for (let i = 0; i < len; i++) wd[i] = Math.random() * 2 - 1; this.white = white;
    // crowd roar: near layer (full band) and distant layer (muffled), both driven by fighting intensity
    this.nearBed = this.bed(520, 0.9); this.farBed = this.bed(260, 0.5);
    if (this.paused) c.suspend();
  }
  bed(freq, q) {
    const c = this.ctx, src = c.createBufferSource(); src.buffer = this.noise; src.loop = true; src.playbackRate.value = rnd(0.9, 1.1);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq; f.Q.value = q; const g = c.createGain(); g.gain.value = 0;
    src.connect(f); f.connect(g); g.connect(this.master); src.start(); return { g, f };
  }
  setMuted(m) { this.muted = m; if (!m) this.start(); if (this.ctx) { this.master.gain.setTargetAtTime(m ? 0 : 0.7, this.ctx.currentTime, 0.05); this.sync(); } }
  setPaused(p) { this.paused = p; this.sync(); }
  sync() { if (!this.ctx) return; if (this.paused || this.muted) { if (this.ctx.state === 'running' && this.paused) this.ctx.suspend(); } if (!this.paused && this.ctx.state === 'suspended') this.ctx.resume(); }
  reset() { this.hornedStart = false; this.intensity = 0; }
  listen(cam) {
    const L = this.ctx.listener, e = cam.matrixWorld.elements, p = cam.position;
    if (L.positionX) {
      L.positionX.value = p.x; L.positionY.value = p.y; L.positionZ.value = p.z;
      L.forwardX.value = -e[8]; L.forwardY.value = -e[9]; L.forwardZ.value = -e[10]; L.upX.value = e[4]; L.upY.value = e[5]; L.upZ.value = e[6];
    } else { L.setPosition(p.x, p.y, p.z); L.setOrientation(-e[8], -e[9], -e[10], e[4], e[5], e[6]); }
  }
  /** one-shot positional voice: returns {out, t, c} or null if over budget / too far */
  voice(x, y, z, dur, cam, far = HEAR) {
    if (this.voices >= MAX_VOICES) return null;
    const d = Math.hypot(x - cam.position.x, y - cam.position.y, z - cam.position.z); if (d > far) return null;
    const c = this.ctx, p = c.createPanner(); p.panningModel = 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = 6; p.rolloffFactor = 1.3; p.maxDistance = far; p.rolloffFactor = far > HEAR ? 0.6 : 1.3;
    if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; } else p.setPosition(x, y, z);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.max(700, 14000 / (1 + d * 0.06)); // air absorption
    lp.connect(p); p.connect(this.master); this.voices++;
    setTimeout(() => { this.voices--; try { p.disconnect(); } catch (e) {} }, (dur + 0.1) * 1000);
    return { out: lp, t: c.currentTime, c, d };
  }
  noiseHit(v, buf, filt, f, q, peak, dur, rate = 1) {
    const { c, t } = v, s = c.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate;
    const b = c.createBiquadFilter(); b.type = filt; b.frequency.value = f; b.Q.value = q; const g = c.createGain();
    g.gain.setValueAtTime(peak, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur); s.connect(b); b.connect(g); g.connect(v.out); s.start(t, Math.random()); s.stop(t + dur + 0.02);
  }
  ring(v, f, peak, dur) { // metallic partials
    const { c, t } = v, g = c.createGain(); g.gain.setValueAtTime(peak, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur); g.connect(v.out);
    for (const m of [1, 2.76, 5.4]) { const o = c.createOscillator(); o.type = 'square'; o.frequency.value = f * m; const og = c.createGain(); og.gain.value = 0.3 / m; o.connect(og); og.connect(g); o.start(t); o.stop(t + dur + 0.02); }
  }
  /** metal clash on shield/spear */
  clash(x, y, z, cam, k) { const v = this.voice(x, y, z, 0.4, cam); if (!v) return; const a = 0.5 * k;
    this.noiseHit(v, this.white, 'bandpass', rnd(1800, 4200), 2.5, a, 0.1); this.ring(v, rnd(900, 1900), 0.07 * a, rnd(0.18, 0.35)); }
  /** spear thrust whoosh */
  thrust(x, y, z, cam, k) { const v = this.voice(x, y, z, 0.3, cam); if (!v) return; const { c, t } = v;
    const s = c.createBufferSource(); s.buffer = this.white; const b = c.createBiquadFilter(); b.type = 'bandpass'; b.Q.value = 1.2; b.frequency.setValueAtTime(700, t); b.frequency.exponentialRampToValueAtTime(2600, t + 0.16);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.18 * k, t + 0.08); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22); s.connect(b); b.connect(g); g.connect(v.out); s.start(t, Math.random()); s.stop(t + 0.25); }
  /** spear into flesh: thud + short grunt */
  thud(x, y, z, cam, k, kill) { const v = this.voice(x, y, z, 0.5, cam); if (!v) return; const { c, t } = v;
    this.noiseHit(v, this.noise, 'lowpass', 420, 0.7, 0.9 * k, 0.16, rnd(0.8, 1.2));
    if (kill) { const o = c.createOscillator(), g = c.createGain(); o.type = 'sawtooth'; const f0 = rnd(150, 240); o.frequency.setValueAtTime(f0, t + 0.02); o.frequency.exponentialRampToValueAtTime(f0 * 0.6, t + 0.35);
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 700; f.Q.value = 1.5; g.gain.setValueAtTime(0.0001, t + 0.02); g.gain.linearRampToValueAtTime(0.16 * k, t + 0.07); g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      o.connect(f); f.connect(g); g.connect(v.out); o.start(t + 0.02); o.stop(t + 0.42); } }
  /** war horn (long, two detuned saws) */
  horn(x, z, cam, note = 0) { if (!this.ctx || this.muted) return; const t0 = this.ctx.currentTime; if (t0 - this.lastHorn < 0.4) return; this.lastHorn = t0;
    const prev = this.voices; if (this.voices >= MAX_VOICES) return;
    const v = this.voice(x, 12, z, 2.4, cam, 900); if (!v) return; const { c, t } = v;
    const f0 = 98 * Math.pow(2, note / 12), g = c.createGain(), lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(300, t); lp.frequency.linearRampToValueAtTime(1100, t + 0.5); lp.frequency.linearRampToValueAtTime(500, t + 2);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.35, t + 0.35); g.gain.setValueAtTime(0.35, t + 1.3); g.gain.exponentialRampToValueAtTime(0.001, t + 2.2);
    g.connect(lp); lp.connect(v.out);
    for (const dt of [-4, 4]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f0 * 0.96, t); o.frequency.linearRampToValueAtTime(f0, t + 0.25); o.detune.value = dt; o.connect(g); o.start(t); o.stop(t + 2.3); } }
  /** Called each frame. hits: [{x,z,kill}] this frame, activity 0..1 = nearby density, global 0..1 = overall fighting rate */
  update(cam, hits, activity, global, dt) {
    if (!this.ctx || this.muted || this.paused) return; const c = this.ctx, t = c.currentTime;
    this.listen(cam);
    this.intensity += (global - this.intensity) * Math.min(1, dt * 1.5);
    this.nearBed.g.gain.setTargetAtTime(0.04 + 0.34 * activity, t, 0.35); this.nearBed.f.frequency.setTargetAtTime(380 + 900 * activity, t, 0.4);
    this.farBed.g.gain.setTargetAtTime(0.03 + 0.22 * this.intensity, t, 0.6);
    if (hits.length) { // nearest first, capped per frame
      const px = cam.position.x, pz = cam.position.z, py = cam.position.y;
      const arr = hits.map((h) => ({ h, d: (h.x - px) ** 2 + (h.z - pz) ** 2 })).sort((a, b) => a.d - b.d);
      for (let i = 0, n = 0; i < arr.length && n < PER_FRAME; i++) { const h = arr[i].h, k = Math.min(1, 1.1 - Math.sqrt(arr[i].d) / HEAR); if (k < 0.08) break; n++;
        const y = Math.max(0, 1.3); const r = Math.random();
        if (h.kill) { this.thud(h.x, y, h.z, cam, k, true); this.thrust(h.x, y, h.z, cam, k * 0.6); }
        else if (r < 0.5) this.clash(h.x, y, h.z, cam, k); else if (r < 0.8) this.thud(h.x, y, h.z, cam, k, false); else this.thrust(h.x, y, h.z, cam, k); }
    }
  }
}
