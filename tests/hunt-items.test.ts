// M2 後半: 道具（回復・罠・鎮静玉）、捕獲、剥ぎ取り、報酬の確定。
import { beforeAll, describe, expect, it } from 'vitest';
import type { Content } from '../src/data/schemas';
import type { SimEvent } from '../src/game/events';
import type { InputFrame } from '../src/game/inputFrame';
import { applyDamageToMonster, isWeak, type MonsterState } from '../src/game/monster';
import { resolveIncomingHit } from '../src/game/player';
import { firstMismatch, runReplay } from '../src/game/replay';
import { Simulation } from '../src/game/sim';
import { Btn, baseOptions, frame, loadContent, press, run } from './helpers';

let content: Content;
beforeAll(async () => {
  content = await loadContent();
});

const QUEST = 'quest.basin.003';
const HEAL = 'item.heal_tonic', TRAP = 'item.bind_trap', ORB = 'item.calm_orb';
const hunt = (seed = 12345): Simulation => new Simulation(content, baseOptions({ questId: QUEST, seed }));
const count = (sim: Simulation, id: string): number => sim.player.items.find((s) => s.itemId === id)!.count;
const select = (sim: Simulation, id: string): void => {
  sim.player.itemIndex = sim.player.items.findIndex((s) => s.itemId === id);
};
const of = <T extends SimEvent['type']>(ev: SimEvent[], type: T): Extract<SimEvent, { type: T }>[] => ev.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);

/** ガルドロスを (0,10) に -Z 向き（プレイヤーの方）で置く。AI は止めておく。 */
function arena(seed = 12345): { sim: Simulation; m: MonsterState } {
  const sim = hunt(seed);
  const m = sim.monsters[0]!;
  m.pos = { x: 0, y: 0, z: 10 };
  m.prevPos = { ...m.pos };
  m.yaw = Math.PI;
  m.aware = true;
  m.aiEnabled = false;
  sim.player.pos = { x: 0, y: 0, z: 4 };
  sim.player.prevPos = { ...sim.player.pos };
  sim.player.yaw = 0;
  return { sim, m };
}
/** 道具を 1 回使い切るまで進める（押す → 行動が終わる） */
function useItem(sim: Simulation, id: string): SimEvent[] {
  select(sim, id);
  const ev = run(sim, 1, () => press(Btn.Item));
  ev.push(...run(sim, 130));
  return ev;
}
const weaken = (m: MonsterState, sim: Simulation): void => {
  applyDamageToMonster(m, m.def.parts.findIndex((p) => p.id === 'body'), m.hp - Math.floor(m.def.hp * 0.2), 'blunt', sim);
  m.staggerTicks = 0;
  sim.drainEvents();
};

