// 狩らない依頼（採集・採掘・現地の納品。v0.27.0、docs/spec.md の 27 章、ChatGPT のクエスト設計 #9 の G01・G02・M01・M02・D01）。
import { beforeAll, describe, expect, it } from 'vitest';
import type { Content, QuestDef } from '../src/data/schemas';
import { GATHER_BAG } from '../src/data/schemas';
import { questMaterials, validateGather } from '../src/data/validators';
import { DEPOT_REACH, NODE_REACH, errandProgress, errandReady, openNodes } from '../src/game/errand';
import { questTimeLimitTicks } from '../src/game/field';
import { Simulation } from '../src/game/sim';
import { newSave, settleRun } from '../src/save/profile';
import { Btn, baseOptions, frame, press, run } from './helpers';
import { loadContent } from './helpers';

let content: Content;
beforeAll(async () => {
  content = await loadContent();
});

const IDS = ['quest.gather.001', 'quest.gather.002', 'quest.mine.001', 'quest.mine.002', 'quest.delivery.001'];
const LEAF = 'mat.gather.flatnagi_leaf';
const start = (questId: string, over = {}): Simulation => new Simulation(content, baseOptions({ questId, field: true, monsterId: null, ...over }));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const errorsOf = (id: string, fn: (q: QuestDef) => void): string => {
  const q = clone(content.quests.get(id)!);
  fn(q);
  return validateGather(content, q).join('\n');
};

/** プレイヤーを、(x, z) の近くへ置く（納刀・止まった状態）。向きは点の方 */
function standNear(sim: Simulation, areaId: string, x: number, z: number, dist = 1.2): void {
  const p = sim.player;
  sim.areaId = areaId;
  p.pos = { x: x - dist, y: 0, z };
  p.prevPos = { ...p.pos };
  p.yaw = Math.PI / 2;
  p.drawn = false;
}

/** その tick に攻撃ボタンを押して、行動が終わるまで進める */
function act(sim: Simulation, n = 160): ReturnType<typeof run> {
  return run(sim, n, (i) => (i === 0 ? press(Btn.Main) : frame()));
}

/**
 * (x, z) へ歩く（実際の移動・当たりで）。外周は道しるべを伝い、岩が前を塞ぐ時は、岩の横の点を目指す。
 * 着けば true。エリアが変わったら、そこで止まる。
 */
function walkTo(sim: Simulation, x: number, z: number, max = 4000): boolean {
  for (let i = 0; i < max; i++) {
    const p = sim.player.pos;
    if (Math.hypot(x - p.x, z - p.z) < 0.3) return true;
    const area = sim.area()!;
    let t = sim.world.steerTo(area, p.x, p.z, x, z, 0.5);
    for (const r of area.rocks) {
      const dx = t.x - p.x, dz = t.z - p.z, L = Math.hypot(dx, dz) || 1;
      const ux = dx / L, uz = dz / L;
      const along = (r.x - p.x) * ux + (r.z - p.z) * uz;
      const side = (r.x - p.x) * -uz + (r.z - p.z) * ux;
      if (along > 0 && along < L && Math.abs(side) < r.r + 0.9) {
        const s = side > 0 ? -1 : 1;
        t = { x: r.x + -uz * s * (r.r + 1.4), z: r.z + ux * s * (r.r + 1.4) };
      }
    }
    const d = Math.hypot(t.x - p.x, t.z - p.z) || 1;
    sim.step(frame({ moveX: (t.x - p.x) / d, moveZ: (t.z - p.z) / d }));
    if (sim.drainEvents().some((e) => e.type === 'area_change')) return false;
  }
  return false;
}

/** 出口を通って、隣のエリアへ */
function goTo(sim: Simulation, to: string): void {
  const e = sim.area()!.exits.find((x) => x.to === to)!;
  walkTo(sim, e.x, e.z);
  if (sim.areaId !== to) {
    // 出口の円の中へもう少し進む
    for (let i = 0; i < 120 && sim.areaId !== to; i++) {
      const p = sim.player.pos, d = Math.hypot(e.x - p.x, e.z - p.z) || 1;
      sim.step(frame({ moveX: (e.x - p.x) / d, moveZ: (e.z - p.z) / d }));
      sim.drainEvents();
    }
  }
  expect(sim.areaId).toBe(to);
}

