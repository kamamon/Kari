// 防具の見た目（ガルドロスの素材の防具: 岩殻・脈殻・晶殻・輝殻）。
// 設定図（art-source/armor/galdros/）を見て、板の枚数・左右の偏り・付ける位置を写した。
//   体の板: armor_galdros_t2_*_v1.png（依頼 7 の A。利用者が採用）
//   兜: armor_galdros_t2_*_v2.png（依頼 7 の続き。「中世の兜のようなイメージ」で作り直した図。2026-11-24 に受け取り、利用者の指示で組み込んだ）
//   段ごとの違い: armor_galdros_tiers_front_v1.png（依頼 7 の B。岩の色は変えず、脈殻で板に晶脈の筋、晶殻・輝殻で左側に晶が育つ）
// 板は、ガルドロスの岩殻と同じ作り（procGeo.plate: 角のある岩板と、縁の晶脈）。
// 図を表面へ貼ってはいない（単色の板）。革の帯・留め具・あごひも・鋲の細かい形は作っていない（兜の鋲だけ、小さな粒で置いた）。
// 座標: m、Y 上、+Z 前、+X が本人の左。静止姿勢は「気をつけ」（腕は真下）。
import { Vector3 } from 'three';
import { ARMOR_SLOTS, type ArmorSlot } from '../data/schemas';
import { JOINTS, REST, type JointName } from './bodySolve';
import { Geo, crystal, flatTri, hash3, hex, loft, plate, shade, sstep, type RGB, type Ring } from './procGeo';
import { SHELL_PALETTES } from './shellPlates';

/** 部位ごとの段（2 = 岩殻 … 5 = 輝殻）。1 か、無ければ、里の装束（何も足さない）。 */
export type ArmorLook = Partial<Record<ArmorSlot, number>>;
export const armorLookKey = (look: ArmorLook): string => { const a=ARMOR_SLOTS.map(s=>look[s]??1);return a.join(a.some(t=>t>=10)?',':''); };

/** 防具のモデルの ID（model.armor.galdros.t2 など）から段を読む。読めなければ 1（見た目なし）。 */
export const armorTierOf = (assetId: string | undefined): number => {
  const g=/^model\.armor\.(ore|bone)\.r([1-4])$/.exec(assetId??'');
  if(g)return (g[1]==='ore'?10:20)+Number(g[2]);
  const t = Number(/^model\.armor\.galdros\.t(\d)$/.exec(assetId ?? '')?.[1] ?? 1);
  return SHELL_PALETTES[t] ? t : 1;
};

/**
 * 段ごとの違い（設定図 B: armor_galdros_tiers_front_v1.png）。**岩の色は、どの段も同じ**（色違いにしない）。
 * rim = 縁と帯の色（上ほど明るい琥珀色）、bevel = 縁取りの幅、veins = 板 1 枚に走る晶脈の筋の本数、
 * grown = 左側に育つ晶（0 = 無し、1 = 左の肩・左胸・左の腰、2 = それに左の籠手を足し、晶も大きい）、scale = 板の大きさ、glow = 縁と晶が自分で光る強さ。
 */
interface ArmorTier { rim: number; crystal: number; bevel: number; veins: number; grown: 0 | 1 | 2; scale: number; glow: number }
const ROCK = 0x8a8170;
export const ARMOR_TIERS: Record<number, ArmorTier> = {
  2: { rim: 0xc9963c, crystal: 0xc9963c, bevel: 0.009, veins: 0, grown: 0, scale: 1, glow: 0 },
  3: { rim: 0xd9a441, crystal: 0xd9a441, bevel: 0.012, veins: 2, grown: 0, scale: 1.02, glow: 0 },
  4: { rim: 0xdca640, crystal: 0xe8922e, bevel: 0.012, veins: 2, grown: 1, scale: 1.04, glow: 0.2 },
  5: { rim: 0xe6b24e, crystal: 0xf79f33, bevel: 0.013, veins: 3, grown: 2, scale: 1.1, glow: 0.55 },
};

const B = Object.fromEntries(JOINTS.map((n, i) => [n, i])) as Record<JointName, number>;

/** 胴を少し外から包む面の、前後の位置（x は左右。superellipse。設定図の胴の太さに板の浮きを足した値） */
const torsoZ = (x: number, depth: number): number => depth * Math.pow(Math.max(0, 1 - Math.pow(Math.min(1, Math.abs(x) / 0.2), 2.5)), 0.4);

