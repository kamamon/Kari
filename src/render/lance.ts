// 長尖槍（里鍛ちの長尖槍）の槍と大盾の仮モデル。設定図（art-source/weapon/weapon_chosenso_*_v1.png）の輪郭を測った寸法で
// 形を組み、図をそのまま貼る。v0.4.0 からゲーム内で使う。
import { Group } from 'three';
import { ArtMesh, type ArtStatus } from './artMesh';
import type { WeaponModel } from './heavyBlade';
import { buildPlankShield } from './shield';
import { CHOSENSO_LANCE, CHOSENSO_SHIELD_OUTLINE, WEAPON_SHEETS } from './weaponSheets';

/** 穂先と口金の境の高さ（握りの中央から）。これより上は、ひし形の断面の穂先 */
const HEAD_FROM = 1.73;

/**
 * 槍。原点は革巻きの握りの中央、+Y が穂先。全長 2.9m（石突 -0.54m 〜 穂先 2.36m）。
 * 穂先は長さ 約 0.63m、幅 約 5.6cm、厚み 約 2cm のひし形。柄の太さ 約 5cm。口金の上に小さな鍔（幅 約 10cm）。
 * 幅は正面の図、厚みは真横の図から、高さごとに測った。
 */
export function buildLance(): WeaponModel {
  const m = new ArtMesh(WEAPON_SHEETS.chosensoLance);
  const ring = ([y, halfFront, halfSide]: readonly [number, number, number]) => ({ y, cz: 0, rx: halfSide, rz: halfFront, czArt: 0, rArt: halfFront });
  const split = CHOSENSO_LANCE.findIndex((s) => s[0] < HEAD_FROM);
  m.sweep(CHOSENSO_LANCE.slice(0, split + 1).map(ring), 4); // 穂先（ひし形）
  m.sweep(CHOSENSO_LANCE.slice(split).map(ring), 12); // 口金・鍔・柄・握り・石突
  const art: ArtStatus[] = [];
  const group = new Group();
  group.name = 'model.weapon.long_lance.001.lance';
  group.add(m.build('long_lance_lance', art));
  return { group, art, triangles: m.triangles };
}

/**
 * 大盾。寸法は依頼の指定を優先する: 高さ 1.1m、幅 0.6m、縁の厚み 約 3cm（図は幅が約 0.585m と少し細いので、幅だけを広げる）。
 * 原点は裏面の中央、+Z が表。組み方は shield.ts（護刃の盾と同じ）。
 */
export function buildGreatShield(): WeaponModel {
  return buildPlankShield('model.weapon.long_lance.001.shield', WEAPON_SHEETS.chosensoShieldFront, WEAPON_SHEETS.chosensoShieldBack, CHOSENSO_SHIELD_OUTLINE, {
    bulge: 0.04,
    thick: 0.03,
    halfW: 0.2925,
    halfH: 0.55,
    xScale: 0.6 / 0.585,
    // 護刃の盾と同じく、裏は左右を逆にして使う（左腕に通せる並び）
    handle: { x: -0.115, y0: 0.175, y1: -0.11, r: 0.018, off: 0.04 },
    strap: { x: 0.102, y0: 0.175, y1: -0.115, w: 0.09, off: 0.075 },
  });
}
