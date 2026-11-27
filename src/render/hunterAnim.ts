// 断岳剣以外（護刃・長尖槍・環弓・大槌・双剣・太刀）の体の動かし方。技の動き・構え・防御・歩きを、同じ解き方（bodySolve.ts）へ通す。
// ゲームの画面（view.ts）と素材ビューア（viewer.ts）と検査（tests/human-motion.test.ts）が、ここを使う。
import { evalMotion, gaitFeet, mixCtl, mixFoot, solveBody, type Ctl, type Foot, type Solved } from './bodySolve';
import type { HunterRig } from './rig';
import { ContactLocomotion, fitFeetToGround, type RenderRoot } from './contactLocomotion';
import { WEAPON_MOTIONS, WEAPON_STANCES } from './weaponClipSpecs';
import { MOTION_STYLE } from './poses';
import { renderTick, type ActionRun } from '../game/action';
import type { ActionDef } from '../data/schemas';

/** run.tick は「次に処理する tick」。命中停止中は処理済みの接触姿勢を保つ。simulation は変更しない。 */
export function playerRenderTick(run: ActionRun, alpha: number): number {
  const holding = !!run.def.charge && run.tick === run.def.charge.holdTick && !run.released;
  if (run.hitstop > 0 || (!run.advanced && !holding && run.tick > 0)) return Math.max(0, run.tick - 1);
  return renderTick(run, alpha);
}

/** 射撃の発射フレームも、手/弦と projectile の対応を保つために遷移を終える。 */
export function playerContactFrame(def: ActionDef, t: number): boolean {
  return def.hitWindows.some((h) => t >= h.from && t < h.to)
    || !!def.shoot?.some((s) => t >= s.tick && t < s.tick + 1);
}

export type AnimState =
  /** 技。t は技の tick（小数可）、dirAngle は回避の向き（ラジアン）、chargeTicks は溜めている tick、freeMove は技の間に歩けるか */
  | { kind: 'action'; clip: string; t: number; dirAngle: number; chargeTicks: number; freeMove: boolean }
  /** 抜刀して構えている（立ち・歩き） */
  | { kind: 'idle' }
  /** 防御。blend 0 = 構え、1 = 防御姿勢。shake は受けた直後の揺れ（0〜1） */
  | { kind: 'guard'; blend: number; shake: number };

/** この武器系統・この状態を、ここで解けるか */
export function canSolve(familyId: string, st: AnimState): boolean {
  const S = WEAPON_STANCES[familyId];
  if (!S) return false;
  if (st.kind === 'action') return WEAPON_MOTIONS[st.clip]?.family === familyId;
  if (st.kind === 'guard') return !!S.guard;
  return true;
}

const smooth = (x: number): number => {
  const u = Math.min(1, Math.max(0, x));
  return u * u * (3 - 2 * u);
};
/** 歩幅（2 歩ぶん）: ゆっくりなら短く、速いほど長く */
export const strideOf = (speed: number): number => Math.min(1.3, Math.max(0.7, 0.6 + 0.25 * speed));
/**
 * 抜刀中の歩き（v0.71.0。D-169。2G を手本に。描画だけ。値は Claude の仮の値）: 歩みに合わせて体が動く量。
 * lean = 前かがみ（度）、shift = 支える足の側へ腰が寄る（m）、twist = 腰が左右へひねれて胸で戻す（度）、
 * roll = 支える足の側へ肩が傾く（度）、lag = 着く度に、胸と武器が遅れて上下に揺れる（度）、swing = 手が足と逆に前後へ振れる（m。胸の座標の握り）。
 * 重い武器（断岳剣・大槌・長尖槍）ほど前かがみで、胸と武器の揺れが大きく、手は振らない。双剣・護刃・環弓は手が振れる。
 * 腰の上下は増やさない（v0.28.1 の利用者の指摘「歩くたびにバウンドするのは不自然」。腰の上下は 3cm 以内。tests/motion-replacement.test.ts）
 */
