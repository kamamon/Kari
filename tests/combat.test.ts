import { beforeAll, describe, expect, it } from 'vitest';
import type { Content } from '../src/data/schemas';
import { computeDamage } from '../src/game/combat';
import { isInvulnerable } from '../src/game/player';
import { Simulation } from '../src/game/sim';
import { Btn, baseOptions, frame, hold, loadContent, placeInFrontOfHead, press, run } from './helpers';

let content: Content;
beforeAll(async () => {
  content = await loadContent();
});

const OVERHEAD = 'player.heavy_blade.overhead';
const SIDE = 'player.heavy_blade.side_sweep';
const ROLL = 'player.common.roll';

describe('ダメージ式（設計書 p.10）', () => {
  it('設計書の計算例が 37 になる', () => {
    // 80 × 0.75 × 1.0 × 0.60 × 1.0 + 12 × 0.5 × 0.20 = 37.2 → 37
    expect(
      computeDamage({ attack: 80, motion: 0.75, sharpness: 1, hitzone: 0.6, crit: 1, element: 12, elementMotion: 0.5, elementZone: 0.2, questModifier: 1 }),
    ).toBe(37);
  });
  it('完全無効は 0、有効な攻撃の下限は 1', () => {
    const base = { attack: 80, motion: 1, sharpness: 1, crit: 1, element: 0, elementMotion: 1, elementZone: 0, questModifier: 1 };
    expect(computeDamage({ ...base, hitzone: 0 })).toBe(0);
    expect(computeDamage({ ...base, attack: 1, hitzone: 0.01 })).toBe(1);
  });
});

