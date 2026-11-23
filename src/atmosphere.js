// Time of day + weather. Presets are blended into one target state; the live state eases toward it
// (instantly when the player prefers reduced motion) and is pushed into lights, fog, sky and soldier shaders.
import * as THREE from 'three';

export const TIMES = { day: 'Day', dusk: 'Dusk' };
export const WEATHERS = { clear: 'Clear', fog: 'Fog', rain: 'Rain' };
export const FOG_BASE = 0.0009;

const C = (h) => new THREE.Color(h), V = (a) => new THREE.Vector3(...a);
const TIME = {
  day: { sun: [0.45, 0.8, 0.35], sunCol: '#fff0d8', sunI: 2.2, top: '#5f8cb8', hor: '#c9d3d6', fog: '#c9d3d6', fogK: 1, hemiS: '#cfe0f0', hemiG: '#6a6a4a', hemiI: 1.0, ambS: [0.5, 0.58, 0.68], ambG: [0.32, 0.3, 0.26], glow: 0.25, glowCol: '#fff2d0' },
  dusk: { sun: [-0.85, 0.26, 0.5], sunCol: '#ff9d58', sunI: 2.0, top: '#34426b', hor: '#e59b66', fog: '#c88f72', fogK: 1.3, hemiS: '#8791b8', hemiG: '#4d3f3a', hemiI: 0.85, ambS: [0.36, 0.38, 0.5], ambG: [0.25, 0.21, 0.19], glow: 1.0, glowCol: '#ff9a50' },
};
const WEATHER = {
  clear: { fogK: 1, gray: 0, bright: 1, sun: 1, amb: 1, rain: 0, wet: 0, glow: 1 },
  fog: { fogK: 4.5, gray: 0.75, bright: 1, sun: 0.45, amb: 1.1, rain: 0, wet: 0.2, glow: 0.25 },
  rain: { fogK: 2, gray: 0.8, bright: 0.72, sun: 0.25, amb: 0.85, rain: 1, wet: 1, glow: 0 },
};
const gray = (c, w) => { const l = (c.r * 0.3 + c.g * 0.59 + c.b * 0.11) * w.bright; return c.clone().lerp(new THREE.Color(l, l, l), w.gray); };
const tone = (s) => { // overall brightness vs a clear day, per channel, for the flat-shaded far impostors
  const d = TIME.day; const ref = (a, g, sc) => 0.5 * (a + g) + sc * d.sunI * 0.19;
  const dc = C(d.sunCol); const r = ref(d.ambS[0], d.ambG[0], dc.r), g = ref(d.ambS[1], d.ambG[1], dc.g), b = ref(d.ambS[2], d.ambG[2], dc.b);
  return new THREE.Vector3((0.5 * (s.ambS.x + s.ambG.x) + s.sunCol.r * s.sunI * 0.19) / r, (0.5 * (s.ambS.y + s.ambG.y) + s.sunCol.g * s.sunI * 0.19) / g, (0.5 * (s.ambS.z + s.ambG.z) + s.sunCol.b * s.sunI * 0.19) / b);
};
function target(time, weather) {
  const t = TIME[time] || TIME.day, w = WEATHER[weather] || WEATHER.clear;
  const s = { sun: V(t.sun).normalize(), sunCol: C(t.sunCol), sunI: t.sunI * w.sun, top: gray(C(t.top), w), hor: gray(C(t.hor), w), fog: gray(C(t.fog), w), fogD: FOG_BASE * t.fogK * w.fogK,
    hemiS: gray(C(t.hemiS), w), hemiG: gray(C(t.hemiG), w), hemiI: t.hemiI * w.amb, ambS: V(t.ambS).multiplyScalar(w.amb * (0.6 + 0.4 * w.bright)), ambG: V(t.ambG).multiplyScalar(w.amb * (0.6 + 0.4 * w.bright)),
    glow: C(t.glowCol).multiplyScalar(t.glow * w.glow), rain: w.rain, wet: w.wet };
  s.tone = tone(s); return s;
}
function ease(cur, tgt, k) {
  for (const key in tgt) { const a = cur[key], b = tgt[key]; if (typeof b === 'number') cur[key] = a + (b - a) * k; else a.lerp(b, k); }
}
const clone = (s) => { const o = {}; for (const k in s) o[k] = typeof s[k] === 'number' ? s[k] : s[k].clone(); return o; };

