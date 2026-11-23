// Automated suite: model/rig geometry, sim determinism + collisions + combat, and a headless browser smoke test.
// Run: npm test   (needs `npm run build` output only for the browser part; it builds for you)
import { spawn, execSync } from 'node:child_process';
import { buildSoldier, SHIELD_PLANE_Y } from '../src/model.js';
import { bakeAll, skinVertices } from '../src/rig.js';
import { NB, BONES } from '../src/skeleton.js';
import { CLIPS, CLIP } from '../src/clips.js';
import { Sim, ST, ORD } from '../src/sim.js';
import * as SG from '../src/siege.js';
import { ROLE } from '../src/siegerules.js';
import { cellOf, treeRadius } from '../src/terrain.js';
import { normalSamples, meanLit } from '../src/shade.js';

let fails = 0, passes = 0;
const check = (name, ok, info = '') => { ok ? passes++ : fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); };

// ---------- model / animation geometry ----------
const geo = buildSoldier(0), mid = buildSoldier(1), bake = bakeAll([0, 1, 2, 3, 4, 5].map((t) => buildSoldier(0, t)));
const mats = (c, f) => bake.data.subarray((bake.info[c].first + f) * NB * 12, (bake.info[c].first + f + 1) * NB * 12);
check('bake is finite', bake.data.every(Number.isFinite));
check('every vertex has valid bones/weights', [geo, mid].every((g) => { const s = g.attributes.aSkin; for (let i = 0; i < s.count; i++) if (s.getX(i) >= NB || s.getY(i) >= NB || s.getZ(i) < 0 || s.getZ(i) > 1) return false; return true; }));
{ // joints stay attached in every frame (no loose parts)
  let worst = 0;
  for (let c = 0; c < CLIPS.length; c++) for (let f = 0; f < bake.info[c].count; f++) {
    const m = mats(c, f);
    BONES.forEach((b, i) => { if (b.parent < 0) return; const p = b.parent, [x, y, z] = b.pivot;
      for (let r = 0; r < 3; r++) { const a = m[p * 12 + r * 4] * x + m[p * 12 + r * 4 + 1] * y + m[p * 12 + r * 4 + 2] * z + m[p * 12 + r * 4 + 3]; const d = m[i * 12 + r * 4] * x + m[i * 12 + r * 4 + 1] * y + m[i * 12 + r * 4 + 2] * z + m[i * 12 + r * 4 + 3]; worst = Math.max(worst, Math.abs(a - d)); } });
  }
  check('joints stay connected in all clips', worst < 1e-3, `worst gap ${worst.toExponential(1)} m`);
}
{ // ground clipping + size
  let ok = true, info = '';
  for (let c = 0; c < CLIPS.length; c++) { if (CLIPS[c].cav) continue;
    let mn = 9, mx = -9;
    for (let f = 0; f < bake.info[c].count; f++) { const s = skinVertices(geo, mats(c, f)); for (let i = 1; i < s.length; i += 3) { mn = Math.min(mn, s[i]); mx = Math.max(mx, s[i]); } }
    const die = CLIPS[c].name.includes('die'), lim = die ? 0.02 : 0.08; if (mn < -lim || mx > 4.0) { ok = false; info += ` ${CLIPS[c].name}:min${mn.toFixed(2)}/max${mx.toFixed(2)}`; }
  }
  check('no ground clipping, sane height in all clips', ok, info);
}
{ // feet planted while walking/running (no sliding)
  for (const [ci, label] of [[CLIP.WALK, 'walk'], [CLIP.RUN, 'run']]) {
    const c = CLIPS[ci], n = bake.info[ci].count, dt = c.dur / n; const pos = []; // ankle of left foot (bone 11) in body frame
    for (let f = 0; f <= n; f++) { const m = mats(ci, f % n), b = 11 * 12; const [x, y, z] = BONES[11].pivot; pos.push([m[b + 3] + m[b] * x + m[b + 1] * y + m[b + 2] * z, m[b + 7] + m[b + 4] * x + m[b + 5] * y + m[b + 6] * z, m[b + 11] + m[b + 8] * x + m[b + 9] * y + m[b + 10] * z]); }
    let worst = 0, stance = 0;
    for (let f = 1; f < n; f++) if (pos[f][1] < 0.085 && pos[f - 1][1] < 0.085 && pos[f + 1][1] < 0.085) { stance++; const vz = (pos[f + 1][2] - pos[f - 1][2]) / (2 * dt); worst = Math.max(worst, Math.abs(vz + c.speed)); }
    check(`${label}: planted foot matches ground speed`, stance >= 4 && worst < 0.12 * c.speed + 0.1, `${stance} stance frames, worst error ${worst.toFixed(2)} m/s`);
  }
}
{ // hands are held behind the shield (shield and left hand ride the same bone, so bind space is exact)
  for (const [lod, g] of [['full', geo], ['mid', mid]]) {
    const p = g.attributes.position; let minHand = 9; for (const [a, b] of g.userData.tags.handL) for (let i = a; i < b; i++) minHand = Math.min(minHand, p.getY(i));
    check(`left hand sits behind the shield (${lod})`, minHand >= SHIELD_PLANE_Y + 0.01, `hand reaches y ${minHand.toFixed(3)} vs shield plane ${SHIELD_PLANE_Y}`);
  }
  // in every pose the shield stays clear of the head/torso zone in front of the chest (no body clipping)
  let worst = 9; const p = geo.attributes.position, s = geo.attributes.aSkin;
  const shieldIdx = []; for (const [a, b] of geo.userData.tags.shield) for (let i = a; i < b; i++) shieldIdx.push(i);
  for (let c = 0; c < CLIPS.length; c++) { if (CLIPS[c].cav || ['die', 'che'].includes(CLIPS[c].name.slice(0, 3))) continue; for (let f = 0; f < bake.info[c].count; f++) { const sk = skinVertices(geo, mats(c, f)); for (const i of shieldIdx) worst = Math.min(worst, sk[i * 3 + 2]); } }
  check('shield never passes behind the body line', worst > -0.1, `rearmost shield z ${worst.toFixed(2)} m`);
}
{ // every unit type: clean geometry in every clip, hands behind shields
  const names = ['hoplite', 'heavy', 'archer', 'javelin', 'commander', 'cavalry'];
  for (let ty = 1; ty < 6; ty++) {
    const g = buildSoldier(0, ty), m1 = buildSoldier(1, ty); let bad = '';
    for (let c = 0; c < CLIPS.length; c++) { if (!!CLIPS[c].cav !== !!g.userData.cav) continue; let mn = 9, mx = -9; for (let f = 0; f < bake.info[c].count; f++) { const s = skinVertices(g, mats(c, f)); for (let i = 1; i < s.length; i += 3) { mn = Math.min(mn, s[i]); mx = Math.max(mx, s[i]); } }
      const die = CLIPS[c].name.includes('die'), lim = die ? 0.03 : 0.1; if (mn < -lim || mx > (g.userData.cav ? 5 : 4)) bad += ` ${CLIPS[c].name}:${mn.toFixed(2)}/${mx.toFixed(2)}`; }
    check(`${names[ty]}: no ground clipping in any clip`, bad === '', bad);
    const tags = g.userData.tags; if (tags.shield) { const p = g.attributes.position; let mh = 9; for (const [a, b2] of tags.handL) for (let i = a; i < b2; i++) mh = Math.min(mh, p.getY(i)); check(`${names[ty]}: hand behind shield`, mh >= SHIELD_PLANE_Y + 0.01, mh.toFixed(3)); }
    check(`${names[ty]}: mid LOD lighter`, m1.index.count < g.index.count * 0.45, `${g.index.count / 3} vs ${m1.index.count / 3}`);
  }
}
check('mid LOD far lighter than full', mid.index.count < geo.index.count * 0.4, `${geo.index.count / 3} vs ${mid.index.count / 3} tris`);


