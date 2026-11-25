// 里（拠点）の計算（v0.31.0）。DOM・Three.js に触れない（Node の検査で同じものを使う）。
import type { V3 } from '../core/math';
import type { World } from './world';

/** 施設の前の床と、狩人の足もとの高さの差が、これ以下なら同じ段（m）。段の間は 3m なので、別の段の施設は開かない */
export const FACILITY_FLOOR_TOL = 1;

/**
 * 狩人が前に立っている施設（いちばん近いもの）。施設の前（x, z から半径 r）にいて、施設の前の床と同じ段にいる時だけ。
 * 里の段（v0.31.0。工房は下の段）で、上の段の縁から下の施設を開かないため。
 */
export function nearestFacility<F extends { x: number; z: number; r: number }>(facilities: readonly F[], world: World, pos: V3): F | null {
  let near: F | null = null;
  let best = Infinity;
  for (const f of facilities) {
    const d = Math.hypot(f.x - pos.x, f.z - pos.z);
    if (d > f.r || d >= best) continue;
    if (Math.abs(world.groundHeight(f.x, f.z) - pos.y) > FACILITY_FLOOR_TOL) continue;
    best = d;
    near = f;
  }
  return near;
}
