// 登攀（v0.44.0。#19 の H07。docs/spec.md の 32.9）: 登り口で壁へ押すと取り付き、登り切って上の段に立つ。上から下りる・手を離す・落とされる。
// 盆地のエリア 4・9 の 3m の棚（tools/gen-field.py が作る。設計の a4_climb_01・a9_climb_01）。値は Kari の仮の値。
import { beforeAll, describe, expect, it } from 'vitest';
import type { ClimbDef, Content, VaultDef } from '../src/data/schemas';
import type { SimEvent } from '../src/game/events';
import { CLIMB_EXIT_BELOW, CLIMB_UP, LAND_TICKS, LAND_TICKS_HIGH, VAULT_IN, VAULT_TICKS, resolveIncomingHit } from '../src/game/player';
import { groundAt } from '../src/game/world';
import { headingTo } from '../src/game/roam';
import { forwardOf } from '../src/core/math';
import { Simulation } from '../src/game/sim';
import { Btn, baseOptions, frame, loadContent, run } from './helpers';

let content: Content;
beforeAll(async () => {
  content = await loadContent();
});

type Climb = Extract<SimEvent, { type: 'climb' }>;
const climbs = (evs: SimEvent[]): string[] => evs.filter((e): e is Climb => e.type === 'climb').map((e) => `${e.phase}:${e.dir}`);

/** エリア areaId の登攀の前に、壁を向いて立たせる（標的は遠いエリア 3 に居る） */
function atClimb(areaId = 'a4', back = 0.3): { sim: Simulation; c: ClimbDef } {
  const sim = new Simulation(content, baseOptions({ questId: 'quest.basin.003', field: true }));
  const c = sim.field!.areas.find((a) => a.id === areaId)!.climbs![0]!;
  sim.player.pos = { x: c.x - Math.sin(c.yaw) * back, y: 0, z: c.z - Math.cos(c.yaw) * back };
  sim.player.prevPos = { ...sim.player.pos };
  sim.player.yaw = c.yaw;
  sim.areaId = areaId;
  run(sim, 2);
  expect(sim.areaId).toBe(areaId);
  return { sim, c };
}
/** 壁へ向かって押す（toward = false なら壁から離れる向き） */
const push = (c: ClimbDef, toward = true): ReturnType<typeof frame> => frame({ moveX: Math.sin(c.yaw) * (toward ? 1 : -1), moveZ: Math.cos(c.yaw) * (toward ? 1 : -1) });

