// 幼体の群れ（v0.18.0。docs/spec.md の 23 章、D-081）。計算だけ（DOM・Three.js・Math.random・現在時刻に触れない）。
// 群れ（HerdGroup）は、住みかのエリアの中に「居場所の中心（anchor）」を持ち、草を食べながら、ときどき中心を少し動かす。
// 1 頭ずつ（HerdMember）は、気分（mood）で動く:
//   graze   草を食む（中心のまわりの自分の場所へ、ゆっくり歩いては、立ち止まって食べる）
//   rest    群れで伏せて休む（気づく距離が短くなる）
//   alert   狩人に気づいて、顔を上げて見る（その場に止まる）
//   flee    逃げる（狩人から離れる向きへ。走り続けると、息を整えるまで止まる）
//   fight   向き直って反撃する（攻撃された時と、追い詰められた時。この間だけ技を出す）
//   regroup 群れへ戻る
//   hide    親（成体）が同じエリアで戦っている間、岩陰へ寄る
//   travel  群れで、住みかの別のエリアへ移る（フィールドだけ）
// 気づいた個体は、仲間へ知らせる（距離に応じて少し遅れて、仲間も気づく・逃げる）。
// 乱数は群れごとの SeededRng（シミュレーションの乱数とは別）。群れが居ても、大型の動きの乱数の並びは変わらない。
import { DEG, angleDiff, clamp, forwardOf, turnToward, yawOf } from '../core/math';
import type { SeededRng } from '../core/seededRng';
import type { FieldAreaDef, FieldExit, HerdDef } from '../data/schemas';
import type { MonsterState } from './monster';
import type { PlayerState, SimCtx } from './player';
import { headingTo, nextHop, wakeMonster } from './roam';
import type { AreaGeom, Circle, World } from './world';

export type HerdMood = 'graze' | 'rest' | 'alert' | 'flee' | 'fight' | 'regroup' | 'hide' | 'travel';

export interface HerdGroup {
  id: number;
  monsterId: string;
  def: HerdDef;
  /** 住みかのエリア（巡る順）。フィールドでなければ空 */
  areas: string[];
  /** いま住んでいるエリアの番号（areas の中）と id（フィールドでなければ ''） */
  areaIndex: number;
  areaId: string;
  /** 居場所の中心 */
  anchor: { x: number; z: number };
  /** 中心を次に動かすまで */
  driftIn: number;
  /** 群れで休んでいる残り（0 なら起きている）と、次に休むまで */
  restTicks: number;
  restIn: number;
  /** 次に別のエリアへ移るまで（住みかが 1 つなら動かない） */
  travelIn: number;
  /** 別のエリアへ移っている途中: 使う出口・その出口の先のエリア・最後の行き先・着いた後の中心・経った時間（途中のエリアを通る時は、エリアごとに出口を選び直す） */
  travel: { via: FieldExit; to: string; dest: string; arrival: { x: number; z: number }; ticks: number } | null;
  /** 静かになってからの時間 / 騒ぎがあったか */
  quiet: number;
  stirred: boolean;
  /** 騒ぎの知らせを出した段階（0 = まだ、1 = 顔を上げた、2 = 逃げ出した。静まると 0 へ戻る） */
  alarmLevel: number;
  /** 親（同じ狩場に居る成体。居なければ null） */
  parent: MonsterState | null;
  rng: SeededRng;
  members: MonsterState[];
}

export interface HerdMember {
  group: HerdGroup;
  /** 群れの中の番号（自分の場所と、散る向きに使う） */
  index: number;
  mood: HerdMood;
  /** 気分ごとの時間（flee: 走った時間、fight: 残り、alert: 静かになってからの時間） */
  ticks: number;
  /** 向かっている点（食べに行く場所・逃げる先・隠れる場所） */
  goal: { x: number; z: number } | null;
  /** goal へ、群れへ戻る速さで歩く */
  hurry: boolean;
  /** 立ち止まって食べる残り */
  idle: number;
  /** 仲間の知らせを受けて、反応するまでの残り（0 = 知らせ無し）。alarmFlee なら逃げる、でなければ顔を上げる */
  alarm: number;
  alarmFlee: boolean;
  /** 中心から見た自分の場所 */
  slot: { x: number; z: number };
  /** 息を整えている残り（この間は逃げない） */
  tired: number;
  /** 逃げようとして進めなかった時間（追い詰められた） */
  stuck: number;
}

