// 里の 5 つの段（v0.35.0。ChatGPT の里の設計 #11 の P1）: 水音の庭 -10 / 炉の段 -3 / 灯の広場 0 / 暮らしの段 +8 / 灯見の台 +22。
// - 2 つの回遊路（生活の道・見晴らしの道）を、跳ばずに歩いて一周できる（吊り橋も渡る）
// - 段の縁・裂け目・沢・吊り橋のわきから落ちない
// - 建物と飾り・小物・出口のデータと、当たり（tools/gen-hub.py の出力）が合う。検査が誤りを見つける
// - 見た目: 水車・昇降台・煙・小物の板が作られ、里の音の大きさは場所で変わる（水辺は沢、炉の段は炉、上の段は風）
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Mesh } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { HUB_PROP_ARTS, type Content, type MapDef } from '../src/data/schemas';
import { validateHub } from '../src/data/validators';
import { nearestFacility } from '../src/game/hub';
import { Simulation } from '../src/game/sim';
import { World, groundAt } from '../src/game/world';
import { buildHubGroup } from '../src/render/hubScene';
import { PROP_ART } from '../src/render/propArt';
import { PROP_HEIGHT, SMITH_PERIOD } from '../src/render/villageScene';
import { baseOptions, loadContent } from './helpers';

const ROOT = join(__dirname, '..');
let content: Content;
let map: MapDef;
beforeAll(async () => {
  content = await loadContent();
  map = content.maps.get(content.hub.mapId)!;
});

const hubSim = (): Simulation => new Simulation(content, baseOptions({ mapId: content.hub.mapId, monsterId: null }));

/** 道しるべの点を順に歩く。着いた点ごとの高さを返す（着けなければ、その点の名前で止める） */
function walkRoute(sim: Simulation, route: readonly (readonly [number, number])[], perLeg = 1500): number[] {
  const ys: number[] = [];
  for (const [tx, tz] of route) {
    let reached = false;
    for (let i = 0; i < perLeg && !reached; i++) {
      const p = sim.player.pos;
      const dx = tx - p.x, dz = tz - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.35) {
        reached = true;
        break;
      }
      sim.step({ moveX: dx / d, moveZ: dz / d, held: 0, pressed: 0, released: 0 });
      // 当たりの円の中へは入らない
      for (const r of map.rocks) expect(Math.hypot(p.x - r.x, p.z - r.z)).toBeGreaterThanOrEqual(r.r + content.player.radius - 1e-6);
    }
    expect(reached, `(${tx}, ${tz}) へ着けない。いま (${sim.player.pos.x.toFixed(2)}, ${sim.player.pos.y.toFixed(2)}, ${sim.player.pos.z.toFixed(2)})`).toBe(true);
    ys.push(+sim.player.pos.y.toFixed(4));
  }
  return ys;
}

