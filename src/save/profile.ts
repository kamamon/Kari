import { PROVISIONS } from '../game/provisions';
import {emptyClassicGear, JEWELS, socketCapacity, installedSlots, fortifyBonus, classicRank, type ClassicGearState} from '../game/classicGear';
import {computeGear} from '../game/gear';
// 保存データ（里の持ち物・装備・進行）の形と、それを変える処理。
// ここは計算だけで、DOM・IndexedDB・現在時刻には触れない（Node のテストで同じコードを動かす）。
// 実際の書き込みは saveDb.ts、画面とのやりとりは saveManager.ts。
//
// 決まり（CLAUDE.md の Save、設計書 28 章）:
// - 報酬の受け取りと強化は、必要な確認・減算・加算・処理済みの記録を 1 回の書き込みで確定する。
// - 知らない ID（この版に無い素材や武器）は捨てずに持ち続ける。
// - 新しい版が書いたデータ（schemaVersion がこの版より大きい）は、読まないし上書きもしない。
import { ARMOR_SLOTS, recipeFrom, recipeIsWeapon, recipeResult, type ArmorDef, type ArmorSlot, type Content, type DeliveryDef, type ItemStack, type QuestDef, type RecipeDef, type ShopDef, type SupportPackDef } from '../data/schemas';
import { appearanceShapeErrors, applyDraft, changedKinds, editableAppearance, legacyAppearance, validateDraft, type AppearanceDoc, type AppearanceDraft } from '../data/appearance';
import { hubLifeShapeErrors, type HubLifeState } from '../data/hubLife';

/**
 * 版 2（v0.9.0）: 防具（armor）を足した。版 3（v0.14.0）: 身に着けている防具（equippedArmorIds）を足した。
 * 版 4（v0.26.0）: 1 度だけの受け取りの記録（claims。工房からの支給・里の納品）を足した。
 * 版 5（v0.28.0）: ハンターの外見（appearance）を足した。
 */
// 版6: 装飾品・強化を移行。里の生活の任意欄も保持する。
export const SAVE_SCHEMA_VERSION = 6;
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
  /** 持っている防具の ID。この版に無い ID も、そのまま持つ。 */
  armor: string[];
  /**
   * 身に着けている防具の ID（装備箱で、部位ごとに替える・外す。v0.14.0）。持っているものだけが効く。
   * 1 つの部位に 2 つ入っていたら（版 2 から直したデータや、この版に無い ID が混ざった時）、防御力が高い方を着る。
   * その部位のものが 1 つも入っていなければ、その部位は何も着ていない。この版に無い ID も、そのまま持つ。
   */
  equippedArmorIds: string[];
  progress: {
    /** 依頼ごとの達成回数 */
    questClears: Record<string, number>;
  };
  /** 報酬を確定した依頼の runId（古い順） */
  settledRuns: string[];
  /**
   * 1 度だけ受け取るものの記録（v0.26.0。工房からの支給の id、里の納品の id）。古いものから捨てない（settledRuns とは別）。
   * この版に無い id も、そのまま持つ。
   */
  claims: string[];
  /**
   * ハンターの外見（v0.28.0。src/data/appearance.ts、docs/spec.md の 28 章）。無い古いデータは基準ハンター A。
   * 知らない欄・未知の ID も、そのまま持つ（描く時だけ A で代わりに描く）。能力には関わらない。
   */
  appearance: AppearanceDoc;
  classicGear?: ClassicGearState;
  /** 拠点の発展と準備。旧版5のデータは省略可。 */
  hubLife?: HubLifeState;
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
    readonly code: 'insufficient' | 'not_owned' | 'already_owned' | 'unknown' | 'not_sold' | 'not_bought' | 'bad_count' | 'full' | 'claimed' | 'locked',
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

