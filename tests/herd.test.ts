// 幼体の群れ（登録簿の 14〜21。v0.18.0、docs/spec.md の 23 章）: データの決まり、群れの依頼、群れの動き（食む・気づく・逃げる・反撃・
// 知らせ・休む・移り住む・親との関わり）、剥ぎ取り、決定論（群れが居ても、大型の動きは変わらない）。
import { beforeAll, describe, expect, it } from 'vitest';
import type { Content } from '../src/data/schemas';
import { assembleContent } from '../src/data/validators';
import type { SimEvent } from '../src/game/events';
import { herdHurt, isCalm, type HerdMood } from '../src/game/herd';
import { applyDamageToMonster, type MonsterState } from '../src/game/monster';
import { Simulation } from '../src/game/sim';
import { newRun } from '../src/game/action';
import { trackSegment } from '../src/game/tracks';
import { CREATURE_ART } from '../src/render/creatureArt';
import { CREATURE_PLANS } from '../src/render/creaturePlans';
import { Btn, baseOptions, frame, loadContent, press, run } from './helpers';
import { readFile } from 'node:fs/promises';

let content: Content;
beforeAll(async () => {
  content = await loadContent();
});

const KEYS = ['kordopil', 'palseit', 'numaporon', 'chilumicana', 'kohalgis', 'mitogaron', 'yurtepica', 'hinasalv'];
const PARENT: Record<string, string> = { kordopil: 'galdros', palseit: 'selvark', numaporon: 'numeradon', chilumicana: 'lumisca', kohalgis: 'orglass', mitogaron: 'tengaro', yurtepica: 'verito', hinasalv: 'kirisave' };
/** 群れの依頼（1 つの狩場）。標的の群れは、依頼の位置 (4, 15) のまわり */
const pack = (key: string, seed = 12345): Simulation => new Simulation(content, baseOptions({ questId: `quest.${key}.pack1`, seed }));
const packField = (key: string, seed = 12345): Simulation => new Simulation(content, baseOptions({ questId: `quest.${key}.pack1`, seed, field: true }));
const members = (sim: Simulation, g = 0): MonsterState[] => sim.herds[g]!.members;
const moods = (ms: MonsterState[]): HerdMood[] => ms.map((m) => m.herd!.mood);
const center = (ms: MonsterState[]): { x: number; z: number } => ({ x: ms.reduce((a, m) => a + m.pos.x, 0) / ms.length, z: ms.reduce((a, m) => a + m.pos.z, 0) / ms.length });
const dist = (a: { x: number; z: number }, b: { x: number; z: number }): number => Math.hypot(a.x - b.x, a.z - b.z);
const place = (sim: Simulation, x: number, z: number, yaw = 0): void => {
  sim.player.pos = { x, y: 0, z };
  sim.player.prevPos = { ...sim.player.pos };
  sim.player.yaw = yaw;
};
/** 群れの真ん中から、向き (ux, uz) へ d m の所に狩人を置く */
const placeFrom = (sim: Simulation, d: number, ux = 0, uz = -1): void => {
  const c = center(members(sim));
  place(sim, c.x + ux * d, c.z + uz * d);
};
const kill = (sim: Simulation, m: MonsterState): void => applyDamageToMonster(m, m.def.parts.findIndex((p) => p.id === 'body'), m.hp, 'blunt', sim);
type Ev<T extends SimEvent['type']> = Extract<SimEvent, { type: T }>;
const only = <T extends SimEvent['type']>(evs: SimEvent[], type: T): Ev<T>[] => evs.filter((e): e is Ev<T> => e.type === type);

