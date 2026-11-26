// 人の体の解き方（純粋な計算だけ）。骨盤・背・胸の向きと、足を置く場所、手の行き先から、全関節の角度を出す。
// - 足は地面の決めた場所へ置き、ひざを逆算する（足が滑らない・浮かない）。届かない時は、かかとを上げ、腰を落とす。
// - 腕は握りへ逆算する。盾は前腕に固定され、弓の弦は右手が引く。
// - 出した姿勢は humanLimits.ts が「人にできる範囲か」を調べる。
// このファイルは相対 import を持たず、消せる型だけで書く（tools/gen-weapons.mjs が Node で直接読むため）。
// 単位 m・度。アクターのローカル座標: Y 上、+Z 前、+X 左（右手側は -X）。yaw は + で左を向く。pitch は + で前へ倒す。

export const REST = {
  pelvisY: 0.92, spineY: 1.02, chestY: 1.18, neckY: 1.52, headY: 1.58,
  shoulderX: 0.185, shoulderY: 1.46, upperArm: 0.29, forearm: 0.27,
  hipX: 0.095, hipY: 0.88, thigh: 0.43, shin: 0.41,
  /** 頭のてっぺん（全高） */
  top: 1.75,
} as const;

export const JOINTS = [
  'pelvis', 'spine', 'chest', 'neck', 'head',
  'upperArmL', 'forearmL', 'handL', 'upperArmR', 'forearmR', 'handR',
  'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR',
] as const;
export type JointName = (typeof JOINTS)[number];
export type JRot = [number, number, number];
export type Vec = [number, number, number];
export type Quat = [number, number, number, number];

export interface BodyPose {
  j: Record<JointName, JRot>;
  /** 骨盤の上下 (m) */
  py: number;
  /** 骨盤の左右・前後 (m)。無い時は 0。 */
  px?: number;
  pz?: number;
  /** 足の接地を解き終えている（リグ側で骨盤を上下させて合わせ直さない） */
  grounded?: boolean;
  /** 体全体の前転角（度）と、その向き（向きに対する相対角・ラジアン） */
  tumble: number;
  tumbleDir: number;
  /** 回転の中心を下げる量 (m)。倒れた時に地面へ寝かせる。 */
  drop: number;
}

// ---- ベクトルと四元数 ----
const D2R = Math.PI / 180;
export const vadd = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const vsub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const vmul = (a: Vec, s: number): Vec => [a[0] * s, a[1] * s, a[2] * s];
export const vdot = (a: Vec, b: Vec): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const vcross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const vlen = (a: Vec): number => Math.hypot(a[0], a[1], a[2]);
export const vnorm = (a: Vec, fallback: Vec = [0, 1, 0]): Vec => {
  const l = vlen(a);
  return l < 1e-9 ? [fallback[0], fallback[1], fallback[2]] : [a[0] / l, a[1] / l, a[2] / l];
};
export const vlerp = (a: Vec, b: Vec, u: number): Vec => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
/** 2 つの向きのなす角（度） */
export const vangle = (a: Vec, b: Vec): number => Math.acos(clamp(vdot(vnorm(a), vnorm(b)), -1, 1)) / D2R;

export const qmul = (a: Quat, b: Quat): Quat => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
export const qconj = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];
export const qrot = (q: Quat, v: Vec): Vec => {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
};
const qaxis = (ax: 0 | 1 | 2, deg: number): Quat => {
  const h = (deg * D2R) / 2;
  const q: Quat = [0, 0, 0, Math.cos(h)];
  q[ax] = Math.sin(h);
  return q;
};
/** [pitch, yaw, roll]（度）。yaw を外側に掛ける（向きを決めてから、その向きのまま前後・左右へ倒す）。 */
export const qpyr = (r: readonly number[]): Quat => qmul(qmul(qaxis(1, r[1] ?? 0), qaxis(0, r[0] ?? 0)), qaxis(2, r[2] ?? 0));
/** 軸 x・y・z（正規直交）から四元数 */
export function qbasis(x: Vec, y: Vec, z: Vec): Quat {
  const m00 = x[0], m01 = y[0], m02 = z[0], m10 = x[1], m11 = y[1], m12 = z[1], m20 = x[2], m21 = y[2], m22 = z[2];
  const tr = m00 + m11 + m22;
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1);
    return [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s];
  }
  if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    return [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  }
  if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    return [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  }
  const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
  return [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
}
/** three.js の Euler（XYZ 順）と同じ角度（度）へ */
export function qeuler(q: Quat): JRot {
  const cx = qrot(q, [1, 0, 0]), cy = qrot(q, [0, 1, 0]), cz = qrot(q, [0, 0, 1]);
  const m13 = cz[0];
  const y = Math.asin(clamp(m13, -1, 1));
  if (Math.abs(m13) < 0.9999999) return [Math.atan2(-cz[1], cz[2]) / D2R, y / D2R, Math.atan2(-cy[0], cx[0]) / D2R];
  return [Math.atan2(cy[2], cy[1]) / D2R, y / D2R, 0];
}

