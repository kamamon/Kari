// モンスターの状態と行動選択（訓練標的とガルドロスで共通）。
// 技は開始時に一度だけ抽選し、攻撃中に毎 tick 選び直さない。旋回は turning.untilTick まで。
// 本体 HP・部位の耐久・切断の蓄積・怯みの蓄積・怒りは、それぞれ別の値として持つ。
import { followShape, staggerFollowTick } from './follow';
import { DEG, angleDiff, forwardOf, fromArr, toWorld, turnToward, v3, yawOf, type V3 } from '../core/math';
import type { SeededRng } from '../core/seededRng';
import type { DamageType, MonsterAiChoice, MonsterDef } from '../data/schemas';
import { newRun, type ActionRun } from './action';
import { activeControl, ailmentRules, clearAilments, freshAilments, stepAilments, type MonsterAilments } from './ailment';
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
  /** 状態異常（v0.33.0。毒・麻痺・睡眠・気絶のためた量と、効いている残り。src/game/ailment.ts） */
  ailments: MonsterAilments;
  /** 突進の制動（v0.41.0）: 前へ進めなかった tick が続いた数（技を始めるたびに 0） */
  stall: number;
  /** 目印（v0.42.0。標識玉）の残り tick。0 なら印は無い */
  markTicks: number;
  /** 最後に狩人が見たエリア（同じエリアに居た時。フィールドの大型だけ。見ていなければ null） */
  seenAreaId: string | null;
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
    ailments: freshAilments(),
    stall: 0,
    markTicks: 0,
    seenAreaId: null,
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
  // 部位の追従（v0.25.0。src/game/follow.ts）: 技の間と、眠っている間は、表のとおりに形を動かす。
  // v0.36.0（#12 の M3）: 転倒・怯み（部位破壊・切断を含む）・気絶の間も、戦闘の状態（経過・残りの tick）から引く。切断の後は、残った形の表
  const fol = m.def.follow;
  let grid: (Int16Array | null)[][] | null = null;
  let tick = 0, dur = 1;
  if (fol && !m.dead) {
    const st = fol.states;
    if (m.action) {
      grid = fol.actions.get(m.action.def.actionId) ?? null;
      tick = m.action.tick;
      dur = m.action.def.durationTicks;
    } else if (m.staggerTicks > 0 && m.staggerKind) {
      const s = m.staggerKind === 'topple' ? st.topple : st.flinch;
      if (s) {
        grid = s.grid;
        dur = s.ticks;
        tick = staggerFollowTick(m.staggerTotal - m.staggerTicks, m.staggerTotal, s.ticks);
      }
    } else if ((m.asleep || m.captured || m.ailments.ticks.sleep > 0) && fol.sleep) grid = fol.sleep;
    else if (m.ailments.ticks.stun > 0 && st.stun) {
      grid = st.stun.grid;
      dur = st.stun.ticks;
      tick = m.ailments.ticks.stun % st.stun.ticks;
    }
  }
  m.def.parts.forEach((part, i) => {
    const severed = m.parts[i]!.severed && part.sever;
    const shapes = severed ? part.sever!.shapesAfter : part.shapes;
    shapes.forEach((s, j) => {
      const d = grid ? grid[i]?.[severed ? part.shapes.length + j : j] : null;
      out.push(shapeToWorld(d ? followShape(s, d, tick, dur, fol!.step) : s, i, m.pos, m.yaw));
    });
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
  const area = ctx.world.areaAt(m.pos.x, m.pos.z);
  const f = forwardOf(m.yaw);
  const x = m.pos.x + f.x * dist;
  const z = m.pos.z + f.z * dist;
  const r = m.def.bodyRadius;
  // 自然な形のエリア: 行き先が、外周から体の半径より内側で、そこまでの間も外周に遮られない
  const g = ctx.world.geo(area);
  if (g) return g.shape.signedDistance(x, z) > r && g.shape.clear(m.pos.x, m.pos.z, x, z, r * 0.8);
  const b = area.bounds;
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
  m.stall = 0;
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

  // 状態異常（v0.33.0）: 効き目の残り・毒・猶予・ためた量の減り。毒で倒れることもある
  const at = stepAilments(m.ailments, ailmentRules(ctx.content), m.def.id);
  for (const k of at.ended) ctx.emit({ type: 'monster_ailment', target: m.id, kind: k, on: false });
  if (at.poison > 0) {
    ctx.emit({ type: 'ailment_damage', target: m.id, kind: 'poison', damage: at.poison, pos: { x: m.pos.x, y: m.pos.y + 1.2, z: m.pos.z } });
    applyStatusDamage(m, at.poison, ctx);
    if (m.dead) return;
  }

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
  // 麻痺・睡眠・気絶（v0.33.0）: 効いている間は動かない（技も止まる）
  if (activeControl(m.ailments) !== null) {
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
      const ts = def.turnSteps;
      // 足を踏み替える向き直り（v0.41.0。#19 の M01）: 正面の外に居る相手には、待ち時間の間は決まった角度だけ回る。
      // 待ち時間が明けていれば、まずその位置へ出せる技（横・後ろへの技）を選び、無ければ回る。回っている間は相手を追わない
      const outside = !!ts && ang > ts.faceDeg;
      if (!outside) {
        m.yaw = turnToward(m.yaw, toPlayer, (def.turnDegPerSec * (rage ? rage.speedScale : 1) * DEG) / 60);
        // 間合い取り: 正面に捉えていて遠ければ歩いて近づく
        if (def.moveSpeed && def.approach && dist > def.approach.stopDist && ang < def.approach.faceDeg) {
          const step = (def.moveSpeed * (rage ? rage.speedScale : 1)) / 60;
          const f = forwardOf(m.yaw);
          ctx.world.move(m.pos, def.bodyRadius, f.x * step, f.z * step);
        }
      }
      // 相手が左（rel > 0）なら左回り。backDeg より後ろなら 180°
      const turn = (): void => {
        const rel = angleDiff(m.yaw, toPlayer) / DEG;
        const back = ang > ts!.backDeg;
        begin(m, rel > 0 ? (back ? ts!.backLeft : ts!.left) : back ? ts!.backRight : ts!.right, ctx);
      };
      if (m.cooldown > 0) {
        m.cooldown--;
        if (!outside) return;
        turn();
      } else {
        const choice = chooseAction(m, player, ctx);
        if (choice) {
          const actionId = choice.ifSevered && isSevered(m, choice.ifSevered.partId) ? choice.ifSevered.actionId : choice.actionId;
          m.lastActionId = choice.actionId;
          if (choice.cooldownTicks) m.moveCooldowns[choice.actionId] = choice.cooldownTicks;
          begin(m, actionId, ctx);
          // 開始した tick に行動の 0 tick 目を処理する（プレイヤーと同じ数え方）
        } else if (outside) turn();
        else return;
      }
    }
  }

  const run = m.action!;
  const adef = run.def;
  const t = run.tick;
  if (active && adef.turning && t < adef.turning.untilTick) {
    m.yaw = turnToward(m.yaw, toPlayer, (adef.turning.maxDegreesPerSecond * DEG) / 60);
  }
  // 体ごと回る（v0.41.0。向き直りの技）: ゆっくり始まってゆっくり止まる
  const sp = adef.spin;
  if (sp && t >= sp.from && t < sp.to) {
    const ease = (u: number): number => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
    const n = sp.to - sp.from;
    const y = m.yaw + sp.degrees * DEG * (ease((t + 1 - sp.from) / n) - ease((t - sp.from) / n));
    m.yaw = Math.atan2(Math.sin(y), Math.cos(y));
  }
  if (adef.rootMotion.mode === 'controller' && adef.rootMotion.curveId) {
    const curve = ctx.content.curves.get(adef.rootMotion.curveId)!;
    const d = sampleCurve(curve, t + 1) - sampleCurve(curve, t);
    if (d !== 0) {
      // dirDeg: 横・斜め・後ろへ跳ぶ技（v0.17.0）。体の向きは変えない
      const f = forwardOf(m.yaw + (adef.rootMotion.dirDeg ?? 0) * DEG);
      const x0 = m.pos.x, z0 = m.pos.z;
      ctx.world.move(m.pos, def.bodyRadius, f.x * d, f.z * d);
      // 突進の制動（v0.41.0。#19 の M02）: 走る間に前へ進めない（壁に沿って滑る時も、前への進みで見る）tick が 3 つ続いたら、減速の始めへ。
      // 浅い角度でかすめる時（40° より浅い）は、そのまま壁に沿って走る
      const br = adef.brake;
      if (br && t >= br.from && t < br.to && d > 0.02) {
        const ahead = (m.pos.x - x0) * f.x + (m.pos.z - z0) * f.z;
        // 前への進みが 6 割に届かない（壁へ斜め 40° より深く当たって滑る時を含む）
        m.stall = ahead < d * 0.6 ? m.stall + 1 : 0;
        if (m.stall >= 3) {
          m.stall = 0;
          run.tick = br.to - 1;
          ctx.emit({ type: 'monster_brake', target: m.id, tick: t });
        }
      }
    }
  }
  for (const hz of adef.hazards ?? []) {
    if (hz.tick === t) ctx.spawnHazards(hz, player.pos, hz.origin ? toWorld(fromArr(hz.origin), m.pos, m.yaw) : undefined, def);
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

/**
 * 反応の契約（v0.43.0。#19 の M03・M04。D-134）:
 * - 終端（死亡・捕獲）は、ほかのすべてより先（markDead・捕獲が動き・怯み・怒り・状態異常を止める。ここへは来ない）。
 * - 転倒は決まった長さを最後まで続ける。転倒の間の破壊・切断・怯みは、部位が壊れ・切れて知らせも出るが、反応（怯みの動き）は吸い込む
 *   （転倒の途中で起き上がって怯みへ替わる、を起こさない。倒れる向きと長さは、始めた tick で決まったまま）。
 * - それ以外は、残りの長い方（切断 110 > 破壊 80 > 怯み 46〜50。長さは Kari の仮の値）。怯みの蓄積は、何もしていない時だけたまる。
 */
function stagger(m: MonsterState, kind: StaggerKind, ticks: number, partIndex: number, ctx: SimCtx): void {
  if (m.staggerTicks > 0 && m.staggerKind === 'topple') return;
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
/** 倒れた: 終端の状態を先に決める（動き・怯み・怒り・状態異常を止める） */
function markDead(m: MonsterState): void {
  m.dead = true;
  m.asleep = false;
  m.deadTicks = 0;
  m.action = null;
  m.staggerTicks = 0;
  m.staggerKind = null;
  if (m.enraged) m.enraged = false;
  clearAilments(m.ailments);
}

/**
 * 毒など、部位に当たらないダメージ（v0.33.0）。体力だけを減らす（部位・怯み・怒り・目覚め・気づきには関わらない）。
 */
export function applyStatusDamage(m: MonsterState, damage: number, ctx: SimCtx): void {
  if (m.dead || m.captured || damage <= 0) return;
  m.hp = Math.max(0, m.hp - damage);
  if (m.hp <= 0) {
    markDead(m);
    ctx.emit({ type: 'monster_dead', target: m.id });
  }
}

/**
 * 部位へのダメージ。partScale は部位破壊・切断のための蓄積だけに掛ける（防具の技能「砕き」。v0.33.0。体力・怯み・怒りは damage のまま）。
 */
export function applyDamageToMonster(m: MonsterState, partIndex: number, damage: number, type: DamageType, ctx: SimCtx, partScale = 1): void {
  if (m.dead || m.captured || damage <= 0) return;
  m.hp = Math.max(0, m.hp - damage);
  const part = m.parts[partIndex]!;
  const def = m.def.parts[partIndex]!;

  let broke = false;
  if (def.breakDurability !== null && !part.broken) {
    part.durability -= damage * partScale;
    if (part.durability <= 0) {
      part.durability = 0;
      part.broken = true;
      broke = true;
    }
  }
  let severed = false;
  if (def.sever && !part.severed && type === 'cut') {
    part.severAcc += damage * partScale;
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
    markDead(m);
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
