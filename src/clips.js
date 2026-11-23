// Clip metadata shared by the baker, renderer and sim (no three.js here).
export const CLIP = { IDLE: 0, WALK: 1, RUN: 2, ATTACK: 3, HIT: 4, DIE_BACK: 5, DIE_FWD: 6 };
export const CLIPS = [
  { name: 'idle', dur: 2.4, loop: true, fps: 12 },
  { name: 'walk', dur: 0.8, loop: true, fps: 24, speed: 1.4 },
  { name: 'run', dur: 0.62, loop: true, fps: 30, speed: 3.6 },
  { name: 'attack', dur: 0.85, loop: false, fps: 30, hit: 0.4 },
  { name: 'hit', dur: 0.45, loop: false, fps: 30 },
  { name: 'dieBack', dur: 1.5, loop: false, fps: 30 },
  { name: 'dieFwd', dur: 1.5, loop: false, fps: 30 },
];
export function frameCount(c) { return c.loop ? Math.round(c.dur * c.fps) : Math.round(c.dur * c.fps) + 1; }
