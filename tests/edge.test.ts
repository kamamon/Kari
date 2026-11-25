// 刃の状態と研磨石（v0.7.0、docs/spec.md 16 章）。
// 当てると減る / 段階でダメージが変わる / 硬い部位で弾かれる / 研磨石で最大へ戻る。数値はデータ（weapons.json の edge）。
import { beforeAll, describe, expect, it } from 'vitest';
import type { Content } from '../src/data/schemas';
import { ContentError, validateEdge } from '../src/data/validators';
import { computeDamage, edgeStage } from '../src/game/combat';
import type { SimEvent } from '../src/game/events';
import { resolveIncomingHit } from '../src/game/player';
import { Simulation } from '../src/game/sim';
import { Btn, baseOptions, frame, loadContent, placeInFrontOfHead, press, run } from './helpers';

let content: Content;
/** 標的の頭を「硬い部位」にした収録データ（斬 0.30 / 打 0.30）。鋭い時は通り、並より下では弾かれる硬さ */
let hard: Content;
beforeAll(async () => {
  content = await loadContent();
  hard = structuredClone(content);
  const head = hard.monsters.get('monster.training_dummy')!.parts.find((p) => p.id === 'head')!;
  head.hitzone = { ...head.hitzone, cut: 0.3, blunt: 0.3 };
});

const WHET = 'item.whetstone';
const of = <T extends SimEvent['type']>(ev: SimEvent[], type: T): Extract<SimEvent, { type: T }>[] => ev.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
const count = (sim: Simulation, id: string): number => sim.player.items.find((s) => s.itemId === id)?.count ?? 0;
/** 標的の頭の前に立ち、縦斬りを 1 回当てる（断岳剣）。その間の出来事を返す。 */
function overhead(sim: Simulation, ticks = 40): SimEvent[] {
  placeInFrontOfHead(sim);
  return run(sim, ticks, (i) => (i === 0 ? press(Btn.Main) : frame()));
}
const sim1 = (c: Content = content, weaponId = 'weapon.heavy_blade.001'): Simulation => new Simulation(c, baseOptions({ weaponId }));

describe('刃の状態の決まり（データ）', () => {
  it('段階は 鋭い → 並 → 鈍い。鈍いほどダメージの倍率が下がり、弾かれる硬さの境目が上がる', () => {
    const E = content.edge;
    expect(E.stages.map((s) => s.id)).toEqual(['keen', 'worn', 'dull']);
    expect(E.stages[0]!.damageScale).toBe(1); // 研いだ直後は、いままでと同じ威力
    expect(edgeStage(E, E.max).id).toBe('keen');
    expect(edgeStage(E, 60).id).toBe('keen');
    expect(edgeStage(E, 59.9).id).toBe('worn');
    expect(edgeStage(E, 25).id).toBe('worn');
    expect(edgeStage(E, 24.9).id).toBe('dull');
    expect(edgeStage(E, 0).id).toBe('dull');
  });

  it('刃の状態があるのは、環弓以外の 6 系統', () => {
    const withEdge = [...content.families.values()].filter((f) => f.edge).map((f) => f.id).sort();
    expect(withEdge).toEqual(['guard_blade', 'heavy_blade', 'long_blade', 'long_lance', 'twin_blades', 'war_maul']);
  });

  it('鋭い時は、ガルドロスのどの部位でも弾かれない。並では背殻だけ、鈍いと脚も弾かれる（斬る武器）', () => {
    const g = content.monsters.get('monster.galdros')!;
    const bounces = (stageId: string): string[] => {
      const st = content.edge.stages.find((s) => s.id === stageId)!;
      return g.parts.filter((p) => p.hitzone.cut < st.bounceBelow).map((p) => p.id);
    };
    expect(bounces('keen')).toEqual([]);
    expect(bounces('worn')).toEqual(['back']);
    expect(bounces('dull')).toEqual(['back', 'foreleg', 'hindleg']);
  });

  it('決まりが壊れたデータは弾く（段階の順が逆、最後が 0 でない）', () => {
    const errs: string[] = [];
    validateEdge({ ...content.edge, stages: [...content.edge.stages].reverse() }, errs);
    expect(errs.length).toBeGreaterThan(0);
    const errs2: string[] = [];
    validateEdge({ ...content.edge, stages: content.edge.stages.slice(0, 2) }, errs2);
    expect(errs2.join()).toContain('最後の段階');
    expect(ContentError).toBeDefined();
  });
});

