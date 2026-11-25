// ハンターの外見（v0.28.0。ChatGPT のキャラメイク設計 #10、docs/spec.md の 28 章）。
// 保存の形の検査・描くための解決・編集の差分を、ここで計算する（DOM・three・保存の書き込みに触れない）。
//
// 決まり（設計の state contract / implementation contract から）:
// - 外見の無い古い保存データは、基準ハンター A（legacy_hunter_a_v1）。A を、近い肌の色番号や全軸 50 へ置き換えない。
// - 決定は、編集した種類だけを、いまの保存データへ当てる（未知の ID・知らない欄は、そのまま残す）。
// - 描く時は、未知・不正な値を A へ代わりに描く（保存値は書き換えない）。
// - 外見は、能力・動き・当たりに関わらない（simulation へ渡さない）。
import type { AppearanceCatalog } from './schemas';

export const LEGACY_PROFILE = 'legacy_hunter_a_v1';
export const CUSTOM_PROFILE = 'custom_hunter_v1';
/** この版が読み書きできる外見データの版 */
export const APPEARANCE_DATA_VERSION = 1;

/** 保存する外見。知らない欄も持ち続ける（[k: string]: unknown） */
export interface AppearanceDoc {
  dataVersion: number;
  profile: string;
  [k: string]: unknown;
}

/** 基準ハンター A（新しい保存データ・外見の無い古い保存データ） */
export const legacyAppearance = (): AppearanceDoc => ({ dataVersion: APPEARANCE_DATA_VERSION, profile: LEGACY_PROFILE, overrides: {} });

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** 保存の形の検査（浅い）。中の値の範囲は、描く時と決定の時に確かめる（読めない値で、保存データ全体を読めなくしない） */
export function appearanceShapeErrors(raw: unknown): string[] {
  if (!isObj(raw)) return ['外見の欄が不正です'];
  const e: string[] = [];
  if (!(Number.isInteger(raw.dataVersion) && (raw.dataVersion as number) >= 1)) e.push('外見の版が不正です');
  if (typeof raw.profile !== 'string' || raw.profile === '') e.push('外見の種類が不正です');
  return e;
}

/** 編集中の外見（種類ごと。null は「A のまま」）。髪型・顔・眉・目は、いまは A だけなので持たない */
export interface AppearanceDraft {
  body: { presetId: string; axes: Record<string, number> } | null;
  skin: { colorId: string; redness: number; yellowness: number } | null;
  hairColorId: string | null;
}

export const emptyDraft = (): AppearanceDraft => ({ body: null, skin: null, hairColorId: null });

/** この版で編集できる外見か（版 1 で、知っている種類）。将来の版・知らない種類は、見るだけ（書き換えない） */
export function editableAppearance(a: AppearanceDoc): boolean {
  return a.dataVersion === APPEARANCE_DATA_VERSION && (a.profile === LEGACY_PROFILE || a.profile === CUSTOM_PROFILE);
}

/** 保存の外見 → 編集の draft（知っている種類だけ。値は生のまま。範囲外・未知 ID は validateDraft が見つける） */
export function draftOf(a: AppearanceDoc): AppearanceDraft {
  const d = emptyDraft();
  if (a.profile !== CUSTOM_PROFILE) return d;
  const body = a.body;
  if (isObj(body) && typeof body.presetId === 'string' && isObj(body.axes)) d.body = { presetId: body.presetId, axes: Object.fromEntries(Object.entries(body.axes).filter(([, v]) => isNum(v))) as Record<string, number> };
  const skin = a.skin;
  if (isObj(skin) && typeof skin.colorId === 'string') d.skin = { colorId: skin.colorId, redness: isNum(skin.redness) ? skin.redness : 0, yellowness: isNum(skin.yellowness) ? skin.yellowness : 0 };
  const hair = a.hair;
  if (isObj(hair) && typeof hair.colorId === 'string') d.hairColorId = hair.colorId;
  return d;
}

/** 2 つの draft の、種類ごとの違い（決定で当てる種類） */
export function changedKinds(base: AppearanceDraft, draft: AppearanceDraft): ('body' | 'skin' | 'hairColorId')[] {
  return (['body', 'skin', 'hairColorId'] as const).filter((k) => JSON.stringify(base[k]) !== JSON.stringify(draft[k]));
}

