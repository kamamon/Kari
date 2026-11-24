// 大型 11 種（登録簿の 02〜12。v0.17.0）: データの決まり、技が狩人へ届くこと、状態異常、横へ跳ぶ技、決定論。
import { beforeAll, describe, expect, it } from 'vitest';
import type { Content } from '../src/data/schemas';
import type { SimEvent } from '../src/game/events';
import { trackSegment } from '../src/game/tracks';
import { Simulation } from '../src/game/sim';
import { CREATURE_PLANS } from '../src/render/creaturePlans';
import { CREATURE_MOVES } from '../src/render/creatureMoves';
import { CREATURE_ART } from '../src/render/creatureArt';
import { applyStatus } from '../src/game/player';
import { baseOptions, frame, loadContent, run } from './helpers';

let content: Content;
beforeAll(async () => {
  content = await loadContent();
});

const KEYS = ['selvark', 'numeradon', 'bornakel', 'ashreia', 'lumisca', 'orglass', 'tengaro', 'verito', 'razmer', 'kirisave', 'velgait'];
const hunt = (key: string, seed = 12345): Simulation => new Simulation(content, baseOptions({ questId: `quest.${key}.r1`, seed }));

/** 標的を (0,10) に -Z 向きで置き、気付いた状態にする。only を渡すと、その技だけを選べるようにする。 */
function arena(key: string, only?: string[]): Simulation {
  const sim = hunt(key);
  const m = sim.monsters[0]!;
  m.pos = { x: 0, y: 0, z: 10 };
  m.prevPos = { ...m.pos };
  m.yaw = Math.PI;
  m.prevYaw = Math.PI;
  m.aware = true;
  m.cooldown = 0;
  if (only) for (const c of m.def.ai.choices) if (!only.some((o) => c.actionId === `monster.${key}.${o}`)) m.moveCooldowns[c.actionId] = 1e9;
  return sim;
}
/** 標的のローカル座標（左 +X、前 +Z）で狩人を置く（標的は (0,10) で -Z 向き） */
function at(sim: Simulation, lx: number, lz: number): void {
  sim.player.pos = { x: -lx, y: 0, z: 10 - lz };
  sim.player.prevPos = { ...sim.player.pos };
}
const starts = (ev: SimEvent[], actor: string): string[] => ev.flatMap((e) => (e.type === 'action_start' && e.actor === actor ? [e.actionId] : []));

