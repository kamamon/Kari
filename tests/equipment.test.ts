// 系列の装備（v0.32.0。ChatGPT の全装備四級版 #15 の最初の一切れ。docs/spec.md の 29 章、D-113）。v0.33.0 で 19 系列（属性・状態異常も）
// v0.75.0（利用者の指示。D-175）: 白紙にした 19 種を外したので、equipment:gen の出力の系列は空（これまでの防具の耐性と技能 armorTraits だけ）。
//   いま作れる系列は、スパインゲイルとフロストアルド（ChatGPT の #50・#51 のデータ。equipment:gen の出力ではない）。作る・強化の仕組みは、この 2 系列で確かめる。
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
/** いま作れる系列（v0.75.0。どちらも ChatGPT のデータ） */
const SERIES = ['series.spinegale', 'series.frostald'];
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

describe('系列の装備のデータ', () => {
  it('equipment:gen の出力の系列は空（19 種の系列を外した。v0.75.0）。いまある系列はスパインゲイルとフロストアルドで、ガルドロスの 35 武器・25 防具・48 強化は、そのまま', () => {
    const gen = JSON.parse(readFileSync(root('public/data/equipment_series.json'), 'utf8')) as { weapons: unknown[]; armor: unknown[]; recipes: unknown[]; armorTraits: Record<string, unknown> };
    expect([gen.weapons.length, gen.armor.length, gen.recipes.length, Object.keys(gen.armorTraits).length]).toEqual([0, 0, 0, 20]);
    const weapons = [...content.weapons.values()].filter((w) => w.series?.startsWith('series.'));
    const armor = [...content.armor.values()].filter((a) => a.series?.startsWith('series.'));
    expect(new Set(weapons.map((w) => w.series))).toEqual(new Set(SERIES));
    expect(new Set(armor.map((a) => a.series))).toEqual(new Set(SERIES));
    // 2 系列 × 3 級 × （いまある 7 系統の武器 + 防具 5）。初級は作る、上の級は 1 つ下からの強化
    expect(weapons).toHaveLength(2 * 3 * 7);
    expect(armor).toHaveLength(2 * 3 * 5);
    expect(crafts()).toHaveLength(2 * 12);
    for (const w of weapons) expect(content.families.has(w.family), w.id).toBe(true);
    expect([...content.weapons.values()].filter((w) => !w.series)).toHaveLength(35);
    expect([...content.armor.values()].filter((a) => !a.series)).toHaveLength(25);
    expect([...content.recipes.values()].filter((r) => (r.kind === 'upgrade' && !content.weapons.get(r.resultWeaponId)!.series) || (r.kind === 'armor_upgrade' && !content.armor.get(r.resultArmorId)!.series))).toHaveLength(48);
    // 外した 19 種の装備・素材は、どこにも残っていない
    const gone = /\.(selvark|numeradon|bornakel|ashreia|lumisca|orglass|tengaro|verito|razmer|kirisave|velgait|kordopil|palseit|numaporon|chilumicana|kohalgis|mitogaron|yurtepica|hinasalv)\./;
    expect([...content.weapons.keys(), ...content.armor.keys(), ...content.recipes.keys(), ...content.materials.keys()].filter((id) => gone.test(id))).toEqual([]);
  });

  it('中級の強化: 疾棘断剣（スパインゲイルの初級の断岳剣）を持っていて、中級の素材がそろうと裂風断剣になる（元は無くなる）。素材は中級のスパインゲイルの依頼で手に入る', () => {
    const r = content.recipes.get('recipe.upgrade.weapon.spinegale.heavy_blade.r2')!;
    expect(r.kind).toBe('upgrade');
    const doc: SaveDoc = { ...newSave(content, STAMP), weapons: [...newSave(content, STAMP).weapons, 'weapon.heavy_blade.spinegale.r1'], money: r.cost.money, items: Object.fromEntries(r.cost.items.map((s) => [s.itemId, s.count])) };
    // 中級は、岩場の足音を達成するまで開かない
    expect(craftRankOpen(doc, content, r)).toBe(false);
    const cleared: SaveDoc = { ...doc, progress: { ...doc.progress, questClears: { ...doc.progress.questClears, 'quest.basin.003': 1 } } };
    expect(craftRankOpen(cleared, content, r)).toBe(true);
    const next = craft(cleared, r);
    expect(next.weapons).toContain('weapon.heavy_blade.spinegale.r2');
    expect(next.weapons).not.toContain('weapon.heavy_blade.spinegale.r1');
    expect(next.money).toBe(0);
    const q = content.quests.get('quest.spinegale.r2')!;
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
      const w = content.weapons.get('weapon.heavy_blade.spinegale.r1')!;
      c.weapons.set(w.id, { ...w, rankId: 'rank.9' });
    })).toMatch(/級 rank.9 が無い/);
  });
});

