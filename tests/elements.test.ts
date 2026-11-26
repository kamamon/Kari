// 属性・状態異常・防具の技能と耐性（v0.33.0。ChatGPT の全装備四級版 #15 の rules。docs/spec.md の 30 章、D-114・D-115）。
// - 装備の効き目（src/game/gear.ts）: 技能の Lv（1 部位 1 点、3 まで。個別耐性は対象ごと）、耐性の合計と上限、属性の部位の係数、複合、会心の上限
// - モンスターの状態異常（src/game/ailment.ts）: 閾値の伸び、減り方、硬直どうしの重なりと猶予、毒の分け方、眠りを覚ます命中
// - simulation: 属性のダメージ、盾には乗らない、毒・麻痺・睡眠・気絶、受ける攻撃の属性と耐性、技能（スタミナ・回復・研ぐ時間・刃・部位）
import { beforeAll, describe, expect, it } from 'vitest';
import type { ArmorDef, Content, MonsterDef } from '../src/data/schemas';
import { AILMENT_UNIT, addAilment, ailmentThreshold, freshAilments, poisonHitDamage, startPoison, stepAilments, wakeFromSleep } from '../src/game/ailment';
import type { SimEvent } from '../src/game/events';
import { computeGear, critChance, incomingElementScale, typedElementZone, weaponElementZone } from '../src/game/gear';
import { applyStatus, resolveIncomingHit } from '../src/game/player';
import { Simulation } from '../src/game/sim';
import { Btn, baseOptions, frame, loadContent, placeInFrontOfHead, press, run } from './helpers';

let content: Content;
beforeAll(async () => {
  content = await loadContent();
});

const SLOTS = ['head', 'chest', 'arms', 'waist', 'legs'];
const seriesSet = (sp: string): string[] => SLOTS.map((s) => `armor.${s}.${sp}.r1`);
const galdrosSet = (tier: number): string[] => SLOTS.map((s) => `armor.${s}.00${tier}`);
const R = (): Content['elements']['ailment'] => content.elements.ailment;
/** 内容の写し（モンスターや防具を試しに変える） */
const withMonster = (id: string, edit: (d: MonsterDef) => MonsterDef): Content => {
  const c: Content = { ...content, monsters: new Map(content.monsters) };
  c.monsters.set(id, edit(content.monsters.get(id)!));
  return c;
};
const ofType = <T extends SimEvent['type']>(ev: SimEvent[], t: T): Extract<SimEvent, { type: T }>[] => ev.filter((e): e is Extract<SimEvent, { type: T }> => e.type === t);
/** 頭の正面で 1 回振る（断岳剣の縦斬りなど） */
const swing = (sim: Simulation, btn: number = Btn.Main, ticks = 100): SimEvent[] => run(sim, ticks, (i) => (i === 0 ? press(btn) : frame()));

