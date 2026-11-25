// 段のある里（v0.31.0。ChatGPT の里の設計 #11 の P0）: 広場（0m）と、3m 低い「炉の段」（工房）。v0.35.0 の P1 で 5 つの段になった（tests/hub-village.test.ts）。
// - 地面の高さ: 0 より低い段差も、重なる段差の最も高いもの（無ければ 0）
// - 段の縁から落ちない（stepDown）。階段と踊り場を下りて、上って、行き来できる
// - 施設は、同じ段にいる時だけ開く。施設・人・建物の当たりは、その段の床に立つ
// - 見た目: 地面の穴・床・擁壁（蹴上げ）・柵が、段差のデータと合う
import { BufferGeometry, Mesh, Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Content, MapDef } from '../src/data/schemas';
import { validateHub } from '../src/data/validators';
import { FACILITY_FLOOR_TOL, nearestFacility } from '../src/game/hub';
import { Simulation } from '../src/game/sim';
import { World, groundAt } from '../src/game/world';
import { RAIL_DROP, buildTerraces, holedGround, railLines, railRuns, terraceWalls } from '../src/render/terraces';
import { baseOptions, loadContent } from './helpers';

let content: Content;
let map: MapDef;
beforeAll(async () => {
  content = await loadContent();
  map = content.maps.get(content.hub.mapId)!;
});

const hubSim = (): Simulation => new Simulation(content, baseOptions({ mapId: content.hub.mapId, monsterId: null }));
const workshop = (): Content['hub']['facilities'][number] => content.hub.facilities.find((f) => f.id === 'workshop')!;

/** (tx, tz) へ向かって歩く（着くか、steps tick まで）。歩いた間の y の最小・最大を返す */
function walk(sim: Simulation, tx: number, tz: number, steps = 900): { reached: boolean; minY: number; maxY: number } {
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < steps; i++) {
    const p = sim.player.pos;
    const dx = tx - p.x, dz = tz - p.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.3) return { reached: true, minY, maxY };
    sim.step({ moveX: dx / d, moveZ: dz / d, held: 0, pressed: 0, released: 0 });
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  return { reached: false, minY, maxY };
}

