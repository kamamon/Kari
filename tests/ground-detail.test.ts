// 狩場の地面の作り込み（v0.74.0。docs/spec.md の 21.4）: 踏み分け道と、崖・岩・段の際の陰。描画だけ（当たり・移動は変えない）。
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { InstancedMesh, Matrix4, type Mesh, type MeshLambertMaterial, Vector3 } from 'three';
import { AreaShape } from '../src/game/areaShape';
import { buildAreaGroup } from '../src/render/arena';
import { landscapeProfile } from '../src/render/fieldLandscape';
import { MASK_MARGIN, MOUTH_HALF, buildGroundDetail, maskAt, type GroundDetail } from '../src/render/groundDetail';
import type { FieldAreaDef, FieldDef } from '../src/data/schemas';

const fields: FieldDef[] = readdirSync('public/data/fields').filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(`public/data/fields/${f}`, 'utf8')) as FieldDef);
const basin = fields.find((f) => f.id === 'field.basin')!;
const detailOf = (a: FieldAreaDef): GroundDetail =>
  buildGroundDetail({ bounds: a.bounds, shape: a.shape, exits: a.exits, center: a.center, rocks: a.rocks, platforms: a.platforms, kind: a.kind, seed: 9001 + a.no * 131 });
const all = (): { f: FieldDef; a: FieldAreaDef }[] => fields.flatMap((f) => f.areas.map((a) => ({ f, a })));

