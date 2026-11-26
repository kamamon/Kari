// 仮のエフェクト: 刃の軌跡・火花・粉塵・地面の衝撃輪。simulation の出来事を受けて出すだけで、計算には関わらない。
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, DoubleSide, DynamicDrawUsage, Mesh, MeshBasicMaterial, NormalBlending, Points, PointsMaterial, RingGeometry, Scene, Vector3,
} from 'three';

const TRAIL_MAX = 18;

/** 刃の根元と刃先を結ぶ帯。trail_on の間だけ伸び、消える時は古い方から細る。 */
export class BladeTrail {
  readonly mesh: Mesh;
  private pos: Float32Array;
  private col: Float32Array;
  private pts: { a: Vector3; b: Vector3; life: number }[] = [];
  active = false;
  /** 双剣の猛り（v0.54.0）の間は、赤みのある軌跡にする（見た目だけ） */
  hot = false;

  constructor(scene: Scene) {
    const geo = new BufferGeometry();
    this.pos = new Float32Array(TRAIL_MAX * 2 * 3);
    this.col = new Float32Array(TRAIL_MAX * 2 * 3);
    geo.setAttribute('position', new BufferAttribute(this.pos, 3).setUsage(DynamicDrawUsage));
    geo.setAttribute('color', new BufferAttribute(this.col, 3).setUsage(DynamicDrawUsage));
    const idx: number[] = [];
    for (let i = 0; i < TRAIL_MAX - 1; i++) {
      const k = i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
    geo.setIndex(idx);
    this.mesh = new Mesh(geo, new MeshBasicMaterial({ vertexColors: true, blending: AdditiveBlending, transparent: true, depthWrite: false, side: DoubleSide, fog: false }));
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  update(dt: number, base: Vector3, tip: Vector3): void {
    if (this.active) {
      this.pts.unshift({ a: base.clone(), b: tip.clone(), life: 1 });
      if (this.pts.length > TRAIL_MAX) this.pts.pop();
    }
    for (const p of this.pts) p.life -= dt * (this.active ? 3.2 : 6);
    while (this.pts.length && this.pts[this.pts.length - 1]!.life <= 0) this.pts.pop();
    const n = this.pts.length;
    for (let i = 0; i < TRAIL_MAX; i++) {
      const p = this.pts[Math.min(i, n - 1)];
      const o = i * 6;
      if (!p || i >= n) {
        const last = this.pts[n - 1];
        for (let k = 0; k < 6; k++) this.pos[o + k] = last ? [last.a.x, last.a.y, last.a.z, last.b.x, last.b.y, last.b.z][k]! : 0;
        for (let k = 0; k < 6; k++) this.col[o + k] = 0;
        continue;
      }
      this.pos.set([p.a.x, p.a.y, p.a.z, p.b.x, p.b.y, p.b.z], o);
      const l = Math.max(0, p.life);
      if (this.hot) this.col.set([0.14 * l, 0.04 * l, 0.03 * l, 0.62 * l, 0.22 * l, 0.15 * l], o);
      else this.col.set([0.1 * l, 0.09 * l, 0.06 * l, 0.5 * l, 0.47 * l, 0.36 * l], o);
    }
    const g = this.mesh.geometry;
    (g.getAttribute('position') as BufferAttribute).needsUpdate = true;
    (g.getAttribute('color') as BufferAttribute).needsUpdate = true;
    g.setDrawRange(0, Math.max(0, n - 1) * 6);
  }
}

/** まとめて 1 回で描く粒子。sparks は加算、dust は通常合成。 */
export class Particles {
  readonly points: Points;
  private pos: Float32Array;
  private col: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private max: Float32Array;
  private base: Float32Array;
  private next = 0;

  constructor(scene: Scene, private count: number, size: number, additive: boolean, private gravity: number, private drag: number) {
    this.pos = new Float32Array(count * 3).fill(-9999);
    this.col = new Float32Array(count * 3);
    this.base = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.max = new Float32Array(count).fill(1);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(this.pos, 3).setUsage(DynamicDrawUsage));
    geo.setAttribute('color', new BufferAttribute(this.col, 3).setUsage(DynamicDrawUsage));
    this.points = new Points(
      geo,
      new PointsMaterial({ size, vertexColors: true, transparent: true, depthWrite: false, blending: additive ? AdditiveBlending : NormalBlending, sizeAttenuation: true, opacity: additive ? 1 : 0.5 }),
    );
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  emit(n: number, at: { x: number; y: number; z: number }, speed: number, up: number, life: number, color: [number, number, number], spread = 1): void {
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.count;
      const a = Math.random() * Math.PI * 2;
      const e = (Math.random() - 0.3) * spread;
      const s = speed * (0.4 + Math.random() * 0.8);
      this.pos.set([at.x, at.y, at.z], i * 3);
      this.vel.set([Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s + up, Math.sin(a) * Math.cos(e) * s], i * 3);
      this.base.set(color, i * 3);
      this.life[i] = this.max[i] = life * (0.6 + Math.random() * 0.7);
    }
  }

  /** 向きのある吹き出し（風圧・音圧・灰の幕など）。dir の向きへ speed で、spread の幅で散らす */
  emitDir(n: number, at: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, speed: number, spread: number, life: number, color: [number, number, number], jitter = 0): void {
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.count;
      const s = speed * (0.6 + Math.random() * 0.6);
      const j = (): number => (Math.random() - 0.5) * 2 * jitter;
      this.pos.set([at.x + j(), at.y + j() * 0.5, at.z + j()], i * 3);
      this.vel.set([dir.x * s + (Math.random() - 0.5) * spread, dir.y * s + (Math.random() - 0.3) * spread * 0.5, dir.z * s + (Math.random() - 0.5) * spread], i * 3);
      this.base.set(color, i * 3);
      this.life[i] = this.max[i] = life * (0.6 + Math.random() * 0.7);
    }
  }

