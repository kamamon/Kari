// 採掘・虫網・釣りの道具の持ち方（v0.70.0。D-168。描画だけ。形は Claude の形）。
// 道具は右手の握りの位置・柄の向き・頭の向きを、技の tick ごとの鍵で決め、両腕は rig の IK で道具へ付ける
// （src/render/rig.ts の toolToTrack）。体（脚・胴・頭）と、道具を持たない間の左腕は、CLIPS の体の動き（poses.ts）のまま。
// 座標はアクター（+Z 前、+Y 上、+X 左）。右手は -X の側。
//
// 道具の座標（rig.ts で作る形）: 柄は +Y。つるはしは頭が y 0.48、尖りが +Z（先は z 0.25）。
// 網は輪の中心が y 0.95、口が ±Z。竿は先が y 1.455。

import { smoothstep } from '../core/math';

export type ToolKind = 'pick' | 'net' | 'rod';
type Ease = 'smooth' | 'in' | 'out' | 'linear';
type Tuple3 = readonly [number, number, number];

export interface ToolKey {
  t: number;
  /** 右手の握り（アクターの座標） */
  grip: Tuple3;
  /** 柄の向き: 前（+Z）から上（+Y）へ回した角度（度。90 = 真上、180 = 真後ろ、-90 = 真下）。角度のまま混ぜるので、頭の上を回る振りも表せる */
  pitch: number;
  /** 柄の向きを左右へ（度。+ = 左（+X）へ） */
  yaw?: number;
  /** 頭の向きを柄の周りに回す（度。0 = 頭の尖り・網の口・竿の糸の側が、柄の向きの「下」） */
  roll?: number;
  /** 左手を道具に添える重み（0 = 体の動きのまま、1 = 道具の上の点へ） */
  leftW?: number;
  /** 左手を添える所（柄の上、右手からの距離 m。網の輪などは at で道具の座標の点） */
  along?: number;
  at?: Tuple3;
  /** この鍵へ向かう区間の混ぜ方（in = だんだん速く、out = だんだん遅く） */
  ease?: Ease;
}

export interface ToolTrack {
  tool: ToolKind;
  /** 何もしない時に左手を添える所の既定（柄の上の距離） */
  along: number;
  keys: ToolKey[];
}

export interface ToolHold {
  tool: ToolKind;
  grip: { x: number; y: number; z: number };
  dir: { x: number; y: number; z: number };
  /** 頭の向き（dir に直交） */
  face: { x: number; y: number; z: number };
  /** 左手の行き先（道具の座標）と重み */
  left: Tuple3;
  leftW: number;
}

// ---- 採掘（150 tick。42・76・110 で岩を打ち、126 で鉱石を拾う。D-168） ----
// 両手で柄を握り、後ろ足へ体重を乗せて頭の後ろへ振りかぶり、前へ踏み込んで振り下ろす。尖りは前 0.8m、高さ 0.3m の岩の面へ当たり、
// 2 tick 止まってから（手応え）、少し跳ね返る。3 回目の後は、つるはしを右へ下ろしてしゃがみ込み、左手で鉱石を拾って腰の袋へ。
const STRIKE = { grip: [-0.05, 0.77, 0.47] as Tuple3, pitch: -28 };
const swing = (t0: number): ToolKey[] => [
  // 振りかぶる（後ろ足へ。柄は頭の上を通って後ろへ寝る）
  { t: t0, grip: [-0.06, 1.86, 0.02], pitch: 195, leftW: 1, ease: 'smooth' },
  // 振り下ろす: 手は額の前を通り、柄は立ってから前へ倒れる（だんだん速く）
  { t: t0 + 10, grip: [-0.06, 1.56, 0.26], pitch: 100, leftW: 1, ease: 'in' },
  { t: t0 + 15, grip: [-0.05, 1.08, 0.4], pitch: 22, leftW: 1, ease: 'linear' },
  { t: t0 + 18, grip: STRIKE.grip, pitch: STRIKE.pitch, leftW: 1, ease: 'linear' },
  // 当たって止まり（手応え）、跳ね返る。そこから次の振りかぶりへ（11 tick で頭の上へ）
  { t: t0 + 20, grip: STRIKE.grip, pitch: STRIKE.pitch, leftW: 1 },
  { t: t0 + 23, grip: [-0.05, 0.81, 0.45], pitch: -14, leftW: 1, ease: 'out' },
];
const MINE: ToolTrack = {
  tool: 'pick',
  along: -0.09,
  keys: [
    { t: 0, grip: [-0.23, 0.885, 0.07], pitch: -40, leftW: 0 },
    // 構える: 胸の前で両手に持つ
    { t: 10, grip: [-0.1, 1.0, 0.26], pitch: 35, leftW: 1 },
    ...swing(24),
    ...swing(58),
    ...swing(92),
    // つるはしを右へ下ろす（頭を地面へ）。左手は離して鉱石を拾う（体の動き）
    { t: 120, grip: [-0.27, 0.8, 0.3], pitch: -70, leftW: 0, ease: 'smooth' },
    { t: 128, grip: [-0.28, 0.6, 0.32], pitch: -80, leftW: 0 },
    { t: 140, grip: [-0.25, 0.92, 0.14], pitch: -60, leftW: 0 },
    { t: 150, grip: [-0.23, 0.885, 0.07], pitch: -40, leftW: 0 },
  ],
};

