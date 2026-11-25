// 描画専用。simulation の位置・yaw・攻撃軌道は変更しない。
// 足首ではなく母指球を世界座標へ留める。停止/方向転換で届かなくなる足は、滑らせずに踏み替える。
import { fillCtl, mixFoot, solveBody, type BodyPose, type Foot, type Hands } from './bodySolve';

export interface RenderRoot { x: number; z: number; yaw: number }
interface Point { x: number; z: number; yaw: number }
interface Swing { from: Point; to: Point; elapsed: number; duration: number; lift: number }
interface FootState { at: Point; lift: number; contact: boolean; swing: Swing | null }
const BALL = 0.13, DEG = Math.PI / 180;
const clamp = (x: number, a: number, b: number): number => Math.max(a, Math.min(b, x));
const smooth = (x: number): number => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
const angle = (a: number, b: number): number => Math.atan2(Math.sin(b - a), Math.cos(b - a));

/** 足の母指球。world-space contact の検査にも使う。 */
export function footContactWorld(f: Foot, r: RenderRoot): Point {
  const fy = f[3] * DEG;
  const x = f[0] + Math.sin(fy) * BALL, z = f[2] + Math.cos(fy) * BALL;
  const c = Math.cos(r.yaw), s = Math.sin(r.yaw);
  return { x: r.x + x * c + z * s, z: r.z - x * s + z * c, yaw: r.yaw + fy };
}
function local(at: Point, lift: number, heel: number, r: RenderRoot): Foot {
  const c = Math.cos(r.yaw), s = Math.sin(r.yaw), dx = at.x - r.x, dz = at.z - r.z;
  const yaw = angle(r.yaw, at.yaw);
  return [dx * c - dz * s - Math.sin(yaw) * BALL, lift, dx * s + dz * c - Math.cos(yaw) * BALL, yaw / DEG, heel];
}

export class ContactLocomotion {
  private feet: [FootState, FootState] | null = null;
  private root: RenderRoot | null = null;
  private released: { from: [FootState, FootState]; age: number } | null = null;
  reset(): void { this.feet = null; this.root = null; this.released = null; }