describe('登攀（#19 の H07。v0.44.0）', () => {
  it('盆地のエリア 4 と 9 に、3m の棚へ登る所が 1 つずつある（データの検査を通る）', () => {
    const f = content.fields.get('field.basin')!;
    const all = f.areas.flatMap((a) => (a.climbs ?? []).map((c) => `${a.id}:${c.id}:${c.top}`));
    expect(all).toEqual(['a4:a4_climb_01:3', 'a9:a9_climb_01:3']);
  });

  it('登り口で壁へ押すと、武器を納めて取り付き、登り切って上の段（3m）に立つ。登る間は、登攀が位置を持つ（落ちない）', () => {
    const { sim, c } = atClimb();
    sim.player.drawn = true;
    const evs = run(sim, 1, () => push(c));
    expect(sim.player.mode).toBe('climb');
    expect(sim.player.drawn).toBe(false);
    expect(climbs(evs)).toEqual(['start:up']);
    // 取り付きと登る間: 高さは上がるだけで、地面へ落ちない
    let last = sim.player.pos.y;
    const up: SimEvent[] = [];
    for (let i = 0; i < 400 && sim.player.mode === 'climb'; i++) {
      sim.step(push(c));
      up.push(...sim.drainEvents());
      expect(sim.player.pos.y).toBeGreaterThanOrEqual(last - 1e-9);
      last = sim.player.pos.y;
    }
    expect(climbs(up)).toEqual(['exit:up', 'top:up']);
    expect(sim.player.mode).toBe('free');
    expect(sim.player.pos).toMatchObject({ x: c.exit.x, y: c.top, z: c.exit.z });
    run(sim, 5);
    expect(sim.player.grounded).toBe(true);
    expect(sim.player.pos.y).toBe(c.top);
    // 登るのにかかった時間: 取り付き 14 + 登る (3 - 1.45) / 速さ + 登り切り 36（仮の値）
    const climbTicks = Math.ceil((c.top - CLIMB_EXIT_BELOW) / CLIMB_UP);
    expect(up.length).toBeGreaterThan(0);
    expect(climbTicks).toBeGreaterThan(40);
  });

  it('止まると、壁にいたまま（押すのをやめても落ちない）。壁に沿って横へ押しても取り付かない', () => {
    const { sim, c } = atClimb();
    run(sim, 30, () => push(c));
    const y = sim.player.pos.y;
    expect(sim.player.mode).toBe('climb');
    run(sim, 120);
    expect(sim.player.mode).toBe('climb');
    expect(sim.player.pos.y).toBeCloseTo(y, 9);
    const side = atClimb();
    run(side.sim, 30, () => frame({ moveX: Math.cos(side.c.yaw), moveZ: -Math.sin(side.c.yaw) }));
    expect(side.sim.player.mode).toBe('free');
  });

  it('上の段の登り切った所から、縁へ向かって押すと、向きを変えて取り付き、下まで下りて地面に立つ', () => {
    const { sim, c } = atClimb();
    sim.player.pos = { x: c.exit.x, y: c.top, z: c.exit.z };
    sim.player.prevPos = { ...sim.player.pos };
    sim.player.yaw = c.yaw + Math.PI;
    run(sim, 2);
    expect(sim.player.pos.y).toBe(c.top);
    const evs = run(sim, 1, () => push(c, false));
    expect(climbs(evs)).toEqual(['start:down']);
    const down: SimEvent[] = [];
    for (let i = 0; i < 400 && sim.player.mode === 'climb'; i++) {
      sim.step(push(c, false));
      down.push(...sim.drainEvents());
    }
    expect(climbs(down)).toEqual(['bottom:down']);
    expect(sim.player.mode).toBe('free');
    run(sim, 5);
    expect(sim.player.grounded).toBe(true);
    expect(sim.player.pos.y).toBe(0);
    expect(Math.hypot(sim.player.pos.x - c.x, sim.player.pos.z - c.z)).toBeLessThan(1.2);
  });

  it('登り切る・上から取り付く間、高さは 1 tick ごとに少しずつ変わる（縁を越えた所で上の段の高さへ跳ばない。v0.69.0、D-167）', () => {
    // 登り切る: 縁の下 1.45m から 36 tick のうち 6 割で縁の上へ（1 tick の上がり方は最大でも 1.45 × 1.5 / 21.6 ≒ 0.1m）
    const { sim, c } = atClimb();
    const ys: { phase: string; y: number }[] = [];
    for (let i = 0; i < 400 && (sim.player.mode === 'climb' || i < 2); i++) {
      sim.step(push(c));
      ys.push({ phase: sim.player.climb?.phase ?? sim.player.mode, y: sim.player.pos.y });
    }
    const exit = ys.filter((s) => s.phase === 'exit').map((s) => s.y);
    expect(exit.length).toBeGreaterThan(30);
    for (let i = 1; i < exit.length; i++) expect(exit[i]! - exit[i - 1]!, `exit ${i}`).toBeLessThan(0.105);
    // 上から取り付く: 縁の上から 30 tick で縁の下 1.45m へ（1 tick の下がり方は最大でも 1.45 × 1.5 / 30 ≒ 0.073m）
    const top = atClimb();
    top.sim.player.pos = { x: top.c.exit.x, y: top.c.top, z: top.c.exit.z };
    top.sim.player.prevPos = { ...top.sim.player.pos };
    top.sim.player.yaw = top.c.yaw + Math.PI;
    run(top.sim, 2);
    let last = top.sim.player.pos.y, n = 0;
    for (let i = 0; i < 60; i++) {
      top.sim.step(push(top.c, false));
      if (top.sim.player.climb?.phase !== 'down') break;
      expect(last - top.sim.player.pos.y, `down ${i}`).toBeLessThan(0.075);
      expect(top.sim.player.pos.y).toBeLessThanOrEqual(last + 1e-9);
      last = top.sim.player.pos.y;
      n++;
    }
    expect(n).toBeGreaterThan(25);
  });

  it('回避で手を離すと、重力で落ちて地面に立つ。登る途中で攻撃を受けると、壁から落とされる（防御はできない）', () => {
    const { sim, c } = atClimb();
    run(sim, 40, () => push(c));
    expect(sim.player.pos.y).toBeGreaterThan(0.4);
    const evs = run(sim, 1, () => frame({ pressed: Btn.Dodge, held: Btn.Dodge }));
    expect(climbs(evs)).toEqual(['release:down']);
    expect(sim.player.mode).toBe('free');
    run(sim, 90);
    expect(sim.player.grounded).toBe(true);
    expect(sim.player.pos.y).toBe(0);
    const hit = atClimb();
    run(hit.sim, 50, () => push(hit.c));
    expect(hit.sim.player.mode).toBe('climb');
    const out = resolveIncomingHit(hit.sim.player, { attackerPos: { x: hit.c.x, y: 0, z: hit.c.z - 8 }, baseDamage: 10, guardable: true, guardCost: 10, reaction: 'knockdown' }, hit.sim);
    expect(out).toBe('hit');
    expect(hit.sim.player.mode).toBe('hurt');
    expect(hit.sim.player.climb).toBeNull();
    run(hit.sim, 200);
    expect(hit.sim.player.pos.y).toBe(0);
  });

  it('棚の縁（登り切った所の外）から歩いて出ると、3m を落ちて地面に立つ。大型は棚へ上がれない（壁）', () => {
    const { sim, c } = atClimb();
    const shelf = sim.field!.areas.find((a) => a.id === 'a4')!.platforms.find((p) => p.h === c.top)!;
    // 棚の、登る壁と反対でない横の縁の近く
    sim.player.pos = { x: shelf.minX + 0.6, y: c.top, z: (shelf.minZ + shelf.maxZ) / 2 };
    sim.player.prevPos = { ...sim.player.pos };
    run(sim, 2);
    expect(sim.player.pos.y).toBe(c.top);
    let fell = false;
    for (let i = 0; i < 180; i++) {
      sim.step(frame({ moveX: -1, moveZ: 0 }));
      sim.drainEvents();
      if (sim.player.pos.y < c.top - 0.5) fell = true;
      if (fell && sim.player.grounded) break;
    }
    expect(fell).toBe(true);
    expect(sim.player.pos.y).toBe(0);
    expect(sim.player.mode).toBe('free');
    // 大型の胴（半径 1.5m）で棚へ向かって歩いても、上がれない
    const pos = { x: c.x, y: 0, z: c.z };
    for (let i = 0; i < 60; i++) sim.world.move(pos, 1.5, Math.sin(c.yaw) * 0.1, Math.cos(c.yaw) * 0.1);
    expect(pos.y).toBe(0);
    expect((pos.x - c.x) * Math.sin(c.yaw) + (pos.z - c.z) * Math.cos(c.yaw)).toBeLessThan(c.faceDist);
  });

  it('同じ入力なら、同じ登り方（状態の指紋が同じ）', () => {
    const a = atClimb('a9');
    const b = atClimb('a9');
    const input = (i: number): ReturnType<typeof frame> => (i < 70 ? push(a.c) : i < 90 ? frame() : push(a.c, false));
    run(a.sim, 110, input);
    run(b.sim, 110, input);
    expect(a.sim.hash()).toBe(b.sim.hash());
    expect(a.sim.player.mode).toBe('climb');
  });
});

