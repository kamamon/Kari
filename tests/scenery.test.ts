// 景色を現実に近づけた版（v0.19.0。docs/spec.md の 21 章）: 空・遠景の切り抜き・草の揺れ・岩の棚。
// v0.22.0 から、岩と外周の崖は、依頼 10 の図から作る（src/render/rockArt.ts。21.3）。その形の決まりも、ここで確かめる。
// 見た目そのものは画面で確かめる（tools/field-shots.mjs、tools/hub-shots.mjs）。ここでは、形と数の決まりを確かめる。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BufferGeometry, IcosahedronGeometry, MeshLambertMaterial, ShaderMaterial } from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/seededRng';
import { FOG_COLOR, SUN_DIR } from '../src/render/arena';
import { ENV_FAR, ENV_TILES, WIND, swayInWind } from '../src/render/envArt';
import { ROCK_REACH, cavityOf, ledgeGeometry, polyPath, wallPath } from '../src/render/rockGeo';
import {
  BIG_ROCKS, GATE_HALF, artCliffGeometry, cliffArt, cliffArtMaterial, cliffHeightScale, cliffReliefAt, cliffTopAt, mergeRocks, pathLengths, pathSOf, placeBigRock, planCliffs, rockArt,
  rockArtGeometry, rockArtMaterial,
} from '../src/render/rockArt';
import { CLIFF_ART, CLIFF_M, CLIFF_RELIEF, ROCK_ART, ROCK_TILES } from '../src/render/rockArtData';
import { AreaShape } from '../src/game/areaShape';
import { SKY_LOOKS, SkyDome } from '../src/render/sky';

const ROOT = join(__dirname, '..');
const measure = JSON.parse(readFileSync(join(ROOT, 'art-source/env/request8_v1.measure.json'), 'utf8')) as Record<string, {
  ridge?: { min: number; max: number; edge: number; alphaTop: number; alphaBottom: number };
  contrastBefore?: number; contrastAfter?: number;
}>;
const measure10 = JSON.parse(readFileSync(join(ROOT, 'art-source/env/request10_v1.measure.json'), 'utf8')) as {
  rocks: { id: string; normalized: [number, number, number]; diffPct: Record<string, number>; lumSd: number }[];
  cliffs: { id: string; edgesM: [number, number]; edgesPass: boolean; lumSd: number; empty: [number, number] | null }[];
  tiles: { id: string; lumSd: number; seamAfter: [number, number] }[];
  outputs: Record<string, { px: [number, number]; bytes: number }>;
};

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

