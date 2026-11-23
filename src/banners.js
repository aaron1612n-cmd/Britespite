// Regimental standards: one pole + cloth per regiment, two instanced draws for the whole army.
import * as THREE from 'three';
import { heightAt } from './terrain.js';

const POLE_H = 6.5;
export class Standards {
  constructor(scene, sim, colors, still = false) {
    this.sim = sim; this.still = still; this.R = Math.max(1, Math.min(16, Math.ceil(sim.perSide / 400)));
    const m = this.R * 2; this.pos = new Float32Array(m * 3); this.ok = new Uint8Array(m);
    const pole = new THREE.CylinderGeometry(0.05, 0.06, POLE_H, 6); pole.translate(0, POLE_H / 2, 0);
    this.poles = new THREE.InstancedMesh(pole, new THREE.MeshLambertMaterial({ color: 0x4a331f }), m);
    const cloth = new THREE.PlaneGeometry(1.7, 1.15, 10, 4); cloth.translate(0.85, POLE_H - 0.7, 0);
    this.uni = { uT: { value: 0 }, uCols: { value: colors.map((c) => new THREE.Color(c)) }, uTrim: { value: new THREE.Color('#d8a63a') } };
    cloth.setAttribute('side', new THREE.InstancedBufferAttribute(new Float32Array(m).map((_, i) => (i < this.R ? 0 : 1)), 1));
    this.cloth = new THREE.InstancedMesh(cloth, new THREE.ShaderMaterial({ uniforms: this.uni, side: THREE.DoubleSide,
      vertexShader: 'uniform float uT; attribute float side; varying float vS; varying vec2 vUv; void main(){ vS=side; vUv=uv; vec3 p=position; float k=clamp(p.x/1.7,0.,1.); p.z+=sin(p.x*3.2-uT*4.0+float(gl_InstanceID))*0.16*k; p.y+=sin(p.x*2.1-uT*3.0)*0.05*k; gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(p,1.); }',
      fragmentShader: 'uniform vec3 uCols[2]; uniform vec3 uTrim; varying float vS; varying vec2 vUv; void main(){ vec3 c=vS<.5?uCols[0]:uCols[1]; float e=min(min(vUv.y,1.-vUv.y),vUv.x); if(e<0.09) c=uTrim; vec2 q=vUv-vec2(.5,.5); if(abs(q.x)+abs(q.y)<.22) c=uTrim; gl_FragColor=vec4(c,1.); }' }), m);
    for (const o of [this.poles, this.cloth]) { o.frustumCulled = false; scene.add(o); }
    this.dummy = new THREE.Object3D(); this.refresh(true);
  }
  setColors(c) { this.uni.uCols.value[0].set(c[0]); this.uni.uCols.value[1].set(c[1]); }
  // centroid of a stride-sample of each regiment's living men; call a few times a second
  refresh(snap) {
    const s = this.sim, N = s.perSide, R = this.R, chunk = Math.ceil(N / R);
    for (let t = 0; t < 2; t++) for (let r = 0; r < R; r++) {
      const lo = t * N + r * chunk, hi = Math.min(t * N + N, lo + chunk), step = Math.max(1, ((hi - lo) / 40) | 0); let sx = 0, sz = 0, c = 0;
      for (let i = lo; i < hi; i += step) if (!s.removed[i] && s.state[i] !== 3) { sx += s.x[i]; sz += s.z[i]; c++; }
      const k = t * R + r; this.ok[k] = c > 0 ? 1 : 0; if (!c) continue;
      const o = k * 3; sx /= c; sz /= c;
      if (snap || this.pos[o + 1] === 0) { this.pos[o] = sx; this.pos[o + 2] = sz; } this.tx = this.tx || new Float32Array(R * 6); this.tx[k * 2] = sx; this.tx[k * 2 + 1] = sz;
    }
  }
  update(dt, time) {
    this.uni.uT.value = this.still ? 0 : time; const d = this.dummy, a = Math.min(1, dt * 3);
    for (let k = 0; k < this.R * 2; k++) {
      const o = k * 3;
      if (this.ok[k] && this.tx) { this.pos[o] += (this.tx[k * 2] - this.pos[o]) * a; this.pos[o + 2] += (this.tx[k * 2 + 1] - this.pos[o + 2]) * a; this.pos[o + 1] = 1; }
      d.position.set(this.pos[o], heightAt(this.pos[o], this.pos[o + 2]), this.pos[o + 2]); d.rotation.y = k < this.R ? 0.3 : Math.PI - 0.3;
      d.scale.setScalar(this.ok[k] ? 2 : 0); d.updateMatrix(); this.poles.setMatrixAt(k, d.matrix); this.cloth.setMatrixAt(k, d.matrix);
    }
    this.poles.instanceMatrix.needsUpdate = this.cloth.instanceMatrix.needsUpdate = true;
  }
  dispose() { for (const o of [this.poles, this.cloth]) { o.parent?.remove(o); o.geometry.dispose(); o.material.dispose(); } }
}