describe('幼体 8 種のデータ', () => {
  it('8 種とも、遊べる定義（群れ・親・捕獲なし）・群れの依頼・素材・剥ぎ取り 1 回・買い取り・見た目の設計図がそろっている', () => {
    for (const key of KEYS) {
      const id = `monster.${key}`;
      const m = content.monsters.get(id)!;
      expect(m, id).toBeDefined();
      const sp = content.bestiary.species.find((s) => s.id === id)!;
      expect(sp.state).toBe('implemented');
      expect(m.parentId).toBe(sp.baseId);
      expect(m.parentId).toBe(`monster.${PARENT[key]}`);
      expect(m.herd!.size).toEqual(sp.pack);
      expect(m.captureAllowed).toBe(false);
      expect(m.discover).toBeNull();
      // 素材は登録簿の名前
      const mats = [...content.materials.keys()].filter((k) => k.startsWith(`mat.${key}.`));
      expect(mats.map((k) => content.materials.get(k)!.name).sort()).toEqual([...sp.materials].sort());
      const loot = content.loot.get(m.lootId!)!;
      expect(loot.carve.count).toBe(1);
      expect(loot.carve.table.map((t) => t.itemId).sort()).toEqual(mats.sort());
      for (const mat of mats) expect(content.shop.sell.some((s) => s.itemId === mat), mat).toBe(true);
      // 部位は、登録簿の部位 2 つを含む
      for (const n of sp.parts) expect(m.parts.map((p) => p.name), `${key} ${n}`).toContain(n);
      // 依頼: 討伐だけ、初級、最初から受けられる。頭数は群れの少ない方以下
      const q = content.quests.get(`quest.${key}.pack1`)!;
      expect([q.kind, q.rankId, q.requires ?? [], q.targetMonsterId]).toEqual(['slay', 'rank.1', [], id]);
      expect(q.targets).toEqual([{ monsterId: id, count: q.targets![0]!.count }]);
      expect(q.targets![0]!.count).toBeLessThanOrEqual(m.herd!.size[0]);
      // 見た目: 親の絵を、淡くして貼る
      const plan = CREATURE_PLANS[id]!;
      expect(plan, id).toBeDefined();
      expect(plan.key).toBe(PARENT[key]);
      expect(CREATURE_ART[plan.key]).toBeDefined();
      expect(plan.look!.pale).toBeGreaterThan(0);
      for (const a of content.actions.values()) {
        if (!a.actionId.startsWith(`${id}.`)) continue;
        expect(plan.moves[a.clip]!.def.K.length, a.clip).toBeGreaterThan(0);
      }
    }
  });

  it('大きさは、登録簿の全長の約 0.68 倍で、親より小さい。技は登録簿の 3 つと、幼体に固有の技（合わせて 6〜8。v0.21.0）', () => {
    for (const key of KEYS) {
      const id = `monster.${key}`;
      const sp = content.bestiary.species.find((s) => s.id === id)!;
      const plan = CREATURE_PLANS[id]!;
      const xs = plan.spine.map((p) => p[0]);
      const len = (Math.max(...xs) - Math.min(...xs)) * plan.scale;
      expect(len, key).toBeCloseTo(sp.size * 0.68, 1);
      const m = content.monsters.get(id)!;
      const parent = content.monsters.get(m.parentId!)!;
      expect(m.hp).toBeLessThan(parent.hp / 4);
      expect(m.bodyRadius).toBeLessThan(parent.bodyRadius);
      const acts = [...content.actions.keys()].filter((a) => a.startsWith(`${id}.`));
      expect(acts.length, key).toBeGreaterThanOrEqual(6);
      expect(acts.length, key).toBeLessThanOrEqual(8);
      expect(m.ai.choices.length).toBe(acts.length);
    }
  });

  it('攻撃の判定は、地面から 1.2m より低い所を通り、体から 4m 以内。逃げる速さは、狩人の走る速さより遅い', () => {
    for (const key of KEYS) {
      const m = content.monsters.get(`monster.${key}`)!;
      expect(m.moveSpeed! * m.herd!.fleeSpeedScale, key).toBeLessThan(content.player.sprintSpeed);
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
          expect(low, `${a.actionId} ${h.id}`).toBeLessThan(1.2);
          expect(far, `${a.actionId} ${h.id}`).toBeLessThan(4);
        }
      }
    }
  });

  it('風礫盆地には、幼体 8 種の住みかがある。いつも居るのは、コルドピルとパルセイト（盆地の種）', () => {
    const f = content.fields.get('field.basin')!;
    for (const key of KEYS) expect(f.herds!.some((h) => h.monsterId === `monster.${key}`), key).toBe(true);
    expect([...new Set(f.herds!.filter((h) => h.native).map((h) => h.monsterId))].sort()).toEqual(['monster.kordopil', 'monster.palseit']);
    for (const h of f.herds!) expect(h.areas.every((a) => f.areas.find((x) => x.id === a)!.kind !== 'camp')).toBe(true);
  });

  it('群れの依頼の決まりに合わないデータは、読み込みで止まる（標的が群れで暮らさない・捕獲あり・頭数 0）', async () => {
    const bad = async (edit: (quests: Record<string, unknown>[]) => void): Promise<string> => {
      const get = async (p: string): Promise<unknown> => {
        const v = JSON.parse(await readFile(new URL(`../public/data/${p}`, import.meta.url), 'utf8')) as Record<string, unknown>;
        if (p === 'quests_herds.json') edit(v.quests as Record<string, unknown>[]);
        return v;
      };
      try {
        await assembleContent(get);
        return '';
      } catch (e) {
        return String(e);
      }
    };
    expect(await bad((qs) => (qs[0]!.targets = [{ monsterId: 'monster.galdros', count: 1 }]))).toContain('群れで暮らさない');
    expect(await bad((qs) => (qs[0]!.kind = 'hunt'))).toContain('討伐だけ');
    expect(await bad((qs) => ((qs[0]!.targets as { count: number }[])[0]!.count = 0))).toContain('頭数');
  });
});

