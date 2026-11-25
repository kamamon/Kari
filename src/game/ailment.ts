// モンスターの状態異常（v0.33.0。docs/spec.md の 30.4、D-114）: 毒・麻痺・睡眠・気絶をためて、効かせる。
// ためる量は 1000 を 1 とする整数で持つ（小数の誤差で、発症する命中が変わらないように）。決まりは public/data/elements.json の ailment
// （ChatGPT の全装備四級版 #15 の rules.statuses）。計算だけ（DOM・Three.js・時刻に触れない）。
import { STATUS_KINDS, type Content, type MonsterAilmentRules, type StatusKind } from '../data/schemas';

/** 1 を表す整数の単位 */
export const AILMENT_UNIT = 1000;

export interface MonsterAilments {
  /** ためた量（AILMENT_UNIT で 1） */
  gauge: Record<StatusKind, number>;
  /** 発症した回数（回数ごとに、次の発症までの量が伸びる） */
  count: Record<StatusKind, number>;
  /** 最後にためてからの tick（decayDelayTicks を過ぎると、1 秒ごとに減る） */
  idle: Record<StatusKind, number>;
  /** 効いている残りの tick（0 は効いていない） */
  ticks: Record<StatusKind, number>;
  /** 毒: この回の総量（最大体力 × hpRatio を切り捨て）と、済んだ回数 */
  poisonTotal: number;
  poisonDone: number;
  /** 硬直（麻痺・睡眠・気絶）が終わった後の猶予の残り。この間は、ほかの硬直は発症の 1 手前までしかたまらない */
  grace: number;
}

const zeros = (): Record<StatusKind, number> => ({ poison: 0, para: 0, sleep: 0, stun: 0 });

export function freshAilments(): MonsterAilments {
  return { gauge: zeros(), count: zeros(), idle: zeros(), ticks: zeros(), poisonTotal: 0, poisonDone: 0, grace: 0 };
}

/** 動けなくなる状態異常（麻痺・睡眠・気絶）。毒は別（重なってよい） */
export const isControl = (k: StatusKind): boolean => k !== 'poison';

/** いま効いている硬直（麻痺・睡眠・気絶）。無ければ null */
export function activeControl(a: MonsterAilments): StatusKind | null {
  for (const k of STATUS_KINDS) if (isControl(k) && a.ticks[k] > 0) return k;
  return null;
}

/** 発症までにためる量（AILMENT_UNIT 単位）。n 回発症した後は ceil(threshold × growth^n)。気絶は stunGrowth */
export function ailmentThreshold(R: MonsterAilmentRules, kind: StatusKind, n: number): number {
  const g = kind === 'stun' ? R.stunGrowth : R.growth;
  return Math.ceil(R.threshold * Math.pow(g, n) - 1e-9) * AILMENT_UNIT;
}

/** 効き目の長さ（tick） */
function duration(R: MonsterAilmentRules, kind: StatusKind): number {
  return kind === 'poison' ? R.poison.ticks : kind === 'para' ? R.para.ticks : kind === 'sleep' ? R.sleep.ticks : R.stun.ticks;
}

/** 毒の k 回目（1 から）の量: 総量を hits 回へ、商と余りで分ける（先の回へ 1 ずつ。総量は変わらない） */
export function poisonHitDamage(total: number, hits: number, k: number): number {
  const q = Math.floor(total / hits);
  const r = total - q * hits;
  return q + (k <= r ? 1 : 0);
}

export type AilmentResult = 'none' | 'stored' | 'capped' | 'triggered';

/**
 * ためる。amount は AILMENT_UNIT 単位の整数（0 以下は何もしない）。
 * - 同じ状態が効いている間は、ためない
 * - 硬直（麻痺・睡眠・気絶）は、ほかの硬直が効いている間と、その後の猶予の間は、発症の 1 手前（閾値 - 1）までしかたまらない
 *   （猶予が終わっただけでは発症しない。次にためた時に発症する）
 * - 閾値に届いたら発症。ためた量は 0 へ戻る（超えた分は捨てる）
 */
