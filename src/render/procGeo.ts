// コードで形を作るための部品（仮モデル用）: 雑音、皮と岩の模様、骨に付く形（筒・岩板・角・晶）の組み立て。
// 見た目だけの処理で、戦闘の判定には使わない。乱数は座標から決まる値だけを使い、毎回同じ形になる。
import { BufferGeometry, CanvasTexture, DataTexture, Euler, Float32BufferAttribute, Matrix4, NoColorSpace, Quaternion, RepeatWrapping, SRGBColorSpace, Uint16BufferAttribute, Vector3, type Texture } from 'three';

export type RGB = [number, number, number];

export const hex = (h: number): RGB => {
  // sRGB の 16 進 → 頂点色（リニア）
  const f = (v: number): number => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return [f((h >> 16) & 255), f((h >> 8) & 255), f(h & 255)];
};
export const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const shade = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];
export const sstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ---------- 雑音 ----------
export function hash3(ix: number, iy: number, iz: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(iz, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function vnoise(x: number, y: number, z: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const l = (a: number, b: number, t: number): number => a + (b - a) * t;
  return l(
    l(l(hash3(ix, iy, iz), hash3(ix + 1, iy, iz), u), l(hash3(ix, iy + 1, iz), hash3(ix + 1, iy + 1, iz), u), v),
    l(l(hash3(ix, iy, iz + 1), hash3(ix + 1, iy, iz + 1), u), l(hash3(ix, iy + 1, iz + 1), hash3(ix + 1, iy + 1, iz + 1), u), v),
    w,
  );
}
export function fbm(x: number, y: number, z: number, octaves = 3): number {
  let s = 0, a = 0.5, n = 0;
  for (let i = 0; i < octaves; i++) {
    s += vnoise(x, y, z) * a;
    n += a;
    x *= 2.03; y *= 2.03; z *= 2.03;
    a *= 0.5;
  }
  return s / n;
}

// ---------- 模様（繰り返せる画像を起動時に作る） ----------
function tileNoise(x: number, y: number, period: number, seed: number, periodY = period): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const h = (a: number, b: number): number => hash3(((a % period) + period) % period, ((b % periodY) + periodY) % periodY, seed);
  const top = h(ix, iy) + (h(ix + 1, iy) - h(ix, iy)) * u;
  const bot = h(ix, iy + 1) + (h(ix + 1, iy + 1) - h(ix, iy + 1)) * u;
  return top + (bot - top) * v;
}
function tileFbm(u: number, v: number, base: number, octaves: number, seed: number): number {
  let s = 0, a = 0.5, n = 0, p = base;
  for (let i = 0; i < octaves; i++) {
    s += tileNoise(u * p, v * p, p, seed + i * 17) * a;
    n += a;
    a *= 0.5;
    p *= 2;
  }
  return s / n;
}
/** 繰り返せるひび割れ模様（うろこ状の皮）。返り値は 0（ひび）〜1（うろこの中央）。 */
function tileCells(u: number, v: number, cells: number, seed: number): number {
  const x = u * cells, y = v * cells;
  const ix = Math.floor(x), iy = Math.floor(y);
  let f1 = 9, f2 = 9;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = ix + i, cy = iy + j;
      const wx = ((cx % cells) + cells) % cells, wy = ((cy % cells) + cells) % cells;
      const px = cx + 0.15 + 0.7 * hash3(wx, wy, seed), py = cy + 0.15 + 0.7 * hash3(wx, wy, seed + 1);
      const d = Math.hypot(px - x, py - y);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
    }
  }
  return sstep(0.03, 0.42, f2 - f1);
}

function heightToTextures(size: number, height: (u: number, v: number) => number, strength: number, dark: number): { map: Texture; normal: Texture } {
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) h[y * size + x] = height(x / size, y / size);
  // 画面の無い所（Node の検査）では canvas が無いので、同じ値を DataTexture に入れる（v0.30.0）
  const headless = typeof document === 'undefined';
  const mk = (): { canvas: HTMLCanvasElement | null; ctx: CanvasRenderingContext2D | null; img: { data: Uint8ClampedArray } } => {
    if (headless) return { canvas: null, ctx: null, img: { data: new Uint8ClampedArray(size * size * 4) } };
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    return { canvas, ctx, img: ctx.createImageData(size, size) };
  };
  const a = mk(), n = mk();
  const at = (x: number, y: number): number => h[((y + size) % size) * size + ((x + size) % size)]!;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const g = Math.round(255 * (dark + (1 - dark) * at(x, y)));
      a.img.data[i] = a.img.data[i + 1] = a.img.data[i + 2] = g;
      a.img.data[i + 3] = 255;
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength, dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const l = Math.hypot(dx, dy, 1);
      n.img.data[i] = Math.round(255 * (0.5 - (0.5 * dx) / l));
      n.img.data[i + 1] = Math.round(255 * (0.5 + (0.5 * dy) / l));
      n.img.data[i + 2] = Math.round(255 * (0.5 + 0.5 / l));
      n.img.data[i + 3] = 255;
    }
  }
  const tex = (t: typeof a): Texture => {
    if (!t.canvas || !t.ctx) {
      const d = new DataTexture(new Uint8Array(t.img.data.buffer), size, size);
      d.needsUpdate = true;
      return d;
    }
    t.ctx.putImageData(t.img as ImageData, 0, 0);
    return new CanvasTexture(t.canvas);
  };
  const map = tex(a);
  const normal = tex(n);
  for (const t of [map, normal]) {
    t.wrapS = t.wrapT = RepeatWrapping;
    t.anisotropy = 4;
  }
  map.colorSpace = SRGBColorSpace;
  normal.colorSpace = NoColorSpace;
  return { map, normal };
}

