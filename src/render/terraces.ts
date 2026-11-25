// 0 より低い段差（v0.31.0。里の下の段と階段。ChatGPT の里の設計 #11 の P0）の見た目: 地面の板の穴・床・擁壁・柵。
// 形の正本はマップデータの platforms（h が負のもの）。床の高さは simulation と同じ groundAt で決める。描画だけで、当たりは変えない
// （段の縁から落ちないのは、マップの stepDown。柵は、それを見せるための飾り）。
import { BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshLambertMaterial } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { groundAt } from '../game/world';
import { ENV_TILES, tileMaterial } from './envArt';

export interface TerracePlatform {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  h: number;
  look?: 'yard' | 'stone';
}

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
}

/** これより深い下りの縁には、柵を立てる（m） */
export const RAIL_DROP = 0.5;
const EPS = 1e-3;

/**
 * 低い段差の縁で、外が内より高い所に立つ擁壁（階段の蹴上げも含む）。外と内の高さは groundAt で測る（重なる段差も正しく扱う）。
 * 縁は、ほかの段差の境で区切ってから、同じ高さの続きを 1 枚にまとめる。
 */
export function terraceWalls(platforms: readonly TerracePlatform[]): WallSegment[] {
  const out: WallSegment[] = [];
  for (const p of platforms) {
    if (!(p.h < 0)) continue;
    const edges = [
      { alongX: false, at: p.maxX, from: p.minZ, to: p.maxZ, sign: 1 },
      { alongX: false, at: p.minX, from: p.minZ, to: p.maxZ, sign: -1 },
      { alongX: true, at: p.maxZ, from: p.minX, to: p.maxX, sign: 1 },
      { alongX: true, at: p.minZ, from: p.minX, to: p.maxX, sign: -1 },
    ];
    for (const e of edges) {
      const cuts = new Set<number>([e.from, e.to]);
      for (const q of platforms) for (const v of e.alongX ? [q.minX, q.maxX] : [q.minZ, q.maxZ]) if (v > e.from && v < e.to) cuts.add(v);
      const pts = [...cuts].sort((a, b) => a - b);
      let cur: WallSegment | null = null;
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i]!, b = pts[i + 1]!, m = (a + b) / 2;
        const outside = e.alongX ? groundAt(platforms, m, e.at + e.sign * EPS) : groundAt(platforms, e.at + e.sign * EPS, m);
        const inside = e.alongX ? groundAt(platforms, m, e.at - e.sign * EPS) : groundAt(platforms, e.at - e.sign * EPS, m);
        if (outside <= inside + 0.01) {
          cur = null;
          continue;
        }
        if (cur && Math.abs(cur.lo - inside) < 1e-6 && Math.abs(cur.hi - outside) < 1e-6) {
          if (e.alongX) cur.bx = b;
          else cur.bz = b;
          continue;
        }
        cur = e.alongX
          ? { ax: a, az: e.at, bx: b, bz: e.at, lo: inside, hi: outside, nx: 0, nz: -e.sign }
          : { ax: e.at, az: a, bx: e.at, bz: b, lo: inside, hi: outside, nx: -e.sign, nz: 0 };
        out.push(cur);
      }
    }
  }
  return out;
}

