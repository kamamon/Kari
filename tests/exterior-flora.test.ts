// 崖の向こうの木・岩・地面（v0.78.0。docs/spec.md の 21.7、D-178）。描画だけ（戦闘・当たりは変わらない）。
// 形: src/render/exteriorFlora.ts、盆地の外側の地面: src/render/exteriorGround.ts、置く場所: src/render/fieldLandscape.ts（ChatGPT の #43）。
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Color, Group, type InstancedMesh, Matrix4, type Mesh, Quaternion, Vector3 } from 'three';
import type { Content, FieldAreaDef } from '../src/data/schemas';
import { SeededRng } from '../src/core/seededRng';
import { GROUND_GAIN } from '../src/render/arena';
import { ENV_SPRITES, ENV_TILES } from '../src/render/envArt';
import {
  CROWN_UNDER, ExteriorFlora, ROCK_NEAR, ROCK_NEAR_RAD, ROCK_ROOT_MIN, ROCK_SLOPE_MAX, ROCK_TILT, ROCK_TILT_MAX, TALL_SLOPE_MAX, TUFT_ALPHA, TUFT_H,
  crownGeometry, pineTierGeometry, placeExteriorRock, rockSink, trunkGeometry, tuftGeometry, tuftMaterial,
} from '../src/render/exteriorFlora';
import { OUTER_GAIN, OUTER_STEEP_FLAT, OUTER_TILE, outerGroundMaterial, outerPaint, outerSteep, paintsOuter } from '../src/render/exteriorGround';
import { buildLandscapeExterior, buildLandscapeSurface, landscapeProfile } from '../src/render/fieldLandscape';
import { TONE_COLORS } from '../src/render/groundDetail';
import { mergeRocks, rockArt, rockArtGeometry } from '../src/render/rockArt';
import { loadContent } from './helpers';

// Actions の機械は遅い（全エリアの景観を作る検査がある）
vi.setConfig({ testTimeout: 120000 });

let c: Content;
beforeAll(async () => {
  c = await loadContent();
});
const input = (id: string, a: FieldAreaDef) => ({ bounds: a.bounds, shape: a.shape, relief: a.relief, gates: a.exits, profile: landscapeProfile(id, a) });
const tris = (m: Mesh | InstancedMesh | undefined): number => {
  if (!m) return 0;
  const g = m.geometry, n = (g.getIndex()?.count ?? g.getAttribute('position').count) / 3;
  return n * ((m as InstancedMesh).isInstancedMesh ? (m as InstancedMesh).count : 1);
};