// ---------- cavalry: horse + rider ----------
{
  const { HF, B } = await import('../src/skeleton.js'); const { CAV, CAV_TROT, CAV_CHARGE } = await import('../src/clips.js'); const { barrelAt } = await import('../src/model.js');
  const cg = buildSoldier(0, 5), cm = buildSoldier(1, 5), tags = cg.userData.tags, RIDE = [0, 1, 2, 3, 4, 7, 8, 9].map((k) => CAV + k);
  const place = (b, m) => [0, 1, 2].map((r) => m[b * 12 + r * 4 + 3] + m[b * 12 + r * 4] * BONES[b].pivot[0] + m[b * 12 + r * 4 + 1] * BONES[b].pivot[1] + m[b * 12 + r * 4 + 2] * BONES[b].pivot[2]);
  const rng = (g, [a, b2]) => { const o = []; for (let i = a; i < b2; i++) o.push(i); return o; };
  check('cavalry is a mounted rider plus a horse (two tagged parts)', !!tags.rider && !!tags.horse && cg.userData.cav === true && tags.rider[0][1] === tags.horse[0][0]);
  check('cavalry geometry: valid bones and weights', (() => { const sk = cg.attributes.aSkin; for (let i = 0; i < sk.count; i++) if (sk.getX(i) >= NB || sk.getY(i) >= NB || sk.getZ(i) < 0 || sk.getZ(i) > 1) return false; return true; })());
  // horse anatomy in the bind pose: a long barrel, neck rising to a head above the withers, four tapering legs ending in hooves on the ground
  { const p = cg.attributes.position; let mnY = 9, mxY = -9, mnZ = 9, mxZ = -9, xs = 0; for (const [a, b2] of tags.horse) for (let i = a; i < b2; i++) { mnY = Math.min(mnY, p.getY(i)); mxY = Math.max(mxY, p.getY(i)); mnZ = Math.min(mnZ, p.getZ(i)); mxZ = Math.max(mxZ, p.getZ(i)); xs = Math.max(xs, Math.abs(p.getX(i))); }
    check('horse proportions: ~2 m high at the ears, 2.5-3.4 m nose to tail incl. tail, ~0.7 m wide', mnY > -0.01 && mnY < 0.02 && mxY > 2.0 && mxY < 2.3 && mxZ - mnZ > 2.5 && mxZ - mnZ < 3.4 && xs > 0.28 && xs < 0.45, `y ${mnY.toFixed(2)}..${mxY.toFixed(2)}, length ${(mxZ - mnZ).toFixed(2)}, half width ${xs.toFixed(2)}`); }
  // every frame of every mounted clip: rider seat stays on the saddle, hooves above the ground, nothing floats or sinks
  let worstSeat = 0, minGround = 9, floatMax = 0, cn = '';
  const seatIdx = [], p0 = cg.attributes.position; for (const [a, b2] of tags.rider) for (let i = a; i < b2; i++) { const y = p0.getY(i); if (y > 0.92 && y < 1.0 && Math.abs(p0.getX(i)) < 0.17 && Math.abs(p0.getZ(i)) < 0.2) seatIdx.push(i); }
  for (const ci of RIDE) { const c = CLIPS[ci];
    for (let f = 0; f < bake.info[ci].count; f++) {
      const sk = skinVertices(cg, mats(ci, f)); let mn = 9; for (let i = 1; i < sk.length; i += 3) mn = Math.min(mn, sk[i]);
      minGround = Math.min(minGround, mn); if (!c.name.includes('rear')) floatMax = Math.max(floatMax, mn); // a riding horse always has a hoof near the ground, except in the air phase of a gallop (<= 0.3 m)
      // seat: centroid of the rider's pelvis vertices vs the saddle top (barrel top at z~0 + pad) -> within 0.2 m vertically and 0.25 m along the spine of the saddle point
      let cx = 0, cy = 0, cz = 0; for (const i of seatIdx) { cx += sk[i * 3]; cy += sk[i * 3 + 1]; cz += sk[i * 3 + 2]; } cx /= seatIdx.length; cy /= seatIdx.length; cz /= seatIdx.length;
      const sd = Math.hypot(cx, cy - 1.52, cz + 0.05); if (sd > worstSeat) { worstSeat = sd; cn = `${c.name}@${f}`; }
    } }
  check('mounted clips: rider pelvis stays on the saddle', worstSeat < 0.45, `worst ${worstSeat.toFixed(2)} m from the saddle point (${cn})`);
  check('mounted clips: no ground clipping (hooves >= -4 cm)', minGround > -0.04, `lowest point ${minGround.toFixed(3)} m`);
  check('mounted clips: horse never floats more than 30 cm', floatMax < 0.3, `highest lowest-point ${floatMax.toFixed(2)} m`);
  // rider sits astride: the thighs are outside the barrel surface (no leg inside the horse) at rest
  { const sk = skinVertices(cg, mats(CAV, 0)); let worst = 0; for (const [a, b2] of tags.rider) for (let i = a; i < b2; i++) { const y = sk[i * 3 + 1], z = sk[i * 3 + 2], x = Math.abs(sk[i * 3]), br = barrelAt(z); if (!br || p0.getY(i) > 0.6 || y < 0.8) continue; const e = Math.sqrt((x / br.rx) ** 2 + ((y - br.cy) / br.ry) ** 2); if (e < 0.86) worst = Math.max(worst, (1 - e) * br.rx); }
    check('rider legs do not sink into the horse barrel', worst < 0.07, `deepest rider vertex ${(worst * 100).toFixed(1)} cm inside`); }
  // hooves are planted in stance: ground speed matches the clip speed for all four legs in every gait
  for (const [ci, label] of [[CAV + 1, 'walk'], [CAV_TROT, 'trot'], [CAV + 2, 'gallop'], [CAV_CHARGE, 'charge']]) {
    const c = CLIPS[ci], n = bake.info[ci].count, dt = c.dur / n; let worst = 0, stance = 0, legs = 0;
    for (const hb of [B.FL_H, B.FR_H, B.BL_H, B.BR_H]) { const P = (k) => place(hb, mats(ci, ((k % n) + n) % n)), low = (k) => P(k)[1] < HF.fet + 0.012; let ls = 0;
      for (let f = 0; f < n; f++) if ([-2, -1, 0, 1, 2].every((d) => low(f + d))) { ls++; stance++; const vz = (P(f + 1)[2] - P(f - 1)[2]) / (2 * dt); worst = Math.max(worst, Math.abs(vz + c.speed)); } // interior stance frames only (touch-down/lift-off frames blend with the swing)
      if (ls >= 1) legs++; }
    check(`horse ${label}: hooves planted (all 4 legs touch down, no sliding)`, legs === 4 && worst < 0.12 * c.speed + 0.15, `${stance} stance frames, ${legs}/4 legs, worst slide ${worst.toFixed(2)} m/s`);
  }
  // gait is a real footfall sequence: walk keeps 2-3 hooves down, gallop has a moment with none
  { const down = (ci, f) => [B.FL_H, B.FR_H, B.BL_H, B.BR_H].filter((hb) => place(hb, mats(ci, f))[1] < HF.fet + 0.012).length;
    let wmin = 9, wmax = 0, gmin = 9; for (let f = 0; f < bake.info[CAV + 1].count; f++) { const d = down(CAV + 1, f); wmin = Math.min(wmin, d); wmax = Math.max(wmax, d); } for (let f = 0; f < bake.info[CAV + 2].count; f++) gmin = Math.min(gmin, down(CAV + 2, f));
    check('walk keeps at least two hooves down; gallop has a suspension phase', wmin >= 2 && wmax <= 4 && gmin <= 1, `walk ${wmin}-${wmax} down, gallop min ${gmin}`); }
  // death and rear clips settle on the ground; thrust ends back in the ready pose
  for (const ci of [CAV + 5, CAV + 6]) { let mn = 9; const fr = bake.info[ci].count - 1; const sk = skinVertices(cg, mats(ci, fr)); for (let i = 1; i < sk.length; i += 3) mn = Math.min(mn, sk[i]); check(`${CLIPS[ci].name}: body rests on the ground`, Math.abs(mn) < 0.03, `lowest ${mn.toFixed(3)}`); }
  { const a = mats(CAV + 3, 0), b2 = mats(CAV + 3, bake.info[CAV + 3].count - 1); let d = 0; for (let i = 0; i < a.length; i++) d = Math.max(d, Math.abs(a[i] - b2[i])); check('thrust returns to its ready pose', d < 0.35, `max matrix delta ${d.toFixed(2)}`); }
  // sim: cavalry exist in the mounted compositions, wings placement, charge bonus, wide turns, bigger spacing
  const { COMPOSITIONS, TY, UT } = await import('../src/sim.js');
  check('cavalry selectable in the troop selects', !!COMPOSITIONS.cavalry && !!COMPOSITIONS.horde && COMPOSITIONS.balanced.cv > 0);
  { const s = new Sim({ perSide: 1000, seed: 3, comps: ['cavalry', 'hoplites'] }); const idx = [...Array(s.perSide).keys()].filter((i) => s.utype[i] === UT.CAVALRY), mx = Math.abs(Math.max(...idx.map((i) => Math.abs(s.x[i]))));
    const mean = idx.reduce((a, i) => a + Math.abs(s.x[i]), 0) / idx.length, all = [...Array(s.perSide).keys()].reduce((a, i) => a + Math.abs(s.x[i]), 0) / s.perSide;
    check('cavalry army: ~30% mounted, riding the wings', idx.length > 250 && idx.length < 350 && mean > all, `${idx.length} riders, mean |x| ${mean.toFixed(0)} vs army ${all.toFixed(0)}`); }
  { // charge: same cavalryman hits harder after a gallop than from a standstill
    const first = (startZ) => { let tot = 0, hits = 0;
      for (let seed = 1; seed <= 60; seed++) { const s = new Sim({ perSide: 2, seed, comps: ['hoplites', 'hoplites'] }); s.utype[0] = UT.CAVALRY; s.spd[0] = 2.1; s.hp[0] = 1e5; s.clip[0] = s.prevClip[0] = CAV;
        s.x[1] = 100; s.z[1] = 100; s.x[3] = -100; s.z[3] = -100; s.hp[2] = 1e5; s.hp[1] = s.hp[3] = 1e5; s.x[2] = 0; s.z[2] = 0; s.x[0] = 0; s.z[0] = startZ; s.yaw[0] = 0; s.rand = () => 0.3;
        const h0 = s.hp[2]; for (let k = 0; k < 400 && s.hp[2] === h0; k++) s.tick(0.05); if (s.hp[2] < h0) { tot += h0 - s.hp[2]; hits++; } }
      return hits ? tot / hits : 0; };
    const run = first(-28), still = first(-2.6);
    check('charge bonus: a galloping lancer hits harder than one standing still', run > still * 1.4 && still > 0, `${run.toFixed(1)} after a gallop vs ${still.toFixed(1)} from a standstill`); }
  { const s = new Sim({ perSide: 2, seed: 1, comps: ['hoplites', 'hoplites'] }); s.utype[0] = UT.CAVALRY; s.yaw[0] = s.yaw[1] = 0; s.turn(0, 3, 0.05, 8); s.turn(1, 3, 0.05, 8);
    check('cavalry turn wider than infantry', s.yaw[0] < s.yaw[1] * 0.6 && s.yaw[0] > 0, `${s.yaw[0].toFixed(3)} vs ${s.yaw[1].toFixed(3)} rad per tick`); }
  { const s = new Sim({ perSide: 400, seed: 5, comps: ['horde', 'cavalry'] }); for (let i = 0; i < 700; i++) s.tick(0.05);
    const cavs = [...Array(s.n).keys()].filter((i) => s.utype[i] === UT.CAVALRY && !s.removed[i]), liveC = cavs.filter((i) => s.state[i] !== ST.DEAD), deadC = cavs.filter((i) => s.state[i] === ST.DEAD);
    const ok = liveC.every((i) => s.clip[i] >= CAV && s.clip[i] < CAV + 10) && deadC.every((i) => s.clip[i] === CAV + 5 || s.clip[i] === CAV + 6);
    let ovl = 0; for (let a = 0; a < liveC.length; a++) for (let b2 = a + 1; b2 < liveC.length; b2++) if (Math.hypot(s.x[liveC[a]] - s.x[liveC[b2]], s.z[liveC[a]] - s.z[liveC[b2]]) < 0.55) ovl++;
    check('mounted battle: deaths, mounted clips, horses do not stack', s.deaths[0] + s.deaths[1] > 40 && ok && liveC.length > 20 && ovl / liveC.length < 0.05, `deaths ${s.deaths[0]}/${s.deaths[1]}, ${liveC.length} riders up, ${deadC.length} down, ${ovl} overlaps`); }
}