/** 厚い皮: 胴や脚を取り巻く深いしわ + 浅いひび割れ + 細かい粒 */
export function makeHideTextures(): { map: Texture; normal: Texture } {
  return heightToTextures(256, (u, v) => {
    // しわ: 横（u）へ長く、縦（v）へ細かい。途中でうねらせる。
    const warp = tileFbm(u, v, 3, 2, 70) * 0.09;
    const w1 = 1 - Math.abs(tileNoise(u * 3, (v + warp) * 13, 3, 31, 13) * 2 - 1);
    const w2 = 1 - Math.abs(tileNoise(u * 6, (v + warp * 0.6) * 29, 6, 47, 29) * 2 - 1);
    const wrinkle = 1 - (0.7 * w1 * w1 + 0.3 * w2 * w2);
    return 0.5 * wrinkle + 0.27 * tileCells(u, v, 11, 3) + 0.23 * tileFbm(u, v, 8, 4, 21);
  }, 4.2, 0.74);
}
/** 岩: 粗い起伏 + 細かい粒 */
export function makeRockTextures(): { map: Texture; normal: Texture } {
  return heightToTextures(256, (u, v) => {
    const r = Math.abs(tileFbm(u, v, 4, 4, 40) * 2 - 1);
    return 0.55 * (1 - r) + 0.45 * tileFbm(u, v, 24, 3, 55);
  }, 4.5, 0.7);
}

// ---------- 形の組み立て ----------
/** 頂点を貯めていく入れ物。骨への重み（最大 2 本）と、部位番号（命中時に光らせる用）を持つ。 */
/** 設定図から焼いた絵を貼る区画。筒（loft）を切り開いた長方形 1 枚が、絵の中の長方形 1 つに当たる。 */
export interface AtlasChart {
  kind: string;
  /** 各行（輪）の先頭の頂点番号。1 行は cols 個で、筒の継ぎ目の 1 個が重なる */
  rowStart: number[];
  cols: number;
  /** 行ごとの、区画の中の縦位置（0〜1）と、目印の値（胴なら z、脚なら付け根からの割合） */
  v: number[];
  t: number[];
  /** 実寸 (m): 輪の周の長さの最大と、表面に沿った長さ */
  width: number;
  height: number;
  /** 細かさの倍率（顔は細かく、隠れる所は粗く） */
  density: number;
  /** 焼く側へ渡す追加の値 */
  meta: Record<string, number>;
  /** 絵の中の位置 (px、左上が原点): [x0, y0, x1, y1] */
  rect?: readonly [number, number, number, number];
}
export const ATLAS_SIZE = 2048;
/** 区画のまわりの余白と、絵を貼らない頂点が指す白い区画（左上）の大きさ (px) */
const ATLAS_GUTTER = 8, ATLAS_WHITE = 64;

/** 区画を絵の中へ並べる（高い順に、左から右へ段を作る）。入る最大の細かさを探す。 */
export function packCharts(charts: readonly AtlasChart[]): Record<string, [number, number, number, number]> {
  const order = charts.map((_, i) => i).sort((a, b) => charts[b]!.height * charts[b]!.density - charts[a]!.height * charts[a]!.density || a - b);
  const G = ATLAS_GUTTER;
  const place = (s: number, out?: Record<string, [number, number, number, number]>): boolean => {
    let x = ATLAS_WHITE + G, y = 0, shelf = ATLAS_WHITE + G;
    for (const i of order) {
      const c = charts[i]!;
      const w = Math.max(8, Math.round(c.width * c.density * s)), h = Math.max(8, Math.round(c.height * c.density * s));
      if (w + 2 * G > ATLAS_SIZE) return false;
      if (x + w + 2 * G > ATLAS_SIZE) { x = 0; y += shelf; shelf = 0; }
      if (y + h + 2 * G > ATLAS_SIZE) return false;
      if (out) out[c.kind] = [x + G, y + G, x + G + w, y + G + h];
      x += w + 2 * G;
      shelf = Math.max(shelf, h + 2 * G);
    }
    return true;
  };
  let lo = 4, hi = 4000;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (place(mid)) lo = mid; else hi = mid;
  }
  const out: Record<string, [number, number, number, number]> = {};
  place(Math.floor(lo), out);
  return out;
}

/** 区画の中の位置（横 0〜1、目印の値 t）を、絵の中の位置 (px) へ直す。 */
export function chartPx(c: AtlasChart, u: number, t: number): [number, number] {
  const r = c.rect!;
  const n = c.t.length;
  const inc = c.t[n - 1]! >= c.t[0]!;
  let v = c.v[n - 1]!;
  for (let i = 0; i < n - 1; i++) {
    const a = c.t[i]!, b = c.t[i + 1]!;
    if (inc ? t <= b : t >= b) {
      const k = Math.abs(b - a) < 1e-9 ? 0 : Math.min(1, Math.max(0, (t - a) / (b - a)));
      v = c.v[i]! + (c.v[i + 1]! - c.v[i]!) * k;
      break;
    }
  }
  return [r[0] + (r[2] - r[0]) * u, r[1] + (r[3] - r[1]) * v];
}

