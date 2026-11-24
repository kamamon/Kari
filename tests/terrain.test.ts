// 自然な形のエリア（v0.20.0。docs/spec.md の 18.4）と、出ていく大型の速さ（D-084）。
import { beforeAll, describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/seededRng';
import type { Content, FieldDef } from '../src/data/schemas';
import { AreaShape, NavGraph, type Pt } from '../src/game/areaShape';
import { areaOf } from '../src/game/field';
import { Simulation } from '../src/game/sim';
import { World, type AreaGeom } from '../src/game/world';
import { Btn, baseOptions, frame, loadContent } from './helpers';

let content: Content;
let field: FieldDef;
beforeAll(async () => {
  content = await loadContent();
  field = content.fields.get('field.basin')!;
});

/** L の字（縦 0〜40、横 0〜40、太さ 10） */
const L_SHAPE: Pt[] = [[0, 0], [40, 0], [40, 10], [10, 10], [10, 40], [0, 40]];

/** 多角形の内外と、縁までの距離（すべての辺を調べる、遅いが確かなやり方） */
function brute(poly: Pt[], x: number, z: number): number {
  let inside = false, best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]!, [xj, zj] = poly[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    const ex = xi - xj, ez = zi - zj;
    const t = Math.max(0, Math.min(1, ((x - xj) * ex + (z - zj) * ez) / (ex * ex + ez * ez)));
    best = Math.min(best, Math.hypot(x - (xj + ex * t), z - (zj + ez * t)));
  }
  return inside ? best : -best;
}

describe('外周（AreaShape）', () => {
  it('内か外か・縁までの距離が、すべての辺を調べた値と合う（8m までは正確、その先は 8m 以上）', () => {
    for (const poly of [L_SHAPE, field.areas.find((a) => a.id === 'a1')!.shape!, field.areas.find((a) => a.id === 'a6')!.shape!]) {
      const s = new AreaShape(poly);
      const rng = new SeededRng(7);
      for (let i = 0; i < 3000; i++) {
        const x = s.minX - 10 + rng.next() * (s.maxX - s.minX + 20), z = s.minZ - 10 + rng.next() * (s.maxZ - s.minZ + 20);
        const want = brute(poly, x, z);
        const got = s.signedDistance(x, z);
        expect(s.contains(x, z), `${x},${z}`).toBe(want > 0);
        if (Math.abs(want) <= 8) expect(got).toBeCloseTo(want, 6);
        else expect(Math.sign(got)).toBe(Math.sign(want));
      }
    }
  });

  it('押し戻すと、縁から決めた幅だけ内側に入る。もう内側の点は、動かさない', () => {
    const s = new AreaShape(L_SHAPE);
    const rng = new SeededRng(3);
    for (let i = 0; i < 2000; i++) {
      const x = -8 + rng.next() * 56, z = -8 + rng.next() * 56;
      const [px, pz] = s.constrain(x, z, 1.2);
      expect(s.signedDistance(px, pz)).toBeGreaterThanOrEqual(1.2 - 1e-6);
      if (brute(L_SHAPE, x, z) >= 1.2) expect([px, pz]).toEqual([x, z]);
    }
  });

  it('見通し: L の字の角を挟んだ 2 点は見えない。道しるべを伝えば、角を回って行ける', () => {
    const s = new AreaShape(L_SHAPE);
    expect(s.clear(35, 5, 5, 35, 1)).toBe(false);
    expect(s.clear(35, 5, 5, 5, 1)).toBe(true);
    const nav = new NavGraph(s, [[30, 5], [5, 5], [5, 30]]);
    expect(nav.connected(0, 2)).toBe(true);
    // (35, 5) → (5, 35): 次の点をたどると、どの 1 歩も見通せて、角 (5, 5) を通って着く
    let x = 35, z = 5;
    const hops: string[] = [];
    for (let k = 0; k < 6 && !(x === 5 && z === 35); k++) {
      const p = nav.next(x, z, 5, 35, 1);
      expect(s.clear(x, z, p.x, p.z, 1)).toBe(true);
      ({ x, z } = p);
      hops.push(`${x},${z}`);
    }
    expect(hops[hops.length - 1]).toBe('5,35');
    expect(hops).toContain('5,5');
    // 角に着いたら、その先へ（目当てが見える）
    expect(nav.next(5, 5.5, 5, 35, 1)).toEqual({ x: 5, z: 35 });
  });

  it('歩くと、外周の外へ出ない（L の字の中を、でたらめに 1 万歩）', () => {
    const area: AreaGeom = { bounds: { minX: 0, maxX: 40, minZ: 0, maxZ: 40 }, stepUp: 0.35, rocks: [], platforms: [], shape: L_SHAPE, nav: [[30, 5], [5, 5], [5, 30]], center: { x: 5, z: 5 } };
    const world = new World({ ...content.maps.get('map.basin.training')!, ...area }, [area]);
    const pos = { x: 5, y: 0, z: 5 };
    const rng = new SeededRng(9);
    let a = 0;
    for (let i = 0; i < 10000; i++) {
      a += (rng.next() - 0.5) * 0.6;
      world.move(pos, 0.5, Math.cos(a) * 0.3, Math.sin(a) * 0.3);
      expect(brute(L_SHAPE, pos.x, pos.z)).toBeGreaterThanOrEqual(0.5 - 1e-6);
    }
  });
});