// ---- 動きのデータ ----
/** 足の置き方: [x, 浮かせる高さ, z, つま先の向き(度), かかとの上げ(度)] */
export type Foot = [number, number, number, number, number];
/** 1 歩: [離す tick, 着く tick, x, z, つま先の向き, 上げる高さ, 軸足として回るか(1/0)]。最初の 1 件は初めの立ち位置。 */
export type Step = readonly [number, number, number, number, number, number?, number?];

/** 体を決める値のひとまとまり（1 つの時刻ぶん）。胸の座標 = 両肩の中点が原点で、胸の向きに合わせた軸。 */
export interface Ctl {
  /** 骨盤のずれ [左右, 上下, 前後] と向き [pitch, yaw, roll] */
  hip: number[];
  hipR: number[];
  spine: number[];
  chest: number[];
  /** 顔の向き [yaw, pitch]（アクターの正面が 0） */
  look: number[];
  /** 握り・武器の向き・刃の向く方（胸の座標） */
  grip: number[];
  dir: number[];
  edge: number[];
  /** もう片方の手の行き先と、盾の表が向く方（胸の座標）。使い方は持ち方で決まる。双剣では、offN が左の剣の向き、offE がその刃の向く方。 */
  off: number[];
  offN: number[];
  offE: number[];
  /** ひじを出す方（胸の座標。全部 0 なら自動） */
  elbowR: number[];
  elbowL: number[];
  /** 弓: 弦を引いた長さ (m) と、矢をつがえているか (0〜1) */
  pull: number[];
  arrow: number[];
  /** もう片方の手が仕事をしている度合い (0〜1): 柄 = 添えている / 弓 = 右手が弦に掛かっている / 盾 = 盾を腕に通している（0.5 未満は背中） */
  on: number[];
  /** 武器を握っている度合い (0〜1)。0 では、手は体の横に下がる（納刀中） */
  grab: number[];
  /** 弓: 弦を引く手が、矢を握っている (0〜1。0.5 以上で握る)。近接（v0.60.0。2G の弓の ○）で矢を振る。保留の組の動きには無い（無ければ 0） */
  hold?: number[];
}
export type Channel = keyof Ctl;
export const CHANNELS: readonly Channel[] = ['hip', 'hipR', 'spine', 'chest', 'look', 'grip', 'dir', 'edge', 'off', 'offN', 'offE', 'elbowR', 'elbowL', 'pull', 'on', 'arrow', 'grab', 'hold'];
const DEFAULT_CTL: Ctl = {
  hip: [0, 0, 0], hipR: [0, 0, 0], spine: [0, 0, 0], chest: [0, 0, 0], look: [0, 0],
  grip: [-0.2, -0.45, 0.25], dir: [0, 0.8, 0.6], edge: [0, -0.6, 0.8],
  off: [0.2, -0.5, 0.1], offN: [0, 0, 1], offE: [0, -0.6, 0.8], elbowR: [0, 0, 0], elbowL: [0, 0, 0], pull: [0], on: [0], arrow: [0], grab: [1], hold: [0],
};
/** 何も持たない手が下がる位置（胸の座標。side は 左 +1 / 右 -1） */
export const hangHand = (side: number): Vec => [side * 0.235, -0.555, 0.07];

/** 持ち方（武器系統ごと） */
export interface Hands {
  /** 武器を握る手 */
  primary: 'R' | 'L';
  /** もう片方の手: along = 同じ柄を握る / shield = 盾（前腕に固定）/ string = 弓の弦 / blade = もう 1 本の剣（双剣）/ free = 何も持たない */
  second: 'along' | 'shield' | 'string' | 'blade' | 'free';
  /** along: 握りから何 m 先を握るか */
  along?: number;
  /** shield: 盾のローカル座標での、手が握る取っ手の位置 */
  shieldGrip?: Vec;
  /** string: 弓のローカル座標での、引く前の弦の位置（y, z） */
  stringAt?: [number, number];
  /** string: 弦に掛けるのは指先。手のひら（腕を解く先）は、弦からこの長さ (m) だけ肩の側に置く */
  stringFinger?: number;
  /** 手首: 前腕と武器のなす角の許す範囲（度） */
  wrist: [number, number];
}

/** 1 つの動き。ch は チャンネルごとの [tick, 値...] の並び。 */
export interface Motion {
  dur: number;
  family: string;
  /** 始まりの姿。キーの無いチャンネルは、この値のまま。 */
  base: Ctl;
  /** 前へ進む量 [tick, 累積 m]（技の移動曲線と同じ値） */
  root?: readonly (readonly [number, number])[];
  /** 体ごと回る（技の spin と同じ値） */
  spin?: { from: number; to: number; degrees: number };
  /** 武器が体に触れていてよい区間（背や腰に納めてある間・抜き差しの間）。検査だけが使う。 */
  skipBody?: readonly [number, number] | null;
  ch: Partial<Record<Channel, readonly (readonly number[])[]>>;
  feet: { L: readonly Step[]; R: readonly Step[] };
}

/** 足首の真下から、地面を押す所（母指球）までの前後の距離 */
const BALL_Z = 0.13;

