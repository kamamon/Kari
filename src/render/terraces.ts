// 段差の見た目。v0.31.0 は 0 より低い段（里の炉の段と階段）だけ。v0.35.0（ChatGPT の里の設計 #11 の P1）から、里の段はすべて:
// 地面の板の穴・床・擁壁（崖）・柵・沢の水面と小滝・吊り橋。
// 形の正本はマップデータの platforms。床の高さは simulation と同じ groundAt で決める。描画だけで、当たりは変えない
// （段の縁から落ちないのは、マップの stepDown。柵は、それを見せるための飾り）。
import {
  BoxGeometry, BufferGeometry, DataTexture, DoubleSide, Float32BufferAttribute, Group, LinearFilter, LinearMipmapLinearFilter, Mesh, MeshLambertMaterial, Quaternion,
  RepeatWrapping, SRGBColorSpace, Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { PlatformLook } from '../data/schemas';
import { ENV_TILES, tileMaterial } from './envArt';
import { patchNoise } from './noise';
import { bindSurfaceImage, imageLambert, projectSurfaceUV } from './materialImages';

export interface TerracePlatform {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  h: number;
  look?: PlatformLook;
}

type Bounds = { minX: number; maxX: number; minZ: number; maxZ: number };

/** 擁壁の 1 枚: (ax, az) → (bx, bz) の線上に、lo から hi まで立つ。面は (nx, nz) の向き（低い側）を向く */
export interface WallSegment {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  lo: number;
  hi: number;
  nx: number;
  nz: number;
  /** 高い側と低い側の床の描き方（段差の無い地面なら undefined） */
  upper?: PlatformLook;
  lower?: PlatformLook;
  /** 'fall' は沢の小滝（高い側も低い側も水面）。ほかは岩の擁壁 */
  kind: 'rock' | 'fall';
}

/** これより深い下りの縁には、柵を立てる（m） */
export const RAIL_DROP = 0.5;
const EPS = 1e-3;

/**
 * 段差の並びから、その場所の床を引く索引（2m のます目ごとに、かかる段差を覚える）。groundAt と同じ決まり
 * （縁を含む。重なれば最も高いもの。どれにも重ならなければ 0）。里は段差が 400 ほどあるので、描く時の計算を速くする。
 */
export class PlatformIndex {
  private cells = new Map<number, TerracePlatform[]>();
  private static readonly C = 2;

  constructor(readonly platforms: readonly TerracePlatform[]) {
    for (const p of platforms) {
      for (let i = Math.floor(p.minX / PlatformIndex.C); i <= Math.floor(p.maxX / PlatformIndex.C); i++) {
        for (let j = Math.floor(p.minZ / PlatformIndex.C); j <= Math.floor(p.maxZ / PlatformIndex.C); j++) {
          const k = PlatformIndex.key(i, j);
          const l = this.cells.get(k);
          if (l) l.push(p);
          else this.cells.set(k, [p]);
        }
      }
    }
  }

  private static key(i: number, j: number): number {
    return (i + 4096) * 8192 + (j + 4096);
  }

  /** その場所の、いちばん高い段差（無ければ null） */
  top(x: number, z: number): TerracePlatform | null {
    const l = this.cells.get(PlatformIndex.key(Math.floor(x / PlatformIndex.C), Math.floor(z / PlatformIndex.C)));
    let best: TerracePlatform | null = null;
    if (l) for (const p of l) if (x >= p.minX && x <= p.maxX && z >= p.minZ && z <= p.maxZ && (!best || p.h > best.h)) best = p;
    return best;
  }

  ground(x: number, z: number): number {
    return this.top(x, z)?.h ?? 0;
  }
}

/**
 * 段差の境の壁: どの段差の縁も見て、外と内の高さが違う所に立てる（面は低い側を向く。階段の蹴上げも含む）。高さは groundAt と同じ決まりで測る
 * （重なる段差も正しく扱う）。縁は、ほかの段差の境で区切り、同じ所を 2 度数えない（隣り合う 2 つの段差の縁は、同じ線）。
 * 同じ高さの続きは 1 枚にまとめる。里の外周（bounds）の上の縁は作らない（外周の崖が立つ）。外周に届く壁は、外へ 1m 延ばす（外周の崖の後ろへ入れる）。
 */
export function terraceWalls(platforms: readonly TerracePlatform[], bounds?: Bounds): WallSegment[] {
  const idx = new PlatformIndex(platforms);
  const xsAll = [...new Set(platforms.flatMap((p) => [p.minX, p.maxX]))].sort((a, b) => a - b);
  const zsAll = [...new Set(platforms.flatMap((p) => [p.minZ, p.maxZ]))].sort((a, b) => a - b);
  const pieces = new Map<string, WallSegment>();
  for (const p of platforms) {
    const edges = [
      { alongX: false, at: p.maxX, from: p.minZ, to: p.maxZ, sign: 1 },
      { alongX: false, at: p.minX, from: p.minZ, to: p.maxZ, sign: -1 },
      { alongX: true, at: p.maxZ, from: p.minX, to: p.maxX, sign: 1 },
      { alongX: true, at: p.minZ, from: p.minX, to: p.maxX, sign: -1 },
    ];
    for (const e of edges) {
      if (bounds && (e.alongX ? e.at === bounds.minZ || e.at === bounds.maxZ : e.at === bounds.minX || e.at === bounds.maxX)) continue;
      const all = e.alongX ? xsAll : zsAll;
      const pts = [e.from];
      for (const v of all) if (v > e.from + 1e-9 && v < e.to - 1e-9) pts.push(v);
      pts.push(e.to);
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i]!, b = pts[i + 1]!, m = (a + b) / 2;
        const [ox, oz] = e.alongX ? [m, e.at + e.sign * EPS] : [e.at + e.sign * EPS, m];
        const [ix, iz] = e.alongX ? [m, e.at - e.sign * EPS] : [e.at - e.sign * EPS, m];
        const outside = idx.ground(ox, oz), inside = idx.ground(ix, iz);
        if (Math.abs(outside - inside) <= 0.01) continue;
        const key = `${e.alongX ? 'z' : 'x'}${e.at.toFixed(4)}:${a.toFixed(4)}:${b.toFixed(4)}`;
        if (pieces.has(key)) continue;
        const outLow = outside < inside;
        const n = outLow ? e.sign : -e.sign;
        const hiP = outLow ? idx.top(ix, iz) : idx.top(ox, oz);
        const loP = outLow ? idx.top(ox, oz) : idx.top(ix, iz);
        const kind = hiP?.look === 'water' && loP?.look === 'water' ? 'fall' : 'rock';
        const base = { lo: Math.min(outside, inside), hi: Math.max(outside, inside), upper: hiP?.look, lower: loP?.look, kind } as const;
        pieces.set(key, e.alongX ? { ax: a, az: e.at, bx: b, bz: e.at, nx: 0, nz: n, ...base } : { ax: e.at, az: a, bx: e.at, bz: b, nx: n, nz: 0, ...base });
      }
    }
  }
  // 同じ線・同じ向き・同じ高さ・同じ種類の続きを、1 枚にまとめる
  const groups = new Map<string, WallSegment[]>();
  for (const w of pieces.values()) {
    const k = w.nx !== 0 ? `x${w.ax.toFixed(4)}:${w.nx}` : `z${w.az.toFixed(4)}:${w.nz}`;
    const key = `${k}:${w.lo.toFixed(4)}:${w.hi.toFixed(4)}:${w.kind}:${w.upper ?? ''}:${w.lower ?? ''}`;
    const l = groups.get(key);
    if (l) l.push(w);
    else groups.set(key, [w]);
  }
  const out: WallSegment[] = [];
  for (const list of groups.values()) {
    const byX = list[0]!.nz !== 0;
    const s0 = (w: WallSegment): number => (byX ? Math.min(w.ax, w.bx) : Math.min(w.az, w.bz));
    const s1 = (w: WallSegment): number => (byX ? Math.max(w.ax, w.bx) : Math.max(w.az, w.bz));
    list.sort((p, q) => s0(p) - s0(q));
    let cur: WallSegment | null = null;
    for (const w of list) {
      if (cur && s0(w) <= s1(cur) + 1e-6) {
        if (byX) cur.bx = Math.max(cur.bx, s1(w));
        else cur.bz = Math.max(cur.bz, s1(w));
        continue;
      }
      cur = byX ? { ...w, ax: s0(w), bx: s1(w) } : { ...w, az: s0(w), bz: s1(w) };
      out.push(cur);
    }
  }
  if (bounds) {
    for (const w of out) {
      if (w.nz !== 0) {
        if (w.ax <= bounds.minX + 1e-6) w.ax = bounds.minX - 1;
        if (w.bx >= bounds.maxX - 1e-6) w.bx = bounds.maxX + 1;
      } else {
        if (w.az <= bounds.minZ + 1e-6) w.az = bounds.minZ - 1;
        if (w.bz >= bounds.maxZ - 1e-6) w.bz = bounds.maxZ + 1;
      }
    }
  }
  return out;
}

