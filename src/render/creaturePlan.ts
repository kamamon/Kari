// 大型モンスター（登録簿の 02〜12）と幼体（14〜21。v0.18.0）の仮モデルの設計図の型（v0.17.0）。key は貼る絵（src/render/creatureArt.ts）の名前で、幼体は親の絵を使う。中身は tools/gen-monsters.py が src/render/creaturePlans.ts に書く。
// 座標は、原画（art-source/monster/concepts/）の px。原画は真横から見た右側面（頭が右）なので、
//   z（前）= (px - origin.x) × scale、 y（上）= (origin.y - py) × scale、 x（左）は m で別に持つ（右側面 = -x）。
// 体の面は、骨の通った 1 枚の面（SkinnedMesh）。色は、原画を横から貼る（src/render/creatureArt.ts の切り出し位置で uv を決める）。
// 形と動きは仮素材（設定図は 1 枚の原画だけ。4 方向の図・正式モデルは無い）。当たり判定の形は public/data/monsters/<id>.json が持つ。

import type { MoveDef, MoveKey, Pose } from './creatureMoves';

/** 体つき（動きの決まりが変わる）。quad = 四足、biped = 二足と翼、crab = 六脚の甲殻と鋏、bug = 多脚の虫、arch = 輪の虫、serpent = 長胴 */
export type CreatureFrame = 'quad' | 'biped' | 'crab' | 'bug' | 'arch' | 'serpent';

/** 背骨の点: [px, py, 上の半径, 下の半径, 横の半径]（半径も px） */
export type SpinePoint = [number, number, number, number, number];

export interface LegPlan {
  /** 歩き方の組: F = 前脚、H = 後脚、M1/M2… = 中の脚、clawR / clawL = 鋏（歩かない） */
  group: string;
  /** 付け根の背骨の点（骨のある点） */
  attach: number;
  /** 関節の点: [px, py, 横の位置 m（+ が左。mirror の時は大きさだけ使う）] */
  pts: [number, number, number][];
  /** 関節ごとの太さ（px） */
  r: number[];
  /** 左右に 1 本ずつ（false なら pts の横の位置のとおり 1 本） */
  mirror: boolean;
  /** 歩く周期の中での位置（左の脚。右は frame ごとの決まりでずらす） */
  phase: number;
  /** 足先の平たい塊: [前後の長さ px, 高さ px]（無ければ足先は細くなって終わる） */
  foot?: [number, number];
  /** 原画の輪郭から測った太さの並び（v0.21.0）: [脚の線の上の位置（関節の番号 + 0〜1）, 半径 px]。あれば r より優先 */
  prof?: [number, number][];
  /**
   * 足先の指（v0.21.0）: hoof = 2 つに割れた蹄、toe = 丸い指と爪（n 本）、talon = 鳥の足（前 n 本 + 後ろ 1 本、曲がった鉤爪）。
   * 長さは足先の塊の長さに対する割合
   */
  toes?: { kind: 'hoof' | 'toe' | 'talon'; n: number; len: number; claw: number };
  /** 脚の振り方: x = 前後に振る（四足・二足）、y = 水平に振る（甲殻・虫） */
  swing?: 'x' | 'y';
}

export interface ExtraPlan {
  kind: 'blob' | 'sheet' | 'cone' | 'torus' | 'funnel';
  /** 付ける骨: spine:N（背骨の点 N の骨）/ chain（背骨に沿って、位置で骨を分け合う）/ own:名前（own で作った骨） */
  bone: string;
  /** この物のための骨を作る（翼・冠・鋏の指など、動かすもの）: 名前、付け根の位置 [px, py]、親の骨（spine:N か own:名前） */
  own?: { name: string; at: [number, number]; parent: string };
  /** 左右に 1 つずつ置く（横の位置 x の左右）。own の骨も左右で別になる（名前に _L / _R が付く） */
  mirror?: boolean;
  /** 横の位置 (m)。mirror の時は大きさ */
  x?: number;
  /** blob: 中心 [px, py] と、半径 [前後 px, 上下 px, 左右 m] */
  c?: [number, number];
  r?: [number, number, number];
  /** blob の傾き（前後の軸まわり、rad。+ で前が下がる） */
  pitch?: number;
  /** sheet: 輪郭の点 [px, py]。厚さ (m)。外への傾き (rad) */
  pts?: [number, number][];
  thick?: number;
  tilt?: number;
  /** cone / funnel: 根元 a と先 b [px, py]、根元と先の太さ (px)。b に横の位置を足す時は bx (m) */
  a?: [number, number];
  b?: [number, number];
  ra?: number;
  rb?: number;
  bx?: number;
  /** torus: 中心 c、輪の半径と管の太さ (px)。前後と上下の面に立つ */
  ring?: number;
  tube?: number;
  /** 動かす決まりの名前（crest・wing・sac・dish・plates・bags・sail・crown・finger_R など。own の骨に効く） */
  ch?: string;
  /** 光る物（別の材質で、発光の強さを動かす） */
  glow?: boolean;
  /** 暗い色（口の中・目など。絵に掛ける倍率） */
  shade?: number;
  /** 部位の破壊で見た目を変える時の部位 id（壊れると縮んで暗くなる） */
  part?: string;
}

