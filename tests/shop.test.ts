// 商店と、狩りへ持っていく道具（v0.12.0、docs/spec.md 19 章）。
// 買う・売るは、通貨と持ち物を 1 回の書き込みで変える。買った道具は、支給品に足して狩りへ持っていき、使ったぶんだけ減る。
import { beforeAll, describe, expect, it } from 'vitest';
import type { Content } from '../src/data/schemas';
import { validateHub, validateShop } from '../src/data/validators';
import { nearestFacility } from '../src/game/hub';
import { Simulation } from '../src/game/sim';
import { checkBuy, newSave, pouchOf, settleRun, validateSave, type SaveDoc } from '../src/save/profile';
import { MemoryBackend } from '../src/save/saveDb';
import { SaveManager, type SaveEnv } from '../src/save/saveManager';
import { baseOptions, loadContent } from './helpers';

let content: Content;
beforeAll(async () => {
  content = await loadContent();
});

let clock = 0;
const env = (): SaveEnv => ({ now: () => `2026-11-24T01:00:${String(clock++ % 60).padStart(2, '0')}.000Z`, appVersion: 'test' });
const open = (b: MemoryBackend | null): Promise<SaveManager> => SaveManager.open(content, b, env());
const TONIC = 'item.heal_tonic', STONE = 'item.whetstone', ORB = 'item.calm_orb', TRAP = 'item.bind_trap';
const SHELL = 'mat.galdros.shell_shard';
const Q = 'quest.basin.003';
/** 通貨と素材を持った管理役 */
async function rich(money = 1000, items: [string, number][] = [[SHELL, 5]]): Promise<{ b: MemoryBackend; m: SaveManager }> {
  const b = new MemoryBackend();
  const m = await open(b);
  await m.settle({ runId: 'seed', questId: Q, money, items: items.map(([itemId, count]) => ({ itemId, count })) });
  return { b, m };
}
const fresh = (): SaveDoc => newSave(content, { now: '2026-11-24T00:00:00.000Z', appVersion: 'test', contentVersion: content.contentVersion });

describe('商店のデータ', () => {
  it('売っているのは道具 4 つ。モンスターの素材は、どれも買い取る（採集・採掘の素材は、用途が決まるまで買い取らない。v0.27.0）。検査に通る', () => {
    expect(content.shop.goods.map((g) => g.itemId)).toEqual([TONIC, STONE, ORB, TRAP]);
    const natural = (id: string): boolean => id.startsWith('mat.gather.') || id.startsWith('mat.ore.');
    expect(content.shop.sell.map((g) => g.itemId).sort()).toEqual([...content.materials.keys()].filter((id) => !natural(id)).sort());
    expect([...content.materials.keys()].filter(natural)).toHaveLength(4);
    const errors: string[] = [];
    validateShop(content, errors);
    expect(errors).toEqual([]);
  });

  it('上の段階の素材ほど、高く売れる', () => {
    const price = (id: string): number => content.shop.sell.find((g) => g.itemId === id)!.price;
    expect(price('mat.galdros.shell_shard')).toBeLessThan(price('mat.galdros.veined_shell'));
    expect(price('mat.galdros.veined_shell')).toBeLessThan(price('mat.galdros.crystal_shell'));
    expect(price('mat.galdros.crystal_shell')).toBeLessThan(price('mat.galdros.radiant_shell'));
  });

  it('検査は、壊れたデータを見つける（無い道具・値段 0・同じものが 2 つ）', () => {
    const broken = (edit: (c: Content) => void): string => {
      const c = { ...content, shop: JSON.parse(JSON.stringify(content.shop)) as Content['shop'] };
      edit(c);
      const errors: string[] = [];
      validateShop(c, errors);
      return errors.join('\n');
    };
    expect(broken((c) => void (c.shop.goods[0]!.itemId = 'item.none'))).toContain('が無い');
    expect(broken((c) => void (c.shop.goods[0]!.price = 0))).toContain('値段が不正');
    expect(broken((c) => void c.shop.goods.push({ ...c.shop.goods[0]! }))).toContain('重複');
  });
});