describe('断岳剣・縦斬り', () => {
  it('技データが設計書の値で入っている', () => {
    const a = content.actions.get(OVERHEAD)!;
    expect(a.durationTicks).toBe(72);
    expect(a.phases).toEqual([
      { id: 'startup', from: 0, to: 22 },
      { id: 'active', from: 22, to: 30 },
      { id: 'recovery', from: 30, to: 72 },
    ]);
    expect(a.hitWindows[0]).toMatchObject({ id: 'blade_main', from: 22, to: 30, damageCoefficient: 1.0, maxHitsPerTarget: 1, hitstopTicks: 4 });
    expect(a.cancelWindows).toEqual([{ from: 58, to: 72, into: ['roll'] }]);
    expect(a.turning).toEqual({ untilTick: 10, maxDegreesPerSecond: 90 });
  });

  it('有効判定 [22,30) の間にだけ当たり、単発で 1 回だけ加算される', () => {
    const sim = new Simulation(content, baseOptions());
    placeInFrontOfHead(sim);
    const events = run(sim, 100, (i) => (i === 0 ? press(Btn.Main) : frame()));
    const hits = events.filter((e) => e.type === 'hit');
    expect(hits).toHaveLength(1);
    const h = sim.recentHits[0]!;
    expect(h.actionTick).toBeGreaterThanOrEqual(22);
    expect(h.actionTick).toBeLessThan(30);
    expect(h.partId).toBe('head');
    // 80 × 1.0 × 1.0 × 0.70 = 56
    expect(h.damage).toBe(56);
    expect(sim.monsters[0]!.hp).toBe(1200 - 56);
  });

  it('届かない距離の空振りは命中しない', () => {
    const sim = new Simulation(content, baseOptions());
    placeInFrontOfHead(sim, 6);
    const events = run(sim, 100, (i) => (i === 0 ? press(Btn.Main) : frame()));
    expect(events.filter((e) => e.type === 'hit')).toHaveLength(0);
    expect(sim.monsters[0]!.hp).toBe(1200);
    // 振り音は鳴る（空振りは振り音だけ）
    expect(events.some((e) => e.type === 'action_event' && e.kind === 'sound' && e.id === 'hb_swing_01')).toBe(true);
  });

  it('ヒットストップの分だけ行動時間が止まる（72 + 4 tick で終わる）', () => {
    const sim = new Simulation(content, baseOptions());
    placeInFrontOfHead(sim);
    sim.step(press(Btn.Main));
    let n = 1;
    while (sim.player.mode === 'action' && n < 200) {
      sim.step(frame());
      n++;
    }
    expect(n).toBe(72 + 4);
  });

  it('連打しても行動が最初へ戻らない', () => {
    const sim = new Simulation(content, baseOptions());
    placeInFrontOfHead(sim, 6);
    // 60 tick の間 3 tick ごとに連打（先行入力は 66 より前に切れる）
    // 押してすぐ離す連打（長押しにすると溜めになるため）
    const events = run(sim, 71, (i) => (i % 3 === 0 && i <= 60 ? frame({ pressed: Btn.Main }) : frame()));
    const starts = events.filter((e) => e.type === 'action_start' && e.actionId === OVERHEAD);
    expect(starts).toHaveLength(1);
    expect(sim.player.action?.tick).toBe(71);
  });

  it('回避キャンセルは [58,72) でだけ働く', () => {
    const tryAt = (pressTick: number): number | null => {
      const sim = new Simulation(content, baseOptions());
      placeInFrontOfHead(sim, 6);
      for (let i = 0; i < 120; i++) {
        const inp = i === 0 ? press(Btn.Main) : i === pressTick ? press(Btn.Dodge) : frame();
        sim.step(inp);
        const ev = sim.drainEvents().find((e) => e.type === 'action_start' && e.actionId === ROLL);
        if (ev) return i;
      }
      return null;
    };
    // 40 tick 目の入力は 6 tick の先行入力が切れて無効
    expect(tryAt(40)).toBeNull();
    // 54 tick 目の入力は 58 tick 目まで残り、区間の頭で回避へ移る
    expect(tryAt(54)).toBe(58);
    // 区間内はその場で受け付ける
    expect(tryAt(63)).toBe(63);
  });

  it('溜め: 押し続けると holdTick で止まり、段階に応じて威力が上がる', () => {
    const sim = new Simulation(content, baseOptions());
    placeInFrontOfHead(sim);
    // 18 tick で溜め開始、60 tick 溜めて段階 2 → 離す
    const events = run(sim, 200, (i) => (i === 0 ? press(Btn.Main) : i < 18 + 62 ? hold(Btn.Main) : frame()));
    const levels = events.filter((e) => e.type === 'charge_level').map((e) => (e.type === 'charge_level' ? e.level : 0));
    expect(levels).toEqual([1, 2]);
    const h = sim.recentHits[0]!;
    // 80 × (1.0 × 1.65) × 0.70 = 92.4 → 92
    expect(h.damage).toBe(92);
    expect(h.actionTick).toBeGreaterThanOrEqual(22);
  });
});

describe('横薙ぎ', () => {
  it('複数の部位に触れても本体への加算は 1 回', () => {
    const sim = new Simulation(content, baseOptions());
    const m = sim.monsters[0]!;
    // 標的の真横（脚と胴の両方に刃が通る位置）
    sim.player.pos = { x: m.pos.x + 2.3, y: 0, z: m.pos.z };
    sim.player.yaw = -Math.PI / 2;
    sim.player.drawn = true;
    const events = run(sim, 90, (i) => (i === 0 ? press(Btn.Sub) : frame()));
    const hits = events.filter((e) => e.type === 'hit');
    expect(hits).toHaveLength(1);
    expect(sim.hitCount).toBe(1);
  });

  it('横薙ぎ → 縦斬りの連係は [44,66) で受け付ける', () => {
    const sim = new Simulation(content, baseOptions());
    placeInFrontOfHead(sim, 6);
    let startedAt = -1;
    for (let i = 0; i < 80; i++) {
      sim.step(i === 0 ? press(Btn.Sub) : i === 30 || i === 46 ? press(Btn.Main) : frame());
      if (sim.drainEvents().some((e) => e.type === 'action_start' && e.actionId === OVERHEAD)) startedAt = i;
    }
    expect(sim.content.actions.get(SIDE)!.cancelWindows[0]).toMatchObject({ from: 44, to: 66 });
    expect(startedAt).toBe(46);
  });
});