// ---- 虫網（105 tick。60 で振り抜き、82 で虫が入る） ----
// 右肩の上へ振りかぶり、前へ踏み込んで、虫の舞う朽ち木の上（前 1.2m、高さ 0.6m）を右から左へすくう。
// 網の口を返して閉じ、輪を顔の前へ上げて中を確かめる。
const NET: ToolTrack = {
  tool: 'net',
  along: 0.3,
  keys: [
    { t: 0, grip: [-0.23, 0.885, 0.07], pitch: -50, leftW: 0 },
    { t: 12, grip: [-0.16, 1.02, 0.2], pitch: 70, leftW: 1 },
    // 振りかぶる（右肩の上、柄は上・後ろへ）
    { t: 32, grip: [-0.24, 1.5, -0.02], pitch: 130, yaw: -40, roll: 30, leftW: 1 },
    { t: 46, grip: [-0.22, 1.4, 0.18], pitch: 80, yaw: -36, roll: 60, leftW: 1, ease: 'in' },
    // すくう: 右から左へ、低く（口は進む向きの左）
    { t: 53, grip: [-0.08, 1.0, 0.42], pitch: -18, yaw: -14, roll: 85, leftW: 1, along: 0.1, ease: 'linear' },
    { t: 60, grip: [0.08, 0.92, 0.36], pitch: -12, yaw: 34, roll: 90, leftW: 1, along: 0.06, ease: 'out' },
    // 口を返して閉じる
    { t: 68, grip: [0.0, 1.02, 0.34], pitch: 22, yaw: 18, roll: -90, leftW: 1, along: 0.2 },
    // 顔の前へ上げて、上から中を確かめる（左手は輪の近くの柄）
    { t: 76, grip: [-0.1, 1.12, -0.02], pitch: 22, yaw: 4, roll: -170, leftW: 1, along: 0.42 },
    { t: 82, grip: [-0.1, 1.15, -0.02], pitch: 25, yaw: 4, roll: -175, leftW: 1, along: 0.42 },
    { t: 92, grip: [-0.2, 0.86, 0.1], pitch: -30, leftW: 0 },
    { t: 105, grip: [-0.23, 0.885, 0.07], pitch: -50, leftW: 0 },
  ],
};

// ---- 釣り（240 tick。24 で投げ、144〜204 の間に主ボタンで引き上げる。216 で魚が上がる） ----
// 竿を右肩の上へ引いて、前へ振って投げる。待つ間は竿先を少し上げて持つ。食いつく間（144〜204）は、竿先が小刻みに引き込まれる。
// 204 から竿を立てて大きく引き上げ、下ろす。
export const FISH_BITE = { from: 144, to: 204, period: 14, depth: 7 } as const;
const FISH: ToolTrack = {
  tool: 'rod',
  along: 0.1,
  keys: [
    { t: 0, grip: [-0.23, 0.885, 0.09], pitch: 62, leftW: 0 },
    { t: 10, grip: [-0.14, 1.04, 0.24], pitch: 52, leftW: 1 },
    // 振りかぶる（竿は右肩の上から後ろへ）
    { t: 19, grip: [-0.2, 1.42, 0.04], pitch: 118, yaw: -8, leftW: 1 },
    // 投げる（24 で糸が出る）
    { t: 26, grip: [-0.1, 1.24, 0.42], pitch: 12, leftW: 1, ease: 'in' },
    { t: 36, grip: [-0.1, 1.06, 0.31], pitch: 28, leftW: 1, ease: 'out' },
    // 待つ（ゆっくり揺れる）
    { t: 80, grip: [-0.09, 1.02, 0.29], pitch: 26, leftW: 1 },
    { t: 112, grip: [-0.1, 1.04, 0.3], pitch: 30, leftW: 1 },
    { t: 144, grip: [-0.09, 1.02, 0.29], pitch: 27, leftW: 1 },
    { t: 204, grip: [-0.09, 1.0, 0.3], pitch: 25, leftW: 1 },
    // 引き上げる: 竿を立てて体ごと後ろへ
    { t: 212, grip: [-0.12, 1.3, 0.18], pitch: 82, leftW: 1, ease: 'in' },
    { t: 219, grip: [-0.14, 1.42, 0.1], pitch: 96, leftW: 1, ease: 'out' },
    { t: 230, grip: [-0.18, 1.02, 0.16], pitch: 58, leftW: 0.4 },
    { t: 240, grip: [-0.23, 0.885, 0.09], pitch: 62, leftW: 0 },
  ],
};

