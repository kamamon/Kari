// 狩場の地面の作り込み（v0.74.0。docs/spec.md の 21.4）。描画だけで、当たり・移動・採取は変えない。
//  - 踏み分け道: 出口から、エリアの真ん中へ続く道。岩と段をよけて、ゆるく曲がる。出口の所は広く、奥は細い。
//  - 際の陰: 外周の崖・岩・段の根元の地面を暗くする（物が地面に乗って見える）。出口の開いた所は暗くしない。
// 道と陰は、1 枚の小さな絵（1m を 3 画素。R = 道、G = 陰）にして、地面の素材が混ぜる（arena.ts の groundDetailMaterial）。
// 計算は、ここだけで決まる（DOM・Three.js・乱数の Math.random を使わない。同じ入力なら同じ道）。
import { SeededRng } from '../core/seededRng';
import { AreaShape, type Pt } from '../game/areaShape';

export interface GroundDetailInput {
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** 歩ける範囲の外周。無ければ bounds の四角 */
  shape?: readonly Pt[];
  /** 出口（外周の岩壁が開いている所） */
  exits: readonly { x: number; z: number }[];
  /** エリアの真ん中（道の集まる所）。無ければ bounds の真ん中 */
  center?: { x: number; z: number };
  rocks: readonly { x: number; z: number; r: number }[];
  platforms: readonly { minX: number; maxX: number; minZ: number; maxZ: number; h: number }[];
  /** エリアの種類。path（通り道）は、道が真ん中でつながる。ほか（狩りのエリア・巣・野営地）は、真ん中の手前で薄れて消える */
  kind?: string;
  seed: number;
}

/** 道の上の点。w = 道の半分の幅（m）、k = 濃さ（0〜1）、s = 出口からの道のり（m。出口の外は負） */
export interface TrailPoint { x: number; z: number; w: number; k: number; s: number }

/** 地面の素材へ渡す絵。画素 (i, j) は、世界の (minX + (i + 0.5) / width * sizeX, minZ + (j + 0.5) / height * sizeZ) */
export interface GroundMask {
  /** RGBA。R = 道、G = 陰、B = 0、A = 255 */
  data: Uint8Array;
  width: number;
  height: number;
  minX: number;
  minZ: number;
  sizeX: number;
  sizeZ: number;
}

export interface GroundDetail {
  /** 道の集まる所（真ん中を、岩と段から離した点） */
  hub: { x: number; z: number };
  /** 出口ごとの道（出口の外 → 出口 → 真ん中） */
  trails: TrailPoint[][];
  /** その場所の道の濃さ（0〜1） */
  trailAt(x: number, z: number): number;
  /** その場所の陰の濃さ（0〜1） */
  shadeAt(x: number, z: number): number;
  mask: GroundMask;
}