interface PlateSpec {
  bone: number;
  /** 板の中心、横（u）と縦（v）の半分の長さのベクトル */
  c: [number, number, number];
  u: [number, number, number];
  v: [number, number, number];
  /** 体へ沿わせる反り (m)。縁が体の側へ入る量（u 方向・v 方向） */
  bendU?: number;
  bendV?: number;
  /** 胴の面に沿わせる（+1 = 前、-1 = 後ろ）。c の z は使わない */
  torso?: 1 | -1;
  inside: [number, number, number];
  thickness?: number;
  /** 縁から体へ下ろす壁の深さ (m)。無ければ 0.014 */
  skirt?: number;
  points?: number;
  square?: number;
  /** もう 1 本の骨の影響（板が腕や脚について行く量） */
  follow?: { bone: number; weight: (p: Vector3) => number };
  /** 晶脈の筋を走らせない（兜の小さな板） */
  plain?: boolean;
  /**
   * 晶殻・輝殻で、この板に育つ晶（左側の板だけ）。from = 育ちはじめる grown の値（1 = 晶殻から、2 = 輝殻だけ）。
   * spots = 板の上の位置 (u, v) と、傾ける向き（板の面に沿って u, v へ）、長さ、太さ (m)
   */
  grow?: { from: 1 | 2; spots: [number, number, number, number, number, number][]; patch?: [number, number, number, number] };
  // patch = 晶の面に置き換わる範囲（中心 u, v と、半分の大きさ。板に対する割合）
}

/**
 * 兜の鉢の断面（高さ、左右・前・後ろの半径）。**頭の輪郭（hunterBody の HEAD_SHAPE）から 6〜9mm だけ外**の、頭に沿う丸い鉢。
 * 利用者の指摘（2026-11-24）「顔とヘルメットの幅が合って無さすぎる。幅大きすぎ」: 前の版は、頭から 2cm 離していた
 * （額で幅 20cm。顔は幅 13cm なので、鉢だけが大きく見えた）。額の幅は 17cm（帯を入れて 18cm）にした。
 * 下の縁（額の帯）は眉の上。顔（目・口・あご）は開く。頭のてっぺん 1.75m から 2.3cm 上まで。
 */
export const HELM_SHAPE: readonly (readonly [number, number, number, number])[] = [
  [1.666, 0.085, 0.103, 0.099], [1.698, 0.082, 0.105, 0.093], [1.726, 0.069, 0.097, 0.078], [1.748, 0.052, 0.078, 0.06], [1.764, 0.032, 0.05, 0.038], [1.773, 0.015, 0.022, 0.018],
];
export const HELM_Z = 0.002;
/** 額の帯が、鉢の面から出る量 */
export const HELM_BAND_LIFT = 0.004;

/**
 * 兜の鉢（設定図 v2: armor_galdros_t2_*_v2.png）。利用者の指示（2026-11-24）「頭装備がダサい。中世の兜のようなイメージ」。
 * 岩の鉢を、晶の帯（額をひと回り + 前後と左右にまたぐ 2 本）で締める。額の帯には鋲が並ぶ。帯が交わるてっぺんに、小さな平たい岩。
 * 額の帯から鼻筋へ、短い鼻当て。頬当て（左が大きい）と、うなじの板は PLATES.head。
 * band = 帯の半分の幅 (m)。段が上がると太くなる。
 */
