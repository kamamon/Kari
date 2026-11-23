// tools/export-hunter-atlas.mjs が書き出す（手で直さない）。
// ハンターの体の絵（public/assets/textures/hunter/hunter_body_v1.webp）の中の、区画の位置（2048 四方に並べた時の px）。
export const HUNTER_ATLAS: { size: number; rects: Record<string, readonly [number, number, number, number]> } = {
  size: 2048,
  rects: {
    legL: [80, 8, 592, 782],
    legR: [608, 8, 1120, 782],
    torso: [1136, 8, 1947, 711],
    head: [8, 798, 1333, 1412],
    armL: [1349, 798, 1686, 1406],
    armR: [1702, 798, 2039, 1406],
    mantle: [8, 1428, 1177, 1703],
    skirt: [8, 1719, 1036, 1991],
    footL: [1052, 1719, 1353, 1967],
    footR: [1369, 1719, 1670, 1967],
  },
};
