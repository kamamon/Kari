// 登攀（v0.44.0。#19 の H07。docs/spec.md の 32.9）: 登り口で壁へ押すと取り付き、登り切って上の段に立つ。上から下りる・手を離す・落とされる。
// 盆地のエリア 4・9 の 3m の棚（tools/gen-field.py が作る。設計の a4_climb_01・a9_climb_01）。値は Kari の仮の値。
import { beforeAll, describe, expect, it } from 'vitest';
import type { ClimbDef, Content } from '../src/data/schemas';
import type { SimEvent } from '../src/game/events';
import { CLIMB_EXIT_BELOW, CLIMB_UP, resolveIncomingHit } from '../src/game/player';
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