// ---- 群れの決まり（種によらない値。机上の値）----
/** 歩く速さ（moveSpeed に掛ける）: 食べながら / 群れへ戻る / 移る / 隠れに行く */
const GRAZE_SPEED = 0.3;
const REGROUP_SPEED = 0.75;
const TRAVEL_SPEED = 0.55;
const HIDE_SPEED = 0.9;
/** 立ち止まって食べる時間 */
const GRAZE_IDLE: [number, number] = [150, 420];
/** 中心を動かす間隔と距離 */
const DRIFT_EVERY: [number, number] = [900, 2100];
const DRIFT_DIST: [number, number] = [3, 8];
/** 群れで休む間隔と長さ。休んでいる間、気づく距離はこの割合 */
const REST_EVERY: [number, number] = [3600, 7200];
const REST_FOR: [number, number] = [900, 1800];
const REST_SENSE = 0.6;
/** 狩人が気づく距離の外へ出てから、静まるまで */
const CALM_TICKS = 300;
/** 逃げ切ったとみなす距離（気づく距離に足す） */
const FLEE_MARGIN = 6;
/** 息を整える時間 */
const TIRED_TICKS = 150;
/** 知らせが届くまで: 基本 + 距離 1m ごと + ばらつき */
const ALARM_BASE = 6;
const ALARM_PER_M = 1.5;
const ALARM_JITTER = 14;
/** 追い詰められた: 狩人がこの距離の内で、これだけ進めなかったら、向き直る */
const CORNER_DIST = 5;
const CORNER_TICKS = 40;
/** 別のエリアへ移る間隔。これだけ歩いても着かない時は、そのまま移る */
const TRAVEL_EVERY: [number, number] = [10800, 18000];
const TRAVEL_TIMEOUT = 3600;
/** 親の近くに居る時の、親との間 */
const NEAR_PARENT = 9;

const roll = (rng: SeededRng, [lo, hi]: [number, number]): number => lo + rng.int(hi - lo + 1);

/** 落ち着いている気分（知らせを受けると、顔を上げる・逃げる） */
export function isCalm(mood: HerdMood): boolean {
  return mood === 'graze' || mood === 'rest' || mood === 'regroup' || mood === 'travel' || mood === 'hide';
}

/** 群れを作る。members は、作った後に addMember で足す。 */
export function createHerdGroup(
  id: number,
  monsterId: string,
  def: HerdDef,
  areas: string[],
  areaId: string,
  anchor: { x: number; z: number },
  rng: SeededRng,
): HerdGroup {
  return {
    id, monsterId, def, areas, areaIndex: Math.max(0, areas.indexOf(areaId)), areaId, anchor: { ...anchor },
    driftIn: roll(rng, DRIFT_EVERY), restTicks: 0, restIn: roll(rng, REST_EVERY), travelIn: areas.length > 1 ? roll(rng, TRAVEL_EVERY) : 0,
    travel: null, quiet: 0, stirred: false, alarmLevel: 0, parent: null, rng, members: [],
  };
}

/** 群れの i 頭目の場所（中心から。ひまわりの種の並び） */
export function slotOf(i: number, spacing: number): { x: number; z: number } {
  if (i === 0) return { x: 0, z: 0 };
  const r = spacing * 0.9 * Math.sqrt(i);
  const a = i * 2.39996;
  return { x: Math.cos(a) * r, z: Math.sin(a) * r };
}

export function addMember(g: HerdGroup, m: MonsterState): void {
  const index = g.members.length;
  m.herd = { group: g, index, mood: 'graze', ticks: 0, goal: null, hurry: false, idle: roll(g.rng, GRAZE_IDLE), alarm: 0, alarmFlee: false, slot: slotOf(index, g.def.spacing), tired: 0, stuck: 0 };
  g.members.push(m);
}

export const livingMembers = (g: HerdGroup): MonsterState[] => g.members.filter((m) => !m.dead && !m.captured);