/**
 * 柵の線: 柵の要る擁壁（下りが RAIL_DROP 以上）を、同じ線・同じ上の高さで続く所ごとに 1 本にまとめる。柵は高い側に立つ。
 * 高い側が水面（小滝）と、歩いては行けない岩の床（裂け目の底）には立てない。高い側が吊り橋なら、縄の柵（upper が 'bridge'）。
 */
export function railLines(walls: readonly WallSegment[]): WallSegment[] {
  const key = (w: WallSegment): string =>
    (w.nx !== 0 ? `x${w.ax.toFixed(3)}:${w.nx}:${w.hi.toFixed(3)}` : `z${w.az.toFixed(3)}:${w.nz}:${w.hi.toFixed(3)}`) + (w.upper === 'bridge' ? ':rope' : '');
  const groups = new Map<string, WallSegment[]>();
  for (const w of walls) {
    if (w.hi - w.lo < RAIL_DROP || w.upper === 'water' || w.upper === 'rock') continue;
    const k = key(w);
    groups.set(k, [...(groups.get(k) ?? []), w]);
  }
  const lines: WallSegment[] = [];
  for (const list of groups.values()) {
    const byX = list[0]!.nz !== 0;
    const span = list.map((w) => (byX ? [Math.min(w.ax, w.bx), Math.max(w.ax, w.bx)] : [Math.min(w.az, w.bz), Math.max(w.az, w.bz)]) as [number, number]).sort((a, b) => a[0] - b[0]);
    let [s0, s1] = span[0]!;
    const flush = (): void => {
      const w = list[0]!;
      lines.push(byX ? { ...w, ax: s0, bx: s1, lo: Math.min(...list.map((q) => q.lo)) } : { ...w, az: s0, bz: s1, lo: Math.min(...list.map((q) => q.lo)) });
    };
    for (const [a, b] of span.slice(1)) {
      if (a <= s1 + 1e-6) s1 = Math.max(s1, b);
      else {
        flush();
        [s0, s1] = [a, b];
      }
    }
    flush();
  }
  return lines;
}

