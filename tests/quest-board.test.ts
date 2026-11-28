// 依頼の掲示・工房からの支給・里の納品（v0.26.0。ChatGPT のクエスト設計 #9、docs/spec.md の 25 章、D-098〜D-100）。
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { BOARD_TEXT_MAX, minutesText, starLabel, starRow, validateBoard, validateDeliveries, validateSupport } from '../src/data/questBoard';
import type { Content, QuestBoardDef, RecipeDef } from '../src/data/schemas';
import { questTimeLimitTicks } from '../src/game/field';
import { MAX_SETTLED_RUNS, RuleError, checkDelivery, claimSupport, deliver, newSave, questUnlocked, settleRun, supportState, validateSave, type SaveDoc } from '../src/save/profile';
import { MemoryBackend } from '../src/save/saveDb';
import { SaveManager, type SaveEnv } from '../src/save/saveManager';
import { loadContent } from './helpers';

let content: Content;
beforeAll(async () => {
  content = await loadContent();
});

const stamp = { now: '2026-11-25T00:00:00.000Z', appVersion: 'test', contentVersion: 'test' };
const SHELL = 'mat.galdros.shell_shard';
const ST01 = 'quest.basin.003', ST02 = 'quest.selvark.r1';
let runNo = 0;
const clear = (doc: SaveDoc, questId: string, items: [string, number][] = []): SaveDoc =>
  settleRun(doc, { runId: `run-${runNo++}`, questId, money: 0, items: items.map(([itemId, count]) => ({ itemId, count })) })!;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const errorsOf = (fn: (b: QuestBoardDef) => void): string[] => {
  const b = clone(content.board);
  fn(b);
  return validateBoard(b, content);
};

describe('依頼の掲示（星・分類・依頼人・話・目安の時間）', () => {
  it('狩りの依頼のどれにも掲示があり、読み込みの時に依頼へ付く。設計の 24 件は、星と依頼人が設計（current_quest_overrides_v1.json）のまま', () => {
    // 設計の 24 件と、v0.34.0 の上の級 9 件（文は Claude が書いた。下の「上の級」の検査）
    expect([...content.quests.values()].filter((q) => q.kind !== 'gather')).toHaveLength(39);
    expect([...content.quests.values()].every((q) => !!q.board)).toBe(true);
    const design = JSON.parse(readFileSync('docs/source/chatgpt-quest-design-20261125/current_quest_overrides_v1.json', 'utf8')) as {
      questDesigns: { questId: string; stars: number; client: string; requestText: string; targetClearMinutes: [number, number]; effectiveTimeLimitMinutes: number }[];
    };
    expect(design.questDesigns).toHaveLength(24);
    for (const d of design.questDesigns) {
      const q = content.quests.get(d.questId)!;
      expect(q.board, d.questId).toBeDefined();
      expect(q.board).toMatchObject({ stars: d.stars, client: d.client, text: d.requestText, clearMinutes: d.targetClearMinutes });
      // 設計の「最終の制限時間」と、フィールドで狩る時の時間が同じ
      expect(questTimeLimitTicks(content, q, true), d.questId).toBe(d.effectiveTimeLimitMinutes * 3600);
      expect(q.board!.text.length).toBeLessThanOrEqual(BOARD_TEXT_MAX);
    }
    expect(validateBoard(content.board, content)).toEqual([]);
  });

  it('上の級（v0.34.0）: セルヴァルクは星 4・6・8、群れは 3・5・7。どれも自由。目安の時間は級とともに長くなる', () => {
    const b = (id: string) => content.quests.get(id)!.board!;
    expect(['quest.selvark.r2', 'quest.selvark.r3', 'quest.selvark.r4'].map((id) => b(id).stars)).toEqual([4, 6, 8]);
    for (const sp of ['kordopil', 'palseit']) {
      const ids = [2, 3, 4].map((r) => `quest.${sp}.pack.r${r}`);
      expect(ids.map((id) => b(id).stars)).toEqual([3, 5, 7]);
      const mins = ids.map((id) => b(id).clearMinutes[1]);
      expect(mins[0]! <= mins[1]! && mins[1]! <= mins[2]!).toBe(true);
    }
    for (const id of ['quest.selvark.r2', 'quest.selvark.r3', 'quest.selvark.r4', 'quest.kordopil.pack.r2', 'quest.palseit.pack.r4']) expect(b(id).lane).toBe('free');
  });

  it('分類: 物語の第 1 章の 2 件は主線、ガルドロスの中級〜極級は昇級確認、ほかは自由。初級の大型は星 2、群れは 1〜2', () => {
    const lane = (id: string): string => content.quests.get(id)!.board!.lane;
    expect([ST01, ST02].map(lane)).toEqual(['main', 'main']);
    expect(['quest.basin.r2.001', 'quest.basin.r3.001', 'quest.basin.r4.001'].map(lane)).toEqual(['promotion', 'promotion', 'promotion']);
    expect(['quest.basin.r2.001', 'quest.basin.r3.001', 'quest.basin.r4.001'].map((id) => content.quests.get(id)!.board!.stars)).toEqual([4, 6, 8]);
    // 物語の第 1 章の狩り（story.json）は、どれも主線
    const steps = content.story.chapters.flatMap((c) => c.steps ?? []).map((s) => s.questId);
    expect(steps.every((id) => lane(id) === 'main')).toBe(true);
    for (const q of content.quests.values()) {
      if (q.rankId !== 'rank.1' || q.kind === 'gather') continue;
      if (q.targets) expect([1, 2]).toContain(q.board!.stars);
      else expect(q.board!.stars).toBe(2);
    }
    // おすすめの順は、スパインゲイルの依頼（#50。「岩場の足音」を達成すると受けられる。おすすめの文にも書く）のほかは、最初から受けられる依頼（表示だけで、受けられる条件は変えない）
    const doc = newSave(content, stamp);
    expect(content.board.recommend.text).toMatch(/おすすめ/);
    expect(content.board.recommend.questIds.filter(id=>!questUnlocked(doc,content.quests.get(id)!))).toEqual(['quest.spinegale.r1','quest.frostald.r1']);
  });

  it('検査が誤りを見つける: 掲示の無い依頼・星の範囲・知らない分類・制限を超える目安・知らない依頼', () => {
    expect(errorsOf((b) => void b.quests.pop()).join('\n')).toContain('掲示が無い');
    expect(errorsOf((b) => void (b.quests[0]!.stars = 9)).join('\n')).toContain('星は 1〜8');
    expect(errorsOf((b) => void (b.quests[0]!.stars = 0)).join('\n')).toContain('星は 1〜8');
    expect(errorsOf((b) => void ((b.quests[0] as { lane: string }).lane = 'rare')).join('\n')).toContain('未定義');
    expect(errorsOf((b) => void (b.quests[0]!.clearMinutes = [20, 31])).join('\n')).toContain('制限 30 分を超える');
    expect(errorsOf((b) => void (b.quests[0]!.clearMinutes = [12, 8])).join('\n')).toContain('目安の時間が不正');
    expect(errorsOf((b) => void b.quests.push({ ...b.quests[0]!, questId: 'quest.none' })).join('\n')).toContain('依頼が無い');
    expect(errorsOf((b) => void b.quests.push({ ...b.quests[0]! })).join('\n')).toContain('2 つある');
    expect(errorsOf((b) => void (b.quests[0]!.text = 'あ'.repeat(BOARD_TEXT_MAX + 1))).join('\n')).toContain('長すぎる');
  });

  it('表示の補助: 分（端数は秒）・星の見出し・星の列', () => {
    expect(minutesText(126000)).toBe('35 分');
    expect(minutesText(63000)).toBe('17 分 30 秒');
    expect(starLabel(content.quests.get('quest.basin.r4.001')!)).toBe('★8');
    expect(starRow(2)).toBe('★★☆☆☆☆☆☆ 2 / 8');
  });
});

