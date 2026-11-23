// 保存（里の持ち物・装備・進行）。置き場所はメモリの代用品で、IndexedDB そのものは操作検査（npm run smoke）で確かめる。
// 「別のタブ」は、同じ置き場所を共有する 2 つの管理役で表す。
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { ARMOR_SLOTS, recipeResult, type ArmorRecipeDef, type Content, type QuestDef, type WeaponRecipeDef } from '../src/data/schemas';
import { materialRanks, obtainableMaterials } from '../src/data/validators';
import { MAX_SETTLED_RUNS, SAVE_SCHEMA_VERSION, SLOT_ID, checkCraft, defenseOf, newSave, parseImport, playWeaponId, questUnlocked, readSave, unknownIds, usableWeapons, validateSave, wornArmor, type SaveDoc } from '../src/save/profile';
import { KEEP_BACKUPS, MemoryBackend } from '../src/save/saveDb';
import { SaveManager, type SaveEnv } from '../src/save/saveManager';
import { loadContent } from './helpers';

let content: Content;
beforeAll(async () => {
  content = await loadContent();
});

let clock = 0;
const env = (): SaveEnv => ({ now: () => `2026-11-24T00:00:${String(clock++ % 60).padStart(2, '0')}.000Z`, appVersion: 'test' });
const open = (b: MemoryBackend | null): Promise<SaveManager> => SaveManager.open(content, b, env());
const SHELL = 'mat.galdros.shell_shard', BONE = 'mat.galdros.hard_bone', VEIN = 'mat.galdros.bronze_vein';
const RECIPE = 'recipe.heavy_blade.002';
const rewards = (runId: string, money = 600, items: [string, number][] = [[SHELL, 2]]): { runId: string; questId: string; money: number; items: { itemId: string; count: number }[] } => ({
  runId,
  questId: 'quest.basin.003',
  money,
  items: items.map(([itemId, count]) => ({ itemId, count })),
});
/** 強化に足りるだけの報酬 */
const enough = (runId: string): ReturnType<typeof rewards> => rewards(runId, 600, [[SHELL, 3], [BONE, 2], [VEIN, 1]]);

describe('新しい保存データ', () => {
  it('最初から持つ武器 7 つを持ち、断岳剣を装備している。まだ書き込まない', async () => {
    const b = new MemoryBackend();
    const m = await open(b);
    expect(m.mode).toBe('memory'); // 代用品は「ページを閉じると消える」扱い
    expect(m.doc.revision).toBe(0);
    expect(m.doc.weapons).toHaveLength(7);
    expect(m.doc.equippedWeaponId).toBe('weapon.heavy_blade.001');
    expect(m.doc.weapons).not.toContain('weapon.heavy_blade.002');
    expect(validateSave(m.doc)).toEqual([]);
    expect(b.writes).toBe(0);
  });
});

