import * as THREE from 'three';
import { THEME } from './theme.js';
import { buildSoldier } from './model.js';
import { bakeAll } from './rig.js';
import { NB } from './skeleton.js';
import { CLIPS, CLIP } from './clips.js';
import { heightAt } from './terrain.js';
import { ST } from './sim.js';

const col = (hex) => new THREE.Color(hex);
const FOG = 0.0009;

const COMMON_VS = /* glsl */`
precision highp float; precision highp sampler2D;
uniform sampler2D uBones; uniform vec4 uClips[10];
attribute vec4 iA; attribute vec4 iB; attribute vec4 iC; attribute float aMat; attribute vec3 aSkin;
varying vec3 vN; varying float vMat; varying float vSeed; varying float vTeam; varying float vLY; varying float vDepth;
void rows(int clip, float t, int bone, out vec4 r0, out vec4 r1, out vec4 r2) {
  vec4 c = uClips[clip]; float f; float i0; float i1; float w;
  if (c.w > 0.5) { f = mod(t / c.z * c.y, c.y); i0 = floor(f); i1 = mod(i0 + 1.0, c.y); }
  else { f = clamp(t / c.z, 0.0, 1.0) * (c.y - 1.0); i0 = floor(f); i1 = min(i0 + 1.0, c.y - 1.0); }
  int bx = bone * 3; int y0 = int(c.x + i0);
  r0 = texelFetch(uBones, ivec2(bx, y0), 0); r1 = texelFetch(uBones, ivec2(bx + 1, y0), 0); r2 = texelFetch(uBones, ivec2(bx + 2, y0), 0);
  #ifdef SMOOTH
  w = fract(f); int y1 = int(c.x + i1);
  r0 = mix(r0, texelFetch(uBones, ivec2(bx, y1), 0), w); r1 = mix(r1, texelFetch(uBones, ivec2(bx + 1, y1), 0), w); r2 = mix(r2, texelFetch(uBones, ivec2(bx + 2, y1), 0), w);
  #endif
}
void skinOne(int clip, float t, vec3 p, vec3 n, out vec3 po, out vec3 no) {
  vec4 a0, a1, a2, b0, b1, b2;
  rows(clip, t, int(aSkin.x + 0.5), a0, a1, a2);
  vec4 p4 = vec4(p, 1.0);
  vec3 pa = vec3(dot(a0, p4), dot(a1, p4), dot(a2, p4)); vec3 na = vec3(dot(a0.xyz, n), dot(a1.xyz, n), dot(a2.xyz, n));
  #ifdef TWOBONE
  if (aSkin.z > 0.001) {
    rows(clip, t, int(aSkin.y + 0.5), b0, b1, b2);
    vec3 pb = vec3(dot(b0, p4), dot(b1, p4), dot(b2, p4)); vec3 nb = vec3(dot(b0.xyz, n), dot(b1.xyz, n), dot(b2.xyz, n));
    pa = mix(pa, pb, aSkin.z); na = mix(na, nb, aSkin.z);
  }
  #endif
  po = pa; no = na;
}
void main() {
  vec3 p, n;
  skinOne(int(iB.x + 0.5), iB.y, position, normal, p, n);
  #ifdef BLEND
  if (iC.z < 0.999) { vec3 p2, n2; skinOne(int(iC.x + 0.5), iC.y, position, normal, p2, n2); p = mix(p2, p, iC.z); n = mix(n2, n, iC.z); }
  #endif
  float s = sin(iA.w), c = cos(iA.w);
  mat3 R = mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c);
  vec3 wp = R * p + iA.xyz; vN = normalize(R * n);
  vMat = aMat; vSeed = iB.w; vTeam = iB.z; vLY = position.y;
  vec4 mv = viewMatrix * vec4(wp, 1.0); vDepth = -mv.z; gl_Position = projectionMatrix * mv;
}`;
const COMMON_FS = /* glsl */`
precision highp float;
uniform vec3 uPal[10]; uniform vec3 uTeam[4]; uniform vec3 uSun; uniform vec3 uFog; uniform float uFogD;
varying vec3 vN; varying float vMat; varying float vSeed; varying float vTeam; varying float vLY; varying float vDepth;
void main() {
  int m = int(vMat + 0.5); vec3 base = uPal[m];
  int t = int(vTeam + 0.5);
  if (m == 1) base = uTeam[t * 2]; else if (m == 5) base = uTeam[t * 2 + 1];
  float v = 0.9 + 0.2 * fract(vSeed * 91.7); if (m == 0) base *= 0.88 + 0.24 * fract(vSeed * 37.1);
  base *= v;
  vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;
  float d = max(dot(n, uSun), 0.0);
  vec3 amb = mix(vec3(0.32, 0.30, 0.26), vec3(0.50, 0.58, 0.68), n.y * 0.5 + 0.5);
  float ao = mix(0.62, 1.0, smoothstep(0.0, 0.9, vLY));
  vec3 c = base * (amb * ao + vec3(1.0, 0.94, 0.82) * d * 0.85);
  float f = 1.0 - exp(-uFogD * uFogD * vDepth * vDepth); c = mix(c, uFog, f);
  gl_FragColor = vec4(c, 1.0);
}`;
const IMP_VS = /* glsl */`
precision highp float;
uniform vec3 uRight; attribute vec2 corner; attribute vec4 iA; attribute vec4 iB;
varying vec2 vUv; varying float vTeam; varying float vDead; varying float vSeed; varying float vDepth;
void main() {
  vDead = (iB.x > 4.5 && iB.x < 6.5) ? 1.0 : 0.0; vTeam = iB.z; vSeed = iB.w; vUv = corner + 0.5;
  float w = vDead > 0.5 ? 1.9 : 1.1, h = vDead > 0.5 ? 0.7 : 2.6;
  vec3 wp = iA.xyz + uRight * corner.x * w + vec3(0.0, corner.y + 0.5, 0.0) * h;
  vec4 mv = viewMatrix * vec4(wp, 1.0); vDepth = -mv.z; gl_Position = projectionMatrix * mv;
}`;
const IMP_FS = /* glsl */`
precision highp float;
uniform vec3 uTeam[4]; uniform vec3 uFog; uniform float uFogD; uniform vec3 uSkin;
varying vec2 vUv; varying float vTeam; varying float vDead; varying float vSeed; varying float vDepth;
float seg(vec2 p, vec2 a, vec2 b, float r) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h) - r; }
void main() {
  vec2 p = vUv; int t = int(mod(vTeam, 2.0) + 0.5); int ut = int(floor(vTeam * 0.5 + 0.01)); vec3 tun = uTeam[t * 2]; vec3 acc = uTeam[t * 2 + 1]; vec3 c; float d;
  if (vDead > 0.5) {
    d = length((p - vec2(0.5, 0.5)) * vec2(1.0, 2.2)) - 0.42; if (d > 0.0) discard; c = tun * 0.45;
  } else {
    float body = seg(p, vec2(0.46, 0.38), vec2(0.46, 0.7), 0.17);
    float head = length(p - vec2(0.46, 0.8)) - 0.075;
    float legs = min(seg(p, vec2(0.40, 0.05), vec2(0.42, 0.4), 0.05), seg(p, vec2(0.52, 0.05), vec2(0.5, 0.4), 0.05));
    float spear = seg(p, vec2(0.78, 0.02), vec2(0.78, ut == 3 ? 0.72 : 0.98), 0.016);
    float extra = 9.0;
    if (ut == 2) { spear = min(seg(p, vec2(0.8, 0.3), vec2(0.74, 0.55), 0.016), seg(p, vec2(0.74, 0.55), vec2(0.8, 0.8), 0.016)); }
    if (ut == 1) extra = seg(p, vec2(0.74, 0.3), vec2(0.74, 0.7), 0.1);
    if (ut == 4) extra = min(seg(p, vec2(0.22, 0.05), vec2(0.22, 0.99), 0.016), seg(p, vec2(0.3, 0.9), vec2(0.5, 0.9), 0.055));
    d = min(min(min(body, head), min(legs, spear)), extra);
    if (d > 0.0) discard;
    c = tun;
    if (extra < 0.0 && head > 0.0) c = ut == 4 ? (seg(p, vec2(0.3, 0.9), vec2(0.5, 0.9), 0.055) < 0.0 ? acc * 1.4 : vec3(0.4, 0.3, 0.2)) : acc;
    else if (head < 0.0) c = vec3(0.62, 0.45, 0.2); else if (legs < 0.0 && body > 0.0) c = uSkin * 0.8; else if (spear < 0.0 && body > 0.0) c = vec3(0.4, 0.3, 0.2);
  }
  c *= 0.72 + 0.4 * fract(vSeed * 91.7);
  float f = 1.0 - exp(-uFogD * uFogD * vDepth * vDepth); c = mix(c, uFog, f);
  gl_FragColor = vec4(c, 1.0);
}`;