/** 柵の線: 柵の要る擁壁（下りが RAIL_DROP 以上）を、同じ線・同じ上の高さで続く所ごとに 1 本にまとめる。柵は高い側に立つ */
export function railLines(walls: readonly WallSegment[]): WallSegment[] {
  const key = (w: WallSegment): string => (w.nx !== 0 ? `x${w.ax.toFixed(3)}:${w.nx}:${w.hi.toFixed(3)}` : `z${w.az.toFixed(3)}:${w.nz}:${w.hi.toFixed(3)}`);
  const groups = new Map<string, WallSegment[]>();
  for (const w of walls) {
    if (w.hi - w.lo < RAIL_DROP) continue;
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

/**
 * 地面の板に、低い段差の穴を開ける: 格子（おおよそ cell の間隔に、穴の縁の線を足す）を作り、穴の中のます目を除く。
 * 位置と上向きの法線だけ（uv と色は、呼んだ側が付ける）。
 */
export function holedGround(cx: number, cz: number, gw: number, gd: number, holes: readonly TerracePlatform[], cell = 5): BufferGeometry {
  const lines = (c: number, size: number, edges: number[]): number[] => {
    const n = Math.ceil(size / cell);
    const v = new Set<number>();
    for (let i = 0; i <= n; i++) v.add(c - size / 2 + (size * i) / n);
    for (const e of edges) if (e > c - size / 2 && e < c + size / 2) v.add(e);
    return [...v].sort((a, b) => a - b);
  };
  const xs = lines(cx, gw, holes.flatMap((h) => [h.minX, h.maxX]));
  const zs = lines(cz, gd, holes.flatMap((h) => [h.minZ, h.maxZ]));
  const pos: number[] = [], nor: number[] = [], idx: number[] = [];
  for (const z of zs) for (const x of xs) pos.push(x, 0, z), nor.push(0, 1, 0);
  const at = (i: number, j: number): number => j * xs.length + i;
  for (let j = 0; j + 1 < zs.length; j++) {
    for (let i = 0; i + 1 < xs.length; i++) {
      const mx = (xs[i]! + xs[i + 1]!) / 2, mz = (zs[j]! + zs[j + 1]!) / 2;
      if (holes.some((h) => mx > h.minX && mx < h.maxX && mz > h.minZ && mz < h.maxZ)) continue;
      const a = at(i, j), b = at(i, j + 1), c = at(i + 1, j), d = at(i + 1, j + 1);
      idx.push(a, b, c, c, b, d);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
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

/** 箱（柵の柱と横木）。中心と大きさ、向き（横木は線の向き） */
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

/** 低い段差の床・擁壁・柵（描画 4 回）。床は look ごとの絵、擁壁は岩肌、柵は暗い木 */
export function buildTerraces(platforms: readonly TerracePlatform[], gain: number): Group {
  const g = new Group();
  g.name = 'terraces';
  const low = platforms.filter((p) => p.h < 0);
  if (low.length === 0) return g;
  // 床（作業場の土 / 石段）
  const floors: Record<'yard' | 'stone', BufferGeometry[]> = { yard: [], stone: [] };
  for (const p of low) {
    const look = p.look ?? 'yard';
    const t = ENV_TILES[look === 'stone' ? 'paving' : 'earth'].tile;
    const pts = [[p.minX, p.h, p.maxZ], [p.maxX, p.h, p.maxZ], [p.maxX, p.h, p.minZ], [p.minX, p.h, p.minZ]];
    floors[look].push(quad(pts, pts.map(([x, , z]) => [x! / t, -z! / t]), [0, 1, 0]));
  }
  const mats = {
    yard: tileMaterial('earth', 0xcfc4b2, { gain: gain * 0.92 }),
    stone: tileMaterial('paving', 0xffffff, { gain: 1.15 }),
  };
  for (const look of ['yard', 'stone'] as const) {
    if (floors[look].length === 0) continue;
    const m = new Mesh(mergeGeometries(floors[look])!, mats[look]);
    m.receiveShadow = true;
    m.userData.terrace = look;
    g.add(m);
  }
  // 擁壁と蹴上げ: 面は低い側を向く。絵は、線に沿って横、高さで縦
  const walls = terraceWalls(platforms);
  const wt = ENV_TILES.rock.tile;
  const wallGeo = walls.map((w) => {
    const len = Math.hypot(w.bx - w.ax, w.bz - w.az);
    const u0 = (w.nx !== 0 ? w.az : w.ax) / wt;
    // 表から見て反時計回りになる並び: 面の向き n と、線の向き (b - a) の外積が上を向く順
    const dx = w.bx - w.ax, dz = w.bz - w.az;
    const flip = w.nx * dz - w.nz * dx > 0;
    const [a, b] = flip ? [[w.bx, w.bz], [w.ax, w.az]] : [[w.ax, w.az], [w.bx, w.bz]];
    const [ua, ub] = flip ? [u0 + len / wt, u0] : [u0, u0 + len / wt];
    return quad(
      [[a[0]!, w.lo, a[1]!], [b[0]!, w.lo, b[1]!], [b[0]!, w.hi, b[1]!], [a[0]!, w.hi, a[1]!]],
      [[ua, w.lo / wt], [ub, w.lo / wt], [ub, w.hi / wt], [ua, w.hi / wt]],
      [w.nx, 0, w.nz],
    );
  });
  if (wallGeo.length) {
    const m = new Mesh(mergeGeometries(wallGeo)!, tileMaterial('rock', 0xe6ddd0, { gain: 1.45 }));
    m.castShadow = true;
    m.receiveShadow = true;
    m.userData.terrace = 'wall';
    m.userData.walls = walls.length;
    g.add(m);
  }
  // 柵: 擁壁の上（高い側へ 0.07m）に、柱（1.8m おき以下）と横木 2 本。高さ 1.05m。狩人は縁から体の半径 + 0.12m で止まる（src/game/world.ts）
  const rails = railLines(walls);
  const railGeo: BufferGeometry[] = [];
  for (const r of rails) {
    const ox = -r.nx * 0.07, oz = -r.nz * 0.07;
    const len = Math.hypot(r.bx - r.ax, r.bz - r.az);
    const n = Math.max(1, Math.ceil(len / 1.8));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      railGeo.push(box(r.ax + (r.bx - r.ax) * t + ox, r.hi + 0.525, r.az + (r.bz - r.az) * t + oz, 0.12, 1.05, 0.12));
    }
    const mx = (r.ax + r.bx) / 2 + ox, mz = (r.az + r.bz) / 2 + oz;
    for (const y of [0.5, 0.95]) railGeo.push(r.nx !== 0 ? box(mx, r.hi + y, mz, 0.07, 0.09, len) : box(mx, r.hi + y, mz, len, 0.09, 0.07));
  }
  if (railGeo.length) {
    const m = new Mesh(mergeGeometries(railGeo)!, new MeshLambertMaterial({ color: 0x5f4a35 }));
    m.castShadow = true;
    m.receiveShadow = true;
    m.userData.terrace = 'rail';
    m.userData.rails = rails.length;
    g.add(m);
  }
  return g;
}
