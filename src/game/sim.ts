// simulation 本体。60Hz 固定 tick で step() を 1 回ずつ呼ぶ。
// ここは DOM・Three.js・Math.random・現在時刻に触れない。同じ seed と同じ入力列なら同じ結果になる。
import { toWorld, type V3 } from '../core/math';
import { SeededRng } from '../core/seededRng';
import type { Content, HitWindowDef } from '../data/schemas';
import { inWindow, type ActionRun } from './action';
import { HitLedger, computeDamage, sweepCapsule, type WorldShape } from './combat';
import type { SimEvent } from './events';
import type { InputFrame } from './inputFrame';
import { applyDamageToMonster, createMonster, monsterShapes, stepMonster, type MonsterState } from './monster';
import { createPlayer, playerHurtCapsule, resolveIncomingHit, stepPlayer, weaponOf, type PlayerState, type SimCtx } from './player';
import { trackSegment } from './tracks';
import { World, type Circle } from './world';

export interface SimOptions {
  seed: number;
  mapId: string;
  weaponId: string;
  monsterId: string | null;
  monsterAttacks: boolean;
}

export interface HitRecord {
  tick: number;
  actionId: string;
  windowId: string;
  actionTick: number;
  partId: string;
  damage: number;
  crit: number;
}

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

  constructor(content: Content, options: SimOptions) {
    this.content = content;
    this.options = options;
    const map = content.maps.get(options.mapId);
    if (!map) throw new Error(`map ${options.mapId} が無い`);
    if (!content.weapons.has(options.weaponId)) throw new Error(`weapon ${options.weaponId} が無い`);
    this.world = new World(map);
    this.rng = new SeededRng(options.seed);
    this.player = createPlayer(content, map.spawn, options.weaponId);
    if (options.monsterId) {
      const def = content.monsters.get(options.monsterId);
      if (!def) throw new Error(`monster ${options.monsterId} が無い`);
      const m = createMonster(def, map.monsterSpawn, 'monster#1');
      m.aiEnabled = options.monsterAttacks;
      this.monsters.push(m);
    }
  }

  emit(ev: SimEvent): void {
    if (ev.type === 'player_hurt' || ev.type === 'guard' || ev.type === 'guard_break') this.damageTaken += ev.damage;
    this.events.push(ev);
  }

  newInstanceId(): number {
    return this.nextInstance++;
  }

  blockers(): Circle[] {
    const out: Circle[] = [];
    for (const m of this.monsters) if (!m.dead) out.push({ x: m.pos.x, z: m.pos.z, r: m.def.bodyRadius });
    return out;
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
    this.resolvePlayerAttacks();
    this.resolveMonsterAttacks();
    const active = new Set<number>();
    if (this.player.action) active.add(this.player.action.instanceId);
    if (this.player.attackEval) active.add(this.player.attackEval.run.instanceId);
    for (const m of this.monsters) if (m.action) active.add(m.action.instanceId);
    this.ledger.prune(active);
  }

  /** hitWindow の武器カプセルを「この tick の始点 → 終点」で返す（ワールド座標）。 */
  private windowSweep(hw: HitWindowDef, t: number, pos: V3, yaw: number): { a0: V3; b0: V3; a1: V3; b1: V3; r: number } {
    const tr = this.content.tracks.get(hw.shapeTrack)!;
    const s0 = trackSegment(tr, t);
    const s1 = trackSegment(tr, t + 1);
    return {
      a0: toWorld(s0.a, pos, yaw),
      b0: toWorld(s0.b, pos, yaw),
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
      const sw = this.windowSweep(hw, t, p.pos, p.yaw);
      for (const m of this.monsters) {
        if (m.dead) continue;
        if (this.ledger.count(run.instanceId, hw.id, m.id) >= hw.maxHitsPerTarget) continue;
        const hit = sweepCapsule(sw.a0, sw.b0, sw.a1, sw.b1, sw.r, monsterShapes(m));
        if (!hit) continue;
        this.ledger.record(run.instanceId, hw.id, m.id);
        this.applyPlayerHit(run, hw, t, m, hit.partIndex, hit.point);
      }
    }
  }

  private applyPlayerHit(run: ActionRun, hw: HitWindowDef, t: number, m: MonsterState, partIndex: number, point: V3): void {
    const weapon = weaponOf(this.player, this.content);
    const part = m.def.parts[partIndex]!;
    const charge = run.def.charge;
    const scale = charge ? charge.coefficientScale[run.chargeLevel] ?? 1 : 1;
    // 会心は seed 付き乱数。1 命中につき必ず 1 回引き、乱数列を入力だけで決まるようにする。
    const roll = this.rng.next() * 100;
    const T = this.content.player;
    let crit = 0;
    if (weapon.affinity > 0 && roll < weapon.affinity) crit = 1;
    else if (weapon.affinity < 0 && roll < -weapon.affinity) crit = -1;
    const damage = computeDamage({
      attack: weapon.attack,
      motion: hw.damageCoefficient * scale,
      sharpness: weapon.sharpnessModifier,
      hitzone: part.hitzone[hw.damageType],
      crit: crit > 0 ? T.critMultiplier : crit < 0 ? 0.75 : 1,
      element: weapon.element.value,
      elementMotion: hw.elementCoefficient ?? 1,
      elementZone: part.elementZone,
      questModifier: this.questModifier,
    });
    const hitstop = hw.hitstopTicks + (charge ? charge.hitstopBonus[run.chargeLevel] ?? 0 : 0);
    run.hitstop = hitstop;
    m.hitstop = hitstop;
    this.totalDamage += damage;
    this.hitCount++;
    this.recentHits.push({ tick: this.tick, actionId: run.def.actionId, windowId: hw.id, actionTick: t, partId: part.id, damage, crit });
    if (this.recentHits.length > 8) this.recentHits.shift();
    this.emit({
      type: 'hit',
      attacker: this.player.id,
      target: m.id,
      actionId: run.def.actionId,
      windowId: hw.id,
      partId: part.id,
      partIndex,
      damage,
      crit,
      pos: point,
      material: part.material,
      hitstop,
      chargeLevel: run.chargeLevel,
      tick: this.tick,
    });
    applyDamageToMonster(m, partIndex, damage, this);
  }

  private resolveMonsterAttacks(): void {
    const p = this.player;
    for (const m of this.monsters) {
      const ev = m.attackEval;
      if (!ev || m.dead) continue;
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
            baseDamage: (hw.baseDamage ?? 0) * this.questModifier,
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
      parts.push(m.hp, m.pos.x, m.pos.z, m.yaw, m.dead ? 1 : 0, m.staggerTicks, m.cooldown, act(m.action));
      for (const q of m.parts) parts.push(q.durability, q.broken ? 1 : 0);
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