/** 生きている仲間の真ん中（居なければ中心） */
export function herdCenter(g: HerdGroup, area?: AreaGeom, ctx?: SimCtx): { x: number; z: number } {
  let x = 0, z = 0, n = 0;
  for (const m of g.members) {
    if (m.dead || m.captured) continue;
    if (area && ctx && ctx.world.areaAt(m.pos.x, m.pos.z) !== area) continue;
    x += m.pos.x;
    z += m.pos.z;
    n++;
  }
  return n > 0 ? { x: x / n, z: z / n } : { ...g.anchor };
}

function setMood(m: MonsterState, mood: HerdMood): void {
  const h = m.herd!;
  if (h.mood === mood) return;
  h.mood = mood;
  h.ticks = 0;
  h.goal = null;
  h.hurry = false;
  h.stuck = 0;
  if (mood === 'fight') h.ticks = roll(h.group.rng, h.group.def.fightTicks);
  if (mood === 'graze') h.idle = roll(h.group.rng, GRAZE_IDLE) >> 1;
}

/** 気づいた・逃げ出したことを、仲間へ知らせる（近い仲間ほど早く反応する）。 */
function raise(m: MonsterState, flee: boolean, ctx: SimCtx): void {
  const g = m.herd!.group;
  g.stirred = true;
  g.quiet = 0;
  const level = flee ? 2 : 1;
  if (level > g.alarmLevel) {
    g.alarmLevel = level;
    ctx.emit({ type: 'herd_alarm', herdId: g.id, target: m.id, flee, pos: { ...m.pos } });
  }
  for (const o of g.members) {
    if (o === m || o.dead || o.captured) continue;
    const oh = o.herd!;
    // 逃げる知らせは、顔を上げているだけの仲間にも届く
    if (!isCalm(oh.mood) && !(flee && oh.mood === 'alert')) continue;
    if (oh.alarm > 0 && (oh.alarmFlee || !flee)) continue;
    const d = Math.hypot(o.pos.x - m.pos.x, o.pos.z - m.pos.z);
    oh.alarm = ALARM_BASE + Math.round(d * ALARM_PER_M) + g.rng.int(ALARM_JITTER);
    oh.alarmFlee = flee;
  }
}

/** 攻撃された（倒れた時も）。向き直って反撃するか、逃げる。仲間へ逃げる知らせ。同じエリアに居る親は、気づいて向かってくる。 */
export function herdHurt(m: MonsterState, ctx: SimCtx): void {
  const h = m.herd;
  if (!h) return;
  const g = h.group;
  if (!m.dead && !m.captured) {
    if (h.mood === 'fight') h.ticks = Math.max(h.ticks, 60);
    else if (m.aiEnabled && (h.tired > 0 || g.rng.next() < g.def.fightChance)) setMood(m, 'fight');
    else setMood(m, 'flee');
  }
  raise(m, true, ctx);
  const p = g.parent;
  if (p && !p.dead && !p.captured && ctx.world.areaAt(p.pos.x, p.pos.z) === ctx.world.areaAt(m.pos.x, m.pos.z)) {
    if (p.asleep) wakeMonster(p, ctx, true);
    if (!p.aware) {
      p.aware = true;
      p.pendingRoar = !!p.def.rage || !!p.def.discover;
      ctx.emit({ type: 'monster_aware', target: p.id });
    }
  }
}

/** 親が、同じエリアで戦っている（狩人に気づいて起きている） */
function parentFighting(g: HerdGroup, here: AreaGeom, ctx: SimCtx): MonsterState | null {
  const p = g.parent;
  if (!p || p.dead || p.captured || p.asleep || !p.aware) return null;
  return ctx.world.areaAt(p.pos.x, p.pos.z) === here ? p : null;
}

/** 中心を、エリアの縁と岩から離す */
function settle(pt: { x: number; z: number }, area: AreaGeom, pad: number, world: World): { x: number; z: number } {
  const b = area.bounds;
  const inset = Math.min(pad, (b.maxX - b.minX) / 3, (b.maxZ - b.minZ) / 3);
  // 自然な形のエリアでは、外周の縁から内側へ（四角のエリアは、これまでどおり軸ごとに）
  const keep = (x: number, z: number): { x: number; z: number } =>
    world.geo(area) ? world.clampPoint(area, x, z, inset) : { x: clamp(x, b.minX + inset, b.maxX - inset), z: clamp(z, b.minZ + inset, b.maxZ - inset) };
  let { x, z } = keep(pt.x, pt.z);
  for (const r of area.rocks) {
    const dx = x - r.x, dz = z - r.z;
    const d = Math.hypot(dx, dz);
    const need = r.r + 2.5;
    if (d < need) {
      const ux = d > 1e-6 ? dx / d : 1, uz = d > 1e-6 ? dz / d : 0;
      ({ x, z } = keep(r.x + ux * need, r.z + uz * need));
    }
  }
  return { x, z };
}

