// 道具と剥ぎ取りの動き（v0.64.0。D-150・D-161）: 2G を手本に段に分けた形（投げる・罠・剥ぎ取り）。描画だけで、時間と効き目の tick は同じ。
// 保留の組 v056 は、前の形のまま。
import { afterEach, describe, expect, it } from 'vitest';
import { CLIPS, clipPose } from '../src/render/poses';
import { CURRENT_MOTION_SET, useMotionSet } from '../src/render/motionSet';
import * as HELD from '../src/render/motionsets/v056';

afterEach(async () => {
  await useMotionSet(CURRENT_MOTION_SET);
});

const at = (clip: string, t: number) => clipPose(clip, t)!;

describe('道具と剥ぎ取りの動き（v0.64.0）', () => {
  it('投げる玉: 右腕を頭の後ろへ引いて構え、左足を踏み込みながら上から投げ（22 tick で手を離れる）、振り抜く', () => {
    expect(at('common_item_throw_01', 13).j.upperArmR[0]).toBeLessThan(-140);
    expect(at('common_item_throw_01', 13).j.upperArmL[0]).toBeLessThan(-60);
    expect(at('common_item_throw_01', 22).j.upperArmR[0]).toBeGreaterThan(-80);
    expect(at('common_item_throw_01', 22).j.thighL[0]).toBeLessThan(-25);
    expect(CLIPS.common_item_throw_01!.keys.at(-1)!.t).toBe(46);
  });

  it('罠: 片ひざを突いて地面へ下ろし、両手で 2 回押し込み（56・76 が最も低い）、84 tick で手を離して立つ', () => {
    const py = (t: number) => at('common_item_place_01', t).py;
    expect(py(56)).toBeLessThan(py(66));
    expect(py(76)).toBeLessThan(py(66));
    expect(py(56)).toBeLessThan(-0.45);
    expect(at('common_item_place_01', 84).j.forearmR[0]).toBeLessThan(-40);
    expect(CLIPS.common_item_place_01!.keys.at(-1)!.t).toBe(112);
  });

  it('剥ぎ取り: 小刀を突き入れて（30・50）手前へ引く（40・60）を 2 回、左手で素材をつかんで胸の前へ持ち上げる（80）', () => {
    const arm = (t: number) => at('common_carve_01', t).j.upperArmR[0];
    expect(arm(30)).toBeLessThan(arm(40) - 30);
    expect(arm(50)).toBeLessThan(arm(60) - 30);
    expect(at('common_carve_01', 80).j.upperArmL[0]).toBeLessThan(-70);
    expect(at('common_carve_01', 80).j.forearmL[0]).toBeLessThan(-80);
    expect(CLIPS.common_carve_01!.keys.at(-1)!.t).toBe(100);
  });

  it('保留の組 v056 では、前の形（投げる・罠・剥ぎ取りは、組の写しのまま）', async () => {
    await useMotionSet('v056');
    for (const k of ['common_item_throw_01', 'common_item_place_01', 'common_carve_01']) expect(CLIPS[k], k).toEqual(HELD.COMMON_CLIPS[k]);
    await useMotionSet(CURRENT_MOTION_SET);
    for (const k of ['common_item_throw_01', 'common_item_place_01', 'common_carve_01']) expect(CLIPS[k], k).not.toEqual(HELD.COMMON_CLIPS[k]);
  });
});
