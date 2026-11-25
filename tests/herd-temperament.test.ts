// 個体差が実際の行動へ表れることと、反撃が無制限な追跡・同時攻撃にならないことを確認する。
import { beforeAll, describe, expect, it } from 'vitest';
import type { Content } from '../src/data/schemas';
import { newRun } from '../src/game/action';
import type { SimEvent } from '../src/game/events';
import { herdHurt, type HerdTemperament } from '../src/game/herd';
import { applyDamageToMonster, type MonsterState } from '../src/game/monster';
import { Simulation } from '../src/game/sim';
import { baseOptions, frame, loadContent, run } from './helpers';

let content: Content;
beforeAll(async () => { content = await loadContent(); });

const KIDS = ['kordopil', 'palseit', 'numaporon', 'chilumicana', 'kohalgis', 'mitogaron', 'yurtepica', 'hinasalv'];
type Started = Extract<SimEvent, { type: 'action_start' }>;
const starts = (events: SimEvent[], m?: MonsterState): Started[] => events.filter((e): e is Started => e.type === 'action_start' && (!m || e.actor === m.id));
const distance = (a: { x: number; z: number }, b: { x: number; z: number }): number => Math.hypot(a.x - b.x, a.z - b.z);

/** 頭数だけ固定した、元の種・技・AIを使う群れ。依頼の必要数もその頭数以下へ合わせる。 */
function pack(key = 'kordopil', count = 3, seed = 12345): Simulation {
  const id = `monster.${key}`;
  const questId = `quest.${key}.pack1`;
  const def = content.monsters.get(id)!;
  const quest = content.quests.get(questId)!;
  const local: Content = { ...content, monsters: new Map(content.monsters), quests: new Map(content.quests) };
  local.monsters.set(id, { ...def, herd: { ...def.herd!, size: [count, count] } });
  local.quests.set(questId, { ...quest, targets: quest.targets!.map((t) => ({ ...t, count: Math.min(t.count, count) })) });
  const sim = new Simulation(local, baseOptions({ questId, seed }));
  // 複数回の行動観察中、狩人の力尽きで刺激が消えないようにする。
  sim.player.hp = 10_000;
  return sim;
}

function playerAt(sim: Simulation, x: number, z: number): void {
  sim.player.pos = { x, y: sim.world.groundHeight(x, z), z };
  sim.player.prevPos = { ...sim.player.pos };
}

function monsterAt(sim: Simulation, m: MonsterState, x: number, z: number): void {
  m.pos = { x, y: sim.world.groundHeight(x, z), z };
  m.prevPos = { ...m.pos };
  m.yaw = Math.atan2(sim.player.pos.x - x, sim.player.pos.z - z);
  m.prevYaw = m.yaw;
}

/** 同じ距離5.8m、正面向き。互いに重ならず、狩人は攻撃しない。 */
function approachPack(allAggressive = false): Simulation {
  const sim = pack();
  playerAt(sim, 0, 4);
  sim.herds[0]!.anchor = { x: 0, z: 10 };
  sim.herds[0]!.members.forEach((m, i) => {
    const a = (i - 1) * 0.48;
    monsterAt(sim, m, Math.sin(a) * 5.8, 4 + Math.cos(a) * 5.8);
    if (allAggressive) m.herd!.temperament = 'aggressive';
  });
  return sim;
}

function lone(temperament: HerdTemperament, dist = 5.8): { sim: Simulation; m: MonsterState } {
  const sim = pack();
  playerAt(sim, 0, 10 - dist);
  sim.herds[0]!.anchor = { x: 0, z: 10 };
  const [m, ...rest] = sim.herds[0]!.members;
  monsterAt(sim, m!, 0, 10);
  m!.herd!.temperament = temperament;
  rest.forEach((o, i) => {
    monsterAt(sim, o, -30, -24 + i * 3);
    o.aiEnabled = false;
    o.herd!.temperament = 'timid';
  });
  return { sim, m: m! };
}

function until(sim: Simulation, condition: () => boolean, limit = 480): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < limit && !condition(); i++) {
    sim.step(frame());
    out.push(...sim.drainEvents());
  }
  expect(condition(), `condition not reached after ${limit} ticks`).toBe(true);
  return out;
}

