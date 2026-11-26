// 地面の起伏（v0.46.0。#19 の F02 の一切れ。docs/spec.md の 32.11）: エリアの床の高さの格子（cm の整数、step m おき）を、
// 双一次で引く。simulation（当たり・接地）と描画（地面の板・草・岩・崖の根元）が、同じこの関数で高さを決める。
// 格子の外は、いちばん近い縁の値（外周の外の崖の根元も、これで決まる）。無ければ 0（平ら）

/** 起伏の格子。h は z の行ごとに x の順（nx × nz）。単位は cm */
export interface ReliefDef {
  x0: number;
  z0: number;
  step: number;
  nx: number;
  nz: number;
  h: number[];
}

export function reliefAt(r: ReliefDef | null | undefined, x: number, z: number): number {
  if (!r) return 0;
  const fx = Math.min(Math.max((x - r.x0) / r.step, 0), r.nx - 1);
  const fz = Math.min(Math.max((z - r.z0) / r.step, 0), r.nz - 1);
  const i = Math.min(Math.floor(fx), r.nx - 2);
  const j = Math.min(Math.floor(fz), r.nz - 2);
  const u = fx - i, v = fz - j;
  const h = r.h, n = r.nx, k = j * n + i;
  const a = h[k]!, b = h[k + 1]!, c = h[k + n]!, d = h[k + n + 1]!;
  return ((a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v) / 100;
}
