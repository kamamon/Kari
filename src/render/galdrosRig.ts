// 岩殻獣ガルドロスの仮モデル（3 代目）。
// 骨 53 本: 背骨 5 節・首 2 節・頭・あご・舌・まぶた・尾 8 節・脚 4 本（付け根 / ひじ / 足首 / 指）・岩板 15 枚。
// 骨の名前・番号・親は src/render/galdrosBones.ts の表（v0.30.0。#12 の設計のノード名）。ここでは番号を直接書かない。
// 皮の色は設定図から焼いた絵、背殻はなめらかな殻の面を分け合う薄い板（D-039、D-040）。
// 皮は骨で曲がる一続きの面、岩板は 1 枚ずつ骨を持ち、歩く・吠える・叩かれると揺れる。
// 体つきと岩板の分け方は、採用した設定図（art-source/monster/galdros/）に合わせてある。
//
// 動きはすべて描画側の計算で、戦闘の判定には影響しない:
//   - 脚は「足先を地面に置いてから関節を解く」。歩行・旋回・駆け足・足を引きずる動き。
//   - 首と頭は狩人を目で追う。呼吸・まばたき・身震い・鼻息などのしぐさ。
//   - 尾は付け根の動きに遅れて付いてくる。尾払いの間だけは、判定と同じ軌道データに従う。
//   - 前脚叩きの脚も、判定と同じ軌道データに従う。
//   - 叩かれた部位に応じて、体・頭・尾がのけぞる。部位破壊で岩板が砕けて飛ぶ。
// コードで作った形であり、正式モデル（GLB）が来るまでの仮素材であることは変わらない。
import { Bone, DataTexture, Euler, Float32BufferAttribute, Group, Matrix4, Mesh, MeshStandardMaterial, Quaternion, RepeatWrapping, SRGBColorSpace, Skeleton, SkinnedMesh, TextureLoader, Vector3, type BufferGeometry, type Texture } from 'three';
import { assetUrl } from '../core/assets';
import { smoothstep } from '../core/math';
import { renderTick } from '../game/action';
import type { MonsterState } from '../game/monster';
import { sampleTrack } from '../game/tracks';
import type { MonsterRig, MonsterRigCtx } from './monsterRig';
import { isWeak } from '../game/monster';
import { GALDROS_AO } from './galdrosAo';
import { GALDROS_BONES, GALDROS_EYES, GALDROS_LEGS, GALDROS_LEG_EXTRAS, GALDROS_LIDS, GALDROS_NEW_BONE_REST, GALDROS_PLATES, GALDROS_RIBS, GALDROS_SCAPULAE, GALDROS_TAIL, buildBoneTree, galdrosBone } from './galdrosBones';
import { GALDROS_ATLAS } from './galdrosAtlas';
import { Geo, blob, crystal, fbm, hash3, hex, horn, loft, makeHideTextures, makeRockTextures, mix, packCharts, plate, shade, slab, sstep, type AtlasChart, type RGB, type Ring, type SlabOpts } from './procGeo';

// ---- 骨の番号（名前 → 番号の表から引く。v0.30.0。番号の足し算はしない: 尾・脚・岩板・まぶたは、表の並びの配列で引く） ----
const ROOT = galdrosBone('root'), BODY = galdrosBone('body'), LUMBAR = galdrosBone('lumbar'), PELVIS = galdrosBone('pelvis'), THORAX = galdrosBone('thorax'), CHEST = galdrosBone('chest');
const RIBS_L = GALDROS_RIBS[0]!, RIBS_R = GALDROS_RIBS[1]!, NECK1 = galdrosBone('neck_01'), NECK2 = galdrosBone('neck_02'), HEAD = galdrosBone('head'), JAW = galdrosBone('jaw'), TONGUE = galdrosBone('tongue_01');
const TONGUE2 = galdrosBone('tongue_02');
const TAIL_N = GALDROS_TAIL.length, PLATE_N = GALDROS_PLATES.length;
const BODY_Y = 1.25;
/** 尾の関節の位置 (z)。CUT 番目（-2.5）が切断面。 */
const TAIL_Z = [-1.5, -1.68, -1.86, -2.04, -2.22, -2.42, -2.62, -2.82];
const TAIL_END = -3.0;
/** 鼻先の位置 (z)。体つきは設定図に合わせてある: 全長 約 5.8m（晶の塊の先 -3.2 〜 鼻先 2.64） */
const HEAD_END = 2.64;
const CUT = 4;
/** 尾の先の晶の塊の中心 */
const TAIL_TIP: readonly [number, number, number] = [0, 0.7, -2.72];
const ANKLE_H = 0.2;
const REST_TAIL_PITCH = 0.197;

// ---- 色（採用した基準ボード: 岩は灰〜灰褐色、苔の灰緑、縁取りは明るい青銅） ----
const DARK = hex(0x5b534a);
const SCAR = hex(0x3a322e), FLESH = hex(0x6e2f2a), MOUTH = hex(0x5a2422), TONGUE_C = hex(0x9a5450), TOOTH = hex(0xe0d6ba);
const HORN = hex(0xcfc2a0), HORN_DARK = hex(0x8a7d62), BLACK = hex(0x0c0a09);
const ROCK = hex(0xa69c8b), ROCK_DARK = hex(0x878071), MOSS = hex(0x8b8d6c), BRONZE = hex(0xc9a062);
// 皮の色は、設定図から焼いた絵（galdros_hide）が持つ。頂点の色は「絵に掛ける倍率」で、白が素通し。
// SKIN_AVG は絵の平均の色（絵が読み込まれるまでの代わりの色と、決まった色を出したい所の倍率の計算に使う）。
const WHITE: RGB = [1, 1, 1];
const SKIN_AVG = hex(0x7d6c5c);
/** この色に見せたい時に、頂点へ入れる倍率（絵の平均の色で割る） */
const over = (c: RGB): RGB => [Math.min(1, c[0] / SKIN_AVG[0]), Math.min(1, c[1] / SKIN_AVG[1]), Math.min(1, c[2] / SKIN_AVG[2])];
/** 絵を貼らない皮（まぶた・切り落とした尾の切り口のまわりなど）の色 */
const SKIN_PLAIN = shade(SKIN_AVG, 1.05);
const HIDE_TEX = 'assets/textures/galdros/galdros_hide_v1.webp', ROCK_TEX = 'assets/textures/galdros/galdros_rock_v1.webp';
// 目: 琥珀がかった茶色の虹彩に、丸く黒い瞳（設定図の目）
const IRIS = hex(0xb07a30), IRIS_RIM = hex(0x4a2f14), GLINT = hex(0xfff4dc);

type Profile = readonly (readonly [number, number, number, number, number])[];
// 体の軸に沿った断面: [z, 中心の高さ, 横の半径, 上の半径, 下の半径]（尾先 → 鼻先）
const SPINE: Profile = [
  [TAIL_END, 0.68, 0.1, 0.1, 0.1],
  [-2.88, 0.69, 0.18, 0.18, 0.16],
  [-2.62, 0.7, 0.21, 0.21, 0.19],
  [-2.42, 0.72, 0.23, 0.23, 0.21],
  [-2.22, 0.75, 0.25, 0.25, 0.23],
  [-2.0, 0.8, 0.29, 0.29, 0.26],
  [-1.76, 0.88, 0.38, 0.37, 0.32],
  [-1.5, 1.0, 0.56, 0.52, 0.43],
  [-1.2, 1.12, 0.86, 0.78, 0.58],
  [-0.8, 1.18, 1.05, 0.9, 0.64],
  [-0.3, 1.22, 1.14, 0.93, 0.68],
  [0.3, 1.22, 1.14, 0.93, 0.68],
  [0.8, 1.22, 1.08, 0.9, 0.66],
  [1.15, 1.25, 0.94, 0.8, 0.62],
  [1.45, 1.36, 0.76, 0.66, 0.5],
  [1.66, 1.5, 0.66, 0.54, 0.44],
  [1.82, 1.6, 0.6, 0.42, 0.36],
  [2.0, 1.65, 0.5, 0.33, 0.25],
  [2.2, 1.66, 0.41, 0.27, 0.24],
  [2.4, 1.61, 0.34, 0.2, 0.19],
  [2.54, 1.58, 0.27, 0.15, 0.14],
  [2.61, 1.57, 0.17, 0.1, 0.09],
  [HEAD_END, 1.57, 0.08, 0.05, 0.05],
];
// 下あごの断面
const JAW_PROFILE: Profile = [
  [1.78, 1.36, 0.42, 0.12, 0.15],
  [1.95, 1.34, 0.45, 0.13, 0.15],
  [2.15, 1.34, 0.38, 0.13, 0.14],
  [2.35, 1.36, 0.31, 0.11, 0.12],
  [2.5, 1.4, 0.22, 0.08, 0.08],
  [2.57, 1.42, 0.09, 0.04, 0.04],
];

/** 断面の表を z でなめらかに補間する。 */
function profileAt(table: Profile, z: number): { cy: number; rx: number; top: number; bottom: number } {
  const n = table.length;
  let i = 0;
  while (i < n - 2 && table[i + 1]![0] <= z) i++;
  const a = table[i]!, b = table[i + 1]!;
  const p = table[Math.max(0, i - 1)]!, q = table[Math.min(n - 1, i + 2)]!;
  const h = b[0] - a[0];
  const t = Math.min(1, Math.max(0, (z - a[0]) / h));
  const f = (k: 1 | 2 | 3 | 4): number => {
    const m0 = ((b[k] - p[k]) / (b[0] - p[0] || 1)) * h, m1 = ((q[k] - a[k]) / (q[0] - a[0] || 1)) * h;
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * a[k] + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * b[k] + (t3 - t2) * m1;
  };
  return { cy: f(1), rx: Math.max(0.02, f(2)), top: Math.max(0.02, f(3)), bottom: Math.max(0.02, f(4)) };
}
const spineAt = (z: number): { cy: number; rx: number; top: number; bottom: number } => profileAt(SPINE, z);
/** 胴の表面の高さ（x, z の真上）。岩や突起を背に置く時に使う。 */
function backY(x: number, z: number): number {
  const s = spineAt(z);
  return s.cy + s.top * Math.pow(Math.max(0.02, 1 - Math.pow(Math.min(0.98, Math.abs(x) / s.rx), 2.25)), 1 / 2.25);
}

/** 尾の各節の中ほど（その骨だけに付く位置）。隣の節との間は 2 本を混ぜる。 */
const TAIL_MID = TAIL_Z.map((z, i) => (z + (TAIL_Z[i + 1] ?? TAIL_END)) / 2);
/** 体の軸上の位置 z が、どの骨にどれだけ付くか。尾の切断面では骨をまたがない（切った時に平らな断面になる）。 */
function spineBones(z: number, afterCut: boolean): [number, number, number] {
  if (z >= 1.84) return [HEAD, HEAD, 0];
  if (z >= 1.66) return [NECK2, HEAD, sstep(1.66, 1.84, z)];
  if (z >= 1.45) return [NECK1, NECK2, sstep(1.45, 1.66, z)];
  if (z >= 1.2) return [CHEST, NECK1, sstep(1.2, 1.45, z)];
  if (z >= 0.6) return [THORAX, CHEST, sstep(0.6, 1.15, z)];
  if (z >= 0.3) return [THORAX, THORAX, 0];
  if (z >= -0.3) return [LUMBAR, THORAX, sstep(-0.3, 0.3, z)];
  if (z >= -0.6) return [LUMBAR, LUMBAR, 0];
  if (z >= -1.2) return [PELVIS, LUMBAR, sstep(-1.2, -0.6, z)];
  if (z >= -1.3) return [PELVIS, PELVIS, 0];
  if (z >= TAIL_MID[0]!) return [PELVIS, GALDROS_TAIL[0]!, sstep(-1.3, TAIL_MID[0]!, z)];
  let i = 0;
  while (i < TAIL_N - 1 && TAIL_MID[i + 1]! >= z) i++;
  // 尾の何節目か（0 始まり）で決めてから、骨の番号を引く
  let n0 = i, n1 = Math.min(TAIL_N - 1, i + 1);
  const w1 = i < TAIL_N - 1 ? sstep(TAIL_MID[i]!, TAIL_MID[i + 1]!, z) : 0;
  const cutZ = TAIL_Z[CUT]!;
  if (z < cutZ || (z === cutZ && afterCut)) {
    n0 = Math.max(n0, CUT);
    n1 = Math.max(n1, CUT);
  } else {
    n0 = Math.min(n0, CUT - 1);
    n1 = Math.min(n1, CUT - 1);
  }
  return [GALDROS_TAIL[n0]!, GALDROS_TAIL[n1]!, w1];
}

const gauss = (x: number, c: number, w: number): number => Math.exp(-((x - c) * (x - c)) / (2 * w * w));
/**
 * ひじ・ひざの補正形状（v0.36.0。#12 の M2「関節の内側の潰れの補正」）: 上と下の節を半分ずつ混ぜる関節の輪は、
 * 曲げると、曲げる向きの太さが cos(曲げ / 2) 倍に細る（骨の重みの線形な混ぜ方の性質）。補正形状はその分を、輪の中心から外へ押し戻す。
 * 形は基準の姿勢から BEND_REF だけ曲げた時の量で作り、強さは曲げの量から決める（ちょうど打ち消す強さ）。
 */
const BEND_REF = 1.2;
/** 気絶の首のふらつきが、ひと回りする tick（戦闘の判定の表 states.stun の長さと同じ。v0.36.0） */
export const STUN_LOOP = 164;
const bendFix = (delta: number): number => 1 / Math.cos(Math.min(Math.abs(delta), 2.6) / 2) - 1;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const wrapPi = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const X = new Vector3(1, 0, 0), Y = new Vector3(0, 1, 0), Z = new Vector3(0, 0, 1);
// 目: 設定図に合わせ、頭の岩のひさしの下・やや前向きに置く小さな目
const EYES = [new Vector3(0.375, 1.735, 2.2), new Vector3(-0.375, 1.735, 2.2)];
const EYE_OUT = EYES.map((e) => new Vector3(Math.sign(e.x) * 0.62, 0.12, 0.78).normalize());
/** まぶたを下ろす時の回転軸（目の中心を通る、顔の表面に沿った水平の向き） */
const LID_AXIS = EYE_OUT.map((o) => new Vector3().crossVectors(new Vector3(0, 1, 0), new Vector3(o.x, 0, o.z).normalize()).normalize());
const NOSTRILS = [new Vector3(0.12, 1.66, 2.55), new Vector3(-0.12, 1.66, 2.55)];

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
  toe: Bone;
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
  stance: boolean;
  /** v0.36.0: 接地している足の向き（ワールドの yaw）。体が向きを変えても、踏み直すまで足は向きを保つ（趾が地面を滑らない） */
  plantYaw: number;
  /** 踏み出した時の足の向き（踏み出しの間に、体の向きへ寄せる） */
  fromYaw: number;
  /** 着地で趾が開く量（1 で開き切り、減っていく） */
  splay: number;
  /** ねじれの骨・趾の骨（GALDROS_LEG_EXTRAS） */
  twist: Bone;
  digits: Bone[];
  spur: Bone | null;
  /** 下の節の基準の向き（ねじれの軸。骨の空間） */
  axisL: Vector3;
  /** 趾の並びの中での位置（-1 内 〜 1 外） */
  digitSide: number[];
}

/** 減衰するばね（のけぞり・揺れ戻し用）。 */
class Spring {
  x = 0;
  v = 0;
  constructor(private k = 110, private c = 13) {}
  step(dt: number): number {
    this.v += (-this.x * this.k - this.v * this.c) * dt;
    this.x += this.v * dt;
    return this.x;
  }
}

const _p = new Vector3();
const _d = new Vector3();
const _a = new Vector3();
const _q = new Quaternion();
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

