// 仮ハンターの姿勢データ（手付けのキー姿勢）。正式な GLB クリップが来るまでの仮素材。
// clip 名は技データ（public/data/actions）の clip と対応する。無い clip を似た名前で代用しない。
// 角度は度。関節の回転軸: X 正 = 上体は前屈・脚は後ろ振り / Y 正 = 左へひねる / Z 正 = 左へ倒す。
import { JOINTS, type BodyPose, type JRot, type JointName } from './bodySolve';
import { WEAPON_MOTIONS } from './weaponClipSpecs';
import { smoothstep } from '../core/math';

export { JOINTS, type BodyPose, type JRot, type JointName };
type J = Partial<Record<JointName, JRot>>;

export interface Key {
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
  // 骨盤の左右・前後のずれ（足を解いた姿勢だけが持つ）。混ぜている間は、リグの側で足を地面へ合わせ直す。
  const ax = a.px ?? 0, az = a.pz ?? 0;
  p.px = ax + ((b.px ?? 0) - ax) * t;
  p.pz = az + ((b.pz ?? 0) - az) * t;
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

export interface Clip {
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

/**
 * 断岳剣の斬り上げ（v0.40.0。2G の大剣の △+○ に当たる）: 構えから刃を返しながら前の低い所へ下ろして沈み（12〜16）、
 * 左足を踏み込んで地面すれすれから頭の上へ振り上げる（判定 18〜27）。腕は刃の軌道（hb_upswing_blade_sweep）へ IK で届かせる
 */
const UPSWING: Key[] = [
  { t: 0 },
  { t: 6, j: { ...STANCE, spine: [12, 0, 0], chest: [6, -8, 0], thighL: [-20, 0, 4], shinL: [24, 0, 0] }, py: -0.07 },
  { t: 12, j: { spine: [26, 0, 0], chest: [16, 0, 0], head: [-16, 0, 0], thighL: [-44, 0, 4], shinL: [54, 0, 0], thighR: [24, 0, -4], shinR: [26, 0, 0] }, py: -0.19 },
  { t: 16, j: SWING_DOWN, py: -0.22 },
  { t: 19, j: { spine: [24, 0, 0], chest: [14, 0, 0], head: [-12, 0, 0], thighL: [-46, 0, 4], shinL: [56, 0, 0], thighR: [26, 0, -4], shinR: [26, 0, 0] }, py: -0.19 },
  { t: 22, j: SWING_MID, py: -0.12 },
  { t: 24, j: { spine: [2, 0, 0], chest: [-2, 0, 0], thighL: [-30, 0, 4], shinL: [30, 0, 0], thighR: [18, 0, -4], shinR: [16, 0, 0] }, py: -0.06 },
  { t: 27, j: { ...SWING_UP, head: [-4, 0, 0] }, py: -0.03 },
  { t: 36, j: { ...SWING_UP, spine: [-10, 0, 0], chest: [-8, 0, 0] }, py: -0.03 },
  { t: 50, j: { ...STANCE, spine: [0, 0, 0], chest: [-4, -10, 0] }, py: -0.04 },
  { t: 66 },
];
/** 刃が前の低い所にある時（縦斬り・抜刀斬りの後）の斬り上げ: 下ろす所を省いた同じ動き（12 tick 早い） */
const UPSWING_LOW: Key[] = [{ t: 0, j: SWING_DOWN, py: -0.22 }, ...UPSWING.filter((k) => k.t > 12).map((k) => ({ ...k, t: k.t - 12 }))];
/** 回復液を飲んだ後の決め姿勢: 両腕を肩の高さで横へ開き、肘を曲げて拳を上へ。胸を張り、少し上を向いて、ひざを緩める */
const FLEX: J = {
  spine: [-4, 0, 0], chest: [-8, 0, 0], head: [-8, 0, 0],
  upperArmL: [-10, 0, 80], upperArmR: [-10, 0, -80], forearmL: [0, 0, 98], forearmR: [0, 0, -98],
  thighL: [-6, 0, 6], shinL: [10, 0, 0], thighR: [6, 0, -6], shinR: [10, 0, 0],
};

export const CLIPS: Record<string, Clip> = {
  hb_attack_upswing_01: { base: STANCE, basePy: STANCE_PY, keys: UPSWING },
  hb_attack_upswing_low_01: { base: STANCE, basePy: STANCE_PY, keys: UPSWING_LOW },
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
  // ---- 道具と剥ぎ取り（M2 後半）----
  // 回復液（v0.58.0。2G を手本に、取り出す → 飲む → 効き目 → 決め姿勢 → しまう に分けた）: 右手で腰の袋から瓶を取り出し（〜12）、
  // 口元へ上げて、左手を腰に当て、上を向いて飲み干す（20〜58。58 tick で効果）。腕を下ろし、両腕を横へ上げて力を込める決め姿勢（76〜106）
  common_item_drink_01: {
    base: NEUTRAL, basePy: 0,
    keys: [
      { t: 0 },
      { t: 12, j: { chest: [6, -10, 0], head: [12, -6, 0], upperArmR: [14, 0, -16], forearmR: [-34, 0, 0] }, py: -0.01 },
      { t: 20, j: { chest: [0, -4, 0], head: [4, 0, 0], upperArmR: [-72, 0, -18], forearmR: [-100, 0, 0], upperArmL: [8, 0, 34], forearmL: [-64, 0, 0] } },
      { t: 30, j: { spine: [-4, 0, 0], chest: [-8, 0, 0], head: [-24, 0, 0], upperArmR: [-104, 0, -22], forearmR: [-120, 0, 0], upperArmL: [8, 0, 36], forearmL: [-66, 0, 0] } },
      { t: 58, j: { spine: [-6, 0, 0], chest: [-10, 0, 0], head: [-30, 0, 0], upperArmR: [-112, 0, -22], forearmR: [-126, 0, 0], upperArmL: [8, 0, 36], forearmL: [-66, 0, 0] } },
      { t: 66, j: { chest: [-2, 0, 0], head: [-6, 0, 0], upperArmR: [-40, 0, -12], forearmR: [-60, 0, 0], upperArmL: [2, 0, 18], forearmL: [-30, 0, 0] } },
      // 決め姿勢（v0.40.0。2G に合わせた）: 両腕を横へ上げて力を込め（76〜106）、下ろして戻る。この間は動けない
      { t: 76, j: FLEX, py: -0.05 },
      { t: 84, j: { ...FLEX, upperArmL: [-14, 0, 84], upperArmR: [-14, 0, -84], forearmL: [0, 0, 104], forearmR: [0, 0, -104] }, py: -0.07 },
      { t: 92, j: FLEX, py: -0.04 },
      { t: 106, j: { ...FLEX, upperArmL: [-14, 0, 84], upperArmR: [-14, 0, -84], forearmL: [0, 0, 104], forearmR: [0, 0, -104] }, py: -0.06 },
      { t: 116, j: { upperArmL: [0, 0, 20], upperArmR: [0, 0, -20], forearmL: [-20, 0, 0], forearmR: [-20, 0, 0] }, py: -0.01 },
      { t: 124 },
    ],
  },
  // 拘束罠（v0.64.0。2G を手本に、取り出す → しゃがむ → 据える → 押し込む → 立つ に分けた）: 右手で腰の袋から罠を取り出し（〜10）、
  // 片ひざを突いて両手で体の前に持ち（22）、地面へ下ろして（40）、両手で 2 回押し込み（56・76）、手を離して（84 tick で設置）、立つ。
  common_item_place_01: {
    base: NEUTRAL, basePy: 0,
    keys: [
      { t: 0 },
      { t: 10, j: { chest: [4, -12, 0], upperArmR: [24, 0, -22], forearmR: [-70, 0, 0], thighL: [-8, 0, 3], shinL: [10, 0, 0] }, py: -0.03 },
      { t: 22, j: { spine: [26, 0, 0], chest: [14, 0, 0], head: [14, 0, 0], thighL: [-80, 0, 6], shinL: [110, 0, 0], thighR: [-18, 0, -6], shinR: [100, 0, 0], upperArmL: [-46, 0, 14], forearmL: [-46, 0, 0], upperArmR: [-46, 0, -14], forearmR: [-46, 0, 0] }, py: -0.43 },
      { t: 40, j: { spine: [36, 0, 0], chest: [22, 0, 0], head: [16, 0, 0], thighL: [-80, 0, 6], shinL: [112, 0, 0], thighR: [-20, 0, -6], shinR: [98, 0, 0], upperArmL: [-62, 0, 10], forearmL: [-18, 0, 0], upperArmR: [-62, 0, -10], forearmR: [-18, 0, 0] }, py: -0.45 },
      { t: 56, j: { spine: [42, 0, 0], chest: [24, 0, 0], head: [18, 0, 0], thighL: [-80, 0, 6], shinL: [112, 0, 0], thighR: [-20, 0, -6], shinR: [98, 0, 0], upperArmL: [-56, 0, 8], forearmL: [-4, 0, 0], upperArmR: [-56, 0, -8], forearmR: [-4, 0, 0] }, py: -0.47 },
      { t: 66, j: { spine: [34, 0, 0], chest: [20, 0, 0], head: [16, 0, 0], thighL: [-80, 0, 6], shinL: [112, 0, 0], thighR: [-20, 0, -6], shinR: [98, 0, 0], upperArmL: [-60, 0, 10], forearmL: [-28, 0, 0], upperArmR: [-60, 0, -10], forearmR: [-28, 0, 0] }, py: -0.45 },
      { t: 76, j: { spine: [42, 0, 0], chest: [24, 0, 0], head: [18, 0, 0], thighL: [-80, 0, 6], shinL: [112, 0, 0], thighR: [-20, 0, -6], shinR: [98, 0, 0], upperArmL: [-56, 0, 8], forearmL: [-4, 0, 0], upperArmR: [-56, 0, -8], forearmR: [-4, 0, 0] }, py: -0.47 },
      { t: 84, j: { spine: [30, 0, 0], chest: [16, 0, 0], head: [12, 0, 0], thighL: [-80, 0, 6], shinL: [110, 0, 0], thighR: [-20, 0, -6], shinR: [98, 0, 0], upperArmL: [-36, 0, 14], forearmL: [-50, 0, 0], upperArmR: [-36, 0, -14], forearmR: [-50, 0, 0] }, py: -0.44 },
      { t: 100, j: { spine: [12, 0, 0], thighL: [-30, 0, 4], shinL: [40, 0, 0], thighR: [-8, 0, -4], shinR: [30, 0, 0] }, py: -0.12 },
      { t: 112 },
    ],
  },
  // 投げる玉（鎮静玉・標識玉。v0.64.0。2G を手本に、取り出す → 構える → 踏み込んで投げる → 振り抜く に分けた）: 右手で腰の袋から玉を取り（〜6）、
  // 右足へ体重を乗せて左腕で狙い、右腕を頭の後ろへ引き（12）、左足を踏み込みながら上から投げる（22 tick で手を離れる）。振り抜いて戻る。
  common_item_throw_01: {
    base: NEUTRAL, basePy: 0,
    keys: [
      { t: 0 },
      { t: 6, j: { chest: [4, -10, 0], upperArmR: [20, 0, -20], forearmR: [-60, 0, 0] } },
      { t: 13, j: { spine: [-4, 0, 0], chest: [-6, -30, 0], head: [0, 22, 0], upperArmR: [-150, 0, -30], forearmR: [-92, 0, 0], upperArmL: [-80, 0, 20], forearmL: [-10, 0, 0], thighL: [-20, 0, 4], shinL: [10, 0, 0], thighR: [10, 0, -4], shinR: [24, 0, 0] }, py: -0.04 },
      { t: 22, j: { spine: [10, 0, 0], chest: [12, 28, 0], head: [0, -14, 0], upperArmR: [-62, 0, 6], forearmR: [-6, 0, 0], upperArmL: [-20, 0, 18], forearmL: [-40, 0, 0], thighL: [-30, 0, 4], shinL: [30, 0, 0], thighR: [16, 0, -4], shinR: [20, 0, 0] }, py: -0.07 },
      { t: 30, j: { spine: [14, 0, 0], chest: [14, 30, 0], head: [0, -16, 0], upperArmR: [-20, 0, 14], forearmR: [-10, 0, 0], upperArmL: [0, 0, 20], forearmL: [-30, 0, 0], thighL: [-28, 0, 4], shinL: [30, 0, 0], thighR: [16, 0, -4], shinR: [22, 0, 0] }, py: -0.06 },
      { t: 46 },
    ],
  },
  // 研磨石: 片ひざを突き、ひざの前に渡した武器を研ぐ。96 tick で研ぎ上がる。
  // ここで決めるのは脚と体だけ。武器の位置と腕は、描画の側（view.ts）が構えから渡した位置へ動かして、手を合わせる。
  common_item_whet_01: {
    base: STANCE, basePy: STANCE_PY,
    keys: [
      { t: 0 },
      { t: 18, j: { spine: [24, 0, 0], chest: [12, 6, 0], head: [16, 8, 0], thighL: [-82, 0, 6], shinL: [112, 0, 0], thighR: [-16, 0, -6], shinR: [98, 0, 0] } },
      { t: 38, j: { spine: [26, 0, 0], chest: [14, 10, 0], head: [18, 10, 0], thighL: [-82, 0, 6], shinL: [112, 0, 0], thighR: [-16, 0, -6], shinR: [98, 0, 0] } },
      { t: 51, j: { spine: [24, 0, 0], chest: [12, 4, 0], head: [16, 8, 0], thighL: [-82, 0, 6], shinL: [112, 0, 0], thighR: [-16, 0, -6], shinR: [98, 0, 0] } },
      { t: 64, j: { spine: [26, 0, 0], chest: [14, 10, 0], head: [18, 10, 0], thighL: [-82, 0, 6], shinL: [112, 0, 0], thighR: [-16, 0, -6], shinR: [98, 0, 0] } },
      { t: 77, j: { spine: [24, 0, 0], chest: [12, 4, 0], head: [16, 8, 0], thighL: [-82, 0, 6], shinL: [112, 0, 0], thighR: [-16, 0, -6], shinR: [98, 0, 0] } },
      { t: 96, j: { spine: [22, 0, 0], chest: [10, 8, 0], head: [12, 8, 0], thighL: [-82, 0, 6], shinL: [112, 0, 0], thighR: [-16, 0, -6], shinR: [98, 0, 0] } },
      { t: 110, j: { spine: [10, 0, 0], thighL: [-30, 0, 4], shinL: [40, 0, 0], thighR: [-8, 0, -4], shinR: [30, 0, 0] }, py: -0.12 },
      { t: 120 },
    ],
  },
  // 剥ぎ取り（v0.64.0。2G を手本に、小刀を抜く → ひざを突く → 突き入れて引く を 2 回 → 素材をつかむ → 掲げる → 立つ に分けた）:
  // 右手で腰の小刀を抜き（〜10）、片ひざを突いて左手で獲物を押さえ（20）、小刀を突き入れて手前へ引き切る（30・40、50・60）。
  // 左手で素材をつかみ（70）、胸の前へ持ち上げる（80 tick で素材が手に入る）。立つ。
  common_carve_01: {
    base: NEUTRAL, basePy: 0,
    keys: [
      { t: 0 },
      { t: 10, j: { chest: [4, -8, 0], upperArmR: [20, 0, -18], forearmR: [-60, 0, 0], thighL: [-10, 0, 3], shinL: [12, 0, 0] }, py: -0.05 },
      { t: 20, j: { spine: [28, 0, 0], chest: [14, 0, 0], head: [14, 0, 0], thighL: [-82, 0, 6], shinL: [112, 0, 0], thighR: [-16, 0, -6], shinR: [98, 0, 0], upperArmR: [-60, 0, -10], forearmR: [-40, 0, 0], upperArmL: [-44, 0, 12], forearmL: [-50, 0, 0] }, py: -0.43 },
      { t: 30, j: { spine: [34, 0, 0], chest: [18, 10, 0], head: [16, 0, 0], thighL: [-82, 0, 6], shinL: [112, 0, 0], thighR: [-16, 0, -6], shinR: [98, 0, 0], upperArmR: [-78, 0, -6], forearmR: [-8, 0, 0], upperArmL: [-46, 0, 12], forearmL: [-44, 0, 0] }, py: -0.44 },
      { t: 40, j: { spine: [26, 0, 0], chest: [12, -8, 0], head: [14, 0, 0], thighL: [-82, 0, 6], shinL: [112, 0, 0], thighR: [-16, 0, -6], shinR: [98, 0, 0], upperArmR: [-38, 0, -14], forearmR: [-74, 0, 0], upperArmL: [-44, 0, 12], forearmL: [-50, 0, 0] }, py: -0.43 },
      { t: 50, j: { spine: [34, 0, 0], chest: [18, 10, 0], head: [16, 0, 0], thighL: [-82, 0, 6], shinL: [112, 0, 0], thighR: [-16, 0, -6], shinR: [98, 0, 0], upperArmR: [-78, 0, -6], forearmR: [-8, 0, 0], upperArmL: [-46, 0, 12], forearmL: [-44, 0, 0] }, py: -0.44 },
      { t: 60, j: { spine: [26, 0, 0], chest: [12, -8, 0], head: [14, 0, 0], thighL: [-82, 0, 6], shinL: [112, 0, 0], thighR: [-16, 0, -6], shinR: [98, 0, 0], upperArmR: [-38, 0, -14], forearmR: [-74, 0, 0], upperArmL: [-44, 0, 12], forearmL: [-50, 0, 0] }, py: -0.43 },
      { t: 70, j: { spine: [32, 0, 0], chest: [16, 6, 0], head: [16, 0, 0], thighL: [-82, 0, 6], shinL: [112, 0, 0], thighR: [-16, 0, -6], shinR: [98, 0, 0], upperArmR: [-34, 0, -16], forearmR: [-60, 0, 0], upperArmL: [-64, 0, 8], forearmL: [-14, 0, 0] }, py: -0.44 },
      { t: 80, j: { spine: [16, 0, 0], chest: [6, 0, 0], head: [6, 0, 0], thighL: [-82, 0, 6], shinL: [112, 0, 0], thighR: [-16, 0, -6], shinR: [98, 0, 0], upperArmR: [-26, 0, -14], forearmR: [-46, 0, 0], upperArmL: [-74, 0, 22], forearmL: [-96, 0, 0] }, py: -0.42 },
      { t: 92, j: { spine: [10, 0, 0], thighL: [-30, 0, 4], shinL: [40, 0, 0], thighR: [-8, 0, -4], shinR: [30, 0, 0], upperArmL: [-30, 0, 16], forearmL: [-60, 0, 0] }, py: -0.12 },
      { t: 100 },
    ],
  },
  // 採集（v0.27.0。狩らない依頼）: 片ひざを突き、右手で草を探って摘み、左の腰の袋へ入れる。72 tick で品が入る（6〜72 は回避で止められる）
  common_net_01: {base:NEUTRAL,basePy:0,keys:[
 {t:0},{t:15,j:{chest:[0,-24,0],upperArmR:[-65,-10,-45],forearmR:[-35,0,0],upperArmL:[-20,0,15]}},
 {t:35,j:{chest:[-8,-38,0],upperArmR:[-125,-25,-32],forearmR:[-20,0,0],thighL:[-18,0,5],shinL:[25,0,0]},py:-.05},
 {t:51,j:{chest:[24,26,0],upperArmR:[-48,22,-5],forearmR:[-14,0,0],thighR:[-32,0,0],shinR:[50,0,0]},py:-.12},
 {t:70,j:{spine:[18,0,0],upperArmR:[-36,0,-10],forearmR:[-70,0,0],upperArmL:[-40,0,8],forearmL:[-45,0,0]},py:-.04},{t:89,j:{upperArmR:[-25,0,-8],forearmR:[-35,0,0]}},{t:105}]},
 common_fish_01:{base:NEUTRAL,basePy:0,keys:[
 {t:0},{t:14,j:{chest:[0,-12,0],upperArmR:[-100,-18,-16],forearmR:[-45,0,0]}},
 {t:34,j:{chest:[14,8,0],upperArmR:[-55,0,-9],forearmR:[-20,0,0],upperArmL:[-38,0,8],forearmL:[-60,0,0]}},
 {t:75,j:{upperArmR:[-35,0,-9],forearmR:[-38,0,0],upperArmL:[-24,0,8],forearmL:[-50,0,0]}},
 {t:144,j:{upperArmR:[-35,0,-9],forearmR:[-38,0,0],upperArmL:[-24,0,8],forearmL:[-50,0,0]}},
 {t:204,j:{upperArmR:[-35,0,-9],forearmR:[-38,0,0],upperArmL:[-24,0,8],forearmL:[-50,0,0]}},
 {t:219,j:{chest:[-8,0,0],upperArmR:[-95,0,-15],forearmR:[-38,0,0]}},{t:240}]},
 common_gather_01: {
    base: NEUTRAL, basePy: 0,
    keys: [
      { t: 0 },
      { t: 14, j: { spine: [30, 0, 0], chest: [14, 0, 0], head: [14, 0, 0], thighL: [-82, 0, 6], shinL: [112, 0, 0], thighR: [-16, 0, -6], shinR: [98, 0, 0], upperArmR: [-62, 0, -8], forearmR: [-30, 0, 0], upperArmL: [-40, 0, 12], forearmL: [-50, 0, 0] }, py: -0.43 },
      { t: 28, j: { spine: [26, 0, 0], chest: [12, -6, 0], head: [16, 0, 0], thighL: [-82, 0, 6], shinL: [112, 0, 0], thighR: [-16, 0, -6], shinR: [98, 0, 0], upperArmR: [-38, 0, -12], forearmR: [-72, 0, 0], upperArmL: [-40, 0, 12], forearmL: [-50, 0, 0] }, py: -0.43 },
      { t: 42, j: { spine: [32, 0, 0], chest: [18, 8, 0], head: [18, 6, 0], thighL: [-82, 0, 6], shinL: [112, 0, 0], thighR: [-16, 0, -6], shinR: [98, 0, 0], upperArmR: [-66, 0, -4], forearmR: [-24, 0, 0], upperArmL: [-40, 0, 12], forearmL: [-50, 0, 0] }, py: -0.44 },
      { t: 56, j: { spine: [26, 0, 0], chest: [12, -6, 0], head: [16, 0, 0], thighL: [-82, 0, 6], shinL: [112, 0, 0], thighR: [-16, 0, -6], shinR: [98, 0, 0], upperArmR: [-36, 0, -12], forearmR: [-76, 0, 0], upperArmL: [-40, 0, 12], forearmL: [-50, 0, 0] }, py: -0.43 },
      { t: 72, j: { spine: [18, 0, 0], chest: [8, -12, 0], head: [10, -8, 0], thighL: [-82, 0, 6], shinL: [112, 0, 0], thighR: [-16, 0, -6], shinR: [98, 0, 0], upperArmR: [-22, 0, -18], forearmR: [-92, 0, 0], upperArmL: [-18, 0, 14], forearmL: [-34, 0, 0] }, py: -0.42 },
      { t: 84, j: { spine: [10, 0, 0], thighL: [-30, 0, 4], shinL: [40, 0, 0], thighR: [-8, 0, -4], shinR: [30, 0, 0] }, py: -0.12 },
      { t: 90 },
    ],
  },
  // 採掘（v0.27.0）: 足を開いて構え、借りた採掘道具を 3 回振り下ろし（42・76・110）、しゃがんで鉱石を拾う。126 tick で品が入る（6〜126 は回避で止められる）
  common_mine_01: {
    base: NEUTRAL, basePy: 0,
    keys: [
      { t: 0 },
      { t: 12, j: { spine: [12, 0, 0], thighL: [-22, 0, 8], shinL: [26, 0, 0], thighR: [10, 0, -8], shinR: [22, 0, 0], upperArmR: [-42, 0, -10], forearmR: [-52, 0, 0], upperArmL: [-42, 0, 10], forearmL: [-52, 0, 0] }, py: -0.06 },
      { t: 30, j: { spine: [-4, 0, 0], chest: [-6, 0, 0], head: [-8, 0, 0], thighL: [-22, 0, 8], shinL: [26, 0, 0], thighR: [10, 0, -8], shinR: [22, 0, 0], upperArmR: [-150, 0, -8], forearmR: [-40, 0, 0], upperArmL: [-140, 0, 8], forearmL: [-42, 0, 0] }, py: -0.04 },
      { t: 42, j: { spine: [34, 0, 0], chest: [16, 0, 0], head: [10, 0, 0], thighL: [-30, 0, 8], shinL: [36, 0, 0], thighR: [6, 0, -8], shinR: [30, 0, 0], upperArmR: [-52, 0, -8], forearmR: [-12, 0, 0], upperArmL: [-48, 0, 8], forearmL: [-14, 0, 0] }, py: -0.12 },
      { t: 50, j: { spine: [30, 0, 0], chest: [14, 0, 0], head: [10, 0, 0], thighL: [-30, 0, 8], shinL: [36, 0, 0], thighR: [6, 0, -8], shinR: [30, 0, 0], upperArmR: [-58, 0, -8], forearmR: [-18, 0, 0], upperArmL: [-54, 0, 8], forearmL: [-20, 0, 0] }, py: -0.11 },
      { t: 64, j: { spine: [-4, 0, 0], chest: [-6, 0, 0], head: [-8, 0, 0], thighL: [-22, 0, 8], shinL: [26, 0, 0], thighR: [10, 0, -8], shinR: [22, 0, 0], upperArmR: [-150, 0, -8], forearmR: [-40, 0, 0], upperArmL: [-140, 0, 8], forearmL: [-42, 0, 0] }, py: -0.04 },
      { t: 76, j: { spine: [34, 0, 0], chest: [16, 0, 0], head: [10, 0, 0], thighL: [-30, 0, 8], shinL: [36, 0, 0], thighR: [6, 0, -8], shinR: [30, 0, 0], upperArmR: [-52, 0, -8], forearmR: [-12, 0, 0], upperArmL: [-48, 0, 8], forearmL: [-14, 0, 0] }, py: -0.12 },
      { t: 84, j: { spine: [30, 0, 0], chest: [14, 0, 0], head: [10, 0, 0], thighL: [-30, 0, 8], shinL: [36, 0, 0], thighR: [6, 0, -8], shinR: [30, 0, 0], upperArmR: [-58, 0, -8], forearmR: [-18, 0, 0], upperArmL: [-54, 0, 8], forearmL: [-20, 0, 0] }, py: -0.11 },
      { t: 98, j: { spine: [-4, 0, 0], chest: [-6, 0, 0], head: [-8, 0, 0], thighL: [-22, 0, 8], shinL: [26, 0, 0], thighR: [10, 0, -8], shinR: [22, 0, 0], upperArmR: [-150, 0, -8], forearmR: [-40, 0, 0], upperArmL: [-140, 0, 8], forearmL: [-42, 0, 0] }, py: -0.04 },
      { t: 110, j: { spine: [34, 0, 0], chest: [16, 0, 0], head: [10, 0, 0], thighL: [-30, 0, 8], shinL: [36, 0, 0], thighR: [6, 0, -8], shinR: [30, 0, 0], upperArmR: [-52, 0, -8], forearmR: [-12, 0, 0], upperArmL: [-48, 0, 8], forearmL: [-14, 0, 0] }, py: -0.12 },
      { t: 126, j: { spine: [30, 0, 0], chest: [14, 0, 0], head: [14, 0, 0], thighL: [-82, 0, 6], shinL: [112, 0, 0], thighR: [-16, 0, -6], shinR: [98, 0, 0], upperArmR: [-70, 0, -6], forearmR: [-28, 0, 0], upperArmL: [-58, 0, 10], forearmL: [-34, 0, 0] }, py: -0.43 },
      { t: 140, j: { spine: [10, 0, 0], thighL: [-30, 0, 4], shinL: [40, 0, 0], thighR: [-8, 0, -4], shinR: [30, 0, 0], upperArmR: [-30, 0, -10], forearmR: [-60, 0, 0] }, py: -0.12 },
      { t: 150 },
    ],
  },
  // 納品（v0.27.0）: 前へかがんで、両手で納品箱へ入れる。30 tick で納まる
  common_deliver_01: {
    base: NEUTRAL, basePy: 0,
    keys: [
      { t: 0 },
      { t: 14, j: { spine: [36, 0, 0], chest: [10, 0, 0], head: [10, 0, 0], thighL: [-36, 0, 4], shinL: [44, 0, 0], thighR: [-36, 0, -4], shinR: [44, 0, 0], upperArmR: [-76, 0, -6], forearmR: [-24, 0, 0], upperArmL: [-76, 0, 6], forearmL: [-24, 0, 0] }, py: -0.18 },
      { t: 30, j: { spine: [44, 0, 0], chest: [12, 0, 0], head: [12, 0, 0], thighL: [-40, 0, 4], shinL: [50, 0, 0], thighR: [-40, 0, -4], shinR: [50, 0, 0], upperArmR: [-64, 0, -6], forearmR: [-12, 0, 0], upperArmL: [-64, 0, 6], forearmL: [-12, 0, 0] }, py: -0.22 },
      { t: 42, j: { spine: [10, 0, 0], thighL: [-10, 0, 2], shinL: [12, 0, 0], thighR: [-10, 0, -2], shinR: [12, 0, 0] }, py: -0.04 },
      { t: 48 },
    ],
  },
  // 前転（v0.58.0。2G を手本に、予備 → 蹴り出し → 回る → 着く → 立て直す に分けた）: 腰を落として両腕を前へ出し（〜3）、
  // 後ろ足で蹴って前へ飛び込み、両手を地面へ（6）。丸まって肩から回り（10〜17）、足から着いて低くしゃがみ（22〜26）、立ち上がる
  common_roll_01: {
    base: NEUTRAL, basePy: 0,
    keys: [
      { t: 0, tumble: 0 },
      { t: 3, j: { spine: [22, 0, 0], chest: [10, 0, 0], head: [-10, 0, 0], thighL: [-38, 0, 2], shinL: [52, 0, 0], thighR: [-20, 0, -2], shinR: [40, 0, 0], upperArmL: [-55, 0, 14], upperArmR: [-55, 0, -14], forearmL: [-20, 0, 0], forearmR: [-20, 0, 0] }, py: -0.16, tumble: 10, drop: -0.04 },
      { t: 6, j: { spine: [30, 0, 0], chest: [14, 0, 0], neck: [12, 0, 0], head: [-4, 0, 0], thighL: [-40, 0, 2], shinL: [50, 0, 0], thighR: [4, 0, -2], shinR: [30, 0, 0], upperArmL: [-85, 0, 16], upperArmR: [-85, 0, -16], forearmL: [-20, 0, 0], forearmR: [-20, 0, 0] }, py: -0.2, tumble: 48, drop: -0.12 },
      { t: 10, j: TUCK, py: -0.2, tumble: 130, drop: -0.21 },
      { t: 17, j: TUCK, py: -0.2, tumble: 250, drop: -0.21 },
      { t: 22, j: { ...HALF_TUCK, thighL: [-80, 0, 4], shinL: [108, 0, 0], thighR: [-62, 0, -4], shinR: [96, 0, 0], upperArmL: [-45, 0, 14], upperArmR: [-45, 0, -14] }, py: -0.3, tumble: 345, drop: -0.12 },
      { t: 26, j: { spine: [26, 0, 0], chest: [10, 0, 0], head: [-14, 0, 0], thighL: [-78, 0, 6], shinL: [104, 0, 0], thighR: [-58, 0, -6], shinR: [92, 0, 0], upperArmL: [-38, 0, 16], upperArmR: [-38, 0, -16], forearmL: [-34, 0, 0], forearmR: [-34, 0, 0] }, py: -0.32, tumble: 360, drop: 0 },
      { t: 31, j: { spine: [12, 0, 0], chest: [4, 0, 0], thighL: [-30, 0, 4], shinL: [40, 0, 0], thighR: [-22, 0, -4], shinR: [32, 0, 0], upperArmL: [-14, 0, 12], upperArmR: [-14, 0, -12], forearmL: [-24, 0, 0], forearmR: [-24, 0, 0] }, py: -0.1, tumble: 360 },
      { t: 36, tumble: 360 },
    ],
  },
};

// 断岳剣以外（護刃・長尖槍・環弓・大槌・双剣・太刀）の動きは、ここには無い。体・武器・盾をまとめて解く方式（hunterAnim.ts、bodySolve.ts）で、
// キーは tools/gen-weapons.mjs が weaponClipSpecs.ts へ書き出す。

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

/** clip の長さ（tick）。キー姿勢の clip と、解く方式の動きの両方を見る。無ければ 0。 */
export const clipDuration = (name: string): number => {
  const c = CLIPS[name];
  return c ? c.keys[c.keys.length - 1]!.t : WEAPON_MOTIONS[name]?.dur ?? 0;
};
/** clip があるか（キー姿勢か、解く方式の動きのどちらか） */
export const hasClip = (name: string): boolean => !!CLIPS[name] || !!WEAPON_MOTIONS[name];

/**
 * 納刀の歩き・走り・疾走の上半身の形（v0.58.0。動きの組で入れ替わる。D-150）。値は a + b × 走りの度合い（0 = 止まる〜 1 = 疾走 6.4m/s）。
 * thigh: 太ももを振る角度、thighLean: 太ももを前へ寄せる量、knee: ひざを上げる量、arm: 腕を振る大きさ（太ももの振りに掛ける）、
 * armForward: 腕を前へ寄せる量（負 = 前）、armOut: 腕を開く角度、forearm: ひじの曲げ（負 = 曲げる）、lean: 背の前傾、twist: 胸のひねり、head: 頭の上下（負 = 上）
 */
export interface LocoStyle {
  thigh: [number, number];
  thighLean: number;
  knee: [number, number];
  arm: number;
  armForward: number;
  armOut: number;
  forearm: [number, number];
  lean: [number, number];
  twist: number;
  head: [number, number];
}
/**
 * 2G を手本にした形（v0.58.0）: 走るほど背を前へ倒し（疾走で 18°）、頭は前を見たまま。ひじを直角近くまで曲げ、腕を前寄りに大きく振る。
 * 疾走はひざを高く上げる。v0.56.0 までの形は motionsets/v056.ts の LOCO_STYLE
 */
export const LOCO_STYLE: LocoStyle = { thigh: [24, 22], thighLean: 6, knee: [44, 28], arm: 0.95, armForward: -8, armOut: 10, forearm: [-30, -60], lean: [3, 15], twist: 10, head: [-2, -9] };

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
  const S = LOCO_STYLE;
  const amp = drawn ? 20 : S.thigh[0] + S.thigh[1] * run;
  const s = Math.sin(phase);
  const knee = (ph: number): number => 10 + (drawn ? 30 : S.knee[0] + S.knee[1] * run) * Math.max(0, Math.sin(ph - 0.9));
  if (drawn) {
    p.j.thighL[0] += -amp * s;
    p.j.thighR[0] += amp * s;
    p.j.shinL[0] += knee(phase) * 0.6;
    p.j.shinR[0] += knee(phase + Math.PI) * 0.6;
  } else {
    p.j.thighL = [-amp * s - S.thighLean * run, 0, 2];
    p.j.thighR = [amp * s - S.thighLean * run, 0, -2];
    p.j.shinL = [knee(phase), 0, 0];
    p.j.shinR = [knee(phase + Math.PI), 0, 0];
    p.j.upperArmL = [amp * S.arm * s + S.armForward * run, 0, S.armOut];
    p.j.upperArmR = [-amp * S.arm * s + S.armForward * run, 0, -S.armOut];
    p.j.forearmL = [S.forearm[0] + S.forearm[1] * run, 0, 0];
    p.j.forearmR = [S.forearm[0] + S.forearm[1] * run, 0, 0];
    p.j.spine = [S.lean[0] + S.lean[1] * run, 0, 0];
    p.j.chest = [breathe * 1.2, -S.twist * s * run, 0];
    p.j.head = [S.head[0] + S.head[1] * run, 0, 0];
  }
  // 腰の上下は、足の運びと一緒に GroundedLocomotion が決める（v0.28.1。ここで別の波を足すと、足の届きと食い違って腰が跳ねる）
  return p;
}

/** 防御。blend 0 = 構え、1 = 防御姿勢。 */
export function guardPose(blend: number, shake: number): BodyPose {
  const a = fromKey(STANCE, STANCE_PY, { t: 0 });
  const b = fromKey(STANCE, STANCE_PY, { t: 0, j: { ...STANCE, spine: [12 + shake * 6, 0, 0], chest: [4, 14, 0], thighL: [-24, 0, 6], shinL: [34, 0, 0], thighR: [20, 0, -6], shinR: [26, 0, 0], head: [6, -8, 0] }, py: -0.11 });
  return blendPose(a, b, smoothstep(blend));
}

/**
 * 被弾の動きの形（v0.64.0。D-150・D-160）。'2g' = 2G を手本に作り直した形（当たった向きへ上体が持っていかれて踏み直す怯み、
 * 宙へ浮いて背から落ち、転がって片ひざから立つ転倒、腕を跳ね上げられる弾かれ）、'v056' = 保留の組（v0.63.0 までの形）。
 * 設定の「ハンターの動き」で入れ替わる（src/render/motionSet.ts）。
 */
export const HURT_STYLE: { style: '2g' | 'v056' } = { style: '2g' };

/** 片ひざを突いて、片手を地面に着いた形（転倒からの起き上がりの途中） */
const KNEEL: J = {
  spine: [34, 0, 0], chest: [14, 0, 0], neck: [6, 0, 0], head: [-14, 0, 0],
  thighL: [-78, 0, 6], shinL: [96, 0, 0], thighR: [12, 0, -6], shinR: [112, 0, 0],
  upperArmL: [-30, 0, 22], forearmL: [-40, 0, 0], upperArmR: [-46, 0, -16], forearmR: [-10, 0, 0],
};
/** 宙で手足が開いた形（吹き飛び） */
const FLUNG: J = {
  spine: [-18, 0, 0], chest: [-10, 0, 0], head: [16, 0, 0],
  upperArmL: [-40, 0, 62], upperArmR: [-40, 0, -62], forearmL: [-30, 0, 0], forearmR: [-30, 0, 0],
  thighL: [-34, 0, 12], shinL: [46, 0, 0], thighR: [-8, 0, -10], shinR: [20, 0, 0],
};

/**
 * rel: 押された向き（体の向きから測った角度。0 = 前へ、π = 後ろへ、+π/2 = 左へ）。怯みと弾かれで、上体が持っていかれる向き。
 */
export function hurtPose(kind: 'flinch' | 'knockdown' | 'break' | 'bounce' | 'para' | 'sleep' | 'stun', tick: number, duration: number, drawn: boolean, rel = Math.PI): BodyPose {
  if (HURT_STYLE.style === 'v056') return hurtPoseV056(kind, tick, duration, drawn);
  const base = drawn ? STANCE : NEUTRAL;
  const basePy = drawn ? STANCE_PY : 0;
  if (kind === 'para' || kind === 'stun' || kind === 'sleep') return statusPose(kind, base, basePy, tick, duration);
  if (kind === 'break') return hurtPoseV056(kind, tick, duration, drawn);
  let keys: Key[];
  if (kind === 'flinch' || kind === 'bounce') {
    // 怯み: 当たった瞬間に上体が押された向きへ持っていかれ（頭は遅れて逆へ振れる）、腕が開いて、押された側の足を踏み直して受け止め、構えへ戻る。
    // 弾かれ: 武器ごと腕を上へ跳ね上げられ、上体がのけぞって半歩下がる。
    const f = Math.cos(rel), s = Math.sin(rel);
    const bounce = kind === 'bounce';
    const P = bounce ? -22 : 21 * f; // 前へ曲げる（+）・のけぞる（−）
    const R = bounce ? 0 : -16 * s; // 左右へ傾ける
    const D = Math.max(1, duration);
    const at = (u: number): number => Math.round(D * u * 100) / 100;
    // 踏み直す足: 後ろへ押されたら後ろ足（右）、前へ押されたら前足（左）、横へは押された側の足
    const stepR = bounce || f < -0.3 || (Math.abs(f) <= 0.3 && s < 0);
    const step: J = stepR
      ? { thighR: [26 * (f < 0 ? 1 : 0.4), 0, -8 - 10 * Math.max(0, -s)], shinR: [34, 0, 0], thighL: [-20, 0, 4], shinL: [30, 0, 0] }
      : { thighL: [-34 * (f >= 0 ? 1 : 0.4), 0, 8 + 10 * Math.max(0, s)], shinL: [44, 0, 0], thighR: [14, 0, -4], shinR: [26, 0, 0] };
    const arms: J = bounce
      ? { upperArmL: [-130, 0, 24], upperArmR: [-130, 0, -24], forearmL: [-34, 0, 0], forearmR: [-34, 0, 0] }
      : { upperArmL: [-22, 0, 34], upperArmR: [-22, 0, -34], forearmL: [-46, 0, 0], forearmR: [-46, 0, 0] };
    keys = [
      { t: 0 },
      { t: at(0.1), j: { ...base, ...arms, pelvis: [P * 0.15, 0, R * 0.3], spine: [P * 0.7, 0, R * 0.7], chest: [P * 0.4, 0, R * 0.5], neck: [0, 0, 0], head: [-P * 0.1, 0, -R * 0.2], thighL: [-22, 0, 4], shinL: [34, 0, 0], thighR: [16, 0, -4], shinR: [30, 0, 0] }, py: basePy - 0.07 },
      { t: at(0.3), j: { ...base, ...arms, ...step, pelvis: [P * 0.2, 0, R * 0.4], spine: [P, 0, R], chest: [P * 0.5, 0, R * 0.6], neck: [-P * 0.2, 0, -R * 0.3], head: [-P * 0.35, 0, -R * 0.4] }, py: basePy - 0.1 },
      { t: at(0.55), j: { ...base, ...step, spine: [P * 0.45, 0, R * 0.4], chest: [P * 0.25, 0, R * 0.3], head: [-P * 0.1, 0, -R * 0.1], upperArmL: [-10, 0, 18], upperArmR: [-10, 0, -18] }, py: basePy - 0.05 },
      { t: D },
    ];
  } else {
    // 転倒: 当たった瞬間に体が浮いて手足が開き、押された向きへ背から落ちる（ほかの所で体の向きを押された向きへ回す: view.ts の tumbleDir）。
    // 落ちて少し弾み、しばらく倒れたまま。横へ転がって片ひじを突き、片ひざを突いて手で地面を押し、立ち上がる。
    keys = [
      { t: 0 },
      { t: 4, j: FLUNG, tumble: -24, drop: 0.08, py: basePy },
      { t: 10, j: FLUNG, tumble: -58, drop: 0.1 },
      { t: 17, j: LYING, tumble: -92, drop: -0.43 },
      { t: 21, j: { ...LYING, thighL: [-30, 0, 10], shinL: [40, 0, 0], head: [-20, 0, 0] }, tumble: -84, drop: -0.38 },
      { t: 26, j: LYING, tumble: -90, drop: -0.43 },
      { t: 44, j: LYING, tumble: -90, drop: -0.43 },
      { t: 54, j: { ...HALF_TUCK, upperArmL: [-10, 0, 40], forearmL: [-80, 0, 0] }, tumble: -52, drop: -0.3, py: -0.12 },
      { t: 64, j: KNEEL, py: -0.36 },
      { t: 74, j: { ...KNEEL, spine: [16, 0, 0], chest: [6, 0, 0], head: [-4, 0, 0], thighR: [0, 0, -4], shinR: [60, 0, 0], upperArmR: [-10, 0, -14] }, py: -0.16 },
      { t: duration },
    ];
  }
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1]!.t <= tick) i++;
  const k0 = keys[i]!;
  const k1 = keys[i + 1]!;
  const u = Math.min(1, Math.max(0, (tick - k0.t) / (k1.t - k0.t)));
  return blendPose(fromKey(base, basePy, k0), fromKey(base, basePy, k1), smoothstep(u));
}

