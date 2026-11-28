// 崖の向こうの影と、丘の草・茂み（v0.79.0。docs/spec.md の 21.8、D-179）。描画だけ（戦闘・当たりは変わらない）。
// 影の絵と草: src/render/exteriorShade.ts、素材: src/render/exteriorGround.ts、茂み: src/render/exteriorFlora.ts の shrub、置く所: src/render/fieldLandscape.ts。
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Color, Group, type InstancedMesh, LinearFilter, Matrix4, type Mesh, MeshLambertMaterial, Quaternion, RedFormat, Vector3 } from 'three';
import type { Content, FieldAreaDef } from '../src/data/schemas';
import { SeededRng } from '../src/core/seededRng';
import { ExteriorFlora } from '../src/render/exteriorFlora';
import { outerGroundMaterial, setOuterShade } from '../src/render/exteriorGround';
import {
  HILL_COVER_MIN, HILL_GRASS_FAR, HILL_GRASS_MAX, HILL_GRASS_NEAR, HILL_GRASS_SCALE, HILL_GRASS_STEEP, HILL_SHRUB_MAX, ROCK_SHADE, SHADE_CAP, SHADE_MAX_PX, SHADE_REACH, SHADOW_DIR, SHADOW_PER_M,
  TREE_SHADE, UNDER_SHADE, buildOuterShade, hillGrassCount, hillShrubCount, rockShade, setShadeUv, shadeTexture, treeShade, type OuterShade,
} from '../src/render/exteriorShade';
import { buildLandscapeExterior, buildLandscapeSurface, landscapeProfile } from '../src/render/fieldLandscape';
import { SUN_DIR } from '../src/render/sky';
import { SUN_DIR as ARENA_SUN } from '../src/render/arena';
import { loadContent } from './helpers';

// Actions の機械は遅い（全エリアの景観を作る検査がある）
vi.setConfig({ testTimeout: 120000 });

let c: Content;
beforeAll(async () => {
  c = await loadContent();
});
const input = (id: string, a: FieldAreaDef) => ({ bounds: a.bounds, shape: a.shape, relief: a.relief, gates: a.exits, profile: landscapeProfile(id, a) });
const B = { minX: 0, maxX: 40, minZ: 0, maxZ: 30 };
/** 絵のいちばん濃い値（画素が多いので、Math.max(...) は使えない） */
const maxOf = (d: Uint8Array): number => d.reduce((k, v) => (v > k ? v : k), 0);

