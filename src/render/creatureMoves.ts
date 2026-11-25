// 大型 11 種と幼体 8 種の動き（v0.17.0 → v0.21.0 で、種ごとに固有の鍵の姿勢へ）。
// 技ごとに、決まった名前の値（チャンネル）の姿勢を、技データの時間（startup / active / recovery）の中の位置に並べ、
// 鍵と鍵の間をなめらかにつなぐ（予備動作 → 打つ → 振り抜き → 戻り）。鍵の中身は tools/gen-monsters.py が種ごとに書き、
// src/render/creaturePlans.ts の moves に入る（手で編集しない）。
// 値はラジアンと、体の高さ H に対する割合（yH・z・x）。side のある技（左右の技）は、向きのある値（yaw・roll・...Yaw・x）に side を掛ける。
// 判定は技データの軌道（public/data/tracks/<id>.json）が持つ。体の部位に付けた判定（設計図の bind）は、npm run monsters:bake が
// この動きから軌道を作り直すので、見た目と判定がずれない。時間は技データから取る。
import { smoothstep } from '../core/math';
import type { ActionDef } from '../data/schemas';

export type LegKey = string;

/** 姿勢の値。legs は「組（F・H・B・M1…）か *（全部）」に、.S（攻撃する側）/.O（反対側）を付けた名前 → [前後の振り, 持ち上げ, 外への開き] */
export interface Pose {
  /** 体の上下・前後・左右のずれ（H に対する割合。x は + が技の側） */
  yH?: number;
  z?: number;
  x?: number;
  /** 体全体の傾き（pitch + で前が上がる、roll + で左が上がる、yaw + で左を向く） */
  pitch?: number;
  roll?: number;
  yaw?: number;
  /** 胴の前の側の曲げ（横・縦）と、ねじり */
  spineYaw?: number;
  spinePitch?: number;
  twist?: number;
  /** 首（+ で上げる）・頭・顎 */
  neckPitch?: number;
  neckYaw?: number;
  headPitch?: number;
  headYaw?: number;
  headRoll?: number;
  jaw?: number;
  /** 尾（tailYaw + で左へ、tailPitch + で上げる、tailCurl で先を巻く、tailWave で波打たせる） */
  tailYaw?: number;
  tailPitch?: number;
  tailCurl?: number;
  tailWave?: number;
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
  /** ひれ足を開く（+）・畳む（-）（v0.21.0。キリサーヴ・ヒナサルヴ） */
  fin?: number;
  clawR?: [number, number];
  clawL?: [number, number];
  legs?: Record<LegKey, [number, number, number?]>;
}

/**
 * 動きの鍵の姿勢（v0.21.0）。技の時間の 3 つの区間（w = 構え、s = 攻撃、r = 後隙）の中の位置 t（0〜1）で、その姿勢になる。
 * 鍵の間は、なめらかにつなぐ（e: io = ゆっくり出て、ゆっくり着く / o = 速く出て、ゆっくり着く（打つ・振る）/ i = ゆっくり出て、速く着く（叩きつけ）/ lin = 一定）。
 * e は、その鍵へ向かう区間の決まり。技の始め（0）と終わり（後隙の 1）は、鍵が無ければ、ふだんの姿勢。
 */
export interface MoveKey {
  p: 'w' | 's' | 'r';
  t: number;
  pose: Pose;
  e?: 'io' | 'o' | 'i' | 'lin';
}

export interface MoveDef {
  /** 鍵の姿勢の並び（予備動作 → 打つ → 振り抜き → 戻り） */
  K: MoveKey[];
  /** 跳ぶ高さ（H に対する割合）。技の前へ進む区間で弧を描く */
  hop?: number;
  /** 体を小刻みに震わせる大きさ（rad）。shakeIn: その区間だけ（無ければ攻撃の後） */
  shake?: number;
  shakeIn?: 'windup' | 'strike' | 'all';
  /** 速く足を動かす（横への突進・泥掻き） */
  scurry?: number;
  paddle?: number;
  /** 体をくねらせる（長胴の突進）。wiggle: 小さく */
  und?: number;
  wiggle?: number;
  /** 体ごと回る（回数。+ で左回り）。攻撃の区間で回る */
  spin?: number;
  /** 輪になって転がる（テンガロ） */
  roll?: number;
  /** 並んだ物（帆・嚢）を、前から順に立てる・ふくらませる */
  seq?: boolean;
}

/** 向きのある値（左右の技で side を掛ける） */
const SIDED = new Set(['roll', 'yaw', 'spineYaw', 'neckYaw', 'headYaw', 'tailYaw', 'x', 'headRoll', 'twist']);

