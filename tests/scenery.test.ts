// 景色を現実に近づけた版（v0.19.0。docs/spec.md の 21 章）: 空・遠景の切り抜き・岩と岩壁の形・草の揺れ・岩の絵の濃淡。
// 見た目そのものは画面で確かめる（tools/field-shots.mjs、tools/hub-shots.mjs）。ここでは、形と数の決まりを確かめる。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BufferGeometry, IcosahedronGeometry, MeshLambertMaterial, ShaderMaterial } from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/seededRng';
import { FOG_COLOR, SUN_DIR } from '../src/render/arena';
import { ENV_FAR, ENV_TILES, WIND, swayInWind } from '../src/render/envArt';
import { ROCK_REACH, boulderGeometry, cavityOf, cliffGeometry, ledgeGeometry } from '../src/render/rockGeo';
import { AreaShape } from '../src/game/areaShape';
import { SKY_LOOKS, SkyDome } from '../src/render/sky';

const ROOT = join(__dirname, '..');
const measure = JSON.parse(readFileSync(join(ROOT, 'art-source/env/request8_v1.measure.json'), 'utf8')) as Record<string, {
  ridge?: { min: number; max: number; edge: number; alphaTop: number; alphaBottom: number };
  contrastBefore?: number; contrastAfter?: number;
}>;

/** 頂点の位置・色がすべて数で、色は 0〜2 に収まる */
function sane(g: BufferGeometry, label: string): void {
  const pos = g.getAttribute('position'), col = g.getAttribute('color'), nor = g.getAttribute('normal');
  expect(col, `${label} 色`).toBeDefined();
  expect(col.count).toBe(pos.count);
  for (let i = 0; i < pos.count; i++) {
    expect(Number.isFinite(pos.getX(i) + pos.getY(i) + pos.getZ(i)), label).toBe(true);
    expect(Number.isFinite(nor.getX(i) + nor.getY(i) + nor.getZ(i)), label).toBe(true);
    for (const c of [col.getX(i), col.getY(i), col.getZ(i)]) {
      expect(c, label).toBeGreaterThanOrEqual(0);
      expect(c, label).toBeLessThan(2);
    }
  }
}

describe('空と遠景', () => {
  it('遠景の絵は、空の部分が透明で、山の部分は透けない（空はゲームの側で描く）', () => {
    for (const f of Object.values(ENV_FAR).flat()) {
      const r = measure[f]!.ridge!;
      expect(r, f).toBeDefined();
      expect(r.alphaTop, f).toBeLessThan(0.05);
      expect(r.alphaBottom, f).toBeGreaterThan(0.95);
      // 稜線は、絵の上 1 割より下、下 2 割より上にある
      expect(r.min, f).toBeGreaterThan(0.1);
      expect(r.max, f).toBeLessThan(0.8);
      // ゲームで読む絵（WebP）に、透明の情報が入っている（VP8X の印の alpha）
      const b = readFileSync(join(ROOT, 'public/assets/textures/env', `${f}.webp`));
      expect(b.toString('ascii', 12, 16), f).toBe('VP8X');
      expect(b[20]! & 0x10, f).toBe(0x10);
    }
  });

  it('空の地平線の色は霧の色と同じ（遠くの地面・山すそ・空が、つなぎ目なく溶ける）。日の位置は光の向きと同じ', () => {
    for (const [place, look] of Object.entries(SKY_LOOKS)) {
      expect(look.horizon, place).toBe(FOG_COLOR);
      expect(look.coverage, place).toBeGreaterThan(0.3);
      expect(look.coverage, place).toBeLessThan(0.8);
      const sky = new SkyDome(look, SUN_DIR);
      const u = (sky.mesh.material as ShaderMaterial).uniforms;
      expect(u.uSunDir!.value.distanceTo(SUN_DIR), place).toBeLessThan(1e-6);
      // 太陽は空の上の方（光は上から当たる）
      expect(SUN_DIR.y).toBeGreaterThan(0.6);
      // 雲は時間で流れる
      sky.setTime(12.5);
      expect(u.uTime!.value).toBe(12.5);
      // 空の球は、遠景の筒（300m）より外、カメラの奥の面（400m）より内
      sky.mesh.geometry.computeBoundingSphere();
      const r = sky.mesh.geometry.boundingSphere!.radius;
      expect(r).toBeGreaterThan(300);
      expect(r).toBeLessThan(400);
    }
  });
});