describe('買う', () => {
  it('通貨が減り、道具が増える。1 回の書き込みで入る', async () => {
    const { b, m } = await rich(1000);
    const writes = b.writes;
    expect(await m.buy(TONIC, 3)).toEqual({ ok: true });
    expect(b.writes).toBe(writes + 1);
    expect(m.doc.money).toBe(1000 - 180);
    expect(m.doc.items[TONIC]).toBe(3);
    expect(validateSave(m.doc)).toEqual([]);
  });

  it('通貨が足りなければ、買えない（何も変わらない、書き込まない）', async () => {
    const { b, m } = await rich(100);
    const writes = b.writes, rev = m.doc.revision;
    const r = await m.buy(TRAP, 1);
    expect(r).toMatchObject({ ok: false, reason: 'rule' });
    expect(m.doc.money).toBe(100);
    expect(m.doc.items[TRAP]).toBeUndefined();
    expect(m.doc.revision).toBe(rev);
    expect(b.writes).toBe(writes);
  });

  it('売っていないもの・0 個・小数は、買えない', async () => {
    const { m } = await rich(5000);
    expect((await m.buy(SHELL, 1)).ok).toBe(false);
    expect((await m.buy('item.none', 1)).ok).toBe(false);
    expect((await m.buy(TONIC, 0)).ok).toBe(false);
    expect((await m.buy(TONIC, 1.5)).ok).toBe(false);
    expect(m.doc.money).toBe(5000);
  });

  it('持っておける数（99）を超えては、買えない', async () => {
    const { m } = await rich(9_000_000);
    expect((await m.buy(STONE, 99)).ok).toBe(true);
    expect((await m.buy(STONE, 1)).ok).toBe(false);
    expect(m.doc.items[STONE]).toBe(99);
    expect(checkBuy(m.doc, content.shop, STONE, 1)).toMatchObject({ ok: false, room: 0, have: 99 });
  });

  it('別のタブが先に書いていたら、古い内容からは買わない（読み直す）', async () => {
    const b = new MemoryBackend();
    const a = await open(b);
    await a.settle({ runId: 'seed', questId: Q, money: 100, items: [] });
    const second = await open(b);
    expect((await second.buy(TONIC, 1)).ok).toBe(true); // 60 使って、残り 40
    const r = await a.buy(TONIC, 1); // a は「100 ある」と思っている
    expect(r).toMatchObject({ ok: false, reason: 'conflict' });
    expect(a.doc.money).toBe(40);
    expect(a.doc.items[TONIC]).toBe(1);
  });
});

describe('売る', () => {
  it('素材が減り、通貨が増える。最後の 1 個を売ると、持ち物から消える', async () => {
    const { m } = await rich(0, [[SHELL, 2]]);
    expect(await m.sell(SHELL, 1)).toEqual({ ok: true });
    expect(m.doc).toMatchObject({ money: 20, items: { [SHELL]: 1 } });
    expect(await m.sell(SHELL, 1)).toEqual({ ok: true });
    expect(m.doc.money).toBe(40);
    expect(SHELL in m.doc.items).toBe(false);
  });

  it('持っていない数は売れない。道具は売れない', async () => {
    const { m } = await rich(500, [[SHELL, 1]]);
    expect((await m.sell(SHELL, 2)).ok).toBe(false);
    await m.buy(TONIC, 1);
    expect((await m.sell(TONIC, 1)).ok).toBe(false);
    expect(m.doc.items).toMatchObject({ [SHELL]: 1, [TONIC]: 1 });
  });
});

