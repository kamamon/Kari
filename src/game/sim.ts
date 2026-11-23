// simulation 本体。60Hz 固定 tick で step() を 1 回ずつ呼ぶ。
// ここは DOM・Three.js・Math.random・現在時刻に触れない。同じ seed と同じ入力列なら同じ結果になる。
import { DEG, angleDiff, forwardOf, toWorld, yawOf, type V3 } from '../core/math';
import { SeededRng } from '../core/seededRng';
import type { Content, DamageType, HazardDef, HitWindowDef, ItemDef, ItemStack, LootRoll, QuestDef, ShootDef } from '../data/schemas';
import { inWindow, type ActionRun } from './action';
import { HitLedger, computeDamage, sweepCapsule, type WorldShape } from './combat';
import type { SimEvent } from './events';
import { Btn, type InputFrame } from './inputFrame';
import { applyDamageToMonster, createMonster, monsterBlockers, monsterShapes, stepMonster, type MonsterState } from './monster';
import { createPlayer, familyOf, playerHurtCapsule, resolveIncomingHit, stepPlayer, weaponOf, type PlayerState, type SimCtx } from './player';
import { trackSegment } from './tracks';
import { World, type Circle } from './world';

export interface SimOptions {
  seed: number;
  mapId: string;
  weaponId: string;
  monsterId: string | null;
  monsterAttacks: boolean;
  /** 依頼。指定すると、マップ・標的・制限時間・力尽き回数は依頼の定義から決まる。 */
  questId?: string | null;
}

/** 落下物など、位置が固定された判定。warn が 0 になった後、active の間だけ当たる。 */
export interface Hazard {
  id: number;
  x: number;
  z: number;
  radius: number;
  warn: number;
  warnTotal: number;
  active: number;
  baseDamage: number;
  reaction: 'flinch' | 'knockdown';
  hit: boolean;
  /** 岩が打ち上がった場所（見た目用。ここから弧を描いて (x, z) へ落ちる）。null は真上から。 */
  from: V3 | null;
  peak: number;
}

export type HuntReason = 'slay' | 'capture' | 'time' | 'faints' | 'retire';

/** 仕掛けた罠。arming → armed（大型が踏むと作動）→ holding（止めている間）。 */
export interface Trap {
  id: number;
  x: number;
  z: number;
  radius: number;
  holdTicks: number;
  arm: number;
  life: number;
  state: 'arming' | 'armed' | 'holding';
  target: string | null;
}

/** 手に入れたもの 1 個。source は carve / severed:<部位> / break:<部位> / capture / quest */
export interface LootGain {
  itemId: string;
  source: string;
}

/**
 * 狩猟の進行。phase が active 以外になったら成否は終端で、以後は変わらない。
 * 達成した後は、拠点へ戻るまでの時間（returnTicks）だけ剥ぎ取りができ、その後 closed になる。
 * 報酬（rewards）は closed になった時に一度だけ確定し、以後は何も変わらない。
 */
export interface HuntState {
  quest: QuestDef;
  phase: 'active' | 'success' | 'failed';
  reason: HuntReason | null;
  ticks: number;
  faints: number;
  endTick: number;
  returnTicks: number;
  /** 剥ぎ取りの残り回数。'body'（本体）と、切り落とした部位の id */
  carves: Record<string, number>;
  loot: LootGain[];
  closed: boolean;
  closeTick: number;
  rewards: { money: number; items: ItemStack[] } | null;
}

/** 達成後、剥ぎ取りを使い切ってから結果が閉じるまでの間 */
const CLOSE_AFTER_LAST_CARVE = 150;
/** 捕獲した時に、結果が閉じるまでの時間 */
const CAPTURE_RETURN_TICKS = 300;
/** 罠を置く位置（足元から前へ）と、大型の中心がこれだけ罠の縁に近づくと作動する距離 */
const TRAP_AHEAD = 0.9;
const TRAP_REACH = 0.9;
/** 剥ぎ取りができる距離（本体は胴の半径に足す / 切り落とした部位） */
const CARVE_REACH = 1.4;
const CARVE_PIECE_REACH = 1.7;

export interface HitRecord {
  tick: number;
  actionId: string;
  windowId: string;
  actionTick: number;
  partId: string;
  damage: number;
  crit: number;
}

/** 飛んでいる矢（環弓）。まっすぐ飛び、最初に触れた部位に当たって消える。 */
export interface Projectile {
  id: number;
  pos: V3;
  prevPos: V3;
  /** 1 tick ぶんの移動 */
  vel: V3;
  /** 残りの寿命（tick） */
  life: number;
  /** 飛んだ距離 (m)。適正距離の倍率に使う。 */
  travelled: number;
  actionId: string;
  coefficient: number;
  level: number;
}

