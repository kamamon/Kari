// 段階（初級・中級・上級・極級）と防具（v0.9.0、docs/spec.md 17 章）。
// 段階が上の依頼ほど、同じガルドロスが強い個体になる。防具の防御力で、受けるダメージが減る。
import { beforeAll, describe, expect, it } from 'vitest';
import type { Content } from '../src/data/schemas';
import { ANIMALS } from '../src/data/hubEstate';
import { lootForQuest, materialRanks, questMaterials } from '../src/data/validators';
import type { SimEvent } from '../src/game/events';
import { defenseScale, scaleMonsterDef, totalDefense } from '../src/game/rank';
import { Simulation } from '../src/game/sim';
import { baseOptions, frame, loadContent } from './helpers';

let content: Content;
beforeAll(async () => {
  content = await loadContent();
});

const QUESTS = ['quest.basin.003', 'quest.basin.r2.001', 'quest.basin.r3.001', 'quest.basin.r4.001'] as const;
const G = 'monster.galdros.';
const set = (tier: number): string[] => ['head', 'chest', 'arms', 'waist', 'legs'].map((s) => `armor.${s}.00${tier}`);

/** 依頼を始め、ガルドロスを原点の前に置いて、噛みつき（威力 24）だけを使わせる。相手は正面 3.4m。 */
function biteArena(questId: string, armorIds: string[] = []): Simulation {
  const sim = new Simulation(content, baseOptions({ questId, armorIds }));
  const m = sim.monsters[0]!;
  m.pos = { x: 0, y: 0, z: 10 };
  m.prevPos = { ...m.pos };
  m.yaw = Math.PI;
  m.prevYaw = Math.PI;
  m.aware = true;
  m.cooldown = 0;
  for (const c of m.def.ai.choices) if (c.actionId !== `${G}bite`) m.moveCooldowns[c.actionId] = 1e9;
  sim.player.pos = { x: 0, y: 0, z: 10 - 3.4 };
  sim.player.prevPos = { ...sim.player.pos };
  return sim;
}
/** 最初の 1 発で受けたダメージ */
function firstBite(sim: Simulation): number {
  for (let i = 0; i < 400; i++) {
    sim.step(frame());
    const hurt = sim.drainEvents().find((e): e is Extract<SimEvent, { type: 'player_hurt' }> => e.type === 'player_hurt');
    if (hurt) return hurt.damage;
  }
  throw new Error('噛みつきが当たらなかった');
}

