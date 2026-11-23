// Bone layout. Pivots are bind-pose world positions (metres, character faces +Z, left = +X).
export const B = { PELVIS: 0, CHEST: 1, HEAD: 2, UARM_L: 3, FARM_L: 4, UARM_R: 5, FARM_R: 6,
  THIGH_L: 7, SHIN_L: 8, THIGH_R: 9, SHIN_R: 10, FOOT_L: 11, FOOT_R: 12, SPEAR: 13,
  // horse (cavalry only; identity in every infantry clip). Legs: U = upper, L = cannon, H = pastern + hoof.
  RUMP: 14, FORE: 15, NECK: 16, HHEAD: 17, TAIL: 18,
  FL_U: 19, FL_L: 20, FL_H: 21, FR_U: 22, FR_L: 23, FR_H: 24, BL_U: 25, BL_L: 26, BL_H: 27, BR_U: 28, BR_L: 29, BR_H: 30 };
// Horse leg proportions (metres): front shoulder/knee, hind hip/hock, shared fetlock height, leg z positions.
export const HF = { shoulder: 1.2, knee: 0.62, hip: 1.24, hock: 0.64, fet: 0.2, fz: 0.5, bz: -0.65, hoof: 0.2 };
export const BONES = [
  { name: 'pelvis', parent: -1, pivot: [0, 1.0, 0] },
  { name: 'chest', parent: 0, pivot: [0, 1.16, 0] },
  { name: 'head', parent: 1, pivot: [0, 1.56, 0] },
  { name: 'uArmL', parent: 1, pivot: [0.21, 1.48, 0] },
  { name: 'fArmL', parent: 3, pivot: [0.21, 1.18, 0] },
  { name: 'uArmR', parent: 1, pivot: [-0.21, 1.48, 0] },
  { name: 'fArmR', parent: 5, pivot: [-0.21, 1.18, 0] },
  { name: 'thighL', parent: 0, pivot: [0.1, 0.98, 0] },
  { name: 'shinL', parent: 7, pivot: [0.1, 0.52, 0] },
  { name: 'thighR', parent: 0, pivot: [-0.1, 0.98, 0] },
  { name: 'shinR', parent: 9, pivot: [-0.1, 0.52, 0] },
  { name: 'footL', parent: 8, pivot: [0.1, 0.08, 0] },
  { name: 'footR', parent: 10, pivot: [-0.1, 0.08, 0] },
  { name: 'spear', parent: 6, pivot: [-0.21, 0.9, 0.04] },
  { name: 'rump', parent: -1, pivot: [0, 1.3, -0.3] },
  { name: 'fore', parent: 14, pivot: [0, 1.3, 0.25] },
  { name: 'neck', parent: 15, pivot: [0, 1.46, 0.8] },
  { name: 'hhead', parent: 16, pivot: [0, 2.08, 1.4] },
  { name: 'tail', parent: 14, pivot: [0, 1.56, -1.0] },
  ...[[0.2, 'FL'], [-0.2, 'FR']].flatMap(([x, n], k) => [
    { name: n + 'U', parent: 15, pivot: [x, HF.shoulder, HF.fz] }, { name: n + 'L', parent: 19 + k * 3, pivot: [x, HF.knee, HF.fz] }, { name: n + 'H', parent: 20 + k * 3, pivot: [x, HF.fet, HF.fz] }]),
  ...[[0.2, 'BL'], [-0.2, 'BR']].flatMap(([x, n], k) => [
    { name: n + 'U', parent: 14, pivot: [x, HF.hip, HF.bz] }, { name: n + 'L', parent: 25 + k * 3, pivot: [x, HF.hock, HF.bz] }, { name: n + 'H', parent: 26 + k * 3, pivot: [x, HF.fet, HF.bz] }]),
];
export const NB = BONES.length;
export const THIGH_LEN = 0.46, SHIN_LEN = 0.44, ANKLE_Y = 0.08;
export const MAT = { SKIN: 0, TUNIC: 1, BRONZE: 2, WOOD: 3, LEATHER: 4, ACCENT: 5, EYE: 6, HAIR: 7, TAN: 8, GOLD: 9, COAT: 10, MANE: 11, HOOF: 12, BLAZE: 13 };