/** 最初から持つ防具（部位の順） */
export function starterArmor(content: Content): string[] {
  return ARMOR_SLOTS.flatMap((slot) => [...content.armor.values()].filter((a) => a.slot === slot && a.starter).map((a) => a.id));
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
    armor: starterArmor(content),
    equippedArmorIds: starterArmor(content),
    progress: { questClears: {} },
    settledRuns: [],
    claims: [],
    appearance: legacyAppearance(),
    classicGear:emptyClassicGear(),
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
  if (!Array.isArray(raw.armor) || raw.armor.some((a) => typeof a !== 'string' || a === '')) e.push('防具の一覧が不正です');
  else if (new Set(raw.armor).size !== raw.armor.length) e.push('同じ防具が 2 つ入っています');
  if (!Array.isArray(raw.equippedArmorIds) || raw.equippedArmorIds.some((a) => typeof a !== 'string' || a === '')) e.push('身に着けている防具の一覧が不正です');
  else if (new Set(raw.equippedArmorIds).size !== raw.equippedArmorIds.length) e.push('同じ防具を 2 つ身に着けています');
  if (!isObj(raw.progress) || !isObj(raw.progress.questClears)) e.push('進行の記録がありません');
  else for (const [id, n] of Object.entries(raw.progress.questClears)) if (!isCount(n)) e.push(`依頼 ${id} の達成回数が不正です`);
  if (!Array.isArray(raw.settledRuns) || raw.settledRuns.some((r) => typeof r !== 'string')) e.push('処理済みの依頼の記録が不正です');
  if (!Array.isArray(raw.claims) || raw.claims.some((r) => typeof r !== 'string' || r === '')) e.push('受け取りの記録が不正です');
  else if (new Set(raw.claims).size !== raw.claims.length) e.push('同じ受け取りの記録が 2 つ入っています');
  e.push(...appearanceShapeErrors(raw.appearance), ...hubLifeShapeErrors(raw.hubLife));
  if(raw.classicGear!==undefined){const g=raw.classicGear;if(!isObj(g)||!isObj(g.stock)||!isObj(g.sockets)||!isObj(g.fortify))e.push('装飾品・防具強化の保存が不正です');else{if(Object.values(g.stock).some(n=>!isCount(n)))e.push('装飾品の数が不正です');if(Object.values(g.sockets).some(v=>!Array.isArray(v)||v.length>3||v.some(id=>typeof id!=='string')))e.push('装飾品の装着が不正です');if(Object.values(g.fortify).some(v=>!isCount(v)||Number(v)>5))e.push('防具強化が不正です');}}
  return e;
}

/**
 * 古い版 → 次の版 への変換（キーは変換前の schemaVersion）。
 * 構造を変える時は、ここへ 1 段ずつ足す（版を飛ばして変換しない）。
 * 1 → 2（v0.9.0）: 防具の一覧を足す。中身は空で、最初の防具は grantStarters が配る（収録データを見て決めるため）。
 * 2 → 3（v0.14.0）: 身に着けている防具を足す。版 2 は「持っている中で、部位ごとに防御力がいちばん高いものを着る」だったので、
 *   持っている防具をすべて「身に着けている」にする（読む側が、部位ごとに高い方を選ぶ。着ているものは、直す前と変わらない）。
 * 3 → 4（v0.26.0）: 受け取りの記録（claims）を足す。版 3 までは受け取るものが無かったので、空（まだ何も受け取っていない）。
 *   受け取れるかは、保存してある達成回数で決まる（古いデータでも、条件を満たしていれば、そのまま受け取れる）。
 * 4 → 5（v0.28.0）: 外見（appearance）を足す。版 4 までは外見が無かったので、基準ハンター A（legacy。近い色や全軸 50 へ置き換えない）。
 */