function helmDome(rock: Geo, rim: Geo, rockCol: RGB, rimCol: RGB, band: number): void {
  const X = new Vector3(1, 0, 0), Z = new Vector3(0, 0, 1);
  const ring = (y: number, rx: number, f: number, b: number, grow = 0): Ring => ({ c: new Vector3(0, y, HELM_Z), right: X, up: Z, rx: rx + grow, top: f + grow, bottom: b + grow, b0: B.head, b1: B.head, w1: 0, part: 0 });
  // 岩の鉢（下ほど少し暗い）
  loft(rock, HELM_SHAPE.map(([y, rx, f, b]) => ring(y, rx, f, b)), { seg: 16, color: (p) => { const k = 0.86 + 0.14 * sstep(1.66, 1.76, p.y); return [rockCol[0] * k, rockCol[1] * k, rockCol[2] * k]; }, capEnd: rockCol });
  // 額の帯（鉢の下の縁をひと回り）と、鋲
  const [y0, rx0, f0, b0] = HELM_SHAPE[0]!;
  const lift = HELM_BAND_LIFT;
  loft(rim, [ring(y0 - 0.009, rx0, f0, b0, lift), ring(y0 + 0.012 + band, rx0, f0, b0, lift)], { seg: 16, color: () => rimCol, capStart: rimCol, capEnd: rimCol });
  const stud = shade(rimCol, 1.22);
  const RIVETS = 12;
  for (let k = 0; k < RIVETS; k++) {
    // 帯が交わる所（前後左右）を避けて並べる
    const th = ((k + 0.5) / RIVETS) * Math.PI * 2;
    const cs = Math.cos(th), sn = Math.sin(th);
    const out = new Vector3(cs / (rx0 + lift), 0, sn / ((sn >= 0 ? f0 : b0) + lift)).normalize();
    const at = new Vector3((rx0 + lift) * cs, y0 + 0.004 + band * 0.5, HELM_Z + ((sn >= 0 ? f0 : b0) + lift) * sn);
    crystal(rim, at.addScaledVector(out, -0.002), out, 0.0075, 0.005, stud, B.head, 0, 20 + k);
  }
  // 鉢をまたぐ帯: 前 → てっぺん → 後ろ、左 → てっぺん → 右
  const top = HELM_SHAPE[HELM_SHAPE.length - 1]![0];
  for (const across of [false, true]) {
    const path: Vector3[] = [
      ...HELM_SHAPE.map(([y, rx, f]) => (across ? new Vector3(rx, y, HELM_Z) : new Vector3(0, y, HELM_Z + f))),
      new Vector3(0, top + 0.002, HELM_Z),
      ...[...HELM_SHAPE].reverse().map(([y, rx, , b]) => (across ? new Vector3(-rx, y, HELM_Z) : new Vector3(0, y, HELM_Z - b))),
    ];
    const wide = across ? Z : X;
    const rings = path.map((c, i): Ring => {
      const t = new Vector3().subVectors(path[Math.min(path.length - 1, i + 1)]!, path[Math.max(0, i - 1)]!).normalize();
      const n = new Vector3().crossVectors(t, wide).normalize();
      if (n.dot(new Vector3(c.x, c.y - 1.66, c.z - HELM_Z)) < 0) n.negate();
      return { c: c.clone(), right: wide, up: n, rx: band, top: 0.005, bottom: 0.002, b0: B.head, b1: B.head, w1: 0, part: 0 };
    });
    loft(rim, rings, { seg: 6, color: () => rimCol, capStart: rimCol, capEnd: rimCol });
  }
  // てっぺんの小さな平たい岩（ガルドロスの頭頂。帯が交わる所に乗る）
  plate(rock, { surface: (u, v) => new Vector3(u * 0.015, top + 0.004, HELM_Z + v * 0.012), inside: new Vector3(0, 1.7, HELM_Z), w: 0.03, d: 0.024, thickness: 0.008, skirt: 0.005, bevel: 0.005, seed: 97, bone: B.head, part: 0, rock: rockCol, points: 6, square: 0.55 }, { geo: rim, color: rimCol });
  // 鼻当て: 額の帯から、鼻筋へ下ろす短い棒
  const nasal = [[1.672, f0 + 0.004], [1.652, f0 - 0.004], [1.634, f0 - 0.009]].map(([y, z]): Ring => ({ c: new Vector3(0, y!, HELM_Z + z!), right: X, up: Z, rx: Math.min(0.012, band), top: 0.005, bottom: 0.003, b0: B.head, b1: B.head, w1: 0, part: 0 }));
  loft(rim, nasal, { seg: 6, color: () => rimCol, capStart: rimCol, capEnd: rimCol });
}

