// 坂の足の接地（v0.47.0。#19 の 01「斜面では左右の地面高さを別々に採り、脚が届く範囲で骨盤を調整する」）。描画だけ。
// 平らな所（地面の高さが根元と同じ）では、これまでと同じ姿勢。坂では、高い側の脚が曲がり、低い側の脚が伸びる。
import { describe, expect, it } from 'vitest';
import { GroundedLocomotion } from '../src/render/contactLocomotion';
import { HunterAnimator } from '../src/render/hunterAnim';
import { locomotionPose } from '../src/render/poses';
import type { BodyPose } from '../src/render/bodySolve';

const stand = (ground?: (x: number, z: number) => number, frames = 30): BodyPose => {
  const g = new GroundedLocomotion();
  let out!: BodyPose;
  for (let i = 0; i < frames; i++) {
    const pose = locomotionPose(false, 0, 0, i / 60);
    out = g.frame(pose, false, 0, 0, 1 / 60, ground ? { x: 0, z: 0, yaw: 0, y: 0, ground } : { x: 0, z: 0, yaw: 0 });
  }
  return out;
};
/** 膝の曲がり（すねの X の回転。大きいほど曲がる） */
const knee = (p: BodyPose, side: 'L' | 'R'): number => p.j[side === 'L' ? 'shinL' : 'shinR'][0];

describe('坂の足の接地（v0.47.0）', () => {
  it('平らな所では、地面の高さを渡しても、渡さない時と同じ姿勢', () => {
    const a = stand();
    const b = stand(() => 0);
    expect(b.py).toBeCloseTo(a.py, 9);
    for (const n of ['thighL', 'shinL', 'thighR', 'shinR'] as const) for (let k = 0; k < 3; k++) expect(b.j[n][k]).toBeCloseTo(a.j[n][k], 9);
  });

  it('横の坂（左が高い）に立つと、左の膝が右より曲がり、腰は届く高さへ下がる（足は地面より下へ潜らない）', () => {
    // 体の左（+X）ほど高い坂。左右の足の間（約 0.21m）で 6cm の差
    const flat = stand();
    const slope = stand((x) => 0.3 * x);
    expect(knee(slope, 'L') - knee(slope, 'R')).toBeGreaterThan(2);
    expect(slope.py).toBeLessThanOrEqual(flat.py + 1e-9);
  });

  it('大きな段差（35cm より高い）は合わせない（段の縁に片足を掛けて、脚を伸ばしきらない）', () => {
    const cliff = stand((x) => (x > 0 ? 1.5 : 0));
    const step = stand((x) => (x > 0 ? 0.35 : 0));
    expect(knee(cliff, 'L')).toBeCloseTo(knee(step, 'L'), 6);
  });

  it('武器を構えた待機（護刃。HunterAnimator）でも、横の坂では高い側（左）の膝が、平らな時より曲がる', () => {
    const idle = (ground?: (x: number, z: number) => number): BodyPose => {
      const anim = new HunterAnimator();
      let pose!: BodyPose;
      for (let i = 0; i < 30; i++) {
        const root = ground ? { x: 0, z: 0, yaw: 0, y: 0, ground } : { x: 0, z: 0, yaw: 0 };
        pose = anim.frame('guard_blade', { kind: 'idle' }, 'idle', 1 / 60, 0, i / 60, { root }).pose;
      }
      return pose;
    };
    const flat = idle(), slope = idle((x) => 0.3 * x);
    expect(knee(slope, 'L') - knee(slope, 'R') - (knee(flat, 'L') - knee(flat, 'R'))).toBeGreaterThan(2);
  });
});