function firstAction(sim: Simulation, m: MonsterState): SimEvent[] {
  return until(sim, () => m.action !== null, 300);
}

function hurt(sim: Simulation, m: MonsterState, damage = 1): void {
  applyDamageToMonster(m, m.def.parts.findIndex((p) => p.id === 'body'), damage, 'blunt', sim);
  herdHurt(m, sim);
}

describe('幼体の固定した性格と反応', () => {
  it('全8種で同種の性格が混在し、同じseedでは配分も個体の性格も変わらない', () => {
    for (const key of KIDS) for (const count of [3, 4]) {
      const a = pack(key, count, 91), b = pack(key, count, 91);
      const profile = (s: Simulation): HerdTemperament[] => s.herds[0]!.members.map((m) => m.herd!.temperament);
      const before = profile(a);
      expect(before.filter((t) => t === 'timid'), key).toHaveLength(1);
      expect(before.filter((t) => t === 'aggressive'), key).toHaveLength(1);
      expect(before.filter((t) => t === 'cautious'), key).toHaveLength(count - 2);
      expect(profile(b)).toEqual(before);
      playerAt(a, -35, -24);
      run(a, 300);
      expect(profile(a)).toEqual(before);
    }
    const arrangements = new Set(Array.from({ length: 12 }, (_, seed) => pack('kordopil', 3, seed + 1).herds[0]!.members.map((m) => m.herd!.temperament).join(',')));
    expect(arrangements.size).toBeGreaterThan(1);
  });

  it('同じ近づき方でも、臆病は逃走・慎重は警戒・攻撃的は威嚇後に実際の技を出す', () => {
    const sim = approachPack();
    const ms = sim.herds[0]!.members;
    const by = (t: HerdTemperament): MonsterState => ms.find((m) => m.herd!.temperament === t)!;
    const timid = by('timid'), cautious = by('cautious'), aggressive = by('aggressive');
    const early = run(sim, 20);
    expect(starts(early)).toEqual([]);
    expect(timid.herd!.mood).toBe('flee');
    expect(cautious.herd!.mood).toBe('alert');
    expect(aggressive.herd!.mood).toBe('alert');
    expect(early.some((e) => e.type === 'herd_alarm')).toBe(true);
    const later = run(sim, 240);
    expect(starts(later, aggressive).some((e) => sim.content.actions.get(e.actionId)!.hitWindows.length > 0)).toBe(true);
    expect(starts(later, timid)).toEqual([]);
    expect(starts(later, cautious)).toEqual([]);
  });

  it('遅れて届く逃走警報は、既に始めた反撃を逃走へ上書きしない', () => {
    const { sim, m } = lone('aggressive', 3.5);
    const ev = firstAction(sim, m);
    expect(starts(ev, m).length).toBeGreaterThan(0);
    until(sim, () => m.action === null, 240);
    expect(m.herd!.mood).toBe('fight');
    // 技の途中で警報処理が待つ場合も、実際に警報が届くtickを検査する。
    m.herd!.alarm = 1;
    m.herd!.alarmFlee = true;
    run(sim, 1);
    expect(m.herd!.alarm).toBe(0);
    expect(m.herd!.mood).toBe('fight');
    expect(sim.herds[0]!.engagedId).toBe(m.id);
    expect(starts(firstAction(sim, m), m).length).toBeGreaterThan(0);
  });

  it('警戒範囲の外で長く見ていても、交戦距離へ入った直後には攻撃しない', () => {
    const { sim, m } = lone('aggressive', 7);
    expect(starts(run(sim, 120), m)).toEqual([]);
    expect(m.herd!.mood).toBe('alert');
    playerAt(sim, m.pos.x, m.pos.z - 5.8);
    expect(starts(run(sim, 20), m)).toEqual([]);
    expect(m.herd!.mood).toBe('alert');
    expect(starts(firstAction(sim, m), m).length).toBeGreaterThan(0);
  });
});

