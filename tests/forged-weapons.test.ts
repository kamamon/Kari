// 大槌・双剣・太刀（依頼 6 の設定図から作った形）: 依頼書の寸法になっているか、図の外を貼っていないか。
import { Box3, Mesh, Texture, TextureLoader, Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { buildLongBlade, buildTwinBlade, buildWarMaul, rowMap } from '../src/render/forgedWeapons';
import type { WeaponModel } from '../src/render/heavyBlade';

function build(f: () => WeaponModel): { model: WeaponModel; box: Box3; meshes: Mesh[] } {
  const mock = vi.spyOn(TextureLoader.prototype, 'load').mockImplementation(() => new Texture());
  try {
    const model = f();
    model.group.updateMatrixWorld(true);
    const meshes: Mesh[] = [];
    model.group.traverse((o) => o instanceof Mesh && meshes.push(o));
    return { model, box: new Box3().setFromObject(model.group), meshes };
  } finally {
    mock.mockRestore();
  }
}

/** 高さ y の水平な面で切った断面の、z の範囲（三角形の辺と面の交わりから） */
function slice(meshes: Mesh[], y: number): [number, number] {
  let lo = Infinity, hi = -Infinity;
  const a = new Vector3(), b = new Vector3();
  for (const m of meshes) {
    const p = m.geometry.getAttribute('position');
    for (let t = 0; t < p.count; t += 3) {
      for (const [i, j] of [[0, 1], [1, 2], [2, 0]] as const) {
        a.fromBufferAttribute(p, t + i);
        b.fromBufferAttribute(p, t + j);
        if ((a.y - y) * (b.y - y) > 0 || a.y === b.y) continue;
        const z = a.z + ((y - a.y) / (b.y - a.y)) * (b.z - a.z);
        lo = Math.min(lo, z);
        hi = Math.max(hi, z);
      }
    }
  }
  return [lo, hi];
}

/** 高さ y0〜y1 の頂点の、z の範囲 */
function zRange(meshes: Mesh[], y0: number, y1: number): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (const m of meshes) {
    const p = m.geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      if (y >= y0 && y <= y1) {
        lo = Math.min(lo, p.getZ(i));
        hi = Math.max(hi, p.getZ(i));
      }
    }
  }
  return [lo, hi];
}

function uvInside(meshes: Mesh[]): boolean {
  return meshes.every((m) => {
    const uv = m.geometry.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i), v = uv.getY(i);
      if (!(u >= -0.01 && u <= 1.01 && v >= -0.01 && v <= 1.01)) return false;
    }
    return true;
  });
}

describe('依頼 6 の武器の形（依頼書の寸法）', () => {
  it('図の行への写し方: 点を通り、間は直線、外は延長', () => {
    const f = rowMap([[0, 100], [1, 50], [2, 40]]);
    expect(f(0)).toBe(100);
    expect(f(0.5)).toBe(75);
    expect(f(1.5)).toBe(45);
    expect(f(3)).toBeCloseTo(30);
    expect(f(-1)).toBeCloseTo(150);
  });

  it('大槌: 全長 1.45m（-0.2〜1.25m）、頭は叩く面から反対まで 0.38m・厚み 0.20m（帯金と鋲を除く）・高さ 24cm', () => {
    const { model, box, meshes } = build(buildWarMaul);
    expect(box.min.y).toBeCloseTo(-0.2, 3);
    expect(box.max.y).toBeCloseTo(1.25, 2);
    const head = slice(meshes, 1.1);
    expect(head[0]).toBeCloseTo(-0.19, 3);
    expect(head[1]).toBeCloseTo(0.19, 3);
    const size = box.getSize(new Vector3());
    expect(size.x).toBeGreaterThan(0.2);
    expect(size.x).toBeLessThan(0.225); // 厚み 0.20m + 帯金 4mm + 鋲 6mm（両側）
    // 柄の太さ 4.5cm（握りの間）
    const shaft = slice(meshes, 0.25);
    expect(shaft[1] - shaft[0]).toBeCloseTo(0.045, 2); // 14 角の筒なので、向きで 1mm ほど細く見える
    expect(model.art.length).toBe(2); // 正面の図と真横の図
    expect(uvInside(meshes)).toBe(true);
  });

  it('双剣: 全長 0.70m（-0.08〜0.62m）、刃の幅 4.5cm、鍔の幅 8cm', () => {
    const { model, box, meshes } = build(buildTwinBlade);
    expect(box.min.y).toBeCloseTo(-0.08, 3);
    expect(box.max.y).toBeCloseTo(0.62, 3);
    const blade = slice(meshes, 0.35);
    expect(blade[1] - blade[0]).toBeCloseTo(0.045, 3);
    const guard = slice(meshes, 0.07);
    expect(guard[1] - guard[0]).toBeCloseTo(0.08, 3);
    // 切っ先は刃の側（-Z）がいちばん高い
    const tip = zRange(meshes, 0.619, 0.621);
    expect(tip[1]).toBeLessThan(-0.02);
    expect(model.art.length).toBe(1);
    expect(uvInside(meshes)).toBe(true);
  });

  it('太刀: 全長 1.47m（-0.27〜1.2m）、刃の幅 3.2cm、峰の側へ反り、切っ先は柄の線から約 4cm ずれる', () => {
    const { model, box, meshes } = build(buildLongBlade);
    expect(box.min.y).toBeCloseTo(-0.27, 3);
    expect(box.max.y).toBeGreaterThan(1.195);
    expect(box.max.y).toBeLessThan(1.205);
    const root = slice(meshes, 0.11);
    expect(root[1] - root[0]).toBeCloseTo(0.032, 2);
    const tip = zRange(meshes, box.max.y - 0.001, box.max.y + 0.001);
    expect(tip[0]).toBeGreaterThan(0.035);
    expect(tip[1]).toBeLessThan(0.045);
    // 反りは峰の側（+Z）: 刃の中ほどの中心は、根元より +Z
    const mid = slice(meshes, 0.7);
    expect((mid[0] + mid[1]) / 2).toBeGreaterThan((root[0] + root[1]) / 2 + 0.008);
    expect(model.art.length).toBe(1);
    expect(uvInside(meshes)).toBe(true);
  });
});
