// 保存データ（里の持ち物・装備・進行）の形と、それを変える処理。
// ここは計算だけで、DOM・IndexedDB・現在時刻には触れない（Node のテストで同じコードを動かす）。
// 実際の書き込みは saveDb.ts、画面とのやりとりは saveManager.ts。
//
// 決まり（CLAUDE.md の Save、設計書 28 章）:
// - 報酬の受け取りと強化は、必要な確認・減算・加算・処理済みの記録を 1 回の書き込みで確定する。
// - 知らない ID（この版に無い素材や武器）は捨てずに持ち続ける。
// - 新しい版が書いたデータ（schemaVersion がこの版より大きい）は、読まないし上書きもしない。
import type { Content, ItemStack, RecipeDef } from '../data/schemas';

export const SAVE_SCHEMA_VERSION = 1;
export const SLOT_ID = 'main';
/** 書き出したファイルの目印 */
export const EXPORT_FORMAT = 'veilbound-hunters-save';
/** 処理済みの依頼を覚えておく数。古いものから捨てる（同じ依頼の報酬を 2 度受け取らないための記録） */
export const MAX_SETTLED_RUNS = 300;
/** 1 種類の持ち物・通貨の上限。取り込みの検証にも使う */
export const MAX_COUNT = 9_999_999;

export interface SaveDoc {
  slotId: string;
  /** データの構造の版 */
  schemaVersion: number;
  /** 最後に保存した時の、収録データとアプリの版（記録用） */
  contentVersion: string;
  appVersion: string;
  /** 書き込むたびに 1 増える。別のタブが先に書いていたら、古い方からの書き込みを断るために使う */
  revision: number;
  /** 最後に保存した時刻（ISO 8601）。保存する側が渡す */
  updatedAt: string;
  money: number;
  /** 素材などの数（ID → 個数）。この版に無い ID も、そのまま持つ */
  items: Record<string, number>;
  /** 持っている武器の ID。この版に無い ID も、そのまま持つ */
  weapons: string[];
  equippedWeaponId: string;
  progress: {
    /** 依頼ごとの達成回数 */
    questClears: Record<string, number>;
  };
  /** 報酬を確定した依頼の runId（古い順） */
  settledRuns: string[];
}

/** 保存する時に付ける情報（時刻は保存する側が渡す） */
export interface SaveStamp {
  now: string;
  appVersion: string;
  contentVersion: string;
}

