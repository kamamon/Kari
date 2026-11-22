// seed 付き乱数（mulberry32）。戦闘判定では Math.random を使わず、これだけを使う。
// state は 32bit 整数 1 個なので、リプレイやセーブへそのまま記録できる。

export class SeededRng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  get state(): number {
    return this.s;
  }

  set state(v: number) {
    this.s = v >>> 0;
  }

  /** [0, 1) */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }

  /** 0 以上 n 未満の整数 */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
}