describe('工房で作る（直接生産）', () => {
  const give = (doc: SaveDoc, items: Record<string, number>, money: number): SaveDoc => ({ ...doc, money, items: { ...doc.items, ...items } });

  it('素材と通貨を減らして持ち物に足す。装備は替えない。2 度は作れない。足りなければ何も変えない', () => {
    const r = content.recipes.get('recipe.craft.weapon.spinegale.war_maul.r1')!;
    expect(r.kind).toBe('craft');
    const need = Object.fromEntries(r.cost.items.map((s) => [s.itemId, s.count]));
    const doc = give(newSave(content, STAMP), need, r.cost.money + 5);
    const before = JSON.stringify(doc);
    expect(checkCraft(doc, r).ok).toBe(true);
    const next = craft(doc, r);
    expect(next.weapons).toContain('weapon.war_maul.spinegale.r1');
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
    const a = content.recipes.get('recipe.craft.armor.frostald.head.r1')!;
    const adoc = give(newSave(content, STAMP), Object.fromEntries(a.cost.items.map((s) => [s.itemId, s.count])), a.cost.money);
    const anext = craft(adoc, a);
    expect(anext.armor).toContain('armor.head.frostald.r1');
    expect(anext.equippedArmorIds).toEqual(adoc.equippedArmorIds);
  });

  it('級が開いていない物は作れない（その級の依頼が 1 つも受けられない）。初級は最初から開いている', () => {
    const r = content.recipes.get('recipe.craft.weapon.frostald.long_blade.r1')!;
    const doc = give(newSave(content, STAMP), Object.fromEntries(r.cost.items.map((s) => [s.itemId, s.count])), r.cost.money);
    expect(craftRankOpen(doc, content, r)).toBe(true);
    // 試しに、この武器を中級（rank.2）の物にする: 中級の依頼は、岩場の足音を達成するまで受けられない
    const w = content.weapons.get('weapon.long_blade.frostald.r1')!;
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
    const r = content.recipes.get('recipe.craft.weapon.spinegale.ring_bow.r1')!;
    await m.settle({ runId: 'eq-1', questId: 'quest.basin.003', money: r.cost.money, items: r.cost.items.map((s) => ({ itemId: s.itemId, count: s.count })) });
    const rev = m.doc.revision;
    expect(await m.craft(r.id)).toEqual({ ok: true });
    expect(m.doc.revision).toBe(rev + 1);
    expect(m.doc.weapons).toContain('weapon.ring_bow.spinegale.r1');
    const again = await SaveManager.open(content, b, env);
    expect(again.doc.weapons).toContain('weapon.ring_bow.spinegale.r1');
    expect((await again.craft(r.id)).ok).toBe(false);
  });
});

describe('作った武器で狩る', () => {
  it('氷冠断剣（フロストアルドの初級の断岳剣。攻撃力 80・氷 22）の縦斬り: 80 × 1.05 × 0.70 + 22 × 1.05 × 0.20 = 63.42 → 63', () => {
    const w = content.weapons.get('weapon.heavy_blade.frostald.r1')!;
    expect([w.name, w.attack, w.element, w.affinity]).toEqual(['氷冠断剣', 80, { type: 'ice', value: 22 }, 0]);
    const sim = new Simulation(content, baseOptions({ weaponId: w.id }));
    placeInFrontOfHead(sim);
    run(sim, 100, (i) => (i === 0 ? press(Btn.Main) : frame()));
    expect(sim.recentHits[0]!.damage).toBe(63);
  });

  it('疾棘断剣（スパインゲイルの初級の断岳剣。攻撃力 82・会心 10%）: 会心でない時は 60、会心の時は 82 × 1.05 × 0.70 × 会心の倍率', () => {
    const w = content.weapons.get('weapon.heavy_blade.spinegale.r1')!;
    expect([w.name, w.attack, w.element.type, w.affinity]).toEqual(['疾棘断剣', 82, 'none', 10]);
    const seen = new Map<number, number>();
    const critTo = Math.floor(82 * 1.05 * 0.7 * content.player.critMultiplier + 1e-9);
    for (let seed = 1; seed <= 120; seed++) {
      const sim = new Simulation(content, baseOptions({ seed, weaponId: w.id }));
      placeInFrontOfHead(sim);
      run(sim, 100, (i) => (i === 0 ? press(Btn.Main) : frame()));
      const d = sim.recentHits[0]!.damage;
      seen.set(d, (seen.get(d) ?? 0) + 1);
    }
    expect([...seen.keys()].sort((a, b) => a - b)).toEqual([60, critTo]);
    // 会心は 10% のあたり（120 回のうち 3〜24 回）
    expect(seen.get(critTo)!).toBeGreaterThanOrEqual(3);
    expect(seen.get(critTo)!).toBeLessThanOrEqual(24);
  });
});
