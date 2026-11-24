// 大型 11 種（登録簿の 02〜12）と幼体 8 種（14〜21。v0.18.0）の仮モデル（v0.17.0。D-078）。設計図（src/render/creaturePlans.ts）から、骨の通った 1 枚の面を作り、
// 原画を真横から貼る。動きはすべて描画側の計算で、戦闘の判定には影響しない（判定は技データの軌道が持つ）。
//   - 同じ種の体（面の形）は 1 回だけ作って、群れの仲間で使い回す（骨は 1 頭ずつ）。部位が壊れた個体だけ、面を写して暗くする。
//   - 幼体は、親の絵を淡くして貼る（plan.look）。群れの気分（src/game/herd.ts）で、頭を下げて食む・顔を上げて見る・伏せる。
//   - 背骨・脚は「筒」。輪ごとに、近い 2 本の骨へ重みを分けて、関節でなめらかに曲がる。
//   - 角膜・翼・帆・嚢などは、骨を 1 本持つ「板・塊」。技の値（src/render/creatureMoves.ts）で開く・ふくらむ。
//   - 歩く: 進んだ距離で足の周期を進める（足を地面に固定する解き方は無い。滑って見えることがある）。
//   - 怯み・転倒・眠り・罠・死は、体の高さ・傾き・脚の折り方で表す。
// 形・色・動きは、原画 1 枚から作った仮素材。正式モデル（GLB）が来たら置き換える。
import {
  Bone, BufferGeometry, Color, Euler, Float32BufferAttribute, Group, MeshStandardMaterial, SRGBColorSpace, ShapeUtils, Skeleton, SkinnedMesh, type Texture, TextureLoader, Uint16BufferAttribute, Vector2, Vector3,
} from 'three';
import { assetUrl } from '../core/assets';
import { angleDiff, smoothstep } from '../core/math';
import { renderTick } from '../game/action';
import { isGrazing, isWatching } from '../game/herd';
import { isWeak, type MonsterState } from '../game/monster';
import { sampleCurve } from '../game/tracks';
import { CREATURE_ART, type CreatureArt } from './creatureArt';
import { CREATURE_MOVES, sampleMove, type Pose } from './creatureMoves';
import type { CreaturePlan, ExtraPlan, LegPlan } from './creaturePlan';
import type { MonsterRig, MonsterRigCtx } from './monsterRig';

