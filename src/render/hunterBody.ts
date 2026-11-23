// 基準ハンターの体（仮モデル 2 代目）。設定図（art-source/player/hunter_base_*_v1.png、hunter_face_*_v1.png）の
// 体つきに合わせた筒を、骨（poses.ts の JOINTS）へ重み付けした 1 枚の皮として組む。
// 色は、設定図から焼いた絵（public/assets/textures/hunter/hunter_body_v1.webp）が持つ。区画の並びは hunterAtlas.ts。
// 静止姿勢は「気をつけ」（腕は真下）。設定図は腕を約 40 度開いた姿なので、絵を写す時に腕の向きを合わせる（tools/art/hunter_bake.py）。
import { Vector3 } from 'three';
import { JOINTS, type JointName } from './poses';
import { Geo, loft, sstep, type RGB, type Ring } from './procGeo';

/** 骨の静止位置 (m、root 基準)。rig.ts の骨の配置と、ここの形の両方が使う。 */
export const REST = {
  pelvisY: 0.92, spineY: 1.02, chestY: 1.18, neckY: 1.52, headY: 1.58,
  shoulderX: 0.185, shoulderY: 1.46, upperArm: 0.29, forearm: 0.27,
  hipX: 0.095, hipY: 0.88, thigh: 0.43, shin: 0.41,
  /** 頭のてっぺん（全高） */
  top: 1.75,
} as const;

const B = Object.fromEntries(JOINTS.map((n, i) => [n, i])) as Record<JointName, number>;
const X = new Vector3(1, 0, 0), Y = new Vector3(0, 1, 0), Z = new Vector3(0, 0, 1);
const WHITE: RGB = [1, 1, 1];
const DARK: RGB = [0.1, 0.085, 0.07];

type Bones = [number, number, number];
/** 胴の高さごとの骨 */
function torsoBones(y: number): Bones {
  if (y >= 1.55) return [B.neck, B.head, sstep(1.55, 1.6, y)];
  if (y >= 1.47) return [B.chest, B.neck, sstep(1.47, 1.55, y)];
  if (y >= 1.1) return [B.spine, B.chest, sstep(1.1, 1.24, y)];
  if (y >= 0.96) return [B.pelvis, B.spine, sstep(0.96, 1.08, y)];
  return [B.pelvis, B.pelvis, 0];
}

/** 縦の筒の輪。rx は左右の半幅、front / back は中心から前・後ろへの奥行き。 */
function ringY(y: number, rx: number, front: number, back: number, bones: Bones, cx = 0, cz = 0): Ring {
  return { c: new Vector3(cx, y, cz), right: X, up: Z, rx, top: front, bottom: back, b0: bones[0], b1: bones[1], w1: bones[2], part: 0 };
}

