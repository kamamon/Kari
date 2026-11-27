// 抜刀中の歩き（v0.71.0。D-169）: 歩みに合わせて、腰のひねり・肩の傾き・着いた後の沈み・武器の揺れ・手の振りが出ること。
// 重い武器ほど前かがみで、武器が大きく揺れる。保留の組 v056 は、これまでどおり上半身を動かさない
import { beforeAll, describe, expect, it } from 'vitest';
import type { Content } from '../src/data/schemas';
import { solveState, strideOf } from '../src/render/hunterAnim';
import { MOTION_STYLE } from '../src/render/poses';
import { WEAPON_STANCES } from '../src/render/weaponClipSpecs';
import { loadContent } from './helpers';

let content: Content;
beforeAll(async () => {
  content = await loadContent();
});

const FAMILIES = Object.keys(WEAPON_STANCES);
/** 歩幅の位相 ph（0 = 左足が前へ着く所）での解いた体 */
function walkAt(fam: string, ph: number): ReturnType<typeof solveState> {
  const speed = content.families.get(fam)!.drawnMoveSpeed;
  const time = (ph / (2 * Math.PI)) * (strideOf(speed) / speed);
  return solveState(fam, { kind: 'idle' }, speed, time);
}
/** ひと回りの間の、武器の先（握りから、武器の範囲の端まで）の上下の幅（m） */
function tipBob(fam: string): number {
  const far = WEAPON_STANCES[fam]!.shape.to;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < 24; i++) {
    const w = walkAt(fam, (i / 24) * 2 * Math.PI).weapon;
    const y = w.grip[1]! + w.dir[1]! * far;
    lo = Math.min(lo, y);
    hi = Math.max(hi, y);
  }
  return hi - lo;
}
/** ひと回りの間に、武器の握りが動く道のり（m。上下・前後・左右を合わせて） */
function gripPath(fam: string): number {
  let len = 0;
  let prev = walkAt(fam, 0).weapon.grip;
  for (let i = 1; i <= 24; i++) {
    const g = walkAt(fam, (i / 24) * 2 * Math.PI).weapon.grip;
    len += Math.hypot(g[0]! - prev[0]!, g[1]! - prev[1]!, g[2]! - prev[2]!);
    prev = g;
  }
  return len;
}

describe('抜刀中の歩き（v0.71.0。D-169）', () => {
  it('7 系統とも、歩くと武器の先が上下に揺れ（重い断岳剣・大槌は 3cm 以上、ほかは 1.5cm 以上）、握りは保留の組 v056 より大きく動く', () => {
    for (const fam of FAMILIES) {
      const bob = tipBob(fam), path = gripPath(fam);
      MOTION_STYLE.style = 'v056';
      let old: number;
      try {
        old = gripPath(fam);
      } finally {
        MOTION_STYLE.style = '2g';
      }
      expect(bob, fam).toBeGreaterThan(fam === 'heavy_blade' || fam === 'war_maul' ? 0.03 : 0.015);
      expect(path, fam).toBeGreaterThan(old * 1.3);
    }
  });

  it('重い武器ほど前かがみ: 歩くと、断岳剣は頭が 3cm 以上前へ出る。環弓はほとんど変わらない', () => {
    const lean = (fam: string): number => {
      const idle = solveState(fam, { kind: 'idle' });
      let z = 0;
      for (let i = 0; i < 8; i++) z += walkAt(fam, (i / 8) * 2 * Math.PI).frames.head[2]!;
      return z / 8 - idle.frames.head[2]!;
    };
    expect(lean('heavy_blade')).toBeGreaterThan(0.03);
    expect(lean('heavy_blade')).toBeGreaterThan(lean('ring_bow'));
  });

  it('双剣は手が足と逆に振れる: 左足が前（位相 0）で右手が前へ、右足が前（位相 π）で左手が前へ', () => {
    const a = walkAt('twin_blades', 0), b = walkAt('twin_blades', Math.PI);
    expect(a.frames.handR[2]! - b.frames.handR[2]!).toBeGreaterThan(0.05);
    expect(b.frames.handL[2]! - a.frames.handL[2]!).toBeGreaterThan(0.05);
  });

  it('腰がひねれて、胸で戻す: 位相 0 と π で、腰の向きは 6° 以上違い、胸の向きの違いはその半分より小さい（断岳剣）', () => {
    const yaw = (q: readonly number[]): number => {
      // 四元数の、上の軸の周りの回り（度）
      const [x, y, z, w] = q as [number, number, number, number];
      return (Math.atan2(2 * (w * y + x * z), 1 - 2 * (y * y + x * x)) * 180) / Math.PI;
    };
    for (const fam of ['heavy_blade', 'long_blade', 'twin_blades']) {
      const a = walkAt(fam, 0), b = walkAt(fam, Math.PI);
      const hip = Math.abs(yaw(a.frames.qPelvis) - yaw(b.frames.qPelvis));
      const chest = Math.abs(yaw(a.frames.qChest) - yaw(b.frames.qChest));
      expect(hip, fam).toBeGreaterThan(6);
      expect(chest, fam).toBeLessThan(hip / 2);
    }
  });
});