describe('当てると減る', () => {
  it('最初は最大（鋭い）。縦斬りを 1 回当てると、係数 1.05 × 1.6 = 1.68 減る', () => {
    const sim = sim1();
    expect(sim.player.edge).toBe(100);
    const ev = overhead(sim);
    expect(of(ev, 'hit')).toHaveLength(1);
    expect(of(ev, 'hit')[0]!.bounced).toBe(false);
    expect(sim.player.edge).toBeCloseTo(98.32, 6);
  });

  it('空振りでは減らない', () => {
    const sim = sim1();
    placeInFrontOfHead(sim, 6);
    run(sim, 80, (i) => (i === 0 ? press(Btn.Main) : frame()));
    expect(sim.hitCount).toBe(0);
    expect(sim.player.edge).toBe(100);
  });

  it('溜めて当てても、減り方は技そのものの係数で決まる（溜めた分は余分に減らない）', () => {
    const sim = sim1();
    placeInFrontOfHead(sim);
    // 押し続けて溜め、段階 3 で離す
    const ev = run(sim, 200, (i) => (i === 0 ? press(Btn.Main) : i < 120 ? frame({ held: Btn.Main }) : i === 120 ? frame({ released: Btn.Main }) : frame()));
    const hit = of(ev, 'hit')[0]!;
    expect(hit.chargeLevel).toBeGreaterThanOrEqual(1);
    expect(sim.player.edge).toBeCloseTo(98.32, 6);
  });

  it('段階が下がった tick に、出来事が 1 回出る', () => {
    const sim = sim1();
    sim.player.edge = 60.5;
    const ev = overhead(sim);
    expect(of(ev, 'edge')).toEqual([{ type: 'edge', stage: 'worn', value: sim.player.edge }]);
    expect(sim.player.edge).toBeCloseTo(58.82, 6);
  });

  it('0 より下へは減らない', () => {
    const sim = sim1();
    sim.player.edge = 0.5;
    overhead(sim);
    expect(sim.player.edge).toBe(0);
  });
});

describe('段階でダメージが変わる', () => {
  const dmg = (edge: number): number => {
    const sim = sim1();
    sim.player.edge = edge;
    return of(overhead(sim), 'hit')[0]!.damage;
  };
  const expected = (scale: number): number => computeDamage({ attack: 80, motion: 1.05, sharpness: scale, hitzone: 0.7, crit: 1, element: 0, elementMotion: 1, elementZone: 0, questModifier: 1 });

  it('鋭い = ×1.0、並 = ×0.88、鈍い = ×0.7（ダメージ式の刃補正へ掛ける）', () => {
    expect(dmg(100)).toBe(expected(1));
    expect(dmg(50)).toBe(expected(0.88));
    expect(dmg(10)).toBe(expected(0.7));
    expect(dmg(100)).toBeGreaterThan(dmg(50));
    expect(dmg(50)).toBeGreaterThan(dmg(10));
  });
});

