// モンスターの登録簿（図鑑）: 型・検査・取り込み（v0.13.0、docs/spec.md 20 章、D-071）。
// モンスターは ChatGPT が考える。ここは、その案（JSON）を受け取り、決まりに合うか確かめて、登録簿 public/data/bestiary.json へ足す。
// 登録簿は「どんなモンスターが、どの段階から、どこに出るか」の計画で、遊べる状態（技・当たり・体）は public/data/monsters/ が別に持つ。
// このファイルは、ほかのファイルを実行時に読み込まない（tools/bestiary-import.mjs が、Node でそのまま読むため）。型だけの import は可。

/** 大型 / 超大型（中級から）/ 幼体（大型の子。群れで出る） */
export const SPECIES_CLASSES = ['large', 'huge', 'juvenile'] as const;
export type SpeciesClass = (typeof SPECIES_CLASSES)[number];
/** 原種 / 亜種（中級から）/ 希少種（上級から） */
export const SPECIES_VARIANTS = ['base', 'subspecies', 'rare'] as const;
export type SpeciesVariant = (typeof SPECIES_VARIANTS)[number];
/** planned = 案だけ / art = 原画がある / implemented = 遊べる（public/data/monsters/ にある） */
export const SPECIES_STATES = ['planned', 'art', 'implemented'] as const;
export type SpeciesState = (typeof SPECIES_STATES)[number];
/** 属性（docs/elements.md）。none は無属性 */
export const ELEMENTS = ['none', 'fire', 'thunder', 'ice', 'water', 'wind', 'mist'] as const;
export type ElementId = (typeof ELEMENTS)[number];
export const STATUSES = ['poison', 'paralysis', 'sleep', 'stun'] as const;
export type StatusId = (typeof STATUSES)[number];

export const CLASS_NAMES: Record<SpeciesClass, string> = { large: '大型', huge: '超大型', juvenile: '幼体' };
export const VARIANT_NAMES: Record<SpeciesVariant, string> = { base: '原種', subspecies: '亜種', rare: '希少種' };
export const STATE_NAMES: Record<SpeciesState, string> = { planned: '案', art: '原画あり', implemented: '実装済み' };
export const ELEMENT_NAMES: Record<ElementId, string> = { none: '無属性', fire: '火', thunder: '雷', ice: '氷', water: '水', wind: '風', mist: '霧' };
export const STATUS_NAMES: Record<StatusId, string> = { poison: '毒', paralysis: '麻痺', sleep: '睡眠', stun: '気絶' };

/** 生態。どれも 1〜3 文の文章。 */
export interface Ecology {
  /** 食べ物と、その取り方 */
  diet: string;
  /** ふだんの行動（歩き回る・待ち伏せる・群れる など）と、気性 */
  behavior: string;
  /** なわばりと、すむ場所（狩場の中の、どんなエリアを好むか） */
  territory: string;
  /** 1 日の動き（いつ動き、いつ休むか。天気や霧での違い） */
  rhythm: string;
  /** 巣と、眠り方 */
  nest: string;
  /** ほかのモンスター・里の人との関わり */
  relations: string;
  /** 子（幼体）の姿と、群れ方。親との違い */
  juvenile: string;
  /** 狩人が見つける痕跡（足跡、食べ跡、抜け殻 など） */
  signs: string;
}
export const ECOLOGY_KEYS = ['diet', 'behavior', 'territory', 'rhythm', 'nest', 'relations', 'juvenile', 'signs'] as const;
export const ECOLOGY_NAMES: Record<(typeof ECOLOGY_KEYS)[number], string> = {
  diet: '食べ物', behavior: '行動と気性', territory: 'なわばり', rhythm: '1 日の動き', nest: '巣と眠り', relations: 'ほかとの関わり', juvenile: '幼体', signs: '痕跡',
};