describe('段のある里: 地面と歩き方（v0.31.0）', () => {
  it('地面の高さ: 重なる段差の最も高いもの（0 より低くてもよい）、無ければ 0。0 以上の段差だけの所は、これまでと同じ', () => {
    const plats = [
      { minX: 0, maxX: 10, minZ: 0, maxZ: 10, h: -3 },
      { minX: 8, maxX: 12, minZ: 4, maxZ: 6, h: -1.5 },
      { minX: 20, maxX: 22, minZ: 0, maxZ: 2, h: 0.8 },
    ];
    expect(groundAt(plats, 5, 5)).toBe(-3);
    expect(groundAt(plats, 9, 5)).toBe(-1.5);
    expect(groundAt(plats, 11, 5)).toBe(-1.5);
    expect(groundAt(plats, 15, 5)).toBe(0);
    expect(groundAt(plats, 21, 1)).toBe(0.8);
    expect(groundAt([], 3, 3)).toBe(0);
    // 里の段: 広場は 0、炉の段は -3、西の階段は 1/6m ずつ、踊り場は -1.5
    expect(groundAt(map.platforms, 0, 0)).toBe(0);
    expect(groundAt(map.platforms, -30, 5)).toBe(-3);
    expect(groundAt(map.platforms, -20, 8.5)).toBe(-1.5);
    const west = map.platforms.filter((p) => p.look === 'stone' && p.minZ >= 6 && p.maxZ <= 11 && p.minX >= -23.7 && p.maxX <= -16.8).map((p) => p.h).sort((a, b) => b - a);
    expect(west.length).toBe(17);
    west.reduce((prev, h) => {
      expect(prev - h).toBeLessThanOrEqual(map.stepUp);
      expect(prev - h).toBeLessThanOrEqual(map.stepDown!);
      return h;
    }, 0);
    expect(west.at(-1)! - -3).toBeLessThanOrEqual(map.stepDown!);
  });

  it('段の縁から落ちない: 広場の高さから炉の段へ、柵の所を歩いても、体が縁にかからない所で止まる。階段の脇からも下りられない', () => {
    const w = new World(map);
    // 炉の段の東の縁（x = -23.7）の上（z = 0）: 西へ歩いても、縁で止まる
    const p = { x: -22.5, y: 0, z: 0 };
    for (let i = 0; i < 200; i++) w.move(p, content.player.radius, -0.05, 0);
    // 体（半径）が縁と柵にかからない所で止まる
    expect(p.x).toBeGreaterThan(-23.7 + content.player.radius);
    expect(p.x).toBeLessThan(-23.7 + content.player.radius + 0.2);
    expect(w.groundHeight(p.x, p.z)).toBe(0);
    // 階段の脇（z = 11、北の縁の外）から、南へ歩いても、階段の中へ落ちない
    const q = { x: -22.5, y: 0, z: 11.5 };
    for (let i = 0; i < 200; i++) w.move(q, content.player.radius, 0, -0.05);
    expect(q.z).toBeGreaterThan(10 + content.player.radius);
    expect(w.groundHeight(q.x, q.z)).toBe(0);
    // stepDown の無い所（これまでの狩場）は、これまでどおり下りられる
    const open = new World({ ...map, stepDown: undefined });
    const r = { x: -22.5, y: 0, z: 0 };
    for (let i = 0; i < 200; i++) open.move(r, content.player.radius, -0.05, 0);
    expect(r.x).toBeLessThan(-23.7);
  });

  it('出発地点から、階段と踊り場を下りて工房の前へ。また上って広場へ戻れる（跳ばない。下りは 1 段ずつ）', () => {
    const sim = hubSim();
    expect(walk(sim, -15, 8.5).reached).toBe(true);
    expect(sim.player.pos.y).toBe(0);
    const down = walk(sim, -24.6, 8.5);
    expect(down.reached).toBe(true);
    expect(sim.player.pos.y).toBeCloseTo(-3, 6);
    expect(walk(sim, workshop().x, workshop().z).reached).toBe(true);
    expect(nearestFacility(content.hub.facilities, sim.world, sim.player.pos)?.id).toBe('workshop');
    // 戻る
    expect(walk(sim, -24.6, 8.5).reached).toBe(true);
    const up = walk(sim, -15, 8.5);
    expect(up.reached).toBe(true);
    expect(sim.player.pos.y).toBe(0);
    expect(walk(sim, map.spawn.x, map.spawn.z, 1500).reached).toBe(true);
  });

  it('施設は、同じ段にいる時だけ開く（工房の真上の高さに立っても開かない）', () => {
    const sim = hubSim();
    const f = workshop();
    expect(nearestFacility(content.hub.facilities, sim.world, { x: f.x, y: -3, z: f.z })?.id).toBe('workshop');
    expect(nearestFacility(content.hub.facilities, sim.world, { x: f.x, y: 0, z: f.z })).toBeNull();
    expect(nearestFacility(content.hub.facilities, sim.world, { x: f.x, y: -3 + FACILITY_FLOOR_TOL + 0.01, z: f.z })).toBeNull();
    // 広場の施設は、これまでどおり
    for (const id of ['board', 'shop', 'chest']) {
      const g = content.hub.facilities.find((x) => x.id === id)!;
      expect(sim.world.groundHeight(g.x, g.z), id).toBe(0);
      expect(nearestFacility(content.hub.facilities, sim.world, { x: g.x, y: 0, z: g.z })?.id).toBe(id);
    }
  });

  it('里のデータ: 工房と建物とロクハは炉の段（-3m）、ほかの施設と人は広場（0m）。当たりの下の端は床。検査が誤りを見つける', () => {
    const f = workshop();
    expect(groundAt(map.platforms, f.x, f.z)).toBe(-3);
    expect(groundAt(map.platforms, f.building.x, f.building.z)).toBe(-3);
    const floors = Object.fromEntries((content.hub.npcs ?? []).map((n) => [n.name, groundAt(map.platforms, n.x, n.z)]));
    expect(floors).toEqual({ ミナギ: 0, ロクハ: -3, イサネ: 0, セナキ: 0 });
    const errors: string[] = [];
    validateHub(content, errors);
    expect(errors).toEqual([]);
    const broken = (edit: (c: Content) => void): string => {
      const c = { ...content, hub: JSON.parse(JSON.stringify(content.hub)) as Content['hub'], maps: new Map(content.maps) };
      c.maps.set(map.id, JSON.parse(JSON.stringify(map)) as MapDef);
      edit(c);
      const e: string[] = [];
      validateHub(c, e);
      return e.join('\n');
    };
    // 工房の前を階段にかける / ロクハを広場へ（当たりごと）/ 建物の当たりの y を 0 に
    expect(broken((c) => { const w = c.hub.facilities.find((x) => x.id === 'workshop')!; w.x = -22; w.z = 8.5; })).toMatch(/平らでない|建物と施設の前の床/);
    expect(broken((c) => {
      const n = c.hub.npcs!.find((x) => x.id === 'npc.rokuha')!;
      const m = c.maps.get(map.id)!;
      const r = m.rocks.find((x) => Math.hypot(x.x - n.x, x.z - n.z) < 0.01)!;
      n.x = r.x = -12;
      n.z = r.z = 12;
    })).toMatch(/違う段に立っている|下の端/);
    expect(broken((c) => { const m = c.maps.get(map.id)!; m.rocks[0]!.y = 0; })).toMatch(/建物の当たりの下の端/);
  });
});