  frame(root: RenderRoot, desiredL: Foot, desiredR: Foot, dt: number, moving: boolean): { L: Foot; R: Foot } {
    const desired = [desiredL, desiredR] as const;
    // エリア移動・ビューアの飛び先は補間しない。大きい dt も再入場として扱う。
    if (!this.feet || !this.root || Math.hypot(root.x - this.root.x, root.z - this.root.z) > 1.2 || dt > 0.2) {
      this.feet = desired.map((f) => ({ at: footContactWorld(f, root), lift: f[1], contact: f[1] <= 0.004, swing: null })) as [FootState, FootState];
    }
    const stepDt = clamp(dt, 0, 0.1);
    const feet = this.feet;
    const dx = this.root ? root.x - this.root.x : 0, dz = this.root ? root.z - this.root.z : 0;
    const distance = Math.hypot(dx, dz);
    const directionError = distance > 0.0001 ? Math.abs(angle(root.yaw, Math.atan2(dx, dz))) : 0;
    const turnSpeed = this.root && stepDt > 0 ? Math.abs(angle(this.root.yaw, root.yaw)) / stepDt : 0;
    const overextended = feet.some((state) => {
      const f = local(state.at, state.lift, 0, root);
      return Math.hypot(f[0], f[2]) > 0.52;
    });
    const release = moving && (directionError > 0.45 || turnSpeed > 2.6 || overextended);
    if (release && !this.released) {
      this.released = { from: feet.map((f) => ({ ...f, at: { ...f.at }, swing: null })) as [FootState, FootState], age: 0 };
    }
    if (this.released) {
      // Controller は向きが追いつく前に反対方向へ動ける。足を固定したまま脚を伸ばさず、
      // 80ms の足上げを経て安全な歩行へ戻す。この間は世界接地を保証しない。
      const rel = this.released;
      rel.age += stepDt;
      const u = clamp(rel.age / 0.08, 0, 1), w = smooth(u);
      const result = desired.map((f, i) => {
        const old = rel.from[i]!;
        const p = mixFoot(local(old.at, old.lift, 0, root), f, w);
        p[1] = Math.max(p[1], 0.07 * Math.sin(Math.PI * u));
        // 足上げ中の届き方にも上限を設ける。通常の歩行の範囲から外へ引っ張らない。
        p[0] = i === 0 ? clamp(p[0], 0.055, 0.23) : clamp(p[0], -0.23, -0.055);
        p[2] = clamp(p[2], -0.44, 0.44);
        return p;
      });
      this.feet = result.map((f) => ({ at: footContactWorld(f, root), lift: f[1], contact: f[1] <= 0.004, swing: null })) as [FootState, FootState];
      this.root = { ...root };
      if (!release && u >= 1) this.released = null;
      return { L: result[0]!, R: result[1]! };
    }
    const out: Foot[] = [];
    let stepping = feet.some((f) => !!f.swing);
    for (let i = 0; i < 2; i++) {
      const f = desired[i]!, state = feet[i]!, target = footContactWorld(f, root);
      const nominalSwing = moving && f[1] > 0.004;
      if (!state.swing && nominalSwing) {
        // 普通の遊脚は、距離から進めた歩行周期を使う。接地した側の足は動かさない。
        state.at = target;
        state.lift = f[1];
        state.contact = false;
      } else if (!state.swing && !state.contact) {
        if (moving) {
          state.at = target;
          state.lift = 0;
          state.contact = true;
        } else if (!stepping) {
          // 入力を離した瞬間に、空中の足を地面へ瞬間移動させない。
          state.swing = { from: { ...state.at }, to: target, elapsed: 0, duration: 0.16, lift: state.lift };
          stepping = true;
        }
      }
      if (!state.swing && state.contact && !stepping && !nominalSwing && !moving) {
        const error = Math.hypot(target.x - state.at.x, target.z - state.at.z);
        if (error > 0.075 || Math.abs(angle(state.at.yaw, target.yaw)) > 24 * DEG) {
          state.swing = { from: { ...state.at }, to: target, elapsed: 0, duration: clamp(error / 1.7, 0.16, 0.3), lift: 0 };
          state.contact = false;
          stepping = true;
        }
      }
      if (state.swing) {
        const sw = state.swing;
        sw.elapsed += stepDt;
        const u = clamp(sw.elapsed / sw.duration, 0, 1), w = smooth(u);
        state.at = { x: sw.from.x + (sw.to.x - sw.from.x) * w, z: sw.from.z + (sw.to.z - sw.from.z) * w, yaw: sw.from.yaw + angle(sw.from.yaw, sw.to.yaw) * w };
        state.lift = sw.lift * (1 - w) + 0.065 * Math.sin(Math.PI * u);
        if (u >= 1) { state.swing = null; state.contact = true; state.lift = 0; }
      }
      let heel = state.contact ? f[4] : 0;
      if (moving && state.contact) {
        const turn = angle(state.at.yaw, target.yaw);
        if (Math.abs(turn) > 12 * DEG) {
          // 急に向きを変えた時は母指球を軸に踵を回す。世界座標の接地点は同じ。
          state.at.yaw += clamp(turn, -8 * stepDt, 8 * stepDt);
          heel = Math.max(heel, 18);
        }
      }
      out.push(local(state.at, state.lift, heel, root));
    }
    this.root = { ...root };
    return { L: out[0]!, R: out[1]! };
  }
}

