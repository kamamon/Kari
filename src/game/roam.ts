// 大型モンスターの移動と休息（フィールドのエリアを渡り歩く。v0.11.0、docs/spec.md 18 章）。計算だけ。
// エリアは 1 つの座標の中に離して置いてあるので、モンスターは、誰も見ていないエリアでも、同じ処理で出口まで歩いて次のエリアへ移る。
import { DEG, angleDiff, forwardOf, turnToward, yawOf } from '../core/math';
import type { FieldDef, FieldExit } from '../data/schemas';
import type { MonsterState } from './monster';
import type { SimCtx } from './player';

/** stay = そのエリアに居る（ふつうに戦う）/ leave = 出口へ歩いている（戦わない）/ sleep = 巣で眠っている */
export interface RoamState {
  areaId: string;
  state: 'stay' | 'leave' | 'sleep';
  /** stay の残り、または sleep の残り */
  ticks: number;
  /** leave の時に向かっている出口 */
  via: FieldExit | null;
  /** 巡る順番（routes の roam）の、いま向かっている番号 */
  routeIndex: number;
  /** 弱って、巣へ向かっている */
  limping: boolean;
  /** 気づいていない間の、ぶらつき: 向かっている場所（無ければ立ち止まっている）と、立ち止まる残り */
  wander: { x: number; z: number } | null;
  idle: number;
  /** 気づいた相手が、同じエリアに居ない時間（長くなると、見失う） */
  lost: number;
}

/** 出口へ歩き出してから、これだけ経っても着かなければ、そのまま次のエリアへ移る（何かに引っかかって、いつまでも動けないことを避ける） */
const LEAVE_TIMEOUT_TICKS = 5400;

/** from から to へ、大型が通れる出口だけを使って行く時の、最初の出口。行けなければ null。 */
export function nextHop(field: FieldDef, from: string, to: string): FieldExit | null {
  if (from === to) return null;
  const areas = new Map(field.areas.map((a) => [a.id, a]));
  const first = new Map<string, FieldExit>();
  const queue: string[] = [from];
  const seen = new Set([from]);
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const e of areas.get(id)?.exits ?? []) {
      if (!e.large || seen.has(e.to)) continue;
      seen.add(e.to);
      first.set(e.to, id === from ? e : first.get(id)!);
      if (e.to === to) return first.get(to)!;
      queue.push(e.to);
    }
  }
  return null;
}

export function createRoam(field: FieldDef, monsterId: string, ctx: SimCtx): RoamState | null {
  const route = field.routes[monsterId];
  if (!route) return null;
  const [lo, hi] = field.roam.stayTicks;
  return { areaId: route.start, state: 'stay', ticks: lo + ctx.rng.int(hi - lo + 1), via: null, routeIndex: Math.max(0, route.roam.indexOf(route.start)), limping: false, wander: null, idle: 120 + ctx.rng.int(240), lost: 0 };
}

/** 眠りから起こす（攻撃された時と、眠り終えた時）。 */
export function wakeMonster(m: MonsterState, ctx: SimCtx, byHit: boolean): void {
  if (!m.roam || !m.asleep) return;
  m.asleep = false;
  m.roam.state = 'stay';
  m.roam.ticks = ctx.field?.roam.wakeStayTicks ?? 1800;
  // 眠り終えて起きたら、もう巣へ向かう理由は無い（また弱れば、また向かう）。
  // 攻撃されて起きた時は、弱ったままなので、しばらく戦った後、また眠る
  if (!byHit) m.roam.limping = false;
  ctx.emit({ type: 'monster_wake', target: m.id, byHit });
}

/**
 * (tx, tz) へ向かう時の向き。まっすぐ行くと岩に当たるなら、いちばん手前の岩の脇を目指す。
 * 脇がエリアの外になる側は選ばない。
 */