describe('装備の効き目（技能・耐性）', () => {
  it('ガルドロスの岩殻一式: 受け支え Lv3（頭・腕・脚）と刃持ち Lv2（胴・腰）。火 -10・雷 +15', () => {
    const g = computeGear(content, content.weapons.get('weapon.heavy_blade.001')!, galdrosSet(2));
    expect(Object.fromEntries(g.levels)).toEqual({ guard_economy: 3, edge_keep: 2 });
    expect(g.guardStamina).toBeCloseTo(0.8, 10);
    expect(g.edgeWear).toBeCloseTo(0.91, 10);
    expect(g.resist).toEqual({ fire: -10, thunder: 15, ice: 0, water: 0, wind: 0, mist: 0 });
    // 弓は刃が減らないので、刃持ちは 1 のまま
    expect(computeGear(content, content.weapons.get('weapon.ring_bow.001')!, galdrosSet(2)).edgeWear).toBe(1);
  });

  it('泥冠一式: 個別属性耐性（水）Lv3 = 9 点を水の耐性へ足す。個別状態耐性（毒）Lv2 = 35%', () => {
    const g = computeGear(content, content.weapons.get('weapon.heavy_blade.001')!, seriesSet('numeradon'));
    expect(Object.fromEntries(g.levels)).toEqual({ 'element_resistance:water': 3, 'status_resistance:poison': 2 });
    expect(g.resist.water).toBe(3 * 5 + 9);
    expect(g.resist.thunder).toBe(-2 * 5);
    expect(g.statusResist.poison).toBeCloseTo(1.35, 10);
    expect(g.statusResist.sleep).toBe(1);
  });

  it('混ぜた防具は点から数える。個別耐性は対象ごと（水と氷を合わせない）。部位ごとに 1 つ。耐性は -30〜30', () => {
    // 泥冠の頭（水）・氷帆の胴（氷帆の胴は個別属性耐性の氷）・泥冠の腕（水）
    const kc = content.armor.get('armor.chest.kirisave.r1')!;
    expect(kc.skill).toEqual({ id: 'element_resistance', points: 1, element: 'ice' });
    const g = computeGear(content, content.weapons.get('weapon.heavy_blade.001')!, ['armor.head.numeradon.r1', 'armor.chest.kirisave.r1', 'armor.arms.numeradon.r1']);
    expect(g.levels.get('element_resistance:water')).toBe(2);
    expect(g.levels.get('element_resistance:ice')).toBe(1);
    // 同じ部位を 2 つ渡すと、防御力の高い方だけ
    const two = computeGear(content, content.weapons.get('weapon.heavy_blade.001')!, ['armor.head.002', 'armor.head.005']);
    expect(Object.fromEntries(two.levels)).toEqual({ guard_economy: 1 });
    // 上限: 1 部位で耐性 +20 の試しの防具 5 つ（+100）でも 30
    const c: Content = { ...content, armor: new Map(content.armor) };
    for (const s of SLOTS) {
      const a = content.armor.get(`armor.${s}.001`)!;
      c.armor.set(a.id, { ...a, resist: { fire: 20, ice: -20 } } as ArmorDef);
    }
    const capped = computeGear(c, content.weapons.get('weapon.heavy_blade.001')!, galdrosSet(1));
    expect([capped.resist.fire, capped.resist.ice]).toEqual([30, -30]);
  });

  it('部位の属性の係数: 弱点は 1.5 倍、耐性は 0.5 倍（ガルドロスの頭 0.20: 火 0.30・雷 0.10・氷 0.20）', () => {
    const gd = content.monsters.get('monster.galdros')!;
    const head = gd.parts.find((p) => p.head)!;
    expect(head.id).toBe('head');
    expect(typedElementZone(content, gd, head, 'fire')).toBeCloseTo(0.3, 10);
    expect(typedElementZone(content, gd, head, 'thunder')).toBeCloseTo(0.1, 10);
    expect(typedElementZone(content, gd, head, 'ice')).toBeCloseTo(0.2, 10);
    // 複合: 大きい方。どちらも弱点でない時だけ半分（火 + 氷 は火が弱点 → 0.30、氷 + 水 → 0.20 × 0.5）
    const w = content.weapons.get('weapon.heavy_blade.selvark.r1')!;
    expect(weaponElementZone(content, { ...w, element: { type: 'compound', value: 39, elements: ['fire', 'ice'] } }, gd, head)).toBeCloseTo(0.3, 10);
    expect(weaponElementZone(content, { ...w, element: { type: 'compound', value: 39, elements: ['ice', 'water'] } }, gd, head)).toBeCloseTo(0.1, 10);
    // 雷（耐性 0.10）+ 水（0.20）: 大きい方 0.20 の半分
    expect(weaponElementZone(content, { ...w, element: { type: 'compound', value: 39, elements: ['thunder', 'water'] } }, gd, head)).toBeCloseTo(0.1, 10);
    // 無属性は 0
    expect(weaponElementZone(content, content.weapons.get('weapon.heavy_blade.001')!, gd, head)).toBe(0);
  });

  it('会心率: 急所観察は物理の肉質 0.55 以上の時だけ足す。正の側は 60% まで', () => {
    const orglass = content.weapons.get('weapon.heavy_blade.orglass.r1')!;
    const g = computeGear(content, orglass, []);
    const lumisca = computeGear(content, orglass, ['armor.head.lumisca.r1', 'armor.arms.lumisca.r1', 'armor.legs.lumisca.r1']);
    expect(lumisca.weakCrit).toBe(10);
    expect(critChance(content, orglass, g, 0.7)).toBe(25);
    expect(critChance(content, orglass, lumisca, 0.55)).toBe(35);
    expect(critChance(content, orglass, lumisca, 0.54)).toBe(25);
    expect(critChance(content, { ...orglass, affinity: 55 }, lumisca, 0.7)).toBe(60);
    expect(critChance(content, { ...orglass, affinity: -20 }, lumisca, 0.7)).toBe(-10);
  });

  it('受ける攻撃: 属性を持つ種は 30% が属性の項。(物理 + 属性 × (1 - 耐性/100)) の倍率。属性の無い種は 1', () => {
    const g = computeGear(content, content.weapons.get('weapon.heavy_blade.001')!, galdrosSet(2));
    const sv = content.monsters.get('monster.selvark')!;
    expect(sv.element).toBe('wind');
    expect(incomingElementScale(content, sv, g)).toBe(1);
    expect(incomingElementScale(content, { ...sv, element: 'thunder' }, g)).toBeCloseTo(0.7 + 0.3 * 0.85, 12);
    expect(incomingElementScale(content, { ...sv, element: 'fire' }, g)).toBeCloseTo(0.7 + 0.3 * 1.1, 12);
    expect(incomingElementScale(content, content.monsters.get('monster.galdros')!, g)).toBe(1);
  });
});