describe('段階のデータ', () => {
  it('段階は 4 つ（初級・中級・上級・極級）。初級の倍率はすべて 1', () => {
    const ranks = [...content.ranks.values()].sort((a, b) => a.order - b.order);
    expect(ranks.map((r) => r.name)).toEqual(['初級', '中級', '上級', '極級']);
    expect(ranks[0]!.monster).toEqual({ hpScale: 1, partScale: 1, attackScale: 1, cooldownScale: 1 });
  });

  it('ガルドロスの依頼は段階ごとに 1 件。上の段階は、1 つ下の依頼の達成が条件。ほかの 11 種は初級 1 件ずつ、群れの依頼は 9 件で、最初から受けられる（v0.18.0）。セルヴァルク・コルドピル・パルセイトは中級〜極級も（v0.34.0。ガルドロスの段の道で開く）', () => {
    expect(QUESTS.map((id) => content.quests.get(id)!.rankId)).toEqual(['rank.1', 'rank.2', 'rank.3', 'rank.4']);
    expect(QUESTS.map((id) => content.quests.get(id)!.requires ?? [])).toEqual([[], ['quest.basin.003'], ['quest.basin.r2.001'], ['quest.basin.r3.001']]);
    const others = [...content.quests.values()].filter((q) => q.kind !== 'gather' && q.targetMonsterId !== 'monster.galdros');
    const first = others.filter((q) => q.rankId === 'rank.1');
    expect(first.filter((q) => !q.targets)).toHaveLength(12);
    expect(first.filter((q) => q.targets)).toHaveLength(9);
    for (const q of first) expect(q.requires ?? []).toEqual(q.id === 'quest.spinegale.r1' ? ['quest.basin.003'] : []);
    // 上の級（v0.34.0）: 3 種 × 中級〜極級。級を開く依頼は、ガルドロスの 1 つ下の段の依頼
    const upper = others.filter((q) => q.rankId !== 'rank.1');
    expect(upper.map((q) => q.id).sort()).toEqual(['quest.kordopil.pack.r2', 'quest.kordopil.pack.r3', 'quest.kordopil.pack.r4', 'quest.palseit.pack.r2', 'quest.palseit.pack.r3', 'quest.palseit.pack.r4', 'quest.selvark.r2', 'quest.selvark.r3', 'quest.selvark.r4', 'quest.spinegale.r2', 'quest.spinegale.r3']);
    const gate: Record<string, string> = { 'rank.2': 'quest.basin.003', 'rank.3': 'quest.basin.r2.001', 'rank.4': 'quest.basin.r3.001' };
    for (const q of upper) expect(q.requires, q.id).toEqual(q.id.startsWith('quest.spinegale.') ? [gate[q.rankId], `quest.spinegale.r${Number(q.rankId.split('.')[1])-1}`] : [gate[q.rankId]]);
    // 狩りの依頼 33 件と、狩らない依頼 5 件（v0.27.0。初級・最初から受けられる）
    const errands = [...content.quests.values()].filter((q) => q.kind === 'gather' && !q.gather?.fieldGathering);
    for (const q of errands) expect([q.rankId, q.requires ?? []]).toEqual(['rank.1', []]);
    expect([content.quests.size, errands.length]).toEqual([121, 5]);
  });

  it('段階ごとに、その段階からしか出ない素材が 2 つずつある。初級の 4 種は初級から出る', () => {
    const rankOf = materialRanks(content);
    // ガルドロスの素材（ほかの 11 種は初級だけ。素材は 4 つずつ。幼体 8 種は初級だけで、2〜3 つずつ）
    const from = (order: number): string[] => [...rankOf].filter(([id, o]) => o === order && id.startsWith('mat.galdros.')).map(([id]) => content.materials.get(id)!.name).sort();
    // ほかの 11 種 44・幼体 23・採集と採掘 4（v0.27.0）
    expect([...rankOf].filter(([id, o]) => !id.startsWith('mat.galdros.') && o === 1)).toHaveLength(44 + 23 + 15 + 19 * 5 + 6);
    expect(from(1)).toEqual(['前脚甲', '岩殻片', '硬骨', '青銅晶脈'].sort());
    expect(from(2)).toEqual(['尾端晶', '脈岩殻'].sort());
    expect(from(3)).toEqual(['晶岩殻', '青銅晶塊'].sort());
    expect(from(4)).toEqual(['脈動晶芯', '輝岩殻'].sort());
    // 畜産物だけは狩猟報酬ではなく、里の飼育・給餌・回収で入手する。
    // その他の全素材は引き続き依頼経由で入手可能でなければならない。
    const livestockProducts = Object.values(ANIMALS).map(a => a.product).sort();
    expect([...content.materials.keys()].filter(id => !rankOf.has(id)).sort()).toEqual(livestockProducts);
    expect(rankOf.size + livestockProducts.length).toBe(content.materials.size);
  });

  it('その段階の素材は、切らなくても壊さなくても手に入る（本体の剥ぎ取りか報酬に入っている）', () => {
    const rankOf = materialRanks(content);
    for (const id of QUESTS) {
      const q = content.quests.get(id)!;
      const order = content.ranks.get(q.rankId)!.order;
      const loot = lootForQuest(content, q)!;
      const plain = new Set([...loot.carve.table.map((e) => e.itemId), ...(q.rewards?.items ?? []).map((s) => s.itemId)]);
      for (const [mat, o] of rankOf) if (o === order && mat.startsWith('mat.galdros.')) expect(plain.has(mat), `${id}: ${mat}`).toBe(true);
      // 上の段階の素材が、下の段階の依頼に混ざっていない
      for (const mat of questMaterials(content, q)) expect(rankOf.get(mat)!, `${id}: ${mat}`).toBeLessThanOrEqual(order);
    }
  });
});

describe('段階が上の個体', () => {
  it('初級の個体は、元の定義そのまま（同じオブジェクト）', () => {
    const def = content.monsters.get('monster.galdros')!;
    expect(scaleMonsterDef(def, content.ranks.get('rank.1')!)).toBe(def);
    expect(new Simulation(content, baseOptions({ questId: QUESTS[0] })).monsters[0]!.def).toBe(def);
  });

  it('中級: 体力 2430、怒りの必要量 608、頭の耐久 297、尾の切断 351。元の定義は変えない', () => {
    const def = content.monsters.get('monster.galdros')!;
    const before = JSON.stringify(def);
    const d = scaleMonsterDef(def, content.ranks.get('rank.2')!);
    expect(d.hp).toBe(2430);
    expect(d.rage!.threshold).toBe(608);
    const part = (id: string) => d.parts.find((p) => p.id === id)!;
    expect(part('head').breakDurability).toBe(297);
    expect(part('head').flinch).toMatchObject({ threshold: 243, growth: 81 });
    expect(part('tail').sever!.threshold).toBe(351);
    expect(part('tail').breakDurability).toBeNull();
    expect(d.ai.cooldownTicks).toEqual(def.ai.cooldownTicks.map((v) => Math.round(v * 0.9)));
    // 肉質・形・技・捕獲の割合は変わらない
    expect(part('head').hitzone).toEqual(def.parts.find((p) => p.id === 'head')!.hitzone);
    expect(d.ai.choices).toBe(def.ai.choices);
    expect(d.capture).toBe(def.capture);
    expect(JSON.stringify(def)).toBe(before);
  });

  it('依頼ごとの体力は 1800 / 2430 / 3240 / 4320、与えるダメージの倍率は 1 / 1.3 / 1.65 / 2.05', () => {
    const sims = QUESTS.map((id) => new Simulation(content, baseOptions({ questId: id })));
    expect(sims.map((s) => s.monsters[0]!.hp)).toEqual([1800, 2430, 3240, 4320]);
    expect(sims.map((s) => s.monsterAttackScale)).toEqual([1, 1.3, 1.65, 2.05]);
    expect(sims.map((s) => s.rank!.name)).toEqual(['初級', '中級', '上級', '極級']);
    // 訓練場には段階が無い
    expect(new Simulation(content, baseOptions()).rank).toBeNull();
  });

  it('同じ噛みつきが、段階で重くなる: 24 → 31 → 39 → 49（里の装束）', () => {
    expect(QUESTS.map((id) => firstBite(biteArena(id)))).toEqual([24, 31, 39, 49]);
  });

  it('弱った合図（捕獲できる体力）は、その個体の体力の 25%', () => {
    const sim = new Simulation(content, baseOptions({ questId: QUESTS[3] }));
    const m = sim.monsters[0]!;
    expect(m.def.hp * m.def.capture!.hpRatio).toBe(1080);
  });

  it('上の段階でも、同じ入力なら同じ結果になる（決定論）', () => {
    const play = (): string => {
      const sim = biteArena(QUESTS[3]);
      for (let i = 0; i < 600; i++) sim.step(frame());
      return sim.hash();
    };
    expect(play()).toBe(play());
  });
});

