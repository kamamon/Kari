// simulation 用の小さな数学ライブラリ。Three.js へ依存しない（Node のテストや将来のサーバーでも動かすため）。
// 座標系: 単位 m、Y が上、+Z が前。yaw=0 で +Z を向き、キャラクターの右手側は -X。

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export const v3 = (x = 0, y = 0, z = 0): V3 => ({ x, y, z });
export const fromArr = (a: readonly number[]): V3 => ({ x: a[0] ?? 0, y: a[1] ?? 0, z: a[2] ?? 0 });
export const add = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: V3, s: number): V3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const dot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const len = (a: V3): number => Math.sqrt(dot(a, a));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const lerpV = (a: V3, b: V3, t: number): V3 => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) });
export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export function norm(a: V3): V3 {
  const l = len(a);
  return l > 1e-9 ? scale(a, 1 / l) : { x: 0, y: 0, z: 1 };
}

/** ローカル座標を yaw だけ回して返す（Three.js の rotation.y と同じ向き）。 */
export function rotY(a: V3, yaw: number): V3 {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return { x: a.x * c + a.z * s, y: a.y, z: -a.x * s + a.z * c };
}

/** アクターのローカル座標 → ワールド座標。 */
export const toWorld = (local: V3, pos: V3, yaw: number): V3 => add(rotY(local, yaw), pos);

export const forwardOf = (yaw: number): V3 => ({ x: Math.sin(yaw), y: 0, z: Math.cos(yaw) });
export const yawOf = (x: number, z: number): number => Math.atan2(x, z);

export function wrapAngle(a: number): number {
  const TAU = Math.PI * 2;
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

export const angleDiff = (from: number, to: number): number => wrapAngle(to - from);

export function turnToward(from: number, to: number, maxStep: number): number {
  const d = angleDiff(from, to);
  if (Math.abs(d) <= maxStep) return wrapAngle(to);
  return wrapAngle(from + Math.sign(d) * maxStep);
}

export const DEG = Math.PI / 180;

/** 点 p と線分 ab の最短距離。 */
export function distPointSeg(p: V3, a: V3, b: V3): number {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 > 1e-12 ? clamp(dot(sub(p, a), ab) / l2, 0, 1) : 0;
  return len(sub(p, add(a, scale(ab, t))));
}

/** 線分 p1q1 と線分 p2q2 の最短距離（Ericson, Real-Time Collision Detection の方法）。 */
export function distSegSeg(p1: V3, q1: V3, p2: V3, q2: V3): number {
  const d1 = sub(q1, p1);
  const d2 = sub(q2, p2);
  const r = sub(p1, p2);
  const a = dot(d1, d1);
  const e = dot(d2, d2);
  const f = dot(d2, r);
  let s: number;
  let t: number;
  const EPS = 1e-12;
  if (a <= EPS && e <= EPS) return len(r);
  if (a <= EPS) {
    s = 0;
    t = clamp(f / e, 0, 1);
  } else {
    const c = dot(d1, r);
    if (e <= EPS) {
      t = 0;
      s = clamp(-c / a, 0, 1);
    } else {
      const b = dot(d1, d2);
      const denom = a * e - b * b;
      s = denom > EPS ? clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = clamp((b - c) / a, 0, 1);
      }
    }
  }
  const c1 = add(p1, scale(d1, s));
  const c2 = add(p2, scale(d2, t));
  return len(sub(c1, c2));
}

export const smoothstep = (t: number): number => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};
