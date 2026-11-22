// 岩殻獣ガルドロスの仮モデル（2 代目）。
// 箱の組み合わせをやめ、骨で曲がる一続きの皮（胴・首・頭・あご・尾・脚）、欠けた岩板、うろこ状の模様で組む。
// 体つきと岩板の分け方は、採用した設定図（art-source/monster/galdros/、全長 5.8m・全高 約 2.45m・左肩の岩板が大きい）に合わせてある。
// 脚は「足先を地面に置いてから膝の位置を解く」ので、歩いても向きを変えても足が滑らない。
// 前脚叩きの脚と尾払いの尾は、判定と同じ軌道データで動かす（見た目 = 判定）。
// コードで作った形であり、正式モデル（GLB）が来るまでの仮素材であることは変わらない。
import { Bone, Group, Matrix4, Mesh, MeshStandardMaterial, Quaternion, Skeleton, SkinnedMesh, Vector3 } from 'three';
import { smoothstep } from '../core/math';
import { renderTick } from '../game/action';
import type { MonsterState } from '../game/monster';
import { sampleTrack } from '../game/tracks';
import type { MonsterRig, MonsterRigCtx } from './monsterRig';
import { Geo, crystal, fbm, hex, horn, loft, makeHideTextures, makeRockTextures, mix, shade, slab, sstep, type RGB, type Ring } from './procGeo';

// ---- 骨の番号 ----
const ROOT = 0, BODY = 1, PELVIS = 2, CHEST = 3, NECK = 4, HEAD = 5, JAW = 6, TAIL = 7, LEG = 12;
const BONES = LEG + 12;
const BODY_Y = 1.25;
/** 尾の関節の位置 (z)。3 番目（-2.5）が切断面。 */
const TAIL_Z = [-1.5, -1.85, -2.2, -2.5, -3.0];
const TAIL_END = -3.62;
/** 尾の先の晶の塊の中心 */
const TAIL_TIP: readonly [number, number, number] = [0, 0.73, -3.5];
const CUT = 3;
const ANKLE_H = 0.2;

// ---- 色（採用した基準ボード: 岩は灰〜灰褐色、苔の灰緑、縁取りは明るい青銅） ----
const HIDE = hex(0x857a6c), BELLY = hex(0xb0a48d), DARK = hex(0x5b534a), DUST = hex(0xa39a86), STAIN = hex(0x7a7d69);
const SCAR = hex(0x3a322e), FLESH = hex(0x6e2f2a), HORN = hex(0xcfc2a0), HORN_DARK = hex(0x8a7d62);
const ROCK = hex(0x97928a), ROCK_DARK = hex(0x77736b), MOSS = hex(0x7d8563), BRONZE = hex(0xc9a062), AMBER = hex(0xffc66e);

// 体の軸に沿った断面: [z, 中心の高さ, 横の半径, 上の半径, 下の半径]（尾先 → 鼻先）
const SPINE: readonly (readonly [number, number, number, number, number])[] = [
  [TAIL_END, 0.71, 0.1, 0.1, 0.1],
  [-3.44, 0.73, 0.2, 0.2, 0.18],
  [-3.1, 0.76, 0.26, 0.26, 0.23],
  [-2.8, 0.8, 0.3, 0.3, 0.26],
  [-2.5, 0.85, 0.32, 0.32, 0.28],
  [-2.2, 0.9, 0.36, 0.36, 0.31],
  [-1.85, 0.97, 0.43, 0.42, 0.36],
  [-1.5, 1.05, 0.58, 0.54, 0.45],
  [-1.2, 1.12, 0.86, 0.78, 0.6],
  [-0.8, 1.18, 1.05, 0.9, 0.72],
  [-0.3, 1.22, 1.14, 0.93, 0.8],
  [0.3, 1.22, 1.14, 0.93, 0.8],
  [0.8, 1.22, 1.08, 0.9, 0.76],
  [1.15, 1.25, 0.94, 0.8, 0.66],
  [1.45, 1.33, 0.74, 0.66, 0.52],
  [1.7, 1.42, 0.63, 0.58, 0.42],
  [1.9, 1.52, 0.6, 0.52, 0.32],
  [2.2, 1.54, 0.57, 0.46, 0.28],
  [2.5, 1.5, 0.5, 0.38, 0.25],
  [2.72, 1.45, 0.39, 0.29, 0.2],
  [2.86, 1.41, 0.24, 0.17, 0.13],
  [2.92, 1.39, 0.1, 0.07, 0.06],
];

/** 断面の表を z でなめらかに補間する。 */
function spineAt(z: number): { cy: number; rx: number; top: number; bottom: number } {
  const n = SPINE.length;
  let i = 0;
  while (i < n - 2 && SPINE[i + 1]![0] <= z) i++;
  const a = SPINE[i]!, b = SPINE[i + 1]!;
  const p = SPINE[Math.max(0, i - 1)]!, q = SPINE[Math.min(n - 1, i + 2)]!;
  const h = b[0] - a[0];
  const t = Math.min(1, Math.max(0, (z - a[0]) / h));
  const f = (k: 1 | 2 | 3 | 4): number => {
    const m0 = ((b[k] - p[k]) / (b[0] - p[0] || 1)) * h, m1 = ((q[k] - a[k]) / (q[0] - a[0] || 1)) * h;
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * a[k] + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * b[k] + (t3 - t2) * m1;
  };
  return { cy: f(1), rx: Math.max(0.02, f(2)), top: Math.max(0.02, f(3)), bottom: Math.max(0.02, f(4)) };
}

const TAIL_MID = TAIL_Z.map((z, i) => (z + (TAIL_Z[i + 1] ?? TAIL_END)) / 2);
/** 体の軸上の位置 z が、どの骨にどれだけ付くか。尾の切断面では骨をまたがない（切った時に平らな断面になる）。 */
function spineBones(z: number, afterCut: boolean): [number, number, number] {
  if (z >= 1.9) return [HEAD, HEAD, 0];
  if (z >= 1.6) return [NECK, HEAD, sstep(1.6, 1.9, z)];
  if (z >= 1.25) return [CHEST, NECK, sstep(1.25, 1.6, z)];
  if (z >= 0.4) return [CHEST, CHEST, 0];
  if (z >= -0.4) return [PELVIS, CHEST, sstep(-0.4, 0.4, z)];
  if (z >= -1.3) return [PELVIS, PELVIS, 0];
  if (z >= TAIL_MID[0]!) return [PELVIS, TAIL, sstep(-1.3, TAIL_MID[0]!, z)];
  if (z >= TAIL_MID[1]!) return [TAIL, TAIL + 1, sstep(TAIL_MID[0]!, TAIL_MID[1]!, z)];
  if (z >= TAIL_MID[2]!) return [TAIL + 1, TAIL + 2, sstep(TAIL_MID[1]!, TAIL_MID[2]!, z)];
  if (z > TAIL_Z[CUT]! || (z === TAIL_Z[CUT]! && !afterCut)) return [TAIL + 2, TAIL + 2, 0];
  if (z >= TAIL_MID[3]!) return [TAIL + 3, TAIL + 3, 0];
  if (z >= TAIL_MID[4]!) return [TAIL + 3, TAIL + 4, sstep(TAIL_MID[3]!, TAIL_MID[4]!, z)];
  return [TAIL + 4, TAIL + 4, 0];
}

