// 実行中の行動 1 回分。attackInstanceId は実行ごとに新しく発行する。
import type { ActionDef, PhaseDef } from '../data/schemas';

export interface ActionRun {
  def: ActionDef;
  instanceId: number;
  /** 次に処理する tick（0 始まり）。ヒットストップ中と溜め中は進まない。 */
  tick: number;
  hitstop: number;
  chargeTicks: number;
  chargeLevel: number;
  released: boolean;
  /** 直近の step で tick を処理したら true。ヒットストップ中と溜め中は false（描画が同じ時刻で止まるために使う）。 */
  advanced: boolean;
  /** 移動曲線を進める向き。fixedDir が true なら開始時の向きで固定（回避など）。 */
  moveYaw: number;
  fixedDir: boolean;
  /** 回避の見た目用: 0 前 / 1 左 / 2 後 / 3 右（向きに対する相対） */
  dirIndex: number;
  /** 抜刀したまま始めた道具の行動: 終わっても抜刀のまま（護刃） */
  keepDrawn: boolean;
  /** 行動の時間の倍率（1 より小さいと速い）と、その端数の積み立て。旋鎌の勢い。 */
  speed: number;
  speedAcc: number;
  /** 始めた時の勢いの段階（威力の倍率に使う）と、この行動で勢いを上げたか */
  momentumLevel: number;
  momentumGained: boolean;
}

export function newRun(def: ActionDef, instanceId: number, yaw: number): ActionRun {
  return { def, instanceId, tick: 0, hitstop: 0, chargeTicks: 0, chargeLevel: 0, released: false, advanced: false, moveYaw: yaw, fixedDir: false, dirIndex: 0, keepDrawn: false, speed: 1, speedAcc: 0, momentumLevel: 0, momentumGained: false };
}

export function phaseAt(def: ActionDef, tick: number): PhaseDef | null {
  for (const p of def.phases) if (tick >= p.from && tick < p.to) return p;
  return null;
}

export const inWindow = (tick: number, w: { from: number; to: number }): boolean => tick >= w.from && tick < w.to;

/** 描画用の行動時刻（小数 tick）。alpha は次の tick までの進み具合。計算には使わない。 */
export function renderTick(run: ActionRun, alpha: number): number {
  return run.advanced ? run.tick - 1 + alpha : run.tick;
}
