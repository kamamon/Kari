// 60Hz 固定 tick。描画のフレーム時間から「今回進める tick 数」を決めるだけの小さな部品。
// 画面が非表示から戻った時などは reset() で蓄積時間を捨て、数秒分を一度に進めない。

export const TICK_RATE = 60;
export const TICK_SECONDS = 1 / TICK_RATE;

export class FixedClock {
  private acc = 0;
  /** 1 フレームで追いつく最大 tick 数。超えた分は捨てる（長い停止の後に暴走させない）。 */
  readonly maxCatchUp: number;
  droppedTicks = 0;

  constructor(maxCatchUp = 6) {
    this.maxCatchUp = maxCatchUp;
  }

  /** 経過秒を渡すと、今回実行すべき tick 数を返す。 */
  advance(dtSeconds: number): number {
    if (!(dtSeconds > 0)) return 0;
    this.acc += dtSeconds;
    let n = Math.floor(this.acc / TICK_SECONDS + 1e-9);
    if (n <= 0) return 0;
    this.acc -= n * TICK_SECONDS;
    if (this.acc < 0) this.acc = 0;
    if (n > this.maxCatchUp) {
      this.droppedTicks += n - this.maxCatchUp;
      n = this.maxCatchUp;
      this.acc = 0;
    }
    return n;
  }

  /** 次の tick までの進み具合 [0,1)。描画の補間にだけ使い、計算へは戻さない。 */
  get alpha(): number {
    return Math.min(0.999, this.acc / TICK_SECONDS);
  }

  reset(): void {
    this.acc = 0;
  }
}