/** Blender で焼いた陰（頂点ごとの明るさ 0〜255）を、頂点の色へ掛ける。形が変わって数が合わない時は掛けない。 */
function applyAo(geo: BufferGeometry, name: string): boolean {
  const e = GALDROS_AO[name];
  const col = geo.getAttribute('color');
  if (!e || !col || e.count !== col.count) return false;
  const bin = atob(e.data);
  for (let i = 0; i < col.count; i++) {
    // 皮の絵には設定図のしわの陰が入っているので、皮へ掛ける陰は弱める
    const floor = name === 'hide' ? 0.6 : 0.42;
    const k = floor + (1 - floor) * Math.pow(bin.charCodeAt(i) / 255, 0.9);
    col.setXYZ(i, col.getX(i) * k, col.getY(i) * k, col.getZ(i) * k);
  }
  return true;
}

/** 1 フレーム分の姿勢の量。層（しぐさ・技・怯み・歩き）ごとに足し込んでから骨へ書く。 */
interface Pose {
  x: number; y: number; z: number;
  pitch: number; yaw: number; roll: number;
  /** 背骨の左右の曲げ（前半 / 後半）と、上下の反り */
  bendF: number; bendR: number; archF: number; archR: number;
  neckPitch: number; neckYaw: number; headPitch: number; headYaw: number; headRoll: number;
  jaw: number; tongue: number; lid: number; breath: number;
  tailLift: number; tailWag: number;
  jitter: number; rattle: number; look: number; spread: number;
}
function resetPose(p: Pose): Pose {
  p.x = p.y = p.z = p.pitch = p.yaw = p.roll = p.bendF = p.bendR = p.archF = p.archR = 0;
  p.neckPitch = p.neckYaw = p.headPitch = p.headYaw = p.headRoll = 0;
  p.jaw = 0.02;
  p.tongue = p.lid = p.breath = p.tailLift = p.jitter = p.rattle = p.spread = 0;
  p.tailWag = 1;
  p.look = 1;
  return p;
}

type Fidget = '' | 'shake' | 'snort' | 'sniff' | 'glance' | 'growl' | 'scrape' | 'tailflick';
type PlateDef = {
  group: 'dome' | 'cap' | 'fixed'; parent: number; part: number; slab: Omit<SlabOpts, 'bone' | 'part' | 'rock' | 'mossColor'>;
  /** 背殻の板: 殻の面（z と、真上からの角度 alpha）の中の範囲 */
  shell?: { z0: number; z1: number; a0: number; a1: number };
};

/**
 * 背殻の面。胴の断面より少し外側の、なめらかな山形（設定図の、甲羅のような大きな背殻）。
 * z は体の前後、alpha は真上から横へ下りる角度（+ が左 = +X 側）。
 */
function shellPoint(z: number, alpha: number): Vector3 {
  const s = spineAt(z);
  const e = 2 / 2.25;
  const lift = 0.08 + 0.17 * sstep(-1.6, 0.1, z) * sstep(1.5, 0.7, z);
  const sn = Math.sin(alpha), cs = Math.max(0, Math.cos(alpha));
  return new Vector3(Math.sign(sn) * Math.pow(Math.abs(sn), e) * (s.rx + 0.13), s.cy + Math.pow(cs, e) * (s.top + lift), z);
}

export class GaldrosRig implements MonsterRig {
  readonly root = new Group();
  /** モンスターに付いて動かない物（切り落とした尾、砕けた岩）。シーンへ直接置く。 */
  readonly extras: Group[] = [];
  private bones: Bone[] = [];
  private legs: Leg[] = [];
  /** 皮（hide）のメッシュ。ひじ・ひざの補正形状の強さを毎回書く */
  private hideMesh!: SkinnedMesh;
  /** 部位の追従を測る皮の頂点の範囲（胴・あご・脚・足・付け根のふくらみ。歯・爪・目・まぶた・舌は入れない） */
  private skinPool: [number, number][] = [];
  private capMesh: SkinnedMesh;
  private domeMesh: SkinnedMesh;
  private domeRimMesh: SkinnedMesh;
  private coreMesh: SkinnedMesh;
  private glowMat: MeshStandardMaterial;
  private flashUniform = { value: new Float32Array(8) };
  /** 捕獲されてからの時間（眠る姿勢へ移る） */
  private capT = 0;
  /** 気絶で倒れている重み（v0.33.0。0〜1） */
  private stunW = 0;
  /** 焼いた陰が、いまの形（頂点の数）と合っていて、すべて掛けられたか */
  aoApplied = true;
  /** 皮の絵を貼る区画（書き出しと検査用） */
  atlasCharts: AtlasChart[] = [];
  /** 区画の並びが、焼いた絵と同じ（galdrosAtlas.ts の通り）か */
  atlasStored = false;
  /** 設定図から焼いた絵（皮・岩）の読み込みが終わったか / 失敗したか */
  artLoaded = false;
  artFailed = false;
  private index: Record<string, number> = {};
  private part: PartIds;
  // 砕けた岩
  private debrisGroup = new Group();
  private debrisGeo: BufferGeometry[] = [];
  private debrisMat: MeshStandardMaterial;
  private debris: { mesh: Mesh; vel: Vector3; spin: Vector3; life: number }[] = [];
  private wasBroken = { head: false, back: false };
  private capPlates: number[] = [];
  private domePlates: number[] = [];
  // 動きの状態
  private started = false;
  private lastPos = new Vector3();
  private lastYaw = 0;
  private vel = new Vector3();
  private yawVel = 0;
  private runPhase = 0;
  private breathPhase = 0;
  private lookYaw = 0;
  private lookPitch = 0;
  private blinkAt = 2;
  private lid = 0;
  private rattle = 0;
  private wasLimp = false;
  private tailHeading: number[] = new Array<number>(TAIL_N).fill(0);
  private tailDrive = 0;
  private lastTailYaw = 0;
  private kickX = new Spring();
  private kickZ = new Spring();
  private kickRoll = new Spring(90, 11);
  private kickPitch = new Spring(90, 11);
  private headKickYaw = new Spring(140, 14);
  private headKickPitch = new Spring(140, 14);
  private tailKick = new Spring(60, 7);
  private fid: { kind: Fidget; t0: number; dur: number; side: number } = { kind: '', t0: 0, dur: 1, side: 1 };
  private nextFid = 2.5;
  private fidCount = 0;
  private puffed = false;
  private seed = 1;
  private pose: Pose = resetPose({} as Pose);
  /** v0.36.0: 眼の向き（頭の空間の回転）と、肩甲の基準の位置（親の空間） */
  private eyeQ = [new Quaternion(), new Quaternion()];
  private scapRest: Vector3[] = [];
  /** 眼の中心（頭の骨の空間） */
  private eyeLocal: Vector3[] = [];
  private eyeTmp = [new Vector3(), new Vector3()];
  private eyeTmpQ = [new Quaternion(), new Quaternion()];
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
    const part: PartIds = (this.part = {
      head: this.index.head ?? 0,
      tail: this.index.tail ?? 0,
      back: this.index.back ?? 0,
      foreleg: this.index.foreleg ?? 0,
      hindleg: this.index.hindleg ?? 0,
      body: this.index.body ?? 0,
    });

    // ================= 骨 =================
    // 体の空間での基準の位置を、骨の番号ごとに決める。親は骨の表（galdrosBones.ts）だけが決める。
    const rest: Vector3[] = [];
    const def = (i: number, x: number, y: number, z: number): void => {
      rest[i] = new Vector3(x, y, z);
    };
    const parentOf = (i: number): number => {
      const p = GALDROS_BONES[i]!.parent;
      return p === null ? -1 : galdrosBone(p);
    };
    def(ROOT, 0, 0, 0);
    def(BODY, 0, BODY_Y, 0);
    def(LUMBAR, 0, BODY_Y, -0.35);
    def(PELVIS, 0, BODY_Y, -0.95);
    def(THORAX, 0, BODY_Y, 0.35);
    def(CHEST, 0, BODY_Y, 0.95);
    def(RIBS_L, 0, 1.2, 0.15);
    def(NECK1, 0, 1.34, 1.4);
    def(NECK2, 0, 1.5, 1.63);
    def(HEAD, 0, 1.6, 1.82);
    def(JAW, 0, 1.44, 1.84);
    def(TONGUE, 0, 1.44, 2.1);
    EYES.forEach((e, i) => def(GALDROS_LIDS[i]!, e.x, e.y, e.z));
    TAIL_Z.forEach((z, i) => def(GALDROS_TAIL[i]!, 0, spineAt(z).cy, z));
    // 脚: 前左・前右・後左・後右。左が +X。付け根の位置は判定の軌道データ（肩 y=1.5）に合わせる。
    const legSpecs: { hip: [number, number, number]; home: [number, number]; l1: number; l2: number; front: boolean; side: number }[] = [
      { hip: [1.0, 1.5, 1.05], home: [1.1, 1.18], l1: 0.76, l2: 0.7, front: true, side: 1 },
      { hip: [-1.0, 1.5, 1.05], home: [-1.1, 1.18], l1: 0.76, l2: 0.7, front: true, side: -1 },
      { hip: [0.95, 1.4, -1.05], home: [1.04, -0.98], l1: 0.72, l2: 0.66, front: false, side: 1 },
      { hip: [-0.95, 1.4, -1.05], home: [-1.04, -0.98], l1: 0.72, l2: 0.66, front: false, side: -1 },
    ];
    const legRest: { hip: Vector3; joint: Vector3; ankle: Vector3; pole: Vector3 }[] = [];
    legSpecs.forEach((s, i) => {
      const hip = new Vector3(...s.hip);
      const ankle = new Vector3(s.home[0], ANKLE_H, s.home[1]);
      // 前脚のひじは後ろ、後脚のひざは前へ曲がる（少し外向き）
      const pole = new Vector3(s.side * 0.25, 0, s.front ? -1 : 1).normalize();
      const joint = new Vector3();
      solveJoint(hip, ankle, s.l1, s.l2, pole, new Vector3(), joint);
      legRest.push({ hip, joint, ankle, pole });
      const L = GALDROS_LEGS[i]!;
      def(L.upper, hip.x, hip.y, hip.z);
      def(L.lower, joint.x, joint.y, joint.z);
      def(L.foot, ankle.x, ankle.y, ankle.z);
      def(L.toe, ankle.x, 0.07, ankle.z + 0.24);
    });
    // v0.36.0 で足した 26 本（#12 の M2）: 設計の表の位置
    for (const [name, at] of Object.entries(GALDROS_NEW_BONE_REST)) def(galdrosBone(name), at[0], at[1], at[2]);

    // 岩板: 1 枚ずつ骨を持つ（揺れる・砕ける）。背殻 6 枚、頭 2 枚、肩 3 枚、腰 2 枚、前脚の甲 2 枚。
    const plates: PlateDef[] = [];
    // 背殻: 前・中・後ろの 3 列 × 左右の 6 枚が、1 つのなめらかな殻の面を分け合う（設定図の、中央に合わせ目のある大きな甲）。
    // 中の列は脇まで下り、前後の列は肩・腰の板に場所をゆずる。
    const domeRow = (z0: number, z1: number, side: number, par: number, seed: number): void => {
      for (const sgn of [1, -1]) {
        const shell = { z0, z1, a0: sgn * 0.012, a1: sgn * side };
        const c = shellPoint((z0 + z1) / 2, (shell.a0 + shell.a1) / 2);
        plates.push({ group: 'dome', parent: par, part: part.back, shell, slab: { w: side * 1.25, d: z1 - z0, h: 0.2, seed: seed + (sgn > 0 ? 0 : 1), pos: [c.x, c.y, c.z], rot: [0, 0, 0], moss: sgn > 0 ? 0.35 : 0.7, points: 8 } });
      }
    };
    domeRow(0.35, 1.3, 0.62, THORAX, 11);
    domeRow(-0.55, 0.35, 1.3, BODY, 13);
    domeRow(-1.42, -0.55, 0.62, LUMBAR, 15);
    plates.push({ group: 'cap', parent: HEAD, part: part.head, slab: { w: 0.5, d: 0.92, h: 0.2, seed: 21, pos: [0.23, 2.0, 2.06], rot: [0.3, 0.05, -0.16], moss: 0.2, bendX: 0.3, points: 9 } });
    plates.push({ group: 'cap', parent: HEAD, part: part.head, slab: { w: 0.5, d: 0.9, h: 0.2, seed: 22, pos: [-0.23, 2.0, 2.05], rot: [0.3, -0.05, 0.16], moss: 0.5, bendX: 0.3, points: 9 } });
    // 肩と腰: 左は大きな一枚、右は中 1 枚 + 小 1 枚（設定図の左右差）
    plates.push({ group: 'fixed', parent: CHEST, part: part.body, slab: { w: 1.15, d: 1.2, h: 0.3, seed: 31, pos: [1.2, 1.62, 1.0], rot: [0.05, 0.15, -0.82], moss: 0.8, bendX: 0.12 } });
    plates.push({ group: 'fixed', parent: CHEST, part: part.body, slab: { w: 0.98, d: 1.05, h: 0.27, seed: 32, pos: [-1.15, 1.68, 1.08], rot: [0.05, -0.1, 0.76], moss: 0.2, bendX: 0.12 } });
    plates.push({ group: 'fixed', parent: CHEST, part: part.body, slab: { w: 0.62, d: 0.66, h: 0.2, seed: 33, pos: [-1.22, 1.32, 1.32], rot: [0, -0.2, 1.05], points: 8 } });
    plates.push({ group: 'fixed', parent: PELVIS, part: part.body, slab: { w: 0.95, d: 1.1, h: 0.27, seed: 34, pos: [1.1, 1.48, -1.14], rot: [-0.1, -0.1, -0.86], moss: 0.3, bendX: 0.12 } });
    plates.push({ group: 'fixed', parent: PELVIS, part: part.body, slab: { w: 0.78, d: 0.86, h: 0.23, seed: 35, pos: [-1.05, 1.5, -1.2], rot: [-0.1, 0.1, 0.86], moss: 0.75, bendX: 0.12 } });
    // 前脚の外側の甲。左が大きい。
    plates.push({ group: 'fixed', parent: GALDROS_LEGS[0]!.lower, part: part.foreleg, slab: { w: 0.74, d: 0.72, h: 0.16, seed: 36, pos: [1.6, 0.66, 1.22], rot: [0, 0, -Math.PI / 2 + 0.06], moss: 0.4, bendX: 0.45, points: 8 } });
    plates.push({ group: 'fixed', parent: GALDROS_LEGS[1]!.lower, part: part.foreleg, slab: { w: 0.56, d: 0.58, h: 0.14, seed: 37, pos: [-1.58, 0.64, 1.22], rot: [0, 0, Math.PI / 2 - 0.06], bendX: 0.45, points: 7 } });
    if (plates.length !== PLATE_N) throw new Error(`岩板が ${plates.length} 枚（骨の表は ${PLATE_N}）`);
    plates.forEach((pl, i) => {
      const b = GALDROS_PLATES[i]!;
      // 板を付ける骨は、骨の表の親と同じでなければならない（形の側と表が食い違うと、板が別の骨で動く）
      if (parentOf(b) !== pl.parent) throw new Error(`岩板 ${GALDROS_BONES[b]!.name} の親が骨の表と違う`);
      def(b, pl.slab.pos[0], pl.slab.pos[1], pl.slab.pos[2]);
      if (pl.group === 'cap') this.capPlates.push(b);
      if (pl.group === 'dome') this.domePlates.push(b);
    });

