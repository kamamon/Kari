// 被弾の動きの形（v0.64.0。D-150・D-160）: 2G を手本にした形（いまの組）と、保留の組 v056（v0.63.0 までの形）の入れ替え。
// 描画だけの形なので、当たり・時間は simulation のまま（ここでは形の向きと段階だけを確かめる）。
import { afterEach, describe, expect, it } from 'vitest';
import { HURT_STYLE, hurtPose } from '../src/render/poses';
import { CURRENT_MOTION_SET, useMotionSet } from '../src/render/motionSet';

afterEach(async () => {
  await useMotionSet(CURRENT_MOTION_SET);
});

describe('被弾の形（v0.64.0）', () => {
  it('怯み: 上体は押された向きへ持っていかれる（後ろへ押されるとのけぞり、前へ押されると前へ曲がり、左右は逆に傾く）', () => {
    expect(HURT_STYLE.style).toBe('2g');
    const at = (rel: number) => hurtPose('flinch', 9, 30, true, rel).j.spine;
    expect(at(Math.PI)[0]).toBeLessThan(-12);
    expect(at(0)[0]).toBeGreaterThan(12);
    const left = at(Math.PI / 2), right = at(-Math.PI / 2);
    expect(Math.sign(left[2])).toBe(-Math.sign(right[2]));
    expect(Math.abs(left[2])).toBeGreaterThan(8);
    // 終わりは構えへ戻る
    const end = hurtPose('flinch', 30, 30, true, Math.PI);
    expect(Math.abs(end.j.spine[0] - 5)).toBeLessThan(1e-6);
  });

  it('転倒: 宙へ浮いてから背で落ち、倒れたまま、片ひざを突いて立つ。弾かれは腕を上へ跳ね上げられる', () => {
    const kd = (t: number) => hurtPose('knockdown', t, 84, true);
    expect(kd(8).drop).toBeGreaterThan(0.05);
    expect(kd(8).tumble).toBeLessThan(-20);
    expect(kd(30).tumble).toBe(-90);
    expect(kd(30).drop).toBeCloseTo(-0.43, 5);
    expect(kd(64).tumble).toBe(0);
    expect(kd(64).j.shinR[0]).toBeGreaterThan(90);
    const b = hurtPose('bounce', 6, 26, true);
    expect(b.j.upperArmL[0]).toBeLessThan(-90);
    expect(b.j.spine[0]).toBeLessThan(-12);
  });

  it('保留の組 v056 は、v0.63.0 までの形のまま（怯みは押された向きによらず同じ。転倒は宙へ浮かない）', async () => {
    await useMotionSet('v056');
    expect(HURT_STYLE.style).toBe('v056');
    const a = hurtPose('flinch', 9, 30, true, 0), b = hurtPose('flinch', 9, 30, true, Math.PI);
    expect(a).toEqual(b);
    expect(a.j.spine[0]).toBeLessThan(0);
    for (let t = 0; t <= 84; t += 2) expect(hurtPose('knockdown', t, 84, true).drop).toBeLessThanOrEqual(0);
    await useMotionSet(CURRENT_MOTION_SET);
    expect(HURT_STYLE.style).toBe('2g');
  });
});
