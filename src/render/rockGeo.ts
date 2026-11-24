// 岩と岩壁の形（v0.19.0。docs/spec.md の 21 章）。なめらかな雑音で表面を凹凸させ、頂点の色で、苔・根元の陰・くぼみ・晶脈を付ける。
// 形は見た目だけ。当たり（岩は円柱、外周は四角）は、これまでどおりマップデータが正本。
// 乱数は SeededRng（同じエリアは、いつも同じ形）。Math.random は使わない。
import { BufferGeometry, Float32BufferAttribute, IcosahedronGeometry, Vector3 } from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
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

/** 色を付ける時に使う、苔・陰・晶脈の色（岩の絵に掛ける倍率） */
const MOSS: [number, number, number] = [0.62, 0.72, 0.42];
const VEIN: [number, number, number] = [1.35, 1.08, 0.72];
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

export interface BoulderOptions {
  /** 球の細かさ（3 で 1280 面、2 で 320 面） */
  detail?: number;
  /** 大きな凹凸の強さ（0.3〜0.6） */
  rough?: number;
  /** 苔の量（0〜1） */
  moss?: number;
  /** 晶脈の筋を付ける */
  vein?: boolean;
  /** 横の地層の筋の強さ（0〜1） */
  strata?: number;
  /** 割れた平らな面の数（風化した岩の、角の立った面。0 で丸いまま） */
  cuts?: number;
}

/**
 * 大きさ 1 の岩（高さは 0〜1 くらい。地面は y = 0 で、根元は地面の下へ少し埋まる）。
 * 根元（高さ 0〜0.45）の横の広がりは、いちばん外で半径 ROCK_REACH にそろえる（当たりの円柱から、見た目がはみ出しすぎないように）。
 * なめらかな凹凸の上に、いくつかの平らな割れ面を入れて、角の立った岩にする。
 * 置く時に、横を岩の半径、縦を高さで伸ばす。頂点の色を持つ（素材は vertexColors にする）。
 */