/** 保留の組 v056 の被弾の形（v0.63.0 まで。手を入れない） */
function hurtPoseV056(kind: 'flinch' | 'knockdown' | 'break' | 'bounce' | 'para' | 'sleep' | 'stun', tick: number, duration: number, drawn: boolean): BodyPose {
  const base = drawn ? STANCE : NEUTRAL;
  const basePy = drawn ? STANCE_PY : 0;
  if (kind === 'para' || kind === 'stun' || kind === 'sleep') return statusPose(kind, base, basePy, tick, duration);
  if (kind !== 'knockdown') {
    const u = Math.min(1, tick / Math.max(1, duration));
    const k = Math.sin(Math.min(1, u * 3) * Math.PI * 0.5) * (1 - smoothstep((u - 0.4) / 0.6));
    // 弾かれ（bounce）: 専用の動きはまだ無く、怯みより大きくのけぞる形で代用している（仮）
    const lean = kind === 'break' ? 26 : kind === 'bounce' ? -28 : -20;
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

/**
 * 状態異常で動けない間の姿勢（仮。v0.17.0）。麻痺: 体をこわばらせて小刻みに震える / 気絶: 前かがみで頭を垂れ、ゆっくりふらつく /
 * 睡眠: 倒れて横になり、終わり際に起き上がる。
 */
function statusPose(kind: 'para' | 'stun' | 'sleep', base: J, basePy: number, tick: number, duration: number): BodyPose {
  const inT = smoothstep(Math.min(1, tick / 12));
  const outT = smoothstep(Math.min(1, (duration - tick) / 14));
  if (kind === 'sleep') {
    const keys: Key[] = [
      { t: 0 },
      { t: 18, j: HALF_TUCK, py: -0.25 },
      { t: 40, j: LYING, tumble: -90, drop: -0.43 },
      { t: Math.max(41, duration - 34), j: LYING, tumble: -90, drop: -0.43 },
      { t: Math.max(42, duration - 16), j: HALF_TUCK, tumble: -30, drop: -0.25, py: -0.15 },
      { t: Math.max(43, duration) },
    ];
    let i = 0;
    while (i < keys.length - 2 && keys[i + 1]!.t <= tick) i++;
    const k0 = keys[i]!, k1 = keys[i + 1]!;
    const u = Math.min(1, Math.max(0, (tick - k0.t) / (k1.t - k0.t)));
    const pose = blendPose(fromKey(base, basePy, k0), fromKey(base, basePy, k1), smoothstep(u));
    // 寝息: 胸が少し上下する
    pose.j.chest = [pose.j.chest[0] + Math.sin(tick * 0.09) * 2.5, pose.j.chest[1], pose.j.chest[2]];
    return pose;
  }
  const a = fromKey(base, basePy, { t: 0 });
  if (kind === 'para') {
    const jit = (f: number, s: number): number => Math.sin(tick * f + s) * 2.2;
    const b = fromKey(base, basePy, {
      t: 0, py: basePy - 0.06,
      j: { ...base, spine: [-8 + jit(2.9, 0), jit(3.3, 1), jit(2.6, 2)], chest: [-6, jit(3.1, 3), 0], head: [-12 + jit(3.7, 4), jit(2.3, 5), 0], neck: [-6, 0, 0],
        upperArmL: [-20 + jit(3.4, 6), 0, 28], upperArmR: [-20 + jit(3.0, 7), 0, -28], forearmL: [-35, 0, 0], forearmR: [-35, 0, 0],
        thighL: [-10, 0, 6], shinL: [18 + jit(3.6, 8), 0, 0], thighR: [8, 0, -6], shinR: [14 + jit(2.8, 9), 0, 0] },
    });
    return blendPose(a, b, inT * outT);
  }
  // 気絶
  const sway = Math.sin(tick * 0.07) * 9, nod = Math.sin(tick * 0.11) * 6;
  const b = fromKey(base, basePy, {
    t: 0, py: basePy - 0.12,
    j: { ...base, spine: [24, sway * 0.5, sway * 0.4], chest: [12, 0, sway * 0.3], neck: [20 + nod, 0, 0], head: [22 + nod, sway, sway * 0.6],
      upperArmL: [8, 0, 10], upperArmR: [8, 0, -10], forearmL: [-20, 0, 0], forearmR: [-20, 0, 0],
      thighL: [-28, 0, 6 + sway * 0.3], shinL: [40, 0, 0], thighR: [-18, 0, -6 + sway * 0.3], shinR: [34, 0, 0] },
  });
  return blendPose(a, b, inT * outT);
}

// ---- 登攀（v0.44.0。#19 の H07。仮の手付けの姿勢）----
/** 壁に取り付いた姿勢: 左手が高く右手が低い、右脚を上げた形（B は左右を入れ替えた形）。上体は壁へ少し寄せ、上を見る */
const CLIMB_A: J = {
  spine: [10, 0, 0], chest: [4, 0, 0], head: [-24, 0, 0],
  upperArmL: [-165, 0, 14], forearmL: [-28, 0, 0], upperArmR: [-118, 0, -14], forearmR: [-62, 0, 0],
  thighL: [-18, 0, 7], shinL: [38, 0, 0], thighR: [-62, 0, -7], shinR: [86, 0, 0],
};
const CLIMB_B: J = {
  spine: [10, 0, 0], chest: [4, 0, 0], head: [-24, 0, 0],
  upperArmL: [-118, 0, 14], forearmL: [-62, 0, 0], upperArmR: [-165, 0, -14], forearmR: [-28, 0, 0],
  thighL: [-62, 0, 7], shinL: [86, 0, 0], thighR: [-18, 0, -7], shinR: [38, 0, 0],
};
/** 縁に手を掛けて体を引き上げる: 両手で上の面を押し、右膝を縁へ掛ける */
const CLIMB_PULL: J = {
  spine: [30, 0, 0], chest: [10, 0, 0], head: [-6, 0, 0],
  upperArmL: [-70, 0, 16], forearmL: [-70, 0, 0], upperArmR: [-70, 0, -16], forearmR: [-70, 0, 0],
  thighL: [-10, 0, 5], shinL: [30, 0, 0], thighR: [-95, 0, -5], shinR: [110, 0, 0],
};
/** 1 回の手足の入れ替えで登る高さ（m）。高さから姿勢を決めるので、止まると姿勢も止まる */
const CLIMB_STRIDE = 0.65;

/**
 * 登攀の姿勢。phase は simulation の登攀の段階、u はその段階の進み（0〜1）、h は壁での足の高さ（m）。
 * mount / down は立った姿から壁の姿へ、climb は高さで A と B を行き来する、exit は引き上げてから立つ
 */
export function climbPose(phase: 'mount' | 'down' | 'climb' | 'exit', u: number, h: number): BodyPose {
  const k = 0.5 - 0.5 * Math.cos((Math.PI * h) / CLIMB_STRIDE);
  const wall = blendPose(fromKey(CLIMB_A, 0, { t: 0 }), fromKey(CLIMB_B, 0, { t: 0 }), k);
  const stand = fromKey(NEUTRAL, 0, { t: 0 });
  if (phase === 'climb') return wall;
  if (phase === 'mount' || phase === 'down') return blendPose(stand, wall, smoothstep(u));
  const pull = fromKey(CLIMB_PULL, 0, { t: 0 });
  return u < 0.55 ? blendPose(wall, pull, smoothstep(u / 0.55)) : blendPose(pull, stand, smoothstep((u - 0.55) / 0.45));
}

// ---- 低い岩棚の乗り越え（v0.49.0。#19 の H07 の低棚。仮の手付けの姿勢）----
/** 縁へ手を伸ばす: 上体を前へ倒し、両腕を前へ（手が縁の上の面に届く） */
const VAULT_REACH_J: J = {
  spine: [18, 0, 0], chest: [6, 0, 0], head: [-10, 0, 0],
  upperArmL: [-62, 0, 12], forearmL: [-18, 0, 0], upperArmR: [-62, 0, -12], forearmR: [-18, 0, 0],
  thighL: [-10, 0, 4], shinL: [20, 0, 0], thighR: [-10, 0, -4], shinR: [20, 0, 0],
};
/** 縁に手を突いて体を押し上げる: 腕は下へ押し、右膝を縁へ掛ける。左脚は下に残る */
const VAULT_PUSH_J: J = {
  spine: [28, 0, 0], chest: [8, 0, 0], head: [-14, 0, 0],
  upperArmL: [-22, 0, 18], forearmL: [-28, 0, 0], upperArmR: [-22, 0, -18], forearmR: [-28, 0, 0],
  thighL: [12, 0, 4], shinL: [34, 0, 0], thighR: [-100, 0, -6], shinR: [118, 0, 0],
};
/** 段の上でしゃがむ: 右足が乗り、左脚を引き寄せる */
const VAULT_KNEEL_J: J = {
  spine: [30, 0, 0], chest: [8, 0, 0], head: [-12, 0, 0],
  upperArmL: [-30, 0, 20], forearmL: [-40, 0, 0], upperArmR: [-30, 0, -20], forearmR: [-40, 0, 0],
  thighL: [-44, 0, 6], shinL: [84, 0, 0], thighR: [-70, 0, -8], shinR: [100, 0, 0],
};

/**
 * 乗り越えの姿勢。u は乗り越え全体の進み（0〜1。simulation の VAULT_TICKS を 1 とする）。
 * 縁へ寄る（〜0.25）→ 押し上げる（〜0.55）→ 段の上でしゃがむ（〜0.8）→ 立つ
 */
export function vaultPose(u: number): BodyPose {
  const keys: [number, BodyPose][] = [
    [0, fromKey(NEUTRAL, 0, { t: 0 })],
    [0.25, fromKey(VAULT_REACH_J, 0, { t: 0, py: -0.06 })],
    [0.55, fromKey(VAULT_PUSH_J, 0, { t: 0 })],
    [0.8, fromKey(VAULT_KNEEL_J, 0, { t: 0, py: -0.3 })],
    [1, fromKey(NEUTRAL, 0, { t: 0 })],
  ];
  const v = Math.min(1, Math.max(0, u));
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1]![0] <= v) i++;
  const [t0, a] = keys[i]!, [t1, b] = keys[i + 1]!;
  return blendPose(a, b, smoothstep((v - t0) / (t1 - t0)));
}

