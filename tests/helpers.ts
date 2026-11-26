import { readFile } from 'node:fs/promises';
import type { Content } from '../src/data/schemas';
import { assembleContent, type LoadOptions } from '../src/data/validators';
import { Btn, type InputFrame } from '../src/game/inputFrame';
import { Simulation, type SimOptions } from '../src/game/sim';
import type { SimEvent } from '../src/game/events';

/** ゲームのデータを読む。opts.motionSet: ハンターの動きの組（v0.57.0。'v056' で保留の組） */
export async function loadContent(opts: LoadOptions = {}): Promise<Content> {
  return assembleContent(async (p) => JSON.parse(await readFile(new URL(`../public/data/${p}`, import.meta.url), 'utf8')) as unknown, opts);
}

export const baseOptions = (over: Partial<SimOptions> = {}): SimOptions => ({
  seed: 12345,
  mapId: 'map.basin.training',
  weaponId: 'weapon.heavy_blade.001',
  monsterId: 'monster.training_dummy',
  monsterAttacks: false,
  ...over,
});

export const frame = (over: Partial<InputFrame> = {}): InputFrame => ({ moveX: 0, moveZ: 0, held: 0, pressed: 0, released: 0, ...over });
export const press = (btn: number): InputFrame => frame({ pressed: btn, held: btn });
export const hold = (btn: number): InputFrame => frame({ held: btn });
export { Btn };

/** sim を n tick 進め、その間の出来事を集める。input は tick ごとに作れる。 */
export function run(sim: Simulation, n: number, input: (i: number) => InputFrame = () => frame()): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < n; i++) {
    sim.step(input(i));
    out.push(...sim.drainEvents());
  }
  return out;
}

/** 訓練標的の頭の正面、断岳剣の縦斬りが届く位置へプレイヤーを置く（抜刀済み）。 */
export function placeInFrontOfHead(sim: Simulation, dist = 2.25): void {
  const m = sim.monsters[0]!;
  // 標的は -Z を向いている。頭はワールド z = m.z - 1.75
  sim.player.pos = { x: m.pos.x, y: 0, z: m.pos.z - 1.75 - dist };
  sim.player.prevPos = { ...sim.player.pos };
  sim.player.yaw = 0;
  sim.player.drawn = true;
}