/** 矢の適正距離: 6〜12m で威力そのまま。近すぎ・遠すぎは下がる。 */
export function arrowDistanceScale(d: number): number {
  if (d < 4) return 0.6;
  if (d < 6) return 0.6 + (0.4 * (d - 4)) / 2;
  if (d <= 12) return 1;
  if (d < 16) return 1 - (0.5 * (d - 12)) / 4;
  return 0.5;
}

const ARROW_RADIUS = 0.1;
const ARROW_LIFE_TICKS = 70;
/** 狙いの補助: 正面からこの角度までにある部位へ、矢の向きを合わせる */
const AIM_ASSIST_DEG = 14;
const AIM_RANGE = 28;

export class Simulation implements SimCtx {
  readonly content: Content;
  readonly world: World;
  readonly rng: SeededRng;
  readonly options: SimOptions;
  tick = 0;
  player: PlayerState;
  monsters: MonsterState[] = [];
  readonly ledger = new HitLedger();
  private events: SimEvent[] = [];
  private nextInstance = 1;
  /** 検証用の累計 */
  totalDamage = 0;
  hitCount = 0;
  /** プレイヤーが受けた累計ダメージ（防御の削りも含む） */
  damageTaken = 0;
  recentHits: HitRecord[] = [];
  questModifier = 1;
  /** 依頼ごとの、モンスターの攻撃・落石のダメージ倍率 */
  monsterAttackScale = 1;
  hazards: Hazard[] = [];
  private nextHazard = 1;
  hunt: HuntState | null = null;
  traps: Trap[] = [];
  private nextTrap = 1;
  /** 切り落とした部位が落ちた位置（部位 id ごと）。剥ぎ取りの場所になる。 */
  severedAt: Record<string, { x: number; z: number }> = {};
  projectiles: Projectile[] = [];
  private nextProjectile = 1;

  constructor(content: Content, options: SimOptions) {
    this.content = content;
    this.options = options;
    const quest = options.questId ? content.quests.get(options.questId) : undefined;
    if (options.questId && !quest) throw new Error(`quest ${options.questId} が無い`);
    const map = content.maps.get(quest ? quest.mapId : options.mapId);
    if (!map) throw new Error(`map ${options.mapId} が無い`);
    if (!content.weapons.has(options.weaponId)) throw new Error(`weapon ${options.weaponId} が無い`);
    this.world = new World(map);
    this.rng = new SeededRng(options.seed);
    this.player = createPlayer(content, map.spawn, options.weaponId, quest?.supplies ?? []);
    const monsterId = quest ? quest.targetMonsterId : options.monsterId;
    if (monsterId) {
      const def = content.monsters.get(monsterId);
      if (!def) throw new Error(`monster ${monsterId} が無い`);
      const m = createMonster(def, quest ? quest.monsterSpawn : map.monsterSpawn, 'monster#1');
      m.aiEnabled = quest ? true : options.monsterAttacks;
      this.monsters.push(m);
    }
    if (quest) {
      this.hunt = { quest, phase: 'active', reason: null, ticks: 0, faints: 0, endTick: 0, returnTicks: 0, carves: {}, loot: [], closed: false, closeTick: 0, rewards: null };
      this.monsterAttackScale = quest.monsterAttackScale ?? 1;
    }
  }

  emit(ev: SimEvent): void {
    if (ev.type === 'player_hurt' || ev.type === 'guard' || ev.type === 'guard_break') this.damageTaken += ev.damage;
    if (ev.type === 'player_dead' && this.hunt?.phase === 'active') this.hunt.faints++;
    if (ev.type === 'part_sever') this.severedAt[ev.partId] = { x: ev.pos.x, z: ev.pos.z };
    this.events.push(ev);
  }

  newInstanceId(): number {
    return this.nextInstance++;
  }

  blockers(): Circle[] {
    const out: Circle[] = [];
    for (const m of this.monsters) if (!m.dead) out.push(...monsterBlockers(m));
    return out;
  }

