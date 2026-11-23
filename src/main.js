import * as THREE from 'three';
import { THEME, applyTheme } from './theme.js';
import { Sim } from './sim.js';
import { RemoteSim } from './remote.js';
import { Battlefield } from './render.js';
import { FlyCam } from './controls.js';
import { BattleAudio } from './audio.js';
import { heightAt } from './terrain.js';
import { CamDirector } from './camdirector.js';

applyTheme();
const $ = (id) => document.getElementById(id);
const qs = new URLSearchParams(location.search);
const coarse = matchMedia('(pointer:coarse)').matches;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const testMode = qs.has('test');
const SIZES = [500, 2000, 5000, 10000, 20000, 35000, 50000];
let perSide = +qs.get('n') || (coarse ? 3000 : 10000);
if (!SIZES.includes(perSide)) SIZES.push(perSide), SIZES.sort((a, b) => a - b);

const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !coarse && !testMode, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, coarse ? 1.5 : 1.75));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.3, 6000);
const fly = new FlyCam(camera, canvas);
const audio = new BattleAudio();
const dir = new CamDirector({ camera, fly, reduced });
const G = (window.__GAME__ = { paused: false, fps: 0, frame: 0, errors: [] });
addEventListener('error', (e) => G.errors.push(String(e.message)));

let sim, battle;
function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

let starting = 0;
async function start(n) {
  perSide = n; const ticket = ++starting; if (sim && sim.terminate) sim.terminate(); sim = null; if (battle) { for (const m of [battle.meshNear, battle.meshMid, battle.meshFar, battle.terrain, battle.sky]) { scene.remove(m); m.geometry.dispose(); } }
  scene.clear(); const opts = { perSide: n, seed: +qs.get('seed') || 1 };
  const useWorker = self.crossOriginIsolated && typeof Worker !== 'undefined' && !testMode && !qs.has('sync');
  const s = useWorker ? await new RemoteSim(opts).ready : new Sim(opts); if (ticket !== starting) return; sim = s; G.worker = useWorker; battle = new Battlefield(scene, sim);
  battle.setQuality(coarse ? 0.35 : 1);
  G.sim = sim; G.battle = battle; $('banner').style.display = 'none';
  const files = Math.ceil(Math.sqrt(n * 2.8)), w = files * 1.2, rz = -(80 + Math.ceil(n / files) * 1.2 + 14);
  G.view = { front: [w * 0.08, 9, rz, 0, 3, 90], over: [0, Math.max(50, w * 0.5), rz - w * 0.25, 0, 0, 60], ground: [-w * 0.5 + 8, 2.0, -86, -w * 0.5 + 40, 2.2, -82] };
  dir.reset(sim); setCam(reduced || testMode ? 'front' : null);
}
function setCam(name) {
  dir.stopReplay(); dir.setMode('free');
  if (name) { fly.lookAt(...G.view[name]); sweep = null; return; }
  const a = G.view.over, b = G.view.front; sweep = { t: 0, a, b }; fly.lookAt(...a);
}
let sweep = null;
function runSweep(dt) {
  if (!sweep) return; if (fly.input || dir.active) { sweep = null; return; }
  sweep.t += dt / 5; const k = Math.min(1, sweep.t), e = k * k * (3 - 2 * k), v = sweep.a.map((x, i) => x + (sweep.b[i] - x) * e);
  fly.lookAt(...v); if (k >= 1) sweep = null;
}

