// 地形と衝突。controller が距離と衝突を所有する（アニメーションは移動量を持たない）。
// 地面は高さ 0 の平面 + 段差（platform）。壁は区画の外周、岩は円柱として扱う。
import { clamp, type V3 } from '../core/math';
import type { MapDef } from '../data/schemas';

export interface Circle {
  x: number;
  z: number;
  r: number;
}

export class World {
  readonly map: MapDef;

  constructor(map: MapDef) {
    this.map = map;
  }

  groundHeight(x: number, z: number): number {
    let h = 0;
    for (const p of this.map.platforms) {
      if (x >= p.minX && x <= p.maxX && z >= p.minZ && z <= p.maxZ && p.h > h) h = p.h;
    }
    return h;
  }

  private canStand(pos: V3, x: number, z: number): boolean {
    return this.groundHeight(x, z) - pos.y <= this.map.stepUp + 1e-6;
  }

  /** 半径 radius のキャラクターを (dx, dz) だけ動かす。壁・岩・高い段差は抜けない。 */
  move(pos: V3, radius: number, dx: number, dz: number, others: readonly Circle[] = []): void {
    const b = this.map.bounds;
    let nx = clamp(pos.x + dx, b.minX + radius, b.maxX - radius);
    let nz = clamp(pos.z + dz, b.minZ + radius, b.maxZ - radius);

    // 岩や大型の胴体から押し出す
    for (let pass = 0; pass < 2; pass++) {
      for (const c of this.map.rocks) [nx, nz] = pushOut(nx, nz, radius, c.x, c.z, c.r);
      for (const c of others) [nx, nz] = pushOut(nx, nz, radius, c.x, c.z, c.r);
    }
    nx = clamp(nx, b.minX + radius, b.maxX - radius);
    nz = clamp(nz, b.minZ + radius, b.maxZ - radius);

    // 登れない高さの段差は壁として扱い、軸ごとに滑らせる
    if (!this.canStand(pos, nx, nz)) {
      if (this.canStand(pos, nx, pos.z)) nz = pos.z;
      else if (this.canStand(pos, pos.x, nz)) nx = pos.x;
      else return;
    }
    pos.x = nx;
    pos.z = nz;
    const h = this.groundHeight(nx, nz);
    if (h > pos.y) pos.y = h;
  }

  /** 重力。接地していれば true。 */
  settle(pos: V3, vel: { vy: number }, gravity: number, dt: number): boolean {
    const h = this.groundHeight(pos.x, pos.z);
    if (pos.y <= h + 1e-6) {
      pos.y = h;
      vel.vy = 0;
      return true;
    }
    vel.vy -= gravity * dt;
    pos.y += vel.vy * dt;
    if (pos.y <= h) {
      pos.y = h;
      vel.vy = 0;
      return true;
    }
    return false;
  }
}

function pushOut(x: number, z: number, radius: number, cx: number, cz: number, cr: number): [number, number] {
  const dx = x - cx;
  const dz = z - cz;
  const min = radius + cr;
  const d2 = dx * dx + dz * dz;
  if (d2 >= min * min) return [x, z];
  const d = Math.sqrt(d2);
  if (d < 1e-6) return [cx + min, z];
  return [cx + (dx / d) * min, cz + (dz / d) * min];
}
