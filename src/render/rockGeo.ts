// 段差の岩の棚と、外周に沿った道（v0.19.0〜。docs/spec.md の 21 章）。なめらかな雑音で表面を凹凸させ、頂点の色で、苔・根元の陰・くぼみを付ける。
// v0.22.0 から、岩と外周の崖は、依頼 10 の図から作る（src/render/rockArt.ts）。ここの計算の岩（boulderGeometry）と岩壁（cliffGeometry）は無くした。
// 形は見た目だけ。当たり（岩は円柱、外周は多角形）は、これまでどおりマップデータが正本。
// 乱数は SeededRng（同じエリアは、いつも同じ形）。Math.random は使わない。
import { BufferGeometry, Float32BufferAttribute } from 'three';
import type { SeededRng } from '../core/seededRng';

/** 3 次元のなめらかな雑音（値の雑音。0〜1）。seed ごとに違う並び */
export function valueNoise3(seed: number): (x: number, y: number, z: number) => number {
  const hash = (ix: number, iy: number, iz: number): number => {
    let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(iz, 1274126177) + Math.imul(seed, 144665)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  return (x, y, z) => {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    const fx = x - ix, fy = y - iy, fz = z - iz;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), sz = fz * fz * (3 - 2 * fz);
    const l = (a: number, b: number, t: number): number => a + (b - a) * t;
    const c00 = l(hash(ix, iy, iz), hash(ix + 1, iy, iz), sx), c10 = l(hash(ix, iy + 1, iz), hash(ix + 1, iy + 1, iz), sx);
    const c01 = l(hash(ix, iy, iz + 1), hash(ix + 1, iy, iz + 1), sx), c11 = l(hash(ix, iy + 1, iz + 1), hash(ix + 1, iy + 1, iz + 1), sx);
    return l(l(c00, c10, sy), l(c01, c11, sy), sz);
  };
}

/** 重ねた雑音（0〜1 のあたり）。octaves 回、細かさを 2 倍ずつ */
export function fbm3(n: (x: number, y: number, z: number) => number, x: number, y: number, z: number, octaves = 4): number {
  let v = 0, a = 0.5, s = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    v += a * n(x * s, y * s, z * s);
    norm += a;
    a *= 0.5;
    s *= 2.03;
  }
  return v / norm;
}

