// フィールド（エリアに分かれた狩場）と、大型の移動・休息（v0.11.0、docs/spec.md 18 章）。
// 野営地から出発して出口でエリアを移る。大型は決まった順にエリアを巡り、弱ると巣で眠る。
import { beforeAll, describe, expect, it } from 'vitest';
import type { Content, FieldDef } from '../src/data/schemas';
import { FIELD_AREA_GAP, validateField } from '../src/data/validators';
import type { SimEvent } from '../src/game/events';
import { areaLabel, areaOf, questTimeLimitTicks } from '../src/game/field';
import { AreaShape } from '../src/game/areaShape';
import { applyDamageToMonster } from '../src/game/monster';
import { resolveIncomingHit } from '../src/game/player';
import { headingTo, nextHop } from '../src/game/roam';
import { Simulation } from '../src/game/sim';
import { baseOptions, frame, loadContent, run } from './helpers';

let content: Content;
let field: FieldDef;
beforeAll(async () => {
  content = await loadContent();
  field = content.fields.get('field.basin')!;
});

const Q = 'quest.basin.003';
const fieldSim = (over: Parameters<typeof baseOptions>[0] = {}): Simulation => new Simulation(content, baseOptions({ questId: Q, field: true, ...over }));
type Ev<T extends SimEvent['type']> = Extract<SimEvent, { type: T }>;
const only = <T extends SimEvent['type']>(evs: SimEvent[], type: T): Ev<T>[] => evs.filter((e): e is Ev<T> => e.type === type);

/** プレイヤーを (x, z) へ向けて歩かせる。エリアが変わるか、n tick 経つまで。 */
function walkTo(sim: Simulation, x: number, z: number, n = 1500): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < n; i++) {
    const dx = x - sim.player.pos.x, dz = z - sim.player.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    sim.step(frame({ moveX: dx / d, moveZ: dz / d }));
    const evs = sim.drainEvents();
    out.push(...evs);
    if (evs.some((e) => e.type === 'area_change')) break;
  }
  return out;
}
const exitOf = (from: string, to: string): FieldDef['areas'][number]['exits'][number] => areaOf(field, from)!.exits.find((e) => e.to === to)!;