export class Geo {
  /** 絵を貼る区画（loft の atlas 指定で増える） */
  readonly charts: AtlasChart[] = [];
  private uv1: number[] = [];
  private usesAtlas = false;
  private pos: number[] = [];
  private nor: number[] = [];
  private col: number[] = [];
  private uv: number[] = [];
  private si: number[] = [];
  private sw: number[] = [];
  private part: number[] = [];
  private idx: number[] = [];

  get count(): number {
    return this.pos.length / 3;
  }
  /** b2 / w2 は 3 本目の骨（呼吸でふくらむ胸など）。w2 を先に取り、残りを b0 と b1 で分ける。 */
  vert(p: Vector3, n: Vector3, c: RGB, u: number, v: number, b0: number, b1: number, w1: number, part: number, b2 = 0, w2 = 0): number {
    this.pos.push(p.x, p.y, p.z);
    this.nor.push(n.x, n.y, n.z);
    this.col.push(c[0], c[1], c[2]);
    this.uv.push(u, v);
    this.uv1.push(-1, -1);
    this.si.push(b0, b1, b2, 0);
    this.sw.push((1 - w1) * (1 - w2), w1 * (1 - w2), w2, 0);
    this.part.push(part);
    return this.count - 1;
  }
  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }
  /** 頂点 i が指す絵の中の位置 (px) を決める */
  atlasPx(i: number, x: number, y: number): void {
    this.uv1[i * 2] = x / ATLAS_SIZE;
    this.uv1[i * 2 + 1] = 1 - y / ATLAS_SIZE;
    this.usesAtlas = true;
  }
  /** 区画の位置（rect）が決まった後に呼ぶ。区画に入った頂点の貼り位置を書く。 */
  private writeCharts(): void {
    for (const c of this.charts) {
      const r = c.rect;
      if (!r) continue;
      c.rowStart.forEach((first, row) => {
        for (let k = 0; k < c.cols; k++) this.atlasPx(first + k, r[0] + ((r[2] - r[0]) * k) / (c.cols - 1), r[1] + (r[3] - r[1]) * c.v[row]!);
      });
    }
  }
  get triangles(): number {
    return this.idx.length / 3;
  }
  /** 頂点 i に、もう 1 本の骨の影響を足す（重み w。既にある影響は 1 - w 倍になる）。布を腕や脚に付いて行かせるのに使う。 */
  addInfluence(i: number, bone: number, w: number): void {
    if (w <= 0) return;
    const o = i * 4;
    this.sw[o] = this.sw[o]! * (1 - w);
    this.sw[o + 1] = this.sw[o + 1]! * (1 - w);
    this.si[o + 2] = bone;
    this.sw[o + 2] = w;
  }
  /**
   * 頂点 i の骨の影響を、まとめて決め直す（v0.36.0）。同じ骨は足し合わせ、重みの大きい 4 本までを残して、合計を 1 にする。
   * 重みが全部 0 なら何もしない。
   */
  setSkin(i: number, inf: readonly (readonly [number, number])[]): void {
    const sum = new Map<number, number>();
    for (const [b, w] of inf) if (w > 0) sum.set(b, (sum.get(b) ?? 0) + w);
    const list = [...sum.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 4);
    const total = list.reduce((t, [, w]) => t + w, 0);
    if (total <= 0) return;
    const o = i * 4;
    for (let k = 0; k < 4; k++) {
      const e = list[k];
      this.si[o + k] = e ? e[0] : 0;
      this.sw[o + k] = e ? e[1] / total : 0;
    }
  }
  /** 頂点 i の骨の影響（[骨, 重み] の列。重み 0 は入れない） */
  skinOf(i: number): [number, number][] {
    const out: [number, number][] = [];
    for (let k = 0; k < 4; k++) if (this.sw[i * 4 + k]! > 0) out.push([this.si[i * 4 + k]!, this.sw[i * 4 + k]!]);
    return out;
  }
  positionOf(i: number): Vector3 {
    return new Vector3(this.pos[i * 3]!, this.pos[i * 3 + 1]!, this.pos[i * 3 + 2]!);
  }
  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new Float32BufferAttribute(this.uv, 2));
    if (this.charts.length > 0 || this.usesAtlas) {
      this.writeCharts();
      // 区画に入らない頂点（歯・爪・目・切り口など）は白い区画を指す: 絵の影響を受けず、頂点の色がそのまま出る
      const w = ATLAS_WHITE / 2 / ATLAS_SIZE;
      for (let i = 0; i < this.uv1.length; i += 2) {
        if (this.uv1[i]! < 0) { this.uv1[i] = w; this.uv1[i + 1] = 1 - w; }
      }
      g.setAttribute('uv1', new Float32BufferAttribute(this.uv1, 2));
    }
    g.setAttribute('skinIndex', new Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new Float32BufferAttribute(this.sw, 4));
    g.setAttribute('aPart', new Float32BufferAttribute(this.part, 1));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

