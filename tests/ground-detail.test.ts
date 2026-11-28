// 狩場の地面の作り込み（v0.74.0。docs/spec.md の 21.4）: 踏み分け道と、崖・岩・段の際の陰。描画だけ（当たり・移動は変えない）。
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { InstancedMesh, Matrix4, type Mesh, type MeshLambertMaterial, Vector3 } from 'three';
import { AreaShape } from '../src/game/areaShape';
import { buildAreaGroup } from '../src/render/arena';
import { landscapeProfile } from '../src/render/fieldLandscape';
import { Color } from 'three';
import { GROUND_SHADE, MASK_MARGIN, MOUTH_HALF, TONE_COLORS, baseTone, buildGroundDetail, maskAt, toneTint, tuftTint, type GroundDetail } from '../src/render/groundDetail';
import { patchNoise } from '../src/render/noise';
import type { FieldAreaDef, FieldDef } from '../src/data/schemas';

const fields: FieldDef[] = readdirSync('public/data/fields').filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(`public/data/fields/${f}`, 'utf8')) as FieldDef);
const basin = fields.find((f) => f.id === 'field.basin')!;
const detailOf = (a: FieldAreaDef): GroundDetail =>
  buildGroundDetail({ bounds: a.bounds, shape: a.shape, exits: a.exits, center: a.center, rocks: a.rocks, platforms: a.platforms, kind: a.kind, seed: 9001 + a.no * 131 });
const all = (): { f: FieldDef; a: FieldAreaDef }[] => fields.flatMap((f) => f.areas.map((a) => ({ f, a })));