describe('報酬の受け取り', () => {
  it('通貨・素材・達成回数・処理済みの記録が、1 回の書き込みで入る', async () => {
    const b = new MemoryBackend();
    const m = await open(b);
    expect(await m.settle(rewards('run-1'))).toEqual({ ok: true });
    expect(b.writes).toBe(1);
    expect(m.doc).toMatchObject({ revision: 1, money: 600, items: { [SHELL]: 2 }, progress: { questClears: { 'quest.basin.003': 1 } }, settledRuns: ['run-1'] });
  });

  it('同じ依頼（runId）を何度受け取っても、1 回分しか入らない。書き込みも増えない', async () => {
    const b = new MemoryBackend();
    const m = await open(b);
    await m.settle(rewards('run-1'));
    expect(await m.settle(rewards('run-1'))).toEqual({ ok: true });
    await Promise.all([m.settle(rewards('run-1')), m.settle(rewards('run-1'))]);
    expect(m.doc.money).toBe(600);
    expect(m.doc.items[SHELL]).toBe(2);
    expect(b.writes).toBe(1);
  });

  it('読み込み直しても（別の管理役で開いても）同じ内容で、処理済みの依頼は増えない', async () => {
    const b = new MemoryBackend();
    const m = await open(b);
    await m.settle(rewards('run-1'));
    const again = await open(b);
    expect(again.doc).toEqual(m.doc);
    await again.settle(rewards('run-1'));
    expect(again.doc.money).toBe(600);
    expect(again.isSettled('run-1')).toBe(true);
  });

  it('書き込みに失敗したら、持ち物は増えず、失敗が返る。やり直すと 1 回分だけ入る', async () => {
    const b = new MemoryBackend();
    const m = await open(b);
    b.failNext = new Error('容量が足りません');
    const r = await m.settle(rewards('run-1'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('failed');
    expect(m.doc.money).toBe(0);
    expect(m.isSettled('run-1')).toBe(false);
    expect(b.peek(SLOT_ID)).toBeNull();
    expect(await m.settle(rewards('run-1'))).toEqual({ ok: true });
    expect(m.doc.money).toBe(600);
  });

  it(`処理済みの記録は ${MAX_SETTLED_RUNS} 件まで。古いものから捨てる`, async () => {
    const m = await open(new MemoryBackend());
    for (let i = 0; i < MAX_SETTLED_RUNS + 5; i++) await m.settle(rewards(`run-${i}`, 1, []));
    expect(m.doc.settledRuns).toHaveLength(MAX_SETTLED_RUNS);
    expect(m.doc.settledRuns[0]).toBe('run-5');
    expect(m.doc.money).toBe(MAX_SETTLED_RUNS + 5);
  });
});

describe('強化（岩殻の断岳剣）', () => {
  it('レシピの素材は、いまの依頼で手に入るものだけ', () => {
    const can = obtainableMaterials(content);
    for (const r of content.recipes.values()) for (const s of r.cost.items) expect(can.has(s.itemId), `${r.id}: ${s.itemId}`).toBe(true);
  });

  it('素材が足りない時は、何も減らず、何も書かない', async () => {
    const b = new MemoryBackend();
    const m = await open(b);
    await m.settle(rewards('run-1', 600, [[SHELL, 3], [BONE, 1], [VEIN, 1]])); // 硬骨が 1 つ足りない
    const before = m.doc;
    const c = checkCraft(m.doc, content.recipes.get(RECIPE)!);
    expect(c.ok).toBe(false);
    expect(c.items.find((i) => i.itemId === BONE)).toEqual({ itemId: BONE, have: 1, need: 2 });
    const r = await m.craft(RECIPE);
    expect(r).toMatchObject({ ok: false, reason: 'rule' });
    expect(m.doc).toEqual(before);
    expect(b.writes).toBe(1);
  });

  it('通貨が足りない時も同じ', async () => {
    const m = await open(new MemoryBackend());
    await m.settle(rewards('run-1', 100, [[SHELL, 3], [BONE, 2], [VEIN, 1]]));
    expect(await m.craft(RECIPE)).toMatchObject({ ok: false, reason: 'rule' });
    expect(m.doc.money).toBe(100);
    expect(m.doc.weapons).toContain('weapon.heavy_blade.001');
  });

  it('足りていれば、素材 3+2+1 と 120 通貨が減り、断岳剣が岩殻の断岳剣に変わる。装備も変わる', async () => {
    const b = new MemoryBackend();
    const m = await open(b);
    await m.settle(rewards('run-1', 600, [[SHELL, 4], [BONE, 2], [VEIN, 1]]));
    expect(await m.craft(RECIPE)).toEqual({ ok: true });
    expect(m.doc.money).toBe(480);
    expect(m.doc.items).toEqual({ [SHELL]: 1 }); // 0 個になった素材は一覧から消える
    expect(m.doc.weapons).toContain('weapon.heavy_blade.002');
    expect(m.doc.weapons).not.toContain('weapon.heavy_blade.001');
    expect(m.doc.weapons).toHaveLength(7);
    expect(m.doc.equippedWeaponId).toBe('weapon.heavy_blade.002');
    expect(m.doc.revision).toBe(2);
    // 攻撃力が上がる
    expect(content.weapons.get('weapon.heavy_blade.002')!.attack).toBeGreaterThan(content.weapons.get('weapon.heavy_blade.001')!.attack);
    // 読み込み直しても同じ。元の断岳剣が配り直されることはない
    const again = await open(b);
    expect(again.doc).toEqual(m.doc);
    expect(usableWeapons(again.doc, content)).not.toContain('weapon.heavy_blade.001');
  });

  it('2 回続けて押しても、強化は 1 回だけ（2 回目は「すでに持っています」）', async () => {
    const m = await open(new MemoryBackend());
    await m.settle(rewards('run-1', 600, [[SHELL, 6], [BONE, 4], [VEIN, 2]]));
    const [a, c] = await Promise.all([m.craft(RECIPE), m.craft(RECIPE)]);
    expect(a).toEqual({ ok: true });
    expect(c).toMatchObject({ ok: false, reason: 'rule', message: 'すでに持っています' });
    expect(m.doc.money).toBe(480);
    expect(m.doc.items).toEqual({ [SHELL]: 3, [BONE]: 2, [VEIN]: 1 });
  });

  it('別の武器を装備している時に強化しても、装備は変わらない', async () => {
    const m = await open(new MemoryBackend());
    await m.equip('weapon.long_blade.001');
    await m.settle(enough('run-1'));
    await m.craft(RECIPE);
    expect(m.doc.equippedWeaponId).toBe('weapon.long_blade.001');
  });
});

describe('武器の強化（7 武器 × 5 段）', () => {
  const FORE = 'mat.galdros.foreleg_plate';
  const weaponRecipes = (): WeaponRecipeDef[] => [...content.recipes.values()].filter((r): r is WeaponRecipeDef => r.kind === 'upgrade');
  /** 武器 ID の末尾（.001〜.005）= 段 */
  const tier = (id: string): number => Number(id.slice(-1));

  it('どの武器種も、里鍛ち → 岩殻 → 脈殻 → 晶殻 → 輝殻 の 1 本道（各段のレシピが 1 つずつ）', () => {
    expect(weaponRecipes()).toHaveLength(7 * 4);
    for (const fam of content.families.keys()) {
      const chain = weaponRecipes().filter((r) => content.weapons.get(r.fromWeaponId)!.family === fam);
      expect(chain.map((r) => `${tier(r.fromWeaponId)}>${tier(r.resultWeaponId)}`).sort(), fam).toEqual(['1>2', '2>3', '3>4', '4>5']);
      for (const r of chain) expect(content.weapons.get(r.resultWeaponId)!.family, r.id).toBe(fam);
      expect(content.weapons.get(chain.find((r) => tier(r.fromWeaponId) === 1)!.fromWeaponId)!.starter, fam).toBe(true);
    }
    expect([...content.weapons.values()].filter((w) => w.starter)).toHaveLength(7);
  });

  it('攻撃力は 1 段ごとに 1.15 倍（里鍛ち × 1.15^段。端数は 0.5 以内）。ほかの値は変わらない', () => {
    for (const r of weaponRecipes()) {
      const from = content.weapons.get(r.fromWeaponId)!, to = content.weapons.get(r.resultWeaponId)!;
      const base = content.weapons.get(`${r.fromWeaponId.slice(0, -1)}1`)!;
      expect(to.attack, r.id).toBeGreaterThan(from.attack);
      expect(Math.abs(to.attack - base.attack * 1.15 ** (tier(to.id) - 1)), r.id).toBeLessThanOrEqual(0.5);
      expect({ element: to.element, affinity: to.affinity, sharpnessModifier: to.sharpnessModifier }, r.id).toEqual({ element: from.element, affinity: from.affinity, sharpnessModifier: from.sharpnessModifier });
    }
  });

  it('各段の強化には、その段階の個体からしか出ない素材が要る（2 段目 = 初級、3 段目 = 中級、4 段目 = 上級、5 段目 = 極級）', () => {
    const rankOf = materialRanks(content);
    for (const r of [...content.recipes.values()]) {
      const need = Math.max(...r.cost.items.map((s) => rankOf.get(s.itemId) ?? 99));
      expect(need, r.id).toBe(tier(recipeResult(r)) - 1);
    }
  });

  it('それぞれ、書いてある素材と通貨がちょうどあれば強化でき、使い切る。1 つでも欠けるとできない。段は飛ばせない', async () => {
    for (const fam of content.families.keys()) {
      const m = await open(new MemoryBackend());
      const chain = weaponRecipes().filter((r) => content.weapons.get(r.fromWeaponId)!.family === fam).sort((x, y) => tier(x.fromWeaponId) - tier(y.fromWeaponId));
      // 2 段目を作る前に、3 段目は作れない（元になる武器を持っていない）
      await m.settle(rewards(`run-skip`, chain[1]!.cost.money, chain[1]!.cost.items.map((s) => [s.itemId, s.count])));
      expect(await m.craft(chain[1]!.id), chain[1]!.id).toMatchObject({ ok: false, reason: 'rule', message: '元になる武器を持っていません' });
      const m2 = await open(new MemoryBackend());
      let n = 0;
      for (const r of chain) {
        const exact: [string, number][] = r.cost.items.map((s) => [s.itemId, s.count]);
        // 1 つ欠けた状態ではできない
        const short = exact.map(([id, k], i): [string, number] => [id, i === 0 ? k - 1 : k]).filter(([, k]) => k > 0);
        await m2.settle(rewards(`run-${n++}`, r.cost.money, short));
        expect(await m2.craft(r.id), r.id).toMatchObject({ ok: false, reason: 'rule' });
        expect(m2.doc.weapons, r.id).toContain(r.fromWeaponId);
        // 欠けていた 1 個を足すと、できて、使い切る
        await m2.settle(rewards(`run-${n++}`, 0, [[exact[0]![0], 1]]));
        expect(await m2.craft(r.id), r.id).toEqual({ ok: true });
        expect(m2.doc.items, r.id).toEqual({});
        expect(m2.doc.weapons, r.id).toContain(r.resultWeaponId);
        expect(m2.doc.weapons, r.id).not.toContain(r.fromWeaponId);
        expect(m2.doc.weapons, r.id).toHaveLength(7);
        m2.doc.money > 0 && expect.fail(`${r.id}: 通貨が残った`);
      }
    }
  });

  it('2 段目を 7 つ全部作ると、持っている武器は 7 つのまま、全部が岩殻の〜になる', async () => {
    const b = new MemoryBackend();
    const m = await open(b);
    await m.settle(rewards('run-1', 120 * 7, [[SHELL, 18], [BONE, 10], [VEIN, 6], [FORE, 3]]));
    const second = weaponRecipes().filter((r) => tier(r.resultWeaponId) === 2);
    for (const r of second) expect(await m.craft(r.id), r.id).toEqual({ ok: true });
    expect(m.doc.money).toBe(0);
    expect(m.doc.items).toEqual({});
    expect([...m.doc.weapons].sort()).toEqual(second.map((r) => r.resultWeaponId).sort());
    // 読み込み直しても、最初の武器が配り直されることはない
    const again = await open(b);
    expect(again.doc).toEqual(m.doc);
    expect(usableWeapons(again.doc, content)).toHaveLength(7);
  });
});

describe('防具（5 部位 × 5 段）', () => {
  const armorRecipes = (): ArmorRecipeDef[] => [...content.recipes.values()].filter((r): r is ArmorRecipeDef => r.kind === 'armor_upgrade');
  const tier = (id: string): number => Number(id.slice(-1));

  it('新しいデータは、里の装束（5 部位）を持っていて、防御力は 0', async () => {
    const m = await open(new MemoryBackend());
    expect(m.doc.armor).toEqual(['armor.head.001', 'armor.chest.001', 'armor.arms.001', 'armor.waist.001', 'armor.legs.001']);
    expect(wornArmor(m.doc, content).map((a) => a.slot)).toEqual([...ARMOR_SLOTS]);
    expect(defenseOf(m.doc, content)).toBe(0);
  });

  it('どの部位も 5 段の 1 本道で、防御力は段ごとに上がる（1 部位 0 / 6 / 13 / 21 / 30）', () => {
    expect(armorRecipes()).toHaveLength(5 * 4);
    for (const slot of ARMOR_SLOTS) {
      const pieces = [...content.armor.values()].filter((a) => a.slot === slot).sort((x, y) => tier(x.id) - tier(y.id));
      expect(pieces.map((a) => a.defense), slot).toEqual([0, 6, 13, 21, 30]);
      const chain = armorRecipes().filter((r) => content.armor.get(r.fromArmorId)!.slot === slot);
      expect(chain.map((r) => `${tier(r.fromArmorId)}>${tier(r.resultArmorId)}`).sort(), slot).toEqual(['1>2', '2>3', '3>4', '4>5']);
    }
  });

  it('強化すると、その部位の防具が入れ替わり、防御力の合計が上がる。素材と通貨が減る', async () => {
    const b = new MemoryBackend();
    const m = await open(b);
    await m.settle(rewards('run-1', 200, [[SHELL, 4], [BONE, 2]]));
    expect(await m.craft('recipe.armor.head.002')).toEqual({ ok: true }); // 岩殻片 2 + 硬骨 1 + 80
    expect(await m.craft('recipe.armor.chest.002')).toEqual({ ok: true }); // 岩殻片 2 + 硬骨 1 + 80（設計書 p.17 の例）
    expect(m.doc.armor).toEqual(['armor.head.002', 'armor.chest.002', 'armor.arms.001', 'armor.waist.001', 'armor.legs.001']);
    expect(defenseOf(m.doc, content)).toBe(12);
    expect(m.doc.money).toBe(40);
    expect(m.doc.items).toEqual({});
    // 武器と装備は変わらない
    expect(m.doc.weapons).toHaveLength(7);
    expect(m.doc.equippedWeaponId).toBe('weapon.heavy_blade.001');
    // 足りなければ何も変わらない / 2 回は作れない
    expect(await m.craft('recipe.armor.arms.002')).toMatchObject({ ok: false, reason: 'rule' });
    expect(await m.craft('recipe.armor.head.002')).toMatchObject({ ok: false, reason: 'rule' });
    const again = await open(b);
    expect(again.doc).toEqual(m.doc);
  });

  it('5 部位を同じ段で揃えた時の防御力の合計は 0 / 30 / 65 / 105 / 150', () => {
    for (const [t, total] of [[1, 0], [2, 30], [3, 65], [4, 105], [5, 150]] as const) {
      const doc = { ...newSave(content, { now: 'x', appVersion: 'x', contentVersion: 'x' }), armor: ARMOR_SLOTS.map((s) => `armor.${s}.00${t}`) };
      expect(defenseOf(doc, content), `段 ${t}`).toBe(total);
    }
  });

  it('この版に無い防具は、消さずに持ち続ける。数えるのは、この版にある防具だけ', async () => {
    const b = new MemoryBackend();
    b.seed(SLOT_ID, { ...newSave(content, { now: 'x', appVersion: 'x', contentVersion: 'x' }), revision: 1, armor: ['armor.head.002', 'armor.head.099', 'armor.chest.001'] });
    const m = await open(b);
    expect(unknownIds(m.doc, content).armor).toEqual(['armor.head.099']);
    expect(defenseOf(m.doc, content)).toBe(6);
    // 持っていない部位（腕・腰・脚）には、里の装束が配られる。頭と胴には配られない
    expect(m.doc.armor).toEqual(['armor.head.002', 'armor.head.099', 'armor.chest.001', 'armor.arms.001', 'armor.waist.001', 'armor.legs.001']);
    await m.settle(rewards('run-1'));
    expect((b.peek(SLOT_ID) as SaveDoc).armor).toContain('armor.head.099');
  });
});

describe('段階の解禁', () => {
  it('上の段階の依頼は、1 つ下の段階の依頼を達成すると受けられる', async () => {
    const m = await open(new MemoryBackend());
    const q = (id: string): QuestDef => content.quests.get(id)!;
    const open4 = (): boolean[] => ['quest.basin.003', 'quest.basin.r2.001', 'quest.basin.r3.001', 'quest.basin.r4.001'].map((id) => questUnlocked(m.doc, q(id)));
    expect(open4()).toEqual([true, false, false, false]);
    await m.settle(rewards('run-1'));
    expect(open4()).toEqual([true, true, false, false]);
    await m.settle({ ...rewards('run-2'), questId: 'quest.basin.r2.001' });
    expect(open4()).toEqual([true, true, true, false]);
    await m.settle({ ...rewards('run-3'), questId: 'quest.basin.r3.001' });
    expect(open4()).toEqual([true, true, true, true]);
  });
});

describe('装備', () => {
  it('持っている武器へ替えると保存され、読み込み直しても同じ', async () => {
    const b = new MemoryBackend();
    const m = await open(b);
    expect(await m.equip('weapon.twin_blades.001')).toEqual({ ok: true });
    expect((await open(b)).doc.equippedWeaponId).toBe('weapon.twin_blades.001');
  });

  it('持っていない武器は装備できない。同じ武器なら書き込まない', async () => {
    const b = new MemoryBackend();
    const m = await open(b);
    expect(await m.equip('weapon.heavy_blade.002')).toMatchObject({ ok: false, reason: 'rule' });
    await m.equip('weapon.twin_blades.001');
    const w = b.writes;
    expect(await m.equip('weapon.twin_blades.001')).toEqual({ ok: true });
    expect(b.writes).toBe(w);
  });
});

describe('別のタブ（同じ置き場所を 2 つの管理役で使う）', () => {
  it('古い内容のタブからの強化は断り、新しい内容を読み直す。上書きはしない', async () => {
    const b = new MemoryBackend();
    const tabA = await open(b);
    await tabA.settle(enough('run-1'));
    const tabB = await open(b); // ここで B は「素材あり」を見ている
    expect(await tabA.craft(RECIPE)).toEqual({ ok: true }); // A が先に強化
    const r = await tabB.craft(RECIPE); // B は古い内容のまま強化を押す
    expect(r).toMatchObject({ ok: false, reason: 'conflict' });
    expect(tabB.doc).toEqual(tabA.doc); // 読み直している
    expect(tabB.doc.money).toBe(480);
    expect(b.writes).toBe(2);
  });

  it('古い内容のタブで受け取った報酬は、新しい内容の上へ足される（どちらの分も消えない）', async () => {
    const b = new MemoryBackend();
    const tabA = await open(b);
    const tabB = await open(b);
    await tabA.settle(rewards('run-A'));
    expect(await tabB.settle(rewards('run-B', 300, [[BONE, 1]]))).toEqual({ ok: true });
    expect(tabB.doc.money).toBe(900);
    expect(tabB.doc.items).toEqual({ [SHELL]: 2, [BONE]: 1 });
    expect(tabB.doc.settledRuns).toEqual(['run-A', 'run-B']);
    // 同じ依頼を両方のタブで受け取っても 1 回分
    await tabA.settle(rewards('run-B', 300, [[BONE, 1]]));
    expect(tabA.doc.money).toBe(900);
  });
});

describe('この版に無い ID・新しい版・壊れたデータ', () => {
  const withUnknown = async (b: MemoryBackend): Promise<SaveDoc> => {
    const m = await open(b);
    await m.settle(rewards('run-1'));
    const raw = b.peek(SLOT_ID) as SaveDoc;
    raw.items['mat.future.star_core'] = 4;
    raw.weapons.push('weapon.future_axe.009');
    raw.equippedWeaponId = 'weapon.future_axe.009';
    b.seed(SLOT_ID, raw);
    return raw;
  };

  it('知らない素材と武器は、読んでも書いても消えない。装備は、遊ぶ時だけ持っている武器に替える', async () => {
    const b = new MemoryBackend();
    await withUnknown(b);
    const m = await open(b);
    expect(m.notice).toBeNull();
    expect(unknownIds(m.doc, content)).toEqual({ items: ['mat.future.star_core'], weapons: ['weapon.future_axe.009'], armor: [] });
    expect(playWeaponId(m.doc, content)).toBe('weapon.heavy_blade.001');
    expect(m.doc.equippedWeaponId).toBe('weapon.future_axe.009'); // 保存データは書き換えていない
    await m.settle(rewards('run-2'));
    const stored = b.peek(SLOT_ID) as SaveDoc;
    expect(stored.items['mat.future.star_core']).toBe(4);
    expect(stored.weapons).toContain('weapon.future_axe.009');
    expect(stored.equippedWeaponId).toBe('weapon.future_axe.009');
    // 書き出して取り込んでも残る
    const other = await open(new MemoryBackend());
    expect(await other.importText(m.exportText())).toEqual({ ok: true });
    expect(other.doc.items['mat.future.star_core']).toBe(4);
  });

  it('新しい版のデータには触れない。今回の変更はメモリの上だけ', async () => {
    const b = new MemoryBackend();
    const future = { ...newSave(content, { now: 'x', appVersion: 'x', contentVersion: 'x' }), schemaVersion: SAVE_SCHEMA_VERSION + 1, revision: 9, money: 5000, extra: { a: 1 } };
    b.seed(SLOT_ID, future);
    const m = await open(b);
    expect(m.mode).toBe('readonly');
    expect(m.notice).toContain('新しい版');
    expect(await m.settle(rewards('run-1'))).toEqual({ ok: true }); // 遊ぶことはできる
    expect(m.doc.money).toBe(600);
    expect(await m.equip('weapon.ring_bow.001')).toEqual({ ok: true });
    expect(b.peek(SLOT_ID)).toEqual(future); // 置いてあるデータは 1 文字も変わっていない
    expect(JSON.parse(m.exportText())).toEqual(future); // 書き出すと、元のデータがそのまま出る
  });

  it('壊れたデータにも触れない。利用者が選べば、控えへ移してから新しく始める', async () => {
    const b = new MemoryBackend();
    const broken = { slotId: SLOT_ID, schemaVersion: 1, revision: 3, money: -50, items: 'x' };
    b.seed(SLOT_ID, broken);
    const m = await open(b);
    expect(m.mode).toBe('readonly');
    expect(m.notice).toContain('読めませんでした');
    await m.settle(rewards('run-1'));
    expect(b.peek(SLOT_ID)).toEqual(broken);
    expect(await m.resetUnreadable()).toEqual({ ok: true });
    expect(m.mode).toBe('memory');
    expect((b.peek(SLOT_ID) as SaveDoc).money).toBe(600);
    const backups = await m.backups();
    expect(backups[0]).toMatchObject({ reason: 'reset', doc: broken });
  });

  it('形や数の検証: 負の数・小数・重複した武器・欠けた項目を見つける', () => {
    const ok = newSave(content, { now: 'x', appVersion: 'x', contentVersion: 'x' });
    expect(validateSave(ok)).toEqual([]);
    expect(validateSave({ ...ok, money: -1 })).toHaveLength(1);
    expect(validateSave({ ...ok, items: { [SHELL]: 1.5 } })).toHaveLength(1);
    expect(validateSave({ ...ok, weapons: ['a', 'a'] })).toHaveLength(1);
    expect(validateSave({ ...ok, settledRuns: undefined })).toHaveLength(1);
    expect(validateSave(null)).toHaveLength(1);
    expect(readSave({ ...ok, schemaVersion: 0 }).kind).toBe('invalid'); // 直す手順の無い古い版
  });
});

describe('書き出し・取り込み・控え', () => {
  it('書き出したものを取り込むと同じ内容になる。取り込む前の内容は控えに残り、戻せる', async () => {
    const b1 = new MemoryBackend();
    const rich = await open(b1);
    await rich.settle(enough('run-1'));
    await rich.craft(RECIPE);
    const text = rich.exportText();

    const b2 = new MemoryBackend();
    const poor = await open(b2);
    await poor.settle(rewards('run-x', 50, []));
    expect(await poor.importText(text)).toEqual({ ok: true });
    expect(poor.doc).toMatchObject({ money: 480, equippedWeaponId: 'weapon.heavy_blade.002', settledRuns: ['run-1'] });
    expect(poor.doc.revision).toBe(2); // 取り込みも 1 回の書き込みで、revision は自分の続き
    // 取り込んだ側でも、同じ依頼の報酬は 2 度入らない
    await poor.settle(enough('run-1'));
    expect(poor.doc.money).toBe(480);

    const backups = await poor.backups();
    expect(backups.map((x) => x.reason)).toEqual(['import']);
    expect((backups[0]!.doc as SaveDoc).money).toBe(50);
    expect(await poor.restoreBackup(backups[0]!.id)).toEqual({ ok: true });
    expect(poor.doc.money).toBe(50);
    expect(poor.doc.weapons).toContain('weapon.heavy_blade.001');
  });

  it('読めないテキスト・別のファイル・不正な数は取り込まず、いまの内容を変えない', async () => {
    const b = new MemoryBackend();
    const m = await open(b);
    await m.settle(rewards('run-1'));
    const before = b.peek(SLOT_ID);
    for (const text of ['', '{', '{"format":"other","save":{}}', JSON.stringify({ ...m.doc, money: 1e12 }), JSON.stringify({ ...m.doc, schemaVersion: 99 })]) {
      const r = await m.importText(text);
      expect(r.ok, text.slice(0, 30)).toBe(false);
    }
    expect(b.peek(SLOT_ID)).toEqual(before);
    expect(parseImport('{').kind).toBe('invalid');
  });

  it('起動して最初の書き込みの前の内容を、控えに 1 つ残す（前回までの状態へ戻せる）', async () => {
    const b = new MemoryBackend();
    const first = await open(b);
    await first.settle(rewards('run-1'));
    expect(await first.backups()).toHaveLength(0); // 何も無い所への最初の書き込みは控えない
    const second = await open(b); // 次の起動
    await second.settle(rewards('run-2'));
    await second.settle(rewards('run-3'));
    const backups = await second.backups();
    expect(backups.map((x) => x.reason)).toEqual(['session']);
    expect((backups[0]!.doc as SaveDoc).settledRuns).toEqual(['run-1']);
  });

  it(`控えは ${KEEP_BACKUPS} 個まで。古いものから消える`, async () => {
    const b = new MemoryBackend();
    const m = await open(b);
    await m.settle(rewards('run-0', 1, []));
    const text = m.exportText();
    for (let i = 0; i < KEEP_BACKUPS + 3; i++) await m.importText(text);
    expect(await m.backups()).toHaveLength(KEEP_BACKUPS);
  });

  it('保存できない端末（置き場所なし）でも遊べる。知らせが出る', async () => {
    const m = await open(null);
    expect(m.mode).toBe('memory');
    expect(m.notice).toContain('保存できません');
    expect(await m.settle(rewards('run-1'))).toEqual({ ok: true });
    expect(m.doc.money).toBe(600);
  });
});

describe('実機で書き出したデータ（tests/fixtures/save-v1-device-0.7.0.json）', () => {
  // 利用者の端末で、v0.7.0 の「ファイルに書き出す」から出たもの（2026-11-24）。依頼を 2 回達成し、太刀を装備した状態。
  // 保存の構造を変える時は、このファイルが読めなくならないこと（読めなくするなら、変換を足すこと）を、ここで確かめる。
  const text = readFileSync(new URL('./fixtures/save-v1-device-0.7.0.json', import.meta.url), 'utf8');

  it('検証を通り、知らない ID は無い。中身は、依頼 2 回分の報酬と太刀の装備', () => {
    const r = parseImport(text);
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    // 版 1（防具が入る前）のデータ。読む時に版 2 へ直る（防具の一覧が空で足される）
    expect(r.migratedFrom).toBe(1);
    expect(validateSave(r.doc)).toEqual([]);
    expect(r.doc.armor).toEqual([]);
    expect(unknownIds(r.doc, content)).toEqual({ items: [], weapons: [], armor: [] });
    expect(r.doc).toMatchObject({ schemaVersion: 2, revision: 3, money: 1200, equippedWeaponId: 'weapon.long_blade.001', progress: { questClears: { 'quest.basin.003': 2 } } });
    expect(r.doc.settledRuns).toHaveLength(2);
    expect(playWeaponId(r.doc, content)).toBe('weapon.long_blade.001');
    expect(usableWeapons(r.doc, content)).toHaveLength(7);
  });

  it('取り込める。取り込んだ後、同じ依頼の報酬は 2 度入らない。強化は硬骨が 1 つ足りない', async () => {
    const m = await open(new MemoryBackend());
    expect(await m.importText(text)).toEqual({ ok: true });
    expect(m.doc.money).toBe(1200);
    await m.settle(rewards(m.doc.settledRuns[0]!));
    expect(m.doc.money).toBe(1200);
    const c = checkCraft(m.doc, content.recipes.get(RECIPE)!);
    expect(c.ok).toBe(false);
    expect(c.items.filter((i) => i.have < i.need)).toEqual([{ itemId: BONE, have: 1, need: 2 }]);
    expect(c.money).toEqual({ have: 1200, need: 120 });
  });

  it('版 1 のデータを取り込むと、持ち物・武器・進行はそのままで、里の装束（5 部位）が配られる。初級を達成済みなので中級が受けられる', async () => {
    const m = await open(new MemoryBackend());
    expect(await m.importText(text)).toEqual({ ok: true });
    expect(m.doc).toMatchObject({ schemaVersion: 2, money: 1200, equippedWeaponId: 'weapon.long_blade.001', items: { [SHELL]: 7, [VEIN]: 2, [BONE]: 1 } });
    expect(m.doc.weapons).toHaveLength(7);
    expect(m.doc.armor).toEqual(['armor.head.001', 'armor.chest.001', 'armor.arms.001', 'armor.waist.001', 'armor.legs.001']);
    expect(defenseOf(m.doc, content)).toBe(0);
    expect(questUnlocked(m.doc, content.quests.get('quest.basin.r2.001')!)).toBe(true);
    expect(questUnlocked(m.doc, content.quests.get('quest.basin.r3.001')!)).toBe(false);
  });

  it('端末に版 1 のデータがある時: 開くと版 2 へ直して書き込み、元の版 1 は 1 文字も変えずに控えへ残す', async () => {
    const b = new MemoryBackend();
    const v1 = (JSON.parse(text) as { save: Record<string, unknown> }).save;
    b.seed(SLOT_ID, v1);
    const m = await open(b);
    expect(m.notice).toBe('保存データを新しい形へ直しました（元のデータは控えに残してあります）。');
    expect(m.unreadable).toBeNull();
    const stored = b.peek(SLOT_ID) as SaveDoc;
    expect(stored).toMatchObject({ schemaVersion: 2, money: 1200, revision: 4, equippedWeaponId: 'weapon.long_blade.001', items: { [SHELL]: 7, [VEIN]: 2, [BONE]: 1 } });
    expect(stored.armor).toHaveLength(5);
    expect(stored.settledRuns).toHaveLength(2);
    const backups = await m.backups();
    expect(backups).toHaveLength(1);
    expect(backups[0]!.reason).toBe('migrate');
    expect(backups[0]!.doc).toEqual(v1);
    // その後の強化も、ふつうに保存される
    expect(await m.craft('recipe.armor.head.002')).toEqual({ ok: true });
    expect(b.peek(SLOT_ID)).toMatchObject({ schemaVersion: 2, money: 1120, revision: 5 });
    // 開き直しても同じ（2 度目は直さない）
    const again = await open(b);
    expect(again.doc).toEqual(m.doc);
    expect(await again.backups()).toHaveLength(1);
  });

  it('この持ち物で強化できる武器は太刀と双剣、防具は頭・胴・腰。太刀を強化すると、装備が岩殻の太刀になり、青銅晶脈が無くなる', async () => {
    const m = await open(new MemoryBackend());
    await m.importText(text);
    const can = (): string[] => [...content.recipes.values()].filter((r) => checkCraft(m.doc, r).ok).map((r) => r.id).sort();
    expect(can()).toEqual(['recipe.armor.chest.002', 'recipe.armor.head.002', 'recipe.armor.waist.002', 'recipe.long_blade.002', 'recipe.twin_blades.002']);
    expect(await m.craft('recipe.long_blade.002')).toEqual({ ok: true });
    expect(m.doc.equippedWeaponId).toBe('weapon.long_blade.002');
    expect(playWeaponId(m.doc, content)).toBe('weapon.long_blade.002');
    expect(m.doc.money).toBe(1080);
    expect(m.doc.items).toEqual({ [SHELL]: 4, [BONE]: 1 });
    expect(m.doc.settledRuns).toHaveLength(2);
    expect(can()).toEqual(['recipe.armor.chest.002', 'recipe.armor.head.002']); // 腰は青銅晶脈が要る
  });
});