describe('風礫盆地の、自然な形のエリア', () => {
  /** 多角形の面積 */
  const areaOfPoly = (p: Pt[]): number => Math.abs(p.reduce((s, a, i) => s + a[0] * p[(i + 1) % p.length]![1] - p[(i + 1) % p.length]![0] * a[1], 0)) / 2;
  /** エリアのいちばん広い所の幅（縁から最も遠い点までの距離の 2 倍） */
  const widest = (a: FieldDef['areas'][number]): number => {
    const s = new AreaShape(a.shape!);
    let best = 0;
    for (let x = s.minX; x <= s.maxX; x += 1) for (let z = s.minZ; z <= s.maxZ; z += 1) best = Math.max(best, brute(a.shape!, x, z));
    return best * 2;
  };

  it('どのエリアも四角ではない（外周の点が 40 以上で、面積は囲む四角の 85% より小さい）', () => {
    for (const a of field.areas) {
      expect(a.shape!.length, a.id).toBeGreaterThanOrEqual(40);
      const b = a.bounds;
      expect(areaOfPoly(a.shape!) / ((b.maxX - b.minX) * (b.maxZ - b.minZ)), a.id).toBeLessThan(0.85);
    }
  });

  it('狭いエリア（谷・沢）と、広くて戦いやすいエリアがある', () => {
    const narrow = field.areas.filter((a) => a.size === 'narrow' && a.kind !== 'camp');
    const wide = field.areas.filter((a) => a.size === 'wide');
    expect(narrow.map((a) => a.id)).toEqual(['a1', 'a5', 'a8']);
    expect(wide.map((a) => a.id)).toEqual(['a2', 'a6', 'a7']);
    // 狭いエリアは、いちばん広い所でも幅 22m まで。広いエリアは、幅 60m 以上の所があり、面積は狭いエリアの 3 倍以上
    for (const a of narrow) expect(widest(a), a.id).toBeLessThanOrEqual(22);
    for (const a of wide) expect(widest(a), a.id).toBeGreaterThanOrEqual(60);
    const big = Math.min(...wide.map((a) => areaOfPoly(a.shape!))), small = Math.max(...narrow.map((a) => areaOfPoly(a.shape!)));
    expect(big / small).toBeGreaterThan(3);
  });

  it('出口・着く場所・中心・道しるべ・岩・段差は、外周の中にある（岩はまるごと、着く場所は体の幅だけ内側）', () => {
    for (const a of field.areas) {
      const s = new AreaShape(a.shape!);
      expect(s.signedDistance(a.center!.x, a.center!.z), a.id).toBeGreaterThan(3);
      for (const e of a.exits) expect(s.signedDistance(e.x, e.z), `${a.id}→${e.to}`).toBeGreaterThan(0.5);
      for (const p of a.nav!) expect(s.signedDistance(p[0], p[1]), a.id).toBeGreaterThan(1.5);
      for (const r of a.rocks) expect(s.signedDistance(r.x, r.z), a.id).toBeGreaterThan(r.r);
      for (const p of a.platforms) for (const [x, z] of [[p.minX, p.minZ], [p.maxX, p.maxZ], [p.minX, p.maxZ], [p.maxX, p.minZ]]) expect(s.signedDistance(x!, z!), a.id).toBeGreaterThan(0.5);
      for (const o of field.areas) for (const e of o.exits.filter((x) => x.to === a.id)) {
        expect(s.signedDistance(e.arrive.x, e.arrive.z), `${o.id}→${a.id}`).toBeGreaterThan(2);
        if (e.arriveLarge) expect(s.signedDistance(e.arriveLarge.x, e.arriveLarge.z), `${o.id}→${a.id} 大型`).toBeGreaterThan(3);
      }
    }
  });

  it('どの出口へも、中心から道しるべを伝って行ける（大型の体の半径 1.5m で）', () => {
    for (const a of field.areas) {
      const s = new AreaShape(a.shape!);
      const nav = new NavGraph(s, a.nav!, 1.8);
      for (const e of a.exits) {
        // 中心から出口まで、next をたどる
        let x = a.center!.x, z = a.center!.z;
        for (let k = 0; k < 20 && Math.hypot(e.x - x, e.z - z) > 0.5; k++) ({ x, z } = nav.next(x, z, e.x, e.z, 1.8));
        expect(Math.hypot(e.x - x, e.z - z), `${a.id}→${e.to}`).toBeLessThan(0.5);
      }
    }
  });
});