describe('モンスターの状態異常（計算）', () => {
  it('発症までの量: 100 → 135 → 183 → 247（毒・麻痺・睡眠）、気絶は 100 → 150 → 225 → 338', () => {
    expect([0, 1, 2, 3].map((n) => ailmentThreshold(R(), 'poison', n) / AILMENT_UNIT)).toEqual([100, 135, 183, 247]);
    expect([0, 1, 2, 3].map((n) => ailmentThreshold(R(), 'sleep', n) / AILMENT_UNIT)).toEqual([100, 135, 183, 247]);
    expect([0, 1, 2, 3].map((n) => ailmentThreshold(R(), 'stun', n) / AILMENT_UNIT)).toEqual([100, 150, 225, 338]);
  });

  it('届いたら発症し、ためた量は 0（超えた分は捨てる）。効いている間は、同じ状態をためない', () => {
    const a = freshAilments();
    expect(addAilment(a, R(), 'para', 60_000)).toBe('stored');
    expect(addAilment(a, R(), 'para', 70_000)).toBe('triggered');
    expect(a.gauge.para).toBe(0);
    expect(a.count.para).toBe(1);
    expect(a.ticks.para).toBe(R().para.ticks);
    expect(addAilment(a, R(), 'para', 500_000)).toBe('none');
    expect(a.gauge.para).toBe(0);
  });

  it('硬直は重ならない: 効いている間と、終わってから 180 tick は、ほかの硬直は 1 手前まで。猶予が過ぎても、次にためるまで発症しない', () => {
    const a = freshAilments();
    addAilment(a, R(), 'para', 100_000);
    expect(addAilment(a, R(), 'sleep', 150_000)).toBe('capped');
    expect(a.gauge.sleep).toBe(100_000 - 1);
    // 毒は別枠
    expect(addAilment(a, R(), 'poison', 100_000)).toBe('triggered');
    for (let i = 0; i < R().para.ticks; i++) stepAilments(a, R());
    expect(a.ticks.para).toBe(0);
    expect(a.grace).toBe(R().lockGraceTicks);
    expect(addAilment(a, R(), 'stun', 200_000)).toBe('capped');
    for (let i = 0; i < R().lockGraceTicks; i++) stepAilments(a, R());
    expect(a.grace).toBe(0);
    expect(a.ticks.sleep).toBe(0);
    expect(addAilment(a, R(), 'sleep', 1)).toBe('triggered');
    expect(a.ticks.sleep).toBe(R().sleep.ticks);
    // 眠りを覚ます: 効き目を終えて、猶予が始まる
    expect(wakeFromSleep(a, R())).toBe(true);
    expect([a.ticks.sleep, a.grace]).toEqual([0, R().lockGraceTicks]);
    expect(wakeFromSleep(a, R())).toBe(false);
  });

  it('ためた量は、最後にためてから 5 秒後、1 秒ごとに 2 ずつ減る', () => {
    const a = freshAilments();
    addAilment(a, R(), 'poison', 10_000);
    for (let i = 0; i < 300 + 59; i++) stepAilments(a, R());
    expect(a.gauge.poison).toBe(10_000);
    stepAilments(a, R());
    expect(a.gauge.poison).toBe(8_000);
    for (let i = 0; i < 60; i++) stepAilments(a, R());
    expect(a.gauge.poison).toBe(6_000);
    // ためると、減り始めまでの時間が戻る
    addAilment(a, R(), 'poison', 1_000);
    for (let i = 0; i < 300; i++) stepAilments(a, R());
    expect(a.gauge.poison).toBe(7_000);
  });

  it('毒: 最大体力の 2% を切り捨てた総量を、15 秒で 10 回へ、商と余りで分ける（総量は変わらない）', () => {
    expect(Array.from({ length: 10 }, (_, i) => poisonHitDamage(24, 10, i + 1))).toEqual([3, 3, 3, 3, 2, 2, 2, 2, 2, 2]);
    const a = freshAilments();
    addAilment(a, R(), 'poison', 100_000);
    startPoison(a, R(), 1800);
    expect(a.poisonTotal).toBe(36);
    const hits: [number, number][] = [];
    for (let t = 1; t <= 1000; t++) {
      const r = stepAilments(a, R());
      if (r.poison) hits.push([t, r.poison]);
    }
    expect(hits.map((h) => h[0])).toEqual([90, 180, 270, 360, 450, 540, 630, 720, 810, 900]);
    expect(hits.reduce((s, h) => s + h[1], 0)).toBe(36);
    expect(a.ticks.poison).toBe(0);
  });
});