// ---- UI
const sel = $('size'); sel.innerHTML = SIZES.map((s) => `<option value="${s}">${(s * 2).toLocaleString()} soldiers</option>`).join(''); sel.value = perSide;
sel.addEventListener('change', () => start(+sel.value));
const pauseBtn = $('pause'), muteBtn = $('mute');
function setPaused(p) { G.paused = p; if (sim && sim.setPaused) sim.setPaused(p); pauseBtn.setAttribute('aria-pressed', p); pauseBtn.textContent = p ? 'Resume' : 'Pause'; }
function setMuted(m) { audio.setMuted(m); muteBtn.setAttribute('aria-pressed', m); muteBtn.textContent = m ? 'Sound off' : 'Sound on'; }
pauseBtn.onclick = () => setPaused(!G.paused); muteBtn.onclick = () => setMuted(!audio.muted); $('restart').onclick = () => start(perSide);
const cineBtn = $('cine'), replayBtn = $('replay'), camstat = $('camstat'), cview = $('cview'), cspeed = $('cspeed');
const side = (t) => (t === 0 ? 'Crimson' : 'Azure');
dir.onChange = () => {
  cineBtn.setAttribute('aria-pressed', dir.mode === 'cine'); replayBtn.setAttribute('aria-pressed', dir.replaying);
  const f = dir.mode === 'follow', r = dir.replaying; camstat.style.display = dir.active || r ? 'flex' : 'none';
  $('ctext').textContent = (r ? 'REPLAY · ' : '') + (f ? `Following ${side(sim.team[dir.target])} soldier` : dir.mode === 'cine' ? 'Cinematic camera' : 'Free camera');
  cview.style.display = f ? '' : 'none'; cview.textContent = dir.view === 'chase' ? 'First person' : 'Chase view'; cspeed.style.display = r ? '' : 'none'; cspeed.textContent = `${dir.speed}× speed`;
  $('cfree').textContent = r ? 'Exit replay' : 'Free cam';
};
cineBtn.onclick = () => dir.setMode(dir.mode === 'cine' ? 'free' : 'cine');
replayBtn.onclick = () => (dir.replaying ? dir.stopReplay() : dir.startReplay() || flash('Not enough battle recorded yet'));
cview.onclick = () => dir.toggleView(); cspeed.onclick = () => dir.cycleSpeed();
$('cfree').onclick = () => (dir.replaying ? dir.stopReplay() : dir.setMode('free'));
const src = () => (dir.replaying ? dir.rsim : sim);
function flash(t) { hint.textContent = t; hint.classList.remove('off'); clearTimeout(flash.t); flash.t = setTimeout(() => hint.classList.add('off'), 2200); }
function followAt(px, py, reach) { const i = dir.pick(src(), px, py, innerWidth, innerHeight, reach); if (i >= 0) { dir.follow(i, src()); return true; } return false; }
let tap = null;
canvas.addEventListener('pointerdown', (e) => { if (e.isPrimary) tap = { x: e.clientX, y: e.clientY, t: performance.now() }; });
canvas.addEventListener('pointerup', (e) => {
  if (!tap || !e.isPrimary || !sim) return; const m = Math.hypot(e.clientX - tap.x, e.clientY - tap.y), d = performance.now() - tap.t; tap = null;
  if (m > 8 || d > 450) return; const locked = document.pointerLockElement === canvas; followAt(locked ? innerWidth / 2 : e.clientX, locked ? innerHeight / 2 : e.clientY, locked ? 60 : e.pointerType === 'touch' ? 48 : 30);
});
const hint = $('hint'); let tut = 0;
const TUT = coarse
  ? ['Left pad: fly. Drag anywhere else: look.', '▲ ▼ change height. » is turbo.', 'Fly down to the front line and watch them fight.', 'Tap a soldier to follow them. Cinema and Replay are up top.']
  : ['Click to look around. WASD flies, Space / C up and down.', 'Shift is turbo. Mouse wheel changes speed.', 'Keys 1, 2, 3 jump to the field. P pauses, M sound.', 'Click a soldier to follow. V view, T cinema, Y replay, Esc free.'];