/** 1 本につないだ柵（同じ線の上で、続いていて、高さの差が 1 段ぶん以下の柵の線を、端から端まで） */
export interface RailRun {
  /** 線が x に沿うか（z が一定）。at はその一定の座標、off は高い側へずらす量（0.07m） */
  byX: boolean;
  at: number;
  off: number;
  s0: number;
  s1: number;
  rope: boolean;
  /** 柱の立つ床（その位置の高い側の床） */
  floor: (s: number) => number;
  /** 柵の高さの元の線（段の真ん中を結んだ線。段の上でも、柵の上の横木は斜めにまっすぐ） */
  profile: (s: number) => number;
}

/** 柵の線を、階段に沿ってつなぐ（railLines の後）。段の高さの差が 0.4m 以下で、隙間なく続く所を 1 本にする */
export function railRuns(lines: readonly WallSegment[]): RailRun[] {
  const groups = new Map<string, WallSegment[]>();
  for (const w of lines) {
    const k = (w.nx !== 0 ? `x${w.ax.toFixed(3)}:${w.nx}` : `z${w.az.toFixed(3)}:${w.nz}`) + (w.upper === 'bridge' ? ':rope' : '');
    groups.set(k, [...(groups.get(k) ?? []), w]);
  }
  const out: RailRun[] = [];
  for (const list of groups.values()) {
    const w0 = list[0]!;
    const byX = w0.nz !== 0;
    const segs = list.map((w) => ({ s0: byX ? Math.min(w.ax, w.bx) : Math.min(w.az, w.bz), s1: byX ? Math.max(w.ax, w.bx) : Math.max(w.az, w.bz), hi: w.hi })).sort((a, b) => a.s0 - b.s0);
    let cur: typeof segs = [];
    const flush = (): void => {
      if (cur.length === 0) return;
      const run = cur;
      const mids = run.map((q) => [(q.s0 + q.s1) / 2, q.hi] as const);
      out.push({
        byX,
        at: byX ? w0.az : w0.ax,
        off: byX ? -w0.nz * 0.07 : -w0.nx * 0.07,
        s0: run[0]!.s0,
        s1: run[run.length - 1]!.s1,
        rope: w0.upper === 'bridge',
        floor: (sv) => (run.find((q) => sv >= q.s0 - 1e-6 && sv <= q.s1 + 1e-6) ?? run[run.length - 1]!).hi,
        profile: (sv) => {
          if (mids.length === 1 || sv <= mids[0]![0]) return run.length === 1 ? run[0]!.hi : Math.max(mids[0]![1], run[0]!.hi);
          for (let i = 0; i + 1 < mids.length; i++) {
            const [a, ha] = mids[i]!, [b, hb] = mids[i + 1]!;
            if (sv <= b) return ha + ((hb - ha) * (sv - a)) / (b - a);
          }
          return mids[mids.length - 1]![1];
        },
      });
      cur = [];
    };
    for (const q of segs) {
      const last = cur[cur.length - 1];
      if (last && q.s0 <= last.s1 + 1e-6 && Math.abs(q.hi - last.hi) <= 0.4) cur.push(q);
      else {
        flush();
        cur = [q];
      }
    }
    flush();
  }
  return out;
}

/**
 * 地面の板に、段差の穴を開ける: 格子（おおよそ cell の間隔に、穴の縁の線を足す）を作り、穴の中のます目を除く。
 * keep を渡すと、それが false のます目も除く（里の外周の外で、広場の高さでない所）。位置と上向きの法線だけ（uv と色は、呼んだ側が付ける）。
 */
