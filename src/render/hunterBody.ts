// 基準ハンターの体（仮モデル 2 代目）。設定図（art-source/player/hunter_base_*_v1.png、hunter_face_*_v1.png）の
// 体つきに合わせた筒を、骨（poses.ts の JOINTS）へ重み付けした 1 枚の皮として組む。
// 色は、設定図から焼いた絵（public/assets/textures/hunter/hunter_body_v1.webp）が持つ。区画の並びは hunterAtlas.ts。
// 静止姿勢は「気をつけ」（腕は真下）。設定図は腕を約 40 度開いた姿なので、絵を写す時に腕の向きを合わせる（tools/art/hunter_bake.py）。
import { Vector3 } from 'three';
import { JOINTS, REST, type JointName } from './bodySolve';
import { Geo, blob, hex, horn, loft, sstep, type RGB, type Ring } from './procGeo';

/** 骨の静止位置 (m、root 基準)。rig.ts の骨の配置と、ここの形の両方が使う。 */
export { REST };

const B = Object.fromEntries(JOINTS.map((n, i) => [n, i])) as Record<JointName, number>;
const X = new Vector3(1, 0, 0), Y = new Vector3(0, 1, 0), Z = new Vector3(0, 0, 1);
const WHITE: RGB = [1, 1, 1];
const DARK: RGB = [0.1, 0.085, 0.07];
// 絵を貼らない部品（髪の束・耳・親指・腰袋）の色。設定図の色に合わせてある。
const HAIR = hex(0x5a4130), HAIR_DARK = hex(0x4a3527), SKIN = hex(0xb98a6c), LEATHER = hex(0x6b4a2e);

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
function ringY(y: number, rx: number, front: number, back: number, bones: Bones, cx = 0, cz = 0, tilt = 0): Ring {
  // tilt: 輪を前下がりに傾ける（前が低く、後ろが高くなる）。えりのように、前が開いて後ろが立つ形に使う。
  const up = tilt === 0 ? Z : new Vector3(0, -tilt, 1).normalize();
  return { c: new Vector3(cx, y, cz), right: X, up, rx, top: front, bottom: back, b0: bones[0], b1: bones[1], w1: bones[2], part: 0 };
}

/**
 * 体の一部の三角形の範囲 [始め, 終わり)。buildHunterBody が書く。防具を着ている時に、ここを描かない:
 * mantle = 外套（首まわりと肩の布。胴の防具を着ている時）、hair = 髪の束（兜をかぶっている時。兜を突き抜けるため）。
 */
export const BODY_RANGES: { mantle: [number, number]; hair: [number, number] } = { mantle: [0, 0], hair: [0, 0] };

