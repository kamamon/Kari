// tools/export-galdros-mesh.mjs が書き出す（手で直さない）。
// ガルドロスの皮の絵（public/assets/textures/galdros/galdros_hide_v1.webp）の中の、区画の位置 (px)。
export const GALDROS_ATLAS: { size: number; rects: Record<string, readonly [number, number, number, number]> } = {
  size: 2048,
  rects: {
    body: [80, 8, 1070, 512],
    head: [8, 528, 1230, 914],
    leg0: [1246, 528, 1964, 855],
    leg1: [8, 930, 712, 1253],
    leg3: [728, 930, 1373, 1244],
    leg2: [8, 1269, 678, 1581],
    foot1: [694, 1269, 1163, 1539],
    foot0: [1179, 1269, 1652, 1539],
    foot3: [8, 1597, 458, 1862],
    foot2: [474, 1597, 923, 1862],
    jaw: [939, 1597, 1322, 1764],
    lump2: [1338, 1597, 1671, 1757],
    tailBase: [8, 1878, 663, 2038],
    lump1: [679, 1878, 1008, 2037],
    lump0: [1024, 1878, 1353, 2036],
    lump3: [1369, 1878, 1698, 2036],
    tailTip: [1714, 1878, 2018, 2033],
  },
};