export function headingTo(m: MonsterState, tx: number, tz: number, ctx: SimCtx): number {
  const dx = tx - m.pos.x, dz = tz - m.pos.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-6) return m.yaw;
  const ux = dx / dist, uz = dz / dist;
  const area = ctx.world.areaAt(m.pos.x, m.pos.z);
  let near: { t: number; lat: number; x: number; z: number; clear: number } | null = null;
  for (const c of area.rocks) {
    const rx = c.x - m.pos.x, rz = c.z - m.pos.z;
    const t = rx * ux + rz * uz;
    if (t <= 0 || t >= dist) continue;
    const lat = rz * ux - rx * uz;
    const clear = c.r + m.def.bodyRadius + 0.6;
    if (Math.abs(lat) >= clear) continue;
    if (!near || t < near.t) near = { t, lat, x: c.x, z: c.z, clear };
  }
  if (!near) return yawOf(dx, dz);
  const b = area.bounds;
  const pad = m.def.bodyRadius + 0.2;
  const side = (s: number): { x: number; z: number; ok: boolean } => {
    const x = near!.x - uz * s * (near!.clear + 0.8), z = near!.z + ux * s * (near!.clear + 0.8);
    return { x, z, ok: x >= b.minX + pad && x <= b.maxX - pad && z >= b.minZ + pad && z <= b.maxZ - pad };
  };
  // 岩が進む向きの左にあれば右へ、右にあれば左へ
  let w = side(near.lat >= 0 ? -1 : 1);
  if (!w.ok) {
    const o = side(near.lat >= 0 ? 1 : -1);
    if (o.ok) w = o;
  }
  return yawOf(w.x - m.pos.x, w.z - m.pos.z);
}

/** 気づいていない間、エリアの中をゆっくり歩いては立ち止まる。 */
function wander(m: MonsterState, ctx: SimCtx): void {
  const r = m.roam!;
  const R = ctx.field!.roam;
  if (!r.wander) {
    if (r.idle > 0) {
      r.idle--;
      return;
    }
    const b = ctx.world.areaAt(m.pos.x, m.pos.z).bounds;
    const inset = Math.min(R.wanderInset, (b.maxX - b.minX) / 3, (b.maxZ - b.minZ) / 3);
    r.wander = { x: b.minX + inset + ctx.rng.next() * (b.maxX - b.minX - inset * 2), z: b.minZ + inset + ctx.rng.next() * (b.maxZ - b.minZ - inset * 2) };
  }
  const dx = r.wander.x - m.pos.x, dz = r.wander.z - m.pos.z;
  const want = headingTo(m, r.wander.x, r.wander.z, ctx);
  m.yaw = turnToward(m.yaw, want, (m.def.turnDegPerSec * 0.6 * DEG) / 60);
  let moved = 0;
  if (Math.abs(angleDiff(m.yaw, want)) < 50 * DEG) {
    const step = ((m.def.moveSpeed ?? 3) * R.wanderSpeedScale) / 60;
    const f = forwardOf(m.yaw);
    const x0 = m.pos.x, z0 = m.pos.z;
    ctx.world.move(m.pos, m.def.bodyRadius, f.x * step, f.z * step);
    moved = Math.hypot(m.pos.x - x0, m.pos.z - z0);
    // 高い段などに当たって進めないなら、そこで立ち止まる
    if (moved < step * 0.3) r.wander = null;
  }
  if (r.wander && Math.hypot(dx, dz) <= m.def.bodyRadius + 1.5) r.wander = null;
  if (!r.wander) {
    const [lo, hi] = R.wanderIdleTicks;
    r.idle = lo + ctx.rng.int(hi - lo + 1);
  }
}

/** 巣の寝床（エリアの中央）へ、弱った足取りで歩く。着いたら true。 */
function walkToBed(m: MonsterState, ctx: SimCtx): boolean {
  const b = ctx.world.areaAt(m.pos.x, m.pos.z).bounds;
  const bx = (b.minX + b.maxX) / 2, bz = (b.minZ + b.maxZ) / 2;
  if (Math.hypot(bx - m.pos.x, bz - m.pos.z) <= m.def.bodyRadius + 1) return true;
  const want = headingTo(m, bx, bz, ctx);
  m.yaw = turnToward(m.yaw, want, (m.def.turnDegPerSec * DEG) / 60);
  if (Math.abs(angleDiff(m.yaw, want)) < 70 * DEG) {
    const step = ((m.def.moveSpeed ?? 3) * ctx.field!.roam.limpSpeedScale) / 60;
    const f = forwardOf(m.yaw);
    ctx.world.move(m.pos, m.def.bodyRadius, f.x * step, f.z * step);
  }
  return false;
}

/**
 * 移動と休息を 1 tick 進める。true を返した tick は、モンスターはほかのこと（気づく・向く・技を選ぶ）をしない。
 * 技の途中で立ち去り始めることは無い（いまの技が終わってから歩き出す）。
 */