/** 決定できるか（知っていて選べる ID・範囲内の数）。問題を日本語で返す */
export function validateDraft(d: AppearanceDraft, cat: AppearanceCatalog): string[] {
  const e: string[] = [];
  if (d.body) {
    if (!cat.bodyPresets.some((p) => p.id === d.body!.presetId)) e.push(`体型 ${d.body.presetId} は、この版に無い`);
    for (const ax of cat.bodyAxes) {
      const v = d.body.axes[ax.id];
      if (!(isNum(v) && v >= 0 && v <= 100)) e.push(`${ax.label} は 0〜100 で入力してください`);
    }
  }
  if (d.skin) {
    if (!cat.skinColors.some((c) => c.id === d.skin!.colorId)) e.push(`肌の色 ${d.skin.colorId} は、この版に無い`);
    for (const [k, label] of [['redness', '赤み'], ['yellowness', '黄み']] as const) {
      const v = d.skin[k];
      if (!(isNum(v) && v >= cat.skinTone.min && v <= cat.skinTone.max)) e.push(`${label} は ${cat.skinTone.min}〜${cat.skinTone.max} で入力してください`);
    }
  }
  if (d.hairColorId !== null && !cat.hairColors.some((c) => c.id === d.hairColorId)) e.push(`髪の色 ${d.hairColorId} は、この版に無い`);
  return e;
}

/**
 * 決定: いまの保存の外見へ、編集した種類（base と draft で違う種類）だけを当てる。
 * ほかの欄（知らない欄・未知の ID・髪型など）は、そのまま残す。全部が A のままなら、種類は legacy に戻す（知らない欄は残す）。
 */
export function applyDraft(saved: AppearanceDoc, base: AppearanceDraft, draft: AppearanceDraft): AppearanceDoc {
  const kinds = changedKinds(base, draft);
  const out: AppearanceDoc = JSON.parse(JSON.stringify(saved)) as AppearanceDoc;
  for (const k of kinds) {
    if (k === 'body') {
      if (draft.body) out.body = { presetId: draft.body.presetId, axes: { ...draft.body.axes } };
      else delete out.body;
    } else if (k === 'skin') {
      if (draft.skin) out.skin = { ...draft.skin };
      else delete out.skin;
    } else {
      const hair = isObj(out.hair) ? { ...out.hair } : {};
      if (draft.hairColorId) hair.colorId = draft.hairColorId;
      else delete hair.colorId;
      if (Object.keys(hair).length) out.hair = hair;
      else delete out.hair;
    }
  }
  const custom = ['body', 'skin', 'hair', 'face', 'brows', 'eyes'].some((k) => out[k] !== undefined);
  out.profile = custom ? CUSTOM_PROFILE : LEGACY_PROFILE;
  if (custom) delete out.overrides;
  else if (!isObj(out.overrides)) out.overrides = {};
  out.dataVersion = APPEARANCE_DATA_VERSION;
  return out;
}

/** 描くための外見（色は sRGB の 0〜1）。null は「A のまま」。保存値が未知・不正な時は A を描き、fallback に書く */
export interface ResolvedAppearance {
  skin: [number, number, number] | null;
  hair: [number, number, number] | null;
  /** 体型の 8 軸（0〜100）。null は A の体つき */
  body: Record<string, number> | null;
  /** A へ代わりに描いた所（未知の ID・範囲外の値・知らない版） */
  fallback: string[];
}

export const hexRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** 肌の色に、赤み・黄み（-100〜100）を足す。赤みは R を上げて G・B を少し下げ、黄みは R・G を上げて B を下げる */
export function toneSkin(rgb: readonly [number, number, number], redness: number, yellowness: number): [number, number, number] {
  const r = Math.max(-1, Math.min(1, redness / 100)), y = Math.max(-1, Math.min(1, yellowness / 100));
  return [clamp01(rgb[0] * (1 + 0.1 * r + 0.04 * y)), clamp01(rgb[1] * (1 - 0.05 * r + 0.03 * y)), clamp01(rgb[2] * (1 - 0.05 * r - 0.14 * y))];
}

