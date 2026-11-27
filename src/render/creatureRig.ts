// 大型 11 種（登録簿の 02〜12）と幼体 8 種（14〜21。v0.18.0）の仮モデル（v0.17.0。D-078）。設計図（src/render/creaturePlans.ts）から、骨の通った 1 枚の面を作り、
// 原画を真横から貼る。動きはすべて描画側の計算で、戦闘の判定には影響しない（判定は技データの軌道が持つ）。
//   - 同じ種の体（面の形）は 1 回だけ作って、群れの仲間で使い回す（骨は 1 頭ずつ）。部位が壊れた個体だけ、面を写して暗くする。
//   - 幼体は、親の絵を淡くして貼る（plan.look）。群れの気分（src/game/herd.ts）で、頭を下げて食む・顔を上げて見る・伏せる。
//   - 背骨・脚は「筒」。輪ごとに、近い 2 本の骨へ重みを分けて、関節でなめらかに曲がる。
//   - 角膜・翼・帆・嚢などは、骨を 1 本持つ「板・塊」。技の値（src/render/creatureMoves.ts）で開く・ふくらむ。
//   - 歩く: 進んだ距離で足の周期を進める。v0.25.0 から、前後に振る脚は、支えている間の足先を地面に留める（plantFeet。描画だけ）。
//     v0.65.0 から、足を踏み替える向き直りの技（判定の無い spin）の間も、回った量で周期を進めて足を留め、足音を出す。
//   - 怯み・転倒・眠り・罠・死は、体の高さ・傾き・脚の折り方で表す。
//   - 顎（v0.25.0）: 四足・二足・長胴は、頭の下の側に顎の骨があり、咆哮・威嚇・噛む技で口を開ける（口の中は暗い面）。
// 形・色・動きは、原画 1 枚から作った仮素材。正式モデル（GLB）が来たら置き換える。
import {
  Bone, BufferGeometry, Color, Euler, Float32BufferAttribute, Group, MeshStandardMaterial, NoColorSpace, RepeatWrapping, SRGBColorSpace, Quaternion, ShapeUtils, Skeleton, SkinnedMesh, type Texture, TextureLoader, Uint16BufferAttribute, Vector2, Vector3,
} from 'three';
import { assetUrl } from '../core/assets';
import { angleDiff, smoothstep } from '../core/math';
import { renderTick } from '../game/action';
import { isGrazing, isWatching } from '../game/herd';
import { isWeak, type MonsterState } from '../game/monster';
import { sampleCurve } from '../game/tracks';
import { CREATURE_ART, type CreatureArt } from './creatureArt';
import { addScaled, sampleKeyList, sampleMove, type Pose } from './creatureMoves';
import type { CreaturePlan, ExtraPlan, FidgetPlan, LegPlan } from './creaturePlan';
import type { MonsterRig, MonsterRigCtx } from './monsterRig';

const TAU = Math.PI * 2;
/** 気絶の首のふらつきのひと回り（tick。v0.67.0。ガルドロスの STUN_LOOP と同じ長さ。部位の追従の表もこの長さで繰り返す） */
export const CREATURE_STUN_LOOP = 164;
/** 転がる技が突進の制動で止まった時に、輪を元の向きへ揺り戻す長さ（tick。v0.68.0） */
const ROLL_SETTLE_TICKS = 18;

/**
 * 弱って足を引きずって歩く時か（v0.72.0。#19 の M05。D-170。描画だけ）: 弱って（`roam.limping`）巣へ向かう・エリアを出る・寝床へ歩く間。
 * 気づいた相手と同じエリアで戦っている間は、引きずらない（2G の弱った大型は、逃げる時に足を引きずる）。技・怯み・眠り・死の間も除く
 */
export function limpGait(m: MonsterState): boolean {
  const r = m.roam;
  return !!r?.limping && (r.state === 'leave' || !m.aware) && !m.action && !m.dead && !m.asleep && m.staggerTicks <= 0;
}
/** 引きずる脚に体重が乗る時に、腰がその脚の側へ傾く大きさの上限（rad。値は Kari の仮の値） */
const LIMP_ROLL = 0.12;
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
/** 体の面の細かさ（v0.21.0 で、なめらかに）: 背骨の輪の点の数と、輪の間隔 (m)。脚も同じ */
const SPINE_SEG = 28;
const SPINE_STEP = 0.05;
const LEG_SEG = 16;
const LEG_STEP = 0.04;

/** 頂点の骨の影響（骨の番号、重み） */
type Inf = [number, number][];

class Buf {
  pos: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  si: number[] = [];
  sw: number[] = [];
  idx: number[] = [];
  get count(): number {
    return this.pos.length / 3;
  }
  vert(p: Vector3, uv: [number, number], shade: number, inf: Inf): number {
    this.pos.push(p.x, p.y, p.z);
    this.uv.push(uv[0], uv[1]);
    this.col.push(shade, shade, shade);
    const top = [...inf].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = top.reduce((s, x) => s + x[1], 0) || 1;
    for (let k = 0; k < 4; k++) {
      this.si.push(top[k]?.[0] ?? 0);
      this.sw.push(top[k] ? top[k]![1] / sum : 0);
    }
    return this.count - 1;
  }
  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }
  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new Float32BufferAttribute(this.col, 3));
    g.setAttribute('skinIndex', new Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new Float32BufferAttribute(this.sw, 4));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

/** 骨の領域（背骨・脚の上の長さの範囲）。隣との境目で、なめらかに重みを分ける。 */
interface Region {
  bone: number;
  lo: number;
  hi: number;
}

function regionWeights(u: number, regions: readonly Region[], blend: number): Inf {
  const out: Inf = [];
  const s = (x: number): number => clamp(0.5 + 0.5 * x, 0, 1);
  for (const r of regions) {
    const w = (r.lo === -Infinity ? 1 : s((u - r.lo) / blend)) * (r.hi === Infinity ? 1 : s((r.hi - u) / blend));
    if (w > 1e-4) out.push([r.bone, w]);
  }
  return out.length ? out : [[regions[0]!.bone, 1]];
}

/** 3 次の補間（Catmull-Rom）で、点の列をなめらかにたどる */
function catmull(p0: Vector3, p1: Vector3, p2: Vector3, p3: Vector3, t: number): Vector3 {
  const t2 = t * t, t3 = t2 * t;
  const f = (a: number, b: number, c: number, d: number): number => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return new Vector3(f(p0.x, p1.x, p2.x, p3.x), f(p0.y, p1.y, p2.y, p3.y), f(p0.z, p1.z, p2.z, p3.z));
}

interface Sample {
  c: Vector3;
  /** 点の列の中の位置（i + 0〜1） */
  at: number;
  /** 長さ (m) */
  u: number;
}

function samplePath(pts: readonly Vector3[], step: number): Sample[] {
  const out: Sample[] = [];
  let u = 0;
  let prev: Vector3 | null = null;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]!, p1 = pts[i]!, p2 = pts[i + 1]!, p3 = pts[Math.min(pts.length - 1, i + 2)]!;
    const n = clamp(Math.ceil(p1.distanceTo(p2) / step), 2, 40);
    for (let k = i === 0 ? 0 : 1; k <= n; k++) {
      const c = catmull(p0, p1, p2, p3, k / n);
      if (prev) u += prev.distanceTo(c);
      out.push({ c, at: i + k / n, u });
      prev = c;
    }
  }
  return out;
}

interface BoneRec {
  bone: Bone;
  world: Vector3;
  rest: Vector3;
  kind: 'root' | 'spine' | 'leg' | 'own';
  role: string;
  /** 背骨の点の番号 / 脚の関節の番号 */
  index: number;
  side: number;
  ch?: string;
  /** 帆の並び（前から） */
  order?: number;
}

interface LegRec {
  plan: LegPlan;
  side: number;
  bones: number[];
  phase: number;
  length: number;
  /** 付け根から足先までの高さ（形を作った時。v0.25.0。歩く振り幅に使う） */
  reach: number;
}

interface PartRange {
  buf: 'main' | 'glow';
  from: number;
  to: number;
  own: number[];
}

/** 原画 1 枚から作った、骨の通った体（形の部分）。 */
class CreatureBody {
  readonly bones: BoneRec[] = [];
  readonly legs: LegRec[] = [];
  readonly main = new Buf();
  readonly glow = new Buf();
  /** 目（v0.21.0）: 濡れて光る、別の材質 */
  readonly eye = new Buf();
  readonly parts = new Map<string, PartRange[]>();
  /** 背骨の骨のある点の番号 → 骨の番号 */
  readonly spineBone = new Map<number, number>();
  readonly own = new Map<string, number>();
  spinePts: Vector3[] = [];
  spineRegions: Region[] = [];
  spineSamples: Sample[] = [];
  /** 体の高さ（根元の骨の高さ） */
  height = 1;
  /** 背骨の長さ */
  length = 1;
  private blend = 0.2;

  /** 体の筒（背骨）の頂点の数（main の最初から）と、その頂点が胴（1）か、首・頭・尾（0）か。横たわる姿勢の高さ合わせと検査で使う */
  spineVerts = 0;
  torsoVert = new Uint8Array(0);

  /** 体を支える頂点（胴の筒と、胴の大きな塊 = 袋・甲羅・嚢、胴に付いた塊）。横たわる姿勢では、ここの下を地面に着ける */
  support = new Uint8Array(0);
  private readonly blobRanges: [number, number][] = [];
  /**
   * 顎の骨（v0.25.0。ChatGPT の設計提案 #6 の「顎の可動経路」）。頭（役 h）の後ろに続く点がある四足・二足・長胴だけ。無ければ -1。
   * 頭の点の少し下を蝶番にして、頭から鼻先までの筒の下の側（口の線より下）を、この骨へ重み付けする。
   */
  jawBone = -1;
  private jawAt = -1;
  /** 口の中の面（暗い色。口を開けると、上下の間に伸びて見える）の三角形の数 */
  mouthTris = 0;

  constructor(readonly plan: CreaturePlan, readonly art: CreatureArt) {
    this.buildBones();
    this.buildSpine();
    this.spineVerts = this.main.count;
    for (const leg of this.legs) this.buildLeg(leg);
    for (const e of plan.extras) this.buildExtra(e);
    this.weightJaw();
    const n = this.main.count;
    this.support = new Uint8Array(n);
    this.support.set(this.torsoVert);
    for (let i = this.spineVerts; i < n; i++) {
      const b = this.bones[this.mainBone(i)]!;
      if (b.kind === 'own' && SUPPORT_CH.has(b.ch ?? '')) this.support[i] = 1;
    }
    // 胴に付いた塊（房・節など）も、胴の一部として地面に着ける
    for (const [a, b] of this.blobRanges) {
      for (let i = a; i < b; i++) {
        const r = this.bones[this.mainBone(i)]!;
        if (r.kind === 'spine' && (r.index === plan.root || r.role === 'b' || r.role === 'a')) this.support[i] = 1;
      }
    }
  }

  /** main の頂点 i を、いちばん強く動かす骨 */
  mainBone(i: number): number {
    let best = 0, bw = -1;
    for (let k = 0; k < 4; k++) {
      const w = this.main.sw[i * 4 + k]!;
      if (w > bw) { bw = w; best = this.main.si[i * 4 + k]!; }
    }
    return best;
  }