export function stepRoam(m: MonsterState, playerHere: boolean, ctx: SimCtx): boolean {
  const field = ctx.field;
  const r = m.roam;
  if (!field || !r) return false;
  const R = field.roam;
  const route = field.routes[m.def.id]!;
  // 段を降りたら、地面の高さへ戻す
  m.pos.y = ctx.world.groundHeight(m.pos.x, m.pos.z);
  // 気づいた相手が別のエリアへ行ったまま戻らなければ、見失う（戻ってきた時に、また気づく所から始まる）
  if (m.aware && !playerHere) {
    if (++r.lost >= R.loseSightTicks && !m.action) {
      m.aware = false;
      r.lost = 0;
      ctx.emit({ type: 'monster_lost', target: m.id });
    }
  } else r.lost = 0;

  if (r.state === 'sleep') {
    r.ticks--;
    const cap = Math.round(m.def.hp * R.sleepHealCap);
    if (m.hp < cap && r.ticks % 60 === 0) m.hp = Math.min(cap, m.hp + Math.max(1, Math.round(m.def.hp * R.sleepHealPerSec)));
    if (r.ticks <= 0) wakeMonster(m, ctx, false);
    return true;
  }

  const weak = m.hp <= m.def.hp * R.limpHpRatio;
  if (r.state === 'stay') {
    if (weak && !r.limping) {
      // 弱ったら、巣へ向かう。巣に居るなら、少しして眠る
      r.limping = true;
      r.ticks = Math.min(r.ticks, 180);
    }
    if (r.ticks > 0) {
      r.ticks--;
      if (!m.aware && !m.action) {
        // 弱って巣に着いたら、寝床（巣の中央）まで歩いて、着いたらすぐ眠る。それ以外は、ぶらつく
        if (r.limping && r.areaId === route.nest) {
          if (walkToBed(m, ctx)) r.ticks = 0;
        } else wander(m, ctx);
      }
      if (r.ticks > 0) return false;
    }
    if (m.action) return false;
    if (r.limping && r.areaId === route.nest) {
      r.state = 'sleep';
      r.ticks = R.sleepTicks;
      m.asleep = true;
      m.aware = false;
      ctx.emit({ type: 'monster_sleep', target: m.id, areaId: r.areaId });
      return true;
    }
    let dest = route.nest;
    if (!r.limping) {
      // 目当てのエリアに着いていたら、次のエリアへ。途中のエリアなら、そのまま目当てへ向かう
      if (r.areaId === route.roam[r.routeIndex]) r.routeIndex = (r.routeIndex + 1) % route.roam.length;
      dest = route.roam[r.routeIndex]!;
    }
    const via = nextHop(field, r.areaId, dest);
    if (!via) {
      r.ticks = 600;
      return false;
    }
    r.state = 'leave';
    r.via = via;
    r.wander = null;
    r.ticks = 0;
    ctx.emit({ type: 'monster_leave', target: m.id, from: r.areaId, to: via.to });
  }

  // leave: 出口へ歩く
  if (m.action) return false;
  const via = r.via!;
  const dx = via.x - m.pos.x, dz = via.z - m.pos.z;
  if (Math.hypot(dx, dz) <= m.def.bodyRadius + 2.5 || ++r.ticks >= LEAVE_TIMEOUT_TICKS) {
    const a = via.arriveLarge ?? via.arrive;
    m.pos = { x: a.x, y: 0, z: a.z };
    m.prevPos = { ...m.pos };
    m.yaw = a.yaw;
    m.prevYaw = a.yaw;
    m.aware = false;
    m.cooldown = 0;
    r.lost = 0;
    r.idle = 60 + ctx.rng.int(120);
    r.areaId = via.to;
    r.via = null;
    r.state = 'stay';
    const [lo, hi] = R.stayTicks;
    // 巣に着いたら、少しして眠る。目当てのエリアに着いたら、しばらく居る。途中のエリアは、少し立ち止まって通り抜ける
    // （巣では、寝床まで歩いて眠る。気づいて戦いになった時は、この時間が過ぎてから、その場で眠る）
    if (r.limping) r.ticks = r.areaId === route.nest ? 1500 : 60;
    else r.ticks = r.areaId === route.roam[r.routeIndex] ? lo + ctx.rng.int(hi - lo + 1) : 90;
    ctx.emit({ type: 'monster_move', target: m.id, areaId: r.areaId });
    return true;
  }
  const want = headingTo(m, via.x, via.z, ctx);
  m.yaw = turnToward(m.yaw, want, (m.def.turnDegPerSec * DEG) / 60);
  if (Math.abs(angleDiff(m.yaw, want)) < 70 * DEG) {
    const step = ((m.def.moveSpeed ?? 3) * (r.limping ? R.limpSpeedScale : R.walkSpeedScale)) / 60;
    const f = forwardOf(m.yaw);
    ctx.world.move(m.pos, m.def.bodyRadius, f.x * step, f.z * step);
  }
  return true;
}