describe('影の絵', () => {
  it('影の伸びる向きは、太陽の反対。高さ 1m の物の影は 0.68m（光の向きは、狩りの光と同じ）', () => {
    expect(ARENA_SUN).toBe(SUN_DIR);
    expect(Math.hypot(SHADOW_DIR[0], SHADOW_DIR[1])).toBeCloseTo(1, 9);
    expect(SHADOW_DIR[0] * SUN_DIR.x + SHADOW_DIR[1] * SUN_DIR.z).toBeLessThan(0);
    expect(SHADOW_DIR[0]).toBeCloseTo(14 / Math.hypot(14, 11), 6);
    expect(SHADOW_PER_M).toBeCloseTo(Math.hypot(14, 11) / 26, 6);
  });

  it('絵は 512 画素まで・エリアの外 96m まで。楕円の真ん中が濃く、ふちへ向けて薄く、外は 0。長い方は、影の伸びる向き', () => {
    const s = buildOuterShade(B, [{ x: 20, z: 15, ra: 8, rb: 4, k: 0.5 }]);
    expect(Math.max(s.width, s.height)).toBeLessThanOrEqual(SHADE_MAX_PX);
    expect([s.minX, s.minZ, s.sizeX, s.sizeZ]).toEqual([-SHADE_REACH, -SHADE_REACH, 40 + SHADE_REACH * 2, 30 + SHADE_REACH * 2]);
    expect(s.data.length).toBe(s.width * s.height);
    expect(s.at(20, 15)).toBeGreaterThan(0.47);
    expect(s.at(20, 15)).toBeLessThanOrEqual(0.5 + 1 / 255);
    // 影の伸びる向きへ 6m: まだ影の中。横へ 6m: 外
    expect(s.at(20 + SHADOW_DIR[0] * 6, 15 + SHADOW_DIR[1] * 6)).toBeGreaterThan(0.05);
    expect(s.at(20 - SHADOW_DIR[1] * 6, 15 + SHADOW_DIR[0] * 6)).toBe(0);
    expect(s.at(20 + SHADOW_DIR[0] * 10, 15 + SHADOW_DIR[1] * 10)).toBe(0);
    // 真ん中から外へ、濃くならない
    let prev = 1;
    for (let d = 0; d <= 9; d += 0.75) {
      const v = s.at(20 + SHADOW_DIR[0] * d, 15 + SHADOW_DIR[1] * d);
      expect(v).toBeLessThanOrEqual(prev + 0.01);
      prev = v;
    }
    // 影が無ければ、ぜんぶ 0
    expect(buildOuterShade(B, []).data.every((v) => v === 0)).toBe(true);
  });

  it('重なった影は 1 - (1 - a)(1 - b)。上限は SHADE_CAP。同じ入力からは同じ絵', () => {
    const one = { x: 10, z: 10, ra: 6, rb: 6, k: 0.4, soft: 0.9 };
    const s = buildOuterShade(B, [one, { ...one }]);
    expect(s.at(10, 10)).toBeCloseTo(1 - 0.6 * 0.6, 2);
    const many = buildOuterShade(B, Array.from({ length: 8 }, () => ({ ...one })));
    expect(many.at(10, 10)).toBeCloseTo(SHADE_CAP, 2);
    expect(maxOf(many.data)).toBe(Math.round(SHADE_CAP * 255));
    expect(Array.from(buildOuterShade(B, [one, { ...one }]).data)).toEqual(Array.from(s.data));
  });

  it('素材が読む形: 1 色（赤）・1 バイト・行の詰め 1・なめらかに読む。地面の板の頂点に、絵の座標', () => {
    const s = buildOuterShade(B, [{ x: 20, z: 15, ra: 5, rb: 5, k: 0.5 }]), t = shadeTexture(s);
    expect(t.format).toBe(RedFormat);
    expect(t.unpackAlignment).toBe(1);
    expect(t.magFilter).toBe(LinearFilter);
    expect(t.generateMipmaps).toBe(false);
    expect(t.image.width).toBe(s.width);
    const f = c.fields.get('field.basin')!, a = f.areas[1]!, surf = buildLandscapeSurface(input(f.id, a));
    const sh = buildOuterShade(a.bounds, []);
    setShadeUv(surf.outer, sh);
    const uv = surf.outer.getAttribute('aShade'), pos = surf.outer.getAttribute('position');
    expect(uv.count).toBe(pos.count);
    for (let i = 0; i < uv.count; i += 97) {
      expect(uv.getX(i)).toBeCloseTo((pos.getX(i) - sh.minX) / sh.sizeX, 5);
      expect(uv.getY(i)).toBeCloseTo((pos.getZ(i) - sh.minZ) / sh.sizeZ, 5);
    }
    t.dispose();
    surf.near.dispose();
    surf.outer.dispose();
  });

  it('木の影 = 樹冠の影（高さ × 0.68 だけ太陽の反対へ）・真下の陰・幹の影。岩は、根元のまわりの陰', () => {
    const b = treeShade(100, 50, 3, 6.4, 2, 0.5);
    expect(b).toHaveLength(3);
    const off = 6.4 * SHADOW_PER_M;
    expect(b[0]!.x).toBeCloseTo(100 + SHADOW_DIR[0] * off, 6);
    expect(b[0]!.z).toBeCloseTo(50 + SHADOW_DIR[1] * off, 6);
    expect(b[0]!.k).toBe(TREE_SHADE);
    // 樹冠の影は、太陽の反対へ少し長い
    expect(b[0]!.ra).toBeGreaterThan(b[0]!.rb);
    expect(b[0]!.rb).toBeCloseTo(3 * 1.04, 6);
    expect([b[1]!.x, b[1]!.z, b[1]!.k]).toEqual([100, 50, UNDER_SHADE]);
    // 幹の影は、根元と樹冠の影の間の細い帯
    expect(b[2]!.x).toBeCloseTo((100 + b[0]!.x) / 2, 6);
    expect(b[2]!.rb).toBeLessThan(b[2]!.ra);
    const s = buildOuterShade({ minX: 80, maxX: 120, minZ: 30, maxZ: 70 }, b);
    expect(s.at(b[0]!.x, b[0]!.z)).toBeGreaterThan(TREE_SHADE - 0.02);
    expect(s.at(100, 50)).toBeGreaterThan(UNDER_SHADE - 0.02);
    expect(s.at(100 - SHADOW_DIR[0] * 6, 50 - SHADOW_DIR[1] * 6)).toBe(0);
    const r = rockShade(10, 10, 4, 3);
    expect(r.k).toBe(ROCK_SHADE);
    expect(r.ra).toBeGreaterThan(4 * 1.3);
    // 岩の根元の輪（半径 4m）のどの向きでも、陰がある
    const rs = buildOuterShade(B, [r]);
    for (let a = 0; a < 6.28; a += 0.7) expect(rs.at(10 + Math.cos(a) * 4.2, 10 + Math.sin(a) * 4.2)).toBeGreaterThan(0.06);
  });

  it('外側の地面の素材が、影の絵を読む（盆地の素材は初めから。ほかの狩場の素材は、計算を足す）', () => {
    const s = buildOuterShade(B, [{ x: 20, z: 15, ra: 5, rb: 5, k: 0.5 }]), t = shadeTexture(s);
    const compile = (mat: MeshLambertMaterial): { uniforms: Record<string, { value: unknown }>; vertexShader: string; fragmentShader: string } => {
      const sh = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: 'void main() {\n#include <uv_vertex>\n}', fragmentShader: 'void main() {\n#include <map_fragment>\n}' };
      mat.onBeforeCompile(sh as never, null as never);
      return sh;
    };
    // 盆地
    const basin = outerGroundMaterial();
    const blank = (basin.userData.exShade as { value: { image: { width: number } } }).value;
    expect(blank.image.width).toBe(1);
    setOuterShade(basin, t);
    const b = compile(basin);
    expect(b.uniforms.tExShade!.value).toBe(t);
    expect(b.vertexShader).toContain('attribute vec2 aShade;');
    expect(b.vertexShader).toContain('vExShade = aShade;');
    expect(b.fragmentShader).toContain('diffuseColor.rgb *= 1.0 - texture2D( tExShade, vExShade ).r;');
    // 影は、絵と頂点の色を掛けた後
    expect(b.fragmentShader.indexOf('tExShade, vExShade')).toBeGreaterThan(b.fragmentShader.indexOf('diffuseColor *= sampledDiffuseColor;'));
    expect(basin.customProgramCacheKey()).toBe('outer-ground');
    // ほかの狩場
    const other = new MeshLambertMaterial();
    setOuterShade(other, t);
    const o = compile(other);
    expect(o.uniforms.tExShade!.value).toBe(t);
    expect(o.vertexShader).toContain('#include <uv_vertex>\n  vExShade = aShade;');
    expect(o.fragmentShader).toContain('#include <map_fragment>\n  diffuseColor.rgb *= 1.0 - texture2D( tExShade, vExShade ).r;');
    expect(other.customProgramCacheKey()).toBe('outer-shade');
    // 付け直すと、絵だけが替わる
    const t2 = shadeTexture(s);
    setOuterShade(other, t2);
    expect(o.uniforms.tExShade!.value).toBe(t2);
    for (const x of [t, t2]) x.dispose();
    basin.dispose();
    other.dispose();
  });
});