/** 保存の外見 → 描くための外見。保存値は変えない */
export function resolveAppearance(raw: unknown, cat: AppearanceCatalog): ResolvedAppearance {
  const out: ResolvedAppearance = { skin: null, hair: null, body: null, fallback: [] };
  if (!isObj(raw) || appearanceShapeErrors(raw).length) {
    out.fallback.push('外見の欄');
    return out;
  }
  const a = raw as AppearanceDoc;
  if (!editableAppearance(a)) {
    out.fallback.push(`外見の版 ${String(a.dataVersion)}・種類 ${a.profile}`);
    return out;
  }
  if (a.profile === LEGACY_PROFILE) return out;
  const d = draftOf(a);
  if (d.skin) {
    const c = cat.skinColors.find((x) => x.id === d.skin!.colorId);
    if (c && Math.abs(d.skin.redness) <= 100 && Math.abs(d.skin.yellowness) <= 100) out.skin = toneSkin(hexRgb(c.hex), d.skin.redness, d.skin.yellowness);
    else out.fallback.push(`肌 ${d.skin.colorId}`);
  }
  if (d.hairColorId) {
    const c = cat.hairColors.find((x) => x.id === d.hairColorId);
    if (c) out.hair = hexRgb(c.hex);
    else out.fallback.push(`髪の色 ${d.hairColorId}`);
  }
  if (d.body) {
    const ok = cat.bodyAxes.every((ax) => isNum(d.body!.axes[ax.id]) && d.body!.axes[ax.id]! >= 0 && d.body!.axes[ax.id]! <= 100);
    if (ok) out.body = Object.fromEntries(cat.bodyAxes.map((ax) => [ax.id, d.body!.axes[ax.id]!]));
    else out.fallback.push('体型');
  }
  // 髪型・顔・眉・目は、いまは A だけ（ほかの ID が保存されていれば、A を描く）
  const hair = a.hair;
  if (isObj(hair) && typeof hair.styleId === 'string' && !cat.hairStyles.some((h) => h.id === hair.styleId && h.ready)) out.fallback.push(`髪型 ${hair.styleId}`);
  for (const [k, list] of [['face', cat.faces], ['brows', cat.brows]] as const) {
    const v = a[k];
    const id = isObj(v) ? (v.presetId ?? v.styleId) : undefined;
    if (typeof id === 'string' && !list.some((x) => x.id === id && x.ready)) out.fallback.push(`${k === 'face' ? '顔' : '眉'} ${id}`);
  }
  const eyes = a.eyes;
  if (isObj(eyes) && typeof eyes.colorId === 'string' && !cat.eyeColors.some((x) => x.id === eyes.colorId && x.ready)) out.fallback.push(`目の色 ${eyes.colorId}`);
  return out;
}

/** 描く側が、作り直しが要るかを見る鍵（体型だけ。色は uniform で替える） */
export const bodyKey = (body: Record<string, number> | null): string => (body ? Object.entries(body).sort(([x], [y]) => (x < y ? -1 : 1)).map(([k, v]) => `${k}:${Math.round(v)}`).join(',') : 'A');

// ---- 編集（画面の下書き。決定するまで、保存も、ゲームの姿も変えない）----

/** 下書き → 描くための外見（下見に使う） */
export function resolveDraft(d: AppearanceDraft, cat: AppearanceCatalog): ResolvedAppearance {
  return resolveAppearance(applyDraft(legacyAppearance(), emptyDraft(), d), cat);
}

/** 種類の名前（確認の画面・知らせ） */
export const DRAFT_KIND_NAMES = { body: '体型', skin: '肌', hairColorId: '髪の色' } as const;
export type DraftKind = keyof typeof DRAFT_KIND_NAMES;

const signed = (v: number): string => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '0');

/** 下書きの 1 つの種類を、名前で表す（「A の体つき」「筋肉質（B03・調整あり）」など） */
export function describeKind(kind: DraftKind, d: AppearanceDraft, cat: AppearanceCatalog): string {
  if (kind === 'body') {
    if (!d.body) return 'A の体つき';
    const p = cat.bodyPresets.find((x) => x.id === d.body!.presetId);
    const tuned = p ? cat.bodyAxes.some((ax) => d.body!.axes[ax.id] !== p.axes[ax.id]) : true;
    return `${p?.label ?? d.body.presetId}（${d.body.presetId}${tuned ? '・調整あり' : ''}）`;
  }
  if (kind === 'skin') {
    if (!d.skin) return 'A の肌';
    const c = cat.skinColors.find((x) => x.id === d.skin!.colorId);
    const tone = d.skin.redness || d.skin.yellowness ? `・赤み ${signed(d.skin.redness)}・黄み ${signed(d.skin.yellowness)}` : '';
    return `${c?.label ?? d.skin.colorId}（${d.skin.colorId}${tone}）`;
  }
  if (!d.hairColorId) return 'A の髪の色';
  const c = cat.hairColors.find((x) => x.id === d.hairColorId);
  return `${c?.label ?? d.hairColorId}（${d.hairColorId}）`;
}