describe('大型 11 種のデータ', () => {
  it('11 種とも、遊べる定義・依頼（初級）・素材 4 つ・剥ぎ取りの表・買い取り・見た目の設計図・貼る絵がそろっている', () => {
    for (const key of KEYS) {
      const id = `monster.${key}`;
      const m = content.monsters.get(id);
      expect(m, id).toBeDefined();
      const q = content.quests.get(`quest.${key}.r1`)!;
      expect(q.targetMonsterId).toBe(id);
      expect(q.rankId).toBe('rank.1');
      expect(q.requires ?? []).toEqual([]);
      const mats = [...content.materials.keys()].filter((k) => k.startsWith(`mat.${key}.`));
      expect(mats, key).toHaveLength(4);
      const loot = content.loot.get(m!.lootId!)!;
      expect(loot.carve.table.map((t) => t.itemId).sort()).toEqual([...mats].sort());
      for (const r of loot.carve.table) expect(content.materials.has(r.itemId)).toBe(true);
      for (const [partId, tab] of Object.entries(loot.breaks ?? {})) {
        expect(m!.parts.some((p) => p.id === partId && p.breakDurability !== null), `${key} ${partId}`).toBe(true);
        for (const r of tab.table) expect(mats).toContain(r.itemId);
      }
      for (const mat of mats) expect(content.shop.sell.some((s) => s.itemId === mat), mat).toBe(true);
      expect(CREATURE_PLANS[id], id).toBeDefined();
      expect(CREATURE_ART[key], key).toBeDefined();
      // 登録簿の「実装済み」
      const sp = content.bestiary.species.find((s) => s.id === id)!;
      expect(sp.state).toBe('implemented');
      // フィールド（風礫盆地）に巡り方がある
      expect(content.fields.get('field.basin')!.routes[id], id).toBeDefined();
    }
  });

  it('部位は、登録簿の部位 4 つを含み、壊せる。技は登録簿の 4 つ（左右のあるものは 2 つ）と咆哮', () => {
    for (const key of KEYS) {
      const m = content.monsters.get(`monster.${key}`)!;
      const sp = content.bestiary.species.find((s) => s.id === m.id)!;
      const names = m.parts.map((p) => p.name);
      for (const n of sp.parts) expect(names, `${key} ${n}`).toContain(n);
      expect(m.parts.filter((p) => p.breakDurability !== null).length, key).toBeGreaterThanOrEqual(4);
      const acts = [...content.actions.keys()].filter((a) => a.startsWith(`${m.id}.`));
      expect(acts).toContain(`${m.id}.roar`);
      expect(acts.length, key).toBeGreaterThanOrEqual(5);
      expect(m.discover!.actionId).toBe(`${m.id}.roar`);
    }
  });

  it('どの技にも見た目の動き（設計図の moves と、動きの型）がある', () => {
    for (const key of KEYS) {
      const plan = CREATURE_PLANS[`monster.${key}`]!;
      for (const a of content.actions.values()) {
        if (!a.actionId.startsWith(`monster.${key}.`)) continue;
        const mv = plan.moves[a.clip];
        expect(mv, a.clip).toBeDefined();
        expect(CREATURE_MOVES[mv!.kind], `${a.clip} → ${mv!.kind}`).toBeDefined();
      }
    }
  });

  it('攻撃の判定は、地面から 1.6m より低い所を通り、体から 10m 以内（狩人へ届く・遠すぎない）', () => {
    for (const key of KEYS) {
      for (const a of content.actions.values()) {
        if (!a.actionId.startsWith(`monster.${key}.`)) continue;
        for (const h of a.hitWindows) {
          const tr = content.tracks.get(h.shapeTrack)!;
          let low = Infinity, far = 0;
          for (let t = h.from; t < h.to; t++) {
            const s = trackSegment(tr, t);
            low = Math.min(low, s.a.y - tr.radius, s.b.y - tr.radius);
            far = Math.max(far, Math.hypot(s.a.x, s.a.z), Math.hypot(s.b.x, s.b.z));
          }
          expect(low, `${a.actionId} ${h.id}`).toBeLessThan(1.6);
          expect(far, `${a.actionId} ${h.id}`).toBeLessThan(10);
        }
      }
    }
  });
});

