// Regimental standards, each carried by one soldier (the bearer). Human scale, two instanced draws.
// When the bearer falls the standard drops; a nearby survivor picks it up a few seconds later.
import * as THREE from 'three';
import { heightAt } from './terrain.js';

export const STD = { pole: 2.9, base: 0.15, clothW: 0.75, clothH: 0.5, offR: 0.3, offF: 0.15, regimentMen: 400, maxPerSide: 16 };
const PICKUP = 5;

export class Standards {
  constructor(scene, sim, colors, still = false) {
    this.sim = sim; this.still = still; this.R = Math.max(1, Math.min(STD.maxPerSide, Math.ceil(sim.perSide / STD.regimentMen)));
    const m = this.R * 2; this.m = m;
    this.bearer = new Int32Array(m).fill(-1); this.down = new Float32Array(m); // seconds since bearer fell
    this.fx = new Float32Array(m); this.fz = new Float32Array(m); this.fyaw = new Float32Array(m);
    this.cur = new Float32Array(m * 4); // x, z, yaw, lean (world-space result, for tests)
    const pole = new THREE.CylinderGeometry(0.025, 0.03, STD.pole, 6); pole.translate(0, STD.base + STD.pole / 2, 0);
    this.poles = new THREE.InstancedMesh(pole, new THREE.MeshLambertMaterial({ color: 0x4a331f }), m);
    const cloth = new THREE.PlaneGeometry(STD.clothW, STD.clothH, 6, 3); cloth.translate(STD.clothW / 2 + 0.03, STD.base + STD.pole - STD.clothH / 2 - 0.05, 0);
    this.uni = { uT: { value: 0 }, uCols: { value: colors.map((c) => new THREE.Color(c)) }, uTrim: { value: new THREE.Color('#d8a63a') } };
    cloth.setAttribute('side', new THREE.InstancedBufferAttribute(new Float32Array(m).map((_, i) => (i < this.R ? 0 : 1)), 1));
    const W = STD.clothW;
    this.cloth = new THREE.InstancedMesh(cloth, new THREE.ShaderMaterial({ uniforms: this.uni, side: THREE.DoubleSide,
      vertexShader: `uniform float uT; attribute float side; varying float vS; varying vec2 vUv; void main(){ vS=side; vUv=uv; vec3 p=position; float k=clamp(p.x/${W.toFixed(2)},0.,1.); p.z+=sin(p.x*7.0-uT*4.0+float(gl_InstanceID))*0.05*k; gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(p,1.); }`,
      fragmentShader: 'uniform vec3 uCols[2]; uniform vec3 uTrim; varying float vS; varying vec2 vUv; void main(){ vec3 c=vS<.5?uCols[0]:uCols[1]; float e=min(min(vUv.y,1.-vUv.y),vUv.x); if(e<0.1) c=uTrim; vec2 q=vUv-vec2(.5,.5); if(abs(q.x)+abs(q.y)<.2) c=uTrim; gl_FragColor=vec4(c,1.); }' }), m);
    for (const o of [this.poles, this.cloth]) { o.frustumCulled = false; scene.add(o); }
    this.dummy = new THREE.Object3D(); this.refresh();
  }
  setColors(c) { this.uni.uCols.value[0].set(c[0]); this.uni.uCols.value[1].set(c[1]); }
  alive(i) { const s = this.sim; return i >= 0 && !s.removed[i] && s.state[i] !== 3; }
  // pick bearers for regiments that have none (a few times a second)
  refresh() {
    const s = this.sim, N = s.perSide, R = this.R, chunk = Math.ceil(N / R);
    for (let t = 0; t < 2; t++) for (let r = 0; r < R; r++) {
      const k = t * R + r; if (this.alive(this.bearer[k]) || (this.bearer[k] >= 0 && this.down[k] < PICKUP)) continue;
      const lo = t * N + r * chunk, hi = Math.min(t * N + N, lo + chunk); let b = -1;
      for (let i = lo + ((hi - lo) >> 1), n = 0; n < hi - lo; n++, i = i + 1 >= hi ? lo : i + 1) if (this.alive(i)) { b = i; break; } // start mid-regiment: the standard stays near the centre
      this.bearer[k] = b; this.down[k] = 0;
    }
  }
  update(dt, time, alpha = 0) {
    const s = this.sim, d = this.dummy, dtk = alpha * s.TICK; this.uni.uT.value = this.still ? 0 : time;
    for (let k = 0; k < this.m; k++) {
      const b = this.bearer[k]; let lean = 0;
      if (b >= 0 && this.alive(b)) {
        const yaw = s.yaw[b], px = s.x[b] + s.vx[b] * dtk, pz = s.z[b] + s.vz[b] * dtk, sn = Math.sin(yaw), cs = Math.cos(yaw);
        // yaw 0 faces +z; the pole is held on the bearer's right side, slightly ahead
        this.fx[k] = px + cs * STD.offR + sn * STD.offF; this.fz[k] = pz - sn * STD.offR + cs * STD.offF; this.fyaw[k] = yaw - Math.PI / 2; this.down[k] = 0;
      } else if (b >= 0) { this.down[k] += dt; lean = Math.min(1, this.down[k] * 2.5); }
      const x = this.fx[k], z = this.fz[k], on = b >= 0;
      d.position.set(x, heightAt(x, z) + (lean ? 0.05 * lean : 0), z); d.rotation.set(0, this.fyaw[k], lean * (Math.PI / 2 - 0.05), 'YXZ');
      d.scale.setScalar(on ? 1 : 0); d.updateMatrix(); this.poles.setMatrixAt(k, d.matrix); this.cloth.setMatrixAt(k, d.matrix);
      this.cur[k * 4] = x; this.cur[k * 4 + 1] = z; this.cur[k * 4 + 3] = lean;
    }
    this.poles.instanceMatrix.needsUpdate = this.cloth.instanceMatrix.needsUpdate = true;
  }
  dispose() { for (const o of [this.poles, this.cloth]) { o.parent?.remove(o); o.geometry.dispose(); o.material.dispose(); } }
}
