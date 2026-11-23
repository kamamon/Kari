// 描画フレームの間隔の集計（実機の重さを報告するための数値）。
import { describe, expect, it } from 'vitest';
import { FrameMeter, describeFrames } from '../src/core/frameMeter';

describe('描画の間隔の集計', () => {
  it('平均・p95・最大・100ms 超の回数を出す', () => {
    const m = new FrameMeter(100);
    for (let i = 0; i < 94; i++) m.push(16);
    for (let i = 0; i < 5; i++) m.push(40);
    m.push(250);
    const s = m.summary();
    expect(s.samples).toBe(100);
    expect(s.avgMs).toBeCloseTo((94 * 16 + 5 * 40 + 250) / 100, 5);
    expect(s.p95Ms).toBe(40); // 小さい順の 95 番目
    expect(s.maxMs).toBe(250);
    expect(s.longFrames).toBe(1);
    expect(s.seconds).toBeCloseTo((94 * 16 + 5 * 40 + 250) / 1000, 5);
  });

  it('平均と p95 は直近の分だけ。100ms 超の回数は reset まで数え続ける', () => {
    const m = new FrameMeter(10);
    m.push(300);
    for (let i = 0; i < 10; i++) m.push(20);
    const s = m.summary();
    expect(s.samples).toBe(10);
    expect(s.maxMs).toBe(20);
    expect(s.longFrames).toBe(1);
    m.reset();
    expect(m.summary()).toMatchObject({ samples: 0, longFrames: 0, seconds: 0 });
  });

  it('おかしな値（0・負・無限大）は入れない', () => {
    const m = new FrameMeter(10);
    for (const v of [0, -5, Infinity, NaN]) m.push(v);
    expect(m.summary().samples).toBe(0);
    expect(describeFrames(m.summary())).toContain('まだ計測していません');
  });
});
