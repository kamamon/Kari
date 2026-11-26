// 地面の起伏（v0.46.0。#19 の F02 の一切れ。docs/spec.md の 32.11）: 盆地のエリアの床は、外周に近いほど上がる「盆」の形。
// 出口・着く所・中心・段と登り口のまわりは平ら。simulation の当たりと接地は、データの格子（cm）を双一次で引く。
import { beforeAll, describe, expect, it } from 'vitest';
import type { Content, FieldDef } from '../src/data/schemas';
import { validateField } from '../src/data/validators';
import { reliefAt } from '../src/game/relief';
import { Simulation } from '../src/game/sim';
import { baseOptions, frame, loadContent, run } from './helpers';

let content: Content;
let field: FieldDef;
beforeAll(async () => {
  content = await loadContent();
  field = content.fields.get('field.basin')!;
});

const area = (id: string): FieldDef['areas'][number] => field.areas.find((a) => a.id === id)!;
const errorsOf = (f: FieldDef): string[] => {
  const errors: string[] = [];
  validateField(content, f, errors);
  return errors;
};

describe('地面の起伏（#19 の F02。v0.46.0）', () => {
  it('エリア 3（これまでの狩場）だけ平ら。ほかは設計の高さの帯の内で、外周に近い所ほど高い（中心は 0）', () => {
    expect(area('a3').relief).toBeUndefined();
    const band: Record<string, number> = { camp: 1, a1: 3, a2: 2, a4: 3, a5: 3, a6: 3, a7: 3, a8: 4, a9: 3, a10: 2 };
    for (const [id, b] of Object.entries(band)) {
      const r = area(id).relief!;
      const max = Math.max(...r.h) / 100;
      expect(max, id).toBeGreaterThan(0.5);
      expect(max, id).toBeLessThanOrEqual(b + 1e-9);
      const c = area(id).center!;
      expect(reliefAt(r, c.x, c.z), id).toBe(0);
    }
  });

  it('格子の点ではデータの値、間は双一次、格子の外は縁の値', () => {
    const r = area('a6').relief!;
    const at = (i: number, j: number): number => r.h[j * r.nx + i]! / 100;
    const i = 20, j = 7;
    expect(reliefAt(r, r.x0 + i * r.step, r.z0 + j * r.step)).toBeCloseTo(at(i, j), 9);
    const mid = reliefAt(r, r.x0 + (i + 0.5) * r.step, r.z0 + (j + 0.5) * r.step);
    expect(mid).toBeCloseTo((at(i, j) + at(i + 1, j) + at(i, j + 1) + at(i + 1, j + 1)) / 4, 9);
    expect(reliefAt(r, r.x0 - 50, r.z0 - 50)).toBeCloseTo(at(0, 0), 9);
    expect(reliefAt(undefined, 3, 4)).toBe(0);
  });

  it('出口・着く所・中心・登り口・段のまわりは平ら（これまでの位置の高さのまま）。データの検査を通る', () => {
    expect(errorsOf(field)).toEqual([]);
    for (const a of field.areas) {
      for (const e of a.exits) expect(reliefAt(a.relief, e.x, e.z), `${a.id}→${e.to}`).toBe(0);
      for (const c of a.climbs ?? []) expect(reliefAt(a.relief, c.x, c.z), c.id).toBe(0);
    }
  });

  it('検査が誤りを見つける: 急な坂・平らでない出口・起伏に埋まる段・格子の数の違い', () => {
    const steep = structuredClone(field);
    const r = steep.areas.find((a) => a.id === 'a6')!.relief!;
    const c = steep.areas.find((a) => a.id === 'a6')!.center!;
    const ci = Math.round((c.x - r.x0) / r.step), cj = Math.round((c.z - r.z0) / r.step);
    r.h[cj * r.nx + ci] = 400;
    const e1 = errorsOf(steep);
    expect(e1.some((e) => /30° を超える/.test(e))).toBe(true);
    expect(e1.some((e) => /中心 が平らでない/.test(e))).toBe(true);
    const buried = structuredClone(field);
    // エリア 9 の低い段（0.3m）。エリア 4 の低い段は、v0.49.0 から低い岩棚（1.1m）
    const a4 = buried.areas.find((a) => a.id === 'a9')!;
    const low = a4.platforms.find((p) => p.h === 0.3)!;
    for (let j = 0; j < a4.relief!.nz; j++) {
      for (let i = 0; i < a4.relief!.nx; i++) {
        const x = a4.relief!.x0 + i * a4.relief!.step, z = a4.relief!.z0 + j * a4.relief!.step;
        if (Math.abs(x - low.minX) < 3 && Math.abs(z - low.minZ) < 3) a4.relief!.h[j * a4.relief!.nx + i] = 60;
      }
    }
    expect(errorsOf(buried).some((e) => /起伏.*に埋まる/.test(e))).toBe(true);
    const bad = structuredClone(field);
    bad.areas.find((a) => a.id === 'a2')!.relief!.h.pop();
    expect(errorsOf(bad).some((e) => /relief が不正/.test(e))).toBe(true);
  });

  it('坂を歩いて上り下りすると、足は地面に付いたまま（下りでも宙に浮かない）', () => {
    const sim = new Simulation(content, baseOptions({ questId: 'quest.basin.003', field: true }));
    const a = area('a6');
    const c = a.center!;
    sim.player.pos = { x: c.x, y: 0, z: c.z };
    sim.player.prevPos = { ...sim.player.pos };
    sim.areaId = 'a6';
    for (const m of sim.monsters) m.aiEnabled = false;
    run(sim, 2);
    // いちばん高い格子の方へ歩く（起伏の上り）→ 戻る（下り）
    const r = a.relief!;
    let best = 0;
    for (let k = 0; k < r.h.length; k++) if (r.h[k]! > r.h[best]!) best = k;
    const tx = r.x0 + (best % r.nx) * r.step, tz = r.z0 + Math.floor(best / r.nx) * r.step;
    let top = 0, floating = 0;
    const walk = (x: number, z: number, n: number): void => {
      for (let i = 0; i < n; i++) {
        const dx = x - sim.player.pos.x, dz = z - sim.player.pos.z, d = Math.hypot(dx, dz) || 1;
        if (d < 0.5) break;
        sim.step(frame({ moveX: dx / d, moveZ: dz / d }));
        sim.drainEvents();
        const g = sim.world.groundHeight(sim.player.pos.x, sim.player.pos.z);
        if (sim.player.pos.y - g > 1e-6) floating++;
        top = Math.max(top, sim.player.pos.y);
      }
    };
    walk(tx, tz, 1200);
    expect(top).toBeGreaterThan(1);
    walk(c.x, c.z, 1200);
    expect(floating).toBe(0);
    expect(sim.player.pos.y).toBeCloseTo(0, 6);
  });

  it('起伏の上に置かれた大型も幼体も、地面の高さに立つ（群れは 1 か所に重ならない）', () => {
    const sim = new Simulation(content, baseOptions({ questId: 'quest.basin.003', field: true }));
    run(sim, 600);
    for (const m of sim.monsters) {
      expect(m.pos.y, m.id).toBeCloseTo(sim.world.groundHeight(m.pos.x, m.pos.z), 6);
    }
    for (const g of sim.herds) {
      const xs = g.members.map((m) => `${m.pos.x.toFixed(2)},${m.pos.z.toFixed(2)}`);
      expect(new Set(xs).size, String(g.id)).toBe(xs.length);
    }
  });
});