/**
 * 群れ全体を 1 tick 進める（1 頭ずつの前に呼ぶ）。静かな間だけ: 休む・中心を動かす・別のエリアへ移る。
 * 騒ぎ（顔を上げる・逃げる・戦う・隠れる）がある間は、どれも止まる。静まったら、居る所を新しい中心にする。
 */
export function stepHerdGroup(g: HerdGroup, ctx: SimCtx): void {
  const alive = livingMembers(g);
  if (alive.length === 0) return;
  const disturbed = alive.some((m) => m.herd!.mood === 'alert' || m.herd!.mood === 'flee' || m.herd!.mood === 'fight' || m.herd!.alarm > 0);
  if (disturbed) {
    g.quiet = 0;
    g.stirred = true;
    if (g.restTicks > 0) g.restTicks = 0;
    // 逃げ終えて止まっている間は、居る所を新しい居場所にする（静まった後、逃げる前の場所へは戻らない）
    if (!g.travel && !alive.some((m) => m.herd!.mood === 'flee' || m.herd!.mood === 'fight')) {
      const area = ctx.world.areaAt(alive[0]!.pos.x, alive[0]!.pos.z);
      g.anchor = settle(herdCenter(g, area, ctx), area, 6, ctx.world);
    }
    return;
  }
  g.quiet++;
  if (g.quiet === 1 && g.stirred) {
    g.stirred = false;
    g.alarmLevel = 0;
    g.driftIn = roll(g.rng, DRIFT_EVERY);
  }
  if (alive.some((m) => m.herd!.mood === 'hide')) return;
  const area = ctx.world.areaAt(g.anchor.x, g.anchor.z);

  // 別のエリアへ移っている途中
  if (g.travel) {
    const t = g.travel;
    t.ticks++;
    const dest = ctx.field?.areas.find((a) => a.id === t.to);
    const arrived = alive.filter((m) => dest && ctx.world.areaAt(m.pos.x, m.pos.z) === dest);
    if (t.ticks >= TRAVEL_TIMEOUT && dest) {
      // 着かない仲間は、そのまま移す（引っかかって群れが分かれたままにならないように）
      for (const m of alive) if (!arrived.includes(m)) arriveAt(m, t.via, ctx);
    }
    if (dest && alive.every((m) => ctx.world.areaAt(m.pos.x, m.pos.z) === dest)) {
      const from = g.areaId;
      g.areaId = t.to;
      ctx.emit({ type: 'herd_move', herdId: g.id, from, to: t.to });
      // 途中のエリア: 次の出口へ
      const next = t.to !== t.dest ? planTravel(g, t.to, t.dest, ctx) : null;
      if (next) {
        g.travel = next;
        for (const m of alive) setMood(m, 'travel');
        return;
      }
      g.areaIndex = Math.max(0, g.areas.indexOf(t.to));
      g.anchor = { ...t.arrival };
      g.travel = null;
      g.travelIn = roll(g.rng, TRAVEL_EVERY);
      for (const m of alive) setMood(m, 'regroup');
    }
    return;
  }

  // 休む
  if (g.restTicks > 0) {
    if (--g.restTicks === 0) {
      g.restIn = roll(g.rng, REST_EVERY);
      for (const m of alive) if (m.herd!.mood === 'rest') setMood(m, 'graze');
    }
    return;
  }
  if (--g.restIn <= 0 && alive.every((m) => m.herd!.mood === 'graze')) {
    g.restTicks = roll(g.rng, REST_FOR);
    for (const m of alive) setMood(m, 'rest');
    return;
  }

  // 別のエリアへ移る（住みかが 2 つ以上ある時だけ）
  if (ctx.field && g.areas.length > 1 && --g.travelIn <= 0) {
    const t = planTravel(g, g.areaId, g.areas[(g.areaIndex + 1) % g.areas.length]!, ctx);
    if (t) {
      g.travel = t;
      for (const m of alive) setMood(m, 'travel');
      return;
    }
    g.travelIn = roll(g.rng, TRAVEL_EVERY);
  }

  // 中心を少し動かす。親が同じエリアで落ち着いていれば、親の近くへ寄る
  if (--g.driftIn <= 0) {
    g.driftIn = roll(g.rng, DRIFT_EVERY);
    const p = g.parent;
    let next: { x: number; z: number };
    if (p && !p.dead && !p.captured && !p.aware && ctx.world.areaAt(p.pos.x, p.pos.z) === area) {
      const dx = g.anchor.x - p.pos.x, dz = g.anchor.z - p.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      next = { x: p.pos.x + (dx / d) * NEAR_PARENT, z: p.pos.z + (dz / d) * NEAR_PARENT };
    } else {
      const a = g.rng.next() * Math.PI * 2;
      const r = DRIFT_DIST[0] + g.rng.next() * (DRIFT_DIST[1] - DRIFT_DIST[0]);
      next = { x: g.anchor.x + Math.cos(a) * r, z: g.anchor.z + Math.sin(a) * r };
    }
    g.anchor = settle(next, area, 6, ctx.world);
  }
}