export function boulderGeometry(rng: SeededRng, o: BoulderOptions = {}): BufferGeometry {
  const seed = Math.floor(rng.next() * 1e9);
  const n = valueNoise3(seed);
  const rough = o.rough ?? 0.45;
  let g: BufferGeometry = new IcosahedronGeometry(1, o.detail ?? 3);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g = mergeVertices(g);
  const pos = g.getAttribute('position');
  const ox = rng.next() * 50, oz = rng.next() * 50;
  const tilt = (rng.next() - 0.5) * 0.5;
  // 割れ面: 横向きか上向きの面（下向きの面は地面の下なので作らない）
  const cuts: { n: Vector3; c: number }[] = [];
  for (let k = 0; k < (o.cuts ?? 0); k++) {
    const a = rng.next() * Math.PI * 2;
    const up = rng.next() * 0.9;
    cuts.push({ n: new Vector3(Math.cos(a), up, Math.sin(a)).normalize(), c: 0.62 + rng.next() * 0.26 });
  }
  const crev = new Float32Array(pos.count);
  const p = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const big = fbm3(n, p.x * 1.1 + ox, p.y * 1.1, p.z * 1.1 + oz, 3) - 0.5;
    const small = fbm3(n, p.x * 3.6 + 7, p.y * 3.6 + oz, p.z * 3.6 + ox, 3) - 0.5;
    const fine = fbm3(n, p.x * 9 + 3, p.y * 9 + 5, p.z * 9 + 1, 2) - 0.5;
    const r = 1 + rough * big * 1.6 + 0.16 * small + 0.04 * fine;
    crev[i] = -(rough * big * 1.6 + 0.16 * small);
    p.multiplyScalar(r);
    // 割れ面より外へ出た所を、面の上へ戻す（平らな面と、角）
    for (const c of cuts) {
      const over = p.dot(c.n) - c.c;
      if (over > 0) {
        p.addScaledVector(c.n, -over * 0.92);
        crev[i] -= over * 0.3;
      }
    }
    let { x, y, z } = p;
    // 地層: 横の段（少し傾けて）
    if (o.strata) y += o.strata * 0.035 * Math.sin((y + x * tilt) * 17 + big * 4);
    // 上を少し平らに、根元は地面の下で平たく
    if (y > 0.55) y = 0.55 + (y - 0.55) * 0.75;
    if (y < -0.25) y = -0.25 + (y + 0.25) * 0.25;
    pos.setXYZ(i, x, (y + 0.25) / 1.1, z);
  }
  let reach = 0;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y >= 0 && y <= 0.45) reach = Math.max(reach, Math.hypot(pos.getX(i), pos.getZ(i)));
  }
  if (reach > 0) {
    const k = ROCK_REACH / reach;
    for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i) * k, pos.getY(i), pos.getZ(i) * k);
  }
  g.computeVertexNormals();
  // 頂点の色: 根元の陰・くぼみの陰・明るさのむら・上を向いた所の苔・晶脈
  const nor = g.getAttribute('normal');
  const cav = cavityOf(g);
  const col = new Float32Array(pos.count * 3);
  const veinDir = new Vector3(rng.next() - 0.5, (rng.next() - 0.5) * 0.6, rng.next() - 0.5).normalize();
  const veinAt = (rng.next() - 0.5) * 0.6;
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const ny = nor.getY(i);
    const ao = 0.52 + 0.48 * smooth(-0.05, 0.45, p.y);
    // 大きさ 1 の岩で、くぼみ 0.02 ほどがはっきり暗くなる
    const dark = (1 - Math.min(0.3, Math.max(0, crev[i]!) * 0.8)) * Math.min(1.12, Math.max(0.55, 1 - cav[i]! * 9));
    const tone = 0.86 + 0.28 * fbm3(n, p.x * 5 + 3, p.y * 5, p.z * 5, 2);
    // 上を向いた面は、少し明るい（風雨で白む）
    const bleach = 1 + 0.1 * smooth(0.6, 0.95, ny);
    let r = ao * dark * tone * bleach, gC = r, b = r;
    const warm = (fbm3(n, p.x * 1.7 + 11, p.y * 1.7, p.z * 1.7 + 5, 2) - 0.5) * 0.18;
    r *= 1 + warm;
    b *= 1 - warm;
    const moss = (o.moss ?? 0.5) * smooth(0.45, 0.85, ny) * smooth(0.4, 0.6, fbm3(n, p.x * 2.2 + 19, p.y * 2.2, p.z * 2.2 + 23, 3)) * smooth(0.15, 0.4, p.y);
    r = r * (1 - moss) + r * MOSS[0] * moss;
    gC = gC * (1 - moss) + gC * MOSS[1] * moss * 1.05;
    b = b * (1 - moss) + b * MOSS[2] * moss;
    if (o.vein) {
      const v = smooth(0.07, 0.02, Math.abs(p.dot(veinDir) - veinAt));
      r = r * (1 - v) + VEIN[0] * v * 0.8;
      gC = gC * (1 - v) + VEIN[1] * v * 0.8;
      b = b * (1 - v) + VEIN[2] * v * 0.8;
    }
    col[i * 3] = r;
    col[i * 3 + 1] = gC;
    col[i * 3 + 2] = b;
  }
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  return g;
}

export interface CliffOptions {
  /** 歩ける範囲（この四角のすぐ外に、岩壁の内側の面が立つ） */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** 開ける所（出口）。この点から 4.5m の内は壁が無く、9m までになだらかに高くなる */
  gates: { x: number; z: number }[];
  /** 高さ [いちばん低い所, ばらつきの幅]（m） */
  height: [number, number];
  /** 苔の量（0〜1） */
  moss?: number;
  /** 晶脈の筋の多さ（0〜1） */
  veins?: number;
}

/**
 * 外周の岩壁（v0.19.0。それまでは箱を並べた壁）。歩ける範囲の四角を、外へ 0.5m ずらした道に沿って、
 * 断面（内側の切り立った面 → 上の縁 → 外へ下る背）を並べた 1 枚の面。高さ・地層の段・縦の割れ目・面の凹凸は雑音で変える。
 * 内側の面は、歩ける範囲へ入り込まない（当たりは、これまでどおり四角）。uv は 水平の長さ・高さ（m）で、絵は tile で割って貼る。
 */