export interface MoveSample {
  pose: Pose;
  /** 構え・攻撃・後隙のどこか */
  stage: 'windup' | 'strike' | 'recover';
  /** 攻撃の強さ（0〜1）。震え・跳び・回るの量に使う */
  strike: number;
  /** 構えの進み（0〜1） */
  windup: number;
}

const ease = (u: number): number => smoothstep(Math.max(0, Math.min(1, u)));
const easeOut = (u: number): number => 1 - (1 - Math.max(0, Math.min(1, u))) ** 2;
const easeIn = (u: number): number => Math.max(0, Math.min(1, u)) ** 2;
const EASE = { io: ease, o: easeOut, i: easeIn, lin: (u: number) => Math.max(0, Math.min(1, u)) };

/** 姿勢の値を、重み付きで足す（向きのある値は side を掛ける） */
export function addScaled(into: Pose, p: Pose, w: number, side: number): void {
  if (w === 0) return;
  for (const [k, v] of Object.entries(p) as [keyof Pose, unknown][]) {
    if (k === 'legs') {
      into.legs ??= {};
      for (const [lk, lv] of Object.entries(v as Record<string, [number, number, number?]>)) {
        const cur = into.legs[lk] ?? [0, 0, 0];
        into.legs[lk] = [cur[0] + lv[0] * w, cur[1] + lv[1] * w, (cur[2] ?? 0) + (lv[2] ?? 0) * w];
      }
    } else if (k === 'clawR' || k === 'clawL') {
      const cv = v as [number, number];
      const cur = into[k] ?? [0, 0];
      into[k] = [cur[0] + cv[0] * w, cur[1] + cv[1] * w];
    } else {
      const num = (v as number) * w * (SIDED.has(k) ? side : 1);
      (into as Record<string, number>)[k] = ((into as Record<string, number>)[k] ?? 0) + num;
    }
  }
}

/** 鍵の並びを、0〜1 の位置 u で補間する（しぐさ・倒れる動きにも使う）。鍵の時刻は at(k) で決める */
export function sampleKeyList(keys: readonly { at: number; pose: Pose; e?: MoveKey['e'] }[], u: number, side = 1, amp = 1): Pose {
  const pose: Pose = {};
  if (keys.length === 0) return pose;
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1]!.at <= u) i++;
  const k0 = keys[i]!, k1 = keys[Math.min(keys.length - 1, i + 1)]!;
  const f = k1.at > k0.at ? (u - k0.at) / (k1.at - k0.at) : 1;
  const w = EASE[k1.e ?? 'io'](f);
  addScaled(pose, k0.pose, (1 - w) * amp, side);
  addScaled(pose, k1.pose, w * amp, side);
  return pose;
}

/** 技の区間（構えの終わり a0、攻撃の終わり a1） */
export function moveSpan(action: ActionDef): { D: number; a0: number; a1: number } {
  const D = action.durationTicks;
  const act = action.phases.find((p) => p.id === 'active');
  // 攻撃の区間が無い技（咆哮・威嚇）は、全体の 3 割で構え、4 割半までを「攻撃」の区間とみなす
  return { D, a0: act ? act.from : Math.round(D * 0.3), a1: act ? act.to : Math.round(D * 0.45) };
}

/** 鍵の時刻（技の tick） */
export function keyTick(k: MoveKey, D: number, a0: number, a1: number): number {
  return k.p === 'w' ? k.t * a0 : k.p === 's' ? a0 + k.t * (a1 - a0) : a1 + k.t * (D - a1);
}

/** 技データの時間で、鍵の姿勢を混ぜる。t は描画の tick（小数）。 */
export function sampleMove(def: MoveDef, action: ActionDef, t: number, side: number, amp: number): MoveSample {
  const { D, a0, a1 } = moveSpan(action);
  const keys: { at: number; pose: Pose; e?: MoveKey['e'] }[] = [{ at: 0, pose: {} }];
  for (const k of def.K) keys.push({ at: keyTick(k, D, a0, a1), pose: k.pose, e: k.e });
  keys.sort((a, b) => a.at - b.at);
  if (keys[keys.length - 1]!.at < D - 1e-6) keys.push({ at: D, pose: {}, e: 'io' });
  const pose = sampleKeyList(keys, t, side, amp);
  const stage: MoveSample['stage'] = t < a0 ? 'windup' : t < a1 ? 'strike' : 'recover';
  const strike = stage === 'windup' ? 0 : stage === 'strike' ? easeOut((t - a0) / Math.max(1, a1 - a0)) : Math.max(0, 1 - (t - a1) / Math.max(1, (D - a1) * 0.6));
  return { pose, stage, strike, windup: stage === 'windup' ? ease(t / Math.max(1, a0)) : 1 };
}
