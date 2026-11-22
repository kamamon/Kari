// 検証表示: 攻撃判定と部位判定を画面へ重ねる。見えない範囲から当たる・破壊後も判定が残る等を目で確かめるためのもの。
import { BufferAttribute, BufferGeometry, DynamicDrawUsage, LineBasicMaterial, LineSegments, Scene } from 'three';
import type { V3 } from '../core/math';

const MAX_SEGMENTS = 4000;

export class DebugDraw {
  readonly lines: LineSegments;
  private pos = new Float32Array(MAX_SEGMENTS * 6);
  private col = new Float32Array(MAX_SEGMENTS * 6);
  private n = 0;

  constructor(scene: Scene) {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(this.pos, 3).setUsage(DynamicDrawUsage));
    geo.setAttribute('color', new BufferAttribute(this.col, 3).setUsage(DynamicDrawUsage));
    this.lines = new LineSegments(geo, new LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, fog: false }));
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 10;
    this.lines.visible = false;
    scene.add(this.lines);
  }

  begin(): void {
    this.n = 0;
  }

  line(a: V3, b: V3, color: [number, number, number]): void {
    if (this.n >= MAX_SEGMENTS) return;
    const o = this.n * 6;
    this.pos.set([a.x, a.y, a.z, b.x, b.y, b.z], o);
    this.col.set([...color, ...color], o);
    this.n++;
  }

  /** カプセル（b が null なら球）を輪で描く。 */
  capsule(a: V3, b: V3 | null, r: number, color: [number, number, number]): void {
    const end = b ?? a;
    const ax = { x: end.x - a.x, y: end.y - a.y, z: end.z - a.z };
    const l = Math.hypot(ax.x, ax.y, ax.z);
    // 軸に直交する 2 方向
    const n = l > 1e-6 ? { x: ax.x / l, y: ax.y / l, z: ax.z / l } : { x: 0, y: 1, z: 0 };
    const ref = Math.abs(n.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
    let u = { x: n.y * ref.z - n.z * ref.y, y: n.z * ref.x - n.x * ref.z, z: n.x * ref.y - n.y * ref.x };
    const ul = Math.hypot(u.x, u.y, u.z);
    u = { x: u.x / ul, y: u.y / ul, z: u.z / ul };
    const v = { x: n.y * u.z - n.z * u.y, y: n.z * u.x - n.x * u.z, z: n.x * u.y - n.y * u.x };
    const ring = (c: V3, p: V3, q: V3): void => {
      const N = 14;
      for (let i = 0; i < N; i++) {
        const t0 = (i / N) * Math.PI * 2;
        const t1 = ((i + 1) / N) * Math.PI * 2;
        this.line(
          { x: c.x + (p.x * Math.cos(t0) + q.x * Math.sin(t0)) * r, y: c.y + (p.y * Math.cos(t0) + q.y * Math.sin(t0)) * r, z: c.z + (p.z * Math.cos(t0) + q.z * Math.sin(t0)) * r },
          { x: c.x + (p.x * Math.cos(t1) + q.x * Math.sin(t1)) * r, y: c.y + (p.y * Math.cos(t1) + q.y * Math.sin(t1)) * r, z: c.z + (p.z * Math.cos(t1) + q.z * Math.sin(t1)) * r },
          color,
        );
      }
    };
    ring(a, u, v);
    ring(a, n, u);
    ring(a, n, v);
    if (b) {
      ring(b, u, v);
      ring(b, n, u);
      ring(b, n, v);
      for (const s of [u, v, { x: -u.x, y: -u.y, z: -u.z }, { x: -v.x, y: -v.y, z: -v.z }]) {
        this.line({ x: a.x + s.x * r, y: a.y + s.y * r, z: a.z + s.z * r }, { x: b.x + s.x * r, y: b.y + s.y * r, z: b.z + s.z * r }, color);
      }
    }
  }

  end(visible: boolean): void {
    this.lines.visible = visible && this.n > 0;
    const g = this.lines.geometry;
    g.setDrawRange(0, this.n * 2);
    (g.getAttribute('position') as BufferAttribute).needsUpdate = true;
    (g.getAttribute('color') as BufferAttribute).needsUpdate = true;
  }
}