export function holedGround(cx: number, cz: number, gw: number, gd: number, holes: readonly TerracePlatform[], cell = 5, keep?: (x: number, z: number) => boolean): BufferGeometry {
  const lines = (c: number, size: number, edges: number[]): number[] => {
    const n = Math.ceil(size / cell);
    const v = new Set<number>();
    for (let i = 0; i <= n; i++) v.add(c - size / 2 + (size * i) / n);
    for (const e of edges) if (e > c - size / 2 && e < c + size / 2) v.add(e);
    return [...v].sort((a, b) => a - b);
  };
  const xs = lines(cx, gw, holes.flatMap((h) => [h.minX, h.maxX]));
  const zs = lines(cz, gd, holes.flatMap((h) => [h.minZ, h.maxZ]));
  const idx = new PlatformIndex(holes);
  const pos: number[] = [], nor: number[] = [], idxs: number[] = [];
  for (const z of zs) for (const x of xs) pos.push(x, 0, z), nor.push(0, 1, 0);
  const at = (i: number, j: number): number => j * xs.length + i;
  for (let j = 0; j + 1 < zs.length; j++) {
    for (let i = 0; i + 1 < xs.length; i++) {
      const mx = (xs[i]! + xs[i + 1]!) / 2, mz = (zs[j]! + zs[j + 1]!) / 2;
      const hp = idx.top(mx, mz);
      if (hp && mx > hp.minX && mx < hp.maxX && mz > hp.minZ && mz < hp.maxZ) continue;
      if (keep && !keep(mx, mz)) continue;
      const a = at(i, j), b = at(i, j + 1), c = at(i + 1, j), d = at(i + 1, j + 1);
      idxs.push(a, b, c, c, b, d);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  g.setIndex(idxs);
  return g;
}

/** 四角い面 1 枚（4 点。a→b→c→d が表から見て反時計回り）。uv は (u, v) の 4 組 */
function quad(pts: number[][], uv: number[][], n: [number, number, number]): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pts.flat(), 3));
  g.setAttribute('normal', new Float32BufferAttribute([...n, ...n, ...n, ...n], 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv.flat(), 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

/** 箱（柵の柱と横木）。中心と大きさ（軸にそろう） */
function box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number): BufferGeometry {
  const g = new BufferGeometry();
  const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z0 = cz - sz / 2, z1 = cz + sz / 2;
  const faces: [number[][], [number, number, number]][] = [
    [[[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0]],
    [[[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0]],
    [[[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0]],
    [[[x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [x0, y0, z0]].reverse(), [0, -1, 0]],
    [[[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1]],
    [[[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1]],
  ];
  return mergeGeometries(faces.map(([p, n]) => quad(p, [[0, 0], [1, 0], [1, 1], [0, 1]], n)))!;
}

const tmpQ = new Quaternion();
const X_AXIS = new Vector3(1, 0, 0);
/** 2 点の間に渡した角材（縄にも使う）。太さ t */
function beam(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, t: number): BufferGeometry {
  const d = new Vector3(x1 - x0, y1 - y0, z1 - z0);
  const len = d.length();
  const g = new BoxGeometry(len, t, t);
  g.deleteAttribute('uv');
  tmpQ.setFromUnitVectors(X_AXIS, d.normalize());
  g.applyQuaternion(tmpQ);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
}

/**
 * 水の絵（つなぎ目の無い縞。64 × 128）。沢の水面と小滝で、流れの向きへ動かす（animateTerraces）。
 * 縞は、整数の周波数の sin の和（端と端がつながる）。fall は白い泡の筋を多く、縦に長く。
 */
function waterTexture(fall: boolean): DataTexture {
  const W = 64, H = 128;
  const data = new Uint8Array(W * H * 4);
  const waves = fall
    ? [[3, 1, 0.9, 0.3], [7, 2, 0.6, 1.7], [13, 3, 0.4, 2.9], [5, 1, 0.5, 4.1]]
    : [[1, 3, 0.8, 0.4], [2, 7, 0.5, 2.2], [3, 11, 0.35, 1.1], [1, 5, 0.45, 3.3]];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let n = 0, sum = 0;
      for (const [fx, fy, amp, ph] of waves) {
        n += amp! * Math.sin(2 * Math.PI * (fx! * x / W + fy! * y / H) + ph! + Math.sin(2 * Math.PI * y / H * 2 + x * 0.3) * 0.6);
        sum += amp!;
      }
      n = 0.5 + 0.5 * (n / sum);
      const i = (y * W + x) * 4;
      if (fall) {
        const v = 0.72 + 0.28 * n;
        data[i] = 214 * v;
        data[i + 1] = 228 * v;
        data[i + 2] = 226 * v;
        data[i + 3] = 150 + 105 * n;
      } else {
        // 細かい揺らぎ（ます目ごとの値を混ぜる）を足して、縞が並んで見えないように。光る所は弱く
        const h = (Math.imul(x * 73856093 ^ y * 19349663, 2654435761) >>> 0) / 4294967296;
        const m = n * 0.8 + h * 0.2;
        const hi = Math.max(0, (m - 0.7) / 0.3);
        data[i] = 64 + 30 * m + 52 * hi;
        data[i + 1] = 84 + 30 * m + 50 * hi;
        data[i + 2] = 80 + 28 * m + 46 * hi;
        data[i + 3] = 255;
      }
    }
  }
  const t = new DataTexture(data, W, H);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/**
 * 石積みの絵（256 四方。高さの違う段に、長さの違う石を並べる。石ごとに明るさと色み、縁は丸く陰を付け、目地は暗く細く）。1 枚 = 3m。
 * 設計 #11 の「石積みの擁壁と基礎は、上の床を支える構造が見える形にする」。絵の素材が届くまでの、計算で作る仮の絵
 */
function masonryTexture(): DataTexture {
  const W = 256, H = 256, MORTAR = 2;
  const data = new Uint8Array(W * H * 4);
  let seed = 90127;
  const rnd = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const hash = (x: number, y: number): number => {
    let h = (Math.imul(x & 255, 374761393) + Math.imul(y & 255, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  // 段の高さ（合計 256。端と端がつながる）
  const rows: number[] = [];
  for (let y = 0; y < H;) {
    const hgt = Math.min(H - y, 26 + Math.floor(rnd() * 22));
    rows.push(hgt);
    y += hgt;
  }
  if (rows.length > 1 && rows[rows.length - 1]! < 18) rows[rows.length - 2]! += rows.pop()!;
  let y0 = 0;
  for (const rh of rows) {
    const cuts: number[] = [];
    let x = Math.floor(rnd() * 40);
    const first = x;
    while (x < first + W - 24) {
      cuts.push(x % W);
      x += 30 + Math.floor(rnd() * 50);
    }
    const stones = cuts.map(() => ({ v: 0.78 + rnd() * 0.28, t: (rnd() - 0.5) * 0.08, g: (rnd() - 0.5) * 0.03 }));
    for (let y = y0; y < y0 + rh; y++) {
      const yy = y - y0;
      for (let px = 0; px < W; px++) {
        let k = 0, dx = W;
        cuts.forEach((c, i) => {
          const d = (px - c + W) % W;
          if (d < dx) {
            dx = d;
            k = i;
          }
        });
        const toNext = (cuts[(k + 1) % cuts.length]! - px + W) % W;
        // 石の縁までの距離（角は丸める）
        const ex = Math.min(dx - MORTAR, toNext), ey = Math.min(yy - MORTAR, rh - 1 - yy);
        const r = 5;
        const corner = ex < r && ey < r ? r - Math.hypot(r - ex, r - ey) : Math.min(ex, ey);
        const noise = hash(px, y) * 0.5 + hash(px >> 2, y >> 2) * 0.5;
        const i = (y * W + px) * 4;
        if (corner < 0) {
          const m = 0.36 + 0.08 * noise;
          data[i] = 110 * m * 1.1;
          data[i + 1] = 104 * m * 1.1;
          data[i + 2] = 94 * m * 1.1;
        } else {
          const st = stones[k]!;
          // 縁の陰（上と左は明るく、下と右は暗く）
          const bevel = Math.min(1, corner / 6);
          const light = yy - MORTAR < 6 || dx - MORTAR < 6 ? 1.06 : rh - 1 - yy < 6 || toNext < 6 ? 0.86 : 1;
          const v = st.v * (0.78 + 0.22 * bevel) * (bevel < 1 ? light : 1) * (0.86 + 0.24 * noise);
          data[i] = Math.min(255, 168 * v * (1 + st.t));
          data[i + 1] = Math.min(255, 158 * v * (1 + st.g));
          data[i + 2] = Math.min(255, 140 * v * (1 - st.t));
        }
        data[i + 3] = 255;
      }
    }
    y0 += rh;
  }
  const t = new DataTexture(data, W, H);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.needsUpdate = true;
  return t;
}

let masonryMat: MeshLambertMaterial | null = null;
function masonryMaterial(): MeshLambertMaterial {
  if (!masonryMat) {
    masonryMat = new MeshLambertMaterial({ map: masonryTexture(), vertexColors: true });
    masonryMat.color.setScalar(1.12);
    bindSurfaceImage(masonryMat,'masonry',{raw:true,gain:1.5,replaceFallback:true,bump:.07});
    masonryMat.userData.uv = true;
  }
  return masonryMat;
}

let waterMat: MeshLambertMaterial | null = null;
let fallMat: MeshLambertMaterial | null = null;
function waterMaterials(): { water: MeshLambertMaterial; fall: MeshLambertMaterial } {
  if (!waterMat) {
    waterMat = new MeshLambertMaterial({ map: waterTexture(false), emissive: 0x101c1b });
    waterMat.userData.uv = true;
    bindSurfaceImage(waterMat,'water',{animated:true,replaceFallback:true,gain:1.28});
  }
  if (!fallMat) {
    fallMat = new MeshLambertMaterial({ map: waterTexture(true), transparent: true, side: DoubleSide, emissive: 0x3a4846 });
    fallMat.userData.uv = true;
  }
  return { water: waterMat, fall: fallMat };
}

/** 沢の水面（南へ）と小滝（下へ）の絵を、時刻 t（秒）に合わせて動かす（描画の側が毎フレーム呼ぶ） */
export function animateTerraces(t: number): void {
  if (waterMat?.map) waterMat.map.offset.set(Math.sin(t * 0.3) * 0.02, -t * 0.35);
  if (fallMat?.map) fallMat.map.offset.set(0, t * 1.1);
}

/** 自然の岩の壁か（裂け目の岩の床に面する壁）。ほかは石積み */
const natural = (w: WallSegment): boolean => w.upper === 'rock' || w.lower === 'rock';

/**
 * 1 つの擁壁の形。自然の岩の壁で高さ 1m 以上は、ます目に切って、中の点を低い側へ少しふくらませる（岩の凹凸。上と下の縁と両端は動かさない）。
 * 石積みは平ら（目地の絵）で、高さ 1.5m 以上の段の縁には、上に笠石（0.22m、低い側へ 0.1m 出る）を載せる
 */
function wallGeometry(w: WallSegment, wt: number, noise: (x: number, z: number) => number): BufferGeometry {
  const len = Math.hypot(w.bx - w.ax, w.bz - w.az);
  const along = (x: number, z: number): number => (w.nx !== 0 ? z : x);
  // 表から見て反時計回りになる並び: 面の向き n と、線の向き (b - a) の外積が上を向く順
  const dx = w.bx - w.ax, dz = w.bz - w.az;
  const flip = w.nx * dz - w.nz * dx > 0;
  const [a, b] = flip ? [[w.bx, w.bz], [w.ax, w.az]] : [[w.ax, w.az], [w.bx, w.bz]];
  const H = w.hi - w.lo;
  const tall = H >= 1 && w.kind === 'rock' && natural(w);
  // 高い壁は、ます目に切る（自然の岩は凹凸、石積みは色むらのため）
  const grid = H >= 1 && w.kind === 'rock';
  const nu = grid ? Math.max(1, Math.ceil(len / 1.2)) : 1, nv = grid ? Math.max(1, Math.ceil(H / 1)) : 1;
  const pos: number[] = [], uv: number[] = [], col: number[] = [], index: number[] = [];
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const t = i / nu, y = w.lo + (H * j) / nv;
      let x = a[0]! + (b[0]! - a[0]!) * t, z = a[1]! + (b[1]! - a[1]!) * t;
      const u = along(x, z);
      if (tall && i > 0 && i < nu && j > 0 && j < nv) {
        const d = 0.22 * Math.max(0, noise(u * 2.3, y * 2.3) * 1.6 - 0.45);
        x += w.nx * d;
        z += w.nz * d;
      }
      pos.push(x, y, z);
      uv.push(u / wt, y / wt);
      // 根元ほど暗く（地面との境の陰）。少しの色むら（石積みは、縦の雨の筋）。草の段の下の崖は、上の縁が少し緑がかる
      const ao = 0.74 + 0.26 * Math.min(1, Math.max(0, (y - w.lo) / 2.2));
      const v = ao * (tall ? 0.92 + 0.16 * noise(u * 0.7 + 31, y * 0.7) : 0.84 + 0.14 * noise(u * 1.3 + 17, y * 0.08 + 5) + 0.12 * noise(u * 0.25 + 3, y * 0.35 - 9));
      const moss = w.upper === 'grass' && w.hi - y < 0.6 ? 1 : 0;
      col.push(v * (1 - 0.06 * moss), v * (1 + 0.03 * moss), v * (1 - 0.12 * moss));
    }
  }
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const p = j * (nu + 1) + i, q = p + 1, r = p + nu + 1, s = r + 1;
      index.push(p, q, s, p, s, r);
    }
  }
  // 石積みの笠石（段の縁。高さ 1.5m 以上、上が石段でない所）: 上の面と、低い側の面
  if (!tall && w.kind === 'rock' && H >= 1.5 && w.upper !== 'stone') {
    const o = 0.1, t = 0.22;
    const base = pos.length / 3;
    const pts = [[a[0]!, a[1]!], [b[0]!, b[1]!]];
    const top = w.hi + 0.02;
    // 前の面（低い側へ o 出す。下の端 top - t）と、上の面（壁の線から o 先まで）
    for (const [y, out] of [[top - t, o], [top, o], [top, 0]] as const) {
      for (const [x, z] of pts) {
        pos.push(x! + w.nx * out, y, z! + w.nz * out);
        uv.push(along(x!, z!) / wt, y / wt + (out === 0 ? 0.05 : 0));
        col.push(0.95, 0.94, 0.9);
      }
    }
    index.push(base, base + 1, base + 3, base, base + 3, base + 2, base + 2, base + 3, base + 5, base + 2, base + 5, base + 4);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** 床の格子（cell m ごとに点を置き、色むらを頂点の色で）。外周に届く床は、外へ 1m 延ばす（外周の崖の下へ入れる） */
function floorGeometry(p: TerracePlatform, tile: number, noise: ((x: number, z: number) => number) | null, bounds?: Bounds, cell = 4): BufferGeometry {
  const x0 = bounds && p.minX <= bounds.minX ? p.minX - 1 : p.minX, x1 = bounds && p.maxX >= bounds.maxX ? p.maxX + 1 : p.maxX;
  const z0 = bounds && p.minZ <= bounds.minZ ? p.minZ - 1 : p.minZ, z1 = bounds && p.maxZ >= bounds.maxZ ? p.maxZ + 1 : p.maxZ;
  const nx = noise ? Math.max(1, Math.ceil((x1 - x0) / cell)) : 1, nz = noise ? Math.max(1, Math.ceil((z1 - z0) / cell)) : 1;
  const pos: number[] = [], uv: number[] = [], col: number[] = [], nor: number[] = [], index: number[] = [];
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const x = x0 + ((x1 - x0) * i) / nx, z = z0 + ((z1 - z0) * j) / nz;
      pos.push(x, p.h, z);
      nor.push(0, 1, 0);
      uv.push(x / tile, -z / tile);
      const s = noise ? 1 - 0.2 * noise(x, z) : 1;
      const warm = noise ? (noise(x + 91, z + 53) - 0.5) * 0.14 : 0;
      col.push(s * (1 + warm), s, s * (1 - warm));
    }
  }
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
      index.push(a, c, b, b, c, d);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.setIndex(index);
  return g;
}

/** 吊り橋の板と桁と柱（歩く向きは、両端が同じ高さの床につながる向き）。縄の柵は railLines の 'bridge' から */
function bridgeGeometry(p: TerracePlatform, idx: PlatformIndex): BufferGeometry[] {
  const alongX = Math.abs(idx.ground(p.minX - 0.05, (p.minZ + p.maxZ) / 2) - p.h) < 0.01 && Math.abs(idx.ground(p.maxX + 0.05, (p.minZ + p.maxZ) / 2) - p.h) < 0.01;
  const out: BufferGeometry[] = [];
  const [s0, s1, w0, w1] = alongX ? [p.minX, p.maxX, p.minZ, p.maxZ] : [p.minZ, p.maxZ, p.minX, p.maxX];
  const place = (s: number, w: number, y: number, ls: number, lw: number, ly: number): BufferGeometry =>
    alongX ? box(s, y, w, ls, ly, lw) : box(w, y, s, lw, ly, ls);
  // 板（歩く向きに 0.26m、すき間 0.04m）。両端は、床の縁の上に少しかかる
  for (let s = s0 - 0.2 + 0.15; s < s1 + 0.2; s += 0.3) out.push(place(s, (w0 + w1) / 2, p.h - 0.04, 0.26, w1 - w0 - 0.1, 0.08));
  // 桁（両わき）
  for (const w of [w0 + 0.18, w1 - 0.18]) out.push(place((s0 + s1) / 2, w, p.h - 0.2, s1 - s0 + 1.2, 0.16, 0.22));
  return out;
}

/** 段差の床・擁壁・柵・水面・小滝・吊り橋（描画は、床の絵の種類 + 擁壁・小滝・水面・木の 4 回まで） */
export function buildTerraces(platforms: readonly TerracePlatform[], gain: number, bounds?: Bounds): Group {
  const g = new Group();
  g.name = 'terraces';
  if (platforms.length === 0) return g;
  const idx = new PlatformIndex(platforms);
  const noise = patchNoise(7331);
  // 床（絵の種類ごと）
  const floors = new Map<PlatformLook, BufferGeometry[]>();
  const wood: BufferGeometry[] = [];
  for (const p of platforms) {
    const look = p.look ?? 'yard';
    if (look === 'bridge') {
      wood.push(...bridgeGeometry(p, idx));
      continue;
    }
    const tile = look === 'stone' ? ENV_TILES.paving.tile : look === 'grass' ? ENV_TILES.grass.tile : look === 'rock' ? ENV_TILES.rock.tile : look === 'water' ? 7 : ENV_TILES.earth.tile;
    const varied = look === 'yard' || look === 'grass';
    const geo = floorGeometry(p, tile, varied ? noise : null, bounds);
    floors.set(look, [...(floors.get(look) ?? []), geo]);
  }
  const mats: Record<Exclude<PlatformLook, 'bridge'>, MeshLambertMaterial> = {
    yard: tileMaterial('earth', 0xcfc4b2, { gain: gain * 0.92, vertexColors: true }),
    stone: tileMaterial('paving', 0xffffff, { gain: 1.15, vertexColors: true }),
    grass: tileMaterial('grass', 0xffffff, { gain: gain * 1.02, vertexColors: true }),
    rock: tileMaterial('rock', 0xd8d4cc, { gain: 1.4, vertexColors: true }),
    water: waterMaterials().water,
  };
  for (const [look, list] of floors) {
    if (look === 'bridge') continue;
    const m = new Mesh(mergeGeometries(list)!, mats[look]);
    m.receiveShadow = true;
    m.userData.terrace = look;
    m.userData.noMerge = true;
    g.add(m);
  }
  // 擁壁と蹴上げ（吊り橋を除いて測る: 裂け目の岩の壁は、橋の下にも続く）。小滝は別の形
  const walls = terraceWalls(platforms.filter((p) => p.look !== 'bridge'), bounds);
  const wt = ENV_TILES.rock.tile;
  // 石積み（段の縁・階段の蹴上げと脇）と、自然の岩（裂け目）
  const masonry = walls.filter((w) => w.kind === 'rock' && !natural(w)).map((w) => wallGeometry(w, 3, noise));
  if (masonry.length) {
    const m = new Mesh(mergeGeometries(masonry)!, masonryMaterial());
    m.castShadow = true;
    m.receiveShadow = true;
    m.userData.terrace = 'wall';
    m.userData.walls = masonry.length;
    // 根元に草を寄せる所（arena.ts）。高さ 2m 以上の石積み
    m.userData.bases = walls.filter((w) => w.kind === 'rock' && !natural(w) && w.hi - w.lo >= 2);
    m.userData.noMerge = true;
    g.add(m);
  }
  // 小滝の後ろにも岩の壁（幕は透けるので、後ろが空いていると空が見える）
  const rockGeo = walls.filter((w) => (w.kind === 'rock' && natural(w)) || w.kind === 'fall').map((w) => wallGeometry({ ...w, kind: 'rock', upper: w.kind === 'fall' ? 'rock' : w.upper }, wt, noise));
  if (rockGeo.length) {
    const m = new Mesh(mergeGeometries(rockGeo)!, tileMaterial('rock', 0xe6ddd0, { gain: 1.45, vertexColors: true, bump: 1.5 }));
    m.castShadow = true;
    m.receiveShadow = true;
    m.userData.terrace = 'cliff';
    m.userData.walls = rockGeo.length;
    m.userData.noMerge = true;
    g.add(m);
  }
  const falls = walls.filter((w) => w.kind === 'fall');
  if (falls.length) {
    // 小滝の幕は、低い側へ 0.12m 出す（落ちる水が、崖の面から離れて見える）。下の端は、水面の少し下
    const geo = falls.map((w) => {
      const f = { ...w, ax: w.ax + w.nx * 0.12, bx: w.bx + w.nx * 0.12, az: w.az + w.nz * 0.12, bz: w.bz + w.nz * 0.12, lo: w.lo - 0.1, hi: w.hi + 0.02 };
      return wallGeometry(f, 2, noise);
    });
    const m = new Mesh(mergeGeometries(geo)!, waterMaterials().fall);
    m.userData.terrace = 'fall';
    m.userData.falls = falls;
    m.userData.noMerge = true;
    m.renderOrder = 1;
    g.add(m);
  }
  // 柵（吊り橋も入れて測る: 橋の口には柵を立てない）: 擁壁の上（高い側へ 0.07m）に、柱（1.8m おき以下）と横木 2 本。高さ 1.05m。
  // 階段の脇は、段ごとの柵をつないで、段に沿って斜めに下りる 1 本の柵にする（railRuns）。
  // 狩人は縁から体の半径 + 0.12m で止まる（src/game/world.ts）。吊り橋の両わきは、細い柱と、少したわんだ縄 2 本
  const rails = railLines(terraceWalls(platforms, bounds));
  const runs = railRuns(rails);
  for (const run of runs) {
    const rope = run.rope;
    const len = run.s1 - run.s0;
    const n = Math.max(1, Math.ceil(len / (rope ? 2 : 1.8)));
    const ptAt = (sv: number, y: number): [number, number, number] => (run.byX ? [sv, y, run.at + run.off] : [run.at + run.off, y, sv]);
    const tops: [number, number, number][] = [];
    for (let i = 0; i <= n; i++) {
      const sv = run.s0 + (len * i) / n;
      const foot = run.floor(sv), top = run.profile(sv) + 1.05;
      const [x, , z] = ptAt(sv, 0);
      wood.push(box(x, (foot + top) / 2, z, rope ? 0.09 : 0.12, top - foot, rope ? 0.09 : 0.12));
      tops.push(ptAt(sv, top));
    }
    for (let i = 0; i < n; i++) {
      const p = tops[i]!, q = tops[i + 1]!;
      if (rope) {
        for (const [dy, sag] of [[-0.05, 0.16], [-0.5, 0.1]] as const) {
          for (let k = 0; k < 4; k++) {
            const t0 = k / 4, t1 = (k + 1) / 4;
            const y0 = p[1] + (q[1] - p[1]) * t0 + dy - sag * Math.sin(Math.PI * t0), y1 = p[1] + (q[1] - p[1]) * t1 + dy - sag * Math.sin(Math.PI * t1);
            wood.push(beam(p[0] + (q[0] - p[0]) * t0, y0, p[2] + (q[2] - p[2]) * t0, p[0] + (q[0] - p[0]) * t1, y1, p[2] + (q[2] - p[2]) * t1, 0.035));
          }
        }
      } else for (const dy of [-0.1, -0.55]) wood.push(beam(p[0], p[1] + dy, p[2], q[0], q[1] + dy, q[2], 0.08));
    }
  }
  if (wood.length) {
    for (const w of wood) projectSurfaceUV(w,.9);
    const m = new Mesh(mergeGeometries(wood)!, imageLambert('wood',{color:0x5f4a35},{bump:.025}));
    m.castShadow = true;
    m.receiveShadow = true;
    m.userData.terrace = 'rail';
    m.userData.rails = runs.length;
    m.userData.ropes = runs.filter((r) => r.rope).length;
    m.userData.noMerge = true;
    g.add(m);
  }
  return g;
}