// ---- 降下と着地（v0.45.0。仮の手付けの姿勢）----
/** 段の端から降りる間: 両腕を横へ広げ、膝を前へ曲げる */
const DROPPING: J = {
  spine: [6, 0, 0], head: [8, 0, 0],
  upperArmL: [-35, 0, 62], forearmL: [-25, 0, 0], upperArmR: [-35, 0, -62], forearmR: [-25, 0, 0],
  thighL: [-38, 0, 6], shinL: [58, 0, 0], thighR: [-18, 0, -6], shinR: [42, 0, 0],
};
/** 着地: 深くしゃがんで受け止める */
const LANDED: J = {
  spine: [28, 0, 0], chest: [8, 0, 0], head: [-14, 0, 0],
  upperArmL: [-32, 0, 22], forearmL: [-42, 0, 0], upperArmR: [-32, 0, -22], forearmR: [-42, 0, 0],
  thighL: [-74, 0, 9], shinL: [112, 0, 0], thighR: [-66, 0, -9], shinR: [104, 0, 0],
};

/** 降りている間の姿勢（落ち始めの 8 tick で、立った姿から移る） */
export function dropPose(ticks: number): BodyPose {
  return blendPose(fromKey(NEUTRAL, 0, { t: 0 }), fromKey(DROPPING, 0, { t: 0 }), smoothstep(Math.min(1, ticks / 8)));
}

