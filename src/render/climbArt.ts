// 登れる壁の目印（v0.44.0。#19 の H07）: 登攀の壁の面に、蔦（つた）を描いた板を貼る。見た目は仮素材（設定図は無い）。
// 絵は計算で作る（DataTexture。画面の無い Node の検査でも同じ）。simulation の値は読むだけ。

import { DataTexture, Group, Mesh, MeshLambertMaterial, PlaneGeometry, RGBAFormat, SRGBColorSpace, UnsignedByteType } from 'three';
import { SeededRng } from '../core/seededRng';
import type { ClimbDef } from '../data/schemas';

const W = 64, H = 128;
let shared: DataTexture | null = null;

/** 蔦の絵（縦に這う茎 5 本と、葉）。背景は透明 */
function ivyTexture(): DataTexture {
  if (shared) return shared;
  const rng = new SeededRng(4417);
  const d = new Uint8Array(W * H * 4);
  const put = (x: number, y: number, r: number, g: number, b: number): void => {
    const xi = ((Math.round(x) % W) + W) % W, yi = Math.round(y);
    if (yi < 0 || yi >= H) return;
    const i = (yi * W + xi) * 4;
    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;
    d[i + 3] = 255;
  };
  for (let v = 0; v < 5; v++) {
    const x0 = 6 + v * 12 + rng.next() * 4;
    const amp = 2 + rng.next() * 3, freq = 0.05 + rng.next() * 0.04, ph = rng.next() * 6;
    for (let y = 0; y < H; y++) {
      const x = x0 + Math.sin(y * freq + ph) * amp;
      put(x, y, 58, 70, 38);
      put(x + 1, y, 50, 62, 32);
      // 葉: ときどき、茎の左右に小さな楕円
      if (rng.next() < 0.16) {
        const side = rng.next() < 0.5 ? -1 : 1;
        const g = 92 + Math.floor(rng.next() * 50);
        for (let a = -2; a <= 2; a++) for (let b = -1; b <= 1; b++) if (a * a + b * b * 3 <= 5) put(x + side * (3 + a), y + b, 52 + Math.floor(rng.next() * 18), g, 40);
      }
    }
  }
  const t = new DataTexture(d, W, H, RGBAFormat, UnsignedByteType);
  t.colorSpace = SRGBColorSpace;
  t.flipY = false;
  t.needsUpdate = true;
  shared = t;
  return t;
}

/**
 * 登攀の壁の面に、蔦の板を貼る。板は壁の面の手前に立て、上ほど奥へ少し傾ける（棚の横の面は、下ほど外へ広がるので）。
 * ground は登り口の地面の高さを返す
 */
export function buildClimbFaces(climbs: readonly ClimbDef[], ground: (x: number, z: number) => number): Group {
  const g = new Group();
  g.name = 'climb-faces';
  const mat = new MeshLambertMaterial({ map: ivyTexture(), alphaTest: 0.5 });
  for (const c of climbs) {
    const base = ground(c.x, c.z);
    const h = c.top - base;
    const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
    const geo = new PlaneGeometry(c.width, h + 0.3);
    const m = new Mesh(geo, mat);
    // 板の向き: 表（+Z）を登る人の方（−f）へ。上が壁の奥へ 5° ほど
    m.rotation.set(-0.085, c.yaw + Math.PI, 0, 'YXZ');
    const off = 0.04;
    m.position.set(c.x + fx * (c.faceDist - off), base + h / 2 - 0.05, c.z + fz * (c.faceDist - off));
    m.userData.climbId = c.id;
    m.receiveShadow = true;
    g.add(m);
  }
  return g;
}
