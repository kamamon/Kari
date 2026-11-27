// 段階（初級・中級・上級・極級）による個体の強さと、防具による軽減。計算だけ。
// 個体の強さは「元の定義へ倍率を掛けた定義」を作って渡す。モンスターの処理（monster.ts）は、段階を知らないまま動く。
import { ARMOR_SLOTS, type Content, type MonsterDef, type RankDef } from '../data/schemas';

/**
 * その段階の個体の定義。体力・怒りの必要量・部位の耐久・怯みと切断の必要量・技と技の間隔を、段階の倍率で変える。
 * 倍率がすべて 1 なら、元の定義をそのまま返す（初級は v0.8.0 までと 1 tick も変わらない）。
 * 与えるダメージ（attackScale）は定義ではなく、simulation が当てる時に掛ける。
 */
export function scaleMonsterDef(def: MonsterDef, rank: RankDef): MonsterDef {
  const s = rank.monster;
  if (s.hpScale === 1 && s.partScale === 1 && s.cooldownScale === 1) return def;
  const part = (v: number): number => Math.max(1, Math.round(v * s.partScale));
  const [lo, hi] = def.ai.cooldownTicks;
  const cool = (v: number): number => Math.max(1, Math.round(v * s.cooldownScale));
  return {
    ...def,
    ...(def.id === 'monster.spinegale' ? { spinegaleRank: rank.order, moveSpeed: [2.8, 3.0, 3.2][Math.min(2,rank.order-1)]! } : {}),
    hp: def.id === 'monster.spinegale' ? [1450, 3200, 5800][Math.min(2,rank.order-1)]! : Math.max(1, Math.round(def.hp * s.hpScale)),
    rage: def.rage ? { ...def.rage, threshold: Math.max(1, Math.round(def.rage.threshold * s.hpScale)) } : def.rage,
    parts: def.parts.map((p) => ({
      ...p,
      breakDurability: p.breakDurability === null ? null : part(p.breakDurability),
      flinch: p.flinch ? { ...p.flinch, threshold: part(p.flinch.threshold), growth: part(p.flinch.growth) } : p.flinch,
      sever: p.sever ? { ...p.sever, threshold: part(p.sever.threshold) } : p.sever,
    })),
    ai: { ...def.ai, cooldownTicks: [cool(lo), Math.max(cool(lo), cool(hi))] },
  };
}

/** 防御力の合計。部位ごとに 1 つだけ数える（同じ部位が 2 つ渡されたら、高い方）。この版に無い ID は数えない。 */
export function totalDefense(content: Content, armorIds: readonly string[]): number {
  let total = 0;
  for (const slot of ARMOR_SLOTS) {
    let best = 0;
    for (const id of armorIds) {
      const a = content.armor.get(id);
      if (a && a.slot === slot && a.defense > best) best = a.defense;
    }
    total += best;
  }
  return total;
}

/** 受けるダメージへ掛ける倍率: base / (base + 防御力)。防御力 0 なら 1。 */
export function defenseScale(content: Content, defense: number): number {
  const base = content.armorRules.base;
  return base / (base + Math.max(0, defense));
}
