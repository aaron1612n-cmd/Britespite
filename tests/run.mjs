// Automated suite: model/rig geometry, sim determinism + collisions + combat, and a headless browser smoke test.
// Run: npm test   (needs `npm run build` output only for the browser part; it builds for you)
import { spawn, execSync } from 'node:child_process';
import { buildSoldier, SHIELD_PLANE_Y } from '../src/model.js';
import { bakeAll, skinVertices } from '../src/rig.js';
import { NB, BONES } from '../src/skeleton.js';
import { CLIPS, CLIP } from '../src/clips.js';
import { Sim, ST } from '../src/sim.js';

let fails = 0, passes = 0;
const check = (name, ok, info = '') => { ok ? passes++ : fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); };

// ---------- model / animation geometry ----------
const geo = buildSoldier(0), mid = buildSoldier(1), bake = bakeAll(geo);
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
  for (let c = 0; c < CLIPS.length; c++) {
    let mn = 9, mx = -9;
    for (let f = 0; f < bake.info[c].count; f++) { const s = skinVertices(geo, mats(c, f)); for (let i = 1; i < s.length; i += 3) { mn = Math.min(mn, s[i]); mx = Math.max(mx, s[i]); } }
    const die = CLIPS[c].name.startsWith('die'), lim = die ? 0.02 : 0.08; if (mn < -lim || mx > 4.0) { ok = false; info += ` ${CLIPS[c].name}:min${mn.toFixed(2)}/max${mx.toFixed(2)}`; }
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
  for (let c = 0; c < CLIPS.length; c++) { if (['die', 'che'].includes(CLIPS[c].name.slice(0, 3))) continue; for (let f = 0; f < bake.info[c].count; f++) { const sk = skinVertices(geo, mats(c, f)); for (const i of shieldIdx) worst = Math.min(worst, sk[i * 3 + 2]); } }
  check('shield never passes behind the body line', worst > -0.1, `rearmost shield z ${worst.toFixed(2)} m`);
}
check('mid LOD far lighter than full', mid.index.count < geo.index.count * 0.4, `${geo.index.count / 3} vs ${mid.index.count / 3} tris`);

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
  check('losers fled rather than all dying', m.fled[0] + m.fled[1] > 20, `fled ${m.fled}, dead ${m.deaths[0]}/${m.deaths[1]}`);
  check('battle ends within 8 minutes', t * 0.05 < 480, `${(t * 0.05).toFixed(0)}s`);
}
{
  const s = new Sim({ perSide: 10000, seed: 2 }); let t = performance.now(); for (let i = 0; i < 400; i++) s.tick(0.05);
  const ms = (performance.now() - t) / 400; check('sim tick under 18 ms for 20,000 soldiers', ms < 18, `${ms.toFixed(1)} ms/tick (20 ticks/s, runs in a worker)`);
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
  const ff = await page.evaluate(() => { const b = document.getElementById('ff'); b.click(); const a = b.textContent; b.click(); b.click(); b.click(); return [a, b.textContent]; });
  check('fast-forward button cycles 1x/2x/4x/8x', ff[0] === '2×' && ff[1] === '1×', ff.join(' -> '));
  const t0 = await page.evaluate(() => { const G = window.__GAME__, a = performance.now(); for (let i = 0; i < 10; i++) G.draw(); return (performance.now() - a) / 10; });
  console.log(`INFO  software-GL frame cost ${t0.toFixed(0)} ms (CPU submit only, headless software GL; real FPS needs a GPU)`);
} finally { await browser.close(); srv.kill(); }
console.log(`\n${passes} passed, ${fails} failed`); process.exit(fails ? 1 : 0);