/** 部位ごとの板。左（+X）が大きい: ガルドロスの岩殻の偏り（左肩は大 1 枚、右肩は中 1 枚 + 小 1 枚。籠手と腰の板も左が大きい）。 */
const PLATES: Record<ArmorSlot, PlateSpec[]> = {
  // 兜（設定図 v2）: 鉢は helmDome。ここは、額の帯から下がる板。顔（目・口・あご）は開ける。
  // どの板も、頭の輪郭に沿わせる（頬当ては、あごへ向かって内へ傾ける。頭は、額で幅 15.8cm、あごの角で 10cm）。
  head: [
    // 頬当て: 耳のあたりを覆って、あごの角まで。左が大きい（左は耳の真横、右は耳の前寄りに細く）
    { bone: B.head, c: [0.0715, 1.612, -0.004], u: [0, 0, 0.037], v: [0.013, 0.05, 0], bendU: 0.008, inside: [0, 1.61, 0], thickness: 0.01, skirt: 0.008, points: 8, plain: true },
    { bone: B.head, c: [-0.0745, 1.624, 0.01], u: [0, 0, 0.027], v: [-0.0095, 0.04, 0], bendU: 0.006, inside: [0, 1.62, 0.01], thickness: 0.01, skirt: 0.008, points: 7, plain: true },
    // うなじの板: 額の帯のすぐ下から下がる（すき間を空けない）。下の縁が、少しだけ後ろへ開く
    { bone: B.head, c: [0, 1.618, -0.1], u: [0.056, 0, 0], v: [0, 0.042, 0.004], bendU: 0.022, inside: [0, 1.62, 0], thickness: 0.01, skirt: 0.008, points: 8, plain: true },
  ],
  // 胸当て: 胸の前に 2 枚、背の上半分に 2 枚（背中の中央は空ける: 武器を背負う）。肩当ては胴の部品
  chest: [
    // （左胸は、晶殻から、下の外寄りが晶の面になる）
    { bone: B.chest, c: [0.088, 1.372, 0], u: [0.076, 0, 0], v: [0, 0.088, 0], torso: 1, bendV: 0.012, inside: [0.06, 1.37, 0], grow: { from: 1, patch: [0.3, -0.36, 0.5, 0.46], spots: [[0.42, -0.5, 0.9, -1.2, 0.05, 0.024], [0.02, -0.56, -0.4, -1.3, 0.044, 0.022], [0.58, -0.08, 1.3, -0.5, 0.042, 0.021], [0.22, -0.2, 0.6, -0.9, 0.04, 0.02]] } },
    { bone: B.chest, c: [-0.088, 1.372, 0], u: [0.076, 0, 0], v: [0, 0.088, 0], torso: 1, bendV: 0.012, inside: [-0.06, 1.37, 0] },
    { bone: B.chest, c: [0.094, 1.372, 0], u: [0.07, 0, 0], v: [0, 0.102, 0], torso: -1, bendV: 0.012, inside: [0.06, 1.37, 0] },
    { bone: B.chest, c: [-0.094, 1.372, 0], u: [0.07, 0, 0], v: [0, 0.102, 0], torso: -1, bendV: 0.012, inside: [-0.06, 1.37, 0] },
    // 左肩: 大きな 1 枚。肩から外へ 12cm・上へ 8cm までに収める（腕を真上へ振り上げる。依頼 7 の決まり）
    { bone: B.chest, c: [0.214, 1.452, 0], u: [0, 0, 0.108], v: [0.056, -0.066, 0], bendU: 0.04, bendV: 0.012, inside: [0.16, 1.42, 0], points: 8, follow: { bone: B.upperArmL, weight: (p) => 0.2 + 0.4 * sstep(0.2, 0.3, p.x) },
      // 晶殻から、外寄りに、短く太い晶がかたまって生える（腰の後ろの晶の塊と同じ形）
      grow: { from: 1, patch: [0.0, 0.3, 0.5, 0.42], spots: [[-0.3, 0.3, -0.3, 0.25, 0.042, 0.025], [0.14, 0.36, 0.2, 0.3, 0.046, 0.027], [0.46, 0.16, 0.5, 0.1, 0.038, 0.022], [-0.06, 0.02, 0, -0.1, 0.04, 0.023], [-0.54, 0.06, -0.5, 0, 0.034, 0.02]] } },
    // 右肩: 中 1 枚（上）+ 小 1 枚（下。上腕に付く）
    { bone: B.chest, c: [-0.207, 1.468, 0], u: [0, 0, 0.086], v: [-0.05, -0.044, 0], bendU: 0.03, bendV: 0.008, inside: [-0.16, 1.44, 0], points: 8, follow: { bone: B.upperArmR, weight: (p) => 0.2 + 0.4 * sstep(0.2, 0.28, -p.x) } },
    { bone: B.upperArmR, c: [-0.243, 1.384, 0], u: [0, 0, 0.062], v: [-0.014, -0.046, 0], bendU: 0.02, inside: [-0.19, 1.41, 0], points: 7 },
  ],
  // 籠手: 前腕の外側。ひじの内側・手首・指は覆わない
  arms: [
    // （左の籠手は、輝殻だけ、外側に晶が出る）
    { bone: B.forearmL, c: [0.236, 1.045, 0], u: [0, 0, 0.056], v: [0, 0.104, 0], bendU: 0.022, inside: [0.185, 1.045, 0], points: 8, grow: { from: 2, patch: [0.0, -0.1, 0.56, 0.5], spots: [[0.0, 0.2, 0, 0.6, 0.04, 0.02], [-0.3, -0.2, -0.5, 0.3, 0.036, 0.018], [0.3, -0.42, 0.5, 0.2, 0.036, 0.018]] } },
    { bone: B.forearmR, c: [-0.232, 1.065, 0], u: [0, 0, 0.044], v: [0, 0.074, 0], bendU: 0.018, inside: [-0.185, 1.065, 0], points: 7 },
  ],
  // 腰当て: 腰の横に下げる板。前は開ける。下の方は脚について行く
  waist: [
    { bone: B.pelvis, c: [0.232, 0.895, 0.012], u: [0, 0, 0.128], v: [0.012, 0.148, 0], bendU: 0.06, inside: [0.1, 0.9, 0], points: 9, follow: { bone: B.thighL, weight: (p) => 0.6 * sstep(0.98, 0.8, p.y) },
      // 晶殻から、下半分が晶の面になる
      grow: { from: 1, patch: [0.0, -0.4, 0.62, 0.44], spots: [[-0.3, -0.52, -0.3, -1.0, 0.052, 0.027], [0.24, -0.56, 0.3, -1.0, 0.056, 0.028], [0.0, -0.22, 0, -0.9, 0.048, 0.025], [0.46, -0.26, 0.7, -0.7, 0.042, 0.022], [-0.48, -0.18, -0.7, -0.7, 0.042, 0.022]] } },
    { bone: B.pelvis, c: [-0.226, 0.868, -0.03], u: [0, 0, 0.084], v: [-0.01, 0.104, 0], bendU: 0.035, inside: [-0.1, 0.87, 0], points: 8, follow: { bone: B.thighR, weight: (p) => 0.6 * sstep(0.95, 0.8, p.y) } },
  ],
  // 脛当て: すねの前。ひざより下
  legs: [
    { bone: B.shinL, c: [REST.hipX, 0.312, 0.078], u: [0.05, 0, 0], v: [0, 0.104, 0], bendU: 0.02, bendV: 0.006, inside: [REST.hipX, 0.31, 0], points: 8 },
    { bone: B.shinR, c: [-REST.hipX, 0.312, 0.078], u: [0.05, 0, 0], v: [0, 0.104, 0], bendU: 0.02, bendV: 0.006, inside: [-REST.hipX, 0.31, 0], points: 8 },
  ],
};

