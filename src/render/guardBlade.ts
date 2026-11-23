// 護刃（里鍛ちの護刃）の剣と盾の仮モデル。設定図（art-source/weapon/weapon_gojin_*_v1.png）の輪郭を測った寸法で
// 形を組み、図をそのまま貼る。まだゲームには出ない（武器としての実装は未着手。素材ビューアで見られる）。
import { Group } from 'three';
import { addSingleEdgeSword, ArtMesh, type ArtStatus, type P3, type SwordDims } from './artMesh';
import type { WeaponModel } from './heavyBlade';
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

/** 盾の寸法: 高さ 0.6m、幅 0.47m。前へ丸くふくらむ（真横の図で、中央が約 3cm 前に出る）。板と縁の厚み 約 2.4cm。 */
const SHIELD = { bulge: 0.034, thick: 0.024, halfW: 0.2345, halfH: 0.3, rings: 6, step: 0.03 };

/**
 * 盾。原点は裏面の中央（腕を当てる所）、+Z が表（敵の方）、+Y が上、+X は表から見て右。
 * 表は表の図、裏は裏の図（後ろから見た図なので左右を反転）を貼る。裏の取っ手と革帯は、まだ絵だけ（立体にしていない）。
 */
export function buildGuardBladeShield(): WeaponModel {
  const front = new ArtMesh(WEAPON_SHEETS.gojinShieldFront, 'xy');
  const back = new ArtMesh(WEAPON_SHEETS.gojinShieldBack, 'xy-back');
  // 外形の辺を細かく分ける
  const rim: [number, number][] = [];
  const n = GOJIN_SHIELD_OUTLINE.length;
  for (let i = 0; i < n; i++) {
    const p = GOJIN_SHIELD_OUTLINE[i]!, q = GOJIN_SHIELD_OUTLINE[(i + 1) % n]!;
    const parts = Math.max(1, Math.round(Math.hypot(q[0] - p[0], q[1] - p[1]) / SHIELD.step));
    for (let k = 0; k < parts; k++) rim.push([p[0] + ((q[0] - p[0]) * k) / parts, p[1] + ((q[1] - p[1]) * k) / parts]);
  }
  // ふくらみ: 中央がいちばん前。上下・左右の端で 3/4 ほど下がる
  const dome = (x: number, y: number): number => SHIELD.bulge * (1 - 0.75 * ((x / SHIELD.halfW) ** 2 + (y / SHIELD.halfH) ** 2));
  const zFront = (x: number, y: number): number => SHIELD.thick + dome(x, y) - SHIELD.bulge;
  const at = (p: readonly [number, number], k: number, z: (x: number, y: number) => number): P3 => {
    const x = (p[0] * k) / SHIELD.rings, y = (p[1] * k) / SHIELD.rings;
    return [x, y, z(x, y)];
  };
  const zBack = (x: number, y: number): number => zFront(x, y) - SHIELD.thick;
  for (let i = 0; i < rim.length; i++) {
    const p = rim[i]!, q = rim[(i + 1) % rim.length]!;
    for (let k = 0; k < SHIELD.rings; k++) {
      if (k === 0) {
        front.tri(at(p, 0, zFront), at(p, 1, zFront), at(q, 1, zFront));
        back.tri(at(p, 0, zBack), at(q, 1, zBack), at(p, 1, zBack));
      } else {
        front.quad(at(p, k, zFront), at(p, k + 1, zFront), at(q, k + 1, zFront), at(q, k, zFront));
        back.quad(at(p, k, zBack), at(q, k, zBack), at(q, k + 1, zBack), at(p, k + 1, zBack));
      }
    }
    // 縁の側面。色は、表の図の縁（鉄）の少し内側から取る
    const a = at(p, SHIELD.rings, zFront), b = at(q, SHIELD.rings, zFront), c = at(q, SHIELD.rings, zBack), d = at(p, SHIELD.rings, zBack);
    const ua = front.planar([p[0] * 0.96, p[1] * 0.96, 0]), ub = front.planar([q[0] * 0.96, q[1] * 0.96, 0]);
    front.quad(a, b, c, d, [ua, ub, ub, ua]);
  }
  const art: ArtStatus[] = [];
  const group = new Group();
  group.name = 'model.weapon.guard_blade.001.shield';
  group.add(front.build('guard_blade_shield_front', art), back.build('guard_blade_shield_back', art));
  return { group, art, triangles: front.triangles + back.triangles };
}
