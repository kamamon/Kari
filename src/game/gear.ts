// 装備の効き目（v0.33.0。docs/spec.md の 30 章、D-114）: 防具の技能と耐性、武器の属性の係数、会心率、受ける攻撃の属性。
// 計算だけ（DOM・Three.js・時刻に触れない）。数値は public/data/elements.json と skills.json（ChatGPT の全装備四級版 #15 の rules）。
import { ARMOR_SLOTS, ELEMENT_IDS, STATUS_KINDS, type ArmorDef, type ArmorSkill, type Content, type ElementId, type MonsterDef, type MonsterPartDef, type StatusKind, type WeaponDef } from '../data/schemas';

/** 技能の Lv の上限（1 部位 1 点。同じ系列の 5 部位でも特別な上乗せは無い） */
export const SKILL_MAX_LEVEL = 3;

export interface GearEffects {
  /** 技能の Lv（1〜3）。鍵は技能の id。個別耐性は「id:属性」「id:状態異常」（違う属性・状態異常の点は合わせない） */
  levels: Map<string, number>;
  /** 属性ごとの耐性（防具の合計 + 個別属性耐性。[-30, 30] に収める）。受ける攻撃の属性の項だけに (1 - 耐性/100) を掛ける */
  resist: Record<ElementId, number>;
  /** 防御で受けた時のスタミナの消費に掛ける（1 - 受け支え） */
  guardStamina: number;
  /** 回避のスタミナの消費に掛ける（1 - 身軽） */
  dodgeStamina: number;
  /** スタミナの自然な回復に掛ける（1 + 息継ぎ。回復の始まるまでの待ちは変えない） */
  staminaRegen: number;
  /** 刃・打面の減りに掛ける（1 - 刃持ち。弓はもともと減らない） */
  edgeWear: number;
  /** 部位破壊・切断のための蓄積に掛ける（1 + 砕き。体力・怯み・気絶は変えない） */
  partDamage: number;
  /** 武器の属性の項に掛ける（1 + 属性調律） */
  element: number;
  /** 毒・麻痺・睡眠の蓄積に掛ける（1 + 状態調律。気絶は入らない） */
  status: number;
  /** 気絶の蓄積に掛ける（1 + 響打。打撃が頭に当たった時だけ） */
  stun: number;
  /** 物理の肉質が境目（weakCritHitzone）以上の部位に当てた時に、足す会心率（急所観察） */
  weakCrit: number;
  /** 整備の道具（研磨石）を使う時間に掛ける（1 - 道具整備） */
  itemTime: number;
  /** ハンターの状態異常の、発症までにためる量に掛ける（1 + 個別状態耐性） */
  statusResist: Record<StatusKind, number>;
}

/** 部位ごとに 1 つだけ数える（同じ部位が 2 つ渡されたら、防御力の高い方。同じなら先の方）。この版に無い ID は数えない。 */
export function wornPieces(content: Content, armorIds: readonly string[]): ArmorDef[] {
  const out: ArmorDef[] = [];
  for (const slot of ARMOR_SLOTS) {
    let best: ArmorDef | null = null;
    for (const id of armorIds) {
      const a = content.armor.get(id);
      if (a && a.slot === slot && (!best || a.defense > best.defense)) best = a;
    }
    if (best) out.push(best);
  }
  return out;
}

/** 技能の点を数える鍵（個別耐性は、対象ごとに別に数える） */
export function skillKey(s: Pick<ArmorSkill, 'id' | 'element' | 'status'>): string {
  return s.element ? `${s.id}:${s.element}` : s.status ? `${s.id}:${s.status}` : s.id;
}

/** 技能の点の合計 → Lv（上限 3） */
export function skillLevels(pieces: readonly ArmorDef[]): Map<string, number> {
  const pts = new Map<string, number>();
  for (const a of pieces) {
    if (!a.skill) continue;
    const k = skillKey(a.skill);
    pts.set(k, (pts.get(k) ?? 0) + a.skill.points);
  }
  const lv = new Map<string, number>();
  for (const [k, v] of pts) lv.set(k, Math.min(SKILL_MAX_LEVEL, v));
  return lv;
}

/** 技能の、いまの Lv の値（skills.json の values。Lv 0 なら 0） */
export function skillValue(content: Content, levels: ReadonlyMap<string, number>, key: string): number {
  const lv = levels.get(key) ?? 0;
  if (lv <= 0) return 0;
  const def = content.skills.get(key.split(':')[0]!);
  return def ? def.values[Math.min(SKILL_MAX_LEVEL, lv) - 1] ?? 0 : 0;
}

