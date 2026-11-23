// Bone layout. Pivots are bind-pose world positions (metres, character faces +Z, left = +X).
export const B = { PELVIS: 0, CHEST: 1, HEAD: 2, UARM_L: 3, FARM_L: 4, UARM_R: 5, FARM_R: 6,
  THIGH_L: 7, SHIN_L: 8, THIGH_R: 9, SHIN_R: 10, FOOT_L: 11, FOOT_R: 12, SPEAR: 13 };
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
];
export const NB = BONES.length;
export const THIGH_LEN = 0.46, SHIN_LEN = 0.44, ANKLE_Y = 0.08;
export const MAT = { SKIN: 0, TUNIC: 1, BRONZE: 2, WOOD: 3, LEATHER: 4, ACCENT: 5, EYE: 6, HAIR: 7, TAN: 8, GOLD: 9 };