describe('短い反撃と撤退', () => {
  it('1回の交戦は攻撃的でも2技まで、慎重・疲れた臆病個体は1技で退く', () => {
    for (const temperament of ['aggressive', 'cautious', 'timid'] as const) {
      const { sim, m } = lone(temperament, 1.5);
      if (temperament === 'timid') m.herd!.tired = 60;
      hurt(sim, m);
      const ev = firstAction(sim, m);
      ev.push(...until(sim, () => m.herd!.mood !== 'fight' && m.action === null, 600));
      expect(starts(ev, m).length, temperament).toBeGreaterThan(0);
      expect(starts(ev, m).length, temperament).toBeLessThanOrEqual(temperament === 'aggressive' ? 2 : 1);
      expect(m.herd!.reengageTicks, temperament).toBeGreaterThan(0);
    }
  });

  it('長い技の再生中も交戦期限を消費し、360tick後はその技を終えて次を出さない', () => {
    const { sim, m } = lone('aggressive', 1.5);
    hurt(sim, m);
    const begun = firstAction(sim, m);
    expect(starts(begun, m)).toHaveLength(1);
    const real = m.action!;
    // 実際にAIが開始した技を長くした境界条件。判定・移動を無くし、時間制限だけを見る。
    m.action = newRun({ ...real.def, durationTicks: 420, hitWindows: [], events: [], rootMotion: { mode: 'none' } }, real.instanceId, m.yaw);
    const ev = run(sim, 365);
    expect(m.action).not.toBeNull();
    expect(m.herd!.ticks).toBeLessThanOrEqual(0);
    expect(starts(ev, m)).toEqual([]);
    ev.push(...run(sim, 60));
    expect(m.action).toBeNull();
    expect(m.herd!.mood).not.toBe('fight');
    expect(starts(ev, m)).toEqual([]);
  });

  it('交戦開始点から8mを超えたら、近くに狩人がいても新しい技を始めない', () => {
    const { sim, m } = lone('aggressive', 5.8);
    until(sim, () => m.herd!.mood === 'fight');
    expect(m.action).toBeNull();
    const origin = { ...m.herd!.fightOrigin! };
    playerAt(sim, origin.x + 8.2, origin.z - 1.5);
    monsterAt(sim, m, origin.x + 8.2, origin.z);
    const ev = run(sim, 20);
    expect(m.herd!.mood).not.toBe('fight');
    expect(starts(ev, m)).toEqual([]);
  });

  it('退いた直後に再び被弾しても、180tickの再交戦待ちを飛ばさない', () => {
    const { sim, m } = lone('aggressive', 1.5);
    hurt(sim, m);
    firstAction(sim, m);
    until(sim, () => m.herd!.mood !== 'fight' && m.action === null, 600);
    expect(m.herd!.reengageTicks).toBe(180);
    playerAt(sim, m.pos.x, m.pos.z - 1.5);
    hurt(sim, m);
    const ev = run(sim, 179);
    expect(starts(ev, m)).toEqual([]);
    expect(m.herd!.mood).not.toBe('fight');
  });

  it('HPが30%以下なら全性格が撤退し、被弾・近接・警報でも反撃を始めない', () => {
    for (const temperament of ['aggressive', 'cautious', 'timid'] as const) {
      const { sim, m } = lone(temperament, 3.5);
      m.hp = m.def.hp * 0.3;
      m.herd!.alarm = 1;
      m.herd!.alarmFlee = true;
      const before = distance(m.pos, sim.player.pos);
      herdHurt(m, sim);
      const ev = run(sim, 90);
      expect(starts(ev, m), temperament).toEqual([]);
      expect(m.herd!.mood, temperament).not.toBe('fight');
      expect(distance(m.pos, sim.player.pos), temperament).toBeGreaterThan(before + 1);
    }
    const { sim, m } = lone('aggressive', 1.5);
    hurt(sim, m);
    firstAction(sim, m);
    m.hp = m.def.hp * 0.3;
    herdHurt(m, sim);
    const ev = until(sim, () => m.action === null, 250);
    ev.push(...run(sim, 60));
    expect(starts(ev, m)).toEqual([]);
    expect(m.herd!.mood).not.toBe('fight');
  });
});

