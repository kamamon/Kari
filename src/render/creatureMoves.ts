// 大型 11 種の仮の動き（v0.17.0）。技ごとに「構え（W）」と「攻撃（S）」の 2 つの姿勢を、決まった名前の値（チャンネル）で書き、
// 技データの時間（startup / active / recovery）に合わせて、休み → 構え → 攻撃 → 休み と混ぜる。
// 値はラジアンと、体の高さ H に対する割合（yH）。side のある技（左右の技）は、向きのある値（yaw・roll・...Yaw）に side を掛ける。
// 判定は技データの軌道（public/data/tracks/<id>.json）が持ち、ここは見た目だけ。判定とずれないように、時間は技データから取る。
import { smoothstep } from '../core/math';
import type { ActionDef } from '../data/schemas';

export type LegKey = string;

/** 姿勢の値。legs は「組（F・H・B・M1…）か *（全部）」に、.S（攻撃する側）/.O（反対側）を付けた名前 → [前後の振り, 持ち上げ, 外への開き] */
export interface Pose {
  yH?: number;
  pitch?: number;
  roll?: number;
  yaw?: number;
  spineYaw?: number;
  spinePitch?: number;
  neckPitch?: number;
  neckYaw?: number;
  headPitch?: number;
  headYaw?: number;
  jaw?: number;
  tailYaw?: number;
  tailPitch?: number;
  tailCurl?: number;
  crest?: number;
  wing?: number;
  /** 攻撃する側の翼だけ */
  wingS?: number;
  sac?: number;
  dish?: number;
  plates?: number;
  bags?: number;
  sail?: number;
  crown?: number;
  glow?: number;
  finger?: number;
  tubes?: number;
  ring?: number;
  archFront?: number;
  archBack?: number;
  clawR?: [number, number];
  clawL?: [number, number];
  legs?: Record<LegKey, [number, number, number?]>;
}

export interface MoveDef {
  W: Pose;
  S: Pose;
  /** 跳ぶ高さ（H に対する割合）。技の前へ進む区間で弧を描く */
  hop?: number;
  /** 体を小刻みに震わせる大きさ（rad）。shakeIn: 構えの間だけ */
  shake?: number;
  shakeIn?: 'windup' | 'strike';
  /** 攻撃の後、攻撃の姿勢を保つ割合（後隙の中で） */
  hold?: number;
  /** 速く足を動かす（横への突進・泥掻き） */
  scurry?: number;
  paddle?: number;
  /** 体をくねらせる（長胴の突進）。wiggle: 小さく */
  und?: number;
  wiggle?: number;
  /** 体ごと回る（殻振り） */
  spin?: number;
  /** 輪になって転がる（テンガロ） */
  roll?: number;
  /** 背の帆を、前から順に立てる */
  seqSail?: number;
}