describe('属性・状態異常の命中（simulation）', () => {
  it('帆角の断岳剣（攻撃力 85・風 26）の縦斬り: 風が弱点なら 0.30、耐性なら 0.10、どちらでもなければ 0.20', () => {
    const dmg = (c: Content): number => {
      const sim = new Simulation(c, baseOptions({ weaponId: 'weapon.heavy_blade.selvark.r1' }));
      placeInFrontOfHead(sim);
      swing(sim);
      expect(sim.recentHits[0]!.partId).toBe('head');
      return sim.recentHits[0]!.damage;
    };
    const phys = 85 * 1.05 * 0.7;
    expect(dmg(content)).toBe(Math.floor(phys + 26 * 1.05 * 0.2 + 1e-9));
    expect(dmg(withMonster('monster.training_dummy', (d) => ({ ...d, weak: ['wind'] })))).toBe(Math.floor(phys + 26 * 1.05 * 0.3 + 1e-9));
    expect(dmg(withMonster('monster.training_dummy', (d) => ({ ...d, resist: ['wind'] })))).toBe(Math.floor(phys + 26 * 1.05 * 0.1 + 1e-9));
    // 属性調律 Lv3（氷帆の頭・腕・脚）は、属性の項だけを 1.1 倍
    const sim = new Simulation(content, baseOptions({ weaponId: 'weapon.heavy_blade.selvark.r1', armorIds: ['armor.head.kirisave.r1', 'armor.arms.kirisave.r1', 'armor.legs.kirisave.r1'] }));
    placeInFrontOfHead(sim);
    swing(sim);
    expect(sim.recentHits[0]!.damage).toBe(Math.floor(phys + 26 * 1.1 * 1.05 * 0.2 + 1e-9));
  });

  it('毒の断岳剣: 1 命中で 9.2 × 1.05 をためる。届くと毒になり、15 秒で最大体力の 2% が減る（怯み・怒りには関わらない）', () => {
    const sim = new Simulation(content, baseOptions({ weaponId: 'weapon.heavy_blade.verito.r1' }));
    const m = sim.monsters[0]!;
    placeInFrontOfHead(sim);
    swing(sim);
    expect(m.ailments.gauge.poison).toBe(Math.floor(9.2 * 1.05 * AILMENT_UNIT + 1e-6));
    m.ailments.gauge.poison = 100 * AILMENT_UNIT - 1;
    const hp0 = m.hp;
    const ev = swing(sim, Btn.Main, 30 + 1000);
    const on = ofType(ev, 'monster_ailment').filter((e) => e.kind === 'poison');
    expect(on.map((e) => e.on)).toEqual([true, false]);
    const ticks = ofType(ev, 'ailment_damage');
    expect(ticks).toHaveLength(10);
    const total = Math.floor(m.def.hp * 0.02);
    expect(ticks.reduce((s, e) => s + e.damage, 0)).toBe(total);
    const hit = ofType(ev, 'hit').reduce((s, e) => s + e.damage, 0);
    expect(hp0 - m.hp).toBe(hit + total);
    expect(m.ailments.count.poison).toBe(1);
  });

  it('盾で打つ（護刃の盾打ち）には、武器の状態異常が乗らない。刃で斬ると乗る', () => {
    const sim = new Simulation(content, baseOptions({ weaponId: 'weapon.guard_blade.verito.r1' }));
    const m = sim.monsters[0]!;
    placeInFrontOfHead(sim, 1.4);
    // v0.53.0: 盾打ちは、連係の途中の副（斬り下ろしの後）。斬り下ろし（刃）で毒がたまり、続く盾打ち（盾）では増えない
    run(sim, 15, (i) => (i === 0 ? press(Btn.Main) : frame()));
    expect(sim.recentHits.map((h) => h.windowId)).toEqual(['blade_main']);
    const afterBlade = m.ailments.gauge.poison;
    expect(afterBlade).toBeGreaterThan(0);
    run(sim, 45, (i) => (i === 0 ? press(Btn.Sub) : frame()));
    expect(sim.recentHits.map((h) => h.windowId)).toEqual(['blade_main', 'shield']);
    expect(m.ailments.gauge.poison).toBeLessThanOrEqual(afterBlade);
  });

  it('睡眠: 眠らせた後、覚ます最初の命中だけ 1.5 倍', () => {
    const sim = new Simulation(content, baseOptions({ weaponId: 'weapon.heavy_blade.ashreia.r1' }));
    const m = sim.monsters[0]!;
    placeInFrontOfHead(sim);
    m.ailments.gauge.sleep = 100 * AILMENT_UNIT - 1;
    const ev = swing(sim);
    expect(ofType(ev, 'monster_ailment')).toMatchObject([{ kind: 'sleep', on: true }]);
    expect(m.ailments.ticks.sleep).toBeGreaterThan(0);
    const normal = Math.floor(86 * 1.05 * 0.7 + 1e-9);
    expect(sim.recentHits[0]!.damage).toBe(normal);
    placeInFrontOfHead(sim);
    const ev2 = swing(sim);
    expect(ofType(ev2, 'monster_ailment')[0]).toMatchObject({ kind: 'sleep', on: false, woke: true });
    expect(sim.recentHits[1]!.damage).toBe(Math.floor(86 * 1.05 * 0.7 * 1.5 + 1e-9));
    expect(m.ailments.ticks.sleep).toBe(0);
  });

  it('麻痺: 効いている間は技が止まり、攻撃も当たらない。終わると、また動く', () => {
    const sim = new Simulation(content, baseOptions({ weaponId: 'weapon.heavy_blade.tengaro.r1', monsterAttacks: true }));
    const m = sim.monsters[0]!;
    placeInFrontOfHead(sim);
    m.ailments.gauge.para = 100 * AILMENT_UNIT - 1;
    m.cooldown = 1e9;
    swing(sim, Btn.Main, 40);
    expect(m.ailments.ticks.para).toBeGreaterThan(0);
    m.cooldown = 0;
    let acted = 0;
    let hurt = 0;
    for (let i = 0; i < R().para.ticks - 60; i++) {
      sim.step(frame());
      if (m.action) acted++;
      hurt += ofType(sim.drainEvents(), 'player_hurt').length;
    }
    expect([acted, hurt]).toEqual([0, 0]);
    let after = 0;
    for (let i = 0; i < 200; i++) {
      sim.step(frame());
      if (m.action) after++;
    }
    expect(m.ailments.ticks.para).toBe(0);
    expect(after).toBeGreaterThan(0);
  });

  it('気絶: 打撃が頭に当たった時だけ。大槌の叩きつけ 1 回 = 25 × 0.6。斬撃や、頭でない部位ではたまらない', () => {
    const sim = new Simulation(content, baseOptions({ weaponId: 'weapon.war_maul.001' }));
    const m = sim.monsters[0]!;
    let dist = 0;
    for (const d of [2.25, 2.0, 1.75, 2.5, 1.5, 2.75]) {
      const s = new Simulation(content, baseOptions({ weaponId: 'weapon.war_maul.001' }));
      placeInFrontOfHead(s, d);
      swing(s);
      if (s.recentHits[0]?.partId === 'head') {
        dist = d;
        break;
      }
    }
    expect(dist).toBeGreaterThan(0);
    placeInFrontOfHead(sim, dist);
    swing(sim);
    expect(m.ailments.gauge.stun).toBe(Math.floor(25 * 0.6 * AILMENT_UNIT + 1e-6));
    m.ailments.gauge.stun = 100 * AILMENT_UNIT - 1;
    placeInFrontOfHead(sim, dist);
    const ev = swing(sim);
    expect(ofType(ev, 'monster_ailment')).toMatchObject([{ kind: 'stun', on: true }]);
    // 斬撃は頭に当たっても、たまらない
    const cut = new Simulation(content, baseOptions({ weaponId: 'weapon.heavy_blade.001' }));
    placeInFrontOfHead(cut);
    swing(cut);
    expect(cut.recentHits[0]!.partId).toBe('head');
    expect(cut.monsters[0]!.ailments.gauge.stun).toBe(0);
    // 頭の印が無ければ（試しに外す）、打撃でもたまらない
    const c = withMonster('monster.training_dummy', (d) => ({ ...d, parts: d.parts.map((p) => ({ ...p, head: false })) }));
    const nohead = new Simulation(c, baseOptions({ weaponId: 'weapon.war_maul.001' }));
    placeInFrontOfHead(nohead, dist);
    swing(nohead);
    expect(nohead.recentHits[0]!.partId).toBe('head');
    expect(nohead.monsters[0]!.ailments.gauge.stun).toBe(0);
  });
});