function instanced(src, max, withC) {
  const g = new THREE.InstancedBufferGeometry();
  g.index = src.index; for (const k in src.attributes) g.setAttribute(k, src.attributes[k]);
  const mk = (name) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(name, a); return a; };
  const o = { g, A: mk('iA'), B: mk('iB') }; if (withC) o.C = mk('iC'); g.instanceCount = 0; return o;
}

export class Battlefield {
  constructor(scene, sim) {
    this.scene = scene; this.sim = sim; const n = sim.n;
    const fulls = [0, 1, 2, 3, 4].map((t) => buildSoldier(0, t)), mids = [0, 1, 2, 3, 4].map((t) => buildSoldier(1, t)), full = fulls[0], tc = sim.typeCount || [n, 0, 0, 0, 0];
    const bake = bakeAll(fulls); this.bake = bake;
    const tex = new THREE.DataTexture(bake.data, NB * 3, bake.totalFrames, THREE.RGBAFormat, THREE.FloatType);
    tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.needsUpdate = true;
    const clipU = bake.info.map((c) => new THREE.Vector4(c.first, c.count, c.dur, c.loop ? 1 : 0));
    const pal = [THEME.skin, THEME.skin, THEME.bronze, THEME.wood, THEME.leather, THEME.skin, '#1b1410', '#2b1d14', '#8a6a45', '#d4a93a'].map(col);
    const teamCols = [col(THEME.teamA), col(THEME.teamA).multiplyScalar(0.8), col(THEME.teamB), col(THEME.teamB).multiplyScalar(0.8)];
    const fog = col(THEME.haze), sun = new THREE.Vector3(0.45, 0.8, 0.35).normalize();
    this.uniforms = { uBones: { value: tex }, uClips: { value: clipU }, uPal: { value: pal }, uTeam: { value: teamCols }, uSun: { value: sun }, uFog: { value: fog }, uFogD: { value: FOG }, uRight: { value: new THREE.Vector3(1, 0, 0) }, uSkin: { value: col(THEME.skin) } };
    const mkMat = (defs) => new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: COMMON_VS, fragmentShader: COMMON_FS, defines: defs, side: THREE.DoubleSide });
    this.nearT = fulls.map((g, t) => instanced(g, Math.max(1, tc[t]), true)); this.midT = mids.map((g, t) => instanced(g, Math.max(1, tc[t]), false));
    this.meshesNear = this.nearT.map((o) => new THREE.Mesh(o.g, mkMat({ SMOOTH: 1, TWOBONE: 1, BLEND: 1 })));
    this.meshesMid = this.midT.map((o) => new THREE.Mesh(o.g, mkMat({ SMOOTH: 1, TWOBONE: 1 })));
    this.meshNear = this.meshesNear[0]; this.meshMid = this.meshesMid[0];
    // far impostors
    const ig = new THREE.InstancedBufferGeometry(); ig.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
    ig.setAttribute('corner', new THREE.Float32BufferAttribute([-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5], 2)); ig.setIndex([0, 1, 2, 0, 2, 3]);
    const mkI = (name) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4); a.setUsage(THREE.DynamicDrawUsage); ig.setAttribute(name, a); return a; };
    this.far = { g: ig, A: mkI('iA'), B: mkI('iB') }; ig.instanceCount = 0;
    this.meshFar = new THREE.Mesh(ig, new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: IMP_VS, fragmentShader: IMP_FS, side: THREE.DoubleSide }));
    for (const m of [...this.meshesNear, ...this.meshesMid, this.meshFar]) { m.frustumCulled = false; scene.add(m); }
    this.buildArrows(n);
    this.q = { nearR: 26, midR: 100, nearCap: 900, midCap: 5000 };
    this.counts = { near: 0, mid: 0, far: 0, culled: 0 };
    this.buildTerrain(sim.world); this.buildSky();
    scene.fog = new THREE.FogExp2(THEME.haze, FOG);
    const hemi = new THREE.HemisphereLight(0xcfe0f0, 0x6a6a4a, 1.0); scene.add(hemi);
    const dl = new THREE.DirectionalLight(0xfff0d8, 2.2); dl.position.copy(sun).multiplyScalar(100); scene.add(dl);
  }
  buildTerrain(world) {
    const size = world * 2 + 3000, seg = 220, g = new THREE.PlaneGeometry(size, size, seg, seg); g.rotateX(-Math.PI / 2);
    const p = g.attributes.position, colors = new Float32Array(p.count * 3), a = col(THEME.grassA), b = col(THEME.grassB), c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i); p.setY(i, heightAt(x, z));
      const t = 0.5 + 0.5 * Math.sin(x * 0.011) * Math.sin(z * 0.013 + 1) + 0.15 * Math.sin(x * 0.07 + z * 0.05); c.copy(a).lerp(b, Math.min(1, Math.max(0, t))); colors.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3)); g.computeVertexNormals();
    const cv = document.createElement('canvas'); cv.width = cv.height = 256; const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, 256, 256);
    let s = 7; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 5000; i++) { const v = 200 + (r() * 55) | 0, dk = r() < 0.5; cx.fillStyle = dk ? `rgba(60,70,30,${0.08 + r() * 0.1})` : `rgba(255,255,220,${0.05 + r() * 0.1})`; cx.fillRect(r() * 256, r() * 256, 1 + r() * 2, 2 + r() * 4); }
    const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(size / 6, size / 6); t.anisotropy = 4; t.colorSpace = THREE.SRGBColorSpace;
    this.terrain = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, map: t })); this.scene.add(this.terrain);
  }
  buildArrows() {
    const g = new THREE.InstancedBufferGeometry(), box = new THREE.BoxGeometry(1, 1, 1); g.index = box.index; g.setAttribute('position', box.attributes.position);
    const mk = (name) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(this.sim.apos.length), 4); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(name, a); return a; };
    this.arrows = { g, A: mk('iA'), B: mk('iB') }; g.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, side: THREE.DoubleSide, vertexShader: `precision highp float; attribute vec4 iA; attribute vec4 iB; varying float vK; varying float vDepth;
      void main(){ vec3 f = normalize(iB.xyz + 1e-5); vec3 r = normalize(cross(f, vec3(0.0,1.0,0.0)) + vec3(1e-4,0.0,0.0)); vec3 u = cross(r, f);
        float len = iA.w > 0.5 ? 1.7 : 0.95; vec4 c0 = viewMatrix * vec4(iA.xyz, 1.0); float w = 0.018 + (-c0.z) * 0.0016;
        vec3 wp = iA.xyz + f * position.z * len + r * position.x * w + u * position.y * w; vec4 mv = viewMatrix * vec4(wp, 1.0); vK = iA.w; vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `precision highp float; uniform vec3 uFog; uniform float uFogD; varying float vK; varying float vDepth;
        void main(){ vec3 c = vK > 0.5 ? vec3(0.45,0.33,0.2) : vec3(0.28,0.2,0.12); float f = 1.0 - exp(-uFogD * uFogD * vDepth * vDepth); gl_FragColor = vec4(mix(c, uFog, f), 1.0); }` });
    this.arrowMesh = new THREE.Mesh(g, mat); this.arrowMesh.frustumCulled = false; this.scene.add(this.arrowMesh);
  }
  dispose() {
    for (const m of [...this.meshesNear, ...this.meshesMid, this.meshFar, this.arrowMesh, this.terrain, this.sky]) { this.scene.remove(m); m.geometry.dispose(); }
  }
  buildSky() {
    const m = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: col('#5f8cb8') }, hor: { value: col(THEME.haze) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 hor; varying vec3 vP; void main(){ float h = clamp(normalize(vP).y, 0.0, 1.0); gl_FragColor = vec4(mix(hor, top, pow(h, 0.55)), 1.0); }' });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(5000, 24, 12), m); this.sky.frustumCulled = false; this.scene.add(this.sky);
  }
  update(camera, alpha) {
    const s = this.sim, n = s.n, dt = alpha * s.TICK, q = this.q;
    camera.updateMatrixWorld(); const e = camera.matrixWorld.elements;
    const cx = e[12], cy = e[13], cz = e[14], rx = e[0], ry = e[1], rz = e[2], ux = e[4], uy = e[5], uz = e[6], fx = -e[8], fy = -e[9], fz = -e[10];
    const ty = Math.tan((camera.fov * Math.PI) / 360) * 1.1, tx = ty * camera.aspect;
    this.uniforms.uRight.value.set(rx, 0, rz).normalize(); this.sky.position.set(cx, cy, cz);
    const nr2 = q.nearR * q.nearR, mr2 = q.midR * q.midR;
    let a = 0, b = 0, f = 0, cull = 0; const NT = this.nearT, MT = this.midT, an = this.an || (this.an = [0, 0, 0, 0, 0]), bn = this.bn || (this.bn = [0, 0, 0, 0, 0]); an.fill(0); bn.fill(0);
    const FA = this.far.A.array, FB = this.far.B.array;
    const { x, z, vx, vz, yaw, state, clip, animT, prevClip, prevT, blend, team, seed, removed, utype } = s;
    for (let i = 0; i < n; i++) {
      if (removed[i]) continue;
      const dead = state[i] === ST.DEAD, px = dead ? x[i] : x[i] + vx[i] * dt, pz = dead ? z[i] : z[i] + vz[i] * dt;
      const dx = px - cx, dz = pz - cz, dy = 0.9 - cy;
      const depth = dx * fx + dy * fy + dz * fz;
      if (depth < -3) { cull++; continue; }
      const lim = depth * tx + 3, lx = dx * rx + dy * ry + dz * rz; if (lx > lim || lx < -lim) { cull++; continue; }
      const ly = dx * ux + dy * uy + dz * uz, limy = depth * ty + 3; if (ly > limy || ly < -limy) { cull++; continue; }
      const d2 = dx * dx + dz * dz + dy * dy, y = heightAt(px, pz), ut = utype[i];
      const cl = CLIPS[clip[i]]; let t = animT[i] + (cl.speed ? dt * Math.min(1.8, Math.max(0.4, Math.hypot(vx[i], vz[i]) / cl.speed)) : dt);
      if (cl.loop) { if (t > cl.dur) t -= cl.dur; } else if (t > cl.dur) t = cl.dur;
      if (d2 < nr2 && a < q.nearCap) {
        const o = an[ut]++ * 4, A = NT[ut].A.array, Bb = NT[ut].B.array, C = NT[ut].C.array; A[o] = px; A[o + 1] = y; A[o + 2] = pz; A[o + 3] = yaw[i];
        Bb[o] = clip[i]; Bb[o + 1] = t; Bb[o + 2] = team[i]; Bb[o + 3] = seed[i];
        C[o] = prevClip[i]; C[o + 1] = prevT[i]; C[o + 2] = Math.min(1, blend[i] + dt / 0.18); a++;
      } else if (d2 < mr2 && b < q.midCap) {
        const o = bn[ut]++ * 4, A = MT[ut].A.array, Bb = MT[ut].B.array; A[o] = px; A[o + 1] = y; A[o + 2] = pz; A[o + 3] = yaw[i];
        Bb[o] = clip[i]; Bb[o + 1] = t; Bb[o + 2] = team[i]; Bb[o + 3] = seed[i]; b++;
      } else {
        const o = f * 4; FA[o] = px; FA[o + 1] = y; FA[o + 2] = pz; FA[o + 3] = yaw[i];
        FB[o] = clip[i]; FB[o + 1] = t; FB[o + 2] = team[i] + 2 * ut; FB[o + 3] = seed[i]; f++;
      }
    }
    const up = (m, c, arrs) => { m.g.instanceCount = c; for (const at of arrs) { at.clearUpdateRanges(); at.addUpdateRange(0, Math.max(1, c) * 4); at.needsUpdate = true; } };
    for (let t = 0; t < 5; t++) { up(NT[t], an[t], [NT[t].A, NT[t].B, NT[t].C]); up(MT[t], bn[t], [MT[t].A, MT[t].B]); this.meshesNear[t].visible = an[t] > 0; this.meshesMid[t].visible = bn[t] > 0; }
    up(this.far, f, [this.far.A, this.far.B]); this.meshFar.visible = f > 0;
    // projectiles (copied out of the shared sim buffers, nudged forward to hide the 20 Hz tick)
    { const ar = this.arrows, A = ar.A.array, Bq = ar.B.array, P = s.apos, D = s.adir; let k = 0;
      for (let i = 0; i < P.length; i += 4) { if (D[i + 3] === 0) continue; const sp = P[i + 3] > 0.5 ? 26 : 40, o = k * 4; A[o] = P[i] + D[i] * sp * dt; A[o + 1] = P[i + 1] + D[i + 1] * sp * dt; A[o + 2] = P[i + 2] + D[i + 2] * sp * dt; A[o + 3] = P[i + 3]; Bq[o] = D[i]; Bq[o + 1] = D[i + 1]; Bq[o + 2] = D[i + 2]; Bq[o + 3] = 1; k++; }
      up(ar, k, [ar.A, ar.B]); this.arrowMesh.visible = k > 0; this.counts.arrows = k; }
    this.counts.near = a; this.counts.mid = b; this.counts.far = f; this.counts.culled = cull;
    // adapt LOD radii so counts hover under their caps
    q.nearR = Math.min(60, Math.max(8, q.nearR * (a >= q.nearCap ? 0.96 : a < q.nearCap * 0.7 ? 1.015 : 1)));
    q.midR = Math.min(260, Math.max(q.nearR + 20, q.midR * (b >= q.midCap ? 0.96 : b < q.midCap * 0.7 ? 1.015 : 1)));
  }
  setTeamColors(a, b) {
    const t = this.uniforms.uTeam.value; t[0].set(a); t[1].set(a).multiplyScalar(0.62); t[2].set(b); t[3].set(b).multiplyScalar(0.62);
  }
  setQuality(k) { this.q.nearCap = Math.round(900 * k); this.q.midCap = Math.round(5000 * k); }
}