export interface ArmorGeo {
  /** 岩の板 */
  rock: Geo;
  /** 板の縁の晶脈、兜の帯、板に走る晶脈の筋、育った晶、腰の後ろの晶の塊 */
  rim: Geo;
  /** 縁と晶が自分で光る強さ（段が上がると光る。0 = 光らない） */
  glow: number;
}

/**
 * 板の上を走る晶脈の筋（脈殻から）。板の面の少し上に、細い帯を折れ線で置く。
 * 1 枚の板の筋は、同じ向きに、間を空けて並べる（交わらせない: 交わると、割れ目ではなく印に見える）。筋の途中から、短い枝が 1 本出る。
 * top = 板の上の位置 (u, v) → 板の上面より少し外の点。index / count = 何本目か。
 */
function vein(rim: Geo, top: (u: number, v: number) => Vector3, normal: Vector3, col: RGB, bone: number, plateSeed: number, index: number, count: number): void {
  const r = (k: number): number => hash3(plateSeed, k, 7 + index * 3);
  // 板ごとに決まった向き（斜め）。筋ごとに、少しだけ振る
  const base = hash3(plateSeed, 0, 5) * Math.PI;
  const ang = base + (r(1) - 0.5) * 0.35;
  const dx = Math.cos(ang), dy = Math.sin(ang);
  // 向きに直角の方向へ、筋を並べる
  const off = (index - (count - 1) / 2) * (count > 2 ? 0.42 : 0.56) + (r(2) - 0.5) * 0.12;
  const cx = -Math.sin(base) * off, cy = Math.cos(base) * off;
  const half = Math.sqrt(Math.max(0.08, 0.5 - off * off));
  const at = (t: number, side: number): Vector3 => top(cx + dx * t + -dy * side, cy + dy * t + dx * side);
  const kink = (r(3) - 0.5) * 0.2;
  const line = (pts: Vector3[], widths: number[], k0: number): void => {
    const sides = pts.map((p, i) => {
      const t = new Vector3().subVectors(pts[Math.min(pts.length - 1, i + 1)]!, pts[Math.max(0, i - 1)]!).normalize();
      const w = new Vector3().crossVectors(normal, t).normalize().multiplyScalar(widths[i]!);
      return [p.clone().add(w), p.clone().sub(w)] as const;
    });
    for (let i = 0; i < sides.length - 1; i++) {
      const [a, b] = sides[i]!, [c, d] = sides[i + 1]!;
      const tone = shade(col, 0.95 + 0.3 * r(k0 + i));
      const front = new Vector3().crossVectors(new Vector3().subVectors(c, a), new Vector3().subVectors(b, a)).dot(normal) >= 0;
      if (front) { flatTri(rim, a, c, b, tone, bone, 0); flatTri(rim, b, c, d, tone, bone, 0); }
      else { flatTri(rim, a, b, c, tone, bone, 0); flatTri(rim, b, d, c, tone, bone, 0); }
    }
  };
  line([at(-half, 0), at(-half * 0.45, kink * 0.6), at(0, kink), at(half * 0.5, kink * 0.3), at(half, 0)], [0.001, 0.003, 0.0036, 0.0028, 0.001], 10);
  // 枝: 筋の途中から、斜めに短く
  const bt = (r(4) - 0.5) * half * 0.8, bs = r(5) < 0.5 ? -1 : 1;
  line([at(bt, kink * 0.8), at(bt + half * 0.22, kink * 0.8 + bs * 0.1), at(bt + half * 0.36, kink * 0.8 + bs * 0.2)], [0.0024, 0.0018, 0.0008], 20);
}