interface WalkCarry { lean: number; shift: number; twist: number; roll: number; lag: number; swing: number }
const WALK_CARRY: Record<string, WalkCarry> = {
  heavy_blade: { lean: 5, shift: 0.02, twist: 5, roll: 2.5, lag: 3, swing: 0 },
  war_maul: { lean: 4, shift: 0.02, twist: 5, roll: 2.5, lag: 3, swing: 0 },
  long_lance: { lean: 3, shift: 0.018, twist: 3, roll: 2, lag: 1.8, swing: 0 },
  long_blade: { lean: 2, shift: 0.015, twist: 7, roll: 1.5, lag: 1.4, swing: 0 },
  guard_blade: { lean: 2, shift: 0.014, twist: 7, roll: 1.5, lag: 1.2, swing: 0.035 },
  twin_blades: { lean: 4, shift: 0.012, twist: 8, roll: 1.5, lag: 1.2, swing: 0.06 },
  ring_bow: { lean: 1, shift: 0.014, twist: 6, roll: 1.5, lag: 1, swing: 0.03 },
};
const WALK_CARRY_DEFAULT: WalkCarry = { lean: 2, shift: 0.015, twist: 5, roll: 1.5, lag: 1.2, swing: 0 };

/** 状態が替わった時に、直前の姿から混ぜる時間（秒） */
const BLEND_SEC = 0.08;
/** 弓: 溜めるほど深く引く（引く長さに掛ける割増と、引き切るまでの tick） */
const CHARGE_PULL = 0.12, CHARGE_TICKS = 36;

export interface AnimContext {
  root?: RenderRoot;
  /** 判定が有効な tick は、ブレンドせずに正本の軌道へ一致させる。 */
  active?: boolean;
  frozen?: boolean;
  /** 手で狙っている間の狙いの上下（v0.61.0。環弓。ラジアン、上が正）。背と胸を反らす・かがめる（見た目だけ） */
  aimPitch?: number;
}

interface Frame {
  ctl: Ctl;
  fL: Foot;
  fR: Foot;
}

export class HunterAnimator {
  private last: Frame | null = null;
  private from: Frame | null = null;
  private key = '';
  private blendT = 1;
  /** 手で狙う時の、背と胸の反らし（狙いの上下へ滑らかに寄せる。v0.61.0） */
  private aimLean = 0;
  private phase = 0;
  private contact = new ContactLocomotion();
  private previousRoot: RenderRoot | null = null;
  /** 歩いている間に、足が届くように腰をさらに落とした量（m） */
  private sag = 0;

  constructor(phase = 0) { this.phase = phase; }

  /** 解ける状態を抜けた（被弾・納刀など）。次に入る時は、直前の姿から混ぜない。 */
  reset(): void {
    this.last = null;
    this.from = null;
    this.key = '';
    this.contact.reset();
    this.previousRoot = null;
    this.sag = 0;
  }

  /** 直前のフレームも、ここで解いた姿だったか */
  get continuing(): boolean {
    return this.last !== null;
  }

