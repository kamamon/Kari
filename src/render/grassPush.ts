// 草の踏み分け（v0.77.0。docs/spec.md の 21.6。描画だけ）: 狩人と大型の足元の草が、外へ倒れて、少し沈む。
// 草の素材（src/render/envArt.ts の swayInWind）が、ここの値（押す物の位置・半径・強さ。4 つまで）を読む。
// 値を入れるのは、描画の側（src/render/view.ts）。戦闘の計算・当たりには関わらない（計算の状態を読むだけ）。
import { Vector4 } from 'three';

/** 草を押す物。x・z = 位置（世界の m）、r = 草が倒れ始める半径（m）、k = 強さ（0〜1。無ければ 1） */
export interface GrassPusher { x: number; z: number; r: number; k?: number }

/** 1 度に渡せる数（シェーダーの配列の長さ） */
export const GRASS_PUSH_MAX = 4;
/** 狩人が草を押す半径（m）。足元から、ひざ下の草が触れるくらい */
export const HUNTER_PUSH_R = 0.85;
/** 大型が草を押す半径 = 体の当たりの半径 × これ */
export const MONSTER_PUSH_SCALE = 1.15;
/** 倒れる草の先が、外へ動く距離（m。いちばん強い所）と、高さの縮む割合 */
export const PUSH_LEAN = 0.32, PUSH_FLAT = 0.5;

/** 草の素材すべてが読む値（x, z, 半径, 強さ）。使わない枠は、強さ 0 */
export const GRASS_PUSH = { value: Array.from({ length: GRASS_PUSH_MAX }, () => new Vector4(0, 0, 1, 0)) };

/** 押す物を渡す。多い時は、先に書いた物から 4 つ（狩人を先に入れる）。半径は 0.05m より小さくしない */
export function setGrassPushers(list: readonly GrassPusher[]): void {
  for (let i = 0; i < GRASS_PUSH_MAX; i++) {
    const p = list[i];
    if (p) GRASS_PUSH.value[i]!.set(p.x, p.z, Math.max(0.05, p.r), Math.max(0, Math.min(1, p.k ?? 1)));
    else GRASS_PUSH.value[i]!.set(0, 0, 1, 0);
  }
}

/**
 * 草 1 本（根元が x, z）が受ける、押しの向きと強さ（検査と、シェーダーの式の覚え）。
 * 押す物の中心から半径の 0.35 倍までは強さ 1、半径で 0。向きは、押す物から外へ。
 */
export function grassPushAt(x: number, z: number, list: readonly GrassPusher[] = GRASS_PUSH.value.map((v) => ({ x: v.x, z: v.y, r: v.z, k: v.w }))): { x: number; z: number; flat: number } {
  let px = 0, pz = 0, flat = 0;
  for (const p of list.slice(0, GRASS_PUSH_MAX)) {
    const dx = x - p.x, dz = z - p.z, dist = Math.hypot(dx, dz), r = Math.max(0.05, p.r);
    const t = Math.max(0, Math.min(1, (dist - r * 0.35) / (r - r * 0.35)));
    const k = (1 - t * t * (3 - 2 * t)) * Math.max(0, Math.min(1, p.k ?? 1));
    if (k <= 0) continue;
    px += (dist > 1e-3 ? dx / dist : 0.7071) * k;
    pz += (dist > 1e-3 ? dz / dist : 0.7071) * k;
    flat = Math.max(flat, k);
  }
  return { x: px, z: pz, flat: Math.min(1, flat) };
}
