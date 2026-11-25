// 依頼の掲示・工房からの支給・里の納品（v0.26.0。ChatGPT のクエスト設計 #9、docs/spec.md の 25 章）。
// ここは、データの決まりの検査と、画面に出す文の計算だけ（DOM・保存・時刻に触れない）。
import { QUEST_LANES, type Content, type DeliveriesDef, type QuestBoardDef, type QuestDef, type SupportDef } from './schemas';
import { questTimeLimitTicks } from '../game/field';

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const text = (v: unknown, max: number): boolean => typeof v === 'string' && v.trim().length > 0 && v.length <= max;

/** 星の数（1〜8）の範囲 */
export const STAR_MIN = 1;
export const STAR_MAX = 8;

/** 依頼人の話の長さの上限（設計は 100〜180 字。画面で読める長さ） */
export const BOARD_TEXT_MAX = 240;

/**
 * 依頼の掲示の検査。どの依頼にも 1 つだけあり、星・分類・依頼人・話・目安の時間が決まりどおり。
 * 目安の長い方は、フィールドの制限時間を超えない（制限の中で終わる設計）。
 */
export function validateBoard(board: QuestBoardDef, content: Pick<Content, 'quests' | 'fields'>): string[] {
  const e: string[] = [];
  if (!board || !Array.isArray(board.quests)) return ['quests が無い'];
  const seen = new Set<string>();
  for (const b of board.quests) {
    const w = `board ${String(b?.questId)}`;
    const q = content.quests.get(b.questId);
    if (!q) e.push(`${w}: 依頼が無い`);
    if (seen.has(b.questId)) e.push(`${w}: 2 つある`);
    seen.add(b.questId);
    if (!(isInt(b.stars) && b.stars >= STAR_MIN && b.stars <= STAR_MAX)) e.push(`${w}: 星は ${STAR_MIN}〜${STAR_MAX} の整数`);
    if (!QUEST_LANES.includes(b.lane)) e.push(`${w}: 分類 "${String(b.lane)}" は未定義`);
    if (!text(b.client, 30)) e.push(`${w}: 依頼人が不正`);
    if (!text(b.text, BOARD_TEXT_MAX)) e.push(`${w}: 依頼人の話が空か長すぎる（${BOARD_TEXT_MAX} 字まで）`);
    const m = b.clearMinutes;
    if (!(Array.isArray(m) && m.length === 2 && isInt(m[0]) && isInt(m[1]) && m[0] >= 1 && m[0] <= m[1])) e.push(`${w}: 目安の時間が不正`);
    else if (q) {
      const limit = questTimeLimitTicks(content, q, !!q.fieldId) / 3600;
      if (m[1] > limit) e.push(`${w}: 目安の長い方 ${m[1]} 分が、制限 ${limit} 分を超える`);
    }
  }
  for (const id of content.quests.keys()) if (!seen.has(id)) e.push(`board: 依頼 ${id} の掲示が無い（星・依頼人・話を書く）`);
  for (const id of board.recommend?.questIds ?? []) if (!content.quests.has(id)) e.push(`board: おすすめの依頼 ${id} が無い`);
  if (!text(board.recommend?.text, 200)) e.push('board: おすすめの文が無い');
  return e;
}

/** 工房からの支給の検査 */
export function validateSupport(support: SupportDef, content: Pick<Content, 'quests' | 'materials'>): string[] {
  const e: string[] = [];
  if (!support || !Array.isArray(support.packs)) return ['packs が無い'];
  const seen = new Set<string>();
  for (const p of support.packs) {
    const w = `support ${String(p?.id)}`;
    if (!text(p.id, 80) || seen.has(p.id)) e.push(`${w}: id が空か重複`);
    seen.add(p.id);
    if (content.quests.has(p.id)) e.push(`${w}: 依頼の id と同じ`);
    if (!text(p.name, 40) || !text(p.text, 200)) e.push(`${w}: 名前か説明が不正`);
    if (!(isInt(p.tier) && p.tier >= 2 && p.tier <= 5)) e.push(`${w}: tier が不正（2〜5）`);
    if (!Array.isArray(p.requires) || p.requires.length === 0) e.push(`${w}: 受け取れる条件が無い`);
    for (const id of p.requires ?? []) if (!content.quests.has(id)) e.push(`${w}: 条件の依頼 ${id} が無い`);
    if (!Array.isArray(p.items) || p.items.length === 0) e.push(`${w}: 材料が無い`);
    for (const s of p.items ?? []) if (!content.materials.has(s.itemId) || !(isInt(s.count) && s.count > 0)) e.push(`${w}: 材料 ${s.itemId} が不正`);
  }
  return e;
}

/** 里の納品の検査 */
export function validateDeliveries(doc: DeliveriesDef, content: Pick<Content, 'quests' | 'materials'>, supportIds: ReadonlySet<string>): string[] {
  const e: string[] = [];
  if (!doc || !Array.isArray(doc.deliveries)) return ['deliveries が無い'];
  const seen = new Set<string>();
  for (const d of doc.deliveries) {
    const w = `delivery ${String(d?.id)}`;
    if (!text(d.id, 80) || seen.has(d.id)) e.push(`${w}: id が空か重複`);
    seen.add(d.id);
    if (content.quests.has(d.id) || supportIds.has(d.id)) e.push(`${w}: 依頼か支給の id と同じ`);
    if (!text(d.name, 40) || !text(d.client, 30) || !text(d.text, BOARD_TEXT_MAX)) e.push(`${w}: 名前・依頼人・話が不正`);
    if (!(isInt(d.stars) && d.stars >= STAR_MIN && d.stars <= STAR_MAX)) e.push(`${w}: 星は ${STAR_MIN}〜${STAR_MAX} の整数`);
    for (const id of d.requires ?? []) if (!content.quests.has(id)) e.push(`${w}: 条件の依頼 ${id} が無い`);
    if (!Array.isArray(d.items) || d.items.length === 0) e.push(`${w}: 渡す素材が無い`);
    const ids = new Set<string>();
    for (const s of d.items ?? []) {
      if (!content.materials.has(s.itemId)) e.push(`${w}: 素材 ${s.itemId} が無い`);
      if (ids.has(s.itemId)) e.push(`${w}: 素材 ${s.itemId} が 2 行ある（1 行にまとめる）`);
      ids.add(s.itemId);
      if (!(isInt(s.count) && s.count > 0) || !(isInt(s.keep) && s.keep >= 0)) e.push(`${w}: 素材 ${s.itemId} の数が不正`);
    }
    if (!(isInt(d.money) && d.money >= 0)) e.push(`${w}: 報酬が不正`);
  }
  return e;
}

/** 分の表示（端数は秒で）。例: 35 分 / 17 分 30 秒 */
export function minutesText(ticks: number): string {
  const sec = Math.round(ticks / 60);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s === 0 ? `${m} 分` : `${m} 分 ${s} 秒`;
}

/** 一覧の見出しに付ける星（例: ★2）。掲示の無い依頼は空 */
export function starLabel(q: Pick<QuestDef, 'board'>): string {
  return q.board ? `★${q.board.stars}` : '';
}

/** 詳しい星の列（例: ★★☆☆☆☆☆☆ 2 / 8） */
export function starRow(stars: number): string {
  return `${'★'.repeat(stars)}${'☆'.repeat(Math.max(0, STAR_MAX - stars))} ${stars} / ${STAR_MAX}`;
}