/** 単調な 3 次補間（行き過ぎない）。keys は [t, 値...]。両端は速さ 0。 */
export function sampleKeys(keys: readonly (readonly number[])[], t: number): number[] {
  const n = keys.length;
  const first = keys[0]!, last = keys[n - 1]!;
  if (n === 1 || t <= first[0]!) return first.slice(1);
  if (t >= last[0]!) return last.slice(1);
  let i = 0;
  while (i < n - 2 && keys[i + 1]![0]! <= t) i++;
  const k0 = keys[i]!, k1 = keys[i + 1]!;
  const h = k1[0]! - k0[0]!;
  const u = (t - k0[0]!) / h;
  const u2 = u * u, u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
  const out: number[] = [];
  const slope = (a: readonly number[] | undefined, b: readonly number[], c: readonly number[] | undefined, k: number): number => {
    if (!a || !c) return 0;
    const ha = b[0]! - a[0]!, hb = c[0]! - b[0]!;
    const da = (b[k]! - a[k]!) / ha, db = (c[k]! - b[k]!) / hb;
    if (da * db <= 0) return 0;
    const w1 = 2 * hb + ha, w2 = hb + 2 * ha;
    return (w1 + w2) / (w1 / da + w2 / db);
  };
  for (let k = 1; k < k0.length; k++) {
    const m0 = slope(keys[i - 1], k0, k1, k), m1 = slope(k0, k1, keys[i + 2], k);
    out.push(h00 * k0[k]! + h10 * h * m0 + h01 * k1[k]! + h11 * h * m1);
  }
  return out;
}

/** 技の中での、体（アクター）の移動と回転。技の始まりの位置・向きを基準にする。 */
export function rootAt(m: Motion, t: number, dirAngle = 0): { x: number; z: number; yaw: number } {
  const yawAt = (tt: number): number => (m.spin ? m.spin.degrees * clamp((tt - m.spin.from) / (m.spin.to - m.spin.from), 0, 1) : 0);
  let x = 0, z = 0;
  if (m.root && m.root.length > 0) {
    const dist = (tt: number): number => {
      const r = m.root!;
      if (tt <= r[0]![0]) return r[0]![1];
      const last = r[r.length - 1]!;
      if (tt >= last[0]) return last[1];
      let i = 0;
      while (i < r.length - 2 && r[i + 1]![0] <= tt) i++;
      return r[i]![1] + ((r[i + 1]![1] - r[i]![1]) * (tt - r[i]![0])) / (r[i + 1]![0] - r[i]![0]);
    };
    for (let k = 0; k < t; k++) {
      const e = Math.min(k + 1, t);
      const d = dist(e) - dist(k);
      if (d === 0) continue;
      const a = yawAt((k + e) / 2) * D2R + dirAngle;
      x += Math.sin(a) * d;
      z += Math.cos(a) * d;
    }
  }
  return { x, z, yaw: yawAt(t) };
}

/** 歩の並びから、tick t の足の置き方を出す。置いた足は、体が進んでも回っても、地面の同じ場所に残る。 */
export function footAt(m: Motion, steps: readonly Step[], t: number, dirAngle = 0): Foot {
  let i = 0;
  while (i < steps.length - 1 && steps[i + 1]![0] <= t) i++;
  // 地面に残るのは、足の前の方（母指球）。x・z は足首の真下で書くので、つま先の向きへ BALL_Z だけ進めた点を置く。
  const world = (s: Step): { x: number; z: number; yaw: number; pivot: boolean } => {
    const r = rootAt(m, s[1], dirAngle);
    const c = Math.cos(r.yaw * D2R), sn = Math.sin(r.yaw * D2R);
    const bx = s[2] + Math.sin(s[4] * D2R) * BALL_Z, bz = s[3] + Math.cos(s[4] * D2R) * BALL_Z;
    return { x: r.x + bx * c + bz * sn, z: r.z - bx * sn + bz * c, yaw: s[4] + r.yaw, pivot: !!s[6] };
  };
  const now = rootAt(m, t, dirAngle);
  const local = (w: { x: number; z: number; yaw: number; pivot: boolean }, st: Step, lift: number): Foot => {
    const c = Math.cos(now.yaw * D2R), sn = Math.sin(now.yaw * D2R);
    const dx = w.x - now.x, dz = w.z - now.z;
    // 軸足として回る時は、母指球を地面に残したまま、つま先は体と一緒に回る
    const yaw = w.pivot ? st[4] : w.yaw - now.yaw;
    return [dx * c - dz * sn - Math.sin(yaw * D2R) * BALL_Z, lift, dx * sn + dz * c - Math.cos(yaw * D2R) * BALL_Z, yaw, 0];
  };
  const s = steps[i]!;
  const w1 = world(s);
  if (t >= s[1] || i === 0) return local(w1, s, 0);
  const p = steps[i - 1]!;
  const w0 = world(p);
  const u = (t - s[0]) / (s[1] - s[0]);
  const e = u * u * (3 - 2 * u);
  const yaw0 = w0.pivot ? p[4] + now.yaw : w0.yaw, yaw1 = w1.pivot ? s[4] + now.yaw : w1.yaw;
  const f = local({ x: w0.x + (w1.x - w0.x) * e, z: w0.z + (w1.z - w0.z) * e, yaw: yaw0 + (yaw1 - yaw0) * e, pivot: false }, s, (s[5] ?? 0.07) * Math.sin(Math.PI * u) ** 0.8);
  // 振り出しの前半はつま先が下がり、後半は上がる
  f[4] = 14 * Math.sin(Math.PI * Math.min(1, u * 1.6)) * (1 - u);
  return f;
}