describe('幼体の技（v0.21.0）', () => {
  /** 群れの依頼（狩場なし）で、最初の 1 頭だけを (0,10) に -Z 向きで置き、ほかは遠くへ */
  function lone(key: string): { sim: Simulation; m: MonsterState } {
    const sim = new Simulation(content, baseOptions({ questId: `quest.${key}.pack1` }));
    const [m, ...rest] = sim.monsters;
    for (const o of rest) {
      o.pos = { x: 200, y: 0, z: 200 };
      o.prevPos = { ...o.pos };
      o.aiEnabled = false;
    }
    m!.pos = { x: 0, y: 0, z: 10 };
    m!.prevPos = { ...m!.pos };
    m!.yaw = Math.PI;
    m!.prevYaw = Math.PI;
    m!.aware = true;
    m!.aiEnabled = false;
    return { sim, m: m! };
  }

  it('攻撃の判定はどれも、その判定が通る所に立つ狩人へ当たる', () => {
    const miss: string[] = [];
    let n = 0;
    for (const key of KEYS) {
      for (const def of content.actions.values()) {
        if (!def.actionId.startsWith(`monster.${key}.`)) continue;
        for (const hw of def.hitWindows) {
          const dry = lone(key);
          dry.sim.player.pos = { x: 0, y: 0, z: 50 };
          dry.sim.player.prevPos = { ...dry.sim.player.pos };
          dry.m.action = newRun(def, 9001, dry.m.yaw);
          const tr = content.tracks.get(hw.shapeTrack)!;
          const tm = (hw.from + hw.to) / 2;
          let target: { x: number; z: number } | null = null;
          let bestT = Infinity;
          for (let t = 0; t < hw.to; t++) {
            dry.sim.step(frame());
            if (t < hw.from) continue;
            const sg = trackSegment(tr, t);
            let best = -1;
            let cand: { x: number; z: number } | null = null;
            for (let k = 0; k <= 10; k++) {
              const lx = sg.a.x + ((sg.b.x - sg.a.x) * k) / 10, ly = sg.a.y + ((sg.b.y - sg.a.y) * k) / 10, lz = sg.a.z + ((sg.b.z - sg.a.z) * k) / 10;
              if (ly - tr.radius > 1.2) continue;
              const d = Math.hypot(lx, lz);
              if (d > best) {
                best = d;
                const c = Math.cos(dry.m.yaw), sn = Math.sin(dry.m.yaw);
                cand = { x: dry.m.pos.x + lx * c + lz * sn, z: dry.m.pos.z - lx * sn + lz * c };
              }
            }
            if (cand && Math.abs(t - tm) < Math.abs(bestT - tm)) {
              bestT = t;
              target = cand;
            }
          }
          n++;
          if (!target) {
            miss.push(`${def.actionId}#${hw.id}（届く所が無い）`);
            continue;
          }
          const { sim, m } = lone(key);
          sim.player.pos = { x: target.x, y: 0, z: target.z };
          sim.player.prevPos = { ...sim.player.pos };
          m.action = newRun({ ...def, hitWindows: [hw] }, 9002, m.yaw);
          let ok = false;
          for (let t = 0; t <= hw.to + 1 && !ok; t++) {
            sim.step(frame());
            ok = sim.drainEvents().some((e) => e.type === 'player_hurt') && t >= hw.from;
          }
          if (!ok) miss.push(`${def.actionId}#${hw.id}`);
        }
      }
    }
    expect(n).toBeGreaterThan(40);
    expect(miss, miss.join(', ')).toEqual([]);
  });
});