describe('里の 5 つの段（v0.35.0）: 地形', () => {
  it('段の高さ: 水音の庭 -10・炉の段 -3（庭の縁まで延びた）・広場 0・暮らしの段 +8・灯見の台 +22。裂け目の底 15、吊り橋 22、沢は隣の床より 0.45m 低い', () => {
    const at = (x: number, z: number): number => groundAt(map.platforms, x, z);
    expect(at(0, -30)).toBe(-10);
    expect(at(-30, -10)).toBe(-3);
    expect(at(0, 0)).toBe(0);
    expect(at(-10, 30)).toBe(8);
    expect(at(-20, 50)).toBe(22);
    expect(at(10, 50)).toBe(22);
    expect(at(0, 45)).toBe(15);
    expect(at(0, 51.5)).toBe(22);
    for (const [z, floor] of [[-30, -10], [0, 0], [30, 8], [50, 22]] as const) expect(at(-44, z)).toBeCloseTo(floor - 0.45, 6);
    // 歩ける床の高低差は 32m（設計 #11 の 2 章）
    const walk = map.platforms.filter((p) => p.look !== 'water' && p.look !== 'rock');
    expect(Math.max(...walk.map((p) => p.h)) - Math.min(...walk.map((p) => p.h))).toBe(32);
    // 階段は、蹴上げ 1/6m・踏面 0.3m・幅 3m（設計 #11 の 4 章の範囲）
    const steps = map.platforms.filter((p) => p.look === 'stone' && Math.min(p.maxX - p.minX, p.maxZ - p.minZ) < 0.31);
    expect(steps.length).toBeGreaterThan(300);
    for (const s of steps) {
      expect(Math.min(s.maxX - s.minX, s.maxZ - s.minZ)).toBeCloseTo(0.3, 6);
      expect(Math.max(s.maxX - s.minX, s.maxZ - s.minZ)).toBeGreaterThanOrEqual(3);
    }
    // 踊り場は 4.5m 以上
    for (const p of map.platforms.filter((q) => q.look === 'stone' && Math.min(q.maxX - q.minX, q.maxZ - q.minZ) >= 2 && q.h !== 0 && q.h !== 8)) {
      expect(Math.min(p.maxX - p.minX, p.maxZ - p.minZ), JSON.stringify(p)).toBeGreaterThanOrEqual(2.1);
      expect(Math.max(p.maxX - p.minX, p.maxZ - p.minZ), JSON.stringify(p)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('生活の道: 広場 → 西の階段 → 炉の段 → 南の石段 → 水音の庭 → 崖沿いの石段 → 見晴らし台 → 広場を、跳ばずに一周できる', () => {
    const sim = hubSim();
    const ys = walkRoute(sim, [
      [-15, 8.5], [-24.6, 8.5], [-28.5, -12], [-28.5, -16], [-28.5, -24], [-28.5, -25.5], [-28.5, -35], [-8, -30], [-6, -18.5], [6.75, -18.5], [20.5, -18.5], [20.5, -12], [0, -9],
    ]);
    expect(ys).toEqual([0, -3, -3, -3, -6.5, -6.5, -10, -10, -10, -5, 0, 0, 0]);
    expect(sim.player.vel.vy).toBe(0);
  });

  it('見晴らしの道: 広場 → 崖沿いの石段 → 暮らしの段 → 灯見の台（西）→ 吊り橋 → 灯見の台（東）→ 東の石段 → 暮らしの段 → 崖沿いの石段 → 広場を一周できる', () => {
    const sim = hubSim();
    const ys = walkRoute(sim, [
      [-5.5, 15.5], [-4.5, 18.5], [-15.5, 18.5], [-26.5, 18.5], [-26.5, 24], [-5, 38.5], [-4.5, 41.5], [-20.8, 41.5], [-37.5, 41.5], [-36, 46], [-6, 52], [5, 51.5],
      [20, 44], [22.5, 41.5], [22.5, 24.4], [6.8, 24.4], [2, 24], [2, 18.5], [12.5, 18.5], [22.8, 18.5], [22.8, 14], [0, -9],
    ], 2200);
    expect(ys).toEqual([0, 0, 4, 8, 8, 8, 8, 15, 22, 22, 22, 22, 22, 22, 15, 8, 8, 8, 4, 0, 0, 0]);
  });

  it('落ちない: 暮らしの段・灯見の台の縁、裂け目、吊り橋のわき、沢へは、歩いても下りられない（体が縁にかからない所で止まる）', () => {
    const w = new World(map);
    const r = content.player.radius;
    const push = (x: number, z: number, dx: number, dz: number): { x: number; y: number; z: number } => {
      const p = { x, y: w.groundHeight(x, z), z };
      for (let i = 0; i < 300; i++) w.move(p, r, dx, dz);
      return p;
    };
    // 暮らしの段の南の縁（z 17）から南へ / 灯見の台の南の縁（z 40）から南へ
    const a = push(-30, 20, 0, -0.05);
    expect(a.y).toBe(8);
    expect(a.z).toBeGreaterThan(17 + r);
    const b = push(10, 43, 0, -0.05);
    expect(b.y).toBe(22);
    expect(b.z).toBeGreaterThan(40 + r);
    // 裂け目へ（灯見の台の西から東へ）
    const c = push(-5, 45, 0.05, 0);
    expect(c.y).toBe(22);
    expect(c.x).toBeLessThan(-2 - r);
    // 吊り橋の上から、わきへ
    const d = push(0, 51.5, 0, 0.05);
    expect(d.y).toBe(22);
    expect(d.z).toBeLessThan(53 - r);
    // 沢へ（庭の西の縁から西へ）
    const e = push(-38, -30, -0.05, 0);
    expect(e.y).toBe(-10);
    expect(e.x).toBeGreaterThan(-42 + r);
    // 吊り橋の下（裂け目の底）は、どの段からも行けない（底から縁へ上がれないので、出られもしない）
    expect(groundAt(map.platforms, 0, 45) - groundAt(map.platforms, 0, 39)).toBeGreaterThan(map.stepUp);
  });

  it('施設は広場と炉の段だけ。上の段の、施設の真上の辺りに立っても開かない', () => {
    const sim = hubSim();
    for (const f of content.hub.facilities) expect([0, -3]).toContain(sim.world.groundHeight(f.x, f.z));
    // 依頼板の北（暮らしの段の上）
    expect(nearestFacility(content.hub.facilities, sim.world, { x: 0, y: 8, z: 12 })).toBeNull();
  });
});

describe('里の 5 つの段（v0.35.0）: データ', () => {
  it('建物と飾り・人・小物は、どれも床に立つ当たりがある（tools/gen-hub.py）。当たりの並びは、施設 → 建物と飾り → 人 → 小物', () => {
    const hub = content.hub;
    expect((hub.scenery ?? []).length).toBeGreaterThanOrEqual(20);
    expect((hub.props ?? []).length).toBeGreaterThanOrEqual(15);
    expect(map.rocks[0]!.x).toBe(hub.facilities[0]!.building.x);
    expect(map.rocks[hub.facilities.length]!.x).toBe(hub.scenery![0]!.x);
    const last = hub.props!.at(-1)!;
    expect(map.rocks.at(-1)!.x).toBe(last.x);
    // 段ごとの建物（設計 #11 の 2 章の表）
    const tier = (id: string): number => {
      const s = hub.scenery!.find((q) => q.id === id)!;
      return groundAt(map.platforms, s.x, s.z);
    };
    expect([tier('mill.garden'), tier('store.garden'), tier('lift.garden'), tier('wash.garden')]).toEqual([-10, -10, -10, -10]);
    expect([tier('shed.forge'), tier('anvil.forge'), tier('tank.forge')]).toEqual([-3, -3, -3]);
    expect([tier('inn.living'), tier('house.a'), tier('house.b'), tier('field.living')]).toEqual([8, 8, 8, 8]);
    expect([tier('hall.lookout'), tier('survey.lookout'), tier('watch.lookout')]).toEqual([22, 22, 22]);
    const errors: string[] = [];
    validateHub(content, errors);
    expect(errors).toEqual([]);
  });

  it('検査は、壊れたデータを見つける（小物の絵の名前・建物の当たり・外周の出口・施設の前の当たり）', () => {
    const broken = (edit: (c: Content) => void): string => {
      const c = { ...content, hub: JSON.parse(JSON.stringify(content.hub)) as Content['hub'], maps: new Map(content.maps) };
      c.maps.set(map.id, JSON.parse(JSON.stringify(map)) as MapDef);
      edit(c);
      const e: string[] = [];
      validateHub(c, e);
      return e.join('\n');
    };
    expect(broken((c) => { c.hub.props![0]!.art = 'no_such_art'; })).toMatch(/art no_such_art が不明/);
    expect(broken((c) => { const s = c.hub.scenery!.find((q) => q.id === 'inn.living')!; s.x += 6; })).toMatch(/inn\.living: 当たり/);
    expect(broken((c) => { c.hub.gates![0]!.x = 10; })).toMatch(/外周の上に無い/);
    expect(broken((c) => { c.maps.get(map.id)!.rocks.push({ x: 0, z: 10.4, r: 0.5, h: 1 }); })).toMatch(/施設の前（立つ輪）に、当たり/);
    expect(broken((c) => { c.hub.scenery![1]!.kind = 'castle' as never; })).toMatch(/kind castle が不明/);
  });

  it('小物の絵（ChatGPT の物語の原画 #13）: 名前は図集の索引と同じ。図集と原画がある。背丈がある', () => {
    for (const a of HUB_PROP_ARTS) {
      expect(PROP_ART[a], a).toBeDefined();
      expect(PROP_HEIGHT[a], a).toBeGreaterThan(0.3);
      expect(existsSync(join(ROOT, 'art-source/story', PROP_ART[a]!.source)), a).toBe(true);
    }
    expect(Object.keys(PROP_ART).sort()).toEqual([...HUB_PROP_ARTS].sort());
    expect(existsSync(join(ROOT, 'public/assets/textures/props/props_story_v1.webp'))).toBe(true);
  });
});

describe('里の 5 つの段（v0.35.0）: 見た目と音', () => {
  it('建物・水車・昇降台・物干し・小物の板・外の斜面・山の岩ができ、動くものは動く', () => {
    const { group, village } = buildHubGroup(content.hub, map);
    const v = group.getObjectByName('village')!;
    const kinds = v.children.map((o) => o.userData.village).filter(Boolean).sort();
    expect(kinds).toEqual(['glow', 'plain', 'roof', 'stone']);
    const wheel = v.children.find((o) => o.userData.wheel) as Mesh;
    const lift = v.children.find((o) => o.userData.lift)!;
    const props = v.children.find((o) => o.userData.props)!;
    expect(wheel).toBeDefined();
    expect(props.userData.props).toBe((content.hub.props ?? []).length + 1);
    expect(v.children.find((o) => o.userData.trails)!.userData.trails).toBe((content.hub.gates ?? []).filter((g) => g.trail).length);
    expect(v.children.find((o) => o.userData.laundry)).toBeDefined();
    expect((v.children.find((o) => o.userData.rockArt)!.userData.rockArt as string[]).length).toBeGreaterThanOrEqual(6);
    // 動く: 水車は回り、昇降台は上がる
    village.update(0.016, 0, { x: 0, y: 1.5, z: 0 }, 300);
    const y0 = lift.position.y;
    village.update(0.016, 7, { x: 0, y: 1.5, z: 0 }, 300);
    expect(lift.position.y).toBeGreaterThan(y0 + 2);
    expect(wheel.rotation.x).toBeGreaterThan(1);
    // 小滝は 3 つ（沢の段の境）。それぞれの下で、しぶきが出る
    const falls = group.getObjectByName('terraces')!.children.find((m) => m.userData.terrace === 'fall')!.userData.falls as unknown[];
    expect(falls.length).toBe(3);
  });

  it('里の音: 水辺では沢が大きく、炉の段では炉が大きく、上の段ほど風が強い。鍛冶は槌を一定の間で打ち、近いほど大きい', () => {
    const { village } = buildHubGroup(content.hub, map);
    const at = (x: number, z: number, t = 0.5) => village.update(0.016, t, { x, y: groundAt(map.platforms, x, z) + 1.5, z }, 300).ambience;
    const garden = at(-38, -25), plaza = at(10, 0), forge = at(-29, 11), lookout = at(10, 50);
    expect(garden.water).toBeGreaterThan(0.6);
    expect(plaza.water).toBeLessThan(garden.water);
    expect(forge.forge).toBeGreaterThan(0.6);
    expect(plaza.forge).toBeLessThan(forge.forge);
    expect(lookout.wind).toBeGreaterThan(plaza.wind);
    expect(plaza.wind).toBeGreaterThan(garden.wind);
    // 槌の音: 鍛冶のそばで、SMITH_PERIOD ごとに 1 回（初めの 1 回は数えない）
    const { village: v2 } = buildHubGroup(content.hub, map);
    let clanks = 0, sparks = 0, near = 0;
    for (let t = 0; t < SMITH_PERIOD * 5.5; t += 0.05) {
      const fr = v2.update(0.05, t, { x: -29, y: -1.5, z: 12 }, 300);
      for (const s of fr.sounds) if (s.id === 'forge_clank') {
        clanks++;
        near = Math.max(near, s.k);
      }
      sparks += fr.sparks.length;
    }
    expect(clanks).toBe(5);
    expect(sparks).toBe(5);
    expect(near).toBeGreaterThan(0.8);
  });
});
