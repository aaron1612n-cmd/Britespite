import * as THREE from 'three';
import { THEME, applyTheme } from './theme.js';
import { Sim } from './sim.js';
import { RemoteSim } from './remote.js';
import { Battlefield } from './render.js';
import { FlyCam } from './controls.js';
import { BattleAudio } from './audio.js';
import { heightAt, TERRAINS } from './terrain.js';
import { TIMES, WEATHERS } from './atmosphere.js';
import { FORMATIONS, FORMATION_KEYS } from './formations.js';
import { Standards } from './banners.js';
import { Commander } from './command.js';
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

const pick = (v, set, d) => (v in set ? v : d);
const look = { terrain: pick(qs.get('terrain'), TERRAINS, 'flat'), weather: pick(qs.get('weather'), WEATHERS, 'clear'), time: pick(qs.get('time'), TIMES, 'day'), reduced, coarse };
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

let sim, battle, flags;
// army colours: index into THEME.palette, remembered between visits
const pal = THEME.palette; let ci = [0, 1];
try { const v = JSON.parse(localStorage.getItem('bs-colors')); if (Array.isArray(v) && v.length === 2 && v.every((i) => pal[i])) ci = v; } catch (e) {}
const cols = () => ci.map((i) => pal[i].c);
function applyColors() {
  const [a, b] = cols(); if (battle) battle.setTeamColors(a, b); if (flags) flags.setColors([a, b]);
  const r = document.documentElement.style; r.setProperty('--teamA', a); r.setProperty('--teamB', b);
  $('swA').style.background = a; $('swB').style.background = b; $('na').textContent = $('ha').textContent = pal[ci[0]].n; $('nb').textContent = $('hb').textContent = pal[ci[1]].n;
  try { localStorage.setItem('bs-colors', JSON.stringify(ci)); } catch (e) {}
}
function cycle(side) { let n = ci[side]; do n = (n + 1) % pal.length; while (n === ci[1 - side]); ci[side] = n; applyColors(); }
const cmdr = new Commander({ camera, canvas, fly, getSim: () => sim, onMode: (on) => { if (on) hint.classList.add('off'); } });
G.cmdr = cmdr;
function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