describe('丘の草と茂み', () => {
  it('本数は、外周の長さ × 草の量（上限あり。草の少ない狩場には生やさない）', () => {
    expect(hillGrassCount(200, 1)).toBe(640);
    expect(hillGrassCount(1000, 1)).toBe(HILL_GRASS_MAX);
    expect(hillGrassCount(200, 0.5)).toBe(320);
    // 草の量が 0.05 より少ない狩場（雪・氷・洞）には生やさない
    expect(hillGrassCount(200, 0.02)).toBe(0);
    expect(hillGrassCount(1000, HILL_COVER_MIN - 0.001)).toBe(0);
    expect(hillShrubCount(1000, HILL_COVER_MIN - 0.001)).toBe(0);
    expect(hillGrassCount(200, 0)).toBe(0);
    expect(hillShrubCount(200, 1)).toBe(72);
    expect(hillShrubCount(1000, 1)).toBe(HILL_SHRUB_MAX);
    expect(hillShrubCount(200, 0)).toBe(0);
  });

  it('茂み 1 つ = 葉の板 3 枚（根元を合わせて、少し開く）。木の葉の板と同じ描画。針葉樹の狩場には無い', () => {
    const flora = new ExteriorFlora({ seed: 5, tree: 'broadleaf', foliage: 0x4d693c });
    const rng = new SeededRng(8);
    expect(flora.shrub(rng, 10, 2, 20, 3, 1)).toBe(true);
    expect(flora.shrub(rng, 30, 2, 20, 3, 0.4)).toBe(true);
    expect(flora.shrubs).toBe(2);
    const g = new Group();
    flora.addTo(g);
    expect(g.children.map((m) => m.name)).toEqual(['field-exterior-leaves']);
    const leaves = g.children[0] as InstancedMesh;
    expect(leaves.count).toBe(6);
    const m = new Matrix4(), at = new Vector3(), q = new Quaternion(), s = new Vector3(), up = new Vector3(), col = new Color();
    const lit: number[] = [];
    for (let i = 0; i < 6; i++) {
      leaves.getMatrixAt(i, m);
      m.decompose(at, q, s);
      expect(at.x).toBe(i < 3 ? 10 : 30);
      // 根元は、地面より少し下
      expect(at.y).toBeLessThan(2);
      expect(at.y).toBeGreaterThan(2 - 0.3);
      expect(s.x).toBeGreaterThan(3 * 0.84);
      expect(s.x).toBeLessThan(3 * 1.16);
      // 板は、ほぼ上向き（少し開く）
      up.set(0, 1, 0).applyQuaternion(q);
      expect(up.y).toBeGreaterThan(0.9);
      expect(up.y).toBeLessThan(0.99);
      leaves.getColorAt(i, col);
      lit.push(col.g);
    }
    // 影の中の茂み（明るさ 0.4）は暗い
    expect(Math.max(...lit.slice(3))).toBeLessThan(Math.min(...lit.slice(0, 3)));
    const pine = new ExteriorFlora({ seed: 5, tree: 'pine', foliage: 0x4d693c });
    expect(pine.shrub(rng, 0, 0, 0, 3, 1)).toBe(false);
    expect(pine.shrubs).toBe(0);
  });
});