describe('支給品と道具', () => {
  it('依頼の支給品を持って出発する（フィールドで大型を狩る依頼には標識玉 2 も。v0.42.0）。訓練場では研磨石だけを持つ。環弓は研磨石を持たない', () => {
    const sim = hunt();
    expect(sim.player.items).toEqual([{ itemId: HEAL, count: 5 }, { itemId: TRAP, count: 1 }, { itemId: ORB, count: 3 }, { itemId: 'item.whetstone', count: 3 }]);
    expect(new Simulation(content, baseOptions({ questId: QUEST, field: true })).player.items).toEqual([...sim.player.items, { itemId: 'item.marker_orb', count: 2 }]);
    expect(new Simulation(content, baseOptions()).player.items).toEqual([{ itemId: 'item.whetstone', count: 10 }]);
    expect(new Simulation(content, baseOptions({ questId: QUEST, weaponId: 'weapon.ring_bow.001' })).player.items.map((s) => s.itemId)).toEqual([HEAL, TRAP, ORB]);
    expect(new Simulation(content, baseOptions({ weaponId: 'weapon.ring_bow.001' })).player.items).toEqual([]);
    // 群れの依頼・狩らない依頼には足さない
    const kinds = new Set<string>();
    for (const q of content.quests.values()) {
      if (!q.fieldId || (q.kind !== 'gather' && !q.targets)) continue;
      kinds.add(q.kind === 'gather' ? 'gather' : 'herd');
      expect(new Simulation(content, baseOptions({ questId: q.id, field: true })).player.items.some((s) => s.itemId === 'item.marker_orb'), q.id).toBe(false);
    }
    // v0.75.0: 群れの依頼は、いまは無い（白紙にした幼体を外した。D-175）
    expect([...kinds].sort()).toEqual(['gather']);
  });

  it('道具の切り替えは端で回り込む', () => {
    const sim = hunt();
    run(sim, 1, () => press(Btn.ItemNext));
    expect(sim.player.itemIndex).toBe(1);
    run(sim, 1, () => press(Btn.ItemPrev));
    run(sim, 1, () => press(Btn.ItemPrev));
    expect(sim.player.itemIndex).toBe(sim.player.items.length - 1);
  });

  it('回復液: 飲み終わる tick で 40 回復して 1 個減る。上限は超えない', () => {
    const sim = hunt();
    sim.player.hp = 30;
    select(sim, HEAL);
    let ev = run(sim, 1, () => press(Btn.Item));
    expect(of(ev, 'item_use')).toHaveLength(1);
    // effectTick 58: 押した tick が行動の 0 なので、あと 57 tick では まだ
    ev = run(sim, 57);
    expect(sim.player.hp).toBe(30);
    expect(count(sim, HEAL)).toBe(5);
    ev = run(sim, 1);
    expect(sim.player.hp).toBe(70);
    expect(count(sim, HEAL)).toBe(4);
    expect(of(ev, 'item_effect')[0]).toMatchObject({ kind: 'heal', ok: true, amount: 40 });
    // 飲み終わった後の決め姿勢（v0.40.0。2G）: 124 tick まで動けない
    run(sim, 60);
    expect(sim.player.mode).toBe('action');
    expect(sim.player.action?.def.actionId).toBe('player.item.drink');
    run(sim, 6);
    expect(sim.player.mode).toBe('free');
    sim.player.hp = 90;
    useItem(sim, HEAL);
    expect(sim.player.hp).toBe(100);
    expect(count(sim, HEAL)).toBe(3);
  });

  it('飲んでいる途中で攻撃を受けると、回復せず、道具も減らない', () => {
    const sim = hunt();
    sim.player.hp = 50;
    select(sim, HEAL);
    run(sim, 1, () => press(Btn.Item));
    run(sim, 30);
    resolveIncomingHit(sim.player, { attackerPos: { x: 0, y: 0, z: 5 }, baseDamage: 10, guardable: true, guardCost: 10, reaction: 'flinch' }, sim);
    run(sim, 120);
    expect(sim.player.hp).toBe(40);
    expect(count(sim, HEAL)).toBe(5);
    expect(sim.player.itemUse).toBeNull();
  });

  it('抜刀中に道具ボタンを押すと、納刀するだけ（v0.40.0。2G）。使うのは、納刀した後にもう 1 度押した時', () => {
    const sim = hunt();
    sim.player.drawn = true;
    sim.player.hp = 50;
    select(sim, HEAL);
    const ev = run(sim, 1, () => press(Btn.Item));
    expect(ev.some((e) => e.type === 'action_start' && e.actionId.endsWith('sheathe'))).toBe(true);
    const later = run(sim, 160);
    expect(of(later, 'item_use')).toHaveLength(0);
    expect(sim.player.drawn).toBe(false);
    expect(sim.player.hp).toBe(50);
    expect(count(sim, HEAL)).toBe(5);
    // 納刀した後に、もう 1 度押す
    const use = run(sim, 1, () => press(Btn.Item));
    expect(of(use, 'item_use')).toHaveLength(1);
    run(sim, 130);
    expect(sim.player.hp).toBe(90);
    expect(count(sim, HEAL)).toBe(4);
  });

  it('納刀の終わり際（先行入力の 6 tick 以内）に押した道具は、納刀が終わった tick に使い始める（1 回の押下は 1 回だけ）', () => {
    const sim = hunt();
    sim.player.drawn = true;
    sim.player.hp = 50;
    select(sim, HEAL);
    run(sim, 1, () => press(Btn.Item)); // 納刀を始める（断岳剣の納刀は 44 tick）
    run(sim, 40);
    expect(sim.player.action?.def.actionId).toBe('player.heavy_blade.sheathe');
    const ev = run(sim, 1, () => press(Btn.Item)); // 残り 3 tick の所で押す
    expect(of(ev, 'item_use')).toHaveLength(0);
    const later = run(sim, 8);
    expect(of(later, 'item_use')).toHaveLength(1);
    const rest = run(sim, 200);
    expect(of(rest, 'item_use')).toHaveLength(0);
    expect(count(sim, HEAL)).toBe(4);
  });

  it('数が 0 の道具は使えない', () => {
    const sim = hunt();
    select(sim, TRAP);
    sim.player.items[1]!.count = 0;
    const ev = run(sim, 1, () => press(Btn.Item));
    expect(of(ev, 'item_fail')[0]).toMatchObject({ reason: 'empty' });
    expect(sim.player.mode).toBe('free');
  });
});

