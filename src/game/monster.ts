// モンスターの状態と行動選択（訓練標的とガルドロスで共通）。
// 技は開始時に一度だけ抽選し、攻撃中に毎 tick 選び直さない。旋回は turning.untilTick まで。
// 本体 HP・部位の耐久・切断の蓄積・怯みの蓄積・怒りは、それぞれ別の値として持つ。
import { DEG, angleDiff, forwardOf, fromArr, toWorld, turnToward, v3, yawOf, type V3 } from '../core/math';
import type { SeededRng } from '../core/seededRng';
import type { DamageType, MonsterAiChoice, MonsterDef } from '../data/schemas';
import { newRun, type ActionRun } from './action';
import { shapeToWorld, type WorldShape } from './combat';
import { stepHerdMember, type HerdMember } from './herd';
import type { PlayerState, SimCtx } from './player';
import { stepRoam, wakeMonster, type RoamState } from './roam';
import { sampleCurve } from './tracks';

export type StaggerKind = 'break' | 'flinch' | 'topple' | 'sever';

export interface MonsterPartState {
  durability: number;
  broken: boolean;
  severed: boolean;
  severAcc: number;
  flinchAcc: number;
  flinchThreshold: number;
}

export interface MonsterState {
  /** フィールドでの移動と休息（フィールドでなければ null） */
  roam: RoamState | null;
  /** 巣で眠っている（攻撃されると起きる） */
  asleep: boolean;
  /** 群れの 1 頭（幼体。v0.18.0）。群れで暮らさなければ null */
  herd: HerdMember | null;
  id: string;
  def: MonsterDef;
  pos: V3;
  prevPos: V3;
  yaw: number;
  prevYaw: number;
  hp: number;
  parts: MonsterPartState[];
  action: ActionRun | null;
  attackEval: { run: ActionRun; t: number } | null;
  cooldown: number;
  moveCooldowns: Record<string, number>;
  staggerTicks: number;
  staggerTotal: number;
  staggerKind: StaggerKind | null;
  /** 怯みから立ち直った直後は、次の怯みを受け付けない */
  flinchImmune: number;
  hitstop: number;
  dead: boolean;
  deadTicks: number;
  aiEnabled: boolean;
  /** プレイヤーに気付いているか（発見前は動かない） */
  aware: boolean;
  enraged: boolean;
  enragedTicks: number;
  rageAcc: number;
  pendingRoar: boolean;
  lastActionId: string | null;
  spawn: { x: number; z: number; yaw: number };
  /** 罠にかかっている残り時間。この間は動けない（攻撃は受ける）。 */
  trapTicks: number;
  /** 罠にかかった回数（2 回目からは止まる時間が短くなる） */
  trapCount: number;
  /** たまっている鎮静玉の数と、効き目が消えるまでの時間 */
  tranq: number;
  tranqTicks: number;
  /** 捕獲された（終端。以後は動かず、ダメージも受けない） */
  captured: boolean;
}

/** 弱っているか（体力が捕獲できる割合以下）。見た目の合図と捕獲の条件が同じ値を使う。 */
export function isWeak(m: MonsterState): boolean {
  const c = m.def.capture;
  return !!c && !m.dead && m.hp <= m.def.hp * c.hpRatio;
}

const IMMUNE_AFTER_STAGGER = 90;

function freshParts(def: MonsterDef): MonsterPartState[] {
  return def.parts.map((p) => ({
    durability: p.breakDurability ?? 0,
    broken: false,
    severed: false,
    severAcc: 0,
    flinchAcc: 0,
    flinchThreshold: p.flinch?.threshold ?? 0,
  }));
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
    parts: freshParts(def),
    action: null,
    attackEval: null,
    cooldown: def.ai.cooldownTicks[0],
    moveCooldowns: {},
    staggerTicks: 0,
    staggerTotal: 0,
    staggerKind: null,
    flinchImmune: 0,
    hitstop: 0,
    dead: false,
    deadTicks: 0,
    aiEnabled: true,
    aware: !def.discover,
    enraged: false,
    enragedTicks: 0,
    rageAcc: 0,
    pendingRoar: false,
    lastActionId: null,
    trapTicks: 0,
    trapCount: 0,
    tranq: 0,
    tranqTicks: 0,
    captured: false,
    roam: null,
    asleep: false,
    herd: null,
    spawn,
  };
}