describe('降下と着地（#19 の H07。v0.45.0）', () => {
  /** エリア 4 の棚の上、登る壁と反対の横の縁の 0.6m 内側に立たせる */
  function onShelf(): { sim: Simulation; c: ClimbDef; shelf: { minX: number; maxX: number; minZ: number; maxZ: number; h: number } } {
    const { sim, c } = atClimb();
    const shelf = sim.field!.areas.find((a) => a.id === 'a4')!.platforms.find((p) => p.h === c.top)!;
    sim.player.pos = { x: shelf.minX + 0.6, y: c.top, z: (shelf.minZ + shelf.maxZ) / 2 };
    sim.player.prevPos = { ...sim.player.pos };
    run(sim, 2);
    expect(sim.player.pos.y).toBe(c.top);
    return { sim, c, shelf };
  }

  it('段の端から歩いて出ると降下になり、出た時の動きのまま進む（向きを変える・攻撃する、を受けない）。着地で立て直す（3m からは 20 tick）', () => {
    const { sim, c } = onShelf();
    const evs: SimEvent[] = [];
    for (let i = 0; i < 60 && !sim.player.drop; i++) {
      sim.step(frame({ moveX: -1, moveZ: 0 }));
      evs.push(...sim.drainEvents());
    }
    expect(sim.player.drop).not.toBeNull();
    expect(evs.find((e) => e.type === 'drop')).toMatchObject({ from: c.top });
    // 降りる間: 反対へ押しても、主ボタンを押しても、出た時の向き（−X）へ進み続け、技は始まらない
    const x0 = sim.player.pos.x;
    const during: SimEvent[] = [];
    for (let i = 0; i < 120 && sim.player.drop; i++) {
      sim.step(frame({ moveX: 1, moveZ: 0, pressed: i === 3 ? Btn.Main : 0, held: Btn.Main }));
      during.push(...sim.drainEvents());
    }
    expect(sim.player.pos.x).toBeLessThan(x0);
    expect(during.filter((e) => e.type === 'action_start' && e.actor === 'player')).toHaveLength(0);
    const land = during.find((e): e is Extract<SimEvent, { type: 'land' }> => e.type === 'land')!;
    expect(land.height).toBeCloseTo(c.top, 1);
    expect(sim.player.pos.y).toBe(0);
    expect(sim.player.land).toMatchObject({ total: LAND_TICKS_HIGH });
    // 立て直しの間は、押しても動かない。終わると歩ける
    const at = { ...sim.player.pos };
    run(sim, LAND_TICKS_HIGH - 1, () => frame({ moveX: 1, moveZ: 0 }));
    expect(sim.player.pos).toEqual(at);
    run(sim, 10, () => frame({ moveX: 1, moveZ: 0 }));
    expect(sim.player.land).toBeNull();
    expect(sim.player.pos.x).toBeGreaterThan(at.x);
  });

  it('低い段（0.3m）から歩いて降りても、降下にならない（立ち止まらない）', () => {
    // エリア 4 の低い段は、v0.49.0 から低い岩棚（1.1m）。0.3m の段はエリア 9
    const { sim } = atClimb('a9');
    const low = sim.field!.areas.find((a) => a.id === 'a9')!.platforms.find((p) => p.h === 0.3)!;
    sim.player.pos = { x: low.maxX - 0.4, y: 0.3, z: (low.minZ + low.maxZ) / 2 };
    sim.player.prevPos = { ...sim.player.pos };
    run(sim, 2);
    expect(sim.player.pos.y).toBe(0.3);
    const evs = run(sim, 60, () => frame({ moveX: 1, moveZ: 0 }));
    expect(evs.filter((e) => e.type === 'drop' || e.type === 'land')).toHaveLength(0);
    // 段を降りた先は地面（起伏の上。v0.46.0）に付いたまま
    expect(sim.player.pos.x).toBeGreaterThan(low.maxX + 1);
    expect(sim.player.grounded).toBe(true);
    expect(sim.player.pos.y).toBeCloseTo(sim.world.groundHeight(sim.player.pos.x, sim.player.pos.z), 9);
    expect(sim.player.land).toBeNull();
  });

  it('壁の高い所で手を離すと、その場から降下して着地で立て直す。低い所（1m 未満）で離すと、ただ下りる', () => {
    const hi = atClimb();
    run(hi.sim, 70, () => push(hi.c));
    expect(hi.sim.player.pos.y).toBeGreaterThan(1.1);
    run(hi.sim, 1, () => frame({ pressed: Btn.Dodge, held: Btn.Dodge }));
    expect(hi.sim.player.drop).not.toBeNull();
    const evs = run(hi.sim, 120);
    const land = evs.find((e): e is Extract<SimEvent, { type: 'land' }> => e.type === 'land')!;
    expect(land.height).toBeGreaterThan(1);
    expect(hi.sim.player.pos.y).toBe(0);
    const lo = atClimb();
    run(lo.sim, 30, () => push(lo.c));
    expect(lo.sim.player.pos.y).toBeLessThan(0.95);
    run(lo.sim, 1, () => frame({ pressed: Btn.Dodge, held: Btn.Dodge }));
    expect(lo.sim.player.drop).toBeNull();
    const lev = run(lo.sim, 60);
    expect(lev.filter((e) => e.type === 'land')).toHaveLength(0);
    expect(LAND_TICKS).toBeLessThan(LAND_TICKS_HIGH);
  });
});