/** 装備の効き目。武器と、身に着けている防具から決まる（狩りの間は変わらない） */
export function computeGear(content: Content, weapon: WeaponDef, armorIds: readonly string[]): GearEffects {
  const pieces = wornPieces(content, armorIds);
  const levels = skillLevels(pieces);
  const pct = (key: string): number => skillValue(content, levels, key) / 100;
  const [lo, hi] = content.elements.resistRange;
  const resist = {} as Record<ElementId, number>;
  for (const e of ELEMENT_IDS) {
    let r = 0;
    for (const a of pieces) r += a.resist?.[e] ?? 0;
    r += skillValue(content, levels, `element_resistance:${e}`);
    resist[e] = Math.min(hi, Math.max(lo, r));
  }
  const statusResist = {} as Record<StatusKind, number>;
  for (const k of STATUS_KINDS) statusResist[k] = 1 + pct(`status_resistance:${k}`);
  const bow = content.families.get(weapon.family)?.edge === undefined;
  return {
    levels,
    resist,
    guardStamina: 1 - pct('guard_economy'),
    dodgeStamina: 1 - pct('dodge_economy'),
    staminaRegen: 1 + pct('stamina_recovery'),
    edgeWear: bow ? 1 : 1 - pct('edge_keep'),
    partDamage: 1 + pct('part_damage'),
    element: 1 + pct('element_tuning'),
    status: 1 + pct('status_tuning'),
    stun: 1 + pct('stun_tuning'),
    weakCrit: skillValue(content, levels, 'weak_crit'),
    itemTime: 1 - pct('item_efficiency'),
    statusResist,
  };
}

/** 何も着けていない時（技能・耐性なし）。テストと、装備の無い場面に */
export function noGear(content: Content, weapon: WeaponDef): GearEffects {
  return computeGear(content, weapon, []);
}

/** 部位の、その属性の係数: elementZone を、弱点なら zone.weak 倍、耐性なら zone.resist 倍 */
export function typedElementZone(content: Content, def: MonsterDef, part: MonsterPartDef, el: ElementId): number {
  const Z = content.elements.zone;
  const f = def.weak?.includes(el) ? Z.weak : def.resist?.includes(el) ? Z.resist : 1;
  return part.elementZone * f;
}

/**
 * 武器の属性の、この部位への係数。無属性は 0。
 * 複合（上級・極級）は 2 つの属性の係数の大きい方。2 つのどちらも相手の弱点でない時だけ compoundNonWeak 倍（設計 #15、docs/elements.md の 3 章）。
 */
export function weaponElementZone(content: Content, w: WeaponDef, def: MonsterDef, part: MonsterPartDef): number {
  const e = w.element;
  if (e.type === 'none' || !(e.value > 0)) return 0;
  if (e.type === 'compound') {
    const [a, b] = e.elements ?? [];
    if (!a || !b) return 0;
    const z = Math.max(typedElementZone(content, def, part, a), typedElementZone(content, def, part, b));
    const weakHit = !!def.weak?.includes(a) || !!def.weak?.includes(b);
    return weakHit ? z : z * content.elements.compoundNonWeak;
  }
  return typedElementZone(content, def, part, e.type as ElementId);
}

/** 会心率（%）: 武器の会心 + 急所観察（物理の肉質が境目以上の時）。正の側は critCap まで（負の会心は、そのまま） */
export function critChance(content: Content, w: WeaponDef, g: GearEffects, hitzone: number): number {
  const a = w.affinity + (hitzone >= content.elements.weakCritHitzone ? g.weakCrit : 0);
  return Math.min(content.elements.critCap, a);
}

/**
 * 受ける攻撃の、属性と耐性の倍率。属性を持つ種（element）の攻撃は、monsterElementShare の分が、その属性の項になる。
 * (物理 + 属性 × (1 - 耐性/100)) を、元の攻撃に対する倍率で返す（属性の無い種と、耐性 0 は 1）。
 */
export function incomingElementScale(content: Content, def: MonsterDef | null, g: GearEffects): number {
  const el = def?.element;
  if (!el) return 1;
  const s = content.elements.monsterElementShare;
  return 1 - s + s * (1 - g.resist[el] / 100);
}

/** 武器の属性の表示名（無属性は null。複合は 2 つを「・」でつなぐ） */
export function elementLabel(content: Content, w: WeaponDef): string | null {
  const e = w.element;
  if (e.type === 'none' || !(e.value > 0)) return null;
  const name = (id: string): string => content.elements.elements.find((x) => x.id === id)?.name ?? id;
  return e.type === 'compound' ? (e.elements ?? []).map(name).join('・') : name(e.type);
}
