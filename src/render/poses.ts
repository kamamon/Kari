// 仮ハンターの姿勢データ（手付けのキー姿勢）。正式な GLB クリップが来るまでの仮素材。
// clip 名は技データ（public/data/actions）の clip と対応する。無い clip を似た名前で代用しない。
// 角度は度。関節の回転軸: X 正 = 上体は前屈・脚は後ろ振り / Y 正 = 左へひねる / Z 正 = 左へ倒す。
import { smoothstep } from '../core/math';

export const JOINTS = [
  'pelvis', 'spine', 'chest', 'neck', 'head',
  'upperArmL', 'forearmL', 'handL', 'upperArmR', 'forearmR', 'handR',
  'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR',
] as const;
export type JointName = (typeof JOINTS)[number];
export type JRot = [number, number, number];
type J = Partial<Record<JointName, JRot>>;

export interface BodyPose {
  j: Record<JointName, JRot>;
  /** 骨盤の上下 (m) */
  py: number;
  /** 体全体の前転角（度）と、その向き（向きに対する相対角・ラジアン） */
  tumble: number;
  tumbleDir: number;
  /** 回転の中心を下げる量 (m)。倒れた時に地面へ寝かせる。 */
  drop: number;
}

interface Key {
  t: number;
  j?: J;
  py?: number;
  tumble?: number;
  drop?: number;
}

const ZERO: JRot = [0, 0, 0];

export function emptyPose(): BodyPose {
  const j = {} as Record<JointName, JRot>;
  for (const n of JOINTS) j[n] = [0, 0, 0];
  return { j, py: 0, tumble: 0, tumbleDir: 0, drop: 0 };
}

function fromKey(base: J, basePy: number, k: Key): BodyPose {
  const p = emptyPose();
  for (const n of JOINTS) {
    const v = k.j?.[n] ?? base[n] ?? ZERO;
    p.j[n] = [v[0], v[1], v[2]];
  }
  p.py = k.py ?? basePy;
  p.tumble = k.tumble ?? 0;
  p.drop = k.drop ?? 0;
  return p;
}

export function blendPose(a: BodyPose, b: BodyPose, t: number): BodyPose {
  const p = emptyPose();
  for (const n of JOINTS) {
    const x = a.j[n];
    const y = b.j[n];
    p.j[n] = [x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t];
  }
  p.py = a.py + (b.py - a.py) * t;
  p.tumble = a.tumble + (b.tumble - a.tumble) * t;
  p.drop = a.drop + (b.drop - a.drop) * t;
  p.tumbleDir = t < 0.5 ? a.tumbleDir : b.tumbleDir;
  return p;
}

// ---- 基本姿勢 ----
const NEUTRAL: J = { upperArmL: [0, 0, 7], upperArmR: [0, 0, -7], forearmL: [-12, 0, 0], forearmR: [-12, 0, 0] };
/** 抜刀時の構え。左足を前に出し、上体を少し右へ開く。 */
const STANCE: J = { spine: [5, 0, 0], chest: [0, -18, 0], thighL: [-13, 0, 4], shinL: [17, 0, 0], thighR: [12, 0, -4], shinR: [15, 0, 0], head: [0, 14, 0] };
const STANCE_PY = -0.035;

interface Clip {
  base: J;
  basePy: number;
  keys: Key[];
}