const smooth = (a: number, b: number, t: number): number => {
  const x = Math.max(0, Math.min(1, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
};

/**
 * 頂点ごとの「くぼみ」の深さ（m。正でくぼみ、負で出っ張り）。隣の頂点の平均が、法線の向きにどれだけ前にあるか。
 * 面の向きだけの光では岩の形が読みにくいので、くぼみを暗く、出っ張りを明るく、頂点の色に入れる。
 */
export function cavityOf(geo: BufferGeometry): Float32Array {
  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  const idx = geo.getIndex();
  const n = pos.count;
  const sum = new Float32Array(n * 3);
  const cnt = new Float32Array(n);
  const out = new Float32Array(n);
  if (!idx) return out;
  const add = (a: number, b: number): void => {
    sum[a * 3] += pos.getX(b);
    sum[a * 3 + 1] += pos.getY(b);
    sum[a * 3 + 2] += pos.getZ(b);
    cnt[a]++;
  };
  for (let t = 0; t < idx.count; t += 3) {
    const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2);
    add(a, b); add(a, c); add(b, a); add(b, c); add(c, a); add(c, b);
  }
  for (let i = 0; i < n; i++) {
    if (!cnt[i]) continue;
    const dx = sum[i * 3]! / cnt[i]! - pos.getX(i);
    const dy = sum[i * 3 + 1]! / cnt[i]! - pos.getY(i);
    const dz = sum[i * 3 + 2]! / cnt[i]! - pos.getZ(i);
    out[i] = dx * nor.getX(i) + dy * nor.getY(i) + dz * nor.getZ(i);
  }
  return out;
}

/** 岩の根元の、いちばん外の横の半径（大きさ 1 の岩で）。置く時に、当たりの半径を掛ける */
export const ROCK_REACH = 1.06;

/**
 * 段差（v0.20.0）: 四角い箱ではなく、角の丸い、岩の棚。上は平らで（歩く所）、横は岩肌で、下ほど外へ広がって地面に入る。
 * 当たりは、これまでどおり四角（p）。見た目は、四角の内側に収まる（角だけ、当たりより内側）。
 * 2 つの材料を使う: 0 = 上の面（地面の絵）、1 = 横の面（岩。頂点の色あり）。
 */
export function ledgeGeometry(rng: SeededRng, p: { minX: number; maxX: number; minZ: number; maxZ: number; h: number }, groundTile: number, rockTile: number): BufferGeometry {
  const n = valueNoise3(Math.floor(rng.next() * 1e9));
  const w = p.maxX - p.minX, d = p.maxZ - p.minZ;
  const cx = (p.minX + p.maxX) / 2, cz = (p.minZ + p.maxZ) / 2;
  const rc = Math.min(1.6, 0.3 * Math.min(w, d));
  // 外周: 角の丸い四角を 0.5m おきに（面積が正の向き）
  const ring: { x: number; z: number; nx: number; nz: number }[] = [];
  const hx = w / 2 - rc, hz = d / 2 - rc;
  const segs: [number, number, number][] = [[hx, -hz, -Math.PI / 2], [hx, hz, 0], [-hx, hz, Math.PI / 2], [-hx, -hz, Math.PI]];
  const straight: [number, number, number, number][] = [[-hx, -hz - rc, hx, -hz - rc], [hx + rc, -hz, hx + rc, hz], [hx, hz + rc, -hx, hz + rc], [-hx - rc, hz, -hx - rc, -hz]];
  for (let k = 0; k < 4; k++) {
    const [x0, z0, x1, z1] = straight[k]!;
    const len = Math.hypot(x1 - x0, z1 - z0);
    const cnt = Math.max(1, Math.round(len / 0.5));
    const nx = k === 1 ? 1 : k === 3 ? -1 : 0, nz = k === 0 ? -1 : k === 2 ? 1 : 0;
    for (let i = 0; i < cnt; i++) ring.push({ x: x0 + ((x1 - x0) * i) / cnt, z: z0 + ((z1 - z0) * i) / cnt, nx, nz });
    const [ax, az, a0] = segs[k]!;
    const arcN = Math.max(2, Math.round((rc * Math.PI) / 2 / 0.5));
    for (let j = 0; j < arcN; j++) {
      const a = a0 + (j / arcN) * (Math.PI / 2);
      ring.push({ x: ax + Math.cos(a) * rc, z: az + Math.sin(a) * rc, nx: Math.cos(a), nz: Math.sin(a) });
    }
  }
  const R = ring.length;
  // 横の面の段: [外への距離, 高さ]（上の角は少し丸く、下ほど外へ）
  const prof: [number, number][] = [[-0.14, p.h], [-0.03, p.h - 0.06], [0.04, p.h * 0.55], [0.12, 0.02], [0.22, -0.2]];
  const pos: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = [];
  // 上の面（扇）: 中心 + 上の縁
  pos.push(cx, p.h, cz);
  uv.push(cx / groundTile, -cz / groundTile);
  col.push(1, 1, 1);
  for (const q of ring) {
    const x = cx + q.x + q.nx * prof[0]![0], z = cz + q.z + q.nz * prof[0]![0];
    pos.push(x, p.h, z);
    uv.push(x / groundTile, -z / groundTile);
    col.push(1, 1, 1);
  }
  for (let i = 0; i < R; i++) idx.push(0, 1 + ((i + 1) % R), 1 + i);
  const topCount = idx.length;
  // 横の面
  const base = pos.length / 3;
  // v0.44.0: 1 周の終わりに、始めの列をもう 1 度（u を 1 周の長さで）置く。これまでは最後の帯が u を 1 周ぶん逆に詰めて、
  // 岩肌が縦の縞に潰れていた（低い段では目立たないが、登攀の 3m の棚ではっきり見えた）
  let s = 0;
  for (let i = 0; i <= R; i++) {
    const q = ring[i % R]!;
    if (i > 0) s += Math.hypot(q.x - ring[i - 1]!.x, q.z - ring[i - 1]!.z);
    const bump = fbm3(n, q.x * 0.9 + cx, 0, q.z * 0.9 + cz, 3) - 0.5;
    for (let k = 0; k < prof.length; k++) {
      const [o0, y] = prof[k]!;
      const out = o0 + (k >= 2 ? bump * 0.3 : 0);
      const x = cx + q.x + q.nx * out, z = cz + q.z + q.nz * out;
      pos.push(x, y, z);
      uv.push(s / rockTile, y / rockTile);
      const shade = (0.42 + 0.3 * smooth(-0.1, p.h, y)) * (0.85 + 0.3 * fbm3(n, x * 2, y * 2, z * 2, 2));
      col.push(shade * 1.02, shade, shade * 0.95);
    }
  }
  const P = prof.length;
  for (let i = 0; i < R; i++) {
    const i2 = i + 1;
    for (let k = 0; k < P - 1; k++) {
      const a = base + i * P + k, b = base + i2 * P + k, c = base + i * P + k + 1, e = base + i2 * P + k + 1;
      // 段は上から下へ並ぶので、この向きで、外から見て表になる
      idx.push(a, b, c, b, e, c);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.addGroup(0, topCount, 0);
  g.addGroup(topCount, idx.length - topCount, 1);
  g.computeVertexNormals();
  return g;
}

/**
 * 外周（面積が正の向きの多角形）に沿った道。step m おきの点と、外向きの向き、背を外へ伸ばせる長さ（reach）。
 * 外周が内側へ入り込む所（外から見てくぼんだ所）では、外向きの線が外で交わるので、背を、交わる手前までに縮める。
 */
export function polyPath(shape: readonly (readonly [number, number])[], e: number, step: number): { x: number; z: number; nx: number; nz: number; reach: number }[] {
  // 間隔をそろえる
  const src = shape.map((p) => [p[0], p[1]] as [number, number]);
  let L = 0;
  const cum = [0];
  for (let i = 0; i < src.length; i++) {
    const a = src[i]!, c = src[(i + 1) % src.length]!;
    L += Math.hypot(c[0] - a[0], c[1] - a[1]);
    cum.push(L);
  }
  const cnt = Math.max(12, Math.round(L / step));
  const pts: [number, number][] = [];
  let k = 0;
  for (let i = 0; i < cnt; i++) {
    const s = (i / cnt) * L;
    while (cum[k + 1]! < s) k++;
    const a = src[k]!, c = src[(k + 1) % src.length]!;
    const t = (s - cum[k]!) / Math.max(1e-9, cum[k + 1]! - cum[k]!);
    pts.push([a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t]);
  }
  // 外向き（面積が正の向きでは、進む向きを右へ 90 度）。前後 2 つの点で、ならす
  const N = pts.length;
  const out = pts.map((_, i) => {
    const a = pts[(i - 2 + N) % N]!, c = pts[(i + 2) % N]!;
    const dx = c[0] - a[0], dz = c[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    return [dz / l, -dx / l] as [number, number];
  });
  // 曲がり（向きの変わり / 長さ）。外向きの線が近づく所（外周が内へ曲がる所）は、半径の 0.85 倍までしか背を伸ばさない
  const reach = pts.map((_, i) => {
    const a = out[(i - 3 + N) % N]!, c = out[(i + 3) % N]!;
    const turn = Math.atan2(a[0] * c[1] - a[1] * c[0], a[0] * c[0] + a[1] * c[1]);
    // 外向きが、進む向き（右回り）に回れば、外から見てくぼんだ所
    const kappa = -turn / (6 * step);
    return kappa > 1e-3 ? Math.min(MAX_REACH, 0.85 / kappa) : MAX_REACH;
  });
  return pts.map((p, i) => ({ x: p[0] + out[i]![0] * e, z: p[1] + out[i]![1] * e, nx: out[i]![0], nz: out[i]![1], reach: reach[i]! }));
}

/** 背を外へ伸ばす、いちばん長い距離（断面の最後の点） */
const MAX_REACH = 9.5;

/**
 * 外周の外 e m の道（v0.22.0。崖を並べる道）。自然な形なら外周に沿って、四角なら四角の外で、角は半径 e の弧。
 * 道は、上から見て x → z の向きに回り、外向きは進む向きの右。
 */
export function wallPath(b: { minX: number; maxX: number; minZ: number; maxZ: number }, shape: readonly (readonly [number, number])[] | null, e: number, step: number): { x: number; z: number; nx: number; nz: number; reach: number }[] {
  if (shape && shape.length >= 3) return polyPath(shape, e, step);
  const path: { x: number; z: number; nx: number; nz: number; reach: number }[] = [];
  rectPath(b, e, step, path);
  return path;
}

function rectPath(b: { minX: number; maxX: number; minZ: number; maxZ: number }, e: number, step: number, path: { x: number; z: number; nx: number; nz: number; reach: number }[]): void {
  const corners: [number, number, number][] = [[b.maxX, b.minZ, -Math.PI / 2], [b.maxX, b.maxZ, 0], [b.minX, b.maxZ, Math.PI / 2], [b.minX, b.minZ, Math.PI]];
  const edges: [number, number, number, number, number, number][] = [
    // 始点 x, z → 終点 x, z、外向き nx, nz
    [b.minX, b.minZ - e, b.maxX, b.minZ - e, 0, -1],
    [b.maxX + e, b.minZ, b.maxX + e, b.maxZ, 1, 0],
    [b.maxX, b.maxZ + e, b.minX, b.maxZ + e, 0, 1],
    [b.minX - e, b.maxZ, b.minX - e, b.minZ, -1, 0],
  ];
  for (let k = 0; k < 4; k++) {
    const [x0, z0, x1, z1, nx, nz] = edges[k]!;
    const len = Math.hypot(x1 - x0, z1 - z0);
    const cnt = Math.max(1, Math.round(len / step));
    for (let i = 0; i < cnt; i++) {
      const t = i / cnt;
      path.push({ x: x0 + (x1 - x0) * t, z: z0 + (z1 - z0) * t, nx, nz, reach: MAX_REACH });
    }
    // 角の弧（次の辺へ）
    const [cx, cz, a0] = corners[k]!;
    for (let j = 0; j < 4; j++) {
      const a = a0 + ((j + 0.5) / 4) * (Math.PI / 2);
      const nx2 = Math.cos(a), nz2 = Math.sin(a);
      path.push({ x: cx + nx2 * e, z: cz + nz2 * e, nx: nx2, nz: nz2, reach: MAX_REACH });
    }
  }
}
