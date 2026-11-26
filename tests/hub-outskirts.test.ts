// 外周の景観は表示だけ。既存の里の地形・施設を変更せず、山肌は全方向に広がる。
import { InstancedMesh, Mesh, MeshLambertMaterial } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Content, MapDef } from '../src/data/schemas';
import { buildHubOutskirts } from '../src/render/hubOutskirts';
import { buildHubGroup } from '../src/render/hubScene';
import { FOG_DENSITY, VILLAGE_FOG_DENSITY } from '../src/render/arena';
import { loadContent } from './helpers';

let content: Content, map: MapDef;
beforeAll(async () => { content = await loadContent(); map = content.maps.get(content.hub.mapId)!; });
describe('灯継ぎの里の山岳外周', () => {
  it('全周の山肌を作り、内側に面を作らず、正本データを書き換えない', () => {
    const before = JSON.stringify([map, content.hub]);
    const { group } = buildHubOutskirts(content.hub, map);
    const m = group.getObjectByName('mountain-terrain') as Mesh;
    expect(m).toBeInstanceOf(Mesh);
    const p = m.geometry.getAttribute('position'), ix = m.geometry.getIndex()!;
    const b = map.bounds;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      expect(Number.isFinite(x + y + z)).toBe(true);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    expect([minX < b.minX - 200, maxX > b.maxX + 200, minZ < b.minZ - 200, maxZ > b.maxZ + 200]).toEqual([true, true, true, true]);
    for (let i = 0; i < ix.count; i += 3) {
      const ids = [ix.getX(i), ix.getX(i + 1), ix.getX(i + 2)];
      const x = ids.reduce((s, j) => s + p.getX(j), 0) / 3, z = ids.reduce((s, j) => s + p.getZ(j), 0) / 3;
      expect(x <= b.minX || x >= b.maxX || z <= b.minZ || z >= b.maxZ).toBe(true);
    }
    expect(JSON.stringify([map, content.hub])).toBe(before);
    expect(group.userData.sceneryOnly).toBe(true);
    for (const s of group.userData.sites as { x: number; z: number; r: number }[]) {
      expect(Math.max(b.minX - s.x, s.x - b.maxX, b.minZ - s.z, s.z - b.maxZ)).toBeGreaterThanOrEqual(4);
    }
  });

  it('森林・外の建物・桟道・上下流を決められた量で描く。インスタンスは固定seed', () => {
    const a = buildHubOutskirts(content.hub, map), b = buildHubOutskirts(content.hub, map);
    const counts = a.group.userData.counts;
    expect(counts).toEqual(b.group.userData.counts);
    expect(counts.cedars).toBeGreaterThan(100);
    expect(counts.buildings).toBeGreaterThanOrEqual(3);
    expect(counts.bridges).toBe(1);
    expect(counts.rivers).toBe(2);
    const cedar = a.group.getObjectByName('mountain-cedars') as InstancedMesh;
    const cedar2 = b.group.getObjectByName('mountain-cedars') as InstancedMesh;
    expect(cedar).toBeInstanceOf(InstancedMesh);
    expect(cedar.instanceMatrix.array).toEqual(cedar2.instanceMatrix.array);
    let tris = 0, draws = 0;
    a.group.traverse((o) => {
      if (o instanceof Mesh) {
        tris += (o.geometry.index?.count ?? o.geometry.getAttribute('position').count) / 3 * (o instanceof InstancedMesh ? o.count : 1);
        draws++;
        expect(o.castShadow).toBe(false);
      }
    });
    expect(tris).toBeLessThan(42000);
    // 素材ごとの木・石・瓦・布・水・幹を別バッチに分けた。三角形の上限は維持。
    expect(draws).toBeLessThanOrEqual(14);
    expect(VILLAGE_FOG_DENSITY).toBeLessThan(FOG_DENSITY);
  });

  it('ゲーム本体の buildHubGroup から呼び出され、既存水車は1台。外の川は時刻で動く', () => {
    const { group, village } = buildHubGroup(content.hub, map);
    const outer = group.getObjectByName('hub-mountain-outskirts')!;
    expect(outer).toBeDefined();
    const water = outer.getObjectByName('outer-streams') as Mesh;
    const texture = (water.material as MeshLambertMaterial).map!;
    const offset = texture.offset.y;
    village.update(0.016, 1.5, { x: 0, y: 1.5, z: 0 }, 300);
    expect(texture.offset.y).not.toBe(offset);
    let wheels = 0; group.traverse((o) => { if (o.userData.wheel) wheels++; });
    expect(wheels).toBe(1);
  });
});