const MIGRATIONS: Record<number, (doc: Record<string, unknown>) => Record<string, unknown>> = {
  1: (doc) => ({ ...doc, armor: Array.isArray(doc.armor) ? doc.armor : [] }),
  2: (doc) => ({ ...doc, equippedArmorIds: Array.isArray(doc.equippedArmorIds) ? doc.equippedArmorIds : Array.isArray(doc.armor) ? [...(doc.armor as unknown[])] : [] }),
  3: (doc) => ({ ...doc, claims: Array.isArray(doc.claims) ? doc.claims : [] }),
  4: (doc) => ({ ...doc, appearance: doc.appearance !== undefined ? doc.appearance : legacyAppearance() }),
  5: (doc) => ({ ...doc, classicGear:doc.classicGear??emptyClassicGear() }),
};

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
 * 最初から持つ武器と防具を配る。その系統の武器（その部位の防具）を 1 つも持っていない時だけ配る
 * （強化して元の武器が無くなった系統へ、もう一度配らない）。
 * 収録データに武器の系統が増えた時や、防具が入る前の保存データでも、使えるようにするためのもの。
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
  const slots = new Set<string>();
  for (const id of doc.armor) {
    const a = content.armor.get(id);
    if (a) slots.add(a.slot);
  }
  const addArmor = starterArmor(content).filter((id) => !slots.has(content.armor.get(id)!.slot) && !doc.armor.includes(id));
  if (add.length === 0 && addArmor.length === 0) return null;
  const next = cloneSave(doc);
  next.weapons.push(...add);
  next.armor.push(...addArmor);
  // 配った防具は、その部位に何も持っていなかったので、そのまま身に着ける
  next.equippedArmorIds.push(...addArmor.filter((id) => !next.equippedArmorIds.includes(id)));
  return next;
}

export interface RunRewards {
  runId: string;
  questId: string;
  money: number;
  items: readonly ItemStack[];
  /** 狩りで使った、自分の道具（支給品のぶんは入れない）。持ち物から減らす */
  spent?: readonly ItemStack[];
  /** 達成したか。false（失敗・途中で帰った）なら、達成回数は増やさず、使った道具だけを減らす。無ければ達成 */
  cleared?: boolean;
}

/**
 * 依頼の結果を持ち物へ入れる: 報酬を足し、使った自分の道具を減らし、達成なら達成回数を増やす。
 * 同じ runId は 1 度だけ（2 度目は null = 何も変えない）。報酬も使った道具も無い失敗は、何も書かない（null）。
 */
export function settleRun(doc: SaveDoc, r: RunRewards): SaveDoc | null {
  if (doc.settledRuns.includes(r.runId)) return null;
  const cleared = r.cleared !== false;
  const spent = (r.spent ?? []).filter((s) => s.count > 0 && (doc.items[s.itemId] ?? 0) > 0);
  if (!cleared && spent.length === 0) return null;
  const next = cloneSave(doc);
  for (const s of spent) {
    const left = (next.items[s.itemId] ?? 0) - Math.floor(s.count);
    if (left > 0) next.items[s.itemId] = left;
    else delete next.items[s.itemId];
  }
  next.money = Math.min(MAX_COUNT, next.money + Math.max(0, Math.floor(r.money)));
  for (const s of r.items) {
    if (!(s.count > 0)) continue;
    next.items[s.itemId] = Math.min(MAX_COUNT, (next.items[s.itemId] ?? 0) + Math.floor(s.count));
  }
  if (cleared) next.progress.questClears[r.questId] = Math.min(MAX_COUNT, (next.progress.questClears[r.questId] ?? 0) + 1);
  next.settledRuns.push(r.runId);
  if (next.settledRuns.length > MAX_SETTLED_RUNS) next.settledRuns.splice(0, next.settledRuns.length - MAX_SETTLED_RUNS);
  return next;
}

export interface CraftCheck {
  ok: boolean;
  /** 元の武器（防具）を持っているか（作るレシピは元が無いので、いつも true） */
  ownsBase: boolean;
  /** 結果の級が開いているか（v0.32.0。系列の装備だけ。craftRankOpen） */
  rankOpen: boolean;
  /** すでに結果の武器（防具）を持っているか */
  ownsResult: boolean;
  money: { have: number; need: number };
  items: { itemId: string; have: number; need: number }[];
}

/**
 * 系列の装備（v0.32.0 の作る・v0.34.0 の強化）の結果の級が、もう開いているか: その級の依頼が 1 つは受けられる。
 * 級の無い結果（ガルドロスの段の道。素材が上の段階の個体からしか出ない）は、いつも開いている（ChatGPT の全装備四級版 #15 の「未登場の級の装備は作れない」）。
 */