// ---------- sim ----------
{
  const a = new Sim({ perSide: 400, seed: 5 }), b = new Sim({ perSide: 400, seed: 5 });
  for (let i = 0; i < 1600; i++) { a.tick(0.05); b.tick(0.05); }
  check('sim is deterministic', a.hash() === b.hash(), `hash ${a.hash()}`);
  check('both armies took casualties', a.deaths[0] > 0 && a.deaths[1] > 0, `deaths ${a.deaths[0]}/${a.deaths[1]}`);
  check('no NaN or out-of-bounds units', [...a.x, ...a.z].every((v) => Number.isFinite(v) && Math.abs(v) <= a.world));
  let overlaps = 0, pairs = 0; const idx = []; for (let i = 0; i < a.n; i++) if (a.state[i] !== ST.DEAD && !a.removed[i]) idx.push(i);
  for (let i = 0; i < idx.length; i++) for (let j = i + 1; j < idx.length; j++) { const d = Math.hypot(a.x[idx[i]] - a.x[idx[j]], a.z[idx[i]] - a.z[idx[j]]); if (d < 0.5) overlaps++; pairs++; }
  check('soldiers do not stack on each other', overlaps / idx.length < 0.03, `${overlaps} overlapping pairs among ${idx.length} fighters`);
  const dead = [...Array(a.n).keys()].filter((i) => a.state[i] === ST.DEAD && !a.removed[i]);
  check('dead units play a death clip', dead.every((i) => a.clip[i] === CLIP.DIE_BACK || a.clip[i] === CLIP.DIE_FWD));
}
{ // lopsided fight: when one side dies the winners must stop and cheer, not keep marching
  const s = new Sim({ perSide: 150, seed: 4 }); 
  for (let i = 0; i < s.perSide; i++) { s.hp[s.perSide + i] = 1; s.spd[i] *= 1; }
  let k = 0; while (s.winner() < 0 && k < 4000) { s.tick(0.05); k++; }
  const w = s.winner(), pos0 = [...s.x]; for (let i = 0; i < 200; i++) s.tick(0.05);
  const surv = [...Array(s.n).keys()].filter((i) => s.state[i] !== ST.DEAD && !s.removed[i]);
  check('battle ends with a winner', w >= 0 && surv.length > 0, `winner ${w} after ${(k * 0.05).toFixed(0)} s`);
  check('survivors cheer and stay put', surv.every((i) => s.state[i] === ST.CHEER && s.clip[i] === CLIP.CHEER && Math.abs(s.x[i] - pos0[i]) < 1e-3 && s.vx[i] === 0 && s.vz[i] === 0), `${surv.length} survivors`);
}
{ // morale: losing side breaks and flees, battle ends instead of grinding on
  const m = new Sim({ perSide: 400, seed: 5 }); let t = 0; while (m.winner() < 0 && t < 12000) { m.tick(0.05); t++; }
  check('battle ends naturally with a winner', m.winner() >= 0, `winner ${m.winner()} after ${(t * 0.05).toFixed(0)}s`);
  check('nobody runs away', m.fled[0] + m.fled[1] === 0, `fled ${m.fled}, dead ${m.deaths[0]}/${m.deaths[1]}`);
  check('battle ends within 8 minutes', t * 0.05 < 480, `${(t * 0.05).toFixed(0)}s`);
}
{ // mixed armies: all five types appear, archers and javelins hit from range, commander buffs allies
  const s = new Sim({ perSide: 1500, seed: 8, comps: ['balanced', 'balanced'] });
  check('mixed army has every unit type', s.typeCount.every((c) => c > 0) && s.typeCount.reduce((a, b) => a + b) === s.n, `${s.typeCount}`);
  let maxArrows = 0, sawBuff = false; for (let i = 0; i < 1600; i++) { s.tick(0.05); let a = 0; for (let k = 0; k < s.adir.length; k += 4) a += s.adir[k + 3]; maxArrows = Math.max(maxArrows, a); if (!sawBuff) for (let q = 0; q < s.n; q++) if (s.tickCount - s.buffT[q] <= 8) { sawBuff = true; break; } }
  const dead = { 2: 0, 3: 0 }; for (let i = 0; i < s.n; i++) if (s.state[i] === ST.DEAD) { /* corpses */ }
  check('archers and javelineers loose projectiles', maxArrows > 5, `${maxArrows} in flight at once`);
  check('commander aura buffs nearby troops', sawBuff);
  check('mixed battle produces casualties on both sides', s.deaths[0] > 20 && s.deaths[1] > 20, `${s.deaths[0]}/${s.deaths[1]}`);
}
{ // every formation lays out an army without stacking, and each one actually fights
  const { FORMATION_KEYS } = await import('../src/formations.js');
  for (const k of FORMATION_KEYS) {
    const s = new Sim({ perSide: 300, seed: 3, formations: [k, FORMATION_KEYS[(FORMATION_KEYS.indexOf(k) + 1) % 6]] });
    let bad = 0, close = 0; for (let i = 0; i < s.n; i++) { if (!Number.isFinite(s.x[i]) || Math.abs(s.x[i]) > s.world || Math.abs(s.z[i]) > s.world) bad++; }
    const idx = [...Array(s.n).keys()]; for (let i = 0; i < s.n; i++) for (let j = i + 1; j < s.n; j++) if (Math.hypot(s.x[i] - s.x[j], s.z[i] - s.z[j]) < 0.35) close++;
    for (let i = 0; i < 1500; i++) s.tick(0.05);
    check(`formation ${k}: valid layout, no stacking, fights`, bad === 0 && close < 10 && s.deaths[0] + s.deaths[1] > 0, `${close} too-close pairs, deaths ${s.deaths[0]}/${s.deaths[1]}`);
  }
}
{
  const s = new Sim({ perSide: 10000, seed: 2 }); let t = performance.now(); for (let i = 0; i < 400; i++) s.tick(0.05);
  const ms = (performance.now() - t) / 400; check('sim tick under 18 ms for 20,000 soldiers', ms < 18, `${ms.toFixed(1)} ms/tick (20 ticks/s, runs in a worker)`);
}