describe('受ける攻撃と、防具の技能（simulation）', () => {
  /** ガルドロスを正面に置き、噛みつき（威力 24）だけを使わせる（tests/rank.test.ts と同じ） */
  const firstBite = (c: Content, armorIds: string[]): number => {
    const sim = new Simulation(c, baseOptions({ questId: 'quest.basin.003', armorIds }));
    const m = sim.monsters[0]!;
    m.pos = { x: 0, y: 0, z: 10 };
    m.prevPos = { ...m.pos };
    m.yaw = Math.PI;
    m.prevYaw = Math.PI;
    m.aware = true;
    m.cooldown = 0;
    for (const ch of m.def.ai.choices) if (ch.actionId !== 'monster.galdros.bite') m.moveCooldowns[ch.actionId] = 1e9;
    sim.player.pos = { x: 0, y: 0, z: 10 - 3.4 };
    sim.player.prevPos = { ...sim.player.pos };
    for (let i = 0; i < 400; i++) {
      sim.step(frame());
      const hurt = ofType(sim.drainEvents(), 'player_hurt')[0];
      if (hurt) return hurt.damage;
    }
    throw new Error('噛みつきが当たらなかった');
  };

  it('属性を持つ種の攻撃は、耐性で変わる（岩殻一式: 火 -10 で増え、雷 +15 で減る。属性の無い種は同じ）', () => {
    const def = 100 / (100 + 30);
    const as = (el: 'fire' | 'thunder' | null): number => firstBite(el ? withMonster('monster.galdros', (d) => ({ ...d, element: el })) : content, galdrosSet(2));
    expect(as(null)).toBe(Math.floor(24 * def + 1e-9));
    expect(as('fire')).toBe(Math.floor(24 * (0.7 + 0.3 * 1.1) * def + 1e-9));
    expect(as('thunder')).toBe(Math.floor(24 * (0.7 + 0.3 * 0.85) * def + 1e-9));
  });

  it('受ける値は小数のまま渡し、分かれた後で 1 回だけ切り捨てる（72.864 の防御崩れ × 0.7 → 51、ふつうに受けて 72）', () => {
    const sim = new Simulation(content, baseOptions({ weaponId: 'weapon.guard_blade.001' }));
    const p = sim.player;
    p.mode = 'guard';
    p.drawn = true;
    p.guard = { phase: 'hold', tick: 40 };
    p.stamina = 0;
    const from = { x: p.pos.x, y: 0, z: p.pos.z + 3 };
    expect(resolveIncomingHit(p, { attackerPos: from, baseDamage: 72.864, guardable: true, guardCost: 20, reaction: 'flinch' }, sim)).toBe('guard_break');
    expect(ofType(sim.drainEvents(), 'guard_break')[0]!.damage).toBe(51);
    const s2 = new Simulation(content, baseOptions({ weaponId: 'weapon.guard_blade.001' }));
    expect(resolveIncomingHit(s2.player, { attackerPos: from, baseDamage: 72.864, guardable: false, guardCost: 20, reaction: 'flinch' }, s2)).toBe('hit');
    expect(ofType(s2.drainEvents(), 'player_hurt')[0]!.damage).toBe(72);
  });

  it('受け支え Lv3（岩殻一式）: 防御で受けた時のスタミナの消費が 20% 減る', () => {
    const spent = (armorIds: string[]): number => {
      const sim = new Simulation(content, baseOptions({ weaponId: 'weapon.guard_blade.001', armorIds }));
      const p = sim.player;
      p.mode = 'guard';
      p.drawn = true;
      p.guard = { phase: 'hold', tick: 40 };
      expect(resolveIncomingHit(p, { attackerPos: { x: p.pos.x, y: 0, z: p.pos.z + 3 }, baseDamage: 10, guardable: true, guardCost: 30, reaction: 'flinch' }, sim)).toBe('guarded');
      return 100 - p.stamina;
    };
    expect(spent([])).toBe(30);
    expect(spent(galdrosSet(2))).toBeCloseTo(24, 10);
  });

  it('身軽 Lv3（帆角の頭・腕・脚）: 回避のスタミナが 13% 減る。息継ぎ Lv2（胴・腰）: 自然な回復が 7% 速い', () => {
    const roll = (armorIds: string[]): Simulation => {
      const sim = new Simulation(content, baseOptions({ armorIds }));
      run(sim, 1, () => press(Btn.Dodge));
      return sim;
    };
    expect(100 - roll([]).player.stamina).toBe(25);
    const s = roll(seriesSet('selvark'));
    expect(100 - s.player.stamina).toBeCloseTo(25 * 0.87, 10);
    const regen = (armorIds: string[]): number => {
      const sim = new Simulation(content, baseOptions({ armorIds }));
      sim.player.stamina = 50;
      run(sim, 60);
      return sim.player.stamina - 50;
    };
    expect(regen([])).toBeCloseTo(content.player.staminaRegenPerSec, 6);
    expect(regen(seriesSet('selvark'))).toBeCloseTo(content.player.staminaRegenPerSec * 1.07, 6);
  });

  it('個別状態耐性（泥冠の胴・腰で毒 35%）: 毒の発症までにためる量が 135 になる', () => {
    const sim = new Simulation(content, baseOptions({ armorIds: seriesSet('numeradon') }));
    applyStatus(sim.player, { kind: 'poison', power: 100 }, sim);
    expect(sim.player.ailment.poisonTicks).toBe(0);
    applyStatus(sim.player, { kind: 'poison', power: 40 }, sim);
    expect(sim.player.ailment.poisonTicks).toBeGreaterThan(0);
    // 防具が無ければ 100 で発症
    const bare = new Simulation(content, baseOptions());
    applyStatus(bare.player, { kind: 'poison', power: 100 }, bare);
    expect(bare.player.ailment.poisonTicks).toBeGreaterThan(0);
  });

  it('道具整備 Lv2（絹霧の胴・腰）: 研磨石を使う時間が 9% 短い（効き目は同じ）。刃持ち Lv2: 刃の減りが 9% 少ない', () => {
    const whet = (armorIds: string[]): number => {
      const sim = new Simulation(content, baseOptions({ armorIds }));
      sim.player.edge = 10;
      sim.player.drawn = false; // v0.40.0（2G）: 研磨石は納刀して使う
      for (let i = 0; i < 400; i++) {
        sim.step(i === 0 ? press(Btn.Item) : frame());
        if (ofType(sim.drainEvents(), 'item_effect').some((e) => e.kind === 'whet' && e.ok)) return i;
      }
      throw new Error('研げなかった');
    };
    const base = whet([]);
    const fast = whet(seriesSet('verito'));
    expect(fast).toBeLessThan(base);
    expect(fast).toBeGreaterThanOrEqual(Math.floor(base * 0.91) - 1);
    expect(fast).toBeLessThanOrEqual(Math.ceil(base * 0.91) + 1);
    const wear = (armorIds: string[]): number => {
      const sim = new Simulation(content, baseOptions({ armorIds }));
      placeInFrontOfHead(sim);
      const e0 = sim.player.edge;
      swing(sim);
      return e0 - sim.player.edge;
    };
    expect(wear(galdrosSet(2))).toBeCloseTo(wear([]) * 0.91, 6);
  });

  it('砕き Lv2（鐘嚢の胴・腰）: 部位の耐久の減りだけが 9% 多い（体力の減りは同じ）', () => {
    const hitPart = (armorIds: string[]): [number, number] => {
      const sim = new Simulation(content, baseOptions({ armorIds }));
      const m = sim.monsters[0]!;
      placeInFrontOfHead(sim);
      const hp = m.hp;
      const dur = m.parts[0]!.durability;
      swing(sim);
      return [hp - m.hp, dur - m.parts[0]!.durability];
    };
    const [hp0, d0] = hitPart([]);
    const [hp1, d1] = hitPart(seriesSet('bornakel'));
    expect(hp1).toBe(hp0);
    expect(d1).toBeCloseTo(d0 * 1.09, 6);
  });
});