export function craftRankOpen(doc: SaveDoc, content: Content, recipe: RecipeDef): boolean {
  const result = recipeResult(recipe);
  const rankId = recipeIsWeapon(recipe) ? content.weapons.get(result)?.rankId : content.armor.get(result)?.rankId;
  if (!rankId) return true;
  return [...content.quests.values()].some((q) => q.rankId === rankId && questUnlocked(doc, q));
}

/** 強化できるか・作れるか（画面の表示用。実際の確認は craft が書き込みの中でもう一度行う）。rankOpen は craftRankOpen の結果 */
export function checkCraft(doc: SaveDoc, recipe: RecipeDef, rankOpen = true): CraftCheck {
  const items = recipe.cost.items.map((s) => ({ itemId: s.itemId, have: doc.items[s.itemId] ?? 0, need: s.count }));
  const owned = recipeIsWeapon(recipe) ? doc.weapons : doc.armor;
  const from = recipeFrom(recipe);
  const ownsBase = from === null || owned.includes(from);
  const ownsResult = owned.includes(recipeResult(recipe));
  const money = { have: doc.money, need: recipe.cost.money };
  return { ok: ownsBase && rankOpen && !ownsResult && money.have >= money.need && items.every((i) => i.have >= i.need), ownsBase, rankOpen, ownsResult, money, items };
}

/**
 * 強化: 素材と通貨を減らし、元の武器（防具）を結果のものに入れ替える。元の武器を装備していたら、装備も入れ替える。
 * 防具も同じ: 元の防具を身に着けていたら、強化した防具を身に着ける（外していた部位は、外したまま）。
 * 作る（v0.32.0）: 素材と通貨を減らし、結果の武器（防具）を持ち物に足す（装備は替えない）。
 * 足りない・持っていない・級が開いていない時は RuleError を投げる（何も変えない）。
 */
export function craft(doc: SaveDoc, recipe: RecipeDef, rankOpen = true): SaveDoc {
  const c = checkCraft(doc, recipe, rankOpen);
  if (c.ownsResult) throw new RuleError('already_owned', 'すでに持っています');
  if (!c.ownsBase) throw new RuleError('not_owned', recipe.kind === 'upgrade' ? '元になる武器を持っていません' : '元になる防具を持っていません');
  if (!c.rankOpen) throw new RuleError('locked', 'その級の装備は、まだ作れません');
  if (!c.ok) throw new RuleError('insufficient', '素材か通貨が足りません');
  const next = cloneSave(doc);
  next.money -= recipe.cost.money;
  for (const s of recipe.cost.items) {
    const left = (next.items[s.itemId] ?? 0) - s.count;
    if (left > 0) next.items[s.itemId] = left;
    else delete next.items[s.itemId];
  }
  if (recipe.kind === 'upgrade') {
    next.weapons = next.weapons.map((w) => (w === recipe.fromWeaponId ? recipe.resultWeaponId : w));
    if (next.equippedWeaponId === recipe.fromWeaponId) next.equippedWeaponId = recipe.resultWeaponId;
  } else if (recipe.kind === 'armor_upgrade') {
    next.armor = next.armor.map((a) => (a === recipe.fromArmorId ? recipe.resultArmorId : a));
    next.equippedArmorIds = next.equippedArmorIds.map((a) => (a === recipe.fromArmorId ? recipe.resultArmorId : a));
  } else if (recipe.kind === 'craft') next.weapons = [...next.weapons, recipe.resultWeaponId];
  else next.armor = [...next.armor, recipe.resultArmorId];
  const cg=next.classicGear;
  const oldId=recipeFrom(recipe),newId=recipeResult(recipe);
  if(cg&&oldId){for(const jid of cg.sockets[oldId]??[])cg.stock[jid]=Math.min(MAX_COUNT,(cg.stock[jid]??0)+1);delete cg.sockets[oldId];if(cg.fortify[oldId]){cg.fortify[newId]=cg.fortify[oldId]!;delete cg.fortify[oldId];}}
  return next;
}

// ---- 商店 ----

