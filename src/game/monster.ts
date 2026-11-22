// モンスター（M1 では訓練標的）の状態と行動選択。
// 技は開始時に一度だけ抽選し、攻撃中に毎 tick 選び直さない。旋回は turning.untilTick まで。
import { DEG, angleDiff, forwardOf, turnToward, v3, yawOf, type V3 } from '../core/math';
import type { MonsterDef } from '../data/schemas';
import { newRun, type ActionRun } from './action';
import { shapeToWorld, type WorldShape } from './combat';
import type { PlayerState, SimCtx } from './player';
import { sampleCurve } from './tracks';

export interface MonsterState {
  id: string;
  def: MonsterDef;
  pos: V3;
  prevPos: V3;
  yaw: number;
  prevYaw: number;
  hp: number;
  parts: { durability: number; broken: boolean }[];
  action: ActionRun | null;
  attackEval: { run: ActionRun; t: number } | null;
  cooldown: number;
  staggerTicks: number;
  hitstop: number;
  dead: boolean;
  deadTicks: number;
  aiEnabled: boolean;
  lastActionId: string | null;
  spawn: { x: number; z: number; yaw: number };
}

export function createMonster(def: MonsterDef, spawn: { x: number; z: number; yaw: number }, id: string): MonsterState {
  const pos = v3(spawn.x, 0, spawn.z);
  return {
    id,
    def,
    pos,
    prevPos: { ...pos },
    yaw: spawn.yaw,
    prevYaw: spawn.yaw,
    hp: def.hp,
    parts: def.parts.map((p) => ({ durability: p.breakDurability ?? 0, broken: false })),
    action: null,
    attackEval: null,
    cooldown: def.ai.cooldownTicks[0],
    staggerTicks: 0,
    hitstop: 0,
    dead: false,
    deadTicks: 0,
    aiEnabled: true,
    lastActionId: null,
    spawn,
  };
}

export function resetMonster(m: MonsterState): void {
  m.pos = v3(m.spawn.x, 0, m.spawn.z);
  m.prevPos = { ...m.pos };
  m.yaw = m.spawn.yaw;
  m.prevYaw = m.yaw;
  m.hp = m.def.hp;
  m.parts = m.def.parts.map((p) => ({ durability: p.breakDurability ?? 0, broken: false }));
  m.action = null;
  m.attackEval = null;
  m.cooldown = m.def.ai.cooldownTicks[0];
  m.staggerTicks = 0;
  m.hitstop = 0;
  m.dead = false;
  m.deadTicks = 0;
  m.lastActionId = null;
}

/** 部位の当たり形状（ワールド座標）。並び順が「同時接触の固定優先順」になる。 */
export function monsterShapes(m: MonsterState): WorldShape[] {
  const out: WorldShape[] = [];
  m.def.parts.forEach((part, i) => {
    for (const s of part.shapes) out.push(shapeToWorld(s, i, m.pos, m.yaw));
  });
  return out;
}

function chooseAction(m: MonsterState, player: PlayerState, ctx: SimCtx): string | null {
  const dx = player.pos.x - m.pos.x;
  const dz = player.pos.z - m.pos.z;
  const dist = Math.hypot(dx, dz);
  const ang = Math.abs(angleDiff(m.yaw, yawOf(dx, dz))) / DEG;
  let cands = m.def.ai.choices.filter((c) => dist >= c.minDist && dist <= c.maxDist && ang <= c.maxAngleDeg);
  if (cands.length === 0) return null;
  if (cands.length > 1) {
    const others = cands.filter((c) => c.actionId !== m.lastActionId);
    if (others.length > 0) cands = others;
  }
  const total = cands.reduce((s, c) => s + c.weight, 0);
  let r = ctx.rng.next() * total;
  for (const c of cands) {
    r -= c.weight;
    if (r <= 0) return c.actionId;
  }
  return cands[cands.length - 1]!.actionId;
}