describe('木の形', () => {
  it('幹: 三角形 30、高さ 1（真ん中が原点）。根元が広がり、上ほど細い', () => {
    const g = trunkGeometry(), p = g.getAttribute('position');
    expect(g.getIndex()!.count / 3).toBe(30);
    let lo = 9, hi = -9, rLo = 0, rHi = 0;
    for (let i = 0; i < p.count; i++) {
      lo = Math.min(lo, p.getY(i));
      hi = Math.max(hi, p.getY(i));
      const r = Math.hypot(p.getX(i), p.getZ(i));
      if (p.getY(i) < -0.49) rLo = Math.max(rLo, r);
      if (p.getY(i) > 0.49) rHi = Math.max(rHi, r);
    }
    expect(lo).toBeCloseTo(-0.5, 5);
    expect(hi).toBeCloseTo(0.5, 5);
    expect(rLo).toBeGreaterThan(1.4);
    expect(rHi).toBeLessThan(0.95);
    expect(g.getAttribute('uv')).toBeDefined();
  });

  it('葉のかたまり: 三角形 80。頂点の色で、下が暗く・上が明るい。同じ種は同じ形', () => {
    const g = crownGeometry(77), p = g.getAttribute('position'), col = g.getAttribute('color');
    expect(p.count / 3).toBe(80);
    let under = 0, nu = 0, top = 0, nt = 0;
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) < -0.55) { under += col.getY(i); nu++; }
      if (p.getY(i) > 0.55) { top += col.getY(i); nt++; }
    }
    expect(nu).toBeGreaterThan(5);
    expect(nt).toBeGreaterThan(5);
    expect(under / nu).toBeLessThan(CROWN_UNDER + 0.15);
    expect(top / nt).toBeGreaterThan(0.92);
    expect(Array.from(crownGeometry(77).getAttribute('position').array)).toEqual(Array.from(p.array));
    expect(Array.from(crownGeometry(78).getAttribute('position').array)).not.toEqual(Array.from(p.array));
  });

  it('針葉樹の傘: 三角形 36。頂点は高さ 1、ふちは枝先（外）とくぼみ（内）が交互。下の面は暗い', () => {
    const g = pineTierGeometry(5), p = g.getAttribute('position'), col = g.getAttribute('color');
    expect(g.getIndex()!.count / 3).toBe(36);
    expect(p.getY(0)).toBe(1);
    const tip = Math.hypot(p.getX(1), p.getZ(1)), notch = Math.hypot(p.getX(2), p.getZ(2));
    expect(tip).toBeGreaterThan(0.85);
    expect(notch).toBeLessThan(0.72);
    expect(p.getY(1)).toBeLessThan(0);
    // 下の面（後ろ半分の頂点）
    for (let i = p.count / 2 + 1; i < p.count; i++) expect(col.getX(i)).toBe(CROWN_UNDER);
  });

  it('葉の板: 三角形 4（表と裏）。根元が原点で +Y へ伸び、法線は +Y。絵は、小物の図集の茂みのマス', () => {
    const g = tuftGeometry(), p = g.getAttribute('position'), n = g.getAttribute('normal'), uv = g.getAttribute('uv');
    expect(p.count / 3).toBe(4);
    const [x0, y0, x1, y1] = ENV_SPRITES.props.cells.bush.rect;
    let lo = 9, hi = -9, l = 9, r = -9;
    for (let i = 0; i < p.count; i++) {
      lo = Math.min(lo, p.getY(i));
      hi = Math.max(hi, p.getY(i));
      l = Math.min(l, p.getX(i));
      r = Math.max(r, p.getX(i));
      expect([n.getX(i), n.getY(i), n.getZ(i)]).toEqual([0, 1, 0]);
      expect(uv.getX(i)).toBeGreaterThanOrEqual(x0 / 1024 - 1e-6);
      expect(uv.getX(i)).toBeLessThanOrEqual(x1 / 1024 + 1e-6);
      expect(uv.getY(i)).toBeGreaterThanOrEqual(1 - y1 / 1024 - 1e-6);
      expect(uv.getY(i)).toBeLessThanOrEqual(1 - y0 / 1024 + 1e-6);
    }
    expect(lo).toBe(0);
    expect(hi).toBeCloseTo(TUFT_H, 6);
    expect(r - l).toBeCloseTo(1, 6);
    // 根元（絵の rootX）は、板の中ほど
    expect(l).toBeLessThan(-0.4);
    expect(r).toBeGreaterThan(0.4);
    // 素材: 切り抜き（草より低い境）。草の揺れの素材とは別（ブラウザ検査が、草の板を素材の鍵で数える）
    const mat = tuftMaterial();
    expect(mat.alphaTest).toBe(TUFT_ALPHA);
    expect(TUFT_ALPHA).toBeLessThan(0.5);
    expect(mat.customProgramCacheKey()).toBe('canopy-tuft');
    expect(mat.customProgramCacheKey()).not.toBe('sway-in-wind');
    mat.dispose();
  });
});