describe('工房からの支給（物語の第 1 章の後に 1 度だけ）', () => {
  it('材料の数は「どれか 1 つの武器の系統 + 防具 5 部位」を 2 段目へ強化できる量（recipes.json から数えて同じ）', () => {
    const pack = content.support.packs.find((p) => p.id === 'story.support.tier2')!;
    expect(pack.requires).toEqual([ST01, ST02]);
    const rs = [...content.recipes.values()].filter((r: RecipeDef) => r.id.endsWith('.002'));
    const weapons = rs.filter((r) => r.kind === 'upgrade');
    const armor = rs.filter((r) => r.kind === 'armor_upgrade');
    expect([weapons.length, armor.length]).toEqual([7, 5]);
    const need = new Map<string, number>();
    for (const r of weapons) for (const s of r.cost.items) need.set(s.itemId, Math.max(need.get(s.itemId) ?? 0, s.count));
    for (const r of armor) for (const s of r.cost.items) need.set(s.itemId, (need.get(s.itemId) ?? 0) + s.count);
    expect(Object.fromEntries(pack.items.map((s) => [s.itemId, s.count]))).toEqual(Object.fromEntries(need));
    expect(validateSupport(content.support, content)).toEqual([]);
  });

  it('条件の 2 件を、どちらの順で達成しても受け取れる。受け取ると材料が入り、2 度目は断る（何も変えない）', () => {
    const pack = content.support.packs[0]!;
    for (const order of [[ST01, ST02], [ST02, ST01]]) {
      let doc = newSave(content, stamp);
      expect(supportState(doc, pack)).toBe('locked');
      expect(() => claimSupport(doc, pack)).toThrow(RuleError);
      doc = clear(doc, order[0]!);
      expect(supportState(doc, pack)).toBe('locked');
      doc = clear(doc, order[1]!, [[SHELL, 1]]);
      expect(supportState(doc, pack)).toBe('ready');
      const got = claimSupport(doc, pack);
      expect(supportState(got, pack)).toBe('claimed');
      expect(got.items[SHELL]).toBe(1 + 14);
      expect(got.claims).toEqual([pack.id]);
      expect(validateSave(got)).toEqual([]);
      expect(() => claimSupport(got, pack)).toThrow(/もう受け取っています/);
      expect(doc.claims).toEqual([]); // 元の doc は変えない
    }
  });

  it('受け取った記録は、依頼をいくつ処理しても消えない（処理済みの依頼の記録 300 件とは別）', () => {
    const pack = content.support.packs[0]!;
    let doc = claimSupport(clear(clear(newSave(content, stamp), ST01), ST02), pack);
    for (let i = 0; i < MAX_SETTLED_RUNS + 20; i++) doc = clear(doc, ST01);
    expect(doc.settledRuns).toHaveLength(MAX_SETTLED_RUNS);
    expect(supportState(doc, pack)).toBe('claimed');
  });
});