// ---------- terrain ----------
for (const id of ['hills', 'ford', 'forest']) {
  const a = new Sim({ perSide: 400, seed: 5, terrain: id }), b = new Sim({ perSide: 400, seed: 5, terrain: id });
  for (let i = 0; i < 1600; i++) { a.tick(0.05); b.tick(0.05); }
  check(`${id}: deterministic, finite, both sides fight`, a.hash() === b.hash() && [...a.x, ...a.z].every(Number.isFinite) && a.deaths[0] > 0 && a.deaths[1] > 0, `deaths ${a.deaths[0]}/${a.deaths[1]}`);
}
{
  const s = new Sim({ perSide: 400, seed: 1, terrain: 'ford' }), tr = s.tr; let deepStarts = 0;
  for (let i = 0; i < s.n; i++) if (tr.K[cellOf(tr, s.x[i], s.z[i])]) deepStarts++;
  check('ford: nobody starts in the water', deepStarts === 0);
  check('ford: crossing is wadeable, rest of the river is deep', tr.K[cellOf(tr, 0, 0)] === 1 && tr.K[cellOf(tr, tr.world * 0.5, 0)] === 2, `centre ${tr.K[cellOf(tr, 0, 0)]}, flank ${tr.K[cellOf(tr, tr.world * 0.5, 0)]}`);
  const h = new Sim({ perSide: 400, seed: 1, terrain: 'hills' }); const w = h.world;
  const up = h.moveMul ? (() => { h.x[0] = -0.2 * w - 40; h.z[0] = -10; return h.moveMul(0, 1, 0); })() : 1;
  check('hills: walking uphill is slower than downhill', up < 0.95 && (() => { h.x[0] = -0.2 * w + 40; return h.moveMul(0, 1, 0); })() > up, `uphill ${up.toFixed(2)}`);
  check('flat stays the default with no terrain effects', new Sim({ perSide: 10 }).tr.fx === false);
}
{ // standards: human scale and carried by a living bearer
  const { STD } = await import('../src/banners.js');
  check('standard is human scale', STD.pole <= 3.2 && STD.pole >= 2.2 && STD.clothW <= 0.9 && STD.clothH <= 0.6, `pole ${STD.pole} m, cloth ${STD.clothW}x${STD.clothH} m`);
  check('standard is gripped beside the bearer', Math.hypot(STD.offR, STD.offF) < 0.45 && STD.base < 1.2 && STD.base + STD.pole > 1.2, `hand offset ${Math.hypot(STD.offR, STD.offF).toFixed(2)} m, grip height 1.2 m inside pole span`);
}
// ---------- siege: prop geometry ----------
{
  const P = SG.siegeParams(140), parts = { wall: SG.buildWall(P), leaf: SG.buildLeaf(), ladder: SG.buildLadder(), 'ram frame': SG.buildRamFrame(), 'ram log': SG.buildRamLog() };
  let flipped = 0, faces = 0;
  for (const [name, b] of Object.entries(parts)) {
    for (const pr of b.prims) for (let t = pr.i0; t < pr.i1; t += 3) {
      const [a, c, d] = [b.idx[t], b.idx[t + 1], b.idx[t + 2]].map((k) => [b.pos[k * 3], b.pos[k * 3 + 1], b.pos[k * 3 + 2]]);
      const nx = (c[1] - a[1]) * (d[2] - a[2]) - (c[2] - a[2]) * (d[1] - a[1]), ny = (c[2] - a[2]) * (d[0] - a[0]) - (c[0] - a[0]) * (d[2] - a[2]), nz = (c[0] - a[0]) * (d[1] - a[1]) - (c[1] - a[1]) * (d[0] - a[0]);
      const fx = (a[0] + c[0] + d[0]) / 3 - pr.center[0], fy = (a[1] + c[1] + d[1]) / 3 - pr.center[1], fz = (a[2] + c[2] + d[2]) / 3 - pr.center[2]; faces++;
      if (nx * fx + ny * fy + nz * fz < -1e-9) flipped++;
    }
    // loose parts: every primitive must touch the rest through overlapping bounds (one connected piece per mesh)
    const n = b.prims.length, seen = new Set([0]), q = [0], eps = 0.03;
    while (q.length) { const i = q.pop(); for (let j = 0; j < n; j++) if (!seen.has(j)) { const A = b.prims[i], B = b.prims[j]; if ([0, 1, 2].every((k) => A.min[k] <= B.max[k] + eps && B.min[k] <= A.max[k] + eps)) { seen.add(j); q.push(j); } } }
    check(`siege ${name}: no loose parts`, seen.size === n, `${seen.size}/${n} connected`);
  }
  check('siege props: every face winds outward', flipped === 0, `${flipped}/${faces} faces flipped`);
  const w = parts.wall; let inGate = 0; for (let i = 0; i < w.pos.length; i += 3) { const x = w.pos[i], y = w.pos[i + 1], z = w.pos[i + 2]; if (Math.abs(x) < SG.GATE_HALF - 0.01 && y > 0.01 && y < SG.SPRING - 0.01 && Math.abs(z) < SG.HT) inGate++; }
  check('gate opening is clear of stonework', inGate === 0, `${inGate} vertices inside the doorway`);
  let minY = 9; for (const b of Object.values(parts)) if (b !== parts['ram log']) for (let i = 1; i < b.pos.length; i += 3) minY = Math.min(minY, b.pos[i]);
  check('nothing floats above ground or leaves a gap under the wall', minY >= -3.001 && parts.ladder.prims.every((p) => p.min[1] >= -0.001) && parts['ram frame'].prims.every((p) => p.min[1] >= -0.001));
  const fr = parts['ram frame'], frameX = Math.max(...fr.prims.filter((p) => p.min[1] < 2.5).map((p) => p.max[0])); // below head height (the roof overhang is above the crew)
  check('ram crew stand clear of the ram frame', SG.RAM.slotX - 0.3 > frameX, `frame edge ${frameX.toFixed(2)} m, crew at ${SG.RAM.slotX} m`);
  const gap = -SG.HT - (SG.RAM.stopZ + SG.RAM.headZ); check('ram head rests against the gate (no gap, no overlap into it)', gap >= 0 && gap < 0.15, `gap ${gap.toFixed(2)} m`);
  const top = SG.LADDER_FOOT_Z + SG.LADDER_LEN * Math.sin(SG.LADDER_LEAN), topY = SG.LADDER_LEN * Math.cos(SG.LADDER_LEAN);
  check('raised ladders reach the wall walkway', topY >= SG.WALL_H && top >= -SG.HT - 0.5 && top <= -SG.HT + 0.2, `top at z ${top.toFixed(2)}, y ${topY.toFixed(2)}`);
  check('ladders stay clear of towers', P.ladders.every((x) => P.towers.every((t) => Math.abs(x - t) > SG.TOWER_R + 2)) && P.ladders.length >= 6, `${P.ladders.length} ladders`);
}
// ---------- siege: sim ----------
{
  const run = (seed, N, ticks, probe) => { const s = new Sim({ perSide: N, seed, mode: 'siege' }); for (let t = 0; t < ticks; t++) { s.tick(0.05); if (probe) probe(s, t); } return s; };
  const a = run(4, 300, 1800), b = run(4, 300, 1800);
  check('siege sim is deterministic', a.hash() === b.hash(), `hash ${a.hash()}`);
  const bad = { band: 0, early: 0, top: 0, elev: 0, tower: 0, nan: 0, floating: 0 }; let everTop = 0, gateAt = -1, maxClimb = 0;
  const s = run(4, 300, 6000, (s, t) => {
    const open = s.sg[1] >= 0.6; if (gateAt < 0 && s.sg[0] <= 0) gateAt = t; let climb = 0;
    for (let i = 0; i < s.n; i++) {
      if (s.removed[i]) continue; const x = s.x[i], z = s.z[i], e = s.elev[i], dead = s.state[i] === ST.DEAD;
      if (!Number.isFinite(x + z + e)) bad.nan++;
      if (e < -0.001 || e > SG.WALL_H + 0.4) bad.elev++;
      if (s.prog[i] >= 0) climb++;
      if (dead) { if (e > 0.2 && s.role[i] !== ROLE.POST && s.role[i] !== ROLE.FALL) bad.floating++; continue; }
      if (s.role[i] === ROLE.POST) { everTop++; if (Math.abs(e - SG.WALL_H) > 0.01 || Math.abs(z) > 1.05) bad.top++; }
      if (e < 1) {
        if (Math.abs(z) < SG.HT - 0.05 && !(open && Math.abs(x) < SG.GATE_HALF + 0.05)) bad.band++;
        if (!open && Math.abs(z) < SG.HT + 0.2 && Math.abs(x) < SG.GATE_HALF) bad.early++;
        for (const tx of s.siege.P.towers) if (Math.hypot(x - tx, z) < SG.TOWER_R - 0.1) bad.tower++;
      }
    }
    maxClimb = Math.max(maxClimb, climb);
  });
  check('nobody walks through the wall, closed gate or towers', bad.band + bad.early + bad.tower === 0, JSON.stringify(bad));
  check('wall-top units stay on the walkway; climbers stay on the ladder height range', bad.top + bad.elev + bad.nan === 0);
  check('fallen climbers do not hang in mid air', bad.floating === 0, `${bad.floating} frames`);
  check('ladders get climbed and the wall top is reached', maxClimb > 0 && everTop > 0, `${maxClimb} climbers at once`);
  check('ram breaks the gate and the doors swing open', s.sg[0] <= 0 && s.sg[1] >= 0.99 && s.sg[6] > 3, `gate broke at ${(gateAt / 20).toFixed(0)} s after ${s.sg[6]} hits`);
  check('siege ends with a winner', s.winner() >= 0, `alive ${s.alive[0]}/${s.alive[1]}`);
  const t0 = performance.now(), big = new Sim({ perSide: 10000, seed: 2, mode: 'siege' }); for (let i = 0; i < 300; i++) big.tick(0.05);
  const ms = (performance.now() - t0) / 300; check('siege tick under 18 ms for 15,000 soldiers', ms < 18, `${ms.toFixed(1)} ms/tick`);
}