describe('木を組む', () => {
  const grow = (tree: 'broadleaf' | 'pine' | 'swamp', dense = false, n = 6): Group => {
    const flora = new ExteriorFlora({ seed: 4242, tree, foliage: 0x4d693c, dense });
    const rng = new SeededRng(99);
    for (let i = 0; i < n; i++) flora.tree(rng, { x: i * 20, z: 5, ground: 2, root: 1.6, h: 8 + i, yaw: i, shade: 0.9 });
    const g = new Group();
    flora.addTo(g);
    return g;
  };
  const mesh = (g: Group, name: string): InstancedMesh | undefined => g.getObjectByName(name) as InstancedMesh | undefined;

  it('広葉樹 1 本 = 幹 1 + 枝 2、葉のかたまり 5、葉の板 39（木の多い林は、かたまり 4・板 31）。描画は 3 回', () => {
    const g = grow('broadleaf');
    expect(g.children.map((m) => m.name)).toEqual(['field-exterior-trunks', 'field-exterior-canopy', 'field-exterior-leaves']);
    expect(mesh(g, 'field-exterior-trunks')!.count).toBe(6 * 3);
    expect(mesh(g, 'field-exterior-canopy')!.count).toBe(6 * 5);
    expect(mesh(g, 'field-exterior-leaves')!.count).toBe(6 * 39);
    // 1 本の三角形: 幹と枝 90 + かたまり 400 + 板 156 = 646（それまでは、幹と枝 84 + 球 3 つ 540 = 624）
    expect((tris(mesh(g, 'field-exterior-trunks')) + tris(mesh(g, 'field-exterior-canopy')) + tris(mesh(g, 'field-exterior-leaves'))) / 6).toBe(646);
    const d = grow('broadleaf', true);
    expect(mesh(d, 'field-exterior-canopy')!.count).toBe(6 * 4);
    expect(mesh(d, 'field-exterior-leaves')!.count).toBe(6 * 31);
  });

  it('葉の板は、木のまわり（樹冠の中〜少し外）に根元があり、上にも下にも向く。下を向いた板は暗い', () => {
    const g = grow('broadleaf', false, 1), leaves = mesh(g, 'field-exterior-leaves')!;
    const m = new Matrix4(), at = new Vector3(), q = new Quaternion(), s = new Vector3(), up = new Vector3(), col = new Color();
    let down = 0, upN = 0, litDown = 0, litUp = 0;
    for (let i = 0; i < leaves.count; i++) {
      leaves.getMatrixAt(i, m);
      m.decompose(at, q, s);
      // 木は (0, 2, 5)、高さ 8: 樹冠の半径は 高さ × 0.4 まで
      expect(Math.hypot(at.x, at.z - 5)).toBeLessThan(8 * 0.4 * 1.25);
      expect(at.y).toBeGreaterThan(2 + 8 * 0.2);
      expect(at.y).toBeLessThan(2 + 8 * 1.1);
      expect(s.x).toBeGreaterThan(0.8);
      up.set(0, 1, 0).applyQuaternion(q);
      leaves.getColorAt(i, col);
      const lit = col.g;
      if (up.y < -0.3) { down++; litDown += lit; }
      if (up.y > 0.5) { upN++; litUp += lit; }
    }
    expect(down).toBeGreaterThan(5);
    expect(upN).toBeGreaterThan(5);
    expect(litDown / down).toBeLessThan((litUp / upN) * 0.75);
  });

  it('針葉樹 1 本 = 幹 1、傘 5 段（葉の板は無い。描画は 2 回）。湿地の木は、低く広い', () => {
    const g = grow('pine');
    expect(g.children.map((m) => m.name)).toEqual(['field-exterior-trunks', 'field-exterior-canopy']);
    expect(mesh(g, 'field-exterior-trunks')!.count).toBe(6);
    expect(mesh(g, 'field-exterior-canopy')!.count).toBe(30);
    expect((tris(mesh(g, 'field-exterior-trunks')) + tris(mesh(g, 'field-exterior-canopy'))) / 6).toBe(30 + 5 * 36);
    // 湿地の木: 同じ高さの広葉樹より、葉のかたまりの上の端が低い
    const topOf = (grp: Group): number => {
      const cm = mesh(grp, 'field-exterior-canopy')!, m = new Matrix4(), at = new Vector3(), q = new Quaternion(), s = new Vector3();
      let hi = -1e9;
      for (let i = 0; i < cm.count; i++) {
        cm.getMatrixAt(i, m);
        m.decompose(at, q, s);
        hi = Math.max(hi, at.y + s.y);
      }
      return hi;
    };
    expect(topOf(grow('swamp', false, 1))).toBeLessThan(topOf(grow('broadleaf', false, 1)));
  });

  it('同じ種と同じ乱数からは、同じ木', () => {
    const a = mesh(grow('broadleaf'), 'field-exterior-leaves')!, b = mesh(grow('broadleaf'), 'field-exterior-leaves')!;
    expect(Array.from(a.instanceMatrix.array)).toEqual(Array.from(b.instanceMatrix.array));
    expect(Array.from(a.instanceColor!.array)).toEqual(Array.from(b.instanceColor!.array));
  });
});