/** 動き m の tick t での値（足は置き方まで解く）。 */
export function evalMotion(m: Motion, t: number, dirAngle = 0): { ctl: Ctl; footL: Foot; footR: Foot } {
  const ctl = {} as Ctl;
  for (const c of CHANNELS) {
    const keys = m.ch[c];
    ctl[c] = keys && keys.length > 0 ? sampleKeys(keys, t) : (m.base[c] ?? DEFAULT_CTL[c]!).slice();
  }
  return { ctl, footL: footAt(m, m.feet.L, t, dirAngle), footR: footAt(m, m.feet.R, t, dirAngle) };
}

export const mixCtl = (a: Ctl, b: Ctl, u: number): Ctl => {
  const o = {} as Ctl;
  for (const c of CHANNELS) {
    const ac = a[c] ?? DEFAULT_CTL[c]!, bc = b[c] ?? DEFAULT_CTL[c]!;
    o[c] = ac.map((x, i) => x + ((bc[i] ?? x) - x) * u);
  }
  return o;
};
export const mixFoot = (a: Foot, b: Foot, u: number): Foot => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u, a[3] + (b[3] - a[3]) * u, a[4] + (b[4] - a[4]) * u];
export const fillCtl = (p: Partial<Ctl>): Ctl => ({ ...DEFAULT_CTL, ...p });

// ---- 解く ----
const L_THIGH = REST.thigh, L_SHIN = REST.shin, LEG_MAX = (L_THIGH + L_SHIN) * 0.994;
const L_UPPER = REST.upperArm, L_FORE = REST.forearm + 0.04;
const ANKLE_H = 0.04, HEEL_Z = -0.065;
/** 肩の中点（胸の座標の原点）の、胸の関節からの高さ */
const SC_Y = REST.shoulderY - REST.chestY;

export interface Frames {
  pelvis: Vec; chest: Vec; sc: Vec; head: Vec;
  qPelvis: Quat; qChest: Quat; qHead: Quat;
  shoulderL: Vec; shoulderR: Vec; elbowL: Vec; elbowR: Vec; handL: Vec; handR: Vec;
  /** 手の行き先（届かない時は handL/R とずれる） */
  targetL: Vec; targetR: Vec;
  hipL: Vec; hipR: Vec; kneeL: Vec; kneeR: Vec; ankleL: Vec; ankleR: Vec;
  /** 足が地面を押す所（母指球） */
  ballL: Vec; ballR: Vec;
  /** 武器を握っている度合いと、もう片方の手が仕事をしている度合い */
  grab: number; on: number;
  /** 足: つま先の向き（度）、かかとの上げ、足首の曲げ（+ がすねを前へ倒す側）、地面から浮いた高さ */
  footYawL: number; footYawR: number; heelL: number; heelR: number; ankleFlexL: number; ankleFlexR: number; liftL: number; liftR: number;
  /** 脚が届かず伸び切った量 (m)。0 なら届いている。 */
  legShortL: number; legShortR: number;
}
export interface Solved {
  pose: BodyPose;
  /** 武器の置き場所（アクターの座標）。normal は武器の +X（刃の厚みの向き）。 */
  weapon: { grip: Vec; dir: Vec; normal: Vec };
  /** 盾（双剣では、もう 1 本の剣）の置き場所（原点と向き）。持っていない時は null。 */
  shield: { pos: Vec; quat: Quat } | null;
  /** 双剣: もう 1 本の剣の握りと向き（判定の軌道に使う）。ほかの武器では null。 */
  off: { grip: Vec; dir: Vec } | null;
  /** 弓: 弦を引いた点（弓のローカル座標）と、矢をつがえているか */
  string: { y: number; z: number; arrow: boolean } | null;
  /** 弓: 弦を引く手が握った矢（v0.60.0。近接）。握りの位置と、矢じりの向き（前腕の向き。アクターの座標）。握っていない時は null */
  held: { pos: Vec; dir: Vec } | null;
  frames: Frames;
}

/** 弦を引く手が握った矢（v0.60.0）: 手の位置と、ひじから手への向き（矢じりは前腕の先の方へ出る） */
function heldOf(arm: { E: Vec; H: Vec }): { pos: Vec; dir: Vec } {
  return { pos: arm.H, dir: vnorm(vsub(arm.H, arm.E), [0, 0, 1]) };
}

