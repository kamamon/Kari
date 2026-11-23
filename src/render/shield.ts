// 木の板の盾（護刃の盾・長尖槍の大盾）の仮モデルの組み方。設定図の外形（角の点）から、前へ丸くふくらむ板を作り、
// 表には表の図、裏には裏の図（後ろから見た図なので左右を反転）を貼る。
// 原点は裏面の中央（腕を当てる所）、+Z が表（敵の方）、+Y が上、+X は表から見て右。
// 裏の取っ手と革帯は、まだ絵だけ（立体にしていない）。
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
}

export function buildPlankShield(name: string, frontSheet: ArtSheet, backSheet: ArtSheet, outline: readonly (readonly [number, number])[], d: ShieldDims): WeaponModel {
  const RINGS = 6, STEP = 0.03;
  const front = new ArtMesh(frontSheet, 'xy');
  const back = new ArtMesh(backSheet, 'xy-back');
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
  const art: ArtStatus[] = [];
  const group = new Group();
  group.name = name;
  group.add(front.build(`${name}.front`, art), back.build(`${name}.back`, art));
  return { group, art, triangles: front.triangles + back.triangles };
}