export interface Ring {
  /** 断面の中心 */
  c: Vector3;
  right: Vector3;
  up: Vector3;
  /** 横の半径、上側の半径、下側の半径 */
  rx: number;
  top: number;
  bottom: number;
  b0: number;
  b1: number;
  w1: number;
  part: number;
}
export interface LoftOpts {
  /** 3 本目の骨と、その重み（頂点ごと）。 */
  third?: { bone: number; weight: (ring: Ring, a: number, p: Vector3) => number };
  /**
   * 頂点ごとの骨の影響を、まとめて決め直す（v0.36.0。[骨, 重み] の列。4 本まで。null は輪の重みのまま）。
   * ふたの頂点にも使う（a は角度、ふたの真ん中は NaN）。third より後に効く。
   */
  skin?: (ring: Ring, a: number, p: Vector3, index: number, def: readonly (readonly [number, number])[]) => readonly (readonly [number, number])[] | null;
  seg: number;
  /** 断面の角ばり。2 で楕円、大きいほど四角に近い */
  exponent?: number;
  /** 半径へ掛ける倍率の追加分（こぶ・くびれ）。a は断面の角度（-π/2 が真下、π/2 が真上） */
  bulge?: (ring: Ring, a: number, index: number) => number;
  color: (p: Vector3, n: Vector3, ring: Ring, a: number) => RGB;
  /** 表面のでこぼこの大きさ (m) と細かさ */
  noise?: number;
  noiseFreq?: number;
  capStart?: RGB;
  capEnd?: RGB;
  uRepeat?: number;
  vScale?: number;
  /** 設定図から焼いた絵を貼る区画を作る。切れ目ごとに 1 区画で、kinds がその名前。 */
  atlas?: {
    kinds: string[];
    /** 輪ごとの目印の値（焼く側が、設定図のどこを写すかを決めるのに使う） */
    t: (ring: Ring, index: number) => number;
    /** この輪から新しい区画を始める（同じ位置に輪を 2 つ重ねて切る） */
    breakBefore?: (ring: Ring, index: number) => boolean;
    /** この輪には絵を貼らない（頂点の色だけにする） */
    plain?: (ring: Ring, index: number) => boolean;
    density?: number[];
    meta?: Record<string, number>;
  };
  /** 別のメッシュの区画の貼り位置を借りる（切り落とした尾の先） */
  atlasRef?: { chart: AtlasChart; t: (ring: Ring, index: number) => number };
}

const spow = (v: number, e: number): number => Math.sign(v) * Math.pow(Math.abs(v), e);