function solveArm(S: Vec, T: Vec, pole: Vec): { E: Vec; H: Vec; qU: Quat; qF: Quat } {
  const n = vsub(T, S);
  const dist = clamp(vlen(n), 0.1, L_UPPER + L_FORE - 0.002);
  const nh = vnorm(n, [0, -1, 0]);
  const a = (L_UPPER * L_UPPER - L_FORE * L_FORE + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, L_UPPER * L_UPPER - a * a));
  let perp = vsub(pole, vmul(nh, vdot(pole, nh)));
  if (vlen(perp) < 1e-5) perp = vsub([0, -1, 0], vmul(nh, -nh[1]));
  perp = vnorm(perp, [1, 0, 0]);
  const E = vadd(vadd(S, vmul(nh, a)), vmul(perp, h));
  const H = vadd(S, vmul(nh, dist));
  const yU = vnorm(vsub(S, E));
  const f = vnorm(vsub(H, E));
  let zU = vsub(f, vmul(yU, vdot(f, yU)));
  if (vlen(zU) < 1e-4) zU = vsub(vmul(perp, -1), vmul(yU, -vdot(perp, yU)));
  zU = vnorm(zU, [0, 0, 1]);
  const xU = vcross(yU, zU);
  const yF = vmul(f, -1);
  const zF = vcross(xU, yF);
  return { E, H, qU: qbasis(xU, yU, zU), qF: qbasis(xU, yF, zF) };
}

function solveLeg(Hp: Vec, A: Vec, pole: Vec): { K: Vec; A: Vec; qT: Quat; qS: Quat; short: number } {
  const n = vsub(A, Hp);
  const raw = vlen(n);
  const dist = clamp(raw, 0.25, L_THIGH + L_SHIN - 0.002);
  const nh = vnorm(n, [0, -1, 0]);
  const a = (L_THIGH * L_THIGH - L_SHIN * L_SHIN + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, L_THIGH * L_THIGH - a * a));
  let perp = vsub(pole, vmul(nh, vdot(pole, nh)));
  if (vlen(perp) < 1e-5) perp = [0, 0, 1];
  perp = vnorm(perp, [0, 0, 1]);
  const K = vadd(vadd(Hp, vmul(nh, a)), vmul(perp, h));
  const A2 = vadd(Hp, vmul(nh, dist));
  const yT = vnorm(vsub(Hp, K));
  const zT = vnorm(vsub(perp, vmul(yT, vdot(perp, yT))), [0, 0, 1]);
  const xT = vcross(yT, zT);
  const yS = vnorm(vsub(K, A2));
  const zS = vcross(xT, yS);
  return { K, A: A2, qT: qbasis(xT, yT, zT), qS: qbasis(xT, yS, zS), short: Math.max(0, raw - (L_THIGH + L_SHIN - 0.002)) };
}

const footQuat = (f: Foot): Quat => qmul(qaxis(1, f[3]), qaxis(0, f[4]));
const ballOf = (f: Foot): Vec => vadd([f[0], f[1], f[2]], qrot(qaxis(1, f[3]), [0, 0, BALL_Z]));
function ankleOf(f: Foot): Vec {
  const qy = qaxis(1, f[3]);
  const q = footQuat(f);
  if (f[4] >= 0) return vadd(vadd([f[0], f[1], f[2]], qrot(qy, [0, 0, BALL_Z])), qrot(q, [0, ANKLE_H, -BALL_Z]));
  return vadd(vadd([f[0], f[1], f[2]], qrot(qy, [0, 0, HEEL_Z])), qrot(q, [0, ANKLE_H, -HEEL_Z]));
}

