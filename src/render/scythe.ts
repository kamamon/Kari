// 旋鎌（里鍛ちの旋鎌）の仮モデル。設定図（art-source/weapon/weapon_senren_{front,side}_v1.png）の輪郭を測った寸法で
// 形を組み、正面の図をそのまま両面へ貼る。まだゲームには出ない（武器としての実装は未着手。素材ビューアで見られる）。
// 原点は下の握りの中央、+Y が柄の先、刃は -Z の方へ伸びる。X が厚み。単位 m。
// 設定図を測った寸法: 全高 1.95m（石突 -0.43m 〜 刃の峰 1.52m）、柄の太さ 約 3.1cm、刃渡り 約 0.75m、
// 上の握りは原点から 0.64m 上。刃先は原点から見て 高さ 1.33m・横 0.75m（距離 約 1.53m）。
import { Group } from 'three';
import { ArtMesh, type ArtStatus, type P3 } from './artMesh';
import type { WeaponModel } from './heavyBlade';
import { SENREN_BLADE, WEAPON_SHEETS } from './weaponSheets';

const SHAFT_R = 0.0155;
const SHAFT_TOP = 1.3376; // 金具の下端
const BLADE_T = 0.005; // 峰の厚みの半分（真横の図: 約 1cm）

export function buildScythe(): WeaponModel {
  const m = new ArtMesh(WEAPON_SHEETS.senren);
  // 石突（青銅色のふた）と柄
  m.lathe([
    [-0.4295, 0.013, 0.013],
    [-0.423, 0.018, 0.018],
    [-0.379, 0.018, 0.018],
    [-0.377, SHAFT_R, SHAFT_R],
    [SHAFT_TOP, SHAFT_R, SHAFT_R],
  ]);
  // 刃を留める金具（青銅色、鋲 2 個）
  m.box(-0.0225, 0.0225, SHAFT_TOP, 1.492, -0.02, 0.039);
  // 刃: 上の端（峰）が厚く、下の端（握りの方を向く側）が刃。刃先へ向かって細くなる。
  const top = (i: number, s: number): P3 => [s * BLADE_T * Math.min(1, 0.35 + i * 0.08), SENREN_BLADE[i]![1], SENREN_BLADE[i]![0]];
  const edge = (i: number): P3 => [0, SENREN_BLADE[i]![2], SENREN_BLADE[i]![0]];
  for (let i = 0; i < SENREN_BLADE.length - 1; i++) {
    for (const s of [-1, 1]) m.quad(top(i, s), top(i + 1, s), edge(i + 1), edge(i));
    m.quad(top(i, 1), top(i + 1, 1), top(i + 1, -1), top(i, -1)); // 峰
  }
  const art: ArtStatus[] = [];
  const group = new Group();
  group.name = 'model.weapon.reap_scythe.001';
  group.add(m.build('reap_scythe_body', art));
  return { group, art, triangles: m.triangles };
}