describe('装備の性能の書き方（装備箱・工房。src/ui/gearText.ts）', () => {
  it('武器: 属性・状態異常・会心。防具: 技能と耐性。まとめ: 技能の Lv と効き目、耐性の合計', async () => {
    const { armorStat, gearSummary, weaponShortName, weaponStat } = await import('../src/ui/gearText');
    const w = (id: string) => content.weapons.get(id)!;
    expect(weaponStat(content, w('weapon.heavy_blade.selvark.r1'))).toMatch(/^攻撃力 85・刃 \d+\/\d+・風 26$/);
    expect(weaponStat(content, w('weapon.heavy_blade.verito.r1'))).toMatch(/^攻撃力 86・刃 \d+\/\d+・毒 9\.2$/);
    expect(weaponStat(content, w('weapon.heavy_blade.orglass.r1'))).toMatch(/^攻撃力 86・刃 \d+\/\d+・会心 25%$/);
    expect(weaponStat(content, w('weapon.heavy_blade.002'))).toMatch(/^攻撃力 92・刃 \d+\/\d+$/);
    expect(weaponShortName(content, w('weapon.heavy_blade.selvark.r1'))).toBe('帆角【初級】');
    expect(weaponShortName(content, w('weapon.heavy_blade.002'))).toBe('岩殻');
    const num=armorStat(content, content.armor.get('armor.head.numeradon.r1')!);
    expect(num).toMatch(/^防御 6・/);expect(num).toContain('個別属性耐性（水） +3');expect(num).toContain('雷 -2 水 +3');expect(num).toContain('空き枠 1');
    const ash=armorStat(content, content.armor.get('armor.chest.ashreia.r1')!);
    expect(ash).toMatch(/^防御 6・/);expect(ash).toContain('個別状態耐性（睡眠）');expect(ash).toContain('火 -2 霧 +3');
    expect(armorStat(content, content.armor.get('armor.head.001')!)).toBe('防御 0');
    const g = computeGear(content, w('weapon.heavy_blade.001'), galdrosSet(2));
    expect(gearSummary(content, g)).toEqual({ skills: '受け支え Lv3（防御のスタミナ -20%）・刃持ち Lv2（刃の減り -9%）', resist: '火 -10・雷 +15' });
    const n = computeGear(content, w('weapon.heavy_blade.001'), seriesSet('numeradon'));
    expect(gearSummary(content, n).skills).toBe('個別属性耐性（水） Lv3（耐性 +9）・個別状態耐性（毒） Lv2（発症まで +35%）');
  });
});
