// 系列の装備（v0.32.0。ChatGPT の全装備四級版 #15 の最初の一切れ。docs/spec.md の 29 章、D-113）。v0.33.0 で 19 系列（属性・状態異常も）
// - 生成した public/data/equipment_series.json が、設計のデータ（docs/source/chatgpt-equipment-20261125/data/all-equipment.json）の値のまま
//   （属性・状態異常・防具の耐性と技能も。これまでの防具 岩殻〜輝殻 の耐性と技能 armorTraits も）
// - 工房の「作る」: 素材と通貨を 1 回の書き込みで減らし、持ち物へ足す（装備は替えない）。2 度は作れない。足りなければ何も変えない
// - 級が開いていない物は作れない。素材が、その級より上でしか手に入らないレシピは、検査が見つける
// - 作った武器で狩ると、その攻撃力と会心で当たる
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Content, RecipeDef } from '../src/data/schemas';
import { crossCheck, questMaterials } from '../src/data/validators';
import { Simulation } from '../src/game/sim';
import { checkCraft, craft, craftRankOpen, newSave, RuleError, type SaveDoc } from '../src/save/profile';
import { MemoryBackend } from '../src/save/saveDb';
import { SaveManager, type SaveEnv } from '../src/save/saveManager';
import { Btn, baseOptions, frame, loadContent, placeInFrontOfHead, press, run } from './helpers';

const root = (p: string): string => resolve(__dirname, '..', p);
let content: Content;
beforeAll(async () => {
  content = await loadContent();
});

interface Design {
  series: { id: string; sourceSpeciesId: string; weaponProfile: string; elements: string[]; status: string | null }[];
  weaponCandidates: { id: string; seriesId: string; family: string; rank: number; name: string; attack: number; affinity: number; elements: string[]; elementValue: number; status: string | null; statusPotency: number }[];
  armorCandidates: {
    id: string;
    seriesId: string;
    slot: string;
    rank: number;
    name: string;
    defense: number;
    resistances: Record<string, number>;
    skill: { id: string; points: number; parameters: { element?: string; status?: string } } | null;
    runtimeExists: boolean;
  }[];
  recipes: { resultId: string; seriesId?: string; rank: number; kind: string; fromId: string | null; consumesPrevious: boolean; money: number; ingredients: { materialId: string; name: string; count: number }[] }[];
  materials: { id: string; name: string; rankOrder: number }[];
}
const design = (): Design => JSON.parse(readFileSync(root('docs/source/chatgpt-equipment-20261125/data/all-equipment.json'), 'utf8')) as Design;
// 遊べる 20 種のうち、ガルドロスの他（登録簿の順）
const SERIES = [
  'series.selvark', 'series.numeradon', 'series.bornakel', 'series.ashreia', 'series.lumisca', 'series.orglass', 'series.tengaro', 'series.verito', 'series.razmer', 'series.kirisave', 'series.velgait',
  'series.kordopil', 'series.palseit', 'series.numaporon', 'series.chilumicana', 'series.kohalgis', 'series.mitogaron', 'series.yurtepica', 'series.hinasalv',
];
const STATUS_ID: Record<string, string> = { poison: 'poison', paralysis: 'para', sleep: 'sleep' };
/** 設計の防具の耐性（0 でないもの）と技能を、ゲームの形に */
const traitsOf = (a: Design['armorCandidates'][number]): { resist?: Record<string, number>; skill?: Record<string, unknown> } => {
  const resist = Object.fromEntries(Object.entries(a.resistances).filter(([, v]) => v !== 0));
  const out: { resist?: Record<string, number>; skill?: Record<string, unknown> } = {};
  if (Object.keys(resist).length) out.resist = resist;
  if (a.skill) {
    const sk: Record<string, unknown> = { id: a.skill.id, points: a.skill.points };
    if (a.skill.parameters.element) sk.element = a.skill.parameters.element;
    if (a.skill.parameters.status) sk.status = STATUS_ID[a.skill.parameters.status];
    out.skill = sk;
  }
  return out;
};
const crafts = (): RecipeDef[] => [...content.recipes.values()].filter((r) => (r.kind === 'craft' || r.kind === 'armor_craft') && !/^recipe\.(ore_only|bone_only)\./.test(r.id));
let clock = 0;
const env: SaveEnv = { now: () => `2026-11-25T00:00:${String(clock++ % 60).padStart(2, '0')}.000Z`, appVersion: 'test' };
const STAMP = { now: '2026-11-25T00:00:00.000Z', appVersion: 'test', contentVersion: 'test' };