  update(dt: number): void {
    const drag = Math.max(0, 1 - this.drag * dt);
    for (let i = 0; i < this.count; i++) {
      if (this.life[i]! <= 0) continue;
      this.life[i]! -= dt;
      const o = i * 3;
      if (this.life[i]! <= 0) {
        this.pos[o + 1] = -9999;
        continue;
      }
      this.vel[o + 1]! -= this.gravity * dt;
      this.vel[o]! *= drag;
      this.vel[o + 2]! *= drag;
      this.pos[o]! += this.vel[o]! * dt;
      this.pos[o + 1]! += this.vel[o + 1]! * dt;
      this.pos[o + 2]! += this.vel[o + 2]! * dt;
      if (this.pos[o + 1]! < 0.03) {
        this.pos[o + 1] = 0.03;
        this.vel[o + 1] = 0;
      }
      const f = this.life[i]! / this.max[i]!;
      this.col[o] = this.base[o]! * f;
      this.col[o + 1] = this.base[o + 1]! * f;
      this.col[o + 2] = this.base[o + 2]! * f;
    }
    const g = this.points.geometry;
    (g.getAttribute('position') as BufferAttribute).needsUpdate = true;
    (g.getAttribute('color') as BufferAttribute).needsUpdate = true;
  }
}

/** 地面に広がる輪（叩きつけの着地点など）。 */
export class GroundRings {
  private rings: { mesh: Mesh; life: number; max: number; size: number }[] = [];

  constructor(private scene: Scene) {}

  spawn(x: number, y: number, z: number, size: number, life: number, color: number): void {
    const mesh = new Mesh(new RingGeometry(0.82, 1, 28), new MeshBasicMaterial({ color, transparent: true, depthWrite: false, side: DoubleSide }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y + 0.05, z);
    this.scene.add(mesh);
    this.rings.push({ mesh, life, max: life, size });
  }

  update(dt: number): void {
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]!;
      r.life -= dt;
      const u = 1 - Math.max(0, r.life) / r.max;
      const s = r.size * (0.2 + 0.8 * Math.sqrt(u));
      r.mesh.scale.set(s, s, 1);
      (r.mesh.material as MeshBasicMaterial).opacity = (1 - u) * 0.7;
      if (r.life <= 0) {
        this.scene.remove(r.mesh);
        r.mesh.geometry.dispose();
        (r.mesh.material as MeshBasicMaterial).dispose();
        this.rings.splice(i, 1);
      }
    }
  }
}
