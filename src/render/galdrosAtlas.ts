// tools/export-galdros-mesh.mjs が書き出す（手で直さない）。
// ガルドロスの皮の絵（public/assets/textures/galdros/galdros_hide_v1.webp）の中の、区画の位置 (px)。
export const GALDROS_ATLAS: { size: number; rects: Record<string, readonly [number, number, number, number]> } = {
  size: 2048,
  rects: {
    body: [80, 8, 1089, 504],
    head: [8, 520, 1209, 993],
    leg0: [1225, 520, 1935, 843],
    leg1: [8, 1009, 704, 1328],
    leg3: [720, 1009, 1359, 1320],
    leg2: [1375, 1009, 2038, 1317],
    foot1: [8, 1344, 472, 1611],
    foot0: [488, 1344, 956, 1611],
    foot3: [972, 1344, 1417, 1606],
    foot2: [1433, 1344, 1878, 1606],
    tailTip: [8, 1627, 381, 1847],
    jaw: [397, 1627, 824, 1832],
    tailBase: [840, 1627, 1512, 1828],
    lump2: [1528, 1627, 1858, 1786],
    lump1: [8, 1863, 334, 2020],
    lump0: [350, 1863, 675, 2020],
    lump3: [691, 1863, 1016, 2020],
  },
};