describe('段のある里: 見た目（地面の穴・床・擁壁・柵）', () => {
  it('擁壁: 炉の段の東の縁は 3m（階段の口を除く）、階段は 1/6m の蹴上げ。どの壁も、面は低い側を向き、高さは床と合う。外周の上には作らない', () => {
    const walls = terraceWalls(map.platforms, map.bounds);
    // 炉の段の東の縁（x = -23.7。面は西＝低い側を向く）: 北と南は 3m、階段の口（z 7〜10）は最後の蹴上げ。v0.35.0 から、炉の段は庭の縁（z -17）まで
    const east = walls.filter((w) => w.nx === -1 && Math.abs(w.ax + 23.7) < 1e-6);
    expect(east.map((w) => [Math.min(w.az, w.bz), Math.max(w.az, w.bz), +(w.hi - w.lo).toFixed(4)]).sort((a, b) => a[0]! - b[0]!)).toEqual([[-17, 7, 3], [7, 10, 0.1667], [10, 15, 3]]);
    // 西の階段の蹴上げは 17 + 踊り場の前後
    const risers = walls.filter((w) => w.hi - w.lo < RAIL_DROP && w.nx === -1 && w.az >= 6 && w.bz <= 11 && w.ax >= -23.71 && w.ax <= -16.79);
    expect(risers.length).toBeGreaterThanOrEqual(17);
    for (const w of walls) {
      // 面の向きの側が低い（groundAt で、面の少し前は lo、少し後ろは hi）。外周の外へ延ばした所は測らない
      const mx = (Math.max(w.ax, map.bounds.minX) + Math.min(w.bx, map.bounds.maxX)) / 2, mz = (Math.max(w.az, map.bounds.minZ) + Math.min(w.bz, map.bounds.maxZ)) / 2;
      expect(groundAt(map.platforms, mx + w.nx * 0.01, mz + w.nz * 0.01)).toBeCloseTo(w.lo, 6);
      expect(groundAt(map.platforms, mx - w.nx * 0.01, mz - w.nz * 0.01)).toBeCloseTo(w.hi, 6);
      // 外周の上の縁は無い
      if (w.nx !== 0) expect(w.ax !== map.bounds.minX && w.ax !== map.bounds.maxX).toBe(true);
      else expect(w.az !== map.bounds.minZ && w.az !== map.bounds.maxZ).toBe(true);
    }
    // 柵は、下りが 0.5m 以上の縁だけ（水面と、歩いては行けない岩の床の上には立てない）
    const rails = railLines(walls);
    expect(rails.length).toBeGreaterThan(4);
    for (const r of rails) {
      expect(r.hi - r.lo).toBeGreaterThanOrEqual(RAIL_DROP);
      expect(['water', 'rock']).not.toContain(r.upper);
    }
    // 階段の脇の柵は、段ごとではなく、段に沿って 1 本につなぐ。炉の段から庭へ下りる石段 b の西の脇（x -30）は、段に沿って斜めに下りる 1 本
    const runs = railRuns(rails);
    expect(runs.length).toBeLessThan(rails.length);
    const bWest = runs.filter((r) => !r.byX && Math.abs(r.at + 30) < 1e-6 && r.s0 >= -23.31 && r.s1 <= -16.99);
    expect(bWest.length).toBe(1);
    const run = bWest[0]!;
    expect(run.s1 - run.s0).toBeGreaterThan(6);
    // 元の線は、北（炉の段の側）ほど高く、なめらかに下がる。柱は段の上に立つ
    expect(run.profile(run.s1 - 0.2)).toBeGreaterThan(run.profile((run.s0 + run.s1) / 2));
    expect(run.profile((run.s0 + run.s1) / 2)).toBeGreaterThan(run.profile(run.s0 + 0.2));
    expect(run.floor(-20.05)).toBeCloseTo(groundAt(map.platforms, -28.5, -20.05), 6);
  });

  it('地面の板は、段差の中にます目を残さない。床・擁壁・柵は、床の絵の種類と、石積み・岩・小滝・水・木の面（描画はその数）で、高さがデータと合う', () => {
    const low = map.platforms.filter((p) => p.h < 0);
    const g = holedGround(-9, 0, 326, 294, low);
    const pos = g.getAttribute('position'), idx = g.getIndex()!;
    for (let t = 0; t < idx.count; t += 3) {
      const c = new Vector3();
      for (let k = 0; k < 3; k++) c.add(new Vector3(pos.getX(idx.getX(t + k)), 0, pos.getZ(idx.getX(t + k))));
      c.multiplyScalar(1 / 3);
      expect(low.some((p) => c.x > p.minX && c.x < p.maxX && c.z > p.minZ && c.z < p.maxZ), `${c.x},${c.z}`).toBe(false);
    }
    const group = buildTerraces(map.platforms, 1.25, map.bounds);
    const kinds = group.children.map((m) => (m as Mesh).userData.terrace as string);
    expect(kinds.sort()).toEqual(['cliff', 'fall', 'grass', 'rail', 'rock', 'stone', 'wall', 'water', 'yard']);
    // 土の床は、炉の段（-3）と水音の庭（-10）だけ
    const floor = group.children.find((m) => m.userData.terrace === 'yard') as Mesh<BufferGeometry>;
    const ys = new Set(Array.from({ length: floor.geometry.getAttribute('position').count }, (_, i) => floor.geometry.getAttribute('position').getY(i)));
    expect([...ys].sort((a, b) => a - b)).toEqual([-10, -3]);
  });
});