  private hulls: Map<number, Vector3[]> | null = null;
  /**
   * 骨ごとの、形の端の点（その骨が動かす頂点のうち、14 の向きでいちばん外の点。動かす前の位置）。
   * 横たわる間、脚や翼が地面へ潜っていないかを、安く測る（v0.21.0）
   */
  hull(bi: number): readonly Vector3[] {
    if (!this.hulls) {
      const dirs: Vector3[] = [];
      for (const d of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) dirs.push(new Vector3(d[0], d[1], d[2]));
      for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) dirs.push(new Vector3(x, y, z).normalize());
      const best = new Map<number, { d: number; i: number }[]>();
      const pos = this.main.pos;
      for (let i = 0; i < this.main.count; i++) {
        const b = this.mainBone(i);
        let row = best.get(b);
        if (!row) {
          row = dirs.map(() => ({ d: -Infinity, i: -1 }));
          best.set(b, row);
        }
        const x = pos[i * 3]!, y = pos[i * 3 + 1]!, z = pos[i * 3 + 2]!;
        dirs.forEach((dv, k) => {
          const d = dv.x * x + dv.y * y + dv.z * z;
          if (d > row[k]!.d) row[k] = { d, i };
        });
      }
      this.hulls = new Map();
      for (const [b, row] of best) {
        const ids = [...new Set(row.map((r) => r.i))];
        this.hulls.set(b, ids.map((i) => new Vector3(pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!)));
      }
    }
    return this.hulls.get(bi) ?? [];
  }

  /** 原画の px → モンスターの座標 (m) */
  m(px: number, py: number, x = 0): Vector3 {
    const s = this.plan.scale;
    return new Vector3(x, (this.plan.origin[1] - py) * s, (px - this.plan.origin[0]) * s);
  }
  /** モンスターの座標 → 原画の uv（横から貼る） */
  uvOf(p: Vector3): [number, number] {
    const s = this.plan.scale;
    const px = this.plan.origin[0] + p.z / s, py = this.plan.origin[1] - p.y / s;
    const [x0, y0, x1, y1] = this.art.crop;
    return [(px - x0) / (x1 - x0), 1 - (py - y0) / (y1 - y0)];
  }

  private addBone(world: Vector3, parent: number | null, rec: Omit<BoneRec, 'bone' | 'world' | 'rest'>): number {
    const bone = new Bone();
    const rest = parent === null ? world.clone() : world.clone().sub(this.bones[parent]!.world);
    bone.position.copy(rest);
    if (parent !== null) this.bones[parent]!.bone.add(bone);
    this.bones.push({ bone, world: world.clone(), rest, ...rec });
    return this.bones.length - 1;
  }

  private buildBones(): void {
    const p = this.plan;
    this.addBone(new Vector3(), null, { kind: 'root', role: 'root', index: -1, side: 0 });
    this.spinePts = p.spine.map((q) => this.m(q[0], q[1]));
    const has = (i: number): boolean => i === p.root || p.roles[i] !== '-';
    // 根元 → 頭の側、根元 → 尾の側の順に、骨を作る
    this.spineBone.set(p.root, this.addBone(this.spinePts[p.root]!, 0, { kind: 'spine', role: p.roles[p.root] === '-' ? 'b' : p.roles[p.root]!, index: p.root, side: 0 }));
    let parent = this.spineBone.get(p.root)!;
    for (let i = p.root + 1; i < p.spine.length; i++) {
      if (!has(i)) continue;
      parent = this.addBone(this.spinePts[i]!, parent, { kind: 'spine', role: p.roles[i]!, index: i, side: 0 });
      this.spineBone.set(i, parent);
    }
    parent = this.spineBone.get(p.root)!;
    for (let i = p.root - 1; i >= 0; i--) {
      if (!has(i)) continue;
      parent = this.addBone(this.spinePts[i]!, parent, { kind: 'spine', role: p.roles[i]!, index: i, side: 0 });
      this.spineBone.set(i, parent);
    }
    this.height = Math.max(0.3, this.spinePts[p.root]!.y);
    // 脚: 関節ごとに 1 本（最後の点も、足先・手先を回す骨）
    for (const lp of p.legs) {
      for (const side of lp.mirror ? [1, -1] : [0]) {
        const bones: number[] = [];
        let par = this.boneForSpine(lp.attach);
        lp.pts.forEach((q, j) => {
          const x = side === 0 ? q[2] : q[2] * side;
          par = this.addBone(this.m(q[0], q[1], x), par, { kind: 'leg', role: lp.group, index: j, side: side === 0 ? Math.sign(q[2]) || 1 : side });
          bones.push(par);
        });
        let length = 0;
        for (let j = 1; j < bones.length; j++) length += this.bones[bones[j]!]!.world.distanceTo(this.bones[bones[j - 1]!]!.world);
        // 右の脚は、左と半周期ずらす（四足は対角の脚がそろう。二足・甲殻は左右が交互）
        const phase = lp.phase + (side < 0 ? 0.5 : 0);
        // 付け根から足先までの高さ（脚を前後に θ 回すと、足先は高さ × sin θ だけ前後へ動く）
        const reach = Math.abs(this.bones[bones[0]!]!.world.y - this.bones[bones[bones.length - 1]!]!.world.y);
        this.legs.push({ plan: lp, side: side === 0 ? Math.sign(lp.pts[0]![2]) || 1 : side, bones, phase, length, reach });
      }
    }
    // 背骨の領域（重みの分け方）
    const samples = samplePath(this.spinePts, SPINE_STEP);
    this.spineSamples = samples;
    this.length = samples[samples.length - 1]!.u;
    const uAt = (i: number): number => samples.find((s) => s.at >= i - 1e-6)?.u ?? 0;
    const J = [...this.spineBone.keys()].sort((a, b) => a - b);
    const r = J.indexOf(p.root);
    this.spineRegions = J.map((i, q) => {
      const bone = this.spineBone.get(i)!;
      if (q < r) return { bone, lo: q === 0 ? -Infinity : uAt(J[q - 1]!), hi: uAt(i) };
      if (q === r) return { bone, lo: q === 0 ? -Infinity : uAt(J[q - 1]!), hi: q === J.length - 1 ? Infinity : uAt(J[q + 1]!) };
      return { bone, lo: uAt(i), hi: q === J.length - 1 ? Infinity : uAt(J[q + 1]!) };
    });
    let minSeg = Infinity;
    for (let q = 1; q < J.length; q++) minSeg = Math.min(minSeg, uAt(J[q]!) - uAt(J[q - 1]!));
    this.blend = clamp(minSeg * 0.35, 0.05, 0.3);
    // 動かす物の骨
    for (const e of p.extras) {
      if (!e.own) continue;
      for (const side of e.mirror ? [1, -1] : [0]) {
        const name = e.own.name + (side > 0 ? '_L' : side < 0 ? '_R' : '');
        if (this.own.has(name)) continue;
        const x = (e.x ?? 0) * (side === 0 ? 1 : side);
        const at = this.m(e.own.at[0], e.own.at[1], x);
        const par = this.resolveBone(e.own.parent, side, at);
        // 並ぶ物（帆 sail0…・嚢 sac0…）は、名前の数字が前からの順
        const order = /(\d+)(?:_[LR])?$/.exec(name)?.[1];
        this.own.set(name, this.addBone(at, par, { kind: 'own', role: e.ch ?? '', index: 0, side: side === 0 ? Math.sign(x) : side, ch: e.ch, order: order ? Number(order) : undefined }));
      }
    }
    // 顎（v0.25.0）: 四足・二足・長胴で、頭（役 h）の点の先に、まだ鼻先の点がある体だけ
    if (p.frame === 'quad' || p.frame === 'biped' || p.frame === 'serpent') {
      let hi = -1;
      for (let i = p.spine.length - 1; i > p.root; i--) {
        if (p.roles[i] === 'h') {
          hi = i;
          break;
        }
      }
      if (hi > 0 && hi < p.spine.length - 1 && this.spineBone.has(hi)) {
        const hinge = this.spinePts[hi]!.clone();
        hinge.y -= p.spine[hi]![3] * p.scale * 0.3;
        this.jawBone = this.addBone(hinge, this.spineBone.get(hi)!, { kind: 'own', role: 'jaw', index: hi, side: 0, ch: 'jaw' });
        this.jawAt = hi;
      }
    }
  }

  /**
   * 顎の重み（v0.25.0）: 頭の点から鼻先までの筒の、口の線（中心より少し下）より下の頂点を、顎の骨へ移す（頭の点から先へ少しずつ）。
   * 口の線をまたぐ三角形は、頂点を写して暗い色にする（口の中。閉じている時は細い線、開けると上下の間に伸びる）。
   */
  private weightJaw(): void {
    if (this.jawBone < 0) return;
    const smp = this.spineSamples;
    const uHinge = smp.find((q) => q.at >= this.jawAt - 1e-6)?.u ?? 0;
    const uNose = smp[smp.length - 1]!.u;
    if (uNose - uHinge < 0.04) return;
    const ramp = Math.max(0.02, (uNose - uHinge) * 0.25);
    const jw = new Float32Array(smp.length * SPINE_SEG);
    const b = this.main;
    for (let k = 0; k < smp.length; k++) {
      const w = clamp((smp[k]!.u - uHinge) / ramp, 0, 1);
      if (w <= 0) continue;
      for (let j = 0; j < SPINE_SEG; j++) {
        if (Math.sin(-Math.PI / 2 + (TAU * j) / SPINE_SEG) >= -0.22) continue;
        const vi = k * SPINE_SEG + j;
        jw[vi] = w;
        const inf: Inf = [];
        for (let q = 0; q < 4; q++) if (b.sw[vi * 4 + q]! > 0) inf.push([b.si[vi * 4 + q]!, b.sw[vi * 4 + q]! * (1 - w)]);
        inf.push([this.jawBone, w]);
        const top = inf.sort((x, y) => y[1] - x[1]).slice(0, 4);
        const sum = top.reduce((a, x) => a + x[1], 0) || 1;
        for (let q = 0; q < 4; q++) {
          b.si[vi * 4 + q] = top[q]?.[0] ?? 0;
          b.sw[vi * 4 + q] = top[q] ? top[q]![1] / sum : 0;
        }
      }
    }
    // 背骨の筒の三角形は、main の最初にある（輪の間 + 両端のふた）
    const nTri = (smp.length - 1) * SPINE_SEG * 2 + SPINE_SEG * 2;
    const dup = new Map<number, number>();
    const copy = (vi: number): number => {
      let d = dup.get(vi);
      if (d !== undefined) return d;
      b.pos.push(b.pos[vi * 3]!, b.pos[vi * 3 + 1]!, b.pos[vi * 3 + 2]!);
      b.uv.push(b.uv[vi * 2]!, b.uv[vi * 2 + 1]!);
      b.col.push(0.14, 0.09, 0.08);
      for (let q = 0; q < 4; q++) {
        b.si.push(b.si[vi * 4 + q]!);
        b.sw.push(b.sw[vi * 4 + q]!);
      }
      d = b.count - 1;
      dup.set(vi, d);
      return d;
    };
    const jaw = (vi: number): number => (vi < jw.length ? jw[vi]! : 0);
    for (let t = 0; t < nTri; t++) {
      const i0 = b.idx[t * 3]!, i1 = b.idx[t * 3 + 1]!, i2 = b.idx[t * 3 + 2]!;
      const w = [jaw(i0), jaw(i1), jaw(i2)];
      const lo = Math.min(...w), hi = Math.max(...w);
      if (hi < 0.5 || lo >= 0.5) continue;
      b.idx[t * 3] = copy(i0);
      b.idx[t * 3 + 1] = copy(i1);
      b.idx[t * 3 + 2] = copy(i2);
      this.mouthTris++;
    }
  }

  /** 背骨の点 i の骨（i に骨が無ければ、根元の側の近い骨） */
  boneForSpine(i: number): number {
    const p = this.plan;
    let k = i;
    while (!this.spineBone.has(k)) k += k < p.root ? 1 : -1;
    return this.spineBone.get(k)!;
  }

  private resolveBone(ref: string, side: number, at?: Vector3): number {
    if (ref.startsWith('spine:')) return this.boneForSpine(Number(ref.slice(6)));
    if (ref.startsWith('own:')) {
      const base = ref.slice(4);
      return this.own.get(base + (side > 0 ? '_L' : side < 0 ? '_R' : '')) ?? this.own.get(base) ?? 0;
    }
    if (ref.startsWith('leg:')) {
      const [, group, j] = ref.split(':');
      const leg = this.legs.find((l) => l.plan.group === group && (!l.plan.mirror || l.side === (side || 1)));
      return leg ? leg.bones[Math.min(Number(j), leg.bones.length - 1)]! : 0;
    }
    if (ref === 'chain' && at) {
      const w = this.chainWeights(at);
      return [...w].sort((a, b) => b[1] - a[1])[0]![0];
    }
    return 0;
  }

  /** 背骨に沿った重み（その点に近い背骨の位置で決める） */
  chainWeights(p: Vector3): Inf {
    let best = 0, bd = Infinity;
    for (let i = 0; i < this.spineSamples.length; i++) {
      const s = this.spineSamples[i]!;
      const d = (s.c.y - p.y) ** 2 + (s.c.z - p.z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return regionWeights(this.spineSamples[best]!.u, this.spineRegions, this.blend);
  }

  private markPart(part: string | undefined | null, buf: 'main' | 'glow', from: number, own: number[]): void {
    if (!part) return;
    const list = this.parts.get(part) ?? [];
    list.push({ buf, from, to: (buf === 'main' ? this.main : this.glow).count, own });
    this.parts.set(part, list);
  }

  /** 筒（背骨・脚）。rings: 中心、右と上の向き、半径（上・下・横）、重み */
  private tube(b: Buf, rings: { c: Vector3; right: Vector3; up: Vector3; top: number; bot: number; side: number; inf: Inf }[], seg: number, shade = 1): void {
    const base = b.count;
    for (const r of rings) {
      for (let k = 0; k < seg; k++) {
        const a = -Math.PI / 2 + (TAU * k) / seg;
        const cs = Math.cos(a), sn = Math.sin(a);
        const p = r.c.clone().addScaledVector(r.right, cs * r.side).addScaledVector(r.up, sn * (sn >= 0 ? r.top : r.bot));
        b.vert(p, this.uvOf(p), shade, r.inf);
      }
    }
    for (let i = 0; i < rings.length - 1; i++) {
      for (let k = 0; k < seg; k++) {
        const a = base + i * seg + k, bb = base + i * seg + ((k + 1) % seg), c = a + seg, d = bb + seg;
        // 外向きの面（輪は right → up の向きに回り、right × up が進む向き）
        b.tri(a, bb, c);
        b.tri(bb, d, c);
      }
    }
    // ふた（両端）: 始まりは後ろ向き、終わりは前向き
    const cap = (ri: number, start: boolean): void => {
      const r = rings[ri]!;
      const center = b.vert(r.c, this.uvOf(r.c), shade, r.inf);
      for (let k = 0; k < seg; k++) {
        const a = base + ri * seg + k, bb = base + ri * seg + ((k + 1) % seg);
        if (start) b.tri(center, bb, a);
        else b.tri(center, a, bb);
      }
    };
    cap(0, true);
    cap(rings.length - 1, false);
  }

  /** 太さの並び（[位置, 値…]）を、位置 at で補間する */
  private static profAt(prof: readonly (readonly number[])[], at: number, k: number): number {
    let lo = 0, hi = prof.length - 1;
    if (at <= prof[0]![0]!) return prof[0]![k]!;
    if (at >= prof[hi]![0]!) return prof[hi]![k]!;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (prof[mid]![0]! <= at) lo = mid;
      else hi = mid;
    }
    const a = prof[lo]!, b = prof[hi]!;
    const f = (at - a[0]!) / Math.max(1e-9, b[0]! - a[0]!);
    return a[k]! + (b[k]! - a[k]!) * f;
  }

  private buildSpine(): void {
    const p = this.plan;
    const s = p.scale;
    const rad = p.spine.map((q) => [q[2] * s, q[3] * s, q[4] * s] as const);
    const prof = p.profile;
    const rings = this.spineSamples.map((smp, k) => {
      const i = Math.min(p.spine.length - 2, Math.floor(smp.at));
      const f = smp.at - i;
      const r0 = rad[i]!, r1 = rad[i + 1]!;
      // 原画の輪郭から測った太さ（v0.21.0）があれば、それを使う
      const lerp = (a: number, b: number, kk: number): number => (prof ? CreatureBody.profAt(prof, smp.at, kk) * s : a + (b - a) * f);
      // 進む向き（前後の点の差）
      const a = this.spineSamples[Math.max(0, k - 1)]!.c, b = this.spineSamples[Math.min(this.spineSamples.length - 1, k + 1)]!.c;
      const t = b.clone().sub(a).normalize();
      const right = new Vector3(1, 0, 0);
      const up = new Vector3().crossVectors(t, right).normalize();
      return { c: smp.c, right, up, top: lerp(r0[0], r1[0], 1), bot: lerp(r0[1], r1[1], 2), side: lerp(r0[2], r1[2], 3), inf: regionWeights(smp.u, this.spineRegions, this.blend) };
    });
    const base = this.main.count;
    this.tube(this.main, rings, SPINE_SEG);
    // 胴の輪（根元の点と、役が b・a の点）。ふたの中心は、両端の輪と同じ
    const torso = this.spineSamples.map((smp) => {
      const i = Math.round(smp.at);
      return i === p.root || p.roles[i] === 'b' || p.roles[i] === 'a' ? 1 : 0;
    });
    const mask = new Uint8Array(this.main.count - base);
    for (let k = 0; k < rings.length; k++) mask.fill(torso[k]!, k * SPINE_SEG, (k + 1) * SPINE_SEG);
    mask[rings.length * SPINE_SEG] = torso[0]!;
    mask[rings.length * SPINE_SEG + 1] = torso[rings.length - 1]!;
    this.torsoVert = mask;
  }

  private buildLeg(leg: LegRec): void {
    const p = this.plan;
    const s = p.scale;
    const pts = leg.bones.map((b) => this.bones[b]!.world);
    const samples = samplePath(pts, LEG_STEP);
    // 領域: 付け根の背骨の骨 → 関節ごとの骨
    const attach = this.boneForSpine(leg.plan.attach);
    const uAt = (j: number): number => samples.find((q) => q.at >= j - 1e-6)?.u ?? 0;
    // 付け根の背骨の骨（筒の始まりまで）→ 関節 j の骨（j から j+1 まで）。最後の関節の骨は、足先の塊だけを動かす
    const n = leg.bones.length;
    const regs: Region[] = [{ bone: attach, lo: -Infinity, hi: 0 }];
    for (let j = 0; j < n - 1; j++) regs.push({ bone: leg.bones[j]!, lo: uAt(j), hi: j === n - 2 ? Infinity : uAt(j + 1) });
    const blend = clamp(leg.length * 0.08, 0.04, 0.15);
    const lprof = leg.plan.prof;
    const rings = samples.map((smp, k) => {
      const i = Math.min(pts.length - 2, Math.floor(smp.at));
      const f = smp.at - i;
      // 原画の輪郭から測った太さ（v0.21.0）があれば、それを使う
      const r = (lprof ? CreatureBody.profAt(lprof, smp.at, 1) : leg.plan.r[i]! + (leg.plan.r[i + 1]! - leg.plan.r[i]!) * f) * s;
      const a = samples[Math.max(0, k - 1)]!.c, b = samples[Math.min(samples.length - 1, k + 1)]!.c;
      const t = b.clone().sub(a).normalize();
      let right = new Vector3().crossVectors(t, new Vector3(0, 0, 1));
      if (right.lengthSq() < 1e-4) right = new Vector3(1, 0, 0);
      right.normalize();
      const up = new Vector3().crossVectors(t, right).normalize();
      return { c: smp.c, right, up, top: r, bot: r, side: r, inf: regionWeights(smp.u, regs, blend) };
    });
    const from = this.main.count;
    this.tube(this.main, rings, LEG_SEG);
    // 足先の塊
    if (leg.plan.foot) {
      const last = pts[pts.length - 1]!;
      const lb = leg.bones[leg.bones.length - 1]!;
      const len = leg.plan.foot[0] * s, h = leg.plan.foot[1] * s;
      const w = Math.max(leg.plan.r[leg.plan.r.length - 1]! * s * 1.3, len * 0.35);
      const fc = new Vector3(last.x, Math.max(h * 0.5, last.y - h * 0.2), last.z + len * 0.22);
      const toes = leg.plan.toes;
      if (toes?.kind === 'hoof') {
        // 蹄: 足先の塊の代わりに、硬くて暗い 2 つの爪（前へ細く）
        for (const sx of [-1, 1]) {
          this.ellipsoid(this.main, new Vector3(fc.x + sx * w * 0.42, h * 0.42, fc.z + len * 0.12), len * 0.42, h * 0.45, w * 0.5, 0.12, 0.42, () => [[lb, 1]], 12, 7);
        }
      } else {
        this.ellipsoid(this.main, fc, len * 0.5, h * 0.55, w, 0, 0.92, () => [[lb, 1]], 12, 7);
      }
      if (toes && toes.kind !== 'hoof') this.addToes(fc, len, h, w, toes, lb);
    }
    if (leg.plan.group === 'clawR') this.markPart('claw_r', 'main', from, []);
    if (leg.plan.group === 'clawL') this.markPart('claw_l', 'main', from, []);
  }

  /**
   * 足先の指（v0.21.0）。toe: 前へ扇に開いた丸い指（先に短い爪）。talon: 鳥の足（前へ長い指 n 本 + 後ろへ 1 本、先は下へ曲がった鉤爪）。
   * どれも、脚の最後の骨に付く。
   */
  private addToes(fc: Vector3, len: number, h: number, w: number, t: NonNullable<LegPlan['toes']>, lb: number): void {
    const inf = (): Inf => [[lb, 1]];
    const n = Math.max(1, t.n);
    const talon = t.kind === 'talon';
    const L = len * t.len;
    const spread = talon ? 0.42 : 0.32;
    const dirs: { a: number; back: boolean }[] = [];
    for (let i = 0; i < n; i++) dirs.push({ a: n === 1 ? 0 : (i / (n - 1) - 0.5) * 2 * spread, back: false });
    if (talon) dirs.push({ a: Math.PI, back: true });
    for (const d of dirs) {
      const len2 = d.back ? L * 0.55 : L * (1 - Math.abs(d.a) * 0.35);
      const dx = Math.sin(d.a), dz = Math.cos(d.a);
      const r0 = talon ? h * 0.22 : h * 0.3;
      // 付け根（足先の塊の前の縁）→ 先
      const base = new Vector3(fc.x + dx * w * 0.55, talon ? h * 0.35 : h * 0.32, fc.z + dz * len * 0.32);
      const tip = new Vector3(base.x + dx * len2, talon ? h * 0.16 : h * 0.2, base.z + dz * len2);
      if (talon) {
        // 指は 2 つの節（少し持ち上がって、先で地面へ）
        const mid = base.clone().lerp(tip, 0.55).add(new Vector3(0, h * 0.12, 0));
        this.cone(this.main, base, mid, r0, r0 * 0.8, 0.85, inf, false);
        this.cone(this.main, mid, tip, r0 * 0.8, r0 * 0.55, 0.85, inf, false);
      } else {
        this.ellipsoid(this.main, base.clone().lerp(tip, 0.5), len2 * 0.55, r0, r0 * 1.05, 0, 0.9, inf, 10, 6);
      }
      if (t.claw > 0) {
        // 爪: 暗く硬い円すい。鉤爪は下へ曲がる
        const cl = L * t.claw;
        const end = tip.clone().add(new Vector3(dx * cl * (talon ? 0.7 : 0.9), talon ? -h * 0.22 : -h * 0.08, dz * cl * (talon ? 0.7 : 0.9)));
        this.cone(this.main, tip, end, r0 * (talon ? 0.55 : 0.6), r0 * 0.08, 0.32, inf, false);
      }
    }
  }

  private ellipsoid(b: Buf, c: Vector3, rz: number, ry: number, rx: number, pitch: number, shade: number, inf: (p: Vector3) => Inf, seg = 16, rows = 10, uvFrom?: (p: Vector3) => Vector3): void {
    const base = b.count;
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    for (let i = 0; i <= rows; i++) {
      const th = (Math.PI * i) / rows;
      const y = Math.cos(th), r = Math.sin(th);
      for (let k = 0; k < seg; k++) {
        const ph = (TAU * k) / seg;
        const lx = Math.cos(ph) * r * rx, ly = y * ry, lz = Math.sin(ph) * r * rz;
        // 前後の軸まわりの傾き（+ で前が下がる）
        const p = new Vector3(c.x + lx, c.y + ly * cp - lz * sp, c.z + ly * sp + lz * cp);
        b.vert(p, this.uvOf(uvFrom ? uvFrom(p) : p), shade, inf(p));
      }
    }
    for (let i = 0; i < rows; i++) {
      for (let k = 0; k < seg; k++) {
        const a = base + i * seg + k, bb = base + i * seg + ((k + 1) % seg), cc = a + seg, d = bb + seg;
        b.tri(a, bb, cc);
        b.tri(bb, d, cc);
      }
    }
  }

  private buildExtra(e: ExtraPlan): void {
    const p = this.plan;
    const s = p.scale;
    for (const side of e.mirror ? [1, -1] : [0]) {
      const x = (e.x ?? 0) * (side === 0 ? 1 : side);
      // 目（暗くて小さな塊）は、濡れて光る別の材質へ（v0.21.0）
      const isEye = e.kind === 'blob' && (e.shade ?? 1) <= 0.3 && !!e.r && e.r[0] <= 40;
      const buf = e.glow ? this.glow : isEye ? this.eye : this.main;
      const shade = isEye ? 1 : e.shade ?? 1;
      const own: number[] = [];
      let bone = 0;
      let infAt: (q: Vector3) => Inf;
      if (e.bone === 'chain') infAt = (q) => this.chainWeights(q);
      else {
        bone = this.resolveBone(e.bone, side);
        if (e.bone.startsWith('own:')) own.push(bone);
        infAt = () => [[bone, 1]];
      }
      const from = buf.count;
      if (e.kind === 'blob' && e.c && e.r) {
        const c = this.m(e.c[0], e.c[1], x);
        this.ellipsoid(buf, c, e.r[0] * s, e.r[1] * s, e.r[2], e.pitch ?? 0, shade, infAt);
        if (buf === this.main) this.blobRanges.push([from, buf.count]);
      } else if (e.kind === 'sheet' && e.pts) {
        this.sheet(buf, e, x, side, shade, infAt);
      } else if ((e.kind === 'cone' || e.kind === 'funnel') && e.a && e.b) {
        const a = this.m(e.a[0], e.a[1], x), b = this.m(e.b[0], e.b[1], x + (e.bx ?? 0) * (side || 1));
        this.cone(buf, a, b, (e.ra ?? 10) * s, (e.rb ?? 2) * s, shade, infAt, e.kind === 'funnel');
      } else if (e.kind === 'torus' && e.c) {
        this.torus(buf, this.m(e.c[0], e.c[1], x), (e.ring ?? 100) * s, (e.tube ?? 12) * s, shade, infAt);
      }
      this.markPart(e.part ?? undefined, e.glow ? 'glow' : 'main', from, own);
    }
  }

  private sheet(b: Buf, e: ExtraPlan, x: number, side: number, shade: number, infAt: (q: Vector3) => Inf): void {
    const pts2 = e.pts!.map(([px, py]) => this.m(px, py, 0));
    const contour = pts2.map((q) => new Vector2(q.z, q.y));
    if (ShapeUtils.isClockWise(contour)) contour.reverse(), pts2.reverse();
    const faces = ShapeUtils.triangulateShape(contour, []);
    const t = (e.thick ?? 0.04) / 2;
    // 外への傾き: 付け根（own の骨の位置、無ければ最初の点）を通る前後の軸まわり。付け根より上に広がる板（角膜・帆）は上が外へ、
    // 下へ垂れる板（翼・ひれ）は下が外へ傾く
    const pivot = e.own ? this.m(e.own.at[0], e.own.at[1], 0) : pts2[0]!;
    const above = pts2.reduce((sum, q) => sum + q.y, 0) / pts2.length > pivot.y;
    const dirX = side === 0 ? Math.sign(x) || 1 : side;
    const tilt = (e.tilt ?? 0) * dirX * (above ? -1 : 1);
    const place = (q: Vector3, dx: number): Vector3 => {
      const ly = q.y - pivot.y, lx = dx;
      const cs = Math.cos(tilt), sn = Math.sin(tilt);
      return new Vector3(x + lx * cs - ly * sn, pivot.y + lx * sn + ly * cs, q.z);
    };
    const n = pts2.length;
    const front: number[] = [], back: number[] = [];
    for (const q of pts2) {
      const pf = place(q, t), pb = place(q, -t);
      front.push(b.vert(pf, this.uvOf(q), shade, infAt(pf)));
      back.push(b.vert(pb, this.uvOf(q), shade, infAt(pb)));
    }
    for (const [i, j, k] of faces) {
      b.tri(front[i]!, front[j]!, front[k]!);
      b.tri(back[k]!, back[j]!, back[i]!);
    }
    // 縁（厚み）
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = b.vert(place(pts2[i]!, t), this.uvOf(pts2[i]!), shade * 0.85, infAt(pts2[i]!));
      const bb = b.vert(place(pts2[j]!, t), this.uvOf(pts2[j]!), shade * 0.85, infAt(pts2[j]!));
      const c = b.vert(place(pts2[i]!, -t), this.uvOf(pts2[i]!), shade * 0.85, infAt(pts2[i]!));
      const d = b.vert(place(pts2[j]!, -t), this.uvOf(pts2[j]!), shade * 0.85, infAt(pts2[j]!));
      b.tri(a, c, bb);
      b.tri(bb, c, d);
    }
  }

  private cone(b: Buf, a: Vector3, c: Vector3, ra: number, rb: number, shade: number, infAt: (q: Vector3) => Inf, open: boolean): void {
    const axis = c.clone().sub(a);
    const t = axis.clone().normalize();
    let right = new Vector3().crossVectors(t, new Vector3(0, 1, 0));
    if (right.lengthSq() < 1e-4) right = new Vector3(1, 0, 0);
    right.normalize();
    const up = new Vector3().crossVectors(right, t).normalize();
    const seg = open ? 18 : 8;
    const rows = open ? 4 : 3;
    const base = b.count;
    for (let i = 0; i <= rows; i++) {
      const f = i / rows;
      const cc = a.clone().addScaledVector(axis, f);
      const r = ra + (rb - ra) * f;
      for (let k = 0; k < seg; k++) {
        const ang = (TAU * k) / seg;
        const p = cc.clone().addScaledVector(right, Math.cos(ang) * r).addScaledVector(up, Math.sin(ang) * r);
        b.vert(p, this.uvOf(p), shade, infAt(p));
      }
    }
    for (let i = 0; i < rows; i++) {
      for (let k = 0; k < seg; k++) {
        const p0 = base + i * seg + k, p1 = base + i * seg + ((k + 1) % seg), p2 = p0 + seg, p3 = p1 + seg;
        b.tri(p0, p2, p1);
        b.tri(p1, p2, p3);
      }
    }
    // 根元のふた（後ろ向き）
    if (!open) {
      const center = b.vert(a, this.uvOf(a), shade, infAt(a));
      for (let k = 0; k < seg; k++) b.tri(center, base + k, base + ((k + 1) % seg));
    }
    if (open) {
      // 開いた口: 内側の面（暗い）と、奥のふた
      const inner = b.count;
      for (let i = 0; i <= 1; i++) {
        const f = i === 0 ? 1 : 0.35;
        const cc = a.clone().addScaledVector(axis, f);
        const r = (ra + (rb - ra) * f) * 0.88;
        for (let k = 0; k < seg; k++) {
          const ang = (TAU * k) / seg;
          const p = cc.clone().addScaledVector(right, Math.cos(ang) * r).addScaledVector(up, Math.sin(ang) * r);
          b.vert(p, this.uvOf(p), 0.3, infAt(p));
        }
      }
      for (let k = 0; k < seg; k++) {
        const p0 = inner + k, p1 = inner + ((k + 1) % seg), p2 = p0 + seg, p3 = p1 + seg;
        // 内側の面は、軸の方を向く
        b.tri(p0, p1, p2);
        b.tri(p1, p3, p2);
        // 縁: 外の面の端と、内の面の端（口の前を向く）
        const o0 = base + rows * seg + k, o1 = base + rows * seg + ((k + 1) % seg);
        b.tri(o0, p0, o1);
        b.tri(o1, p0, p1);
      }
      const center = b.vert(a.clone().addScaledVector(axis, 0.35), [0, 0], 0.12, infAt(a));
      // 奥のふた（口の方を向く）
      for (let k = 0; k < seg; k++) b.tri(center, inner + seg + ((k + 1) % seg), inner + seg + k);
    }
  }

  private torus(b: Buf, c: Vector3, R: number, r: number, shade: number, infAt: (q: Vector3) => Inf): void {
    const seg = 28, rows = 8;
    const base = b.count;
    for (let i = 0; i < seg; i++) {
      const a = (TAU * i) / seg;
      const cc = new Vector3(c.x, c.y + Math.sin(a) * R, c.z + Math.cos(a) * R);
      const out = new Vector3(0, Math.sin(a), Math.cos(a));
      for (let k = 0; k < rows; k++) {
        const ph = (TAU * k) / rows;
        const p = cc.clone().addScaledVector(out, Math.cos(ph) * r).add(new Vector3(Math.sin(ph) * r, 0, 0));
        b.vert(p, this.uvOf(p), shade, infAt(p));
      }
    }
    for (let i = 0; i < seg; i++) {
      for (let k = 0; k < rows; k++) {
        const p0 = base + i * rows + k, p1 = base + i * rows + ((k + 1) % rows), p2 = base + ((i + 1) % seg) * rows + k, p3 = base + ((i + 1) % seg) * rows + ((k + 1) % rows);
        b.tri(p0, p1, p2);
        b.tri(p1, p3, p2);
      }
    }
  }
}

