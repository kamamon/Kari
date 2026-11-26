// 手で狙う（v0.61.0。2G の弓の照準。#19 の H05。docs/spec.md の 32.27）。
// 狙いの向き（左右 yaw・上下 pitch）は入力（InputFrame の aimYaw・aimPitch）で simulation へ渡す。描画のカメラは、目の点から
// 狙いの向きへ伸びる線（狙いの線）の上に置くので、画面の真ん中の照準は、この線が最初に当たる所を指す。矢は胸の前から、その所へ飛ぶ。
// DOM・Three.js・現在時刻に触れない（src/game の決まり）。
import { distPointSeg, type V3 } from '../core/math';
import { monsterShapes, type MonsterState } from './monster';
import type { World } from './world';

/** 目の点: 足元から上へ、体の右へ（狙いの線が頭に重ならないよう、右肩の上を通す） */
export const AIM_EYE_UP = 1.6;
export const AIM_EYE_RIGHT = 0.32;
/** 狙いの線を調べる長さ (m) と刻み */
export const AIM_REACH = 40;
const AIM_STEP = 0.25;

/** 狙いの向きの単位ベクトル（前 = (sin, cos)。pitch は上が正） */
export function aimDir(yaw: number, pitch: number): V3 {
  const c = Math.cos(pitch);
  return { x: Math.sin(yaw) * c, y: Math.sin(pitch), z: Math.cos(yaw) * c };
}

/** 目の点（足元 pos、狙いの左右 yaw）。右 = (-cos, sin) */
export function aimEye(pos: V3, yaw: number): V3 {
  return { x: pos.x - Math.cos(yaw) * AIM_EYE_RIGHT, y: pos.y + AIM_EYE_UP, z: pos.z + Math.sin(yaw) * AIM_EYE_RIGHT };
}

export interface AimHit {
  /** 狙いの線が最初に当たった所（何にも当たらなければ、届く長さの先） */
  point: V3;
  /** 目の点からの距離 (m) */
  dist: number;
  /** 当たったもの: モンスター（id と部位の番号）・地面・無し */
  kind: 'monster' | 'ground' | 'none';
  monsterId?: string;
  partIndex?: number;
}

/**
 * 狙いの線（目の点 eye から dir へ）が最初に当たる所。生きているモンスター（捕獲したものは除く）の部位の形と、地面を調べる。
 * 0.25m 刻みで進めて、最初に形の中か地面の下へ入った点を返す
 */
export function aimTarget(monsters: readonly MonsterState[], world: World, eye: V3, dir: V3, reach = AIM_REACH): AimHit {
  const shapes = monsters.filter((m) => !m.dead && !m.captured).map((m) => ({ m, s: monsterShapes(m) }));
  for (let d = AIM_STEP; d <= reach; d += AIM_STEP) {
    const p = { x: eye.x + dir.x * d, y: eye.y + dir.y * d, z: eye.z + dir.z * d };
    for (const { m, s } of shapes) {
      for (const sh of s) {
        const dd = sh.b ? distPointSeg(p, sh.a, sh.b) : Math.hypot(p.x - sh.a.x, p.y - sh.a.y, p.z - sh.a.z);
        if (dd <= sh.r) return { point: p, dist: d, kind: 'monster', monsterId: m.id, partIndex: sh.partIndex };
      }
    }
    if (p.y < world.groundHeight(p.x, p.z)) return { point: p, dist: d, kind: 'ground' };
  }
  return { point: { x: eye.x + dir.x * reach, y: eye.y + dir.y * reach, z: eye.z + dir.z * reach }, dist: reach, kind: 'none' };
}