export function resetMonster(m: MonsterState): void {
  const fresh = createMonster(m.def, m.spawn, m.id);
  fresh.aiEnabled = m.aiEnabled;
  fresh.herd = m.herd;
  Object.assign(m, fresh);
}

/** 部位の当たり形状（ワールド座標）。並び順が「同時接触の固定優先順」になる。切断済みの部位は短い形状へ替わる。 */
export function monsterShapes(m: MonsterState): WorldShape[] {
  const out: WorldShape[] = [];
  m.def.parts.forEach((part, i) => {
    const shapes = m.parts[i]!.severed && part.sever ? part.sever.shapesAfter : part.shapes;
    for (const s of shapes) out.push(shapeToWorld(s, i, m.pos, m.yaw));
  });
  return out;
}

/** プレイヤーが通り抜けられない円（ワールド座標）。 */
export function monsterBlockers(m: MonsterState): { x: number; z: number; r: number }[] {
  const list = m.def.collision ?? [{ z: 0, r: m.def.bodyRadius }];
  const f = forwardOf(m.yaw);
  return list.map((c) => ({ x: m.pos.x + f.x * c.z, z: m.pos.z + f.z * c.z, r: c.r }));
}

const isSevered = (m: MonsterState, partId: string): boolean => {
  const i = m.def.parts.findIndex((p) => p.id === partId);
  return i >= 0 && m.parts[i]!.severed;
};

function clearAhead(m: MonsterState, dist: number, ctx: SimCtx): boolean {
  const b = ctx.world.areaAt(m.pos.x, m.pos.z).bounds;
  const f = forwardOf(m.yaw);
  const x = m.pos.x + f.x * dist;
  const z = m.pos.z + f.z * dist;
  const r = m.def.bodyRadius;
  return x > b.minX + r && x < b.maxX - r && z > b.minZ + r && z < b.maxZ - r;
}

/** その個体の乱数。群れの幼体は、群れの乱数を使う（シミュレーションの乱数の並びを変えない） */
const rngOf = (m: MonsterState, ctx: SimCtx): SeededRng => m.herd?.group.rng ?? ctx.rng;

function chooseAction(m: MonsterState, player: PlayerState, ctx: SimCtx): MonsterAiChoice | null {
  const dx = player.pos.x - m.pos.x;
  const dz = player.pos.z - m.pos.z;
  const dist = Math.hypot(dx, dz);
  // rel > 0 ならプレイヤーはモンスターの左側（+X 側）
  const rel = angleDiff(m.yaw, yawOf(dx, dz)) / DEG;
  const ang = Math.abs(rel);
  let cands = m.def.ai.choices.filter(
    (c) =>
      dist >= c.minDist &&
      dist <= c.maxDist &&
      ang <= c.maxAngleDeg &&
      ang >= (c.minAngleDeg ?? 0) &&
      (!c.side || (c.side === 'left' ? rel > 0 : rel <= 0)) &&
      !(m.moveCooldowns[c.actionId]! > 0) &&
      (!c.clearAhead || clearAhead(m, c.clearAhead, ctx)),
  );
  if (cands.length === 0) return null;
  if (cands.length > 1) {
    const others = cands.filter((c) => c.actionId !== m.lastActionId);
    if (others.length > 0) cands = others;
  }
  const total = cands.reduce((s, c) => s + c.weight, 0);
  let r = rngOf(m, ctx).next() * total;
  for (const c of cands) {
    r -= c.weight;
    if (r <= 0) return c;
  }
  return cands[cands.length - 1]!;
}

function begin(m: MonsterState, actionId: string, ctx: SimCtx): void {
  m.action = newRun(ctx.content.actions.get(actionId)!, ctx.newInstanceId(), m.yaw);
  ctx.emit({ type: 'action_start', actor: m.id, actionId, instanceId: m.action.instanceId });
}

