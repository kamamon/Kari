// 地上の拘束罠。設置可否と種別相性は純計算。描画/入力/時刻には依存しない。
import { forwardOf, type V3 } from '../core/math';
import type { TrapResponseProfile } from '../data/schemas';
import type { World } from './world';

export const TRAP_AHEAD = 0.9;
// 機構の接地範囲。発動半径とは別。高さは地面の正本から読む。
const FOOTPRINT = 0.45;
const MAX_STEP = 0.35;
const MAX_PLAYER_OFFSET = 0.45;

/** 設置できる位置。崖外、岩の中、急な段差や空中には置けない。 */
export function trapSite(world: World, pos: V3, yaw: number): V3 | null {
  const f = forwardOf(yaw);
  const x = pos.x + f.x * TRAP_AHEAD, z = pos.z + f.z * TRAP_AHEAD;
  const area = world.areaAt(pos.x, pos.z);
  if (world.areaAt(x, z) !== area) return null;
  const b = area.bounds;
  if (x - FOOTPRINT < b.minX || x + FOOTPRINT > b.maxX || z - FOOTPRINT < b.minZ || z + FOOTPRINT > b.maxZ) return null;
  const geo = world.geo(area);
  if (geo && geo.shape.signedDistance(x, z) < FOOTPRINT) return null;
  if (area.rocks.some(o => Math.hypot(x - o.x, z - o.z) < o.r + FOOTPRINT)) return null;
  const y = world.groundHeight(x, z);
  if (Math.abs(pos.y - world.groundHeight(pos.x, pos.z)) > MAX_PLAYER_OFFSET || Math.abs(y - pos.y) > MAX_PLAYER_OFFSET) return null;
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    const h = world.groundHeight(x + Math.cos(a) * FOOTPRINT, z + Math.sin(a) * FOOTPRINT);
    if (Math.abs(h - y) > MAX_STEP) return null;
  }
  return { x, y, z };
}

/** 発動範囲にいても、別エリア/上下に離れた面/空中の相手には効かない。 */
export function trapGroundContact(world: World, monster: V3, trap: {x: number; z: number}): boolean {
  if (world.areaAt(monster.x, monster.z) !== world.areaAt(trap.x, trap.z)) return false;
  const ground = world.groundHeight(monster.x, monster.z);
  return Math.abs(monster.y - ground) <= MAX_STEP && Math.abs(ground - world.groundHeight(trap.x, trap.z)) <= 0.65;
}

/** 0はその状態では作動しない。回数を増やすのは実際に発動した時だけ。 */
export function trapHoldTicks(base: number, count: number, enraged: boolean, profile?: TrapResponseProfile): number {
  if (!profile) return Math.max(60, Math.round(base * Math.pow(0.6, count)));
  const scale = enraged ? profile.enragedScale : profile.normalScale;
  if (scale === 0) return 0;
  const first = Math.max(1, Math.round(base * scale));
  const floor = Math.min(first, profile.minTicks);
  return Math.max(floor, Math.round(base * scale * Math.pow(profile.repeatScale, count)));
}