describe('依頼 10 の岩の図から作る岩（v0.22.0）', () => {
  it('20 種。大きさは 3 つの図の平均で、図の値と合う。上の線は 0〜1 で、いちばん高い所は 1 に近い。図集の範囲は重ならない', () => {
    expect(ROCK_ART.length).toBe(20);
    const rects: [number, number, number, number][] = [];
    for (const a of ROCK_ART) {
      const m = measure10.rocks.find((r) => r.id === a.id)!;
      expect([a.w, a.d, a.h], a.id).toEqual(m.normalized);
      for (const p of [a.fp, a.sp]) {
        expect(p.length).toBe(64);
        expect(Math.min(...p), a.id).toBeGreaterThanOrEqual(0);
        expect(Math.max(...p), a.id).toBeGreaterThan(0.97);
        expect(Math.max(...p), a.id).toBeLessThanOrEqual(1);
      }
      expect(a.foot.length, a.id).toBeGreaterThanOrEqual(1);
      for (const r of [a.front, a.side, a.top]) {
        expect(r[0]).toBeGreaterThanOrEqual(0);
        expect(r[3]).toBeLessThanOrEqual(1);
        expect(r[2]).toBeGreaterThan(r[0]);
        expect(r[3]).toBeGreaterThan(r[1]);
        rects.push(r as [number, number, number, number]);
      }
    }
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]!, b = rects[j]!;
        const overlap = a[0] < b[2] - 1e-6 && b[0] < a[2] - 1e-6 && a[1] < b[3] - 1e-6 && b[1] < a[3] - 1e-6;
        expect(overlap, `${i} と ${j}`).toBe(false);
      }
    }
  });

  it('形: 根元は地面の下（埋まった岩）、いちばん高い所は図の高さ、平面の大きさの外へ出ない。上は上を向き、横は外を向く。色・図の位置・混ぜ方は数', () => {
    for (const a of ROCK_ART) {
      for (const lod of [1, 0] as const) {
        const g = rockArtGeometry(a, lod);
        const pos = g.getAttribute('position'), nor = g.getAttribute('normal'), wts = g.getAttribute('wts');
        let top = -Infinity, low = Infinity, topI = 0;
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
          if (y > top) [top, topI] = [y, i];
          low = Math.min(low, y);
          expect(Math.abs(x), a.id).toBeLessThanOrEqual(a.w / 2 + 1e-3);
          expect(Math.abs(z), a.id).toBeLessThanOrEqual(a.d / 2 + 1e-3);
          const sw = wts.getX(i) + wts.getY(i) + wts.getZ(i);
          expect(sw, a.id).toBeCloseTo(1, 4);
          for (const nm of ['uvF', 'uvS', 'uvT']) {
            const u = g.getAttribute(nm);
            expect(u.getX(i) >= 0 && u.getX(i) <= 1 && u.getY(i) >= 0 && u.getY(i) <= 1, `${a.id} ${nm}`).toBe(true);
          }
        }
        expect(low, a.id).toBeLessThan(-0.03);
        expect(low, a.id).toBeGreaterThan(-0.3);
        expect(top / a.h, a.id).toBeGreaterThan(lod ? 0.9 : 0.8);
        expect(top / a.h, a.id).toBeLessThanOrEqual(1.0001);
        // いちばん高い所は上を向く（傾いた板・立ち岩は、とがった先なので、斜め上まで）
        expect(nor.getY(topI), a.id).toBeGreaterThan(a.tags.includes('tall') ? 0.05 : 0.6);
        sane(g, `岩 ${a.id}`);
      }
      // 横の面は外を向く: 輪郭のすぐ内の輪（地面の少し上）の法線が、塊の中心から外へ
      const g = rockArtGeometry(a, 1);
      const pos = g.getAttribute('position'), nor = g.getAttribute('normal');
      let out = 0, total = 0;
      let base = 0;
      for (const part of a.foot) {
        const N = part.pts.length / 2;
        for (let j = 0; j < N; j++) {
          const i = base + N + j;
          const dx = pos.getX(i) - part.c[0], dz = pos.getZ(i) - part.c[1];
          total++;
          if (nor.getX(i) * dx + nor.getZ(i) * dz > 0) out++;
        }
        base += N * 8 + 1;
      }
      expect(out / total, a.id).toBeGreaterThan(0.85);
    }
  });

  it('当たりの円柱に置く: 根元のいちばん外は、当たりの半径の ROCK_REACH 倍。高さは、図の比の 0.8〜1.25 倍まで。種が同じなら同じ岩', () => {
    expect(BIG_ROCKS.length).toBeGreaterThanOrEqual(10);
    const rng = new SeededRng(17);
    for (let k = 0; k < 60; k++) {
      const r = { x: 0, z: 0, r: 1 + rng.next() * 2, h: 1.3 + rng.next() * 3 };
      const p = placeBigRock(new SeededRng(100 + k), r, ROCK_REACH);
      expect(BIG_ROCKS).toContain(p.id);
      const a = rockArt(p.id);
      let reach = 0;
      for (const part of a.foot) for (let i = 0; i < part.pts.length; i += 2) reach = Math.max(reach, Math.hypot(part.pts[i]! * p.sx, part.pts[i + 1]! * p.sz));
      expect(reach / r.r).toBeCloseTo(ROCK_REACH, 5);
      expect(Math.max(p.sx, p.sz) / Math.min(p.sx, p.sz)).toBeLessThanOrEqual(1.25 + 1e-9);
      const s = Math.sqrt(p.sx * p.sz);
      expect(p.sy / s).toBeGreaterThanOrEqual(0.8 - 1e-9);
      expect(p.sy / s).toBeLessThanOrEqual(1.25 + 1e-9);
      expect(placeBigRock(new SeededRng(100 + k), r, ROCK_REACH)).toEqual(p);
    }
    const geo = mergeRocks([placeBigRock(new SeededRng(1), { x: 5, z: -3, r: 2, h: 3 }, ROCK_REACH), placeBigRock(new SeededRng(2), { x: -9, z: 4, r: 1.4, h: 2 }, ROCK_REACH)]);
    sane(geo, '2 つの岩をまとめた形');
  });

  it('素材: 岩は 3 つの図を混ぜ、崖は図を切り抜く。どちらも岩肌を細かな模様として掛ける（シェーダーへ入る）', () => {
    for (const [mat, key] of [[rockArtMaterial(), 'rock-art-v1'], [cliffArtMaterial(), 'cliff-art-v1']] as const) {
      const sh = { uniforms: {} as Record<string, unknown>, vertexShader: 'void main() {\n#include <begin_vertex>\n#include <project_vertex>\n}', fragmentShader: 'void main() {\n#include <map_fragment>\n}' };
      mat.onBeforeCompile(sh as never, undefined as never);
      expect(mat.customProgramCacheKey()).toBe(key);
      expect(sh.uniforms.rockDetail).toBeDefined();
      expect(sh.fragmentShader).toContain('detailMean');
      expect(sh.vertexShader).toContain('vRockW');
    }
    expect(cliffArtMaterial().alphaTest).toBe(0.5);
  });
});