    // 骨を 2 段で組む（先に全部を作り、後で親へつなぐ。親が子より後ろの番号でもよい。#12 の M1）
    this.bones = buildBoneTree(GALDROS_BONES.map((b, i) => {
      const pos = rest[i];
      if (!pos) throw new Error(`骨 ${b.name} の基準の位置が無い`);
      return { name: b.name, parent: parentOf(i), pos };
    }));
    this.root.add(this.bones[ROOT]!);
    this.root.updateMatrixWorld(true);
    this.scapRest = GALDROS_SCAPULAE.map((b) => this.bones[b]!.position.clone());
    this.eyeLocal = EYES.map((e) => e.clone().sub(rest[HEAD]!));
    const skeleton = new Skeleton(this.bones);
    legSpecs.forEach((s, i) => {
      const r = legRest[i]!;
      const L = GALDROS_LEGS[i]!;
      this.legs.push({
        upper: this.bones[L.upper]!, lower: this.bones[L.lower]!, foot: this.bones[L.foot]!, toe: this.bones[L.toe]!,
        home: new Vector3(s.home[0], 0, s.home[1]), pole: r.pole.clone(),
        restU: new Vector3().subVectors(r.joint, r.hip).normalize(),
        restL: new Vector3().subVectors(r.ankle, r.joint).normalize(),
        restDown: new Vector3().subVectors(r.ankle, r.hip).normalize(),
        l1: s.l1, l2: s.l2, front: s.front, side: s.side,
        plant: new Vector3(), from: new Vector3(), t: 1, dur: 0.3, cur: new Vector3(), fresh: true, stance: true,
        plantYaw: 0, fromYaw: 0, splay: 0,
        twist: this.bones[GALDROS_LEG_EXTRAS[i]!.twist]!, digits: GALDROS_LEG_EXTRAS[i]!.digits.map((b) => this.bones[b]!),
        spur: GALDROS_LEG_EXTRAS[i]!.spur === null ? null : this.bones[GALDROS_LEG_EXTRAS[i]!.spur!]!,
        axisL: new Vector3().subVectors(r.ankle, r.joint).normalize(),
        digitSide: GALDROS_LEG_EXTRAS[i]!.digits.map((b) => {
          // 足首からの横の位置を、外向きを + にして -1〜1 へ
          const x = GALDROS_NEW_BONE_REST[GALDROS_BONES[b]!.name]![0];
          return clamp(((x - r.ankle.x) * s.side) / 0.36, -1, 1);
        }),
      });
    });

    // ================= 形 =================
    const hide = new Geo(), rock = new Geo(), cap = new Geo(), dome = new Geo(), domeRim = new Geo(), core = new Geo(), glow = new Geo();
    /** ひじ・ひざの補正形状（脚ごと。頂点の番号 → 基準の位置からのずれ） */
    const bendShapes: Map<number, Vector3>[] = [];