const SWING_DOWN: J = { spine: [30, 0, 0], chest: [20, 0, 0], thighL: [-50, 0, 4], shinL: [62, 0, 0], thighR: [28, 0, -4], shinR: [30, 0, 0], head: [-20, 0, 0] };
const SWING_MID: J = { spine: [18, 0, 0], chest: [12, 0, 0], thighL: [-42, 0, 4], shinL: [48, 0, 0], thighR: [22, 0, -4], shinR: [20, 0, 0] };
const SWING_UP: J = { spine: [-12, 0, 0], chest: [-10, 0, 0], thighL: [-16, 0, 4], shinL: [18, 0, 0], thighR: [16, 0, -4], shinR: [14, 0, 0], head: [8, 0, 0] };
const RECOVER: J = { spine: [14, 0, 0], chest: [8, -8, 0], thighL: [-28, 0, 4], shinL: [30, 0, 0], thighR: [16, 0, -4], shinR: [18, 0, 0] };
const TUCK: J = {
  spine: [45, 0, 0], chest: [25, 0, 0], neck: [25, 0, 0], thighL: [-105, 0, 0], shinL: [115, 0, 0], thighR: [-105, 0, 0], shinR: [115, 0, 0],
  upperArmL: [-50, 0, 12], upperArmR: [-50, 0, -12], forearmL: [-100, 0, 0], forearmR: [-100, 0, 0],
};
const HALF_TUCK: J = {
  spine: [25, 0, 0], chest: [12, 0, 0], thighL: [-55, 0, 0], shinL: [70, 0, 0], thighR: [-40, 0, 0], shinR: [60, 0, 0],
  upperArmL: [-25, 0, 10], upperArmR: [-25, 0, -10], forearmL: [-50, 0, 0], forearmR: [-50, 0, 0],
};
const LYING: J = { upperArmL: [0, 0, 55], upperArmR: [0, 0, -55], thighL: [-8, 0, 10], thighR: [6, 0, -10], shinL: [14, 0, 0], shinR: [6, 0, 0], head: [-10, 0, 0] };

export const CLIPS: Record<string, Clip> = {
  hb_attack_vertical_01: {
    base: STANCE, basePy: STANCE_PY,
    keys: [
      { t: 0 },
      { t: 10, j: { ...STANCE, spine: [-5, 0, 0], chest: [-5, -8, 0] } },
      { t: 18, j: SWING_UP, py: -0.03 },
      { t: 22, j: { ...SWING_UP, spine: [-4, 0, 0], chest: [0, 0, 0], thighL: [-30, 0, 4], shinL: [26, 0, 0] }, py: -0.06 },
      { t: 26, j: SWING_MID, py: -0.14 },
      { t: 30, j: SWING_DOWN, py: -0.22 },
      { t: 46, j: SWING_DOWN, py: -0.22 },
      { t: 58, j: RECOVER, py: -0.1 },
      { t: 72 },
    ],
  },
  hb_draw_slash_01: {
    base: STANCE, basePy: STANCE_PY,
    keys: [
      { t: 0, j: { chest: [0, -10, 0], thighL: [-6, 0, 3], thighR: [6, 0, -3], shinL: [8, 0, 0], shinR: [8, 0, 0] }, py: -0.01 },
      { t: 8, j: { chest: [-4, -14, 0], thighL: [-10, 0, 3], thighR: [10, 0, -3], shinL: [12, 0, 0], shinR: [12, 0, 0] }, py: -0.02 },
      { t: 14, j: SWING_UP, py: -0.03 },
      { t: 20, j: { ...SWING_UP, spine: [-4, 0, 0], chest: [0, 0, 0], thighL: [-30, 0, 4], shinL: [26, 0, 0] }, py: -0.06 },
      { t: 24, j: SWING_MID, py: -0.14 },
      { t: 28, j: SWING_DOWN, py: -0.22 },
      { t: 40, j: SWING_DOWN, py: -0.22 },
      { t: 52, j: RECOVER, py: -0.1 },
      { t: 64 },
    ],
  },
  hb_attack_side_01: {
    base: STANCE, basePy: STANCE_PY,
    keys: [
      { t: 0 },
      { t: 8, j: { ...STANCE, spine: [6, -15, 0], chest: [0, -42, 0] }, py: -0.05 },
      { t: 18, j: { ...STANCE, spine: [8, -20, 0], chest: [0, -52, 0], thighL: [-18, 0, 4], shinL: [24, 0, 0] }, py: -0.07 },
      { t: 22, j: { ...STANCE, spine: [10, 0, 0], chest: [0, -4, 0], thighL: [-26, 0, 4], shinL: [34, 0, 0], thighR: [18, 0, -4], shinR: [20, 0, 0] }, py: -0.09 },
      { t: 27, j: { ...STANCE, spine: [10, 24, 0], chest: [0, 52, 0], thighL: [-26, 0, 4], shinL: [34, 0, 0], thighR: [18, 0, -4], shinR: [20, 0, 0] }, py: -0.09 },
      { t: 34, j: { ...STANCE, spine: [8, 30, 0], chest: [0, 62, 0], thighL: [-24, 0, 4], shinL: [30, 0, 0] }, py: -0.08 },
      { t: 50, j: { ...STANCE, spine: [6, 10, 0], chest: [0, 22, 0] }, py: -0.05 },
      { t: 66 },
    ],
  },
  hb_draw_01: {
    base: STANCE, basePy: STANCE_PY,
    keys: [
      { t: 0, j: { chest: [0, -8, 0] }, py: 0 },
      { t: 10, j: { chest: [-4, -14, 0], thighL: [-6, 0, 3], thighR: [6, 0, -3], shinL: [8, 0, 0], shinR: [8, 0, 0] }, py: -0.01 },
      { t: 26 },
    ],
  },
  hb_sheathe_01: {
    base: STANCE, basePy: STANCE_PY,
    keys: [
      { t: 0 },
      { t: 14, j: { ...STANCE, chest: [-6, -22, 0] } },
      { t: 30, j: { chest: [-4, -12, 0], thighL: [-6, 0, 3], thighR: [6, 0, -3], shinL: [8, 0, 0], shinR: [8, 0, 0] }, py: -0.01 },
      { t: 44, j: {}, py: 0 },
    ],
  },
  common_roll_01: {
    base: NEUTRAL, basePy: 0,
    keys: [
      { t: 0, tumble: 0 },
      { t: 4, j: HALF_TUCK, py: -0.12, tumble: 28, drop: -0.08 },
      { t: 10, j: TUCK, py: -0.2, tumble: 120, drop: -0.2 },
      { t: 18, j: TUCK, py: -0.2, tumble: 255, drop: -0.2 },
      { t: 24, j: HALF_TUCK, py: -0.16, tumble: 340, drop: -0.1 },
      { t: 28, j: HALF_TUCK, py: -0.1, tumble: 360, drop: 0 },
      { t: 36, tumble: 360 },
    ],
  },
};