describe('群れの依頼', () => {
  it('標的の群れが、登録簿の頭数（依頼の頭数より少なくない）で出る。1 体の標的（main）は無い', () => {
    for (const key of KEYS) {
      const sim = pack(key);
      const q = content.quests.get(`quest.${key}.pack1`)!;
      const H = content.monsters.get(`monster.${key}`)!.herd!;
      expect(sim.pack).toBe(true);
      expect(sim.main).toBeNull();
      expect(sim.herds).toHaveLength(1);
      const n = members(sim).length;
      expect(n).toBeGreaterThanOrEqual(Math.max(q.targets![0]!.count, H.size[0]));
      expect(n).toBeLessThanOrEqual(H.size[1]);
      expect(sim.monsters[0]!.def.id).toBe(`monster.${key}`);
      // 群れは、互いの間を空けて立つ（重ならない）
      for (const a of members(sim)) for (const b of members(sim)) if (a !== b) expect(dist(a.pos, b.pos)).toBeGreaterThan(a.def.bodyRadius + b.def.bodyRadius - 1e-6);
    }
  });

  it('頭数を討伐すると達成。倒した幼体は 1 回ずつ剥ぎ取れて、素材が出る。報酬は依頼の報酬を足して確定', () => {
    const sim = pack('kordopil');
    const ms = members(sim);
    for (let i = 0; i < 2; i++) kill(sim, ms[i]!);
    run(sim, 2);
    expect(sim.hunt!.phase).toBe('active');
    // 狩りの途中でも、倒した幼体は剥ぎ取れる（納刀している時だけ）
    expect(sim.hunt!.carves[`body:${ms[0]!.id}`]).toBe(1);
    place(sim, ms[0]!.pos.x, ms[0]!.pos.z - ms[0]!.def.bodyRadius - 0.6);
    sim.player.drawn = true;
    expect(sim.carveTarget()).toBeNull();
    sim.player.drawn = false;
    expect(sim.carveTarget()).toBe(`body:${ms[0]!.id}`);
    run(sim, 200, (i) => (i === 0 ? press(Btn.Main) : frame()));
    expect(sim.hunt!.carves[`body:${ms[0]!.id}`]).toBe(0);
    expect(sim.hunt!.loot).toHaveLength(1);
    expect(sim.hunt!.loot[0]!.source).toBe('carve:monster.kordopil');
    expect(sim.hunt!.loot[0]!.itemId.startsWith('mat.kordopil.')).toBe(true);
    kill(sim, ms[2]!);
    const ev = run(sim, 2);
    expect(only(ev, 'hunt_end')).toEqual([{ type: 'hunt_end', phase: 'success', reason: 'slay' }]);
    expect(sim.slain('monster.kordopil')).toBe(3);
    // 残りの剥ぎ取り（標的のぶん）が 2 回
    expect(sim.carvesLeft()).toBe(2);
    run(sim, 1800 + 10, (i) => (i === 1 ? press(Btn.Retire) : frame()));
    expect(sim.hunt!.closed).toBe(true);
    const rw = sim.hunt!.rewards!;
    expect(rw.money).toBe(content.quests.get('quest.kordopil.pack1')!.rewards!.money);
    expect(rw.items.reduce((a, s) => a + s.count, 0)).toBe(2);
  });

  it('2 種の群れの依頼は、種ごとの頭数がそろうまで達成にならない', () => {
    const sim = new Simulation(content, baseOptions({ questId: 'quest.basin_young.r1', seed: 7 }));
    expect(sim.herds.map((g) => g.monsterId)).toEqual(['monster.kordopil', 'monster.palseit']);
    for (const m of members(sim, 0)) kill(sim, m);
    run(sim, 2);
    expect(sim.hunt!.phase).toBe('active');
    for (const m of members(sim, 1).slice(0, 3)) kill(sim, m);
    run(sim, 2);
    expect(sim.hunt!.phase).toBe('success');
  });

  it('罠は幼体では作動せず、鎮静玉は幼体に当たらない', () => {
    const sim = pack('numaporon');
    const m = members(sim)[0]!;
    sim.traps.push({ id: 99, x: m.pos.x, z: m.pos.z, radius: 1.5, holdTicks: 300, arm: 0, life: 600, state: 'armed', target: null });
    const ev = run(sim, 5);
    expect(only(ev, 'trap_trigger')).toEqual([]);
    place(sim, m.pos.x, m.pos.z - 3, 0);
    const tranq = content.items.get('item.calm_orb')!;
    expect(sim.applyItem(tranq)).toBe(true);
    expect(members(sim).every((x) => x.tranq === 0)).toBe(true);
  });
});