export function stepMonster(m: MonsterState, player: PlayerState, ctx: SimCtx): void {
  m.prevPos = { ...m.pos };
  m.prevYaw = m.yaw;
  m.attackEval = null;
  const def = m.def;

  if (m.dead) {
    m.deadTicks++;
    if (def.respawnTicks !== null && m.deadTicks >= def.respawnTicks) {
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

  // 時間で減るもの（怯み中も進む）
  if (m.flinchImmune > 0) m.flinchImmune--;
  for (const k in m.moveCooldowns) if (m.moveCooldowns[k]! > 0) m.moveCooldowns[k]!--;
  if (m.enraged) {
    m.enragedTicks--;
    if (m.enragedTicks <= 0) {
      m.enraged = false;
      ctx.emit({ type: 'monster_rage', target: m.id, on: false });
    }
  }

  if (m.captured) return;
  if (m.tranqTicks > 0 && --m.tranqTicks === 0) m.tranq = 0;

  if (m.staggerTicks > 0) {
    m.staggerTicks--;
    if (m.staggerTicks === 0) {
      m.staggerKind = null;
      m.flinchImmune = IMMUNE_AFTER_STAGGER;
    }
    if (m.trapTicks > 0) m.trapTicks--;
    return;
  }
  if (m.trapTicks > 0) {
    m.trapTicks--;
    m.action = null;
    return;
  }

  // 群れの幼体: ふだんは群れの動き。反撃する間（fight）と技の途中だけ、下のふつうの技の選び方へ進む
  if (m.herd && stepHerdMember(m, player, ctx)) return;

  // 別のエリアに居る相手には、気づかないし、向かっていかない（エリアが 1 つの狩場では、いつも同じエリア）
  const sameArea = ctx.world.areaAt(player.pos.x, player.pos.z) === ctx.world.areaAt(m.pos.x, m.pos.z);
  // フィールド: エリアを移る・巣で眠る（その間は、気づく・技を選ぶ、をしない）
  if (m.roam && stepRoam(m, sameArea, ctx)) return;

  const dx = player.pos.x - m.pos.x;
  const dz = player.pos.z - m.pos.z;
  const dist = Math.hypot(dx, dz);
  const toPlayer = yawOf(dx, dz);
  const ang = Math.abs(angleDiff(m.yaw, toPlayer)) / DEG;
  const rage = m.enraged ? def.rage : undefined;

  // 発見: 視界に入るか、すぐ近くまで寄られたら気付く
  if (!m.aware) {
    const d = def.discover!;
    if (m.aiEnabled && sameArea && player.mode !== 'dead' && (dist <= d.closeRange || (dist <= d.range && ang <= d.fovDeg / 2))) {
      m.aware = true;
      ctx.emit({ type: 'monster_aware', target: m.id });
      begin(m, d.actionId, ctx);
    } else return;
  }

  const active = m.aiEnabled && sameArea && player.mode !== 'dead' && dist <= def.ai.aggroRange;

  if (!m.action) {
    if (m.pendingRoar && def.rage) {
      m.pendingRoar = false;
      begin(m, def.rage.actionId, ctx);
    } else {
      if (!active) return;
      m.yaw = turnToward(m.yaw, toPlayer, (def.turnDegPerSec * (rage ? rage.speedScale : 1) * DEG) / 60);
      // 間合い取り: 正面に捉えていて遠ければ歩いて近づく
      if (def.moveSpeed && def.approach && dist > def.approach.stopDist && ang < def.approach.faceDeg) {
        const step = (def.moveSpeed * (rage ? rage.speedScale : 1)) / 60;
        const f = forwardOf(m.yaw);
        ctx.world.move(m.pos, def.bodyRadius, f.x * step, f.z * step);
      }
      if (m.cooldown > 0) {
        m.cooldown--;
        return;
      }
      const choice = chooseAction(m, player, ctx);
      if (!choice) return;
      const actionId = choice.ifSevered && isSevered(m, choice.ifSevered.partId) ? choice.ifSevered.actionId : choice.actionId;
      m.lastActionId = choice.actionId;
      if (choice.cooldownTicks) m.moveCooldowns[choice.actionId] = choice.cooldownTicks;
      begin(m, actionId, ctx);
      // 開始した tick に行動の 0 tick 目を処理する（プレイヤーと同じ数え方）
    }
  }

  const run = m.action!;
  const adef = run.def;
  const t = run.tick;
  if (active && adef.turning && t < adef.turning.untilTick) {
    m.yaw = turnToward(m.yaw, toPlayer, (adef.turning.maxDegreesPerSecond * DEG) / 60);
  }
  if (adef.rootMotion.mode === 'controller' && adef.rootMotion.curveId) {
    const curve = ctx.content.curves.get(adef.rootMotion.curveId)!;
    const d = sampleCurve(curve, t + 1) - sampleCurve(curve, t);
    if (d !== 0) {
      // dirDeg: 横・斜め・後ろへ跳ぶ技（v0.17.0）。体の向きは変えない
      const f = forwardOf(m.yaw + (adef.rootMotion.dirDeg ?? 0) * DEG);
      ctx.world.move(m.pos, def.bodyRadius, f.x * d, f.z * d);
    }
  }
  for (const hz of adef.hazards ?? []) {
    if (hz.tick === t) ctx.spawnHazards(hz, player.pos, hz.origin ? toWorld(fromArr(hz.origin), m.pos, m.yaw) : undefined);
  }
  for (const ev of adef.events) {
    if (ev.tick === t) ctx.emit({ type: 'action_event', actor: m.id, kind: ev.type, id: ev.id, pos: { ...m.pos } });
  }
  m.attackEval = { run, t };
  run.advanced = true;
  run.tick++;
  if (run.tick >= adef.durationTicks) {
    m.action = null;
    const [lo, hi] = def.ai.cooldownTicks;
    m.cooldown = Math.round((lo + rngOf(m, ctx).int(hi - lo + 1)) * (rage ? rage.cooldownScale : 1));
  }
}

function stagger(m: MonsterState, kind: StaggerKind, ticks: number, partIndex: number, ctx: SimCtx): void {
  // 長い方を優先（切断 > 破壊 > 転倒 > 怯み の順に長くしてある）
  if (ticks <= m.staggerTicks) return;
  m.action = null;
  m.staggerTicks = ticks;
  m.staggerTotal = ticks;
  m.staggerKind = kind;
  ctx.emit({ type: 'monster_stagger', target: m.id, kind, partIndex });
}

/**
 * ダメージを適用する。死亡（終端状態）を先に確定し、その後に破壊・切断・怯み・怒りを見る。
 * 切断の蓄積は切断属性（cut）のダメージだけ。
 */
export function applyDamageToMonster(m: MonsterState, partIndex: number, damage: number, type: DamageType, ctx: SimCtx): void {
  if (m.dead || m.captured || damage <= 0) return;
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
  let severed = false;
  if (def.sever && !part.severed && type === 'cut') {
    part.severAcc += damage;
    if (part.severAcc >= def.sever.threshold) {
      part.severed = true;
      severed = true;
    }
  }
  const emitChanges = (): void => {
    if (broke) ctx.emit({ type: 'part_break', target: m.id, partId: def.id, partIndex });
    if (severed) {
      // 切り落とした先端の落ちる位置（切断前の形状の先端）
      const tip = def.shapes[def.shapes.length - 1]!;
      const pos = toWorld(fromArr(tip.b ?? tip.a), m.pos, m.yaw);
      ctx.emit({ type: 'part_sever', target: m.id, partId: def.id, partIndex, pos: { x: pos.x, y: m.pos.y, z: pos.z }, yaw: m.yaw });
    }
  };

  if (m.hp <= 0) {
    m.dead = true;
    m.asleep = false;
    m.deadTicks = 0;
    m.action = null;
    m.staggerTicks = 0;
    m.staggerKind = null;
    if (m.enraged) m.enraged = false;
    emitChanges();
    ctx.emit({ type: 'monster_dead', target: m.id });
    return;
  }
  emitChanges();

  // 眠っていたら起きる
  if (m.asleep) wakeMonster(m, ctx, true);

  // 攻撃されたら気付く
  if (!m.aware && m.def.discover) {
    m.aware = true;
    ctx.emit({ type: 'monster_aware', target: m.id });
    m.pendingRoar = !!m.def.rage;
  }

  if (severed) stagger(m, 'sever', def.sever!.staggerTicks, partIndex, ctx);
  if (broke) stagger(m, 'break', m.def.breakStaggerTicks, partIndex, ctx);

  if (def.flinch && m.staggerTicks === 0 && m.flinchImmune === 0) {
    part.flinchAcc += damage;
    if (part.flinchAcc >= part.flinchThreshold) {
      part.flinchAcc = 0;
      part.flinchThreshold += def.flinch.growth;
      stagger(m, def.flinch.topple ? 'topple' : 'flinch', def.flinch.ticks, partIndex, ctx);
    }
  }

  const rage = m.def.rage;
  if (rage && !m.enraged) {
    m.rageAcc += damage;
    if (m.rageAcc >= rage.threshold) {
      m.rageAcc = 0;
      m.enraged = true;
      m.enragedTicks = rage.durationTicks;
      m.pendingRoar = true;
      ctx.emit({ type: 'monster_rage', target: m.id, on: true });
    }
  }
}