describe('系列の装備のデータ（#15 の初級・19 系列）', () => {
  it('19 系列 × 武器 7・防具 5 = 228 点と、作るレシピ 228。数値・属性・状態異常・耐性・技能・素材・費用は設計のまま、恒久 ID に付け直した', () => {
    const d = design();
    const weapons = [...content.weapons.values()].filter((w) => w.series?.startsWith('series.') && w.rankId === 'rank.1');
    const armor = [...content.armor.values()].filter((a) => a.series?.startsWith('series.') && a.rankId === 'rank.1');
    expect(weapons).toHaveLength(147);
    expect(armor).toHaveLength(105);
    expect(crafts()).toHaveLength(252);
    expect(new Set(weapons.map((w) => w.series))).toEqual(new Set([...SERIES,'series.spinegale','series.frostald']));
    const profiles: Record<string, number> = {};
    for (const sid of SERIES) {
      const s = d.series.find((x) => x.id === sid)!;
      // 初級に複合は無い（上級・極級だけ）
      expect(['raw', 'precision', 'single', 'status']).toContain(s.weaponProfile);
      profiles[s.weaponProfile] = (profiles[s.weaponProfile] ?? 0) + 1;
      const sp = s.sourceSpeciesId.split('.')[1];
      for (const w of d.weaponCandidates.filter((x) => x.seriesId === sid && x.rank === 1)) {
        const g = content.weapons.get(`weapon.${w.family}.${sp}.r1`)!;
        expect(g, w.id).toBeDefined();
        const element = w.elements.length ? { type: w.elements[0], value: w.elementValue } : { type: 'none', value: 0 };
        const status = w.status ? { kind: STATUS_ID[w.status], potency: w.statusPotency } : undefined;
        expect({ name: g.name, attack: g.attack, affinity: g.affinity, family: g.family, element: g.element, status: g.status, rankId: g.rankId }).toEqual({ name: w.name, attack: w.attack, affinity: w.affinity, family: w.family, element, status, rankId: 'rank.1' });
        // 形は、その武器種の里の武器（仮）
        expect(g.assetId).toBe(`model.weapon.${w.family}.001`);
        const r = d.recipes.find((x) => x.resultId === w.id && x.kind === 'craft')!;
        const mine = crafts().find((x) => x.kind === 'craft' && x.resultWeaponId === g.id)!;
        expect(mine.cost).toEqual({ money: r.money, items: r.ingredients.map((i) => ({ itemId: i.materialId, count: i.count })) });
      }
      for (const a of d.armorCandidates.filter((x) => x.seriesId === sid && x.rank === 1)) {
        const g = content.armor.get(`armor.${a.slot}.${sp}.r1`)!;
        expect({ name: g.name, defense: g.defense, slot: g.slot, assetId: g.assetId }).toEqual({ name: a.name, defense: a.defense, slot: a.slot, assetId: undefined });
        expect({ resist: g.resist, skill: g.skill }).toEqual({ resist: undefined, skill: undefined, ...traitsOf(a) });
        const r = d.recipes.find((x) => x.resultId === a.id && x.kind === 'craft')!;
        const mine = crafts().find((x) => x.kind === 'armor_craft' && x.resultArmorId === g.id)!;
        expect(mine.cost).toEqual({ money: r.money, items: r.ingredients.map((i) => ({ itemId: i.materialId, count: i.count })) });
      }
    }
    expect(profiles).toEqual({ raw: 2, precision: 3, single: 9, status: 5 });
    // ガルドロスの 35 武器・25 防具・48 強化は、そのまま
    expect([...content.weapons.values()].filter((w) => !w.series)).toHaveLength(35);
    expect([...content.armor.values()].filter((a) => !a.series)).toHaveLength(25);
    expect([...content.recipes.values()].filter((r) => (r.kind === 'upgrade' && !content.weapons.get(r.resultWeaponId)!.series) || (r.kind === 'armor_upgrade' && !content.armor.get(r.resultArmorId)!.series))).toHaveLength(48);
  });

  it('中級〜極級（v0.34.0）: 帆角・幼岩・幼帆の 3 系列 × 3 級 × 武器 7・防具 5 = 108 点と、1 つ下の級からの強化 108。数値・素材の名前と数・費用は設計のまま', () => {
    const d = design();
    const ranked = ['selvark', 'kordopil', 'palseit'];
    const upgrades = [...content.recipes.values()].filter((r) => (r.kind === 'upgrade' && content.weapons.get(r.resultWeaponId)?.series?.startsWith('series.')) || (r.kind === 'armor_upgrade' && content.armor.get(r.resultArmorId)?.series?.startsWith('series.')));
    expect(upgrades).toHaveLength(156);
    expect([...content.weapons.values()].filter((w) => w.series?.startsWith('series.') && w.rankId !== 'rank.1')).toHaveLength(91);
    expect([...content.armor.values()].filter((a) => a.series?.startsWith('series.') && a.rankId !== 'rank.1')).toHaveLength(65);
    const dname = new Map(d.materials.map((m) => [m.id, m.name]));
    for (const sp of ranked) {
      const sid = `series.${sp}`;
      for (const rank of [2, 3, 4]) {
        for (const w of d.weaponCandidates.filter((x) => x.seriesId === sid && x.rank === rank)) {
          const g = content.weapons.get(`weapon.${w.family}.${sp}.r${rank}`)!;
          expect({ name: g.name, attack: g.attack, affinity: g.affinity, rankId: g.rankId, value: g.element.value }).toEqual({ name: w.name, attack: w.attack, affinity: w.affinity, rankId: `rank.${rank}`, value: w.elementValue });
          const r = d.recipes.find((x) => x.resultId === w.id && x.kind === 'upgrade')!;
          expect(r.consumesPrevious).toBe(true);
          const mine = upgrades.find((x) => x.kind === 'upgrade' && x.resultWeaponId === g.id) as Extract<RecipeDef, { kind: 'upgrade' }>;
          expect(mine.fromWeaponId).toBe(`weapon.${w.family}.${sp}.r${rank - 1}`);
          expect(mine.cost.money).toBe(r.money);
          // 素材は、設計の名前のまま（「帆膜［中級］」）、同じ数
          expect(mine.cost.items.map((s) => [content.materials.get(s.itemId)!.name, s.count])).toEqual(r.ingredients.map((i) => [dname.get(i.materialId) ?? i.name, i.count]));
        }
        for (const a of d.armorCandidates.filter((x) => x.seriesId === sid && x.rank === rank)) {
          const g = content.armor.get(`armor.${a.slot}.${sp}.r${rank}`)!;
          expect({ name: g.name, defense: g.defense, resist: g.resist, skill: g.skill }).toEqual({ name: a.name, defense: a.defense, resist: undefined, skill: undefined, ...traitsOf(a) });
          const mine = upgrades.find((x) => x.kind === 'armor_upgrade' && x.resultArmorId === g.id) as Extract<RecipeDef, { kind: 'armor_upgrade' }>;
          expect(mine.fromArmorId).toBe(`armor.${a.slot}.${sp}.r${rank - 1}`);
        }
      }
    }
    // ほかの 16 系列は初級だけ（設計の上の級の狩場が、まだ無い）
    expect([...content.weapons.values()].filter((w) => w.series?.startsWith('series.') && w.rankId !== 'rank.1' && w.series !== 'series.spinegale' && w.series !== 'series.frostald' && !ranked.some((sp) => w.series === `series.${sp}`))).toEqual([]);
  });

  it('中級の強化: 帆角の断岳剣【初級】を持っていて、中級の素材がそろうと【中級】になる（元は無くなる）。素材は中級のセルヴァルクの依頼で手に入る', () => {
    const r = content.recipes.get('recipe.upgrade.weapon.selvark.heavy_blade.r2')!;
    expect(r.kind).toBe('upgrade');
    const doc: SaveDoc = { ...newSave(content, STAMP), weapons: [...newSave(content, STAMP).weapons, 'weapon.heavy_blade.selvark.r1'], money: r.cost.money, items: Object.fromEntries(r.cost.items.map((s) => [s.itemId, s.count])) };
    // 中級は、岩場の足音を達成するまで開かない
    expect(craftRankOpen(doc, content, r)).toBe(false);
    const cleared: SaveDoc = { ...doc, progress: { ...doc.progress, questClears: { ...doc.progress.questClears, 'quest.basin.003': 1 } } };
    expect(craftRankOpen(cleared, content, r)).toBe(true);
    const next = craft(cleared, r);
    expect(next.weapons).toContain('weapon.heavy_blade.selvark.r2');
    expect(next.weapons).not.toContain('weapon.heavy_blade.selvark.r1');
    expect(next.money).toBe(0);
    const q = content.quests.get('quest.selvark.r2')!;
    for (const s of r.cost.items) expect(questMaterials(content, q).has(s.itemId), s.itemId).toBe(true);
  });

  it('これまでの防具（岩殻〜輝殻）に、設計の耐性（火 -2・雷 +3）と技能が付く。名前・防御力・見た目・里の服は、そのまま', () => {
    const d = design();
    const old = JSON.parse(readFileSync(root('public/data/armor.json'), 'utf8')) as { armor: { id: string; name: string; defense: number; assetId?: string }[] };
    const tiers: Record<number, string> = { 1: '002', 2: '003', 3: '004', 4: '005' };
    let n = 0;
    for (const a of d.armorCandidates.filter((x) => x.seriesId === 'series.galdros' && x.rank <= 4)) {
      const id = `armor.${a.slot}.${tiers[a.rank]}`;
      const g = content.armor.get(id)!;
      const o = old.armor.find((x) => x.id === id)!;
      expect(a.runtimeExists).toBe(true);
      expect({ name: g.name, defense: g.defense, assetId: g.assetId }).toEqual({ name: o.name, defense: o.defense, assetId: o.assetId });
      expect({ resist: g.resist, skill: g.skill }).toEqual(traitsOf(a));
      expect(g.resist).toEqual({ fire: -2, thunder: 3 });
      n++;
    }
    expect(n).toBe(20);
    // 里の服（.001）には付けない
    for (const slot of ['head', 'chest', 'arms', 'waist', 'legs']) expect(content.armor.get(`armor.${slot}.001`)!.skill).toBeUndefined();
  });

  it('検査: 素材が結果の級より上の依頼でしか手に入らない・結果が無い・級が無い、を見つける', () => {
    const check = (edit: (c: Content) => void): string => {
      const c: Content = { ...content, recipes: new Map(content.recipes), weapons: new Map(content.weapons) };
      edit(c);
      const errors: string[] = [];
      crossCheck(c, errors);
      return errors.join('\n');
    };
    expect(check(() => {})).toBe('');
    // ガルドロスの輝殻の素材（極級でしか出ない）を、初級の作るレシピに入れる
    expect(check((c) => {
      const r = crafts()[0]! as Extract<RecipeDef, { kind: 'craft' }>;
      c.recipes.set(r.id, { ...r, cost: { money: r.cost.money, items: [...r.cost.items, { itemId: 'mat.galdros.radiant_shell', count: 1 }] } });
    })).toMatch(/結果の級より上の依頼でしか手に入らない/);
    expect(check((c) => {
      const r = crafts()[0]! as Extract<RecipeDef, { kind: 'craft' }>;
      c.recipes.set(r.id, { ...r, resultWeaponId: 'weapon.none' });
    })).toMatch(/結果の武器 weapon.none が無い/);
    expect(check((c) => {
      const w = content.weapons.get('weapon.heavy_blade.bornakel.r1')!;
      c.weapons.set(w.id, { ...w, rankId: 'rank.9' });
    })).toMatch(/級 rank.9 が無い/);
  });
});