describe('崖の向こうの岩', () => {
  /** 置いた岩の、根元の輪（図の形で、地面より下の頂点）が、どれも地面より下にあるか。返すのは、地面より上に出た頂点の数と、いちばん浮いた高さ */
  const floating = (r: ReturnType<typeof placeExteriorRock>, height: (x: number, z: number) => number): { n: number; worst: number } => {
    const local = rockArtGeometry(rockArt(r.id), r.lod ?? 1).getAttribute('position');
    const world = mergeRocks([r]).getAttribute('position');
    let n = 0, worst = -Infinity;
    for (let i = 0; i < local.count; i++) {
      if (local.getY(i) >= 0) continue;
      const gap = world.getY(i) - height(world.getX(i), world.getZ(i));
      worst = Math.max(worst, gap);
      if (gap > 0) n++;
    }
    return { n, worst };
  };

  it('平らな所: 傾けず、根元を rockSink だけ埋める。斜面: 斜面の向きへ半分だけ傾け、急なほど深く埋めて、低くする', () => {
    const flat = placeExteriorRock(new SeededRng(3), () => 5, { x: 10, z: 20, rad: 3, h: 2.4, dist: 30 });
    expect(flat.tilt).toEqual([0, 1, 0]);
    expect(flat.y).toBeCloseTo(5 - rockSink(3), 6);
    expect(flat.slope).toBeCloseTo(0, 6);
    expect(flat.lod).toBe(0);
    // +X へ上がる斜面（傾き 0.6）
    const hill = (x: number): number => 5 + 0.6 * x;
    const r = placeExteriorRock(new SeededRng(3), (x) => hill(x), { x: 10, z: 20, rad: 3, h: 2.4, dist: 30 });
    expect(r.slope).toBeCloseTo(0.6, 3);
    const ang = Math.acos(r.tilt![1]);
    expect(ang).toBeCloseTo(Math.min(ROCK_TILT_MAX, Math.atan(0.6) * ROCK_TILT), 5);
    // 傾く向きは、斜面の法線の向き（-X へ倒れる）
    expect(r.tilt![0]).toBeLessThan(0);
    expect(r.tilt![2]).toBeCloseTo(0, 6);
    expect(rockSink(3, 0.6)).toBeGreaterThan(rockSink(3, 0) + 0.4);
    expect(r.sy).toBeLessThan(flat.sy);
    // 根元の輪は、どこも地面より下（浮かない）
    expect(floating(flat, () => 5).n).toBe(0);
    expect(floating(r, (x) => hill(x)).n).toBe(0);
    // 斜面の上の側は、埋まる
    const world = mergeRocks([r]).getAttribute('position');
    let buried = 0;
    for (let i = 0; i < world.count; i++) if (world.getY(i) < hill(world.getX(i)) - 0.5) buried++;
    expect(buried).toBeGreaterThan(10);
  });

  it('近くて大きい岩だけ、細かい形（三角形 1080）。ほかは粗い形（168）。立ち岩は、ゆるい所だけ', () => {
    const near = placeExteriorRock(new SeededRng(3), () => 0, { x: 0, z: 0, rad: ROCK_NEAR_RAD + 0.5, h: 2, dist: ROCK_NEAR - 1 });
    const far = placeExteriorRock(new SeededRng(3), () => 0, { x: 0, z: 0, rad: ROCK_NEAR_RAD + 0.5, h: 2, dist: ROCK_NEAR + 1 });
    const small = placeExteriorRock(new SeededRng(3), () => 0, { x: 0, z: 0, rad: ROCK_NEAR_RAD - 0.5, h: 2, dist: ROCK_NEAR - 1 });
    expect([near.lod, far.lod, small.lod]).toEqual([1, 0, 0]);
    expect(mergeRocks([near]).getIndex()!.count / 3).toBe(1080);
    expect(mergeRocks([far]).getIndex()!.count / 3).toBe(168);
    const tallFlat = placeExteriorRock(new SeededRng(3), () => 0, { x: 0, z: 0, rad: 3, h: 7, dist: 40, tall: true });
    const tallSteep = placeExteriorRock(new SeededRng(3), (x) => (TALL_SLOPE_MAX + 0.1) * x, { x: 0, z: 0, rad: 3, h: 7, dist: 40, tall: true });
    expect(tallFlat.id).toBe('R-16');
    expect(tallSteep.id).not.toBe('R-16');
  });

  it('岩をまとめる: 傾き（根元の中心を軸に）・色の倍率・粗い形', () => {
    const base = { id: 'R-13', x: 4, y: 1, z: -2, yaw: 0.7, sx: 1, sy: 1, sz: 1 };
    const plain = mergeRocks([base]).getAttribute('position');
    const s = Math.sin(0.3), k = Math.cos(0.3);
    const tilted = mergeRocks([{ ...base, tilt: [s, k, 0] }]).getAttribute('position');
    // いちばん高い点は、+X へ倒れる
    let top = 0;
    for (let i = 1; i < plain.count; i++) if (plain.getY(i) > plain.getY(top)) top = i;
    expect(tilted.getX(top)).toBeGreaterThan(plain.getX(top) + 0.3);
    // 根元の中心からの距離は変わらない（回しただけ）
    const dist = (p: typeof plain, i: number): number => Math.hypot(p.getX(i) - 4, p.getY(i) - 1, p.getZ(i) + 2);
    for (let i = 0; i < plain.count; i += 37) expect(dist(tilted, i)).toBeCloseTo(dist(plain, i), 4);
    const c0 = mergeRocks([base]).getAttribute('color'), c1 = mergeRocks([{ ...base, tint: [0.5, 1, 2] }]).getAttribute('color');
    expect(c1.getX(9)).toBeCloseTo(c0.getX(9) * 0.5, 5);
    expect(c1.getY(9)).toBeCloseTo(c0.getY(9), 5);
    expect(c1.getZ(9)).toBeCloseTo(c0.getZ(9) * 2, 5);
    expect(mergeRocks([{ ...base, lod: 0 }]).getIndex()!.count).toBeLessThan(mergeRocks([base]).getIndex()!.count / 4);
  });
});