/** clip の姿勢。未定義の clip は null を返す（呼び出し側が欠落として表示する）。 */
export function clipPose(name: string, tick: number): BodyPose | null {
  const clip = CLIPS[name];
  if (!clip) return null;
  const keys = clip.keys;
  if (tick <= keys[0]!.t) return fromKey(clip.base, clip.basePy, keys[0]!);
  const last = keys[keys.length - 1]!;
  if (tick >= last.t) return fromKey(clip.base, clip.basePy, last);
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1]!.t <= tick) i++;
  const k0 = keys[i]!;
  const k1 = keys[i + 1]!;
  const u = (tick - k0.t) / (k1.t - k0.t);
  // 前転角だけは等速で回す（緩急を付けると回転が波打つ）
  const p = blendPose(fromKey(clip.base, clip.basePy, k0), fromKey(clip.base, clip.basePy, k1), smoothstep(u));
  p.tumble = (k0.tumble ?? 0) + ((k1.tumble ?? 0) - (k0.tumble ?? 0)) * u;
  return p;
}

export const clipDuration = (name: string): number => {
  const c = CLIPS[name];
  return c ? c.keys[c.keys.length - 1]!.t : 0;
};

/** 待機・歩行・疾走。phase は進んだ距離から作る（足の動きを移動量に合わせる）。 */
export function locomotionPose(drawn: boolean, speed: number, phase: number, time: number): BodyPose {
  const p = fromKey(drawn ? STANCE : NEUTRAL, drawn ? STANCE_PY : 0, { t: 0 });
  const breathe = Math.sin(time * 1.7);
  p.j.chest[0] += breathe * 1.2;
  if (speed < 0.15) {
    p.py += breathe * 0.004;
    return p;
  }
  const run = Math.min(1, speed / 6.4);
  const amp = drawn ? 20 : 26 + 18 * run;
  const s = Math.sin(phase);
  const knee = (ph: number): number => 10 + (drawn ? 30 : 46 + 20 * run) * Math.max(0, Math.sin(ph - 0.9));
  if (drawn) {
    p.j.thighL[0] += -amp * s;
    p.j.thighR[0] += amp * s;
    p.j.shinL[0] += knee(phase) * 0.6;
    p.j.shinR[0] += knee(phase + Math.PI) * 0.6;
  } else {
    p.j.thighL = [-amp * s - 4 * run, 0, 2];
    p.j.thighR = [amp * s - 4 * run, 0, -2];
    p.j.shinL = [knee(phase), 0, 0];
    p.j.shinR = [knee(phase + Math.PI), 0, 0];
    p.j.upperArmL = [amp * 0.8 * s, 0, 8];
    p.j.upperArmR = [-amp * 0.8 * s, 0, -8];
    p.j.forearmL = [-22 - 40 * run, 0, 0];
    p.j.forearmR = [-22 - 40 * run, 0, 0];
    p.j.spine = [4 + 10 * run, 0, 0];
    p.j.chest = [breathe * 1.2, -8 * s * run, 0];
  }
  p.py += -0.015 + 0.02 * Math.cos(phase * 2);
  return p;
}