/** 断面（輪）を順につないで、滑らかな筒状の面を作る。胴・首・尾・脚に使う。 */
export function loft(g: Geo, rings: Ring[], o: LoftOpts): void {
  const seg = o.seg;
  const e = 2 / (o.exponent ?? 2);
  const P: Vector3[][] = [];
  const A: number[] = [];
  for (let k = 0; k < seg; k++) A.push(-Math.PI / 2 + (Math.PI * 2 * k) / seg);
  rings.forEach((r, i) => {
    const row: Vector3[] = [];
    for (let k = 0; k < seg; k++) {
      const a = A[k]!;
      const cs = Math.cos(a), sn = Math.sin(a);
      const s = 1 + (o.bulge ? o.bulge(r, a, i) : 0);
      const x = spow(cs, e) * r.rx * s;
      const y = spow(sn, e) * (sn >= 0 ? r.top : r.bottom) * s;
      const p = new Vector3().copy(r.c).addScaledVector(r.right, x).addScaledVector(r.up, y);
      if (o.noise) {
        const f = o.noiseFreq ?? 2.2;
        const d = (fbm(p.x * f + 11.3, p.y * f + 4.1, p.z * f + 7.7, 3) - 0.5) * 2 * o.noise;
        const rad = new Vector3().subVectors(p, r.c);
        const len = rad.length();
        if (len > 1e-5) p.addScaledVector(rad, d / len);
      }
      row.push(p);
    }
    P.push(row);
  });
  // 法線: 格子の隣どうしの差から求める（継ぎ目でも滑らかになる）
  const base = g.count;
  const ta = new Vector3(), tl = new Vector3(), n = new Vector3(), out = new Vector3();
  let vAcc = 0;
  const uRep = o.uRepeat ?? 4;
  for (let i = 0; i < rings.length; i++) {
    const r = rings[i]!;
    if (i > 0) vAcc += r.c.distanceTo(rings[i - 1]!.c) * (o.vScale ?? 0.55);
    for (let k = 0; k <= seg; k++) {
      const kk = k % seg;
      const p = P[i]![kk]!;
      ta.subVectors(P[i]![(kk + 1) % seg]!, P[i]![(kk + seg - 1) % seg]!);
      tl.subVectors(P[Math.min(rings.length - 1, i + 1)]![kk]!, P[Math.max(0, i - 1)]![kk]!);
      n.crossVectors(ta, tl);
      out.subVectors(p, r.c);
      if (n.lengthSq() < 1e-12) n.copy(out);
      n.normalize();
      if (n.dot(out) < 0) n.negate();
      const vi = g.vert(p, n, o.color(p, n, r, A[kk]!), (k / seg) * uRep, vAcc, r.b0, r.b1, r.w1, r.part, o.third?.bone ?? 0, o.third ? o.third.weight(r, A[kk]!, p) : 0);
      if (o.skin) {
        const sk = o.skin(r, A[kk]!, p, i, g.skinOf(vi));
        if (sk) g.setSkin(vi, sk);
      }
    }
  }
  const w = seg + 1;
  if (o.atlas) {
    const at = o.atlas;
    let rows: number[] = [];
    let ci = 0;
    const close = (): void => {
      if (rows.length >= 2) {
        const v: number[] = [0];
        let width = 0;
        rows.forEach((i, j) => {
          let circ = 0;
          for (let k = 0; k < seg; k++) circ += P[i]![k]!.distanceTo(P[i]![(k + 1) % seg]!);
          width = Math.max(width, circ);
          if (j > 0) {
            let d = 0;
            for (let k = 0; k < seg; k++) d += P[i]![k]!.distanceTo(P[rows[j - 1]!]![k]!);
            v.push(v[j - 1]! + d / seg);
          }
        });
        const height = v[v.length - 1]!;
        g.charts.push({
          kind: at.kinds[ci] ?? `${at.kinds[0]}_${ci}`, rowStart: rows.map((i) => base + i * w), cols: w,
          v: v.map((x) => (height > 1e-9 ? x / height : 0)), t: rows.map((i) => at.t(rings[i]!, i)),
          width, height, density: at.density?.[ci] ?? 1, meta: at.meta ?? {},
        });
        ci++;
      }
      rows = [];
    };
    rings.forEach((r, i) => {
      if (at.plain?.(r, i)) { close(); return; }
      if (at.breakBefore?.(r, i)) close();
      rows.push(i);
    });
    close();
  }
  if (o.atlasRef) {
    for (let i = 0; i < rings.length; i++) {
      for (let k = 0; k <= seg; k++) {
        const [x, y] = chartPx(o.atlasRef.chart, k / seg, o.atlasRef.t(rings[i]!, i));
        g.atlasPx(base + i * w + k, x, y);
      }
    }
  }
  // 面の向き: 最初の四角形の法線が外を向くように決める
  const p00 = P[0]![0]!, p01 = P[0]![1]!, p10 = P[1]![0]!;
  const face = new Vector3().crossVectors(new Vector3().subVectors(p01, p00), new Vector3().subVectors(p10, p00));
  const mid = new Vector3().addVectors(rings[0]!.c, rings[1]!.c).multiplyScalar(0.5);
  const flip = face.dot(new Vector3().subVectors(p00, mid)) < 0;
  for (let i = 0; i < rings.length - 1; i++) {
    for (let k = 0; k < seg; k++) {
      const a = base + i * w + k, b = a + 1, c = a + w, d = c + 1;
      if (flip) { g.tri(a, c, b); g.tri(b, c, d); } else { g.tri(a, b, c); g.tri(b, d, c); }
    }
  }
  const cap = (ri: number, color: RGB, start: boolean): void => {
    const r = rings[ri]!;
    const axis = new Vector3().crossVectors(r.right, r.up).normalize();
    const other = rings[start ? 1 : rings.length - 2]!;
    if (axis.dot(new Vector3().subVectors(r.c, other.c)) < 0) axis.negate();
    const center = g.vert(r.c, axis, color, 0.5, 0.5, r.b0, r.b1, r.w1, r.part);
    const reskin = (vi: number, a: number, p: Vector3): void => {
      const sk = o.skin?.(r, a, p, ri, g.skinOf(vi));
      if (sk) g.setSkin(vi, sk);
    };
    reskin(center, Number.NaN, r.c);
    const ringIdx: number[] = [];
    for (let k = 0; k < seg; k++) {
      ringIdx.push(g.vert(P[ri]![k]!, axis, color, 0.5 + 0.5 * Math.cos(A[k]!), 0.5 + 0.5 * Math.sin(A[k]!), r.b0, r.b1, r.w1, r.part));
      reskin(ringIdx[k]!, A[k]!, P[ri]![k]!);
    }
    const fa = new Vector3().crossVectors(new Vector3().subVectors(P[ri]![0]!, r.c), new Vector3().subVectors(P[ri]![1]!, r.c));
    const ccw = fa.dot(axis) > 0;
    for (let k = 0; k < seg; k++) {
      const a = ringIdx[k]!, b = ringIdx[(k + 1) % seg]!;
      if (ccw) g.tri(center, a, b); else g.tri(center, b, a);
    }
  };
  if (o.capStart) cap(0, o.capStart, true);
  if (o.capEnd) cap(rings.length - 1, o.capEnd, false);
}

/** 面ごとに平らな三角形を足す（岩・晶のような角ばった物）。 */
export function flatTri(g: Geo, a: Vector3, b: Vector3, c: Vector3, color: RGB, bone: number, part: number, uvScale = 0.6): void {
  const n = new Vector3().crossVectors(new Vector3().subVectors(b, a), new Vector3().subVectors(c, a));
  if (n.lengthSq() < 1e-12) return;
  n.normalize();
  // 面に沿った向きで模様を貼る
  const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
  const uv = (p: Vector3): [number, number] => (ay >= ax && ay >= az ? [p.x, p.z] : ax >= az ? [p.z, p.y] : [p.x, p.y]);
  const i0 = g.vert(a, n, color, uv(a)[0] * uvScale, uv(a)[1] * uvScale, bone, bone, 0, part);
  const i1 = g.vert(b, n, color, uv(b)[0] * uvScale, uv(b)[1] * uvScale, bone, bone, 0, part);
  const i2 = g.vert(c, n, color, uv(c)[0] * uvScale, uv(c)[1] * uvScale, bone, bone, 0, part);
  g.tri(i0, i1, i2);
}