describe('依頼 10 の崖の図から作る外周の崖（v0.22.0）', () => {
  const field = JSON.parse(readFileSync(join(ROOT, 'public/data/fields/basin.json'), 'utf8')) as {
    areas: { id: string; kind: string; bounds: { minX: number; maxX: number; minZ: number; maxZ: number }; shape: [number, number][]; exits: { x: number; z: number }[] }[];
  };

  it('20 種。端の高さは 4.5m（低い 3 種は 3m）に ±0.3m。出口のわきの 2 つは、出口の側が何も無い。凹凸は 96 × 36', () => {
    expect(CLIFF_ART.length).toBe(20);
    for (const c of CLIFF_ART) {
      const m = measure10.cliffs.find((x) => x.id === c.id)!;
      expect(m.edgesPass, c.id).toBe(true);
      expect(c.top.length).toBe(256);
      expect(Math.min(...c.top), c.id).toBeGreaterThanOrEqual(0);
      expect(atob(c.relief).length).toBe(CLIFF_RELIEF[0] * CLIFF_RELIEF[1]);
      for (const y of [0.5, 2, 4]) for (const x of [1, 12, 23]) expect(Math.abs(cliffReliefAt(c, x, y))).toBeLessThanOrEqual(1);
    }
    expect(cliffArt('C-19').exit).toBe('right');
    expect(cliffArt('C-20').exit).toBe('left');
    expect(cliffTopAt(cliffArt('C-19'), 23)).toBeLessThan(0.05);
    expect(cliffTopAt(cliffArt('C-20'), 1)).toBeLessThan(0.05);
    expect(cliffTopAt(cliffArt('C-19'), 2)).toBeGreaterThan(4);
    expect(cliffTopAt(cliffArt('C-20'), 22)).toBeGreaterThan(4);
  });

  it('並べ方: 出口の前（±4.5m）には壁が無く、ほかは、すき間なく図が並ぶ。同じ図は続かない。横の伸び縮みは 0.7〜1.25 倍（比で 1 に近くなる数の図を入れる）', () => {
    for (const a of field.areas) {
      const path = polyPath(a.shape, 0.5, 0.5);
      const { cum, L } = pathLengths(path);
      const gs = a.exits.map((e) => pathSOf(path, cum, e.x, e.z));
      const pieces = planCliffs(L, gs, new SeededRng(3), { low: false, nest: a.kind === 'nest' });
      const walled = (s: number): boolean => pieces.some((p) => {
        const c = cliffArt(p.id);
        const x = ((((s - p.s0) % L) + L) % L) / p.k;
        return x >= 0 && x <= CLIFF_M && cliffTopAt(c, x) > 0.05;
      });
      for (let s = 0; s < L; s += 0.5) {
        const gd = Math.min(...gs.map((g) => Math.min(Math.abs(s - g), L - Math.abs(s - g))));
        if (gd < GATE_HALF - 0.3) expect(walled(s), `${a.id} s=${s.toFixed(1)}（出口の前）`).toBe(false);
        if (gd > GATE_HALF + 0.6) expect(walled(s), `${a.id} s=${s.toFixed(1)}`).toBe(true);
      }
      for (let i = 0; i < pieces.length; i++) {
        const p = pieces[i]!;
        expect(p.k, a.id).toBeGreaterThan(0.7);
        expect(p.k, a.id).toBeLessThan(1.25);
        if (i > 0 && !cliffArt(p.id).exit) expect(p.id, a.id).not.toBe(pieces[i - 1]!.id);
      }
    }
  });

  it('形: 面は歩ける範囲へ入らない（外周の外 0.05m より外）。出口の前は開く。ほかは 4m より高い。同じ種なら同じ形。三角形は 2 万より少ない', () => {
    for (const a of field.areas) {
      const s = new AreaShape(a.shape);
      const o = { path: wallPath(a.bounds, a.shape, 0.5, 0.5), gates: a.exits, vk: 1.087, low: false, nest: a.kind === 'nest', moss: 0.6 };
      const { face, cap } = artCliffGeometry(o, new SeededRng(5));
      const pos = face.getAttribute('position');
      let gateTop = -Infinity, wallTop = -Infinity;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        expect(s.signedDistance(x, z), `${a.id} 頂点 ${i}`).toBeLessThan(-0.05);
        const dGate = Math.min(...a.exits.map((e) => Math.hypot(x - e.x, z - e.z)));
        if (dGate < 3.5) gateTop = Math.max(gateTop, y);
        if (dGate > 16) wallTop = Math.max(wallTop, y);
      }
      expect(gateTop, a.id).toBeLessThan(0.6);
      expect(wallTop, a.id).toBeGreaterThan(4);
      sane(face, `${a.id} の崖の面`);
      sane(cap, `${a.id} の崖の背`);
      const tris = (face.getIndex()!.count + cap.getIndex()!.count) / 3;
      expect(tris, a.id).toBeLessThan(20000);
      const again = artCliffGeometry(o, new SeededRng(5)).face.getAttribute('position');
      expect(Array.from(again.array as Float32Array)).toEqual(Array.from(pos.array as Float32Array));
    }
    // 11 エリアの頂点（約 6 万）を外周と比べるので重い（手元 2 秒、Actions では 5.5 秒かかって、既定の 5 秒を超えた）
  }, 30000);

  it('崖の高さは外周に沿って変わる（v0.50.0。#19 の F06「同じ高さの全周の崖を減らす」）: 輪の始めと終わりで同じ、幅は 1 ± vary の中', () => {
    for (const a of field.areas) {
      const path = wallPath(a.bounds, a.shape, 0.5, 0.5);
      const { L } = pathLengths(path);
      const vals = Array.from({ length: 200 }, (_, i) => cliffHeightScale(path, L, 0.26, (i / 200) * L));
      expect(Math.max(...vals), a.id).toBeLessThanOrEqual(1.26 + 1e-9);
      expect(Math.min(...vals), a.id).toBeGreaterThanOrEqual(0.74 - 1e-9);
      // どのエリアも、高い所と低い所の比が 1.25 倍より大きい（同じ高さの輪にしない）
      expect(Math.max(...vals) / Math.min(...vals), a.id).toBeGreaterThan(1.25);
      expect(cliffHeightScale(path, L, 0.26, 0)).toBeCloseTo(cliffHeightScale(path, L, 0.26, L), 9);
      expect(cliffHeightScale(path, L, 0, L * 0.3)).toBe(1);
    }
    // 形に効く: エリア 2 の崖の面の、同じ頂点の高さを、変えない時と比べる（頂点の数は同じ）。2m より高い所で、低くなる所と高くなる所がある
    const a = field.areas.find((x) => x.id === 'a2')!;
    const o = { path: wallPath(a.bounds, a.shape, 0.5, 0.5), gates: a.exits, vk: 1.087, low: false, nest: false, moss: 0.6 };
    const flat = artCliffGeometry(o, new SeededRng(5)).face.getAttribute('position');
    const varied = artCliffGeometry({ ...o, vary: 0.26 }, new SeededRng(5)).face.getAttribute('position');
    expect(varied.count).toBe(flat.count);
    let lo = Infinity, hi = 0;
    for (let i = 0; i < flat.count; i++) {
      if (flat.getY(i) < 2) continue;
      const r = varied.getY(i) / flat.getY(i);
      lo = Math.min(lo, r);
      hi = Math.max(hi, r);
    }
    expect(lo).toBeLessThan(0.85);
    expect(hi).toBeGreaterThan(1.15);
  });

  it('里（低い崖）は、端の高さ 3m の図だけで、高さの倍率を掛ける', () => {
    const b = { minX: -20, maxX: 20, minZ: -15, maxZ: 15 };
    const { pieces } = artCliffGeometry({ path: wallPath(b, null, 0.5, 0.5), gates: [{ x: 0, z: -15 }], vk: 2.2 / 3, low: true, nest: false, moss: 0.5 }, new SeededRng(1));
    for (const p of pieces) {
      const c = cliffArt(p.id);
      if (c.exit) continue;
      expect(Math.max(...c.edges), p.id).toBeLessThan(3.6);
    }
  });
});