/** 値のひとまとまりと足の置き方から、全関節を解く。 */
export function solveBody(ctl: Ctl, footL: Foot, footR: Foot, hands: Hands): Solved {
  const qP = qpyr(ctl.hipR);
  const qS = qmul(qP, qpyr(ctl.spine));
  const qC = qmul(qS, qpyr(ctl.chest));
  const fwdP = qrot(qP, [0, 0, 1]);
  const feet: Foot[] = [footL.slice() as Foot, footR.slice() as Foot];
  const sides = [1, -1];
  const pelvisAt = (drop: number): Vec => [ctl.hip[0]!, REST.pelvisY + ctl.hip[1]! - drop, ctl.hip[2]!];
  const hipOf = (P: Vec, side: number): Vec => vadd(P, qrot(qP, [REST.hipX * side, REST.hipY - REST.pelvisY, 0]));
  const legOf = (P: Vec, i: number): ReturnType<typeof solveLeg> => {
    const f = feet[i]!;
    const ff = qrot(qaxis(1, f[3]), [0, 0, 1]);
    return solveLeg(hipOf(P, sides[i]!), ankleOf(f), vnorm([ff[0] * 0.6 + fwdP[0] * 0.4, 0.05, ff[2] * 0.6 + fwdP[2] * 0.4]));
  };
  /** 足首の曲げ（度）: すねが、つま先の方へどれだけ倒れているか */
  const flexOf = (i: number, leg: ReturnType<typeof solveLeg>): number => {
    const up = vnorm(vsub(leg.K, leg.A));
    const q = footQuat(feet[i]!);
    return Math.atan2(vdot(up, qrot(q, [0, 0, 1])), vdot(up, qrot(q, [0, 1, 0]))) / D2R;
  };
  const planted = (i: number): boolean => feet[i]![1] < 0.004;
  const reach = (P: Vec, i: number): number => vlen(vsub(ankleOf(feet[i]!), hipOf(P, sides[i]!)));
  // 1) 置いた足へ届かない時は、まず かかとを上げる（後ろ足）。それでも届かなければ腰を落とす。
  let P = pelvisAt(0);
  // （離れ際・着き際の足にも、浮きに応じて少しずつ効かせる。そうしないと、足を離した瞬間に腰が跳ねる）
  for (let i = 0; i < 2; i++) {
    const heelMax = 42 * clamp(1 - feet[i]![1] / 0.03, 0, 1);
    for (let k = 0; k < 14 && reach(P, i) > LEG_MAX && feet[i]![4] < heelMax; k++) {
      const before = reach(P, i);
      feet[i]![4] += 3;
      if (reach(P, i) > before) {
        feet[i]![4] -= 3;
        break;
      }
    }
  }
  // （運んでいる途中の足にも届くようにする。そうしないと、足を離した瞬間に腰が跳ね上がる）
  if (reach(P, 0) > LEG_MAX || reach(P, 1) > LEG_MAX) {
    let lo = 0, hi = 0.7;
    for (let k = 0; k < 18; k++) {
      const mid = (lo + hi) / 2;
      const Q = pelvisAt(mid);
      if (reach(Q, 0) > LEG_MAX || reach(Q, 1) > LEG_MAX) lo = mid;
      else hi = mid;
    }
    P = pelvisAt(hi);
  }
  // 2) すねが前へ倒れすぎる（足首が曲がりすぎる）時も、かかとを上げて逃がす
  for (let i = 0; i < 2; i++) {
    if (!planted(i)) continue;
    for (let k = 0; k < 16 && flexOf(i, legOf(P, i)) > 24 && feet[i]![4] < 60; k++) feet[i]![4] += 3;
  }
  const legL = legOf(P, 0), legR = legOf(P, 1);

  // ---- 胴 ----
  const spineP = vadd(P, qrot(qP, [0, REST.spineY - REST.pelvisY, 0]));
  const chestP = vadd(spineP, qrot(qS, [0, REST.chestY - REST.spineY, 0]));
  const sc = vadd(chestP, qrot(qC, [0, SC_Y, 0]));
  const shL = vadd(sc, qrot(qC, [REST.shoulderX, 0, 0])), shR = vadd(sc, qrot(qC, [-REST.shoulderX, 0, 0]));
  const neckP = vadd(chestP, qrot(qC, [0, REST.neckY - REST.chestY, 0]));
  // 顔: 見たい向きへ、首と頭で分けて回す（回せる範囲まで）
  // （胸の正面から左右 79° まで。そこまでなら、顔は見たい向きへ水平に向く）
  const fwdC = qrot(qC, [0, 0, 1]);
  const chestYaw = Math.atan2(fwdC[0], fwdC[2]) / D2R;
  let dy = (ctl.look[0] ?? 0) - chestYaw;
  dy = ((((dy + 180) % 360) + 360) % 360) - 180;
  const want = qmul(qaxis(1, chestYaw + clamp(dy, -79, 79)), qaxis(0, clamp(ctl.look[1] ?? 0, -35, 40)));
  let rel = qmul(qconj(qC), want);
  if (rel[3] < 0) rel = [-rel[0], -rel[1], -rel[2], -rel[3]];
  // 首が 4 割、頭が 6 割を受け持つ
  const half = Math.acos(clamp(rel[3], -1, 1));
  const sn = Math.sin(half);
  const part = (k: number): Quat => (sn < 1e-6 ? [0, 0, 0, 1] : [(rel[0] / sn) * Math.sin(half * k), (rel[1] / sn) * Math.sin(half * k), (rel[2] / sn) * Math.sin(half * k), Math.cos(half * k)]);
  const neckE = qeuler(part(0.4)), headE = qeuler(qmul(qconj(part(0.4)), rel));
  const qN = qmul(qC, part(0.4));
  const qH = qmul(qC, rel);
  const headP = vadd(neckP, qrot(qN, [0, REST.headY - REST.neckY, 0]));

  // ---- 武器と腕 ----
  const toActor = (v: readonly number[]): Vec => vadd(sc, qrot(qC, [v[0]!, v[1]!, v[2]!]));
  const dirActor = (v: readonly number[]): Vec => qrot(qC, vnorm([v[0]!, v[1]!, v[2]!]));
  const grip = toActor(ctl.grip);
  const dir = dirActor(ctl.dir);
  let edge = dirActor(ctl.edge);
  edge = vnorm(vsub(edge, vmul(dir, vdot(edge, dir))), [1, 0, 0]);
  const normal = vnorm(vcross(edge, dir), [1, 0, 0]);
  // 武器のローカル軸（rig の basis と同じ決め方）: x = normal、y = dir、z = x × y
  const wz = vcross(normal, dir);
  const poleOf = (side: number, S: Vec, T: Vec, hint: readonly number[]): Vec => {
    if (Math.abs(hint[0]!) + Math.abs(hint[1]!) + Math.abs(hint[2]!) > 1e-6) return qrot(qC, vnorm([hint[0]!, hint[1]!, hint[2]!]));
    // 自動: 手が肩より下なら ひじは下・外・少し後ろ。手が上がるほど外・前へ。手が体の正面を越えて反対側へ行くほど前へ。
    const rel = qrot(qconj(qC), vsub(T, S));
    const up = clamp((rel[1] + 0.05) / 0.3, 0, 1);
    const across = clamp((-rel[0] * side - 0.1) / 0.2, 0, 1);
    return qrot(qC, vnorm([side * (0.55 + 0.4 * up), -0.75 + 0.6 * up, -0.35 + 0.6 * up + 1.1 * across]));
  };
  let tR: Vec, tL: Vec;
  let string: Solved['string'] = null;
  const grab = clamp(ctl.grab[0] ?? 1, 0, 1), on = clamp(ctl.on[0] ?? 0, 0, 1);
  if (hands.primary === 'R') tR = vlerp(toActor(hangHand(-1)), grip, grab);
  else tL = vlerp(toActor(hangHand(1)), grip, grab);
  if (hands.second === 'along') {
    const side = hands.primary === 'R' ? 1 : -1;
    const o = vlerp(toActor(hangHand(side)), vadd(grip, vmul(dir, hands.along ?? 0.3)), on);
    if (hands.primary === 'R') tL = o;
    else tR = o;
  } else if (hands.second === 'string') {
    const [sy, sz] = hands.stringAt ?? [0.02, 0.17];
    const pull = ctl.pull[0] ?? 0;
    const sp = vadd(vadd(grip, vmul(dir, sy)), vmul(wz, sz + pull));
    const sh = hands.primary === 'L' ? shR : shL;
    const o = vlerp(toActor(ctl.off), vadd(sp, vmul(vnorm(vsub(sh, sp)), hands.stringFinger ?? 0)), on);
    if (hands.primary === 'L') tR = o;
    else tL = o;
    string = { y: sy, z: sz + pull * on, arrow: (ctl.arrow[0] ?? 0) > 0.5 };
  } else if (hands.second === 'blade') {
    // もう 1 本の剣: 握っていない間（納めている間）は、手を体の横に下げる
    const side = hands.primary === 'R' ? 1 : -1;
    const o = vlerp(toActor(hangHand(side)), toActor(ctl.off), on);
    if (hands.primary === 'R') tL = o;
    else tR = o;
  } else {
    const o = toActor(ctl.off);
    if (hands.primary === 'R') tL = o;
    else tR = o;
  }
  const armR = solveArm(shR, tR!, poleOf(-1, shR, tR!, ctl.elbowR));
  const armL = solveArm(shL, tL!, poleOf(1, shL, tL!, ctl.elbowL));
  let shield: Solved['shield'] = null;
  if (hands.second === 'shield' && on >= 0.5) {
    // 盾は前腕に固定: 盾の -X が前腕の向き（ひじ → 手）。表は、望む向きにいちばん近い側。
    const arm = hands.primary === 'R' ? armL : armR;
    const f = vnorm(vsub(arm.H, arm.E));
    const n = dirActor(ctl.offN);
    const z = vnorm(vsub(n, vmul(f, vdot(n, f))), [0, 0, 1]);
    const x = vmul(f, -1);
    const y = vcross(z, x);
    const g = hands.shieldGrip ?? [0, 0, 0];
    shield = { pos: vsub(arm.H, vadd(vadd(vmul(x, g[0]), vmul(y, g[1])), vmul(z, g[2]))), quat: qbasis(x, y, z) };
  }
  let off: Solved['off'] = null;
  if (hands.second === 'blade' && on >= 0.5) {
    // もう 1 本の剣は手に持つ: 原点が握り、+Y が刃先、-Z が刃（1 本目と同じ決め方）
    const arm = hands.primary === 'R' ? armL : armR;
    const d2 = dirActor(ctl.offN);
    const e2 = vnorm(vsub(dirActor(ctl.offE), vmul(d2, vdot(dirActor(ctl.offE), d2))), [1, 0, 0]);
    const n2 = vnorm(vcross(e2, d2), [1, 0, 0]);
    shield = { pos: arm.H, quat: qbasis(n2, d2, vcross(n2, d2)) };
    off = { grip: arm.H, dir: d2 };
  }

  // ---- 関節の角度へ ----
  const j = {} as Record<JointName, JRot>;
  j.pelvis = qeuler(qP);
  j.spine = qeuler(qpyr(ctl.spine));
  j.chest = qeuler(qpyr(ctl.chest));
  j.neck = neckE;
  j.head = headE;
  j.upperArmL = qeuler(qmul(qconj(qC), armL.qU));
  j.forearmL = qeuler(qmul(qconj(armL.qU), armL.qF));
  j.handL = [0, 0, 0];
  j.upperArmR = qeuler(qmul(qconj(qC), armR.qU));
  j.forearmR = qeuler(qmul(qconj(armR.qU), armR.qF));
  j.handR = [0, 0, 0];
  j.thighL = qeuler(qmul(qconj(qP), legL.qT));
  j.shinL = qeuler(qmul(qconj(legL.qT), legL.qS));
  j.footL = qeuler(qmul(qconj(legL.qS), footQuat(feet[0]!)));
  j.thighR = qeuler(qmul(qconj(qP), legR.qT));
  j.shinR = qeuler(qmul(qconj(legR.qT), legR.qS));
  j.footR = qeuler(qmul(qconj(legR.qS), footQuat(feet[1]!)));
  return {
    pose: { j, px: P[0], py: P[1] - REST.pelvisY, pz: P[2], grounded: true, tumble: 0, tumbleDir: 0, drop: 0 },
    weapon: { grip, dir, normal },
    shield,
    off,
    string,
    held: hands.second === 'string' && (ctl.hold?.[0] ?? 0) >= 0.5 ? heldOf(hands.primary === 'L' ? armR : armL) : null,
    frames: {
      pelvis: P, chest: chestP, sc, head: headP, qPelvis: qP, qChest: qC, qHead: qH,
      shoulderL: shL, shoulderR: shR, elbowL: armL.E, elbowR: armR.E, handL: armL.H, handR: armR.H, targetL: tL!, targetR: tR!,
      hipL: hipOf(P, 1), hipR: hipOf(P, -1), kneeL: legL.K, kneeR: legR.K, ankleL: legL.A, ankleR: legR.A,
      ballL: ballOf(feet[0]!), ballR: ballOf(feet[1]!), grab, on,
      footYawL: feet[0]![3], footYawR: feet[1]![3], heelL: feet[0]![4], heelR: feet[1]![4],
      ankleFlexL: flexOf(0, legL), ankleFlexR: flexOf(1, legR), liftL: feet[0]![1], liftR: feet[1]![1],
      legShortL: legL.short, legShortR: legR.short,
    },
  };
}

