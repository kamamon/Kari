// 生成物（npm run monsters:art = tools/monster-art.py）。手で編集しない。
// 原画の、体へ貼るために切り出した範囲（原画の px）。crop = 絵に入れた範囲、bbox = 体の形を囲む四角。
export interface CreatureArt {
  file: string;
  crop: [number, number, number, number];
  bbox: [number, number, number, number];
  /** 体の色の平均（0〜1。絵が読み込まれるまでの色） */
  average: [number, number, number];
}

export const CREATURE_ART: Record<string, CreatureArt> = {
  selvark: { file: 'assets/textures/monsters/selvark_side_v1.webp', crop: [26, 0, 1338, 1019], bbox: [42, 12, 1322, 1003], average: [0.547, 0.458, 0.328] },
  numeradon: { file: 'assets/textures/monsters/numeradon_side_v1.webp', crop: [13, 140, 1522, 899], bbox: [29, 156, 1506, 883], average: [0.485, 0.361, 0.221] },
  bornakel: { file: 'assets/textures/monsters/bornakel_side_v1.webp', crop: [21, 64, 1501, 970], bbox: [37, 80, 1485, 954], average: [0.528, 0.368, 0.251] },
  ashreia: { file: 'assets/textures/monsters/ashreia_side_v1.webp', crop: [61, 0, 1311, 1024], bbox: [77, 13, 1295, 1009], average: [0.452, 0.389, 0.341] },
  lumisca: { file: 'assets/textures/monsters/lumisca_side_v1.webp', crop: [8, 64, 1495, 972], bbox: [24, 80, 1479, 956], average: [0.438, 0.388, 0.290] },
  orglass: { file: 'assets/textures/monsters/orglass_side_v1.webp', crop: [8, 32, 1524, 987], bbox: [24, 48, 1508, 971], average: [0.490, 0.454, 0.379] },
  tengaro: { file: 'assets/textures/monsters/tengaro_side_v1.webp', crop: [42, 3, 1468, 992], bbox: [58, 19, 1452, 976], average: [0.478, 0.274, 0.187] },
  verito: { file: 'assets/textures/monsters/verito_side_v1.webp', crop: [31, 13, 1536, 982], bbox: [47, 29, 1528, 966], average: [0.647, 0.483, 0.536] },
  razmer: { file: 'assets/textures/monsters/razmer_side_v1.webp', crop: [12, 251, 1756, 739], bbox: [28, 267, 1740, 723], average: [0.455, 0.353, 0.251] },
  kirisave: { file: 'assets/textures/monsters/kirisave_side_v1.webp', crop: [12, 231, 1767, 650], bbox: [28, 247, 1751, 634], average: [0.470, 0.542, 0.583] },
  velgait: { file: 'assets/textures/monsters/velgait_side_v1.webp', crop: [15, 1, 1456, 1009], bbox: [31, 17, 1440, 993], average: [0.396, 0.337, 0.281] },
  galdros: { file: 'assets/textures/monsters/galdros_side_v1.webp', crop: [28, 115, 1632, 812], bbox: [44, 131, 1616, 796], average: [0.463, 0.397, 0.332] },
};
