// ガルドロス戦（M2 前半）: 発見・技の選択・追尾の打ち切り・部位・切断・転倒・怒り・狩猟の終了経路。
import { beforeAll, describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/seededRng';
import type { Content } from '../src/data/schemas';
import type { SimEvent } from '../src/game/events';
import type { InputFrame } from '../src/game/inputFrame';
import { applyDamageToMonster, monsterShapes, type MonsterState } from '../src/game/monster';
import { resolveIncomingHit } from '../src/game/player';
import { firstMismatch, runReplay } from '../src/game/replay';
import { Simulation } from '../src/game/sim';
import { Btn, baseOptions, frame, loadContent, run } from './helpers';

let content: Content;
beforeAll(async () => {
  content = await loadContent();
});

const QUEST = 'quest.basin.003';
const G = 'monster.galdros.';
const hunt = (): Simulation => new Simulation(content, baseOptions({ questId: QUEST }));
/** この依頼で受けるダメージ（技データの値 × 依頼の倍率、端数切り捨て） */
const taken = (base: number): number => Math.floor(base * (content.quests.get(QUEST)!.monsterAttackScale ?? 1));

/** ガルドロスを (0,10) に -Z 向きで置き、気付いた状態にする。only を渡すと、その技だけを選べるようにする。 */
function arena(only?: string | string[]): { sim: Simulation; m: MonsterState } {
  const sim = hunt();
  const m = sim.monsters[0]!;
  m.pos = { x: 0, y: 0, z: 10 };
  m.prevPos = { ...m.pos };
  m.yaw = Math.PI;
  m.prevYaw = Math.PI;
  m.aware = true;
  m.cooldown = 0;
  const allow = only === undefined ? null : (Array.isArray(only) ? only : [only]).map((x) => G + x);
  if (allow) for (const c of m.def.ai.choices) if (!allow.includes(c.actionId)) m.moveCooldowns[c.actionId] = 1e9;
  return { sim, m };
}
/** モンスターのローカル座標（左 +X、前 +Z）でプレイヤーを置く。 */
function at(sim: Simulation, lx: number, lz: number): void {
  sim.player.pos = { x: -lx, y: 0, z: 10 - lz };
  sim.player.prevPos = { ...sim.player.pos };
}
const started = (events: SimEvent[], id: string): boolean => events.some((e) => e.type === 'action_start' && e.actionId === G + id);
const part = (m: MonsterState, id: string): number => m.def.parts.findIndex((p) => p.id === id);

describe('発見', () => {
  it('遠くに居る間は動かず、視界に入ると気付いて咆哮する', () => {
    const sim = hunt();
    const m = sim.monsters[0]!;
    const z0 = m.pos.z;
    let ev = run(sim, 180);
    expect(m.aware).toBe(false);
    expect(m.pos.z).toBe(z0);
    expect(ev.some((e) => e.type === 'action_start' && e.actor === m.id)).toBe(false);
    // 正面 12m（視界 130 度・16m 以内）
    const f = { x: Math.sin(m.yaw), z: Math.cos(m.yaw) };
    sim.player.pos = { x: m.pos.x + f.x * 12, y: 0, z: m.pos.z + f.z * 12 };
    ev = run(sim, 2);
    expect(m.aware).toBe(true);
    expect(ev.filter((e) => e.type === 'monster_aware')).toHaveLength(1);
    expect(started(ev, 'roar')).toBe(true);
  });

  it('背後からは 6m まで気付かれない。攻撃すれば気付く', () => {
    const sim = hunt();
    const m = sim.monsters[0]!;
    const f = { x: Math.sin(m.yaw), z: Math.cos(m.yaw) };
    sim.player.pos = { x: m.pos.x - f.x * 10, y: 0, z: m.pos.z - f.z * 10 };
    run(sim, 30);
    expect(m.aware).toBe(false);
    applyDamageToMonster(m, part(m, 'tail'), 30, 'cut', sim);
    expect(m.aware).toBe(true);
    const sim2 = hunt();
    const m2 = sim2.monsters[0]!;
    sim2.player.pos = { x: m2.pos.x - f.x * 5.5, y: 0, z: m2.pos.z - f.z * 5.5 };
    run(sim2, 2);
    expect(m2.aware).toBe(true);
  });
});

describe('技の選択と追尾の打ち切り', () => {
  it('前脚叩き: 正面の左右で使う脚を選び、28 tick 以降は向きを変えない', () => {
    for (const [lx, id] of [[0.6, 'slam_l'], [-0.6, 'slam_r']] as const) {
      // 正面の近くで選べる技は多いので、前脚叩きだけに絞って、脚の選び方を確かめる
      const { sim, m } = arena(['slam_l', 'slam_r']);
      at(sim, lx, 3.2);
      const ev: SimEvent[] = [];
      let yaw28 = 0;
      for (let i = 0; i < 120; i++) {
        sim.step(frame());
        ev.push(...sim.drainEvents());
        if (i === 28) yaw28 = m.yaw;
        if (i > 28) expect(m.yaw).toBe(yaw28);
      }
      expect(started(ev, id)).toBe(true);
      expect(ev.filter((e) => e.type === 'player_hurt')).toHaveLength(1);
      expect(sim.player.hp).toBe(100 - taken(28));
    }
  });

  it('依頼の倍率が、受けるダメージに掛かる。この依頼は倍率なし（回復液を支給するので 1.0 へ戻した）', () => {
    expect(content.quests.get(QUEST)!.monsterAttackScale).toBeUndefined();
    const hp = (scale: number | null): number => {
      const { sim } = arena(['slam_l', 'slam_r']);
      if (scale !== null) sim.monsterAttackScale = scale;
      at(sim, 0.6, 3.2);
      run(sim, 120);
      return sim.player.hp;
    };
    expect(hp(null)).toBe(100 - 28);
    expect(hp(0.75)).toBe(100 - 21);
  });

  it('直線突進: 遠い正面で使い、発進後は追尾しない。立ち止まると 1 回だけ轢かれ、横へ避ければ当たらない', () => {
    const still = arena('charge');
    at(still.sim, 0, 12);
    const z0 = still.m.pos.z;
    const ev = run(still.sim, 190);
    expect(started(ev, 'charge')).toBe(true);
    expect(ev.filter((e) => e.type === 'player_hurt')).toHaveLength(1);
    expect(still.sim.player.hp).toBe(100 - taken(34));
    // 技を選ぶ前に 1 tick 歩き（2.6m/s）、その後は移動曲線どおり 16.5m 進む（壁に当たらない配置）
    expect(z0 - still.m.pos.z).toBeCloseTo(16.5 + 2.6 / 60, 5);

    const dodge = arena('charge');
    at(dodge.sim, 0, 12);
    let yaw40 = 0;
    for (let i = 0; i < 190; i++) {
      // 40 tick（旋回の打ち切り）を過ぎてから横へ歩く
      dodge.sim.step(i > 40 ? frame({ moveX: 1 }) : frame());
      if (i === 40) yaw40 = dodge.m.yaw;
      if (i > 40) expect(dodge.m.yaw).toBe(yaw40);
    }
    expect(dodge.sim.player.hp).toBe(100);
  });

  it('壁際（正面に 9m の空きが無い）では突進を選ばない', () => {
    const { sim, m } = arena('charge');
    m.pos = { x: 0, y: 0, z: -22 };
    sim.player.pos = { x: 0, y: 0, z: -29 };
    const ev = run(sim, 60);
    expect(started(ev, 'charge')).toBe(false);
  });

  it('半円尾払い: 背後に居ると使う。尾を切ると短い尾払いに替わり、届く距離が縮む', () => {
    // 尾の判定は付け根（z -1.5）から 1.75m + 半径 0.45m（体の中心から 3.7m）。切断後は 0.95m + 0.45m（2.9m）。
    // 真後ろ 3.6m は、切る前だけ届く距離。
    const long = arena('tail_sweep');
    at(long.sim, 0, -3.6);
    let ev = run(long.sim, 110);
    expect(started(ev, 'tail_sweep')).toBe(true);
    expect(long.sim.player.hp).toBe(100 - taken(26));

    const short = arena('tail_sweep');
    short.m.parts[part(short.m, 'tail')]!.severed = true;
    at(short.sim, 0, -3.6);
    ev = run(short.sim, 110);
    expect(started(ev, 'tail_sweep_short')).toBe(true);
    expect(short.sim.player.hp).toBe(100);
  });

  it('鉱殻崩落: 尾で地面を叩いた時に岩が打ち上がり、落下地点はその時点で固定。その場に居れば 1 回当たり、離れれば当たらない', () => {
    const stay = arena('rockfall');
    at(stay.sim, 0, 8);
    // 尾が地面を叩く（技の 58 tick 目）までは、岩は出ない
    let ev = run(stay.sim, 50);
    expect(stay.sim.hazards).toHaveLength(0);
    ev = [...ev, ...run(stay.sim, 12)];
    expect(started(ev, 'rockfall')).toBe(true);
    expect(stay.sim.hazards).toHaveLength(5);
    expect(ev.filter((e) => e.type === 'hazard_warn')).toHaveLength(5);
    expect([stay.sim.hazards[0]!.x, stay.sim.hazards[0]!.z]).toEqual([stay.sim.player.pos.x, stay.sim.player.pos.z]);
    // 岩は、尾の先（モンスターの後ろ 3m）から打ち上がる
    const from = stay.sim.hazards[0]!.from!;
    expect(Math.hypot(from.x - stay.m.pos.x, from.z - stay.m.pos.z)).toBeCloseTo(3.0, 1);
    ev = run(stay.sim, 80);
    expect(ev.filter((e) => e.type === 'hazard_impact')).toHaveLength(5);
    expect(ev.filter((e) => e.type === 'player_hurt')).toHaveLength(1);
    expect(stay.sim.player.hp).toBe(100 - taken(22));
    expect(stay.sim.hazards).toHaveLength(0);

    const leave = arena('rockfall');
    at(leave.sim, 0, 8);
    run(leave.sim, 62);
    const before = leave.sim.hazards.map((h) => [h.x, h.z]);
    leave.sim.player.pos = { x: 30, y: 0, z: -20 };
    run(leave.sim, 40);
    expect(leave.sim.hazards.map((h) => [h.x, h.z])).toEqual(before);
    run(leave.sim, 40);
    expect(leave.sim.player.hp).toBe(100);
  });
});

describe('部位・切断・怯み・怒り', () => {
  it('頭と背殻は耐久が尽きると壊れ、壊れた部位は肉質が柔らかくなる', () => {
    const { sim, m } = arena();
    m.aiEnabled = false;
    const head = part(m, 'head');
    applyDamageToMonster(m, head, 219, 'cut', sim);
    expect(m.parts[head]!.broken).toBe(false);
    applyDamageToMonster(m, head, 1, 'cut', sim);
    expect(m.parts[head]!.broken).toBe(true);
    expect(sim.drainEvents().filter((e) => e.type === 'part_break')).toHaveLength(1);
    expect(m.staggerKind).toBe('break');
    expect(m.hp).toBe(m.def.hp - 220);
    expect(m.def.parts[head]!.brokenHitzone!.cut).toBeGreaterThan(m.def.parts[head]!.hitzone.cut);
  });

  it('尾は切断属性の蓄積でだけ切れ、切れると判定が短くなる', () => {
    const { sim, m } = arena();
    m.aiEnabled = false;
    const tail = part(m, 'tail');
    const reach = (): number => Math.max(...monsterShapes(m).filter((s) => s.partIndex === tail).map((s) => (s.b ?? s.a).z));
    const before = reach();
    applyDamageToMonster(m, tail, 400, 'blunt', sim);
    expect(m.parts[tail]!.severed).toBe(false);
    m.staggerTicks = 0;
    applyDamageToMonster(m, tail, 259, 'cut', sim);
    expect(m.parts[tail]!.severed).toBe(false);
    applyDamageToMonster(m, tail, 1, 'cut', sim);
    expect(m.parts[tail]!.severed).toBe(true);
    const ev = sim.drainEvents();
    expect(ev.filter((e) => e.type === 'part_sever')).toHaveLength(1);
    expect(m.staggerKind).toBe('sever');
    // -Z 向きなので、尾はワールドの +Z 側へ伸びる。切断後は 0.8m 短い（判定の先端が z -2.9 → -2.1）。
    expect(before - reach()).toBeCloseTo(0.8, 5);
    // 2 回は切れない
    applyDamageToMonster(m, tail, 500, 'cut', sim);
    expect(sim.drainEvents().filter((e) => e.type === 'part_sever')).toHaveLength(0);
  });

  it('脚の怯みは転倒になる。立ち直り直後は怯まず、次の転倒にはより多くのダメージが要る', () => {
    const { sim, m } = arena();
    m.aiEnabled = false;
    const leg = part(m, 'foreleg');
    applyDamageToMonster(m, leg, 200, 'cut', sim);
    expect(m.staggerKind).toBe('topple');
    expect(m.staggerTicks).toBe(190);
    run(sim, 190);
    expect(m.staggerTicks).toBe(0);
    // 立ち直り直後の 90 tick は蓄積しない
    applyDamageToMonster(m, leg, 400, 'cut', sim);
    expect(m.staggerKind).toBe(null);
    run(sim, 90);
    applyDamageToMonster(m, leg, 300, 'cut', sim);
    expect(m.staggerKind).toBe(null); // 閾値は 200 → 310 に上がっている
    applyDamageToMonster(m, leg, 10, 'cut', sim);
    expect(m.staggerKind).toBe('topple');
  });

  it('450 ダメージで怒り、咆哮してから攻撃の間隔が詰まる。2100 tick で収まる', () => {
    const { sim, m } = arena();
    at(sim, 0, 30);
    m.cooldown = 1e6;
    const body = part(m, 'body');
    m.parts[body]!.flinchThreshold = 1e9;
    expect(m.def.rage!.threshold).toBe(450);
    applyDamageToMonster(m, body, 449, 'cut', sim);
    expect(m.enraged).toBe(false);
    applyDamageToMonster(m, body, 1, 'cut', sim);
    expect(m.enraged).toBe(true);
    let ev = run(sim, 2);
    expect(ev.filter((e) => e.type === 'monster_rage')).toHaveLength(1);
    expect(started(ev, 'roar')).toBe(true);
    ev = run(sim, 2100);
    expect(m.enraged).toBe(false);
    expect(ev.some((e) => e.type === 'monster_rage' && !e.on)).toBe(true);
  });

  it('死亡は終端。以後のダメージや怯みは起きない', () => {
    const { sim, m } = arena();
    applyDamageToMonster(m, part(m, 'head'), 5000, 'cut', sim);
    expect(m.dead).toBe(true);
    expect(m.staggerTicks).toBe(0);
    const ev = sim.drainEvents();
    expect(ev.filter((e) => e.type === 'monster_dead')).toHaveLength(1);
    applyDamageToMonster(m, part(m, 'foreleg'), 5000, 'cut', sim);
    expect(sim.drainEvents()).toHaveLength(0);
    run(sim, 600);
    expect(m.dead).toBe(true); // 訓練標的と違い、復帰しない
  });
});

describe('狩猟の終了（結果は一度だけ確定する）', () => {
  const kill = (sim: Simulation): void => applyDamageToMonster(sim.monsters[0]!, 0, 99999, 'cut', sim);
  const faint = (sim: Simulation): void => {
    sim.player.hp = 1;
    sim.player.invulnTicks = 0;
    resolveIncomingHit(sim.player, { attackerPos: { x: 0, y: 0, z: 0 }, baseDamage: 50, guardable: false, guardCost: 0, reaction: 'flinch' }, sim);
  };

  it('討伐で成功。以後は時間切れやリタイアで変わらない', () => {
    const sim = hunt();
    kill(sim);
    let ev = run(sim, 1);
    expect(ev.filter((e) => e.type === 'hunt_end')).toEqual([{ type: 'hunt_end', phase: 'success', reason: 'slay' }]);
    expect(sim.hunt).toMatchObject({ phase: 'success', reason: 'slay', ticks: 1 });
    sim.hunt!.ticks = 1e9;
    ev = run(sim, 5, () => frame({ pressed: Btn.Retire }));
    expect(ev.filter((e) => e.type === 'hunt_end')).toHaveLength(0);
    expect(sim.hunt).toMatchObject({ phase: 'success', reason: 'slay' });
  });

  it('制限時間（15 分 = 54000 tick）で失敗', () => {
    const sim = hunt();
    expect(sim.hunt!.quest.timeLimitTicks).toBe(54000);
    sim.hunt!.ticks = 54000 - 2;
    run(sim, 1);
    expect(sim.hunt!.phase).toBe('active');
    run(sim, 1);
    expect(sim.hunt).toMatchObject({ phase: 'failed', reason: 'time' });
  });

  it('力尽き 3 回で失敗。2 回目まではキャンプから再開する', () => {
    const sim = hunt();
    faint(sim);
    run(sim, 1);
    expect(sim.hunt).toMatchObject({ phase: 'active', faints: 1 });
    run(sim, 220);
    expect(sim.player.mode).toBe('free');
    expect(sim.player.hp).toBe(100);
    faint(sim);
    run(sim, 221);
    faint(sim);
    const ev = run(sim, 1);
    expect(sim.hunt).toMatchObject({ phase: 'failed', reason: 'faints', faints: 3 });
    expect(ev.filter((e) => e.type === 'hunt_end')).toHaveLength(1);
  });

  it('リタイアは入力として受け取り、失敗で終わる', () => {
    const sim = hunt();
    run(sim, 10);
    run(sim, 1, () => frame({ pressed: Btn.Retire }));
    expect(sim.hunt).toMatchObject({ phase: 'failed', reason: 'retire', ticks: 11 });
  });

  it('討伐と時間切れが同じ tick に重なったら、討伐を先に確定する', () => {
    const sim = hunt();
    sim.hunt!.ticks = 54000 - 1;
    kill(sim);
    run(sim, 1, () => frame({ pressed: Btn.Retire }));
    expect(sim.hunt).toMatchObject({ phase: 'success', reason: 'slay' });
  });

  it('終了後はモンスターの攻撃も落石も当たらない', () => {
    const { sim, m } = arena('rockfall');
    at(sim, 0, 8);
    run(sim, 62);
    expect(sim.hazards.length).toBe(5);
    run(sim, 1, () => frame({ pressed: Btn.Retire }));
    run(sim, 120);
    expect(sim.player.hp).toBe(100);
    expect(m.aiEnabled).toBe(false);
  });
});

describe('ガルドロス戦の固定 tick 一致', () => {
  it('同じ入力列は、描画 30/60fps・不規則な間隔でも同じ結果になる', () => {
    const frames: InputFrame[] = [];
    let held = 0;
    for (let i = 0; i < 4200; i++) {
      const f = frame();
      const c = i % 113;
      // 北のガルドロスへ向かい、戦いながら時々横へ動く
      if (i < 520 || c >= 90) f.moveZ = 1;
      else if (c >= 60 && c < 75) f.moveX = Math.floor(i / 113) % 2 ? 1 : -1;
      let next = held;
      if (i < 420) next |= Btn.Sprint;
      else next &= ~Btn.Sprint;
      if (i >= 520 && c === 0) next |= Btn.Main;
      if (c === 4) next &= ~Btn.Main;
      if (i >= 520 && c === 40) next |= Btn.Sub;
      if (c === 44) next &= ~Btn.Sub;
      if (i >= 520 && i % 197 === 30) next |= Btn.Dodge;
      if (i % 197 === 33) next &= ~Btn.Dodge;
      f.pressed = next & ~held;
      f.released = held & ~next;
      f.held = next;
      held = next;
      frames.push(f);
    }
    const opts = baseOptions({ questId: QUEST });
    const a = runReplay(content, opts, frames, () => 1 / 60);
    const b = runReplay(content, opts, frames, () => 1 / 30);
    const jitter = new SeededRng(5);
    const c = runReplay(content, opts, frames, () => 0.006 + jitter.next() * 0.04);
    expect(firstMismatch(a, b)).toBe(-1);
    expect(firstMismatch(a, c)).toBe(-1);
    // 実際に戦闘になっていること
    expect(a.damageTaken).toBeGreaterThan(0);
    expect(a.hitCount).toBeGreaterThan(2);
  });
});