describe('目印（#19 の 04。v0.48.0）', () => {
  it('エリア 4 のくびれに割れた立ち岩 2 本、エリア 7 の外周寄りに岩柱 2 本（どれも図 R-16）。ほかのエリアには無い。出口・着く所・登り口から離れる', () => {
    const marks = (id: string) => area(id).rocks.filter((r) => r.art);
    expect(marks('a4').map((r) => r.art)).toEqual(['R-16', 'R-16']);
    expect(marks('a7').map((r) => r.art)).toEqual(['R-16', 'R-16']);
    for (const a of field.areas) if (a.id !== 'a4' && a.id !== 'a7') expect(marks(a.id), a.id).toEqual([]);
    // 割れた 2 本は寄り添う（間 0.5m ほど）。a7 の 2 本は離れる
    const [p, q] = marks('a4');
    expect(Math.hypot(p!.x - q!.x, p!.z - q!.z)).toBeLessThan(p!.r + q!.r + 1);
    const [u, v] = marks('a7');
    expect(Math.hypot(u!.x - v!.x, u!.z - v!.z)).toBeGreaterThan(40);
    for (const id of ['a4', 'a7']) {
      const a = area(id);
      for (const r of marks(id)) {
        for (const e of a.exits) expect(Math.hypot(r.x - e.x, r.z - e.z), `${id} ${e.to}`).toBeGreaterThan(10);
        for (const c of a.climbs ?? []) expect(Math.hypot(r.x - c.x, r.z - c.z), c.id).toBeGreaterThan(4);
        expect(r.h).toBeGreaterThan(6);
      }
    }
  });
});