describe('回避', () => {
  it('開始時にスタミナ 25 を消費し、無敵は [3,11) tick だけ', () => {
    const sim = new Simulation(content, baseOptions({ monsterId: null }));
    const inv: number[] = [];
    for (let i = 0; i < 40; i++) {
      sim.step(i === 0 ? press(Btn.Dodge) : frame());
      if (i === 0) expect(sim.player.stamina).toBe(75);
      if (isInvulnerable(sim.player)) inv.push(i);
    }
    expect(inv).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
    expect(sim.player.mode).toBe('free');
  });

  it('36 tick で 3.4m 進み、壁は抜けない', () => {
    const sim = new Simulation(content, baseOptions({ monsterId: null }));
    const z0 = sim.player.pos.z;
    run(sim, 36, (i) => (i === 0 ? press(Btn.Dodge) : frame()));
    expect(sim.player.pos.z - z0).toBeCloseTo(3.4, 5);
    // 南の壁へ向かって何度転がっても外へ出ない
    const b = sim.world.map.bounds;
    run(sim, 600, (i) => frame({ moveZ: -1, pressed: i % 50 === 0 ? Btn.Dodge : 0 }));
    expect(sim.player.pos.z).toBeGreaterThanOrEqual(b.minZ + content.player.radius - 1e-9);
  });

  it('スタミナが足りなければ回避できない', () => {
    const sim = new Simulation(content, baseOptions({ monsterId: null }));
    sim.player.stamina = 20;
    const events = run(sim, 3, (i) => (i === 0 ? press(Btn.Dodge) : frame()));
    expect(events.some((e) => e.type === 'stamina_empty')).toBe(true);
    expect(sim.player.mode).toBe('free');
  });
});

describe('先行入力', () => {
  it('6 tick 以内の入力は行動終了後に実行され、7 tick 前の入力は消える', () => {
    const after = (pressTick: number): boolean => {
      const sim = new Simulation(content, baseOptions({ monsterId: null }));
      // 回避 36 tick。終了は 36 tick 目。
      const events = run(sim, 60, (i) => (i === 0 ? press(Btn.Dodge) : i === pressTick ? press(Btn.Weapon) : frame()));
      return events.some((e) => e.type === 'action_start' && e.actionId === 'player.heavy_blade.draw');
    };
    expect(after(31)).toBe(true);
    expect(after(29)).toBe(false);
  });
});

