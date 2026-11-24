// 防具の見た目（ガルドロスの素材の防具: 岩殻・脈殻・晶殻・輝殻）。
// 設定図（art-source/armor/galdros/armor_galdros_t2_*_v1.png。依頼 7 の A。利用者の「採用」はまだ）を見て、
// 板の枚数・左右の偏り・付ける位置を写した。板は、ガルドロスの岩殻と同じ作り（procGeo.plate: 角のある岩板と、縁の晶脈）。
// 図を表面へ貼ってはいない（単色の板）。革の帯・留め具・あごひもは作っていない。
// 座標: m、Y 上、+Z 前、+X が本人の左。静止姿勢は「気をつけ」（腕は真下）。
import { Vector3 } from 'three';
import { ARMOR_SLOTS, type ArmorSlot } from '../data/schemas';
import { JOINTS, REST, type JointName } from './bodySolve';
import { Geo, crystal, hex, plate, sstep, type RGB } from './procGeo';
import { SHELL_PALETTES } from './shellPlates';

/** 部位ごとの段（2 = 岩殻 … 5 = 輝殻）。1 か、無ければ、里の装束（何も足さない）。 */
export type ArmorLook = Partial<Record<ArmorSlot, number>>;
export const armorLookKey = (look: ArmorLook): string => ARMOR_SLOTS.map((s) => look[s] ?? 1).join('');

/** 防具のモデルの ID（model.armor.galdros.t2 など）から段を読む。読めなければ 1（見た目なし）。 */
export const armorTierOf = (assetId: string | undefined): number => {
  const t = Number(/^model\.armor\.galdros\.t(\d)$/.exec(assetId ?? '')?.[1] ?? 1);
  return SHELL_PALETTES[t] ? t : 1;
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
}

/** 部位ごとの板。左（+X）が大きい: ガルドロスの岩殻の偏り（左肩は大 1 枚、右肩は中 1 枚 + 小 1 枚。籠手と腰の板も左が大きい）。 */
const PLATES: Record<ArmorSlot, PlateSpec[]> = {
  // 兜: てっぺんが平たい岩の板。前へ短いひさし
  head: [{ bone: B.head, c: [0, 1.722, 0.012], u: [0.098, 0, 0], v: [0, 0, 0.126], bendU: 0.01, bendV: 0.008, inside: [0, 1.6, 0], thickness: 0.032, skirt: 0.022, points: 10, square: 0.8 }],
  // 胸当て: 胸の前に 2 枚、背の上半分に 2 枚（背中の中央は空ける: 武器を背負う）。肩当ては胴の部品
  chest: [
    { bone: B.chest, c: [0.088, 1.372, 0], u: [0.076, 0, 0], v: [0, 0.088, 0], torso: 1, bendV: 0.012, inside: [0.06, 1.37, 0] },
    { bone: B.chest, c: [-0.088, 1.372, 0], u: [0.076, 0, 0], v: [0, 0.088, 0], torso: 1, bendV: 0.012, inside: [-0.06, 1.37, 0] },
    { bone: B.chest, c: [0.094, 1.372, 0], u: [0.07, 0, 0], v: [0, 0.102, 0], torso: -1, bendV: 0.012, inside: [0.06, 1.37, 0] },
    { bone: B.chest, c: [-0.094, 1.372, 0], u: [0.07, 0, 0], v: [0, 0.102, 0], torso: -1, bendV: 0.012, inside: [-0.06, 1.37, 0] },
    // 左肩: 大きな 1 枚。肩から外へ 12cm・上へ 8cm までに収める（腕を真上へ振り上げる。依頼 7 の決まり）
    { bone: B.chest, c: [0.214, 1.452, 0], u: [0, 0, 0.108], v: [0.056, -0.066, 0], bendU: 0.04, bendV: 0.012, inside: [0.16, 1.42, 0], points: 8, follow: { bone: B.upperArmL, weight: (p) => 0.2 + 0.4 * sstep(0.2, 0.3, p.x) } },
    // 右肩: 中 1 枚（上）+ 小 1 枚（下。上腕に付く）
    { bone: B.chest, c: [-0.207, 1.468, 0], u: [0, 0, 0.086], v: [-0.05, -0.044, 0], bendU: 0.03, bendV: 0.008, inside: [-0.16, 1.44, 0], points: 8, follow: { bone: B.upperArmR, weight: (p) => 0.2 + 0.4 * sstep(0.2, 0.28, -p.x) } },
    { bone: B.upperArmR, c: [-0.243, 1.384, 0], u: [0, 0, 0.062], v: [-0.014, -0.046, 0], bendU: 0.02, inside: [-0.19, 1.41, 0], points: 7 },
  ],
  // 籠手: 前腕の外側。ひじの内側・手首・指は覆わない
  arms: [
    { bone: B.forearmL, c: [0.236, 1.045, 0], u: [0, 0, 0.056], v: [0, 0.104, 0], bendU: 0.022, inside: [0.185, 1.045, 0], points: 8 },
    { bone: B.forearmR, c: [-0.232, 1.065, 0], u: [0, 0, 0.044], v: [0, 0.074, 0], bendU: 0.018, inside: [-0.185, 1.065, 0], points: 7 },
  ],
  // 腰当て: 腰の横に下げる板。前は開ける。下の方は脚について行く
  waist: [
    { bone: B.pelvis, c: [0.232, 0.895, 0.012], u: [0, 0, 0.128], v: [0.012, 0.148, 0], bendU: 0.06, inside: [0.1, 0.9, 0], points: 9, follow: { bone: B.thighL, weight: (p) => 0.6 * sstep(0.98, 0.8, p.y) } },
    { bone: B.pelvis, c: [-0.226, 0.868, -0.03], u: [0, 0, 0.084], v: [-0.01, 0.104, 0], bendU: 0.035, inside: [-0.1, 0.87, 0], points: 8, follow: { bone: B.thighR, weight: (p) => 0.6 * sstep(0.95, 0.8, p.y) } },
  ],
  // 脛当て: すねの前。ひざより下
  legs: [
    { bone: B.shinL, c: [REST.hipX, 0.312, 0.078], u: [0.05, 0, 0], v: [0, 0.104, 0], bendU: 0.02, bendV: 0.006, inside: [REST.hipX, 0.31, 0], points: 8 },
    { bone: B.shinR, c: [-REST.hipX, 0.312, 0.078], u: [0.05, 0, 0], v: [0, 0.104, 0], bendU: 0.02, bendV: 0.006, inside: [-REST.hipX, 0.31, 0], points: 8 },
  ],
};

