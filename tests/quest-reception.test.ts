// 級別受付の受け入れ検査。移動・標的画像・データ誤りの境界を確かめる。
// v0.75.0（利用者の指示。D-175）: 白紙にした 19 種の依頼 29 件（大型 20・群れ 9）を外した。受付に届くのは、依頼 99 件（狩り 10・狩らない依頼 89）と里の納品 1 件。
// DOMの折り畳み・画像error・納品確認はブラウザで別途確認する。
import { existsSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { validateDeliveries } from '../src/data/questBoard';
import { questTargets, type Content, type QuestDef } from '../src/data/schemas';
import { validateHub } from '../src/data/validators';
import { nearestFacility } from '../src/game/hub';
import { Simulation } from '../src/game/sim';
import { monsterQuestImageUrl, questActivity, receptionGroups } from '../src/ui/questReception';
import { baseOptions, frame, loadContent } from './helpers';

let content: Content;
beforeAll(async () => { content = await loadContent(); });

const RANKS = ['rank.1', 'rank.2', 'rank.3', 'rank.4'];
const DELIVERY = 'quest.delivery.009';
const idsAt = (c: Content, rank: string, field = true): string[] =>
  receptionGroups(c, rank, field).flatMap((group) => group.entries.map((entry) => entry.id));

/** 位置を代入せず、入力だけで目的地まで歩く。900 tickで着かなければ不通。 */
function walkTo(sim: Simulation, x: number, z: number): boolean {
  for (let i = 0; i < 900; i++) {
    const dx = x - sim.player.pos.x, dz = z - sim.player.pos.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.3) return true;
    sim.step(frame({ moveX: dx / distance, moveZ: dz / distance }));
  }
  return false;
}

describe('級ごとの受付と、星ごとの依頼', () => {
  it('現在の100件が4受付へ一度ずつ届き、初級27+3件、中級・上級21+3件、極級21+1件になる。ロック中の仕事も消えない', () => {
    const groups = RANKS.map((rank) => receptionGroups(content, rank));
    const actual = groups.flatMap((list) => list.flatMap((group) => group.entries.map((entry) => entry.id)));
    const expected = [...content.quests.keys(), ...content.deliveries.keys()];
    expect(expected).toHaveLength(103);
    expect(actual).toHaveLength(103);
    expect(new Set(actual).size).toBe(103);
    expect([...actual].sort()).toEqual([...expected].sort());
    expect(groups.map((list) => list.map((group) => [group.stars, group.entries.length]))).toEqual([
      [[1, 27], [2, 4]], [[3, 21], [4, 4]], [[5, 21], [6, 4]], [[7, 21], [8, 1]],
    ]);
    for (let i = 0; i < RANKS.length; i++) {
      for (const group of groups[i]!) {
        expect(group.entries.every((entry) => entry.rankId === RANKS[i])).toBe(true);
      }
    }
    expect(idsAt(content, 'rank.4')).toContain('quest.basin.r4.001');
    expect(idsAt(content, 'rank.1')).toContain(DELIVERY);
    expect(RANKS.slice(1).flatMap((rank) => idsAt(content, rank))).not.toContain(DELIVERY);
  });

  it('arenaではフィールド専用の採取89件だけを除き、里納品D09と全狩猟（10件）を残す', () => {
    const fieldIds = RANKS.flatMap((rank) => idsAt(content, rank));
    const arenaIds = RANKS.flatMap((rank) => idsAt(content, rank, false));
    const excluded = fieldIds.filter((id) => !arenaIds.includes(id)).sort();
    expect(excluded).toEqual([...content.quests.values()].filter(q=>q.kind==='gather').map(q=>q.id).sort());
    expect(excluded).toHaveLength(89);
    expect(arenaIds).toHaveLength(14);
    expect(arenaIds).toContain(DELIVERY);
    expect(arenaIds.filter((id) => content.quests.get(id)?.kind !== 'gather')).toHaveLength(14);
  });

  it('上級の星が1でも上級に留まり、掲示が欠けても星未設定の末尾に残る。入力データは変わらない', () => {
    const original = content.quests.get('quest.basin.r3.001')!;
    const unusual = { ...original, board: { ...original.board!, stars: 1 } };
    const changed: Content = { ...content, quests: new Map(content.quests) };
    changed.quests.set(unusual.id, unusual);
    expect(receptionGroups(changed, 'rank.3')[0]!.stars).toBe(1);
    expect(receptionGroups(changed, 'rank.3')[0]!.entries.map((entry) => entry.id)).toEqual([original.id]);
    expect(idsAt(changed, 'rank.1')).not.toContain(original.id);
    expect(original.board!.stars).toBe(6);

    const unposted: Content = {
      ...content,
      quests: new Map(content.quests),
      board: { ...content.board, quests: content.board.quests.filter((board) => board.questId !== original.id) },
    };
    unposted.quests.set(original.id, { ...original, board: undefined });
    const groups = receptionGroups(unposted, 'rank.3');
    expect(groups.at(-1)!.stars).toBeNull();
    expect(groups.at(-1)!.entries.map((entry) => entry.id)).toEqual([original.id]);
    expect(groups.flatMap((group) => group.entries)).toHaveLength(25);
    expect(content.quests.get(original.id)).toBe(original);
    expect(content.board.quests.some((board) => board.questId === original.id)).toBe(true);
  });
});

