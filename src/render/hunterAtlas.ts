// tools/export-hunter-atlas.mjs が書き出す（手で直さない）。
// ハンターの体の絵（public/assets/textures/hunter/hunter_body_v1.webp）の中の、区画の位置（2048 四方に並べた時の px）。
export const HUNTER_ATLAS: { size: number; rects: Record<string, readonly [number, number, number, number]> } = {
  size: 2048,
  rects: {
    legL: [80, 8, 592, 782],
    legR: [608, 8, 1120, 782],
    torso: [1136, 8, 1947, 728],
    armL: [8, 798, 345, 1406],
    armR: [361, 798, 698, 1406],
    head: [714, 798, 2039, 1393],
    skirt: [8, 1422, 1050, 1694],
    footL: [1066, 1422, 1367, 1670],
    footR: [1383, 1422, 1684, 1670],
    mantle: [8, 1710, 1215, 1942],
  },
};