const RAIN_VS = /* glsl */`
uniform float uT; uniform vec3 uCam; uniform vec3 uBox; uniform float uLen;
attribute vec3 seed; attribute float tail; varying float vA;
void main() {
  vec3 p; float sp = 8.0 + seed.z * 4.0;
  p.x = uCam.x + mod(seed.x * uBox.x - uCam.x + uBox.x * 0.5, uBox.x) - uBox.x * 0.5;
  p.z = uCam.z + mod(seed.z * 977.0 * uBox.z - uCam.z + uBox.z * 0.5, uBox.z) - uBox.z * 0.5;
  p.y = uCam.y + mod(seed.y * uBox.y - uT * sp - uCam.y + uBox.y * 0.5, uBox.y) - uBox.y * 0.5;
  p += vec3(-0.18, 1.0, 0.0) * tail * uLen;
  vec4 mv = viewMatrix * vec4(p, 1.0); vA = (1.0 - tail * 0.9) * (1.0 - smoothstep(0.35, 0.5, length(p.xz - uCam.xz) / uBox.x));
  gl_Position = projectionMatrix * mv;
}`;
const RAIN_FS = 'precision mediump float; uniform vec3 uCol; uniform float uAlpha; varying float vA; void main(){ gl_FragColor = vec4(uCol, vA * uAlpha); }';

export class Atmosphere {
  /** b: Battlefield (needs uniforms, scene, sky, terrain, sun, hemi) */
  constructor(b, { time = 'day', weather = 'clear', reduced = false, coarse = false } = {}) {
    this.b = b; this.reduced = reduced; this.time = time; this.weather = weather; this.t = 0; this.last = performance.now();
    this.tgt = target(time, weather); this.cur = clone(this.tgt);
    const n = coarse ? 900 : 2600, seed = new Float32Array(n * 6), tail = new Float32Array(n * 2); let s = 99; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < n; i++) { const a = r(), c = r(), d = r(); for (let k = 0; k < 2; k++) seed.set([a, c, d], (i * 2 + k) * 3); tail[i * 2 + 1] = 1; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 6), 3)); g.setAttribute('seed', new THREE.BufferAttribute(seed, 3)); g.setAttribute('tail', new THREE.BufferAttribute(tail, 1));
    this.rainU = { uT: { value: 0 }, uCam: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(70, 50, 70) }, uLen: { value: 1.1 }, uCol: { value: C('#cfd8de') }, uAlpha: { value: 0 } };
    this.rain = new THREE.LineSegments(g, new THREE.ShaderMaterial({ uniforms: this.rainU, vertexShader: RAIN_VS, fragmentShader: RAIN_FS, transparent: true, depthWrite: false, fog: false }));
    this.rain.frustumCulled = false; this.rain.visible = false; b.scene.add(this.rain); this.apply(1, null);
  }
  /** change look; instant when the player prefers reduced motion */
  set(time, weather) { this.time = time; this.weather = weather; this.tgt = target(time, weather); if (this.reduced) { this.cur = clone(this.tgt); } }
  update(camera) {
    const now = performance.now(), dt = Math.min(0.1, (now - this.last) / 1000); this.last = now;
    if (!this.reduced) { this.t += dt; ease(this.cur, this.tgt, 1 - Math.exp(-dt * 1.4)); }
    this.apply(dt, camera);
  }
  apply(dt, camera) {
    const b = this.b, s = this.cur, u = b.uniforms;
    b.scene.fog.color.copy(s.fog); b.scene.fog.density = s.fogD; u.uFog.value.copy(s.fog); u.uFogD.value = s.fogD;
    u.uSun.value.copy(s.sun); u.uSunCol.value.set(s.sunCol.r, s.sunCol.g, s.sunCol.b).multiplyScalar((s.sunI / 2.2) * 0.85); u.uAmbS.value.copy(s.ambS); u.uAmbG.value.copy(s.ambG); u.uTone.value.copy(s.tone);
    b.sun.color.copy(s.sunCol); b.sun.intensity = s.sunI; b.sun.position.copy(s.sun).multiplyScalar(100);
    b.hemi.color.copy(s.hemiS); b.hemi.groundColor.copy(s.hemiG); b.hemi.intensity = s.hemiI;
    const su = b.sky.material.uniforms; su.top.value.copy(s.top); su.hor.value.copy(s.hor); su.uSun.value.copy(s.sun); su.uGlow.value.copy(s.glow);
    b.terrain.material.color.setScalar(1 - 0.28 * s.wet);
    const ru = this.rainU; this.rain.visible = s.rain > 0.02; ru.uAlpha.value = 0.55 * s.rain; ru.uT.value = this.reduced ? 0 : this.t;
    if (camera) { const h = Math.max(0, camera.position.y), xz = 60 + Math.min(h, 110); ru.uCam.value.copy(camera.position); ru.uBox.value.set(xz, 50 + Math.min(h, 60) * 0.5, xz); ru.uLen.value = 1.1 + xz * 0.012; }
  }
  dispose() { this.b.scene.remove(this.rain); this.rain.geometry.dispose(); this.rain.material.dispose(); }
}
