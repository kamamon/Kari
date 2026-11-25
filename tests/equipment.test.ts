// 系列の装備（v0.32.0。ChatGPT の全装備四級版 #15 の最初の一切れ。docs/spec.md の 29 章、D-113）。
// - 生成した public/data/equipment_series.json が、設計のデータ（docs/source/chatgpt-equipment-20261125/data/all-equipment.json）の値のまま
// - 工房の「作る」: 素材と通貨を 1 回の書き込みで減らし、持ち物へ足す（装備は替えない）。2 度は作れない。足りなければ何も変えない
// - 級が開いていない物は作れない。素材が、その級より上でしか手に入らないレシピは、検査が見つける
// - 作った武器で狩ると、その攻撃力と会心で当たる
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Content, RecipeDef } from '../src/data/schemas';
import { crossCheck } from '../src/data/validators';
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
  weaponCandidates: { id: string; seriesId: string; family: string; rank: number; name: string; attack: number; affinity: number; elementValue: number; statusPotency: number }[];
  armorCandidates: { id: string; seriesId: string; slot: string; rank: number; name: string; defense: number }[];
  recipes: { resultId: string; seriesId?: string; rank: number; kind: string; money: number; ingredients: { materialId: string; count: number }[] }[];
}
const design = (): Design => JSON.parse(readFileSync(root('docs/source/chatgpt-equipment-20261125/data/all-equipment.json'), 'utf8')) as Design;
const SERIES = ['series.bornakel', 'series.orglass', 'series.razmer', 'series.kordopil', 'series.kohalgis'];
const crafts = (): RecipeDef[] => [...content.recipes.values()].filter((r) => r.kind === 'craft' || r.kind === 'armor_craft');
let clock = 0;
const env: SaveEnv = { now: () => `2026-11-25T00:00:${String(clock++ % 60).padStart(2, '0')}.000Z`, appVersion: 'test' };
const STAMP = { now: '2026-11-25T00:00:00.000Z', appVersion: 'test', contentVersion: 'test' };

describe('系列の装備のデータ（#15 の初級・5 系列）', () => {
  it('5 系列 × 武器 7・防具 5 = 60 点と、作るレシピ 60。数値・素材・費用は設計のまま、恒久 ID に付け直した', () => {
    const d = design();
    const weapons = [...content.weapons.values()].filter((w) => w.series);
    const armor = [...content.armor.values()].filter((a) => a.series);
    expect(weapons).toHaveLength(35);
    expect(armor).toHaveLength(25);
    expect(crafts()).toHaveLength(60);
    expect(new Set(weapons.map((w) => w.series))).toEqual(new Set(SERIES));
    for (const sid of SERIES) {
      const s = d.series.find((x) => x.id === sid)!;
      // 入れるのは、いまの計算で働く系列だけ（無属性・会心。属性と状態異常は無い）
      expect(['raw', 'precision']).toContain(s.weaponProfile);
      expect(s.elements).toEqual([]);
      expect(s.status).toBeNull();
      const sp = s.sourceSpeciesId.split('.')[1];
      for (const w of d.weaponCandidates.filter((x) => x.seriesId === sid && x.rank === 1)) {
        const g = content.weapons.get(`weapon.${w.family}.${sp}.r1`)!;
        expect(g, w.id).toBeDefined();
        expect({ name: g.name, attack: g.attack, affinity: g.affinity, family: g.family, element: g.element.value, rankId: g.rankId }).toEqual({ name: w.name, attack: w.attack, affinity: w.affinity, family: w.family, element: 0, rankId: 'rank.1' });
        expect(w.elementValue + w.statusPotency).toBe(0);
        // 形は、その武器種の里の武器（仮）
        expect(g.assetId).toBe(`model.weapon.${w.family}.001`);
        const r = d.recipes.find((x) => x.resultId === w.id && x.kind === 'craft')!;
        const mine = crafts().find((x) => x.kind === 'craft' && x.resultWeaponId === g.id)!;
        expect(mine.cost).toEqual({ money: r.money, items: r.ingredients.map((i) => ({ itemId: i.materialId, count: i.count })) });
      }
      for (const a of d.armorCandidates.filter((x) => x.seriesId === sid && x.rank === 1)) {
        const g = content.armor.get(`armor.${a.slot}.${sp}.r1`)!;
        expect({ name: g.name, defense: g.defense, slot: g.slot, assetId: g.assetId }).toEqual({ name: a.name, defense: a.defense, slot: a.slot, assetId: undefined });
        const r = d.recipes.find((x) => x.resultId === a.id && x.kind === 'craft')!;
        const mine = crafts().find((x) => x.kind === 'armor_craft' && x.resultArmorId === g.id)!;
        expect(mine.cost).toEqual({ money: r.money, items: r.ingredients.map((i) => ({ itemId: i.materialId, count: i.count })) });
      }
    }
    // ガルドロスの 35 武器・25 防具・48 強化は、そのまま
    expect([...content.weapons.values()].filter((w) => !w.series)).toHaveLength(35);
    expect([...content.armor.values()].filter((a) => !a.series)).toHaveLength(25);
    expect([...content.recipes.values()].filter((r) => r.kind === 'upgrade' || r.kind === 'armor_upgrade')).toHaveLength(48);
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