export interface DraftChange {
  kind: DraftKind;
  label: string;
  before: string;
  after: string;
}

/** 2 つの下書きの違いを、名前で並べる（確認の画面の「髪の色：前 → 後」） */
export function draftChanges(from: AppearanceDraft, to: AppearanceDraft, cat: AppearanceCatalog): DraftChange[] {
  return changedKinds(from, to).map((kind) => ({ kind, label: DRAFT_KIND_NAMES[kind], before: describeKind(kind, from, cat), after: describeKind(kind, to, cat) }));
}

/**
 * 編集の履歴（元に戻す・やり直す）。1 操作で 1 つ積む。上限（50）を超えた分は、古いものから消える。
 * 戻した後に新しい操作をすると、やり直しの枝は消える。カメラ・比較・固定の切り替えは積まない（呼ぶ側が積まない）。
 */
export class DraftHistory {
  private undos: string[] = [];
  private redos: string[] = [];
  constructor(readonly limit = 50) {}
  /** 操作の前の下書きを積む */
  push(before: AppearanceDraft): void {
    this.undos.push(JSON.stringify(before));
    if (this.undos.length > this.limit) this.undos.shift();
    this.redos = [];
  }
  /** 1 つ戻す（current はいまの下書き。やり直しへ積む）。戻せなければ null */
  undo(current: AppearanceDraft): AppearanceDraft | null {
    const s = this.undos.pop();
    if (s === undefined) return null;
    this.redos.push(JSON.stringify(current));
    return JSON.parse(s) as AppearanceDraft;
  }
  redo(current: AppearanceDraft): AppearanceDraft | null {
    const s = this.redos.pop();
    if (s === undefined) return null;
    this.undos.push(JSON.stringify(current));
    return JSON.parse(s) as AppearanceDraft;
  }
  get undoCount(): number {
    return this.undos.length;
  }
  get redoCount(): number {
    return this.redos.length;
  }
  clear(): void {
    this.undos = [];
    this.redos = [];
  }
}

/** ランダムで固定する種類（髪型・顔・眉・目の色は、いまは A だけなので、いつも変えない） */
export interface RandomLocks {
  body: boolean;
  skin: boolean;
  hairColor: boolean;
}

/**
 * ランダムの範囲（この版で見て確かめた範囲。体型の軸を 0〜100 の端まで選ばない）。
 * 体型: 見本 4 種から 1 つ選び、各軸を見本の値 ±10（15〜85 に収める）。肌: 12 色から 1 つ、赤み・黄みは ±30。髪: 12 色から 1 つ。
 */
export const RANDOM_RANGE = { axisJitter: 10, axisMin: 15, axisMax: 85, tone: 30 } as const;

/** 固定していない種類を選び直した下書き。全部を固定していれば null。rnd は 0 以上 1 未満 */
export function randomDraft(cur: AppearanceDraft, locks: RandomLocks, cat: AppearanceCatalog, rnd: () => number): AppearanceDraft | null {
  if (locks.body && locks.skin && locks.hairColor) return null;
  const pick = <T>(list: readonly T[]): T => list[Math.min(list.length - 1, Math.floor(rnd() * list.length))]!;
  const between = (a: number, b: number): number => Math.round(a + (b - a) * rnd());
  const out: AppearanceDraft = JSON.parse(JSON.stringify(cur)) as AppearanceDraft;
  if (!locks.body) {
    const p = pick(cat.bodyPresets);
    const r = RANDOM_RANGE;
    out.body = { presetId: p.id, axes: Object.fromEntries(cat.bodyAxes.map((ax) => [ax.id, Math.min(r.axisMax, Math.max(r.axisMin, (p.axes[ax.id] ?? 50) + between(-r.axisJitter, r.axisJitter)))])) };
  }
  if (!locks.skin) {
    const c = pick(cat.skinColors.filter((x) => x.ready !== false));
    out.skin = { colorId: c.id, redness: between(-RANDOM_RANGE.tone, RANDOM_RANGE.tone), yellowness: between(-RANDOM_RANGE.tone, RANDOM_RANGE.tone) };
  }
  if (!locks.hairColor) out.hairColorId = pick(cat.hairColors.filter((x) => x.ready !== false)).id;
  return out;
}