  /**
   * 1 フレームぶん解く。key は状態の名前（替わった時に混ぜ始める）。moveSpeed は m/秒。
   * 返り値の姿勢・武器・盾を、applySolved でリグへ渡す。
   */
  frame(familyId: string, st: AnimState, key: string, dt: number, moveSpeed: number, time: number, context: AnimContext = {}): Solved {
    dt = context.frozen ? 0 : Math.max(0, dt);
    if (context.root && this.previousRoot && dt > 0 && dt < 0.2) {
      const distance = Math.hypot(context.root.x - this.previousRoot.x, context.root.z - this.previousRoot.z);
      if (distance < 1.2) moveSpeed = Math.min(7, distance / dt);
    }
    if (context.root) this.previousRoot = { ...context.root };
    const S = WEAPON_STANCES[familyId]!;
    const idle = S.idle;
    let f: Frame;
    let walk = 0;
    if (st.kind === 'action') {
      const m = WEAPON_MOTIONS[st.clip]!;
      const e = evalMotion(m, Math.min(st.t, m.dur), st.dirAngle);
      f = { ctl: e.ctl, fL: e.footL, fR: e.footR };
      if (S.hands.second === 'string' && st.chargeTicks > 0) f.ctl.pull = [(f.ctl.pull[0] ?? 0) * (1 + CHARGE_PULL * smooth(st.chargeTicks / CHARGE_TICKS))];
      if (st.freeMove && !context.active) walk = smooth((moveSpeed - 0.1) / 0.5);
    } else if (st.kind === 'guard') {
      const g = S.guard!;
      const u = smooth(st.blend);
      f = { ctl: mixCtl(idle.ctl, g.ctl, u), fL: mixFoot(idle.feet.L, g.feet.L, u), fR: mixFoot(idle.feet.R, g.feet.R, u) };
      f.ctl.spine = [f.ctl.spine[0]! + 6 * st.shake, f.ctl.spine[1]!, f.ctl.spine[2]!];
      f.ctl.hip = [f.ctl.hip[0]!, f.ctl.hip[1]! - 0.02 * st.shake, f.ctl.hip[2]! - 0.04 * st.shake];
      // 構え歩き（v0.59.0。2G のランス）: 構えたまま歩く時は、防御の足の置き方から足を運ぶ
      if (st.blend >= 1) walk = smooth((moveSpeed - 0.1) / 0.5);
    } else {
      f = { ctl: mixCtl(idle.ctl, idle.ctl, 0), fL: idle.feet.L.slice() as Foot, fR: idle.feet.R.slice() as Foot };
      const breathe = Math.sin(time * 1.7);
      f.ctl.chest = [f.ctl.chest[0]! + breathe * 1.2, f.ctl.chest[1]!, f.ctl.chest[2]!];
      f.ctl.hip = [f.ctl.hip[0]!, f.ctl.hip[1]! + Math.sin(time * 1.7 - 0.3) * 0.004, f.ctl.hip[2]!];
      walk = smooth((moveSpeed - 0.1) / 0.5);
    }
    // 歩く: 足を交互に運ぶ。腰は進む方へ少し戻し、その分だけ背でひねり直す（胸と腕の向きは変えない）
    if (walk > 0) {
      const stride = strideOf(moveSpeed);
      this.phase += (moveSpeed * dt * Math.PI * 2) / stride;
      const base = st.kind === 'guard' && S.guard ? S.guard.feet : idle.feet;
      const g = gaitFeet(this.phase, stride, base.L, base.R);
      f.fL = mixFoot(f.fL, g.L, walk);
      f.fR = mixFoot(f.fR, g.R, walk);
      const back = f.ctl.hipR[1]! * 0.4 * walk;
      f.ctl.hipR = [f.ctl.hipR[0]! + 3 * walk, f.ctl.hipR[1]! - back, f.ctl.hipR[2]!];
      f.ctl.spine = [f.ctl.spine[0]!, f.ctl.spine[1]! + back, f.ctl.spine[2]!];
      f.ctl.hip = [f.ctl.hip[0]!, f.ctl.hip[1]! + g.bob * walk, f.ctl.hip[2]!];
      // 抜刀中の歩き（v0.71.0。D-169）: 左足が前へ着く所を位相 0 とする（gaitFeet と同じ）。防御のまま歩く時は半分。保留の組 v056 は動かさない
      if (MOTION_STYLE.style !== 'v056') {
        const C = WALK_CARRY[familyId] ?? WALK_CARRY_DEFAULT;
        const k = walk * (st.kind === 'guard' ? 0.5 : 1);
        const c1 = Math.cos(this.phase);
        const c = f.ctl;
        c.hip = [c.hip[0]! + C.shift * c1 * k, c.hip[1]!, c.hip[2]!];
        c.hipR = [c.hipR[0]!, c.hipR[1]! - C.twist * c1 * k, c.hipR[2]! + C.roll * 0.5 * c1 * k];
        c.spine = [c.spine[0]! + C.lean * k, c.spine[1]! + C.twist * 0.55 * c1 * k, c.spine[2]! - C.roll * c1 * k];
        c.chest = [c.chest[0]! + C.lag * Math.cos(2 * this.phase - 1.4) * k, c.chest[1]! + C.twist * 0.35 * c1 * k, c.chest[2]!];
        if (C.swing > 0) {
          // 右手（左手が主の環弓は左手）は、左足が前の時に前へ。双剣の左の剣は、その逆
          const sw = C.swing * c1 * k * (S.hands.primary === 'L' ? -1 : 1);
          c.grip = [c.grip[0]!, c.grip[1]!, c.grip[2]! + sw];
          if (S.hands.second === 'blade') c.off = [c.off[0]!, c.off[1]!, c.off[2]! - sw];
        }
      }
    }
    // 状態が替わった瞬間は、直前の姿から短く混ぜる（手は武器に、足は地面に付いたまま混ざる）
    if (key !== this.key) {
      this.key = key;
      this.from = this.last;
      this.blendT = 0;
    }
    this.blendT += dt;
    const w = context.active ? 1 : Math.min(1, this.blendT / BLEND_SEC);
    if (w < 1 && this.from) {
      const u = smooth(w);
      f = { ctl: mixCtl(this.from.ctl, f.ctl, u), fL: mixFoot(this.from.fL, f.fL, u), fR: mixFoot(this.from.fR, f.fR, u) };
    }
    // 手で狙う（v0.61.0。環弓）: 狙いの上下に合わせて、背と胸を反らす・かがめ、顔を上げ下げする（見た目だけ。矢は simulation の狙いの線へ飛ぶ）
    this.aimLean += ((context.aimPitch ?? 0) - this.aimLean) * Math.min(1, dt * 12);
    if (Math.abs(this.aimLean) > 1e-4 && !context.active) {
      const d = (this.aimLean * 180) / Math.PI;
      const c = f.ctl;
      f = { ...f, ctl: { ...c, spine: [c.spine[0]! - d * 0.35, c.spine[1]!, c.spine[2]!], chest: [c.chest[0]! - d * 0.5, c.chest[1]!, c.chest[2]!], look: [c.look[0]!, c.look[1]! - d * 0.3] } };
    }
    // 足を世界座標へ留める処理は、通常歩行だけ。攻撃中の判定軌道は変えない。
    if (context.root && (st.kind === 'idle' || (st.kind === 'guard' && walk > 0.01))) {
      const grounded = this.contact.frame(context.root, f.fL, f.fR, dt, walk > 0.01);
      // 坂（v0.47.0）: それぞれの足の下の地面の高さへ
      fitFeetToGround(context.root, grounded.L, grounded.R);
      f.fL = grounded.L; f.fR = grounded.R;
    } else this.contact.reset();
    this.last = f;
    // 歩いている間（v0.28.1）: 足が届かずに腰を落とした分は、次のフレームでゆっくり戻す（腰が跳ね上がらない）
    if ((st.kind === 'idle' || st.kind === 'guard') && walk > 0) {
      this.sag = Math.max(0, this.sag - 0.3 * Math.min(dt, 0.1));
      const solved = solveBody({ ...f.ctl, hip: [f.ctl.hip[0]!, f.ctl.hip[1]! - this.sag, f.ctl.hip[2]!] }, f.fL, f.fR, S.hands);
      this.sag = Math.max(0, f.ctl.hip[1]! - solved.pose.py);
      return solved;
    }
    this.sag = 0;
    return solveBody(f.ctl, f.fL, f.fR, S.hands);
  }
}