const gauss = (x: number, c: number, w: number): number => Math.exp(-((x - c) * (x - c)) / (2 * w * w));
const X = new Vector3(1, 0, 0), Y = new Vector3(0, 1, 0);
const EYES = [new Vector3(0.5, 1.7, 2.24), new Vector3(-0.5, 1.7, 2.24)];

/** 皮の色。上は暗く腹は明るく、まだらと土ぼこりを足す。 */
function hideColor(p: Vector3, n: Vector3): RGB {
  let c = mix(BELLY, HIDE, sstep(-0.6, 0.1, n.y));
  c = mix(c, DARK, 0.5 * sstep(0.3, 0.95, n.y));
  c = mix(c, STAIN, 0.3 * sstep(0.45, 0.7, fbm(p.x * 0.9 + 3, p.y * 0.9, p.z * 0.9 + 8, 2)));
  c = shade(c, 0.8 + 0.4 * fbm(p.x * 3.3, p.y * 3.3 + 5, p.z * 3.3, 3));
  c = mix(c, DUST, 0.55 * sstep(0.6, 0.08, p.y));
  return c;
}

interface PartIds {
  head: number;
  tail: number;
  back: number;
  foreleg: number;
  hindleg: number;
  body: number;
}

interface Leg {
  upper: Bone;
  lower: Bone;
  foot: Bone;
  /** 設計時の位置（モデル座標） */
  hip: Vector3;
  home: Vector3;
  pole: Vector3;
  restU: Vector3;
  restL: Vector3;
  restDown: Vector3;
  l1: number;
  l2: number;
  front: boolean;
  side: number;
  /** 地面に置いた足首の真下（ワールド座標） */
  plant: Vector3;
  from: Vector3;
  /** 1 以上で接地。1 未満は踏み出しの途中 */
  t: number;
  dur: number;
  cur: Vector3;
  fresh: boolean;
}

/** 2 本の骨の脚: 付け根 s と足首 a から、ひじ（ひざ）の位置を求める。 */
function solveJoint(s: Vector3, a: Vector3, l1: number, l2: number, pole: Vector3, outAnkle: Vector3, outJoint: Vector3): void {
  const dir = _d.subVectors(a, s);
  let d = dir.length();
  if (d < 1e-5) {
    dir.set(0, -1, 0);
    d = 1e-5;
  } else dir.multiplyScalar(1 / d);
  const dc = Math.min(Math.max(d, Math.abs(l1 - l2) + 0.02), l1 + l2 - 0.005);
  outAnkle.copy(s).addScaledVector(dir, dc);
  const along = (l1 * l1 - l2 * l2 + dc * dc) / (2 * dc);
  const h = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  const perp = _p.copy(pole).addScaledVector(dir, -pole.dot(dir));
  if (perp.lengthSq() < 1e-8) perp.set(0, 0, 1);
  perp.normalize();
  outJoint.copy(s).addScaledVector(dir, along).addScaledVector(perp, h);
}
const _p = new Vector3();
const _d = new Vector3();

export class GaldrosRig implements MonsterRig {
  readonly root = new Group();
  /** 切り落とした尾の先。地面に残るので、モンスターとは別にシーンへ置く。 */
  readonly extras: Group[] = [];
  private bones: Bone[] = [];
  private legs: Leg[] = [];
  private capMesh: SkinnedMesh;
  private domeMesh: SkinnedMesh;
  private domeRimMesh: SkinnedMesh;
  private coreMesh: SkinnedMesh;
  private glowMat: MeshStandardMaterial;
  private flashUniform = { value: new Float32Array(8) };
  private index: Record<string, number> = {};
  private started = false;
  private lastPos = new Vector3();
  private lastYaw = 0;
  private vel = new Vector3();
  private yawVel = 0;
  private tailLag = 0;
  private lookYaw = 0;
  private blink = 0;
  private wasLimp = false;
  private slamHeld = -1;
  private runPhase = 0;
  // 計算用の使い回し
  private v1 = new Vector3();
  private v2 = new Vector3();
  private v3 = new Vector3();
  private v4 = new Vector3();
  private v5 = new Vector3();
  private q1 = new Quaternion();
  private q2 = new Quaternion();
  private q3 = new Quaternion();
  private q4 = new Quaternion();
  private q5 = new Quaternion();

