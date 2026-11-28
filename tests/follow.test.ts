// 攻撃を受ける部位の追従（v0.25.0。ChatGPT の設計提案 #6、D-097）: 技の間と眠っている間、部位の形が、動きの中の位置へ動く。
// 表は描画の動きから前もって作る（npm run monsters:bake）。戦闘は表だけを読み、tick で決まる。
import { beforeAll, describe, expect, it } from 'vitest';
import type { Content } from '../src/data/schemas';
import { newRun } from '../src/game/action';
import { Vector3 } from 'three';
import { followKeys, followShape, followTick, staggerFollowTick } from '../src/game/follow';
import { GaldrosRig, STUN_LOOP } from '../src/render/galdrosRig';
import { bakeGaldrosFollow, galdrosFollowEnds } from './galdrosFollow';
import { createMonster, monsterShapes } from '../src/game/monster';
import { loadContent } from './helpers';

let content: Content;
beforeAll(async () => {
  content = await loadContent();
});

const mid = (s: { a: { x: number; y: number; z: number }; b: { x: number; y: number; z: number } | null }): [number, number, number] =>
  s.b ? [(s.a.x + s.b.x) / 2, (s.a.y + s.b.y) / 2, (s.a.z + s.b.z) / 2] : [s.a.x, s.a.y, s.a.z];
const dist = (p: number[], q: number[]): number => Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!, p[2]! - q[2]!);