export function addAilment(a: MonsterAilments, R: MonsterAilmentRules, kind: StatusKind, amount: number): AilmentResult {
  if (!(amount > 0) || a.ticks[kind] > 0) return 'none';
  const thr = ailmentThreshold(R, kind, a.count[kind]);
  a.idle[kind] = 0;
  const g = a.gauge[kind] + Math.floor(amount);
  if (isControl(kind) && (activeControl(a) !== null || a.grace > 0)) {
    a.gauge[kind] = Math.min(g, thr - 1);
    return g >= thr ? 'capped' : 'stored';
  }
  if (g < thr) {
    a.gauge[kind] = g;
    return 'stored';
  }
  a.gauge[kind] = 0;
  a.count[kind]++;
  a.ticks[kind] = duration(R, kind);
  return 'triggered';
}

/** 毒の始まり: 総量を決める（最大体力 × hpRatio を切り捨て） */
export function startPoison(a: MonsterAilments, R: MonsterAilmentRules, maxHp: number): void {
  a.poisonTotal = Math.floor(maxHp * R.poison.hpRatio + 1e-9);
  a.poisonDone = 0;
}

export interface AilmentTick {
  /** この tick の毒のダメージ（無ければ 0） */
  poison: number;
  /** この tick に終わった状態異常 */
  ended: StatusKind[];
}

/** 毎 tick（モンスターが止まっていない時）: 効き目の残り、毒、猶予、ためた量の減り */
export function stepAilments(a: MonsterAilments, R: MonsterAilmentRules): AilmentTick {
  const out: AilmentTick = { poison: 0, ended: [] };
  // 硬直が終わった後の猶予（硬直の間は減らない）
  if (a.grace > 0 && activeControl(a) === null) a.grace--;
  for (const k of STATUS_KINDS) {
    if (a.ticks[k] > 0) {
      a.ticks[k]--;
      if (k === 'poison') {
        const interval = Math.max(1, Math.floor(R.poison.ticks / R.poison.hits));
        const elapsed = R.poison.ticks - a.ticks[k];
        if (elapsed % interval === 0 && a.poisonDone < R.poison.hits) {
          a.poisonDone++;
          out.poison += poisonHitDamage(a.poisonTotal, R.poison.hits, a.poisonDone);
        }
      }
      if (a.ticks[k] === 0) {
        out.ended.push(k);
        if (isControl(k)) a.grace = R.lockGraceTicks;
      }
      continue;
    }
    // ためた量は、最後にためてから decayDelayTicks の後、1 秒ごとに decayPerSec ずつ減る
    if (a.gauge[k] > 0) {
      a.idle[k]++;
      const over = a.idle[k] - R.decayDelayTicks;
      if (over > 0 && over % 60 === 0) a.gauge[k] = Math.max(0, a.gauge[k] - Math.round(R.decayPerSec * AILMENT_UNIT));
    }
  }
  return out;
}

/** 眠りを覚ます（物理の命中）。眠っていたら、効き目を終えて猶予を始め、true */
export function wakeFromSleep(a: MonsterAilments, R: MonsterAilmentRules): boolean {
  if (a.ticks.sleep <= 0) return false;
  a.ticks.sleep = 0;
  a.grace = R.lockGraceTicks;
  return true;
}

/** 倒れた・捕獲された: 効き目を止める（ためた量と回数は残すが、もう使わない） */
export function clearAilments(a: MonsterAilments): void {
  for (const k of STATUS_KINDS) a.ticks[k] = 0;
  a.grace = 0;
}

/** 状態異常の表示名 */
export const AILMENT_NAMES: Record<StatusKind, string> = { poison: '毒', para: '麻痺', sleep: '睡眠', stun: '気絶' };

/** ためる量（AILMENT_UNIT 単位）: 基礎の量 × 命中の係数 × 技能。切り捨て */
export function ailmentAmount(base: number, motion: number, scale: number): number {
  return Math.floor(base * motion * scale * AILMENT_UNIT + 1e-6);
}

/** 決まり（content の elements.ailment） */
export const ailmentRules = (c: Content): MonsterAilmentRules => c.elements.ailment;
