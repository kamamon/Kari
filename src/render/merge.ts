// 同じ素材の動かないメッシュを 1 つにまとめて、描画回数を減らす。
// group の下を調べ、userData.dynamic を付けた子（別に動かす・表示を切り替える部分）の中には入らない。
import { Matrix4, Mesh, type Material, type Object3D } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function mergeByMaterial(group: Object3D): void {
  group.updateMatrixWorld(true);
  const inverse = new Matrix4().copy(group.matrixWorld).invert();
  const buckets = new Map<Material, Mesh[]>();
  const visit = (o: Object3D): void => {
    for (const child of o.children) {
      if (child.userData.dynamic) continue;
      const mesh = child as Mesh;
      if (mesh.isMesh && !Array.isArray(mesh.material) && !(mesh as unknown as { isInstancedMesh?: boolean }).isInstancedMesh) {
        const list = buckets.get(mesh.material) ?? [];
        list.push(mesh);
        buckets.set(mesh.material, list);
      }
      visit(child);
    }
  };
  visit(group);
  for (const [material, meshes] of buckets) {
    if (meshes.length < 2) continue;
    const geos = meshes.map((m) => {
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      g.applyMatrix4(new Matrix4().multiplyMatrices(inverse, m.matrixWorld));
      for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
      return g;
    });
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!merged) continue;
    const out = new Mesh(merged, material);
    out.castShadow = meshes.some((m) => m.castShadow);
    out.receiveShadow = meshes.some((m) => m.receiveShadow);
    for (const m of meshes) {
      m.removeFromParent();
      m.geometry.dispose();
    }
    group.add(out);
  }
}
