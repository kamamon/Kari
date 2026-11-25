// 断岳剣の既存の刃軌道を保ち、下半身を接地 IK へ替える。
// 腰→胸のひねりを分担する。技の時刻・移動距離・判定窓は変更しない。
import { fillCtl, footAt, type BodyPose, type Foot, type Motion, type Step } from './bodySolve';
import { groundLowerBody } from './contactLocomotion';

const L: Step = [0, 0, 0.11, 0.18, 6];
const R: Step = [0, 0, -0.13, -0.16, -28];
const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));
function smoothKeys(keys: readonly (readonly [number, number])[], t: number): number {
  if (t <= keys[0]![0]) return keys[0]![1];
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1]!, b = keys[i]!;
    if (t <= b[0]) { const u = clamp((t - a[0]) / (b[0] - a[0]), 0, 1), w = u * u * (3 - 2 * u); return a[1] + (b[1] - a[1]) * w; }
  }
  return keys[keys.length - 1]![1];
}
const HEAVY: Record<string, Motion> = {
  hb_attack_vertical_01: {
    dur: 72, family: 'heavy_blade', base: fillCtl({}), ch: {},
    root: [[0, 0], [14, 0], [24, 0.33], [30, 0.35], [72, 0.35]],
    feet: { L: [L, [12, 24, 0.11, 0.24, 6, 0.07], [54, 67, 0.11, 0.18, 6, 0.05]], R: [R, [38, 52, -0.13, -0.16, -28, 0.06]] },
  },
  hb_attack_side_01: {
    dur: 66, family: 'heavy_blade', base: fillCtl({}), ch: {},
    root: [[0, 0], [10, 0], [20, 0.25], [66, 0.25]],
    feet: { L: [L, [8, 18, 0.12, 0.23, 6, 0.06], [52, 64, 0.11, 0.18, 6, 0.05]], R: [R, [38, 51, -0.13, -0.16, -28, 0.05]] },
  },
  // 斬り上げ（v0.40.0）: 沈んだ所（10〜20）で左足を踏み込み、振り上げた後に右足を寄せ、最後に左足を戻す
  hb_attack_upswing_01: {
    dur: 66, family: 'heavy_blade', base: fillCtl({}), ch: {},
    root: [[0, 0], [10, 0], [20, 0.28], [26, 0.3], [66, 0.3]],
    feet: { L: [L, [10, 20, 0.11, 0.24, 6, 0.07], [52, 62, 0.11, 0.18, 6, 0.05]], R: [R, [36, 50, -0.13, -0.16, -28, 0.06]] },
  },
  // 刃が前の低い所にある時の斬り上げ（12 tick 早い）
  hb_attack_upswing_low_01: {
    dur: 54, family: 'heavy_blade', base: fillCtl({}), ch: {},
    root: [[0, 0], [8, 0.26], [14, 0.3], [54, 0.3]],
    feet: { L: [L, [0, 8, 0.11, 0.22, 6, 0.06], [40, 50, 0.11, 0.18, 6, 0.05]], R: [R, [24, 38, -0.13, -0.16, -28, 0.06]] },
  },
  hb_draw_slash_01: {
    dur: 64, family: 'heavy_blade', base: fillCtl({}), ch: {},
    root: [[0, 0], [8, 0], [22, 0.42], [28, 0.45], [64, 0.45]],
    feet: { L: [[0, 0, 0.105, 0, 5], [7, 20, 0.11, 0.23, 6, 0.07], [50, 62, 0.11, 0.18, 6, 0.05]], R: [[0, 0, -0.105, 0, -5], [33, 48, -0.13, -0.16, -28, 0.06]] },
  },
};

/** 母指球を動かさず、踵を上げて向きを変える。 */
function pivot(f: Foot, degrees: number, heel: number): Foot {
  const old = f[3] * Math.PI / 180, next = degrees * Math.PI / 180;
  return [f[0] + (Math.sin(old) - Math.sin(next)) * 0.13, f[1], f[2] + (Math.cos(old) - Math.cos(next)) * 0.13, degrees, f[1] > 0.004 ? f[4] : Math.max(f[4], heel)];
}

export function groundedHeavyAttack(pose: BodyPose, clip: string, t: number): BodyPose {
  const m = HEAVY[clip];
  if (!m) return pose;
  if (clip === 'hb_attack_side_01') {
    // 両手を柄へ届かせるため、前脚へ重さを移しながら膝で 12cm 沈む。
    // 足は移動させない。既存の刃軌道に腕だけを伸ばすと左手が約 9cm 届かなかった。
    const crouch = smoothKeys([[0, 0], [8, 1], [38, 1], [54, 0], [66, 0]], t);
    const transfer = smoothKeys([[0, 0], [16, 0], [22, 1], [38, 1], [54, 0], [66, 0]], t);
    pose = { ...pose, py: pose.py - 0.12 * crouch, pz: (pose.pz ?? 0) + 0.08 * transfer };
  }
  let left = footAt(m, m.feet.L, t), right = footAt(m, m.feet.R, t);
  const totalYaw = pose.j.spine[1] + pose.j.chest[1];
  // 最大 92° が背骨だけへ掛かっていた薙ぎを、骨盤 44° + 背/胸 48° に分ける。
  const hipYaw = clip === 'hb_attack_side_01'
    ? smoothKeys([[0, 0], [8, -16], [18, -28], [22, -2], [27, 34], [34, 44], [50, 16], [66, 0]], t)
    : clamp(totalYaw * 0.3, -12, 12);
  if (clip === 'hb_attack_side_01') {
    const u = smoothKeys([[0, 0], [18, 0], [34, 1], [50, 0.4], [66, 0]], t);
    left = pivot(left, left[3] + 32 * u, 12 * Math.sin(Math.PI * u));
    right = pivot(right, right[3] + 46 * u, 22 * Math.sin(Math.PI * u));
  }
  const p = groundLowerBody(pose, left, right, hipYaw);
  const spine = pose.j.spine[1] * 0.35;
  p.j.spine = [pose.j.spine[0], spine, pose.j.spine[2]];
  p.j.chest = [pose.j.chest[0], totalYaw - hipYaw - spine, pose.j.chest[2]];
  return p;
}