describe('罠と鎮静玉', () => {
  it('罠は足元の前に置かれ、少しして作動可能になる。大型が踏むと動きを止め、時間が過ぎると解ける', () => {
    const { sim, m } = arena();
    let ev = useItem(sim, TRAP);
    expect(count(sim, TRAP)).toBe(0);
    expect(sim.traps).toHaveLength(1);
    // 置いた直後はまだ作動しない（60 tick かかる）
    expect(sim.traps[0]!.state).toBe('arming');
    expect(sim.traps[0]!.z).toBeCloseTo(4.9, 5);
    ev = run(sim, 20);
    expect(sim.traps[0]!.state).toBe('armed');
    expect(of(ev, 'trap_armed')).toHaveLength(1);
    // 遠い間は作動しない
    run(sim, 30);
    expect(m.trapTicks).toBe(0);
    m.pos = { x: 0, y: 0, z: 6.5 };
    ev = run(sim, 1);
    expect(of(ev, 'trap_trigger')[0]).toMatchObject({ target: m.id, ticks: 540 });
    expect(sim.traps[0]!.state).toBe('holding');
    // 止まっている間は技を出さない
    m.aiEnabled = true;
    m.cooldown = 0;
    ev = run(sim, 538);
    expect(ev.some((e) => e.type === 'action_start' && e.actor === m.id)).toBe(false);
    expect(m.trapTicks).toBe(2);
    ev = run(sim, 2);
    expect(m.trapTicks).toBe(0);
    expect(of(ev, 'trap_end')).toHaveLength(1);
    expect(sim.traps).toHaveLength(0);
  });

  it('罠は同時に 1 つまで。狩猟が終わった後は置けない', () => {
    const { sim } = arena();
    sim.player.items[1]!.count = 2;
    useItem(sim, TRAP);
    const ev = run(sim, 1, () => press(Btn.Item));
    expect(of(ev, 'item_fail')[0]).toMatchObject({ reason: 'not_now' });
    expect(count(sim, TRAP)).toBe(1);
  });

  it('鎮静玉は正面 7m 以内の大型に当たる。外しても 1 個減る。効き目は 900 tick で消える', () => {
    const { sim, m } = arena();
    let ev = useItem(sim, ORB);
    expect(of(ev, 'item_effect')[0]).toMatchObject({ kind: 'tranq', ok: true, amount: 1 });
    expect(m.tranq).toBe(1);
    expect(count(sim, ORB)).toBe(2);
    // 背を向けて投げると当たらない
    sim.player.yaw = Math.PI;
    ev = useItem(sim, ORB);
    expect(of(ev, 'item_effect')[0]).toMatchObject({ ok: false });
    expect(m.tranq).toBe(1);
    expect(count(sim, ORB)).toBe(1);
    run(sim, 900);
    expect(m.tranq).toBe(0);
  });
});