/** from から dest へ移る時の、最初の出口と、その先で群れが待つ場所（出口の先の、着く場所から 8m 内側）。行けなければ null */
function planTravel(g: HerdGroup, from: string, dest: string, ctx: SimCtx): HerdGroup['travel'] {
  if (!ctx.field) return null;
  const via = nextHop(ctx.field, from, dest, false);
  if (!via) return null;
  const to = ctx.field.areas.find((a) => a.id === via.to)!;
  const inward = forwardOf(via.arrive.yaw);
  return { via, to: via.to, dest, arrival: settle({ x: via.arrive.x + inward.x * 8, z: via.arrive.z + inward.z * 8 }, to, 6, ctx.world), ticks: 0 };
}

/** 出口の先へ着く（仲間どうしが重ならないように、横へずらす） */
function arriveAt(m: MonsterState, via: FieldExit, ctx: SimCtx): void {
  const h = m.herd!;
  const side = ((h.index % 5) - 2) * 1.3;
  const f = forwardOf(via.arrive.yaw);
  m.pos = { x: via.arrive.x - f.z * side, y: 0, z: via.arrive.z + f.x * side };
  m.pos.y = ctx.world.groundHeight(m.pos.x, m.pos.z);
  m.prevPos = { ...m.pos };
  m.yaw = via.arrive.yaw;
  m.prevYaw = m.yaw;
  setMood(m, 'regroup');
}

/** (tx, tz) へ歩く。狩人の体は避ける（すり抜けない）。進んだ距離を返す（向きを変えているだけの時は -1）。 */
function walk(m: MonsterState, tx: number, tz: number, speed: number, turn: number, ctx: SimCtx, avoid: Circle[]): number {
  const want = headingTo(m, tx, tz, ctx);
  m.yaw = turnToward(m.yaw, want, (m.def.turnDegPerSec * turn * DEG) / 60);
  if (Math.abs(angleDiff(m.yaw, want)) > 75 * DEG) return -1;
  const step = ((m.def.moveSpeed ?? 2.5) * speed) / 60;
  const d = Math.hypot(tx - m.pos.x, tz - m.pos.z);
  const s = Math.min(step, d);
  const f = forwardOf(m.yaw);
  const x0 = m.pos.x, z0 = m.pos.z;
  ctx.world.move(m.pos, m.def.bodyRadius, f.x * s, f.z * s, avoid);
  return Math.hypot(m.pos.x - x0, m.pos.z - z0);
}

