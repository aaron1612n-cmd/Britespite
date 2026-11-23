// Renders the siege props: curtain wall + towers (one mesh), gate leaves, raised ladders (instanced), ram frame + swinging log.
import * as THREE from 'three';
import { buildWall, buildLeaf, buildLadder, buildRamFrame, buildRamLog, ladderAngle, siegeParams, GATE_HALF, HT, LADDER_FOOT_Z, RAM } from './siege.js';
import { SG } from './siegerules.js';

const toGeo = (mb) => { const a = mb.arrays(), g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(a.pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(a.nrm, 3)); g.setAttribute('color', new THREE.BufferAttribute(a.col, 3)); g.setIndex(new THREE.BufferAttribute(a.idx, 1)); g.computeBoundingSphere(); return g; };

export class SiegeScene {
  constructor(scene, sim) {
    this.scene = scene; this.sim = sim; const P = (this.P = siegeParams(sim.world));
    this.mat = new THREE.MeshLambertMaterial({ vertexColors: true }); this.geos = [];
    const mk = (mb) => { const g = toGeo(mb); this.geos.push(g); return new THREE.Mesh(g, this.mat); };
    this.wall = mk(buildWall(P)); scene.add(this.wall);
    const leaf = buildLeaf(); this.leafL = mk(leaf); this.leafR = new THREE.Mesh(this.leafL.geometry, this.mat);
    this.leafL.position.set(-GATE_HALF, 0, 0); this.leafR.position.set(GATE_HALF, 0, 0); this.leafR.scale.x = -1; scene.add(this.leafL, this.leafR);
    const lg = toGeo(buildLadder()); this.geos.push(lg); this.ladders = new THREE.InstancedMesh(lg, this.mat, P.ladders.length); this.ladders.frustumCulled = false; scene.add(this.ladders); this.ladT = -1;
    this.ramFrame = mk(buildRamFrame()); this.ramLog = mk(buildRamLog()); scene.add(this.ramFrame, this.ramLog);
    for (const m of [this.wall, this.leafL, this.leafR, this.ramFrame, this.ramLog]) m.frustumCulled = false;
    this.tmp = new THREE.Object3D(); this.update();
  }
  update() {
    const sg = this.sim.sg, t = performance.now() / 1000;
    const open = sg[SG.GATE_OPEN], shake = sg[SG.SHAKE] * 0.012 * Math.sin(t * 60), a = open * 1.75;
    this.leafL.rotation.y = -a + shake; this.leafR.rotation.y = a - shake;
    const rz = sg[SG.RAM_Z], rx = sg[SG.RAM_X];
    this.ramFrame.position.set(rx, 0, rz); this.ramLog.position.set(rx, RAM.pivotY, rz); this.ramLog.rotation.x = sg[SG.SWING];
    const up = sg[SG.LADDER_UP];
    if (up !== this.ladT) {
      this.ladT = up; const o = this.tmp;
      this.P.ladders.forEach((x, k) => { o.position.set(x, 0, LADDER_FOOT_Z); o.rotation.set(ladderAngle(up), 0, 0); o.updateMatrix(); this.ladders.setMatrixAt(k, o.matrix); });
      this.ladders.instanceMatrix.needsUpdate = true;
    }
  }
  dispose() { for (const g of this.geos) g.dispose(); this.mat.dispose(); this.ladders.dispose(); }
}