export function stepMonster(m: MonsterState, player: PlayerState, ctx: SimCtx): void {
  m.prevPos = { ...m.pos };
  m.prevYaw = m.yaw;
  m.attackEval = null;

  if (m.dead) {
    m.deadTicks++;
    if (m.def.respawnTicks !== null && m.deadTicks >= m.def.respawnTicks) {
      resetMonster(m);
      ctx.emit({ type: 'monster_respawn', target: m.id });
    }
    return;
  }
  if (m.hitstop > 0) {
    m.hitstop--;
    if (m.action) m.action.advanced = false;
    return;
  }
  if (m.staggerTicks > 0) {
    m.staggerTicks--;
    return;
  }

  const dx = player.pos.x - m.pos.x;
  const dz = player.pos.z - m.pos.z;
  const dist = Math.hypot(dx, dz);
  const toPlayer = yawOf(dx, dz);
  const turnStep = (m.def.turnDegPerSec * DEG) / 60;
  const aware = m.aiEnabled && player.mode !== 'dead' && dist <= m.def.ai.aggroRange;

  if (!m.action) {
    if (!aware) return;
    m.yaw = turnToward(m.yaw, toPlayer, turnStep);
    if (m.cooldown > 0) {
      m.cooldown--;
      return;
    }
    const actionId = chooseAction(m, player, ctx);
    if (!actionId) return;
    m.action = newRun(ctx.content.actions.get(actionId)!, ctx.newInstanceId(), m.yaw);
    m.lastActionId = actionId;
    ctx.emit({ type: 'action_start', actor: m.id, actionId, instanceId: m.action.instanceId });
    // 開始した tick に行動の 0 tick 目を処理する（プレイヤーと同じ数え方）
  }

  const run = m.action;
  const def = run.def;
  const t = run.tick;
  if (aware && def.turning && t < def.turning.untilTick) {
    m.yaw = turnToward(m.yaw, toPlayer, (def.turning.maxDegreesPerSecond * DEG) / 60);
  }
  if (def.rootMotion.mode === 'controller' && def.rootMotion.curveId) {
    const curve = ctx.content.curves.get(def.rootMotion.curveId)!;
    const d = sampleCurve(curve, t + 1) - sampleCurve(curve, t);
    const f = forwardOf(m.yaw);
    ctx.world.move(m.pos, m.def.bodyRadius, f.x * d, f.z * d);
  }
  for (const ev of def.events) {
    if (ev.tick === t) ctx.emit({ type: 'action_event', actor: m.id, kind: ev.type, id: ev.id, pos: { ...m.pos } });
  }
  m.attackEval = { run, t };
  run.advanced = true;
  run.tick++;
  if (run.tick >= def.durationTicks) {
    m.action = null;
    const [lo, hi] = m.def.ai.cooldownTicks;
    m.cooldown = lo + ctx.rng.int(hi - lo + 1);
  }
}

/** ダメージを適用する。本体 HP と部位の耐久は別に持つ。死亡（終端状態）を先に確定する。 */
export function applyDamageToMonster(m: MonsterState, partIndex: number, damage: number, ctx: SimCtx): void {
  if (m.dead || damage <= 0) return;
  m.hp = Math.max(0, m.hp - damage);
  const part = m.parts[partIndex]!;
  const def = m.def.parts[partIndex]!;
  let broke = false;
  if (def.breakDurability !== null && !part.broken) {
    part.durability -= damage;
    if (part.durability <= 0) {
      part.durability = 0;
      part.broken = true;
      broke = true;
    }
  }
  if (m.hp <= 0) {
    m.dead = true;
    m.deadTicks = 0;
    m.action = null;
    m.staggerTicks = 0;
    if (broke) ctx.emit({ type: 'part_break', target: m.id, partId: def.id, partIndex });
    ctx.emit({ type: 'monster_dead', target: m.id });
    return;
  }
  if (broke) {
    m.action = null;
    m.staggerTicks = m.def.breakStaggerTicks;
    ctx.emit({ type: 'part_break', target: m.id, partId: def.id, partIndex });
  }
}