const qf = (qs.get('form') || '').split(',');
const form = [0, 1].map((i) => (FORMATIONS[qf[i] || qf[0]] ? qf[i] || qf[0] : 'block'));
let starting = 0;
async function start(n) {
  perSide = n; const ticket = ++starting; if (sim && sim.terminate) sim.terminate(); sim = null; if (battle) battle.dispose();
  if (flags) flags.dispose(); flags = null; scene.clear(); const opts = { perSide: n, seed: +qs.get('seed') || 1, terrain: look.terrain, formations: form.slice() };
  const useWorker = self.crossOriginIsolated && typeof Worker !== 'undefined' && !testMode && !qs.has('sync');
  const s = useWorker ? await new RemoteSim(opts).ready : new Sim(opts); if (ticket !== starting) return; sim = s; cmdr.ids = []; cmdr.dest = null; cmdr.refresh(); audio.reset(); G.hornedEnd = false; G.worker = useWorker; battle = new Battlefield(scene, sim, look);
  battle.setQuality(coarse ? 0.35 : 1); flags = new Standards(scene, sim, cols(), reduced); applyColors();
  G.sim = sim; G.battle = battle; if (sim.setSpeed) sim.setSpeed(speed); $('banner').style.display = 'none';
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
for (const [id, i] of [['fa', 0], ['fb', 1]]) { const el = $(id); el.innerHTML = FORMATION_KEYS.map((k) => `<option value="${k}">${FORMATIONS[k].name}</option>`).join(''); el.value = form[i]; el.title = 'Formation (applies on restart)'; el.addEventListener('change', () => { form[i] = el.value; start(perSide); }); }
sel.addEventListener('change', () => start(+sel.value));
for (const [id, set, key] of [['terrain', TERRAINS, 'terrain'], ['weather', WEATHERS, 'weather'], ['time', TIMES, 'time']]) {
  const el = $(id); el.innerHTML = Object.entries(set).map(([k, v]) => `<option value="${k}">${v}</option>`).join(''); el.value = look[key];
  el.addEventListener('change', () => { look[key] = el.value; if (key === 'terrain') start(perSide); else battle.setLook(look.time, look.weather); });
}
const pauseBtn = $('pause'), muteBtn = $('mute');
function setPaused(p) { G.paused = p; audio.setPaused(p); if (sim && sim.setPaused) sim.setPaused(p); pauseBtn.setAttribute('aria-pressed', p); pauseBtn.textContent = p ? 'Resume' : 'Pause'; }
function setMuted(m) { audio.setMuted(m); muteBtn.setAttribute('aria-pressed', m); muteBtn.textContent = m ? 'Sound off' : 'Sound on'; }
pauseBtn.onclick = () => setPaused(!G.paused); muteBtn.onclick = () => setMuted(!audio.muted); $('colA').onclick = () => cycle(0); $('colB').onclick = () => cycle(1);
const panel = $('panel'), statsBtn = $('statsBtn'); let showStats = true;
function setStats(v) { showStats = v; panel.hidden = !v; statsBtn.setAttribute('aria-pressed', v); }
statsBtn.onclick = () => setStats(!showStats); setStats(true);
$('restart').onclick = () => start(perSide);
const SPEEDS = [1, 2, 4, 8], ffBtn = $('ff'); let speed = 1;
function setSpeed(v) { speed = v; ffBtn.textContent = v + '×'; ffBtn.setAttribute('aria-pressed', v > 1); if (sim && sim.setSpeed) sim.setSpeed(v); G.speed = v; }
ffBtn.onclick = () => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]);
const cineBtn = $('cine'), replayBtn = $('replay'), camstat = $('camstat'), cview = $('cview'), cspeed = $('cspeed');
const sideName = (t) => pal[ci[t]].n;
dir.onChange = () => {
  cineBtn.setAttribute('aria-pressed', dir.mode === 'cine'); replayBtn.setAttribute('aria-pressed', dir.replaying);
  const f = dir.mode === 'follow', r = dir.replaying; camstat.style.display = dir.active || r ? 'flex' : 'none';
  $('ctext').textContent = (r ? 'REPLAY · ' : '') + (f ? `Following ${sideName(sim.team[dir.target])} soldier` : dir.mode === 'cine' ? 'Cinematic camera' : 'Free camera');
  cview.style.display = f ? '' : 'none'; cview.textContent = dir.view === 'chase' ? 'First person' : 'Chase view'; cspeed.style.display = r ? '' : 'none'; cspeed.textContent = `${dir.speed}× speed`;
  $('cfree').textContent = r ? 'Exit replay' : 'Free cam';
};
cineBtn.onclick = () => dir.setMode(dir.mode === 'cine' ? 'free' : 'cine');
replayBtn.onclick = () => (dir.replaying ? dir.stopReplay() : dir.startReplay() || flash('Not enough battle recorded yet'));
cview.onclick = () => dir.toggleView(); cspeed.onclick = () => dir.cycleSpeed();
$('cfree').onclick = () => (dir.replaying ? dir.stopReplay() : dir.setMode('free'));
const camSrc = () => (dir.replaying ? dir.rsim : sim);
function flash(t) { hint.textContent = t; hint.classList.remove('off'); clearTimeout(flash.t); flash.t = setTimeout(() => hint.classList.add('off'), 2200); }
function followAt(px, py, reach) { const i = dir.pick(camSrc(), px, py, innerWidth, innerHeight, reach); if (i >= 0) { dir.follow(i, camSrc()); return true; } return false; }
let tap = null;
canvas.addEventListener('pointerdown', (e) => { tap = e.isPrimary && !cmdr.on ? { x: e.clientX, y: e.clientY, t: performance.now() } : null; });
canvas.addEventListener('pointerup', (e) => {
  if (!tap || !e.isPrimary || !sim || cmdr.on) return; const m = Math.hypot(e.clientX - tap.x, e.clientY - tap.y), d = performance.now() - tap.t; tap = null;
  if (m > 8 || d > 450) return; const locked = document.pointerLockElement === canvas; followAt(locked ? innerWidth / 2 : e.clientX, locked ? innerHeight / 2 : e.clientY, locked ? 60 : e.pointerType === 'touch' ? 48 : 30);
});
const hint = $('hint'); let tut = 0;
const TUT = coarse
  ? ['Left pad: fly. Drag anywhere else: look.', '▲ ▼ change height. » is turbo.', '» is turbo. 1× / 2× speeds up the battle. Fly down to the front line.', 'Tap a soldier to follow them. Cinema and Replay are up top.']
  : ['Click to look around. WASD flies, Space / C up and down.', 'Shift is turbo. Mouse wheel changes speed.', 'Keys 1, 2, 3 jump to the field. Tab opens Command mode. F fast-forwards, P pauses, M sound.', 'Click a soldier to follow. G follows the one in the centre. V view, K cinema, Y replay, Esc free.'];