describe('フィールドのデータ（風礫盆地）', () => {
  it('野営地と 10 エリア。番号は 0〜10 で、検査に通る', () => {
    expect(field.name).toBe('風礫盆地');
    expect(field.areas.map((a) => a.no)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(field.areas.filter((a) => a.kind === 'camp').map((a) => a.id)).toEqual(['camp']);
    expect(field.areas.filter((a) => a.kind === 'nest').map((a) => a.id)).toEqual(['a10']);
    const errors: string[] = [];
    validateField(content, field, errors);
    expect(errors).toEqual([]);
  });

  it('エリアどうしは、気づく距離や矢が届く距離より、ずっと離れている', () => {
    let min = Infinity;
    for (const a of field.areas) {
      for (const b of field.areas) {
        if (a.id >= b.id) continue;
        const dx = Math.max(b.bounds.minX - a.bounds.maxX, a.bounds.minX - b.bounds.maxX, 0), dz = Math.max(b.bounds.minZ - a.bounds.maxZ, a.bounds.minZ - b.bounds.maxZ, 0);
        min = Math.min(min, Math.hypot(dx, dz));
      }
    }
    expect(min).toBeGreaterThanOrEqual(FIELD_AREA_GAP);
    expect(content.monsters.get('monster.galdros')!.discover!.range).toBeLessThan(FIELD_AREA_GAP / 2);
  });

  it('エリア 3 は、これまでの狩場と同じ位置の岩と出口を持つ（外周は自然な形。v0.20.0）', () => {
    const legacy = content.maps.get(field.legacyMapId)!;
    const a3 = areaOf(field, field.legacyAreaId)!;
    expect(a3.rocks).toEqual(legacy.rocks);
    // 出口は、これまでの外周（±40 / ±30）の 2m 内側
    expect(a3.exits.map((e) => [e.x, e.z])).toEqual([[0, -28], [-38, 0], [38, 0], [0, 28]]);
    const s = new AreaShape(a3.shape!);
    for (const p of [legacy.spawn, legacy.monsterSpawn]) expect(s.signedDistance(p.x, p.z)).toBeGreaterThan(3);
    for (const r of a3.rocks) expect(s.signedDistance(r.x, r.z)).toBeGreaterThan(r.r + 2);
  });

  it('検査は、壊れたデータを見つける（戻る出口が無い・着く場所が出口の上・大型が通れない巡り方）', () => {
    const broken = (edit: (f: FieldDef) => void): string[] => {
      const f = JSON.parse(JSON.stringify(field)) as FieldDef;
      edit(f);
      const errors: string[] = [];
      validateField(content, f, errors);
      return errors;
    };
    expect(broken((f) => void f.areas.find((a) => a.id === 'a1')!.exits.splice(0, 1)).join('\n')).toContain('戻る出口が無い');
    expect(broken((f) => {
      const e = f.areas.find((a) => a.id === 'camp')!.exits[0]!;
      const back = f.areas.find((a) => a.id === 'a1')!.exits.find((x) => x.to === 'camp')!;
      e.arrive = { x: back.x, z: back.z, yaw: 0 };
    }).join('\n')).toContain('出口に近すぎる');
    expect(broken((f) => void (f.routes['monster.galdros']!.roam = ['a3', 'a1'])).join('\n')).toContain('大型が入れないエリア');
    expect(broken((f) => void (f.areas.find((a) => a.id === 'a9')!.bounds.minX = 300)).join('\n')).toContain('近すぎる');
  });

  it('依頼はどれも、この狩場を使う。制限時間は、フィールドで狩る時だけ 2 倍（フィールドの時間を持つ依頼は、その値。v0.26.0）', () => {
    // ChatGPT のクエスト設計 #9: ガルドロスの中級・上級・極級だけ、フィールドで 35 / 40 / 45 分。1 つの狩場（arena）は 15 分のまま
    // v0.34.0: セルヴァルクの中級〜極級も、ガルドロスと同じ 35 / 40 / 45 分
    const explicit: Record<string, number> = { 'quest.basin.r2.001': 35, 'quest.basin.r3.001': 40, 'quest.basin.r4.001': 45, 'quest.selvark.r2': 35, 'quest.selvark.r3': 40, 'quest.selvark.r4': 45, 'quest.spinegale.r1': 15, 'quest.spinegale.r2': 30, 'quest.spinegale.r3': 40, 'quest.frostald.r1':20,'quest.frostald.r2':30,'quest.frostald.r3':40 };
    for (const q of content.quests.values()) {
      expect(content.fields.has(q.fieldId!)).toBe(true);
      if(!q.gather?.fieldGathering) expect(q.fieldId).toBe(q.id.startsWith('quest.frostald.')?'field.whitefrost':'field.basin');
      expect(questTimeLimitTicks(content, q, false)).toBe(q.timeLimitTicks);
      // 狩らない依頼（v0.27.0）は、フィールドで 15 分（tests/errand.test.ts）
      if (q.kind === 'gather') expect(questTimeLimitTicks(content, q, true)).toBe((q.gather?.fieldGathering?30:15) * 3600);
      else if (explicit[q.id]) expect(questTimeLimitTicks(content, q, true)).toBe(explicit[q.id]! * 3600);
      else {
        expect(q.fieldTimeLimitTicks).toBeUndefined();
        expect(questTimeLimitTicks(content, q, true)).toBe(q.timeLimitTicks * 2);
      }
    }
    expect(Object.keys(explicit).filter(id=>!id.startsWith('quest.spinegale.')&&!id.startsWith('quest.frostald.')).every((id) => content.quests.get(id)!.timeLimitTicks === 54000)).toBe(true);
    expect(fieldSim().hunt!.timeLimitTicks).toBe(108000);
    expect(new Simulation(content, baseOptions({ questId: Q })).hunt!.timeLimitTicks).toBe(54000);
    // simulation も同じ値を使う（受注の画面と、狩りの中の時計がずれない）
    const r4 = 'quest.basin.r4.001';
    expect(fieldSim({ questId: r4 }).hunt!.timeLimitTicks).toBe(162000);
    expect(new Simulation(content, baseOptions({ questId: r4 })).hunt!.timeLimitTicks).toBe(54000);
  });

  it('エリアの呼び名: 野営地は名前、ほかは番号', () => {
    expect(areaLabel(areaOf(field, 'camp')!)).toBe('野営地');
    expect(areaLabel(areaOf(field, 'a7')!)).toBe('エリア 7');
  });
});

describe('フィールドを使わない時は、これまでどおり', () => {
  it('field を指定しなければ、1 つの狩場で始まる（位置も、エリアの数も、これまでと同じ）', () => {
    const sim = new Simulation(content, baseOptions({ questId: Q }));
    expect(sim.field).toBeNull();
    expect(sim.world.areas.length).toBe(1);
    expect(sim.areaId).toBe('');
    expect(sim.player.pos).toMatchObject({ x: 0, z: -20 });
    expect(sim.monsters[0]!.roam).toBeNull();
    expect(sim.area()).toBeNull();
  });

  it('訓練場（依頼なし）は、field を付けても 1 つの狩場', () => {
    const sim = new Simulation(content, baseOptions({ field: true }));
    expect(sim.field).toBeNull();
    expect(sim.world.areas.length).toBe(1);
  });
});

describe('出発と、エリアの移動', () => {
  it('野営地から始まる。標的はエリア 3 に居て、まだ気づいていない', () => {
    const sim = fieldSim();
    expect(sim.areaId).toBe('camp');
    expect(sim.player.pos).toMatchObject({ x: field.start.x, z: field.start.z });
    const m = sim.monsters[0]!;
    expect(sim.monsterArea(m)!.id).toBe('a3');
    const spawn = content.quests.get(Q)!.monsterSpawn!;
    expect(m.pos).toMatchObject({ x: spawn.x, z: spawn.z });
    expect(m.aware).toBe(false);
  });

  it('出口に入ると、行き先のエリアの、決まった場所へ移る（野営地 → 1 → 3）', () => {
    const sim = fieldSim();
    const e1 = exitOf('camp', 'a1');
    const evs1 = walkTo(sim, e1.x, e1.z);
    expect(only(evs1, 'area_change')).toEqual([{ type: 'area_change', from: 'camp', to: 'a1' }]);
    expect(sim.areaId).toBe('a1');
    expect(sim.player.pos).toMatchObject({ x: e1.arrive.x, z: e1.arrive.z });
    expect(sim.player.yaw).toBeCloseTo(e1.arrive.yaw, 4);
    // 着いた直後に、戻りの出口へ入ってしまわない
    expect(only(run(sim, 120), 'area_change')).toEqual([]);
    const e3 = exitOf('a1', 'a3');
    const evs3 = walkTo(sim, e3.x, e3.z);
    expect(only(evs3, 'area_change')).toEqual([{ type: 'area_change', from: 'a1', to: 'a3' }]);
    expect(sim.area()!.name).toBe('岩原');
    expect(sim.player.pos).toMatchObject({ x: 0, z: -20 });
  });

  it('エリアの外へは出られない（縁で止まる）。岩にも入らない', () => {
    const sim = fieldSim();
    const b = areaOf(field, 'camp')!.bounds;
    walkTo(sim, b.minX - 50, b.minZ - 50, 900);
    expect(sim.areaId).toBe('camp');
    expect(sim.player.pos.x).toBeGreaterThanOrEqual(b.minX);
    expect(sim.player.pos.z).toBeGreaterThanOrEqual(b.minZ);
    // エリア 1 の岩へ向かって歩く
    const e1 = exitOf('camp', 'a1');
    walkTo(sim, e1.x, e1.z);
    const rock = areaOf(field, 'a1')!.rocks[0]!;
    walkTo(sim, rock.x, rock.z, 900);
    expect(Math.hypot(sim.player.pos.x - rock.x, sim.player.pos.z - rock.z)).toBeGreaterThanOrEqual(rock.r + content.player.radius - 1e-6);
  });

  it('力尽きると、野営地へ戻る（居るエリアも野営地になる）', () => {
    const sim = fieldSim();
    walkTo(sim, exitOf('camp', 'a1').x, exitOf('camp', 'a1').z);
    expect(sim.areaId).toBe('a1');
    sim.drainEvents();
    resolveIncomingHit(sim.player, { attackerPos: { x: 0, y: 0, z: -200 }, baseDamage: 9999, guardable: false, guardCost: 0, reaction: 'knockdown' }, sim);
    const evs = run(sim, content.player.respawnTicks + 30);
    expect(only(evs, 'area_change')).toEqual([{ type: 'area_change', from: 'a1', to: 'camp' }]);
    expect(sim.areaId).toBe('camp');
    expect(sim.player.pos).toMatchObject({ x: field.start.x, z: field.start.z });
    expect(sim.hunt!.faints).toBe(1);
  });
});

describe('大型の移動', () => {
  it('通り道は、大型が通れる出口だけを使う', () => {
    expect(nextHop(field, 'a3', 'a7')!.to).toBe('a7');
    expect(nextHop(field, 'a3', 'a10')!.to).toMatch(/^a(6|7)$/);
    expect(nextHop(field, 'a2', 'a10')).not.toBeNull();
    expect(nextHop(field, 'a3', 'a3')).toBeNull();
    // 野営地と通り道（1・5・8）へは、大型は入らない
    for (const id of ['camp', 'a1', 'a5', 'a8']) expect(nextHop(field, 'a3', id)).toBeNull();
  });

  it('最初のエリアには 90〜150 秒居る（seed で変わる）', () => {
    const [lo, hi] = field.roam.stayTicks;
    expect([lo, hi]).toEqual([5400, 9000]);
    for (const seed of [1, 2, 3]) {
      const sim = fieldSim({ seed });
      const evs = run(sim, hi + 5);
      expect(only(evs, 'monster_leave').length).toBe(1);
      expect(only(run(new Simulation(content, baseOptions({ questId: Q, field: true, seed })), lo - 5), 'monster_leave')).toEqual([]);
    }
  }, 30_000); // Actions では 5 秒を超えることがある（v0.39.0 の公開で 5.2 秒。手元は 2〜3 秒）

  it('しばらく居た後、次のエリアへ歩いて移る。順番は決まっている（3 → 7 → 4 → 2 → 3）', () => {
    const sim = fieldSim();
    const m = sim.monsters[0]!;
    const evs = run(sim, 60 * 60 * 12);
    const moves = only(evs, 'monster_move').map((e) => e.areaId);
    expect(moves.slice(0, 5)).toEqual(['a7', 'a4', 'a2', 'a3', 'a7']);
    const leaves = only(evs, 'monster_leave');
    expect(leaves[0]).toMatchObject({ from: 'a3', to: 'a7' });
    expect(m.hp).toBe(m.def.hp);
    expect(m.asleep).toBe(false);
  }, 30_000); // Actions では 5 秒を超えることがある（v0.39.0 の公開で 5.2 秒。手元は 2〜3 秒）

  it('出口へ歩く間も、着いた後も、エリアの外へ出ない。着く場所は、大型用の場所', () => {
    const sim = fieldSim();
    const m = sim.monsters[0]!;
    let arrived = 0;
    for (let i = 0; i < 60 * 60 * 8; i++) {
      sim.step(frame());
      const evs = sim.drainEvents();
      const a = sim.monsterArea(m)!;
      expect(m.pos.x).toBeGreaterThanOrEqual(a.bounds.minX);
      expect(m.pos.x).toBeLessThanOrEqual(a.bounds.maxX);
      expect(m.pos.z).toBeGreaterThanOrEqual(a.bounds.minZ);
      expect(m.pos.z).toBeLessThanOrEqual(a.bounds.maxZ);
      for (const mv of only(evs, 'monster_move')) {
        const into = field.areas.flatMap((x) => x.exits).find((e) => e.to === mv.areaId && e.arriveLarge && Math.hypot(e.arriveLarge.x - m.pos.x, e.arriveLarge.z - m.pos.z) < 1e-6);
        expect(into).toBeDefined();
        arrived++;
      }
    }
    expect(arrived).toBeGreaterThanOrEqual(3);
  }, 30_000); // Actions では 5 秒を超えることがある（v0.39.0 の公開で 5.2 秒。手元は 2〜3 秒）

  it('長く動かしても、どこかに引っかかって止まらない（seed を変えて 40 分ずつ。出口へ歩く時間は 1 分以内）', () => {
    for (const seed of [11, 22, 33, 44]) {
      const sim = fieldSim({ seed });
      // 制限時間で依頼が終わっても、大型は動き続ける（ここでは移動だけを見る）
      let leftAt = -1, worst = 0, moves = 0;
      for (let i = 0; i < 60 * 60 * 40; i++) {
        sim.step(frame());
        for (const e of sim.drainEvents()) {
          if (e.type === 'monster_leave') leftAt = i;
          else if (e.type === 'monster_move') {
            worst = Math.max(worst, i - leftAt);
            moves++;
          }
        }
      }
      expect(moves).toBeGreaterThanOrEqual(12);
      expect(worst).toBeLessThan(3600);
    }
  }, 120_000); // 4 × 40 分（57 万 tick）。手元で 35〜47 秒とぶれ、40 秒の上限を超えることがあった（v0.44.0。調べる中身は変えていない）

  it('戦っている最中でも、居る時間が過ぎれば、技の後に立ち去る（立ち去る間は、技を出さない）', () => {
    const sim = fieldSim();
    const m = sim.monsters[0]!;
    walkTo(sim, exitOf('camp', 'a1').x, exitOf('camp', 'a1').z);
    walkTo(sim, exitOf('a1', 'a3').x, exitOf('a1', 'a3').z);
    m.aware = true;
    let left = -1, arrived = -1;
    const during: SimEvent[] = [];
    for (let i = 0; i < 60 * 60 * 4 && arrived < 0; i++) {
      // 狩人は、標的から少し離れた所に居続ける（力尽きないよう、体力は戻す）
      sim.player.hp = content.player.maxHp;
      sim.step(frame());
      for (const e of sim.drainEvents()) {
        if (e.type === 'monster_leave') left = i;
        else if (e.type === 'monster_move') arrived = i;
        else if (left >= 0 && e.type === 'action_start' && e.actor === m.id) during.push(e);
      }
    }
    expect(left).toBeGreaterThan(0);
    expect(arrived).toBeGreaterThan(left);
    expect(during).toEqual([]);
    expect(sim.monsterArea(m)!.id).toBe('a7');
    expect(m.aware).toBe(false);
  });

  it('居る間は、エリアの中をゆっくり歩いては立ち止まる（気づいていない間だけ）', () => {
    const sim = fieldSim();
    const m = sim.monsters[0]!;
    const start = { ...m.pos };
    let far = 0;
    for (let i = 0; i < 4000; i++) {
      sim.step(frame());
      far = Math.max(far, Math.hypot(m.pos.x - start.x, m.pos.z - start.z));
    }
    expect(sim.monsterArea(m)!.id).toBe('a3');
    expect(far).toBeGreaterThan(4);
    // 岩の中へは入らない
    for (const r of areaOf(field, 'a3')!.rocks) expect(Math.hypot(m.pos.x - r.x, m.pos.z - r.z)).toBeGreaterThanOrEqual(r.r + m.def.bodyRadius - 1e-6);
  });

  it('まっすぐ行くと岩に当たる時は、岩の脇へ向きを変える', () => {
    const sim = fieldSim();
    const m = sim.monsters[0]!;
    const rock = areaOf(field, 'a3')!.rocks[1]!; // (13, -6)
    m.pos = { x: rock.x - 10, y: 0, z: rock.z };
    const straight = Math.PI / 2;
    const h = headingTo(m, rock.x + 10, rock.z, sim);
    expect(Math.abs(h - straight)).toBeGreaterThan(0.2);
    // 岩が無い向きなら、まっすぐ
    expect(headingTo(m, m.pos.x - 6, m.pos.z, sim)).toBeCloseTo(-Math.PI / 2, 6);
  });

  it('別のエリアに居る相手には、気づかないし、向かっていかない。気づいていても、しばらくすると見失う', () => {
    const sim = fieldSim();
    const m = sim.monsters[0]!;
    m.aware = true;
    m.cooldown = 0;
    const evs = run(sim, field.roam.loseSightTicks + 5);
    expect(only(evs, 'action_start').filter((e) => 'actor' in e && e.actor === m.id)).toEqual([]);
    expect(only(evs, 'hazard_warn')).toEqual([]);
    expect(only(evs, 'monster_lost').length).toBe(1);
    expect(m.aware).toBe(false);
    expect(sim.monsterArea(m)!.id).toBe('a3');
  });

  it('同じエリアに入って近づくと、気づいて戦いになる', () => {
    const sim = fieldSim();
    const m = sim.monsters[0]!;
    walkTo(sim, exitOf('camp', 'a1').x, exitOf('camp', 'a1').z);
    walkTo(sim, exitOf('a1', 'a3').x, exitOf('a1', 'a3').z);
    expect(sim.areaId).toBe('a3');
    const evs: SimEvent[] = [];
    for (let i = 0; i < 1500 && !m.aware; i++) {
      const dx = m.pos.x - sim.player.pos.x, dz = m.pos.z - sim.player.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      sim.step(frame({ moveX: dx / d, moveZ: dz / d }));
      evs.push(...sim.drainEvents());
    }
    expect(only(evs, 'monster_aware').length).toBe(1);
  });
});

describe('弱ると巣で眠る', () => {
  /** 体力を割合にして、巣で眠るまで進める */
  function untilSleep(sim: Simulation, ratio = 0.2): SimEvent[] {
    const m = sim.monsters[0]!;
    m.hp = Math.round(m.def.hp * ratio);
    const out: SimEvent[] = [];
    for (let i = 0; i < 60 * 60 * 5 && !m.asleep; i++) {
      sim.step(frame());
      out.push(...sim.drainEvents());
    }
    return out;
  }

  it('体力が 25% 以下になると、巣（エリア 10）へ向かい、着いて少しすると眠る', () => {
    const sim = fieldSim();
    const m = sim.monsters[0]!;
    const evs = untilSleep(sim);
    expect(m.asleep).toBe(true);
    expect(sim.monsterArea(m)!.id).toBe('a10');
    expect(only(evs, 'monster_sleep')).toEqual([{ type: 'monster_sleep', target: m.id, areaId: 'a10' }]);
    const path = only(evs, 'monster_move').map((e) => e.areaId);
    expect(path[path.length - 1]).toBe('a10');
    // 3 → 途中のエリア → 10
    expect(path.length).toBe(2);
    expect(m.roam!.limping).toBe(true);
    // 入口ではなく、寝床（巣の中心）まで歩いてから眠る
    const c = areaOf(field, 'a10')!.center!;
    expect(Math.hypot(m.pos.x - c.x, m.pos.z - c.z)).toBeLessThanOrEqual(m.def.bodyRadius + 1.01);
  });

  it('眠っている間に体力が戻る（上限は 40%）。眠り終えると起きて、また巡る', () => {
    const sim = fieldSim();
    const m = sim.monsters[0]!;
    untilSleep(sim);
    const before = m.hp;
    const evs = run(sim, field.roam.sleepTicks + 2);
    expect(m.hp).toBeGreaterThan(before);
    expect(m.hp).toBeLessThanOrEqual(Math.round(m.def.hp * field.roam.sleepHealCap));
    expect(only(evs, 'monster_wake')).toEqual([{ type: 'monster_wake', target: m.id, byHit: false }]);
    expect(m.asleep).toBe(false);
    expect(m.roam!.limping).toBe(false);
    const later = run(sim, 60 * 60 * 4);
    expect(only(later, 'monster_move').length).toBeGreaterThanOrEqual(1);
  });

  it('眠っている所を攻撃すると、起きて気づく', () => {
    const sim = fieldSim();
    const m = sim.monsters[0]!;
    untilSleep(sim);
    sim.drainEvents();
    applyDamageToMonster(m, 0, 10, 'cut', sim);
    const evs = sim.drainEvents();
    expect(only(evs, 'monster_wake')).toEqual([{ type: 'monster_wake', target: m.id, byHit: true }]);
    expect(m.asleep).toBe(false);
    expect(m.aware).toBe(true);
    // 弱ったままなので、しばらく戦った後、また眠る
    const again = run(sim, field.roam.wakeStayTicks + 400);
    expect(only(again, 'monster_sleep').length).toBe(1);
  });

  it('v0.41.0（#19 の M05）: 巣で気づいて戦いになった時は、相手が居る間は眠らない。相手が去って見失うと、寝床へ歩いて眠る', () => {
    const sim = fieldSim();
    const m = sim.monsters[0]!;
    m.hp = Math.round(m.def.hp * 0.2);
    // 巣に着くまで進める
    for (let i = 0; i < 60 * 60 * 5 && sim.monsterArea(m)!.id !== 'a10'; i++) sim.step(frame());
    expect(sim.monsterArea(m)!.id).toBe('a10');
    // 追いついた狩人が、同じエリアの目の前に居る（技は当たらない所へ置き直し続ける）。v0.40.0 までは 1500 tick ほどで眠った
    m.aware = true;
    const evs: SimEvent[] = [];
    const away = (): void => {
      sim.player.pos = { x: m.pos.x, y: 0, z: m.pos.z - 30 > 211 ? m.pos.z - 30 : m.pos.z + 30 };
      sim.player.prevPos = { ...sim.player.pos };
      sim.areaId = 'a10';
    };
    for (let i = 0; i < 2400; i++) {
      away();
      sim.step(frame());
      evs.push(...sim.drainEvents());
    }
    expect(m.asleep).toBe(false);
    expect(only(evs, 'monster_sleep')).toEqual([]);
    // 狩人が野営地へ戻る: 見失ってから、寝床（巣の中央）まで歩いて眠る
    sim.player.pos = { ...sim.player.pos, x: 0, z: 0 };
    sim.player.prevPos = { ...sim.player.pos };
    sim.areaId = sim.field!.areas[0]!.id;
    for (let i = 0; i < 60 * 60 * 3 && !m.asleep; i++) {
      sim.step(frame());
      evs.push(...sim.drainEvents());
    }
    expect(m.asleep).toBe(true);
    expect(only(evs, 'monster_lost').length).toBeGreaterThanOrEqual(1);
    expect(only(evs, 'monster_sleep')).toHaveLength(1);
    const bed = sim.world.centerOf(sim.world.areaAt(m.pos.x, m.pos.z));
    expect(Math.hypot(bed.x - m.pos.x, bed.z - m.pos.z)).toBeLessThanOrEqual(m.def.bodyRadius + 1.01);
  });

  it('眠っている間は、技を出さないし、歩かない', () => {
    const sim = fieldSim();
    const m = sim.monsters[0]!;
    untilSleep(sim);
    const pos = { ...m.pos };
    const evs = run(sim, 600);
    expect(m.pos).toEqual(pos);
    expect(m.action).toBeNull();
    expect(only(evs, 'hazard_warn')).toEqual([]);
  });
});

describe('決定性', () => {
  it('同じ seed と同じ入力なら、フィールドでも同じ結果になる', () => {
    const play = (): string => {
      const sim = fieldSim({ seed: 777 });
      const e1 = exitOf('camp', 'a1');
      walkTo(sim, e1.x, e1.z);
      const e3 = exitOf('a1', 'a3');
      walkTo(sim, e3.x, e3.z);
      run(sim, 9000, (i) => frame({ moveX: Math.sin(i / 50), moveZ: Math.cos(i / 70) }));
      return sim.hash();
    };
    expect(play()).toBe(play());
  });

  it('seed が違えば、居る時間や歩く先が変わる', () => {
    const at = (seed: number): string => {
      const sim = fieldSim({ seed });
      run(sim, 3000);
      const m = sim.monsters[0]!;
      return `${m.pos.x.toFixed(3)},${m.pos.z.toFixed(3)},${m.roam!.ticks}`;
    };
    expect(at(1)).not.toBe(at(2));
  });
});