  spawnHazards(def: HazardDef, target: V3, origin?: V3): void {
    // 打ち上げた場所から狙った位置へ向かう向き（一列に並べる時に使う）
    const ox = origin?.x ?? target.x, oz = origin?.z ?? target.z;
    const dist = Math.hypot(target.x - ox, target.z - oz);
    const dx = dist > 0.01 ? (target.x - ox) / dist : 0, dz = dist > 0.01 ? (target.z - oz) / dist : 1;
    for (let i = 0; i < def.count; i++) {
      let x = target.x;
      let z = target.z;
      if (def.pattern === 'line') {
        // 手前から奥へ: 狙った位置までの半分から、狙った位置まで。左右へ少しずらす（最後の 1 個は、狙った位置の近くに落ちる）
        const along = dist * (def.count > 1 ? 0.5 + (0.5 * i) / (def.count - 1) : 1);
        const side = (this.rng.next() - 0.5) * 2 * def.spread;
        x = ox + dx * along - dz * side;
        z = oz + dz * along + dx * side;
      } else if (i > 0) {
        // 1 個目は狙った位置、残りはその周りへ散らす。出した時点で位置を固定する（予告後に動かさない）。
        const a = this.rng.next() * Math.PI * 2;
        const r = def.spread * (0.45 + 0.55 * this.rng.next());
        x += Math.cos(a) * r;
        z += Math.sin(a) * r;
      }
      const h: Hazard = {
        id: this.nextHazard++, x, z, radius: def.radius, warn: def.warnTicks, warnTotal: def.warnTicks, active: def.activeTicks, baseDamage: def.baseDamage, reaction: def.reaction, hit: false,
        from: origin ? { x: origin.x, y: origin.y, z: origin.z } : null, peak: def.peak ?? 6,
      };
      this.hazards.push(h);
      this.emit({ type: 'hazard_warn', id: h.id, x, z, radius: h.radius, warnTicks: h.warn });
    }
  }

  private stepHazards(): void {
    if (this.hazards.length === 0) return;
    const p = this.player;
    for (const h of this.hazards) {
      if (h.warn > 0) {
        h.warn--;
        if (h.warn === 0) this.emit({ type: 'hazard_impact', id: h.id, x: h.x, z: h.z, radius: h.radius });
        continue;
      }
      h.active--;
      if (h.hit || this.hunt?.phase === 'success' || this.hunt?.phase === 'failed') continue;
      if (Math.hypot(p.pos.x - h.x, p.pos.z - h.z) > h.radius + this.content.player.radius * 0.5) continue;
      const outcome = resolveIncomingHit(p, { attackerPos: { x: h.x, y: 0, z: h.z }, baseDamage: h.baseDamage * this.monsterAttackScale, guardable: false, guardCost: 0, reaction: h.reaction }, this);
      if (outcome !== 'evaded' && outcome !== 'ignored') h.hit = true;
    }
    this.hazards = this.hazards.filter((h) => h.warn > 0 || h.active > 0);
  }

  // ---- 道具 ----

  canUseItem(item: ItemDef): boolean {
    // 回復は依頼の外（訓練場）や達成後でも使える。罠と鎮静玉は狩猟中だけ。罠は同時に 1 つまで。
    if (item.kind === 'heal') return true;
    if (this.hunt?.phase !== 'active') return false;
    return item.kind !== 'trap' || this.traps.length === 0;
  }

  applyItem(item: ItemDef): boolean {
    const p = this.player;
    const pos = { ...p.pos };
    if (item.kind === 'heal') {
      const before = p.hp;
      p.hp = Math.min(this.content.player.maxHp, p.hp + (item.heal ?? 0));
      this.emit({ type: 'item_effect', itemId: item.id, kind: 'heal', ok: true, amount: p.hp - before, pos });
      return true;
    }
    if (!this.canUseItem(item)) {
      this.emit({ type: 'item_effect', itemId: item.id, kind: item.kind, ok: false, amount: 0, pos });
      return false;
    }
    if (item.kind === 'trap') {
      const t = item.trap!;
      const f = forwardOf(p.yaw);
      const trap: Trap = { id: this.nextTrap++, x: p.pos.x + f.x * TRAP_AHEAD, z: p.pos.z + f.z * TRAP_AHEAD, radius: t.radius, holdTicks: t.holdTicks, arm: t.armTicks, life: t.lifeTicks, state: 'arming', target: null };
      this.traps.push(trap);
      this.emit({ type: 'item_effect', itemId: item.id, kind: 'trap', ok: true, amount: 0, pos: { x: trap.x, y: p.pos.y, z: trap.z } });
      return true;
    }
    // 鎮静玉: 正面の範囲に居る、いちばん近い大型に当たる。外しても 1 個減る。
    const q = item.tranq!;
    let best: MonsterState | null = null;
    let bestDist = Infinity;
    for (const m of this.monsters) {
      if (m.dead || m.captured) continue;
      const dx = m.pos.x - p.pos.x, dz = m.pos.z - p.pos.z;
      const dist = Math.max(0, Math.hypot(dx, dz) - m.def.bodyRadius);
      if (dist > q.range || dist >= bestDist) continue;
      if (Math.abs(angleDiff(yawOf(dx, dz), p.yaw)) > q.halfAngleDeg * DEG) continue;
      best = m;
      bestDist = dist;
    }
    if (best && best.def.capture) {
      best.tranq++;
      best.tranqTicks = best.def.capture.tranqDecayTicks;
    }
    const f = forwardOf(p.yaw);
    this.emit({ type: 'item_effect', itemId: item.id, kind: 'tranq', ok: !!best, amount: best ? best.tranq : 0, pos: best ? { x: best.pos.x, y: 1.4, z: best.pos.z } : { x: p.pos.x + f.x * q.range, y: 0.3, z: p.pos.z + f.z * q.range } });
    return true;
  }