describe('低い岩棚の乗り越え（#19 の H07 の低棚。v0.49.0）', () => {
  type Vault = Extract<SimEvent, { type: 'vault' }>;
  const vaults = (evs: SimEvent[]): string[] => evs.filter((e): e is Vault => e.type === 'vault').map((e) => `${e.phase}:${e.vaultId}`);
  /** エリア areaId の i 番目の帯の真ん中から back だけ手前（side だけ横）に、縁を向いて立たせる */
  function atVault(areaId = 'a4', i = 0, back = 0.6, side = 0): { sim: Simulation; v: VaultDef } {
    const sim = new Simulation(content, baseOptions({ questId: 'quest.basin.003', field: true }));
    const v = sim.field!.areas.find((a) => a.id === areaId)!.vaults![i]!;
    const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
    sim.player.pos = { x: v.x - fx * back + fz * side, y: 0, z: v.z - fz * back - fx * side };
    sim.player.prevPos = { ...sim.player.pos };
    sim.player.yaw = v.yaw;
    sim.areaId = areaId;
    run(sim, 2);
    expect(sim.areaId).toBe(areaId);
    return { sim, v };
  }
  const pushV = (v: VaultDef, toward = true): ReturnType<typeof frame> => frame({ moveX: Math.sin(v.yaw) * (toward ? 1 : -1), moveZ: Math.cos(v.yaw) * (toward ? 1 : -1) });
  /** (x, z) が、縁の面から何 m 内側か（帯の向き） */
  const inside = (v: VaultDef, x: number, z: number): number => (x - v.x) * Math.sin(v.yaw) + (z - v.z) * Math.cos(v.yaw) - v.faceDist;

  it('盆地のエリア 4 に 1 つ、エリア 10 に 2 つの低い岩棚（1.1m）があり、どれにも乗り越える帯がある。ほかのエリアには無い', () => {
    const f = content.fields.get('field.basin')!;
    for (const a of f.areas) {
      const ledges = a.platforms.filter((p) => p.h > a.stepUp && p.h <= 1.2);
      expect(ledges.length, a.id).toBe(a.id === 'a4' ? 1 : a.id === 'a10' ? 2 : 0);
      if (ledges.length === 0) {
        expect(a.vaults ?? [], a.id).toHaveLength(0);
        continue;
      }
      for (const q of ledges) {
        expect(q.h).toBe(1.1);
        // その棚に向き合う帯が 1 つ以上
        const facing = (a.vaults ?? []).filter((v) => {
          const x = v.x + Math.sin(v.yaw) * (v.faceDist + 0.3), z = v.z + Math.cos(v.yaw) * (v.faceDist + 0.3);
          return x > q.minX && x < q.maxX && z > q.minZ && z < q.maxZ;
        });
        expect(facing.length, `${a.id} ${JSON.stringify(q)}`).toBeGreaterThan(0);
      }
    }
  });

  it('帯で縁へ押すと、武器を納めて手を掛け、VAULT_TICKS で段の上（縁から内側）に立つ。間は落ちず、入力を受けない', () => {
    const { sim, v } = atVault();
    sim.player.drawn = true;
    const evs: SimEvent[] = [];
    let t = 0;
    while (sim.player.mode !== 'vault' && t++ < 30) {
      sim.step(pushV(v));
      evs.push(...sim.drainEvents());
    }
    expect(sim.player.mode).toBe('vault');
    expect(sim.player.drawn).toBe(false);
    expect(vaults(evs)).toEqual([`start:${v.id}`]);
    let last = sim.player.pos.y;
    const during: SimEvent[] = [];
    let n = 0;
    while (sim.player.mode === 'vault' && n++ < 60) {
      sim.step(frame({ moveX: -Math.sin(v.yaw), moveZ: -Math.cos(v.yaw), pressed: n === 4 ? Btn.Main : 0, held: Btn.Main }));
      during.push(...sim.drainEvents());
      expect(sim.player.pos.y).toBeGreaterThanOrEqual(last - 1e-9);
      last = sim.player.pos.y;
    }
    // 始めた tick を含めて VAULT_TICKS
    expect(n + 1).toBe(VAULT_TICKS);
    expect(vaults(during)).toEqual([`top:${v.id}`]);
    expect(during.filter((e) => e.type === 'action_start' && e.actor === 'player')).toHaveLength(0);
    expect(sim.player.mode).toBe('free');
    expect(sim.player.pos.y).toBe(v.top);
    expect(inside(v, sim.player.pos.x, sim.player.pos.z)).toBeCloseTo(VAULT_IN, 6);
    run(sim, 5);
    expect(sim.player.grounded).toBe(true);
    expect(sim.player.pos.y).toBe(v.top);
  });

  it('帯の外（角の近く）では、縁へ押しても乗り越えない（段は壁で、地面に居たまま）', () => {
    const { sim, v } = atVault('a4', 0, 0.6, 0);
    const end = v.width / 2 + 0.6;
    const off = atVault('a4', 0, 0.6, end);
    const evs = run(off.sim, 60, () => pushV(off.v));
    expect(vaults(evs)).toHaveLength(0);
    expect(off.sim.player.pos.y).toBe(0);
    expect(inside(off.v, off.sim.player.pos.x, off.sim.player.pos.z)).toBeLessThanOrEqual(1e-6);
    // 帯から縁と平行に押しても（縁へ向かっていない）、乗り越えない
    const along = frame({ moveX: Math.cos(v.yaw), moveZ: -Math.sin(v.yaw) });
    expect(vaults(run(sim, 20, () => along))).toHaveLength(0);
  });

  it('乗り越える途中で攻撃を受けると、縁の前へ落とされる（段の中・縁の上へは出ない）。段の縁から歩いて出ると降下して、着地で立て直す', () => {
    const { sim, v } = atVault();
    run(sim, 40, () => (sim.player.mode === 'vault' && (sim.player.vault?.t ?? 0) >= 16 ? frame() : pushV(v)));
    // 押し上げている途中（16 tick 目）で止めて当てる
    const hit = atVault();
    let k = 0;
    while (!(hit.sim.player.mode === 'vault' && hit.sim.player.vault!.t >= 16) && k++ < 60) hit.sim.step(pushV(hit.v));
    hit.sim.drainEvents();
    expect(hit.sim.player.pos.y).toBeGreaterThan(0.3);
    // 段の側から当たる（吹き飛ぶ向きは段から離れる向き）
    const fx = Math.sin(hit.v.yaw), fz = Math.cos(hit.v.yaw);
    const out = resolveIncomingHit(hit.sim.player, { attackerPos: { x: hit.v.x + fx * (hit.v.faceDist + 8), y: 0, z: hit.v.z + fz * (hit.v.faceDist + 8) }, baseDamage: 10, guardable: true, guardCost: 10, reaction: 'knockdown' }, hit.sim);
    expect(out).toBe('hit');
    expect(vaults(hit.sim.drainEvents())).toEqual([`release:${hit.v.id}`]);
    expect(hit.sim.player.vault).toBeNull();
    expect(inside(hit.v, hit.sim.player.pos.x, hit.sim.player.pos.z)).toBeCloseTo(-0.36, 6);
    run(hit.sim, 200);
    expect(inside(hit.v, hit.sim.player.pos.x, hit.sim.player.pos.z)).toBeLessThan(0);
    expect(hit.sim.player.grounded).toBe(true);
    expect(hit.sim.player.pos.y).toBeLessThan(0.3);
    expect(hit.sim.player.pos.y).toBeCloseTo(hit.sim.world.groundHeight(hit.sim.player.pos.x, hit.sim.player.pos.z), 9);
    // 乗り越えた後、段の縁（帯の向きと逆）へ歩いて出ると、1.1m を降下して着地（短い立て直し）
    expect(sim.player.pos.y).toBe(v.top);
    const evs: SimEvent[] = [];
    for (let i = 0; i < 90 && !evs.some((e) => e.type === 'land'); i++) {
      sim.step(pushV(v, false));
      evs.push(...sim.drainEvents());
    }
    expect(evs.find((e) => e.type === 'drop')).toMatchObject({ from: v.top });
    const land = evs.find((e): e is Extract<SimEvent, { type: 'land' }> => e.type === 'land')!;
    expect(land.height).toBeCloseTo(v.top, 1);
    expect(sim.player.land).toMatchObject({ total: LAND_TICKS });
    expect(sim.player.pos.y).toBe(0);
  });

  it('大型（胴の半径 1.5m）は低い岩棚へ上がれない（壁）。群れの居場所は段の上と縁に置かれない', () => {
    const { sim, v } = atVault('a10', 0);
    const pos = { x: v.x - Math.sin(v.yaw) * 2, y: 0, z: v.z - Math.cos(v.yaw) * 2 };
    for (let i = 0; i < 80; i++) sim.world.move(pos, 1.5, Math.sin(v.yaw) * 0.1, Math.cos(v.yaw) * 0.1);
    expect(pos.y).toBe(0);
    expect(inside(v, pos.x, pos.z)).toBeLessThanOrEqual(1e-6);
    // 群れ（v0.18.0）: 長く進めても、居場所（中心）が歩いて上がれない段の 2.5m 以内に入らない
    const f = sim.field!;
    for (let i = 0; i < 6000; i++) {
      sim.step(frame());
      sim.drainEvents();
      if (i % 50 !== 0) continue;
      for (const g of sim.herds) {
        const a = f.areas.find((x) => x.id === g.areaId)!;
        for (const q of a.platforms) {
          if (q.h <= a.stepUp) continue;
          const dx = Math.max(q.minX - g.anchor.x, g.anchor.x - q.maxX, 0), dz = Math.max(q.minZ - g.anchor.z, g.anchor.z - q.maxZ, 0);
          expect(Math.hypot(dx, dz), `${g.areaId} ${i}`).toBeGreaterThan(2.4);
        }
      }
    }
    expect(groundAt(f.areas.find((a) => a.id === 'a10')!.platforms, v.x, v.z)).toBe(0);
  });

  it('大型は、向こう側へ歩く時に低い岩棚を回り込む（段の中へ入らず、引っかからない）', () => {
    const { sim } = atVault('a10', 3);
    const area = sim.field!.areas.find((a) => a.id === 'a10')!;
    const m = sim.monsters[0]!;
    const r = m.def.bodyRadius;
    // 低い岩棚のどれかを、横切る向き（x か z）で、両端がエリアの中に入る 2 点を探す
    let pick: { q: (typeof area.platforms)[number]; from: { x: number; z: number }; to: { x: number; z: number } } | null = null;
    for (const q of area.platforms.filter((p) => p.h === 1.1)) {
      const cx = (q.minX + q.maxX) / 2, cz = (q.minZ + q.maxZ) / 2, g = r + 4;
      for (const [from, to] of [[{ x: cx, z: q.minZ - g }, { x: cx, z: q.maxZ + g }], [{ x: q.minX - g, z: cz }, { x: q.maxX + g, z: cz }]] as const) {
        if (!pick && sim.world.inArea(area, from.x, from.z, r + 1) && sim.world.inArea(area, to.x, to.z, r + 1)) pick = { q, from, to };
      }
    }
    expect(pick).not.toBeNull();
    const { q, from, to } = pick!;
    m.pos = { x: from.x, y: 0, z: from.z };
    m.yaw = 0;
    let n = 0;
    for (; n < 900 && Math.hypot(m.pos.x - to.x, m.pos.z - to.z) > 1; n++) {
      m.yaw = headingTo(m, to.x, to.z, sim);
      const f = forwardOf(m.yaw);
      const step = Math.min(0.1, Math.hypot(m.pos.x - to.x, m.pos.z - to.z));
      sim.world.move(m.pos, r, f.x * step, f.z * step);
      // 胴の中心は段の中へ入らない
      expect(m.pos.x > q.minX && m.pos.x < q.maxX && m.pos.z > q.minZ && m.pos.z < q.maxZ).toBe(false);
    }
    expect(Math.hypot(m.pos.x - to.x, m.pos.z - to.z)).toBeLessThanOrEqual(1);
    // まっすぐなら 30m ほど。回り込んでも 2 倍まで（0.1m / tick）
    expect(n).toBeLessThan(600);
  });

  it('同じ入力なら、同じ乗り越え方（状態の指紋が同じ）', () => {
    const a = atVault('a10', 3);
    const b = atVault('a10', 3);
    const input = (i: number): ReturnType<typeof frame> => (i < 12 ? pushV(a.v) : frame());
    run(a.sim, 14, input);
    run(b.sim, 14, input);
    expect(a.sim.player.mode).toBe('vault');
    expect(a.sim.hash()).toBe(b.sim.hash());
    run(a.sim, 40, input);
    run(b.sim, 40, input);
    expect(a.sim.hash()).toBe(b.sim.hash());
    expect(a.sim.player.pos.y).toBe(a.v.top);
  });
});