export const CREATURE_MOVES: Record<string, MoveDef> = {
  roar: {
    W: { pitch: -0.1, neckPitch: 0.3, headPitch: 0.2, jaw: 0.3, crest: 0.5, wing: 0.4, sac: 0.5, sail: 0.6, glow: 0.6, tailPitch: 0.2, crown: 0.3, plates: 0.4, bags: 0.4, clawR: [0.4, 0], clawL: [0.4, 0], finger: 0.5 },
    S: { pitch: 0.12, yH: 0.04, neckPitch: 0.3, headPitch: 0.2, jaw: 1, crest: 1, wing: 1, sac: 1, sail: 1, glow: 1, tailPitch: 0.45, crown: 0.6, plates: 1, bags: 1, clawR: [0.9, -0.3], clawL: [0.9, -0.3], finger: 1, ring: 0.15 },
    shake: 0.035, hold: 0.7,
  },
  hop_side: { W: { yH: -0.16, roll: -0.12, legs: { '*': [0, 0.6] } }, S: { roll: 0.22, headYaw: 0.25, legs: { '*': [0, 0.7], 'H.S': [-0.5, 0.3, 0.5] } }, hop: 0.28 },
  hop_back: { W: { yH: -0.18, pitch: -0.1, legs: { '*': [0, 0.6] } }, S: { pitch: 0.35, neckPitch: 0.2, crest: 0.6, legs: { F: [0.7, 0.9], H: [-0.3, 0.5] } }, hop: 0.32 },
  leap: { W: { yH: -0.2, pitch: -0.12, wing: -0.2, bags: -0.4, legs: { '*': [0, 0.7] } }, S: { pitch: -0.22, wing: 0.9, bags: 0.6, legs: { '*': [0, 0.9] } }, hop: 0.35 },
  glide: { W: { yH: -0.18, pitch: -0.1, wing: 0.5, legs: { '*': [0, 0.6] } }, S: { yH: -0.12, pitch: -0.15, wing: 1.1, neckPitch: -0.25, legs: { '*': [-0.4, 0.8] } } },
  lunge: { W: { yH: -0.14, pitch: -0.18, neckPitch: -0.15, crest: -0.3, legs: { F: [0.2, 0.3], H: [-0.2, 0.4] } }, S: { pitch: -0.28, neckPitch: -0.45, headPitch: -0.2, crest: 0.2, legs: { F: [0.5, 0.2], H: [-0.5, 0.2] } } },
  gust: { W: { crest: 1, neckPitch: 0.35, headPitch: 0.3, pitch: 0.12, jaw: 0.4 }, S: { crest: 1.3, neckPitch: -0.25, headPitch: -0.15, pitch: -0.1, jaw: 0.8 }, hold: 0.4 },
  spit: { W: { neckPitch: 0.35, headPitch: 0.35, dish: 1, jaw: 0.3, pitch: 0.06 }, S: { neckPitch: -0.15, headPitch: -0.25, dish: -0.35, jaw: 1, pitch: -0.05 } },
  slide: { W: { yH: 0.05, pitch: 0.12, legs: { '*': [0, 0.5] } }, S: { yH: -0.22, pitch: -0.08, neckPitch: -0.1, legs: { F: [0.6, 0.4], H: [-0.6, 0.4] } }, wiggle: 0.12 },
  shoulder: { W: { yaw: -0.22, roll: 0.12, yH: -0.05, legs: { 'F.S': [0, 0.4] } }, S: { yaw: 0.35, roll: -0.15, pitch: -0.08, legs: { 'F.O': [-0.3, 0.3] } } },
  paw: { W: { pitch: 0.12, legs: { F: [0.3, 0.8] } }, S: { pitch: -0.08, headPitch: -0.1, legs: { F: [0.5, 0.1] } }, paddle: 1 },
  blast: { W: { sac: 1, neckPitch: 0.25, headPitch: 0.2, pitch: 0.08, yH: 0.03 }, S: { sac: 0.2, neckPitch: -0.1, headPitch: -0.1, pitch: -0.05, jaw: 1 }, shake: 0.025, hold: 0.5 },
  slam_head: { W: { neckPitch: 0.6, headPitch: 0.45, pitch: 0.2, legs: { F: [0.15, 0.2] } }, S: { neckPitch: -0.55, headPitch: -0.35, pitch: -0.18, yH: -0.06 } },
  shiver: { W: { sac: 0.6, yH: -0.04 }, S: { pitch: -0.12, yH: -0.06, sac: 0.2, legs: { F: [0.4, 0.2], H: [-0.3, 0.2] } }, shake: 0.05, shakeIn: 'windup' },
  curtain: { W: { wing: 1, neckPitch: 0.3, headPitch: 0.1, pitch: 0.12 }, S: { wing: 1.3, neckPitch: -0.2, pitch: -0.1 }, hold: 0.4 },
  thrust_head: { W: { neckPitch: 0.45, headPitch: 0.35, pitch: 0.1, yH: -0.06 }, S: { neckPitch: -0.75, headPitch: -0.35, pitch: -0.3, yH: -0.12 } },
  wing_sweep: { W: { yaw: -0.2, wingS: 1, roll: 0.06 }, S: { yaw: 0.35, wingS: -0.4 } },
  kick_front: { W: { pitch: 0.1, legs: { 'F.S': [-0.4, 1], 'B.S': [-0.5, 1] } }, S: { pitch: -0.06, legs: { 'F.S': [1.0, 0.3], 'B.S': [1.1, 0.25] } } },
  spark_tail: { W: { tailPitch: 0.45, glow: 1, wing: 0.3, neckPitch: 0.15 }, S: { tailPitch: -0.3, glow: 1, headPitch: -0.15 }, hold: 0.3 },
  sweep_tail: { W: { yaw: -0.25, spineYaw: -0.25, tailYaw: -0.7 }, S: { yaw: 0.6, spineYaw: 0.35, tailYaw: 1.4 } },
  sweep_body: { W: { spineYaw: 0.55, neckYaw: 0.4, headYaw: 0.25 }, S: { spineYaw: -0.6, neckYaw: -0.5, headYaw: -0.3 } },
  sweep_body_side: { W: { spineYaw: -0.4, tailYaw: 0.5, sail: 0.6 }, S: { spineYaw: 0.5, tailYaw: -0.6, roll: 0.15 } },
  claw_pinch: { W: { clawR: [0.7, -0.2], finger: 1, pitch: 0.06 }, S: { clawR: [-0.05, 0.5], finger: -0.2, pitch: -0.05 } },
  claw_fan: { W: { clawR: [0.4, -0.6], clawL: [0.4, -0.6], finger: 1 }, S: { clawR: [0, 0.6], clawL: [0, 0.6], finger: 0 } },
  dash_side: { W: { yH: -0.1, roll: -0.12, legs: { '*': [0, 0.5] } }, S: { roll: 0.12, legs: { '*': [0, 0.3] } }, scurry: 1 },
  shell_swing: { W: { plates: 1, roll: 0.15, yH: 0.04 }, S: { plates: 0.6 }, spin: 1 },
  roll: { W: { ring: 1, yH: -0.1 }, S: { ring: 1, yH: -0.1 }, roll: 1, hold: 0.15 },
  arch_drop: { W: { archFront: 1 }, S: { archFront: -0.35 } },
  hook_sweep: { W: { yaw: -0.25, roll: -0.1 }, S: { yaw: 0.4, roll: 0.15 } },
  tail_strike: { W: { tailPitch: 0.9, tailCurl: 0.5, archBack: 1 }, S: { tailPitch: -0.5, archBack: -0.3 } },
  spray_rear: { W: { pitch: -0.15, tubes: 1, yaw: -0.2 }, S: { pitch: -0.1, tubes: 1, yaw: 0.25 } },
  foreleg_sweep: { W: { pitch: 0.1, legs: { M1: [0.3, 0.9] } }, S: { pitch: -0.05, legs: { M1: [-0.5, 0.4] } } },
  drip: { W: { pitch: -0.25, yH: 0.06 }, S: { pitch: 0.05 } },
  crawl_charge: { W: { yH: -0.12, neckPitch: -0.1, legs: { '*': [-0.4, 0.4] } }, S: { yH: -0.1, legs: { '*': [-0.5, 0.3] } }, und: 1 },
  ring_slam: { W: { spinePitch: 0.45, neckPitch: 0.3, legs: { F: [0.3, 0.9] } }, S: { spinePitch: -0.2, neckPitch: -0.3, legs: { F: [0.2, 0] } } },
  ice_row: { W: { sail: 1, neckPitch: 0.2 }, S: { sail: 1, neckPitch: -0.15, headPitch: -0.1 }, seqSail: 1 },
  mist_ball: { W: { crown: 1, glow: 1, headPitch: 0.25, neckPitch: 0.15 }, S: { crown: -0.3, glow: 0.6, headPitch: -0.3, neckPitch: -0.1 } },
  stomp_front: { W: { pitch: 0.45, yH: 0.08, legs: { F: [0.7, 1] } }, S: { pitch: -0.08, yH: -0.04, legs: { F: [0.3, 0] } } },
};

