// 登攀・乗り越え・研磨の終わりの形（v0.69.0。D-150・D-167。描画だけ）
import { describe, expect, it } from 'vitest';
import { MOTION_STYLE, climbPose, climbWallPose, clipPose, vaultPose, type BodyPose } from '../src/render/poses';

/** 2 つの姿勢の、関節の角度のいちばん大きな差（度）と、腰の高さの差（m） */
function diff(a: BodyPose, b: BodyPose): { deg: number; py: number } {
  let deg = 0;
  for (const n of Object.keys(a.j) as (keyof BodyPose['j'])[]) {
    for (let k = 0; k < 3; k++) deg = Math.max(deg, Math.abs(a.j[n][k] - b.j[n][k]));
  }
  return { deg, py: Math.abs(a.py - b.py) };
}

const STRIDE = 0.65;

describe('登攀の形（v0.69.0）', () => {
  it('壁の姿勢は、手足の入れ替えの境目（0.65m ごと）で跳ばず、2 歩（1.3m）でひと回りする', () => {
    for (let k = -2; k <= 4; k++) {
      const h = k * STRIDE;
      const d = diff(climbWallPose(h - 1e-6), climbWallPose(h + 1e-6));
      expect(d.deg, `h=${h}`).toBeLessThan(0.01);
      expect(diff(climbWallPose(h + 0.2), climbWallPose(h + 0.2 + 2 * STRIDE)).deg).toBeLessThan(1e-6);
    }
  });

  it('入れ替えの半ばでは、伸ばす手が壁から離れて肘を曲げ（顔の前を通る）、上げる脚は膝を高く上げる', () => {
    // A（左手が上）→ B（右手が上）の半ば: 右手を伸ばしている
    const mid = climbWallPose(0.5 * STRIDE);
    expect(mid.j.forearmR[0]).toBeLessThan(-80);
    expect(mid.j.upperArmR[0]).toBeLessThan(-140);
    expect(mid.j.thighL[0]).toBeLessThan(-70);
    expect(mid.j.shinL[0]).toBeGreaterThan(100);
    // B → A の半ば: 左右が入れ替わる
    const mid2 = climbWallPose(1.5 * STRIDE);
    expect(mid2.j.forearmL[0]).toBeLessThan(-80);
    expect(mid2.j.thighR[0]).toBeLessThan(-70);
    // 体は支える手の側へ寄り、胸は伸ばす手の側へひねる（左右で逆）
    expect(Math.sign(mid.j.chest[1])).toBe(-Math.sign(mid2.j.chest[1]));
  });

  it('取り付く・上から取り付く・登り切るは、始めと終わりで立った姿勢と壁の姿勢へつながり、途中で跳ばない', () => {
    const h = 0.3;
    const stand = climbPose('mount', 0, h);
    expect(diff(climbPose('mount', 1, h), climbWallPose(h)).deg).toBeLessThan(1e-6);
    expect(diff(climbPose('down', 0, h), stand).deg).toBeLessThan(1e-6);
    expect(diff(climbPose('down', 1, h), climbWallPose(h)).deg).toBeLessThan(1e-6);
    expect(diff(climbPose('exit', 0, h), climbWallPose(h)).deg).toBeLessThan(1e-6);
    expect(diff(climbPose('exit', 1, h), stand).deg).toBeLessThan(1e-6);
    // 1 tick ごと（取り付く 14・上から 30・登り切る 36 tick）の変わり方が大きすぎない
    for (const [phase, n] of [['mount', 14], ['down', 30], ['exit', 36]] as const) {
      for (let i = 0; i < n; i++) {
        const d = diff(climbPose(phase, i / n, h), climbPose(phase, (i + 1) / n, h));
        expect(d.deg, `${phase} ${i}`).toBeLessThan(32);
        expect(d.py, `${phase} ${i}`).toBeLessThan(0.08);
      }
    }
  });

  it('取り付く途中（0.6）は両手を上へ伸ばす。登り切るは 肘を引く → 腕を伸ばして面を押す → 右膝を縁へ掛ける、の順。上から下りるはその逆', () => {
    const grab = climbPose('mount', 0.6, 0);
    expect(grab.j.upperArmL[0]).toBeLessThan(-155);
    expect(grab.j.upperArmR[0]).toBeLessThan(-155);
    const hang = climbPose('exit', 0.1, 0);
    expect(hang.j.forearmL[0]).toBeLessThan(-85);
    expect(hang.j.forearmR[0]).toBeLessThan(-85);
    const press = climbPose('exit', 0.28, 0);
    expect(press.j.upperArmL[0]).toBeGreaterThan(-40);
    expect(press.j.forearmL[0]).toBeGreaterThan(-25);
    expect(press.j.spine[0]).toBeGreaterThan(35);
    const knee = climbPose('exit', 0.44, 0);
    expect(knee.j.thighR[0]).toBeLessThan(-90);
    expect(climbPose('exit', 0.66, 0).py).toBeCloseTo(-0.24, 6);
    // 上から: しゃがむ → 面を押す → ぶら下がる
    expect(climbPose('down', 0.22, 0).py).toBeCloseTo(-0.3, 6);
    expect(climbPose('down', 0.45, 0).j.spine[0]).toBeGreaterThan(35);
    expect(climbPose('down', 0.72, 0).j.forearmR[0]).toBeLessThan(-85);
  });

  it('保留の組 v056 では、作り直す前の形（壁は 2 つの姿勢を高さで混ぜ、登り切るは押し上げの 1 つの鍵）', () => {
    MOTION_STYLE.style = 'v056';
    try {
      const pull = climbPose('exit', 0.55, 0);
      expect(pull.j.upperArmL[0]).toBe(-70);
      expect(pull.j.thighR[0]).toBe(-95);
      // 入れ替えの半ばは、ただ A と B の真ん中（肘を曲げて顔の前を通らない）
      expect(climbPose('climb', 0, 0.325).j.forearmR[0]).toBeCloseTo(-45, 6);
    } finally {
      MOTION_STYLE.style = '2g';
    }
    expect(climbPose('climb', 0, 0.325).j.forearmR[0]).toBeLessThan(-80);
  });

  it('乗り越えは、これまでと同じ鍵（寄る → 押し上げる → しゃがむ → 立つ）', () => {
    expect(vaultPose(0.55).j.thighR[0]).toBe(-100);
    expect(vaultPose(0.8).py).toBeCloseTo(-0.3, 6);
    expect(diff(vaultPose(0), vaultPose(1)).deg).toBeLessThan(1e-6);
  });
});

describe('研磨の終わり（v0.69.0）', () => {
  it('研ぎ上がり（96 tick）の後に、ひざを突いたまま背を起こして刃へ顔を向け（102 tick）、それから立ち上がる', () => {
    const at = (t: number): BodyPose => clipPose('common_item_whet_01', t)!;
    const check = at(102);
    expect(check.j.head[1]).toBeGreaterThan(20);
    expect(check.j.spine[0]).toBeLessThan(at(94).j.spine[0]);
    // ひざは突いたまま
    expect(check.j.thighL[0]).toBe(-82);
    expect(check.j.shinR[0]).toBe(98);
    // 1 tick ごとの変わり方が大きすぎない
    for (let t = 90; t < 120; t++) expect(diff(at(t), at(t + 1)).deg, `t=${t}`).toBeLessThan(10);
  });
});
