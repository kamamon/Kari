// 全体の地図（v0.51.0。#19 の F04「地理的な輪郭・番号・自分の向き」。docs/spec.md の 32.16）: 配置の計算（DOM を使わない部分）。
import { beforeAll, describe, expect, it } from 'vitest';
import type { Content, FieldDef } from '../src/data/schemas';
import { FIELD_MAP_CELL, fieldMapLayout } from '../src/ui/fieldMap';
import { loadContent } from './helpers';

let content: Content;
let field: FieldDef;
beforeAll(async () => {
  content = await loadContent();
  field = content.fields.get('field.basin')!;
});

describe('全体の地図の配置（#19 の F04。v0.51.0）', () => {
  it('どのエリアも本当の外周の形を、同じ縮尺で、自分のマスの中に描く（隣と重ならない。地図は w × h に収まる）', () => {
    const L = fieldMapLayout(field, 800, 560);
    expect(L.width).toBeLessThanOrEqual(800 + 1e-6);
    expect(L.height).toBeLessThanOrEqual(560 + 1e-6);
    expect(L.areas).toHaveLength(field.areas.length);
    const boxes = L.areas.map((a) => {
      const xs = a.outline.map((p) => p[0]), ys = a.outline.map((p) => p[1]);
      return { id: a.id, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
    });
    for (const a of field.areas) {
      const bx = boxes.find((x) => x.id === a.id)!;
      // 同じ縮尺: 地図の上の幅 = 本当の幅 × scale
      expect(bx.x1 - bx.x0).toBeCloseTo((a.bounds.maxX - a.bounds.minX) * L.scale, 6);
      expect(bx.y1 - bx.y0).toBeCloseTo((a.bounds.maxZ - a.bounds.minZ) * L.scale, 6);
      expect(Math.max(a.bounds.maxX - a.bounds.minX, a.bounds.maxZ - a.bounds.minZ)).toBeLessThan(FIELD_MAP_CELL);
    }
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const p = boxes[i]!, q = boxes[j]!;
        const apart = p.x1 < q.x0 || q.x1 < p.x0 || p.y1 < q.y0 || q.y1 < p.y0;
        expect(apart, `${p.id} と ${q.id}`).toBe(true);
      }
    }
  });

  it('上から見た向き: 北（+Z）が上、+X が左。マスも同じ（列の大きい方が左、行の大きい方が上）', () => {
    const L = fieldMapLayout(field, 800, 560);
    const a2 = field.areas.find((a) => a.id === 'a2')!;
    const [x0, y0] = L.toMap('a2', a2.center!.x, a2.center!.z);
    const [xe] = L.toMap('a2', a2.center!.x + 10, a2.center!.z);
    const [, yn] = L.toMap('a2', a2.center!.x, a2.center!.z + 10);
    expect(xe).toBeLessThan(x0);
    expect(yn).toBeLessThan(y0);
    for (const a of field.areas) {
      for (const b of field.areas) {
        const pa = L.areas.find((x) => x.id === a.id)!.center, pb = L.areas.find((x) => x.id === b.id)!.center;
        if (a.grid[0] > b.grid[0] && a.grid[1] === b.grid[1]) expect(pa[0], `${a.id} は ${b.id} より左`).toBeLessThan(pb[0]);
        if (a.grid[1] > b.grid[1] && a.grid[0] === b.grid[0]) expect(pa[1], `${a.id} は ${b.id} より上`).toBeLessThan(pb[1]);
      }
    }
  });

  it('道: つながる組ごとに 1 本（盆地は 14 本、大型も通るのは 8 本）。線の両端は、それぞれのエリアの出口の印', () => {
    const L = fieldMapLayout(field, 800, 560);
    expect(L.links).toHaveLength(14);
    expect(L.links.filter((k) => k.large).map((k) => [k.a, k.b].sort().join('-')).sort()).toEqual(['a10-a6', 'a10-a7', 'a2-a3', 'a2-a4', 'a3-a6', 'a3-a7', 'a4-a7', 'a6-a9'].sort());
    for (const k of L.links) {
      const ea = L.areas.find((a) => a.id === k.a)!.exits.find((e) => e.to === k.b)!;
      const eb = L.areas.find((a) => a.id === k.b)!.exits.find((e) => e.to === k.a)!;
      expect(Math.hypot(ea.x - k.x0, ea.y - k.y0)).toBeLessThan(1e-9);
      expect(Math.hypot(eb.x - k.x1, eb.y - k.y1)).toBeLessThan(1e-9);
    }
    // 番号: 野営地は「営」、ほかは画面の番号
    expect(L.areas.find((a) => a.id === 'camp')!.label).toBe('営');
    expect(L.areas.find((a) => a.id === 'a10')!.label).toBe('10');
  });
});