const ZERO_POSE = (): Required<Omit<Pose, 'legs' | 'clawR' | 'clawL'>> & { legs: Record<string, [number, number, number?]>; clawR: [number, number]; clawL: [number, number] } => ({
  yH: 0, z: 0, x: 0, pitch: 0, roll: 0, yaw: 0, spineYaw: 0, spinePitch: 0, twist: 0, neckPitch: 0, neckYaw: 0, headPitch: 0, headYaw: 0, headRoll: 0, jaw: 0,
  tailYaw: 0, tailPitch: 0, tailCurl: 0, tailWave: 0,
  crest: 0, wing: 0, wingS: 0, sac: 0, dish: 0, plates: 0, bags: 0, sail: 0, crown: 0, glow: 0, finger: 0, tubes: 0, ring: 0, archFront: 0, archBack: 0, fin: 0,
  legs: {}, clawR: [0, 0], clawL: [0, 0],
});
type FullPose = ReturnType<typeof ZERO_POSE>;

function addPose(into: FullPose, p: Pose, k = 1): void {
  for (const [key, v] of Object.entries(p)) {
    if (key === 'legs') {
      for (const [lk, lv] of Object.entries(v as Record<string, [number, number, number?]>)) {
        const cur = into.legs[lk] ?? [0, 0, 0];
        into.legs[lk] = [cur[0] + lv[0] * k, cur[1] + lv[1] * k, (cur[2] ?? 0) + (lv[2] ?? 0) * k];
      }
    } else if (key === 'clawR' || key === 'clawL') {
      const c = v as [number, number];
      into[key] = [into[key][0] + c[0] * k, into[key][1] + c[1] * k];
    } else (into as unknown as Record<string, number>)[key] = ((into as unknown as Record<string, number>)[key] ?? 0) + (v as number) * k;
  }
}