describe('工房で作る（直接生産）', () => {
  const give = (doc: SaveDoc, items: Record<string, number>, money: number): SaveDoc => ({ ...doc, money, items: { ...doc.items, ...items } });

  it('素材と通貨を減らして持ち物に足す。装備は替えない。2 度は作れない。足りなければ何も変えない', () => {
    const r = content.recipes.get('recipe.craft.weapon.bornakel.war_maul.r1')!;
    expect(r.kind).toBe('craft');
    const need = Object.fromEntries(r.cost.items.map((s) => [s.itemId, s.count]));
    const doc = give(newSave(content, STAMP), need, r.cost.money + 5);
    const before = JSON.stringify(doc);
    expect(checkCraft(doc, r).ok).toBe(true);
    const next = craft(doc, r);
    expect(next.weapons).toContain('weapon.war_maul.bornakel.r1');
    expect(next.equippedWeaponId).toBe(doc.equippedWeaponId);
    expect(next.money).toBe(5);
    for (const s of r.cost.items) expect(next.items[s.itemId] ?? 0).toBe(0);
    expect(JSON.stringify(doc)).toBe(before);
    expect(() => craft(next, r)).toThrow(RuleError);
    // 1 個足りない
    const short = give(newSave(content, STAMP), { ...need, [r.cost.items[0]!.itemId]: r.cost.items[0]!.count - 1 }, r.cost.money);
    expect(checkCraft(short, r).ok).toBe(false);
    expect(() => craft(short, r)).toThrow(/足りません/);
    // 防具も同じ: 持ち物に足し、身に着けない
    const a = content.recipes.get('recipe.craft.armor.kohalgis.head.r1')!;
    const adoc = give(newSave(content, STAMP), Object.fromEntries(a.cost.items.map((s) => [s.itemId, s.count])), a.cost.money);
    const anext = craft(adoc, a);
    expect(anext.armor).toContain('armor.head.kohalgis.r1');
    expect(anext.equippedArmorIds).toEqual(adoc.equippedArmorIds);
  });

  it('級が開いていない物は作れない（その級の依頼が 1 つも受けられない）。初級は最初から開いている', () => {
    const r = content.recipes.get('recipe.craft.weapon.orglass.long_blade.r1')!;
    const doc = give(newSave(content, STAMP), Object.fromEntries(r.cost.items.map((s) => [s.itemId, s.count])), r.cost.money);
    expect(craftRankOpen(doc, content, r)).toBe(true);
    // 試しに、この武器を中級（rank.2）の物にする: 中級の依頼は、岩場の足音を達成するまで受けられない
    const w = content.weapons.get('weapon.long_blade.orglass.r1')!;
    const c2: Content = { ...content, weapons: new Map(content.weapons) };
    c2.weapons.set(w.id, { ...w, rankId: 'rank.2' });
    expect(craftRankOpen(doc, c2, r)).toBe(false);
    expect(checkCraft(doc, r, false).ok).toBe(false);
    expect(() => craft(doc, r, false)).toThrow(/まだ作れません/);
    const cleared: SaveDoc = { ...doc, progress: { ...doc.progress, questClears: { ...doc.progress.questClears, 'quest.basin.003': 1 } } };
    expect(craftRankOpen(cleared, c2, r)).toBe(true);
  });

  it('保存の管理役を通して作る: 1 回の書き込みで確定し、読み直しても残る', async () => {
    const b = new MemoryBackend();
    const m = await SaveManager.open(content, b, env);
    const r = content.recipes.get('recipe.craft.weapon.razmer.ring_bow.r1')!;
    await m.settle({ runId: 'eq-1', questId: 'quest.basin.003', money: r.cost.money, items: r.cost.items.map((s) => ({ itemId: s.itemId, count: s.count })) });
    const rev = m.doc.revision;
    expect(await m.craft(r.id)).toEqual({ ok: true });
    expect(m.doc.revision).toBe(rev + 1);
    expect(m.doc.weapons).toContain('weapon.ring_bow.razmer.r1');
    const again = await SaveManager.open(content, b, env);
    expect(again.doc.weapons).toContain('weapon.ring_bow.razmer.r1');
    expect((await again.craft(r.id)).ok).toBe(false);
  });
});