describe('捕獲', () => {
  /** 弱らせて、罠にかけた状態を作る */
  function trapped(): { sim: Simulation; m: MonsterState } {
    const a = arena();
    weaken(a.m, a.sim);
    useItem(a.sim, TRAP);
    run(a.sim, 20);
    a.m.pos = { x: 0, y: 0, z: 6.5 };
    run(a.sim, 1);
    expect(a.m.trapTicks).toBeGreaterThan(0);
    return a;
  }

  it('弱っている合図（見た目）と捕獲の条件は、同じ割合（体力 25% 以下）を使う', () => {
    const { sim, m } = arena();
    expect(isWeak(m)).toBe(false);
    applyDamageToMonster(m, 0, m.hp - m.def.hp * 0.25 - 1, 'blunt', sim);
    expect(isWeak(m)).toBe(false);
    applyDamageToMonster(m, 0, 1, 'blunt', sim);
    expect(isWeak(m)).toBe(true);
  });

  it('弱っていて、罠にかかっていて、鎮静玉が 2 個たまると捕獲。依頼は「捕獲」で達成になる', () => {
    const { sim, m } = trapped();
    let ev = useItem(sim, ORB);
    expect(m.captured).toBe(false);
    ev = useItem(sim, ORB);
    expect(m.captured).toBe(true);
    expect(of(ev, 'monster_captured')).toHaveLength(1);
    expect(of(ev, 'hunt_end')[0]).toMatchObject({ phase: 'success', reason: 'capture' });
    // 捕獲した相手は、もうダメージを受けない
    const hp = m.hp;
    applyDamageToMonster(m, 0, 500, 'cut', sim);
    expect(m.hp).toBe(hp);
    expect(m.dead).toBe(false);
  });

  it('弱っていない相手は、罠と鎮静玉がそろっても捕獲にならない。罠が解けた後もならない', () => {
    const a = arena();
    useItem(a.sim, TRAP);
    run(a.sim, 20);
    a.m.pos = { x: 0, y: 0, z: 6.5 };
    run(a.sim, 1);
    expect(a.m.trapTicks).toBeGreaterThan(0);
    useItem(a.sim, ORB);
    useItem(a.sim, ORB);
    expect(a.m.tranq).toBe(2);
    expect(a.m.captured).toBe(false);

    const b = trapped();
    b.m.trapTicks = 1;
    run(b.sim, 3);
    useItem(b.sim, ORB);
    useItem(b.sim, ORB);
    expect(b.m.captured).toBe(false);
    expect(b.sim.hunt!.phase).toBe('active');
  });

  it('同じ tick に倒していたら、討伐が先に確定して捕獲にはならない', () => {
    const { sim, m } = trapped();
    m.tranq = 2;
    m.tranqTicks = 900;
    applyDamageToMonster(m, 0, m.hp, 'cut', sim);
    const ev = run(sim, 1);
    expect(m.dead).toBe(true);
    expect(m.captured).toBe(false);
    expect(of(ev, 'hunt_end')[0]).toMatchObject({ reason: 'slay' });
  });

  it('捕獲の報酬は、その場で抽選され、少し後に結果が閉じる（剥ぎ取りは無い）', () => {
    const { sim } = trapped();
    useItem(sim, ORB);
    useItem(sim, ORB);
    const h = sim.hunt!;
    expect(h.loot.filter((g) => g.source === 'capture')).toHaveLength(4);
    expect(h.carves).toEqual({});
    expect(h.closed).toBe(false);
    const ev = run(sim, 300);
    expect(h.closed).toBe(true);
    expect(of(ev, 'hunt_close')).toHaveLength(1);
    expect(h.rewards!.money).toBe(600);
    // 捕獲 4 + 依頼の固定報酬 1
    expect(h.rewards!.items.reduce((n, s) => n + s.count, 0)).toBe(5);
  });
});

