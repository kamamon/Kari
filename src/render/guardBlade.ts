// 護刃（里鍛ちの護刃）の剣と盾の仮モデル。設定図（art-source/weapon/weapon_gojin_*_v1.png）の輪郭を測った寸法で
// 形を組み、図をそのまま貼る。まだゲームには出ない（武器としての実装は未着手。素材ビューアで見られる）。
import { Group } from 'three';
import { addSingleEdgeSword, ArtMesh, type ArtStatus, type SwordDims } from './artMesh';
import type { WeaponModel } from './heavyBlade';
import { buildPlankShield } from './shield';
import { GOJIN_SHIELD_OUTLINE, WEAPON_SHEETS } from './weaponSheets';

/**
 * 剣。原点は握りの中央、+Y が刃先、-Z が刃、+Z が峰。
 * 設定図を測った寸法: 全長 1.0m、刃 0.75m（握りから 0.128〜0.878m）、幅 7.8cm、厚み 約 1.1cm。
 */
const SWORD: SwordDims = {
  y0: 0.1278,
  tip: [0.8776, -0.031],
  spineTopY: 0.8126,
  zEdge: -0.0387,
  zSpine: 0.0387,
  T: 0.0055,
  TS: 0.004,
  bevelEdge: 0.012,
  bevelSlant: 0.008,
  bevelSpine: 0.004,
  langet: { y1: 0.181, halfW: 0.018, proud: 0.003 },
  guard: { y0: 0.103, z0: -0.0596, z1: 0.0604, halfT: 0.02 },
  turned: [
    [[0.0767, 0.0205, 0.0205], [0.1015, 0.0255, 0.0255]],
    [[-0.0767, 0.0195, 0.0205], [0.0767, 0.0195, 0.0205]],
    [[-0.1224, 0.018, 0.018], [-0.114, 0.0255, 0.0267], [-0.082, 0.0255, 0.0267], [-0.0767, 0.022, 0.0225]],
  ],
};

export function buildGuardBladeSword(): WeaponModel {
  const m = new ArtMesh(WEAPON_SHEETS.gojinSword);
  addSingleEdgeSword(m, SWORD);
  const art: ArtStatus[] = [];
  const group = new Group();
  group.name = 'model.weapon.guard_blade.001.sword';
  group.add(m.build('guard_blade_sword', art));
  return { group, art, triangles: m.triangles };
}

/**
 * 盾。高さ 0.6m、幅 0.47m。前へ丸くふくらむ（真横の図で、中央が約 3cm 前に出る）。板と縁の厚み 約 2.4cm。
 * 原点は裏面の中央、+Z が表。組み方は shield.ts。
 */
export function buildGuardBladeShield(): WeaponModel {
  return buildPlankShield('model.weapon.guard_blade.001.shield', WEAPON_SHEETS.gojinShieldFront, WEAPON_SHEETS.gojinShieldBack, GOJIN_SHIELD_OUTLINE, { bulge: 0.034, thick: 0.024, halfW: 0.2345, halfH: 0.3 });
}