describe('部位の追従（v0.25.0）', () => {
  it('遊べる 3 種（ガルドロス・スパインゲイル・フロストアルド）に表があり、技の多くで部位が動く（訓練標的には無い。v0.75.0 で、生成の体の 19 種は外した）', () => {
    for (const id of ['monster.galdros', 'monster.spinegale', 'monster.frostald', 'monster.venolka']) {
      const f = content.monsters.get(id)!.follow;
      expect(f, id).toBeDefined();
      const acts = [...content.actions.values()].filter((a) => a.actionId.startsWith(`${id}.`));
      expect(f!.actions.size, id).toBeGreaterThanOrEqual(Math.ceil(acts.length * 0.8));
    }
    expect(content.monsters.get('monster.training_dummy')?.follow).toBeUndefined();
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

  it('眠っている間は、頭の形が低くなる（体を伏せた姿勢）。起きると戻る', () => {
    const def = content.monsters.get('monster.galdros')!;
    const m = createMonster(def, { x: 0, z: 0, yaw: 0 }, 'follow');
    const head = def.parts.findIndex((p) => p.id === 'head');
    const up = mid(monsterShapes(m).find((s) => s.partIndex === head)!);
    m.asleep = true;
    const down = mid(monsterShapes(m).find((s) => s.partIndex === head)!);
    expect(down[1]).toBeLessThan(up[1]! - 0.1);
    m.asleep = false;
    expect(mid(monsterShapes(m).find((s) => s.partIndex === head)!)[1]).toBeCloseTo(up[1]!, 9);
  });

  it('同じ状態からは、いつも同じ形（描画の状態を読まない）', () => {
    const def = content.monsters.get('monster.galdros')!;
    const a = [...content.actions.values()].find((x) => x.actionId === 'monster.galdros.bite')!;
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

describe('ガルドロスの部位の追従（v0.36.0。#12 の M3、D-119）', () => {
  const G = 'monster.galdros';
  const partIx = (id: string): number => content.monsters.get(G)!.parts.findIndex((p) => p.id === id);
  const fresh = (): ReturnType<typeof createMonster> => createMonster(content.monsters.get(G)!, { x: 0, z: 0, yaw: 0 }, 'follow');

  it('全部の技・眠る姿勢・転倒・怯み・気絶の表があり、尾には切った後に残る形（after）の動きもある', () => {
    const f = content.monsters.get(G)!.follow!;
    expect(f).toBeDefined();
    const moves = [...content.actions.values()].filter((a) => a.actionId.startsWith(`${G}.`));
    expect(f.actions.size).toBe(moves.length);
    expect(f.sleep).not.toBeNull();
    expect(f.states.topple?.ticks).toBe(190);
    expect(f.states.flinch?.ticks).toBe(46);
    expect(f.states.stun?.ticks).toBe(STUN_LOOP);
    const tail = partIx('tail');
    const def = content.monsters.get(G)!;
    // 尾の形の番号の後ろに、切った後の形の番号が続く
    const afterSlot = def.parts[tail]!.shapes.length;
    expect(f.actions.get(`${G}.tail_sweep`)![tail]![afterSlot]).not.toBeNull();
    expect(f.states.topple!.grid[tail]![afterSlot]).not.toBeNull();
  });

  it('表は描画の骨から作り直したものと同じ（手で直していない。ずれていたら npm run monsters:bake）', () => {
    const doc = bakeGaldrosFollow(content);
    const f = content.monsters.get(G)!.follow!;
    const def = content.monsters.get(G)!;
    const check = (name: string, grid: (Int16Array | null)[][] | undefined, set: { shapes: { part: string; i: number; after?: boolean; d: number[][] }[] }): void => {
      expect(grid, name).toBeDefined();
      for (const sh of set.shapes) {
        const pi = def.parts.findIndex((p) => p.id === sh.part);
        const d = grid![pi]![sh.after ? def.parts[pi]!.shapes.length + sh.i : sh.i];
        expect(d, `${name} ${sh.part}[${sh.i}]`).toBeTruthy();
        const flat = sh.d.flat();
        expect(flat.every((v, k) => Math.abs(v - d![k]!) <= 2), `${name} ${sh.part}${sh.after ? '(after)' : ''}[${sh.i}]`).toBe(true);
      }
    };
    for (const [aid, set] of Object.entries(doc.actions)) check(aid, f.actions.get(aid), set);
    for (const [id, set] of Object.entries(doc.states ?? {})) check(id, f.states[id as 'topple']?.grid, set!);
    check('sleep', f.sleep ?? undefined, doc.poses!.sleep!);
  }, 60000);

  it('転倒: 戦闘の状態（経過 tick）だけで形が決まり、体の右（−X）へ倒れて低くなる。立ち上がると戻る', () => {
    const m = fresh();
    const back = partIx('back');
    const rest = mid(monsterShapes(m).find((s) => s.partIndex === back)!);
    m.staggerKind = 'topple';
    m.staggerTotal = 190;
    m.staggerTicks = 190 - 90;
    const down = mid(monsterShapes(m).find((s) => s.partIndex === back)!);
    expect(down[0]).toBeLessThan(rest[0]! - 0.4);
    expect(down[1]).toBeLessThan(rest[1]! - 0.2);
    // 同じ経過からは同じ形
    expect(JSON.stringify(monsterShapes(m))).toBe(JSON.stringify(monsterShapes(m)));
    m.staggerTicks = 0;
    m.staggerKind = null;
    expect(dist(mid(monsterShapes(m).find((s) => s.partIndex === back)!), rest)).toBeLessThan(1e-9);
  });

  it('怯みは経過の割合で引く（頭の 50 tick も、46 tick で作った表へ）。気絶は残りの tick を表の長さで割った余り', () => {
    expect(staggerFollowTick(0, 50, 46)).toBe(0);
    expect(staggerFollowTick(25, 50, 46)).toBe(23);
    expect(staggerFollowTick(49, 50, 46)).toBe(45);
    expect(staggerFollowTick(120, 190, 190)).toBe(120);
    const m = fresh();
    const head = partIx('head');
    m.ailments.ticks.stun = STUN_LOOP * 2 + 30;
    const a = JSON.stringify(monsterShapes(m).filter((s) => s.partIndex === head));
    m.ailments.ticks.stun = 30;
    expect(JSON.stringify(monsterShapes(m).filter((s) => s.partIndex === head))).toBe(a);
  });

  it('戦闘の形は、同じ tick の描画の皮の位置と合う（60Hz で進めた描画。視線は入れない）: 尾払いの尾の先・前脚叩きの前脚・転倒の背', () => {
    const def = content.monsters.get(G)!;
    const ends = galdrosFollowEnds(content);
    const near = (rig: GaldrosRig, m: ReturnType<typeof createMonster>, part: string, i: number): number => {
      const pi = partIx(part);
      const s = monsterShapes(m).filter((x) => x.partIndex === pi)[i]!;
      const e = ends.find((x) => x.part === part && x.i === i && !x.after)!;
      const pa = rig.skinned(e.a, e.sa);
      const pb = e.b ? rig.skinned(e.b, e.sb!) : null;
      return Math.max(pa.distanceTo(new Vector3(s.a.x, s.a.y, s.a.z)), pb && s.b ? pb.distanceTo(new Vector3(s.b.x, s.b.y, s.b.z)) : 0);
    };
    let worst = 0;
    for (const [id, part, i] of [[`${G}.tail_sweep`, 'tail', 0], [`${G}.slam_l`, 'foreleg', 0]] as const) {
      const m = fresh();
      m.aware = true;
      const rig = new GaldrosRig(def.parts.map((p) => p.id));
      const a = content.actions.get(id)!;
      const run = newRun(a, 1, 0);
      for (let t = 0; t < a.durationTicks; t++) {
        run.tick = t;
        run.advanced = false;
        m.action = run;
        rig.update(m, { alpha: 1, dt: 1 / 60, time: t / 60, content });
        if (t % 6 === 0) worst = Math.max(worst, near(rig, m, part, i));
      }
    }
    {
      const m = fresh();
      m.aware = true;
      const rig = new GaldrosRig(def.parts.map((p) => p.id));
      for (let t = 0; t < 190; t++) {
        m.staggerKind = 'topple';
        m.staggerTotal = 190;
        m.staggerTicks = 190 - t;
        rig.update(m, { alpha: 1, dt: 1 / 60, time: t / 60, content });
        if (t % 6 === 0) worst = Math.max(worst, near(rig, m, 'back', 0));
      }
    }
    // 表は cm の整数で、鍵の間は直線。鍵の上では 1cm 以内（丸め）
    expect(worst).toBeLessThan(0.015);
  });

  it('尾を切った後: 尾払いで残った尾の形が振られ、先は切った所より伸びない（残った骨だけで動く）', () => {
    const m = fresh();
    const tail = partIx('tail');
    m.parts[tail]!.severed = true;
    const rest = monsterShapes(m).find((s) => s.partIndex === tail)!;
    const len0 = Math.hypot(rest.b!.x - rest.a.x, rest.b!.y - rest.a.y, rest.b!.z - rest.a.z);
    const a = content.actions.get(`${G}.tail_sweep_short`)!;
    const run = newRun(a, 1, 0);
    let swing = 0, longest = 0;
    for (let t = 0; t < a.durationTicks; t++) {
      run.tick = t;
      m.action = run;
      const s = monsterShapes(m).find((x) => x.partIndex === tail)!;
      swing = Math.max(swing, Math.abs(s.b!.x - rest.b!.x));
      longest = Math.max(longest, Math.hypot(s.b!.x - s.a.x, s.b!.y - s.a.y, s.b!.z - s.a.z));
    }
    expect(swing).toBeGreaterThan(0.3);
    expect(longest).toBeLessThan(len0 + 0.06);
  });
});
