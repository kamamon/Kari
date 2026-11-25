// 攻撃を受ける部位の追従（v0.25.0。ChatGPT の設計提案 #6、D-097）: 技の間と眠っている間、部位の形が、動きの中の位置へ動く。
// 表は描画の動きから前もって作る（npm run monsters:bake）。戦闘は表だけを読み、tick で決まる。
import { beforeAll, describe, expect, it } from 'vitest';
import type { Content } from '../src/data/schemas';
import { newRun } from '../src/game/action';
import { followKeys, followShape, followTick } from '../src/game/follow';
import { createMonster, monsterShapes } from '../src/game/monster';
import { CREATURE_PLANS } from '../src/render/creaturePlans';
import { loadContent } from './helpers';

let content: Content;
beforeAll(async () => {
  content = await loadContent();
});

const mid = (s: { a: { x: number; y: number; z: number }; b: { x: number; y: number; z: number } | null }): [number, number, number] =>
  s.b ? [(s.a.x + s.b.x) / 2, (s.a.y + s.b.y) / 2, (s.a.z + s.b.z) / 2] : [s.a.x, s.a.y, s.a.z];
const dist = (p: number[], q: number[]): number => Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!, p[2]! - q[2]!);

describe('部位の追従（v0.25.0）', () => {
  it('大型 11 種と幼体 8 種のすべてに表があり、技の多くで部位が動く（ガルドロスと訓練標的には無い）', () => {
    for (const id of Object.keys(CREATURE_PLANS)) {
      const f = content.monsters.get(id)!.follow;
      expect(f, id).toBeDefined();
      const acts = [...content.actions.values()].filter((a) => a.actionId.startsWith(`${id}.`));
      expect(f!.actions.size, id).toBeGreaterThanOrEqual(Math.ceil(acts.length * 0.8));
      expect(f!.sleep, id).not.toBeNull();
    }
    expect(content.monsters.get('monster.galdros')!.follow).toBeUndefined();
  });

  it('鍵の tick と補間: 鍵の上では表の値、間は直線、技の長さの外は端の値', () => {
    expect(followKeys(90, 6)).toBe(16); // 0, 6, …, 84, 89
    expect(followTick(15, 90, 6)).toBe(89);
    const d = Int16Array.from([0, 0, 0, 0, 0, 0, 60, 0, -30, 60, 0, -30]);
    const s = { a: [0, 1, 2] as [number, number, number], b: [0, 1, 3] as [number, number, number], r: 0.2 };
    expect(followShape(s, d, 0, 7, 6).a).toEqual([0, 1, 2]);
    const half = followShape(s, d, 3, 7, 6);
    expect(half.a[0]).toBeCloseTo(0.3);
    expect(half.b![2]).toBeCloseTo(2.85);
    expect(followShape(s, d, 99, 7, 6).a[0]).toBeCloseTo(0.6);
  });

  it('セルヴァルクの横跳び蹴り: 攻撃の間、後脚の形が、休んでいる時の位置から大きく動き、技が終わると戻る', () => {
    const def = content.monsters.get('monster.selvark')!;
    const m = createMonster(def, { x: 0, z: 0, yaw: 0 }, 'follow');
    const leg = def.parts.findIndex((p) => p.id === 'hindleg');
    const rest = monsterShapes(m).filter((s) => s.partIndex === leg).map(mid);
    const a = content.actions.get('monster.selvark.hop_kick_l')!;
    const run = newRun(a, 1, 0);
    let most = 0;
    for (let t = a.phases.find((p) => p.id === 'active')!.from; t < a.phases.find((p) => p.id === 'active')!.to; t++) {
      run.tick = t;
      m.action = run;
      const now = monsterShapes(m).filter((s) => s.partIndex === leg).map(mid);
      most = Math.max(most, ...now.map((p, i) => dist(p, rest[i]!)));
    }
    expect(most).toBeGreaterThan(0.3);
    m.action = null;
    const back = monsterShapes(m).filter((s) => s.partIndex === leg).map(mid);
    expect(Math.max(...back.map((p, i) => dist(p, rest[i]!)))).toBeLessThan(1e-9);
  });

  it('眠っている間は、頭の形が低くなる（体を伏せた姿勢）。起きると戻る', () => {
    for (const id of ['monster.selvark', 'monster.numeradon', 'monster.kordopil']) {
      const def = content.monsters.get(id)!;
      const m = createMonster(def, { x: 0, z: 0, yaw: 0 }, 'follow');
      const head = def.parts.findIndex((p) => p.id === 'head');
      if (head < 0) continue;
      const up = mid(monsterShapes(m).find((s) => s.partIndex === head)!);
      m.asleep = true;
      const down = mid(monsterShapes(m).find((s) => s.partIndex === head)!);
      expect(down[1], id).toBeLessThan(up[1]! - 0.1);
      m.asleep = false;
      expect(mid(monsterShapes(m).find((s) => s.partIndex === head)!)[1]).toBeCloseTo(up[1]!, 9);
    }
  });

  it('同じ状態からは、いつも同じ形（描画の状態を読まない）', () => {
    const def = content.monsters.get('monster.razmer')!;
    const a = [...content.actions.values()].find((x) => x.actionId === 'monster.razmer.bite')!;
    const shapes = (): string => {
      const m = createMonster(def, { x: 3, z: -2, yaw: 0.7 }, 'follow');
      const run = newRun(a, 1, 0);
      run.tick = 35;
      m.action = run;
      return JSON.stringify(monsterShapes(m));
    };
    expect(shapes()).toBe(shapes());
  });
});