describe('大型 11 種の戦い', () => {
  it('狩人が前・横・後ろに居ると、どの種も 30 秒の間に技を出し、狩人に当てる（受ける側は動かない）', () => {
    for (const key of KEYS) {
      let hits = 0;
      const used = new Set<string>();
      for (const [lx, lz] of [[0, 3.5], [3, 0.5], [-3, 0.5], [0, -3.5], [0, 9]] as const) {
        const sim = arena(key);
        at(sim, lx, lz);
        const ev = run(sim, 1800, () => frame());
        for (const id of starts(ev, sim.monsters[0]!.id)) used.add(id);
        hits += ev.filter((e) => e.type === 'player_hurt').length;
      }
      expect(hits, key).toBeGreaterThan(0);
      expect(used.size, `${key}: ${[...used].join(', ')}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('正面の、近寄るのをやめる距離より近い所に、選べる技の無い隙間が無い（立ち止まったまま動かなくならない）', () => {
    for (const key of KEYS) {
      const m = content.monsters.get(`monster.${key}`)!;
      // 体の当たりの円より外（狩人が立てる所）から、近寄るのをやめる距離まで
      const front = Math.max(...(m.collision ?? [{ z: 0, r: m.bodyRadius }]).map((c) => c.z + c.r)) + content.player.radius;
      for (let d = Math.min(front, m.approach!.stopDist); d <= m.approach!.stopDist; d += 0.25) {
        const ok = m.ai.choices.some((c) => d >= c.minDist && d <= c.maxDist && (c.minAngleDeg ?? 0) <= 0);
        expect(ok, `${key}: 正面 ${d.toFixed(2)}m`).toBe(true);
      }
    }
  });

  it('同じ種と同じ入力なら、同じ結果になる（決定論）', () => {
    for (const key of ['selvark', 'tengaro', 'kirisave']) {
      const a = arena(key), b = arena(key);
      at(a, 2, 4);
      at(b, 2, 4);
      run(a, 900);
      run(b, 900);
      expect(a.hash()).toBe(b.hash());
    }
  });

  it('横跳び蹴り（セルヴァルク）は、体の向きを変えずに、狩人の居る横へ跳ぶ', () => {
    const sim = arena('selvark', ['hop_kick_l']);
    at(sim, 3, 0.8);
    const ev = run(sim, 120);
    expect(starts(ev, sim.monsters[0]!.id)[0]).toBe('monster.selvark.hop_kick_l');
    const m = sim.monsters[0]!;
    // 標的は -Z 向き。左（+X ローカル）はワールドの -X
    expect(m.pos.x).toBeLessThan(-2.2);
    expect(Math.abs(m.pos.z - 10)).toBeLessThan(0.6);
  });

  it('転がる（テンガロ）は、斜め前へ 11m 進む', () => {
    const sim = arena('tengaro', ['roll_l']);
    at(sim, 2, 12);
    run(sim, 200);
    const m = sim.monsters[0]!;
    expect(Math.hypot(m.pos.x, m.pos.z - 10)).toBeGreaterThan(9);
  });
});

describe('状態異常（狩人）', () => {
  const firstStatus = (ev: SimEvent[]): string | undefined => ev.flatMap((e) => (e.type === 'status' && e.on ? [e.kind] : []))[0];

  it('灰幕（アシュレイア）を防御せずに浴びると眠り、攻撃されると起きる', () => {
    const sim = arena('ashreia', ['ash_curtain']);
    at(sim, 0, 4);
    const ev = run(sim, 200);
    expect(firstStatus(ev)).toBe('sleep');
    const p = sim.player;
    expect(p.mode === 'hurt' && p.hurt?.kind).toBe('sleep');
    expect(p.pos.y).toBeGreaterThanOrEqual(0);
    // 眠っている間に攻撃を受けると、起きて怯む
    const before = p.hp;
    sim.monsters[0]!.moveCooldowns = {};
    const ev2 = run(sim, 600);
    expect(ev2.some((e) => e.type === 'status' && e.kind === 'sleep' && !e.on)).toBe(true);
    expect(p.hp).toBeLessThanOrEqual(before);
  });

  it('音圧（ボルナケル）で気絶がたまる。2 回で気絶する（1 回では、まだ）', () => {
    const sim = arena('bornakel', ['sound_blast']);
    at(sim, 0, 5);
    const ev = run(sim, 160);
    expect(ev.some((e) => e.type === 'player_hurt')).toBe(true);
    expect(sim.player.ailment.build.stun).toBeGreaterThan(40);
    expect(firstStatus(ev)).toBeUndefined();
  });

  it('毒の滴（ヴェリト）は狩人の足元へ落ち、毒をためる', () => {
    const sim = arena('verito', ['drip']);
    at(sim, 0, 3);
    const ev = run(sim, 200);
    expect(ev.some((e) => e.type === 'hazard_warn')).toBe(true);
    expect(sim.player.ailment.build.poison > 0 || sim.player.ailment.poisonTicks > 0).toBe(true);
  });

  it('毒: 体力が少しずつ減り、1 より下がらない。時間で消える', () => {
    const sim = arena('verito');
    sim.monsters[0]!.aiEnabled = false;
    const p = sim.player;
    at(sim, 0, 25);
    p.hp = 12;
    applyStatus(p, { kind: 'poison', power: 100 }, sim);
    expect(p.ailment.poisonTicks).toBeGreaterThan(0);
    const ev = run(sim, 1000);
    expect(p.hp).toBe(1);
    expect(p.ailment.poisonTicks).toBe(0);
    expect(ev.some((e) => e.type === 'status' && e.kind === 'poison' && !e.on)).toBe(true);
  });

  it('麻痺: その間は動けず、時間で解ける。ためた値は、時間で減る', () => {
    const sim = arena('tengaro');
    sim.monsters[0]!.aiEnabled = false;
    const p = sim.player;
    at(sim, 0, 25);
    applyStatus(p, { kind: 'para', power: 40 }, sim);
    expect(p.ailment.build.para).toBe(40);
    run(sim, 300);
    expect(p.ailment.build.para).toBeLessThan(25);
    applyStatus(p, { kind: 'para', power: 100 }, sim);
    expect(p.mode === 'hurt' && p.hurt?.kind).toBe('para');
    const x0 = p.pos.x;
    run(sim, 60, () => frame({ moveX: 1 }));
    expect(p.pos.x).toBe(x0);
    run(sim, 200);
    expect(p.mode).toBe('free');
  });
});
