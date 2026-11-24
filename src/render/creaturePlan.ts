// 大型モンスター（登録簿の 02〜12）の仮モデルの設計図の型（v0.17.0）。中身は tools/gen-monsters.py が src/render/creaturePlans.ts に書く。
// 座標は、原画（art-source/monster/concepts/）の px。原画は真横から見た右側面（頭が右）なので、
//   z（前）= (px - origin.x) × scale、 y（上）= (origin.y - py) × scale、 x（左）は m で別に持つ（右側面 = -x）。
// 体の面は、骨の通った 1 枚の面（SkinnedMesh）。色は、原画を横から貼る（src/render/creatureArt.ts の切り出し位置で uv を決める）。
// 形と動きは仮素材（設定図は 1 枚の原画だけ。4 方向の図・正式モデルは無い）。当たり判定の形は public/data/monsters/<id>.json が持つ。

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

/** 技ごとの動き（src/render/creatureMoves.ts の型の名前と、左右） */
export interface MovePlan {
  kind: string;
  /** 1 = 左（+x）、-1 = 右 */
  side?: number;
  /** 動きの大きさの倍率 */
  amp?: number;
}

export interface CreaturePlan {
  key: string;
  frame: CreatureFrame;
  /** 1px の長さ (m) */
  scale: number;
  /** 体の中心の px（横）と、地面の px（縦） */
  origin: [number, number];
  spine: SpinePoint[];
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
  moves: Record<string, MovePlan>;
}