/** 着地の姿勢: 着いた時がいちばん低く、立て直しの終わりへ向かって立ち上がる（left = 残り、total = 長さ） */
export function landPose(left: number, total: number): BodyPose {
  const u = smoothstep(Math.min(1, Math.max(0, left / total)));
  return blendPose(fromKey(NEUTRAL, 0, { t: 0 }), fromKey(LANDED, 0, { t: 0, py: -0.34 }), u);
}

export function deadPose(ticks: number): BodyPose {
  if (HURT_STYLE.style === 'v056') {
    const u = smoothstep(ticks / 30);
    return blendPose(fromKey(NEUTRAL, 0, { t: 0 }), fromKey(NEUTRAL, 0, { t: 0, j: LYING, tumble: -90, drop: -0.43 }), u);
  }
  // 力尽き（v0.64.0）: ひざが折れて片ひざを突き、頭を垂れて、そのまま背から倒れて止まる
  const keys: Key[] = [
    { t: 0 },
    { t: 12, j: { ...KNEEL, spine: [40, 0, 0], head: [24, 0, 0], upperArmL: [0, 0, 12], upperArmR: [0, 0, -12], forearmL: [-20, 0, 0], forearmR: [-20, 0, 0] }, py: -0.38 },
    { t: 20, j: { ...KNEEL, spine: [30, 0, 0], head: [20, 0, 0], upperArmL: [0, 0, 16], upperArmR: [0, 0, -16] }, py: -0.38 },
    { t: 34, j: LYING, tumble: -90, drop: -0.43 },
  ];
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1]!.t <= ticks) i++;
  const k0 = keys[i]!, k1 = keys[i + 1]!;
  const u = Math.min(1, Math.max(0, (ticks - k0.t) / (k1.t - k0.t)));
  return blendPose(fromKey(NEUTRAL, 0, k0), fromKey(NEUTRAL, 0, k1), smoothstep(u));
}