  private stepTraps(): void {
    if (this.traps.length === 0) return;
    for (const t of this.traps) {
      if (t.state === 'holding') {
        const m = this.monsters.find((x) => x.id === t.target);
        if (!m || m.dead || m.captured || m.trapTicks <= 0) t.life = 0;
        continue;
      }
      t.life--;
      if (t.state === 'arming') {
        if (--t.arm > 0) continue;
        t.state = 'armed';
        this.emit({ type: 'trap_armed', id: t.id, x: t.x, z: t.z });
      }
      for (const m of this.monsters) {
        if (m.dead || m.captured || m.trapTicks > 0) continue;
        if (Math.hypot(m.pos.x - t.x, m.pos.z - t.z) > t.radius + TRAP_REACH) continue;
        // 2 回目からは慣れて、止まる時間が 6 割ずつになる
        m.trapTicks = Math.max(60, Math.round(t.holdTicks * Math.pow(0.6, m.trapCount)));
        m.trapCount++;
        m.action = null;
        m.attackEval = null;
        t.state = 'holding';
        t.target = m.id;
        this.emit({ type: 'trap_trigger', id: t.id, target: m.id, x: t.x, z: t.z, ticks: m.trapTicks });
        break;
      }
    }
    for (const t of this.traps) if (t.life <= 0) this.emit({ type: 'trap_end', id: t.id });
    this.traps = this.traps.filter((t) => t.life > 0);
  }

  /**
   * 捕獲。捕獲できる相手が、弱っていて、罠にかかっていて、鎮静玉が必要な数たまっている時に成立する。
   * 死亡（終端）はこの前に確定しているので、同じ tick に倒していたら捕獲にはならない。
   */
  private stepCapture(): void {
    const h = this.hunt;
    if (!h || h.phase !== 'active' || h.quest.kind !== 'hunt') return;
    for (const m of this.monsters) {
      const c = m.def.capture;
      if (m.dead || m.captured || !m.def.captureAllowed || !c) continue;
      if (m.hp > m.def.hp * c.hpRatio || m.trapTicks <= 0 || m.tranq < c.tranqNeeded) continue;
      m.captured = true;
      m.action = null;
      m.attackEval = null;
      m.staggerTicks = 0;
      m.staggerKind = null;
      m.enraged = false;
      this.emit({ type: 'monster_captured', target: m.id });
    }
  }

  // ---- 素材 ----

  private roll(r: LootRoll, source: string, h: HuntState): void {
    let total = 0;
    for (const e of r.table) total += e.weight;
    for (let i = 0; i < r.count; i++) h.loot.push({ itemId: this.pick(r, total), source });
  }

  private pick(r: LootRoll, total: number): string {
    let x = this.rng.next() * total;
    for (const e of r.table) {
      x -= e.weight;
      if (x < 0) return e.itemId;
    }
    return r.table[r.table.length - 1]!.itemId;
  }

  carveTarget(): string | null {
    const h = this.hunt;
    const m = this.monsters[0];
    if (!h || h.phase !== 'success' || h.closed || !m) return null;
    const p = this.player;
    if ((h.carves.body ?? 0) > 0 && Math.hypot(p.pos.x - m.pos.x, p.pos.z - m.pos.z) <= m.def.bodyRadius + CARVE_REACH) return 'body';
    for (const [partId, at] of Object.entries(this.severedAt)) {
      if ((h.carves[partId] ?? 0) > 0 && Math.hypot(p.pos.x - at.x, p.pos.z - at.z) <= CARVE_PIECE_REACH) return partId;
    }
    return null;
  }

  carve(source: string): void {
    const h = this.hunt;
    const m = this.monsters[0];
    const loot = m?.def.lootId ? this.content.loot.get(m.def.lootId) : undefined;
    if (!h || h.closed || !loot || !((h.carves[source] ?? 0) > 0)) return;
    const table = source === 'body' ? loot.carve : loot.severed?.[source];
    if (!table) return;
    h.carves[source]!--;
    let total = 0;
    for (const e of table.table) total += e.weight;
    const itemId = this.pick(table, total);
    const tag = source === 'body' ? 'carve' : `severed:${source}`;
    h.loot.push({ itemId, source: tag });
    this.emit({ type: 'carve', itemId, source: tag, pos: { ...this.player.pos } });
  }