describe('対象の小画像と、非狩猟の区別', () => {
  it('現行3標的種のURLが実在する図鑑WebPを指す。絵の無い種・知らない種は null', () => {
    const targetIds = new Set([...content.quests.values()].flatMap((quest) => questTargets(quest).map((target) => target.monsterId)));
    expect([...targetIds].sort()).toEqual(['monster.frostald', 'monster.galdros', 'monster.spinegale', 'monster.venolka']);
    for (const id of targetIds) {
      const species = content.bestiary.species.find((entry) => entry.id === id)!;
      const url = monsterQuestImageUrl(content, id);
      expect(url, id).not.toBeNull();
      expect(url!.startsWith(import.meta.env.BASE_URL), id).toBe(true);
      const path = url!.slice(import.meta.env.BASE_URL.length);
      expect(path, id).toMatch(/^assets\/bestiary\/[^/]+\.webp$/);
      expect(existsSync(new URL(`../public/${path}`, import.meta.url)), `${id}: ${path}`).toBe(true);
      expect(path.split('/').at(-1), id).toBe(species.art!.split('/').at(-1)!.replace(/\.png$/, '.webp'));
    }
    expect(monsterQuestImageUrl(content, 'monster.spinegale')).toContain('spinegale_concept_v1.webp');
    expect(monsterQuestImageUrl(content, 'monster.frostald')).toContain('frostald_concept.webp');
    expect(monsterQuestImageUrl(content, 'monster.unknown')).toBeNull();
    const withoutArt: Content = { ...content, bestiary: { ...content.bestiary, species: content.bestiary.species.map((species) => species.id === 'monster.spinegale' ? { ...species, art: undefined } : species) } };
    expect(monsterQuestImageUrl(withoutArt, 'monster.spinegale')).toBeNull();
  });

  it('標的が 2 種の依頼（試しの依頼。いまのデータには無い）でも、標的2種と頭数を保持し、上位個体でも種の画像を変えない', () => {
    // v0.75.0: 混成の群れの依頼（幼岩と幼帆）を外したので、同じ形の依頼を、内容の写しへ足して確かめる
    const mixed: QuestDef = { ...content.quests.get('quest.basin.003')!, id: 'quest.test.mixed', targets: [{ monsterId: 'monster.galdros', count: 2 }, { monsterId: 'monster.spinegale', count: 3 }], board: undefined };
    const changed: Content = { ...content, quests: new Map(content.quests) };
    changed.quests.set(mixed.id, mixed);
    const entry = receptionGroups(changed, 'rank.1').flatMap((group) => group.entries).find((row) => row.id === mixed.id)!;
    expect(entry.kind).toBe('quest');
    if (entry.kind !== 'quest') throw new Error('標的 2 種の依頼が里納品へ変わった');
    expect(entry.quest).toBe(mixed);
    expect(questTargets(entry.quest)).toEqual([
      { monsterId: 'monster.galdros', count: 2 }, { monsterId: 'monster.spinegale', count: 3 },
    ]);
    expect(questTargets(entry.quest).map((target) => monsterQuestImageUrl(content, target.monsterId))).toEqual([
      monsterQuestImageUrl(content, 'monster.galdros'), monsterQuestImageUrl(content, 'monster.spinegale'),
    ]);
    for (const id of ['quest.basin.003', 'quest.basin.r2.001', 'quest.basin.r3.001', 'quest.basin.r4.001']) {
      expect(questTargets(content.quests.get(id)!)).toEqual([{ monsterId: 'monster.galdros', count: 1 }]);
    }
  });

  it('採取内容で葉・採掘・箱を区別し、IDを変えても種類を取り違えない', () => {
    const expected: [string, string][] = [
      ['quest.gather.001', 'gather'], ['quest.gather.002', 'gather'],
      ['quest.mine.001', 'mining'], ['quest.mine.002', 'mining'], ['quest.delivery.001', 'field_delivery'],
    ];
    for (const [id, activity] of expected) {
      const quest: QuestDef = { ...content.quests.get(id)!, id: 'quest.renamed' };
      expect(questActivity(quest), id).toBe(activity);
      expect(questTargets(quest), id).toEqual([]);
    }
  });
});