describe('狩らない依頼のデータ', () => {
  it('盆地の 5 件: 獣は出ない・要る数より 2 個以上多く採れる・採集袋に入る・採取点はエリアの中で岩と出口から離れる', () => {
    for (const id of IDS) {
      const q = content.quests.get(id)!;
      expect(q.kind, id).toBe('gather');
      expect(q.targetMonsterId).toBeUndefined();
      expect(q.targets).toBeUndefined();
      expect(q.gather!.encounters).toBe('none');
      expect(validateGather(content, q)).toEqual([]);
      expect(questTimeLimitTicks(content, q, true)).toBe(15 * 3600);
      expect(q.board).toMatchObject({ stars: 1, lane: 'free' });
      expect(q.supplies).toEqual([{ itemId: 'item.heal_tonic', count: 3 }, { itemId: 'item.whetstone', count: 1 }]);
      for (const s of q.gather!.needs) {
        const supply = q.gather!.nodes.filter((n) => n.itemId === s.itemId).length * q.gather!.yieldPerNode;
        expect(supply).toBeGreaterThanOrEqual(s.count + 2);
        expect(supply).toBeLessThanOrEqual(GATHER_BAG.perItem);
      }
      // 持ち帰る素材として、取得できる素材に数える
      for (const n of q.gather!.nodes) expect(questMaterials(content, q).has(n.itemId)).toBe(true);
    }
    expect(content.quests.get('quest.delivery.001')!.gather!.needs.map((s) => s.itemId)).toEqual([LEAF, 'mat.ore.grit_whetstone']);
  });

  it('検査が誤りを見つける: エリアの外・岩や出口に近い・足りない数・袋に入らない・知らない素材・納品箱が野営地の外・ダミーの標的', () => {
    expect(errorsOf('quest.gather.001', (q) => void (q.gather!.nodes[0]!.x = -300))).toContain('外周に近すぎる');
    expect(errorsOf('quest.mine.001', (q) => Object.assign(q.gather!.nodes[0]!, { x: -14.74 + 1.5, z: -239.21 }))).toContain('岩に近すぎる');
    expect(errorsOf('quest.gather.001', (q) => Object.assign(q.gather!.nodes[0]!, { x: -217, z: -240 }))).toContain('出口に近すぎる');
    expect(errorsOf('quest.gather.001', (q) => void q.gather!.nodes.pop())).toContain('しか採れない');
    expect(errorsOf('quest.gather.002', (q) => void (q.gather!.yieldPerNode = 5))).toContain('採集袋に入りきらない');
    expect(errorsOf('quest.gather.001', (q) => void (q.gather!.needs[0]!.itemId = 'mat.none'))).toContain('要る素材 mat.none が無い');
    expect(errorsOf('quest.gather.001', (q) => void (q.gather!.depot = { areaId: 'a1', x: 0, z: -240 }))).toContain('納品箱 は野営地に置く');
    expect(errorsOf('quest.gather.001', (q) => void (q.gather!.nodes[1]!.x = q.gather!.nodes[0]!.x + 1, q.gather!.nodes[1]!.z = q.gather!.nodes[0]!.z))).toContain('近すぎる（4m 未満）');
  });
});