export interface SlabOpts {
  /** 幅 (x)、奥行 (z)、厚み (y) */
  w: number;
  d: number;
  h: number;
  seed: number;
  pos: [number, number, number];
  rot: [number, number, number];
  bone: number;
  part: number;
  rock: RGB;
  /** 上を向いた面に乗る苔の量 0〜1 */
  moss?: number;
  mossColor?: RGB;
  /** 体に沿わせる曲げ（x 方向・z 方向） */
  bendX?: number;
  bendZ?: number;
  points?: number;
}

/** 欠けた縁を持つ岩板。rim を渡すと、下の縁に沿って晶脈の帯を作る。 */
export interface PlateOpts {
  /** 板が乗る面: (u, v) ∈ [-1, 1]² → 位置。体の丸みに沿った面を渡す */
  surface: (u: number, v: number) => Vector3;
  /** 体の内側にある点（面の表裏を決める） */
  inside: Vector3;
  /** 実寸の目安 (m)。模様の大きさに使う */
  w: number;
  d: number;
  /** 板の厚み (m) と、縁から体へ下ろす壁の深さ (m) */
  thickness: number;
  skirt?: number;
  seed: number;
  bone: number;
  part: number;
  rock: RGB;
  moss?: number;
  mossColor?: RGB;
  /** 輪郭の角の数と、四角さ（小さいほど四角に近い） */
  points?: number;
  square?: number;
  /** 縁の面取りの幅 (m)。無ければ 0.035（ガルドロスの岩殻）。小さな板（防具）は細くする */
  bevel?: number;
}
/**
 * なめらかな岩板（設定図の背殻・肩・腰の板）。体の面に沿って反った薄い板で、輪郭は角のある多角形、
 * 上面は平らでなめらか、縁は斜めに落ちる面取り（rim の色。設定図の青銅色の縁）になる。
 */