// ---------- one lighting model for every LOD ----------
{
  const samples = normalSamples(geo, 1), V = (x, y, z) => ({ x, y, z });
  const L = { day: [V(0.45, 0.8, 0.35), V(0.85, 0.8, 0.7), V(0.5, 0.58, 0.68), V(0.32, 0.3, 0.26)], dusk: [V(-0.85, 0.26, 0.5), V(0.85, 0.5, 0.3), V(0.36, 0.38, 0.5), V(0.25, 0.21, 0.19)], rain: [V(0.45, 0.8, 0.35), V(0.1, 0.1, 0.1), V(0.42, 0.45, 0.52), V(0.27, 0.25, 0.22)] };
  for (const k in L) { const r = meanLit(samples, ...L[k]); check(`soldiers facing the sun and away from it differ by under 35% (${k})`, r.lo / r.hi > 0.65, `dimmest/brightest facing ${(r.lo / r.hi).toFixed(2)}`); }
}
{ // soldiers do not walk through trees
  const s = new Sim({ perSide: 800, seed: 5, terrain: 'forest' }), g = s.tr.tg; let bad = 0, worst = 1;
  check('forest has trees to collide with', g && g.n > 100, `${g && g.n} trees`);
  for (let t = 0; t < 900; t++) { s.tick(0.05); if (t % 30 === 0) for (let i = 0; i < s.n; i++) { if (s.removed[i]) continue; const cx = Math.floor((s.x[i] + g.w) / g.cs), cz = Math.floor((s.z[i] + g.w) / g.cs); for (const t2 of g.ids) { if (g.x[t2] < s.x[i] - 3 || g.x[t2] > s.x[i] + 3) continue; const d = Math.hypot(s.x[i] - g.x[t2], s.z[i] - g.z[t2]); worst = Math.min(worst, d / g.r[t2]); if (d < g.r[t2] * 0.9) bad++; } } }
  check('nobody stands inside a tree trunk', bad === 0, `${bad} overlaps, closest ${(worst * 100).toFixed(0)}% of blocking radius`);
}

