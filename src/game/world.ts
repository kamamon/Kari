// 地形と衝突。controller が距離と衝突を所有する（アニメーションは移動量を持たない）。
// 地面は高さ 0 の平面 + 段差（platform）。壁は区画の外周、岩は円柱として扱う。
// v0.31.0: 段差は 0 より低くてもよい（里の下の段・階段。その場所の地面は、重なる段差のうち最も高いもの、無ければ 0）。
// stepDown のある区画では、それより深く下る所も壁（段の縁から落ちない）。
// 外周は、四角（bounds）か、自然な形の多角形（shape。v0.20.0。src/game/areaShape.ts）。
import { clamp, type V3 } from '../core/math';
import type { SeededRng } from '../core/seededRng';
import type { MapDef } from '../data/schemas';
import { AreaShape, NavGraph, type Pt } from './areaShape';

export interface Circle {
  x: number;
  z: number;
  r: number;
}

/** 1 つのエリアの形（MapDef と FieldAreaDef の共通部分） */
export interface AreaGeom {
  /** 外周を囲む四角。shape が無ければ、これが外周 */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  stepUp: number;
  /** 一歩で下りられる高さ（m。v0.31.0）。これより深く下る所は壁。無ければ、どこまでも下りられる（落ちる） */
  stepDown?: number;
  /** 岩・建物・人の当たり（円柱）。h は上の端の高さ、y は下の端（無ければ 0。カメラだけが使う） */
  rocks: { x: number; z: number; r: number; h: number; y?: number }[];
  /** 段差。h は上の面の高さ（0 より低くてもよい）。look は描き方だけ（simulation は読まない） */
  platforms: { minX: number; maxX: number; minZ: number; maxZ: number; h: number; look?: 'yard' | 'stone' }[];
  /** 歩ける範囲の外周（v0.20.0。自然な形のエリア）。[x, z] の点の列。無ければ bounds の四角 */
  shape?: Pt[];
  /** 道しるべ（v0.20.0）。外周に遮られて目当てが見えない時に、ここを伝って歩く */
  nav?: Pt[];
  /** エリアの中心（必ず歩ける所。出てくる所・寝床の目安）。無ければ bounds の中央 */
  center?: { x: number; z: number };
}

/** 段のある区画（stepDown）で、体の半径の先に空ける余り（m）。柵は縁の上（縁から 0.07m）に立つので、それより広く */
export const EDGE_GAP = 0.12;

/** steerTo が、求めた点を使い回す回数（1 tick に 1 回呼ぶなら、およそ 1/3 秒） */
const STEER_REUSE = 20;

/** 自然な形のエリアの、前もって作った外周と道しるべ */
export interface AreaGeo {
  shape: AreaShape;
  nav: NavGraph | null;
}

/**
 * 段差の並びから、その場所の地面の高さ: 重なる段差のうち最も高いもの。どれにも重ならなければ 0。
 * v0.31.0 から、段差は 0 より低くてもよい（里の下の段と階段）。描画の側も、同じ計算で床の高さを決める。
 */
export function groundAt(platforms: readonly { minX: number; maxX: number; minZ: number; maxZ: number; h: number }[], x: number, z: number): number {
  let h = -Infinity;
  for (const p of platforms) {
    if (x >= p.minX && x <= p.maxX && z >= p.minZ && z <= p.maxZ && p.h > h) h = p.h;
  }
  return h === -Infinity ? 0 : h;
}

export class World {
  /** エリアに分ける前の狩場（フィールドでは、それにあたるエリアと同じ形） */
  readonly map: MapDef;
  /** エリア。フィールドでなければ、map の 1 つだけ。エリアどうしは離れていて、重ならない */
  readonly areas: readonly AreaGeom[];
  /** 力尽きた後に戻る場所 */
  spawn: { x: number; z: number; yaw: number };

  /** 自然な形のエリアの外周と道しるべ（四角のエリアは null） */
  private readonly geos = new Map<AreaGeom, AreaGeo | null>();

  constructor(map: MapDef, areas?: readonly AreaGeom[]) {
    this.map = map;
    this.areas = areas && areas.length > 0 ? areas : [map];
    this.spawn = map.spawn;
    for (const a of this.areas) this.geo(a);
  }