/** 決まりに合わない操作（素材が足りない、持っていない武器、など）。書き込みはしない。 */
export class RuleError extends Error {
  constructor(
    readonly code: 'insufficient' | 'not_owned' | 'already_owned' | 'unknown',
    message: string,
  ) {
    super(message);
    this.name = 'RuleError';
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_COUNT;

/** 最初から持つ武器（データの並び順） */
export function starterWeapons(content: Content): string[] {
  return [...content.weapons.values()].filter((w) => w.starter).map((w) => w.id);
}

/** 新しい保存データ。まだ 1 度も書き込んでいない状態（revision 0）。 */
export function newSave(content: Content, stamp: SaveStamp): SaveDoc {
  const weapons = starterWeapons(content);
  return {
    slotId: SLOT_ID,
    schemaVersion: SAVE_SCHEMA_VERSION,
    contentVersion: stamp.contentVersion,
    appVersion: stamp.appVersion,
    revision: 0,
    updatedAt: stamp.now,
    money: 0,
    items: {},
    weapons,
    equippedWeaponId: weapons[0] ?? '',
    progress: { questClears: {} },
    settledRuns: [],
  };
}

/** 形と数の検証。問題を日本語で列挙する（空なら問題なし）。知らない ID は問題にしない。 */
export function validateSave(raw: unknown): string[] {
  const e: string[] = [];
  if (!isObj(raw)) return ['保存データの形ではありません'];
  if (typeof raw.slotId !== 'string' || raw.slotId === '') e.push('slotId がありません');
  if (!Number.isInteger(raw.schemaVersion)) e.push('schemaVersion がありません');
  if (!isCount(raw.revision)) e.push('revision が不正です');
  if (typeof raw.updatedAt !== 'string') e.push('updatedAt がありません');
  if (!isCount(raw.money)) e.push('通貨の数が不正です');
  if (!isObj(raw.items)) e.push('持ち物がありません');
  else for (const [id, n] of Object.entries(raw.items)) if (!isCount(n)) e.push(`持ち物 ${id} の数が不正です`);
  if (!Array.isArray(raw.weapons) || raw.weapons.some((w) => typeof w !== 'string' || w === '')) e.push('武器の一覧が不正です');
  else if (new Set(raw.weapons).size !== raw.weapons.length) e.push('同じ武器が 2 つ入っています');
  if (typeof raw.equippedWeaponId !== 'string') e.push('装備している武器がありません');
  if (!isObj(raw.progress) || !isObj(raw.progress.questClears)) e.push('進行の記録がありません');
  else for (const [id, n] of Object.entries(raw.progress.questClears)) if (!isCount(n)) e.push(`依頼 ${id} の達成回数が不正です`);
  if (!Array.isArray(raw.settledRuns) || raw.settledRuns.some((r) => typeof r !== 'string')) e.push('処理済みの依頼の記録が不正です');
  return e;
}

/**
 * 古い版 → 次の版 への変換（キーは変換前の schemaVersion）。
 * いまは版 1 が最初なので空。構造を変える時は、ここへ 1 段ずつ足す（版を飛ばして変換しない）。
 */
const MIGRATIONS: Record<number, (doc: Record<string, unknown>) => Record<string, unknown>> = {};

export type ReadResult =
  | { kind: 'ok'; doc: SaveDoc; migratedFrom: number | null }
  /** この版より新しい構造。読まないし、上書きもしない */
  | { kind: 'newer'; schemaVersion: number }
  | { kind: 'invalid'; errors: string[] };

/** 保存されていたもの（または取り込むもの）を、この版で使える形へ。元のオブジェクトは変えない。 */
export function readSave(raw: unknown): ReadResult {
  if (!isObj(raw)) return { kind: 'invalid', errors: ['保存データの形ではありません'] };
  const v = raw.schemaVersion;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) return { kind: 'invalid', errors: ['schemaVersion がありません'] };
  if (v > SAVE_SCHEMA_VERSION) return { kind: 'newer', schemaVersion: v };
  let doc: Record<string, unknown> = structuredCloneJson(raw);
  let from: number | null = null;
  for (let cur = v; cur < SAVE_SCHEMA_VERSION; cur++) {
    const step = MIGRATIONS[cur];
    if (!step) return { kind: 'invalid', errors: [`版 ${cur} のデータを、いまの版へ直す手順がありません`] };
    from ??= v;
    doc = step(doc);
    doc.schemaVersion = cur + 1;
  }
  const errors = validateSave(doc);
  if (errors.length > 0) return { kind: 'invalid', errors };
  return { kind: 'ok', doc: doc as unknown as SaveDoc, migratedFrom: from };
}

function structuredCloneJson<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export const cloneSave = (doc: SaveDoc): SaveDoc => structuredCloneJson(doc);

// ---- 変える処理。どれも元の doc は変えず、新しい doc を返す。変える所が無ければ null。 ----

/**
 * 最初から持つ武器を配る。その系統の武器を 1 つも持っていない時だけ配る
 * （強化して元の武器が無くなった系統へ、もう一度配らない）。
 * 収録データに武器の系統が増えた時に、古い保存データでも使えるようにするためのもの。
 */
export function grantStarters(doc: SaveDoc, content: Content): SaveDoc | null {
  const families = new Set<string>();
  for (const id of doc.weapons) {
    const w = content.weapons.get(id);
    if (w) families.add(w.family);
  }
  const add: string[] = [];
  for (const w of content.weapons.values()) {
    if (!w.starter || families.has(w.family) || doc.weapons.includes(w.id)) continue;
    add.push(w.id);
    families.add(w.family);
  }
  if (add.length === 0) return null;
  const next = cloneSave(doc);
  next.weapons.push(...add);
  return next;
}

export interface RunRewards {
  runId: string;
  questId: string;
  money: number;
  items: readonly ItemStack[];
}

/** 依頼の報酬を持ち物へ入れる。同じ runId は 1 度だけ（2 度目は null = 何も変えない）。 */
export function settleRun(doc: SaveDoc, r: RunRewards): SaveDoc | null {
  if (doc.settledRuns.includes(r.runId)) return null;
  const next = cloneSave(doc);
  next.money = Math.min(MAX_COUNT, next.money + Math.max(0, Math.floor(r.money)));
  for (const s of r.items) {
    if (!(s.count > 0)) continue;
    next.items[s.itemId] = Math.min(MAX_COUNT, (next.items[s.itemId] ?? 0) + Math.floor(s.count));
  }
  next.progress.questClears[r.questId] = Math.min(MAX_COUNT, (next.progress.questClears[r.questId] ?? 0) + 1);
  next.settledRuns.push(r.runId);
  if (next.settledRuns.length > MAX_SETTLED_RUNS) next.settledRuns.splice(0, next.settledRuns.length - MAX_SETTLED_RUNS);
  return next;
}

export interface CraftCheck {
  ok: boolean;
  /** 元の武器を持っているか */
  ownsBase: boolean;
  /** すでに結果の武器を持っているか */
  ownsResult: boolean;
  money: { have: number; need: number };
  items: { itemId: string; have: number; need: number }[];
}

/** 強化できるか（画面の表示用。実際の確認は craft が書き込みの中でもう一度行う）。 */
export function checkCraft(doc: SaveDoc, recipe: RecipeDef): CraftCheck {
  const items = recipe.cost.items.map((s) => ({ itemId: s.itemId, have: doc.items[s.itemId] ?? 0, need: s.count }));
  const ownsBase = doc.weapons.includes(recipe.fromWeaponId);
  const ownsResult = doc.weapons.includes(recipe.resultWeaponId);
  const money = { have: doc.money, need: recipe.cost.money };
  return { ok: ownsBase && !ownsResult && money.have >= money.need && items.every((i) => i.have >= i.need), ownsBase, ownsResult, money, items };
}

/**
 * 強化: 素材と通貨を減らし、元の武器を結果の武器に入れ替える。元の武器を装備していたら、装備も入れ替える。
 * 足りない・持っていない時は RuleError を投げる（何も変えない）。
 */
export function craft(doc: SaveDoc, recipe: RecipeDef): SaveDoc {
  const c = checkCraft(doc, recipe);
  if (c.ownsResult) throw new RuleError('already_owned', 'すでに持っています');
  if (!c.ownsBase) throw new RuleError('not_owned', '元になる武器を持っていません');
  if (!c.ok) throw new RuleError('insufficient', '素材か通貨が足りません');
  const next = cloneSave(doc);
  next.money -= recipe.cost.money;
  for (const s of recipe.cost.items) {
    const left = (next.items[s.itemId] ?? 0) - s.count;
    if (left > 0) next.items[s.itemId] = left;
    else delete next.items[s.itemId];
  }
  next.weapons = next.weapons.map((w) => (w === recipe.fromWeaponId ? recipe.resultWeaponId : w));
  if (next.equippedWeaponId === recipe.fromWeaponId) next.equippedWeaponId = recipe.resultWeaponId;
  return next;
}

/** 装備を替える。持っていない武器は RuleError。同じ武器なら null。 */
export function equip(doc: SaveDoc, weaponId: string): SaveDoc | null {
  if (!doc.weapons.includes(weaponId)) throw new RuleError('not_owned', 'その武器を持っていません');
  if (doc.equippedWeaponId === weaponId) return null;
  const next = cloneSave(doc);
  next.equippedWeaponId = weaponId;
  return next;
}

// ---- 画面で使う読み取り ----

/** 持っていて、この版で使える武器（データの並び順）。 */
export function usableWeapons(doc: SaveDoc, content: Content): string[] {
  return [...content.weapons.keys()].filter((id) => doc.weapons.includes(id));
}

/** 実際に持たせる武器。装備がこの版で使えない時は、持っている中の最初の武器（保存データは書き換えない）。 */
export function playWeaponId(doc: SaveDoc, content: Content): string {
  const usable = usableWeapons(doc, content);
  if (usable.includes(doc.equippedWeaponId)) return doc.equippedWeaponId;
  return usable[0] ?? starterWeapons(content)[0] ?? [...content.weapons.keys()][0]!;
}

/** この版に無い ID（捨てずに持っているもの）。 */
export function unknownIds(doc: SaveDoc, content: Content): { items: string[]; weapons: string[] } {
  return {
    items: Object.keys(doc.items).filter((id) => !content.materials.has(id) && !content.items.has(id)),
    weapons: doc.weapons.filter((id) => !content.weapons.has(id)),
  };
}

// ---- 書き出しと取り込み ----

export function exportText(doc: SaveDoc, exportedAt: string): string {
  return JSON.stringify({ format: EXPORT_FORMAT, exportedAt, save: doc }, null, 2);
}

/** 書き出したテキストを読む。包みのある形（format / save）と、保存データそのままの形の両方を受ける。 */
export function parseImport(text: string): ReadResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { kind: 'invalid', errors: ['JSON として読めません（途中で切れている、または別のファイルです）'] };
  }
  if (isObj(raw) && 'save' in raw) {
    if (raw.format !== EXPORT_FORMAT) return { kind: 'invalid', errors: ['このゲームの書き出しファイルではありません'] };
    raw = raw.save;
  }
  return readSave(raw);
}