/** 絵の外側の余白（m）。地面の板が外周の外へ出る分（arena.ts の landscape の余白と同じ） */
export const MASK_MARGIN = 6;
/** 1m あたりの画素。1 辺は MASK_MAX 画素まで */
const PX_PER_M = 3, MASK_MAX = 512;
/** 道の半分の幅（m）: 奥・出口の口 */
export const TRAIL_HALF = 1.05, MOUTH_HALF = 2.3;
/** 出口の口の長さ（m。ここまでで奥の幅へ細くなる）と、出口の外へ伸ばす長さ（m） */
const MOUTH_LEN = 10, OUT_LEN = 4.5;
/** 道が集まる所の、踏み固めた円の半径（m） */
const HUB_R = 2.0;
/** 道の中心が、岩・段・外周から離れる距離（m） */
export const ROCK_CLEAR = 1.9, PLAT_CLEAR = 1.5, EDGE_CLEAR = 2.4;
/** 陰が届く幅（m）: 外周の崖・岩・段 */
const EDGE_SHADE = 3.6, ROCK_SHADE = 2.0, PLAT_SHADE = 1.3;

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
const smooth = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** 道と陰を作る。 */
export function buildGroundDetail(input: GroundDetailInput): GroundDetail {
  const b = input.bounds;
  const outline = input.shape && input.shape.length >= 3 ? new AreaShape(input.shape) : null;
  const rng = new SeededRng((input.seed ^ 0x5f3a91) >>> 0);
  /** 縁までの距離（中が正） */
  const edge = (x: number, z: number): number =>
    outline ? outline.signedDistance(x, z) : Math.min(x - b.minX, b.maxX - x, z - b.minZ, b.maxZ - z);
  const pullIn = (x: number, z: number, margin: number): [number, number] =>
    outline ? outline.constrain(x, z, margin) : [Math.min(b.maxX - margin, Math.max(b.minX + margin, x)), Math.min(b.maxZ - margin, Math.max(b.minZ + margin, z))];
  const plats = input.platforms.filter((p) => p.h > 0.05);

  /** 岩と段から押し出す（道の中心が離れる距離まで）。動かしたら true */
  const pushOut = (p: { x: number; z: number }): boolean => {
    let moved = false;
    for (const r of input.rocks) {
      const dx = p.x - r.x, dz = p.z - r.z, d = Math.hypot(dx, dz), need = r.r + ROCK_CLEAR;
      if (d >= need) continue;
      const ux = d > 1e-6 ? dx / d : 1, uz = d > 1e-6 ? dz / d : 0;
      p.x = r.x + ux * need;
      p.z = r.z + uz * need;
      moved = true;
    }
    for (const q of plats) {
      const x0 = q.minX - PLAT_CLEAR, x1 = q.maxX + PLAT_CLEAR, z0 = q.minZ - PLAT_CLEAR, z1 = q.maxZ + PLAT_CLEAR;
      if (p.x <= x0 || p.x >= x1 || p.z <= z0 || p.z >= z1) continue;
      // いちばん近い辺へ
      const dl = p.x - x0, dr = x1 - p.x, dn = p.z - z0, df = z1 - p.z, m = Math.min(dl, dr, dn, df);
      if (m === dl) p.x = x0;
      else if (m === dr) p.x = x1;
      else if (m === dn) p.z = z0;
      else p.z = z1;
      moved = true;
    }
    return moved;
  };

  // 道の集まる所: 真ん中を、岩と段と外周から離す
  const hub = { x: input.center?.x ?? (b.minX + b.maxX) / 2, z: input.center?.z ?? (b.minZ + b.maxZ) / 2 };
  for (let i = 0; i < 6; i++) {
    const moved = pushOut(hub);
    [hub.x, hub.z] = pullIn(hub.x, hub.z, EDGE_CLEAR);
    if (!moved) break;
  }

  /** 出口の外向き（単位の長さ） */
  const outwardOf = (e: { x: number; z: number }): { x: number; z: number } => {
    if (outline) {
      const n = outline.outwardAt(e.x, e.z);
      const l = Math.hypot(n.x, n.z);
      if (l > 1e-6) return { x: n.x / l, z: n.z / l };
    }
    const dx = e.x - hub.x, dz = e.z - hub.z, l = Math.hypot(dx, dz) || 1;
    return { x: dx / l, z: dz / l };
  };

  // 岩と段をよける道すじ（1m のます目の上の最短路）。大きな段（登る棚）の向こうへ、まっすぐ抜けないようにする
  const gx0 = Math.floor(b.minX), gz0 = Math.floor(b.minZ), gw = Math.ceil(b.maxX) - gx0 + 1, gh = Math.ceil(b.maxZ) - gz0 + 1;
  const wall = new Uint8Array(gw * gh), soft = new Uint8Array(gw * gh);
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      const x = gx0 + i, z = gz0 + j, k = j * gw + i;
      if (edge(x, z) < 1) { wall[k] = 1; continue; }
      for (const r of input.rocks) {
        const d = Math.hypot(x - r.x, z - r.z) - r.r;
        if (d < 1) wall[k] = 1;
        else if (d < 2.6) soft[k] = 1;
      }
      for (const q of plats) {
        const d = Math.hypot(Math.max(q.minX - x, 0, x - q.maxX), Math.max(q.minZ - z, 0, z - q.maxZ));
        if (d < 0.9) wall[k] = 1;
        else if (d < 2.4) soft[k] = 1;
      }
    }
  }
  const route = (from: { x: number; z: number }, to: { x: number; z: number }): { x: number; z: number }[] | null => {
    const cell = (p: { x: number; z: number }): number => Math.max(0, Math.min(gh - 1, Math.round(p.z - gz0))) * gw + Math.max(0, Math.min(gw - 1, Math.round(p.x - gx0)));
    const s0 = cell(from), s1 = cell(to);
    const cost = new Float32Array(gw * gh).fill(Infinity), est = new Float32Array(gw * gh).fill(Infinity), prev = new Int32Array(gw * gh).fill(-1), done = new Uint8Array(gw * gh);
    const ti = s1 % gw, tj = (s1 - ti) / gw;
    cost[s0] = 0;
    est[s0] = 0;
    // 山（ヒープ）の順は、ここまでの道のり + 終わりまでのまっすぐの長さ（A*）
    const heap: number[] = [s0];
    const up = (i: number): void => { while (i > 0) { const p = (i - 1) >> 1; if (est[heap[p]!]! <= est[heap[i]!]!) break; [heap[p], heap[i]] = [heap[i]!, heap[p]!]; i = p; } };
    const down = (i: number): void => { for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < heap.length && est[heap[l]!]! < est[heap[m]!]!) m = l; if (r < heap.length && est[heap[r]!]! < est[heap[m]!]!) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i]!, heap[m]!]; i = m; } };
    while (heap.length) {
      const c = heap[0]!, lastCell = heap.pop()!;
      if (heap.length) { heap[0] = lastCell; down(0); }
      if (done[c]) continue;
      done[c] = 1;
      if (c === s1) break;
      const ci = c % gw, cj = (c - ci) / gw;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ni = ci + di, nj = cj + dj;
          if (ni < 0 || nj < 0 || ni >= gw || nj >= gh) continue;
          const n = nj * gw + ni;
          // 始めと終わりのますは、壁でも通す（出口の口・岩に寄った真ん中）
          if (done[n] || (wall[n] && n !== s1 && n !== s0)) continue;
          const step = (di && dj ? 1.4142 : 1) * (soft[n] ? 1.7 : 1);
          if (cost[c]! + step < cost[n]!) { cost[n] = cost[c]! + step; est[n] = cost[n]! + Math.hypot(ni - ti, nj - tj); prev[n] = c; heap.push(n); up(heap.length - 1); }
        }
      }
    }
    if (!done[s1]) return null;
    const out: { x: number; z: number }[] = [];
    for (let c = s1; c >= 0; c = prev[c]!) out.push({ x: gx0 + (c % gw), z: gz0 + Math.floor(c / gw) });
    out.reverse();
    out[0] = { x: from.x, z: from.z };
    out[out.length - 1] = { x: to.x, z: to.z };
    return out;
  };

  const single = input.exits.length < 2;
  /** 通り道のエリア: 道が真ん中でつながる */
  const through = input.kind === 'path' && !single;
  const trails: TrailPoint[][] = [];
  for (const e of input.exits) {
    const n = outwardOf(e);
    // 出口から内へまっすぐ入る所（ここまでは、出口の向きのまま）
    const inLen = Math.min(6, Math.hypot(hub.x - e.x, hub.z - e.z) * 0.35);
    const a = { x: e.x - n.x * inLen, z: e.z - n.z * inLen };
    const L = Math.hypot(hub.x - a.x, hub.z - a.z);
    // ゆるい曲がり: 両端で 0 になる 2 つの波
    const amp = Math.min(4.5, L * 0.13), s1 = (rng.next() < 0.5 ? -1 : 1) * (0.55 + 0.45 * rng.next()) * amp, s2 = (rng.next() * 2 - 1) * amp * 0.5;
    // 道の濃さと幅のむら（道のりに沿った、ゆるい波）
    const ph = [rng.next() * 6.283, rng.next() * 6.283, rng.next() * 6.283, rng.next() * 6.283];
    // 道すじ（岩と段をよけた最短路。見つからなければ、まっすぐ）を先にならしてから、曲がりを足す
    const straight = Math.max(2, Math.round(L));
    const mid: { x: number; z: number }[] = route(a, hub) ?? Array.from({ length: straight + 1 }, (_, i) => ({ x: lerp(a.x, hub.x, i / straight), z: lerp(a.z, hub.z, i / straight) }));
    for (let pass = 0; pass < 6; pass++) {
      for (let i = 1; i < mid.length - 1; i++) {
        const p = mid[i]!, q = mid[i - 1]!, r = mid[i + 1]!;
        p.x = p.x * 0.5 + (q.x + r.x) * 0.25;
        p.z = p.z * 0.5 + (q.z + r.z) * 0.25;
      }
    }
    // 道すじに直交する向きは、ずらす前の点から決める
    const base = mid.map((p) => ({ x: p.x, z: p.z }));
    for (let i = 1; i < mid.length - 1; i++) {
      const u = i / (mid.length - 1), off = s1 * Math.sin(Math.PI * u) + s2 * Math.sin(2 * Math.PI * u);
      const q = base[i - 1]!, r = base[i + 1]!, l = Math.hypot(r.x - q.x, r.z - q.z) || 1;
      mid[i]!.x += (-(r.z - q.z) / l) * off;
      mid[i]!.z += ((r.x - q.x) / l) * off;
    }
    // 岩・段・外周から離し、なめらかにする（両端は動かさない）。離す → ならす を繰り返し、最後はならして終わる（角を残さない）
    for (let pass = 0; pass < 28; pass++) {
      for (let i = 1; i < mid.length - 1; i++) {
        const p = mid[i]!;
        pushOut(p);
        // 外周からは、出口から離れるほど大きく離す（出口の口は、外周に近くてよい）
        const far = smooth(2, 9, Math.hypot(p.x - e.x, p.z - e.z));
        [p.x, p.z] = pullIn(p.x, p.z, lerp(0.6, EDGE_CLEAR, far));
      }
      for (let i = 1; i < mid.length - 1; i++) {
        const p = mid[i]!, q = mid[i - 1]!, r = mid[i + 1]!;
        p.x = p.x * 0.5 + (q.x + r.x) * 0.25;
        p.z = p.z * 0.5 + (q.z + r.z) * 0.25;
      }
    }
    // 出口の外 → 出口 → 内へ入る所 → 真ん中、を 1m おきに取り直す
    const raw: { x: number; z: number }[] = [{ x: e.x + n.x * OUT_LEN, z: e.z + n.z * OUT_LEN }, { x: e.x, z: e.z }, ...mid];
    const pts: TrailPoint[] = [];
    let s = -OUT_LEN, carry = 0;
    const total = OUT_LEN + inLen + polyLength(mid);
    const inner = total - OUT_LEN;
    const put = (x: number, z: number, at: number): void => {
      // 奥の道は、所々で細く・薄くなる（踏まれ方のむら）。出口の口は、いつも濃い
      const deep = smooth(MOUTH_LEN * 0.6, MOUTH_LEN * 1.5, at);
      const v1 = 0.5 + 0.3 * Math.sin(at * 0.19 + ph[0]!) + 0.2 * Math.sin(at * 0.47 + ph[1]!), v2 = 0.5 + 0.3 * Math.sin(at * 0.23 + ph[2]!) + 0.2 * Math.sin(at * 0.61 + ph[3]!);
      const mouth = at < 0 ? MOUTH_HALF * (1 - 0.3 * smooth(0, OUT_LEN, -at)) : lerp(MOUTH_HALF, TRAIL_HALF * lerp(1, lerp(0.8, 1.25, v2), deep), smooth(1.5, MOUTH_LEN, at));
      let k = at < 0 ? 1 - 0.45 * smooth(0, OUT_LEN, -at) : lerp(1, lerp(0.56, 1, v1), deep);
      // 道が真ん中までつながるのは、通り道のエリア（kind: path）だけ。狩りのエリアは、開けた真ん中へ入る手前で薄れて消える
      // （出口が 1 つの野営地と、巣は、もっと手前から）
      if (at > 0 && single) k *= 1 - smooth(0.5, 0.92, at / inner);
      else if (at > 0 && input.kind === 'nest') k *= 1 - smooth(0.4, 0.85, at / inner);
      else if (at > 0 && !through) k *= 1 - smooth(0.6, 0.95, at / inner);
      pts.push({ x, z, w: mouth, k, s: at });
    };
    for (let i = 0; i + 1 < raw.length; i++) {
      const p = raw[i]!, q = raw[i + 1]!, len = Math.hypot(q.x - p.x, q.z - p.z);
      let t = carry;
      while (t < len) {
        put(lerp(p.x, q.x, t / len), lerp(p.z, q.z, t / len), s + t);
        t += 1;
      }
      carry = t - len;
      s += len;
    }
    const last = raw[raw.length - 1]!;
    put(last.x, last.z, s);
    trails.push(pts);
  }
  // 3 本以上の道が集まる所は、踏み固めた円（通り道のエリアだけ）
  const hubK = through && input.exits.length >= 3 ? 0.8 : 0;

  // 線分ごとに、囲む四角を持っておく
  interface Seg { ax: number; az: number; bx: number; bz: number; aw: number; bw: number; ak: number; bk: number; x0: number; x1: number; z0: number; z1: number }
  const segs: Seg[] = [];
  for (const t of trails) {
    for (let i = 0; i + 1 < t.length; i++) {
      const p = t[i]!, q = t[i + 1]!, reach = Math.max(p.w, q.w) * 1.3;
      if (p.k <= 0 && q.k <= 0) continue;
      segs.push({ ax: p.x, az: p.z, bx: q.x, bz: q.z, aw: p.w, bw: q.w, ak: p.k, bk: q.k, x0: Math.min(p.x, q.x) - reach, x1: Math.max(p.x, q.x) + reach, z0: Math.min(p.z, q.z) - reach, z1: Math.max(p.z, q.z) + reach });
    }
  }
  const segAt = (g: Seg, x: number, z: number): number => {
    const dx = g.bx - g.ax, dz = g.bz - g.az, l2 = dx * dx + dz * dz;
    const u = l2 > 1e-9 ? clamp01(((x - g.ax) * dx + (z - g.az) * dz) / l2) : 0;
    const d = Math.hypot(x - (g.ax + dx * u), z - (g.az + dz * u)), w = lerp(g.aw, g.bw, u);
    return lerp(g.ak, g.bk, u) * (1 - smooth(w * 0.5, w * 1.3, d));
  };
  const hubAt = (x: number, z: number): number => (hubK > 0 ? hubK * (1 - smooth(HUB_R * 0.5, HUB_R * 1.3, Math.hypot(x - hub.x, z - hub.z))) : 0);
  const trailAt = (x: number, z: number): number => {
    let v = hubAt(x, z);
    for (const g of segs) {
      if (x < g.x0 || x > g.x1 || z < g.z0 || z > g.z1) continue;
      const t = segAt(g, x, z);
      if (t > v) v = t;
    }
    return v;
  };

  const shadeAt = (x: number, z: number): number => {
    // 出口の開いた所は、崖が無いので暗くしない
    let open = 1;
    for (const e of input.exits) open = Math.min(open, smooth(2.6, 6.5, Math.hypot(x - e.x, z - e.z)));
    let v = (1 - smooth(0, EDGE_SHADE, edge(x, z))) * open;
    for (const r of input.rocks) {
      const d = Math.hypot(x - r.x, z - r.z);
      if (d >= r.r + ROCK_SHADE) continue;
      v = Math.max(v, 0.9 * (1 - smooth(r.r * 0.8, r.r + ROCK_SHADE, d)));
    }
    for (const q of plats) {
      const dx = Math.max(q.minX - x, 0, x - q.maxX), dz = Math.max(q.minZ - z, 0, z - q.maxZ), d = Math.hypot(dx, dz);
      if (d >= PLAT_SHADE) continue;
      v = Math.max(v, 0.7 * (1 - smooth(0, PLAT_SHADE, d)));
    }
    return v;
  };

  // 絵にする: 陰は 1m のます目で測って伸ばす（ゆるい濃淡なので足りる）。道は、線分の近くの画素だけを塗る
  const minX = b.minX - MASK_MARGIN, minZ = b.minZ - MASK_MARGIN, sizeX = b.maxX - b.minX + MASK_MARGIN * 2, sizeZ = b.maxZ - b.minZ + MASK_MARGIN * 2;
  const width = Math.min(MASK_MAX, Math.max(8, Math.ceil(sizeX * PX_PER_M))), height = Math.min(MASK_MAX, Math.max(8, Math.ceil(sizeZ * PX_PER_M)));
  const data = new Uint8Array(width * height * 4);
  const cw = Math.ceil(sizeX) + 2, ch = Math.ceil(sizeZ) + 2;
  const coarse = new Float32Array(cw * ch);
  for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) coarse[j * cw + i] = shadeAt(minX + i, minZ + j);
  const trail = new Float32Array(width * height);
  const px = sizeX / width, pz = sizeZ / height;
  const paint = (x0: number, x1: number, z0: number, z1: number, at: (x: number, z: number) => number): void => {
    const i0 = Math.max(0, Math.floor((x0 - minX) / px)), i1 = Math.min(width - 1, Math.ceil((x1 - minX) / px));
    const j0 = Math.max(0, Math.floor((z0 - minZ) / pz)), j1 = Math.min(height - 1, Math.ceil((z1 - minZ) / pz));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const t = at(minX + (i + 0.5) * px, minZ + (j + 0.5) * pz);
        if (t > trail[j * width + i]!) trail[j * width + i] = t;
      }
    }
  };
  for (const g of segs) paint(g.x0, g.x1, g.z0, g.z1, (x, z) => segAt(g, x, z));
  if (hubK > 0) paint(hub.x - HUB_R * 1.3, hub.x + HUB_R * 1.3, hub.z - HUB_R * 1.3, hub.z + HUB_R * 1.3, hubAt);
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const fx = (i + 0.5) * px, fz = (j + 0.5) * pz;
      const ix = Math.min(cw - 2, Math.floor(fx)), iz = Math.min(ch - 2, Math.floor(fz)), tx = fx - ix, tz = fz - iz;
      const c00 = coarse[iz * cw + ix]!, c10 = coarse[iz * cw + ix + 1]!, c01 = coarse[(iz + 1) * cw + ix]!, c11 = coarse[(iz + 1) * cw + ix + 1]!;
      const shade = lerp(lerp(c00, c10, tx), lerp(c01, c11, tx), tz);
      const k = (j * width + i) * 4;
      data[k] = Math.round(clamp01(trail[j * width + i]!) * 255);
      data[k + 1] = Math.round(clamp01(shade) * 255);
      data[k + 3] = 255;
    }
  }
  return { hub, trails, trailAt, shadeAt, mask: { data, width, height, minX, minZ, sizeX, sizeZ } };
}

function polyLength(p: readonly { x: number; z: number }[]): number {
  let l = 0;
  for (let i = 0; i + 1 < p.length; i++) l += Math.hypot(p[i + 1]!.x - p[i]!.x, p[i + 1]!.z - p[i]!.z);
  return l;
}

/** 絵の値を、世界の座標で読む（検査用。いちばん近い画素） */
export function maskAt(m: GroundMask, x: number, z: number): { trail: number; shade: number } {
  const i = Math.max(0, Math.min(m.width - 1, Math.floor(((x - m.minX) / m.sizeX) * m.width)));
  const j = Math.max(0, Math.min(m.height - 1, Math.floor(((z - m.minZ) / m.sizeZ) * m.height)));
  const k = (j * m.width + i) * 4;
  return { trail: m.data[k]! / 255, shade: m.data[k + 1]! / 255 };
}