  /** 自然な形のエリアなら、外周と道しるべ。四角のエリアなら null */
  geo(area: AreaGeom): AreaGeo | null {
    let g = this.geos.get(area);
    if (g === undefined) {
      if (area.shape && area.shape.length >= 3) {
        const shape = new AreaShape(area.shape);
        g = { shape, nav: area.nav && area.nav.length > 0 ? new NavGraph(shape, area.nav) : null };
      } else g = null;
      this.geos.set(area, g);
    }
    return g;
  }

  /** (x, z) が、外周から margin 以上内側にある */
  inArea(area: AreaGeom, x: number, z: number, margin = 0): boolean {
    const g = this.geo(area);
    if (g) return g.shape.signedDistance(x, z) >= margin;
    const b = area.bounds;
    return x >= b.minX + margin && x <= b.maxX - margin && z >= b.minZ + margin && z <= b.maxZ - margin;
  }

  /** 外周までの距離（中なら正）。自然な形のエリアでは、8m より遠い所は 8m */
  wallDistance(area: AreaGeom, x: number, z: number): number {
    const g = this.geo(area);
    if (g) return g.shape.signedDistance(x, z);
    const b = area.bounds;
    return Math.min(x - b.minX, b.maxX - x, z - b.minZ, b.maxZ - z);
  }

  /** (x, z) を、外周から inset 以上内側へ寄せた点 */
  clampPoint(area: AreaGeom, x: number, z: number, inset: number): { x: number; z: number } {
    const g = this.geo(area);
    if (g) {
      const [px, pz] = g.shape.constrain(x, z, inset);
      return { x: px, z: pz };
    }
    const b = area.bounds;
    return { x: clamp(x, b.minX + inset, b.maxX - inset), z: clamp(z, b.minZ + inset, b.maxZ - inset) };
  }

  /** エリアの中心（必ず歩ける所） */
  centerOf(area: AreaGeom): { x: number; z: number } {
    if (area.center) return { x: area.center.x, z: area.center.z };
    const b = area.bounds;
    return { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 };
  }

  /**
   * (fx, fz) から (tx, tz) へ向かう時に、次に目指す点（半径 r の体で）。
   * 四角のエリアと、まっすぐ見える時は、目当てそのもの。自然な形のエリアで外周に遮られる時は、道しるべを伝う。
   * who（歩く者）を渡すと、求めた点を覚えておき、目当てがほとんど動かず、点に着いていない間は、STEER_REUSE 回まで使い回す
   * （見通しを調べるのは重いので。使い回す回数は呼んだ回数で数えるので、同じ入力なら、いつも同じ結果になる）。
   */
  steerTo(area: AreaGeom, fx: number, fz: number, tx: number, tz: number, r: number, who?: object): { x: number; z: number } {
    const g = this.geo(area);
    if (!g?.nav) return { x: tx, z: tz };
    if (who) {
      const c = this.steerCache.get(who);
      if (c && c.area === area && c.uses < STEER_REUSE && Math.hypot(c.tx - tx, c.tz - tz) < 1 && Math.hypot(c.x - fx, c.z - fz) > 1.5) {
        c.uses++;
        return { x: c.x, z: c.z };
      }
      const p = g.nav.next(fx, fz, tx, tz, r);
      this.steerCache.set(who, { area, tx, tz, x: p.x, z: p.z, uses: 0 });
      return p;
    }
    return g.nav.next(fx, fz, tx, tz, r);
  }

  /** steerTo が覚えておく、歩く者ごとの、次に目指す点 */
  private readonly steerCache = new WeakMap<object, { area: AreaGeom; tx: number; tz: number; x: number; z: number; uses: number }>();

  /** 自然な形のエリアの中の、外周から inset 以上離れた点を、乱数で 1 つ（20 回試して無ければ中心） */
  randomPoint(area: AreaGeom, rng: SeededRng, inset: number): { x: number; z: number } {
    const b = area.bounds;
    for (let i = 0; i < 20; i++) {
      const x = b.minX + rng.next() * (b.maxX - b.minX), z = b.minZ + rng.next() * (b.maxZ - b.minZ);
      if (this.inArea(area, x, z, inset)) return { x, z };
    }
    return this.centerOf(area);
  }