/** 2 つの姿勢を混ぜる（a を 1 - w、b を w） */
function blendInto(a: FullPose, b: Pose, w: number): void {
  if (w <= 0) return;
  const tmp = ZERO_POSE();
  addPose(tmp, b);
  for (const key of Object.keys(tmp) as (keyof FullPose)[]) {
    if (key === 'legs' || key === 'clawR' || key === 'clawL') continue;
    (a as unknown as Record<string, number>)[key] = (a as unknown as Record<string, number>)[key]! * (1 - w) + (tmp as unknown as Record<string, number>)[key]! * w;
  }
  for (const k of new Set([...Object.keys(a.legs), ...Object.keys(tmp.legs)])) {
    const x = a.legs[k] ?? [0, 0, 0], y = tmp.legs[k] ?? [0, 0, 0];
    a.legs[k] = [x[0] * (1 - w) + y[0] * w, x[1] * (1 - w) + y[1] * w, (x[2] ?? 0) * (1 - w) + (y[2] ?? 0) * w];
  }
}

/** 貼る絵は、同じ絵を 1 回だけ読む（親と幼体・群れの仲間で使い回す） */
const ART_CACHE = new Map<string, { tex: Texture | null; wait: ((t: Texture) => void)[] }>();
function loadArt(file: string, done: (t: Texture) => void): void {
  // 画面の無い所（Node の検査・判定の軌道を作る npm run monsters:bake）では、絵を読まない
  if (typeof document === 'undefined') return;
  let e = ART_CACHE.get(file);
  if (e?.tex) return done(e.tex);
  if (e) {
    e.wait.push(done);
    return;
  }
  e = { tex: null, wait: [done] };
  ART_CACHE.set(file, e);
  const entry = e;
  new TextureLoader().load(assetUrl(file), (tex) => {
    tex.colorSpace = SRGBColorSpace;
    tex.anisotropy = 4;
    entry.tex = tex;
    for (const w of entry.wait.splice(0)) w(tex);
  });
}

/** 種ごとに 1 つだけ作る体（面の形と骨の並び）。群れの仲間で使い回す */
/** 体を支える飾り（動かす骨の名前）: 横たわる時は、胴と同じく地面に着ける（翼・冠などは、潜らないように回す） */
const SUPPORT_CH = new Set(['bags', 'plates', 'sac']);
const UP = new Vector3(0, 1, 0);
/** 横たわる姿勢で、胴の下・首や尾の下を草へ沈める深さ（体の高さに対する割合） */
const LIE_SINK = 0.02;
const LIE_SINK_REST = 0.06;
/** 横たわる姿勢の高さ合わせ（体の形 → 姿勢の名前 → 上下のずれ m） */
const LIE_FIT = new WeakMap<object, Map<string, number>>();
const BODY_CACHE = new Map<CreaturePlan, { body: CreatureBody; main: BufferGeometry; glow: BufferGeometry | null; eye: BufferGeometry | null }>();
/** 目の材質（濡れて光る。どの種も同じ） */
const EYE_MAT = new MeshStandardMaterial({ color: 0x17120c, roughness: 0.12, metalness: 0.0, emissive: 0x050302 });
/** 原画の濃淡を、面の凹凸にも使う強さ（v0.21.0。しわ・鱗・羽の筋に、光の当たり方の差が付く） */
const ART_BUMP = 1.6;
/**
 * 絵の混ぜ方（v0.21.0。MeshStandardMaterial の map の代わり）。横を向いた面は、横から貼った原画のまま。
 * 前・後ろ・上・下を向いた面は、原画をぼかした色に、肌の細かな模様（3 方向から貼る）を掛ける（横から貼った絵が伸びて、筋になるのを隠す）。
 * 位置と向きは、骨で動かす前の形のもの（動いても、模様が肌の上を滑らない）。肌の絵が無い間は、原画のまま。
 */
const SKIN_BLEND = `
#ifdef USE_MAP
  vec4 sideCol = texture2D( map, vMapUv );
  vec3 an = abs( normalize( vSkinNrm ) );
  float sideW = smoothstep( 0.22, 0.72, an.x );
  vec3 tw = an * an * an;
  tw /= ( tw.x + tw.y + tw.z + 1e-5 );
  vec3 tA = texture2D( skinTile, vSkinPos.zy * skinScale ).rgb;
  vec3 tB = texture2D( skinTile, vSkinPos.xz * skinScale ).rgb;
  vec3 tC = texture2D( skinTile, vSkinPos.xy * skinScale ).rgb;
  vec3 detail = ( tA * tw.x + tB * tw.y + tC * tw.z ) * 2.0;
  vec3 soft = texture2D( map, vMapUv, 3.0 ).rgb;
  diffuseColor *= vec4( mix( soft * detail, sideCol.rgb, sideW ), sideCol.a );
#endif
`;

export class CreatureRig implements MonsterRig {
  readonly root = new Group();
  private readonly body: CreatureBody;
  /** この個体の骨（体の骨の並びと同じ番号） */
  private readonly bones: BoneRec[];
  /** 面を、同じ種の仲間と分け合っている（部位が壊れたら、写してから暗くする） */
  private sharedGeo = true;
  /** 淡くする光（幼体）。叩かれた時の光に足す */
  private readonly pale: [number, number, number] = [0, 0, 0];
  private graze = 0;
  private watch = 0;
  private readonly mesh: SkinnedMesh;
  private readonly glowMesh: SkinnedMesh | null = null;
  private readonly mat: MeshStandardMaterial;
  private readonly glowMat: MeshStandardMaterial | null = null;
  private readonly euler = new Euler(0, 0, 0, 'YXZ');
  private flash = 0;
  private phase = 0;
  private speed = 0;
  private yawVel = 0;
  private look = 0;
  private lookUp = 0;
  private rest = 0;
  private started = false;
  private lastX = 0;
  private lastZ = 0;
  private lastYaw = 0;
  private react = { yaw: 0, pitch: 0, roll: 0 };
  private broken = new Set<string>();
  private brokenBones = new Set<number>();
  /** 肌の細かな模様の絵（読み込めるまで null。シェーダーの uniform と同じもの） */
  private skinUniform: { value: Texture | null };
  /** 倒れる向き（1 = 体の右へ。v0.67.0 から、転倒・気絶・死はいつも右。ガルドロスと同じ。戦闘の部位の追従の表と合わせる） */
  private readonly toppleSide = 1;
  /** 気絶で倒れている重み（v0.33.0。0〜1） */
  private stunW = 0;
  private stepAcc = 0;
  /** 転がる技の輪の回る量（v0.68.0）: 技の番号・前の tick・前の曲線の距離・描く距離・跳んだ後の揺り戻し */
  private readonly roll: { inst: number; t: number; d: number; shown: number; settle: { from: number; to: number; t0: number } | null } = { inst: -1, t: 0, d: 0, shown: 0, settle: null };
  /** 種ごとの構えの重み（v0.21.0） */
  private unaware = 0;
  private alertW = 0;
  private weakW = 0;
  /**
   * 足を引きずる（v0.72.0。#19 の M05。D-170。描画だけ）: 弱って巣へ向かう間に引きずる脚（四足と脚のある長胴は右の後ろ脚、二足は右脚。
   * 前後に振る脚が無い体は null）と、その重み（limpW）。limpHitch は、引きずる脚に体重が乗る間（支える半周期の真ん中が 1）の、かばう揺れの大きさ
   */
  private dragLeg: LegRec | null | undefined;
  /** 引きずる脚の足先の、体の真ん中からの横の距離（m。立った形で） */
  private dragW = 0;
  /** 体重が乗る時に腰を傾ける大きさ（rad。LIMP_ROLL か、胴の下が地面へ 4cm より深く潜らない所まで）と、いまの傾き */
  private limpRoll = 0;
  private hipRoll = 0;
  /** 腰だけを傾けるために、逆へ回す、根元のすぐ前の背骨の点（無ければ -1） */
  private frontSpine = -1;
  /** 引きずる脚がある体か（v0.72.0。まだ形を見ていない時は false。view.ts は、ある体では体の傾きを rig に任せる） */
  get hasDragLeg(): boolean {
    return !!this.dragLeg;
  }
  /** 検査用（v0.72.0）: 引きずる脚の、群れ（H・B）と左右 */
  dragLegOf(): { group: string; side: number } | null {
    return this.dragLeg ? { group: this.dragLeg.plan.group, side: this.dragLeg.side } : null;
  }
  private limpW = 0;
  limpHitch = 0;
  /** 検査用（v0.72.0）: 横たわる重み（0 = 立っている … 1 = 横たわりきった。眠り・転倒・死・捕獲） */
  get lieRest(): number {
    return this.rest;
  }
  /** 巣に着いて眠りへ入る（弱って歩いて来た時だけ。ゆっくり、後ろから腰を下ろす） */
  private settling = false;
  private rageW = 0;
  private runW = 0;
  /** 尾の付け根が向いている向き（体の向きに遅れて付いてくる） */
  private tailHead = 0;
  private fid: { f: FidgetPlan; t0: number; side: number } | null = null;
  /** 横たわる間に、地面へ潜った脚や飾りを出すための、骨ごとの補正（v0.21.0。落ち着いた姿勢では使い回す） */
  private readonly groundFix: { bone: Bone; q: Quaternion }[] = [];
  private groundW = -1;
  private groundAge = 0;
  private nextFid = 2.5;
  private fidCount = 0;
  /** 個体ごとの揺れのずれ（群れの仲間が同じ動きにならないように） */
  private readonly seed: number;
  private rndState: number;
  private static count = 0;