/** 向きのある値（左右の技で side を掛ける） */
const SIDED = new Set(['roll', 'yaw', 'spineYaw', 'neckYaw', 'headYaw', 'tailYaw']);

export interface MoveSample {
  pose: Pose;
  /** 構え・攻撃・後隙のどこか（0〜1 の進み） */
  stage: 'windup' | 'strike' | 'recover';
  /** 攻撃の姿勢の強さ（0〜1）。震え・跳び・回るの量に使う */
  strike: number;
  /** 構えの進み（0〜1） */
  windup: number;
}

const ease = (u: number): number => smoothstep(Math.max(0, Math.min(1, u)));
const easeOut = (u: number): number => 1 - (1 - Math.max(0, Math.min(1, u))) ** 2;

/** 技データの時間で、構え → 攻撃 → 休み を混ぜる。t は描画の tick（小数）。 */
export function sampleMove(def: MoveDef, action: ActionDef, t: number, side: number, amp: number): MoveSample {
  const D = action.durationTicks;
  const act = action.phases.find((p) => p.id === 'active');
  // 攻撃の区間が無い技（咆哮）は、全体の 3 割で構え、4 割半までに攻撃の姿勢へ
  const a0 = act ? act.from : Math.round(D * 0.3);
  const a1 = act ? act.to : Math.round(D * 0.45);
  let wW = 0, wS = 0, stage: MoveSample['stage'];
  if (t < a0) {
    stage = 'windup';
    wW = ease(t / Math.max(1, a0));
  } else if (t < a1) {
    stage = 'strike';
    wS = easeOut((t - a0) / Math.max(1, a1 - a0));
    wW = 1 - wS;
  } else {
    stage = 'recover';
    const hold = def.hold ?? 0.25;
    const v = (t - a1) / Math.max(1, D - a1);
    wS = 1 - ease((v - hold) / Math.max(0.05, 1 - hold));
  }
  const pose: Pose = {};
  const mix = (k: keyof Pose, a: number | undefined, b: number | undefined): void => {
    const v = ((a ?? 0) * wW + (b ?? 0) * wS) * amp * (SIDED.has(k) ? side : 1);
    if (v !== 0) (pose as Record<string, number>)[k] = v;
  };
  const keys = new Set([...Object.keys(def.W), ...Object.keys(def.S)]);
  for (const k of keys) {
    if (k === 'legs' || k === 'clawR' || k === 'clawL') continue;
    mix(k as keyof Pose, (def.W as Record<string, number>)[k], (def.S as Record<string, number>)[k]);
  }
  for (const c of ['clawR', 'clawL'] as const) {
    const a = def.W[c], b = def.S[c];
    if (a || b) pose[c] = [((a?.[0] ?? 0) * wW + (b?.[0] ?? 0) * wS) * amp, ((a?.[1] ?? 0) * wW + (b?.[1] ?? 0) * wS) * amp];
  }
  const legKeys = new Set([...Object.keys(def.W.legs ?? {}), ...Object.keys(def.S.legs ?? {})]);
  if (legKeys.size) {
    pose.legs = {};
    for (const k of legKeys) {
      const a = def.W.legs?.[k], b = def.S.legs?.[k];
      pose.legs[k] = [
        ((a?.[0] ?? 0) * wW + (b?.[0] ?? 0) * wS) * amp,
        ((a?.[1] ?? 0) * wW + (b?.[1] ?? 0) * wS) * amp,
        ((a?.[2] ?? 0) * wW + (b?.[2] ?? 0) * wS) * amp,
      ];
    }
  }
  return { pose, stage, strike: stage === 'windup' ? 0 : wS, windup: stage === 'windup' ? wW : 1 };
}
