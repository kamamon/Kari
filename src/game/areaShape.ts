// 自然な形のエリア（v0.20.0。docs/spec.md の 18.4）: 歩ける範囲の外周（多角形）と、エリアの中の道しるべ。
// 内か外か・縁までの距離・縁からの押し戻し・見通し・道しるべを伝う道を、DOM と Three.js を使わずに計算する。
// 縁に近い所だけを調べられるように、エリアを 4m のます目に分け、ますごとに近い辺を覚えておく。

/** [x, z]（m） */
export type Pt = readonly [number, number];

/** ます目の大きさ（m） */
const CELL = 4;
/** ますごとに覚える辺の範囲（m）。これより縁から離れた所は、縁までの距離を REACH とみなす（押し戻しの幅は、これより狭い） */
const REACH = 8;

interface Near {
  x: number;
  z: number;
  /** 縁までの距離（符号なし） */
  d: number;
  /** 中なら true */
  inside: boolean;
  /** 縁の点での、内向きの向き */
  nx: number;
  nz: number;
}

export class AreaShape {
  readonly n: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  /** 頂点 */
  private readonly px: Float64Array;
  private readonly pz: Float64Array;
  /** 辺 i（頂点 i → i+1）の向き・長さの 2 乗・内向きの法線 */
  private readonly ex: Float64Array;
  private readonly ez: Float64Array;
  private readonly el2: Float64Array;
  private readonly nx: Float64Array;
  private readonly nz: Float64Array;
  /** 頂点の内向きの向き（隣の 2 辺の法線を、角の大きさで重み付けした平均）。頂点がいちばん近い時の内外の判定に使う */
  private readonly vnx: Float64Array;
  private readonly vnz: Float64Array;
  /** ます目: 近い辺の一覧。null は、縁から REACH より離れたます（deep に、中か外かを持つ） */
  private readonly gx0: number;
  private readonly gz0: number;
  private readonly gw: number;
  private readonly gh: number;
  private readonly cells: (Int32Array | null)[];
  private readonly deep: Uint8Array;