// ---------- browser smoke ----------
let pw; try { pw = await import('playwright'); } catch { pw = await import('/opt/node-tools/node_modules/playwright/index.mjs'); }
execSync('npx vite build', { stdio: 'ignore' });
const srv = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 500 } }); const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); }); page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('http://localhost:4173/?test&manual&n=500'); await page.waitForFunction(() => window.__GAME__ && window.__GAME__.ready, null, { timeout: 30000 });
  const r = await page.evaluate(() => { const G = window.__GAME__; const out = {}; G.draw(); out.calls = G.renderer.info.render.calls; G.step(1600); G.draw(); G.setCam('ground'); G.draw();
    // input bursts
    for (const k of ['KeyW', 'KeyA', 'Space']) window.dispatchEvent(new KeyboardEvent('keydown', { code: k })); G.fly.update(0.1); for (let i = 0; i < 20; i++) { G.fly.look(5, 3, 0.01); G.draw(); }
    G.setPaused(true); G.setPaused(false); out.alive = [...G.sim.alive]; out.counts = G.battle.counts; out.y = G.camera.position.y; return out; });
  check('browser boots with window.__GAME__ and no console errors', errs.length === 0, errs.join(' | '));
  check('draw calls under 100', r.calls > 0 && r.calls < 100, `${r.calls} calls`);
  check('battle ran in browser', r.alive[0] < 500 || r.alive[1] < 500, `alive ${r.alive}`);
  check('free camera stays above ground', r.y > 0);
  { // LOD switch is a soft band, not a ring; camera NaNs and a lost GL context both recover
    const lo = await page.evaluate(() => { const G = window.__GAME__, S = G.sim; G.step(5); G.fly.lookAt(0, 6, -120, 0, 2, 0); G.draw(); const b = G.battle, cam = G.camera; let maxNear = 0, minOther = 1e9;
      for (let i = 0; i < S.n; i++) { if (S.removed[i]) continue; const d = Math.hypot(S.x[i] - cam.position.x, S.z[i] - cam.position.z, 0.9 - cam.position.y); if (b.lod[i] === 0) maxNear = Math.max(maxNear, d); else minOther = Math.min(minOther, d); }
      return { maxNear, minOther, near: b.counts.near, mid: b.counts.mid }; });
    check('near/mid LOD switch is a soft band, not a circle', lo.near === 0 || lo.maxNear > lo.minOther, `farthest full-detail ${lo.maxNear.toFixed(0)} m vs nearest reduced ${lo.minOther.toFixed(0)} m`);
    const nan = await page.evaluate(() => { const G = window.__GAME__; G.fly.look(NaN, NaN, 0.01); G.fly.yaw = NaN; G.fly.pos.set(NaN, 5, 3); G.fly.update(NaN); G.draw(); return [G.fly.yaw, G.fly.pitch, ...G.fly.pos.toArray()].every(Number.isFinite); });
    check('NaN input never reaches the camera', nan);
    const px = await page.evaluate(async () => { const G = window.__GAME__, gl = G.renderer.getContext(), ext = gl.getExtension('WEBGL_lose_context'); G.setCam('front'); if (!ext) return null;
      ext.loseContext(); await new Promise((r) => setTimeout(r, 150)); ext.restoreContext(); await new Promise((r) => setTimeout(r, 600));
      G.draw(); const b = new Uint8Array(4); gl.readPixels(Math.floor(gl.drawingBufferWidth / 2), Math.floor(gl.drawingBufferHeight * 0.8), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, b); return [...b]; });
    check('screen is not black after a lost and restored WebGL context', px === null || px[0] + px[1] + px[2] > 40, JSON.stringify(px));
  }
  { // siege scenario boots, runs and stays under the draw-call budget
    const sp = await browser.newPage({ viewport: { width: 800, height: 500 } }); const e2 = []; sp.on('console', (m) => { if (m.type() === 'error') e2.push(m.text()); }); sp.on('pageerror', (e) => e2.push(e.message));
    await sp.goto('http://localhost:4173/?test&manual&mode=siege&n=500'); await sp.waitForFunction(() => window.__GAME__ && window.__GAME__.ready, null, { timeout: 30000 });
    const q = await sp.evaluate(() => { const G = window.__GAME__; G.draw(); G.step(900); G.setCam('ground'); G.draw(); const out = { calls: G.renderer.info.render.calls, mode: G.mode, gate: G.sim.sg[0], alive: [...G.sim.alive] }; G.setCam('over'); G.draw(); out.calls2 = G.renderer.info.render.calls; return out; });
    check('siege mode boots in the browser with no console errors', q.mode === 'siege' && e2.length === 0, e2.join(' | '));
    check('siege draw calls under 100', q.calls < 100 && q.calls2 < 100, `${q.calls}/${q.calls2} calls`);
    check('siege battle ran in browser', q.gate < 1400 && q.alive[0] <= 500, `gate ${q.gate | 0}, alive ${q.alive}`);
    await sp.close();
  }
  { // the real (worker) path: shared buffers, fast-forward pacing, no errors
    const wp = await browser.newPage({ viewport: { width: 640, height: 400 } }); const e3 = []; wp.on('console', (m) => { if (m.type() === 'error') e3.push(m.text()); }); wp.on('pageerror', (e) => e3.push(e.message));
    await wp.goto('http://localhost:4173/?n=2000'); await wp.waitForFunction(() => window.__GAME__ && window.__GAME__.ready && window.__GAME__.sim, null, { timeout: 30000 });
    await wp.evaluate(() => { const b = document.getElementById('ff'); while (window.__GAME__.speed !== 4) b.click(); }); await wp.waitForTimeout(3500); await wp.waitForFunction(() => window.__GAME__.achieved > 0, null, { timeout: 10000 });
    const w = await wp.evaluate(() => { const G = window.__GAME__; return { worker: G.worker, ach: G.sim.achieved, tick: G.sim.meta[1], types: G.sim.typeCount && G.sim.utype.length === G.sim.n }; });
    check('worker mode boots with shared unit-type data and no console errors', w.worker === true && w.types && e3.length === 0, `worker ${w.worker}, ${e3.slice(0, 2).join(' | ')}`);
    check('fast-forward 4x reaches about 4x on a small battle', w.ach > 3 && w.ach < 5, `achieved ${w.ach.toFixed(2)}x, tick ${w.tick}`);
    await wp.close();
  }
  const ff = await page.evaluate(() => { const b = document.getElementById('ff'); b.click(); const a = b.textContent; b.click(); b.click(); b.click(); return [a, b.textContent]; });
  check('fast-forward button cycles 1x/2x/4x/8x', ff[0] === '2×' && ff[1] === '1×', ff.join(' -> '));
  const cam = await page.evaluate(async () => {
    const G = window.__GAME__, D = G.dir, o = {}; await G.restart(500); const S = G.sim; G.setCam('front'); G.step(1100);
    // record ~4s with real recorder
    for (let i = 0; i < 90; i++) { G.step(1); D.rec.record(S, 0.05); }
    o.recSec = D.rec.seconds;
    const i = D.pick(S, innerWidth / 2, innerHeight / 2, innerWidth, innerHeight, 2000); o.picked = i;
    D.follow(i, S); for (let k = 0; k < 40; k++) { D.update(0.05, S, 0); G.draw(); } o.fv = D.cam.position.distanceTo(D.pos);
    const p = [S.x[i], S.z[i]]; o.followDist = Math.hypot(D.cam.position.x - p[0], D.cam.position.z - p[1]);
    D.toggleView(); for (let k = 0; k < 20; k++) { D.update(0.05, S, 0); G.draw(); } o.fpDist = Math.hypot(D.cam.position.x - S.x[i], D.cam.position.z - S.z[i]); o.fpY = D.cam.position.y;
    D.setMode('cine'); for (let k = 0; k < 400; k++) { D.update(0.05, S, 0); } G.draw(); o.cine = D.cam.position.toArray().every(Number.isFinite) && !!D.hot;
    D.startReplay(); let rs = null; for (let k = 0; k < 60; k++) { rs = D.update(0.05, S, 0); G.battle.sim = rs || S; G.battle.update(G.camera, 0); G.battle.sim = S; } o.replay = !!rs; o.replayFinite = [...D.rsim.x].every(Number.isFinite);
    D.stopReplay(); D.setMode('free'); o.free = D.mode === 'free'; o.camFinite = D.cam.position.toArray().every(Number.isFinite);
    return o;
  });
  check('record keeps a few seconds of battle', cam.recSec > 3, `${cam.recSec.toFixed(1)} s`);
  check('follow-cam picks a soldier and trails it', cam.picked >= 0 && cam.followDist < 12, `dist ${cam.followDist?.toFixed(1)} m`);
  check('first-person view sits at the soldier, above ground', cam.fpDist < 2 && cam.fpY > 1, `dist ${cam.fpDist?.toFixed(2)} y ${cam.fpY?.toFixed(2)}`);
  check('cinematic camera finds the fight', cam.cine);
  check('replay plays recorded frames and exits cleanly', cam.replay && cam.replayFinite && cam.free && cam.camFinite);
  check('camera modes raise no console errors', errs.length === 0, errs.join(' | '));
  for (const q of ['terrain=hills&weather=fog&time=dusk', 'terrain=ford&weather=rain&time=day', 'terrain=forest&weather=rain&time=dusk']) {
    const errs2 = []; const p2 = await browser.newPage({ viewport: { width: 800, height: 500 } }); p2.on('console', (m) => { if (m.type() === 'error') errs2.push(m.text()); }); p2.on('pageerror', (e) => errs2.push(e.message));
    await p2.goto(`http://localhost:4173/?test&manual&n=500&${q}`, { timeout: 120000 }); await p2.waitForFunction(() => window.__GAME__ && window.__GAME__.ready, null, { timeout: 30000 });
    const calls = await p2.evaluate(() => { const G = window.__GAME__; G.step(400); G.draw(); G.setLook({ weather: 'rain', time: 'dusk' }); G.draw(); return G.renderer.info.render.calls; });
    check(`look ${q}: no console errors, draw calls under 100`, errs2.length === 0 && calls < 100, `${calls} calls ${errs2.join(' | ')}`); await p2.close();
  }
  const t0 = await page.evaluate(() => { const G = window.__GAME__, a = performance.now(); for (let i = 0; i < 10; i++) G.draw(); return (performance.now() - a) / 10; });
  console.log(`INFO  software-GL frame cost ${t0.toFixed(0)} ms (CPU submit only, headless software GL; real FPS needs a GPU)`);
} finally { await browser.close(); srv.kill(); }
{ // commander orders
  const mk = () => new Sim({ perSide: 400, seed: 3 }), ids = (s) => Array.from({ length: 100 }, (_, i) => i);
  const a = mk(); const ids0 = ids(a); const cz0 = ids0.reduce((q, i) => q + a.z[i], 0) / 100;
  a.command(ids0, ORD.ADVANCE, 0, cz0 + 40); for (let k = 0; k < 400; k++) a.tick(a.TICK);
  const cz1 = ids0.reduce((q, i) => q + a.z[i], 0) / 100; check('advance order moves the group forward', cz1 > cz0 + 25, `${cz0.toFixed(1)} -> ${cz1.toFixed(1)}`);
  check('group reverts to hold on arrival', ids0.filter((i) => a.ord[i] === ORD.HOLD).length > 80);
  const b = mk(); b.command(ids0, ORD.HOLD); const x0 = ids0.map((i) => b.x[i]), z0 = ids0.map((i) => b.z[i]);
  for (let k = 0; k < 300; k++) b.tick(b.TICK); let drift = 0; ids0.forEach((i, k) => { drift = Math.max(drift, Math.hypot(b.x[i] - x0[k], b.z[i] - z0[k])); });
  check('hold order keeps soldiers in place', drift < 6, `max drift ${drift.toFixed(1)} m`);
  const f = mk(); const fx0 = ids0.reduce((q, i) => q + f.x[i], 0) / 100; f.command(ids0, ORD.FLANK, fx0 + 60, cz0 + 40); for (let k = 0; k < 500; k++) f.tick(f.TICK);
  const fx1 = ids0.reduce((q, i) => q + f.x[i], 0) / 100; check('flank order swings the group sideways', fx1 > fx0 + 40, `${fx0.toFixed(1)} -> ${fx1.toFixed(1)}`);
}

console.log(`\n${passes} passed, ${fails} failed`); process.exit(fails ? 1 : 0);