describe('狩場の地面の作り込み（踏み分け道と際の陰）', () => {
  it('20 の狩場のどのエリアでも、出口ごとに道が 1 本。出口の外から始まり、出口を通り、1m おきの点でつながっている', () => {
    expect(fields.length).toBe(20);
    let n = 0;
    for (const { f, a } of all()) {
      const d = detailOf(a), tag = `${f.id} ${a.id}`;
      expect(d.trails.length, tag).toBe(a.exits.length);
      a.exits.forEach((e, i) => {
        const t = d.trails[i]!;
        expect(t[0]!.s, tag).toBeLessThan(-4);
        const at = t.reduce((m, p) => Math.min(m, Math.hypot(p.x - e.x, p.z - e.z)), 99);
        expect(at, tag).toBeLessThan(0.6);
        for (let k = 1; k < t.length; k++) expect(Math.hypot(t[k]!.x - t[k - 1]!.x, t[k]!.z - t[k - 1]!.z), tag).toBeLessThan(1.05);
        // 出口の口は広く濃い。道のりは、奥へ行くほど増える
        expect(d.trailAt(e.x, e.z), tag).toBeGreaterThan(0.9);
        for (let k = 1; k < t.length; k++) expect(t[k]!.s, tag).toBeGreaterThan(t[k - 1]!.s);
        n++;
      });
    }
    expect(n).toBeGreaterThan(400);
  });

  it('道は、岩（面から 0.8m 以上）と段をよけ、外周の中を通る。まっすぐ結んだ長さの 1.5 倍より長くならない', () => {
    for (const { f, a } of all()) {
      const d = detailOf(a), o = new AreaShape(a.shape!), tag = `${f.id} ${a.id}`;
      a.exits.forEach((e, i) => {
        const t = d.trails[i]!;
        const inner = t.filter((p) => p.s > 3 && p.k > 0.05);
        for (const p of inner) {
          for (const r of a.rocks) expect(Math.hypot(p.x - r.x, p.z - r.z) - r.r, tag).toBeGreaterThan(0.8);
          for (const q of a.platforms) if (q.h > 0.05) expect(p.x > q.minX - 0.4 && p.x < q.maxX + 0.4 && p.z > q.minZ - 0.4 && p.z < q.maxZ + 0.4, tag).toBe(false);
          expect(o.signedDistance(p.x, p.z), tag).toBeGreaterThan(0.5);
        }
        const last = t[t.length - 1]!;
        expect(last.s, tag).toBeLessThan((Math.hypot(d.hub.x - e.x, d.hub.z - e.z) + 0.5) * 1.5);
      });
    }
  });

  it('通り道のエリアは道が真ん中でつながる。狩りのエリア・巣・野営地は、真ん中の手前で薄れて消える', () => {
    for (const a of basin.areas) {
      const d = detailOf(a);
      if (a.kind === 'path') {
        expect(d.trailAt(d.hub.x, d.hub.z), a.id).toBeGreaterThan(0.5);
        for (const t of d.trails) expect(t[t.length - 1]!.k, a.id).toBeGreaterThan(0.5);
      } else {
        expect(d.trailAt(d.hub.x, d.hub.z), a.id).toBeLessThan(0.01);
        for (const t of d.trails) {
          expect(t[t.length - 1]!.k, a.id).toBe(0);
          // それでも、出口から 10m は濃い道
          for (const p of t) if (p.s >= 0 && p.s <= 10) expect(p.k, a.id).toBeGreaterThan(0.85);
        }
      }
    }
    expect(basin.areas.filter((a) => a.kind === 'path').length).toBe(3);
  });

  it('道の幅: 出口の口は半分の幅 2.3m、奥は 0.8〜1.4m。道の外（中心から 4.5m）には、道が無い', () => {
    const a3 = basin.areas.find((a) => a.id === 'a3')!, d = detailOf(a3);
    for (const t of d.trails) {
      const gate = t.find((p) => Math.abs(p.s) < 0.51)!;
      expect(gate.w).toBeCloseTo(MOUTH_HALF, 1);
      for (const p of t) if (p.s > 14) { expect(p.w).toBeGreaterThan(0.8); expect(p.w).toBeLessThan(1.4); }
      // 道に直交する向きへ 4.5m
      for (let k = 1; k + 1 < t.length; k += 5) {
        const p = t[k]!, q = t[k + 1]!, l = Math.hypot(q.x - p.x, q.z - p.z), nx = -(q.z - p.z) / l, nz = (q.x - p.x) / l;
        if (p.s < 12 || p.k < 0.3) continue;
        // ほかの道・円が近い所は除く
        const x = p.x + nx * 4.5, z = p.z + nz * 4.5;
        const others = d.trails.filter((u) => u !== t).some((u) => u.some((v) => Math.hypot(v.x - x, v.z - z) < 4));
        if (!others) expect(d.trailAt(x, z)).toBe(0);
        expect(d.trailAt(p.x, p.z)).toBeGreaterThan(p.k * 0.95);
      }
    }
  });

  it('際の陰: 崖の根元と岩の際は暗く、開けた地面と出口の口は暗くしない', () => {
    for (const a of basin.areas) {
      const d = detailOf(a), o = new AreaShape(a.shape!);
      // 出口
      for (const e of a.exits) expect(d.shadeAt(e.x, e.z), a.id).toBeLessThan(0.05);
      // 岩の際（面から 0.2m）。ほかの岩・段・崖が近くても、暗い
      for (const r of a.rocks) expect(d.shadeAt(r.x + r.r + 0.2, r.z), a.id).toBeGreaterThan(0.5);
      // 外周の点から 0.4m 内（出口から 8m 以上）は暗く、6m 内（岩・段から離れた所）は暗くない
      let edge = 0, open = 0;
      a.shape!.forEach(([x, z], i) => {
        if (i % 7 !== 0 || a.exits.some((e) => Math.hypot(e.x - x, e.z - z) < 8)) return;
        const n = o.outwardAt(x, z), l = Math.hypot(n.x, n.z) || 1;
        const near = [x - (n.x / l) * 0.4, z - (n.z / l) * 0.4] as const, far = [x - (n.x / l) * 6, z - (n.z / l) * 6] as const;
        if (o.signedDistance(near[0], near[1]) > 0.2 && o.signedDistance(near[0], near[1]) < 0.6) { expect(d.shadeAt(near[0], near[1]), a.id).toBeGreaterThan(0.75); edge++; }
        const clear = o.signedDistance(far[0], far[1]) > 5 && !a.rocks.some((r) => Math.hypot(r.x - far[0], r.z - far[1]) < r.r + 2.2) && !a.platforms.some((q) => far[0] > q.minX - 1.5 && far[0] < q.maxX + 1.5 && far[1] > q.minZ - 1.5 && far[1] < q.maxZ + 1.5);
        if (clear) { expect(d.shadeAt(far[0], far[1]), a.id).toBe(0); open++; }
      });
      expect(edge, a.id).toBeGreaterThan(3);
      expect(open, a.id).toBeGreaterThan(1);
    }
  });

  it('地面の素材へ渡す絵: 1 辺 512 画素まで。外周の外 6m まで覆う。値は、計算した道と陰に合う。同じ入力なら同じ絵', () => {
    for (const { f, a } of all()) {
      const d = detailOf(a), m = d.mask, tag = `${f.id} ${a.id}`;
      expect(Math.max(m.width, m.height), tag).toBeLessThanOrEqual(512);
      expect(m.data.length, tag).toBe(m.width * m.height * 4);
      expect(m.minX, tag).toBeCloseTo(a.bounds.minX - MASK_MARGIN, 6);
      expect(m.sizeZ, tag).toBeCloseTo(a.bounds.maxZ - a.bounds.minZ + MASK_MARGIN * 2, 6);
    }
    for (const a of basin.areas) {
      const d = detailOf(a), m = d.mask, px = m.sizeX / m.width, pz = m.sizeZ / m.height;
      for (let j = 3; j < m.height; j += 17) for (let i = 2; i < m.width; i += 13) {
        const x = m.minX + (i + 0.5) * px, z = m.minZ + (j + 0.5) * pz, v = maskAt(m, x, z);
        expect(Math.abs(v.trail - d.trailAt(x, z)), a.id).toBeLessThan(0.006);
        // 陰は 1m のます目から伸ばすので、急に変わる所（岩の際）では少しずれる
        expect(Math.abs(v.shade - d.shadeAt(x, z)), a.id).toBeLessThan(0.3);
      }
      expect(Buffer.from(detailOf(a).mask.data).equals(Buffer.from(m.data)), a.id).toBe(true);
    }
  });

  it('エリアの見た目: 地面の板に絵の座標が付き、出口の踏み跡の板は置かない。道の上には草・小石・茂みが無い', () => {
    const sprites = (g: ReturnType<typeof buildAreaGroup>): { x: number; z: number }[] => {
      const out: { x: number; z: number }[] = [], m4 = new Matrix4(), v = new Vector3();
      g.updateMatrixWorld(true);
      g.traverse((o) => {
        const im = o as InstancedMesh;
        if (!im.isInstancedMesh || !((im.material as MeshLambertMaterial).alphaTest > 0)) return;
        for (let i = 0; i < im.count; i++) { im.getMatrixAt(i, m4); v.setFromMatrixPosition(m4).applyMatrix4(im.matrixWorld); out.push({ x: v.x, z: v.z }); }
      });
      return out;
    };
    for (const id of ['camp', 'a1', 'a3', 'a10']) {
      const a = basin.areas.find((x) => x.id === id)!, d = detailOf(a);
      const g = buildAreaGroup({ bounds: a.bounds, shape: a.shape, rocks: a.rocks, platforms: a.platforms, kind: a.kind, seed: 9001 + a.no * 131, climbs: a.climbs, relief: a.relief, groundTint: a.look?.ground, landscape: landscapeProfile(basin.id, a), center: a.center, camp: a.kind === 'camp' ? basin.camp : null, gates: a.exits.map((e) => ({ x: e.x, z: e.z, marker: true })) });
      let ground: Mesh | null = null, planes = 0;
      g.traverse((o) => { const m = o as Mesh; if (m.userData.ground) ground = m; if (m.name === 'gateTrail') planes++; });
      const uv = ground!.geometry.getAttribute('aMask');
      expect(uv.count, id).toBe(ground!.geometry.getAttribute('position').count);
      for (let i = 0; i < uv.count; i += 7) { expect(uv.getX(i), id).toBeGreaterThanOrEqual(-0.001); expect(uv.getX(i), id).toBeLessThanOrEqual(1.001); expect(uv.getY(i), id).toBeGreaterThanOrEqual(-0.001); expect(uv.getY(i), id).toBeLessThanOrEqual(1.001); }
      expect(planes, id).toBe(0);
      expect(g.userData.groundMask, id).toBeTruthy();
      const sp = sprites(g);
      expect(sp.length, id).toBeGreaterThan(id === 'a10' ? 20 : 150);
      for (const p of sp) expect(d.trailAt(p.x, p.z), id).toBeLessThanOrEqual(0.4);
    }
    // これまでの 1 つの狩場（?hunt=arena）と里は、これまでどおり（道と陰の絵を作らない）
    const legacy = buildAreaGroup({ bounds: { minX: -20, maxX: 20, minZ: -20, maxZ: 20 }, rocks: [], platforms: [], gates: [{ x: 0, z: -20 }] });
    expect(legacy.userData.groundMask).toBeUndefined();
    const arena = buildAreaGroup({ bounds: { minX: -20, maxX: 20, minZ: -20, maxZ: 20 }, rocks: [], platforms: [], gates: [{ x: 0, z: -20, marker: true }] });
    expect(arena.getObjectByName('gateTrail')).toBeTruthy();
  });
});
