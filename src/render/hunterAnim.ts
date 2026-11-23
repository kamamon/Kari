// 護刃・旋鎌・長尖槍・環弓の体の動かし方。技の動き・構え・防御・歩きを、同じ解き方（bodySolve.ts）へ通す。
// ゲームの画面（view.ts）と素材ビューア（viewer.ts）と検査（tests/human-motion.test.ts）が、ここを使う。
import { evalMotion, gaitFeet, mixCtl, mixFoot, solveBody, type Ctl, type Foot, type Solved } from './bodySolve';
import type { HunterRig } from './rig';
import { WEAPON_MOTIONS, WEAPON_STANCES } from './weaponClipSpecs';

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
const strideOf = (speed: number): number => Math.min(1.3, Math.max(0.7, 0.6 + 0.25 * speed));
/** 状態が替わった時に、直前の姿から混ぜる時間（秒） */
const BLEND_SEC = 0.08;
/** 弓: 溜めるほど深く引く（引く長さに掛ける割増と、引き切るまでの tick） */
const CHARGE_PULL = 0.12, CHARGE_TICKS = 36;

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
  private phase = 0;

  /** 解ける状態を抜けた（被弾・納刀など）。次に入る時は、直前の姿から混ぜない。 */
  reset(): void {
    this.last = null;
    this.from = null;
    this.key = '';
  }

  /** 直前のフレームも、ここで解いた姿だったか */
  get continuing(): boolean {
    return this.last !== null;
  }

  /**
   * 1 フレームぶん解く。key は状態の名前（替わった時に混ぜ始める）。moveSpeed は m/秒。
   * 返り値の姿勢・武器・盾を、applySolved でリグへ渡す。
   */
  frame(familyId: string, st: AnimState, key: string, dt: number, moveSpeed: number, time: number): Solved {
    const S = WEAPON_STANCES[familyId]!;
    const idle = S.idle;
    let f: Frame;
    let walk = 0;
    if (st.kind === 'action') {
      const m = WEAPON_MOTIONS[st.clip]!;
      const e = evalMotion(m, Math.min(st.t, m.dur), st.dirAngle);
      f = { ctl: e.ctl, fL: e.footL, fR: e.footR };
      if (S.hands.second === 'string' && st.chargeTicks > 0) f.ctl.pull = [(f.ctl.pull[0] ?? 0) * (1 + CHARGE_PULL * smooth(st.chargeTicks / CHARGE_TICKS))];
      if (st.freeMove) walk = smooth((moveSpeed - 0.1) / 0.5);
    } else if (st.kind === 'guard') {
      const g = S.guard!;
      const u = smooth(st.blend);
      f = { ctl: mixCtl(idle.ctl, g.ctl, u), fL: mixFoot(idle.feet.L, g.feet.L, u), fR: mixFoot(idle.feet.R, g.feet.R, u) };
      f.ctl.spine = [f.ctl.spine[0]! + 6 * st.shake, f.ctl.spine[1]!, f.ctl.spine[2]!];
      f.ctl.hip = [f.ctl.hip[0]!, f.ctl.hip[1]! - 0.02 * st.shake, f.ctl.hip[2]! - 0.04 * st.shake];
    } else {
      f = { ctl: mixCtl(idle.ctl, idle.ctl, 0), fL: idle.feet.L.slice() as Foot, fR: idle.feet.R.slice() as Foot };
      const breathe = Math.sin(time * 1.7);
      f.ctl.chest = [f.ctl.chest[0]! + breathe * 1.2, f.ctl.chest[1]!, f.ctl.chest[2]!];
      f.ctl.hip = [f.ctl.hip[0]!, f.ctl.hip[1]! + breathe * 0.004, f.ctl.hip[2]!];
      walk = smooth((moveSpeed - 0.1) / 0.5);
    }
    // 歩く: 足を交互に運ぶ。腰は進む方へ少し戻し、その分だけ背でひねり直す（胸と腕の向きは変えない）
    if (walk > 0) {
      const stride = strideOf(moveSpeed);
      this.phase += (moveSpeed * dt * Math.PI * 2) / stride;
      const g = gaitFeet(this.phase, stride, idle.feet.L, idle.feet.R);
      f.fL = mixFoot(f.fL, g.L, walk);
      f.fR = mixFoot(f.fR, g.R, walk);
      const back = f.ctl.hipR[1]! * 0.4 * walk;
      f.ctl.hipR = [f.ctl.hipR[0]! + 3 * walk, f.ctl.hipR[1]! - back, f.ctl.hipR[2]!];
      f.ctl.spine = [f.ctl.spine[0]!, f.ctl.spine[1]! + back, f.ctl.spine[2]!];
      f.ctl.hip = [f.ctl.hip[0]!, f.ctl.hip[1]! + g.bob * walk, f.ctl.hip[2]!];
    }
    // 状態が替わった瞬間は、直前の姿から短く混ぜる（手は武器に、足は地面に付いたまま混ざる）
    if (key !== this.key) {
      this.key = key;
      this.from = this.last;
      this.blendT = 0;
    }
    this.blendT += dt;
    const w = Math.min(1, this.blendT / BLEND_SEC);
    if (w < 1 && this.from) {
      const u = smooth(w);
      f = { ctl: mixCtl(this.from.ctl, f.ctl, u), fL: mixFoot(this.from.fL, f.fL, u), fR: mixFoot(this.from.fR, f.fR, u) };
    }
    this.last = f;
    return solveBody(f.ctl, f.fL, f.fR, S.hands);
  }
}

/** 混ぜずに、その場で 1 つの状態を解く（素材ビューア・検査用）。 */
export function solveState(familyId: string, st: AnimState, moveSpeed = 0, time = 0): Solved {
  return new HunterAnimator().frame(familyId, st, '', 1, moveSpeed, time);
}

/** 解いた結果を、リグへ渡す。 */
export function applySolved(rig: HunterRig, s: Solved): void {
  rig.setPose(s.pose);
  rig.placeWeapon(s.weapon.grip, s.weapon.dir, s.weapon.normal);
  if (s.shield) rig.placeShield(s.shield.pos, s.shield.quat);
  else rig.shieldToBack();
  rig.setString(s.string);
}