describe('採って、納める', () => {
  it('大型も幼体も出ない。野営地から出発し、時計は 15 分。採取点は 1 か所 2 個、2 度は採れない', () => {
    const sim = start('quest.gather.001');
    expect(sim.monsters).toEqual([]);
    expect(sim.herds).toEqual([]);
    expect(sim.areaId).toBe('camp');
    expect(sim.hunt!.timeLimitTicks).toBe(54000);
    const n = sim.errand!.def.nodes[0]!;
    standNear(sim, n.areaId, n.x, n.z);
    expect(sim.errandTarget()).toEqual({ kind: 'node', nodeId: n.id, actionId: 'player.common.gather' });
    const evs = act(sim);
    expect(evs.filter((e) => e.type === 'errand_gather')).toHaveLength(1);
    expect(sim.errand!.bag[LEAF]).toBe(2);
    expect(sim.errand!.used).toEqual([n.id]);
    // もう採れない（攻撃ボタンは、何も始めない）
    expect(sim.errandTarget()).toBeNull();
    act(sim, 100);
    expect(sim.errand!.bag[LEAF]).toBe(2);
  });

  it('採集は 72 tick、採掘は 126 tick で品が入る。回避で止めると、何も入らず、採取点も残る', () => {
    const sim = start('quest.mine.001');
    const n = sim.errand!.def.nodes[0]!;
    standNear(sim, n.areaId, n.x, n.z, 1.3);
    const t = sim.errandTarget()!;
    expect(t).toMatchObject({ kind: 'node', actionId: 'player.common.mine' });
    sim.step(press(Btn.Main));
    run(sim, 124);
    expect(sim.errand!.bag['mat.ore.basin_iron']).toBeUndefined();
    run(sim, 2);
    expect(sim.errand!.bag['mat.ore.basin_iron']).toBe(2);
    // 止める: 採集の途中（40 tick）で回避
    const g = start('quest.gather.001');
    const m = g.errand!.def.nodes[1]!;
    standNear(g, m.areaId, m.x, m.z);
    g.step(press(Btn.Main));
    run(g, 40);
    expect(g.player.action?.def.actionId).toBe('player.common.gather');
    g.step(frame({ pressed: Btn.Dodge, held: Btn.Dodge, moveX: -1 }));
    run(g, 80);
    expect(g.errand!.bag[LEAF]).toBeUndefined();
    expect(g.errand!.used).toEqual([]);
    expect(g.player.errandOp).toBeNull();
  });

  it('抜刀していると、採る・納めるはできない（攻撃ボタンは攻撃のまま）', () => {
    const sim = start('quest.gather.001');
    const n = sim.errand!.def.nodes[0]!;
    standNear(sim, n.areaId, n.x, n.z);
    sim.player.drawn = true;
    expect(sim.errandTarget()).toBeNull();
  });

  it('要る数がそろうまで、納品箱は使えない。そろうと 1 度で納め、余りだけを持ち帰る。時計が止まり、5 秒で帰る', () => {
    const sim = start('quest.gather.001');
    const e = sim.errand!;
    const d = e.def.depot;
    for (const n of e.def.nodes.slice(0, 2)) {
      standNear(sim, n.areaId, n.x, n.z);
      act(sim);
    }
    expect(errandProgress(e)).toEqual([{ itemId: LEAF, have: 4, need: 6 }]);
    standNear(sim, d.areaId, d.x, d.z, 1.5);
    expect(sim.errandTarget()).toBeNull();
    for (const n of e.def.nodes.slice(2)) {
      standNear(sim, n.areaId, n.x, n.z);
      act(sim);
    }
    expect(e.bag[LEAF]).toBe(8);
    expect(errandReady(e)).toBe(true);
    standNear(sim, d.areaId, d.x, d.z, 1.5);
    expect(sim.errandTarget()).toEqual({ kind: 'deliver', actionId: 'player.common.deliver' });
    const evs = act(sim, 60);
    const h = sim.hunt!;
    expect(evs.some((x) => x.type === 'errand_deliver')).toBe(true);
    expect(h).toMatchObject({ phase: 'success', reason: 'deliver' });
    // 余り（8 - 6 = 2 枚）だけ
    expect(h.loot.map((g) => `${g.itemId}@${g.source}`)).toEqual([`${LEAF}@gather`, `${LEAF}@gather`]);
    const t = h.ticks;
    run(sim, 200);
    expect(h.ticks).toBe(t);
    expect(h.closed).toBe(false);
    run(sim, 120);
    expect(h.closed).toBe(true);
    expect(h.rewards).toEqual({ money: 240, items: [{ itemId: LEAF, count: 2 }] });
    // 保存: 余りと通貨と達成回数が入る（納品した 6 枚は入らない）
    const doc = settleRun(newSave(content, { now: 'x', appVersion: 't', contentVersion: 't' }), { runId: 'r', questId: h.quest.id, money: h.rewards!.money, items: h.rewards!.items })!;
    expect(doc.items[LEAF]).toBe(2);
    expect(doc.progress.questClears['quest.gather.001']).toBe(1);
  });

  it('時間切れと納品が同じ tick なら、失敗（終わり方は 1 つ）。リタイアでは何も持ち帰らない', () => {
    const sim = start('quest.gather.001');
    const e = sim.errand!;
    for (const n of e.def.nodes) {
      standNear(sim, n.areaId, n.x, n.z);
      act(sim);
    }
    const d = e.def.depot;
    standNear(sim, d.areaId, d.x, d.z, 1.5);
    const h = sim.hunt!;
    // 納める行動の 30 tick 目が、ちょうど制限の tick になるように
    h.ticks = h.timeLimitTicks - 31;
    sim.step(press(Btn.Main));
    run(sim, 40);
    expect(h).toMatchObject({ phase: 'failed', reason: 'time' });
    expect(h.rewards).toEqual({ money: 0, items: [] });
    const r = start('quest.gather.001');
    const n0 = r.errand!.def.nodes[0]!;
    standNear(r, n0.areaId, n0.x, n0.z);
    act(r);
    r.step(press(Btn.Retire));
    expect(r.hunt).toMatchObject({ phase: 'failed', reason: 'retire', loot: [], rewards: { money: 0, items: [] } });
  });

  it('5 件とも、野営地から実際に歩いて、全部の採取点で採り、納品箱で納められる（エリアの出入りでも採った状態は戻らない）', () => {
    for (const id of IDS) {
      const sim = start(id);
      const e = sim.errand!;
      const order = ['camp', 'a1', 'a5'];
      for (const areaId of order) {
        const here = e.def.nodes.filter((n) => n.areaId === areaId);
        const later = e.def.nodes.some((n) => order.indexOf(n.areaId) > order.indexOf(areaId));
        if (sim.areaId !== areaId) {
          if (here.length === 0 && !later) break;
          goTo(sim, areaId);
        }
        for (const n of here) {
          expect(walkTo(sim, n.x - 1.1, n.z), `${id} ${n.id}`).toBe(true);
          expect(sim.errandTarget(), `${id} ${n.id} ${Math.hypot(sim.player.pos.x - n.x, sim.player.pos.z - n.z).toFixed(2)} ${sim.player.mode} ${sim.player.drawn}`).toMatchObject({ kind: 'node', nodeId: n.id });
          act(sim);
          expect(sim.errand!.used).toContain(n.id);
        }
      }
      // 戻る
      while (sim.areaId !== 'camp') goTo(sim, sim.areaId === 'a5' ? 'a1' : 'camp');
      expect(openNodes(e, null)).toEqual([]);
      expect(errandReady(e)).toBe(true);
      const d = e.def.depot;
      expect(walkTo(sim, d.x - 1.4, d.z), id).toBe(true);
      expect(Math.hypot(sim.player.pos.x - d.x, sim.player.pos.z - d.z)).toBeLessThanOrEqual(DEPOT_REACH);
      act(sim, 60);
      expect(sim.hunt, id).toMatchObject({ phase: 'success', reason: 'deliver' });
      // 目安の時間（長い方）より短い（歩いて採るだけの最短。試遊の代わりではない）
      expect(sim.hunt!.ticks / 3600, id).toBeLessThan(sim.hunt!.quest.board!.clearMinutes[1]);
    }
  });

  it('同じ入力なら、いつも同じ結果（採った状態と採集袋も、状態の指紋に入る）', () => {
    const play = (): string[] => {
      const sim = start('quest.gather.002');
      const hs: string[] = [];
      for (const n of sim.errand!.def.nodes.slice(0, 2)) {
        standNear(sim, n.areaId, n.x, n.z);
        run(sim, 100, (i) => (i === 0 ? press(Btn.Main) : frame()));
        hs.push(sim.hash());
      }
      return hs;
    };
    expect(play()).toEqual(play());
    expect(NODE_REACH).toBeGreaterThan(1);
  });
});