  constructor(points: readonly Pt[]) {
    // 向きをそろえる（面積が正 = x → z の向きに回る）
    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i]!, b = points[(i + 1) % points.length]!;
      area += a[0] * b[1] - b[0] * a[1];
    }
    const pts = area >= 0 ? points : [...points].reverse();
    const n = pts.length;
    if (n < 3) throw new Error('外周の点が 3 つより少ない');
    this.n = n;
    this.px = new Float64Array(n);
    this.pz = new Float64Array(n);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      const [x, z] = pts[i]!;
      this.px[i] = x;
      this.pz[i] = z;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    this.minX = minX;
    this.maxX = maxX;
    this.minZ = minZ;
    this.maxZ = maxZ;
    this.ex = new Float64Array(n);
    this.ez = new Float64Array(n);
    this.el2 = new Float64Array(n);
    this.nx = new Float64Array(n);
    this.nz = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const dx = this.px[j]! - this.px[i]!, dz = this.pz[j]! - this.pz[i]!;
      const l = Math.hypot(dx, dz) || 1e-9;
      this.ex[i] = dx;
      this.ez[i] = dz;
      this.el2[i] = l * l;
      // 面積が正の向きでは、内向き = 進む向きを左へ 90 度
      this.nx[i] = -dz / l;
      this.nz[i] = dx / l;
    }
    this.vnx = new Float64Array(n);
    this.vnz = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const h = (i + n - 1) % n;
      const x = this.nx[h]! + this.nx[i]!, z = this.nz[h]! + this.nz[i]!;
      const l = Math.hypot(x, z) || 1;
      this.vnx[i] = x / l;
      this.vnz[i] = z / l;
    }
    // ます目
    this.gx0 = minX - REACH - CELL;
    this.gz0 = minZ - REACH - CELL;
    this.gw = Math.ceil((maxX - minX + 2 * (REACH + CELL)) / CELL);
    this.gh = Math.ceil((maxZ - minZ + 2 * (REACH + CELL)) / CELL);
    this.cells = new Array(this.gw * this.gh).fill(null);
    this.deep = new Uint8Array(this.gw * this.gh);
    const lists: number[][] = Array.from({ length: this.gw * this.gh }, () => []);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const x0 = Math.min(this.px[i]!, this.px[j]!) - REACH, x1 = Math.max(this.px[i]!, this.px[j]!) + REACH;
      const z0 = Math.min(this.pz[i]!, this.pz[j]!) - REACH, z1 = Math.max(this.pz[i]!, this.pz[j]!) + REACH;
      const c0 = Math.max(0, Math.floor((x0 - this.gx0) / CELL)), c1 = Math.min(this.gw - 1, Math.floor((x1 - this.gx0) / CELL));
      const r0 = Math.max(0, Math.floor((z0 - this.gz0) / CELL)), r1 = Math.min(this.gh - 1, Math.floor((z1 - this.gz0) / CELL));
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) lists[r * this.gw + c]!.push(i);
    }
    for (let k = 0; k < lists.length; k++) {
      const l = lists[k]!;
      if (l.length > 0) this.cells[k] = Int32Array.from(l);
      else {
        // 縁から REACH より離れたます: 中心が中か外か
        const cx = this.gx0 + ((k % this.gw) + 0.5) * CELL, cz = this.gz0 + (Math.floor(k / this.gw) + 0.5) * CELL;
        this.deep[k] = this.rayInside(cx, cz) ? 1 : 0;
      }
    }
  }

  /** 囲む広さ（m²） */
  area(): number {
    let a = 0;
    for (let i = 0; i < this.n; i++) {
      const j = (i + 1) % this.n;
      a += this.px[i]! * this.pz[j]! - this.px[j]! * this.pz[i]!;
    }
    return Math.abs(a) / 2;
  }

  /** (x, z) にいちばん近い縁での、外向きの向き */
  outwardAt(x: number, z: number): { x: number; z: number } {
    const r = this.nearestIn(x, z, null);
    return { x: -r.nx, z: -r.nz };
  }

  /** 外周の点（向きをそろえた後） */
  points(): Pt[] {
    const out: Pt[] = [];
    for (let i = 0; i < this.n; i++) out.push([this.px[i]!, this.pz[i]!]);
    return out;
  }

  /** 光線の交差で、中か外か（ます目を使わない。遅いので、作る時と、ます目の外だけ） */
  private rayInside(x: number, z: number): boolean {
    let c = false;
    const n = this.n;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = this.px[i]!, zi = this.pz[i]!, xj = this.px[j]!, zj = this.pz[j]!;
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
    }
    return c;
  }

  private cellOf(x: number, z: number): number {
    const c = Math.floor((x - this.gx0) / CELL), r = Math.floor((z - this.gz0) / CELL);
    if (c < 0 || r < 0 || c >= this.gw || r >= this.gh) return -1;
    return r * this.gw + c;
  }

  /** 縁のいちばん近い点。edges を渡すと、その辺だけを調べる */
  private nearestIn(x: number, z: number, edges: Int32Array | null): Near {
    let best = Infinity, bx = 0, bz = 0, bi = 0, bt = 0;
    const n = edges ? edges.length : this.n;
    for (let k = 0; k < n; k++) {
      const i = edges ? edges[k]! : k;
      const ax = this.px[i]!, az = this.pz[i]!;
      let t = ((x - ax) * this.ex[i]! + (z - az) * this.ez[i]!) / this.el2[i]!;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = ax + this.ex[i]! * t, qz = az + this.ez[i]! * t;
      const d2 = (x - qx) * (x - qx) + (z - qz) * (z - qz);
      if (d2 < best) {
        best = d2;
        bx = qx;
        bz = qz;
        bi = i;
        bt = t;
      }
    }
    // 内向き: 辺の途中なら辺の法線、頂点なら頂点の向き
    let nx: number, nz: number;
    if (bt <= 1e-9) {
      nx = this.vnx[bi]!;
      nz = this.vnz[bi]!;
    } else if (bt >= 1 - 1e-9) {
      const j = (bi + 1) % this.n;
      nx = this.vnx[j]!;
      nz = this.vnz[j]!;
    } else {
      nx = this.nx[bi]!;
      nz = this.nz[bi]!;
    }
    const d = Math.sqrt(best);
    const inside = (x - bx) * nx + (z - bz) * nz > 0;
    return { x: bx, z: bz, d, inside, nx, nz };
  }

  /** 縁のいちばん近い点。縁から REACH より内側の点は、null（調べない） */
  private near(x: number, z: number): Near | null {
    const k = this.cellOf(x, z);
    if (k < 0) return this.nearestIn(x, z, null);
    const edges = this.cells[k]!;
    if (!edges) return this.deep[k] ? null : this.nearestIn(x, z, null);
    const r = this.nearestIn(x, z, edges);
    // ますの辺は REACH の内だけ。それより遠い時は、ほかの辺の方が近いかもしれない
    if (r.d > REACH) return this.nearestIn(x, z, null);
    return r;
  }

  /** 中なら true */
  contains(x: number, z: number): boolean {
    const k = this.cellOf(x, z);
    if (k < 0) return false;
    if (!this.cells[k]) return this.deep[k] === 1;
    return this.nearestIn(x, z, this.cells[k]!).inside;
  }

  /** 縁までの距離。中なら正、外なら負。縁から REACH より離れた中の点は REACH（それ以上は測らない） */
  signedDistance(x: number, z: number): number {
    const k = this.cellOf(x, z);
    if (k >= 0 && !this.cells[k]) return this.deep[k] ? REACH : -REACH;
    const r = this.near(x, z);
    if (!r) return REACH;
    return r.inside ? r.d : -r.d;
  }

  /** 縁から margin 以上内側へ押し戻した点（もう内側なら、そのまま） */
  constrain(x: number, z: number, margin: number): [number, number] {
    for (let pass = 0; pass < 3; pass++) {
      const k = this.cellOf(x, z);
      if (k >= 0 && !this.cells[k] && this.deep[k]) return [x, z];
      const r = this.near(x, z);
      if (!r) return [x, z];
      const sd = r.inside ? r.d : -r.d;
      if (sd >= margin - 1e-9) return [x, z];
      let ux = r.nx, uz = r.nz;
      if (r.d > 1e-6) {
        ux = (x - r.x) / r.d;
        uz = (z - r.z) / r.d;
        if (!r.inside) {
          ux = -ux;
          uz = -uz;
        }
      }
      x = r.x + ux * margin;
      z = r.z + uz * margin;
    }
    return [x, z];
  }

  /** (x0, z0) → (x1, z1) の線分が、縁から r 以上離れて、ずっと中を通る */
  clear(x0: number, z0: number, x1: number, z1: number, r: number): boolean {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const step = Math.max(0.25, Math.min(1, r * 0.5));
    const cnt = Math.max(1, Math.ceil(len / step));
    for (let i = 0; i <= cnt; i++) {
      const t = i / cnt;
      if (this.signedDistance(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t) < r) return false;
    }
    return true;
  }
}