    // ---- 胴・首・頭（上あご）・尾: 尾先から鼻先まで 1 本の皮 ----
    const cutZ = TAIL_Z[CUT]!;
    const zs: number[] = [];
    for (let z = TAIL_END; z < HEAD_END + 0.01; z += z < -1.4 ? 0.08 : z < 1.3 ? 0.09 : 0.055) zs.push(Math.abs(z - cutZ) < 0.04 ? cutZ - 0.045 : z);
    type SRing = Ring & { z: number; flesh?: boolean; brk?: boolean };
    const rings: SRing[] = [];
    const ringAt = (z: number, afterCut: boolean, flesh = false, brk = false): void => {
      const s = spineAt(z);
      const [b0, b1, w1] = spineBones(z, afterCut);
      rings.push({ c: new Vector3(0, s.cy, z), right: X, up: Y, rx: s.rx, top: s.top, bottom: s.bottom, b0, b1, w1, z, flesh, brk, part: z > 1.6 ? part.head : z < -1.6 ? part.tail : part.body });
    };
    let cutDone = false;
    // 絵を貼る区画の切れ目（尾の付け根と首）。同じ位置に輪を 2 つ重ねる。
    const breaks = [-1.5, 1.5];
    for (const z of zs) {
      while (breaks.length > 0 && z > breaks[0]! + 0.02) {
        const zb = breaks.shift()!;
        ringAt(zb, true);
        ringAt(zb, true, false, true);
      }
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
      seg: 32, exponent: 2.25, noise: 0.028, noiseFreq: 1.9, uRepeat: 5, capStart: DARK, capEnd: HORN_DARK,
      // 絵を貼る区画: 尾先 / 尾の付け根側 / 胴 / 首と頭。切断面（flesh）には貼らない。
      atlas: { kinds: ['tailTip', 'tailBase', 'body', 'head'], t: (r) => (r as SRing).z, plain: (r) => !!(r as SRing).flesh, breakBefore: (r) => !!(r as SRing).brk, density: [1, 1, 0.8, 1.5] },
      // 呼吸でふくらむのは、岩板に覆われていない脇腹と腹
      third: { bone: RIBS_L, weight: (r, a) => 0.6 * sstep(-1.05, -0.5, (r as SRing).z) * sstep(1.15, 0.6, (r as SRing).z) * sstep(0.75, 0.1, Math.sin(a)) },
      // 胸郭は左右の骨に分ける（v0.36.0）: 腹の真ん中（|x| < 0.12）で 2 本を混ぜる。左右が同じに動けば、v0.35.0 までと同じ形
      skin: (_r, _a, p, _i, d) => {
        const k = d.findIndex(([b]) => b === RIBS_L);
        const side = sstep(-0.12, 0.12, p.x);
        if (k < 0 || side >= 1) return null;
        const w = d[k]![1];
        return [...d.filter((_, j) => j !== k), [RIBS_L, w * side], [RIBS_R, w * (1 - side)]];
      },
      bulge: (r, a) => {
        const z = (r as SRing).z;
        const side = Math.abs(Math.cos(a)), upness = Math.sin(a), dTop = Math.abs(a - Math.PI / 2);
        let b = 0;
        b += 0.11 * gauss(z, 1.0, 0.36) * side * sstep(-0.7, 0.3, upness); // 肩
        b += 0.09 * gauss(z, -1.0, 0.34) * side * sstep(-0.7, 0.3, upness); // 腰
        b += 0.035 * sstep(0.9, 1.0, upness) * sstep(-2.6, -1.2, z) * sstep(1.7, 1.2, z); // 背骨の稜線
        b += 0.06 * gauss(z, -0.1, 0.8) * sstep(-0.35, -1, upness); // 腹のたるみ
        b += 0.16 * gauss(z, 1.5, 0.22) * sstep(-0.55, -1, upness); // のどのたるみ
        b += 0.2 * gauss(z, 2.05, 0.1) * gauss(dTop, 0.78, 0.2); // 眉
        b += 0.07 * gauss(z, 1.9, 0.15) * side * gauss(upness, -0.15, 0.4); // 頬
        b -= 0.07 * gauss(z, 2.34, 0.08) * gauss(dTop, 1.05, 0.25); // 鼻づらのくぼみ
        b += 0.022 * Math.sin(z * 24) * gauss(z, 1.45, 0.3); // 首のしわ
        b += 0.014 * Math.sin(z * 21 + 1) * (gauss(z, -1.4, 0.3) + gauss(z, 0.55, 0.3)); // 肩・腰のしわ
        b += 0.012 * Math.sin(z * 26) * sstep(-1.7, -2.0, z); // 尾の節
        return b;
      },
      color: (p, n, r, a) => {
        const rr = r as SRing;
        if (rr.flesh) return FLESH;
        let c: RGB = WHITE;
        const dTop = Math.abs(a - Math.PI / 2);
        // 岩板の下に隠れている面（壊すと見える）: 傷んだ暗い地肌
        const under = Math.max(sstep(0.85, 0.5, dTop) * sstep(-1.25, -0.9, rr.z) * sstep(1.1, 0.8, rr.z), sstep(0.7, 0.4, dTop) * sstep(1.72, 1.85, rr.z) * sstep(2.42, 2.3, rr.z));
        c = mix(c, over(shade(SCAR, 0.9 + 0.5 * fbm(p.x * 6, p.y * 6, p.z * 6, 2))), under * 0.75);
        // 目のくぼみと鼻の穴
        for (const e of EYES) c = shade(c, 1 - 0.3 * sstep(0.17, 0.07, p.distanceTo(e)));
        for (const e of NOSTRILS) c = mix(c, BLACK, sstep(0.07, 0.03, p.distanceTo(e)));
        // 口の中（上あごの裏）
        if (rr.z > 1.86) c = mix(c, over(MOUTH), sstep(-0.75, -0.95, n.y) * sstep(1.86, 1.98, rr.z));
        return c;
      },
    });

    // ---- 下あご・舌・歯 ----
    const jawRings: Ring[] = JAW_PROFILE.map(([z, cy, rx, top, bottom]) => ({ c: new Vector3(0, cy, z), right: X, up: Y, rx, top, bottom, b0: JAW, b1: JAW, w1: 0, part: part.head }));
    const pool = (from: number): void => {
      this.skinPool.push([from, hide.count]);
    };
    pool(0);
    const jawBase = hide.count;
    loft(hide, jawRings, { seg: 16, exponent: 2.3, noise: 0.012, uRepeat: 2, capStart: MOUTH, capEnd: HORN_DARK, atlas: { kinds: ['jaw'], t: (r) => r.c.z }, color: (_p, n) => mix(WHITE, over(MOUTH), sstep(0.75, 0.95, n.y)) });
    pool(jawBase);
    const tongue: Ring[] = [];
    for (let i = 0; i <= 7; i++) {
      const t = i / 7;
      const z = 1.9 + 0.52 * t;
      const j = profileAt(JAW_PROFILE, z);
      const w = Math.max(0.03, 0.2 * Math.sin(Math.PI * (0.25 + 0.72 * t)));
      // 先の 3 つの輪は、舌の先の骨（tongue_02。v0.36.0）へ移る
      const tip = i >= 5;
      tongue.push({ c: new Vector3(0, j.cy + j.top + 0.015, z), right: X, up: Y, rx: w, top: 0.05, bottom: 0.03, b0: tip ? TONGUE : JAW, b1: tip ? TONGUE2 : TONGUE, w1: tip ? sstep(0.62, 0.95, t) : sstep(0.2, 0.7, t), part: part.head });
    }
    loft(hide, tongue, { seg: 10, uRepeat: 1, capStart: TONGUE_C, capEnd: TONGUE_C, color: (p) => shade(TONGUE_C, 0.85 + 0.3 * fbm(p.x * 14, p.y * 14, p.z * 14, 2)) });
    // 歯: 上あごは下向き、下あごは上向き。口を閉じている間は隠れ、開くと見える（設定図は口を閉じた姿で、歯は見えない）
    for (const s of [1, -1]) {
      for (let j = 0; j < 7; j++) {
        const z = 1.96 + j * 0.075;
        const up = spineAt(z), lo = profileAt(JAW_PROFILE, z);
        const big = j === 5 ? 1.7 : 1;
        horn(hide, new Vector3(s * up.rx * 0.6, up.cy - up.bottom * 0.8, z), new Vector3(s * 0.12, -1, 0.05), 0.085 * big, 0.03 * big, TOOTH, HEAD, part.head);
        horn(hide, new Vector3(s * lo.rx * 0.6, lo.cy + lo.top * 0.75, z + 0.05), new Vector3(s * 0.1, 1, -0.05), 0.075, 0.027, TOOTH, JAW, part.head);
      }
    }
    // くちばしと、下あごの先（設定図の頭には角やとげが無いので、付けない）
    // くちばしは短く、下へ曲がる（設定図は上あごの先が鉤になっている）
    horn(hide, new Vector3(0, 1.52, 2.55), new Vector3(0, -1, 0.45), 0.2, 0.13, HORN, HEAD, part.head, new Vector3(0, -0.1, -0.08));
    horn(hide, new Vector3(0, 1.41, 2.5), new Vector3(0, 0.5, 1), 0.1, 0.07, HORN, JAW, part.head);
    // 目: 暗い縁、琥珀がかった茶色の虹彩、丸い瞳、小さな光の点、上下のまぶた
    EYES.forEach((e, i) => {
      const out = EYE_OUT[i]!, axis = LID_AXIS[i]!;
      // 眼球（縁・虹彩・瞳）は眼の骨（v0.36.0）で、まぶたと別に動く。光の点は頭に付けたまま（瞳が光の下で動いて見える）
      const eye = GALDROS_EYES[i]!;
      blob(hide, e.clone().addScaledVector(out, -0.012), out, 0.13, 0.078, 0.066, () => IRIS_RIM, eye, part.head, 10, 5);
      blob(glow, e.clone().addScaledVector(out, 0.012), out, 0.11, 0.058, 0.052, () => IRIS, eye, part.head, 10, 5);
      blob(hide, e.clone().addScaledVector(out, 0.052), out, 0.036, 0.027, 0.027, () => BLACK, eye, part.head, 8, 4);
      blob(glow, e.clone().addScaledVector(out, 0.066).add(new Vector3(0, 0.02, 0)).addScaledVector(axis, 0.014), out, 0.012, 0.009, 0.009, () => GLINT, HEAD, part.head, 5, 3);
      const lidColor = (p: Vector3): RGB => shade(SKIN_PLAIN, 0.8 + 0.25 * fbm(p.x * 30, p.y * 30, p.z * 30, 2));
      // 上まぶた（骨で下りる）と、下まぶた（動かない）
      blob(hide, e.clone().add(new Vector3(0, 0.066, 0)).addScaledVector(out, 0.012), axis, 0.2, 0.07, 0.034, lidColor, GALDROS_LIDS[i]!, part.head, 8, 4);
      blob(hide, e.clone().add(new Vector3(0, -0.058, 0)).addScaledVector(out, 0.008), axis, 0.18, 0.062, 0.028, lidColor, HEAD, part.head, 8, 4);
    });

    // ---- 脚 ----
    legSpecs.forEach((s, i) => {
      const r = legRest[i]!;
      const L = GALDROS_LEGS[i]!;
      const E = GALDROS_LEG_EXTRAS[i]!;
      const pid = s.front ? part.foreleg : part.hindleg;
      const k = s.front ? 1 : 0.95;
      // 趾の骨（前脚 4 本・後脚 3 群）の x。足の先の皮は x で近い 2 本に分け、爪は近い 1 本に付ける（v0.36.0）
      const digitX = E.digits.map((b) => GALDROS_NEW_BONE_REST[GALDROS_BONES[b]!.name]![0]);
      const order = digitX.map((x, j) => [x, j] as const).sort((a, b) => a[0] - b[0]);
      const digitSkin = (x: number, w: number): [number, number][] => {
        if (x <= order[0]![0]) return [[E.digits[order[0]![1]]!, w]];
        for (let j = 0; j + 1 < order.length; j++) {
          const [x0, a] = order[j]!, [x1, b] = order[j + 1]!;
          if (x <= x1) {
            const f = sstep(x0, x1, x);
            return [[E.digits[a]!, w * (1 - f)], [E.digits[b]!, w * f]];
          }
        }
        return [[E.digits[order[order.length - 1]![1]]!, w]];
      };
      const nearestDigit = (x: number): number => E.digits[order.reduce((best, o) => (Math.abs(o[0] - x) < Math.abs(best[0] - x) ? o : best))[1]]!;
      // [付け根からの割合(0=付け根,1=関節,2=足首), 半径]
      const prof: [number, number][] = [[-0.12, 0.52], [0.12, 0.53], [0.4, 0.5], [0.75, 0.46], [1.0, 0.44], [1.25, 0.43], [1.6, 0.41], [1.85, 0.41], [2.0, 0.42]];
      const lr: Ring[] = prof.map(([u, rad]) => {
        const a = u <= 1 ? r.hip : r.joint, c = u <= 1 ? r.joint : r.ankle;
        const t = u <= 1 ? u : u - 1;
        const cpos = new Vector3().lerpVectors(a, c, t);
        const dir = new Vector3().subVectors(c, a).normalize();
        const right = new Vector3().crossVectors(dir, Z).normalize();
        const up = new Vector3().crossVectors(right, dir).normalize();
        // 関節の前後 0.3 の範囲で 2 本の骨を混ぜる
        let b0 = L.upper, b1 = L.upper, w1 = 0;
        if (u > 0.7 && u < 1.3) { b1 = L.lower; w1 = sstep(0.7, 1.3, u); }
        else if (u >= 1.3 && u < 1.8) { b0 = L.lower; b1 = L.lower; }
        else if (u >= 1.8) { b0 = L.lower; b1 = L.foot; w1 = sstep(1.8, 2.1, u) * 0.6; }
        // 上腕（もも）は前後に厚い
        const thick = u < 1 ? 1.14 : 1.04;
        return { c: cpos, right, up, rx: rad * k, top: rad * k * thick, bottom: rad * k * thick, b0, b1, w1, part: pid };
      });
      const legBase = hide.count;
      // 脚の皮と足（次の loft まで）は、部位の追従を測る皮に入れる
      loft(hide, lr, {
        seg: 14, exponent: 2.2, noise: 0.022, noiseFreq: 2.6, uRepeat: 2,
        // 下の節の先の半分は、ねじれの骨（v0.36.0）へ移る: 手首・足首のねじれが、ひじ・ひざから足首まで少しずつ配られる
        skin: (_r, _a, _p, idx) => {
          const u = prof[idx]![0];
          if (u < 1.3) return null;
          const wf = 0.6 * sstep(1.8, 2.1, u);
          const wt = sstep(1.3, 1.95, u) * (1 - wf);
          return [[L.lower, 1 - wt - wf], [E.twist, wt], [L.foot, wf]];
        },
        bulge: (_r, a, idx) => 0.05 * Math.sin(idx * 2.1 + i) + (idx === 4 ? 0.08 * Math.max(0, Math.sin(a) * (s.front ? -1 : 1)) : 0) + (idx === 6 ? -0.04 : 0),
        atlas: { kinds: [`leg${i}`], t: (_r, idx) => prof[idx]![0], meta: { front: s.front ? 1 : 0 } },
        color: () => WHITE,
      });
      // ひじ・ひざの輪（u = 1、上と下の節が半分ずつ）の補正形状: 曲げる面の中の、関節からのずれを 1 / cos(BEND_REF / 2) 倍へ戻す量
      {
        const ring = prof.findIndex(([u]) => u === 1);
        const axisH = new Vector3().crossVectors(new Vector3().subVectors(r.joint, r.hip), new Vector3().subVectors(r.ankle, r.joint)).normalize();
        const shape = new Map<number, Vector3>();
        for (let k = 0; k <= 14; k++) {
          const vi = legBase + ring * 15 + k;
          const off = hide.positionOf(vi).sub(r.joint);
          off.addScaledVector(axisH, -off.dot(axisH));
          shape.set(vi, off.multiplyScalar(bendFix(BEND_REF)));
        }
        bendShapes.push(shape);
      }
      // 足: 平たく広い。かかと側は足首の骨、前半分は指の骨に付く（踏み切りで指が反る）。
      const fx = r.ankle.x, fz = r.ankle.z;
      const foot: Ring[] = [];
      for (const [dz, rx, top] of [[-0.44, 0.05, 0.04], [-0.38, 0.26, 0.17], [-0.28, 0.42, 0.27], [-0.04, 0.5, 0.36], [0.2, 0.52, 0.3], [0.42, 0.47, 0.21], [0.56, 0.32, 0.13], [0.63, 0.1, 0.05]] as const) {
        foot.push({ c: new Vector3(fx, 0.085, fz + dz), right: X, up: Y, rx: rx * k, top: top * k, bottom: 0.085, b0: L.foot, b1: L.toe, w1: sstep(0.1, 0.36, dz), part: pid });
      }
      loft(hide, foot, {
        seg: 16, exponent: 2.6, noise: 0.012, uRepeat: 2, capStart: DARK, capEnd: DARK,
        // 足の先（爪の付け根より前）は、趾の骨（v0.36.0）へ移る。x で近い 2 本を混ぜる（後脚は内・中・外の 3 群）
        skin: (rr, _a, p, _idx, d) => {
          const wd = sstep(0.3, 0.5, rr.c.z - fz);
          if (wd <= 0) return null;
          const wToe = d.find(([b]) => b === L.toe)?.[1] ?? 0;
          return [...d.filter(([b]) => b !== L.toe), [L.toe, wToe * (1 - wd)], ...digitSkin(p.x, wToe * wd)];
        },
        // 指の間のくぼみ（4 本指）
        bulge: (_r, a, idx) => (idx >= 5 ? -0.1 * Math.pow(Math.abs(Math.sin(Math.cos(a) * 3.3)), 6) * sstep(-0.2, 0.5, Math.sin(a)) : 0),
        atlas: { kinds: [`foot${i}`], t: (rr) => rr.c.z - fz, meta: { front: s.front ? 1 : 0 } },
        // 足の裏は暗く
        color: (_p, n) => shade(WHITE, 1 - 0.55 * sstep(-0.35, -0.8, n.y)),
      });
      pool(legBase);
      // 爪 4 本: どれも、x で近い趾の骨に付く（前脚は 1 本ずつ。後脚は内・中・中・外）
      for (const cx of [-0.36, -0.12, 0.12, 0.36]) {
        horn(hide, new Vector3(fx + cx * k, 0.13, fz + 0.5 - Math.abs(cx) * 0.3), new Vector3(cx * 0.5, -0.1, 1), 0.27, 0.115, HORN, nearestDigit(fx + cx * k), pid, new Vector3(0, -0.1, 0));
      }
      // かかとのけづめ（前脚は、けづめの骨 digit_05）
      horn(hide, new Vector3(fx - s.side * 0.1, 0.24, fz - 0.36), new Vector3(-s.side * 0.2, 0.25, -1), 0.2, 0.07, HORN_DARK, E.spur ?? L.foot, pid, new Vector3(0, -0.06, 0));
      // 肩・腰の筋肉のふくらみ（脚が動いても付け根に隙間が出ない）
      const lump: Ring[] = [];
      const lc = new Vector3(s.hip[0] * 0.93, s.hip[1] - 0.02, s.hip[2]);
      for (let j = 0; j <= 6; j++) {
        const t = j / 6;
        const rr = Math.max(0.02, Math.sin(Math.PI * (0.06 + 0.88 * t)));
        lump.push({ c: lc.clone().add(new Vector3(0, 0, -0.56 + 1.12 * t)), right: X, up: Y, rx: 0.42 * rr, top: 0.52 * rr, bottom: 0.5 * rr, b0: s.front ? CHEST : PELVIS, b1: L.upper, w1: 0.35, part: pid });
      }
      // 前脚の付け根のふくらみは、肩甲（v0.36.0）にも付く（胸 0.35・肩甲 0.3・上腕 0.35。肩甲が動かなければ v0.35.0 と同じ形）
      const scap = s.front ? GALDROS_SCAPULAE[i]! : null;
      const lumpBase = hide.count;
      loft(hide, lump, { seg: 12, noise: 0.02, uRepeat: 2, skin: scap === null ? undefined : () => [[CHEST, 0.35], [scap, 0.3], [L.upper, 0.35]], atlas: { kinds: [`lump${i}`], t: (rr) => rr.c.z, density: [0.6], meta: { front: s.front ? 1 : 0, cy: lc.y, top: 0.52, bottom: 0.5 } }, color: () => WHITE });
      pool(lumpBase);
    });

    // ---- 岩板（1 枚ずつ骨に付く） ----
    // 設定図の板は、体に沿って反った薄くなめらかな板で、縁が青銅色。背殻は殻の面、ほかは位置と傾きで決めた反った面に乗せる。
    plates.forEach((pl, i) => {
      const o = pl.slab;
      const sh = pl.shell;
      const m = new Matrix4().compose(new Vector3(...o.pos), new Quaternion().setFromEuler(new Euler(...o.rot)), new Vector3(1, 1, 1));
      // 肩・腰の板は、脚の付け根のふくらみに埋まらないよう、面の外側へ浮かせる
      const floatUp = pl.group === 'fixed' && (pl.parent === CHEST || pl.parent === PELVIS) ? 0.13 : 0;
      const surface = sh
        ? (u: number, v: number): Vector3 => shellPoint((sh.z0 + sh.z1) / 2 + (v * (sh.z1 - sh.z0)) / 2, (sh.a0 + sh.a1) / 2 + (u * (sh.a1 - sh.a0)) / 2)
        : (u: number, v: number): Vector3 => {
          const x = (u * o.w) / 2, z = (v * o.d) / 2;
          return new Vector3(x, floatUp - (o.bendX ?? 0) * x * x - (o.bendZ ?? 0) * z * z, z).applyMatrix4(m);
        };
      const inside = sh ? new Vector3(0, spineAt(o.pos[2]).cy, o.pos[2]) : new Vector3(0, -1, 0).applyMatrix4(m);
      const opts = {
        surface, inside, w: o.w, d: o.d, seed: o.seed, bone: GALDROS_PLATES[i]!, part: pl.part, rock: ROCK, moss: o.moss, mossColor: MOSS, points: o.points ?? 8,
        thickness: sh ? 0.1 : Math.min(0.11, o.h * 0.42), skirt: sh ? 0.07 : o.h * 0.45, square: sh ? 0.13 : 0.5,
      };
      // 縁は光る素材へ入れるので、色は少し落とす
      const rimColor = shade(BRONZE, 0.78);
      if (pl.group === 'dome') plate(dome, opts, { geo: domeRim, color: rimColor });
      else if (pl.group === 'cap') plate(cap, opts, { geo: cap, color: BRONZE });
      else plate(rock, opts, { geo: glow, color: rimColor });
    });
    const rowBone = (z: number): number => (z > 0.3 ? THORAX : z > -0.55 ? BODY : LUMBAR);
    // 壊れた後に残る根元
    for (let j = 0; j < 12; j++) {
      const a = (j / 12) * Math.PI * 2 + 0.2;
      const x = Math.cos(a) * 0.78, z = -0.12 + Math.sin(a) * 1.05;
      slab(core, { w: 0.42, d: 0.5, h: 0.26, seed: 60 + j, pos: [x, backY(x, z) + 0.03, z], rot: [Math.sin(a) * 0.25, a, -x * 0.5], bone: rowBone(z), part: part.back, rock: ROCK_DARK, points: 6 });
    }
    // 設定図に無い部品（背のとげ、殻のふちの小岩、首の後ろと尾の背の岩、ひじ・ひざのこぶ）は付けない（D-040）
    // 尾の先の晶の塊
    const tip = new Vector3(...TAIL_TIP);
    const tailCrystals: [number, number, number, number, number][] = [
      [0, 0.1, -1, 0.52, 0.25], [0.6, 0.4, -0.7, 0.42, 0.22], [-0.6, 0.35, -0.75, 0.42, 0.22], [0.1, 0.9, -0.4, 0.38, 0.21], [-0.3, -0.6, -0.7, 0.36, 0.2], [0.35, -0.5, -0.7, 0.34, 0.19],
      [0, 0.7, 0.3, 0.32, 0.2], [0.6, 0, 0.2, 0.3, 0.18], [-0.6, 0, 0.2, 0.3, 0.18], [0.45, 0.6, -0.2, 0.3, 0.17], [-0.45, 0.6, -0.2, 0.3, 0.17], [0, -0.7, 0.1, 0.28, 0.17],
    ];
    // 設定図の晶の塊は、尾の先を前後に長く覆う。後ろ向きの晶ほど後ろから生やす。
    const crystalBase = (c: Vector3, x: number, y: number, z: number): Vector3 => c.clone().add(new Vector3(x * 0.08, y * 0.08, 0.04 + z * 0.2));
    tailCrystals.forEach(([x, y, z, len, rad], j) => crystal(glow, crystalBase(tip, x, y, z), new Vector3(x, y, z), len * 0.85, rad * 0.9, BRONZE, GALDROS_TAIL[TAIL_N - 1]!, part.tail, j + 1));

    // ================= 素材 =================
    // 絵を貼る区画の位置を決める。焼いた絵と同じ並び（galdrosAtlas.ts）を使う。
    // 形を変えて区画が増減した時は、その場で並べ直す（絵とは合わなくなるので atlasStored を false にして知らせる）。
    this.atlasCharts = hide.charts;
    const stored = GALDROS_ATLAS.rects as Record<string, readonly [number, number, number, number] | undefined>;
    this.atlasStored = hide.charts.length === Object.keys(stored).length && hide.charts.every((c) => stored[c.kind]);
    const rects = this.atlasStored ? stored : packCharts(hide.charts);
    for (const c of hide.charts) c.rect = rects[c.kind]!;

    const hideTex = makeHideTextures(), rockTex = makeRockTextures();
    // 皮の絵は読み込みが終わるまで、平均の色 1 色で代わりをする
    const flat = new DataTexture(new Uint8Array([125, 108, 92, 255]), 1, 1);
    flat.colorSpace = SRGBColorSpace;
    flat.channel = 1;
    flat.needsUpdate = true;
    const hideMat = new MeshStandardMaterial({ vertexColors: true, map: flat, normalMap: hideTex.normal, roughness: 0.82, metalness: 0 });
    hideMat.normalScale.set(0.45, 0.45);
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

    const skin = (g: Geo, mat: MeshStandardMaterial, name: string): SkinnedMesh => {
      const geo = g.build();
      // くぼみや岩板の下の陰（Blender で焼いた値）を頂点の色へ掛ける。光る部分には掛けない。
      if (mat !== this.glowMat && !applyAo(geo, name)) this.aoApplied = false;
      const mesh = new SkinnedMesh(geo, mat);
      mesh.name = name;
      mesh.bind(skeleton, new Matrix4());
      mesh.castShadow = true;
      // 骨で大きく動くので、元の形の大きさでの視界判定は使わない
      mesh.frustumCulled = false;
      this.root.add(mesh);
      return mesh;
    };
    this.hideMesh = skin(hide, hideMat, 'hide');
    {
      // ひじ・ひざの補正形状を、皮のメッシュの形の変化（morph target）として付ける（頂点の数・並びは変えない。焼いた陰と絵の区画はそのまま）
      const geo = this.hideMesh.geometry;
      const n = geo.getAttribute('position').count;
      geo.morphAttributes.position = bendShapes.map((shape) => {
        const arr = new Float32Array(n * 3);
        for (const [vi, d] of shape) arr.set([d.x, d.y, d.z], vi * 3);
        return new Float32BufferAttribute(arr, 3);
      });
      geo.morphTargetsRelative = true;
      this.hideMesh.updateMorphTargets();
    }
    skin(rock, rockMat, 'rock');
    this.capMesh = skin(cap, rockMat, 'cap');
    this.domeMesh = skin(dome, rockMat, 'dome');
    this.domeRimMesh = skin(domeRim, this.glowMat, 'domeRim');
    this.coreMesh = skin(core, rockMat, 'core');
    skin(glow, this.glowMat, 'glow');

    // ================= 体から離れる物 =================
    const plain = (g: Geo): BufferGeometry => {
      const geo = g.build();
      geo.deleteAttribute('skinIndex');
      geo.deleteAttribute('skinWeight');
      return geo;
    };
    // 切り落とした尾の先（最初は隠す）
    const dropGeo = new Geo(), dropGlow = new Geo();
    const piece: Ring[] = [];
    const baseY = spineAt(cutZ).cy;
    for (let z = cutZ; z > TAIL_END - 0.001; z -= 0.085) {
      const s = spineAt(Math.max(TAIL_END, z));
      piece.push({ c: new Vector3(0, s.cy - baseY, z - cutZ), right: X, up: Y, rx: s.rx, top: s.top, bottom: s.bottom, b0: 0, b1: 0, w1: 0, part: 0 });
    }
    // 絵の貼り位置は、体の尾先の区画を借りる
    const tipChart = hide.charts.find((c) => c.kind === 'tailTip');
    loft(dropGeo, piece, { seg: 16, exponent: 2.25, noise: 0.02, uRepeat: 2, capStart: FLESH, capEnd: DARK, atlasRef: tipChart ? { chart: tipChart, t: (r) => r.c.z + cutZ } : undefined, color: () => (tipChart ? WHITE : SKIN_PLAIN) });
    const dtip = new Vector3(TAIL_TIP[0], TAIL_TIP[1] - baseY, TAIL_TIP[2] - cutZ);
    tailCrystals.forEach(([x, y, z, len, rad], j) => crystal(dropGlow, crystalBase(dtip, x, y, z), new Vector3(x, y, z), len * 0.85, rad * 0.9, BRONZE, 0, 0, j + 1));
    const dropHide = new MeshStandardMaterial({ vertexColors: true, map: flat, normalMap: hideTex.normal, roughness: 0.84 });
    dropHide.normalScale.set(0.45, 0.45);
    // 設定図から焼いた絵を読み込む。皮は専用の貼り位置（uv1）、岩は繰り返しの模様。
    const loader = new TextureLoader();
    const waitFor = (path: string, apply: (t: Texture) => void): Promise<boolean> =>
      new Promise((resolve) => {
        // 画面の無い所（Node の検査）では読まない
        if (typeof document === 'undefined') return resolve(false);
        loader.load(assetUrl(path), (t) => { t.colorSpace = SRGBColorSpace; t.anisotropy = 4; apply(t); resolve(true); }, undefined, () => resolve(false));
      });
    void Promise.all([
      waitFor(HIDE_TEX, (t) => {
        t.channel = 1;
        hideMat.map = t;
        dropHide.map = t;
        flat.dispose();
      }),
      waitFor(ROCK_TEX, (t) => {
        t.wrapS = t.wrapT = RepeatWrapping;
        const old = rockMat.map;
        rockMat.map = t;
        this.debrisMat.map = t;
        old?.dispose();
      }),
    ]).then((ok) => { this.artLoaded = ok.every(Boolean); this.artFailed = !this.artLoaded; });
    const dropGlowMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.15, emissive: 0x3a2a12 });
    const drop = new Group();
    for (const [g, mat] of [[dropGeo, dropHide], [dropGlow, dropGlowMat]] as const) {
      const mesh = new Mesh(plain(g), mat);
      mesh.castShadow = true;
      drop.add(mesh);
    }
    drop.position.y = 0.3;
    drop.rotation.z = 0.5;
    const dropRoot = new Group();
    dropRoot.add(drop);
    dropRoot.visible = false;
    this.extras.push(dropRoot);
    // 砕けて飛ぶ岩（部位破壊の時に出す）
    this.debrisMat = new MeshStandardMaterial({ vertexColors: true, map: rockTex.map, normalMap: rockTex.normal, roughness: 0.95 });
    for (let j = 0; j < 4; j++) {
      const g = new Geo();
      slab(g, { w: 0.34 + j * 0.09, d: 0.3 + ((j * 7) % 3) * 0.1, h: 0.16 + j * 0.03, seed: 200 + j, pos: [0, 0, 0], rot: [0, 0, 0], bone: 0, part: 0, rock: j % 2 ? ROCK : ROCK_DARK, moss: j === 1 ? 0.5 : 0, mossColor: MOSS, points: 6 });
      this.debrisGeo.push(plain(g));
    }
    this.extras.push(this.debrisGroup);
  }

  /**
   * 焼き付け用（v0.36.0。#12 の M3「部位の追従」）: 体の座標の点 p に、いちばん近い皮（胴・あご・脚・足・付け根のふくらみ）の頂点の重み（骨と重み）。
   * 部位の形の端を、見える皮と同じに動かすために使う（npm run monsters:bake。一般の種の CreatureRig.skinOf と同じ決まり）。
   * accept を渡すと、その頂点の骨の並びが合う頂点だけから選ぶ（頭の形は頭の皮から、など。体の中の点が、別の部位の皮を拾わないように）
   */
  skinOf(p: Vector3, accept?: (bones: readonly number[]) => boolean): { bones: number[]; w: number[] } {
    const geo = this.hideMesh.geometry;
    const pos = geo.getAttribute('position'), si = geo.getAttribute('skinIndex'), sw = geo.getAttribute('skinWeight');
    let best = -1, bd = Infinity;
    const list: number[] = [];
    for (const [from, to] of this.skinPool) {
      for (let i = from; i < to; i++) {
        if (accept) {
          list.length = 0;
          for (let k = 0; k < 4; k++) if (sw.getComponent(i, k) > 0) list.push(si.getComponent(i, k));
          if (!accept(list)) continue;
        }
        const d = (pos.getX(i) - p.x) ** 2 + (pos.getY(i) - p.y) ** 2 + (pos.getZ(i) - p.z) ** 2;
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
    }
    if (best < 0) throw new Error(`部位の追従: 点 ${p.toArray().join(',')} に合う皮の頂点が無い`);
    const bones: number[] = [], w: number[] = [];
    for (let k = 0; k < 4; k++) {
      const wk = sw.getComponent(best, k);
      if (wk > 0) {
        bones.push(si.getComponent(best, k));
        w.push(wk);
      }
    }
    return { bones, w };
  }

  /** 焼き付け用（v0.36.0）: 形を作った時の点 p を、重み s で骨に乗せた、いまの位置（ワールド。体が原点・向き 0 なら体の座標） */
  skinned(p: Vector3, s: { bones: number[]; w: number[] }): Vector3 {
    this.root.updateMatrixWorld(true);
    const inv = this.hideMesh.skeleton.boneInverses;
    const out = new Vector3(), m = new Matrix4(), v = new Vector3();
    s.bones.forEach((bi, k) => {
      m.multiplyMatrices(this.bones[bi]!.matrixWorld, inv[bi]!);
      out.addScaledVector(v.copy(p).applyMatrix4(m), s.w[k]!);
    });
    return out;
  }

  hitFlash(partIndex: number): void {
    if (partIndex >= 0 && partIndex < 8) this.flashUniform.value[partIndex] = 1;
  }

  /** 命中した位置（ワールド座標）に応じて、体・頭・尾をのけぞらせる。 */
  hitReact(partIndex: number, wx: number, wz: number, strength = 1): void {
    const yaw = this.root.rotation.y, cy = Math.cos(yaw), sy = Math.sin(yaw);
    const dx = wx - this.root.position.x, dz = wz - this.root.position.z;
    const lx = dx * cy - dz * sy, lz = dx * sy + dz * cy;
    const len = Math.hypot(lx, lz) || 1;
    const k = Math.min(1.6, strength);
    const side = Math.sign(lx) || 1;
    // 叩かれた側と反対へ押される
    this.kickX.v += (-lx / len) * 1.1 * k;
    this.kickZ.v += (-lz / len) * 0.7 * k;
    this.kickRoll.v += side * 0.9 * k;
    if (partIndex === this.part.head) {
      this.headKickYaw.v += -side * 5.5 * k;
      this.headKickPitch.v += -3 * k;
    } else if (partIndex === this.part.tail) {
      this.tailKick.v += -side * 4 * k;
    } else if (partIndex === this.part.back) {
      this.kickPitch.v += (lz > 0 ? 1 : -1) * 0.5 * k;
    }
    this.rattle = Math.max(this.rattle, 0.75 * k);
  }

  /** 尾を切った時に、落ちた位置へ尾先を置く。 */
  placeSevered(x: number, y: number, z: number, yaw: number): void {
    const d = this.extras[0]!;
    d.position.set(x, y, z);
    d.rotation.y = yaw;
    d.visible = true;
  }

  private rnd(): number {
    return hash3(this.seed++, 17, 91);
  }

  /** 岩板が砕けて飛ぶ。 */
  private shatter(plates: readonly number[]): void {
    const center = this.root.position;
    for (const b of plates) {
      const at = this.bones[b]!.getWorldPosition(this.v1);
      for (let j = 0; j < 3; j++) {
        const mesh = new Mesh(this.debrisGeo[Math.floor(this.rnd() * this.debrisGeo.length)]!, this.debrisMat);
        mesh.castShadow = true;
        mesh.position.copy(at).add(this.v2.set(this.rnd() - 0.5, this.rnd() * 0.3, this.rnd() - 0.5).multiplyScalar(0.5));
        mesh.rotation.set(this.rnd() * 6, this.rnd() * 6, this.rnd() * 6);
        mesh.scale.setScalar(0.7 + this.rnd() * 0.8);
        const out = this.v3.set(at.x - center.x, 0, at.z - center.z);
        if (out.lengthSq() < 0.01) out.set(this.rnd() - 0.5, 0, this.rnd() - 0.5);
        out.normalize().multiplyScalar(1.5 + this.rnd() * 3);
        this.debris.push({ mesh, vel: new Vector3(out.x + (this.rnd() - 0.5) * 2, 3 + this.rnd() * 3.5, out.z + (this.rnd() - 0.5) * 2), spin: new Vector3(this.rnd() - 0.5, this.rnd() - 0.5, this.rnd() - 0.5).multiplyScalar(14), life: 2.6 + this.rnd() });
        this.debrisGroup.add(mesh);
      }
    }
  }

  private stepDebris(dt: number, ground: number): void {
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i]!;
      d.life -= dt;
      d.vel.y -= 16 * dt;
      d.mesh.position.addScaledVector(d.vel, dt);
      d.mesh.rotation.x += d.spin.x * dt;
      d.mesh.rotation.y += d.spin.y * dt;
      d.mesh.rotation.z += d.spin.z * dt;
      if (d.mesh.position.y < ground + 0.1) {
        d.mesh.position.y = ground + 0.1;
        d.vel.y = Math.abs(d.vel.y) > 1.2 ? -d.vel.y * 0.32 : 0;
        d.vel.x *= 0.55;
        d.vel.z *= 0.55;
        d.spin.multiplyScalar(0.45);
      }
      if (d.life < 0.5) d.mesh.scale.multiplyScalar(Math.max(0, 1 - dt * 4));
      if (d.life <= 0) {
        this.debrisGroup.remove(d.mesh);
        this.debris.splice(i, 1);
      }
    }
  }

  /** 鼻息（土ぼこりの効果を鼻先に出す）。 */
  private puffNostrils(c: MonsterRigCtx, amount: number): void {
    if (!c.fx) return;
    this.root.updateMatrixWorld(true);
    const p = this.bones[HEAD]!.localToWorld(this.v1.set(0, -0.05, 1.0));
    c.fx.puff(p.x, p.y, p.z, amount);
  }

  /**
   * 怯み（転倒）が始まってからの秒。戦闘の状態の経過 tick（全体 − 残り。その tick を数え終えた後の値）から、
   * 技の renderTick と同じ数え方で、前の tick から alpha の分だけ進める（alpha = 1 で経過 tick ちょうど）
   */
  private staggerSec(m: MonsterState, alpha: number): number {
    return Math.max(0, m.staggerTotal - m.staggerTicks - 1 + Math.min(1, Math.max(0, alpha))) / 60;
  }

  /**
   * 眼（v0.36.0。#12 の M2）: まぶたと別に、狩人を目で追う（頭の向きの残りの分だけ。眼の回る量は 0.32 まで）。
   * 追わない時は、ゆっくり辺りを見る（気付いていない）・上へ回る（眠る）・ふらつく（倒れている）。死んだら止まる。
   * 乱数は使わない（まばたき・しぐさの乱数の並びを変えないため。時刻の区切りの hash で決める）。
   */
  private aimEyes(m: MonsterState, c: MonsterRigCtx, P: Pose, time: number, dt: number, resting: boolean): void {
    if (m.dead) return;
    const head = this.bones[HEAD]!;
    const track = !!c.lookAt && m.aware && !resting && P.look > 0;
    let target: Vector3 | null = null;
    // 計算用の値は眼だけのもの（this.v1〜v5 は、打ち付ける脚の足先などを持ち越しているので使わない）
    const [tv, dir] = this.eyeTmp;
    const [q, qi] = this.eyeTmpQ;
    if (track) target = head.worldToLocal(tv!.set(c.lookAt!.x, c.lookAt!.y + 1.1, c.lookAt!.z));
    const slot = Math.floor(time / 1.9);
    const wYaw = resting ? 0 : P.look > 0 || !m.aware ? (hash3(slot, 5, 13) - 0.5) * 0.45 : 0.3 * Math.sin(time * 1.7);
    const wPitch = resting ? -0.2 : P.look > 0 || !m.aware ? (hash3(slot, 7, 29) - 0.5) * 0.16 + (m.aware ? 0 : 0.12) : 0.12 * Math.sin(time * 1.1 + 1);
    const MAX = 0.32;
    for (let i = 0; i < 2; i++) {
      const out = EYE_OUT[i]!;
      if (target) dir!.copy(target).sub(this.eyeLocal[i]!).normalize();
      else dir!.copy(out).applyAxisAngle(Y, wYaw).applyAxisAngle(LID_AXIS[i]!, wPitch).normalize();
      q!.setFromUnitVectors(out, dir!);
      const ang = 2 * Math.acos(clamp(q!.w, -1, 1));
      if (ang > MAX) q!.copy(qi!.identity().slerp(q!, MAX / ang));
      this.eyeQ[i]!.slerp(q!, 1 - Math.exp(-dt * 22));
      this.bones[GALDROS_EYES[i]!]!.quaternion.copy(this.eyeQ[i]!);
    }
  }

  update(m: MonsterState, c: MonsterRigCtx): void {
    const B = this.bones;
    const dt = Math.min(0.05, Math.max(0, c.dt));
    const time = c.time;
    const partOf = (id: string): MonsterState['parts'][number] | undefined => m.parts[this.index[id] ?? -1];
    const pos = this.root.position;
    const yaw = this.root.rotation.y;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const ground = pos.y;

    // ================= 部位の状態 =================
    const severed = !!partOf('tail')?.severed;
    const headBroken = !!partOf('head')?.broken, backBroken = !!partOf('back')?.broken;
    if (this.started && ((headBroken && !this.wasBroken.head) || (backBroken && !this.wasBroken.back))) {
      this.root.updateMatrixWorld(true);
      if (headBroken && !this.wasBroken.head) this.shatter(this.capPlates);
      if (backBroken && !this.wasBroken.back) this.shatter(this.domePlates);
    }
    this.wasBroken.head = headBroken;
    this.wasBroken.back = backBroken;
    this.capMesh.visible = !headBroken;
    this.domeMesh.visible = this.domeRimMesh.visible = !backBroken;
    this.coreMesh.visible = backBroken;
    B[GALDROS_TAIL[CUT]!]!.scale.setScalar(severed ? 0.0001 : 1);
    const flash = this.flashUniform.value;
    for (let i = 0; i < flash.length; i++) flash[i] = Math.max(0, flash[i]! - dt * 5);
    this.stepDebris(dt, ground);

    const enraged = m.enraged && !m.dead;
    // 弱っている合図は、捕獲の条件と同じ値（モンスターのデータの capture.hpRatio）を使う
    const weak = isWeak(m);
    // 眠る姿勢: 捕獲された時と、巣で眠っている時（フィールド）と、状態異常の睡眠（v0.33.0）。起きた時は、すばやく立ち上がる
    const resting = m.captured || ((m.asleep || m.ailments.ticks.sleep > 0) && !m.dead);
    this.capT = resting ? this.capT + c.dt : m.dead ? 0 : Math.max(0, Math.min(this.capT, 1.4) - c.dt * 3.2);
    // 怒り: 晶脈と目が赤く脈打つ
    const rage = enraged ? 0.6 + 0.4 * Math.sin(time * 7) : 0;
    this.glowMat.emissive.setRGB(1 + rage * 2.2, 1 - rage * 0.45, 1 - rage * 0.75);
    // 段階が上の個体（晶脈の育った個体）は、晶脈の光が強い。設定図は無く、見分けるための仮の表現
    const grown = Math.max(0, (c.rankOrder ?? 1) - 1) * 0.22;
    this.glowMat.emissiveIntensity = m.dead ? 0.06 : 0.3 + grown + rage * 0.55;

    // ================= 体全体の速さと向きの変化（見た目用） =================
    if (!this.started) {
      this.lastPos.copy(pos);
      this.lastYaw = yaw;
      this.tailHeading.fill(yaw);
    }
    if (dt > 1e-4) {
      const k = 1 - Math.exp(-dt * 14);
      this.v1.subVectors(pos, this.lastPos).multiplyScalar(1 / dt);
      if (this.v1.length() > 40) this.v1.set(0, 0, 0); // 位置が飛んだ時
      this.vel.lerp(this.v1, k);
      this.yawVel += (wrapPi(yaw - this.lastYaw) / dt - this.yawVel) * k;
      this.lastPos.copy(pos);
      this.lastYaw = yaw;
    }
    const speed = Math.hypot(this.vel.x, this.vel.z);
    const gallop = sstep(4.2, 6.5, speed);
    this.runPhase += (speed / 0.5) * dt;

    // ================= 姿勢の量を層ごとに足す =================
    const P = resetPose(this.pose);
    let slamLeg = -1, pawLeg = -1, pawT = 0, pawAmp = 1, limp = 0, tailYaw = 0, tailPitch = 0, tailDriveTarget = 0, kick = 0;
    /** 倒れた脚がもがく動きの時刻（転倒の間は、怯みの経過時間。v0.36.0） */
    let kickTime = time;
    const slamTarget = this.v5;

    // ---- 呼吸・まばたき・基本の構え ----
    const breathRate = m.dead ? 0 : resting ? 0.9 : enraged ? 3.4 : weak ? 3.9 : m.aware ? 1.9 : 1.3;
    this.breathPhase += breathRate * dt;
    const breath = Math.sin(this.breathPhase);
    P.breath = (enraged || weak ? 0.045 : 0.03) * breath;
    P.y += 0.012 * breath;
    P.archF += 0.012 * breath;
    if (time > this.blinkAt) this.blinkAt = time + 2.2 + this.rnd() * 3.5;
    const blinking = this.blinkAt - time < 0.13 ? 1 : 0;
    P.lid = Math.max(0.2, blinking, enraged ? 0.38 : 0, weak ? 0.5 : 0);
    if (!m.aware) {
      // 気付いていない: 頭を下げて地面を嗅いでいる
      P.neckPitch += 0.26 + 0.05 * Math.sin(time * 0.6);
      P.headPitch += 0.2 + 0.06 * Math.sin(time * 0.83);
      P.look = 0;
      P.tailWag = 0.7;
    }
    if (weak) {
      // 弱っている: 頭と尾が下がり、息が荒い
      P.neckPitch += 0.16;
      P.headPitch += 0.08;
      P.tailLift -= 0.25;
      P.y -= 0.05;
      P.jaw += 0.1 + 0.05 * Math.max(0, breath);
      P.tailWag = 0.4;
    }
    if (enraged) {
      P.jaw += 0.05 + 0.04 * Math.max(0, breath);
      P.tailLift += 0.12;
      P.tailWag = 1.5;
    }

    // ---- しぐさ（技も怯みも無く、ほぼ止まっている間だけ） ----
    const calm = !m.action && m.staggerTicks <= 0 && !m.dead && !resting && m.trapTicks <= 0 && m.ailments.ticks.para <= 0 && m.ailments.ticks.stun <= 0 && speed < 0.45 && Math.abs(this.yawVel) < 0.25;
    const fid = this.fid;
    if (!calm) {
      fid.kind = '';
      this.nextFid = Math.max(this.nextFid, time + 1.4);
    } else if (!fid.kind && time >= this.nextFid) {
      const list: Fidget[] = m.aware ? ['growl', 'snort', 'shake', 'tailflick', 'scrape', 'growl'] : ['sniff', 'glance', 'snort', 'tailflick', 'shake', 'sniff'];
      fid.kind = list[Math.floor(this.rnd() * list.length)] ?? 'snort';
      fid.t0 = time;
      fid.dur = fid.kind === 'shake' ? 0.9 : fid.kind === 'snort' ? 0.7 : fid.kind === 'tailflick' ? 0.8 : fid.kind === 'scrape' ? 1.6 : 2.2;
      fid.side = this.fidCount++ % 2 ? 1 : -1;
      this.puffed = false;
    }
    if (fid.kind) {
      const u = (time - fid.t0) / fid.dur;
      if (u >= 1) {
        fid.kind = '';
        this.nextFid = time + 1.8 + this.rnd() * 3;
      } else {
        const env = Math.sin(Math.PI * u);
        switch (fid.kind) {
          case 'shake': // 身震い: 岩板が鳴る
            P.roll += 0.06 * env * Math.sin(time * 34);
            P.yaw += 0.03 * env * Math.sin(time * 29);
            P.headRoll += 0.2 * env * Math.sin(time * 31);
            P.rattle = Math.max(P.rattle, env);
            P.tailWag = 4;
            P.look = 0.3;
            break;
          case 'snort': // 鼻息
            P.headPitch += -0.14 * Math.sin(Math.PI * Math.min(1, u * 2.2)) + 0.1 * env;
            P.jaw += 0.06 * env;
            if (u > 0.25 && !this.puffed) {
              this.puffed = true;
              this.puffNostrils(c, 3);
            }
            break;
          case 'sniff': // 地面を嗅ぐ
            P.neckPitch += 0.2 * env;
            P.headPitch += 0.14 * env + 0.04 * env * Math.sin(time * 9);
            P.neckYaw += 0.25 * env * Math.sin(u * Math.PI * 2) * fid.side;
            break;
          case 'glance': // 辺りを見回す
            P.neckPitch -= 0.3 * env;
            P.headPitch -= 0.16 * env;
            P.neckYaw += 0.5 * env * fid.side * Math.sign(Math.sin(u * Math.PI * 2 + 0.3));
            break;
          case 'growl': // 低くうなる
            P.jaw += 0.2 * env + 0.03 * env * Math.sin(time * 44);
            P.neckPitch += 0.1 * env;
            P.headRoll += 0.06 * env * Math.sin(time * 3) * fid.side;
            P.tailLift += 0.2 * env;
            P.lid = Math.max(P.lid, 0.35 * env);
            P.tongue += 0.3 * env;
            break;
          case 'scrape': // 前脚で地面を掻く
            pawLeg = fid.side > 0 ? 0 : 1;
            pawT = (time - fid.t0) * 45;
            pawAmp = 0.8 * env;
            P.neckPitch += 0.12 * env;
            break;
          case 'tailflick': // 尾を振る
            if (u < 0.3) this.tailKick.v += fid.side * 26 * dt;
            break;
        }
      }
    }

    // ---- 技（振り付け。判定のある脚と尾は軌道データに従う） ----
    const run = m.action;
    if (run && !m.dead) {
      const t = renderTick(run, c.alpha);
      const clip = run.def.clip;
      const track = run.def.weaponTrack ? c.content.tracks.get(run.def.weaponTrack) : undefined;
      // 短い突進（130 tick）は、突進（190 tick）の振り付けを時間を縮めて使う
      const tc = clip === 'galdros_charge_short_01' ? t * 1.46 : t;
      const TAIL_CLIPS = ['galdros_tail_sweep_01', 'galdros_tail_sweep_rev_01', 'galdros_tail_slam_01', 'galdros_rockfall_01'];
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
        const hitNow = gauss(t, 55, 3);
        P.pitch += -0.13 * wind + 0.16 * after;
        P.roll += (-0.08 * wind + 0.06 * after) * side;
        P.y += 0.06 * wind - 0.36 * after;
        P.z += -0.12 * wind + 0.2 * after;
        P.bendF += (0.12 * wind - 0.08 * after) * side;
        P.bendR += 0.06 * wind * side;
        P.archF += -0.08 * wind + 0.06 * after;
        P.neckPitch += -0.22 * wind + 0.2 * after;
        P.headPitch += -0.1 * wind + 0.12 * after - 0.12 * hitNow;
        P.jaw += 0.14 * wind + 0.32 * after;
        P.tongue += 0.4 * after;
        P.tailLift += 0.3 * wind + 0.45 * hitNow;
        P.spread += 0.18 * (wind + after);
        P.rattle = Math.max(P.rattle, hitNow);
        P.look = 0.6;
      } else if (clip === 'galdros_charge_01' || clip === 'galdros_charge_short_01') {
        const wind = smoothstep(tc / 30) * (1 - smoothstep((tc - 140) / 40));
        const pre = tc < 60 ? smoothstep(tc / 45) : 0;
        const brake = tc > 132 ? Math.sin(Math.PI * Math.min(1, (tc - 132) / 40)) : 0;
        P.neckPitch += 0.3 * wind;
        P.headPitch += 0.2 * wind;
        P.pitch += 0.07 * wind - 0.1 * brake;
        P.y += -0.08 * wind - 0.06 * brake;
        P.z += -0.24 * pre + 0.2 * brake;
        P.archR += 0.1 * pre;
        // 構えている間は頭を左右に振り、走り出すと首が上下に揺れる
        P.headYaw += 0.12 * pre * Math.sin(tc * 0.5);
        P.neckPitch += 0.06 * gallop * Math.sin(this.runPhase * 2);
        P.tailLift += 0.3 * wind;
        P.rattle = Math.max(P.rattle, 0.5 * gallop, brake);
        if (tc > 10 && tc < 52) {
          pawLeg = 1; // 右前脚で地面を掻く
          pawT = tc;
        }
        P.jaw += tc > 60 && tc < 132 ? 0.2 : 0.04 + 0.2 * brake;
        P.look = 0.25;
      } else if (TAIL_CLIPS.includes(clip) && track) {
        const s = sampleTrack(track, t);
        tailYaw = Math.atan2(s.dir.x, -s.dir.z);
        tailPitch = Math.asin(clamp(s.dir.y, -1, 1));
        tailDriveTarget = 1;
        // 体を「く」の字に絞ってから、尾の向きへ腰を回す
        P.bendR += -tailYaw * 0.1;
        P.bendF += tailYaw * 0.06;
        P.roll += -tailYaw * 0.035;
        P.y -= 0.07 * Math.sin(Math.PI * clamp(t / 70, 0, 1));
        P.neckPitch += 0.08;
        P.jaw += 0.12;
        P.spread += 0.12;
        if (clip === 'galdros_tail_slam_01' || clip === 'galdros_rockfall_01') {
          // 尾を高く上げ、真後ろの地面へ叩きつける。落石は、ここで岩が打ち上がる。
          const hitT = clip === 'galdros_rockfall_01' ? 57 : 55;
          const up = sstep(0, 0.8, s.dir.y);
          const impact = gauss(t, hitT + 1, 3), after = smoothstep((t - hitT) / 3) * (1 - smoothstep((t - hitT - 12) / 40));
          P.pitch += 0.09 * up - 0.06 * after;
          P.archR += 0.14 * up;
          P.y += -0.05 * up - 0.14 * after;
          P.z += 0.1 * up - 0.08 * after;
          P.neckPitch += 0.1 * up;
          P.jaw += 0.2 * up + 0.32 * after;
          P.tongue += 0.4 * after;
          P.rattle = Math.max(P.rattle, impact * 1.4);
          P.jitter += 0.035 * after;
          P.spread += 0.16 * after;
          P.look = 0.4;
        }
      } else if (clip === 'galdros_bite_01') {
        // 首を引いて口を開け、体ごと踏み込んで噛む
        const pull = Math.sin(Math.PI * clamp((t - 8) / 30, 0, 1));
        const snap = smoothstep((t - 38) / 5) * (1 - smoothstep((t - 54) / 30));
        P.neckPitch += 0.16 * pull - 0.26 * snap;
        P.headPitch += 0.1 * pull - 0.16 * snap;
        P.z += -0.16 * pull + 0.34 * snap;
        P.y += 0.04 * pull - 0.08 * snap;
        P.pitch += -0.04 * pull + 0.07 * snap;
        P.jaw += 0.7 * smoothstep((t - 12) / 14) * (1 - smoothstep((t - 44) / 3));
        P.tongue += 0.5 * pull;
        P.tailLift += 0.3 * snap;
        P.rattle = Math.max(P.rattle, gauss(t, 45, 3) * 0.8);
        P.look = 0.7;
      } else if (clip === 'galdros_head_swing_01' && track) {
        // 頭を片側へ溜めて、反対側へ振り抜く（首の向きは判定の軌道に合わせる）
        const s = sampleTrack(track, t);
        const a = Math.atan2(s.dir.x, s.dir.z);
        P.neckYaw += a * 0.55;
        P.headYaw += a * 0.35;
        P.bendF += a * 0.12;
        P.roll += -a * 0.05;
        P.x += Math.sin(a) * 0.12;
        P.neckPitch += 0.1;
        P.jaw += 0.3 * sstep(30, 42, t) * (1 - smoothstep((t - 56) / 20));
        P.y -= 0.06 * Math.sin(Math.PI * clamp(t / 80, 0, 1));
        P.spread += 0.1;
        P.look = 0.2;
      } else if (clip === 'galdros_double_slam_01' || clip === 'galdros_rock_stomp_01') {
        // 上体を大きく起こし、両前脚で正面を叩く（岩を打ち上げる方は、溜めが少し短い）
        const hitT = clip === 'galdros_double_slam_01' ? 65 : 57;
        const strike = smoothstep((t - (hitT - 5)) / 5);
        const wind = smoothstep(t / 38) * (1 - strike), after = strike * (1 - smoothstep((t - hitT - 6) / 54));
        const impact = gauss(t, hitT + 1, 3);
        P.pitch += -0.24 * wind + 0.15 * after;
        P.y += 0.14 * wind - 0.36 * after;
        P.z += -0.14 * wind + 0.18 * after;
        P.archF += -0.16 * wind + 0.06 * after;
        P.neckPitch += -0.2 * wind + 0.24 * after;
        P.headPitch += -0.08 * wind + 0.12 * after;
        P.jaw += 0.2 * wind + 0.4 * after;
        P.tongue += 0.4 * after;
        P.tailLift += 0.4 * wind + 0.5 * impact;
        P.spread += 0.22 * (wind + after);
        P.rattle = Math.max(P.rattle, impact * 1.5);
        P.jitter += 0.03 * after;
        P.look = 0.5;
      } else if (clip === 'galdros_body_press_01') {
        // 沈んでから前へ跳び、腹で潰す
        const crouch = smoothstep(t / 40) * (1 - smoothstep((t - 50) / 5));
        const air = Math.sin(Math.PI * clamp((t - 52) / 17, 0, 1));
        const land = smoothstep((t - 68) / 3) * (1 - smoothstep((t - 86) / 52));
        P.y += -0.26 * crouch + 0.6 * air - 0.42 * land;
        P.pitch += 0.07 * crouch - 0.22 * air + 0.1 * land;
        P.archF += -0.1 * air;
        P.neckPitch += 0.14 * crouch - 0.2 * air + 0.22 * land;
        P.jaw += 0.12 * crouch + 0.5 * air + 0.3 * land;
        P.tongue += 0.5 * air;
        P.tailLift += 0.5 * air;
        P.spread += 0.3 * land;
        P.rattle = Math.max(P.rattle, gauss(t, 70, 3) * 1.6);
        P.jitter += 0.03 * land;
        P.look = 0.5;
      } else if (clip.startsWith('galdros_side_bash_')) {
        // 体を反対へ引いてから、横にいる相手へぶつける
        const side = clip.includes('_l_') ? 1 : -1;
        const lean = Math.sin(Math.PI * clamp((t - 6) / 30, 0, 1));
        const bash = smoothstep((t - 36) / 6) * (1 - smoothstep((t - 50) / 34));
        P.x += side * (-0.25 * lean + 0.8 * bash);
        P.roll += side * (0.07 * lean - 0.16 * bash);
        P.bendF += side * (-0.1 * lean + 0.12 * bash);
        P.bendR += side * (-0.06 * lean + 0.1 * bash);
        P.y -= 0.1 * bash;
        P.neckYaw += side * (-0.2 * lean + 0.35 * bash);
        P.jaw += 0.2 * bash;
        P.spread += 0.15 * bash;
        P.rattle = Math.max(P.rattle, gauss(t, 44, 3));
        P.look = 0.3;
      } else if (clip.startsWith('galdros_turn_')) {
        // 足を踏み替える向き直り（v0.41.0。#19 の M01）: 回る向きへ首と頭を先に向け、内側へ傾いて少し沈む。
        // 体の向きは simulation が回し（ゆっくり始まってゆっくり止まる）、脚は踏み替え、背骨は向きの速さで曲がる（下の turnBend）
        const dir = clip.includes('_l') ? 1 : -1;
        const big = clip.includes('180') ? 1 : 0.65;
        const u = clamp(t / run.def.durationTicks, 0, 1);
        const lead = Math.sin(Math.PI * Math.min(1, u * 1.3));
        const mid = Math.sin(Math.PI * u);
        P.neckYaw += 0.3 * dir * lead * big;
        P.headYaw += 0.15 * dir * lead * big;
        P.roll += -0.05 * dir * mid * big;
        P.y -= 0.04 * mid * big;
        P.look = 0.35;
      } else if (clip === 'galdros_rock_fling_01') {
        // 左前脚で地面を掻き、岩を前へ弾き飛ばす
        const kick = gauss(t, 44, 4), after = smoothstep((t - 44) / 4) * (1 - smoothstep((t - 60) / 40));
        if (t > 6 && t < 42) {
          pawLeg = 0;
          pawT = t;
          pawAmp = 1.2;
        }
        P.neckPitch += 0.2 * smoothstep(t / 20) * (1 - after) - 0.15 * after;
        P.pitch += 0.05 * smoothstep(t / 20) - 0.1 * kick;
        P.y += -0.06 + 0.1 * kick;
        P.roll += -0.06 * kick;
        P.jaw += 0.1 + 0.3 * after;
        P.tailLift += 0.4 * kick;
        P.rattle = Math.max(P.rattle, kick);
        P.look = 0.8;
      } else if (clip === 'galdros_retreat_01') {
        // 沈んで、後ろへ跳ぶ
        const crouch = smoothstep(t / 16) * (1 - smoothstep((t - 20) / 4));
        const air = Math.sin(Math.PI * clamp((t - 20) / 18, 0, 1));
        const land = smoothstep((t - 38) / 3) * (1 - smoothstep((t - 46) / 24));
        P.y += -0.2 * crouch + 0.36 * air - 0.24 * land;
        P.pitch += -0.06 * crouch + 0.1 * air - 0.08 * land;
        P.neckPitch += 0.12 * crouch + 0.1 * land;
        P.tailLift += 0.5 * air;
        P.jaw += 0.2 * land;
        P.spread += 0.2 * land;
        P.rattle = Math.max(P.rattle, gauss(t, 39, 3));
        P.look = 1;
      } else if (clip === 'galdros_threat_01') {
        // 短く吠えて威嚇する（咆哮より小さい）
        const inhale = Math.sin(Math.PI * clamp(t / 12, 0, 1));
        const k = smoothstep((t - 6) / 8) * (1 - smoothstep((t - 44) / 16));
        P.breath += 0.04 * inhale;
        P.neckPitch += 0.08 * inhale - 0.2 * k;
        P.headPitch += -0.16 * k;
        P.z += 0.1 * k;
        P.jaw += 0.45 * k + 0.04 * k * Math.sin(time * 46);
        P.tongue += 0.5 * k;
        P.headRoll += 0.08 * k * Math.sin(time * 9);
        P.tailLift += 0.4 * k;
        P.tailWag = 0.4;
        P.rattle = Math.max(P.rattle, 0.5 * k);
        P.look = 0.9;
      } else if (clip === 'galdros_stomp_01') {
        // 前を浮かせてから踏み鳴らし、背を震わせる（足もとに張り付いた相手を払う）
        const rear = Math.sin(Math.PI * clamp(t / 30, 0, 1));
        const stomp = smoothstep((t - 32) / 6) * (1 - smoothstep((t - 46) / 30));
        P.pitch += -0.13 * rear + 0.09 * stomp;
        P.y += 0.1 * rear - 0.22 * stomp;
        P.archF += -0.1 * rear;
        P.jitter += 0.045 * stomp;
        P.neckPitch += -0.15 * rear + 0.26 * stomp;
        P.headPitch += 0.12 * stomp;
        P.headRoll += 0.12 * stomp * Math.sin(time * 27);
        P.jaw += 0.16 * stomp;
        P.rattle = Math.max(P.rattle, stomp * 1.2);
        P.tailLift += 0.35 * stomp;
        P.spread += 0.2 * stomp;
        P.look = 0.3;
      } else if (clip === 'galdros_roar_01') {
        // 息を吸って頭を引き、前へ突き出して吠える
        const inhale = Math.sin(Math.PI * clamp(t / 16, 0, 1));
        const k = smoothstep((t - 8) / 10) * (1 - smoothstep((t - 58) / 20));
        P.breath += 0.06 * inhale;
        P.neckPitch += 0.12 * inhale - 0.34 * k;
        P.headPitch += 0.08 * inhale - 0.3 * k;
        P.z += -0.12 * inhale + 0.16 * k;
        P.jaw += 0.66 * k + 0.05 * k * Math.sin(time * 50);
        P.tongue += k * (0.7 + 0.3 * Math.sin(time * 38));
        P.pitch += -0.07 * k;
        P.y += 0.05 * k;
        P.archF += -0.08 * k;
        P.jitter += 0.02 * k;
        P.headRoll += 0.05 * k * Math.sin(time * 11);
        P.tailLift += 0.5 * k;
        P.tailWag = 0.3;
        P.lid = Math.max(P.lid, 0.5 * k);
        P.rattle = Math.max(P.rattle, 0.7 * k);
        P.spread += 0.15 * k;
        P.look = 0.5;
      }
    }

    // ---- 罠にかかっている間: 足を取られて体が沈み、もがく（怯みの動きはこの上に重なる）----
    if (!m.dead && !resting && m.trapTicks > 0) {
      const s1 = Math.sin(time * 8.5), s2 = Math.sin(time * 6.1 + 1.3);
      P.y += -0.16 + 0.03 * s1;
      P.roll += 0.06 * s2;
      P.yaw += 0.05 * s1;
      P.neckYaw += 0.35 * Math.sin(time * 3.4);
      P.neckPitch += -0.12 + 0.1 * s2;
      P.jaw += 0.3 + 0.12 * s1;
      P.tailWag = 4.5;
      P.look = 0.2;
    }
    // ---- 捕獲・死亡・転倒・怯み ----
    if (resting || this.capT > 0) {
      // 眠る: 腹ばいに沈み、首を下ろして目を閉じる。ゆっくり息をする。
      const e1 = smoothstep(this.capT / 1.4), e2 = smoothstep((this.capT - 0.8) / 1.6);
      P.y = -0.34 * e1;
      P.roll = 0.08 * e2;
      P.pitch = 0;
      P.neckPitch = 0.42 * e1;
      P.headPitch = 0.3 * e2;
      P.neckYaw = 0.25 * e2;
      P.jaw = 0.04;
      P.lid = Math.max(P.lid, e1);
      P.tailLift = -0.25 * e1;
      P.tailWag = 0;
      P.look = 0;
    } else if (m.dead) {
      // ひざが折れて沈み、横倒しになる。最後に息を吐く。
      const e1 = smoothstep(m.deadTicks / 30), e2 = smoothstep((m.deadTicks - 22) / 50), e3 = smoothstep((m.deadTicks - 70) / 60);
      P.roll = 1.3 * e2;
      P.y = -0.5 * e1 * (1 - e2) + 0.1 * e2;
      P.x = -0.45 * e2;
      P.z = 0;
      P.pitch = 0;
      P.neckPitch = 0.35 * e1;
      P.headPitch = 0.25 * e1;
      P.headRoll = -0.3 * e2;
      P.jaw = 0.42 * e1 * (1 - 0.5 * e3);
      P.tongue = 0.8 * e2;
      P.breath = -0.03 * e3;
      P.lid = Math.max(0.3, e3);
      P.tailLift = -0.3 * e1;
      P.tailWag = 0;
      P.look = 0;
      limp = e2;
    } else if (m.staggerTicks > 0 && m.staggerTotal > 0) {
      const u = 1 - m.staggerTicks / m.staggerTotal;
      if (m.staggerKind === 'topple') {
        // 横倒しになってもがき、最後に体を起こす。倒れる向き（右 = −X 側が下）と、もがく動きの時刻は、戦闘の状態（怯みの経過 tick）だけで決まる
        // （v0.36.0。#12 の M3: 部位の判定の表を同じ状態から作る。描画の時計・前のフレームでは決めない）
        const k = smoothstep(u / 0.12) * (1 - smoothstep((u - 0.82) / 0.18));
        const st = this.staggerSec(m, c.alpha);
        const struggle = Math.sin(st * 5.5);
        kickTime = st;
        P.roll += 1.12 * k + 0.07 * k * struggle;
        P.y += 0.12 * k;
        P.x += -0.4 * k;
        P.yaw += 0.05 * k * Math.sin(st * 3.1);
        P.neckPitch += -0.25 * k + 0.2 * k * Math.sin(st * 4.2);
        P.headRoll += -0.35 * k;
        P.neckYaw += 0.3 * k * Math.sin(st * 2.6);
        P.jaw += 0.38 * k + 0.1 * k * struggle;
        P.tongue += 0.5 * k;
        P.tailWag = 5;
        P.tailLift += 0.2 * k * struggle;
        P.rattle = Math.max(P.rattle, 0.4 * k + gauss(u, 0.1, 0.04));
        P.look = 0;
        limp = k;
        kick = k;
      } else {
        const k = 1 - smoothstep(u);
        P.pitch += -0.14 * k;
        P.neckPitch += -0.26 * k;
        P.headPitch += -0.14 * k;
        P.z += -0.18 * k;
        P.jaw += 0.4 * k;
        P.jitter += 0.03 * k;
        P.tailLift += 0.3 * k;
        P.rattle = Math.max(P.rattle, k);
        P.look = 0.3;
      }
    }
    // ---- 状態異常（v0.33.0）: 麻痺は固まって細かく震える。気絶は横倒しになって、首がふらつく（睡眠は上の「眠る」）----
    const ail = m.ailments.ticks;
    if (!m.dead && !resting && ail.para > 0) {
      P.roll += 0.04 * Math.sin(time * 47);
      P.pitch += 0.02 * Math.sin(time * 41 + 1);
      P.neckYaw += 0.1 * Math.sin(time * 39 + 2);
      P.jaw += 0.35;
      P.jitter += 0.04;
      P.tailWag = 0;
      P.look = 0;
    }
    const stunT = !m.dead && !resting && ail.stun > 0 ? 1 : 0;
    this.stunW += (stunT - this.stunW) * (1 - Math.exp(-dt * (stunT ? 6 : 3)));
    if (this.stunW > 0.001) {
      const k = smoothstep(this.stunW);
      P.roll += 1.12 * k;
      P.y += 0.12 * k;
      P.x += -0.4 * k;
      P.neckPitch += -0.25 * k;
      P.headRoll += -0.35 * k;
      // 首のふらつきは、気絶の残りの tick で決める（v0.36.0。戦闘の判定の表と同じ。STUN_LOOP tick でひと回り）
      P.neckYaw += 0.3 * k * Math.sin((2 * Math.PI * ail.stun) / STUN_LOOP);
      P.jaw += 0.3 * k;
      P.tongue += 0.4 * k;
      P.lid = Math.max(P.lid, 0.6 * k);
      P.tailWag = 0;
      P.look = 0;
      limp = Math.max(limp, k);
    }

    // ---- 歩きに合わせた体の揺れ（足の上げ下げと前後から求める） ----
    let chestSwing = 0, pelvisSwing = 0;
    if (this.started && limp < 0.5) {
      const fwdOf = (l: Leg): number => {
        const hx = pos.x + l.home.x * cy + l.home.z * sy, hz = pos.z - l.home.x * sy + l.home.z * cy;
        return (l.cur.x - hx) * sy + (l.cur.z - hz) * cy;
      };
      let stepLift = 0, stepRoll = 0, frontLift = 0;
      for (const l of this.legs) {
        const up = l.t < 1 ? Math.sin(Math.PI * l.t) : 0;
        stepLift += up;
        stepRoll += up * l.side;
        if (l.front) frontLift += up;
      }
      chestSwing = clamp(-0.12 * (fwdOf(this.legs[0]!) - fwdOf(this.legs[1]!)), -0.15, 0.15);
      pelvisSwing = clamp(-0.12 * (fwdOf(this.legs[2]!) - fwdOf(this.legs[3]!)), -0.15, 0.15);
      P.y += 0.024 * stepLift;
      P.roll += 0.026 * stepRoll;
      // 前脚が浮いている間は肩が下がり、頭が小さくうなずく
      P.archF += 0.03 * frontLift;
      P.neckPitch += 0.03 * frontLift;
    }
    P.y += 0.06 * gallop * Math.sin(this.runPhase * 2 + 0.6);
    P.pitch += 0.045 * gallop * Math.sin(this.runPhase + 1.2);
    if (weak && speed > 0.3 && this.legs[2]!.t < 1) {
      // 足を引きずる: 左後ろ脚をかばって腰が沈む
      P.roll += 0.05;
      P.y -= 0.04;
    }
    // 向きを変える時は、背骨が曲がる（頭と尻が内側へ）
    const turnBend = clamp(this.yawVel * 0.13, -0.17, 0.17);
    P.bendF += turnBend;
    P.bendR -= turnBend;

    // ---- のけぞり・岩板の揺れ ----
    P.x += this.kickX.step(dt) * 0.16;
    P.z += this.kickZ.step(dt) * 0.16;
    P.roll += this.kickRoll.step(dt) * 0.09;
    P.pitch += this.kickPitch.step(dt) * 0.08;
    P.headYaw += clamp(this.headKickYaw.step(dt) * 0.09, -0.5, 0.5);
    P.headPitch += clamp(this.headKickPitch.step(dt) * 0.08, -0.4, 0.4);
    const tailKick = clamp(this.tailKick.step(dt) * 0.08, -0.6, 0.6);
    this.rattle = Math.max(this.rattle * Math.exp(-dt * 5), P.rattle);

    // ---- 狩人を目で追う（頭の判定からずれないよう、向ける角度は小さくする） ----
    let wantYaw = 0, wantPitch = 0;
    if (c.lookAt && P.look > 0 && m.aware) {
      const hx = pos.x + 1.9 * sy, hz = pos.z + 1.9 * cy;
      const dx = c.lookAt.x - hx, dz = c.lookAt.z - hz;
      const lx = dx * cy - dz * sy, lz = dx * sy + dz * cy;
      const dist = Math.hypot(lx, lz);
      if (dist > 0.6) {
        wantYaw = clamp(Math.atan2(lx, lz), -0.45, 0.45) * P.look;
        wantPitch = clamp(Math.atan2(1.6 - (c.lookAt.y + 1.1), dist), -0.22, 0.26) * P.look;
      }
    } else if (P.look > 0) wantYaw = clamp(this.yawVel * 0.28, -0.4, 0.4) * P.look;
    this.lookYaw += (wantYaw - this.lookYaw) * (1 - Math.exp(-dt * 7));
    this.lookPitch += (wantPitch - this.lookPitch) * (1 - Math.exp(-dt * 7));

    // ================= 骨へ書く =================
    const body = B[BODY]!;
    const jit = P.jitter;
    body.position.set(P.x + (jit ? Math.sin(time * 61) * jit : 0), BODY_Y + P.y + (jit ? Math.sin(time * 47) * jit * 0.6 : 0), P.z);
    body.rotation.set(P.pitch, P.yaw, P.roll);
    const fYaw = P.bendF + chestSwing, rYaw = P.bendR + pelvisSwing;
    B[THORAX]!.rotation.set(P.archF * 0.5, fYaw * 0.5, 0);
    B[CHEST]!.rotation.set(P.archF * 0.5, fYaw * 0.5, 0);
    B[LUMBAR]!.rotation.set(P.archR * 0.5, rYaw * 0.5, 0);
    B[PELVIS]!.rotation.set(P.archR * 0.5, rYaw * 0.5, 0);
    // 胸郭: 左右の骨（v0.36.0）。横倒しの時は、上になった側が大きく息をし、下の側は押されて小さい（立っている時は左右同じで v0.35.0 と同じ）
    const lean = clamp(P.roll / 1.12, -1, 1);
    for (const [b, h] of [[RIBS_L, 1 + 0.5 * lean], [RIBS_R, 1 - 0.5 * lean]] as const) B[b]!.scale.set(1 + P.breath * h, 1 + P.breath * 0.6 * h, 1 + P.breath * 0.15 * h);
    // 首と頭: 胸の左右の揺れを打ち消して、頭は狙った向きを保つ
    const neckYaw = P.neckYaw + this.lookYaw * 0.6 - chestSwing * 0.7;
    const neckPitch = P.neckPitch + this.lookPitch * 0.5 - P.archF * 0.5;
    B[NECK1]!.rotation.set(neckPitch * 0.5, neckYaw * 0.55, 0);
    B[NECK2]!.rotation.set(neckPitch * 0.5, neckYaw * 0.45, 0);
    B[HEAD]!.rotation.set(P.headPitch + this.lookPitch * 0.5, P.headYaw + this.lookYaw * 0.4, P.headRoll - this.lookYaw * 0.12);
    B[JAW]!.rotation.x = Math.max(0, P.jaw);
    B[TONGUE]!.rotation.set(-0.35 * P.tongue + 0.1 * P.tongue * Math.sin(time * 23), 0.15 * P.tongue * Math.sin(time * 17), 0);
    B[TONGUE]!.position.z = 0.36 + 0.1 * P.tongue;
    this.lid += (P.lid - this.lid) * (1 - Math.exp(-dt * 30));
    for (let i = 0; i < 2; i++) B[GALDROS_LIDS[i]!]!.quaternion.setFromAxisAngle(LID_AXIS[i]!, 0.95 * this.lid);
    // 舌の先（v0.36.0）: 舌を出している間だけ、先が反って揺れる
    B[TONGUE2]!.rotation.set(-0.5 * P.tongue * (0.7 + 0.3 * Math.sin(time * 19 + 0.7)), 0.2 * P.tongue * Math.sin(time * 13), 0);
    // 岩板の揺れ
    const rat = Math.min(1.5, this.rattle);
    for (let i = 0; i < PLATE_N; i++) {
      B[GALDROS_PLATES[i]!]!.rotation.set(rat * 0.05 * Math.sin(time * 41 + i * 2.1), rat * 0.03 * Math.sin(time * 37 + i), rat * 0.055 * Math.sin(time * 45 + i * 1.3));
    }

    // ---- 尾 ----
    // 尾払いの間は、判定と同じ向きへ付け根から振る（ほぼまっすぐ）。それ以外は、付け根の向きに遅れて付いてくる。
    this.tailDrive += (tailDriveTarget - this.tailDrive) * (1 - Math.exp(-dt * 24));
    if (tailDriveTarget > 0.5) this.tailDrive = Math.max(this.tailDrive, 0.7);
    const drv = this.tailDrive;
    const tailRate = dt > 1e-4 ? wrapPi(tailYaw - this.lastTailYaw) / dt : 0;
    this.lastTailYaw = tailYaw;
    // 振っている間、先の節はわずかに遅れる（判定から大きくは外さない）
    const trail = clamp(tailRate * 0.0025, -0.035, 0.035);
    let prevHeading = yaw + P.yaw + rYaw;
    for (let i = 0; i < TAIL_N; i++) {
      const bone = B[GALDROS_TAIL[i]!]!;
      if (i === CUT) {
        // 切断面の関節は曲げない（曲げると、重ねてある断面の輪がずれて見える）
        bone.rotation.set(0, 0, 0);
        this.tailHeading[i] = prevHeading;
        continue;
      }
      const sway = (m.dead ? 0 : P.tailWag) * (0.04 + 0.014 * i) * Math.sin(time * 1.3 - i * 0.6) + tailKick * (0.15 + 0.12 * i);
      let h = this.tailHeading[i]!;
      h += wrapPi(prevHeading - h) * (1 - Math.exp(-dt * Math.max(7, 24 - 2.4 * i)));
      let local = clamp(wrapPi(h - prevHeading), -0.5, 0.5) + sway;
      const driven = i === 0 ? -tailYaw * 0.84 - rYaw : i === 1 ? -tailYaw * 0.11 + trail : i === 2 ? -tailYaw * 0.05 + trail : trail;
      local += (driven - local) * drv;
      const lift = P.tailLift * [0.28, 0.2, 0.16, 0.12, 0, 0.1, 0.09, 0.08][i]!;
      const droop = m.dead ? -0.03 : 0.015 * Math.sin(time * 0.9 - i * 0.5) * (1 - drv);
      bone.rotation.set((i === 0 ? drv * (tailPitch + REST_TAIL_PITCH) : 0) + lift * (1 - drv) + droop, local, 0);
      prevHeading += local;
      this.tailHeading[i] = drv > 0.5 ? prevHeading : h;
    }

    // ================= 脚: 足首の置き場所を決めてから、ひじ・ひざを解く =================
    this.root.updateMatrixWorld(true);
    // 眼（v0.36.0）: 頭の向きが決まった後に、まぶたと別に向ける
    this.aimEyes(m, c, P, time, dt, resting);
    const rootQ = this.root.quaternion;
    const bodyQ = body.getWorldQuaternion(this.q5);
    // 先読みは 0.3m まで（突進の速さでそのまま掛けると足が体の前へ飛び出す）
    const leadK = speed > 1e-3 ? Math.min(0.1, 0.3 / speed) : 0;
    const leadX = this.vel.x * leadK, leadZ = this.vel.z * leadK;
    const airborne = this.legs.map((l) => l.t < 0.55);
    this.legs.forEach((l, i) => {
      const hipW = l.upper.getWorldPosition(this.v1);
      const parentQ = l.upper.parent!.getWorldQuaternion(this.q1);
      // 自然に立った時の足の位置（踏ん張る時は外へ広げる）
      const hxL = l.home.x + l.side * P.spread, hzL = l.home.z;
      const home = this.v2.set(pos.x + hxL * cy + hzL * sy + leadX, ground, pos.z - hxL * sy + hzL * cy + leadZ);
      const target = this.v3;
      const dragging = weak && i === 2;
      let footPitch = 0;
      let follow = 26;
      let loose = false;
      let landed = false;
      if (l.fresh || !this.started) {
        l.plant.copy(home);
        l.t = 1;
        l.plantYaw = yaw;
      }
      if (limp > 0.5) {
        // 倒れている: 脚は体に付いて投げ出される。転倒中は交互に蹴ってもがく。
        const k1 = Math.sin(kickTime * 6.2 + i * 1.9), k2 = Math.sin(kickTime * 4.3 + i * 2.7);
        const len = (l.l1 + l.l2) * (0.72 + 0.16 * kick * k1);
        target.copy(l.restDown).applyQuaternion(bodyQ).multiplyScalar(len).add(hipW);
        target.addScaledVector(this.v4.set(0, 0, 1).applyQuaternion(bodyQ), (l.front ? 0.18 : -0.18) + 0.3 * kick * k2);
        loose = true;
        follow = 14;
        l.t = 1;
      } else if (i === slamLeg) {
        target.copy(slamTarget).applyMatrix4(this.root.matrixWorld);
        follow = 70;
        footPitch = -0.3;
        l.t = 1;
        l.plant.set(target.x, ground, target.z);
      } else if (i === pawLeg) {
        const s = Math.sin(pawT * 0.42), cs = Math.cos(pawT * 0.42);
        target.copy(home).addScaledVector(this.v4.set(sy, 0, cy), 0.34 * s * pawAmp);
        target.y = ground + ANKLE_H + 0.16 * Math.max(0, cs) * pawAmp;
        footPitch = 0.3 * s * pawAmp;
        l.t = 1;
        l.plant.set(target.x, ground, target.z);
        // 掻いた土が後ろへ飛ぶ
        if (s < -0.92 && cs < 0 && pawAmp > 0.4) c.fx?.puff(target.x, ground + 0.15, target.z, 1);
      } else {
        if (this.wasLimp) {
          l.plant.copy(home);
          l.plantYaw = yaw;
        }
        const err = Math.hypot(l.plant.x - home.x, l.plant.z - home.z);
        if (l.t >= 1) {
          const stretched = hipW.distanceTo(this.v4.set(l.plant.x, ground + ANKLE_H, l.plant.z)) > (l.l1 + l.l2) * 0.985;
          // 対角の 2 本が組になって交互に出る。相手の組が浮いている間は待つ。
          const mate = 3 - i;
          const othersUp = airborne.some((up, j) => up && j !== i && j !== mate);
          const threshold = (l.front ? 0.16 : 0.2) + (speed < 0.3 ? 0.1 : 0);
          if (err > 2.2) {
            l.plant.copy(home);
            l.plantYaw = yaw;
          } else if (stretched || (err > threshold && !othersUp)) {
            l.from.copy(l.plant);
            l.fromYaw = l.plantYaw;
            l.dur = Math.max(0.11, 0.3 - speed * 0.04) * (dragging ? 1.5 : 1);
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
          l.plant.set(target.x, ground, target.z);
          if (l.t >= 1) landed = true;
          // 弱っている時は、左後ろ脚を上げ切れずに引きずる
          target.y = ground + ANKLE_H + up * Math.min(0.34, 0.17 + speed * 0.012) * (dragging ? 0.25 : 1);
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
            const stance = Math.sin(ph) > 0;
            if (stance && !l.stance) landed = true;
            l.stance = stance;
            l.t = 1;
            l.plant.set(rx, ground, rz);
            follow = 200;
          }
        }
      }
      if (landed) {
        l.plantYaw = yaw;
        l.splay = 1;
        c.fx?.footfall(l.plant.x, ground, l.plant.z, clamp(0.45 + speed * 0.09, 0.4, 1.4));
        this.rattle = Math.max(this.rattle, 0.22 + gallop * 0.4);
      }
      if (l.fresh || !this.started) l.cur.copy(target);
      else l.cur.lerp(target, 1 - Math.exp(-dt * (dragging && !loose ? Math.min(follow, 11) : follow)));
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
      // 足の裏: 接地中は地面に平行。倒れている時は脚に付いていく。踏み切りでは、かかとが上がって指が反る。
      // 足の向き（v0.36.0）: 接地している間は、体が向きを変えても踏み直すまで向きを保ち（趾が地面を滑らない）、踏み出しの間に体の向きへ寄せる。
      // 打ち付ける脚・地面を掻く脚・駆け足・倒れている時は、体の向きのまま（v0.35.0 と同じ）
      let footYaw = yaw;
      if (!loose && i !== slamLeg && i !== pawLeg && gallop <= 0.5) {
        const lag = wrapPi(yaw - l.plantYaw);
        if (Math.abs(lag) > 0.6) l.plantYaw = yaw - Math.sign(lag) * 0.6;
        footYaw = l.t >= 1 ? l.plantYaw : l.fromYaw + wrapPi(yaw - l.fromYaw) * smoothstep(l.t);
      } else l.plantYaw = yaw;
      const qF = loose ? this.q4.copy(qL) : this.q4.copy(rootQ).multiply(_q.setFromAxisAngle(Y, wrapPi(footYaw - yaw))).multiply(_q.setFromAxisAngle(X, footPitch));
      l.foot.quaternion.copy(qL).invert().multiply(qF);
      l.toe.rotation.x = loose ? 0.25 * Math.sin(time * 7 + i) * kick : -Math.max(0, footPitch) * 0.85;
      // ねじれの骨（v0.36.0）: 足のねじれ（下の節の軸まわりの回転）の半分。ひじ・ひざから足首までの皮に、ねじれを配る
      const qr = l.foot.quaternion, ax = l.axisL;
      l.twist.quaternion.setFromAxisAngle(ax, 0.5 * wrapPi(2 * Math.atan2(qr.x * ax.x + qr.y * ax.y + qr.z * ax.z, qr.w)));
      // 趾（v0.36.0）: 踏み出しの間は曲げて縮め、着地で開いて戻る。打ち付ける脚は爪を立てて開く。倒れている・眠る時は力なく曲がる
      const swingK = l.t < 1 ? Math.sin(Math.PI * l.t) : 0;
      l.splay *= Math.exp(-dt * 5);
      let curl = 0.32 * swingK, spread = 0.07 * l.splay;
      if (gallop > 0) curl += (0.3 * Math.max(0, -Math.sin(this.runPhase + [0, 0.7, 3.3, 4.0][i]!)) - curl) * gallop;
      if (loose) {
        curl = 0.35 + 0.15 * Math.sin(kickTime * 5 + i * 1.7) * kick;
        spread = 0;
      } else if (i === slamLeg) {
        curl = -0.28;
        spread = 0.12;
      } else if (resting) curl = Math.max(curl, 0.22);
      l.digits.forEach((d, j) => d.rotation.set(curl, l.digitSide[j]! * spread * l.side, 0));
      l.spur?.rotation.set(0.25 * swingK, 0, 0);
    });
    // ひじ・ひざの補正形状の強さ（v0.36.0）: 下の節の、上の節に対する回転の量から（基準の姿勢で 0）
    const infl = this.hideMesh.morphTargetInfluences!;
    this.legs.forEach((l, i) => {
      const delta = 2 * Math.acos(Math.min(1, Math.abs(l.lower.quaternion.w)));
      infl[i] = bendFix(delta) / bendFix(BEND_REF);
    });
    // 肩甲（v0.36.0）: 上腕の前後の振りの 3 割で傾き、前後に少し滑る。開けば外へ傾く（肩のふくらみだけを曲げる枝の骨。脚の付け根の位置は変えない）
    for (let i = 0; i < 2; i++) {
      const l = this.legs[i]!;
      const d = this.v1.copy(l.restU).applyQuaternion(l.upper.quaternion);
      const swing = Math.atan2(d.z, -d.y) - Math.atan2(l.restU.z, -l.restU.y);
      const abd = (Math.asin(clamp(d.x, -1, 1)) - Math.asin(clamp(l.restU.x, -1, 1))) * l.side;
      const sc = B[GALDROS_SCAPULAE[i]!]!;
      sc.rotation.set(-0.3 * swing, 0, 0.25 * abd * l.side);
      sc.position.copy(this.scapRest[i]!).add(this.v2.set(0, -0.03 * Math.abs(swing), 0.07 * swing));
    }
    this.wasLimp = limp > 0.5;
    this.started = true;
  }
}