/** 道具を持つ動き（体の動きの名前 → 道具の鍵） */
export const TOOL_TRACKS: Readonly<Record<string, ToolTrack>> = {
  common_mine_01: MINE,
  common_net_01: NET,
  common_fish_01: FISH,
};

const D2R = Math.PI / 180;
function ease(e: Ease | undefined, u: number): number {
  if (e === 'in') return u * u;
  if (e === 'out') return 1 - (1 - u) * (1 - u);
  if (e === 'linear') return u;
  return smoothstep(u);
}
const mix = (a: number, b: number, u: number): number => a + (b - a) * u;

/** 柄の向き（pitch・yaw）の単位ベクトル */
function dirOf(pitch: number, yaw: number): { x: number; y: number; z: number } {
  const p = pitch * D2R, y = yaw * D2R;
  return { x: Math.sin(y) * Math.cos(p), y: Math.sin(p), z: Math.cos(y) * Math.cos(p) };
}

/**
 * その tick の道具の持ち方。道具を持つ動きでなければ null。
 * 釣りは、食いつく間（FISH_BITE）に竿先が小刻みに引き込まれる（描画だけ。食いついたかは simulation が決める）。
 */
export function toolHoldAt(clip: string, t: number): ToolHold | null {
  const tr = TOOL_TRACKS[clip];
  if (!tr) return null;
  const ks = tr.keys;
  const last = ks[ks.length - 1]!;
  let a = ks[0]!, b = ks[0]!, u = 0;
  if (t >= last.t) a = b = last;
  else if (t > a.t) {
    for (let i = 1; i < ks.length; i++) {
      if (t <= ks[i]!.t) {
        a = ks[i - 1]!;
        b = ks[i]!;
        u = ease(b.ease, (t - a.t) / Math.max(1e-6, b.t - a.t));
        break;
      }
    }
  }
  let pitch = mix(a.pitch, b.pitch, u);
  const yaw = mix(a.yaw ?? 0, b.yaw ?? 0, u);
  const roll = mix(a.roll ?? 0, b.roll ?? 0, u);
  if (tr.tool === 'rod' && t > FISH_BITE.from && t < FISH_BITE.to) {
    // 食いつく間: 竿先が引き込まれる（始めと終わりはなめらかに）
    const k = Math.min(1, (t - FISH_BITE.from) / 6, (FISH_BITE.to - t) / 6);
    pitch -= FISH_BITE.depth * k * (0.5 - 0.5 * Math.cos((2 * Math.PI * (t - FISH_BITE.from)) / FISH_BITE.period));
  }
  const dir = dirOf(pitch, yaw);
  // 頭の向き: 柄の向きを、同じ縦の面の中で 90° 下へ回したもの。それを柄の周りに roll だけ回す
  const f0 = dirOf(pitch - 90, yaw);
  const c = Math.cos(roll * D2R), s = Math.sin(roll * D2R);
  // dir × f0（右手系）
  const cx = dir.y * f0.z - dir.z * f0.y, cy = dir.z * f0.x - dir.x * f0.z, cz = dir.x * f0.y - dir.y * f0.x;
  const face = { x: f0.x * c + cx * s, y: f0.y * c + cy * s, z: f0.z * c + cz * s };
  const along = mix(a.along ?? tr.along, b.along ?? tr.along, u);
  const at: Tuple3 = a.at && b.at ? [mix(a.at[0], b.at[0], u), mix(a.at[1], b.at[1], u), mix(a.at[2], b.at[2], u)] : [0, along, 0];
  return {
    tool: tr.tool,
    grip: { x: mix(a.grip[0], b.grip[0], u), y: mix(a.grip[1], b.grip[1], u), z: mix(a.grip[2], b.grip[2], u) },
    dir,
    face,
    left: at,
    leftW: mix(a.leftW ?? 0, b.leftW ?? 0, u),
  };
}

/**
 * 釣り糸の浮きの位置（竿先から、投げた所までの割合と、水面での沈み）。
 * cast: 0 = 竿先に下がる、1 = 投げた所。sink: 食いつく間の沈み（m）。
 */
export function fishLineAt(t: number): { cast: number; sink: number } {
  let cast = 0;
  if (t >= 24 && t < 34) cast = smoothstep((t - 24) / 10);
  else if (t >= 34 && t < 206) cast = 1;
  else if (t >= 206 && t < 218) cast = 1 - smoothstep((t - 206) / 12);
  let sink = 0;
  if (t > FISH_BITE.from && t < FISH_BITE.to) {
    const k = Math.min(1, (t - FISH_BITE.from) / 6, (FISH_BITE.to - t) / 6);
    sink = 0.06 * k * (0.5 - 0.5 * Math.cos((2 * Math.PI * (t - FISH_BITE.from)) / FISH_BITE.period));
  }
  return { cast, sink };
}