  /** その位置のエリア。どのエリアの中でもなければ、いちばん近いエリア */
  areaAt(x: number, z: number): AreaGeom {
    if (this.areas.length === 1) return this.areas[0]!;
    let best = this.areas[0]!;
    let bestD = Infinity;
    for (const a of this.areas) {
      const b = a.bounds;
      const dx = Math.max(b.minX - x, 0, x - b.maxX), dz = Math.max(b.minZ - z, 0, z - b.maxZ);
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = a;
        if (d === 0) break;
      }
    }
    return best;
  }

  /** その場所の地面の高さ（groundAt） */
  groundHeight(x: number, z: number): number {
    return groundAt(this.areaAt(x, z).platforms, x, z);
  }

  /**
   * (x, z) へ立てるか: 上りは stepUp まで。
   * stepDown のある区画（里。v0.31.0）では、いまの地面から stepDown より深い下りも壁。さらに、進む向きへ「体の半径 + EDGE_GAP」先の床も
   * 同じ決まりで見る（体が段の縁・柵・段の壁にかからない所で止まる）。stepDown の無い区画（狩場）は、これまでどおり中心だけを見る。
   */
  private canStand(pos: V3, x: number, z: number, radius = 0): boolean {
    const area = this.areaAt(pos.x, pos.z);
    const h = this.groundHeight(x, z);
    if (h - pos.y > area.stepUp + 1e-6) return false;
    if (area.stepDown === undefined) return true;
    const here = this.groundHeight(pos.x, pos.z);
    if (here - h > area.stepDown + 1e-6) return false;
    const dx = x - pos.x, dz = z - pos.z, d = Math.hypot(dx, dz);
    if (d < 1e-9) return true;
    const reach = radius + EDGE_GAP;
    const g = this.groundHeight(x + (dx / d) * reach, z + (dz / d) * reach);
    return g - pos.y <= area.stepUp + 1e-6 && here - g <= area.stepDown + 1e-6;
  }

  /** 半径 radius のキャラクターを (dx, dz) だけ動かす。壁・岩・高い段差は抜けない。 */
  move(pos: V3, radius: number, dx: number, dz: number, others: readonly Circle[] = []): void {
    const area = this.areaAt(pos.x, pos.z);
    const g = this.geo(area);
    const b = area.bounds;
    // 外周の中へ: 四角なら軸ごとに、自然な形なら、縁のいちばん近い点から内側へ
    const keepIn = (x: number, z: number): [number, number] =>
      g ? g.shape.constrain(x, z, radius) : [clamp(x, b.minX + radius, b.maxX - radius), clamp(z, b.minZ + radius, b.maxZ - radius)];
    let [nx, nz] = keepIn(pos.x + dx, pos.z + dz);

    // 岩や大型の胴体から押し出す
    for (let pass = 0; pass < 2; pass++) {
      for (const c of area.rocks) [nx, nz] = pushOut(nx, nz, radius, c.x, c.z, c.r);
      for (const c of others) [nx, nz] = pushOut(nx, nz, radius, c.x, c.z, c.r);
    }
    [nx, nz] = keepIn(nx, nz);

    // 登れない高さの段差は壁として扱い、軸ごとに滑らせる
    if (!this.canStand(pos, nx, nz, radius)) {
      if (this.canStand(pos, nx, pos.z, radius)) nz = pos.z;
      else if (this.canStand(pos, pos.x, nz, radius)) nx = pos.x;
      else return;
    }
    pos.x = nx;
    pos.z = nz;
    const h = this.groundHeight(nx, nz);
    if (h > pos.y) pos.y = h;
  }

  /** 重力。接地していれば true。 */
  settle(pos: V3, vel: { vy: number }, gravity: number, dt: number): boolean {
    const h = this.groundHeight(pos.x, pos.z);
    if (pos.y <= h + 1e-6) {
      pos.y = h;
      vel.vy = 0;
      return true;
    }
    vel.vy -= gravity * dt;
    pos.y += vel.vy * dt;
    if (pos.y <= h) {
      pos.y = h;
      vel.vy = 0;
      return true;
    }
    return false;
  }
}

function pushOut(x: number, z: number, radius: number, cx: number, cz: number, cr: number): [number, number] {
  const dx = x - cx;
  const dz = z - cz;
  const min = radius + cr;
  const d2 = dx * dx + dz * dz;
  if (d2 >= min * min) return [x, z];
  const d = Math.sqrt(d2);
  if (d < 1e-6) return [cx + min, z];
  return [cx + (dx / d) * min, cz + (dz / d) * min];
}