  /** 結果を閉じる。報酬はここで一度だけ確定する。 */
  private closeHunt(h: HuntState): void {
    if (h.closed) return;
    h.closed = true;
    h.closeTick = this.tick;
    h.returnTicks = 0;
    if (h.phase === 'success') {
      for (const s of h.quest.rewards?.items ?? []) for (let i = 0; i < s.count; i++) h.loot.push({ itemId: s.itemId, source: 'quest' });
      const count = new Map<string, number>();
      for (const g of h.loot) count.set(g.itemId, (count.get(g.itemId) ?? 0) + 1);
      h.rewards = { money: h.quest.rewards?.money ?? 0, items: [...count].map(([itemId, n]) => ({ itemId, count: n })) };
    } else {
      // 失敗・リタイアでは報酬も素材も出ない
      h.loot = [];
      h.rewards = { money: 0, items: [] };
    }
    this.emit({ type: 'hunt_close' });
  }

  /**
   * 狩猟の成否。同じ tick に重なった時は 討伐 → 捕獲 → リタイア → 力尽き → 時間切れ の順で先に確定する。
   * 達成した後は、拠点へ戻るまでの間だけ剥ぎ取りができる。
   */
  private stepHunt(input: InputFrame): void {
    const h = this.hunt;
    if (!h || h.closed) return;
    if (h.phase === 'success') {
      // 帰還: 時間切れ / リタイアのボタン（達成後は「帰還する」）/ 剥ぎ取りを使い切った少し後
      h.returnTicks--;
      const left = Object.values(h.carves).reduce((a, b) => a + b, 0);
      if (left === 0 && !this.player.carving && h.returnTicks > CLOSE_AFTER_LAST_CARVE) h.returnTicks = CLOSE_AFTER_LAST_CARVE;
      if (h.returnTicks <= 0 || input.pressed & Btn.Retire) this.closeHunt(h);
      return;
    }
    h.ticks++;
    const end = (phase: 'success' | 'failed', reason: HuntReason): void => {
      h.phase = phase;
      h.reason = reason;
      h.endTick = this.tick;
      for (const m of this.monsters) m.aiEnabled = false;
      this.emit({ type: 'hunt_end', phase, reason });
      if (phase === 'failed') return this.closeHunt(h);
      const m = this.monsters[0];
      const loot = m?.def.lootId ? this.content.loot.get(m.def.lootId) : undefined;
      if (m && loot) {
        // 壊した部位の追加は、達成した時点で確定する
        m.def.parts.forEach((d, i) => {
          const r = loot.breaks?.[d.id];
          if (r && m.parts[i]!.broken) this.roll(r, `break:${d.id}`, h);
        });
        if (reason === 'capture') this.roll(loot.capture, 'capture', h);
        else {
          h.carves.body = loot.carve.count;
          m.def.parts.forEach((d, i) => {
            const r = loot.severed?.[d.id];
            if (r && m.parts[i]!.severed && this.severedAt[d.id]) h.carves[d.id] = r.count;
          });
        }
      }
      h.returnTicks = reason === 'capture' ? CAPTURE_RETURN_TICKS : h.quest.returnTicks ?? 3600;
    };
    if (this.monsters[0]?.dead) end('success', 'slay');
    else if (this.monsters[0]?.captured) end('success', 'capture');
    else if (input.pressed & Btn.Retire) end('failed', 'retire');
    else if (h.faints >= h.quest.maxFaints) end('failed', 'faints');
    else if (h.ticks >= h.quest.timeLimitTicks) end('failed', 'time');
  }

  /** たまった出来事を取り出す（描画・音・UI が毎フレーム呼ぶ）。 */
  drainEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  step(input: InputFrame): void {
    this.tick++;
    stepPlayer(this.player, input, this);
    for (const m of this.monsters) stepMonster(m, this.player, this);
    // 歩いてきた大型に重なったら押し出す（プレイヤーが動いていなくても胴を抜けない）
    if (this.player.mode !== 'dead') this.world.move(this.player.pos, this.content.player.radius, 0, 0, this.blockers());
    this.resolvePlayerAttacks();
    this.stepProjectiles();
    if (this.hunt?.phase !== 'success' && this.hunt?.phase !== 'failed') this.resolveMonsterAttacks();
    this.stepHazards();
    this.stepTraps();
    this.stepCapture();
    this.stepHunt(input);
    const active = new Set<number>();
    if (this.player.action) active.add(this.player.action.instanceId);
    if (this.player.attackEval) active.add(this.player.attackEval.run.instanceId);
    for (const m of this.monsters) if (m.action) active.add(m.action.instanceId);
    this.ledger.prune(active);
  }

