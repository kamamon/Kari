// 景色に貼る絵（依頼 8、v0.13.0。src/render/envArt.ts と src/render/hubScene.ts）。
// 絵そのものの見え方は画面で確かめる（tools/field-shots.mjs、tools/hub-shots.mjs）。ここでは、
// 「絵のファイルがある」「切り抜きの範囲が、測った値と合っている」「建物の形が、依頼書の大きさになっている」を確かめる。
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { BoxGeometry, Box3, Mesh, PlaneGeometry, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { ENV_FAR, ENV_SPRITES, ENV_TILES, boxUv } from '../src/render/envArt';
import { BUILDINGS } from '../src/render/hubScene';
import { DETAIL_TILES } from '../src/render/rockArt';
import { CLIFF_ATLAS, ROCK_ATLAS, ROCK_TILES } from '../src/render/rockArtData';
import { loadContent } from './helpers';

const ROOT = join(__dirname, '..');
const ENV = join(ROOT, 'public/assets/textures/env');
const measure = JSON.parse(readFileSync(join(ROOT, 'art-source/env/request8_v1.measure.json'), 'utf8')) as Record<string, {
  kind: string; wrap?: string; mean?: string; seamAfter?: [number, number]; topAfter?: string; bottomAfter?: string; edgeStep?: number;
  cells?: { x0: number; x1: number; y0: number; y1: number; rootX: number }[];
}>;
const hex = (n: number): string => `#${n.toString(16).padStart(6, '0').toUpperCase()}`;
/** 依頼 10（v0.22.0。tools/rock-art.py）の測った値 */
const measure10 = JSON.parse(readFileSync(join(ROOT, 'art-source/env/request10_v1.measure.json'), 'utf8')) as {
  tiles: { id: string; file: string; seamAfter: [number, number] }[];
  outputs: Record<string, { px: [number, number]; bytes: number }>;
};
const tile10 = new Set<string>(Object.values(ROCK_TILES).map((t) => t.file));

describe('景色の絵のファイル', () => {
  // 依頼 8 の 15 枚（岩肌の 2 枚は、v0.22.0 から依頼 10 の岩肌に替えた）と、依頼 10 の 6 枚（岩と崖の図集・岩肌 4 枚）
  const used8 = [
    ...Object.values(ENV_TILES).map((t) => t.file).filter((f) => !tile10.has(f)),
    ...Object.values(ENV_FAR).flat(),
    ...Object.values(ENV_SPRITES).map((s) => s.file),
    ...Object.values(BUILDINGS).map((b) => b.file),
  ];
  const used10 = [ROCK_ATLAS, CLIFF_ATLAS, ...tile10];
  const used = [...used8, ...used10];

  it('依頼 8 の 15 枚と、依頼 10 の 6 枚を使っていて、どれも、元の絵と、ゲームで読む絵の両方がある', () => {
    expect(new Set(used8).size).toBe(15);
    expect(new Set(used10).size).toBe(6);
    for (const f of used8) {
      expect(existsSync(join(ROOT, 'art-source/env', `${f}.png`)), `元の絵 ${f}.png`).toBe(true);
      expect(measure[f], `測った値 ${f}`).toBeDefined();
    }
    for (const f of tile10) expect(existsSync(join(ROOT, 'art-source/env/tiles', `${f}.png`)), `元の絵 ${f}.png`).toBe(true);
    expect(readdirSync(join(ROOT, 'art-source/env/rocks')).filter((f) => f.endsWith('.png')).length).toBe(20);
    expect(readdirSync(join(ROOT, 'art-source/env/cliffs')).filter((f) => f.endsWith('.png')).length).toBe(20);
    for (const f of used10) expect(measure10.outputs[f], `測った値 ${f}`).toBeDefined();
    for (const f of used) expect(existsSync(join(ENV, `${f}.webp`)), `読む絵 ${f}.webp`).toBe(true);
    // 依頼 10 の岩肌 4 枚は、どれもゲームのどこかで貼る（地面・段差・崖の背の絵か、岩と崖の細かな模様）
    const refs = new Set<string>([...Object.values(ENV_TILES).map((t) => t.file), ...Object.values(DETAIL_TILES).map((k) => ROCK_TILES[k].file)]);
    for (const f of tile10) expect(refs.has(f), `使っていない岩肌 ${f}`).toBe(true);
  });

  it('ゲームで読む絵の置き場に、使っていない絵が無い。合わせて 5MB を超えない（v0.22.0 で、岩と崖の図集 2 枚が約 2.4MB）', () => {
    const files = readdirSync(ENV);
    expect(files.sort()).toEqual(used.map((f) => `${f}.webp`).sort());
    const total = files.reduce((n, f) => n + statSync(join(ENV, f)).size, 0);
    expect(total).toBeLessThan(5 * 1024 * 1024);
  });
});

describe('空と遠景', () => {
  it('上の帯は空の色、下の帯は霧の色（画面の霧と同じ色）になっている', () => {
    for (const f of Object.values(ENV_FAR).flat()) {
      expect(measure[f]!.topAfter, f).toBe('#C5D2CB');
      expect(measure[f]!.bottomAfter, f).toBe('#AEBCAB');
    }
  });

  it('左右の端は、同じ場所の 2 枚で同じ色になっている（どの順でつないでも、段が出ない）', () => {
    for (const f of Object.values(ENV_FAR).flat()) expect(measure[f]!.edgeStep, f).toBeLessThan(0.5);
  });
});

describe('繰り返して敷く絵', () => {
  it('平均の色（絵が届くまでの色）が、測った値と合っている', () => {
    for (const t of Object.values(ENV_TILES)) {
      if (tile10.has(t.file)) {
        const m = Object.values(ROCK_TILES).find((x) => x.file === t.file)!.mean;
        expect(t.mean, t.file).toBe((Math.round(m[0] * 255) << 16) | (Math.round(m[1] * 255) << 8) | Math.round(m[2] * 255));
      } else expect(hex(t.mean), t.file).toBe(measure[t.file]!.mean);
    }
  });

  it('そのまま繰り返す絵は、つなぎ目が見えない。直していない絵（石畳）は、鏡写しに繰り返す', () => {
    for (const t of Object.values(ENV_TILES)) {
      if (tile10.has(t.file)) {
        expect(t.mirror, t.file).toBe(false);
        for (const s of measure10.tiles.find((x) => x.file.endsWith(`${t.file}.png`))!.seamAfter) expect(s, t.file).toBeLessThan(1.3);
        continue;
      }
      const m = measure[t.file]!;
      expect(m.wrap, t.file).toBe(t.mirror ? 'mirror' : 'repeat');
      if (!t.mirror) for (const s of m.seamAfter!) expect(s, t.file).toBeLessThan(1.3);
    }
  });

  it('boxUv: 上を向いた面は x・z、横を向いた面は 水平・高さ から uv を作る（1 = tile m）', () => {
    const box = new Mesh(new BoxGeometry(6, 3, 12));
    box.position.set(30, 1.5, -6);
    boxUv(box, 3, 6);
    const pos = box.geometry.getAttribute('position'), uv = box.geometry.getAttribute('uv');
    const span = (axis: 'x' | 'y' | 'z', face: (n: Vector3) => boolean): [number, number] => {
      let du = 0, dv = 0;
      const a = new Vector3(), b = new Vector3(), c = new Vector3(), n = new Vector3();
      for (let i = 0; i < pos.count; i += 3) {
        a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
        n.crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();
        if (!face(n)) continue;
        const us = [uv.getX(i), uv.getX(i + 1), uv.getX(i + 2)], vs = [uv.getY(i), uv.getY(i + 1), uv.getY(i + 2)];
        du = Math.max(du, Math.max(...us) - Math.min(...us));
        dv = Math.max(dv, Math.max(...vs) - Math.min(...vs));
      }
      void axis;
      return [du, dv];
    };
    // 上の面（6 × 12m）は、6m の絵で 1 × 2 枚ぶん
    expect(span('y', (n) => n.y > 0.9)).toEqual([1, 2]);
    // 前の面（幅 6 × 高さ 3m）は、3m の絵で 2 × 1 枚ぶん。横の面（奥行 12 × 高さ 3m）は 4 × 1 枚ぶん
    expect(span('z', (n) => n.z > 0.9)).toEqual([2, 1]);
    expect(span('x', (n) => n.x > 0.9)).toEqual([4, 1]);
  });

  it('boxUv: 地面に寝かせた板も、置いた場所の座標で貼られる（隣の板と、模様がつながる）', () => {
    const plane = new Mesh(new PlaneGeometry(12, 6));
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(60, 0, 30);
    boxUv(plane, 6);
    const uv = plane.geometry.getAttribute('uv');
    const us = Array.from({ length: uv.count }, (_, i) => uv.getX(i));
    expect(Math.min(...us)).toBeCloseTo(54 / 6, 5);
    expect(Math.max(...us)).toBeCloseTo(66 / 6, 5);
  });
});

describe('草と小物（切り抜き）', () => {
  it('切り抜く範囲が、絵を測った値と合っている（2px 以内）。根元は、範囲の中にある', () => {
    for (const sheet of Object.values(ENV_SPRITES)) {
      const cells = measure[sheet.file]!.cells!;
      const mine = Object.values(sheet.cells);
      expect(mine.length).toBe(4);
      mine.forEach((c, i) => {
        const m = cells[i]!;
        expect(Math.abs(c.rect[0] - m.x0), `${sheet.file} ${i} x0`).toBeLessThanOrEqual(2);
        expect(Math.abs(c.rect[1] - m.y0), `${sheet.file} ${i} y0`).toBeLessThanOrEqual(2);
        expect(Math.abs(c.rect[2] - m.x1), `${sheet.file} ${i} x1`).toBeLessThanOrEqual(2);
        expect(Math.abs(c.rect[3] - m.y1), `${sheet.file} ${i} y1`).toBeLessThanOrEqual(2);
        expect(c.rootX).toBeGreaterThan(c.rect[0]);
        expect(c.rootX).toBeLessThan(c.rect[2]);
      });
    }
  });

  it('高さは、依頼書の値に近い（短い草 30cm、長い草 50cm ほど、茂みはひざの高さ）', () => {
    const g = ENV_SPRITES.grass.cells, p = ENV_SPRITES.props.cells;
    expect(g.short.h).toBeGreaterThan(0.25);
    expect(g.short.h).toBeLessThan(0.38);
    expect(g.tall.h).toBeGreaterThan(0.45);
    expect(g.tall.h).toBeLessThan(0.7);
    expect(g.flower.h).toBeLessThan(g.short.h);
    expect(p.bush.h).toBeGreaterThan(0.4);
    expect(p.bush.h).toBeLessThan(0.65);
    expect(p.crystal.h).toBeLessThan(0.4);
  });
});

describe('里の建物の形', () => {
  const size = (kind: keyof typeof BUILDINGS): { min: Vector3; max: Vector3; w: number; h: number; d: number } => {
    const box = new Box3().setFromBufferAttribute(BUILDINGS[kind].shape().getAttribute('position') as never);
    return { min: box.min, max: box.max, w: box.max.x - box.min.x, h: box.max.y - box.min.y, d: box.max.z - box.min.z };
  };

  it('どの建物も、足元が地面にあり、貼る場所が絵の中に収まっている', () => {
    for (const [kind, def] of Object.entries(BUILDINGS)) {
      const geo = def.shape();
      const pos = geo.getAttribute('position'), uv = geo.getAttribute('uv');
      expect(pos.count % 3, kind).toBe(0);
      expect(pos.count, kind).toBeGreaterThan(30);
      expect(uv.count, kind).toBe(pos.count);
      let minY = Infinity;
      for (let i = 0; i < pos.count; i++) {
        minY = Math.min(minY, pos.getY(i));
        expect(uv.getX(i), kind).toBeGreaterThanOrEqual(0);
        expect(uv.getX(i), kind).toBeLessThanOrEqual(1);
        expect(uv.getY(i), kind).toBeGreaterThanOrEqual(0);
        expect(uv.getY(i), kind).toBeLessThanOrEqual(1);
        expect(Number.isFinite(pos.getX(i) + pos.getY(i) + pos.getZ(i)), kind).toBe(true);
      }
      expect(minY, kind).toBeCloseTo(0, 5);
    }
  });

  it('工房: 幅 6.2m（屋根の出を入れて 6.6m）× 奥行 4.6m、棟 4.5m、煙突の先 5.4m', () => {
    const s = size('workshop');
    expect(s.w).toBeCloseTo(6.6, 1);
    expect(s.d).toBeCloseTo(5.0, 1);
    expect(s.max.y).toBeCloseTo(5.4, 1);
  });

  it('商店: 幅 5.6m。前に、日よけが 2.5m 張り出す。棟は 4m ほど（台の高さ 1m に合わせた比率）', () => {
    const s = size('shop');
    expect(s.w).toBeCloseTo(6.04, 1);
    // 奥行 3.4m + 屋根の出 + 日よけ 2.5m
    expect(s.max.z - 1.1).toBeCloseTo(2.5, 1);
    expect(s.max.y).toBeGreaterThan(3.7);
    expect(s.max.y).toBeLessThan(4.3);
  });

  it('依頼板: 高さ 3.4m、幅 2.8m。薄い（奥行 0.8m より小さい）', () => {
    const s = size('quest');
    expect(s.h).toBeCloseTo(3.4, 1);
    expect(s.w).toBeCloseTo(2.8, 1);
    expect(s.d).toBeLessThan(0.8);
  });

  it('装備箱: 天幕は 3.6m 四方、高さ 4m', () => {
    const s = size('chest');
    expect(s.w).toBeCloseTo(3.6, 1);
    expect(s.d).toBeCloseTo(3.6, 1);
    expect(s.h).toBeCloseTo(4.0, 1);
  });

  it('建物は、当たりの円（maps/hub_village.json の rocks）から、大きくはみ出さない', async () => {
    const content = await loadContent();
    const map = content.maps.get(content.hub.mapId)!;
    content.hub.facilities.forEach((f, i) => {
      const s = size(f.kind);
      const rock = map.rocks[i]!;
      expect(rock.x).toBe(f.building.x);
      expect(rock.z).toBe(f.building.z);
      // 屋根の出と日よけを入れた、いちばん遠い角が、当たりの円から 1.6m より外へ出ない
      const reach = Math.hypot(Math.max(-s.min.x, s.max.x), Math.max(-s.min.z, s.max.z));
      expect(reach, f.id).toBeLessThan(rock.r + 1.6);
    });
  });
});

describe('図鑑に出す原画', () => {
  it('登録簿の art に書かれた絵は、どれも、原画と、図鑑に出す小さな絵の両方がある', async () => {
    const content = await loadContent();
    const withArt = content.bestiary.species.filter((s) => s.art);
    // v0.75.0: いま居る 3 種すべて（ガルドロスは採用した設定図 galdros/…。ほかは ChatGPT の原画で、concepts/ にある）
    expect(withArt.length).toBe(3);
    expect(content.bestiary.species.length).toBe(3);
    for (const s of withArt) {
      const src = s.art!.includes('/') ? join(ROOT, 'art-source/monster', s.art!) : join(ROOT, 'art-source/monster/concepts', s.art!);
      expect(existsSync(src), s.art).toBe(true);
      expect(existsSync(join(ROOT, 'public/assets/bestiary', s.art!.split('/').pop()!.replace(/\.png$/, '.webp'))), s.art).toBe(true);
    }
  });
});