describe('狩りへ持っていく道具', () => {
  it('持っている道具を、持ち出せる数まで持っていく（素材は持っていかない）', () => {
    const doc = fresh();
    doc.items = { [TONIC]: 30, [TRAP]: 1, [SHELL]: 9 };
    expect(pouchOf(doc, content)).toEqual([{ itemId: TONIC, count: 10 }, { itemId: TRAP, count: 1 }]);
    expect(pouchOf(fresh(), content)).toEqual([]);
  });

  it('支給品に足して持つ。合わせて、持ち出せる数まで（回復液 5 + 5、罠 1 + 1、鎮静玉 3 + 3、研磨石 3 + 7）', () => {
    const sim = new Simulation(content, baseOptions({ questId: Q, pouch: [{ itemId: TONIC, count: 10 }, { itemId: TRAP, count: 2 }, { itemId: ORB, count: 6 }, { itemId: STONE, count: 10 }] }));
    const count = (id: string): number => sim.player.items.find((s) => s.itemId === id)!.count;
    expect([count(TONIC), count(TRAP), count(ORB), count(STONE)]).toEqual([10, 2, 6, 10]);
    expect(sim.brought[TONIC]).toEqual({ supplied: 5, own: 5 });
    expect(sim.brought[TRAP]).toEqual({ supplied: 1, own: 1 });
    expect(sim.spentOwn()).toEqual([]);
  });

  it('何も持っていなければ、支給品だけ（これまでと同じ）', () => {
    const a = new Simulation(content, baseOptions({ questId: Q }));
    const b = new Simulation(content, baseOptions({ questId: Q, pouch: [] }));
    expect(b.player.items).toEqual(a.player.items);
    expect(a.hash()).toBe(b.hash());
  });

  it('使う時は、支給品のぶんから先に減る。自分のぶんは、支給品を使い切ってから', () => {
    const sim = new Simulation(content, baseOptions({ questId: Q, pouch: [{ itemId: TONIC, count: 3 }] }));
    const stack = sim.player.items.find((s) => s.itemId === TONIC)!;
    expect(stack.count).toBe(8);
    stack.count = 4; // 4 個使った（支給品 5 のうち）
    expect(sim.spentOwn()).toEqual([]);
    stack.count = 2; // 6 個使った（支給品 5 + 自分 1）
    expect(sim.spentOwn()).toEqual([{ itemId: TONIC, count: 1 }]);
    stack.count = 0;
    expect(sim.spentOwn()).toEqual([{ itemId: TONIC, count: 3 }]);
  });

  it('訓練場では、自分の道具を持っていかない（減らない）', () => {
    const sim = new Simulation(content, baseOptions({ pouch: [{ itemId: TONIC, count: 5 }] }));
    expect(sim.player.items.some((s) => s.itemId === TONIC)).toBe(false);
    expect(sim.spentOwn()).toEqual([]);
  });

  it('環弓は研磨石を持たない。持っていかなかった道具は、減らない', () => {
    const sim = new Simulation(content, baseOptions({ questId: Q, weaponId: 'weapon.ring_bow.001', pouch: [{ itemId: STONE, count: 5 }] }));
    expect(sim.player.items.some((s) => s.itemId === STONE)).toBe(false);
    expect(sim.spentOwn()).toEqual([]);
  });
});