/**
 * エリアの中の道しるべ（点の一覧）。点どうしの見通しで道をつなぎ、いちばん短い道を前もって求めておく。
 * まっすぐ行けない時に、近くの見える点から、道を伝って、目当てが見える点まで歩く。
 */
export class NavGraph {
  readonly nodes: Pt[];
  /** 点 i から点 j への、いちばん短い道の長さと、次に寄る点 */
  private readonly dist: Float64Array;
  private readonly nextHop: Int32Array;

  constructor(
    private readonly shape: AreaShape,
    nodes: readonly Pt[],
    clearance = 2,
  ) {
    this.nodes = nodes.map((p) => [p[0], p[1]] as Pt);
    const n = this.nodes.length;
    this.dist = new Float64Array(n * n).fill(Infinity);
    this.nextHop = new Int32Array(n * n).fill(-1);
    for (let i = 0; i < n; i++) {
      this.dist[i * n + i] = 0;
      this.nextHop[i * n + i] = i;
      for (let j = i + 1; j < n; j++) {
        const a = this.nodes[i]!, b = this.nodes[j]!;
        if (!shape.clear(a[0], a[1], b[0], b[1], clearance)) continue;
        const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
        this.dist[i * n + j] = this.dist[j * n + i] = d;
        this.nextHop[i * n + j] = j;
        this.nextHop[j * n + i] = i;
      }
    }
    for (let k = 0; k < n; k++) {
      for (let i = 0; i < n; i++) {
        const ik = this.dist[i * n + k]!;
        if (ik === Infinity) continue;
        for (let j = 0; j < n; j++) {
          const d = ik + this.dist[k * n + j]!;
          if (d < this.dist[i * n + j]!) {
            this.dist[i * n + j] = d;
            this.nextHop[i * n + j] = this.nextHop[i * n + k]!;
          }
        }
      }
    }
  }

  /** 点どうしが、道でつながっている */
  connected(i: number, j: number): boolean {
    return this.dist[i * this.nodes.length + j]! < Infinity;
  }

  /**
   * (fx, fz) から (tx, tz) へ向かう時に、次に目指す点。まっすぐ見えるなら、目当てそのもの。
   * 見えなければ、見える道しるべから、目当てが見える道しるべまでの、いちばん短い道の、最初の点（着いていれば、その次の点）。
   */
  next(fx: number, fz: number, tx: number, tz: number, r: number): { x: number; z: number } {
    const s = this.shape;
    if (s.clear(fx, fz, tx, tz, r)) return { x: tx, z: tz };
    const n = this.nodes.length;
    let best = Infinity, bi = -1, bj = -1;
    const fromD: number[] = [], toD: number[] = [];
    for (let i = 0; i < n; i++) {
      const p = this.nodes[i]!;
      fromD.push(s.clear(fx, fz, p[0], p[1], r) ? Math.hypot(p[0] - fx, p[1] - fz) : Infinity);
      toD.push(s.clear(p[0], p[1], tx, tz, r) ? Math.hypot(tx - p[0], tz - p[1]) : Infinity);
    }
    for (let i = 0; i < n; i++) {
      if (fromD[i] === Infinity) continue;
      for (let j = 0; j < n; j++) {
        if (toD[j] === Infinity) continue;
        const d = fromD[i]! + this.dist[i * n + j]! + toD[j]!;
        if (d < best) {
          best = d;
          bi = i;
          bj = j;
        }
      }
    }
    if (bi < 0) return { x: tx, z: tz };
    // 寄る点に着いていれば（1.5m の内）、道の次の点へ
    let k = bi;
    const p = this.nodes[k]!;
    if (Math.hypot(p[0] - fx, p[1] - fz) < 1.5) {
      if (k === bj) return { x: tx, z: tz };
      k = this.nextHop[k * n + bj]!;
    }
    const q = this.nodes[k]!;
    return { x: q[0], z: q[1] };
  }
}