/** 逃げる先: 狩人から離れる向き（群れの真ん中へ寄る / 散る）。壁際では、壁に沿って狩人から遠い側へ。 */
function fleeGoal(m: MonsterState, player: PlayerState, ctx: SimCtx): { x: number; z: number } {
  const h = m.herd!;
  const g = h.group;
  let ax = m.pos.x - player.pos.x, az = m.pos.z - player.pos.z;
  const n = Math.hypot(ax, az) || 1;
  ax /= n;
  az /= n;
  if (g.def.scatter) {
    // 散る: 1 頭ずつ違う向きへ（真後ろ・左・右）
    const a = (((h.index % 3) - 1) * 50 + (g.rng.next() - 0.5) * 20) * DEG;
    const c = Math.cos(a), s = Math.sin(a);
    [ax, az] = [ax * c - az * s, ax * s + az * c];
  } else {
    const area = ctx.world.areaAt(m.pos.x, m.pos.z);
    const c = herdCenter(g, area, ctx);
    const cx = c.x - m.pos.x, cz = c.z - m.pos.z;
    const cn = Math.hypot(cx, cz);
    // 群れの真ん中が狩人の側でなければ、そちらへ寄る
    if (cn > g.def.spacing * 1.5 && (cx * ax + cz * az) / cn > -0.3) {
      ax += (cx / cn) * 0.5;
      az += (cz / cn) * 0.5;
      const k = Math.hypot(ax, az) || 1;
      ax /= k;
      az /= k;
    }
  }
  const area = ctx.world.areaAt(m.pos.x, m.pos.z);
  const b = area.bounds;
  const inset = m.def.bodyRadius + 1.5;
  const L = 12;
  // 自然な形のエリアでは、外周の縁から内側へ寄せる（四角のエリアは、これまでどおり軸ごとに）
  const shaped = !!ctx.world.geo(area);
  const at = (ux: number, uz: number): { x: number; z: number } =>
    shaped ? ctx.world.clampPoint(area, m.pos.x + ux * L, m.pos.z + uz * L, inset) : { x: clamp(m.pos.x + ux * L, b.minX + inset, b.maxX - inset), z: clamp(m.pos.z + uz * L, b.minZ + inset, b.maxZ - inset) };
  let goal = at(ax, az);
  if (Math.hypot(goal.x - m.pos.x, goal.z - m.pos.z) < 4) {
    // 壁際: 左右のうち、狩人から遠くなる方へ、壁に沿って
    let best = -Infinity;
    for (const s of [1, -1]) {
      const c = at(-az * s, ax * s);
      const score = Math.hypot(c.x - player.pos.x, c.z - player.pos.z) + Math.hypot(c.x - m.pos.x, c.z - m.pos.z) * 0.5;
      if (score > best) {
        best = score;
        goal = c;
      }
    }
  }
  return goal;
}

/** 隠れる場所: 群れの真ん中に近い岩の、親から見て裏側。岩が無ければ、親から離れた所 */
function hideSpot(m: MonsterState, parent: MonsterState, ctx: SimCtx): { x: number; z: number } {
  const g = m.herd!.group;
  const area = ctx.world.areaAt(m.pos.x, m.pos.z);
  const c = herdCenter(g, area, ctx);
  let best: AreaGeom['rocks'][number] | null = null;
  let bd = Infinity;
  for (const r of area.rocks) {
    if (r.r < 1.2) continue;
    const d = Math.hypot(r.x - c.x, r.z - c.z);
    if (d < bd) {
      bd = d;
      best = r;
    }
  }
  const side = ((m.herd!.index % 5) - 2) * (m.def.bodyRadius * 2.2);
  if (!best || bd > 30) {
    const dx = c.x - parent.pos.x, dz = c.z - parent.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    return settle({ x: parent.pos.x + (dx / d) * 20 - (dz / d) * side, z: parent.pos.z + (dz / d) * 20 + (dx / d) * side }, area, 3, ctx.world);
  }
  const dx = best.x - parent.pos.x, dz = best.z - parent.pos.z;
  const d = Math.hypot(dx, dz) || 1;
  const ux = dx / d, uz = dz / d;
  const out = best.r + m.def.bodyRadius + 1.2;
  return settle({ x: best.x + ux * out - uz * side, z: best.z + uz * out + ux * side }, area, 2, ctx.world);
}

/** 自分の居場所の中心（別のエリアへ移る途中で、もう着いていれば、着いた先の中心） */
function anchorOf(m: MonsterState, ctx: SimCtx): { x: number; z: number } {
  const g = m.herd!.group;
  if (g.travel && ctx.field) {
    const dest = ctx.field.areas.find((a) => a.id === g.travel!.to);
    if (dest && ctx.world.areaAt(m.pos.x, m.pos.z) === dest) return g.travel.arrival;
  }
  return g.anchor;
}

