// 入力列の再生。「同じ seed・tick 付き入力を 30/60fps で再生し、同じ tick の結果が一致するか」を確かめる。
import { FixedClock } from '../core/clock';
import type { Content } from '../data/schemas';
import { EMPTY_INPUT, type InputFrame } from './inputFrame';
import { Simulation, fnv1a, type SimOptions } from './sim';

export interface ReplayResult {
  ticks: number;
  renderFrames: number;
  /** tick ごとの状態指紋 */
  perTick: number[];
  finalHash: string;
  hitCount: number;
  totalDamage: number;
  playerHp: number;
  damageTaken: number;
}

/**
 * frames[i] を i 番目の tick の入力として再生する。
 * frameSeconds は「描画 1 フレームの長さ」を返す関数。描画の間隔が変わっても tick の結果は変わらないはず。
 */
export function runReplay(content: Content, options: SimOptions, frames: readonly InputFrame[], frameSeconds: (frame: number) => number): ReplayResult {
  const sim = new Simulation(content, options);
  const clock = new FixedClock(1000);
  const perTick: number[] = [];
  let i = 0;
  let renderFrames = 0;
  while (i < frames.length) {
    const n = clock.advance(frameSeconds(renderFrames));
    renderFrames++;
    for (let k = 0; k < n && i < frames.length; k++) {
      sim.step(frames[i] ?? EMPTY_INPUT);
      i++;
      perTick.push(fnv1a(sim.hash()));
    }
    if (renderFrames > frames.length * 8 + 1000) throw new Error('replay が進まない');
  }
  return {
    ticks: sim.tick,
    renderFrames,
    perTick,
    finalHash: sim.hash(),
    hitCount: sim.hitCount,
    totalDamage: sim.totalDamage,
    playerHp: sim.player.hp,
    damageTaken: sim.damageTaken,
  };
}

/** 2 つの再生結果を比べ、最初に食い違った tick を返す（一致なら -1）。 */
export function firstMismatch(a: ReplayResult, b: ReplayResult): number {
  const n = Math.max(a.perTick.length, b.perTick.length);
  for (let i = 0; i < n; i++) if (a.perTick[i] !== b.perTick[i]) return i + 1;
  return a.finalHash === b.finalHash ? -1 : n;
}