describe('弾かれ', () => {
  it('鋭い時は、硬い部位（係数 0.30）でも弾かれず、行動は最後まで続く', () => {
    const sim = sim1(hard);
    const ev = overhead(sim);
    expect(of(ev, 'hit')[0]!.bounced).toBe(false);
    expect(sim.player.mode).toBe('action');
    expect(sim.player.edge).toBeCloseTo(98.32, 6);
  });

  it('並の時は弾かれる: ダメージは入るが、行動が止まってよろけ、刃は 2 倍減る', () => {
    const sim = sim1(hard);
    sim.player.edge = 50;
    placeInFrontOfHead(sim);
    const z0 = sim.player.pos.z;
    const hp0 = sim.player.hp;
    let hitTick = -1;
    const ev: SimEvent[] = [];
    for (let i = 0; i < 40 && hitTick < 0; i++) {
      sim.step(i === 0 ? press(Btn.Main) : frame());
      const out = sim.drainEvents();
      ev.push(...out);
      if (out.some((e) => e.type === 'hit')) hitTick = i;
    }
    const hit = of(ev, 'hit')[0]!;
    expect(hit.bounced).toBe(true);
    expect(hit.damage).toBeGreaterThan(0);
    // 当たった tick に行動が止まり、よろけへ入る
    expect(sim.player.action).toBeNull();
    expect(sim.player.mode).toBe('hurt');
    expect(sim.player.hurt).toMatchObject({ kind: 'bounce', duration: content.edge.bounce.recoilTicks });
    expect(sim.player.edge).toBeCloseTo(50 - 1.68 * 2, 6);
    // よろけの間は動けず、少し後ろへ下がる。被弾ではないので体力は減らず、無敵も付かない
    // （押しても技は出ない。先行入力が残らないよう、押すのは前半だけ）
    run(sim, content.edge.bounce.recoilTicks - 1, (i) => (i < 10 ? press(Btn.Main) : frame()));
    expect(sim.player.mode).toBe('hurt');
    expect(sim.player.invulnTicks).toBe(0);
    run(sim, 2);
    expect(sim.player.mode).toBe('free');
    expect(sim.player.hp).toBe(hp0);
    expect(sim.player.drawn).toBe(true);
    // 縦斬りの踏み込み（最大 0.35m）から、0.3m 下がっている
    const back = sim.player.pos.z - z0;
    expect(back).toBeLessThan(0.36 - 0.25);
    expect(back).toBeGreaterThan(-0.31);
  });

  it('弾かれた後は、同じ行動の残りの判定は出ない（双剣の突き込みは 2 回目が出ない）', () => {
    const normal = sim1(content, 'weapon.twin_blades.001');
    placeInFrontOfHead(normal, 0.9);
    expect(of(run(normal, 60, (i) => (i === 0 ? press(Btn.Sub) : frame())), 'hit')).toHaveLength(2);

    const sim = sim1(hard, 'weapon.twin_blades.001');
    sim.player.edge = 50;
    placeInFrontOfHead(sim, 0.9);
    const hits = of(run(sim, 60, (i) => (i === 0 ? press(Btn.Sub) : frame())), 'hit');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.bounced).toBe(true);
  });

  it('打撃（大槌）は、打撃の部位係数で弾かれるかが決まる', () => {
    const sim = sim1(hard, 'weapon.war_maul.001');
    sim.player.edge = 50;
    placeInFrontOfHead(sim, 1.2);
    const hits = of(run(sim, 70, (i) => (i === 0 ? press(Btn.Main) : frame())), 'hit');
    expect(hits[0]!.bounced).toBe(true);
    // 元の標的の頭（打 0.8）なら、鈍くても弾かれない
    const soft = sim1(content, 'weapon.war_maul.001');
    soft.player.edge = 5;
    placeInFrontOfHead(soft, 1.2);
    expect(of(run(soft, 70, (i) => (i === 0 ? press(Btn.Main) : frame())), 'hit')[0]!.bounced).toBe(false);
  });

  it('環弓には刃の状態が無い: 当てても減らず、弾かれない', () => {
    const sim = sim1(hard, 'weapon.ring_bow.001');
    sim.player.edge = 100;
    placeInFrontOfHead(sim, 8);
    const hits = of(run(sim, 200, (i) => (i === 0 ? press(Btn.Main) : i < 80 ? frame({ held: Btn.Main }) : i === 80 ? frame({ released: Btn.Main }) : frame())), 'hit');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => !h.bounced)).toBe(true);
    expect(sim.player.edge).toBe(100);
    expect(sim.player.mode).not.toBe('hurt');
  });
});