describe('群れの動き', () => {
  it('狩人が遠ければ、群れは静かに草を食み、群れの居場所の近くに留まる（1 分）', () => {
    const sim = pack('kordopil');
    place(sim, -30, -25);
    const ms = members(sim);
    const c0 = center(ms);
    let moved = 0;
    const start = ms.map((m) => ({ ...m.pos }));
    run(sim, 3600);
    for (const m of ms) {
      expect(isCalm(m.herd!.mood), m.herd!.mood).toBe(true);
      moved = Math.max(moved, dist(m.pos, start[ms.indexOf(m)]!));
    }
    // 少しは動く（食べる所を変える）が、群れから大きく離れない
    expect(moved).toBeGreaterThan(0.3);
    expect(dist(center(ms), c0)).toBeLessThan(16);
    for (const m of ms) expect(dist(m.pos, center(ms))).toBeLessThan(m.herd!.group.def.spacing * 4 + 2);
  });

  it('近づくと、気づいて顔を上げ、さらに近づくと逃げる。知らせで、仲間も遅れて逃げる', () => {
    for (const key of KEYS) {
      const sim = pack(key);
      const H = content.monsters.get(`monster.${key}`)!.herd!;
      // 気づく距離の少し内
      placeFrom(sim, H.alertRange - 1.5);
      let ev = run(sim, 40);
      expect(only(ev, 'herd_alarm').length, key).toBeGreaterThanOrEqual(1);
      expect(moods(members(sim)).some((x) => x === 'alert'), `${key} ${moods(members(sim))}`).toBe(true);
      expect(moods(members(sim)).some((x) => x === 'flee')).toBe(false);
      // 逃げ出す距離の内へ
      placeFrom(sim, H.fleeRange - 2);
      const before = members(sim).map((m) => dist(m.pos, sim.player.pos));
      ev = run(sim, 90);
      expect(only(ev, 'herd_alarm').some((e) => e.flee), key).toBe(true);
      const fled = members(sim).filter((m) => m.herd!.mood === 'flee');
      expect(fled.length, `${key} ${moods(members(sim))}`).toBe(members(sim).length);
      // 狩人から離れている
      const after = members(sim).map((m) => dist(m.pos, sim.player.pos));
      expect(after.reduce((a, b) => a + b, 0), key).toBeGreaterThan(before.reduce((a, b) => a + b, 0) + members(sim).length * 2);
    }
  });

  it('逃げ切ると、止まって様子を見て、やがて静まり、逃げた先を新しい居場所にする（もとの場所へは戻らない）', () => {
    const sim = pack('palseit');
    const H = content.monsters.get('monster.palseit')!.herd!;
    const c0 = center(members(sim));
    placeFrom(sim, H.fleeRange - 2);
    run(sim, 120);
    // 狩人は離れる（遠くへ置く）
    place(sim, -36, -26);
    run(sim, 60 * 25);
    for (const m of members(sim)) expect(isCalm(m.herd!.mood), m.herd!.mood).toBe(true);
    const g = sim.herds[0]!;
    expect(dist(g.anchor, c0)).toBeGreaterThan(4);
    expect(dist(g.anchor, center(members(sim)))).toBeLessThan(H.spacing * 3);
  });

  it('走り続けると、息が上がって止まる（その間は逃げない）', () => {
    const sim = pack('numaporon');
    const H = content.monsters.get('monster.numaporon')!.herd!;
    const m = members(sim)[0]!;
    // 狩人が後ろから追い続ける
    let tired = false;
    for (let i = 0; i < H.fleeTicks + 120 && !tired; i++) {
      const dx = m.pos.x - sim.player.pos.x, dz = m.pos.z - sim.player.pos.z;
      const d = Math.hypot(dx, dz);
      place(sim, m.pos.x - (dx / d) * 5, m.pos.z - (dz / d) * 5);
      sim.step(frame());
      sim.drainEvents();
      if (m.herd!.tired > 0) tired = true;
    }
    expect(tired).toBe(true);
    expect(m.herd!.mood).toBe('alert');
  });

  it('攻撃されると、向き直って反撃するか、逃げる。反撃の間は技を出し、狩人に当たる', () => {
    let fights = 0, flees = 0, hits = 0;
    for (let seed = 1; seed <= 24; seed++) {
      const sim = pack('kordopil', seed);
      const m = members(sim)[0]!;
      place(sim, m.pos.x, m.pos.z - 2.2);
      applyDamageToMonster(m, m.def.parts.findIndex((p) => p.id === 'body'), 20, 'blunt', sim);
      // 攻撃した時の反応（シミュレーションの外から当てたので、ここで群れへ知らせる）
      herdHurt(m, sim);
      if (m.herd!.mood === 'fight') fights++;
      else if (m.herd!.mood === 'flee') flees++;
      const ev = run(sim, 600);
      hits += only(ev, 'player_hurt').length;
    }
    expect(fights).toBeGreaterThan(2);
    expect(flees).toBeGreaterThan(fights);
    expect(hits).toBeGreaterThan(0);
  });

  it('追い詰めると（壁際で逃げられない）、向き直って反撃する', () => {
    const sim = pack('yurtepica');
    const m = members(sim)[0]!;
    // ほかの仲間は遠くへ
    for (const o of members(sim).slice(1)) {
      o.pos = { x: -30, y: 0, z: 20 };
      o.prevPos = { ...o.pos };
    }
    const b = sim.world.areaAt(0, 0).bounds;
    // 角へ追い込む: 幼体を角に、狩人をその前に
    m.pos = { x: b.maxX - 1, y: 0, z: b.maxZ - 1 };
    m.prevPos = { ...m.pos };
    let fought = false;
    for (let i = 0; i < 600 && !fought; i++) {
      place(sim, m.pos.x - 2.5, m.pos.z - 2.5);
      sim.step(frame());
      sim.drainEvents();
      if (m.herd!.mood === 'fight') fought = true;
    }
    expect(fought).toBe(true);
  });

  it('群れで休む時は伏せて、気づく距離が短くなる', () => {
    const sim = pack('kohalgis');
    const g = sim.herds[0]!;
    place(sim, -36, -26);
    g.restIn = 1;
    run(sim, 30);
    expect(moods(g.members).every((x) => x === 'rest'), moods(g.members).join()).toBe(true);
    // いちばん近い 1 頭から、気づく距離の 0.6 倍より外なら、休んだまま
    const c = center(g.members);
    const spread = Math.max(...g.members.map((m) => dist(m.pos, c)));
    placeFrom(sim, g.def.alertRange * 0.6 + spread + 1);
    run(sim, 30);
    expect(moods(g.members).every((x) => x === 'rest'), moods(g.members).join()).toBe(true);
    placeFrom(sim, g.def.alertRange * 0.6 - 2);
    run(sim, 60);
    expect(moods(g.members).some((x) => x === 'alert' || x === 'flee')).toBe(true);
  });

  it('同じ seed と同じ入力なら、群れの動きも同じ（状態の指紋が一致する）', () => {
    const a = pack('chilumicana', 99), b = pack('chilumicana', 99);
    const input = (i: number) => frame({ moveX: Math.sin(i / 50), moveZ: Math.cos(i / 70) });
    for (let i = 0; i < 1200; i++) {
      a.step(input(i));
      b.step(input(i));
    }
    expect(a.hash()).toBe(b.hash());
  });
});

