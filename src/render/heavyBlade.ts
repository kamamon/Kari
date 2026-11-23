// 断岳剣（里鍛ちの断岳剣）の仮モデル（2 代目）。設定図（art-source/weapon/weapon_dangaku_{front,side}_v1.png）の
// 輪郭を測った寸法で形を組み、正面の図をそのまま両面へ貼る。コードで組んだ仮素材で、正式モデル（GLB）の差し替え口。
// 原点は握り位置、+Y が刃先、X が厚み、Z が刃幅（-Z が刃、+Z が峰）。単位 m。
// 当たり判定（握りから 0.30〜1.75m、半径 0.20m）は変えていない。刃は 0.33〜1.795m、幅 0.33m。
import { BoxGeometry, Group, Mesh, MeshLambertMaterial } from 'three';
import { shellMaterials } from './shellPlates';
import { addSingleEdgeSword, ArtMesh, type ArtStatus, type SwordDims } from './artMesh';
import { WEAPON_SHEETS } from './weaponSheets';

export interface WeaponModel {
  group: Group;
  /** 設定図から作った絵（1 枚ごと）の読み込みが終わったか / 失敗したか */
  art: ArtStatus[];
  triangles: number;
}

/** 設定図を測った寸法（全長 1.95m、刃 1.47m・幅 0.33m・厚み 約 4.4cm） */
const DIMS: SwordDims = {
  y0: 0.331,
  tip: [1.795, -0.155],
  spineTopY: 1.559,
  zEdge: -0.166,
  zSpine: 0.163,
  T: 0.022,
  TS: 0.015,
  bevelEdge: 0.036,
  bevelSlant: 0.024,
  bevelSpine: 0.012,
  langet: { y1: 0.435, halfW: 0.037, proud: 0.006 },
  guard: { y0: 0.28, z0: -0.199, z1: 0.202, halfT: 0.034 },
  turned: [
    [[0.234, 0.04, 0.04], [0.279, 0.05, 0.052]], // 口金
    [[-0.091, 0.036, 0.04], [0.234, 0.036, 0.04]], // 握り（設定図より少し細い。手の大きさに合わせた）
    [[-0.155, 0.03, 0.03], [-0.143, 0.048, 0.05], [-0.097, 0.048, 0.05], [-0.091, 0.042, 0.044]], // 柄頭
  ],
};

/** 岩殻の断岳剣（強化後）に足す、岩の板の位置（握りからの高さ m、高さ、峰からの張り出し、傾き）。設定図は無く、仮の形。 */
const SHELL_PLATES: [y: number, h: number, out: number, tilt: number][] = [
  [0.5, 0.2, 0.05, 0.1],
  [0.74, 0.24, 0.065, -0.07],
  [1.01, 0.22, 0.055, 0.08],
  [1.26, 0.2, 0.04, -0.05],
];

/**
 * 断岳剣の仮モデル。variant を 'shell' にすると、峰に岩の板と青銅色の留め帯を足した「岩殻の断岳剣」になる
 * （設定図が無いので、単色の箱を足しただけの仮の形。当たり判定は同じ）。
 */
export function buildHeavyBlade(variant: 'base' | 'shell' = 'base', tier = 2): WeaponModel {
  const m = new ArtMesh(WEAPON_SHEETS.dangaku);
  addSingleEdgeSword(m, DIMS);
  const art: ArtStatus[] = [];
  const group = new Group();
  group.name = variant === 'shell' ? `model.weapon.heavy_blade.00${tier}` : 'model.weapon.heavy_blade.001';
  group.add(m.build('heavy_blade_body', art));
  let triangles = m.triangles;
  if (variant === 'shell') {
    // 段（2 = 岩殻 … 5 = 輝殻）で板の色が変わる。色の表は shellPlates.ts
    const { rock, rockDark, band: bronze, scale } = shellMaterials(tier);
    SHELL_PLATES.forEach(([y, h0, out, tilt], i) => {
      const h = h0 * scale;
      // 峰（+Z）へかぶせる岩の板。刃の厚みより少し厚く、峰から外へ張り出す
      const plate = new Mesh(new BoxGeometry(0.062, h, 0.11 + out), i % 2 ? rockDark : rock);
      plate.position.set(0, y, DIMS.zSpine - 0.055 + (0.11 + out) / 2);
      plate.rotation.x = tilt;
      plate.castShadow = true;
      // 板を留める青銅色の帯（刃の両面へ回る）
      const band = new Mesh(new BoxGeometry(0.07, 0.022, 0.2), bronze);
      band.position.set(0, y - h * 0.3, DIMS.zSpine - 0.08);
      band.rotation.x = tilt;
      group.add(plate, band);
      triangles += 24;
    });
  }
  return { group, art, triangles };
}