describe('研磨石（v0.40.0 から、2G に合わせて納刀して使う）', () => {
  const whetReady = (edge: number, drawn = false, weaponId = 'weapon.heavy_blade.001'): Simulation => {
    const sim = sim1(content, weaponId);
    sim.player.edge = edge;
    sim.player.drawn = drawn;
    sim.player.itemIndex = sim.player.items.findIndex((s) => s.itemId === WHET);
    return sim;
  };

  it('納刀中に使う: 96 tick 目に最大へ戻り、1 個減る。研ぎ終わると武器は納めたまま', () => {
    const sim = whetReady(30);
    const start = run(sim, 1, () => press(Btn.Item));
    expect(of(start, 'item_use')).toHaveLength(1);
    expect(sim.player.action?.def.actionId).toBe('player.item.whet');
    run(sim, 94);
    expect(sim.player.edge).toBe(30); // 効果の tick の前は、まだ戻っていない
    expect(count(sim, WHET)).toBe(10);
    const ev = run(sim, 3);
    expect(of(ev, 'item_effect')).toMatchObject([{ kind: 'whet', ok: true, amount: 70 }]);
    expect(of(ev, 'edge')).toMatchObject([{ stage: 'keen', value: 100 }]);
    expect(sim.player.edge).toBe(100);
    expect(count(sim, WHET)).toBe(9);
    run(sim, 40);
    expect(sim.player.mode).toBe('free');
    expect(sim.player.drawn).toBe(false);
  });

  it('抜刀中に押すと、納刀するだけで研がない。納刀した後にもう 1 度押すと研ぐ', () => {
    const sim = whetReady(30, true);
    const ev = run(sim, 1, () => press(Btn.Item));
    expect(of(ev, 'action_start').map((e) => e.actionId)).toEqual(['player.heavy_blade.sheathe']);
    const later = run(sim, 200);
    expect(of(later, 'item_use')).toHaveLength(0);
    expect(sim.player.edge).toBe(30);
    expect(sim.player.drawn).toBe(false);
    run(sim, 1, () => press(Btn.Item));
    run(sim, 130);
    expect(sim.player.edge).toBe(100);
    expect(count(sim, WHET)).toBe(9);
    expect(sim.player.drawn).toBe(false);
  });

  it('研ぎ終わる前に攻撃を受けると、戻らず、道具も減らない', () => {
    const sim = whetReady(30);
    run(sim, 1, () => press(Btn.Item));
    run(sim, 60);
    resolveIncomingHit(sim.player, { attackerPos: { x: 0, y: 0, z: 5 }, baseDamage: 10, guardable: true, guardCost: 10, reaction: 'flinch' }, sim);
    run(sim, 150);
    expect(sim.player.edge).toBe(30);
    expect(count(sim, WHET)).toBe(10);
    expect(sim.player.itemUse).toBeNull();
  });

  it('刃が最大の時は使えない（減らない）。抜刀中なら、納刀だけをする', () => {
    const sheathed = whetReady(100);
    const ev = run(sheathed, 1, () => press(Btn.Item));
    expect(of(ev, 'item_fail')).toEqual([{ type: 'item_fail', reason: 'no_need' }]);
    expect(of(ev, 'action_start')).toHaveLength(0);
    run(sheathed, 60);
    expect(count(sheathed, WHET)).toBe(10);
    expect(sheathed.player.drawn).toBe(false);
    const drawn = whetReady(100, true);
    const ev2 = run(drawn, 1, () => press(Btn.Item));
    expect(of(ev2, 'item_fail')).toHaveLength(0);
    expect(of(ev2, 'action_start').map((e) => e.actionId)).toEqual(['player.heavy_blade.sheathe']);
    run(drawn, 60);
    expect(count(drawn, WHET)).toBe(10);
  });

  it('研いでいる最中は、102 tick 目から回避で切り上げられる（効果の後）', () => {
    const sim = whetReady(30);
    run(sim, 1, () => press(Btn.Item));
    run(sim, 80, () => press(Btn.Dodge));
    expect(sim.player.action?.def.actionId).toBe('player.item.whet'); // 効果の前は切り上げられない
    run(sim, 20);
    const ev = run(sim, 6, () => press(Btn.Dodge));
    expect(of(ev, 'action_start').some((e) => e.actionId === 'player.common.roll')).toBe(true);
    expect(sim.player.edge).toBe(100);
  });

  it('護刃は、防御を構えたまま研げる（抜刀のまま。v0.40.0）。構えていない時は納刀する', () => {
    const sim = whetReady(30, true, 'weapon.guard_blade.001');
    run(sim, 12, () => ({ ...frame(), held: Btn.Special }));
    expect(sim.player.mode).toBe('guard');
    const ev = run(sim, 1, () => ({ ...frame(), held: Btn.Special | Btn.Item, pressed: Btn.Item }));
    expect(of(ev, 'item_use')).toHaveLength(1);
    run(sim, 130);
    expect(sim.player.edge).toBe(100);
    expect(sim.player.drawn).toBe(true);
    const other = whetReady(30, true, 'weapon.guard_blade.001');
    const ev2 = run(other, 1, () => press(Btn.Item));
    expect(of(ev2, 'action_start').map((e) => e.actionId)).toEqual(['player.guard_blade.sheathe']);
  });

  it('依頼では 3 個、訓練場では 10 個持つ', () => {
    expect(count(sim1(), WHET)).toBe(10);
    expect(count(new Simulation(content, baseOptions({ questId: 'quest.basin.003' })), WHET)).toBe(3);
  });
});

describe('力尽きても、刃の状態はそのまま', () => {
  it('キャンプへ戻っても、研がない限り戻らない', () => {
    const sim = new Simulation(content, baseOptions({ questId: 'quest.basin.003' }));
    sim.player.edge = 12;
    sim.player.hp = 1;
    resolveIncomingHit(sim.player, { attackerPos: { x: 0, y: 0, z: 5 }, baseDamage: 50, guardable: false, guardCost: 0, reaction: 'knockdown' }, sim);
    expect(sim.player.mode).toBe('dead');
    run(sim, content.player.respawnTicks + 30);
    expect(sim.player.mode).toBe('free');
    expect(sim.player.edge).toBe(12);
  });
});
