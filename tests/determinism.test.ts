import { beforeAll, describe, expect, it } from 'vitest';
import { FixedClock } from '../src/core/clock';
import { SeededRng } from '../src/core/seededRng';
import type { Content } from '../src/data/schemas';
import type { InputFrame } from '../src/game/inputFrame';
import { firstMismatch, runReplay } from '../src/game/replay';
import { Btn, baseOptions, frame, loadContent } from './helpers';

let content: Content;
beforeAll(async () => {
  content = await loadContent();
});

/**
 * tick 付きの入力列。標的の南側から近づき、正面に居続けて
 * 抜刀斬り・縦斬り・溜め・横薙ぎ・回避・防御をひと通り行う。標的の攻撃も受ける。
 */
function script(): InputFrame[] {
  const frames: InputFrame[] = [];
  const N = 2400;
  let held = 0;
  for (let i = 0; i < N; i++) {
    const f = frame();
    const c = i % 97;
    const cycle = Math.floor(i / 97);
    if (i < 260 || c >= 80) f.moveZ = 1; // 標的へ向かう（吹き飛ばされても戻る）
    let next = held;
    if (i < 200) next |= Btn.Sprint;
    else next &= ~Btn.Sprint;
    if (i >= 260 && c === 0) next |= Btn.Main;
    if (c === (cycle % 3 === 0 ? 55 : 3)) next &= ~Btn.Main; // 3 回に 1 回は長押し = 溜め
    if (i >= 260 && i % 131 === 5) next |= Btn.Sub;
    if (i % 131 === 9) next &= ~Btn.Sub;
    if (i >= 260 && i % 173 === 20) next |= Btn.Dodge;
    if (i % 173 === 23) next &= ~Btn.Dodge;
    if (i >= 1200 && i % 400 < 120) next |= Btn.Special;
    else next &= ~Btn.Special;
    f.pressed = next & ~held;
    f.released = held & ~next;
    f.held = next;
    held = next;
    frames.push(f);
  }
  return frames;
}

describe('固定 tick の一致（設計書 p.33「時間」）', () => {
  it('同じ seed と tick 付き入力は、描画 30/60/144fps・不規則な間隔でも同じ結果になる', () => {
    const frames = script();
    const opts = baseOptions({ monsterAttacks: true });
    const r60 = runReplay(content, opts, frames, () => 1 / 60);
    const r30 = runReplay(content, opts, frames, () => 1 / 30);
    const r144 = runReplay(content, opts, frames, () => 1 / 144);
    const jitter = new SeededRng(99);
    const rJ = runReplay(content, opts, frames, () => 0.006 + jitter.next() * 0.04);

    expect(r60.ticks).toBe(frames.length);
    expect(r30.renderFrames).toBeLessThan(r60.renderFrames);
    expect(firstMismatch(r60, r30)).toBe(-1);
    expect(firstMismatch(r60, r144)).toBe(-1);
    expect(firstMismatch(r60, rJ)).toBe(-1);
    expect(r30.finalHash).toBe(r60.finalHash);

    // 入力列が意味のある戦闘になっていること（命中も被弾も起きている）
    expect(r60.hitCount).toBeGreaterThan(3);
    expect(r60.totalDamage).toBeGreaterThan(100);
    expect(r60.damageTaken).toBeGreaterThan(0);
  });

  it('seed が違えば食い違いを検出できる（比較が効いていることの確認）', () => {
    const frames = script();
    const a = runReplay(content, baseOptions({ monsterAttacks: true, seed: 1 }), frames, () => 1 / 60);
    const b = runReplay(content, baseOptions({ monsterAttacks: true, seed: 2 }), frames, () => 1 / 60);
    expect(firstMismatch(a, b)).toBeGreaterThan(0);
  });
});

describe('FixedClock', () => {
  it('1/60 秒で 1 tick、1/30 秒で 2 tick', () => {
    const c = new FixedClock();
    expect(c.advance(1 / 60)).toBe(1);
    expect(c.advance(1 / 30)).toBe(2);
  });
  it('端数は持ち越す', () => {
    const c = new FixedClock();
    let n = 0;
    for (let i = 0; i < 144; i++) n += c.advance(1 / 144);
    expect(n).toBe(60);
  });
  it('長い停止の後は上限までしか進めず、reset で蓄積を捨てる', () => {
    const c = new FixedClock(6);
    expect(c.advance(3)).toBe(6);
    expect(c.droppedTicks).toBe(174);
    c.advance(0.01);
    c.reset();
    expect(c.alpha).toBe(0);
    expect(c.advance(1 / 60)).toBe(1);
  });
});