export interface BuyCheck {
  ok: boolean;
  /** 売っているか */
  sold: boolean;
  price: number;
  have: number;
  /** あと何個持てるか（holdMax まで） */
  room: number;
  money: number;
}

/** 買えるか（画面の表示用。実際の確認は buy が書き込みの中でもう一度行う）。 */
export function checkBuy(doc: SaveDoc, shop: ShopDef, itemId: string, count: number): BuyCheck {
  const g = shop.goods.find((x) => x.itemId === itemId);
  const have = doc.items[itemId] ?? 0;
  const room = Math.max(0, shop.holdMax - have);
  const price = g ? g.price * count : 0;
  return { ok: !!g && Number.isInteger(count) && count > 0 && count <= room && doc.money >= price, sold: !!g, price, have, room, money: doc.money };
}

/** 道具を買う: 通貨を減らし、道具を足す。売っていない・足りない・持てない時は RuleError（何も変えない）。 */
export function buy(doc: SaveDoc, shop: ShopDef, itemId: string, count: number): SaveDoc {
  const c = checkBuy(doc, shop, itemId, count);
  if (!c.sold) throw new RuleError('not_sold', 'その道具は売っていません');
  if (!(Number.isInteger(count) && count > 0)) throw new RuleError('bad_count', '数が正しくありません');
  if (count > c.room) throw new RuleError('full', `これ以上は持てません（${shop.holdMax} 個まで）`);
  if (c.money < c.price) throw new RuleError('insufficient', '通貨が足りません');
  const next = cloneSave(doc);
  next.money -= c.price;
  next.items[itemId] = c.have + count;
  return next;
}

/** 素材を売る: 素材を減らし、通貨を足す。買い取っていない・持っていない時は RuleError。 */
export function sell(doc: SaveDoc, shop: ShopDef, itemId: string, count: number): SaveDoc {
  const g = shop.sell.find((x) => x.itemId === itemId);
  if (!g) throw new RuleError('not_bought', 'その素材は買い取っていません');
  const have = doc.items[itemId] ?? 0;
  if (!(Number.isInteger(count) && count > 0)) throw new RuleError('bad_count', '数が正しくありません');
  if (have < count) throw new RuleError('insufficient', '素材が足りません');
  const next = cloneSave(doc);
  if (have - count > 0) next.items[itemId] = have - count;
  else delete next.items[itemId];
  next.money = Math.min(MAX_COUNT, next.money + g.price * count);
  return next;
}

/**
 * 狩りへ持っていく、自分の道具。売っている道具のうち持っているものを、持ち出せる数（carryMax）まで。
 * 支給品と合わせて carryMax を超えるぶんは、simulation の側で里に残す。
 */
export function pouchOf(doc: SaveDoc, content: Content): ItemStack[] {
  const out: ItemStack[] = [];
  for (const it of content.items.values()) {
    const have = doc.items[it.id] ?? 0;
    if (have > 0) out.push({ itemId: it.id, count: Math.min(have, it.carryMax) });
  }
  return out;
}

/** 装備を替える。持っていない武器は RuleError。同じ武器なら null。 */
export function equip(doc: SaveDoc, weaponId: string): SaveDoc | null {
  if (!doc.weapons.includes(weaponId)) throw new RuleError('not_owned', 'その武器を持っていません');
  if (doc.equippedWeaponId === weaponId) return null;
  const next = cloneSave(doc);
  next.equippedWeaponId = weaponId;
  return next;
}

/**
 * 防具を、部位ごとに替える・外す（装備箱。v0.14.0）。armorId が null なら、その部位を外す。
 * 持っていない防具、この版に無い防具、部位が違う防具は RuleError（何も変えない）。変える所が無ければ null。
 * その部位に身に着けていたほかの防具は、外れる（この版に無い ID は、部位が分からないので、そのまま残す）。
 */