  /** hitWindow の武器カプセルを「この tick の始点 → 終点」で返す（ワールド座標）。 */
  private windowSweep(hw: HitWindowDef, t: number, pos: V3, yaw: number, pos0: V3 = pos, yaw0: number = yaw): { a0: V3; b0: V3; a1: V3; b1: V3; r: number } {
    const tr = this.content.tracks.get(hw.shapeTrack)!;
    const s0 = trackSegment(tr, t);
    const s1 = trackSegment(tr, t + 1);
    return {
      a0: toWorld(s0.a, pos0, yaw0),
      b0: toWorld(s0.b, pos0, yaw0),
      a1: toWorld(s1.a, pos, yaw),
      b1: toWorld(s1.b, pos, yaw),
      r: tr.radius,
    };
  }

  private resolvePlayerAttacks(): void {
    const p = this.player;
    const ev = p.attackEval;
    if (!ev) return;
    const { run, t } = ev;
    for (const hw of run.def.hitWindows) {
      if (!inWindow(t, hw)) continue;
      // 体ごと回る技（spin。v0.5.0 の時点では使う技が無い）は、前の tick の向きから掃引する（1 tick で大きく回っても、間を飛び越えない）
      const sw = run.def.spin ? this.windowSweep(hw, t, p.pos, p.yaw, p.prevPos, p.prevYaw) : this.windowSweep(hw, t, p.pos, p.yaw);
      for (const m of this.monsters) {
        if (m.dead || m.captured) continue;
        if (this.ledger.count(run.instanceId, hw.id, m.id) >= hw.maxHitsPerTarget) continue;
        // 同じ group の別の形（1 本の武器の刃と柄など。v0.5.0 の時点では使う技が無い）が先に当たっていたら、この形は当てない
        if (hw.group && this.ledger.count(run.instanceId, `group:${hw.group}`, m.id) > 0) continue;
        const hit = sweepCapsule(sw.a0, sw.b0, sw.a1, sw.b1, sw.r, monsterShapes(m));
        if (!hit) continue;
        this.ledger.record(run.instanceId, hw.id, m.id);
        if (hw.group) this.ledger.record(run.instanceId, `group:${hw.group}`, m.id);
        this.applyPlayerHit(run, hw, t, m, hit.partIndex, hit.point);
      }
    }
  }

  private applyPlayerHit(run: ActionRun, hw: HitWindowDef, t: number, m: MonsterState, partIndex: number, point: V3): void {
    const charge = run.def.charge;
    let scale = charge ? charge.coefficientScale[run.chargeLevel] ?? 1 : 1;
    // 勢い（双剣）: 始めた時の段階で威力が変わる。大技は、使った段階の倍率になる。
    const M = familyOf(this.player, this.content).momentum;
    const mo = run.def.momentum;
    if (M && mo) scale *= mo.spendScale ? mo.spendScale[run.momentumLevel] ?? 1 : M.damageScale[run.momentumLevel] ?? 1;
    const hitstop = hw.hitstopTicks + (charge ? charge.hitstopBonus[run.chargeLevel] ?? 0 : 0);
    run.hitstop = hitstop;
    this.dealPlayerDamage(m, partIndex, point, { actionId: run.def.actionId, windowId: hw.id, actionTick: t, motion: hw.damageCoefficient * scale, elementMotion: hw.elementCoefficient ?? 1, damageType: hw.damageType, hitstop, chargeLevel: run.chargeLevel });
    if (M && mo?.gain && !run.momentumGained) {
      run.momentumGained = true;
      const p = this.player;
      p.momentumTicks = 0;
      if (p.momentum < M.max) {
        p.momentum++;
        this.emit({ type: 'momentum', level: p.momentum });
      }
    }
  }