/** 防御。blend 0 = 構え、1 = 防御姿勢。 */
export function guardPose(blend: number, shake: number): BodyPose {
  const a = fromKey(STANCE, STANCE_PY, { t: 0 });
  const b = fromKey(STANCE, STANCE_PY, { t: 0, j: { ...STANCE, spine: [12 + shake * 6, 0, 0], chest: [4, 14, 0], thighL: [-24, 0, 6], shinL: [34, 0, 0], thighR: [20, 0, -6], shinR: [26, 0, 0], head: [6, -8, 0] }, py: -0.11 });
  return blendPose(a, b, smoothstep(blend));
}

export function hurtPose(kind: 'flinch' | 'knockdown' | 'break', tick: number, duration: number, drawn: boolean): BodyPose {
  const base = drawn ? STANCE : NEUTRAL;
  const basePy = drawn ? STANCE_PY : 0;
  if (kind !== 'knockdown') {
    const u = Math.min(1, tick / Math.max(1, duration));
    const k = Math.sin(Math.min(1, u * 3) * Math.PI * 0.5) * (1 - smoothstep((u - 0.4) / 0.6));
    const lean = kind === 'break' ? 26 : -20;
    const a = fromKey(base, basePy, { t: 0 });
    const b = fromKey(base, basePy, { t: 0, j: { ...base, spine: [lean, 0, 0], chest: [lean * 0.5, 0, 0], head: [lean * 0.6, 0, 0], thighL: [-20, 0, 4], shinL: [30, 0, 0], thighR: [14, 0, -4], shinR: [26, 0, 0] }, py: basePy - 0.08 });
    return blendPose(a, b, k);
  }
  const keys: Key[] = [
    { t: 0 },
    { t: 12, j: LYING, tumble: -70, drop: -0.28 },
    { t: 22, j: LYING, tumble: -90, drop: -0.43 },
    { t: 50, j: LYING, tumble: -90, drop: -0.43 },
    { t: 66, j: HALF_TUCK, tumble: -30, drop: -0.25, py: -0.15 },
    { t: duration },
  ];
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1]!.t <= tick) i++;
  const k0 = keys[i]!;
  const k1 = keys[i + 1]!;
  const u = Math.min(1, Math.max(0, (tick - k0.t) / (k1.t - k0.t)));
  return blendPose(fromKey(base, basePy, k0), fromKey(base, basePy, k1), smoothstep(u));
}

export function deadPose(ticks: number): BodyPose {
  const u = smoothstep(ticks / 30);
  return blendPose(fromKey(NEUTRAL, 0, { t: 0 }), fromKey(NEUTRAL, 0, { t: 0, j: LYING, tumble: -90, drop: -0.43 }), u);
}
