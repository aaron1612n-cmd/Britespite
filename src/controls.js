import * as THREE from 'three';
import { heightAt } from './terrain.js';

export class FlyCam {
  constructor(camera, dom) {
    this.cam = camera; this.dom = dom; this.pos = camera.position; this.yaw = 0; this.pitch = 0; this.vel = new THREE.Vector3();
    this.keys = new Set(); this.stick = { x: 0, y: 0 }; this.climb = 0; this.fast = false; this.speed = 40; this.moved = false; this.locked = false; this.input = false;
    const d = dom, kb = (e, down) => { const k = e.code; if (['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE','Space','KeyC','ShiftLeft','ShiftRight','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ControlLeft'].includes(k)) { down ? this.keys.add(k) : this.keys.delete(k); if (down) this.touch(); e.preventDefault(); } };
    addEventListener('keydown', (e) => kb(e, true)); addEventListener('keyup', (e) => kb(e, false)); addEventListener('blur', () => this.keys.clear());
    d.addEventListener('wheel', (e) => { this.speed = Math.min(400, Math.max(5, this.speed * (e.deltaY < 0 ? 1.15 : 0.87))); this.touch(); e.preventDefault(); }, { passive: false });
    d.addEventListener('click', () => { if (matchMedia('(pointer:fine)').matches && d.requestPointerLock) d.requestPointerLock(); });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === d; });
    this.ptr = new Map(); const stickEl = document.getElementById('stick'), knob = document.getElementById('knob');
    d.addEventListener('pointerdown', (e) => { d.setPointerCapture(e.pointerId); this.ptr.set(e.pointerId, { x: e.clientX, y: e.clientY, mode: e.pointerType === 'touch' ? 'look' : 'drag' }); });
    stickEl.addEventListener('pointerdown', (e) => { e.stopPropagation(); stickEl.setPointerCapture(e.pointerId); this.ptr.set(e.pointerId, { mode: 'stick' }); this.stickMove(e, stickEl, knob); });
    stickEl.addEventListener('pointermove', (e) => { const p = this.ptr.get(e.pointerId); if (p && p.mode === 'stick') this.stickMove(e, stickEl, knob); });
    const endS = (e) => { if (this.ptr.get(e.pointerId)?.mode === 'stick') { this.ptr.delete(e.pointerId); this.stick.x = this.stick.y = 0; knob.style.transform = ''; } };
    stickEl.addEventListener('pointerup', endS); stickEl.addEventListener('pointercancel', endS);
    d.addEventListener('pointermove', (e) => {
      if (this.locked) { this.look(e.movementX, e.movementY, 0.0022); return; }
      const p = this.ptr.get(e.pointerId); if (!p) return; if (p.mode === 'drag' && !(e.buttons & 1) && !(e.buttons & 2)) return;
      this.look(e.clientX - p.x, e.clientY - p.y, p.mode === 'look' ? 0.0045 : 0.0035); p.x = e.clientX; p.y = e.clientY;
    });
    const end = (e) => this.ptr.delete(e.pointerId); d.addEventListener('pointerup', end); d.addEventListener('pointercancel', end);
    d.addEventListener('contextmenu', (e) => e.preventDefault());
    const hold = (id, on, off) => { const el = document.getElementById(id); el.addEventListener('pointerdown', (e) => { e.stopPropagation(); el.setPointerCapture(e.pointerId); on(el); this.touch(); }); const u = () => off(el); el.addEventListener('pointerup', u); el.addEventListener('pointercancel', u); };
    hold('up', () => (this.climb = 1), () => (this.climb = 0)); hold('down', () => (this.climb = -1), () => (this.climb = 0));
    const fb = document.getElementById('fast'); fb.addEventListener('click', () => { this.fast = !this.fast; fb.setAttribute('aria-pressed', this.fast); });
    this.apply();
  }
  touch() { this.input = true; }
  stickMove(e, el, knob) { const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2; let x = (e.clientX - cx) / (r.width / 2), y = (e.clientY - cy) / (r.height / 2); const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; } this.stick.x = x; this.stick.y = y; knob.style.transform = `translate(${x * 38}px,${y * 38}px)`; this.touch(); }
  look(dx, dy, k) { this.yaw -= dx * k; this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - dy * k)); this.touch(); }
  lookAt(px, py, pz, tx, ty, tz) { this.pos.set(px, py, pz); const dx = tx - px, dy = ty - py, dz = tz - pz; this.yaw = Math.atan2(-dx, -dz); this.pitch = Math.atan2(dy, Math.hypot(dx, dz)); this.apply(); }
  apply() { this.cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ'); }
  update(dt) {
    const k = this.keys, f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - this.stick.y;
    const s = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) + this.stick.x;
    const u = (k.has('Space') || k.has('KeyE') ? 1 : 0) - (k.has('KeyC') || k.has('KeyQ') || k.has('ControlLeft') ? 1 : 0) + this.climb;
    const boost = k.has('ShiftLeft') || k.has('ShiftRight') || this.fast ? 4 : 1, sp = this.speed * boost;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw), cp = Math.cos(this.pitch), sp2 = Math.sin(this.pitch);
    const target = new THREE.Vector3(-sy * cp * f + cy * s, sp2 * f + u, -cy * cp * f - sy * s);
    if (target.lengthSq() > 1) target.normalize(); target.multiplyScalar(sp);
    this.vel.lerp(target, 1 - Math.exp(-8 * dt)); this.pos.addScaledVector(this.vel, dt);
    const gy = heightAt(this.pos.x, this.pos.z) + 1.6; if (this.pos.y < gy) { this.pos.y = gy; if (this.vel.y < 0) this.vel.y = 0; }
    if (this.pos.y > 1500) this.pos.y = 1500; this.apply();
  }
}