  /** プレイヤーの攻撃（武器・矢）が部位に当たった時の、ダメージの計算と記録。 */
  private dealPlayerDamage(
    m: MonsterState,
    partIndex: number,
    point: V3,
    h: { actionId: string; windowId: string; actionTick: number; motion: number; elementMotion: number; damageType: DamageType; hitstop: number; chargeLevel: number },
  ): void {
    const weapon = weaponOf(this.player, this.content);
    const part = m.def.parts[partIndex]!;
    // 会心は seed 付き乱数。1 命中につき必ず 1 回引き、乱数列を入力だけで決まるようにする。
    const roll = this.rng.next() * 100;
    const T = this.content.player;
    let crit = 0;
    if (weapon.affinity > 0 && roll < weapon.affinity) crit = 1;
    else if (weapon.affinity < 0 && roll < -weapon.affinity) crit = -1;
    const damage = computeDamage({
      attack: weapon.attack,
      motion: h.motion,
      sharpness: weapon.sharpnessModifier,
      hitzone: (m.parts[partIndex]!.broken && part.brokenHitzone ? part.brokenHitzone : part.hitzone)[h.damageType],
      crit: crit > 0 ? T.critMultiplier : crit < 0 ? 0.75 : 1,
      element: weapon.element.value,
      elementMotion: h.elementMotion,
      elementZone: part.elementZone,
      questModifier: this.questModifier,
    });
    m.hitstop = h.hitstop;
    this.totalDamage += damage;
    this.hitCount++;
    this.recentHits.push({ tick: this.tick, actionId: h.actionId, windowId: h.windowId, actionTick: h.actionTick, partId: part.id, damage, crit });
    if (this.recentHits.length > 8) this.recentHits.shift();
    this.emit({
      type: 'hit',
      attacker: this.player.id,
      target: m.id,
      actionId: h.actionId,
      windowId: h.windowId,
      partId: part.id,
      partIndex,
      damage,
      crit,
      pos: point,
      material: part.material,
      hitstop: h.hitstop,
      chargeLevel: h.chargeLevel,
      tick: this.tick,
    });
    applyDamageToMonster(m, partIndex, damage, h.damageType, this);
  }

  /**
   * 矢を放つ（環弓）。向きは体の向き。正面の近くに部位があれば、いちばん近いものへ向きと高さを合わせる（狙いの補助）。
   * 何も無ければ、胸の高さから水平に飛ぶ。
   */
  spawnProjectiles(spec: ShootDef, run: ActionRun): void {
    const p = this.player;
    const level = Math.min(run.chargeLevel, spec.speed.length - 1);
    const from: V3 = { x: p.pos.x + Math.sin(p.yaw) * 0.5, y: p.pos.y + 1.35, z: p.pos.z + Math.cos(p.yaw) * 0.5 };
    let yaw = p.yaw;
    let pitch = 0;
    let best = Infinity;
    for (const m of this.monsters) {
      if (m.dead || m.captured) continue;
      for (const s of monsterShapes(m)) {
        const c = s.b ? { x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2, z: (s.a.z + s.b.z) / 2 } : s.a;
        const dx = c.x - from.x, dz = c.z - from.z;
        const flat = Math.hypot(dx, dz);
        if (flat < 0.5 || flat > AIM_RANGE) continue;
        const off = Math.abs(angleDiff(p.yaw, yawOf(dx, dz)));
        if (off > AIM_ASSIST_DEG * DEG) continue;
        // 正面に近く、手前にあるものを優先する
        const score = off * 20 + flat;
        if (score < best) {
          best = score;
          yaw = yawOf(dx, dz);
          pitch = Math.atan2(c.y - from.y, flat);
        }
      }
    }
    const speed = (spec.speed[level] ?? spec.speed[0] ?? 30) / 60;
    for (let i = 0; i < spec.count; i++) {
      const spread = spec.count > 1 ? (i / (spec.count - 1) - 0.5) * spec.spreadDeg * DEG : 0;
      const y = yaw + spread;
      const vel: V3 = { x: Math.sin(y) * Math.cos(pitch) * speed, y: Math.sin(pitch) * speed, z: Math.cos(y) * Math.cos(pitch) * speed };
      this.projectiles.push({ id: this.nextProjectile++, pos: { ...from }, prevPos: { ...from }, vel, life: ARROW_LIFE_TICKS, travelled: 0, actionId: run.def.actionId, coefficient: spec.coefficient[level] ?? spec.coefficient[0] ?? 0.3, level });
    }
    this.emit({ type: 'shoot', count: spec.count, level, pos: from });
  }

  private stepProjectiles(): void {
    if (this.projectiles.length === 0) return;
    const keep: Projectile[] = [];
    for (const a of this.projectiles) {
      a.prevPos = { ...a.pos };
      const next: V3 = { x: a.pos.x + a.vel.x, y: a.pos.y + a.vel.y, z: a.pos.z + a.vel.z };
      let done = false;
      for (const m of this.monsters) {
        if (m.dead || m.captured) continue;
        const hit = sweepCapsule(a.pos, a.pos, next, next, ARROW_RADIUS, monsterShapes(m));
        if (!hit) continue;
        const dist = a.travelled + Math.hypot(hit.point.x - a.pos.x, hit.point.y - a.pos.y, hit.point.z - a.pos.z);
        this.dealPlayerDamage(m, hit.partIndex, hit.point, { actionId: a.actionId, windowId: 'arrow', actionTick: 0, motion: a.coefficient * arrowDistanceScale(dist), elementMotion: 1, damageType: 'shot', hitstop: 2, chargeLevel: a.level });
        done = true;
        break;
      }
      if (done) continue;
      a.pos = next;
      a.travelled += Math.hypot(a.vel.x, a.vel.y, a.vel.z);
      a.life--;
      if (a.life > 0 && a.pos.y > -0.5) keep.push(a);
    }
    this.projectiles = keep;
  }