describe('級別の受付へ実際に到達でき、壊れた割当は読み込みで拒否する', () => {
  it('出発地点から4受付へ安全な道を歩いて到達し、近接対象もその受付になる。建物追加後も広場の灯の位置を保つ', () => {
    const routes: [string, [number, number][]][] = [
      ['board', [[0, 0]]],
      ['board.r2', [[-12, -3], [-12, 7]]],
      ['board.r3', [[8, -6]]],
      ['board.r4', [[0, -3]]],
    ];
    for (const [id, waypoints] of routes) {
      const sim = new Simulation(content, baseOptions({ mapId: content.hub.mapId, monsterId: null }));
      const facility = content.hub.facilities.find((entry) => entry.id === id)!;
      expect(facility, id).toBeDefined();
      for (const [x, z] of [...waypoints, [facility.x, facility.z] as [number, number]]) {
        expect(walkTo(sim, x, z), `${id}: ${x}, ${z}`).toBe(true);
      }
      expect(nearestFacility(content.hub.facilities, sim.world, sim.player.pos)?.id, id).toBe(id);
      expect(sim.player.pos.y, id).toBe(0);
      expect(nearestFacility(content.hub.facilities, sim.world, { ...sim.player.pos, y: 3 }), id).toBeNull();
    }
    const map = content.maps.get(content.hub.mapId)!;
    expect(map.rocks[content.hub.facilities.length]).toMatchObject({ x: -6, z: 1.5, r: 0.6, h: 3 });
  });

  it('受付の級が重複・欠落・不明・未指定ならエラー。旧式の受付1か所を全級と黙認しない', () => {
    const errorsFor = (edit: (hub: Content['hub']) => void): string[] => {
      const changed: Content = { ...content, hub: structuredClone(content.hub) };
      edit(changed.hub);
      const errors: string[] = [];
      validateHub(changed, errors);
      return errors;
    };
    const valid: string[] = [];
    validateHub(content, valid);
    expect(valid).toEqual([]);
    expect(errorsFor((hub) => { hub.facilities.find((facility) => facility.id === 'board.r2')!.questRankId = 'rank.1'; }).join('\n')).toContain('rank.1 の受付が重複');
    expect(errorsFor((hub) => { hub.facilities = hub.facilities.filter((facility) => facility.id !== 'board.r3'); }).join('\n')).toContain('rank.3 の受付が無い');
    expect(errorsFor((hub) => { hub.facilities.find((facility) => facility.id === 'board.r2')!.questRankId = 'rank.unknown'; }).join('\n')).toContain('受付の級 rank.unknown が無い');
    expect(errorsFor((hub) => { delete hub.facilities.find((facility) => facility.id === 'board.r2')!.questRankId; }).join('\n')).toContain('受付の級 undefined が無い');
    const legacy = errorsFor((hub) => {
      hub.facilities = hub.facilities.filter((facility) => facility.kind !== 'quest' || facility.id === 'board');
      delete hub.facilities.find((facility) => facility.id === 'board')!.questRankId;
    });
    for (const rank of RANKS) expect(legacy.join('\n')).toContain(`${rank} の受付が無い`);
  });

  it('里納品の級省略は初級、明示した級はその受付。不明な級は納品データ検査で拒否する', () => {
    const original = content.deliveries.get(DELIVERY)!;
    const supportIds = new Set(content.support.packs.map((pack) => pack.id));
    const implicit = { ...original };
    delete implicit.rankId;
    expect(validateDeliveries({ schemaVersion: 1, deliveries: [implicit] }, content, supportIds)).toEqual([]);
    const moved: Content = { ...content, deliveries: new Map([[DELIVERY, { ...original, rankId: 'rank.3' }]]) };
    expect(idsAt(moved, 'rank.1')).not.toContain(DELIVERY);
    expect(idsAt(moved, 'rank.3')).toContain(DELIVERY);
    const broken = { ...original, rankId: 'rank.unknown' };
    expect(validateDeliveries({ schemaVersion: 1, deliveries: [broken] }, content, supportIds).join('\n')).toContain('受付の級 rank.unknown が無い');
    expect(content.deliveries.get(DELIVERY)).toBe(original);
  });
});