export interface SpeciesDef {
  /** 恒久 ID。monster.<英小文字と数字と _>。表示名を変えても、これは変えない */
  id: string;
  /** 図鑑の番号 */
  no: number;
  /** 二つ名（岩殻獣）と、名前（ガルドロス） */
  title: string;
  name: string;
  class: SpeciesClass;
  variant: SpeciesVariant;
  /** 亜種・希少種・幼体の、もとの種 */
  baseId?: string;
  /** はじめて依頼に出る段階（ranks.json の id） */
  rank: string;
  /** 骨格（frames の id）。体の動かし方を、同じ骨格の種で使い回す */
  frame: string;
  /** 全長 (m) */
  size: number;
  /** すむ狩場の名前（狩場のデータがまだ無くても書ける） */
  habitat: string;
  /** 攻撃に持つ属性（1 つ。上級・極級は 2 つまで = 複合属性）と、状態異常 */
  elements: ElementId[];
  statuses: StatusId[];
  /** 弱点の属性と、強い属性 */
  weak: ElementId[];
  resist: ElementId[];
  /** 外見の核（ひと目で見分ける形）と、その種にしか無い器官 */
  look: string;
  organ: string;
  /** 技の種（3〜8 個。短い言葉） */
  moves: string[];
  /** 壊せる部位（2〜6 個） */
  parts: string[];
  /** 取れる素材の名前（2〜6 個） */
  materials: string[];
  /** 装備の個性（素材と、武器の向き） */
  gear: string;
  /** 防具へ写す個性（輪郭・色・偏り）。依頼 7 の「モンスターごとの個性を防具へ写す 5 つ」 */
  armorLook?: string;
  ecology?: Ecology;
  /** 幼体: 群れの数 [少, 多] */
  pack?: [number, number];
  /** 同じ依頼に一緒に出る相手（上級からの、複数体の依頼の案） */
  pairs?: string[];
  state: SpeciesState;
  /** 文書用の補足（属性が候補か決定か、いまの作業の状態） */
  elementNote?: string;
  stateNote?: string;
  /** 原画（art-source の中のファイル名） */
  art?: string;
  /** だれが、どの依頼で考えたか（claude / chatgpt:依頼 9A など） */
  source: string;
}

export interface FrameDef {
  id: string;
  name: string;
  /** どんな体か。動きの決まり */
  note: string;
  /** この骨格の体を、もう作ってあるか */
  built: boolean;
}

/**
 * 狩場の案（v0.15.0）。種の habitat は、ここにある名前を使う。
 * 名前で持つ（恒久 ID は、歩ける狩場を作る時に付ける）。歩ける狩場（public/data/fields/）がある時は、fieldId でつなぐ。
 */
export interface FieldPlan {
  name: string;
  /** 地形をひとことで */
  terrain: string;
  /** 天気・光・音 */
  mood?: string;
  /** 歩ける狩場の id（public/data/fields/ にあるものだけ）。無ければ、まだ案だけ */
  fieldId?: string;
  /** 案の出どころ */
  source?: string;
}

export interface BestiaryDef {
  schemaVersion: number;
  /** 段階ごとの、新しく登場する種の数の目標（幼体は数えない） */
  plan: Record<string, number>;
  frames: FrameDef[];
  /** 狩場の案。種の habitat に使える名前の一覧 */
  fields: FieldPlan[];
  species: SpeciesDef[];
}

const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const isList = (v: unknown, min: number, max: number): v is string[] => Array.isArray(v) && v.length >= min && v.length <= max && v.every(isStr);
const subset = <T extends string>(v: unknown, all: readonly T[]): v is T[] => Array.isArray(v) && v.every((x) => (all as readonly string[]).includes(x as string)) && new Set(v).size === v.length;

/** 段階の順番（ranks = 段階の id を、低い順に）。 */
export interface BestiaryEnv {
  ranks: readonly string[];
  /** 遊べるモンスターの id（public/data/monsters/）。渡した時だけ、「実装済み」と書かれた種が本当にあるかを見る */
  playable?: ReadonlySet<string>;
  /** 歩ける狩場の id（public/data/fields/）。渡した時だけ、狩場の案の fieldId が本当にあるかを見る */
  fieldIds?: ReadonlySet<string>;
}