  private resolveMonsterAttacks(): void {
    const p = this.player;
    for (const m of this.monsters) {
      const ev = m.attackEval;
      if (!ev || m.dead || m.captured || m.trapTicks > 0) continue;
      const { run, t } = ev;
      for (const hw of run.def.hitWindows) {
        if (!inWindow(t, hw)) continue;
        if (this.ledger.count(run.instanceId, hw.id, p.id) >= hw.maxHitsPerTarget) continue;
        const sw = this.windowSweep(hw, t, m.pos, m.yaw);
        const cap = playerHurtCapsule(p, this.content);
        const shape: WorldShape = { partIndex: 0, a: cap.a, b: cap.b, r: cap.r };
        const hit = sweepCapsule(sw.a0, sw.b0, sw.a1, sw.b1, sw.r, [shape]);
        if (!hit) continue;
        const outcome = resolveIncomingHit(
          p,
          {
            attackerPos: m.pos,
            baseDamage: (hw.baseDamage ?? 0) * this.monsterAttackScale * (m.enraged && m.def.rage ? m.def.rage.damageScale : 1),
            guardable: hw.guardable ?? true,
            guardCost: hw.guardCost ?? 20,
            reaction: hw.reaction ?? 'flinch',
          },
          this,
        );
        if (outcome === 'evaded') {
          // 無敵でかわした場合は台帳に書かない。同じ窓で 1 回だけ知らせる。
          if (this.ledger.count(run.instanceId, `${hw.id}#evade`, p.id) === 0) {
            this.ledger.record(run.instanceId, `${hw.id}#evade`, p.id);
            this.emit({ type: 'evade', pos: { ...p.pos } });
          }
        } else if (outcome !== 'ignored') {
          this.ledger.record(run.instanceId, hw.id, p.id);
        }
      }
    }
  }

  /** 状態の指紋。同じ入力列を別のフレームレートで再生して一致を確かめるのに使う。 */
  hash(): string {
    const p = this.player;
    const act = (r: ActionRun | null): string => (r ? `${r.def.actionId}:${r.tick}:${r.hitstop}:${r.chargeTicks}` : '-');
    const parts: (string | number)[] = [
      this.tick,
      p.pos.x,
      p.pos.y,
      p.pos.z,
      p.yaw,
      p.hp,
      p.stamina,
      p.mode,
      p.drawn ? 1 : 0,
      act(p.action),
      p.guard ? `${p.guard.phase}:${p.guard.tick}` : '-',
      p.hurt ? `${p.hurt.kind}:${p.hurt.tick}` : '-',
      this.rng.state,
      this.totalDamage,
      this.hitCount,
      this.damageTaken,
    ];
    for (const m of this.monsters) {
      parts.push(m.hp, m.pos.x, m.pos.z, m.yaw, m.dead ? 1 : 0, m.staggerTicks, m.cooldown, act(m.action), m.aware ? 1 : 0, m.enraged ? m.enragedTicks : 0, m.rageAcc);
      for (const q of m.parts) parts.push(q.durability, q.broken ? 1 : 0, q.severed ? 1 : 0, q.severAcc, q.flinchAcc, q.flinchThreshold);
    }
    for (const h of this.hazards) parts.push(h.x, h.z, h.warn, h.active, h.hit ? 1 : 0);
    parts.push(p.itemIndex, p.items.map((s) => s.count).join(','), p.itemUse ? `${p.itemUse.itemId}:${p.itemUse.done ? 1 : 0}` : '-', p.pendingItem ? 1 : 0, p.carving ? p.carving.source : '-');
    for (const m of this.monsters) parts.push(m.trapTicks, m.trapCount, m.tranq, m.tranqTicks, m.captured ? 1 : 0);
    for (const t of this.traps) parts.push(t.x, t.z, t.state, t.arm, t.life);
    parts.push(p.momentum, p.momentumTicks);
    for (const a of this.projectiles) parts.push(a.pos.x, a.pos.y, a.pos.z, a.life);
    if (this.hunt) {
      const h = this.hunt;
      parts.push(h.phase, h.reason ?? '-', h.ticks, h.faints, h.returnTicks, h.closed ? 1 : 0, h.loot.map((g) => `${g.itemId}@${g.source}`).join(','), Object.entries(h.carves).map(([k, v]) => `${k}=${v}`).join(','));
    }
    return parts.join('|');
  }
}

/** 文字列を 32bit の数へ畳む（FNV-1a）。tick ごとの指紋を小さく持つために使う。 */
export function fnv1a(s: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
