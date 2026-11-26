import {armorPoints,socketCapacity} from '../game/classicGear';
// 装備の性能の短い説明（v0.33.0）: 装備箱と工房で使う。属性・状態異常・防具の技能と耐性（docs/spec.md の 30 章）。
import { ELEMENT_IDS, type ArmorDef, type ArmorSkill, type Content, type ElementId, type WeaponDef } from '../data/schemas';
import { AILMENT_NAMES } from '../game/ailment';
import { weaponEdgeRules } from '../game/weaponEdge';
import { elementLabel, skillValue, type GearEffects } from '../game/gear';

const elementName = (c: Content, id: ElementId): string => c.elements.elements.find((e) => e.id === id)?.name ?? id;
const signed = (v: number): string => (v > 0 ? `+${v}` : `${v}`);

/** 武器の性能: 「攻撃力 85・風 26」「攻撃力 86・毒 9.2」「攻撃力 81・会心 25%」 */
export function weaponStat(c: Content, w: WeaponDef): string {
  const parts = [`攻撃力 ${w.attack}`];
  if(c.families.get(w.family)?.edge){const e=weaponEdgeRules(c,w.id);parts.push(`刃 ${Math.round(e.max-e.stages[0]!.min)}/${e.max}`);}
  const el = elementLabel(c, w);
  if (el) parts.push(`${el} ${w.element.value}`);
  if (w.status) parts.push(`${AILMENT_NAMES[w.status.kind]} ${w.status.potency}`);
  if (w.affinity) parts.push(`会心 ${w.affinity}%`);
  const shots = shotsText(c, w);
  if (shots) parts.push(`射ち方 ${shots}`);
  return parts.join('・');
}

const SHOT_NAMES = { rapid: '連射', spread: '拡散', pierce: '貫通' } as const;

/** 環弓の溜めの段階ごとの射ち方（v0.60.0）: 「連射1→拡散3→拡散3→拡散5」。射ち方の無い武器は空 */
export function shotsText(c: Content, w: WeaponDef): string {
  const shots = w.shots ?? c.families.get(w.family)?.shots;
  return shots ? shots.map((s) => `${SHOT_NAMES[s.type]}${s.n}`).join('→') : '';
}

/** 武器の、系列を表す短い名前: 「帆角の断岳剣【初級】」→「帆角【初級】」、「岩殻の断岳剣」→「岩殻」 */
export function weaponShortName(c: Content, w: WeaponDef): string {
  const fam = c.families.get(w.family)?.name ?? '';
  return fam ? w.name.replace(`の${fam}`, '') : w.name;
}

/** 技能の名前（個別耐性は、対象つき）: 「受け支え」「個別属性耐性（水）」 */
export function skillName(c: Content, sk: Pick<ArmorSkill, 'id' | 'element' | 'status'>): string {
  const name = c.skills.get(sk.id)?.name ?? sk.id;
  if (sk.element) return `${name}（${elementName(c, sk.element)}）`;
  if (sk.status) return `${name}（${AILMENT_NAMES[sk.status]}）`;
  return name;
}

/** 防具の耐性: 「火 -2 雷 +3」（無ければ空） */
export function resistText(c: Content, r: Partial<Record<ElementId, number>> | undefined): string {
  return ELEMENT_IDS.filter((e) => (r?.[e] ?? 0) !== 0).map((e) => `${elementName(c, e)} ${signed(r![e]!)}`).join(' ');
}

/** 防具の性能: 「防御 6・受け支え・火 -2 雷 +3」 */
export function armorStat(c: Content, a: ArmorDef, label = '防御'): string {
  const parts = [`${label} ${a.defense}`];
  const points=armorPoints(c,a);if(points.length)parts.push(points.map(p=>skillName(c,p)+' '+signed(p.points)).join(' / '));
  const sockets=socketCapacity(c,a.id);if(sockets)parts.push('空き枠 '+sockets);
  const r = resistText(c, a.resist);
  if (r) parts.push(r);
  return parts.join('・');
}

/** 技能の効き目の短い書き方（何が・どちら向きに。v0.33.0） */
const SKILL_EFFECT: Record<string, [string, '+' | '-', string]> = {
  guard_economy: ['防御のスタミナ', '-', '%'],
  edge_keep: ['刃の減り', '-', '%'],
  dodge_economy: ['回避のスタミナ', '-', '%'],
  stamina_recovery: ['スタミナの回復', '+', '%'],
  part_damage: ['部位の蓄積', '+', '%'],
  element_tuning: ['属性', '+', '%'],
  status_tuning: ['毒・麻痺・睡眠の蓄積', '+', '%'],
  weak_crit: ['急所の会心', '+', '%'],
  stun_tuning: ['気絶の蓄積', '+', '%'],
  item_efficiency: ['研ぐ時間', '-', '%'],
  status_resistance: ['発症まで', '+', '%'],
  element_resistance: ['耐性', '+', ''],
};

/** 身に着けている装備の技能と耐性のまとめ: 「受け支え Lv3（防御のスタミナ -20%）・刃持ち Lv2（刃の減り -9%）」「火 -10・雷 +15」 */
export function gearSummary(c: Content, g: GearEffects): { skills: string; resist: string } {
  const skills = [...g.levels.entries()]
    .map(([key, lv]) => {
      const [id, target] = key.split(':') as [string, string | undefined];
      const sk: Pick<ArmorSkill, 'id' | 'element' | 'status'> = { id };
      if (id === 'element_resistance' && target) sk.element = target as ElementId;
      if (id === 'status_resistance' && target) sk.status = target as ArmorSkill['status'];
      const v = skillValue(c, g.levels, key);
      const [what, sign, unit] = SKILL_EFFECT[id] ?? [c.skills.get(id)?.effect ?? '', '+', c.skills.get(id)?.unit ?? ''];
      const value=sign==='-'?-v:v;return `${skillName(c, sk)} ${lv<0?'悪化':'Lv'+lv}（${what} ${signed(value)}${unit}）`;
    })
    .join('・');
  const resist = ELEMENT_IDS.filter((e) => g.resist[e] !== 0).map((e) => `${elementName(c, e)} ${signed(g.resist[e])}`).join('・');
  const points=g.points?[...g.points].map(([k,n])=>`${c.skills.get(k.split(':')[0]!)?.name??k}${k.includes(':')?'('+k.split(':')[1]+')':''} ${signed(n)}`).join(' / '):'';
  return { skills: [skills,points?'技能点: '+points:''].filter(Boolean).join('｜'), resist };
}