function showTut(i) { tut = i; if (i >= TUT.length) { hint.classList.add('off'); return; } hint.textContent = TUT[i]; hint.classList.remove('off'); }
$('help').onclick = () => { setCam('front'); showTut(0); tutT = 0; };
showTut(0); let tutT = 0, tutMoved = false;
addEventListener('keydown', (e) => {
  audio.start(); if (e.repeat) return;
  if (e.code === 'KeyP') setPaused(!G.paused); else if (e.code === 'KeyM') setMuted(!audio.muted); else if (e.code === 'KeyR') start(perSide); else if (e.code === 'KeyH') $('help').click();
  else if (e.code === 'KeyT') cineBtn.click(); else if (e.code === 'KeyY') replayBtn.click(); else if (e.code === 'KeyV' && dir.mode === 'follow') dir.toggleView();
  else if (e.code === 'KeyF') { if (!followAt(innerWidth / 2, innerHeight / 2, 400)) flash('No soldier in view'); } else if (e.code === 'Escape') $('cfree').click();
  else if (e.code === 'Digit1') setCam('front'); else if (e.code === 'Digit2') setCam('over'); else if (e.code === 'Digit3') setCam('ground');
});
addEventListener('pointerdown', () => { if (!audio.ctx && !audio.muted) audio.start(); }, { once: false });

// ---- loop
let last = performance.now(), fAcc = 0, fN = 0, statT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now; G.frame++;
  if (dir.active && dir.userTookOver()) { dir.stopReplay(); dir.setMode('free'); }
  runSweep(dt); if (!dir.active) fly.update(dt); if (!sim) return;
  let alpha = 0;
  if (!G.paused && !G.manual) alpha = sim.advance(dt); else alpha = G.manual ? 0 : sim.acc / sim.TICK;
  if (!G.paused) dir.rec.record(sim, dt);
  const rs = dir.update(dt, sim, alpha); battle.sim = rs || sim; battle.update(camera, rs ? 0 : alpha); battle.sim = sim;
  renderer.render(scene, camera);
  fAcc += dt; fN++;
  if (fAcc > 0.5) { G.fps = fN / fAcc; fAcc = 0; fN = 0; adapt(); }
  if ((statT += dt) > 0.25) { statT = 0; hud(); }
  // audio
  if (audio.ctx && !audio.muted) {
    const hs = []; for (const h of sim.hitEvents) { const d = Math.hypot(h.x - camera.position.x, h.z - camera.position.z, camera.position.y); const v = Math.max(0, 1 - d / 160); if (v > 0.05) hs.push(v); }
    audio.update(Math.min(1, battle.counts.near / 300 + 0.15), hs);
  }
  if (tut < TUT.length && fly.input) { tutT += dt; if (tutT > 3.5) { tutT = 0; showTut(tut + 1); } }
}
// keep the frame rate smooth by trading near-LOD budget
function adapt() {
  const q = coarse ? 0.35 : 1, b = battle; if (G.fps === 0) return;
  const f = G.fps < 40 ? 0.85 : G.fps > 57 ? 1.06 : 1; b.scale = Math.min(q * 1.6, Math.max(0.1, (b.scale ?? q) * f)); b.setQuality(b.scale);
}
function hud() {
  $('ca').textContent = sim.alive[0].toLocaleString(); $('cb').textContent = sim.alive[1].toLocaleString();
  const c = battle.counts; $('stats').textContent = `${G.fps.toFixed(0)} fps · ${(sim.n - 0).toLocaleString()} units\nnear ${c.near} · mid ${c.mid} · far ${c.far}`;
  const w = sim.winner(); const bn = $('banner'); if (w >= 0) { bn.style.display = 'block'; bn.textContent = w === 0 ? 'Crimson holds the field' : 'Azure holds the field'; }
}
G.step = (ticks = 1) => { if (!G.worker) for (let i = 0; i < ticks; i++) sim.tick(sim.TICK); };
G.draw = () => { battle.update(camera, 0); renderer.render(scene, camera); };
G.dir = dir; G.renderer = renderer; G.setCam = setCam; G.restart = start; G.setPaused = setPaused; G.fly = fly; G.camera = camera;
G.manual = qs.has('manual');
start(perSide); setMuted(true);
G.ready = true;
requestAnimationFrame(frame);