describe('草の揺れと、岩の絵の濃淡', () => {
  it('草の素材は、風の時刻（WIND）を読み、頂点を高さに応じてずらす（根元は動かない）', () => {
    const mat = new MeshLambertMaterial();
    swayInWind(mat);
    const sh = { uniforms: {} as Record<string, unknown>, vertexShader: 'void main() {\n#include <begin_vertex>\n#include <project_vertex>\n}', fragmentShader: 'void main() {\n#include <map_fragment>\n}' };
    mat.onBeforeCompile(sh as never, undefined as never);
    expect(sh.uniforms.uWind).toBe(WIND);
    expect(sh.vertexShader).toContain('uniform float uWind;');
    expect(sh.vertexShader).toContain('transformed.xz += lw.xz * hgt;');
    // 揺れの計算は、もとの頂点の位置を決めた後に入る
    expect(sh.vertexShader.indexOf('#include <begin_vertex>')).toBeLessThan(sh.vertexShader.indexOf('transformed.xz +='));
    // 揺らす素材は、揺らさない素材と別のシェーダーになる
    expect(mat.customProgramCacheKey()).toBe('sway-in-wind');
    // 根元の陰（v0.76.0。D-176）: 板の高さを渡して、根元を 0.6 倍に暗くし、0.14m で元の明るさへ戻す（絵を読んだ後に掛ける）
    expect(sh.vertexShader).toContain('vRootH = position.y;');
    expect(sh.fragmentShader).toContain('varying float vRootH;');
    expect(sh.fragmentShader).toContain('diffuseColor.rgb *= mix( 0.60, 1.0, smoothstep( 0.0, 0.14, vRootH ) );');
    expect(sh.fragmentShader.indexOf('#include <map_fragment>')).toBeLessThan(sh.fragmentShader.indexOf('vRootH )'));
  });

  it('岩肌（v0.22.0 から依頼 10 の 4 枚）は、濃淡がはっきり（明るさのばらつき 18 以上）で、上下左右の端がつながる', () => {
    expect(ENV_TILES.rock.file).toBe(ROCK_TILES.t01.file);
    expect(ENV_TILES.vein.file).toBe(ROCK_TILES.t03.file);
    for (const t of measure10.tiles) {
      expect(t.lumSd, t.id).toBeGreaterThanOrEqual(18);
      for (const r of t.seamAfter) expect(r, t.id).toBeLessThan(1.3);
    }
  });
});

describe('岩の棚（v0.20.0）', () => {
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