export function equipArmor(doc: SaveDoc, content: Content, slot: ArmorSlot, armorId: string | null): SaveDoc | null {
  if (!(ARMOR_SLOTS as readonly string[]).includes(slot)) throw new RuleError('unknown', 'その部位はありません');
  if (armorId !== null) {
    if (!doc.armor.includes(armorId)) throw new RuleError('not_owned', 'その防具を持っていません');
    const def = content.armor.get(armorId);
    if (!def) throw new RuleError('unknown', 'その防具は、この版では使えません');
    if (def.slot !== slot) throw new RuleError('unknown', 'その防具は、別の部位のものです');
  }
  const keep = doc.equippedArmorIds.filter((id) => content.armor.get(id)?.slot !== slot);
  const nextIds = armorId === null ? keep : [...keep, armorId];
  const sameSet = nextIds.length === doc.equippedArmorIds.length && nextIds.every((id) => doc.equippedArmorIds.includes(id));
  if (sameSet) return null;
  const next = cloneSave(doc);
  next.equippedArmorIds = nextIds;
  return next;
}

// ---- 1 度だけ受け取るもの（v0.26.0。工房からの支給・里の納品。docs/spec.md の 25 章） ----

/** 条件の依頼を、どれも 1 回は達成しているか */
const clearedAll = (doc: SaveDoc, ids: readonly string[]): boolean => ids.every((id) => (doc.progress.questClears[id] ?? 0) > 0);

/** 工房からの支給の状態。claimed: 受け取った / ready: 受け取れる / locked: まだ条件の依頼が残っている */
export type SupportState = 'claimed' | 'ready' | 'locked';

export function supportState(doc: SaveDoc, pack: SupportPackDef): SupportState {
  if (doc.claims.includes(pack.id)) return 'claimed';
  return clearedAll(doc, pack.requires) ? 'ready' : 'locked';
}

/**
 * 工房からの支給を受け取る: 材料を足し、受け取った記録を残す（1 回の書き込みで両方）。
 * 受け取った後・条件が足りない・持てる数を超える時は RuleError（何も変えない）。
 */
export function claimSupport(doc: SaveDoc, pack: SupportPackDef): SaveDoc {
  const st = supportState(doc, pack);
  if (st === 'claimed') throw new RuleError('claimed', 'もう受け取っています');
  if (st === 'locked') throw new RuleError('locked', 'まだ受け取れません（条件の依頼が残っています）');
  if (pack.items.some((s) => (doc.items[s.itemId] ?? 0) + s.count > MAX_COUNT)) throw new RuleError('full', 'これ以上は持てません');
  const next = cloneSave(doc);
  for (const s of pack.items) next.items[s.itemId] = (next.items[s.itemId] ?? 0) + s.count;
  next.claims.push(pack.id);
  return next;
}

export interface DeliveryCheck {
  ok: boolean;
  /** claimed: 渡した / locked: 条件の依頼が残っている / short: 素材が足りない（残す数を含めて） / ready: 渡せる */
  state: 'claimed' | 'locked' | 'short' | 'ready';
  items: { itemId: string; need: number; keep: number; have: number; after: number }[];
  money: number;
}

/** 里の納品ができるか（画面の表示用。実際の確認は deliver が書き込みの中でもう一度行う）。 */
export function checkDelivery(doc: SaveDoc, d: DeliveryDef): DeliveryCheck {
  const items = d.items.map((s) => {
    const have = doc.items[s.itemId] ?? 0;
    return { itemId: s.itemId, need: s.count, keep: s.keep, have, after: have - s.count };
  });
  const state: DeliveryCheck['state'] = doc.claims.includes(d.id) ? 'claimed' : !clearedAll(doc, d.requires) ? 'locked' : items.every((i) => i.after >= i.keep) ? 'ready' : 'short';
  return { ok: state === 'ready', state, items, money: d.money };
}

/**
 * 里の納品: 素材を減らし、通貨と達成回数を足し、受け取った記録を残す（1 回の書き込みで全部）。
 * 渡した後・条件が足りない・素材が足りない（残す数を割る）・通貨が上限を超える時は RuleError（何も変えない）。
 */