describe('作った武器で狩る', () => {
  it('鐘嚢の断岳剣（攻撃力 92）の縦斬り: 92 × 1.05 × 0.70 = 67.62 → 67', () => {
    const sim = new Simulation(content, baseOptions({ weaponId: 'weapon.heavy_blade.bornakel.r1' }));
    placeInFrontOfHead(sim);
    run(sim, 100, (i) => (i === 0 ? press(Btn.Main) : frame()));
    expect(sim.recentHits[0]!.damage).toBe(67);
  });

  it('硝殻の断岳剣（攻撃力 86・会心 25%）: 会心でない時は 63、会心の時は 86 × 1.05 × 0.70 × 会心の倍率', () => {
    const seen = new Set<number>();
    const critTo = Math.floor(86 * 1.05 * 0.7 * content.player.critMultiplier + 1e-9);
    for (let seed = 1; seed <= 24; seed++) {
      const sim = new Simulation(content, baseOptions({ seed, weaponId: 'weapon.heavy_blade.orglass.r1' }));
      placeInFrontOfHead(sim);
      run(sim, 100, (i) => (i === 0 ? press(Btn.Main) : frame()));
      seen.add(sim.recentHits[0]!.damage);
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([63, critTo]);
  });
});

describe('上の級の依頼（v0.34.0）', () => {
  it('中級のセルヴァルク: 中級の倍率で出て、剥ぎ取り・報酬は中級の素材だけ。中級の群れの幼体も、中級の素材を落とす', () => {
    const r2 = content.ranks.get('rank.2')!;
    const sim = new Simulation(content, baseOptions({ questId: 'quest.selvark.r2' }));
    const m = sim.monsters[0]!;
    expect(m.def.hp).toBe(Math.round(content.monsters.get('monster.selvark')!.hp * r2.monster.hpScale));
    expect(sim.monsterAttackScale).toBe(r2.monster.attackScale);
    m.hp = 0;
    m.dead = true;
    for (let i = 0; i < 30 && sim.hunt!.phase === 'active'; i++) sim.step(frame());
    expect(sim.hunt!.phase).toBe('success');
    for (let i = 0; i < 3; i++) sim.carve('body');
    const r2mats = new Set([...content.materials.keys()].filter((k) => k.startsWith('mat.selvark.') && k.endsWith('.r2')));
    expect(sim.hunt!.loot.length).toBeGreaterThan(0);
    for (const l of sim.hunt!.loot) expect(r2mats.has(l.itemId), l.itemId).toBe(true);
    // 群れ: 中級の依頼の幼体は、中級の倍率と中級の表
    const pack = new Simulation(content, baseOptions({ questId: 'quest.palseit.pack.r2' }));
    const j = pack.monsters.find((x) => x.herd)!;
    expect(j.def.hp).toBe(Math.round(content.monsters.get('monster.palseit')!.hp * r2.monster.hpScale));
    j.hp = 0;
    j.dead = true;
    pack.hunt!.carves[`body:${j.id}`] = 1;
    pack.carve(`body:${j.id}`);
    expect(pack.hunt!.loot.map((l) => l.itemId)).toHaveLength(1);
    expect(pack.hunt!.loot[0]!.itemId).toMatch(/^mat\.palseit\.[a-z_]+\.r2$/);
  });
});
