// 移動曲線と武器軌道のサンプリング。simulation と描画の両方がここを通るので、判定と見た目が同じ値になる。
import { add, clamp, dot, fromArr, lerpV, norm, scale, type V3 } from '../core/math';
import type { CurveDef, ShapeTrackDef } from '../data/schemas';

function slerpDir(a: V3, b: V3, u: number): V3 {
  const d = clamp(dot(a, b), -1, 1);
  if (d > 0.9995) return norm(lerpV(a, b, u));
  const th = Math.acos(d);
  const s = Math.sin(th);
  if (s < 1e-6) return norm(lerpV(a, b, u));
  return add(scale(a, Math.sin((1 - u) * th) / s), scale(b, Math.sin(u * th) / s));
}

/** tick（小数可）での握り位置と向き。範囲外は端のキーで止める。 */
export function sampleTrack(tr: ShapeTrackDef, t: number): { grip: V3; dir: V3 } {
  const keys = tr.keys;
  const first = keys[0]!;
  const last = keys[keys.length - 1]!;
  if (t <= first.t) return { grip: fromArr(first.grip), dir: norm(fromArr(first.dir)) };
  if (t >= last.t) return { grip: fromArr(last.grip), dir: norm(fromArr(last.dir)) };
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1]!.t <= t) i++;
  const k0 = keys[i]!;
  const k1 = keys[i + 1]!;
  const u = (t - k0.t) / (k1.t - k0.t);
  return {
    grip: lerpV(fromArr(k0.grip), fromArr(k1.grip), u),
    dir: slerpDir(norm(fromArr(k0.dir)), norm(fromArr(k1.dir)), u),
  };
}

/** 判定カプセルの芯（ローカル座標の線分）。 */
export function trackSegment(tr: ShapeTrackDef, t: number): { a: V3; b: V3 } {
  const s = sampleTrack(tr, t);
  return { a: add(s.grip, scale(s.dir, tr.from)), b: add(s.grip, scale(s.dir, tr.to)) };
}

/** tick までの累積移動距離 (m)。 */
export function sampleCurve(c: CurveDef, t: number): number {
  const keys = c.keys;
  const first = keys[0]!;
  const last = keys[keys.length - 1]!;
  if (t <= first[0]) return first[1];
  if (t >= last[0]) return last[1];
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1]![0] <= t) i++;
  const k0 = keys[i]!;
  const k1 = keys[i + 1]!;
  return k0[1] + ((k1[1] - k0[1]) * (t - k0[0])) / (k1[0] - k0[0]);
}