/** 体の皮を組む。返した Geo の charts が、絵を貼る区画（頭・胴・外套・すそ・腕・脚・足）。 */
export function buildHunterBody(): Geo {
  const g = new Geo();
  const tube = (kind: string, rings: Ring[], t: (r: Ring, i: number) => number, o: { seg?: number; exponent?: number; density?: number; capStart?: RGB; capEnd?: RGB; bulge?: (r: Ring, a: number, i: number) => number } = {}): void => {
    loft(g, rings, { seg: o.seg ?? 14, exponent: o.exponent ?? 2.1, capStart: o.capStart, capEnd: o.capEnd, bulge: o.bulge, atlas: { kinds: [kind], t, density: [o.density ?? 1] }, color: () => WHITE });
  };
  const head: Bones = [B.head, B.head, 0];

  // ---- 頭: あご先 1.565 〜 てっぺん 1.75。前が顔、後ろが後頭部。髪のふくらみは輪郭に含める。----
  tube(
    'head',
    [
      ringY(1.548, 0.034, 0.04, 0.036, [B.neck, B.head, 0.6]),
      ringY(1.565, 0.047, 0.086, 0.05, head),
      ringY(1.59, 0.064, 0.098, 0.074, head),
      ringY(1.622, 0.073, 0.103, 0.09, head),
      ringY(1.655, 0.078, 0.099, 0.098, head),
      ringY(1.69, 0.082, 0.097, 0.102, head),
      ringY(1.72, 0.076, 0.086, 0.097, head),
      ringY(1.741, 0.054, 0.058, 0.07, head),
      ringY(1.75, 0.02, 0.02, 0.026, head),
    ],
    (r) => r.c.y,
    {
      seg: 18, density: 2.6, capEnd: DARK,
      // 鼻（正面のふくらみ）とあご
      bulge: (r, a) => {
        const f = Math.max(0, Math.sin(a));
        return 0.13 * Math.pow(f, 10) * Math.exp(-0.5 * ((r.c.y - 1.632) / 0.018) ** 2) + 0.05 * Math.pow(f, 6) * Math.exp(-0.5 * ((r.c.y - 1.57) / 0.012) ** 2);
      },
    },
  );

  // ---- 胴: 首の付け根 〜 腰。肩は外套の下なので、なで肩でよい。----
  const torsoY = [1.556, 1.525, 1.495, 1.46, 1.4, 1.32, 1.24, 1.16, 1.09, 1.02, 0.95, 0.89, 0.85];
  const torsoShape: [number, number, number][] = [
    [0.04, 0.044, 0.042], [0.047, 0.05, 0.05], [0.11, 0.075, 0.07], [0.172, 0.098, 0.092], [0.166, 0.112, 0.1], [0.156, 0.11, 0.098], [0.146, 0.102, 0.094],
    [0.14, 0.098, 0.092], [0.146, 0.102, 0.098], [0.158, 0.108, 0.106], [0.166, 0.112, 0.114], [0.16, 0.108, 0.11], [0.09, 0.07, 0.07],
  ];
  tube('torso', torsoY.map((y, i) => ringY(y, torsoShape[i]![0], torsoShape[i]![1], torsoShape[i]![2], torsoBones(y))), (r) => r.c.y, { seg: 16, exponent: 2.5, capEnd: DARK });

  // ---- 外套（首まわりのたるみと、肩を覆う短い布）: 胸の骨に付く。上下は開いている。----
  const chest: Bones = [B.chest, B.chest, 0];
  tube(
    'mantle',
    [
      ringY(1.6, 0.082, 0.05, 0.108, [B.chest, B.neck, 0.5]),
      ringY(1.565, 0.112, 0.085, 0.124, [B.chest, B.neck, 0.3]),
      ringY(1.52, 0.15, 0.116, 0.134, chest),
      ringY(1.475, 0.214, 0.126, 0.132, chest),
      ringY(1.41, 0.246, 0.136, 0.14, chest),
      ringY(1.335, 0.262, 0.142, 0.146, chest),
    ],
    (r) => r.c.y,
    { seg: 18, exponent: 2.2 },
  );

  // ---- すそ（上着のすそと前垂れ）: 腰の骨に付く。下は開いている。----
  const pelvis: Bones = [B.pelvis, B.pelvis, 0];
  tube('skirt', [ringY(1.07, 0.152, 0.106, 0.104, [B.pelvis, B.spine, 0.5]), ringY(0.98, 0.182, 0.126, 0.124, pelvis), ringY(0.87, 0.208, 0.138, 0.136, pelvis), ringY(0.77, 0.216, 0.144, 0.14, pelvis)], (r) => r.c.y, { seg: 16, exponent: 2.3 });

  for (const side of [1, -1] as const) {
    const S = side > 0 ? 'L' : 'R';
    const up = B[`upperArm${S}`], fore = B[`forearm${S}`], hand = B[`hand${S}`];
    const sx = REST.shoulderX * side;
    // ---- 腕: 肩から指先まで 1 本。t は肩からの距離。袖はふくらみ、前腕は革の腕当て、手は平たい。----
    const elbow = REST.upperArm, wrist = REST.upperArm + REST.forearm;
    const arm: [number, number, number, Bones][] = [
      [0, 0.05, 0.05, [up, up, 0]], [0.03, 0.061, 0.06, [up, up, 0]], [0.14, 0.06, 0.058, [up, up, 0]], [0.24, 0.056, 0.054, [up, fore, 0.15]], [elbow, 0.05, 0.05, [up, fore, 0.5]],
      [elbow + 0.05, 0.047, 0.046, [fore, up, 0.15]], [elbow + 0.15, 0.043, 0.042, [fore, fore, 0]], [wrist - 0.03, 0.036, 0.034, [fore, hand, 0.2]], [wrist, 0.03, 0.028, [fore, hand, 0.6]],
      [wrist + 0.04, 0.02, 0.044, [hand, hand, 0]], [wrist + 0.085, 0.018, 0.04, [hand, hand, 0]], [wrist + 0.115, 0.01, 0.018, [hand, hand, 0]],
    ];
    tube(`arm${S}`, arm.map(([t, rx, rz, b]) => ringY(REST.shoulderY - t, rx, rz, rz, b, sx)), (r) => REST.shoulderY - r.c.y, { seg: 12, capStart: DARK, capEnd: DARK });

    // ---- 脚: 付け根から足首まで 1 本。t は付け根からの距離。ズボンはふくらみ、ひざから下は長靴。----
    const thigh = B[`thigh${S}`], shin = B[`shin${S}`], foot = B[`foot${S}`];
    const hx = REST.hipX * side;
    const knee = REST.thigh, ankle = REST.thigh + REST.shin;
    const leg: [number, number, number, Bones][] = [
      [0, 0.088, 0.092, [thigh, thigh, 0]], [0.12, 0.09, 0.094, [thigh, thigh, 0]], [0.28, 0.08, 0.084, [thigh, thigh, 0]], [knee - 0.05, 0.07, 0.074, [thigh, shin, 0.2]], [knee, 0.068, 0.072, [thigh, shin, 0.5]],
      [knee + 0.05, 0.066, 0.068, [shin, thigh, 0.2]], [knee + 0.16, 0.054, 0.058, [shin, shin, 0]], [knee + 0.3, 0.048, 0.052, [shin, shin, 0]], [ankle - 0.03, 0.046, 0.05, [shin, foot, 0.3]], [ankle + 0.03, 0.046, 0.05, [foot, foot, 0]],
    ];
    tube(`leg${S}`, leg.map(([t, rx, rz, b]) => ringY(REST.hipY - t, rx, rz, rz, b, hx)), (r) => REST.hipY - r.c.y, { seg: 12, capStart: DARK, capEnd: DARK });

    // ---- 足（長靴の先）: かかとからつま先へ。t は前後の位置。底は平ら。----
    const fb: Bones = [foot, foot, 0];
    const footRing = (z: number, rx: number, h: number): Ring => ({ c: new Vector3(hx, 0.0, z), right: X, up: Y, rx, top: h, bottom: 0.004, b0: fb[0], b1: fb[1], w1: 0, part: 0 });
    tube(`foot${S}`, [footRing(-0.075, 0.03, 0.05), footRing(-0.05, 0.046, 0.085), footRing(0.02, 0.05, 0.095), footRing(0.09, 0.052, 0.07), footRing(0.155, 0.048, 0.052), footRing(0.19, 0.03, 0.03)], (r) => r.c.z, { seg: 10, exponent: 2.6, capStart: DARK, capEnd: DARK });
  }
  return g;
}