/** 狩場の案 1 つの検査（登録簿と、受け取る案の両方に使う）。 */
function fieldErrors(f: Partial<FieldPlan> | null | undefined, env: BestiaryEnv): string[] {
  if (!f || typeof f !== 'object' || !isStr(f.name)) return ['狩場（fields）に、name の無いものがある'];
  const w = `狩場「${f.name}」`;
  const e: string[] = [];
  if (f.name.startsWith('（')) e.push(`${w}: 見本の例が入っている（返す JSON から外す）`);
  if (!isStr(f.terrain)) e.push(`${w}: terrain（地形）が無い`);
  if (f.mood !== undefined && !isStr(f.mood)) e.push(`${w}: mood が不正`);
  if (f.fieldId !== undefined && (!/^field\.[a-z0-9_]+$/.test(String(f.fieldId)) || (env.fieldIds && !env.fieldIds.has(f.fieldId)))) e.push(`${w}: fieldId "${String(f.fieldId)}" の歩ける狩場が無い`);
  return e;
}

/**
 * 登録簿の検査。決まりに合わない所を、文章の一覧で返す（空なら合格）。
 * strict: ChatGPT から受け取る案に使う。生態・器官・部位・素材まで、全部そろっていることを求める。
 */
export function validateBestiary(b: BestiaryDef, env: BestiaryEnv, strict: (s: SpeciesDef) => boolean = () => false): string[] {
  const errors: string[] = [];
  const rankOrder = (id: string): number => env.ranks.indexOf(id);
  const frames = new Set((b.frames ?? []).map((f) => f.id));
  if (frames.size !== (b.frames ?? []).length) errors.push('frames: id が重複');
  for (const f of b.frames ?? []) if (!/^frame\.[a-z0-9_]+$/.test(f.id) || !isStr(f.name) || !isStr(f.note)) errors.push(`frame ${f.id}: id / name / note が不正`);
  for (const [rank, n] of Object.entries(b.plan ?? {})) if (rankOrder(rank) < 0 || !Number.isInteger(n) || n < 0) errors.push(`plan: ${rank} が不正`);
  // 狩場の案
  if (!Array.isArray(b.fields)) errors.push('fields（狩場の一覧）が無い');
  const fieldNames = new Set<string>();
  for (const f of Array.isArray(b.fields) ? b.fields : []) {
    errors.push(...fieldErrors(f, env));
    if (isStr(f?.name)) {
      if (fieldNames.has(f.name)) errors.push(`狩場「${f.name}」: 同じ名前の狩場がある`);
      fieldNames.add(f.name);
    }
  }
  const byId = new Map<string, SpeciesDef>();
  const names = new Set<string>(), nos = new Set<number>();
  for (const s of b.species ?? []) {
    const w = `${s.id}（${s.title ?? ''} ${s.name ?? ''}）`;
    if (!/^monster\.[a-z0-9_]+$/.test(String(s.id))) errors.push(`${w}: id は monster.<英小文字・数字・_> にする`);
    if (byId.has(s.id)) errors.push(`${w}: id が重複`);
    byId.set(s.id, s);
    if (!isStr(s.title) || !isStr(s.name)) errors.push(`${w}: title / name が無い`);
    const full = `${s.title} ${s.name}`;
    if (names.has(full)) errors.push(`${w}: 同じ名前の種がある`);
    names.add(full);
    if (!Number.isInteger(s.no) || s.no <= 0 || nos.has(s.no)) errors.push(`${w}: no が不正か重複`);
    nos.add(s.no);
    if (!(SPECIES_CLASSES as readonly string[]).includes(s.class)) errors.push(`${w}: class "${String(s.class)}" は未定義`);
    if (!(SPECIES_VARIANTS as readonly string[]).includes(s.variant)) errors.push(`${w}: variant "${String(s.variant)}" は未定義`);
    if (!(SPECIES_STATES as readonly string[]).includes(s.state)) errors.push(`${w}: state "${String(s.state)}" は未定義`);
    if (rankOrder(s.rank) < 0) errors.push(`${w}: rank "${String(s.rank)}" が無い`);
    if (!frames.has(s.frame)) errors.push(`${w}: frame "${String(s.frame)}" が無い`);
    if (!(typeof s.size === 'number' && s.size > 0 && s.size < 400)) errors.push(`${w}: size（全長 m）が不正`);
    if (!isStr(s.habitat)) errors.push(`${w}: habitat が無い`);
    else if (!fieldNames.has(s.habitat)) errors.push(`${w}: habitat「${s.habitat}」が、狩場の一覧（fields）に無い（新しい狩場は、fields に name と terrain を書く）`);
    if (!isStr(s.look)) errors.push(`${w}: look が無い`);
    if (!isList(s.moves, 1, 8)) errors.push(`${w}: moves は 1〜8 個`);
    if (!isStr(s.source)) errors.push(`${w}: source が無い`);
    // 属性
    if (!subset(s.elements, ELEMENTS) || s.elements.length < 1 || s.elements.length > 2) errors.push(`${w}: elements は 1〜2 個（${ELEMENTS.join(' / ')}）`);
    else {
      if (s.elements.length === 2 && (s.elements.includes('none') || rankOrder(s.rank) < 2)) errors.push(`${w}: 複合属性（2 つ）は、上級・極級だけ。無属性とは組まない`);
      if (!subset(s.weak, ELEMENTS) || !subset(s.resist, ELEMENTS) || s.weak.includes('none') || s.resist.includes('none')) errors.push(`${w}: weak / resist が不正`);
      else if (s.weak.some((e) => s.resist.includes(e))) errors.push(`${w}: 同じ属性が、弱点と耐性の両方にある`);
      else if (s.weak.some((e) => s.elements.includes(e))) errors.push(`${w}: 自分の属性が弱点になっている`);
    }
    if (!subset(s.statuses, STATUSES)) errors.push(`${w}: statuses が不正（${STATUSES.join(' / ')}）`);
    // 大きさと種類
    if (s.class === 'huge' && rankOrder(s.rank) < 1) errors.push(`${w}: 超大型は、中級から`);
    if (s.class === 'huge' && s.size < 25) errors.push(`${w}: 超大型は、全長 25m 以上`);
    if (s.class === 'large' && s.size >= 25) errors.push(`${w}: 全長 25m 以上は、超大型（class: huge）にする`);
    if (s.variant === 'subspecies' && rankOrder(s.rank) < 1) errors.push(`${w}: 亜種は、中級から`);
    if (s.variant === 'rare' && rankOrder(s.rank) < 2) errors.push(`${w}: 希少種は、上級から`);
    if (s.class === 'juvenile' && !(Array.isArray(s.pack) && s.pack.length === 2 && Number.isInteger(s.pack[0]) && Number.isInteger(s.pack[1]) && s.pack[0] >= 2 && s.pack[1] >= s.pack[0] && s.pack[1] <= 8)) errors.push(`${w}: 幼体は、pack（群れの数 [少, 多]。2〜8）を書く`);
    if (s.class !== 'juvenile' && s.pack !== undefined) errors.push(`${w}: pack は、幼体だけ`);
    if (strict(s)) {
      if (!isStr(s.organ)) errors.push(`${w}: organ（その種にしか無い器官）が無い`);
      if (!isList(s.moves, 3, 8)) errors.push(`${w}: moves は 3〜8 個`);
      if (!isList(s.parts, 2, 6)) errors.push(`${w}: parts は 2〜6 個`);
      if (!isList(s.materials, 2, 6)) errors.push(`${w}: materials は 2〜6 個`);
      if (!isStr(s.gear)) errors.push(`${w}: gear が無い`);
      for (const k of ECOLOGY_KEYS) if (!isStr(s.ecology?.[k])) errors.push(`${w}: 生態の「${ECOLOGY_NAMES[k]}」（ecology.${k}）が無い`);
    } else if (s.ecology !== undefined) {
      for (const k of ECOLOGY_KEYS) if (!isStr(s.ecology[k])) errors.push(`${w}: 生態の「${ECOLOGY_NAMES[k]}」（ecology.${k}）が無い`);
    }
    if (env.playable && s.state === 'implemented' && !env.playable.has(s.id)) errors.push(`${w}: 「実装済み」だが、public/data/monsters/ に無い`);
  }
  // 種どうしの関わり
  for (const s of b.species ?? []) {
    const w = `${s.id}（${s.title} ${s.name}）`;
    const needsBase = s.variant !== 'base' || s.class === 'juvenile';
    if (needsBase) {
      const base = s.baseId ? byId.get(s.baseId) : undefined;
      if (!base) errors.push(`${w}: baseId（もとの種）が無い`);
      else {
        if (base.variant !== 'base' || base.class === 'juvenile') errors.push(`${w}: もとの種 ${base.id} が、原種の成体ではない`);
        if (s.frame !== base.frame) errors.push(`${w}: 骨格が、もとの種と違う（亜種・希少種・幼体は、同じ骨格にする）`);
        if (s.class === 'juvenile' && !(s.size < base.size * 0.7)) errors.push(`${w}: 幼体は、もとの種の 7 割より小さくする`);
        if (s.class !== 'juvenile' && rankOrder(s.rank) < rankOrder(base.rank)) errors.push(`${w}: もとの種より先の段階に出ている`);
      }
    } else if (s.baseId !== undefined) errors.push(`${w}: 原種の成体に baseId は付けない`);
    for (const p of s.pairs ?? []) {
      // （初級・中級の種どうしでも、上級の依頼で組める）
      if (p === s.id || !byId.has(p)) errors.push(`${w}: pairs の相手 ${p} が無い`);
    }
  }
  return errors;
}