export interface ArmorGeo {
  /** 岩（と晶）の板 */
  rock: Geo;
  /** 板の縁の晶脈と、腰の後ろの晶の塊 */
  rim: Geo;
  /** 縁が自分で光る強さ（段が上がると光る。0 = 光らない） */
  glow: number;
}

/** 着ている防具の板を組む。どの部位も里の装束（段 1）なら null。 */
export function buildHunterArmor(look: ArmorLook): ArmorGeo | null {
  if (armorLookKey(look) === '11111') return null;
  const rock = new Geo(), rim = new Geo();
  let glow = 0;
  let seed = 11;
  for (const slot of ARMOR_SLOTS) {
    const tier = look[slot] ?? 1;
    const pal = SHELL_PALETTES[tier];
    if (tier < 2 || !pal) continue;
    // 岩殻（2 段目）の板の色は、設定図の灰褐色に合わせる。上の段は、武器の板と同じ色の表（段の違いの絵が届くまでの仮）
    const rockCol: RGB = tier === 2 ? hex(0x8a8170) : hex(pal.rock), rimCol: RGB = tier === 2 ? hex(0xc9963c) : hex(pal.band);
    glow = Math.max(glow, tier >= 5 ? 0.55 : tier === 4 ? 0.2 : 0);
    for (const s of PLATES[slot]) {
      const k = pal.scale;
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
      const from = rock.count, fromRim = rim.count;
      plate(rock, { surface, inside, w: u.length() * 2, d: v.length() * 2, thickness: (s.thickness ?? 0.026) * k, skirt: s.skirt ?? 0.014, bevel: 0.009, seed: seed++, bone: s.bone, part: 0, rock: rockCol, points: s.points ?? 8, square: s.square ?? 0.62 }, { geo: rim, color: rimCol });
      if (s.follow) {
        for (let i = from; i < rock.count; i++) rock.addInfluence(i, s.follow.bone, s.follow.weight(rock.positionOf(i)));
        for (let i = fromRim; i < rim.count; i++) rim.addInfluence(i, s.follow.bone, s.follow.weight(rim.positionOf(i)));
      }
    }
    // 腰の真後ろの晶の塊（ガルドロスの尾の先の晶を小さくしたもの）。腰当てに固定
    if (slot === 'waist') {
      const base = new Vector3(0, 1.012, -0.118);
      crystal(rim, base, new Vector3(0, 0.15, -1), 0.05, 0.022, rimCol, B.pelvis, 0, 3);
      crystal(rim, base.clone().add(new Vector3(0.018, -0.006, 0.004)), new Vector3(0.5, 0.1, -1), 0.036, 0.015, rimCol, B.pelvis, 0, 5);
      crystal(rim, base.clone().add(new Vector3(-0.017, 0.004, 0.004)), new Vector3(-0.45, 0.4, -1), 0.034, 0.014, rimCol, B.pelvis, 0, 8);
    }
    // 晶殻・輝殻: 左の肩当てに、短い晶が生える（段の違いの絵（依頼 7 の B）が届くまでの仮）
    if (slot === 'chest' && tier >= 4) {
      const at = new Vector3(0.236, 1.488, -0.02);
      crystal(rim, at, new Vector3(0.4, 0.9, -0.1), 0.05 + 0.02 * (tier - 4), 0.018, rimCol, B.chest, 0, 2);
      crystal(rim, at.clone().add(new Vector3(-0.02, 0.008, 0.05)), new Vector3(0.25, 0.95, 0.2), 0.036 + 0.02 * (tier - 4), 0.014, rimCol, B.chest, 0, 6);
    }
  }
  return { rock, rim, glow };
}