export function cliffGeometry(rng: SeededRng, o: CliffOptions, tile: number): BufferGeometry {
  const seed = Math.floor(rng.next() * 1e9);
  const n = valueNoise3(seed);
  const b = o.bounds;
  const e = 0.5;
  // 道: 四角の外 e m。角は、角の点を中心にした半径 e の弧
  const path: { x: number; z: number; nx: number; nz: number }[] = [];
  const step = 0.9;
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
      path.push({ x: x0 + (x1 - x0) * t, z: z0 + (z1 - z0) * t, nx, nz });
    }
    // 角の弧（次の辺へ）
    const [cx, cz, a0] = corners[k]!;
    for (let j = 0; j < 4; j++) {
      const a = a0 + ((j + 0.5) / 4) * (Math.PI / 2);
      const nx2 = Math.cos(a), nz2 = Math.sin(a);
      path.push({ x: cx + nx2 * e, z: cz + nz2 * e, nx: nx2, nz: nz2 });
    }
  }
  // 断面: [外への距離, 高さの割合]（内側の面を細かく → 上の縁 → 背）
  const prof: [number, number][] = [[0.05, -0.08], [0.12, 0.08], [0.2, 0.2], [0.3, 0.32], [0.42, 0.44], [0.56, 0.56], [0.72, 0.68], [0.9, 0.8], [1.15, 0.9], [1.5, 0.97], [2.1, 1.0], [3.4, 1.02], [5.8, 0.8], [9.5, 0.34]];
  const rows = prof.length;
  const face = 10; // ここまでが内側の面
  const N = path.length;
  const pos = new Float32Array(N * rows * 3);
  const uv = new Float32Array(N * rows * 2);
  const recess = new Float32Array(N * rows);
  const sArr = new Float32Array(N);
  const veinArr = new Uint8Array(N);
  let s = 0;
  const [h0, hv] = o.height;
  const phase = rng.next() * 100;
  // 地層の厚さ（m）と、層ごとの張り出し
  const layer = 1.3 + rng.next() * 0.8;
  for (let i = 0; i < N; i++) {
    const q = path[i]!;
    if (i > 0) s += Math.hypot(q.x - path[i - 1]!.x, q.z - path[i - 1]!.z);
    sArr[i] = s;
    // 高さ: ゆるい起伏と、細かな起伏。ときどき高い岩
    const big = fbm3(n, s / 22 + phase, 0.5, 0.5, 3);
    const fine = fbm3(n, s / 5.5 + phase, 3.5, 1.5, 2);
    let H = h0 + hv * (0.25 + 0.75 * big) + 1.6 * (fine - 0.5);
    if (fine > 0.66) H += (fine - 0.66) * 16;
    // 出口: 4.5m の内は壁が無く、9m までになだらかに
    let open = 1;
    for (const gt of o.gates) open = Math.min(open, smooth(4.5, 9, Math.hypot(q.x - gt.x, q.z - gt.z)));
    H *= open;
    veinArr[i] = (o.veins ?? 0.3) > 0 && fbm3(n, s / 9 + 40, 7, 7, 2) > 1 - (o.veins ?? 0.3) * 0.45 ? 1 : 0;
    // 縦の割れ目（ところどころ、奥へ引っ込む）
    const crack = smooth(0.62, 0.72, fbm3(n, s * 0.55 + 21, 2, 11, 3));
    const amp = Math.min(1, H / 4);
    for (let k = 0; k < rows; k++) {
      const [d0, f] = prof[k]!;
      const y0 = Math.max(-0.6, H * f - (k === 0 ? 0.5 : 0));
      const bump = fbm3(n, s / 3.2, y0 / 3.2, k * 0.7, 3) - 0.5;
      const bumpFine = fbm3(n, s * 1.1 + 13, y0 * 1.1, k, 2) - 0.5;
      let d = d0 * (0.6 + 0.4 * open);
      let rec = 0;
      if (k >= 1 && k < face) {
        // 地層の段: 層の下ほど奥へ、上ほど手前へ（段の上の面ができる）
        const L = layer * (0.85 + 0.3 * fbm3(n, s / 30, 5, 3, 2));
        const t = ((y0 / L) % 1 + 1) % 1;
        const ledge = (t - 0.5) * 0.55;
        // 稜（とがった筋）: 雑音の山と谷を折り返して、角のある起伏にする
        const ridged = 0.5 - Math.abs(fbm3(n, s / 2.2 + 61, y0 / 1.6, k * 0.3, 3) - 0.5) * 2;
        rec = -ledge * 1.3 + crack * 1.1;
        d += (bump * 2.2 + bumpFine * 0.7 + ridged * 0.45 - ledge * 1.3 + crack * 1.1) * amp;
      } else if (k >= face) {
        d += bump * 1.2 * amp;
      }
      // 内側の面は、歩ける範囲へ張り出さない
      if (k < face) d = Math.max(d, 0.05);
      const y = y0 + (k >= face - 1 ? (bump * 1.1 + bumpFine * 0.6) * amp : 0);
      const idx = i * rows + k;
      pos[idx * 3] = q.x + q.nx * d;
      pos[idx * 3 + 1] = y;
      pos[idx * 3 + 2] = q.z + q.nz * d;
      uv[idx * 2] = s / tile;
      uv[idx * 2 + 1] = (y + d * 0.35) / tile;
      recess[idx] = rec;
    }
  }
  const index: number[] = [];
  for (let i = 0; i < N; i++) {
    const i2 = (i + 1) % N;
    for (let k = 0; k < rows - 1; k++) {
      const a = i * rows + k, bI = i2 * rows + k, c = i * rows + k + 1, d = i2 * rows + k + 1;
      // 内側（歩ける範囲）から見て表になる向き（道は、上から見て x → z の向きに回る）
      index.push(a, bI, c, bI, d, c);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  // 色: 根元の陰、くぼみの陰、縦の筋、段の上と上の縁の苔、晶脈
  const nor = geo.getAttribute('normal');
  const cav = cavityOf(geo);
  const col = new Float32Array(N * rows * 3);
  for (let i = 0; i < N; i++) {
    const sI = sArr[i]!;
    for (let k = 0; k < rows; k++) {
      const idx = i * rows + k;
      const y = pos[idx * 3 + 1]!;
      const ny = nor.getY(idx);
      const ao = 0.5 + 0.5 * smooth(-0.2, 2.4, y);
      const rec = (1 - Math.max(0, Math.min(0.3, recess[idx]! * 0.5))) * Math.min(1.15, Math.max(0.5, 1 - cav[idx]! * 1.4));
      const streak = 0.84 + 0.32 * fbm3(n, sI * 1.7 + 5, y * 0.15, 9, 2);
      const bleach = 1 + 0.12 * smooth(0.55, 0.9, ny);
      let r = ao * rec * streak * bleach, g = r, bb = r;
      const warm = (fbm3(n, sI / 7 + 50, y / 6, 3, 2) - 0.5) * 0.16;
      r *= 1 + warm;
      bb *= 1 - warm;
      const mossy = (o.moss ?? 0.6) * smooth(0.5, 0.85, ny) * smooth(0.35, 0.6, fbm3(n, sI / 2.4 + 31, y / 2, 4, 2));
      r = r * (1 - mossy) + r * MOSS[0] * mossy;
      g = g * (1 - mossy) + g * MOSS[1] * mossy * 1.05;
      bb = bb * (1 - mossy) + bb * MOSS[2] * mossy;
      if (veinArr[i] && k >= 1 && k < face - 2) {
        const v = smooth(0.62, 0.7, fbm3(n, sI * 0.7 + 3, y * 0.5, 17, 2));
        r = r * (1 - v) + VEIN[0] * v * 0.75;
        g = g * (1 - v) + VEIN[1] * v * 0.75;
        bb = bb * (1 - v) + VEIN[2] * v * 0.75;
      }
      col[idx * 3] = r;
      col[idx * 3 + 1] = g;
      col[idx * 3 + 2] = bb;
    }
  }
  geo.setAttribute('color', new Float32BufferAttribute(col, 3));
  return geo;
}