describe('盆地の外側の地面', () => {
  it('内側と同じ絵・同じ大きさ・同じ明るさ。色は、内側と同じ色むらの幅（急な斜面は、少しくすむ。遠くは霧の色へ）', () => {
    expect(paintsOuter({ fieldId: 'field.basin' })).toBe(true);
    expect(paintsOuter({ fieldId: 'field.whitefrost' })).toBe(false);
    expect(OUTER_TILE).toBe(ENV_TILES.grass.tile);
    expect(OUTER_GAIN).toBe(GROUND_GAIN);
    const mat = outerGroundMaterial();
    expect(mat.vertexColors).toBe(true);
    expect(mat.userData.outerGround).toBe(true);
    expect(mat.customProgramCacheKey()).toBe('outer-ground');
    mat.dispose();
    const paint = outerPaint({ land: 0x728451, sky: { horizon: 0xaebcab } }, 0x728451), col = new Color();
    // 湿った所（n = 1）は濃い緑、乾いた所（n = 0）は明るい黄み
    paint(col, 1, 0, 0);
    const wet = col.clone();
    paint(col, 0, 0, 0);
    const dry = col.clone();
    expect(wet.g).toBeCloseTo(TONE_COLORS.grass.lo[1] * 0.8, 5);
    expect(dry.r).toBeCloseTo(TONE_COLORS.grass.hi[0], 5);
    expect(dry.r).toBeGreaterThan(wet.r * 1.3);
    // 急な斜面: 少し暗く、緑が減る
    paint(col, 0.5, 1, 0);
    const rocky = col.clone();
    paint(col, 0.5, 0, 0);
    expect(rocky.g).toBeLessThan(col.g);
    expect(rocky.g / rocky.r).toBeLessThan(col.g / col.r);
    // 遠く: 霧の色（絵の平均の色で割った倍率）へ
    paint(col, 0.5, 0, 1);
    const mean = new Color(ENV_TILES.grass.mean).multiplyScalar(OUTER_GAIN), fog = new Color(0xaebcab);
    expect(col.b).toBeCloseTo(fog.b / mean.b, 5);
    // 急な斜面ほど、絵の模様を薄める（真上から貼った絵が、縦に伸びて縞に見えるため）
    expect(outerSteep(0.3)).toBe(0);
    expect(outerSteep(0.55)).toBe(0);
    expect(outerSteep(1)).toBeGreaterThan(0.4);
    expect(outerSteep(1.4)).toBe(1);
    expect(outerSteep(3)).toBe(1);
    expect(OUTER_STEEP_FLAT).toBeGreaterThan(0.5);
    // エリアごとの外側の色（涸れ沢 = 乾いた色）は、倍率にして残す
    const dryArea = outerPaint({ land: 0x928b6a, sky: { horizon: 0xaebcab } }, 0x728451);
    dryArea(col, 0.5, 0, 0);
    const d = col.clone();
    paint(col, 0.5, 0, 0);
    expect(d.r / d.g).toBeGreaterThan(col.r / col.g);
  });
});