function showTut(i) { tut = i; if (i >= TUT.length) { hint.classList.add('off'); return; } hint.textContent = TUT[i]; hint.classList.remove('off'); }
$('help').onclick = () => { setCam('front'); showTut(0); tutT = 0; };
showTut(0); let tutT = 0, tutMoved = false;
addEventListener('keydown', (e) => {
  audio.start(); if (e.repeat) return;
  if (e.code === 'KeyP') setPaused(!G.paused); else if (e.code === 'KeyF') ffBtn.click(); else if (e.code === 'KeyM') setMuted(!audio.muted); else if (e.code === 'KeyT') setStats(!showStats); else if (e.code === 'KeyR') start(perSide); else if (e.code === 'KeyH') $('help').click();
  else if (e.code === 'KeyK') cineBtn.click(); else if (e.code === 'KeyY') replayBtn.click(); else if (e.code === 'KeyV' && dir.mode === 'follow') dir.toggleView();
  else if (e.code === 'KeyG') { if (!followAt(innerWidth / 2, innerHeight / 2, 400)) flash('No soldier in view'); } else if (e.code === 'Escape') $('cfree').click();
  else if (e.code === 'Digit1') setCam('front'); else if (e.code === 'Digit2') setCam('over'); else if (e.code === 'Digit3') setCam('ground');
});
addEventListener('pointerdown', () => { if (!audio.ctx && !audio.muted) audio.start(); }, { once: false });

// ---- loop
let ev = 0, last = performance.now(), fAcc = 0, fN = 0, statT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now; G.frame++;
  if (dir.active && dir.userTookOver()) { dir.stopReplay(); dir.setMode('free'); }
  runSweep(dt); if (!dir.active) fly.update(dt); if (!sim) return;
  let alpha = 0;
  if (!G.paused && !G.manual) alpha = sim.advance(dt, speed); else alpha = G.manual ? 0 : sim.acc / sim.TICK;
  if (!G.paused) dir.rec.record(sim, dt);
  const rs = dir.update(dt, sim, alpha); battle.sim = rs || sim; battle.update(camera, rs ? 0 : alpha); battle.sim = sim; if (flags) { flags.update(dt, now / 1000, alpha); }
  cmdr.draw(reduced);
  renderer.render(scene, camera);
  fAcc += dt; fN++;
  if (fAcc > 0.5) { G.fps = fN / fAcc; fAcc = 0; fN = 0; adapt(); }
  if ((statT += dt) > 0.25) { statT = 0; hud(); cmdr.tick(); }
  // audio
  if (audio.ctx && !audio.muted && !G.paused) {
    const hs = sim.hitEvents; ev = ev * 0.97 + hs.length * 0.03; // smoothed fight rate
    if (hs.length && !audio.hornedStart) { audio.hornedStart = true; const f = sim.world * 0.1; audio.horn(-f, -90, camera, 0); audio.horn(f, 90, camera, 3); }
    const w = sim.winner(); if (w >= 0 && !G.hornedEnd) { G.hornedEnd = true; audio.horn(0, w === 0 ? -80 : 80, camera, 7); }
    audio.update(camera, hs, Math.min(1, battle.counts.near / 300 + 0.1), Math.min(1, ev / 10 + 0.1), dt);
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
  if (flags) flags.refresh();
  const al = sim.alive, de = sim.deaths, P = sim.perSide, t = (id, v) => ($(id).textContent = v.toLocaleString());
  t('sa', al[0]); t('sb', al[1]); t('ka', de[1]); t('kb', de[0]); t('xa', de[0]); t('xb', de[1]);
  $('pa').textContent = Math.round((al[0] / P) * 100) + '%'; $('pb').textContent = Math.round((al[1] / P) * 100) + '%';
  const tot = al[0] + al[1] || 1; $('bara').style.width = (al[0] / tot) * 100 + '%'; $('barb').style.width = (al[1] / tot) * 100 + '%';
  const w = sim.winner(); const bn = $('banner'); if (w >= 0) { bn.style.display = 'block'; bn.textContent = `${pal[ci[w]].n} holds the field`; } else bn.style.display = 'none';
}
G.step = (ticks = 1) => { if (!G.worker) for (let i = 0; i < ticks; i++) sim.tick(sim.TICK); };
G.draw = () => { battle.update(camera, 0); renderer.render(scene, camera); };
G.dir = dir; G.renderer = renderer; G.setCam = setCam; G.restart = start; G.setPaused = setPaused; G.fly = fly; G.camera = camera;
G.look = look; G.setLook = (o) => { Object.assign(look, o); battle.setLook(look.time, look.weather); };
G.manual = qs.has('manual');
start(perSide); setMuted(true);
G.ready = true;
requestAnimationFrame(frame);