describe('防具による軽減', () => {
  it('防御力の合計: 部位ごとに 1 つだけ数える。知らない ID は数えない', () => {
    expect(totalDefense(content, [])).toBe(0);
    expect(totalDefense(content, set(2))).toBe(30);
    expect(totalDefense(content, [...set(2), 'armor.head.005', 'armor.head.099'])).toBe(24 + 30);
    expect(defenseScale(content, 0)).toBe(1);
    expect(defenseScale(content, 100)).toBe(0.5);
  });

  it('里の装束（防御力 0）なら、防具を渡さない時と 1 tick も変わらない', () => {
    const a = biteArena(QUESTS[0]), b = biteArena(QUESTS[0], set(1));
    for (let i = 0; i < 400; i++) {
      a.step(frame());
      b.step(frame());
    }
    expect(b.hash()).toBe(a.hash());
    expect(b.player.hp).toBeLessThan(100);
  });

  it('初級の噛みつき 24 は、岩殻 18 / 脈殻 14 / 晶殻 11 / 輝殻 9 に減る', () => {
    expect([2, 3, 4, 5].map((t) => firstBite(biteArena(QUESTS[0], set(t))))).toEqual([18, 14, 11, 9]);
  });

  it('1 つ下の段の防具で上の段階へ行くと、初級を里の装束で受けるのとほぼ同じ（24 ± 1）', () => {
    const d = [1, 2, 3].map((i) => firstBite(biteArena(QUESTS[i]!, set(i + 1))));
    for (const v of d) expect(Math.abs(v - 24)).toBeLessThanOrEqual(1);
  });

  it('訓練場の標的の攻撃にも効く', () => {
    const sim = new Simulation(content, baseOptions({ armorIds: set(5) }));
    expect(sim.defense).toBe(150);
    expect(sim.defenseScale).toBe(0.4);
  });
});

describe('段階ごとの素材の抽選', () => {
  it('中級の個体を倒して剥ぎ取ると、中級の表から出る（初級の表ではない）', () => {
    const table = (questId: string): string[] => {
      const sim = new Simulation(content, baseOptions({ questId }));
      const m = sim.monsters[0]!;
      m.aware = true;
      m.hp = 1;
      sim.player.drawn = true;
      // 討伐の確定は simulation に任せる（体力を 0 にして 1 tick 進める）
      m.hp = 0;
      m.dead = true;
      const out: string[] = [];
      for (let i = 0; i < 30 && sim.hunt!.phase === 'active'; i++) sim.step(frame());
      for (let i = 0; i < 3; i++) sim.carve('body');
      for (const l of sim.hunt!.loot) out.push(l.itemId);
      return out;
    };
    const r1 = new Set(lootForQuest(content, content.quests.get(QUESTS[0])!)!.carve.table.map((e) => e.itemId));
    const r2 = new Set(lootForQuest(content, content.quests.get(QUESTS[1])!)!.carve.table.map((e) => e.itemId));
    expect(lootForQuest(content, content.quests.get(QUESTS[1])!)!.id).toBe('loot.galdros.r2');
    const got1 = table(QUESTS[0]), got2 = table(QUESTS[1]);
    expect(got1.length).toBe(3);
    expect(got2.length).toBe(3);
    for (const id of got1) expect(r1.has(id), id).toBe(true);
    for (const id of got2) expect(r2.has(id), id).toBe(true);
  });
});
