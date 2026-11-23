// 描画フレームの間隔（requestAnimationFrame が呼ばれた間隔）を記録する小さな部品。
// 実機の重さを数値で報告するためのもの。戦闘の計算には使わない（計算は 60Hz 固定）。
// 注意: これは「フレームとフレームの間の時間」で、GPU の処理時間そのものではない。

export interface FrameSummary {
  /** 集計に使ったフレーム数（直近の分だけ） */
  samples: number;
  /** 直近の平均の間隔 (ms) */
  avgMs: number;
  /** 直近の 95% のフレームがこの間隔以下 (ms) */
  p95Ms: number;
  /** 直近の最大の間隔 (ms) */
  maxMs: number;
  /** reset() してから、間隔が 100ms を超えた回数（止まって見えるフレーム） */
  longFrames: number;
  /** reset() してから計測した時間（秒）。止まっていた時間は含めない */
  seconds: number;
}

export const LONG_FRAME_MS = 100;

export class FrameMeter {
  private readonly buf: Float32Array;
  private count = 0;
  private next = 0;
  private longFrames = 0;
  private totalMs = 0;

  /** size: 直近の何フレームで平均と p95 を出すか（既定 900 = 60fps で約 15 秒）。 */
  constructor(size = 900) {
    this.buf = new Float32Array(Math.max(1, size));
  }

  push(intervalMs: number): void {
    if (!(intervalMs > 0) || !Number.isFinite(intervalMs)) return;
    this.buf[this.next] = intervalMs;
    this.next = (this.next + 1) % this.buf.length;
    if (this.count < this.buf.length) this.count++;
    if (intervalMs > LONG_FRAME_MS) this.longFrames++;
    this.totalMs += intervalMs;
  }

  reset(): void {
    this.count = 0;
    this.next = 0;
    this.longFrames = 0;
    this.totalMs = 0;
  }

  summary(): FrameSummary {
    const n = this.count;
    if (n === 0) return { samples: 0, avgMs: 0, p95Ms: 0, maxMs: 0, longFrames: this.longFrames, seconds: 0 };
    const sorted = Array.from(this.buf.subarray(0, n)).sort((a, b) => a - b);
    let sum = 0;
    for (const v of sorted) sum += v;
    // 95% 点: 小さい順に並べて、95% の位置にある値（端数は切り上げ）
    const p95 = sorted[Math.min(n - 1, Math.ceil(n * 0.95) - 1)]!;
    return { samples: n, avgMs: sum / n, p95Ms: p95, maxMs: sorted[n - 1]!, longFrames: this.longFrames, seconds: this.totalMs / 1000 };
  }
}

/** 報告用の 1 行。 */
export function describeFrames(s: FrameSummary): string {
  if (s.samples === 0) return '描画の間隔: まだ計測していません（狩場で少し動かしてから開いてください）';
  return `描画の間隔: 平均 ${s.avgMs.toFixed(1)}ms / p95 ${s.p95Ms.toFixed(1)}ms / 最大 ${s.maxMs.toFixed(0)}ms / 100ms 超 ${s.longFrames} 回（計測 ${s.seconds.toFixed(0)} 秒）`;
}