/**
 * 1 頭を 1 tick 進める（stepMonster から。怯み・罠・ヒットストップの間は呼ばれない）。
 * true を返した tick は、技を選ばない（群れの動きだけ）。fight の間と、技の途中は false（ふつうの技の選び方へ）。
 */
export function stepHerdMember(m: MonsterState, player: PlayerState, ctx: SimCtx): boolean {
  const h = m.herd!;
  const g = h.group;
  const H = g.def;
  if (m.action) return false;
  m.pos.y = ctx.world.groundHeight(m.pos.x, m.pos.z);
  const here = ctx.world.areaAt(m.pos.x, m.pos.z);
  const pHere = player.mode !== 'dead' && ctx.world.areaAt(player.pos.x, player.pos.z) === here;
  const dist = Math.hypot(player.pos.x - m.pos.x, player.pos.z - m.pos.z);
  const sense = h.mood === 'rest' ? REST_SENSE : 1;
  const near = pHere && dist <= H.fleeRange * sense;
  const seen = pHere && dist <= H.alertRange * sense;
  const avoid: Circle[] = player.mode === 'dead' ? [] : [{ x: player.pos.x, z: player.pos.z, r: ctx.content.player.radius }];
  if (h.tired > 0) h.tired--;
  if (h.mood !== 'fight') h.ticks++;

  // ---- 仲間の知らせ ----
  if (h.alarm > 0 && --h.alarm === 0) {
    if (h.alarmFlee && pHere && h.tired === 0) setMood(m, 'flee');
    else if (isCalm(h.mood)) setMood(m, 'alert');
  }

  // ---- 気分を決める ----
  const parent = parentFighting(g, here, ctx);
  switch (h.mood) {
    case 'graze':
    case 'rest':
    case 'regroup':
    case 'travel':
    case 'hide':
      if (near && h.tired === 0) {
        raise(m, true, ctx);
        setMood(m, 'flee');
      } else if (seen && h.mood !== 'hide') {
        raise(m, false, ctx);
        setMood(m, 'alert');
      } else if (parent && h.mood !== 'hide') setMood(m, 'hide');
      else if (!parent && h.mood === 'hide') setMood(m, 'regroup');
      break;
    case 'alert':
      if (near && h.tired === 0) {
        raise(m, true, ctx);
        setMood(m, 'flee');
      } else if (seen) h.ticks = 0;
      else if (h.ticks >= CALM_TICKS) setMood(m, parent ? 'hide' : 'regroup');
      break;
    case 'flee':
      if (!pHere || dist > H.alertRange + FLEE_MARGIN) {
        setMood(m, 'alert');
        h.ticks = CALM_TICKS >> 1;
      } else if (h.ticks > H.fleeTicks) {
        // 走り続けて息が上がった: 少しの間、その場で息を整える
        h.tired = TIRED_TICKS;
        setMood(m, 'alert');
      }
      break;
    case 'fight':
      if (--h.ticks > 0 && m.aiEnabled && pHere) return false;
      setMood(m, pHere && h.tired === 0 ? 'flee' : 'alert');
      break;
  }

  // ---- 動く ----
  const speed0 = m.def.moveSpeed ?? 2.5;
  switch (h.mood) {
    case 'rest':
      return true;
    case 'alert': {
      // その場で、狩人の方を向く（狩人が居なければ、群れの真ん中の方）
      if (pHere) m.yaw = turnToward(m.yaw, yawOf(player.pos.x - m.pos.x, player.pos.z - m.pos.z), (m.def.turnDegPerSec * DEG) / 60);
      return true;
    }
    case 'flee': {
      if (!h.goal || h.ticks % 20 === 1 || Math.hypot(h.goal.x - m.pos.x, h.goal.z - m.pos.z) < 1) h.goal = fleeGoal(m, player, ctx);
      const step = (speed0 * H.fleeSpeedScale) / 60;
      const moved = walk(m, h.goal.x, h.goal.z, H.fleeSpeedScale, 1.8, ctx, avoid);
      // 追い詰められた: 狩人が近く、ほとんど進めない
      if (dist < CORNER_DIST && moved >= 0 && moved < step * 0.3) h.stuck++;
      else h.stuck = Math.max(0, h.stuck - 1);
      if (h.stuck >= CORNER_TICKS && m.aiEnabled) setMood(m, 'fight');
      return true;
    }
    case 'hide': {
      if (!parent) return true;
      if (!h.goal || h.ticks % 120 === 1) h.goal = hideSpot(m, parent, ctx);
      if (Math.hypot(h.goal.x - m.pos.x, h.goal.z - m.pos.z) > 0.6) walk(m, h.goal.x, h.goal.z, HIDE_SPEED, 1.2, ctx, avoid);
      else m.yaw = turnToward(m.yaw, yawOf(parent.pos.x - m.pos.x, parent.pos.z - m.pos.z), (m.def.turnDegPerSec * DEG) / 60);
      return true;
    }
    case 'travel': {
      const t = g.travel;
      if (!t) {
        setMood(m, 'regroup');
        return true;
      }
      const dest = ctx.field?.areas.find((a) => a.id === t.to);
      if (dest && here === dest) {
        // もう着いた: 着いた先の中心のまわりで待つ
        const a = t.arrival;
        if (Math.hypot(a.x + h.slot.x - m.pos.x, a.z + h.slot.z - m.pos.z) > 1) walk(m, a.x + h.slot.x, a.z + h.slot.z, TRAVEL_SPEED, 1, ctx, avoid);
        return true;
      }
      if (Math.hypot(t.via.x - m.pos.x, t.via.z - m.pos.z) <= t.via.r + m.def.bodyRadius) arriveAt(m, t.via, ctx);
      else walk(m, t.via.x, t.via.z, TRAVEL_SPEED, 1, ctx, avoid);
      return true;
    }
    case 'regroup':
    case 'graze': {
      if (g.travel) {
        setMood(m, 'travel');
        return true;
      }
      const a = anchorOf(m, ctx);
      const sx = a.x + h.slot.x, sz = a.z + h.slot.z;
      const off = Math.hypot(sx - m.pos.x, sz - m.pos.z);
      if (h.mood === 'regroup') {
        if (off <= H.spacing * 0.6) setMood(m, g.restTicks > 0 ? 'rest' : 'graze');
        else walk(m, sx, sz, REGROUP_SPEED, 1, ctx, avoid);
        return true;
      }
      // 群れから離れすぎた: 急いで戻る
      if (off > H.spacing * 3) {
        setMood(m, 'regroup');
        return true;
      }
      if (h.goal) {
        const moved = walk(m, h.goal.x, h.goal.z, GRAZE_SPEED, 0.6, ctx, avoid);
        if ((moved >= 0 && moved < 1e-4) || Math.hypot(h.goal.x - m.pos.x, h.goal.z - m.pos.z) < 0.3) {
          h.goal = null;
          h.idle = roll(g.rng, GRAZE_IDLE);
        }
      } else if (h.idle > 0) h.idle--;
      else {
        // 次に食べる所: 自分の場所の近く
        h.goal = { x: sx + (g.rng.next() - 0.5) * H.spacing, z: sz + (g.rng.next() - 0.5) * H.spacing };
      }
      return true;
    }
    default:
      return true;
  }
}

/** 群れの居るエリア（フィールドでなければ null）。生きている仲間の多いエリア */
export function herdArea(g: HerdGroup, areas: readonly FieldAreaDef[] | undefined, ctx: SimCtx): FieldAreaDef | null {
  if (!areas) return null;
  const alive = livingMembers(g);
  if (alive.length === 0) return null;
  const counts = new Map<AreaGeom, number>();
  for (const m of alive) {
    const a = ctx.world.areaAt(m.pos.x, m.pos.z);
    counts.set(a, (counts.get(a) ?? 0) + 1);
  }
  let best: AreaGeom | null = null;
  let bn = 0;
  for (const [a, n] of counts) if (n > bn) [best, bn] = [a, n];
  return (areas.find((a) => a === best) as FieldAreaDef | undefined) ?? null;
}

/** 見た目用: 頭を下げて食べている（立ち止まっている間） */
export function isGrazing(m: MonsterState): boolean {
  const h = m.herd;
  return !!h && h.mood === 'graze' && !h.goal && h.idle > 0;
}

/** 見た目用: 顔を上げて見ている */
export function isWatching(m: MonsterState): boolean {
  const h = m.herd;
  return !!h && (h.mood === 'alert' || h.mood === 'hide' || h.mood === 'fight');
}
