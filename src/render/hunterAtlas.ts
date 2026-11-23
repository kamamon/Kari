// tools/export-hunter-atlas.mjs が書き出す（手で直さない）。
// ハンターの体の絵（public/assets/textures/hunter/hunter_body_v1.webp）の中の、区画の位置（2048 四方に並べた時の px）。
export const HUNTER_ATLAS: { size: number; rects: Record<string, readonly [number, number, number, number]> } = {
  size: 2048,
  rects: {
    legL: [80, 8, 611, 810],
    legR: [627, 8, 1158, 810],
    torso: [1174, 8, 2014, 754],
    armL: [8, 826, 357, 1456],
    armR: [373, 826, 722, 1456],
    head: [738, 826, 2040, 1441],
    skirt: [8, 1472, 1088, 1754],
    footL: [1104, 1472, 1415, 1729],
    footR: [1431, 1472, 1742, 1729],
    mantle: [8, 1770, 1259, 2011],
  },
};