describe('岩壁', () => {
  const bounds = { minX: -30, maxX: 26, minZ: -24, maxZ: 32 };
  const gates = [{ x: 0, z: -24 }, { x: 26, z: 4 }];

  it('内側の面は、歩ける範囲の四角へ入り込まない（当たりは四角のまま）', () => {
    for (const seed of [1, 7, 42, 9001]) {
      const g = cliffGeometry(new SeededRng(seed), { bounds, gates, height: [5, 5.5], moss: 0.6, veins: 0.3 }, ENV_TILES.rock.tile);
      const pos = g.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), z = pos.getZ(i);
        const inside = x > bounds.minX + 0.01 && x < bounds.maxX - 0.01 && z > bounds.minZ + 0.01 && z < bounds.maxZ - 0.01;
        expect(inside, `seed ${seed} 頂点 ${i} (${x.toFixed(2)}, ${z.toFixed(2)})`).toBe(false);
      }
    }
  });

  it('出口の前は開いていて（4m の内は低い）、ほかは高い壁になる。形と色は数で、重さは 1 万面より小さい', () => {
    const g = cliffGeometry(new SeededRng(3), { bounds, gates, height: [5, 5.5], moss: 0.6, veins: 0.3 }, ENV_TILES.rock.tile);
    const pos = g.getAttribute('position');
    let gateTop = -Infinity, wallTop = -Infinity, far = 0, tall = 0;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const dGate = Math.min(...gates.map((gt) => Math.hypot(x - gt.x, z - gt.z)));
      if (dGate < 4) gateTop = Math.max(gateTop, y);
      if (dGate > 12) {
        wallTop = Math.max(wallTop, y);
        far++;
        if (y > 3) tall++;
      }
    }
    expect(gateTop).toBeLessThan(0.3);
    expect(wallTop).toBeGreaterThan(5);
    // 出口から離れた所の頂点の多くが、背より高い所にある（低い所だけの壁にならない）
    expect(tall / far).toBeGreaterThan(0.3);
    expect(g.getIndex()!.count / 3).toBeLessThan(10000);
    sane(g, '岩壁');
  });

  it('同じ種なら、同じ形になる（エリアを作り直しても、景色が変わらない）', () => {
    const a = cliffGeometry(new SeededRng(11), { bounds, gates, height: [5, 5.5] }, 3).getAttribute('position');
    const b = cliffGeometry(new SeededRng(11), { bounds, gates, height: [5, 5.5] }, 3).getAttribute('position');
    expect(Array.from(a.array as Float32Array)).toEqual(Array.from(b.array as Float32Array));
  });
});

describe('岩', () => {
  it('大きさ 1 の岩: 根元は地面の下へ埋まり、高さは 0.5〜1.2。根元の広がりは、いちばん外で ROCK_REACH（当たりの円柱から大きくはみ出さない）', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const g = boulderGeometry(new SeededRng(seed), { detail: 3, rough: 0.5, moss: 0.6, vein: seed % 3 === 0, strata: 0.8, cuts: seed % 7 });
      g.computeBoundingBox();
      const b = g.boundingBox!;
      expect(b.min.y, `seed ${seed}`).toBeLessThan(0);
      expect(b.max.y, `seed ${seed}`).toBeGreaterThan(0.5);
      expect(b.max.y, `seed ${seed}`).toBeLessThan(1.2);
      const pos = g.getAttribute('position');
      let reach = 0, sum = 0, n = 0;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i), r = Math.hypot(pos.getX(i), pos.getZ(i));
        if (y >= 0 && y <= 0.45) {
          reach = Math.max(reach, r);
          sum += r;
          n++;
        }
      }
      expect(reach, `seed ${seed}`).toBeCloseTo(ROCK_REACH, 5);
      expect(ROCK_REACH).toBeLessThan(1.1);
      // 平均では、当たりの円柱の 7 割より外に、岩の面がある（当たりと見た目の間が、大きく空かない）
      expect(sum / n, `seed ${seed}`).toBeGreaterThan(0.7);
      sane(g, `岩 ${seed}`);
    }
  });

  it('くぼみの深さ: 丸い球（出っ張りだけ）では、どの頂点も 0 以下になる', () => {
    let g: BufferGeometry = new IcosahedronGeometry(1, 2);
    g.deleteAttribute('uv');
    g.deleteAttribute('normal');
    g = mergeVertices(g);
    g.computeVertexNormals();
    const cav = cavityOf(g);
    expect(cav.length).toBe(g.getAttribute('position').count);
    for (const c of cav) expect(c).toBeLessThanOrEqual(1e-6);
    expect(Math.min(...cav)).toBeLessThan(-0.001);
  });
});

describe('草の揺れと、岩の絵の濃淡', () => {
  it('草の素材は、風の時刻（WIND）を読み、頂点を高さに応じてずらす（根元は動かない）', () => {
    const mat = new MeshLambertMaterial();
    swayInWind(mat);
    const sh = { uniforms: {} as Record<string, unknown>, vertexShader: 'void main() {\n#include <begin_vertex>\n#include <project_vertex>\n}', fragmentShader: '' };
    mat.onBeforeCompile(sh as never, undefined as never);
    expect(sh.uniforms.uWind).toBe(WIND);
    expect(sh.vertexShader).toContain('uniform float uWind;');
    expect(sh.vertexShader).toContain('transformed.xz += lw.xz * hgt;');
    // 揺れの計算は、もとの頂点の位置を決めた後に入る
    expect(sh.vertexShader.indexOf('#include <begin_vertex>')).toBeLessThan(sh.vertexShader.indexOf('transformed.xz +='));
    // 揺らす素材は、揺らさない素材と別のシェーダーになる
    expect(mat.customProgramCacheKey()).toBe('sway-in-wind');
  });

  it('岩の 2 枚の絵は、元の絵より濃淡が強い（割れ目と面の陰が見える）。平均の色は変わらない', () => {
    for (const t of [ENV_TILES.rock, ENV_TILES.vein]) {
      const m = measure[t.file]!;
      expect(m.contrastAfter!, t.file).toBeGreaterThan(m.contrastBefore! * 1.35);
    }
  });
});