export function deliver(doc: SaveDoc, d: DeliveryDef): SaveDoc {
  const c = checkDelivery(doc, d);
  if (c.state === 'claimed') throw new RuleError('claimed', 'もう渡しています（1 度だけの依頼です）');
  if (c.state === 'locked') throw new RuleError('locked', 'まだ受けられません（条件の依頼が残っています）');
  if (c.state === 'short') throw new RuleError('insufficient', '素材が足りません（渡した後に残す数を含めて）');
  if (doc.money + d.money > MAX_COUNT) throw new RuleError('full', '通貨がこれ以上持てません');
  const next = cloneSave(doc);
  for (const i of c.items) {
    if (i.after > 0) next.items[i.itemId] = i.after;
    else delete next.items[i.itemId];
  }
  next.money += d.money;
  next.progress.questClears[d.id] = Math.min(MAX_COUNT, (next.progress.questClears[d.id] ?? 0) + 1);
  next.claims.push(d.id);
  return next;
}

// ---- 外見（v0.28.0。docs/spec.md の 28 章） ----

/**
 * 外見を決める: 編集を始めた時の draft（base）と違う種類だけを、いまの保存の外見へ当てる（ほかの欄・未知の ID は残す）。
 * 持ち物・装備・進行は変えない。変える所が無ければ null。この版で編集できない外見（将来の版など）・選べない値は RuleError。
 */