describe('狩りの後の精算', () => {
  it('達成: 報酬が入り、使った自分の道具が減る。1 回の書き込み', async () => {
    const { b, m } = await rich(1000);
    await m.buy(TONIC, 4);
    const writes = b.writes;
    expect(await m.settle({ runId: 'run-a', questId: Q, money: 600, items: [{ itemId: SHELL, count: 2 }], spent: [{ itemId: TONIC, count: 3 }] })).toEqual({ ok: true });
    expect(b.writes).toBe(writes + 1);
    expect(m.doc.items[TONIC]).toBe(1);
    expect(m.doc.money).toBe(1000 - 240 + 600);
    expect(m.doc.progress.questClears[Q]).toBe(2);
  });

  it('失敗・途中で帰った: 使った道具だけが減る。達成回数と通貨は変わらない', async () => {
    const { m } = await rich(1000);
    await m.buy(TONIC, 4);
    const money = m.doc.money, clears = m.doc.progress.questClears[Q];
    expect(await m.settle({ runId: 'run-f', questId: Q, money: 0, items: [], spent: [{ itemId: TONIC, count: 4 }], cleared: false })).toEqual({ ok: true });
    expect(TONIC in m.doc.items).toBe(false);
    expect(m.doc.money).toBe(money);
    expect(m.doc.progress.questClears[Q]).toBe(clears);
    // 同じ狩りを 2 度精算しても、1 度しか減らない
    await m.buy(TONIC, 2);
    await m.settle({ runId: 'run-f', questId: Q, money: 0, items: [], spent: [{ itemId: TONIC, count: 2 }], cleared: false });
    expect(m.doc.items[TONIC]).toBe(2);
  });

  it('失敗して、自分の道具を何も使っていなければ、書き込まない', async () => {
    const { b, m } = await rich(1000);
    const writes = b.writes, rev = m.doc.revision;
    expect(await m.settle({ runId: 'run-n', questId: Q, money: 0, items: [], spent: [], cleared: false })).toEqual({ ok: true });
    expect(b.writes).toBe(writes);
    expect(m.doc.revision).toBe(rev);
  });

  it('持っている数より多く使ったことになっても、0 より下にはならない', () => {
    const doc = fresh();
    doc.items = { [TONIC]: 1 };
    const next = settleRun(doc, { runId: 'r', questId: Q, money: 0, items: [], spent: [{ itemId: TONIC, count: 5 }], cleared: false })!;
    expect(TONIC in next.items).toBe(false);
    expect(validateSave(next)).toEqual([]);
  });
});

describe('拠点のデータ', () => {
  it('施設は 4 つ（工房・商店・依頼板・装備箱）。検査に通る', () => {
    expect(content.hub.facilities.map((f) => f.kind).sort()).toEqual(['chest', 'quest', 'shop', 'workshop']);
    expect(content.hub.name).toBe('灯継ぎの里');
    const errors: string[] = [];
    validateHub(content, errors);
    expect(errors).toEqual([]);
  });

  it('里は歩ける: 出発地点から、どの施設の前へも、まっすぐか岩をよけて行ける（建物の中へは入れない。工房は、西の階段を下りて。v0.31.0）', () => {
    const map = content.maps.get(content.hub.mapId)!;
    // 下の段（炉の段）の工房へは、階段の上（-15, 8.5）と下（-24.6, 8.5）を通る
    const via: Record<string, [number, number][]> = { workshop: [[-15, 8.5], [-24.6, 8.5]] };
    for (const f of content.hub.facilities) {
      const sim = new Simulation(content, baseOptions({ mapId: content.hub.mapId, monsterId: null }));
      const route: [number, number][] = [...(via[f.id] ?? []), [f.x, f.z]];
      let reached = false;
      for (let i = 0; i < 2400 && !reached; i++) {
        const p = sim.player.pos;
        const [tx, tz] = route[0]!;
        const dx = tx - p.x, dz = tz - p.z;
        const d = Math.hypot(dx, dz) || 1;
        sim.step({ moveX: dx / d, moveZ: dz / d, held: 0, pressed: 0, released: 0 });
        if (route.length > 1 && Math.hypot(tx - p.x, tz - p.z) < 0.6) route.shift();
        reached = route.length === 1 && nearestFacility(content.hub.facilities, sim.world, p) === f;
        for (const r of map.rocks) expect(Math.hypot(p.x - r.x, p.z - r.z)).toBeGreaterThanOrEqual(r.r + content.player.radius - 1e-6);
      }
      expect(reached, f.name).toBe(true);
      expect(sim.player.pos.y, f.name).toBeCloseTo(sim.world.groundHeight(f.x, f.z), 6);
    }
  });

  it('検査は、壊れたデータを見つける（施設が足りない・施設の前が建物の中）', () => {
    const broken = (edit: (c: Content) => void): string => {
      const c = { ...content, hub: JSON.parse(JSON.stringify(content.hub)) as Content['hub'] };
      edit(c);
      const errors: string[] = [];
      validateHub(c, errors);
      return errors.join('\n');
    };
    expect(broken((c) => void c.hub.facilities.pop())).toContain('0 個');
    expect(broken((c) => {
      const f = c.hub.facilities[0]!;
      f.x = f.building.x;
      f.z = f.building.z;
    })).toContain('立てない');
  });
});
