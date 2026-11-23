// 木の板の盾（護刃の盾・長尖槍の大盾）の仮モデルの組み方。設定図の外形（角の点）から、前へ丸くふくらむ板を作り、
// 表には表の図、裏には裏の図を貼る。
// 裏の図は、取っ手が持ち手の左・革帯が右に描かれていて、そのままでは右腕用の並びになる。左腕に通して握れるように、
// 裏だけ左右を逆にして使う（取っ手が持ち手の右 = 体の中心側、革帯が左 = ひじ側。D-054）。
// 原点は裏面の中央（腕を当てる所）、+Z が表（敵の方）、+Y が上、+X は表から見て右。
// 裏の取っ手（縦の棒）と革帯（縦に渡した弧）も、裏の図の位置に形として作る。色は裏の図から取る。
import { Group } from 'three';
import { ArtMesh, type ArtSheet, type ArtStatus, type P3 } from './artMesh';
import type { WeaponModel } from './heavyBlade';

export interface ShieldDims {
  /** 中央が前へ出る量 / 板と縁の厚み */
  bulge: number;
  thick: number;
  /** 設定図での半幅・半高（ふくらみの計算に使う） */
  halfW: number;
  halfH: number;
  /** 幅の補正（設定図の幅 × この値。指定の幅に合わせる時に使う。絵の位置は変えない） */
  xScale?: number;
  /** 裏の取っ手と革帯。x は持ち手から見て左が +（表から見て右）。y0 が上の端、y1 が下の端。 */
  handle?: { x: number; y0: number; y1: number; r: number; off: number };
  strap?: { x: number; y0: number; y1: number; w: number; off: number };
}

export function buildPlankShield(name: string, frontSheet: ArtSheet, backSheet: ArtSheet, outline: readonly (readonly [number, number])[], d: ShieldDims): WeaponModel {
  const RINGS = 6, STEP = 0.03;
  const front = new ArtMesh(frontSheet, 'xy');
  const back = new ArtMesh(backSheet, 'xy');
  const k = d.xScale ?? 1;
  front.transform = back.transform = (p) => [p[0] * k, p[1], p[2]];
  // 外形の辺を細かく分ける
  const rim: [number, number][] = [];
  const n = outline.length;
  for (let i = 0; i < n; i++) {
    const p = outline[i]!, q = outline[(i + 1) % n]!;
    const parts = Math.max(1, Math.round(Math.hypot(q[0] - p[0], q[1] - p[1]) / STEP));
    for (let j = 0; j < parts; j++) rim.push([p[0] + ((q[0] - p[0]) * j) / parts, p[1] + ((q[1] - p[1]) * j) / parts]);
  }
  // ふくらみ: 中央がいちばん前。上下・左右の端で 3/4 ほど下がる
  const dome = (x: number, y: number): number => d.bulge * (1 - 0.75 * ((x / d.halfW) ** 2 + (y / d.halfH) ** 2));
  const zFront = (x: number, y: number): number => d.thick + dome(x, y) - d.bulge;
  const zBack = (x: number, y: number): number => zFront(x, y) - d.thick;
  const at = (p: readonly [number, number], ring: number, z: (x: number, y: number) => number): P3 => {
    const x = (p[0] * ring) / RINGS, y = (p[1] * ring) / RINGS;
    return [x, y, z(x, y)];
  };
  for (let i = 0; i < rim.length; i++) {
    const p = rim[i]!, q = rim[(i + 1) % rim.length]!;
    for (let ring = 0; ring < RINGS; ring++) {
      if (ring === 0) {
        front.tri(at(p, 0, zFront), at(p, 1, zFront), at(q, 1, zFront));
        back.tri(at(p, 0, zBack), at(q, 1, zBack), at(p, 1, zBack));
      } else {
        front.quad(at(p, ring, zFront), at(p, ring + 1, zFront), at(q, ring + 1, zFront), at(q, ring, zFront));
        back.quad(at(p, ring, zBack), at(q, ring, zBack), at(q, ring + 1, zBack), at(p, ring + 1, zBack));
      }
    }
    // 縁の側面。色は、表の図の縁（鉄）の少し内側から取る
    const a = at(p, RINGS, zFront), b = at(q, RINGS, zFront), c = at(q, RINGS, zBack), e = at(p, RINGS, zBack);
    const ua = front.planar([p[0] * 0.96, p[1] * 0.96, 0]), ub = front.planar([q[0] * 0.96, q[1] * 0.96, 0]);
    front.quad(a, b, c, e, [ua, ub, ub, ua]);
  }
  // 取っ手: 板から off だけ浮いた縦の棒（八角）と、上下の留め金
  if (d.handle) {
    const h = d.handle;
    const zc = (y: number): number => zBack(h.x, y) - h.off;
    const ring = (y: number, i: number): P3 => {
      const a = (Math.PI * 2 * i) / 8;
      return [h.x + h.r * Math.cos(a), y, zc(y) + h.r * Math.sin(a)];
    };
    for (let i = 0; i < 8; i++) back.quad(ring(h.y1, i), ring(h.y1, i + 1), ring(h.y0, i + 1), ring(h.y0, i));
    for (const y of [h.y0, h.y1]) back.box(h.x - h.r * 1.3, h.x + h.r * 1.3, y - h.r, y + h.r, zc(y) - h.r, zBack(h.x, y));
  }
  // 革帯: 上下の 2 点で板に留め、あいだが板から離れる弧（腕を横から通す）
  if (d.strap) {
    const s = d.strap, N = 10;
    const at2 = (x: number, k: number): P3 => {
      const y = s.y0 + ((s.y1 - s.y0) * k) / N;
      return [x, y, zBack(x, y) - 0.004 - s.off * Math.sin((Math.PI * k) / N)];
    };
    for (let k = 0; k < N; k++) back.quad(at2(s.x - s.w / 2, k), at2(s.x + s.w / 2, k), at2(s.x + s.w / 2, k + 1), at2(s.x - s.w / 2, k + 1));
  }
  const art: ArtStatus[] = [];
  const group = new Group();
  group.name = name;
  group.add(front.build(`${name}.front`, art), back.build(`${name}.back`, art));
  return { group, art, triangles: front.triangles + back.triangles };
}