describe('自然な形のエリアの岩壁・埋まった岩・岩の棚（v0.20.0）', () => {
  const field = JSON.parse(readFileSync(join(ROOT, 'public/data/fields/basin.json'), 'utf8')) as {
    areas: { id: string; bounds: { minX: number; maxX: number; minZ: number; maxZ: number }; shape: [number, number][]; exits: { x: number; z: number }[] }[];
  };

  it('岩壁は外周に沿い、歩ける範囲へ入り込まない（狭い谷・広い原・巣）。出口の前は開く', () => {
    for (const id of ['a1', 'a2', 'a5', 'a10']) {
      const a = field.areas.find((x) => x.id === id)!;
      const s = new AreaShape(a.shape);
      const g = cliffGeometry(new SeededRng(5), { bounds: a.bounds, shape: s.points(), gates: a.exits, height: [5, 5.5], moss: 0.6, veins: 0.3 }, ENV_TILES.rock.tile);
      const pos = g.getAttribute('position');
      let gateTop = -Infinity, wallTop = -Infinity;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        expect(s.signedDistance(x, z), `${id} 頂点 ${i}`).toBeLessThan(0.01);
        const dGate = Math.min(...a.exits.map((e) => Math.hypot(x - e.x, z - e.z)));
        if (dGate < 4) gateTop = Math.max(gateTop, y);
        if (dGate > 14) wallTop = Math.max(wallTop, y);
      }
      expect(gateTop, id).toBeLessThan(0.3);
      expect(wallTop, id).toBeGreaterThan(5);
      sane(g, `${id} の岩壁`);
    }
  });

  it('埋まった岩: いちばん太い所が地面の高さにあり（当たりの半径の 1.06 倍）、上ほど細い。高さは 0〜1 で、地面の下は浅い', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const g = boulderGeometry(new SeededRng(seed), { detail: 3, rough: 0.5, moss: 0.6, strata: 0.7, cuts: 4, bury: 0.35 + (seed % 5) * 0.05 });
      const pos = g.getAttribute('position');
      let top = -Infinity, low = Infinity, base = 0, upper = 0;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i), r = Math.hypot(pos.getX(i), pos.getZ(i));
        top = Math.max(top, y);
        low = Math.min(low, y);
        if (y >= -0.02 && y <= 0.2) base = Math.max(base, r);
        if (y >= 0.6) upper = Math.max(upper, r);
      }
      expect(top, `seed ${seed}`).toBeCloseTo(1, 5);
      expect(low, `seed ${seed}`).toBeGreaterThan(-0.15);
      expect(base, `seed ${seed}`).toBeCloseTo(ROCK_REACH, 5);
      expect(upper, `seed ${seed}`).toBeLessThan(base * 0.95);
      sane(g, `埋まった岩 ${seed}`);
    }
  });

  it('岩の棚: 上の面は高さ h で上を向き、横の面は外を向く。見た目は、当たりの四角から 0.25m までしかはみ出さない', () => {
    const p = { minX: -6, maxX: 8, minZ: 2, maxZ: 12, h: 0.3 };
    const g = ledgeGeometry(new SeededRng(4), p, 6, 3);
    const pos = g.getAttribute('position'), nor = g.getAttribute('normal');
    const [top, side] = g.groups;
    expect(top!.materialIndex).toBe(0);
    expect(side!.materialIndex).toBe(1);
    const idx = g.getIndex()!;
    const cx = (p.minX + p.maxX) / 2, cz = (p.minZ + p.maxZ) / 2;
    for (let k = top!.start; k < top!.start + top!.count; k++) {
      const i = idx.getX(k);
      expect(pos.getY(i)).toBeCloseTo(p.h, 6);
      expect(nor.getY(i)).toBeGreaterThan(0.5);
    }
    let outward = 0, total = 0;
    for (let k = side!.start; k < side!.start + side!.count; k++) {
      const i = idx.getX(k);
      const x = pos.getX(i), z = pos.getZ(i);
      expect(x).toBeGreaterThan(p.minX - 0.25 - 0.16);
      expect(x).toBeLessThan(p.maxX + 0.25 + 0.16);
      expect(z).toBeGreaterThan(p.minZ - 0.25 - 0.16);
      expect(z).toBeLessThan(p.maxZ + 0.25 + 0.16);
      total++;
      if (nor.getX(i) * (x - cx) + nor.getZ(i) * (z - cz) > 0) outward++;
    }
    expect(outward / total).toBeGreaterThan(0.95);
  });
});