  /** seed: 個体ごとの揺れのずれ（省くと作った順。判定の軌道を作る時は 0 にして、毎回同じ姿勢にする） */
  constructor(readonly plan: CreaturePlan, private readonly partIds: readonly string[], opts: { seed?: number } = {}) {
    const art = CREATURE_ART[plan.key]!;
    let shared = BODY_CACHE.get(plan);
    if (!shared) {
      const body = new CreatureBody(plan, art);
      shared = { body, main: body.main.build(), glow: body.glow.count > 0 ? body.glow.build() : null, eye: body.eye.count > 0 ? body.eye.build() : null };
      BODY_CACHE.set(plan, shared);
    }
    this.body = shared.body;
    const n = opts.seed ?? CreatureRig.count++;
    this.seed = (n * 2.399963) % TAU;
    this.rndState = (n * 2654435761 + plan.key.length * 97) >>> 0;
    this.nextFid = 2 + (n % 5) * 0.7;
    // 骨は 1 頭ずつ（体の骨と同じ並び・同じ親子）
    const src = this.body.bones;
    this.bones = src.map((r) => ({ ...r, bone: new Bone() }));
    src.forEach((r, i) => {
      const b = this.bones[i]!.bone;
      b.position.copy(r.rest);
      const pi = src.findIndex((x) => x.bone === r.bone.parent);
      if (pi >= 0) this.bones[pi]!.bone.add(b);
    });
    const look = plan.look;
    const tint = look?.tint ?? [1, 1, 1];
    const avg = new Color(art.average[0] * tint[0], art.average[1] * tint[1], art.average[2] * tint[2]);
    this.mat = new MeshStandardMaterial({ color: avg, vertexColors: true, roughness: 0.82, metalness: 0.02 });
    if (look) {
      const k = look.pale * 0.45;
      this.pale = [0.86 * k, 0.86 * k, 0.82 * k];
      this.mat.emissive.setRGB(...this.pale);
    }
    const skeleton = new Skeleton(this.bones.map((b) => b.bone));
    this.mesh = new SkinnedMesh(shared.main, this.mat);
    this.mesh.add(this.bones[0]!.bone);
    this.mesh.bind(skeleton);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.root.add(this.mesh);
    if (shared.glow) {
      const gc = plan.glowColor ?? [0.9, 0.95, 0.5];
      this.glowMat = new MeshStandardMaterial({ color: new Color(gc[0] * 0.55, gc[1] * 0.55, gc[2] * 0.55), emissive: new Color(gc[0], gc[1], gc[2]), emissiveIntensity: 0.3, roughness: 0.4 });
      this.glowMesh = new SkinnedMesh(shared.glow, this.glowMat);
      this.glowMesh.bind(skeleton, this.mesh.bindMatrix);
      this.glowMesh.frustumCulled = false;
      this.root.add(this.glowMesh);
    }
    if (shared.eye) {
      const eyeMesh = new SkinnedMesh(shared.eye, EYE_MAT);
      eyeMesh.bind(skeleton, this.mesh.bindMatrix);
      eyeMesh.frustumCulled = false;
      this.root.add(eyeMesh);
    }
    // 横から貼る絵が伸びる面（前・後ろ・上・下を向いた面）には、肌の細かな模様を重ねる（v0.21.0）
    this.skinUniform = { value: null as Texture | null };
    const skinScale = { value: 1 / Math.max(0.05, art.skinPx * plan.scale) };
    const skinTex = this.skinUniform;
    this.mat.onBeforeCompile = (sh) => {
      sh.uniforms.skinTile = skinTex;
      sh.uniforms.skinScale = skinScale;
      sh.vertexShader = 'varying vec3 vSkinPos;\nvarying vec3 vSkinNrm;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vSkinPos = position;\n  vSkinNrm = normal;');
      sh.fragmentShader = 'uniform sampler2D skinTile;\nuniform float skinScale;\nvarying vec3 vSkinPos;\nvarying vec3 vSkinNrm;\n' + sh.fragmentShader.replace('#include <map_fragment>', SKIN_BLEND);
    };
    this.mat.customProgramCacheKey = () => 'creature-skin';
    loadArt(art.skin, (tex) => {
      tex.colorSpace = NoColorSpace;
      tex.wrapS = tex.wrapT = RepeatWrapping;
      tex.needsUpdate = true;
      skinTex.value = tex;
      this.mat.needsUpdate = true;
    });
    // 原画の絵（読み込めたら、平均の色から絵へ替える）。同じ絵の濃淡を、面の凹凸にも使う（v0.21.0）
    loadArt(art.file, (tex) => {
      this.mat.map = tex;
      this.mat.bumpMap = tex;
      this.mat.bumpScale = ART_BUMP;
      this.mat.color.setRGB(tint[0], tint[1], tint[2]);
      this.mat.needsUpdate = true;
    });
  }

  /**
   * 焼き付け用（v0.25.0。部位の追従）: 体の座標の点 p に、いちばん近い体の面の頂点の重み（骨と重み）。
   * 部位の形の端を、見える面と同じに動かすために使う（npm run monsters:bake）
   */
  skinOf(p: Vector3): { bones: number[]; w: number[] } {
    const b = this.body.main;
    let best = 0, bd = Infinity;
    for (let i = 0; i < b.count; i++) {
      const d = (b.pos[i * 3]! - p.x) ** 2 + (b.pos[i * 3 + 1]! - p.y) ** 2 + (b.pos[i * 3 + 2]! - p.z) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    const bones: number[] = [], w: number[] = [];
    for (let k = 0; k < 4; k++) {
      const wk = b.sw[best * 4 + k]!;
      if (wk > 0) {
        bones.push(b.si[best * 4 + k]!);
        w.push(wk);
      }
    }
    return { bones, w };
  }

  /** 焼き付け用（v0.24.0）: 形を作った時の点 p を、重み s で骨に乗せた、いまの位置（ワールド。モンスターが原点・向き 0 なら体の座標） */
  skinned(p: Vector3, s: { bones: number[]; w: number[] }): Vector3 {
    this.root.updateMatrixWorld(true);
    const out = new Vector3();
    s.bones.forEach((bi, k) => {
      const br = this.bones[bi]!;
      out.addScaledVector(p.clone().sub(br.world).applyMatrix4(br.bone.matrixWorld), s.w[k]!);
    });
    return out;
  }

  /** 検査用: いましているしぐさ（無ければ null。v0.21.0） */
  fidgetId(): string | null {
    return this.fid?.f.id ?? null;
  }

  /** 検査用: 骨の数・頂点の数・絵が貼られたか */
  info(): { bones: number; verts: number; glow: number; textured: boolean; height: number } {
    return { bones: this.bones.length, verts: this.body.main.count, glow: this.body.glow.count, textured: !!this.mat.map, height: this.body.height };
  }

  /**
   * いまの姿勢の、いちばん低い点の高さ（world の y。v0.21.0）。torso = 体を支える所（胴の筒と、袋・甲羅・嚢）、rest = 首・頭・尾の筒、
   * all = 脚や飾りも含めた全部。
   * 横たわる姿勢（眠る・倒れる・死ぬ）の高さ合わせと、それが地面に横たわっているか（浮いていないか、沈んでいないか）の検査で使う
   */
  lowest(): { torso: number; rest: number; all: number } {
    this.root.updateMatrixWorld(true);
    const v = new Vector3();
    const n = this.body.main.count, ns = this.body.spineVerts, sup = this.body.support;
    let torso = Infinity, rest = Infinity, all = Infinity;
    for (let i = 0; i < n; i++) {
      this.mesh.getVertexPosition(i, v);
      v.applyMatrix4(this.mesh.matrixWorld);
      if (sup[i]) torso = Math.min(torso, v.y);
      else if (i < ns) rest = Math.min(rest, v.y);
      all = Math.min(all, v.y);
    }
    return { torso, rest, all };
  }

  /**
   * 横たわる姿勢の、体の下を地面に着けるための上下のずれ（m。v0.21.0）。体の形と姿勢ごとに 1 回だけ、その姿勢を置いて測る。
   * 胴の下を少しだけ草へ沈め、首・頭・尾が胴より下へ潜るなら、そちらが沈みすぎないように合わせる
   */
  /**
   * 転がる技（テンガロの輪）の、輪の回る量（曲線の距離 m）。ふだんは曲線の距離と同じ。突進の制動（v0.68.0。D-166）で技が走る区間の終わりへ跳んだ時は、
   * 跳んだ分を回さず、いちばん近い「何周かして元の向きに戻る」量へ ROLL_SETTLE_TICKS で揺り戻す（輪の向きが跳ばない）。
   * 跳んだかは、描画の時間で進むはずの tick より 3 tick 以上多く進んだかで見る（描くのが遅い時に間違えない）。
   */
  private rollShownAt(inst: number, t: number, d: number, total: number, dt: number): number {
    const r = this.roll;
    if (r.inst !== inst) {
      r.inst = inst; r.t = t; r.d = d; r.shown = d; r.settle = null;
      return d;
    }
    if (r.settle === null && t - r.t > dt * 60 + 3) {
      const R = Math.max(0.5, this.body.length / TAU);
      const turns = Math.max(1, Math.round(Math.abs(total) / R / TAU));
      const step = total / turns;
      r.settle = { from: r.shown, to: Math.round(r.shown / step) * step, t0: t };
    }
    if (r.settle) {
      const u = clamp((t - r.settle.t0) / ROLL_SETTLE_TICKS, 0, 1);
      r.shown = r.settle.from + (r.settle.to - r.settle.from) * u * u * (3 - 2 * u);
    } else r.shown += d - r.d;
    r.t = t;
    r.d = d;
    return r.shown;
  }

  private lieFit(key: string, pose: Pose, H: number): number {
    let map = LIE_FIT.get(this.body);
    if (!map) {
      map = new Map();
      LIE_FIT.set(this.body, map);
    }
    let v = map.get(key);
    if (v === undefined) {
      const P = ZERO_POSE();
      addPose(P, pose);
      this.apply(P, { gaitAmt: 0, und: 0, paddle: 0, rollDist: 0, rollTotal: 0, seq: 0, windup: 0, side: 1, time: 0, H });
      const lo = this.lowest();
      const y0 = this.root.position.y;
      v = Math.max(-LIE_SINK * H - (lo.torso - y0), Number.isFinite(lo.rest) ? -LIE_SINK_REST * H - (lo.rest - y0) : -Infinity);
      map.set(key, v);
    }
    return v;
  }

  /** 横たわる姿勢に、高さ合わせを足したもの */
  private fitLie(key: string, pose: Pose, H: number): Pose {
    return { ...pose, yH: (pose.yH ?? 0) + this.lieFit(key, pose, H) / H };
  }

  /**
   * 横たわる間、地面へ潜った脚（鋏も）と、動かす飾り（翼・冠・帆など。袋・甲羅・嚢は体として地面に着ける）を、
   * 付け根の骨で回して、地面の上へ出す（v0.21.0。見た目だけ。w = 横たわる重み）。
   * 形の端の点（骨ごとの hull）のうち、いちばん潜った点が地面に出るだけ、その点を上へ向ける向きに回す（2 回くり返す。脚は関節ごとに）
   */
  private groundParts(w: number, steady: boolean): void {
    if (w <= 0.01) {
      this.groundFix.length = 0;
      this.groundW = -1;
      return;
    }
    // 姿勢がほとんど変わらない間（眠り・死んで落ち着いた後）は、4 フレームに 1 回だけ解き、間は前の補正をそのまま当てる
    if (steady && this.groundW >= 0 && this.groundAge < 3 && Math.abs(w - this.groundW) < 0.02) {
      this.groundAge++;
      for (const f of this.groundFix) f.bone.quaternion.premultiply(f.q);
      return;
    }
    this.groundAge = 0;
    this.groundW = w;
    this.groundFix.length = 0;
    this.root.updateMatrixWorld(true);
    const gy = this.root.position.y;
    const body = this.body;
    const piv = new Vector3(), p = new Vector3(), d = new Vector3(), axis = new Vector3(), bestAxis = new Vector3();
    const q = new Quaternion(), pq = new Quaternion(), pqi = new Quaternion();
    const lift = (pivot: number, chain: readonly number[]): void => {
      const hb = this.bones[pivot]!.bone;
      for (let it = 0; it < 2; it++) {
        hb.getWorldPosition(piv);
        let need = 0;
        for (const bi of chain) {
          const br = this.bones[bi]!;
          for (const rest of body.hull(bi)) {
            p.copy(rest).sub(br.world).applyMatrix4(br.bone.matrixWorld);
            if (p.y >= gy) continue;
            d.copy(p).sub(piv);
            const L = d.length();
            if (L < 1e-3) continue;
            const phi = Math.asin(clamp(d.y / L, -1, 1));
            let target = Math.asin(clamp((gy - piv.y) / L, -1, 1));
            if (piv.y < gy) target = Math.min(target, 0.2);
            const delta = target - phi;
            if (delta <= need) continue;
            axis.crossVectors(d, UP);
            if (axis.lengthSq() < 1e-8) axis.set(1, 0, 0).applyQuaternion(this.root.quaternion);
            need = delta;
            bestAxis.copy(axis).normalize();
          }
        }
        if (need < 1e-3) break;
        q.setFromAxisAngle(bestAxis, need * w);
        (hb.parent ?? this.root).getWorldQuaternion(pq);
        // world で回す q を、親の向きの中の回転へ直す: local' = pq⁻¹ · q · pq · local
        pqi.copy(pq).invert().multiply(q).multiply(pq);
        hb.quaternion.premultiply(pqi);
        hb.updateMatrixWorld(true);
        const fix = this.groundFix.find((f) => f.bone === hb);
        if (fix) fix.q.premultiply(pqi);
        else this.groundFix.push({ bone: hb, q: pqi.clone() });
      }
    };
    // 脚は、付け根 → 膝 → 足首の順に、残った分を回す
    for (const leg of body.legs) {
      for (let j = 0; j < leg.bones.length - 1; j++) lift(leg.bones[j]!, leg.bones.slice(j));
    }
    for (const [, bi] of body.own) {
      const b = this.bones[bi]!;
      if (!SUPPORT_CH.has(b.ch ?? '')) lift(bi, [bi]);
    }
  }


  hitFlash(): void {
    this.flash = 1;
  }

  /**
   * 体の印の位置（v0.21.0。判定の軌道を作る npm run monsters:bake と、検査で使う）。root を含めた world の座標。
   *   sp:N（背骨の点 N。小数なら、点と点の間）/ leg:組:側:関節（関節の番号か end = 足先）/ own:名前:側（動かす物の骨）/
   *   tip:名前:側（own の骨を持つ物の、骨からいちばん遠い点）。
   *   側: S = 技の側（side）、O = その反対、L = 左、R = 右、C = 左右の無い物
   */
  marker(spec: string, side = 1): Vector3 {
    this.root.updateMatrixWorld(true);
    const body = this.body;
    const [kind, a, b, c] = spec.split(':');
    const sideOf = (x: string | undefined): number => (x === 'S' ? side : x === 'O' ? -side : x === 'L' ? 1 : x === 'R' ? -1 : 0);
    // 骨に付いた点（形を作った時の位置）の、いまの位置
    const at = (bi: number, rest: Vector3): Vector3 => {
      const br = this.bones[bi]!;
      return rest.clone().sub(br.world).applyMatrix4(br.bone.matrixWorld);
    };
    if (kind === 'sp') {
      const f = Number(a);
      const i0 = Math.max(0, Math.min(body.spinePts.length - 1, Math.floor(f)));
      const i1 = Math.min(body.spinePts.length - 1, i0 + 1);
      const p0 = at(body.boneForSpine(i0), body.spinePts[i0]!);
      if (i1 === i0 || f === i0) return p0;
      return p0.lerp(at(body.boneForSpine(i1), body.spinePts[i1]!), f - i0);
    }
    if (kind === 'leg') {
      const s = sideOf(b);
      const leg = body.legs.find((l) => l.plan.group === a && (!l.plan.mirror || l.side === (s || 1)));
      if (!leg) throw new Error(`no leg ${spec} (${this.plan.key})`);
      if (c === 'end') {
        const lb = leg.bones[leg.bones.length - 1]!;
        const rest = this.bones[lb]!.world.clone();
        if (leg.plan.foot) rest.z += leg.plan.foot[0] * this.plan.scale * 0.6;
        return at(lb, rest);
      }
      const j = Math.min(leg.bones.length - 1, Number(c));
      return at(leg.bones[j]!, this.bones[leg.bones[j]!]!.world);
    }
    if (kind === 'own' || kind === 'tip') {
      const s = sideOf(b);
      const name = a + (s > 0 ? '_L' : s < 0 ? '_R' : '');
      const bi = body.own.get(name) ?? body.own.get(a!);
      if (bi === undefined) throw new Error(`no own bone ${spec} (${this.plan.key})`);
      if (kind === 'own') return at(bi, this.bones[bi]!.world);
      const e = this.plan.extras.find((x) => x.own?.name === a);
      if (!e?.own) throw new Error(`no extra ${spec} (${this.plan.key})`);
      const pts = e.pts ?? [e.b ?? e.c ?? e.own.at];
      const o = e.own.at;
      let far = pts[0]!, fd = -1;
      for (const q of pts) {
        const d = (q[0] - o[0]) ** 2 + (q[1] - o[1]) ** 2;
        if (d > fd) { fd = d; far = q; }
      }
      const x = (e.x ?? 0) * (e.mirror ? s || 1 : 1);
      return at(bi, body.m(far[0], far[1], x));
    }
    throw new Error(`bad marker ${spec}`);
  }

  hitReact(partIndex: number, wx: number, wz: number, strength = 1): void {
    const yaw = this.root.rotation.y;
    const dx = wx - this.root.position.x, dz = wz - this.root.position.z;
    const lat = dx * Math.cos(yaw) - dz * Math.sin(yaw);
    const fwd = dx * Math.sin(yaw) + dz * Math.cos(yaw);
    const k = 0.05 * strength * (this.partIds[partIndex] === 'head' ? 1.5 : 1);
    this.react.yaw -= Math.sign(lat) * k;
    this.react.pitch += (fwd > 0 ? 1 : -0.5) * k;
    this.react.roll += Math.sign(lat) * k * 0.5;
  }

  update(m: MonsterState, c: MonsterRigCtx): void {
    const dt = Math.min(0.1, Math.max(0, c.dt));
    const time = c.time;
    const plan = this.plan;
    const idle = plan.idle;
    const H = this.body.height;
    // ---- 動きの速さ（描画の位置の差から） ----
    const yaw = this.root.rotation.y;
    const px = this.root.position.x, pz = this.root.position.z;
    if (!this.started) {
      this.lastX = px; this.lastZ = pz; this.lastYaw = yaw; this.tailHead = yaw; this.started = true;
    }
    const dx = px - this.lastX, dz = pz - this.lastZ;
    const dyaw = angleDiff(this.lastYaw, yaw);
    this.lastX = px; this.lastZ = pz; this.lastYaw = yaw;
    const dist = Math.hypot(dx, dz);
    if (dt > 0) {
      const k = 1 - Math.exp(-dt * 8);
      this.speed += (Math.min(20, dist / dt) - this.speed) * k;
      this.yawVel += (dyaw / dt - this.yawVel) * k;
    }
    const moveSpeed = m.def.moveSpeed ?? 2.5;
    // 速く動く（出ていく・逃げる。v0.21.0）: 歩幅を広げ、走る構えへ
    const runT = !m.action && !m.dead ? smoothstep((this.speed / moveSpeed - 1.3) / 0.8) : 0;
    this.runW += (runT - this.runW) * (1 - Math.exp(-dt * 5));
    const gaitAmt = clamp(this.speed / moveSpeed, 0, 1.4) + clamp(Math.abs(this.yawVel) * 0.6, 0, 0.6) + 0.35 * this.runW;
    this.phase += (dist + Math.abs(dyaw) * Math.max(0.6, m.def.bodyRadius) * 0.8) / Math.max(0.3, plan.stride * (1 + 0.9 * this.runW));
    // 足を引きずる（v0.72.0。D-170）: 弱って巣へ向かって歩く間（limpGait）。重みは 0.25 秒ほどで混ぜる
    if (this.dragLeg === undefined) this.initDragLeg();
    const limping = limpGait(m) && gaitAmt > 0.05 && !!this.dragLeg;
    this.limpW += ((limping ? 1 : 0) - this.limpW) * (1 - Math.exp(-dt * 4));
    this.limpHitch = this.dragLeg && this.limpW > 0.001 ? this.limpW * Math.max(0, -Math.cos(TAU * (this.phase + this.dragLeg.phase))) ** 3 : 0;

    const P = ZERO_POSE();
    const k2 = 1 - Math.exp(-dt * 3);
    // ---- いつもの動き: 呼吸・尾の揺れ・狩人を目で追う ----
    const enraged = m.enraged && !m.dead;
    const weak = isWeak(m);
    const herd = m.herd;
    // 状態異常の睡眠（v0.33.0）も、巣の眠りと同じ姿勢
    const slept = m.ailments.ticks.sleep > 0;
    const resting = (m.asleep || m.captured || herd?.mood === 'rest' || slept) && !m.dead;
    const breathRate = enraged ? 3.2 : weak || (herd && herd.tired > 0) ? 3.6 : herd ? (herd.mood === 'flee' ? 3 : 1.4) : m.aware ? 1.8 : 1.2;
    const br = Math.sin(time * breathRate + this.seed);
    P.pitch += br * 0.012;
    P.yH += br * 0.006;
    P.sac += 0.12 + br * 0.08;
    P.bags += br * 0.1;
    P.tailYaw += Math.sin(time * 0.8 + this.seed) * 0.1;
    P.glow += enraged ? 0.45 + 0.25 * Math.sin(time * 6) : 0.1 + 0.06 * Math.sin(time * 1.6 + this.seed);
    let lookTarget = 0, lookUpTarget = 0;
    if (c.lookAt && !m.dead && !m.asleep && !slept && !m.captured && m.aware && m.ailments.ticks.stun <= 0 && (!herd || isWatching(m))) {
      const head = this.body.spinePts[this.body.spinePts.length - 1]!;
      const hx = px + Math.sin(yaw) * head.z, hz = pz + Math.cos(yaw) * head.z;
      lookTarget = clamp(angleDiff(yaw, Math.atan2(c.lookAt.x - hx, c.lookAt.z - hz)), -0.8, 0.8) * (m.action ? 0.3 : 1);
      const d = Math.hypot(c.lookAt.x - hx, c.lookAt.z - hz);
      lookUpTarget = clamp(Math.atan2((c.lookAt.y + 1.2) - head.y, Math.max(1, d)), -0.5, 0.3) * (m.action ? 0.2 : 0.7);
    }
    const lk = 1 - Math.exp(-dt * 4);
    this.look += (lookTarget - this.look) * lk;
    this.lookUp += (lookUpTarget - this.lookUp) * lk;
    P.neckYaw += this.look * 0.5;
    P.headYaw += this.look * 0.5;
    P.neckPitch += this.lookUp * 0.4;
    P.headPitch += this.lookUp * 0.4;

    // ---- 種ごとの構え（v0.21.0）: 気付く前は餌を探し、気付くと身構える。弱ると頭と尾が下がり、怒ると飾りを立てる ----
    // 麻痺・気絶（v0.33.0）の間も、しぐさや草を食むような動きはしない
    const free = !m.action && !m.dead && !resting && m.staggerTicks <= 0 && m.ailments.ticks.para <= 0 && m.ailments.ticks.stun <= 0;
    this.unaware += ((free && !m.aware && !herd ? 1 : 0) - this.unaware) * k2;
    this.alertW += ((free && m.aware && !herd ? 1 - this.runW : 0) - this.alertW) * k2;
    this.weakW += ((weak && !m.dead ? 1 : 0) - this.weakW) * k2;
    this.rageW += ((enraged ? 1 : 0) - this.rageW) * k2;
    if (idle) {
      if (this.unaware > 0.01) {
        addPose(P, idle.unaware, this.unaware);
        const w = this.unaware * (1 - this.runW);
        P.neckYaw += idle.sway * Math.sin(time * idle.rate * Math.PI + this.seed) * w;
        P.headPitch += idle.nod * Math.sin(time * idle.rate * TAU + this.seed * 1.7) * w;
      }
      if (this.alertW > 0.01) addPose(P, idle.alert, this.alertW);
      if (this.weakW > 0.01) addPose(P, idle.weak, this.weakW);
      if (this.rageW > 0.01) addPose(P, idle.rage, this.rageW);
      if (this.runW > 0.01) addPose(P, idle.run, this.runW);
    } else if (enraged) {
      P.crest += 0.25; P.wing += 0.15; P.sail += 0.2;
    }
    // 足を引きずる（v0.72.0。D-170）: 引きずる脚に体重が乗る度に、腰がその側へ傾いて沈み（肩は傾けない。反対の側の後ろ足は地面に着いたまま。
    // 引きずる脚は、足の接地で地面へ押し戻されて折れる）、首と頭が落ちる
    this.hipRoll = this.limpRoll * this.limpHitch;
    if (this.limpHitch > 0.001) {
      P.yH -= (this.dragW * Math.sin(this.hipRoll)) / H;
      P.neckPitch -= 0.14 * this.limpHitch;
      P.headPitch -= 0.06 * this.limpHitch;
    }

    // ---- 群れ（幼体）: 立ち止まって頭を下げて食む / 顔を上げて見る（v0.18.0）----
    if (herd) {
      const gk = 1 - Math.exp(-dt * 3);
      this.graze += ((isGrazing(m) && !m.dead && !m.action ? 1 : 0) - this.graze) * gk;
      this.watch += ((isWatching(m) && !m.dead ? 1 : 0) - this.watch) * (1 - Math.exp(-dt * 6));
      if (this.graze > 0.01) {
        const nib = 0.5 + 0.5 * Math.sin(time * 5.3 + this.seed);
        if (idle?.graze) {
          blendInto(P, { ...idle.graze, headPitch: (idle.graze.headPitch ?? 0) - 0.12 * nib, jaw: (idle.graze.jaw ?? 0) + 0.3 * nib }, this.graze);
        } else {
          // 首の長い体ほど、首を深く下ろす（首の骨の数で）。鳥は体ごと前へ傾ける
          const necks = plan.roles.split('').filter((r) => r === 'n').length;
          const neck = -Math.min(1.5, 0.5 + 0.38 * necks);
          blendInto(P, { neckPitch: neck, headPitch: -0.35 - 0.12 * nib, jaw: 0.3 * nib, pitch: plan.frame === 'biped' ? -0.3 : -0.06, yH: -0.02, legs: { F: [0.12, 0.05] } }, this.graze);
        }
      }
      if (this.watch > 0.01) {
        P.neckPitch += 0.25 * this.watch;
        P.headPitch += 0.08 * this.watch;
        P.crest += 0.4 * this.watch;
        P.wing += 0.12 * this.watch;
        P.sail += 0.3 * this.watch;
        P.glow += 0.3 * this.watch;
        P.tailPitch += 0.15 * this.watch;
      }
    }

    // ---- しぐさ（技も怯みも無く、ほぼ止まっている間だけ。v0.21.0）----
    const calm = free && m.trapTicks <= 0 && this.speed < 0.45 && Math.abs(this.yawVel) < 0.25 && this.graze < 0.5 && (!herd || herd.mood !== 'flee');
    if (!calm) {
      this.fid = null;
      this.nextFid = Math.max(this.nextFid, time + 1.2);
    } else if (!this.fid && time >= this.nextFid && idle?.fidgets.length) {
      const list = idle.fidgets.filter((f) => f.when === 'any' || (f.when === 'aware') === m.aware);
      if (list.length) {
        const f = list[Math.floor(this.rnd() * list.length) % list.length]!;
        this.fid = { f, t0: time, side: this.fidCount++ % 2 ? 1 : -1 };
      } else this.nextFid = time + 2;
    }
    if (this.fid) {
      const { f, t0, side: fs } = this.fid;
      const u = (time - t0) / f.dur;
      if (u >= 1) {
        this.fid = null;
        this.nextFid = time + 1.8 + this.rnd() * 3.5;
      } else {
        const keys = [{ at: 0, pose: {} as Pose }, ...f.K.map((k) => ({ at: k.t, pose: k.pose, e: k.e })), { at: 1, pose: {} as Pose }];
        addPose(P, sampleKeyList(keys, u, fs));
        if (f.shake) {
          const env = Math.sin(Math.PI * u);
          P.roll += Math.sin(time * 33) * f.shake * env;
          P.headRoll += Math.sin(time * 27 + 1) * f.shake * 2 * env;
        }
      }
    }

    // ---- 技 ----
    let und = plan.frame === 'serpent' ? 0.12 * Math.min(1, gaitAmt) : 0;
    let scurry = 0, paddle = 0, rollDist = 0, rollTotal = 0, seq = 0, windup = 0, side = 1;
    const run = m.action;
    if (run && !m.dead) {
      const mp = plan.moves[run.def.clip];
      const def = mp?.def;
      if (def) {
        side = mp!.side ?? 1;
        const t = renderTick(run, c.alpha);
        const smp = sampleMove(def, run.def, t, side, mp!.amp ?? 1);
        addPose(P, smp.pose);
        windup = smp.windup;
        // 跳ぶ: 技の前へ進む区間で弧を描く
        const curve = run.def.rootMotion.curveId ? c.content.curves.get(run.def.rootMotion.curveId) : undefined;
        if (curve) {
          const total = curve.keys[curve.keys.length - 1]![1];
          const prog = total !== 0 ? clamp(sampleCurve(curve, t) / total, 0, 1) : 0;
          if (def.hop) P.yH += def.hop * Math.sin(Math.PI * prog);
          if (def.roll) {
            rollDist = this.rollShownAt(run.instanceId, t, sampleCurve(curve, t), total, c.dt);
            rollTotal = total;
          }
        }
        if (def.shake) {
          const amt = def.shakeIn === 'all' ? 1 : def.shakeIn === 'windup' ? (smp.stage === 'windup' ? smp.windup : 0) : def.shakeIn === 'strike' ? (smp.stage === 'strike' ? 1 : 0) : smp.strike;
          P.roll += Math.sin(time * 37) * def.shake * amt;
          P.pitch += Math.sin(time * 29 + 1) * def.shake * amt;
          P.headYaw += Math.sin(time * 23 + 2) * def.shake * 2 * amt;
        }
        if (def.scurry) scurry = def.scurry * (smp.stage === 'strike' ? 1 : smp.strike);
        if (def.paddle) paddle = def.paddle * Math.max(smp.windup * (smp.stage === 'windup' ? 1 : 0), smp.strike);
        if (def.und) und += 0.28 * def.und * (smp.stage === 'windup' ? 0 : 1);
        if (def.wiggle) und += def.wiggle * smp.strike;
        if (def.seq) seq = 1;
        if (def.spin) {
          // 体ごと回る（回数）。攻撃の区間で回りきり、後は同じ向き（1 周回れば、元の向きと同じ）
          const act = run.def.phases.find((ph) => ph.id === 'active');
          const u = act ? clamp((t - act.from) / Math.max(1, act.to - act.from), 0, 1) : 0;
          P.yaw += def.spin * TAU * smoothstep(u) * side;
        }
      }
    }
    if (scurry) this.phase += dt * 3.5 * scurry;

    // ---- 状態: 怯み・転倒・罠・眠り・死 ----
    // 巣に着いて眠る（v0.72.0。D-170）: 弱って歩いて来た時は、2 秒ほどかけて、後ろから腰を下ろしてから前を下ろす
    if (!resting) this.settling = false;
    else if (this.rest <= 0 && m.asleep && m.roam?.limping) this.settling = true;
    this.rest = resting ? Math.min(1, this.rest + dt * (this.settling ? 0.45 : 0.8)) : Math.max(0, this.rest - dt * 1.5);
    // 横たわる重み（眠る・倒れる・死ぬ）: 潜った脚を地面の上へ出す（v0.21.0）。steady = 姿勢がほとんど変わらない
    let lieW = 0;
    let lieSteady = false;
    if (this.rest > 0) {
      const w = smoothstep(this.rest);
      const lie: Pose = idle?.sleep ?? (plan.frame === 'arch'
        ? { yH: -0.12, archFront: -0.5, archBack: -0.5, ring: -0.2 }
        : { yH: plan.frame === 'serpent' ? -0.15 : -0.42, neckPitch: -0.35, neckYaw: 0.5, headPitch: -0.2, tailYaw: 0.6, crest: -0.4, wing: -0.1, legs: { '*': [0, 1, 0.2] } });
      const fitted = this.fitLie('sleep', lie, H);
      blendInto(P, fitted, w);
      P.pitch += Math.sin(time * 0.9) * 0.01 * w;
      // 腰を後ろから下ろす（下ろす途中は、体の前が上がる。頭は体に付いて上を向かないよう、首で戻す）。
      // 眠っても体がほとんど下がらない種（ヌメラドン）は、下がる分だけ
      if (this.settling && this.rest < 1) {
        const k = clamp(-(fitted.yH ?? 0) / 0.25, 0, 1) * Math.sin(Math.PI * this.rest);
        P.pitch += 0.14 * k;
        P.neckPitch -= 0.12 * k;
      }
      lieW = w;
      lieSteady = this.rest >= 1 && m.trapTicks <= 0;
    }
    // 状態異常（v0.33.0）: 麻痺は固まって細かく震える。気絶は横へ倒れて、首がふらつく（睡眠は上の「眠る」）
    const ail = m.ailments.ticks;
    if (!m.dead && ail.para > 0) {
      P.roll += Math.sin(time * 47) * 0.05;
      P.pitch += Math.sin(time * 41 + 1) * 0.03;
      P.neckYaw += Math.sin(time * 39 + 2) * 0.12;
      P.headPitch += Math.sin(time * 43) * 0.08;
      P.jaw += 0.35;
      P.tailWave += 0.15;
    }
    const stunT = !m.dead && ail.stun > 0 ? 1 : 0;
    this.stunW += (stunT - this.stunW) * (1 - Math.exp(-dt * (stunT ? 6 : 3)));
    if (this.stunW > 0.001) {
      const w = smoothstep(this.stunW);
      const lie = this.fitLie('topple', idle?.topple ?? { roll: 1.25, yH: -0.42, neckPitch: -0.2, tailPitch: -0.2, legs: { '*': [0, 0.4, 0.3] } }, H);
      const tp: Pose = {};
      addScaled(tp, lie, 1, this.toppleSide);
      blendInto(P, tp, w);
      lieW = Math.max(lieW, w);
      // 首のふらつきは、気絶の残りの tick で決める（v0.67.0。戦闘の部位の追従の表と同じ。CREATURE_STUN_LOOP tick でひと回り）
      const sp = (TAU * (ail.stun % CREATURE_STUN_LOOP)) / CREATURE_STUN_LOOP;
      P.neckYaw += Math.sin(sp) * 0.3 * w;
      P.headPitch += Math.sin(2 * sp) * 0.15 * w;
      P.jaw += 0.25 * w;
    }
    if (m.trapTicks > 0 && !m.dead) {
      this.phase += dt * 2.5;
      P.roll += Math.sin(time * 8) * 0.07;
      P.neckYaw += Math.sin(time * 5.3) * 0.25;
      P.headPitch += Math.sin(time * 7.1) * 0.15;
      P.jaw += 0.3 + 0.15 * Math.sin(time * 9);
      P.tailWave += 0.25;
    }
    if (m.staggerTicks > 0 && !m.dead) {
      const total = Math.max(1, m.staggerTotal);
      const prog = 1 - m.staggerTicks / total;
      if (m.staggerKind === 'topple') {
        // 倒れる → もがく → 起き上がる（種ごとの姿勢。v0.21.0）。v0.67.0 から、倒れる向きはいつも体の右（ガルドロスと同じ。D-134）で、
        // もがく動きは転倒の経過の tick で決める（戦闘の部位の追従の表と同じ形になるように、描画の時刻と個体ごとのずれを使わない）
        const et = (total - m.staggerTicks) / 60;
        const down = smoothstep(prog / 0.15) * (1 - smoothstep((prog - 0.76) / 0.12));
        const rise = smoothstep((prog - 0.72) / 0.1) * (1 - smoothstep((prog - 0.86) / 0.14));
        const lie = this.fitLie('topple', idle?.topple ?? { roll: 1.25, yH: -0.42, neckPitch: -0.2, tailPitch: -0.2, legs: { '*': [0, 0.4, 0.3] } }, H);
        const tp: Pose = {};
        addScaled(tp, lie, 1, this.toppleSide);
        blendInto(P, tp, down);
        lieW = Math.max(lieW, down);
        if (idle?.rise && rise > 0) addPose(P, idle.rise, rise);
        const kick = down * (1 - rise);
        P.legs['*'] = [(P.legs['*']?.[0] ?? 0) + Math.sin(et * 9) * 0.35 * kick, (P.legs['*']?.[1] ?? 0) + 0.15 * kick * (0.5 + 0.5 * Math.sin(et * 7)), P.legs['*']?.[2] ?? 0];
        P.neckPitch += Math.sin(et * 4.2) * 0.2 * kick;
        P.jaw += (0.35 + 0.1 * Math.sin(et * 11)) * kick;
        P.tailWave += 0.3 * kick;
        P.roll += Math.sin(et * 5.5) * 0.05 * kick * this.toppleSide;
      } else {
        const r = Math.sin(Math.PI * clamp(prog * 1.4, 0, 1));
        const k = m.staggerKind === 'break' || m.staggerKind === 'sever' ? 1.5 : 1;
        if (idle?.flinch) addPose(P, idle.flinch, r * k);
        else {
          P.pitch += 0.12 * r * k;
          P.neckPitch += 0.3 * r * k;
          P.headPitch += 0.25 * r * k;
          P.yH -= 0.04 * r * k;
        }
        P.roll += Math.sin(time * 31) * 0.03 * r;
      }
    }
    if (m.dead) {
      const tick = m.deadTicks + c.alpha;
      if (idle?.dead.length) {
        // 最初の鍵は、膝を折る途中（高さは合わせない）。2 つ目からは横たわった姿勢で、体の下を地面に着ける
        const keys = [{ at: 0, pose: {} as Pose }, ...idle.dead.map((d, i) => ({ at: d.t, pose: i === 0 && idle.dead.length > 1 ? d.pose : this.fitLie(`dead${i}`, d.pose, H) }))];
        const dp = sampleKeyList(keys, tick, this.toppleSide);
        blendInto(P, dp, 1);
      } else {
        const e = smoothstep(tick / 55);
        blendInto(P, this.fitLie('dead', plan.frame === 'arch'
          ? { roll: 1.3, yH: -0.25, archFront: -0.4, archBack: -0.4 }
          : { roll: 1.3, yH: -0.45, neckPitch: -0.4, headPitch: -0.2, tailPitch: -0.2, crest: -0.4, wing: 0.2, legs: { '*': [0, 0.35, 0.4] } }, H), e);
      }
      lieW = 1;
      lieSteady = !!idle?.dead.length && tick > idle.dead[idle.dead.length - 1]!.t + 10;
    }
    // のけぞり（叩かれた向き）
    const decay = Math.exp(-dt * 6);
    this.react.yaw *= decay; this.react.pitch *= decay; this.react.roll *= decay;
    P.yaw += this.react.yaw; P.pitch += this.react.pitch; P.roll += this.react.roll;

    // ---- 後から付いてくる動き（v0.21.0）: 向きを変えると、尾は遅れて外へ振れ、首は曲がる側へ先に向く ----
    if (dt > 0) this.tailHead += angleDiff(this.tailHead, yaw) * (1 - Math.exp(-dt * 5));
    if (!m.dead && this.rest < 0.5) {
      P.tailYaw += clamp(angleDiff(this.tailHead, yaw) * 0.8, -0.7, 0.7);
      P.neckYaw += clamp(this.yawVel * 0.12, -0.3, 0.3);
    }

    // 部位の破壊（壊れた部位は、暗く縮む）
    m.def.parts.forEach((part, i) => {
      if (m.parts[i]!.broken && !this.broken.has(part.id)) this.breakPart(part.id);
    });

    this.apply(P, { gaitAmt: m.dead || this.rest > 0.5 ? 0 : gaitAmt, und, paddle, rollDist, rollTotal, seq, windup, side, time, H });
    this.groundParts(lieW, lieSteady);
    // 足の接地（v0.25.0。ChatGPT の設計提案 #6）: 技を出していない歩き・向き直りの間、支えている脚の足先を地面に留める
    // 足を踏み替える向き直り（v0.65.0。#19 の M01。判定の無い spin の技）の間も、歩きと同じに足を留める（向きの速さで踏み替える）
    const turnStep = !!m.action && !!m.action.def.spin && m.action.def.hitWindows.length === 0;
    this.plantFeet((!m.action || turnStep) && !m.dead && !resting && m.staggerTicks <= 0 && m.trapTicks <= 0 && this.rest < 0.5 && lieW < 0.01);

    // 光・叩かれた時の光
    this.flash = Math.max(0, this.flash - dt * 6);
    this.mat.emissive.setRGB(this.pale[0] + this.flash * 0.55, this.pale[1] + this.flash * 0.45, this.pale[2] + this.flash * 0.3);
    if (this.glowMat) this.glowMat.emissiveIntensity = m.dead ? 0.05 : clamp(0.2 + P.glow * 1.4, 0, 2.2);

    // 足音（歩いた距離ごと。向き直りの技の間は、踏み替えた量も数える）
    if (c.fx && !m.dead && this.rest < 0.5) {
      this.stepAcc += dist + (turnStep ? Math.abs(dyaw) * Math.max(0.6, m.def.bodyRadius) * 0.8 : 0);
      const stepLen = Math.max(0.6, plan.stride * 0.5);
      if (this.stepAcc > stepLen) {
        this.stepAcc = 0;
        // 小さな体（幼体）は軽い足音
        const heavy = plan.frame === 'quad' && H > 1.5 ? 0.9 : H < 0.7 ? 0.15 : 0.5;
        c.fx.footfall(px, 0, pz, heavy);
      }
    }
  }

  /** しぐさを選ぶ乱数（見た目だけ。戦闘の乱数とは別） */
  private rnd(): number {
    this.rndState = (this.rndState * 1664525 + 1013904223) >>> 0;
    return this.rndState / 4294967296;
  }

  private breakPart(id: string): void {
    this.broken.add(id);
    if (this.sharedGeo) {
      // 仲間と分け合っている面を、この個体だけ写してから暗くする
      this.sharedGeo = false;
      this.mesh.geometry = this.mesh.geometry.clone();
      if (this.glowMesh) this.glowMesh.geometry = this.glowMesh.geometry.clone();
    }
    for (const r of this.body.parts.get(id) ?? []) {
      const geo = (r.buf === 'main' ? this.mesh : this.glowMesh)?.geometry;
      if (!geo) continue;
      const col = geo.getAttribute('color') as Float32BufferAttribute;
      for (let i = r.from; i < r.to; i++) col.setXYZ(i, col.getX(i) * 0.55, col.getY(i) * 0.5, col.getZ(i) * 0.48);
      col.needsUpdate = true;
      for (const b of r.own) {
        this.brokenBones.add(b);
        this.bones[b]!.bone.scale.setScalar(0.82);
      }
    }
  }

  /** 検査用: 足の接地を使うか（比べるために切れる） */
  static plantFeetOn = true;

  /** 検査用（v0.25.0）: 前後に振る脚の、足先の位置（ワールド）と、いま留めているか（足の接地は四足と二足だけ） */
  feet(): { group: string; side: number; planted: boolean; stance: number; p: Vector3 }[] {
    this.root.updateMatrixWorld(true);
    return this.body.legs
      .filter((l) => (l.plan.swing ?? 'x') === 'x' && l.bones.length >= 3 && l.plan.group !== 'clawR' && l.plan.group !== 'clawL')
      .map((l) => {
        const ph = TAU * (this.phase + l.phase);
        // stance: 支えの中の位置（0 = 着いた時 … 1 = 離れる時）。踏み出している間は -1
        const stance = Math.cos(ph) > 0 ? -1 : ((((ph - Math.PI / 2) % TAU) + TAU) % TAU) / Math.PI;
        return { group: l.plan.group, side: l.side, planted: !!this.plants.get(l)?.at, stance, p: new Vector3().setFromMatrixPosition(this.bones[l.bones[l.bones.length - 1]!]!.bone.matrixWorld) };
      });
  }

  /** 足の接地の状態（脚ごと）: 留めた足先の位置（ワールド）。踏み出している間は null */
  private readonly plants = new Map<LegRec, { at: Vector3 | null }>();
  /** 足の接地を解いた量（検査用。最後の 1 回の、留めた位置と足先のずれの最大 m） */
  plantError = 0;
  /** 検査用: ずれが大きすぎて、その場で踏み直した回数 */
  plantResteps = 0;
  private readonly tv1 = new Vector3();
  private readonly tv2 = new Vector3();
  private readonly tv3 = new Vector3();
  private readonly tq1 = new Quaternion();
  private readonly tq2 = new Quaternion();
  private readonly tq3 = new Quaternion();

  /**
   * 足の接地（v0.25.0）: 前後に振る脚（四足・二足）は、歩く周期の「支える」半分の間、足先を、支え始めた所（ワールド）に留める。
   * 脚の骨を付け根から順に回して足先を届かせる（CCD。1 回で回す量は小さく、関節の向きは歩きの形のまま）。
   * 着いた時から留め、離れる前に少しずつ歩きの形へ戻す。ずれが脚の長さの 3 割を超えたら、その場で踏み直す（向き直りで足がちぎれない）。
   * 描画だけの計算で、判定（技データ・部位の追従の表）は変えない。
   */
  private plantFeet(active: boolean): void {
    this.plantError = 0;
    // 四足と二足だけ（長胴の短い脚・輪の虫・甲殻と多脚の虫は、これまでどおり）
    if (!active || !CreatureRig.plantFeetOn || (this.plan.frame !== 'quad' && this.plan.frame !== 'biped')) {
      for (const st of this.plants.values()) st.at = null;
      return;
    }
    this.root.updateMatrixWorld(true);
    const rootY = this.root.position.y;
    for (const leg of this.body.legs) {
      const g = leg.plan.group;
      if ((leg.plan.swing ?? 'x') !== 'x' || leg.bones.length < 3 || g === 'clawR' || g === 'clawL') continue;
      let st = this.plants.get(leg);
      if (!st) {
        st = { at: null };
        this.plants.set(leg, st);
      }
      const ph = TAU * (this.phase + leg.phase);
      const c = Math.cos(ph);
      const endRec = this.bones[leg.bones[leg.bones.length - 1]!]!;
      const ground = rootY + endRec.world.y; // 立っている時の、足先の骨の高さ（地面の上）
      const foot = this.tv1.setFromMatrixPosition(endRec.bone.matrixWorld);
      if (c > 0) {
        // 踏み出している: 足先が地面へ潜る時だけ、地面の上へ出す
        st.at = null;
        if (foot.y >= ground - 0.005) continue;
        const target = this.tv2.set(foot.x, ground, foot.z);
        this.reach(leg, target);
        continue;
      }
      if (!st.at) st.at = foot.clone();
      // 前後左右は着いた所に留める。高さは、歩きの形のまま（地面より下へは行かせない）
      const err = Math.hypot(st.at.x - foot.x, st.at.z - foot.z);
      if (err > leg.length * 0.3) {
        st.at.copy(foot);
        this.plantResteps++;
        continue;
      }
      // 着いてから支えの半ばまでは留めきり、離れる前の 1/4 で歩きの形へ戻す（離れる時に足先が跳ばない）
      const w = Math.sin(ph) > 0 ? 1 : clamp(-c * 4, 0, 1);
      const target = this.tv2.set(foot.x + (st.at.x - foot.x) * w, Math.max(foot.y, ground), foot.z + (st.at.z - foot.z) * w);
      if (target.distanceTo(foot) < 1e-4) continue;
      this.reach(leg, target);
      this.plantError = Math.max(this.plantError, this.tv1.setFromMatrixPosition(endRec.bone.matrixWorld).distanceTo(target));
    }
  }

  /** 脚の骨を、足先が target へ届くように回す（先の側から 1 本ずつ。1 回 0.2 rad まで、4 回） */
  private reach(leg: LegRec, target: Vector3): void {
    const chain = leg.bones.map((k) => this.bones[k]!.bone);
    const end = chain[chain.length - 1]!;
    for (let it = 0; it < 8; it++) {
      for (let i = chain.length - 2; i >= 0; i--) {
        const b = chain[i]!;
        const bp = this.tv3.setFromMatrixPosition(b.matrixWorld);
        const v1 = new Vector3().setFromMatrixPosition(end.matrixWorld).sub(bp);
        const v2 = target.clone().sub(bp);
        if (v1.lengthSq() < 1e-8 || v2.lengthSq() < 1e-8) continue;
        const q = this.tq1.setFromUnitVectors(v1.normalize(), v2.normalize());
        const ang = 2 * Math.acos(clamp(q.w, -1, 1));
        if (ang < 1e-5) continue;
        if (ang > 0.3) q.slerp(this.tq2.identity(), 1 - 0.3 / ang);
        b.getWorldQuaternion(this.tq2);
        b.parent!.getWorldQuaternion(this.tq3);
        b.quaternion.copy(this.tq3.invert().multiply(q.multiply(this.tq2)));
        b.updateMatrixWorld(true);
      }
    }
  }

  private setRot(b: Bone, rx: number, ry: number, rz: number): void {
    this.euler.set(rx, ry, rz, 'YXZ');
    b.quaternion.setFromEuler(this.euler);
  }

  /**
   * 弱った時に引きずる脚（v0.72.0）: 四足・脚のある長胴は右の後ろ脚（H）、二足は右脚（B）。前後に振る脚が無い体は null。
   * 腰を傾ける大きさは、立った形の胴の下（地面に着ける点）が、傾けて沈めた時に地面へ 4cm より深く潜らない所まで（胴が地面に近いヌメラドン・ラズメルは小さい）
   */
  private initDragLeg(): void {
    const plan = this.plan, body = this.body;
    this.dragLeg = null;
    if (plan.frame !== 'quad' && plan.frame !== 'biped' && plan.frame !== 'serpent') return;
    const group = plan.frame === 'biped' ? 'B' : 'H';
    const leg = body.legs.find((l) => l.plan.group === group && l.side < 0 && (l.plan.swing ?? 'x') === 'x' && l.reach > 0.05);
    if (!leg) return;
    this.dragLeg = leg;
    this.dragW = Math.abs(body.bones[leg.bones[leg.bones.length - 1]!]!.world.x);
    // 根元のすぐ前の背骨の点（肩の側。ここで逆へ回して、腰だけを傾ける）
    for (let i = plan.root + 1; i < plan.spine.length && this.frontSpine < 0; i++) if (body.spineBone.has(i)) this.frontSpine = i;
    // 胴の点の沈み: 肩の側は体ごと下げる分（dragW）、腰の側はそれに傾きの分（右 = −X の側ほど深い）
    const rootZ = body.spinePts[plan.root]!.z;
    const pos = body.main.pos, sup = body.support;
    let r = LIMP_ROLL;
    for (let i = 0; i < sup.length; i++) {
      if (!sup[i]) continue;
      const x = pos[i * 3]!, y = pos[i * 3 + 1]!, z = pos[i * 3 + 2]!;
      const br = body.bones[body.mainBone(i)]!;
      const front = this.frontSpine >= 0 && (br.kind === 'spine' ? br.index >= this.frontSpine : z > rootZ);
      const f = front ? this.dragW : this.dragW - x;
      if (f > 1e-3) r = Math.min(r, Math.asin(Math.min(1, (Math.max(0, y) + 0.04) / f)));
    }
    this.limpRoll = r;
  }

  private apply(P: FullPose, o: { gaitAmt: number; und: number; paddle: number; rollDist: number; rollTotal: number; seq: number; windup: number; side: number; time: number; H: number }): void {
    const body = this.body;
    const plan = this.plan;
    const root = plan.root;
    const bones = this.bones;
    // 背骨: 役ごとに数える
    const spine = bones.filter((b) => b.kind === 'spine');
    const headSideBody = spine.filter((b) => b.role === 'b' && b.index > root);
    const tailSideBody = spine.filter((b) => b.role === 'b' && b.index < root);
    const neck = spine.filter((b) => b.role === 'n');
    const tail = spine.filter((b) => b.role === 't').sort((a, b) => b.index - a.index);
    const arch = plan.frame === 'arch';
    const nArch = spine.filter((b) => b.role === 'a').length;
    const ringR = body.length / TAU;
    const gaitWave = Math.sin(TAU * this.phase);
    for (const b of spine) {
      let rx = 0, ry = 0, rz = 0;
      const i = b.index;
      // 足を引きずる（v0.72.0）: 腰だけを傾ける（根元で傾け、すぐ前の点で戻す）
      if (i === this.frontSpine) rz -= this.hipRoll;
      if (i === root) {
        rx += -P.pitch;
        ry += P.yaw;
        rz += P.roll + this.hipRoll;
        if (plan.frame === 'biped' || plan.frame === 'quad') rz += Math.sin(TAU * this.phase) * 0.025 * Math.min(1, o.gaitAmt);
        const pos = b.rest.clone();
        pos.y += P.yH * o.H + Math.abs(Math.sin(TAU * this.phase)) * 0.03 * Math.min(1, o.gaitAmt) * (plan.frame === 'serpent' ? 0 : 1);
        pos.z += P.z * o.H;
        pos.x += P.x * o.H;
        if (arch && o.rollDist) {
          // 輪になって転がる: 輪の中心のまわりに回す。転がり終えた時に、ちょうど何周かして元の向きに戻るように、回る量を少し合わせる
          // （戻らないと、技の終わりに体の向きが跳ぶ。v0.21.0）
          const R = Math.max(0.5, ringR);
          const full = Math.abs(o.rollTotal) / R;
          const turns = Math.max(1, Math.round(full / TAU));
          const th = (o.rollDist / R) * (full > 0 ? (turns * TAU) / full : 1);
          const cy = pos.y - ringR * 0.9;
          const ly = pos.y - cy;
          pos.y = cy + ly * Math.cos(th);
          pos.z += ly * Math.sin(th);
          rx += th;
        }
        b.bone.position.copy(pos);
      }
      if (b.role === 'b' && i > root) {
        ry += P.spineYaw / Math.max(1, headSideBody.length);
        rx += -P.spinePitch / Math.max(1, headSideBody.length);
        rz += P.twist / Math.max(1, headSideBody.length);
      }
      if (b.role === 'b' && i < root) ry += -P.spineYaw * 0.3 / Math.max(1, tailSideBody.length);
      if (headSideBody.length === 0 && i === root) {
        ry += P.spineYaw * 0.5;
        rx += -P.spinePitch * 0.5;
        rz += P.twist * 0.5;
      }
      if (b.role === 'n') {
        rx += -P.neckPitch / Math.max(1, neck.length);
        ry += P.neckYaw / Math.max(1, neck.length);
        if (headSideBody.length === 0) ry += P.spineYaw * 0.5 / Math.max(1, neck.length);
      }
      if (b.role === 'h') {
        rx += -P.headPitch;
        ry += P.headYaw;
        rz += P.headRoll;
      }
      if (b.role === 't') {
        const k = tail.indexOf(b);
        const w = (k + 1) / tail.length;
        ry += -P.tailYaw * (0.5 + w) * 1.2 / tail.length;
        rx += P.tailPitch * (0.5 + w) * 1.2 / tail.length;
        ry += Math.sin(o.time * 1.1 - k * 0.6) * 0.035 * w;
        if (P.tailCurl) rx += P.tailCurl * w * 0.4;
        // 波打たせる（尾を鳴らす・もがく）: 付け根から先へ進む波
        if (P.tailWave) ry += P.tailWave * Math.sin(o.time * 11 - k * 0.9) * (0.3 + w) / Math.max(1, tail.length * 0.5);
      }
      if (b.role === 'a') {
        const headSide = i > root;
        const d = P.ring * (Math.PI / Math.max(1, nArch)) * 0.95;
        rx += headSide ? d : -d;
        if (headSide) rx += -P.archFront * 0.12;
        else rx += P.archBack * 0.12;
        rx += Math.sin(TAU * this.phase - i * 0.5) * 0.025 * Math.min(1, o.gaitAmt);
      }
      // 長胴: 体をくねらせる（尾から頭へ波が進む）
      if (o.und && (b.role === 't' || b.role === 'b' || b.role === 'n')) {
        const k = plan.spine.length - i;
        ry += o.und * Math.sin(TAU * this.phase * 0.5 + o.time * 2 * (o.und > 0.2 ? 2 : 1) - k * 0.8);
      }
      this.setRot(b.bone, rx, ry, rz);
    }
    // 脚
    const crouch = Math.max(0, -P.yH);
    for (const leg of body.legs) {
      const g = leg.plan.group;
      const s = leg.side;
      const sideName = s === o.side ? 'S' : 'O';
      let swing = 0, lift = 0, spread = 0;
      const addL = (k: string): void => {
        const v = P.legs[k];
        if (v) { swing += v[0]; lift += v[1]; spread += v[2] ?? 0; }
      };
      if (g === 'clawR' || g === 'clawL') {
        const cl = g === 'clawR' ? P.clawR : P.clawL;
        const [b0, b1] = leg.bones;
        this.setRot(bones[b0!]!.bone, -cl[0] * 0.8 + Math.sin(o.time * 1.3) * 0.02, cl[1] * 0.6 * (g === 'clawR' ? 1 : -1), 0);
        if (b1 !== undefined) this.setRot(bones[b1]!.bone, cl[0] * 0.3, 0, 0);
        continue;
      }
      addL('*'); addL(g); addL(`${g}.${sideName}`); addL(`*.${sideName}`);
      // 歩く周期。前後に振る脚は、支えている半周期の間に足先が下がる量が、体の進む量（歩幅の半分）と合う振り幅にする（v0.25.0。足の接地）
      const ph = TAU * (this.phase + leg.phase);
      const amt = Math.min(1.2, o.gaitAmt);
      if ((plan.frame === 'quad' || plan.frame === 'biped') && (leg.plan.swing ?? 'x') === 'x' && leg.reach > 0.05) {
        const stride = plan.stride * (1 + 0.9 * this.runW);
        swing += Math.sin(ph) * Math.asin(clamp(stride / (4 * leg.reach), 0.1, 0.85)) * Math.min(1, amt * 2.5);
      } else swing += Math.sin(ph) * 0.3 * amt;
      const drag = leg === this.dragLeg ? this.limpW : 0;
      lift += Math.max(0, Math.cos(ph)) * 0.55 * Math.min(1, amt * 1.5) * (1 - 0.8 * drag);
      // 引きずる脚は、振りが小さく（走る間は、留めた足が離れすぎないよう少しだけ）、いつも少し後ろへ流れ（体の後ろに残る）、
      // 足先がほとんど上がらない（地面をこする）
      if (drag > 0) swing = swing * (1 - (0.35 - 0.25 * this.runW) * drag) - 0.12 * drag;
      if (o.paddle && g === 'F') lift += Math.max(0, Math.sin(o.time * 12 * (s > 0 ? 1 : -1))) * 0.7 * o.paddle;
      lift += crouch * (plan.frame === 'serpent' ? 0.6 : 1.6);
      lift = clamp(lift, 0, 1.3);
      const bs = leg.bones.map((k) => bones[k]!.bone);
      if ((leg.plan.swing ?? 'x') === 'y') {
        this.setRot(bs[0]!, 0, -swing * s, lift * 0.5 * s + spread * s);
        if (bs[1]) this.setRot(bs[1], 0, 0, -lift * 0.3 * s);
        for (let j = 2; j < bs.length; j++) this.setRot(bs[j]!, 0, 0, 0);
      } else {
        this.setRot(bs[0]!, -swing - lift * 0.35, 0, spread * s);
        if (bs[1]) this.setRot(bs[1], lift * 1.0, 0, 0);
        if (bs[2]) this.setRot(bs[2], -lift * 0.6, 0, 0);
        for (let j = 3; j < bs.length; j++) this.setRot(bs[j]!, 0, 0, 0);
      }
    }
    // 動かす物
    for (let bi = 0; bi < bones.length; bi++) {
      const b = bones[bi]!;
      if (b.kind !== 'own') continue;
      const s = b.side || 1;
      const bk = this.brokenBones.has(bi) ? 0.82 : 1;
      switch (b.ch) {
        case 'crest':
          this.setRot(b.bone, -0.25 * P.crest, 0, -s * (0.12 + 0.4 * P.crest));
          break;
        case 'fin': {
          // ひれ足（v0.21.0。キリサーヴ）: 歩く周期で前後に漕ぐ（前と後ろ、左と右で逆）。水を掻く技（paddle）では速く漕ぐ。fin で開く（+）・畳む（-）
          const ph = TAU * this.phase + ((b.order ?? 0) % 2) * Math.PI + (s > 0 ? 0 : Math.PI);
          const stroke = Math.sin(ph) * 0.45 * Math.min(1, o.gaitAmt) + Math.sin(o.time * 12 + (s > 0 ? 0 : Math.PI)) * 0.55 * o.paddle;
          this.setRot(b.bone, stroke * bk, 0, s * 0.4 * P.fin);
          break;
        }
        case 'wing': {
          const w = P.wing + (s === o.side ? P.wingS : 0);
          this.setRot(b.bone, -0.15 * w, s * 0.25 * w, s * (0.04 + 1.0 * w));
          break;
        }
        case 'sac': {
          // 並んだ嚢は、前から順にふくらむ（技の seq）
          const order = b.order ?? 0;
          const amt = o.seq ? P.sac * smoothstep((o.windup * 1.6 - order * 0.22) / 0.4) : P.sac;
          b.bone.scale.setScalar(bk * (1 + 0.25 * amt));
          break;
        }
        case 'dish':
          this.setRot(b.bone, -P.dish * 0.35, 0, 0);
          break;
        case 'plates':
          this.setRot(b.bone, -P.plates * 0.1, 0, 0);
          b.bone.scale.set(bk, bk * (1 + 0.12 * P.plates), bk);
          break;
        case 'bags':
          b.bone.scale.setScalar(bk * (1 + 0.15 * P.bags));
          break;
        case 'sail': {
          const order = b.order ?? 0;
          const amt = o.seq ? P.sail * smoothstep((o.windup * 1.7 - order * 0.09) / 0.35) : P.sail;
          // 立てる: 外へ傾いた帆を起こし、少し伸ばす
          this.setRot(b.bone, 0, 0, s * 0.25 * amt);
          b.bone.scale.y = bk * (1 + 0.25 * amt);
          break;
        }
        case 'crown':
          this.setRot(b.bone, -P.crown * 0.4, 0, 0);
          break;
        case 'finger':
          this.setRot(b.bone, -P.finger * 0.5, 0, 0);
          break;
        case 'jaw':
          // 口を開ける（v0.25.0）: + で下顎が下がる。開けすぎない
          this.setRot(b.bone, clamp(P.jaw, 0, 1.2) * 0.42, 0, 0);
          break;
        default:
          break;
      }
    }
  }
}