describe('群れの同時攻撃と状態の再現', () => {
  it('攻撃的な個体が複数近づいても、同時に戦うのは群れで1頭まで', () => {
    const sim = approachPack(true);
    const out: SimEvent[] = [];
    for (let i = 0; i < 540; i++) {
      sim.step(frame());
      out.push(...sim.drainEvents());
      const active = sim.herds[0]!.members.filter((m) => m.action !== null || m.herd!.mood === 'fight');
      expect(active.length, `tick ${i}`).toBeLessThanOrEqual(1);
      if (active[0]) expect(sim.herds[0]!.engagedId).toBe(active[0].id);
    }
    expect(starts(out).length).toBeGreaterThan(0);
  });

  it('交戦中の個体が倒れたら枠を空け、生きた別個体が技を出せる', () => {
    const sim = approachPack(true);
    until(sim, () => sim.herds[0]!.members.some((m) => m.action !== null), 300);
    const owner = sim.herds[0]!.members.find((m) => m.id === sim.herds[0]!.engagedId)!;
    hurt(sim, owner, owner.hp);
    const ev = run(sim, 200);
    expect(owner.dead).toBe(true);
    expect(starts(ev, owner)).toEqual([]);
    expect(starts(ev).some((e) => e.actor !== owner.id)).toBe(true);
    expect(sim.herds[0]!.engagedId).not.toBe(owner.id);
  });

  it('麻痺・睡眠・気絶は攻撃意思より優先され、止まった個体は仲間の枠を塞がない', () => {
    for (const kind of ['para', 'sleep', 'stun'] as const) {
      const sim = approachPack(true);
      until(sim, () => sim.herds[0]!.members.some((m) => m.action !== null), 300);
      const owner = sim.herds[0]!.members.find((m) => m.id === sim.herds[0]!.engagedId)!;
      const at = { ...owner.pos };
      owner.ailments.ticks[kind] = 600;
      owner.herd!.alarm = 1;
      owner.herd!.alarmFlee = true;
      const ev = run(sim, 160);
      expect(owner.action, kind).toBeNull();
      expect(starts(ev, owner), kind).toEqual([]);
      expect(distance(owner.pos, at), kind).toBeLessThan(0.01);
      expect(starts(ev).some((e) => e.actor !== owner.id), kind).toBe(true);
      expect(sim.herds[0]!.engagedId, kind).not.toBe(owner.id);
    }
  });

  it('同じseed・同じ刺激を与えた群れは、攻撃開始の列と状態指紋が一致する', () => {
    const a = approachPack(), b = approachPack();
    const ea: SimEvent[] = [], eb: SimEvent[] = [];
    for (let i = 0; i < 900; i++) {
      const input = frame({ moveX: i >= 300 && i < 360 ? 0.5 : 0, moveZ: i >= 550 && i < 600 ? 0.5 : 0 });
      a.step(input); b.step(input);
      ea.push(...a.drainEvents()); eb.push(...b.drainEvents());
      expect(a.hash(), `tick ${i}`).toBe(b.hash());
    }
    expect(starts(ea).length).toBeGreaterThan(0);
    expect(starts(ea)).toEqual(starts(eb));
  });

  it('性格・攻撃枠・威嚇や再交戦の残りなど、次の判断を変える状態はhashで区別できる', () => {
    const mutations: ((s: Simulation) => void)[] = [
      (s) => { s.herds[0]!.temperamentSeed++; },
      (s) => { s.herds[0]!.engagedId = s.herds[0]!.members[0]!.id; },
      (s) => { s.herds[0]!.members[0]!.herd!.temperament = 'cautious'; },
      (s) => { s.herds[0]!.members[0]!.herd!.threatTicks = 10; },
      (s) => { s.herds[0]!.members[0]!.herd!.reengageTicks = 20; },
      (s) => { s.herds[0]!.members[0]!.herd!.retaliate = true; },
      (s) => { s.herds[0]!.members[0]!.herd!.attacksLeft = 1; },
      (s) => { s.herds[0]!.members[0]!.herd!.countedActionId = 99; },
      (s) => { s.herds[0]!.members[0]!.herd!.fightOrigin = { x: 2, z: 3 }; },
    ];
    for (const mutate of mutations) {
      const sim = pack();
      const before = sim.hash();
      mutate(sim);
      expect(sim.hash()).not.toBe(before);
    }
  });
});