describe('狩場の外側に置く（全エリア）', () => {
  it('盆地: 外側の地面は内側と同じ絵、木は葉の板つき、岩は依頼 10 の図をまとめた 1 つの形。景観の描画は 9 回まで', () => {
    const f = c.fields.get('field.basin')!;
    for (const a of f.areas) {
      const data = input(f.id, a), s = buildLandscapeSurface(data), g = buildLandscapeExterior(data, s);
      const relief = g.getObjectByName('field-exterior-relief') as Mesh;
      expect((relief.material as { userData: Record<string, unknown> }).userData.outerGround, a.id).toBe(true);
      // 頂点の色は、絵に掛ける倍率（1 のまわり）。uv は 6m で 1 枚
      const col = relief.geometry.getAttribute('color'), pos = relief.geometry.getAttribute('position'), uv = relief.geometry.getAttribute('uv');
      let sum = 0, n = 0;
      for (let i = 0; i < col.count; i++) {
        // 遠く（外周から 120m より先）は、霧の色へ寄せてある（倍率が大きい）。その手前を見る
        if (s.distance(pos.getX(i), pos.getZ(i)) > 120) continue;
        sum += col.getY(i);
        n++;
        expect(col.getY(i), a.id).toBeGreaterThan(0.55);
        expect(col.getY(i), a.id).toBeLessThan(1.3);
      }
      expect(sum / n, a.id).toBeGreaterThan(0.8);
      expect(sum / n, a.id).toBeLessThan(1.1);
      expect(uv.getX(7)).toBeCloseTo(pos.getX(7) / OUTER_TILE, 5);
      // 急な斜面の印（頂点ごと。0〜1）
      const steep = relief.geometry.getAttribute('aSteep');
      expect(steep.count, a.id).toBe(pos.count);
      for (let i = 0; i < steep.count; i += 13) {
        expect(steep.getX(i)).toBeGreaterThanOrEqual(0);
        expect(steep.getX(i)).toBeLessThanOrEqual(1);
      }
      const leaves = g.getObjectByName('field-exterior-leaves') as InstancedMesh | undefined;
      const st = g.userData.landscape as { trees: number; rocks: number; shrubs: number };
      // 葉の板: 木 1 本に 39 枚と、丘の茂み（v0.79.0）1 つに 3 枚
      if (st.trees > 0) expect(leaves!.count, a.id).toBe(st.trees * 39 + st.shrubs * 3);
      const stone = g.getObjectByName('field-exterior-rocks') as Mesh;
      expect((stone as unknown as { isInstancedMesh?: boolean }).isInstancedMesh, a.id).toBeUndefined();
      expect((stone.userData.rocks as unknown[]).length, a.id).toBe(st.rocks);
      expect((stone.material as { userData: Record<string, unknown> }).userData.rockArt, a.id).toBe(true);
      expect(g.children.length, a.id).toBeLessThanOrEqual(9);
      s.near.dispose();
    }
  });

  it('ほかの狩場の外側の地面は、これまでどおり（画像の材質。急な斜面の印は無い）', () => {
    const f = c.fields.get('field.whitefrost')!, a = f.areas[1]!, data = input(f.id, a), s = buildLandscapeSurface(data), g = buildLandscapeExterior(data, s);
    const relief = g.getObjectByName('field-exterior-relief') as Mesh;
    expect((relief.material as { userData: Record<string, unknown> }).userData.outerGround).toBeUndefined();
    expect((relief.material as { userData: Record<string, unknown> }).userData.surfaceImage).toBe('frost_snow');
    expect(relief.geometry.getAttribute('aSteep')).toBeUndefined();
    // 針葉樹: 葉の板は無い。岩は氷の素材
    expect(g.getObjectByName('field-exterior-leaves')).toBeUndefined();
    const stone = g.getObjectByName('field-exterior-rocks') as Mesh;
    expect((stone.material as { userData: Record<string, unknown> }).userData.surfaceImage).toBe('frost_ice');
    expect(stone.geometry.getAttribute('uv')).toBeDefined();
    s.near.dispose();
  });

  it('全 21 狩場の全エリア: 岩は、根元の輪が地面より下（浮いていない）。置く場所は外周の外。木と岩の三角形は、エリアごとに 9 万まで', () => {
    let rocks = 0, steep = 0, areas = 0, worst = -Infinity, most = 0, where = '';
    for (const f of c.fields.values()) {
      for (const a of f.areas) {
        const data = input(f.id, a), s = buildLandscapeSurface(data), g = buildLandscapeExterior(data, s);
        const stone = g.getObjectByName('field-exterior-rocks') as Mesh | undefined;
        const list = (stone?.userData.rocks ?? []) as { id: string; x: number; y: number; z: number; lod: 0 | 1 }[];
        if (stone) {
          // まとめた形の頂点を、岩ごとに、図の形の頂点と突き合わせる（順番は、置いた順）
          const world = stone.geometry.getAttribute('position');
          let at = 0;
          for (const r of list) {
            const local = rockArtGeometry(rockArt(r.id), r.lod).getAttribute('position');
            for (let i = 0; i < local.count; i++) {
              if (local.getY(i) >= 0) continue;
              const gap = world.getY(at + i) - s.height(world.getX(at + i), world.getZ(at + i));
              if (gap > worst) { worst = gap; where = `${f.id}/${a.id}`; }
            }
            at += local.count;
            expect(s.distance(r.x, r.z), `${f.id}/${a.id}`).toBeGreaterThan(5);
            rocks++;
          }
          expect(at).toBe(world.count);
        }
        const n = tris(g.getObjectByName('field-exterior-trunks') as InstancedMesh | undefined) + tris(g.getObjectByName('field-exterior-canopy') as InstancedMesh | undefined)
          + tris(g.getObjectByName('field-exterior-leaves') as InstancedMesh | undefined) + tris(stone);
        most = Math.max(most, n);
        expect(n, `${f.id}/${a.id}`).toBeLessThan(90000);
        steep += (g.userData.landscape as { steepRocks?: number }).steepRocks ?? 0;
        areas++;
        g.traverse((o) => {
          const m = o as Mesh;
          if (m.isMesh) m.geometry.dispose();
        });
        s.near.dispose();
      }
    }
    expect(areas).toBeGreaterThan(150);
    expect(rocks).toBeGreaterThan(areas * 20);
    // 根元の輪のいちばん浮いた所でも、地面より ROCK_ROOT_MIN は下
    expect(worst, where).toBeLessThan(-ROCK_ROOT_MIN + 1e-3);
    // 急な斜面（35° より急）に置いた岩は、全体の 2% より少ない
    expect(steep / rocks).toBeLessThan(0.02);
    expect(most).toBeGreaterThan(20000);
    expect(ROCK_SLOPE_MAX).toBe(0.7);
  });
});