export interface BestiaryCount {
  rank: string;
  /** その段階から新しく登場する種（幼体は数えない） */
  have: number;
  plan: number;
  large: number;
  huge: number;
  subspecies: number;
  rare: number;
  juveniles: number;
}

/** 段階ごとの数。目標（plan）との差を見る。 */
export function bestiaryCounts(b: BestiaryDef, ranks: readonly string[]): BestiaryCount[] {
  return ranks.map((rank) => {
    const here = b.species.filter((s) => s.rank === rank);
    const adults = here.filter((s) => s.class !== 'juvenile');
    return {
      rank, have: adults.length, plan: b.plan[rank] ?? 0,
      large: adults.filter((s) => s.class === 'large').length, huge: adults.filter((s) => s.class === 'huge').length,
      subspecies: adults.filter((s) => s.variant === 'subspecies').length, rare: adults.filter((s) => s.variant === 'rare').length,
      juveniles: here.filter((s) => s.class === 'juvenile').length,
    };
  });
}

export interface MergeResult {
  bestiary: BestiaryDef;
  added: string[];
  updated: string[];
  /** 足した狩場・書き換えた狩場（名前）。無ければ空 */
  addedFields?: string[];
  updatedFields?: string[];
  /** 取り込まなかった理由（1 つでもあれば、bestiary は元のまま） */
  errors: string[];
}