/** 混ぜずに、その場で 1 つの状態を解く（素材ビューア・検査用）。 */
export function solveState(familyId: string, st: AnimState, moveSpeed = 0, time = 0): Solved {
  // 絶対時刻から周期を決める。以前は毎回 dt=1 から始まり、全て同じ脚の位相を検査していた。
  const phase = moveSpeed * Math.max(0, time) * Math.PI * 2 / strideOf(moveSpeed);
  return new HunterAnimator(phase).frame(familyId, st, '', 0, moveSpeed, time);
}

/** 解いた結果を、リグへ渡す。familyId は、左手のものを持っていない時の置き場所を決めるのに使う。 */
export function applySolved(rig: HunterRig, s: Solved, familyId: string): void {
  rig.setPose(s.pose);
  rig.placeWeapon(s.weapon.grip, s.weapon.dir, s.weapon.normal);
  if (s.shield) rig.placeShield(s.shield.pos, s.shield.quat);
  else stowOffhand(rig, familyId);
  rig.setString(s.string);
  rig.placeHandArrow(s.held);
}

/** 左手のもの（盾・双剣のもう 1 本）を、納めた時の置き場所へ付ける。姿勢を設定した後に呼ぶ。 */
export function stowOffhand(rig: HunterRig, familyId: string): void {
  const sh = WEAPON_STANCES[familyId]?.sheath2;
  if (sh) rig.shieldToSheath(sh);
  else rig.shieldToBack();
}