describe('里の納品（狩りに出ない。1 度だけ）', () => {
  const D09 = 'quest.delivery.009';
  it('「余った岩殻片を修繕に」: 岩殻片 2 個を渡し、14 個は残す。岩場の足音の後に受けられる', () => {
    const d = content.deliveries.get(D09)!;
    expect(d).toMatchObject({ stars: 1, money: 250, requires: [ST01], items: [{ itemId: SHELL, count: 2, keep: 14 }] });
    expect(validateDeliveries({ schemaVersion: 1, deliveries: [d] }, content, new Set())).toEqual([]);
    let doc = newSave(content, stamp);
    expect(checkDelivery(doc, d).state).toBe('locked');
    doc = clear(doc, ST01, [[SHELL, 15]]);
    expect(checkDelivery(doc, d)).toMatchObject({ ok: false, state: 'short', items: [{ have: 15, after: 13, keep: 14 }] });
    expect(() => deliver(doc, d)).toThrow(/足りません/);
    doc = clear(doc, ST01, [[SHELL, 1]]);
    expect(checkDelivery(doc, d)).toMatchObject({ ok: true, state: 'ready', items: [{ have: 16, after: 14 }] });
    const done = deliver(doc, d);
    expect(done.items[SHELL]).toBe(14);
    expect(done.money).toBe(doc.money + 250);
    expect(done.progress.questClears[D09]).toBe(1);
    expect(done.claims).toEqual([D09]);
    expect(validateSave(done)).toEqual([]);
    expect(checkDelivery(done, d).state).toBe('claimed');
    expect(() => deliver(done, d)).toThrow(/もう渡しています/);
    // 素材をいくら増やしても、もう渡せない
    expect(() => deliver(clear(done, ST01, [[SHELL, 50]]), d)).toThrow(RuleError);
  });

  it('保存の管理役を通す: 1 回の書き込みで確定。別のタブの古い内容からは、2 度渡せない', async () => {
    let clock = 0;
    const env = (): SaveEnv => ({ now: () => `2026-11-25T00:00:${String(clock++ % 60).padStart(2, '0')}.000Z`, appVersion: 'test' });
    const b = new MemoryBackend();
    const tabA = await SaveManager.open(content, b, env());
    await tabA.settle({ runId: 'r1', questId: ST01, money: 0, items: [{ itemId: SHELL, count: 16 }] });
    await tabA.settle({ runId: 'r2', questId: ST02, money: 0, items: [] });
    const tabB = await SaveManager.open(content, b, env());
    const writes = b.writes;
    expect(await tabA.deliver(D09)).toEqual({ ok: true });
    expect(b.writes).toBe(writes + 1);
    expect(tabA.doc.items[SHELL]).toBe(14);
    // B は古い内容（岩殻片 16、まだ渡していない）を見ている。押すと、読み直して断る
    expect(await tabB.deliver(D09)).toMatchObject({ ok: false, reason: 'conflict' });
    expect(await tabB.deliver(D09)).toMatchObject({ ok: false, reason: 'rule' });
    expect(tabB.doc.items[SHELL]).toBe(14);
    expect(tabB.doc.money).toBe(tabA.doc.money);
    // 支給も同じ（1 度だけ）
    expect(await tabB.claimSupport('story.support.tier2')).toEqual({ ok: true });
    expect(await tabA.claimSupport('story.support.tier2')).toMatchObject({ ok: false, reason: 'conflict' });
    expect(await tabA.claimSupport('story.support.tier2')).toMatchObject({ ok: false, reason: 'rule' });
    expect(tabA.doc.items[SHELL]).toBe(14 + 14);
    expect(tabA.doc.claims).toEqual([D09, 'story.support.tier2']);
    expect(await tabA.deliver('quest.delivery.none')).toMatchObject({ ok: false, reason: 'rule' });
  });
});