  constructor(partIds: readonly string[]) {
    partIds.forEach((id, i) => (this.index[id] = i));
    const part: PartIds = {
      head: this.index.head ?? 0,
      tail: this.index.tail ?? 0,
      back: this.index.back ?? 0,
      foreleg: this.index.foreleg ?? 0,
      hindleg: this.index.hindleg ?? 0,
      body: this.index.body ?? 0,
    };

    // ---- 骨 ----
    const rest: Vector3[] = [];
    const parent: number[] = [];
    const def = (i: number, par: number, x: number, y: number, z: number): void => {
      rest[i] = new Vector3(x, y, z);
      parent[i] = par;
    };
    def(ROOT, -1, 0, 0, 0);
    def(BODY, ROOT, 0, BODY_Y, 0);
    def(PELVIS, BODY, 0, BODY_Y, -0.75);
    def(CHEST, BODY, 0, BODY_Y, 0.75);
    def(NECK, CHEST, 0, 1.33, 1.45);
    def(HEAD, NECK, 0, 1.5, 1.85);
    def(JAW, HEAD, 0, 1.36, 1.9);
    TAIL_Z.forEach((z, i) => def(TAIL + i, i === 0 ? PELVIS : TAIL + i - 1, 0, spineAt(z).cy, z));
    // 脚: 前左・前右・後左・後右。左が +X。付け根の位置は判定の軌道データ（肩 y=1.5）に合わせる。
    const legSpecs: { hip: [number, number, number]; home: [number, number]; l1: number; l2: number; front: boolean; side: number }[] = [
      { hip: [1.0, 1.5, 1.05], home: [1.1, 1.18], l1: 0.76, l2: 0.7, front: true, side: 1 },
      { hip: [-1.0, 1.5, 1.05], home: [-1.1, 1.18], l1: 0.76, l2: 0.7, front: true, side: -1 },
      { hip: [0.95, 1.4, -1.05], home: [1.04, -0.98], l1: 0.72, l2: 0.66, front: false, side: 1 },
      { hip: [-0.95, 1.4, -1.05], home: [-1.04, -0.98], l1: 0.72, l2: 0.66, front: false, side: -1 },
    ];
    const legRest: { hip: Vector3; joint: Vector3; ankle: Vector3 }[] = [];
    legSpecs.forEach((s, i) => {
      const hip = new Vector3(...s.hip);
      const ankle = new Vector3(s.home[0], ANKLE_H, s.home[1]);
      // 前脚のひじは後ろ、後脚のひざは前へ曲がる（少し外向き）
      const pole = new Vector3(s.side * 0.25, 0, s.front ? -1 : 1).normalize();
      const joint = new Vector3();
      solveJoint(hip, ankle, s.l1, s.l2, pole, new Vector3(), joint);
      legRest.push({ hip, joint, ankle });
      const b = LEG + i * 3;
      def(b, s.front ? CHEST : PELVIS, hip.x, hip.y, hip.z);
      def(b + 1, b, joint.x, joint.y, joint.z);
      def(b + 2, b + 1, ankle.x, ankle.y, ankle.z);
    });
    for (let i = 0; i < BONES; i++) {
      const b = new Bone();
      const par = parent[i]!;
      if (par >= 0) {
        b.position.copy(rest[i]!).sub(rest[par]!);
        this.bones[par]!.add(b);
      }
      this.bones.push(b);
    }
    this.root.add(this.bones[ROOT]!);
    this.root.updateMatrixWorld(true);
    const skeleton = new Skeleton(this.bones);
    legSpecs.forEach((s, i) => {
      const r = legRest[i]!;
      const b = LEG + i * 3;
      this.legs.push({
        upper: this.bones[b]!, lower: this.bones[b + 1]!, foot: this.bones[b + 2]!,
        hip: r.hip.clone(), home: new Vector3(s.home[0], 0, s.home[1]),
        pole: new Vector3(s.side * 0.25, 0, s.front ? -1 : 1).normalize(),
        restU: new Vector3().subVectors(r.joint, r.hip).normalize(),
        restL: new Vector3().subVectors(r.ankle, r.joint).normalize(),
        restDown: new Vector3().subVectors(r.ankle, r.hip).normalize(),
        l1: s.l1, l2: s.l2, front: s.front, side: s.side,
        plant: new Vector3(), from: new Vector3(), t: 1, dur: 0.3, cur: new Vector3(), fresh: true,
      });
    });

    // ---- 形 ----
    const hide = new Geo(), rock = new Geo(), cap = new Geo(), dome = new Geo(), domeRim = new Geo(), core = new Geo(), glow = new Geo();

    // 胴・首・頭（上あご）・尾: 尾先から鼻先まで 1 本の皮
    const zs: number[] = [];
    for (let z = TAIL_END; z < 2.93; z += z < -1.4 ? 0.085 : z < 1.3 ? 0.1 : 0.06) zs.push(Math.abs(z - TAIL_Z[CUT]!) < 0.04 ? TAIL_Z[CUT]! - 0.045 : z);
    const cutZ = TAIL_Z[CUT]!;
    const rings: (Ring & { z: number; flesh?: boolean })[] = [];
    const ringAt = (z: number, afterCut: boolean, flesh = false): void => {
      const s = spineAt(z);
      const [b0, b1, w1] = spineBones(z, afterCut);
      rings.push({ c: new Vector3(0, s.cy, z), right: X, up: Y, rx: s.rx, top: s.top, bottom: s.bottom, b0, b1, w1, z, flesh, part: z > 1.6 ? part.head : z < -1.6 ? part.tail : part.body });
    };
    let cutDone = false;
    for (const z of zs) {
      if (!cutDone && z > cutZ) {
        // 切断面: 同じ位置に輪を 4 つ重ねる（先側の 2 つは切った時に 1 点へ縮み、残った輪との間が断面になる）
        ringAt(cutZ, true);
        ringAt(cutZ, true, true);
        ringAt(cutZ, false, true);
        ringAt(cutZ, false);
        cutDone = true;
      }
      ringAt(z, true);
    }
    loft(hide, rings, {
      seg: 30, exponent: 2.25, noise: 0.028, noiseFreq: 1.9, uRepeat: 5, capStart: DARK, capEnd: HORN_DARK,
      bulge: (r, a) => {
        const z = (r as Ring & { z: number }).z;
        const side = Math.abs(Math.cos(a)), upness = Math.sin(a), dTop = Math.abs(a - Math.PI / 2);
        let b = 0;
        b += 0.11 * gauss(z, 1.0, 0.36) * side * sstep(-0.7, 0.3, upness); // 肩
        b += 0.09 * gauss(z, -1.0, 0.34) * side * sstep(-0.7, 0.3, upness); // 腰
        b += 0.035 * sstep(0.9, 1.0, upness) * sstep(-3.0, -1.2, z) * sstep(1.7, 1.2, z); // 背骨の稜線
        b += 0.06 * gauss(z, -0.1, 0.8) * sstep(-0.35, -1, upness); // 腹のたるみ
        b += 0.2 * gauss(z, 2.16, 0.12) * gauss(dTop, 0.78, 0.2); // 眉
        b += 0.07 * gauss(z, 1.98, 0.18) * side * gauss(upness, -0.15, 0.4); // 頬
        b -= 0.07 * gauss(z, 2.52, 0.1) * gauss(dTop, 1.05, 0.25); // 鼻づらのくぼみ
        b += 0.02 * Math.sin(z * 24) * gauss(z, 1.45, 0.28); // 首のしわ
        b += 0.014 * Math.sin(z * 21 + 1) * (gauss(z, -1.4, 0.3) + gauss(z, 0.55, 0.3)); // 肩・腰のしわ
        return b;
      },
      color: (p, n, r, a) => {
        const rr = r as Ring & { z: number; flesh?: boolean };
        if (rr.flesh) return FLESH;
        let c = hideColor(p, n);
        const dTop = Math.abs(a - Math.PI / 2);
        // 岩板の下に隠れている面（壊すと見える）: 傷んだ暗い地肌
        const under = Math.max(sstep(0.85, 0.5, dTop) * sstep(-1.25, -0.9, rr.z) * sstep(1.1, 0.8, rr.z), sstep(0.7, 0.4, dTop) * sstep(1.8, 1.95, rr.z) * sstep(2.6, 2.45, rr.z));
        c = mix(c, shade(SCAR, 0.8 + 0.5 * fbm(p.x * 6, p.y * 6, p.z * 6, 2)), under * 0.85);
        for (const e of EYES) c = mix(c, SCAR, 0.8 * sstep(0.17, 0.07, p.distanceTo(e)));
        if (rr.z > 2.7) c = mix(c, HORN_DARK, sstep(2.7, 2.85, rr.z));
        return c;
      },
    });

    // 下あご
    const jaw: Ring[] = [];
    for (const [z, cy, rx, top, bottom] of [[1.84, 1.2, 0.46, 0.13, 0.17], [2.05, 1.19, 0.5, 0.15, 0.19], [2.3, 1.19, 0.47, 0.15, 0.17], [2.55, 1.2, 0.4, 0.13, 0.14], [2.72, 1.22, 0.27, 0.1, 0.1], [2.82, 1.24, 0.09, 0.04, 0.04]] as const) {
      jaw.push({ c: new Vector3(0, cy, z), right: X, up: Y, rx, top, bottom, b0: JAW, b1: JAW, w1: 0, part: part.head });
    }
    loft(hide, jaw, { seg: 16, exponent: 2.3, noise: 0.012, uRepeat: 2, capStart: DARK, capEnd: HORN_DARK, color: (p, n) => mix(hideColor(p, n), BELLY, 0.35) });
    // くちばしと牙
    horn(hide, new Vector3(0, 1.4, 2.8), new Vector3(0, -0.45, 1), 0.3, 0.17, HORN, HEAD, part.head, new Vector3(0, -0.2, 0));
    horn(hide, new Vector3(0, 1.26, 2.74), new Vector3(0, 0.5, 1), 0.16, 0.1, HORN, JAW, part.head);
    for (const s of [1, -1]) horn(hide, new Vector3(s * 0.36, 1.3, 2.4), new Vector3(s * 0.25, 1, 0.25), 0.2, 0.06, HORN, JAW, part.head, new Vector3(0, 0, 0.05));
    // 目（光る）
    for (const e of EYES) {
      const eye: Ring[] = [];
      const out = new Vector3(Math.sign(e.x), 0.1, 0.25).normalize();
      const up = new Vector3().crossVectors(out, new Vector3(0, 0, 1)).normalize();
      const right = new Vector3().crossVectors(up, out).normalize();
      for (let i = 0; i <= 4; i++) {
        const t = i / 4;
        const r = Math.max(0.006, 0.078 * Math.sin(Math.PI * (0.12 + 0.88 * t) * 0.999) * (t === 1 ? 0.1 : 1));
        eye.push({ c: e.clone().addScaledVector(out, -0.04 + 0.1 * t), right, up, rx: r, top: r * 0.8, bottom: r * 0.8, b0: HEAD, b1: HEAD, w1: 0, part: part.head });
      }
      loft(glow, eye, { seg: 8, uRepeat: 1, color: () => AMBER });
    }

    // 脚
    legSpecs.forEach((s, i) => {
      const r = legRest[i]!;
      const b = LEG + i * 3;
      const pid = s.front ? part.foreleg : part.hindleg;
      const k = s.front ? 1 : 0.95;
      // [付け根からの割合(0=付け根,1=関節,2=足首), 半径]
      const prof: [number, number][] = [[-0.12, 0.52], [0.12, 0.53], [0.4, 0.5], [0.75, 0.46], [1.0, 0.44], [1.25, 0.43], [1.6, 0.41], [1.85, 0.41], [2.0, 0.42]];
      const lr: Ring[] = prof.map(([u, rad]) => {
        const a = u <= 1 ? r.hip : r.joint, c = u <= 1 ? r.joint : r.ankle;
        const t = u <= 1 ? u : u - 1;
        const cpos = new Vector3().lerpVectors(a, c, t);
        const dir = new Vector3().subVectors(c, a).normalize();
        const right = new Vector3().crossVectors(dir, new Vector3(0, 0, 1)).normalize();
        const up = new Vector3().crossVectors(right, dir).normalize();
        // 関節の前後 0.3 の範囲で 2 本の骨を混ぜる
        let b0 = b, b1 = b, w1 = 0;
        if (u > 0.7 && u < 1.3) { b1 = b + 1; w1 = sstep(0.7, 1.3, u); }
        else if (u >= 1.3 && u < 1.8) { b0 = b + 1; b1 = b + 1; }
        else if (u >= 1.8) { b0 = b + 1; b1 = b + 2; w1 = sstep(1.8, 2.1, u) * 0.6; }
        // 上腕（もも）は前後に厚い
        const thick = u < 1 ? 1.14 : 1.04;
        return { c: cpos, right, up, rx: rad * k, top: rad * k * thick, bottom: rad * k * thick, b0, b1, w1, part: pid };
      });
      loft(hide, lr, {
        seg: 14, exponent: 2.2, noise: 0.022, noiseFreq: 2.6, uRepeat: 2,
        bulge: (_r, a, idx) => 0.05 * Math.sin(idx * 2.1 + i) + (idx === 4 ? 0.08 * Math.max(0, Math.sin(a) * (s.front ? -1 : 1)) : 0),
        color: (p, n) => shade(hideColor(p, n), 0.92),
      });
      // 足: 平たく広い。地面に接する。
      const fx = r.ankle.x, fz = r.ankle.z;
      const foot: Ring[] = [];
      for (const [dz, rx, top] of [[-0.44, 0.05, 0.04], [-0.38, 0.26, 0.17], [-0.28, 0.42, 0.27], [-0.04, 0.5, 0.36], [0.2, 0.52, 0.3], [0.42, 0.47, 0.21], [0.56, 0.32, 0.13], [0.63, 0.1, 0.05]] as const) {
        foot.push({ c: new Vector3(fx, 0.085, fz + dz), right: X, up: Y, rx: rx * k, top: top * k, bottom: 0.085, b0: b + 2, b1: b + 2, w1: 0, part: pid });
      }
      loft(hide, foot, { seg: 14, exponent: 2.6, noise: 0.012, uRepeat: 2, capStart: DARK, capEnd: DARK, color: (p, n) => mix(mix(shade(hideColor(p, n), 0.85), DUST, 0.3), DARK, 0.8 * sstep(-0.35, -0.8, n.y)) });
      for (const cx of [-0.36, -0.12, 0.12, 0.36]) {
        horn(hide, new Vector3(fx + cx * k, 0.13, fz + 0.5 - Math.abs(cx) * 0.3), new Vector3(cx * 0.5, -0.1, 1), 0.27, 0.115, HORN, b + 2, pid, new Vector3(0, -0.1, 0));
      }
      // 肩・腰の筋肉のふくらみ（脚が動いても付け根に隙間が出ない）
      const lump: Ring[] = [];
      const lc = new Vector3(s.hip[0] * 0.93, s.hip[1] - 0.02, s.hip[2]);
      for (let j = 0; j <= 6; j++) {
        const t = j / 6;
        const rr = Math.max(0.02, Math.sin(Math.PI * (0.06 + 0.88 * t)));
        lump.push({ c: lc.clone().add(new Vector3(0, 0, -0.56 + 1.12 * t)), right: X, up: Y, rx: 0.42 * rr, top: 0.52 * rr, bottom: 0.5 * rr, b0: s.front ? CHEST : PELVIS, b1: b, w1: 0.35, part: pid });
      }
      loft(hide, lump, { seg: 12, noise: 0.02, uRepeat: 2, color: (p, n) => hideColor(p, n) });
    });

    // ---- 岩板 ----
    const rim = { geo: glow, color: BRONZE };
    // 背殻: 中央で左右 2 枚に割れた大きな岩板（壊れる）
    slab(dome, { w: 1.3, d: 2.75, h: 0.36, seed: 11, pos: [0.6, 2.2, -0.12], rot: [0, 0.03, -0.3], bone: BODY, part: part.back, rock: ROCK, moss: 0.25, mossColor: MOSS, bendX: 0.16, bendZ: 0.05, points: 13 }, { geo: domeRim, color: BRONZE });
    slab(dome, { w: 1.3, d: 2.75, h: 0.36, seed: 12, pos: [-0.6, 2.2, -0.12], rot: [0, -0.03, 0.3], bone: BODY, part: part.back, rock: ROCK, moss: 0.85, mossColor: MOSS, bendX: 0.16, bendZ: 0.05, points: 13 }, { geo: domeRim, color: BRONZE });
    // 壊れた後に残る根元
    for (let j = 0; j < 12; j++) {
      const a = (j / 12) * Math.PI * 2 + 0.2;
      const x = Math.cos(a) * 0.78, z = -0.12 + Math.sin(a) * 1.05;
      const top = spineAt(z);
      const y = top.cy + top.top * Math.sqrt(Math.max(0.05, 1 - (x / top.rx) * (x / top.rx))) + 0.03;
      slab(core, { w: 0.42, d: 0.5, h: 0.26, seed: 60 + j, pos: [x, y, z], rot: [Math.sin(a) * 0.25, a, -x * 0.5], bone: BODY, part: part.back, rock: ROCK_DARK, points: 6 });
    }
    // 頭頂の岩（壊れる）
    slab(cap, { w: 0.58, d: 1.0, h: 0.2, seed: 21, pos: [0.27, 2.02, 2.12], rot: [0.22, 0.05, -0.16], bone: HEAD, part: part.head, rock: ROCK, moss: 0.2, mossColor: MOSS, bendX: 0.3, points: 9 }, { geo: cap, color: BRONZE });
    slab(cap, { w: 0.56, d: 0.95, h: 0.2, seed: 22, pos: [-0.27, 2.02, 2.1], rot: [0.22, -0.05, 0.16], bone: HEAD, part: part.head, rock: ROCK, moss: 0.5, mossColor: MOSS, bendX: 0.3, points: 9 }, { geo: cap, color: BRONZE });
    // 肩と腰: 左は大きな一枚、右は中 1 枚 + 小 1 枚（設定図の左右差）
    slab(rock, { w: 1.4, d: 1.6, h: 0.3, seed: 31, pos: [1.1, 1.74, 0.95], rot: [0.05, 0.15, -0.8], bone: CHEST, part: part.body, rock: ROCK, moss: 0.8, mossColor: MOSS, bendX: 0.12 }, rim);
    slab(rock, { w: 0.98, d: 1.05, h: 0.27, seed: 32, pos: [-1.03, 1.82, 1.05], rot: [0.05, -0.1, 0.74], bone: CHEST, part: part.body, rock: ROCK, moss: 0.2, mossColor: MOSS, bendX: 0.12 }, rim);
    slab(rock, { w: 0.62, d: 0.66, h: 0.2, seed: 33, pos: [-1.22, 1.34, 1.3], rot: [0, -0.2, 1.05], bone: CHEST, part: part.body, rock: ROCK, points: 8 }, rim);
    slab(rock, { w: 1.1, d: 1.2, h: 0.27, seed: 34, pos: [1.03, 1.58, -1.1], rot: [-0.1, -0.1, -0.84], bone: PELVIS, part: part.body, rock: ROCK, moss: 0.3, mossColor: MOSS, bendX: 0.12 }, rim);
    slab(rock, { w: 0.78, d: 0.86, h: 0.23, seed: 35, pos: [-1.03, 1.52, -1.16], rot: [-0.1, 0.1, 0.84], bone: PELVIS, part: part.body, rock: ROCK, moss: 0.75, mossColor: MOSS, bendX: 0.12 }, rim);
    // 前脚の外側の甲。左が大きい。
    slab(rock, { w: 0.74, d: 0.72, h: 0.16, seed: 36, pos: [1.6, 0.66, 1.22], rot: [0, 0, -Math.PI / 2 + 0.06], bone: LEG + 1, part: part.foreleg, rock: ROCK, moss: 0.4, mossColor: MOSS, bendX: 0.45, points: 8 }, rim);
    slab(rock, { w: 0.56, d: 0.58, h: 0.14, seed: 37, pos: [-1.58, 0.64, 1.22], rot: [0, 0, Math.PI / 2 - 0.06], bone: LEG + 4, part: part.foreleg, rock: ROCK, bendX: 0.45, points: 7 }, rim);
    // 尾の付け根の小さな岩
    slab(rock, { w: 0.5, d: 0.5, h: 0.14, seed: 38, pos: [0, 1.53, -1.72], rot: [-0.18, 0.3, 0], bone: TAIL, part: part.tail, rock: ROCK, points: 7, bendX: 0.5 });
    slab(rock, { w: 0.38, d: 0.42, h: 0.12, seed: 39, pos: [0, 1.36, -2.1], rot: [-0.18, -0.2, 0], bone: TAIL + 1, part: part.tail, rock: ROCK, points: 6, bendX: 0.6 });
    // 尾の先の晶の塊
    const tip = new Vector3(...TAIL_TIP);
    const tailCrystals: [number, number, number, number, number][] = [[0, 0.1, -1, 0.5, 0.24], [0.6, 0.4, -0.7, 0.4, 0.21], [-0.6, 0.35, -0.75, 0.4, 0.21], [0.1, 0.9, -0.4, 0.36, 0.2], [-0.3, -0.6, -0.7, 0.34, 0.19], [0.35, -0.5, -0.7, 0.32, 0.18], [0, 0.7, 0.3, 0.3, 0.19], [0.6, 0, 0.2, 0.28, 0.17], [-0.6, 0, 0.2, 0.28, 0.17]];
    tailCrystals.forEach(([x, y, z, len, rad], j) => crystal(glow, tip.clone().add(new Vector3(x * 0.08, y * 0.08, 0.06)), new Vector3(x, y, z), len, rad, BRONZE, TAIL + 4, part.tail, j + 1));

    // ---- 素材 ----
    const hideTex = makeHideTextures(), rockTex = makeRockTextures();
    const hideMat = new MeshStandardMaterial({ vertexColors: true, map: hideTex.map, normalMap: hideTex.normal, roughness: 0.84, metalness: 0 });
    hideMat.normalScale.set(0.85, 0.85);
    const rockMat = new MeshStandardMaterial({ vertexColors: true, map: rockTex.map, normalMap: rockTex.normal, roughness: 0.95, metalness: 0 });
    rockMat.normalScale.set(0.9, 0.9);
    // 命中した部位だけを一瞬光らせる（部位番号を頂点に持たせてある）
    for (const mat of [hideMat, rockMat]) {
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uFlash = this.flashUniform;
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nattribute float aPart;\nuniform float uFlash[8];\nvarying float vFlash;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFlash = uFlash[int(aPart + 0.5)];');
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying float vFlash;')
          .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(0.9, 0.7, 0.4) * vFlash;');
      };
      mat.customProgramCacheKey = () => 'galdros-part-flash';
    }
    // 晶脈・目: 頂点の色で光る。怒りで強くする。
    this.glowMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.15, emissive: 0xffffff, emissiveIntensity: 0.3 });
    this.glowMat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= vColor.rgb;');
    };
    this.glowMat.customProgramCacheKey = () => 'galdros-glow';

    const skin = (g: Geo, mat: MeshStandardMaterial): SkinnedMesh => {
      const mesh = new SkinnedMesh(g.build(), mat);
      mesh.bind(skeleton, new Matrix4());
      mesh.castShadow = true;
      // 骨で大きく動くので、元の形の大きさでの視界判定は使わない
      mesh.frustumCulled = false;
      this.root.add(mesh);
      return mesh;
    };
    skin(hide, hideMat);
    skin(rock, rockMat);
    this.capMesh = skin(cap, rockMat);
    this.domeMesh = skin(dome, rockMat);
    this.domeRimMesh = skin(domeRim, this.glowMat);
    this.coreMesh = skin(core, rockMat);
    skin(glow, this.glowMat);

    // ---- 切り落とした尾の先（最初は隠す） ----
    const dropGeo = new Geo(), dropGlow = new Geo();
    const piece: Ring[] = [];
    const baseY = spineAt(cutZ).cy;
    for (let z = cutZ; z > TAIL_END - 0.001; z -= 0.085) {
      const s = spineAt(Math.max(TAIL_END, z));
      piece.push({ c: new Vector3(0, s.cy - baseY, z - cutZ), right: X, up: Y, rx: s.rx, top: s.top, bottom: s.bottom, b0: 0, b1: 0, w1: 0, part: 0 });
    }
    loft(dropGeo, piece, { seg: 16, exponent: 2.25, noise: 0.02, uRepeat: 2, capStart: FLESH, capEnd: DARK, color: (p, n) => hideColor(new Vector3(p.x, p.y + baseY, p.z + cutZ), n) });
    const dtip = new Vector3(TAIL_TIP[0], TAIL_TIP[1] - baseY, TAIL_TIP[2] - cutZ);
    tailCrystals.forEach(([x, y, z, len, rad], j) => crystal(dropGlow, dtip.clone().add(new Vector3(x * 0.08, y * 0.08, 0.06)), new Vector3(x, y, z), len, rad, BRONZE, 0, 0, j + 1));
    const dropHide = new MeshStandardMaterial({ vertexColors: true, map: hideTex.map, normalMap: hideTex.normal, roughness: 0.84 });
    const dropGlowMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.15, emissive: 0x3a2a12 });
    const drop = new Group();
    for (const [g, mat] of [[dropGeo, dropHide], [dropGlow, dropGlowMat]] as const) {
      const geo = g.build();
      geo.deleteAttribute('skinIndex');
      geo.deleteAttribute('skinWeight');
      const mesh = new Mesh(geo, mat);
      mesh.castShadow = true;
      drop.add(mesh);
    }
    drop.position.y = 0.3;
    drop.rotation.z = 0.5;
    const dropRoot = new Group();
    dropRoot.add(drop);
    dropRoot.visible = false;
    this.extras.push(dropRoot);
  }

  hitFlash(partIndex: number): void {
    if (partIndex >= 0 && partIndex < 8) this.flashUniform.value[partIndex] = 1;
  }

  /** 尾を切った時に、落ちた位置へ尾先を置く。 */
  placeSevered(x: number, y: number, z: number, yaw: number): void {
    const d = this.extras[0]!;
    d.position.set(x, y, z);
    d.rotation.y = yaw;
    d.visible = true;
  }

  update(m: MonsterState, c: MonsterRigCtx): void {
    const B = this.bones;
    const dt = Math.min(0.05, Math.max(0, c.dt));
    const part = (id: string): MonsterState['parts'][number] | undefined => m.parts[this.index[id] ?? -1];
    const severed = !!part('tail')?.severed;
    this.capMesh.visible = !part('head')?.broken;
    this.domeMesh.visible = this.domeRimMesh.visible = !part('back')?.broken;
    this.coreMesh.visible = !!part('back')?.broken;
    B[TAIL + CUT]!.scale.setScalar(severed ? 0.0001 : 1);
    const flash = this.flashUniform.value;
    for (let i = 0; i < flash.length; i++) flash[i] = Math.max(0, flash[i]! - dt * 5);

    // 怒り: 晶脈と目が赤く脈打つ。瞬き。
    const rage = m.enraged && !m.dead ? 0.6 + 0.4 * Math.sin(c.time * 7) : 0;
    this.blink = this.blink > 0 ? this.blink - dt : Math.sin(c.time * 0.37) > 0.995 ? 0.12 : 0;
    this.glowMat.emissive.setRGB(1 + rage * 2.2, 1 - rage * 0.45, 1 - rage * 0.75);
    this.glowMat.emissiveIntensity = m.dead ? 0.08 : 0.3 + rage * 0.55;

    // ---- 体全体の速さと向きの変化（見た目用） ----
    const pos = this.root.position;
    const yaw = this.root.rotation.y;
    if (!this.started) {
      this.lastPos.copy(pos);
      this.lastYaw = yaw;
    }
    if (dt > 1e-4) {
      const k = 1 - Math.exp(-dt * 14);
      this.v1.subVectors(pos, this.lastPos).multiplyScalar(1 / dt);
      if (this.v1.length() > 40) this.v1.set(0, 0, 0); // 位置が飛んだ時
      this.vel.lerp(this.v1, k);
      let dy = yaw - this.lastYaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.yawVel += (dy / dt - this.yawVel) * k;
      this.lastPos.copy(pos);
      this.lastYaw = yaw;
    }
    const speed = Math.hypot(this.vel.x, this.vel.z);

    // ---- 姿勢の量 ----
    let pitch = 0, roll = 0, twist = 0, lift = 0, shiftX = 0, shiftZ = 0, jitter = 0;
    let neckPitch = 0, headPitch = 0, jaw = 0.02, tailYaw = 0, tailPitch = 0, tailDrive = 0;
    let slamLeg = -1, pawLeg = -1, pawT = 0, limp = 0;
    const slamTarget = this.v5;
    const idle = Math.sin(c.time * 1.5);
    if (!m.aware) {
      // 気付いていない: 頭を下げて地面を嗅ぐ
      neckPitch = 0.3 + 0.05 * Math.sin(c.time * 0.6);
      headPitch = 0.22 + 0.06 * Math.sin(c.time * 0.83);
    } else {
      neckPitch = 0.03 * idle;
      headPitch = 0.02 * Math.sin(c.time * 0.9);
    }
    lift = 0.012 * idle;

    const run = m.action;
    if (run && !m.dead) {
      const t = renderTick(run, c.alpha);
      const clip = run.def.clip;
      const track = run.def.weaponTrack ? c.content.tracks.get(run.def.weaponTrack) : undefined;
      if (clip.startsWith('galdros_slam') && track) {
        slamLeg = clip.includes('_l_') ? 0 : 1;
        const s = sampleTrack(track, t);
        // 振り上げは曲げたまま、振り下ろしで伸ばす。打ち付ける時は足を地面まで下ろす（体を沈めて届かせる）。
        const strike = smoothstep((t - 48) / 5);
        const reach = 1.3 + 0.45 * strike;
        const down = sstep(-0.2, -0.55, s.dir.y) * strike;
        const ty = s.grip.y + s.dir.y * reach;
        slamTarget.set(s.grip.x + s.dir.x * reach, Math.max(ANKLE_H, ty + (ANKLE_H - ty) * down), s.grip.z + s.dir.z * reach);
        const side = slamLeg === 0 ? 1 : -1;
        const wind = smoothstep(t / 40) * (1 - strike), after = strike * (1 - smoothstep((t - 58) / 56));
        pitch = -0.12 * wind + 0.16 * after;
        roll = (-0.07 * wind + 0.06 * after) * side;
        lift = 0.05 * wind - 0.36 * after;
        shiftZ = -0.1 * wind + 0.2 * after;
        neckPitch = -0.2 * wind + 0.2 * after;
        headPitch = -0.1 * wind + 0.1 * after;
        jaw = 0.12 * wind + 0.3 * after;
        twist = (0.1 * wind - 0.06 * after) * side;
      } else if (clip === 'galdros_charge_01') {
        const wind = smoothstep(t / 30) * (1 - smoothstep((t - 140) / 40));
        neckPitch = 0.3 * wind;
        headPitch = 0.2 * wind;
        pitch = 0.07 * wind;
        lift = -0.08 * wind;
        shiftZ = t < 60 ? -0.22 * smoothstep(t / 45) : 0;
        if (t > 10 && t < 52) {
          pawLeg = 1; // 右前脚で地面を掻く
          pawT = t;
        }
        jaw = t > 60 && t < 132 ? 0.18 : 0.04;
      } else if (clip === 'galdros_tail_sweep_01' && track) {
        const s = sampleTrack(track, t);
        tailYaw = Math.atan2(s.dir.x, -s.dir.z);
        tailPitch = Math.asin(Math.max(-1, Math.min(1, s.dir.y)));
        tailDrive = 1;
        twist = -tailYaw * 0.12;
        roll = -tailYaw * 0.03;
        neckPitch = 0.08;
        jaw = 0.1;
      } else if (clip === 'galdros_rockfall_01') {
        const k = smoothstep(t / 20) * (1 - smoothstep((t - 55) / 30));
        jitter = 0.04 * k;
        pitch = 0.08 * k;
        lift = -0.2 * k;
        neckPitch = 0.26 * k;
        headPitch = 0.12 * k;
      } else if (clip === 'galdros_roar_01') {
        const k = smoothstep(t / 12) * (1 - smoothstep((t - 58) / 20));
        neckPitch = -0.36 * k;
        headPitch = -0.3 * k;
        jaw = 0.62 * k + 0.05 * k * Math.sin(c.time * 50);
        pitch = -0.08 * k;
        lift = 0.06 * k;
        jitter = 0.02 * k;
      }
    }

    if (m.dead) {
      // ひざが折れて沈み、横倒しになる
      const e1 = smoothstep(m.deadTicks / 30), e2 = smoothstep((m.deadTicks - 22) / 50);
      roll = 1.3 * e2;
      lift = -0.5 * e1 * (1 - e2) + 0.1 * e2;
      shiftX = -0.45 * e2;
      neckPitch = 0.35 * e1;
      headPitch = 0.25 * e1;
      jaw = 0.3 * e1;
      limp = e2;
      tailPitch = -0.1;
    } else if (m.staggerTicks > 0 && m.staggerTotal > 0) {
      const u = 1 - m.staggerTicks / m.staggerTotal;
      if (m.staggerKind === 'topple') {
        const k = smoothstep(u / 0.12) * (1 - smoothstep((u - 0.82) / 0.18));
        roll = 1.12 * k;
        lift = 0.12 * k;
        shiftX = -0.4 * k;
        limp = k;
        neckPitch = 0.2 * k + 0.1 * k * Math.sin(c.time * 6);
        jaw = 0.35 * k;
      } else {
        const k = 1 - smoothstep(u);
        pitch = -0.14 * k;
        neckPitch = -0.26 * k;
        headPitch = -0.14 * k;
        shiftZ = -0.18 * k;
        jaw = 0.4 * k;
        jitter = 0.03 * k;
      }
    }

    // 歩きに合わせた体の揺れ（足の上げ下げと前後から求める）
    let stepLift = 0, stepRoll = 0, chestYaw = 0, pelvisYaw = 0;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    if (this.started && limp < 0.5) {
      const fwdOf = (l: Leg): number => {
        const hx = pos.x + l.home.x * cy + l.home.z * sy, hz = pos.z - l.home.x * sy + l.home.z * cy;
        return (l.cur.x - hx) * sy + (l.cur.z - hz) * cy;
      };
      for (const l of this.legs) {
        const up = l.t < 1 ? Math.sin(Math.PI * l.t) : 0;
        stepLift += up;
        stepRoll += up * l.side;
      }
      chestYaw = -0.11 * (fwdOf(this.legs[0]!) - fwdOf(this.legs[1]!));
      pelvisYaw = -0.11 * (fwdOf(this.legs[2]!) - fwdOf(this.legs[3]!));
      chestYaw = Math.max(-0.14, Math.min(0.14, chestYaw));
      pelvisYaw = Math.max(-0.14, Math.min(0.14, pelvisYaw));
    }
    lift += 0.022 * stepLift;
    roll += 0.022 * stepRoll;
    const runAmt = sstep(4.2, 6.5, speed);
    lift += 0.06 * runAmt * Math.sin(this.runPhase * 2 + 0.6);
    pitch += 0.045 * runAmt * Math.sin(this.runPhase + 1.2);

    // 向きを変える時、頭が先に動き、尾が遅れて付いてくる
    const lookTarget = Math.max(-0.5, Math.min(0.5, this.yawVel * 0.28));
    this.lookYaw += (lookTarget - this.lookYaw) * (1 - Math.exp(-dt * 6));
    const lagTarget = Math.max(-0.75, Math.min(0.75, this.yawVel * 0.32));
    this.tailLag += (lagTarget - this.tailLag) * (1 - Math.exp(-dt * 4));

    // ---- 体の軸の骨 ----
    const body = B[BODY]!;
    body.position.set(shiftX + (jitter ? Math.sin(c.time * 61) * jitter : 0), BODY_Y + lift + (jitter ? Math.sin(c.time * 47) * jitter * 0.6 : 0), shiftZ);
    body.rotation.set(pitch, 0, roll);
    B[PELVIS]!.rotation.set(-0.3 * pitch, -twist * 0.5 + pelvisYaw, 0);
    B[CHEST]!.rotation.set(0.012 * Math.sin(c.time * 1.5 + 1), twist * 0.5 + chestYaw, 0);
    B[NECK]!.rotation.set(neckPitch, this.lookYaw * 0.5 - chestYaw * 0.6, 0);
    B[HEAD]!.rotation.set(headPitch, this.lookYaw * 0.5, -this.lookYaw * 0.15);
    B[JAW]!.rotation.x = jaw;
    // 尾: 付け根ほど大きく曲げる（尾払いの判定はまっすぐな 1 本なので、見た目もほぼまっすぐに振る）
    const pelY = B[PELVIS]!.rotation.y;
    const REST_PITCH = 0.173;
    for (let i = 0; i < TAIL_Z.length; i++) {
      const bone = B[TAIL + i]!;
      const sway = (1 - tailDrive) * (0.05 + 0.02 * i) * Math.sin(c.time * 1.3 - i * 0.7) * (m.dead ? 0 : 1);
      const lag = -(1 - tailDrive) * this.tailLag * [0.3, 0.28, 0.24, 0.2, 0.16][i]!;
      const drive = tailDrive * -tailYaw * [0.82, 0.12, 0.06, 0, 0][i]!;
      const droop = m.dead ? -0.1 : (1 - tailDrive) * 0.02 * Math.sin(c.time * 0.9 - i * 0.5);
      // 切断面の関節は曲げない（曲げると、重ねてある断面の輪がずれて見える）
      if (i === CUT) bone.rotation.set(0, 0, 0);
      else bone.rotation.set((i === 0 ? tailDrive * (tailPitch + REST_PITCH) + (m.dead ? tailPitch : 0) : 0) + droop, sway + lag + drive - (i === 0 ? pelY * tailDrive : 0), 0);
    }

    // ---- 脚: 足首の置き場所を決めてから、ひじ・ひざを解く ----
    this.root.updateMatrixWorld(true);
    const rootQ = this.root.quaternion;
    const bodyQ = body.getWorldQuaternion(this.q5);
    const ground = pos.y;
    // 先読みは 0.3m まで（突進の速さでそのまま掛けると足が体の前へ飛び出す）
    const leadK = speed > 1e-3 ? Math.min(0.1, 0.3 / speed) : 0;
    const leadX = this.vel.x * leadK, leadZ = this.vel.z * leadK;
    // 走り（突進）: 足を地面に置いて待つ歩き方では追い付かないので、進んだ距離に合わせて脚を回す
    const gallop = sstep(4.2, 6.5, speed);
    this.runPhase += (speed / 0.5) * dt;
    const airborne = this.legs.map((l) => l.t < 0.55);
    this.legs.forEach((l, i) => {
      const hipW = l.upper.getWorldPosition(this.v1);
      const parentQ = l.upper.parent!.getWorldQuaternion(this.q1);
      // 自然に立った時の足の位置（少し先読みする）
      const home = this.v2.set(pos.x + l.home.x * cy + l.home.z * sy + leadX, ground, pos.z - l.home.x * sy + l.home.z * cy + leadZ);
      const target = this.v3;
      let footPitch = 0;
      let follow = 26;
      let loose = false;
      if (l.fresh || !this.started) {
        l.plant.copy(home);
        l.t = 1;
      }
      if (limp > 0.5) {
        // 倒れている: 脚は体に付いて投げ出される
        const wob = Math.sin(c.time * 8 + i * 1.7) * 0.22 * (m.dead ? 0 : 1);
        target.copy(l.restDown).applyQuaternion(bodyQ).multiplyScalar((l.l1 + l.l2) * (0.74 + 0.08 * Math.sin(c.time * 5.3 + i * 2.1) * (m.dead ? 0 : 1))).add(hipW);
        target.addScaledVector(this.v4.set(0, 0, 1).applyQuaternion(bodyQ), wob + (l.front ? 0.18 : -0.18));
        loose = true;
        follow = 12;
        l.t = 1;
      } else if (i === slamLeg) {
        target.copy(slamTarget).applyMatrix4(this.root.matrixWorld);
        follow = 70;
        footPitch = -0.3;
        l.t = 1;
        l.plant.set(target.x, ground, target.z);
        this.slamHeld = i;
      } else if (i === pawLeg) {
        const s = Math.sin(pawT * 0.42);
        target.copy(home).addScaledVector(this.v4.set(sy, 0, cy), 0.34 * s);
        target.y = ground + ANKLE_H + 0.16 * Math.max(0, Math.cos(pawT * 0.42));
        footPitch = 0.3 * s;
        l.t = 1;
        l.plant.set(target.x, ground, target.z);
      } else {
        if (this.wasLimp) l.plant.copy(home);
        const err = Math.hypot(l.plant.x - home.x, l.plant.z - home.z);
        if (l.t >= 1) {
          const stretched = hipW.distanceTo(this.v4.set(l.plant.x, ground + ANKLE_H, l.plant.z)) > (l.l1 + l.l2) * 0.985;
          // 対角の 2 本が組になって交互に出る。相手の組が浮いている間は待つ。
          const mate = 3 - i;
          const othersUp = airborne.some((up, j) => up && j !== i && j !== mate);
          const threshold = (l.front ? 0.16 : 0.2) + (speed < 0.3 ? 0.1 : 0);
          if (err > 2.2) l.plant.copy(home);
          else if (stretched || (err > threshold && !othersUp)) {
            l.from.copy(l.plant);
            l.dur = Math.max(0.11, 0.3 - speed * 0.04);
            l.t = 0;
            airborne[i] = true;
          }
        }
        if (l.t < 1) {
          l.t = Math.min(1, l.t + dt / l.dur);
          const e = l.t * l.t * (3 - 2 * l.t);
          // 着地点は、着く頃の体の位置を見越して先へ置く
          const ahead = l.dur * (1 - l.t) + l.dur * 0.45;
          target.set(l.from.x + (home.x + this.vel.x * ahead - l.from.x) * e, ground, l.from.z + (home.z + this.vel.z * ahead - l.from.z) * e);
          const up = Math.sin(Math.PI * l.t);
          footPitch = 0.45 * Math.sin(Math.PI * 2 * l.t);
          if (l.t >= 1) l.plant.copy(target);
          else l.plant.set(target.x, ground, target.z);
          target.y = ground + ANKLE_H + up * Math.min(0.34, 0.17 + speed * 0.012);
        } else {
          target.set(l.plant.x, ground + ANKLE_H, l.plant.z);
        }
        if (gallop > 0) {
          // 前の 2 本・後ろの 2 本がほぼ揃って出る駆け足
          const ph = this.runPhase + [0, 0.7, 3.3, 4.0][i]!;
          const swing = Math.max(0, -Math.sin(ph));
          const rx = home.x - leadX + (this.vel.x / speed) * 0.52 * Math.cos(ph), rz = home.z - leadZ + (this.vel.z / speed) * 0.52 * Math.cos(ph);
          target.x += (rx - target.x) * gallop;
          target.z += (rz - target.z) * gallop;
          target.y += (ground + ANKLE_H + swing * 0.36 - target.y) * gallop;
          footPitch += (0.5 * Math.cos(ph) - footPitch) * gallop;
          if (gallop > 0.5) {
            l.t = 1;
            l.plant.set(rx, ground, rz);
            follow = 200;
          }
        }
      }
      if (l.fresh || !this.started) l.cur.copy(target);
      else l.cur.lerp(target, 1 - Math.exp(-dt * follow));
      l.fresh = false;

      // ひじ・ひざの向き。倒れている時は体の向きに従う。
      const pole = this.v4.copy(l.pole).applyQuaternion(loose ? bodyQ : rootQ);
      const ankle = this.v2;
      const joint = this.v3;
      solveJoint(hipW, l.cur, l.l1, l.l2, pole, ankle, joint);
      const dirU = this.v4.subVectors(joint, hipW).normalize();
      const qU = this.q2.setFromUnitVectors(_a.copy(l.restU).applyQuaternion(parentQ).normalize(), dirU).multiply(parentQ);
      l.upper.quaternion.copy(parentQ).invert().multiply(qU);
      const dirL = this.v4.subVectors(ankle, joint).normalize();
      const qL = this.q3.setFromUnitVectors(_a.copy(l.restL).applyQuaternion(qU).normalize(), dirL).multiply(qU);
      l.lower.quaternion.copy(qU).invert().multiply(qL);
      // 足の裏: 接地中は地面に平行。倒れている時は脚に付いていく。
      const qF = loose ? this.q4.copy(qL) : this.q4.copy(rootQ).multiply(_q.setFromAxisAngle(X, footPitch));
      l.foot.quaternion.copy(qL).invert().multiply(qF);
    });
    if (slamLeg < 0) this.slamHeld = -1;
    this.wasLimp = limp > 0.5;
    this.started = true;
  }
}
const _a = new Vector3();
const _q = new Quaternion();
