// ダメージ計算と命中判定。式・係数はすべて本作独自（設計書 p.10 の初期案）。
import { add, distPointSeg, distSegSeg, lerpV, scale, sub, dot, clamp, toWorld, fromArr, type V3 } from '../core/math';
import type { EdgeRules, EdgeStageDef, HurtShapeDef } from '../data/schemas';

/** 刃の状態の値から、いまの段階を求める（段階は鋭い順に並んでいる）。 */
export function edgeStage(rules: EdgeRules, value: number): EdgeStageDef {
  for (const s of rules.stages) if (value >= s.min) return s;
  return rules.stages[rules.stages.length - 1]!;
}

export interface DamageInput {
  attack: number;
  motion: number;
  sharpness: number;
  hitzone: number;
  crit: number;
  element: number;
  elementMotion: number;
  elementZone: number;
  questModifier: number;
}

/**
 * 物理 = 基礎攻撃力 × 技倍率 × 刃補正 × 物理部位係数 × 会心補正
 * 属性 = 属性値 × 技属性倍率 × 属性部位係数
 * ダメージ = floor((物理 + 属性) × クエスト補正)。完全無効は 0、有効な攻撃の下限は 1。
 */
export function computeDamage(d: DamageInput): number {
  const physical = d.attack * d.motion * d.sharpness * d.hitzone * d.crit;
  const elemental = d.element * d.elementMotion * d.elementZone;
  if (physical <= 0 && elemental <= 0) return 0;
  return Math.max(1, Math.floor((physical + elemental) * d.questModifier + 1e-9));
}

export interface WorldShape {
  partIndex: number;
  a: V3;
  b: V3 | null;
  r: number;
}

export function shapeToWorld(s: HurtShapeDef, partIndex: number, pos: V3, yaw: number): WorldShape {
  return { partIndex, a: toWorld(fromArr(s.a), pos, yaw), b: s.b ? toWorld(fromArr(s.b), pos, yaw) : null, r: s.r };
}

export interface SweepHit {
  partIndex: number;
  point: V3;
}

function closestOnSeg(p: V3, a: V3, b: V3): V3 {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 > 1e-12 ? clamp(dot(sub(p, a), ab) / l2, 0, 1) : 0;
  return add(a, scale(ab, t));
}

/**
 * 武器の芯（線分）を前 tick の位置 (a0,b0) から現在位置 (a1,b1) まで掃引し、最初に触れた形状を返す。
 * 移動量に応じて細分化するので、速い刃が 1 tick の間に標的を飛び越えない。
 * 同じ細分ステップで複数に触れた場合は shapes の並び順（= 部位の固定優先順）で決める。
 */
export function sweepCapsule(a0: V3, b0: V3, a1: V3, b1: V3, radius: number, shapes: readonly WorldShape[]): SweepHit | null {
  const travel = Math.max(distPointSeg(a1, a0, a0), distPointSeg(b1, b0, b0));
  const steps = clamp(Math.ceil(travel / Math.max(0.05, radius * 0.5)), 1, 16);
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const a = lerpV(a0, a1, u);
    const b = lerpV(b0, b1, u);
    for (const s of shapes) {
      const d = s.b ? distSegSeg(a, b, s.a, s.b) : distPointSeg(s.a, a, b);
      if (d <= radius + s.r) {
        const center = s.b ? lerpV(s.a, s.b, 0.5) : s.a;
        const onBlade = closestOnSeg(center, a, b);
        return { partIndex: s.partIndex, point: lerpV(onBlade, center, 0.5) };
      }
    }
  }
  return null;
}

/** 命中台帳。キーは attackInstanceId + hitWindow.id + targetEntityId。単発技の多重ヒットを防ぐ。 */
export class HitLedger {
  private byInstance = new Map<number, Map<string, number>>();

  count(instanceId: number, windowId: string, targetId: string): number {
    return this.byInstance.get(instanceId)?.get(`${windowId}|${targetId}`) ?? 0;
  }

  record(instanceId: number, windowId: string, targetId: string): void {
    let m = this.byInstance.get(instanceId);
    if (!m) {
      m = new Map();
      this.byInstance.set(instanceId, m);
    }
    const k = `${windowId}|${targetId}`;
    m.set(k, (m.get(k) ?? 0) + 1);
  }

  /** 実行が終わった行動の記録を捨てる。 */
  prune(active: ReadonlySet<number>): void {
    for (const id of this.byInstance.keys()) if (!active.has(id)) this.byInstance.delete(id);
  }
}