export function plate(g: Geo, o: PlateOpts, rim: { geo: Geo; color: RGB }): void {
  const N = o.points ?? 9;
  const q = o.square ?? 0.5;
  const rnd = (i: number, j: number): number => hash3(o.seed, i, j);
  // 輪郭: 角の点と、その間の点（辺はまっすぐ）
  const corner: [number, number][] = [];
  for (let j = 0; j < N; j++) {
    const th = ((j + 0.5 + (rnd(j, 0) - 0.5) * 0.5) / N) * Math.PI * 2;
    const rr = 0.94 + 0.06 * rnd(j, 1);
    corner.push([spow(Math.cos(th), q) * rr, spow(Math.sin(th), q) * rr]);
  }
  const outline: [number, number][] = [];
  for (let j = 0; j < N; j++) {
    const a = corner[j]!, b = corner[(j + 1) % N]!;
    outline.push(a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
  }
  const M = outline.length;
  const e = 0.01;
  const du = new Vector3(), dv = new Vector3();
  const c0 = o.surface(0, 0);
  const n0 = new Vector3().crossVectors(du.subVectors(o.surface(e, 0), o.surface(-e, 0)), dv.subVectors(o.surface(0, e), o.surface(0, -e)));
  const sign = n0.dot(new Vector3().subVectors(c0, o.inside)) >= 0 ? 1 : -1;
  const normalAt = (u: number, v: number): Vector3 =>
    new Vector3().crossVectors(du.subVectors(o.surface(u + e, v), o.surface(u - e, v)), dv.subVectors(o.surface(u, v + e), o.surface(u, v - e))).normalize().multiplyScalar(sign);
  const moss = o.mossColor ?? o.rock;
  const colorAt = (p: Vector3, n: Vector3): RGB => {
    let col = shade(o.rock, 0.86 + 0.26 * fbm(p.x * 1.7 + o.seed, p.y * 1.7, p.z * 1.7, 3));
    if (o.moss) col = mix(col, moss, o.moss * sstep(0.2, 0.75, n.y) * sstep(0.42, 0.68, fbm(p.x * 1.1 + 5, p.y * 1.1 + o.seed, p.z * 1.1, 3)));
    return col;
  };
  // 上面: 中心から縁の手前（0.9）まで。なめらかな法線で、厚みに少しむらを付ける
  // 面取りの幅は板の大きさによらず一定（約 3.5cm）: 輪郭から内側へ、実寸で同じだけ入った所までが上面
  const BEVEL = o.bevel ?? 0.035;
  const fu = Math.max(0.6, 1 - BEVEL / (o.w / 2)), fv = Math.max(0.6, 1 - BEVEL / (o.d / 2));
  const F = [0.3, 0.58, 0.82, 1];
  const top = (u: number, v: number): number => {
    const n = normalAt(u, v);
    const base = o.surface(u, v);
    const p = base.clone().addScaledVector(n, o.thickness * (0.92 + 0.16 * fbm(base.x * 3 + o.seed, base.y * 3, base.z * 3, 2)));
    return g.vert(p, n, colorAt(p, n), (u * o.w * 0.5 + o.seed * 0.37) * 0.6, (v * o.d * 0.5 + o.seed * 0.11) * 0.6, o.bone, o.bone, 0, o.part);
  };
  const center = top(0, 0);
  const ringIdx: number[][] = F.map((f) => outline.map(([u, v]) => top(u * f * fu, v * f * fv)));
  // 面の向き: 最初の三角形が外を向く順を調べる
  const P = (i: number): Vector3 => g.positionOf(i);
  const t0 = new Vector3().crossVectors(new Vector3().subVectors(P(ringIdx[0]![0]!), P(center)), new Vector3().subVectors(P(ringIdx[0]![1]!), P(center)));
  const ccw = t0.dot(normalAt(0, 0)) > 0;
  const tri = (a: number, b: number, c: number): void => (ccw ? g.tri(a, b, c) : g.tri(a, c, b));
  for (let j = 0; j < M; j++) {
    const j2 = (j + 1) % M;
    tri(center, ringIdx[0]![j]!, ringIdx[0]![j2]!);
    for (let k = 0; k < F.length - 1; k++) {
      const a = ringIdx[k]![j]!, b = ringIdx[k]![j2]!, c = ringIdx[k + 1]![j]!, d = ringIdx[k + 1]![j2]!;
      tri(a, c, d);
      tri(a, d, b);
    }
  }
  // 縁: 面取り（青銅色）と、体へ下りる壁（暗い岩）。平らな面として作る
  const skirt = o.skirt ?? 0.05;
  const edge: { hi: Vector3; mid: Vector3; lo: Vector3 }[] = outline.map(([u, v], j) => {
    const n = normalAt(u * 0.97, v * 0.97);
    const base = o.surface(u, v);
    return { hi: P(ringIdx[F.length - 1]![j]!).clone(), mid: base.clone().addScaledVector(n, o.thickness * 0.38), lo: base.clone().addScaledVector(n, -skirt) };
  });
  const flat = (geo: Geo, a: Vector3, b: Vector3, c: Vector3, col: RGB): void => {
    const nn = new Vector3().crossVectors(new Vector3().subVectors(b, a), new Vector3().subVectors(c, a));
    if (nn.dot(new Vector3().subVectors(a, o.inside)) >= 0) flatTri(geo, a, b, c, col, o.bone, o.part);
    else flatTri(geo, a, c, b, col, o.bone, o.part);
  };
  for (let j = 0; j < M; j++) {
    const a = edge[j]!, b = edge[(j + 1) % M]!;
    const rc = shade(rim.color, 0.82 + 0.3 * rnd(40 + j, 2));
    flat(rim.geo, a.hi, b.hi, b.mid, rc);
    flat(rim.geo, a.hi, b.mid, a.mid, rc);
    const wc = shade(o.rock, 0.5 + 0.12 * rnd(60 + j, 3));
    flat(g, a.mid, b.mid, b.lo, wc);
    flat(g, a.mid, b.lo, a.lo, wc);
  }
}
export function slab(g: Geo, o: SlabOpts, rim?: { geo: Geo; color: RGB }): void {
  const N = o.points ?? 11;
  const m = new Matrix4().compose(new Vector3(...o.pos), new Quaternion().setFromEuler(new Euler(...o.rot)), new Vector3(1, 1, 1));
  const rnd = (i: number, j: number): number => hash3(o.seed, i, j);
  const levels: Vector3[][] = [[], [], []];
  const scaleAt = [0.9, 1.0, 0.7];
  const yAt = [-o.h / 2, -o.h * 0.08, o.h / 2];
  const bend = (p: Vector3): Vector3 => {
    p.y -= (o.bendX ?? 0) * p.x * p.x + (o.bendZ ?? 0) * p.z * p.z;
    return p;
  };
  for (let j = 0; j < N; j++) {
    const th = ((j + (rnd(j, 0) - 0.5) * 0.55) / N) * Math.PI * 2;
    const rr = 0.84 + 0.26 * rnd(j, 1);
    const ox = spow(Math.cos(th), 0.62) * (o.w / 2) * rr, oz = spow(Math.sin(th), 0.62) * (o.d / 2) * rr;
    for (let l = 0; l < 3; l++) {
      const s = scaleAt[l]! * (l === 2 ? 0.9 + 0.2 * rnd(j, 2) : 1);
      const y = yAt[l]! * (l === 2 ? 0.75 + 0.5 * rnd(j, 3) : 1);
      levels[l]!.push(bend(new Vector3(ox * s, y, oz * s)).applyMatrix4(m));
    }
  }
  const topC = bend(new Vector3((rnd(90, 0) - 0.5) * o.w * 0.2, (o.h / 2) * 1.25, (rnd(90, 1) - 0.5) * o.d * 0.2)).applyMatrix4(m);
  const botC = bend(new Vector3(0, -o.h / 2, 0)).applyMatrix4(m);
  const moss = o.mossColor ?? o.rock;
  const nrm = new Vector3();
  const face = (a: Vector3, b: Vector3, c: Vector3, k: number): void => {
    nrm.crossVectors(new Vector3().subVectors(b, a), new Vector3().subVectors(c, a)).normalize();
    let col = shade(o.rock, 0.82 + 0.36 * hash3(o.seed + 7, k, 5));
    if (o.moss) col = mix(col, shade(moss, 0.85 + 0.3 * hash3(o.seed + 9, k, 2)), o.moss * sstep(0.35, 0.8, nrm.y) * (0.55 + 0.45 * hash3(o.seed + 3, k, 8)));
    if (nrm.y < -0.2) col = shade(col, 0.6);
    flatTri(g, a, b, c, col, o.bone, o.part);
  };
  // 面の向き（外向き）を、上面の 1 枚で確かめてから決める
  const test = new Vector3().crossVectors(new Vector3().subVectors(levels[2]![1]!, levels[2]![0]!), new Vector3().subVectors(topC, levels[2]![0]!));
  const outward = test.dot(new Vector3().subVectors(topC, botC)) > 0;
  const f = (a: Vector3, b: Vector3, c: Vector3, k: number): void => (outward ? face(a, b, c, k) : face(a, c, b, k));
  for (let j = 0; j < N; j++) {
    const j2 = (j + 1) % N;
    f(levels[2]![j]!, levels[2]![j2]!, topC, j);
    f(levels[1]![j]!, levels[1]![j2]!, levels[2]![j2]!, 20 + j);
    f(levels[1]![j]!, levels[2]![j2]!, levels[2]![j]!, 40 + j);
    f(levels[0]![j]!, levels[0]![j2]!, levels[1]![j2]!, 60 + j);
    f(levels[0]![j]!, levels[1]![j2]!, levels[1]![j]!, 80 + j);
    f(levels[0]![j2]!, levels[0]![j]!, botC, 100 + j);
  }
  if (rim) {
    // 縁の帯: 中段の輪より少し外へ張り出した細い帯
    const c = new Vector3().addVectors(topC, botC).multiplyScalar(0.5);
    const up = new Vector3().subVectors(topC, botC).normalize();
    const ring = (j: number, grow: number, lift: number): Vector3 => {
      const p = levels[1]![j]!;
      const rad = new Vector3().subVectors(p, c);
      rad.addScaledVector(up, -rad.dot(up));
      return new Vector3().copy(levels[0]![j]!).lerp(p, 0.35).addScaledVector(rad.normalize(), grow).addScaledVector(up, lift);
    };
    for (let j = 0; j < N; j++) {
      const j2 = (j + 1) % N;
      const a0 = ring(j, 0.045, -0.03), a1 = ring(j2, 0.045, -0.03), b0 = ring(j, 0.03, 0.045), b1 = ring(j2, 0.03, 0.045);
      const col = shade(rim.color, 0.8 + 0.4 * hash3(o.seed + 31, j, 1));
      if (outward) { flatTri(rim.geo, a0, a1, b1, col, o.bone, o.part); flatTri(rim.geo, a0, b1, b0, col, o.bone, o.part); }
      else { flatTri(rim.geo, a0, b1, a1, col, o.bone, o.part); flatTri(rim.geo, a0, b0, b1, col, o.bone, o.part); }
    }
  }
}

/** 角ばった結晶（両端がとがった柱）。 */
export function crystal(g: Geo, base: Vector3, dir: Vector3, len: number, radius: number, color: RGB, bone: number, part: number, seed: number): void {
  const d = dir.clone().normalize();
  const ref = Math.abs(d.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
  const u = new Vector3().crossVectors(d, ref).normalize();
  const v = new Vector3().crossVectors(d, u);
  const tip = base.clone().addScaledVector(d, len);
  const ring: Vector3[] = [];
  const sides = 5;
  for (let k = 0; k < sides; k++) {
    const a = (k / sides) * Math.PI * 2 + seed;
    const r = radius * (0.85 + 0.3 * hash3(seed * 13, k, 2));
    ring.push(base.clone().addScaledVector(d, len * 0.38).addScaledVector(u, Math.cos(a) * r).addScaledVector(v, Math.sin(a) * r));
  }
  for (let k = 0; k < sides; k++) {
    const a = ring[k]!, b = ring[(k + 1) % sides]!;
    const c1 = shade(color, 0.7 + 0.6 * hash3(seed * 7, k, 4));
    flatTri(g, a, b, tip, c1, bone, part);
    flatTri(g, b, a, base, shade(c1, 0.7), bone, part);
  }
}

/** 滑らかな円すい（爪・くちばし・牙）。bend で先を曲げる。 */
export function horn(g: Geo, base: Vector3, dir: Vector3, len: number, radius: number, color: RGB, bone: number, part: number, bend?: Vector3): void {
  const d = dir.clone().normalize();
  const ref = Math.abs(d.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
  const right = new Vector3().crossVectors(d, ref).normalize();
  const up = new Vector3().crossVectors(right, d).normalize();
  const rings: Ring[] = [];
  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const c = base.clone().addScaledVector(d, len * t);
    if (bend) c.addScaledVector(bend, t * t);
    const r = Math.max(0.004, radius * (1 - t * 0.97));
    rings.push({ c, right, up, rx: r, top: r, bottom: r, b0: bone, b1: bone, w1: 0, part });
  }
  loft(g, rings, { seg: 7, color: (_p, _n, _r, _a) => color, uRepeat: 1, vScale: 0.3 });
}

/** 楕円体（目玉・こぶ・岩の塊）。axis の向きに長さ len、太さ rx × ry。 */
export function blob(g: Geo, center: Vector3, axis: Vector3, len: number, rx: number, ry: number, color: (p: Vector3, n: Vector3) => RGB, bone: number, part: number, seg = 8, steps = 5, b1 = bone, w1 = 0): void {
  const d = axis.clone().normalize();
  const ref = Math.abs(d.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
  const right = new Vector3().crossVectors(ref, d).normalize();
  const up = new Vector3().crossVectors(d, right).normalize();
  const rings: Ring[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const s = Math.max(0.03, Math.sin(Math.PI * (0.04 + 0.92 * t)));
    rings.push({ c: center.clone().addScaledVector(d, (t - 0.5) * len), right, up, rx: rx * s, top: ry * s, bottom: ry * s, b0: bone, b1, w1, part });
  }
  loft(g, rings, { seg, uRepeat: 1, vScale: 0.4, color: (p, n) => color(p, n) });
}