describe('剥ぎ取りと報酬', () => {
  /** 倒した直後（達成）まで進める。tail を切っておくこともできる。 */
  function slain(opts: { sever?: boolean; breakHead?: boolean; seed?: number } = {}): { sim: Simulation; m: MonsterState } {
    const a = arena(opts.seed);
    const idx = (id: string): number => a.m.def.parts.findIndex((p) => p.id === id);
    if (opts.sever) applyDamageToMonster(a.m, idx('tail'), 260, 'cut', a.sim);
    if (opts.breakHead) applyDamageToMonster(a.m, idx('head'), 220, 'blunt', a.sim);
    applyDamageToMonster(a.m, idx('body'), a.m.hp, 'blunt', a.sim);
    run(a.sim, 1);
    expect(a.sim.hunt!.phase).toBe('success');
    return a;
  }
  const near = (sim: Simulation, x: number, z: number): void => {
    sim.player.pos = { x, y: 0, z };
    sim.player.prevPos = { ...sim.player.pos };
  };

  it('倒すと本体から 3 回剥ぎ取れる。近くで攻撃ボタンを押すと 1 回分で、素材は行動の 80 tick 目に手に入る', () => {
    const { sim, m } = slain();
    const h = sim.hunt!;
    expect(h.carves).toEqual({ body: 3 });
    expect(h.closed).toBe(false);
    // 遠いと剥ぎ取りにならない（抜刀攻撃になる）
    near(sim, 0, 2);
    let ev = run(sim, 1, () => press(Btn.Main));
    expect(ev.some((e) => e.type === 'action_start' && e.actionId === 'player.common.carve')).toBe(false);
    run(sim, 120);
    near(sim, 0, m.pos.z - 2.5);
    ev = run(sim, 1, () => press(Btn.Main));
    expect(ev.some((e) => e.type === 'action_start' && e.actionId === 'player.common.carve')).toBe(true);
    expect(sim.player.drawn).toBe(false);
    ev = run(sim, 79);
    expect(h.loot).toHaveLength(0);
    ev = run(sim, 1);
    expect(of(ev, 'carve')).toHaveLength(1);
    expect(h.carves.body).toBe(2);
    expect(h.loot[0]!.source).toBe('carve');
    expect(content.materials.has(h.loot[0]!.itemId)).toBe(true);
  });

  it('剥ぎ取りを使い切ると少し後に結果が閉じ、報酬が一度だけ確定する。閉じた後は何も増えない', () => {
    const { sim, m } = slain();
    const h = sim.hunt!;
    near(sim, 0, m.pos.z - 2.5);
    const all: SimEvent[] = [];
    for (let i = 0; i < 3; i++) {
      all.push(...run(sim, 1, () => press(Btn.Main)));
      all.push(...run(sim, 110));
    }
    expect(h.carves.body).toBe(0);
    all.push(...run(sim, 200));
    expect(h.closed).toBe(true);
    expect(of(all, 'hunt_close')).toHaveLength(1);
    // 剥ぎ取り 3 + 依頼の固定報酬 1
    expect(h.loot.map((g) => g.source)).toEqual(['carve', 'carve', 'carve', 'quest']);
    expect(h.rewards).toEqual({ money: 600, items: expect.any(Array) });
    expect(h.rewards!.items.reduce((n, s) => n + s.count, 0)).toBe(4);
    const snapshot = JSON.stringify(h);
    const ev = run(sim, 300, () => press(Btn.Main));
    expect(JSON.stringify(h)).toBe(snapshot);
    expect(of(ev, 'hunt_close')).toHaveLength(0);
    expect(of(ev, 'carve')).toHaveLength(0);
  });

  it('切り落とした尾からも 1 回剥ぎ取れる。壊した部位の追加は達成の時点で入る', () => {
    const { sim } = slain({ sever: true, breakHead: true });
    const h = sim.hunt!;
    expect(h.carves).toEqual({ body: 3, tail: 1 });
    expect(h.loot.map((g) => g.source)).toEqual(['break:head']);
    const at = sim.severedAt.tail!;
    near(sim, at.x, at.z + 0.8);
    run(sim, 1, () => press(Btn.Main));
    run(sim, 110);
    expect(h.carves.tail).toBe(0);
    expect(h.loot[1]!.source).toBe('severed:tail');
  });

  it('帰還のボタン（達成後のリタイア入力）で、剥ぎ取りを残したまま閉じられる。時間切れでも閉じる', () => {
    const a = slain();
    run(a.sim, 10);
    run(a.sim, 1, () => press(Btn.Retire));
    expect(a.sim.hunt!.closed).toBe(true);
    expect(a.sim.hunt!.phase).toBe('success');
    expect(a.sim.hunt!.rewards!.items).toEqual([{ itemId: 'mat.galdros.shell_shard', count: 1 }]);

    const b = slain();
    run(b.sim, 3599);
    expect(b.sim.hunt!.closed).toBe(false);
    run(b.sim, 1);
    expect(b.sim.hunt!.closed).toBe(true);
  });

  it('失敗とリタイアでは、報酬も素材も出ない。結果はすぐ閉じる', () => {
    const { sim, m } = arena();
    applyDamageToMonster(m, m.def.parts.findIndex((p) => p.id === 'head'), 220, 'blunt', sim);
    run(sim, 1, () => press(Btn.Retire));
    const h = sim.hunt!;
    expect(h).toMatchObject({ phase: 'failed', reason: 'retire', closed: true, loot: [], rewards: { money: 0, items: [] } });
  });

  it('同じ seed と同じ入力なら、手に入る素材も同じ。seed を変えると変わりうる', () => {
    const play = (seed: number): string => {
      const { sim, m } = slain({ seed, sever: true, breakHead: true });
      near(sim, 0, m.pos.z - 2.5);
      for (let i = 0; i < 3; i++) {
        run(sim, 1, () => press(Btn.Main));
        run(sim, 110);
      }
      run(sim, 4000);
      return JSON.stringify(sim.hunt!.rewards);
    };
    expect(play(7)).toBe(play(7));
    const seen = new Set<string>();
    for (let s = 1; s <= 12; s++) seen.add(play(s));
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('再生', () => {
  it('道具・罠・剥ぎ取りを含む入力列は、30fps と 60fps の再生で同じ結果になる', () => {
    const inputs: InputFrame[] = [];
    const push = (n: number, f: InputFrame = frame()): void => {
      for (let i = 0; i < n; i++) inputs.push(f);
    };
    push(1, press(Btn.Item));
    push(100);
    push(1, press(Btn.ItemNext));
    push(1, press(Btn.Item));
    push(130);
    push(1, press(Btn.ItemNext));
    push(1, press(Btn.Item));
    push(60, frame({ moveZ: 1 }));
    push(120);
    const a = runReplay(content, baseOptions({ questId: QUEST }), inputs, () => 1 / 60);
    const b = runReplay(content, baseOptions({ questId: QUEST }), inputs, () => 1 / 30);
    expect(firstMismatch(a, b)).toBe(-1);
  });
});