const FREE_HANDS: Hands = { primary: 'R', second: 'free', wrist: [0, 180] };
/** 接地率に歩幅を合わせる。run=1 では両足が短く浮く走りになり、歩幅だけを過大にしない。 */
export function travelGait(phase: number, stride: number, L: Foot, R: Foot, run = 0): { L: Foot; R: Foot; bob: number } {
  const duty = 0.6 - 0.28 * clamp(run, 0, 1), half = stride * duty * 0.5;
  const one = (ph: number, base: Foot): Foot => {
    const u = ((ph / (Math.PI * 2)) % 1 + 1) % 1;
    if (u < duty) {
      const k = u / duty;
      const heel = k < 0.18 ? -16 * (1 - k / 0.18) : k > 0.74 ? 24 * ((k - 0.74) / 0.26) : 0;
      return [base[0], 0, half - stride * u, base[3] * 0.4, heel];
    }
    const s = (u - duty) / (1 - duty);
    return [base[0], (0.09 + run * 0.12) * Math.sin(Math.PI * s), -half + 2 * half * smooth(s), base[3] * 0.4, 0];
  };
  return { L: one(phase, L), R: one(phase + Math.PI, R), bob: 0.012 * Math.cos(phase * 2) };
}
/** 既存の上体を保ち、脚と骨盤だけを二本骨 IK で地面へ合わせる。 */
export function groundLowerBody(pose: BodyPose, L: Foot, R: Foot, hipYaw = 0, hipRoll = 0): BodyPose {
  let solved = solveBody(fillCtl({ hip: [pose.px ?? 0, pose.py, pose.pz ?? 0], hipR: [0, hipYaw, hipRoll], grab: [0], on: [0] }), L, R, FREE_HANDS);
  // 今の靴は toe 骨が無い一枚の剛体。母指球 .13m より先の .19m を地面へ埋めない。
  // 初回で求めた骨盤は保持し、靴をつま先/踵の接触高さへ戻して膝だけを解き直す。
  const sole = (f: Foot, heel: number): Foot => {
    const extra = heel >= 0 ? 0.06 * Math.sin(heel * DEG) : -0.01 * Math.sin(heel * DEG);
    return [f[0], f[1] + Math.max(0, extra) + 0.004, f[2], f[3], heel];
  };
  const sl = sole(L, solved.frames.heelL), sr = sole(R, solved.frames.heelR);
  solved = solveBody(fillCtl({ hip: [solved.pose.px ?? 0, solved.pose.py, solved.pose.pz ?? 0], hipR: [0, hipYaw, hipRoll], grab: [0], on: [0] }), sl, sr, FREE_HANDS);
  const p = { ...pose, j: { ...pose.j }, px: solved.pose.px, py: solved.pose.py, pz: solved.pose.pz, grounded: true };
  for (const name of ['pelvis', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'] as const) p.j[name] = solved.pose.j[name];
  return p;
}

/** 納刀中（全 7 系統）と断岳剣の通常歩行。武器の判定時刻には呼ばない。 */
export class GroundedLocomotion {
  private contact = new ContactLocomotion();
  reset(): void { this.contact.reset(); }
  frame(pose: BodyPose, drawn: boolean, speed: number, phase: number, dt: number, root: RenderRoot): BodyPose {
    const L: Foot = drawn ? [0.11, 0, 0.18, 6, 0] : [0.105, 0, 0, 5, 0];
    const R: Foot = drawn ? [-0.13, 0, -0.16, -28, 0] : [-0.105, 0, 0, -5, 0];
    const moving = speed > 0.15;
    const stride = drawn ? 1.35 : 1.7 + 0.9 * Math.min(1, speed / 6.4);
    const run = drawn ? 0 : smooth((speed - 3.5) / 2.9);
    const g = moving ? travelGait(phase, stride, L, R, run) : { L, R, bob: 0 };
    const f = this.contact.frame(root, g.L, g.R, dt, moving);
    const w = smooth((speed - 0.15) / 1.0), yaw = 2.2 * Math.sin(phase) * w, roll = 1.1 * Math.sin(phase) * w;
    const out = groundLowerBody(pose, f.L, f.R, yaw, roll);
    // 腰と胸は逆方向へ。頭と武器の向きを大きく振らない。
    out.j.spine = [pose.j.spine[0], pose.j.spine[1] - yaw * 0.65, pose.j.spine[2] - roll * 0.65];
    return out;
  }
}