describe('狩場の地面の作り込み（踏み分け道と際の陰）', () => {
  it('どの狩場（21。盆地・白霧氷谷と、まだ遊べない 19）のどのエリアでも、出口ごとに道が 1 本。出口の外から始まり、出口を通り、1m おきの点でつながっている', { timeout: 30000 }, () => {
    expect(fields.length).toBe(21);
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

  // ---- v0.76.0: 色むらと、草のなじみ（D-176。docs/spec.md の 21.5）----
  it('色むら: 0〜1 のゆるい濃淡で、地面の濃淡（草がかたまる所）が大きい所ほど湿った側（小さい値）。崖・岩の際は、同じ濃淡でも湿った側へ寄る。絵の B に入る', () => {
    for (const id of ['a3', 'a7', 'a4']) {
      const a = basin.areas.find((x) => x.id === id)!, d = detailOf(a), shape = new AreaShape(a.shape!);
      const patch = patchNoise(9001 + a.no * 131);
      const open: { tone: number; n: number }[] = [];
      let worst = 0, step = 0;
      for (let x = a.bounds.minX; x <= a.bounds.maxX; x += 1.5) {
        for (let z = a.bounds.minZ; z <= a.bounds.maxZ; z += 1.5) {
          if (!shape.contains(x, z)) continue;
          const t = d.toneAt(x, z), sh = d.shadeAt(x, z);
          expect(t, id).toBeGreaterThanOrEqual(0);
          expect(t, id).toBeLessThanOrEqual(1);
          // 絵（1m のます目から伸ばしたもの）と、計算した値が合う
          worst = Math.max(worst, Math.abs(maskAt(d.mask, x, z).tone - t));
          // ゆるい濃淡: 0.5m 隣との差は小さい（陰の端をのぞく）
          if (sh === 0 && d.shadeAt(x + 0.5, z) === 0) step = Math.max(step, Math.abs(d.toneAt(x + 0.5, z) - t));
          if (sh === 0) open.push({ tone: t, n: patch(x, z) });
          // 陰のある所は、陰の無い時の値より、陰の濃さ × 0.3 だけ湿った側（0 で止まる）
          else expect(t, id).toBeCloseTo(Math.max(0, Math.min(1, 0.5 - (patch(x, z) - 0.5) * 1.7) - 0.3 * sh), 6);
        }
      }
      expect(worst, id).toBeLessThan(0.16);
      expect(step, id).toBeLessThan(0.08);
      expect(open.length, id).toBeGreaterThan(200);
      // 開けた所: 濃淡が大きいほど、色むらは小さい（同じ順）。真ん中あたりに広がっていて、片側に張り付かない
      const sorted = [...open].sort((p, q) => p.n - q.n);
      for (let i = 1; i < sorted.length; i++) expect(sorted[i]!.tone, id).toBeLessThanOrEqual(sorted[i - 1]!.tone + 1e-9);
      const mean = open.reduce((s2, p) => s2 + p.tone, 0) / open.length;
      const sd = Math.sqrt(open.reduce((s2, p) => s2 + (p.tone - mean) ** 2, 0) / open.length);
      expect(mean, id).toBeGreaterThan(0.3);
      expect(mean, id).toBeLessThan(0.7);
      expect(sd, id).toBeGreaterThan(0.1);
    }
  });

  it('色むらの色: 草の地面は、湿った所が暗い緑・乾いた所が明るい黄み。ほかの地面は、明るさだけを少し（色みは変えない）。草の板は、地面と同じ色むらと陰', () => {
    const lum = (c: readonly number[]): number => 0.3 * c[0]! + 0.59 * c[1]! + 0.11 * c[2]!;
    const g = TONE_COLORS.grass, p = TONE_COLORS.plain;
    expect(lum(g.lo)).toBeLessThan(0.92);
    expect(lum(g.hi)).toBeGreaterThan(1.04);
    expect(g.lo[1]).toBeGreaterThan(g.lo[0]);
    expect(g.lo[1]).toBeGreaterThan(g.lo[2]);
    expect(g.hi[0]).toBeGreaterThan(g.hi[2] + 0.2);
    for (const c of [p.lo, p.hi]) expect(Math.max(...c) - Math.min(...c)).toBeLessThan(0.02);
    expect(lum(p.hi) - lum(p.lo)).toBeGreaterThan(0.08);
    expect(lum(p.hi) - lum(p.lo)).toBeLessThan(lum(g.hi) - lum(g.lo));
    expect(toneTint('grass', 0)).toEqual([...g.lo]);
    expect(toneTint('grass', 1)).toEqual([...g.hi]);
    expect(toneTint('grass', 0.5).map((v, i) => v - (g.lo[i]! + g.hi[i]!) / 2).every((v) => Math.abs(v) < 1e-9)).toBe(true);
    expect(toneTint('plain', 7)).toEqual([...p.hi]);
    // 草の板: 陰の無い所は地面の色むらと同じ倍率。陰のいちばん濃い所は、地面と同じだけ暗い
    expect(tuftTint('grass', 0.3, 0)).toEqual(toneTint('grass', 0.3));
    const dark = tuftTint('grass', 0.3, 1), base = toneTint('grass', 0.3);
    dark.forEach((v, i) => expect(v).toBeCloseTo(base[i]! * (1 - GROUND_SHADE), 9));
  });

  it('草の板の色と生え方: フィールドでは、1 本ずつ、その場所の色むらと陰の色が掛かる。際の陰の中の草は暗い。背の高い草は湿った所に多く、枯れ草は乾いた所に多い', () => {
    const a = basin.areas.find((x) => x.id === 'a3')!, d = detailOf(a);
    const g = buildAreaGroup({ bounds: a.bounds, shape: a.shape, rocks: a.rocks, platforms: a.platforms, kind: a.kind, seed: 9001 + a.no * 131, climbs: a.climbs, relief: a.relief, groundTint: a.look?.ground, landscape: landscapeProfile(basin.id, a), center: a.center, camp: null, gates: a.exits.map((e) => ({ x: e.x, z: e.z, marker: true })) });
    g.updateMatrixWorld(true);
    const m4 = new Matrix4(), v = new Vector3(), col = new Color();
    const layers: { n: number; lum: number[]; tone: number[]; shade: number[] }[] = [];
    g.traverse((o) => {
      const im = o as InstancedMesh;
      if (!im.isInstancedMesh || !((im.material as MeshLambertMaterial).alphaTest > 0) || !im.instanceColor) return;
      const L = { n: im.count, lum: [] as number[], tone: [] as number[], shade: [] as number[] };
      for (let i = 0; i < im.count; i++) {
        im.getMatrixAt(i, m4);
        v.setFromMatrixPosition(m4).applyMatrix4(im.matrixWorld);
        im.getColorAt(i, col);
        L.lum.push(0.3 * col.r + 0.59 * col.g + 0.11 * col.b);
        L.tone.push(d.toneAt(v.x, v.z));
        L.shade.push(d.shadeAt(v.x, v.z));
      }
      layers.push(L);
    });
    // 草 4 種（短い・背の高い・枯れ・花）と、小石・茂み
    expect(layers.length).toBeGreaterThanOrEqual(5);
    const mean = (xs: number[]): number => xs.reduce((s2, x) => s2 + x, 0) / Math.max(1, xs.length);
    const big = layers.filter((L) => L.n > 150);
    expect(big.length).toBeGreaterThanOrEqual(2);
    for (const L of big) {
      // 陰の濃い所（0.5 以上）の草は、開けた所の草より暗い
      const inShade = L.lum.filter((_, i) => L.shade[i]! > 0.5), inOpen = L.lum.filter((_, i) => L.shade[i]! === 0);
      if (inShade.length >= 5) expect(mean(inShade)).toBeLessThan(mean(inOpen) * 0.85);
      // 開けた所: 乾いた所（色むら 0.6 以上）の草は、湿った所（0.4 以下）の草より明るい
      const dry = L.lum.filter((_, i) => L.shade[i]! === 0 && L.tone[i]! > 0.6), wet = L.lum.filter((_, i) => L.shade[i]! === 0 && L.tone[i]! < 0.4);
      if (dry.length >= 5 && wet.length >= 5) expect(mean(dry)).toBeGreaterThan(mean(wet) * 1.08);
    }
    // いちばん多い層（短い草）は、湿った側に寄る。色むらの平均が 0.5 より小さい
    const short = [...layers].sort((p, q) => q.n - p.n)[0]!;
    expect(mean(short.tone)).toBeLessThan(0.45);
    // これまでの 1 つの狩場（地面の作り込みが無い）は、色を掛けない草のまま（色のばらつきだけ）
    const arena = buildAreaGroup({ bounds: { minX: -20, maxX: 20, minZ: -20, maxZ: 20 }, rocks: [], platforms: [], gates: [{ x: 0, z: -20, marker: true }], seed: 5 });
    const lums: number[] = [];
    arena.traverse((o) => {
      const im = o as InstancedMesh;
      if (!im.isInstancedMesh || !im.instanceColor) return;
      for (let i = 0; i < im.count; i++) { im.getColorAt(i, col); lums.push(0.3 * col.r + 0.59 * col.g + 0.11 * col.b); }
    });
    expect(lums.length).toBeGreaterThan(100);
    expect(mean(lums)).toBeGreaterThan(0.97);
    expect(mean(lums)).toBeLessThan(1.03);
  });

  it('段の上の面: フィールドでは、まわりの地面と同じ色（濃淡 × エリアの色合い × 色むら）が頂点に付く。フィールドでない所は、これまでどおり色を付けない', () => {
    const a = basin.areas.find((x) => x.platforms.some((p) => p.h > 0))!;
    expect(a).toBeTruthy();
    const seed = 9001 + a.no * 131, patch = patchNoise(seed), tint = a.look?.ground ?? [1, 1, 1];
    const g = buildAreaGroup({ bounds: a.bounds, shape: a.shape, rocks: a.rocks, platforms: a.platforms, kind: a.kind, seed, climbs: a.climbs, relief: a.relief, groundTint: a.look?.ground, landscape: landscapeProfile(basin.id, a), center: a.center, camp: null, gates: a.exits.map((e) => ({ x: e.x, z: e.z, marker: true })) });
    let tops = 0, checked = 0;
    g.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh || !Array.isArray(m.material) || m.geometry.groups.length !== 2) return;
      const top = m.geometry.groups[0]!, idx = m.geometry.getIndex()!, pos = m.geometry.getAttribute('position'), col = m.geometry.getAttribute('color');
      expect((m.material[0] as MeshLambertMaterial).vertexColors).toBe(true);
      tops++;
      for (let i = top.start; i < top.start + top.count; i++) {
        const v = idx.getX(i), x = pos.getX(v), z = pos.getZ(v);
        const shade = 1 - 0.2 * patch(x, z), warm = (patch(x + 91, z + 53) - 0.5) * 0.14, t = toneTint(a.kind === 'hunt' || a.kind === 'camp' ? 'grass' : 'plain', baseTone(patch(x, z)));
        expect(col.getX(v)).toBeCloseTo(shade * (1 + warm) * tint[0]! * t[0], 5);
        expect(col.getY(v)).toBeCloseTo(shade * tint[1]! * t[1], 5);
        expect(col.getZ(v)).toBeCloseTo(shade * (1 - warm) * tint[2]! * t[2], 5);
        checked++;
      }
    });
    expect(tops).toBe(a.platforms.filter((p) => p.h > 0).length);
    expect(checked).toBeGreaterThan(30);
    // これまでの 1 つの狩場: 段の上の面に色を付けない（頂点の色を使わない素材のまま）
    const arena = buildAreaGroup({ bounds: { minX: -20, maxX: 20, minZ: -20, maxZ: 20 }, rocks: [], platforms: [{ minX: -4, maxX: 4, minZ: 2, maxZ: 9, h: 1 }], gates: [{ x: 0, z: -20, marker: true }], seed: 5 });
    let legacy = 0;
    arena.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh || !Array.isArray(m.material) || m.geometry.groups.length !== 2) return;
      legacy++;
      expect((m.material[0] as MeshLambertMaterial).vertexColors).toBe(false);
    });
    expect(legacy).toBe(1);
  });

  it('草むら: フィールドの草の地面は、短い草と背の高い草が 1.3 倍（上限 2600 本）。これまでの 1 つの狩場の草の数は変わらない', () => {
    const count = (g: ReturnType<typeof buildAreaGroup>): number[] => {
      const out: number[] = [];
      g.traverse((o) => { const im = o as InstancedMesh; if (im.isInstancedMesh && (im.material as MeshLambertMaterial).alphaTest > 0) out.push(im.count); });
      return out.sort((p, q) => q - p);
    };
    const a = basin.areas.find((x) => x.id === 'a3')!, shape = new AreaShape(a.shape!);
    const g = buildAreaGroup({ bounds: a.bounds, shape: a.shape, rocks: a.rocks, platforms: a.platforms, kind: a.kind, seed: 9001 + a.no * 131, relief: a.relief, landscape: landscapeProfile(basin.id, a), center: a.center, camp: null, gates: a.exits.map((e) => ({ x: e.x, z: e.z, marker: true })) });
    const n = count(g);
    // いちばん多い層 = 短い草: 置けなかったぶん（8 回試して空きが無い）を引いても、広さ × 0.26 × 1.3 の 8 割より多い
    expect(n[0]!).toBeGreaterThan(shape.area() * 0.26 * 1.3 * 0.8);
    expect(n[0]!).toBeLessThanOrEqual(Math.min(2600, Math.round(shape.area() * 0.26 * 1.3)));
    // 描く三角形: 草と小物の板は 1 本 8 枚。エリア 1 つで 4 万枚より少ない
    expect(n.reduce((s2, k) => s2 + k, 0) * 8).toBeLessThan(40000);
    const arena = count(buildAreaGroup({ bounds: { minX: -20, maxX: 20, minZ: -20, maxZ: 20 }, rocks: [], platforms: [], gates: [{ x: 0, z: -20, marker: true }], seed: 5 }));
    expect(arena[0]!).toBeLessThanOrEqual(Math.round(40 * 40 * 0.26));
    expect(arena[0]!).toBeGreaterThan(40 * 40 * 0.26 * 0.8);
  });
});