describe('訓練標的の攻撃を受ける', () => {
  const setup = (): Simulation => {
    const sim = new Simulation(content, baseOptions({ monsterAttacks: true }));
    const m = sim.monsters[0]!;
    m.cooldown = 0;
    sim.player.pos = { x: m.pos.x + 0.6, y: 0, z: m.pos.z - 2.4 };
    sim.player.yaw = 0;
    sim.player.drawn = true;
    return sim;
  };

  it('無防備なら 1 回だけ被弾して転倒する', () => {
    const sim = setup();
    const events = run(sim, 200);
    const hurts = events.filter((e) => e.type === 'player_hurt');
    expect(hurts).toHaveLength(1);
    expect(sim.player.hp).toBe(100 - 24);
  });

  it('正面で防御すると削りダメージとスタミナ消費で受け止める', () => {
    const sim = setup();
    const events = [];
    let staminaAtGuard = -1;
    for (let i = 0; i < 120; i++) {
      sim.step(hold(Btn.Special));
      const evs = sim.drainEvents();
      if (evs.some((e) => e.type === 'guard')) staminaAtGuard = sim.player.stamina;
      events.push(...evs);
    }
    expect(events.filter((e) => e.type === 'guard')).toHaveLength(1);
    expect(events.some((e) => e.type === 'player_hurt')).toBe(false);
    expect(sim.player.hp).toBe(100 - 6);
    expect(staminaAtGuard).toBe(100 - 30);
  });

  it('背を向けた防御は成立しない', () => {
    const sim = setup();
    sim.player.yaw = Math.PI;
    const events = run(sim, 120, () => hold(Btn.Special));
    expect(events.some((e) => e.type === 'guard')).toBe(false);
    expect(events.filter((e) => e.type === 'player_hurt')).toHaveLength(1);
  });

  it('スタミナ不足の防御は崩される', () => {
    const sim = setup();
    sim.player.stamina = 10;
    sim.player.staminaDelay = 100000;
    const events = run(sim, 120, () => hold(Btn.Special));
    expect(events.filter((e) => e.type === 'guard_break')).toHaveLength(1);
    expect(sim.player.hp).toBe(100 - 16);
  });

  it('無敵区間を合わせた回避ですり抜ける', () => {
    const sim = setup();
    let slamStart = -1;
    const events = [];
    for (let i = 0; i < 200; i++) {
      // 攻撃判定 [50,58) に無敵 [3,11) を重ねる → 攻撃開始から 47 tick 後に回避
      const inp = slamStart >= 0 && i === slamStart + 47 ? frame({ pressed: Btn.Dodge, moveZ: 1 }) : frame();
      sim.step(inp);
      const evs = sim.drainEvents();
      if (slamStart < 0 && evs.some((e) => e.type === 'action_start' && e.actor === 'monster#1')) slamStart = i;
      events.push(...evs);
    }
    expect(slamStart).toBeGreaterThanOrEqual(0);
    expect(events.some((e) => e.type === 'evade')).toBe(true);
    expect(events.some((e) => e.type === 'player_hurt')).toBe(false);
    expect(sim.player.hp).toBe(100);
  });

  it('攻撃開始後は追尾を止める（旋回は 30 tick まで）', () => {
    const sim = setup();
    const m = sim.monsters[0]!;
    let started = -1;
    let yawAt30 = 0;
    for (let i = 0; i < 140; i++) {
      // 標的の周りを横へ走り続ける
      sim.step(frame({ moveX: 1 }));
      if (started < 0 && sim.drainEvents().some((e) => e.type === 'action_start' && e.actor === 'monster#1')) started = i;
      if (started >= 0 && i === started + 30) yawAt30 = m.yaw;
      if (started >= 0 && i > started + 30 && i < started + 129) expect(m.yaw).toBe(yawAt30);
      // 旋回の打ち切りは行動 tick 30。開始 tick に 0 tick 目を処理するので、30 tick 後の向きが最終。
    }
    expect(started).toBeGreaterThanOrEqual(0);
  });
});

describe('部位と本体 HP', () => {
  it('部位の耐久は本体 HP と別に減り、破壊で怯む。倒れたら復帰する', () => {
    const sim = new Simulation(content, baseOptions());
    placeInFrontOfHead(sim);
    const m = sim.monsters[0]!;
    const events = run(sim, 1500, (i) => (i % 90 === 0 ? press(Btn.Main) : frame()));
    const breaks = events.filter((e) => e.type === 'part_break');
    expect(breaks.map((e) => (e.type === 'part_break' ? e.partId : ''))).toEqual(['head']);
    expect(m.parts[0]!.broken).toBe(true);
    expect(m.hp).toBeLessThan(1200);
    // 残り HP を直接削って死亡 → 終端状態 → 300 tick 後に復帰
    m.hp = 10;
    const ev2 = run(sim, 700, (i) => (i % 90 === 0 && i <= 180 ? press(Btn.Main) : frame()));
    expect(ev2.filter((e) => e.type === 'monster_dead')).toHaveLength(1);
    expect(ev2.filter((e) => e.type === 'monster_respawn')).toHaveLength(1);
    expect(m.hp).toBe(1200);
    expect(m.parts[0]!.broken).toBe(false);
  });
});