/** 体の皮を組む。返した Geo の charts が、絵を貼る区画（頭・胴・外套・すそ・腕・脚・足）。 */
export function buildHunterBody(): Geo {
  const g = new Geo();
  const tube = (kind: string, rings: Ring[], t: (r: Ring, i: number) => number, o: { seg?: number; exponent?: number; density?: number; capStart?: RGB; capEnd?: RGB; bulge?: (r: Ring, a: number, i: number) => number } = {}): void => {
    loft(g, rings, { seg: o.seg ?? 14, exponent: o.exponent ?? 2.1, capStart: o.capStart, capEnd: o.capEnd, bulge: o.bulge, atlas: { kinds: [kind], t, density: [o.density ?? 1] }, color: () => WHITE });
  };
  const head: Bones = [B.head, B.head, 0];

  // ---- 頭: あご先 1.565 〜 てっぺん 1.75。前が顔、後ろが後頭部。髪のふくらみは輪郭に含める。----
  // 各高さの前後の奥行きは、設定図（左真横の図）の横顔の輪郭を測った値。左右の幅は正面の図から。
  // 鼻は断面の輪に乗らない（幅が狭い）ので、正面だけ細く盛り上げて、横顔の鼻先の位置に合わせる。
  const headShape: [number, number, number, number][] = [
    [1.565, 0.046, 0.08, 0.06], [1.578, 0.049, 0.083, 0.062], [1.592, 0.053, 0.085, 0.066], [1.606, 0.058, 0.086, 0.074], [1.62, 0.064, 0.085, 0.083], [1.632, 0.071, 0.083, 0.089],
    [1.644, 0.074, 0.081, 0.094], [1.656, 0.078, 0.084, 0.094], [1.668, 0.079, 0.092, 0.092], [1.68, 0.078, 0.097, 0.091], [1.695, 0.075, 0.098, 0.085], [1.71, 0.068, 0.094, 0.076],
    [1.725, 0.052, 0.085, 0.06], [1.738, 0.034, 0.066, 0.041], [1.747, 0.015, 0.036, 0.022], [1.7505, 0.005, 0.012, 0.008],
  ];
  tube('head', [ringY(1.552, 0.042, 0.05, 0.048, [B.neck, B.head, 0.6]), ...headShape.map(([y, rx, f, bk]) => ringY(y, rx, f, bk, head))], (r) => r.c.y, {
    seg: 20, density: 2.6, capEnd: HAIR,
    bulge: (r, a) => {
      const f = Math.max(0, Math.sin(a));
      // 鼻（鼻先は高さ 1.62m、横顔で顔の面から約 1.5cm 出る）と、あご先
      return 0.19 * Math.pow(f, 40) * Math.exp(-0.5 * ((r.c.y - 1.622) / 0.012) ** 2) + 0.03 * Math.pow(f, 8) * Math.exp(-0.5 * ((r.c.y - 1.572) / 0.01) ** 2);
    },
  });

  // ---- 胴: 首の付け根 〜 腰。肩は外套の下なので、なで肩でよい。----
  // 首は、あごの下から鎖骨まで見える（えりは前が開いている）。上端は頭の中へ入れて、すき間を作らない。
  const torsoY = [1.585, 1.545, 1.505, 1.46, 1.4, 1.32, 1.24, 1.16, 1.09, 1.02, 0.95, 0.89, 0.85];
  const torsoShape: [number, number, number][] = [
    [0.05, 0.05, 0.052], [0.053, 0.055, 0.056], [0.085, 0.07, 0.068], [0.172, 0.098, 0.092], [0.166, 0.112, 0.1], [0.156, 0.11, 0.098], [0.146, 0.102, 0.094],
    [0.14, 0.098, 0.092], [0.146, 0.102, 0.098], [0.158, 0.108, 0.106], [0.166, 0.112, 0.114], [0.16, 0.108, 0.11], [0.09, 0.07, 0.07],
  ];
  tube('torso', torsoY.map((y, i) => ringY(y, torsoShape[i]![0], torsoShape[i]![1], torsoShape[i]![2], torsoBones(y))), (r) => r.c.y, { seg: 16, exponent: 2.5, capEnd: DARK });

  // ---- 外套（首まわりのたるみと、肩を覆う短い布）: 胸の骨に付く。上下は開いている。----
  const chest: Bones = [B.chest, B.chest, 0];
  const mantleStart = g.count;
  const mantleTri = g.triangles;
  tube(
    'mantle',
    [
      // えり: 前は鎖骨のあたりまで下がって開き、後ろは首の後ろで立つ（輪を前下がりに傾ける）
      ringY(1.53, 0.09, 0.06, 0.112, [B.chest, B.neck, 0.35], 0, 0, 0.5),
      ringY(1.515, 0.12, 0.092, 0.126, [B.chest, B.neck, 0.2], 0, 0, 0.4),
      ringY(1.49, 0.154, 0.118, 0.134, chest, 0, 0, 0.25),
      ringY(1.465, 0.214, 0.126, 0.132, chest, 0, 0, 0.1),
      ringY(1.41, 0.246, 0.136, 0.14, chest),
      ringY(1.335, 0.262, 0.142, 0.146, chest),
    ],
    (r) => r.c.y,
    // すそは波打たせる（房飾りのある布の端）
    { seg: 20, exponent: 2.2, bulge: (_r, a, i) => (i === 5 ? 0.05 * Math.sin(a * 9 + 1) + 0.03 * Math.sin(a * 4) : i === 4 ? 0.02 * Math.sin(a * 9 + 1) : 0) },
  );
  BODY_RANGES.mantle = [mantleTri, g.triangles];
  // 肩にかかる布は、腕を上げると一緒に持ち上がる（上腕の骨の影響を外側ほど強く足す）
  for (let i = mantleStart; i < g.count; i++) {
    const p = g.positionOf(i);
    g.addInfluence(i, p.x > 0 ? B.upperArmL : B.upperArmR, 0.7 * sstep(0.1, 0.24, Math.abs(p.x)) * sstep(1.5, 1.38, p.y));
  }

  // ---- すそ（上着のすそと前垂れ）: 腰の骨に付く。下は開いている。----
  const pelvis: Bones = [B.pelvis, B.pelvis, 0];
  const skirtStart = g.count;
  tube('skirt', [ringY(1.07, 0.152, 0.106, 0.104, [B.pelvis, B.spine, 0.5]), ringY(0.98, 0.182, 0.126, 0.124, pelvis), ringY(0.87, 0.208, 0.138, 0.136, pelvis), ringY(0.77, 0.216, 0.144, 0.14, pelvis)], (r) => r.c.y, {
    seg: 18, exponent: 2.3, bulge: (_r, a, i) => (i === 3 ? 0.04 * Math.sin(a * 7 + 0.5) + 0.03 * Math.sin(a * 3) : 0),
  });
  // すそは、脚を上げると一緒に動く（左右それぞれ、下ほど太ももの骨の影響を強く足す。中央は腰のまま）
  for (let i = skirtStart; i < g.count; i++) {
    const p = g.positionOf(i);
    g.addInfluence(i, p.x > 0 ? B.thighL : B.thighR, 0.65 * sstep(1.0, 0.8, p.y) * sstep(0.02, 0.1, Math.abs(p.x)));
  }

  // ---- 絵に無い立体: 髪の束（頭の輪郭をぎざぎざにする）、耳、腰袋 ----
  const tufts: [number, number, number, number, number, number, number, number][] = [
    // 位置 x, y, z / 向き x, y, z / 長さ / 太さ
    [0, 1.742, 0.0, 0.1, 1, 0.25, 0.05, 0.03], [0.042, 1.737, -0.03, 0.5, 1, -0.3, 0.052, 0.028], [-0.042, 1.737, -0.02, -0.5, 1, -0.2, 0.05, 0.028], [0, 1.732, -0.062, 0, 1, -0.8, 0.055, 0.03],
    [0.032, 1.716, 0.082, 0.35, 0.3, 1, 0.05, 0.026], [-0.036, 1.712, 0.082, -0.45, 0.2, 1, 0.05, 0.026], [0, 1.722, 0.088, 0.1, 0.5, 1, 0.042, 0.024],
    [0.078, 1.7, 0.0, 1, 0.5, 0.1, 0.046, 0.028], [-0.078, 1.7, 0.0, -1, 0.5, 0.1, 0.046, 0.028], [0.074, 1.67, -0.045, 1, 0.1, -0.6, 0.05, 0.028], [-0.074, 1.67, -0.045, -1, 0.1, -0.6, 0.05, 0.028],
    [0, 1.69, -0.098, 0, 0.3, -1, 0.05, 0.03], [0.042, 1.65, -0.092, 0.4, -0.2, -1, 0.05, 0.028], [-0.042, 1.65, -0.092, -0.4, -0.2, -1, 0.05, 0.028], [0, 1.612, -0.082, 0, -0.6, -1, 0.042, 0.026],
  ];
  // 短く先のとがった束を、毛先を少し曲げて置く（設定図の髪は、短く無造作で、毛先がはねている）
  const hairTri = g.triangles;
  tufts.forEach(([x, y, z, dx, dy, dz, len, rad], i) => {
    const d = new Vector3(dx, dy, dz).normalize();
    // 毛先は、束ごとに左右どちらかへ流す
    const bend = new Vector3().crossVectors(d, Y).multiplyScalar(i % 2 === 0 ? 0.014 : -0.014).add(new Vector3(0, -0.006, 0));
    horn(g, new Vector3(x, y, z).addScaledVector(d, -0.008), d, len * 0.36, rad * 0.6, i % 3 === 0 ? HAIR_DARK : HAIR, B.head, 0, bend);
  });
  BODY_RANGES.hair = [hairTri, g.triangles];
  // 耳は小さく、頭に沿わせる（張り出させない）
  for (const side of [1, -1]) blob(g, new Vector3(0.0775 * side, 1.648, -0.01), Y, 0.04, 0.006, 0.014, () => [SKIN[0] * 0.9, SKIN[1] * 0.86, SKIN[2] * 0.84], B.head, 0, 6, 4);
  blob(g, new Vector3(-0.162, 0.995, 0.09), Y, 0.125, 0.048, 0.027, (p) => (p.y > 1.03 ? [LEATHER[0] * 0.8, LEATHER[1] * 0.8, LEATHER[2] * 0.8] : LEATHER), B.pelvis, 0, 8, 5);

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
    // 親指（手のひらは体の側を向き、親指は前へ出る）
    horn(g, new Vector3(sx, REST.shoulderY - wrist - 0.03, 0.03), new Vector3(0, -0.75, 1), 0.052, 0.012, SKIN, hand, 0);

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