const TAU = Math.PI * 2;
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

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
    const n = clamp(Math.ceil(p1.distanceTo(p2) / step), 2, 14);
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

  constructor(readonly plan: CreaturePlan, readonly art: CreatureArt) {
    this.buildBones();
    this.buildSpine();
    for (const leg of this.legs) this.buildLeg(leg);
    for (const e of plan.extras) this.buildExtra(e);
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
        this.legs.push({ plan: lp, side: side === 0 ? Math.sign(lp.pts[0]![2]) || 1 : side, bones, phase, length });
      }
    }
    // 背骨の領域（重みの分け方）
    const samples = samplePath(this.spinePts, 0.09);
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
        const order = /sail(\d+)/.exec(name)?.[1];
        this.own.set(name, this.addBone(at, par, { kind: 'own', role: e.ch ?? '', index: 0, side: side === 0 ? Math.sign(x) : side, ch: e.ch, order: order ? Number(order) : undefined }));
      }
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

  private buildSpine(): void {
    const p = this.plan;
    const s = p.scale;
    const rad = p.spine.map((q) => [q[2] * s, q[3] * s, q[4] * s] as const);
    const rings = this.spineSamples.map((smp, k) => {
      const i = Math.min(p.spine.length - 2, Math.floor(smp.at));
      const f = smp.at - i;
      const r0 = rad[i]!, r1 = rad[i + 1]!;
      const lerp = (a: number, b: number): number => a + (b - a) * f;
      // 進む向き（前後の点の差）
      const a = this.spineSamples[Math.max(0, k - 1)]!.c, b = this.spineSamples[Math.min(this.spineSamples.length - 1, k + 1)]!.c;
      const t = b.clone().sub(a).normalize();
      const right = new Vector3(1, 0, 0);
      const up = new Vector3().crossVectors(t, right).normalize();
      return { c: smp.c, right, up, top: lerp(r0[0], r1[0]), bot: lerp(r0[1], r1[1]), side: lerp(r0[2], r1[2]), inf: regionWeights(smp.u, this.spineRegions, this.blend) };
    });
    this.tube(this.main, rings, 18);
  }

  private buildLeg(leg: LegRec): void {
    const p = this.plan;
    const s = p.scale;
    const pts = leg.bones.map((b) => this.bones[b]!.world);
    const samples = samplePath(pts, 0.07);
    // 領域: 付け根の背骨の骨 → 関節ごとの骨
    const attach = this.boneForSpine(leg.plan.attach);
    const uAt = (j: number): number => samples.find((q) => q.at >= j - 1e-6)?.u ?? 0;
    // 付け根の背骨の骨（筒の始まりまで）→ 関節 j の骨（j から j+1 まで）。最後の関節の骨は、足先の塊だけを動かす
    const n = leg.bones.length;
    const regs: Region[] = [{ bone: attach, lo: -Infinity, hi: 0 }];
    for (let j = 0; j < n - 1; j++) regs.push({ bone: leg.bones[j]!, lo: uAt(j), hi: j === n - 2 ? Infinity : uAt(j + 1) });
    const blend = clamp(leg.length * 0.08, 0.04, 0.15);
    const rings = samples.map((smp, k) => {
      const i = Math.min(pts.length - 2, Math.floor(smp.at));
      const f = smp.at - i;
      const r = (leg.plan.r[i]! + (leg.plan.r[i + 1]! - leg.plan.r[i]!) * f) * s;
      const a = samples[Math.max(0, k - 1)]!.c, b = samples[Math.min(samples.length - 1, k + 1)]!.c;
      const t = b.clone().sub(a).normalize();
      let right = new Vector3().crossVectors(t, new Vector3(0, 0, 1));
      if (right.lengthSq() < 1e-4) right = new Vector3(1, 0, 0);
      right.normalize();
      const up = new Vector3().crossVectors(t, right).normalize();
      return { c: smp.c, right, up, top: r, bot: r, side: r, inf: regionWeights(smp.u, regs, blend) };
    });
    const from = this.main.count;
    this.tube(this.main, rings, 10);
    // 足先の塊
    if (leg.plan.foot) {
      const last = pts[pts.length - 1]!;
      const lb = leg.bones[leg.bones.length - 1]!;
      const len = leg.plan.foot[0] * s, h = leg.plan.foot[1] * s;
      const w = Math.max(leg.plan.r[leg.plan.r.length - 1]! * s * 1.3, len * 0.35);
      this.ellipsoid(this.main, new Vector3(last.x, Math.max(h * 0.5, last.y - h * 0.2), last.z + len * 0.22), len * 0.5, h * 0.55, w, 0, 0.92, () => [[lb, 1]], 12, 7);
    }
    if (leg.plan.group === 'clawR') this.markPart('claw_r', 'main', from, []);
    if (leg.plan.group === 'clawL') this.markPart('claw_l', 'main', from, []);
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
      const buf = e.glow ? this.glow : this.main;
      const shade = e.shade ?? 1;
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
  yH: 0, pitch: 0, roll: 0, yaw: 0, spineYaw: 0, spinePitch: 0, neckPitch: 0, neckYaw: 0, headPitch: 0, headYaw: 0, jaw: 0, tailYaw: 0, tailPitch: 0, tailCurl: 0,
  crest: 0, wing: 0, wingS: 0, sac: 0, dish: 0, plates: 0, bags: 0, sail: 0, crown: 0, glow: 0, finger: 0, tubes: 0, ring: 0, archFront: 0, archBack: 0,
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
const BODY_CACHE = new Map<CreaturePlan, { body: CreatureBody; main: BufferGeometry; glow: BufferGeometry | null }>();

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
  private lat = 0;
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
  private toppleSide = 1;
  private stepAcc = 0;

  constructor(readonly plan: CreaturePlan, private readonly partIds: readonly string[]) {
    const art = CREATURE_ART[plan.key]!;
    let shared = BODY_CACHE.get(plan);
    if (!shared) {
      const body = new CreatureBody(plan, art);
      shared = { body, main: body.main.build(), glow: body.glow.count > 0 ? body.glow.build() : null };
      BODY_CACHE.set(plan, shared);
    }
    this.body = shared.body;
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
    // 原画の絵（読み込めたら、平均の色から絵へ替える）
    loadArt(art.file, (tex) => {
      this.mat.map = tex;
      this.mat.color.setRGB(tint[0], tint[1], tint[2]);
      this.mat.needsUpdate = true;
    });
  }

  /** 検査用: 骨の数・頂点の数・絵が貼られたか */
  info(): { bones: number; verts: number; glow: number; textured: boolean; height: number } {
    return { bones: this.bones.length, verts: this.body.main.count, glow: this.body.glow.count, textured: !!this.mat.map, height: this.body.height };
  }

  hitFlash(): void {
    this.flash = 1;
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
    const H = this.body.height;
    // ---- 動きの速さ（描画の位置の差から） ----
    const yaw = this.root.rotation.y;
    const px = this.root.position.x, pz = this.root.position.z;
    if (!this.started) {
      this.lastX = px; this.lastZ = pz; this.lastYaw = yaw; this.started = true;
    }
    const dx = px - this.lastX, dz = pz - this.lastZ;
    const dyaw = angleDiff(this.lastYaw, yaw);
    this.lastX = px; this.lastZ = pz; this.lastYaw = yaw;
    const dist = Math.hypot(dx, dz);
    if (dt > 0) {
      const k = 1 - Math.exp(-dt * 8);
      this.speed += (Math.min(20, dist / dt) - this.speed) * k;
      this.lat += (((dx * Math.cos(yaw) - dz * Math.sin(yaw)) / dt) - this.lat) * k;
      this.yawVel += (dyaw / dt - this.yawVel) * k;
    }
    const moveSpeed = m.def.moveSpeed ?? 2.5;
    const gaitAmt = clamp(this.speed / moveSpeed, 0, 1.4) + clamp(Math.abs(this.yawVel) * 0.6, 0, 0.6);
    this.phase += (dist + Math.abs(dyaw) * Math.max(0.6, m.def.bodyRadius) * 0.8) / Math.max(0.3, plan.stride);

    const P = ZERO_POSE();
    // ---- いつもの動き: 呼吸・尾の揺れ・狩人を目で追う ----
    const enraged = m.enraged && !m.dead;
    const weak = isWeak(m);
    const herd = m.herd;
    const breathRate = enraged ? 3.2 : weak || (herd && herd.tired > 0) ? 3.6 : herd ? (herd.mood === 'flee' ? 3 : 1.4) : m.aware ? 1.8 : 1.2;
    const br = Math.sin(time * breathRate);
    P.pitch += br * 0.012;
    P.yH += br * 0.006;
    P.sac += 0.12 + br * 0.08;
    P.bags += br * 0.1;
    P.tailYaw += Math.sin(time * 0.8) * 0.1;
    P.glow += enraged ? 0.45 + 0.25 * Math.sin(time * 6) : 0.1 + 0.06 * Math.sin(time * 1.6);
    if (enraged) { P.crest += 0.25; P.wing += 0.15; P.sail += 0.2; }
    let lookTarget = 0, lookUpTarget = 0;
    if (c.lookAt && !m.dead && !m.asleep && !m.captured && m.aware && (!herd || isWatching(m))) {
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

    // ---- 群れ（幼体）: 立ち止まって頭を下げて食む / 顔を上げて見る（v0.18.0）----
    if (herd) {
      const gk = 1 - Math.exp(-dt * 3);
      this.graze += ((isGrazing(m) && !m.dead && !m.action ? 1 : 0) - this.graze) * gk;
      this.watch += ((isWatching(m) && !m.dead ? 1 : 0) - this.watch) * (1 - Math.exp(-dt * 6));
      if (this.graze > 0.01) {
        // 首の長い体ほど、首を深く下ろす（首の骨の数で）。鳥は体ごと前へ傾ける
        const nib = 0.5 + 0.5 * Math.sin(time * 5.3 + this.partIds.length);
        const necks = plan.roles.split('').filter((r) => r === 'n').length;
        const neck = -Math.min(1.5, 0.5 + 0.38 * necks);
        blendInto(P, { neckPitch: neck, headPitch: -0.35 - 0.12 * nib, jaw: 0.3 * nib, pitch: plan.frame === 'biped' ? -0.3 : -0.06, yH: -0.02, legs: { F: [0.12, 0.05] } }, this.graze);
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

    // ---- 技 ----
    let und = plan.frame === 'serpent' ? 0.12 * Math.min(1, gaitAmt) : 0;
    let scurry = 0, paddle = 0, spin = 0, rollDist = 0, seqSail = 0, windup = 0, side = 1;
    const run = m.action;
    if (run && !m.dead) {
      const mp = plan.moves[run.def.clip];
      const def = mp ? CREATURE_MOVES[mp.kind] : undefined;
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
          if (def.roll) rollDist = sampleCurve(curve, t);
        }
        if (def.shake) {
          const amt = def.shakeIn === 'windup' ? (smp.stage === 'windup' ? smp.windup : 0) : smp.strike;
          P.roll += Math.sin(time * 37) * def.shake * amt;
          P.pitch += Math.sin(time * 29 + 1) * def.shake * amt;
          P.headYaw += Math.sin(time * 23 + 2) * def.shake * 2 * amt;
        }
        if (def.scurry) scurry = def.scurry * (smp.stage === 'strike' ? 1 : smp.strike);
        if (def.paddle) paddle = def.paddle * Math.max(smp.windup * (smp.stage === 'windup' ? 1 : 0), smp.strike);
        if (def.und) und += 0.28 * def.und * (smp.stage === 'windup' ? 0 : 1);
        if (def.wiggle) und += def.wiggle * smp.strike;
        if (def.spin) spin = def.spin * (smp.stage === 'strike' ? 1 : 0);
        if (def.seqSail) seqSail = 1;
        if (spin) {
          const act = run.def.phases.find((ph) => ph.id === 'active');
          const u = act ? clamp((t - act.from) / (act.to - act.from), 0, 1) : 0;
          P.yaw += Math.sin(TAU * u) * 0.8;
        }
      }
    }
    if (scurry) this.phase += dt * 3.5 * scurry;

    // ---- 状態: 怯み・転倒・罠・眠り・死 ----
    const resting = (m.asleep || m.captured || herd?.mood === 'rest') && !m.dead;
    this.rest = resting ? Math.min(1, this.rest + dt * 0.8) : Math.max(0, this.rest - dt * 1.5);
    if (this.rest > 0) {
      const w = smoothstep(this.rest);
      const lie: Pose = plan.frame === 'arch'
        ? { yH: -0.12, archFront: -0.5, archBack: -0.5, ring: -0.2 }
        : { yH: plan.frame === 'serpent' ? -0.15 : -0.42, neckPitch: -0.35, neckYaw: 0.5, headPitch: -0.2, tailYaw: 0.6, crest: -0.4, wing: -0.1, legs: { '*': [0, 1, 0.2] } };
      blendInto(P, lie, w);
      P.pitch += Math.sin(time * 0.9) * 0.01 * w;
    }
    if (m.trapTicks > 0 && !m.dead) {
      this.phase += dt * 2.5;
      P.roll += Math.sin(time * 8) * 0.07;
      P.neckYaw += Math.sin(time * 5.3) * 0.25;
      P.headPitch += Math.sin(time * 7.1) * 0.15;
    }
    if (m.staggerTicks > 0 && !m.dead) {
      const total = Math.max(1, m.staggerTotal);
      const prog = 1 - m.staggerTicks / total;
      if (m.staggerKind === 'topple') {
        const e = smoothstep(prog / 0.2) * (1 - smoothstep((prog - 0.75) / 0.25));
        if (prog < 0.02) this.toppleSide = this.lat >= 0 ? 1 : -1;
        blendInto(P, { roll: 1.25 * this.toppleSide, yH: -0.42, neckPitch: -0.2, tailPitch: -0.2, legs: { '*': [Math.sin(time * 9) * 0.3, 0.4, 0.3] } }, e);
      } else {
        const r = Math.sin(Math.PI * clamp(prog * 1.4, 0, 1));
        const k = m.staggerKind === 'break' || m.staggerKind === 'sever' ? 1.5 : 1;
        P.pitch += 0.12 * r * k;
        P.neckPitch += 0.3 * r * k;
        P.headPitch += 0.25 * r * k;
        P.yH -= 0.04 * r * k;
        P.roll += Math.sin(time * 31) * 0.03 * r;
      }
    }
    if (m.dead) {
      const e = smoothstep((m.deadTicks + c.alpha) / 55);
      blendInto(P, plan.frame === 'arch'
        ? { roll: 1.3, yH: -0.25, archFront: -0.4, archBack: -0.4 }
        : { roll: 1.3, yH: -0.45, neckPitch: -0.4, headPitch: -0.2, tailPitch: -0.2, crest: -0.4, wing: 0.2, legs: { '*': [0, 0.35, 0.4] } }, e);
    }
    // のけぞり（叩かれた向き）
    const decay = Math.exp(-dt * 6);
    this.react.yaw *= decay; this.react.pitch *= decay; this.react.roll *= decay;
    P.yaw += this.react.yaw; P.pitch += this.react.pitch; P.roll += this.react.roll;

    // 部位の破壊（壊れた部位は、暗く縮む）
    m.def.parts.forEach((part, i) => {
      if (m.parts[i]!.broken && !this.broken.has(part.id)) this.breakPart(part.id);
    });

    this.apply(P, { gaitAmt: m.dead || this.rest > 0.5 ? 0 : gaitAmt, und, paddle, rollDist, seqSail, windup, side, time, H });

    // 光・叩かれた時の光
    this.flash = Math.max(0, this.flash - dt * 6);
    this.mat.emissive.setRGB(this.pale[0] + this.flash * 0.55, this.pale[1] + this.flash * 0.45, this.pale[2] + this.flash * 0.3);
    if (this.glowMat) this.glowMat.emissiveIntensity = m.dead ? 0.05 : clamp(0.2 + P.glow * 1.4, 0, 2.2);

    // 足音（歩いた距離ごと）
    if (c.fx && !m.dead && this.rest < 0.5) {
      this.stepAcc += dist;
      const stepLen = Math.max(0.6, plan.stride * 0.5);
      if (this.stepAcc > stepLen) {
        this.stepAcc = 0;
        // 小さな体（幼体）は軽い足音
        const heavy = plan.frame === 'quad' && H > 1.5 ? 0.9 : H < 0.7 ? 0.15 : 0.5;
        c.fx.footfall(px, 0, pz, heavy);
      }
    }
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

  private setRot(b: Bone, rx: number, ry: number, rz: number): void {
    this.euler.set(rx, ry, rz, 'YXZ');
    b.quaternion.setFromEuler(this.euler);
  }

  private apply(P: FullPose, o: { gaitAmt: number; und: number; paddle: number; rollDist: number; seqSail: number; windup: number; side: number; time: number; H: number }): void {
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
      if (i === root) {
        rx += -P.pitch;
        ry += P.yaw;
        rz += P.roll;
        if (plan.frame === 'biped' || plan.frame === 'quad') rz += Math.sin(TAU * this.phase) * 0.025 * Math.min(1, o.gaitAmt);
        const pos = b.rest.clone();
        pos.y += P.yH * o.H + Math.abs(Math.sin(TAU * this.phase)) * 0.03 * Math.min(1, o.gaitAmt) * (plan.frame === 'serpent' ? 0 : 1);
        if (arch && o.rollDist) {
          // 輪になって転がる: 輪の中心のまわりに回す
          const th = o.rollDist / Math.max(0.5, ringR);
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
      }
      if (b.role === 'b' && i < root) ry += -P.spineYaw * 0.3 / Math.max(1, tailSideBody.length);
      if (headSideBody.length === 0 && i === root) {
        ry += P.spineYaw * 0.5;
        rx += -P.spinePitch * 0.5;
      }
      if (b.role === 'n') {
        rx += -P.neckPitch / Math.max(1, neck.length);
        ry += P.neckYaw / Math.max(1, neck.length);
        if (headSideBody.length === 0) ry += P.spineYaw * 0.5 / Math.max(1, neck.length);
      }
      if (b.role === 'h') {
        rx += -P.headPitch;
        ry += P.headYaw;
      }
      if (b.role === 't') {
        const k = tail.indexOf(b);
        const w = (k + 1) / tail.length;
        ry += -P.tailYaw * (0.5 + w) * 1.2 / tail.length;
        rx += P.tailPitch * (0.5 + w) * 1.2 / tail.length;
        ry += Math.sin(o.time * 1.1 - k * 0.6) * 0.035 * w;
        if (P.tailCurl) rx += P.tailCurl * w * 0.4;
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
      // 歩く周期
      const ph = TAU * (this.phase + leg.phase);
      const amt = Math.min(1.2, o.gaitAmt);
      swing += Math.sin(ph) * 0.3 * amt;
      lift += Math.max(0, Math.cos(ph)) * 0.55 * Math.min(1, amt * 1.5);
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
        case 'wing': {
          const w = P.wing + (s === o.side ? P.wingS : 0);
          this.setRot(b.bone, -0.15 * w, s * 0.25 * w, s * (0.04 + 1.0 * w));
          break;
        }
        case 'sac':
          b.bone.scale.setScalar(bk * (1 + 0.25 * P.sac));
          break;
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
          const amt = o.seqSail ? P.sail * smoothstep((o.windup * 1.7 - order * 0.09) / 0.35) : P.sail;
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
        default:
          break;
      }
    }
  }
}