/**
 * ChatGPT の案を、登録簿へ足す。
 * - 同じ id の種は、案の内容で上書きする（遊べる種の state と、原画の印は、元のものを残す）。
 * - no が無い・重なる種には、空いている番号を付ける。
 * - 狩場の案（fields）は、名前で足す。同じ名前があれば、地形と雰囲気を書き換える（歩ける狩場とのつながり fieldId は残す）。
 * - 足した後の登録簿ぜんたいを検査し、1 つでも決まりに合わなければ、何も変えない。
 */
export function mergeBestiary(base: BestiaryDef, incoming: { species?: unknown; frames?: unknown; fields?: unknown }, env: BestiaryEnv, source: string): MergeResult {
  const fail = (errors: string[]): MergeResult => ({ bestiary: base, added: [], updated: [], errors });
  if (!Array.isArray(incoming.species) || incoming.species.length === 0) return fail(['species（種の一覧）が無い']);
  const next: BestiaryDef = JSON.parse(JSON.stringify(base)) as BestiaryDef;
  // 新しい骨格の案（あれば足す。まだ体は作っていない印を付ける）
  for (const f of Array.isArray(incoming.frames) ? (incoming.frames as Partial<FrameDef>[]) : []) {
    if (!f || !isStr(f.id) || next.frames.some((x) => x.id === f.id)) continue;
    next.frames.push({ id: f.id, name: String(f.name ?? ''), note: String(f.note ?? ''), built: false });
  }
  // 狩場の案（あれば足す。v0.15.0。それまでは、検査を通るのに、黙って捨てていた）
  const addedFields: string[] = [], updatedFields: string[] = [];
  if (incoming.fields !== undefined) {
    if (!Array.isArray(incoming.fields)) return fail(['fields は、狩場の一覧（配列）にする']);
    const fieldProblems: string[] = [];
    const seen = new Set<string>();
    for (const raw of incoming.fields as Partial<FieldPlan>[]) {
      const errs = fieldErrors(raw, env);
      if (errs.length > 0) {
        fieldProblems.push(...errs);
        continue;
      }
      const name = raw.name!;
      if (seen.has(name)) fieldProblems.push(`狩場「${name}」: 案の中に、同じ名前が 2 つある`);
      seen.add(name);
      const at = next.fields.findIndex((x) => x.name === name);
      const plan: FieldPlan = { name, terrain: raw.terrain!, ...(isStr(raw.mood) ? { mood: raw.mood } : {}) };
      if (at >= 0) {
        // 歩ける狩場とのつながりは、案では変えない
        const old = next.fields[at]!;
        const same = old.terrain === plan.terrain && (old.mood ?? '') === (plan.mood ?? '');
        next.fields[at] = { ...plan, ...(old.fieldId !== undefined ? { fieldId: old.fieldId } : {}), source: same ? old.source ?? source : source };
        if (!same) updatedFields.push(name);
      } else {
        next.fields.push({ ...plan, source });
        addedFields.push(name);
      }
    }
    if (fieldProblems.length > 0) return fail(fieldProblems);
  }
  const known = new Map(next.species.map((s, i) => [s.id, i]));
  const added: string[] = [], updated: string[] = [];
  const touched = new Set<string>();
  const usedNo = new Set(next.species.map((s) => s.no));
  let freeNo = 1;
  const takeNo = (): number => {
    while (usedNo.has(freeNo)) freeNo++;
    usedNo.add(freeNo);
    return freeNo;
  };
  const dup: string[] = [];
  for (const raw of incoming.species as Partial<SpeciesDef>[]) {
    if (!raw || typeof raw !== 'object' || !isStr(raw.id)) return fail(['id の無い種がある']);
    // 書き方の見本（docs/bestiary-template.json）の例は、取り込まない
    if (raw.id.startsWith('monster.example')) return fail([`${raw.id}: 見本の例が入っている（返す JSON から外す）`]);
    if (touched.has(raw.id)) dup.push(raw.id);
    touched.add(raw.id);
    const at = known.get(raw.id);
    const old = at !== undefined ? next.species[at]! : undefined;
    const s = { statuses: [], weak: [], resist: [], parts: [], materials: [], organ: '', gear: '', ...raw, source: isStr(raw.source) ? raw.source : source } as SpeciesDef;
    // 遊べる・原画がある、という事実は、案では変えない
    s.state = old ? old.state : 'planned';
    if (old?.art !== undefined) s.art = old.art;
    if (old?.stateNote !== undefined && s.stateNote === undefined) s.stateNote = old.stateNote;
    if (old) {
      s.no = old.no;
      next.species[at!] = s;
      updated.push(s.id);
    } else {
      if (!(Number.isInteger(s.no) && s.no > 0 && !usedNo.has(s.no))) s.no = takeNo();
      else usedNo.add(s.no);
      known.set(s.id, next.species.length);
      next.species.push(s);
      added.push(s.id);
    }
  }
  if (dup.length > 0) return fail(dup.map((id) => `${id}: 案の中に、同じ id が 2 つある`));
  const errors = validateBestiary(next, env, (s) => touched.has(s.id));
  if (errors.length > 0) return fail(errors);
  next.species.sort((a, b) => a.no - b.no);
  return { bestiary: next, added, updated, addedFields, updatedFields, errors: [] };
}