/** 着ている防具の板を組む。どの部位も里の装束（段 1）なら null。 */
export function buildHunterArmor(look: ArmorLook): ArmorGeo | null {
  if (armorLookKey(look) === '11111') return null;
  const rock = new Geo(), rim = new Geo();
  let glow = 0;
  for (const slot of ARMOR_SLOTS) {
    const encoded=look[slot]??1, style=encoded>=21?'bone':encoded>=11?'ore':'galdros';
    const tier=style==='galdros'?encoded:encoded%10+1, base=ARMOR_TIERS[tier];
    const T:ArmorTier|undefined=style==='galdros'||!base?base:{...base,rim:style==='ore'?0xb4ced3:0x9e8059,crystal:style==='ore'?0x8ec7d7:0xddc6a2,grown:0,glow:0,veins:style==='ore'?Math.max(0,tier-3):0};
    if (tier < 2 || !T) continue;
    // 岩の色は、どの段も設定図の灰褐色。段の違いは、縁の色と太さ・晶脈の筋・育った晶（設定図 B）
    const rockCol: RGB = hex(style==='ore'?[0x687d85,0x7e969e,0x90aeb8,0x9dbfc7][tier-2]!:style==='bone'?[0xb7a383,0xc8b79b,0xd6c5a4,0xe0d2b6][tier-2]!:ROCK), rimCol: RGB = hex(T.rim), crystalCol: RGB = hex(T.crystal);
    glow = Math.max(glow, T.glow);
    if (slot === 'head') helmDome(rock, rim, rockCol, rimCol, 0.0095 + 0.001 * (tier - 2));
    // 板の種（模様と筋の散らし方）は、部位と板の番号で決める（どの部位を着ているかで、ほかの部位の形が変わらない）
    PLATES[slot].forEach((s, index) => {
      const seed = 11 + ARMOR_SLOTS.indexOf(slot) * 10 + index;
      const k = T.scale;
      const c = new Vector3(...s.c), u = new Vector3(...s.u).multiplyScalar(k), v = new Vector3(...s.v).multiplyScalar(k);
      const inside = new Vector3(...s.inside);
      const n = new Vector3().crossVectors(u, v).normalize();
      if (n.dot(new Vector3().subVectors(c, inside)) < 0) n.negate();
      const surface = (a: number, b: number): Vector3 => {
        const p = c.clone().addScaledVector(u, a).addScaledVector(v, b);
        if (s.torso) p.z = s.torso * (torsoZ(p.x, s.torso > 0 ? 0.128 : 0.118) - (s.bendV ?? 0) * b * b);
        else p.addScaledVector(n, -((s.bendU ?? 0) * a * a + (s.bendV ?? 0) * b * b));
        return p;
      };
      const thickness = (s.thickness ?? 0.026) * k;
      // 板の面の外向き（胴に沿う板は、前か後ろ）
      const out = s.torso ? new Vector3(0, 0, s.torso) : n;
      const from = rock.count, fromRim = rim.count;
      plate(rock, { surface, inside, w: u.length() * 2, d: v.length() * 2, thickness, skirt: s.skirt ?? 0.014, bevel: T.bevel, seed, bone: s.bone, part: 0, rock: rockCol, points: style==='ore'?8:style==='bone'?7:(s.points??8), square: style==='ore' ? .86 : style==='bone' ? .34 : (s.square??.62) }, { geo: rim, color: rimCol });
      // 脈殻から: 板に晶脈の筋が走る
      if (!s.plain) for (let i = 0; i < T.veins; i++) vein(rim, (a, b) => surface(a, b).addScaledVector(out, thickness * 1.1 + 0.0022), out, rimCol, s.bone, seed * 17, i, T.veins);
      // 晶殻から: 左側の板に、晶が育つ（輝殻は 1 回り大きい）
      if (s.grow && T.grown >= s.grow.from) {
        const big = T.grown >= 2 && s.grow.from === 1 ? 1.2 : 1;
        const un = u.clone().normalize(), vn = v.clone().normalize();
        // 板の一部が、晶の面に置き換わる: 岩の板より少し出た、琥珀色の面を重ねる（その上に、晶の粒が乗る）
        if (s.grow.patch) {
          const [a0, b0, sa, sb] = s.grow.patch;
          const sub = (a: number, b: number): Vector3 => surface(a0 + a * sa * big, b0 + b * sb * big).addScaledVector(out, thickness * 0.25);
          plate(rim, { surface: sub, inside, w: u.length() * 2 * sa, d: v.length() * 2 * sb, thickness: thickness * 1.05, skirt: 0.004, bevel: 0.01, seed: seed + 50, bone: s.bone, part: 0, rock: shade(crystalCol, 0.86), points: 6, square: 0.7 }, { geo: rim, color: shade(crystalCol, 1.18) });
        }
        s.grow.spots.forEach(([a, b, ta, tb, len, r], i) => {
          const base = surface(a, b).addScaledVector(out, thickness * 0.6);
          const dir = out.clone().addScaledVector(un, ta).addScaledVector(vn, tb).normalize();
          crystal(rim, base, dir, len * big, r * big, crystalCol, s.bone, 0, seed * 3 + i);
        });
      }
      if (s.follow) {
        for (let i = from; i < rock.count; i++) rock.addInfluence(i, s.follow.bone, s.follow.weight(rock.positionOf(i)));
        for (let i = fromRim; i < rim.count; i++) rim.addInfluence(i, s.follow.bone, s.follow.weight(rim.positionOf(i)));
      }
    });
    // 腰の真後ろの晶の塊（ガルドロスの尾の先の晶を小さくしたもの）。腰当てに固定
    if (slot === 'waist' && style==='galdros') {
      const base = new Vector3(0, 1.012, -0.118);
      crystal(rim, base, new Vector3(0, 0.15, -1), 0.05, 0.022, crystalCol, B.pelvis, 0, 3);
      crystal(rim, base.clone().add(new Vector3(0.018, -0.006, 0.004)), new Vector3(0.5, 0.1, -1), 0.036, 0.015, crystalCol, B.pelvis, 0, 5);
      crystal(rim, base.clone().add(new Vector3(-0.017, 0.004, 0.004)), new Vector3(-0.45, 0.4, -1), 0.034, 0.014, crystalCol, B.pelvis, 0, 8);
    }
  }
  return { rock, rim, glow };
}