export function setAppearance(doc: SaveDoc, content: Pick<Content, 'appearance'>, base: AppearanceDraft, draft: AppearanceDraft): SaveDoc | null {
  if (!editableAppearance(doc.appearance)) throw new RuleError('unknown', 'この外見は、この版では編集できません（新しい版のデータです）');
  const errors = validateDraft(draft, content.appearance);
  if (errors.length) throw new RuleError('bad_count', errors[0]!);
  if (changedKinds(base, draft).length === 0) return null;
  const next = cloneSave(doc);
  next.appearance = applyDraft(doc.appearance, base, draft);
  if (JSON.stringify(next.appearance) === JSON.stringify(doc.appearance)) return null;
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

/**
 * 身に着けている防具（部位の順）。身に着けている印が付いていて、持っていて、この版で使えるもの。
 * 1 つの部位に 2 つあれば、防御力が高い方。その部位に 1 つも無ければ（外している）、その部位は入らない。
 */
export function wornArmor(doc: SaveDoc, content: Content): ArmorDef[] {
  const out: ArmorDef[] = [];
  for (const slot of ARMOR_SLOTS) {
    let best: ArmorDef | null = null;
    for (const id of doc.equippedArmorIds) {
      if (!doc.armor.includes(id)) continue;
      const a = content.armor.get(id);
      if (a && a.slot === slot && (!best || a.defense > best.defense)) best = a;
    }
    if (best) out.push(best);
  }
  return out;
}

/** 持っていて、この版で使える防具を、部位ごとに（防御力の低い順）。装備箱の選択肢。 */
export function ownedArmor(doc: SaveDoc, content: Content): Record<ArmorSlot, ArmorDef[]> {
  const out = Object.fromEntries(ARMOR_SLOTS.map((s) => [s, [] as ArmorDef[]])) as Record<ArmorSlot, ArmorDef[]>;
  for (const id of doc.armor) {
    const a = content.armor.get(id);
    if (a) out[a.slot].push(a);
  }
  for (const s of ARMOR_SLOTS) out[s].sort((x, y) => x.defense - y.defense);
  return out;
}

/** 防御力の合計（身に着けている防具） */
export function defenseOf(doc: SaveDoc, content: Content): number {
  const worn=wornArmor(doc,content),w=content.weapons.get(playWeaponId(doc,content));
  return Math.max(0,worn.reduce((n,a)=>n+a.defense,0)+fortifyBonus(worn.map(a=>a.id),doc.classicGear)+(w&&doc.classicGear?computeGear(content,w,worn.map(a=>a.id),doc.classicGear).defenseBonus??0:0));
}

/** その依頼を受けられるか（先に達成しておく依頼を、すべて 1 回は達成している）。 */
export function questUnlocked(doc: SaveDoc, quest: QuestDef): boolean {
  return (quest.requires ?? []).every((id) => (doc.progress.questClears[id] ?? 0) > 0);
}

/** この版に無い ID（捨てずに持っているもの）。 */
export function unknownIds(doc: SaveDoc, content: Content): { items: string[]; weapons: string[]; armor: string[] } {
  return {
    items: Object.keys(doc.items).filter((id) => !content.materials.has(id) && !content.items.has(id)),
    weapons: doc.weapons.filter((id) => !content.weapons.has(id)),
    armor: doc.armor.filter((id) => !content.armor.has(id)),
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

// 1個の装備定義を1個だけ所持する現行保存の範囲で、装着・防具強化を永続化する。
export function changeClassicGear(doc:SaveDoc,c:Content,op:'craft'|'attach'|'detach'|'fortify',id:string,jewelId?:string):SaveDoc{
 const next=cloneSave(doc),g=next.classicGear??(next.classicGear=emptyClassicGear());
 const pay=(money:number,items:readonly {itemId:string;count:number}[])=>{if(next.money<money||items.some(s=>(next.items[s.itemId]??0)<s.count))throw new RuleError('insufficient','素材か通貨が足りません');next.money-=money;for(const s of items){const n=next.items[s.itemId]!-s.count;if(n)next.items[s.itemId]=n;else delete next.items[s.itemId];}};
 if(op==='craft'){
  const j=JEWELS.find(j=>j.id===id);if(!j)throw new RuleError('unknown','装飾品がありません');
  if(![...c.quests.values()].some(q=>q.rankId===j.rank&&questUnlocked(doc,q)))throw new RuleError('locked','その級はまだ開いていません');
  if((g.stock[id]??0)>=MAX_COUNT)throw new RuleError('full','装飾品がいっぱいです');pay(j.money,j.materials);g.stock[id]=(g.stock[id]??0)+1;return next;
 }
 const owned=next.armor.includes(id)||next.weapons.includes(id);if(!owned)throw new RuleError('not_owned','装備を持っていません');
 if(op==='fortify'){const a=c.armor.get(id);if(!a||a.starter)throw new RuleError('unknown','強化できる防具ではありません');const level=g.fortify[id]??0;if(level>=5)throw new RuleError('full','強化上限です');const rank=classicRank(a),ore=['mat.ore.basin_iron','mat.ore.deepcopper','mat.ore.crystalseam_steel','mat.ore.crystalseam_steel'][rank-1]!;pay(120*rank*(level+1),[{itemId:ore,count:level+1}]);g.fortify[id]=level+1;return next;}
 const j=JEWELS.find(x=>x.id===jewelId);if(!j)throw new RuleError('unknown','装飾品がありません');
 const list=g.sockets[id]??(g.sockets[id]=[]);
 if(op==='attach'){if((g.stock[j.id]??0)<=0)throw new RuleError('not_owned','装飾品を持っていません');if(installedSlots(id,g)+j.cost>socketCapacity(c,id))throw new RuleError('full','空きスロットがありません');g.stock[j.id]=(g.stock[j.id]??0)-1;list.push(j.id);}
 else {const i=list.indexOf(j.id);if(i<0)throw new RuleError('not_owned','装着されていません');if((g.stock[j.id]??0)>=MAX_COUNT)throw new RuleError('full','装飾品がいっぱいです');list.splice(i,1);g.stock[j.id]=(g.stock[j.id]??0)+1;}
 return next;
}

export function prepareProvisions(doc:SaveDoc,c:Content,id:string):SaveDoc{
 const r=PROVISIONS.find(x=>x.id===id);if(!r||!c.items.has(r.output))throw new RuleError('unknown','調合がありません');
 if(doc.money<r.money||r.materials.some(m=>(doc.items[m.itemId]??0)<m.count))throw new RuleError('insufficient','素材か通貨が足りません');
 if((doc.items[r.output]??0)+r.count>MAX_COUNT)throw new RuleError('full','所持上限です');
 const next=cloneSave(doc);next.money-=r.money;for(const m of r.materials){const n=next.items[m.itemId]!-m.count;if(n)next.items[m.itemId]=n;else delete next.items[m.itemId];}next.items[r.output]=(next.items[r.output]??0)+r.count;return next;
}