/** 胸の向きと、肩の中点の位置（アクターの座標の値を、胸の座標へ直すのに使う）。足の届き方で腰が落ちる分も含む。 */
export function chestFrame(ctl: Ctl, footL: Foot, footR: Foot, hands: Hands): { sc: Vec; q: Quat } {
  const s = solveBody(ctl, footL, footR, hands);
  return { sc: s.frames.sc, q: s.frames.qChest };
}

/**
 * 歩く時の足（武器を構えたまま）。phase は進んだ距離から作る（1 周 = 2 歩）。
 * v0.28.1: 接地の長さを、脚が届く範囲（0.62m）までにした（歩幅がそれより長い時は、両足が浮く間を作る）。構えの前後のずれ（bias）も、
 * 着く所が体の前 0.28m・離れる所が後ろ 0.38m を超えない所まで縮める（前へ出した足で、着いた瞬間に腰が落ちない）。
 * bob は腰の高さの足し分（m）。足の運びに合わせたなめらかな 1 つの波で、歩きは片足で立つ真ん中が高く、走りは片足の真ん中が低い。
 */
export function gaitFeet(phase: number, stride: number, baseL: Foot, baseR: Foot, bias = 0.35): { L: Foot; R: Foot; bob: number } {
  const duty = clamp(0.62 / Math.max(0.01, stride), 0.3, 0.6);
  const half = (duty * stride) / 2;
  const center = (base: Foot): number => clamp(base[2] * bias, half - 0.38, 0.28 - half);
  const walkish = clamp((duty - 0.45) / 0.15, 0, 1);
  const lift = 0.09 + 0.05 * (1 - walkish);
  const one = (ph: number, base: Foot): Foot => {
    const u = ((ph / (2 * Math.PI)) % 1 + 1) % 1;
    let z: number, y = 0, heel = 0;
    if (u < duty) {
      z = half - (2 * half * u) / duty;
      // かかとから着いて（つま先が上がっている）、足の裏全体へ。離れる前は、かかとが上がる。
      if (u < duty * 0.18) heel = -20 * (1 - u / (duty * 0.18));
      else if (u > duty * 0.75) heel = 26 * ((u - duty * 0.75) / (duty * 0.25));
    } else {
      const s = (u - duty) / (1 - duty);
      const e = s * s * (3 - 2 * s);
      z = -half + 2 * half * e;
      y = lift * Math.sin(Math.PI * s) ** 0.7;
      heel = 26 * (1 - s) * (1 - s) - 20 * s * s;
    }
    return [base[0] * 0.7, y, center(base) + z, base[3] * 0.4, heel];
  };
  const uL = ((phase / (2 * Math.PI)) % 1 + 1) % 1;
  const wave = Math.cos(4 * Math.PI * (uL - duty / 2));
  return { L: one(phase, baseL), R: one(phase + Math.PI, baseR), bob: -0.012 * (1 - walkish) + (0.008 * walkish - 0.012 * (1 - walkish)) * wave };
}