/**
 * 判定の形を、体の部位に付ける（v0.21.0）。tools/gen-monsters.py が書き、npm run monsters:bake が、
 * 動きの中の部位の位置から、技データの軌道（public/data/tracks/<key>.json の track）を作り直す。
 * 印（a・b）の書き方は CreatureRig.marker（sp:点の番号 / leg:組:側:関節 / own:名前:側 / tip:名前:側。側は S = 技の側、O = 反対、L、R、C）。
 */
export interface BindPlan {
  track: string;
  a: string;
  b: string;
  /** カプセルの太さ (m) */
  r: number;
  /** b の先へ伸ばす長さ (m) */
  ext?: number;
  /** a の手前へ伸ばす長さ (m) */
  back?: number;
}

/** 技ごとの動き（v0.21.0 から、種ごとに固有の鍵の姿勢。src/render/creatureMoves.ts の MoveDef） */
export interface MovePlan {
  def: MoveDef;
  /** 1 = 左（+x）、-1 = 右 */
  side?: number;
  /** 動きの大きさの倍率 */
  amp?: number;
  /** 判定の形を付ける部位（無ければ、軌道は手で書いた形のまま） */
  bind?: BindPlan[];
}

/** しぐさ（技も怯みも無く、ほぼ止まっている間に、ときどきする。v0.21.0）。K の t は、しぐさの長さの中の位置（0〜1）で、p は使わない */
export interface FidgetPlan {
  id: string;
  /** 長さ（秒） */
  dur: number;
  /** aware = 狩人に気付いている時だけ、calm = 気付いていない時だけ、any = いつでも */
  when: 'aware' | 'calm' | 'any';
  K: MoveKey[];
  /** 体を小刻みに震わせる（rad） */
  shake?: number;
}

/**
 * 種ごとの、技以外の動き（v0.21.0。ガルドロスの専用の動きに合わせた一揃い）。
 * 姿勢は、ふだんの姿勢に足す（sleep・dead・topple は置き換える）。
 */
export interface IdlePlan {
  /** 気付いていない間（餌を探す・食む）。sway / nod は、首と頭のゆっくりした揺れ（rad）、rate は速さ（1 秒の回数） */
  unaware: Pose;
  sway: number;
  nod: number;
  rate: number;
  /** 気付いて、技を出していない間（身構え） */
  alert: Pose;
  /** 弱っている（頭と尾が下がる） */
  weak: Pose;
  /** 怒り（体の飾りを立てる） */
  rage: Pose;
  /** 速く動く（出ていく・逃げる）時の構え */
  run: Pose;
  /** 眠る・捕獲された時の姿勢 */
  sleep: Pose;
  /** 怯み（叩かれた向きへの、のけぞりに足す） */
  flinch: Pose;
  /** 転倒（倒れている間。もがく動きは legs に足す） */
  topple: Pose;
  /** 転倒から起き上がる途中 */
  rise: Pose;
  /** 倒れる（死）: tick ごとの鍵の姿勢（最後の姿勢のまま） */
  dead: { t: number; pose: Pose }[];
  /** 群れの幼体が食む時の姿勢（無ければ、首を下ろすだけ） */
  graze?: Pose;
  fidgets: FidgetPlan[];
}

export interface CreaturePlan {
  key: string;
  frame: CreatureFrame;
  /** 1px の長さ (m) */
  scale: number;
  /** 体の中心の px（横）と、地面の px（縦） */
  origin: [number, number];
  spine: SpinePoint[];
  /**
   * 原画の輪郭から測った、背骨に沿った太さの並び（v0.21.0。tools/gen-monsters.py の fit_profile）:
   * [背骨の上の位置（点の番号 + 0〜1）, 上の半径, 下の半径, 横の半径]（px）。あれば spine の半径より優先
   */
  profile?: [number, number, number, number][];
  /** 背骨の点ごとの役: - 骨なし（前の骨に付いて動く）、t 尾、b 胴、n 首、h 頭、a 輪の体（arch） */
  roles: string;
  /** 根元の骨（体の中心）の点 */
  root: number;
  legs: LegPlan[];
  extras: ExtraPlan[];
  /** 一歩の長さ (m) と、足を上げる高さ (m) */
  stride: number;
  lift: number;
  /** 光る物の色 */
  glowColor?: [number, number, number];
  /** 幼体（v0.18.0）: 親の絵に掛ける色（1 より大きいと明るい）と、淡さ（白へ寄せる割合） */
  look?: { tint: [number, number, number]; pale: number };
  moves: Record<string, MovePlan>;
  /** 技以外の動き（v0.21.0） */
  idle?: IdlePlan;
}
