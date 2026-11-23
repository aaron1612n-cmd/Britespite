// Clip metadata shared by the baker, renderer and sim (no three.js here).
export const CLIP = { IDLE: 0, WALK: 1, RUN: 2, ATTACK: 3, HIT: 4, DIE_BACK: 5, DIE_FWD: 6, SHOOT: 7, THROW: 8, CHEER: 9 };
// Mounted clips sit CAV slots above their foot counterparts (idle/walk/run=gallop/attack=thrust/hit/die*/cheer=rear); trot + charge take the shoot/throw slots.
export const CAV = 10, CAV_TROT = CAV + 7, CAV_CHARGE = CAV + 8;
export const CLIPS = [
  { name: 'idle', dur: 2.4, loop: true, fps: 12 },
  { name: 'walk', dur: 0.8, loop: true, fps: 24, speed: 1.4 },
  { name: 'run', dur: 0.62, loop: true, fps: 30, speed: 3.6 },
  { name: 'attack', dur: 0.85, loop: false, fps: 30, hit: 0.4 },
  { name: 'hit', dur: 0.45, loop: false, fps: 30 },
  { name: 'dieBack', dur: 1.5, loop: false, fps: 30 },
  { name: 'dieFwd', dur: 1.5, loop: false, fps: 30 },
  { name: 'shoot', dur: 1.1, loop: false, fps: 30, hit: 0.55 },
  { name: 'throw', dur: 0.85, loop: false, fps: 30, hit: 0.42 },
  { name: 'cheer', dur: 1.2, loop: true, fps: 24 },
  { name: 'c-idle', dur: 3.0, loop: true, fps: 12, cav: true },
  { name: 'c-walk', dur: 1.0, loop: true, fps: 24, speed: 1.5, cav: true },
  { name: 'c-gallop', dur: 0.56, loop: true, fps: 60, speed: 5.8, cav: true },
  { name: 'c-thrust', dur: 0.8, loop: false, fps: 30, hit: 0.34, cav: true },
  { name: 'c-hit', dur: 0.5, loop: false, fps: 30, cav: true },
  { name: 'c-dieBack', dur: 1.6, loop: false, fps: 30, cav: true },
  { name: 'c-dieFwd', dur: 1.6, loop: false, fps: 30, cav: true },
  { name: 'c-trot', dur: 0.6, loop: true, fps: 30, speed: 3.6, cav: true },
  { name: 'c-charge', dur: 0.48, loop: true, fps: 60, speed: 7.6, cav: true },
  { name: 'c-rear', dur: 1.4, loop: true, fps: 24, cav: true },
];
export function frameCount(c) { return c.loop ? Math.round(c.dur * c.fps) : Math.round(c.dur * c.fps) + 1; }
