// 断岳剣（里鍛ちの断岳剣）の仮モデル（2 代目）。設定図（art-source/weapon/weapon_dangaku_{front,side}_v1.png）の
// 輪郭を測った寸法で形を組み、正面の図をそのまま両面へ貼る。コードで組んだ仮素材で、正式モデル（GLB）の差し替え口。
// 原点は握り位置、+Y が刃先、X が厚み、Z が刃幅（-Z が刃、+Z が峰）。単位 m。
// 当たり判定（握りから 0.30〜1.75m、半径 0.20m）は変えていない。刃は 0.33〜1.795m、幅 0.33m。
import { Group } from 'three';
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

export function buildHeavyBlade(): WeaponModel {
  const m = new ArtMesh(WEAPON_SHEETS.dangaku);
  addSingleEdgeSword(m, DIMS);
  const art: ArtStatus[] = [];
  const group = new Group();
  group.name = 'model.weapon.heavy_blade.001';
  group.add(m.build('heavy_blade_body', art));
  return { group, art, triangles: m.triangles };
}