describe('フィールドの群れ', () => {
  const Q = 'quest.basin.003';
  it('大型の依頼でも、盆地の群れ（コルドピルとパルセイト）が住みかに居る。ほかの種の群れは居ない', () => {
    const sim = new Simulation(content, baseOptions({ questId: Q, field: true }));
    expect(sim.main).toBe(sim.monsters[0]);
    expect(sim.monsters[0]!.def.id).toBe('monster.galdros');
    expect([...new Set(sim.herds.map((g) => g.monsterId))].sort()).toEqual(['monster.kordopil', 'monster.palseit']);
    for (const g of sim.herds) {
      expect(sim.herdArea(g)!.id).toBe(g.areas[0]);
      // コルドピルの親はガルドロス
      expect(g.parent?.def.id ?? null).toBe(g.monsterId === 'monster.kordopil' ? 'monster.galdros' : null);
    }
  });

  it('親が標的の依頼では、その幼体の群れも居る（本来の狩場が無い種）。幼体の群れの依頼では、標的の群れが住みかに居る', () => {
    const sim = new Simulation(content, baseOptions({ questId: 'quest.numeradon.r1', field: true }));
    expect(sim.herds.some((g) => g.monsterId === 'monster.numaporon')).toBe(true);
    const ps = packField('hinasalv');
    const g = ps.herds.find((x) => x.monsterId === 'monster.hinasalv')!;
    expect(ps.herdArea(g)!.id).toBe('a6');
    expect(g.members.length).toBeGreaterThanOrEqual(2);
  });

  it('群れが居ても、大型の動きは変わらない（群れの乱数は別。幼体は大型を押さない）', async () => {
    const plain = await loadContent();
    (plain.fields.get('field.basin') as { herds?: unknown }).herds = undefined;
    const a = new Simulation(content, baseOptions({ questId: Q, field: true, seed: 5 }));
    const b = new Simulation(plain, baseOptions({ questId: Q, field: true, seed: 5 }));
    expect(a.herds.length).toBeGreaterThan(0);
    expect(b.herds.length).toBe(0);
    for (let i = 0; i < 60 * 60 * 6; i++) {
      a.step(frame());
      b.step(frame());
    }
    const ma = a.monsters[0]!, mb = b.monsters[0]!;
    expect([ma.pos.x, ma.pos.z, ma.roam!.areaId, a.rng.state]).toEqual([mb.pos.x, mb.pos.z, mb.roam!.areaId, b.rng.state]);
  });

  it('時々、群れごと住みかの別のエリアへ移る（出口を歩いて通る）', () => {
    const sim = new Simulation(content, baseOptions({ questId: Q, field: true }));
    const g = sim.herds.find((x) => x.areas[0] === 'a1')!;
    g.travelIn = 1;
    const ev = run(sim, 60 * 150);
    const mv = only(ev, 'herd_move').filter((e) => e.herdId === g.id);
    // 1 から 2 へは、3 を通る（直接つながる出口が無い）
    expect(mv).toEqual([{ type: 'herd_move', herdId: g.id, from: 'a1', to: 'a3' }, { type: 'herd_move', herdId: g.id, from: 'a3', to: 'a2' }]);
    expect(sim.herdArea(g)!.id).toBe('a2');
    for (const m of g.members) expect(sim.monsterArea(m)!.id).toBe('a2');
  });

  it('幼体が攻撃されると、同じエリアに居る親が気づく。親が戦っている間、幼体は岩陰へ寄る', () => {
    const sim = new Simulation(content, baseOptions({ questId: Q, field: true }));
    const parent = sim.monsters[0]!;
    const g = sim.herds.find((x) => x.monsterId === 'monster.kordopil' && x.parent === parent)!;
    // 親を、群れと同じエリアへ連れて行く
    const c = center(g.members);
    parent.pos = { x: c.x + 14, y: 0, z: c.z };
    parent.prevPos = { ...parent.pos };
    parent.roam!.areaId = sim.monsterArea(g.members[0]!)!.id;
    expect(parent.aware).toBe(false);
    const kid = g.members[0]!;
    applyDamageToMonster(kid, kid.def.parts.findIndex((p) => p.id === 'body'), 5, 'blunt', sim);
    herdHurt(kid, sim);
    expect(parent.aware).toBe(true);
    // 狩人は、同じエリアの離れた所に（幼体が狩人から逃げないように。エリアは自然な形なので、いちばん遠い道しるべ）
    const here = sim.monsterArea(kid)!;
    const far = here.nav!.reduce((a, p) => (Math.hypot(p[0] - c.x, p[1] - c.z) > Math.hypot(a[0] - c.x, a[1] - c.z) ? p : a));
    expect(Math.hypot(far[0] - c.x, far[1] - c.z)).toBeGreaterThan(25);
    place(sim, far[0], far[1], 0);
    sim.areaId = here.id;
    run(sim, 60 * 12);
    const hiding = g.members.filter((m) => !m.dead && m.herd!.mood === 'hide');
    expect(hiding.length, moods(g.members).join()).toBeGreaterThan(0);
  });
});