describe('狩場の外側に置く', () => {
  const build = (fid: string, aid: string) => {
    const f = c.fields.get(fid)!, a = f.areas.find((x) => x.id === aid)!, data = input(f.id, a), s = buildLandscapeSurface(data), g = buildLandscapeExterior(data, s);
    const relief = g.getObjectByName('field-exterior-relief') as Mesh;
    return { a, s, g, relief, shade: relief.userData.shade as OuterShade, land: g.userData.landscape as { trees: number; rocks: number; grass: number; shrubs: number; shadeBlobs: number } };
  };

  it('盆地のエリア 3: 外側の地面が影の絵を読み、木の下と岩の際が暗い。エリアの中と、開けた丘は暗くしない', () => {
    const { a, s, g, relief, shade, land } = build('field.basin', 'a3');
    expect(relief.geometry.getAttribute('aShade').count).toBe(relief.geometry.getAttribute('position').count);
    expect((relief.material as MeshLambertMaterial).userData.exShade.value).toBe(relief.userData.outerShade);
    expect(relief.userData.outerShade.image.data).toBe(shade.data);
    // 木 1 本に影 3 つ、岩 1 つに 1 つ
    expect(land.shadeBlobs).toBe(land.trees * 3 + land.rocks);
    // 幹の所（木の真下）は、どの木も暗い
    const trunks = g.getObjectByName('field-exterior-trunks') as InstancedMesh, m = new Matrix4(), at = new Vector3();
    let dark = 0, n = 0;
    for (let i = 0; i < trunks.count; i++) {
      trunks.getMatrixAt(i, m);
      at.setFromMatrixPosition(m);
      const v = shade.at(at.x, at.z);
      if (v > UNDER_SHADE - 0.05) dark++;
      n++;
    }
    expect(dark / n).toBeGreaterThan(0.95);
    // 岩の根元の輪の、影の伸びる側は暗い
    for (const r of (g.getObjectByName('field-exterior-rocks') as Mesh).userData.rocks as { x: number; z: number; r: number }[]) {
      expect(shade.at(r.x + SHADOW_DIR[0] * r.r * 1.1, r.z + SHADOW_DIR[1] * r.r * 1.1)).toBeGreaterThan(0.15);
    }
    // エリアの真ん中（木も岩も、外周の外）と、絵の隅は 0
    expect(shade.at(a.center!.x, a.center!.z)).toBe(0);
    expect(shade.at(shade.minX + 1, shade.minZ + 1)).toBe(0);
    // 影のある画素は、絵の 3〜40%（開けた丘が残る）
    const on = shade.data.reduce((k, v) => k + (v > 0 ? 1 : 0), 0) / shade.data.length;
    expect(on).toBeGreaterThan(0.03);
    expect(on).toBeLessThan(0.4);
    s.near.dispose();
  });

  it('盆地のエリア 3: 丘の草は、外周の 2.2〜58m 先・岩の外・ゆるい斜面に立ち、地面に根元がある。影の中の草は暗い。茂みは葉の板 3 枚ずつ', () => {
    const { s, g, shade, land } = build('field.basin', 'a3');
    const grass = g.getObjectByName('field-exterior-grass') as InstancedMesh;
    expect(grass.count).toBe(land.grass);
    expect(grass.count).toBeGreaterThan(300);
    expect(grass.count).toBeLessThanOrEqual(HILL_GRASS_MAX);
    expect(grass.receiveShadow).toBe(false);
    // 草の揺れの素材（エリアの中の草と同じ）
    expect((grass.material as MeshLambertMaterial).customProgramCacheKey()).toBe('sway-in-wind');
    const rocks = (g.getObjectByName('field-exterior-rocks') as Mesh).userData.rocks as { x: number; z: number; r: number }[];
    const m = new Matrix4(), at = new Vector3(), q = new Quaternion(), sc = new Vector3(), col = new Color();
    const inShade: number[] = [], open: number[] = [];
    for (let i = 0; i < grass.count; i++) {
      grass.getMatrixAt(i, m);
      m.decompose(at, q, sc);
      const d = s.distance(at.x, at.z);
      expect(d).toBeGreaterThanOrEqual(HILL_GRASS_NEAR);
      expect(d).toBeLessThanOrEqual(HILL_GRASS_FAR);
      for (const r of rocks) expect(Math.hypot(at.x - r.x, at.z - r.z)).toBeGreaterThan(r.r);
      const slope = Math.hypot(s.height(at.x + 0.6, at.z) - s.height(at.x - 0.6, at.z), s.height(at.x, at.z + 0.6) - s.height(at.x, at.z - 0.6)) / 1.2;
      expect(slope).toBeLessThanOrEqual(HILL_GRASS_STEEP + 1e-6);
      // 根元は、地面か、少し下（斜面では、傾きの 0.5 倍 m だけ埋める）
      const y = s.height(at.x, at.z);
      expect(at.y).toBeLessThanOrEqual(y + 1e-6);
      expect(at.y).toBeGreaterThan(y - 0.5);
      expect(sc.x).toBeGreaterThanOrEqual(HILL_GRASS_SCALE[0] - 1e-6);
      expect(sc.x).toBeLessThanOrEqual(HILL_GRASS_SCALE[1] + 1e-6);
      grass.getColorAt(i, col);
      (shade.at(at.x, at.z) > 0.3 ? inShade : open).push(col.g);
    }
    const mean = (xs: number[]): number => xs.reduce((k, v) => k + v, 0) / xs.length;
    expect(inShade.length).toBeGreaterThan(5);
    expect(mean(inShade)).toBeLessThan(mean(open) * 0.8);
    // 茂み
    expect(land.shrubs).toBeGreaterThan(30);
    expect((g.getObjectByName('field-exterior-leaves') as InstancedMesh).count).toBe(land.trees * 39 + land.shrubs * 3);
    // 景観の描画は 8 回（地面・出口の先の道・遠い稜線・幹・葉のかたまり・葉の板・岩・草）
    expect(g.children.map((x) => x.name).sort()).toEqual(['field-distant-ridge', 'field-exit-continuation', 'field-exterior-canopy', 'field-exterior-grass', 'field-exterior-leaves', 'field-exterior-relief', 'field-exterior-rocks', 'field-exterior-trunks']);
    // 同じ入力からは、同じ影と草
    const again = build('field.basin', 'a3');
    expect(Array.from(again.shade.data)).toEqual(Array.from(shade.data));
    expect(Array.from((again.g.getObjectByName('field-exterior-grass') as InstancedMesh).instanceMatrix.array)).toEqual(Array.from(grass.instanceMatrix.array));
    s.near.dispose();
    again.s.near.dispose();
  });

  it('草の少ない狩場: 白霧氷谷は、草も茂みも無い（雪。木と岩の影はある）。灰鉱窟は、草も茂みも無く、岩の陰だけ', () => {
    const w = build('field.whitefrost', 'a2');
    expect(w.land.grass).toBe(0);
    expect(w.g.getObjectByName('field-exterior-grass')).toBeUndefined();
    expect(w.land.shrubs).toBe(0);
    expect(w.g.getObjectByName('field-exterior-leaves')).toBeUndefined();
    expect((w.relief.material as MeshLambertMaterial).customProgramCacheKey()).toBe('outer-shade');
    expect(w.land.shadeBlobs).toBe(w.land.trees * 3 + w.land.rocks);
    const m = build('field.ashmine', 'a2');
    expect(m.land.grass).toBe(0);
    expect(m.land.shrubs).toBe(0);
    expect(m.g.getObjectByName('field-exterior-grass')).toBeUndefined();
    expect(m.land.trees).toBe(0);
    expect(m.land.shadeBlobs).toBe(m.land.rocks);
    expect(maxOf(m.shade.data)).toBeGreaterThan(60);
    w.s.near.dispose();
    m.s.near.dispose();
  });

  it('全 21 狩場の全エリア: 景観の描画は 9 回まで。草は 900 本まで・茂みは 110 まで。影の絵は 1 枚（512 画素まで）', () => {
    let areas = 0, grassy = 0, most = 0;
    for (const f of c.fields.values()) {
      for (const a of f.areas) {
        const data = input(f.id, a), s = buildLandscapeSurface(data), g = buildLandscapeExterior(data, s);
        const label = `${f.id}/${a.id}`, land = g.userData.landscape as { grass: number; shrubs: number };
        expect(g.children.length, label).toBeLessThanOrEqual(9);
        expect(land.grass, label).toBeLessThanOrEqual(HILL_GRASS_MAX);
        expect(land.shrubs, label).toBeLessThanOrEqual(HILL_SHRUB_MAX);
        const relief = g.getObjectByName('field-exterior-relief') as Mesh, shade = relief.userData.shade as OuterShade;
        expect(Math.max(shade.width, shade.height), label).toBeLessThanOrEqual(SHADE_MAX_PX);
        expect(maxOf(shade.data), label).toBeLessThanOrEqual(Math.round(SHADE_CAP * 255));
        expect(relief.geometry.getAttribute('aShade'), label).toBeDefined();
        if (land.grass > 0) grassy++;
        most = Math.max(most, land.grass);
        areas++;
        g.traverse((o) => {
          const mm = o as Mesh;
          if (mm.isMesh) mm.geometry.dispose();
        });
        (relief.userData.outerShade as { dispose(): void }).dispose();
        s.near.dispose();
      }
    }
    expect(areas).toBeGreaterThan(150);
    // 草の生える狩場（草原・森・湿地など）は、全体の 3 割より多い
    expect(grassy / areas).toBeGreaterThan(0.3);
    expect(most).toBeGreaterThan(500);
  });
});