describe('出ていく大型（D-084）', () => {
  it('次のエリアへ出ていく速さは、狩人が走る速さより速い（弱っていても）', () => {
    const run = content.player.sprintSpeed;
    expect(field.roam.leaveSpeed).toBeGreaterThan(run * 1.15);
    expect(field.roam.limpLeaveSpeed).toBeGreaterThan(run * 1.05);
  });

  it('出ていく大型を、すぐ後ろから走って追っても、追いつけない（離れていく）', () => {
    const sim = new Simulation(content, baseOptions({ questId: 'quest.basin.003', field: true }));
    const m = sim.monsters[0]!;
    // 居る時間を終わらせて、出ていかせる
    m.roam!.ticks = 1;
    let start = -1;
    const gaps: number[] = [];
    for (let i = 0; i < 60 * 30; i++) {
      // 狩人は、大型のすぐ後ろ（出口と反対の側、3m）から、大型の方へ全力で走る（出ていき始めた時に置く）
      if (m.roam!.state === 'leave' && start < 0) {
        start = i;
        const v = m.roam!.via!;
        const d0 = Math.hypot(v.x - m.pos.x, v.z - m.pos.z) || 1;
        const f = { x: (v.x - m.pos.x) / d0, z: (v.z - m.pos.z) / d0 };
        sim.player.pos = { x: m.pos.x - f.x * 3, y: 0, z: m.pos.z - f.z * 3 };
        sim.player.prevPos = { ...sim.player.pos };
        sim.areaId = sim.monsterArea(m)!.id;
      }
      const dx = m.pos.x - sim.player.pos.x, dz = m.pos.z - sim.player.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      sim.step(start >= 0 ? frame({ moveX: dx / d, moveZ: dz / d, held: Btn.Sprint }) : frame());
      sim.drainEvents();
      if (start >= 0) gaps.push(Math.hypot(m.pos.x - sim.player.pos.x, m.pos.z - sim.player.pos.z));
      if (start >= 0 && m.roam!.state !== 'leave') break;
    }
    expect(start).toBeGreaterThanOrEqual(0);
    expect(gaps.length).toBeGreaterThan(60);
    // 向きを変えて走り出した後（1 秒後）は、どんどん離れる。すぐ近く（3m の内）に居られるのは、合わせて 1 秒まで
    const after = gaps.slice(60);
    expect(after[after.length - 1]!, gaps.map((g) => g.toFixed(1)).join(' ')).toBeGreaterThan(Math.max(6, gaps[60]! + 3));
    expect(gaps.filter((g) => g < 3).length).toBeLessThanOrEqual(60);
  });
});

it('areaOf は、データのエリアを返す', () => {
  expect(areaOf(field, 'a3')!.name).toBe('岩原');
});
