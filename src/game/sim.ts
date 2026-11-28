// simulation 本体。60Hz 固定 tick で step() を 1 回ずつ呼ぶ。
// ここは DOM・Three.js・Math.random・現在時刻に触れない。同じ seed と同じ入力列なら同じ結果になる。
import { DEG, angleDiff, forwardOf, toWorld, yawOf, type V3 } from '../core/math';
import { SeededRng } from '../core/seededRng';
import { STATUS_KINDS, questTargets } from '../data/schemas';
import type { Content, DamageType, ElementId, StatusKind, FieldAreaDef, FieldDef, HazardDef, HazardLook, HitWindowDef, ItemDef, ItemStack, LootDef, LootRoll, MonsterDef, QuestDef, QuestTarget, RankDef, ShootDef, StatusHit } from '../data/schemas';
import { inWindow, type ActionRun } from './action';
import { HitLedger, computeDamage, edgeStage, sweepCapsule, type WorldShape } from './combat';
import type { SimEvent } from './events';
import { Btn, type InputFrame } from './inputFrame';
import { defenseScale, scaleMonsterDef, totalDefense } from './rank';
import { computeGear, skillValue, critChance, incomingElementScale, weaponElementZone, type GearEffects } from './gear';
import { addAilment, ailmentAmount, ailmentRules, activeControl, clearAilments, startPoison, wakeFromSleep } from './ailment';
import { applyDamageToMonster, createMonster, monsterBlockers, monsterShapes, stepMonster, type MonsterState } from './monster';
import { questTimeLimitTicks } from './field';
import { addMember, createHerdGroup, herdArea, herdHurt, livingMembers, slotOf, stepHerdGroup, type HerdGroup } from './herd';
import { createRoam } from './roam';
import { createPlayer, familyOf, playerHurtCapsule, resolveIncomingHit, setSpirit, stepPlayer, weaponOf, type PlayerState, type SimCtx } from './player';
import { aimDir, aimEye, aimTarget } from './aim';
import { trackSegment, sampleTrack } from './tracks';
import { HORN_ATTACK_SCALE, isBowgun, shellAction } from './extraWeapons';
import { World, type Circle } from './world';
import { gatheringCatalog, usesFieldGather } from '../data/fieldGathering';
import { FieldGatherState, FIELD_NODE_REACH } from './fieldGather';
import { DELIVER_ACTION, DEPOT_RADIUS, DEPOT_REACH, MINE_NODE_RADIUS, NODE_REACH, bagHasRoom, createErrand, errandReady, errandSurplus, nodeAction, type ErrandState, type ErrandTarget } from './errand';

import { prepBonus, type HuntPrep } from '../data/hubLife';
import { carryLimit, isCarriedLoot, POUCH_SLOTS } from '../save/classicBox';

export interface SimOptions {
  /** 出発時に消費した温泉・食事。リプレイにも保存する。 */
  hubPrep?: HuntPrep;
  seed: number;
  mapId: string;
  weaponId: string;
  monsterId: string | null;
  monsterAttacks: boolean;
  /** 依頼。指定すると、マップ・標的・制限時間・力尽き回数は依頼の定義から決まる。 */
  questId?: string | null;
  /** 身に着けている防具の ID（部位ごとに 1 つ）。無ければ防御力 0。 */
  armorIds?: readonly string[];
  /**
   * フィールド（エリアに分かれた狩場）で狩る。依頼に fieldId がある時だけ効く。野営地から出発し、標的はエリアを巡る。
   * 指定しなければ、これまでどおり 1 つの狩場（依頼の mapId）で始まる。
   */
  field?: boolean;
  /**
   * 狩りへ持っていく、自分の道具（商店で買ったもの）。依頼の時だけ効く。支給品に足して持つ（合わせて carryMax まで）。
   * 使う時は、支給品のぶんから先に減る。自分のぶんを何個使ったかは spentOwn() で分かる。
   */
  pouch?: readonly ItemStack[];
  /** 実際のゲームの狩場では支給品を野営地で手動取得。旧テスト/アリーナは従来方式。 */
  classicBox?: boolean;
  /**
   * 操作補助: 弓の狙いの補助（v0.61.0。#19 の H05。設定の「弓の狙いの補助」）。手で狙っていない時に、正面 14° 以内の部位へ矢の向きと高さを寄せる。
   * 標準（2G）は切: 手で狙っていなければ、矢は体の向きへ水平に飛ぶ。手で狙っている間は、どちらでも寄せない
   */
  aimAssist?: boolean;
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
  /** 当たった時にためる状態異常と、見た目の種類（v0.17.0） */
  status: StatusHit | null;
  look: HazardLook;
  /** 出した種の技の属性（v0.33.0。monsterElementShare の分が、この属性になる）。無属性・持ち主の無いものは null */
  element: ElementId | null;
}

export type HuntReason = 'slay' | 'capture' | 'time' | 'faints' | 'retire' | 'deliver';

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
  /** 制限時間（フィールドで狩る時は、依頼の値より長い） */
  timeLimitTicks: number;
  endTick: number;
  returnTicks: number;
  /** 剥ぎ取りの残り回数。'body'（1 体の標的の本体）と、切り落とした部位の id と、倒した幼体の 'body:<個体の id>' */
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
  /** 軽弩・重弩の弾（v0.80.0）。矢と見た目・距離の減り方が違う */
  kind?: 'round';
  /** 貫通の矢（v0.60.0）: あと何回当たれるか（1 で、次に当たると消える）と、当たった部位（モンスター id: 部位の番号）。同じ部位へは 1 回だけ */
  pierce?: number;
  hitParts?: string[];
}

/**
 * 射ち方ごとの、1 回の射撃の力（合計）の分け方（v0.60.0。2G の弓の連射・拡散・貫通。値は Kari の仮の値。docs/spec.md の 32.26）。
 * 連射: n 本が同じ線を飛ぶ（上下に 7cm ずつずらす）。拡散: 扇に広がる（3 本は ±10°、5 本は ±8°・±16°）。
 * 貫通: 1 本が体を抜け、別々の部位へ n 回まで当たる（1 回ごとに 1.35 ÷ n。全部当たると 1.35 倍）
 */
export const RAPID_SHARE: Record<number, number[]> = { 1: [1], 2: [0.6, 0.4], 3: [0.45, 0.33, 0.22], 4: [0.37, 0.28, 0.2, 0.15] };
export const SPREAD_FAN: Record<number, { deg: number; share: number }[]> = {
  3: [{ deg: 0, share: 0.5 }, { deg: -10, share: 0.25 }, { deg: 10, share: 0.25 }],
  5: [{ deg: 0, share: 0.36 }, { deg: -8, share: 0.2 }, { deg: 8, share: 0.2 }, { deg: -16, share: 0.12 }, { deg: 16, share: 0.12 }],
};
export const PIERCE_TOTAL = 1.35;
const RAPID_GAP = 0.07;

/** 矢の適正距離: 6〜12m で威力そのまま。近すぎ・遠すぎは下がる。 */
export function arrowDistanceScale(d: number): number {
  if (d < 4) return 0.6;
  if (d < 6) return 0.6 + (0.4 * (d - 4)) / 2;
  if (d <= 12) return 1;
  if (d < 16) return 1 - (0.5 * (d - 12)) / 4;
  return 0.5;
}

/**
 * 軽弩・重弩の弾（v0.80.0。値は Kari の仮の値。docs/spec.md の 33 章）: 12m までは威力そのまま、そこから 36m で 0.35 まで下がる。
 * 貫通弾は 1 回の力が 0.48（3 回まで）、散弾は 3 つ（±0.1 rad）で 1 つの力が 0.4
 */
export function roundDistanceScale(d: number): number {
  return d <= 12 ? 1 : Math.max(0.35, 1 - (d - 12) / 24);
}
const ROUND_PIERCE_SHARE = 0.48;
const ROUND_SPREAD_SHARE = 0.4;
const ROUND_SPREAD_YAW = [-0.1, 0, 0.1];

const ARROW_RADIUS = 0.1;
const ARROW_LIFE_TICKS = 70;
/** 狙いの補助: 正面からこの角度までにある部位へ、矢の向きを合わせる */
const AIM_ASSIST_DEG = 14;
const AIM_RANGE = 28;

export class Simulation implements SimCtx {
  readonly content: Content;
  readonly world: World;
  /** フィールド（エリアに分かれた狩場）。そうでなければ null */
  readonly field: FieldDef | null = null;
  /** プレイヤーが居るエリアの id（フィールドでなければ ''） */
  areaId = '';
  /** 出発した時の道具の内訳（道具ごとの、支給品の数と、自分で持ってきた数） */
  readonly brought: Record<string, { supplied: number; own: number }> = {};
  readonly supplyStock: ItemStack[] = [];
  /** 自前品の消費を後から受け取った支給品で帳消しにしない。 */
  private readonly ownSpentFloor: Record<string,number> = {};
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
  /** 防具の防御力の合計と、それで受けるダメージへ掛かる倍率（1 以下） */
  defense = 0;
  defenseScale = 1;
  /** 身に着けている防具の ID（設定のまま。見た目が読む） */
  armorIds: readonly string[] = [];
  /** 装備の効き目（v0.33.0。防具の技能と耐性。src/game/gear.ts） */
  gear: GearEffects;
  /** 依頼の段階（訓練場では null） */
  rank: RankDef | null = null;
  hazards: Hazard[] = [];
  private nextHazard = 1;
  hunt: HuntState | null = null;
  traps: Trap[] = [];
  private nextTrap = 1;
  /** 切り落とした部位が落ちた位置（部位 id ごと）。剥ぎ取りの場所になる。 */
  severedAt: Record<string, { x: number; z: number }> = {};
  projectiles: Projectile[] = [];
  private nextProjectile = 1;
  /** 群れ（幼体。v0.18.0）。群れの依頼の標的と、フィールドに住む群れ */
  herds: HerdGroup[] = [];
  /** 依頼の標的（種ごとの頭数）。1 体の大型の依頼なら [{ 標的, 1 }]。訓練場・里では空 */
  readonly targets: QuestTarget[] = [];
  /** 群れの依頼（標的を、決まった頭数だけ討伐する）か */
  readonly pack: boolean = false;
  /** 1 体の標的（大型の依頼の標的、訓練場の標的）。群れの依頼では null */
  main: MonsterState | null = null;
  /** 狩らない依頼（採集・採掘・現地の納品。v0.27.0）の、採った採取点と採集袋。狩りの依頼・訓練場では null */
  errand: ErrandState | null = null;
  fieldGather: FieldGatherState | null = null;
  /** 操作補助: 弓の狙いの補助（v0.61.0。SimOptions.aimAssist。標準は切） */
  readonly aimAssist: boolean;

  constructor(content: Content, options: SimOptions) {
    const preparation=prepBonus(options.questId?options.hubPrep:null);
    if(preparation.hp||preparation.stamina)content={...content,player:{...content.player,maxHp:content.player.maxHp+preparation.hp,maxStamina:content.player.maxStamina+preparation.stamina}};
    this.content = content;
    this.options = options;
    this.aimAssist = !!options.aimAssist;
    const quest = options.questId ? content.quests.get(options.questId) : undefined;
    if (options.questId && !quest) throw new Error(`quest ${options.questId} が無い`);
    const map = content.maps.get(quest ? quest.mapId : options.mapId);
    if (!map) throw new Error(`map ${options.mapId} が無い`);
    if (!content.weapons.has(options.weaponId)) throw new Error(`weapon ${options.weaponId} が無い`);
    const field = options.field && quest?.fieldId ? content.fields.get(quest.fieldId) : undefined;
    if (options.field && quest?.fieldId && !field) throw new Error(`field ${quest.fieldId} が無い`);
    // 狩らない依頼は、採取点がフィールドの座標にあるので、フィールドでだけ遊べる
    if (quest?.kind === 'gather' && !field) throw new Error(`quest ${quest.id}: 狩らない依頼は、フィールドでだけ遊べる`);
    this.world = new World(map, field?.areas);
    this.rng = new SeededRng(options.seed);
    if (field) {
      this.field = field;
      this.areaId = field.start.areaId;
      // 力尽きた後は、野営地へ戻る
      this.world.spawn = field.start;
    }
    // 支給品: 依頼なら依頼の支給品、訓練場なら訓練用（研磨石）。依頼では、自分の道具を足す（合わせて carryMax まで。残りは里に置いていく）
    // 里（拠点）では、道具を持たない
    const base = quest ? quest.supplies ?? [] : map.id === content.hub.mapId ? [] : content.player.trainingSupplies ?? [];
    // フィールドで大型を狩る依頼（v0.42.0）: 標識玉を足す（群れの依頼・狩らない依頼・エリアが 1 つの狩場には足さない。依頼に同じ道具があれば、そちら）
    const bigHunt = !!field && !!quest && quest.kind !== 'gather' && !quest.targets && !!quest.targetMonsterId;
    const extra = bigHunt ? (content.player.huntSupplies ?? []).filter((x) => !base.some((b) => b.itemId === x.itemId)) : [];
    const allSupplies = [...base, ...extra];
    const manual = !!quest && !!options.classicBox;
    if(manual)this.supplyStock.push(...allSupplies.map(s=>({...s})));
    const supplies = manual?[]:allSupplies;
    const carry: ItemStack[] = supplies.map((s) => ({ ...s }));
    for (const s of supplies) this.brought[s.itemId] = { supplied: s.count, own: 0 };
    for (const own of quest ? options.pouch ?? [] : []) {
      const it = content.items.get(own.itemId);
      if (!it || !(own.count > 0)) continue;
      const b = (this.brought[own.itemId] ??= { supplied: 0, own: 0 });
      const add = Math.max(0, Math.min(Math.floor(own.count), it.carryMax - b.supplied - b.own));
      if (add === 0) continue;
      b.own += add;
      const stack = carry.find((x) => x.itemId === own.itemId);
      if (stack) stack.count += add;
      else carry.push({ itemId: own.itemId, count: add });
    }
    this.player = createPlayer(content, this.world.spawn, options.weaponId, carry);
    this.armorIds = [...(options.armorIds ?? [])];
    this.defense = totalDefense(content, this.armorIds);
    this.defenseScale = defenseScale(content, this.defense)/preparation.defense;
    this.gear = computeGear(content, content.weapons.get(options.weaponId)!, this.armorIds);
    this.gear.statusResist.poison*=preparation.poison;
    if (quest) {
      this.rank = content.ranks.get(quest.rankId) ?? null;
      if (!this.rank) throw new Error(`rank ${quest.rankId} が無い`);
    }
    this.targets = quest ? questTargets(quest).map((t) => ({ ...t })) : [];
    this.pack = !!quest?.targets;
    const monsterId = quest ? (this.pack ? null : quest.targetMonsterId ?? null) : options.monsterId;
    if (monsterId) {
      const base = content.monsters.get(monsterId);
      if (!base) throw new Error(`monster ${monsterId} が無い`);
      // 段階が上の依頼では、強い個体（体力・部位・間隔を段階の倍率で変えた定義）が出る
      const def = this.rank ? scaleMonsterDef(base, this.rank) : base;
      const m = createMonster(def, quest?.monsterSpawn ?? map.monsterSpawn, 'monster#1');
      m.aiEnabled = quest ? true : options.monsterAttacks;
      if (field) {
        // 最初に居るエリア。「これまでの狩場」にあたるエリアなら依頼の位置、そうでなければエリアの中央
        m.roam = createRoam(field, base.id, this);
        const area = m.roam && field.areas.find((a) => a.id === m.roam!.areaId);
        if (area && area.id !== field.legacyAreaId) {
          const c = this.world.centerOf(area);
          m.pos = { x: c.x, y: 0, z: c.z };
          m.prevPos = { ...m.pos };
        }
      }
      this.monsters.push(m);
      this.main = m;
    }
    // 狩らない依頼（v0.27.0）: 大型も幼体も出さない（encounters: none）。採取点と採集袋を用意する
    if (quest && field && usesFieldGather(content,quest)) this.fieldGather=new FieldGatherState(gatheringCatalog(content,field.id)!,quest.rankId,options.seed);
    if (quest?.gather) this.errand = createErrand(quest.gather);
    else this.spawnHerds(quest, field ?? null, quest?.monsterSpawn ?? map.monsterSpawn);
    if (quest) {
      this.hunt = { quest, phase: 'active', reason: null, ticks: 0, faints: 0, timeLimitTicks: questTimeLimitTicks(content, quest, !!field), endTick: 0, returnTicks: 0, carves: {}, loot: [], closed: false, closeTick: 0, rewards: null };
      this.monsterAttackScale = (quest.monsterAttackScale ?? 1) * (this.rank?.monster.attackScale ?? 1);
    }
  }

  emit(ev: SimEvent): void {
    if (ev.type === 'player_hurt' || ev.type === 'guard' || ev.type === 'guard_break') this.damageTaken += ev.damage;
    if (ev.type === 'player_dead' && this.hunt?.phase === 'active') this.hunt.faints++;
    if (ev.type === 'part_sever') this.severedAt[ev.partId] = { x: ev.pos.x, z: ev.pos.z };
    if (ev.type === 'monster_dead') this.onMonsterDead(ev.target);
    this.events.push(ev);
  }

  // ---- 群れ（幼体。v0.18.0）----

  /**
   * 群れを出す。群れの依頼では、標的の種の群れ（標的の頭数より少なくならない）。
   * フィールドでは、狩場に住む群れ（native の群れと、親か自分が標的の群れ）を、住みかの最初のエリアへ。
   */
  private spawnHerds(quest: QuestDef | undefined, field: FieldDef | null, spawn: { x: number; z: number; yaw: number }): void {
    const c = this.content;
    const need = new Map(this.pack ? this.targets.map((t) => [t.monsterId, t.count]) : []);
    const targetIds = new Set(this.targets.map((t) => t.monsterId));
    if (field) {
      for (const fh of field.herds ?? []) {
        const base = c.monsters.get(fh.monsterId);
        if (!base?.herd) continue;
        const active = fh.native || targetIds.has(base.id) || (!!base.parentId && targetIds.has(base.parentId));
        if (!active) continue;
        const area = field.areas.find((a) => a.id === fh.areas[0]);
        if (!area) continue;
        const g = this.spawnHerd(base, need.get(base.id) ?? 0, fh.areas, area.id, (rng) => {
          // 自然な形のエリアでは、外周から 8m 以上離れた所（四角のエリアは、これまでどおり真ん中の 4 割の中）
          if (this.world.geo(area)) return this.world.randomPoint(area, rng, 8);
          const b = area.bounds;
          return { x: b.minX + (b.maxX - b.minX) * (0.3 + 0.4 * rng.next()), z: b.minZ + (b.maxZ - b.minZ) * (0.3 + 0.4 * rng.next()) };
        });
        need.set(base.id, Math.max(0, (need.get(base.id) ?? 0) - g.members.length));
      }
    }
    // 群れの依頼で、まだ足りない標的（フィールドに住みかの無い種・1 つの狩場）: 依頼の位置へ
    let k = 0;
    for (const t of this.targets) {
      const left = need.get(t.monsterId) ?? 0;
      if (!this.pack || left <= 0) continue;
      const base = c.monsters.get(t.monsterId);
      if (!base?.herd) throw new Error(`monster ${t.monsterId} は群れで暮らさない（群れの依頼の標的にできない）`);
      const at = field ? (() => {
        const a = field.areas.find((x) => x.id === field.legacyAreaId)!;
        const c = this.world.centerOf(a);
        return this.world.clampPoint(a, c.x + k * 9, c.z, 6);
      })() : { x: spawn.x + k * 9, z: spawn.z };
      this.spawnHerd(base, left, [], field ? field.legacyAreaId : '', () => at);
      need.set(t.monsterId, 0);
      k++;
    }
    for (const g of this.herds) {
      const base = c.monsters.get(g.monsterId)!;
      g.parent = this.monsters.find((m) => !m.herd && m.def.id === base.parentId) ?? null;
    }
  }

  /** 群れを 1 つ出す。頭数は、登録簿の範囲から引く（atLeast より少なくしない）。乱数は群れごと（シミュレーションの乱数を使わない）。 */
  private spawnHerd(base: MonsterDef, atLeast: number, areas: string[], areaId: string, place: (rng: SeededRng) => { x: number; z: number }): HerdGroup {
    const H = base.herd!;
    const index = this.herds.length;
    const rng = new SeededRng((this.options.seed + Math.imul(index + 1, 0x9e3779b9)) >>> 0);
    const size = Math.max(atLeast, H.size[0] + rng.int(H.size[1] - H.size[0] + 1));
    const p0 = place(rng);
    const area = this.world.areaAt(p0.x, p0.z);
    // 中心は、岩と縁から離す
    const probe = { x: p0.x, y: 0, z: p0.z };
    this.world.move(probe, H.spacing * 2, 0, 0);
    const at = { x: probe.x, z: probe.z };
    const def = this.rank ? scaleMonsterDef(base, this.rank) : base;
    const g = createHerdGroup(index + 1, base.id, H, areas, areaId, at, rng);
    for (let i = 0; i < size; i++) {
      const s = slotOf(i, H.spacing);
      const m = createMonster(def, { x: at.x, z: at.z, yaw: rng.next() * Math.PI * 2 }, `herd${index + 1}#${i + 1}`);
      this.world.move(m.pos, def.bodyRadius, s.x, s.z);
      if (this.world.areaAt(m.pos.x, m.pos.z) !== area) m.pos = { x: at.x, y: 0, z: at.z };
      m.pos.y = this.world.groundHeight(m.pos.x, m.pos.z);
      m.prevPos = { ...m.pos };
      m.spawn = { x: m.pos.x, z: m.pos.z, yaw: m.yaw };
      addMember(g, m);
      this.monsters.push(m);
    }
    this.herds.push(g);
    return g;
  }

  /** 倒れた幼体は、その場で 1 回剥ぎ取れる（狩りの途中でも。失敗・帰還の後は無し） */
  private onMonsterDead(id: string): void {
    const h = this.hunt;
    const m = this.monsters.find((x) => x.id === id);
    if (!h || h.closed || h.phase === 'failed' || !m?.herd) return;
    const loot = this.lootOf(m);
    if (loot) h.carves[`body:${m.id}`] = loot.carve.count;
  }

  /** 倒した数（種ごと。群れの依頼の標的を数える） */
  slain(monsterId: string): number {
    let n = 0;
    for (const m of this.monsters) if (m.dead && m.def.id === monsterId) n++;
    return n;
  }

  /** 剥ぎ取りの残り（標的のぶんだけ。周りに居た幼体のぶんは、帰還を早めるかの判断に数えない） */
  carvesLeft(): number {
    const h = this.hunt;
    if (!h) return 0;
    let n = 0;
    for (const [k, v] of Object.entries(h.carves)) {
      if (!k.startsWith('body:')) {
        n += v;
        continue;
      }
      const m = this.monsters.find((x) => x.id === k.slice(5));
      if (m && this.targets.some((t) => t.monsterId === m.def.id)) n += v;
    }
    return n;
  }

  /** 幼体どうし・幼体と大型が重ならないように、幼体を押し出す（大型は動かさない。大型の動きは、群れが居ても変わらない）。 */
  private separateHerds(): void {
    if (this.herds.length === 0) return;
    const list = this.monsters;
    for (let i = 0; i < list.length; i++) {
      const a = list[i]!;
      if (!a.herd || a.dead || a.captured) continue;
      for (let j = 0; j < list.length; j++) {
        const b = list[j]!;
        if (i === j || (b.herd && j < i) || b.dead || b.captured) continue;
        // 遠い相手は見ない（大型の体の長さを入れても 8m に届かない）
        if (Math.abs(a.pos.x - b.pos.x) > 8 || Math.abs(a.pos.z - b.pos.z) > 8) continue;
        if (!b.herd) {
          for (const c of monsterBlockers(b)) {
            const dx = a.pos.x - c.x, dz = a.pos.z - c.z;
            const d = Math.hypot(dx, dz);
            const need = c.r + a.def.bodyRadius;
            if (d >= need) continue;
            const ux = d > 1e-6 ? dx / d : 1, uz = d > 1e-6 ? dz / d : 0;
            this.world.move(a.pos, a.def.bodyRadius, ux * (need - d), uz * (need - d));
          }
          continue;
        }
        const dx = a.pos.x - b.pos.x, dz = a.pos.z - b.pos.z;
        const d = Math.hypot(dx, dz);
        const need = a.def.bodyRadius + b.def.bodyRadius;
        if (d >= need) continue;
        const ux = d > 1e-6 ? dx / d : 1, uz = d > 1e-6 ? dz / d : 0;
        const push = (need - d) / 2;
        this.world.move(a.pos, a.def.bodyRadius, ux * push, uz * push);
        this.world.move(b.pos, b.def.bodyRadius, -ux * push, -uz * push);
      }
    }
  }

  newInstanceId(): number {
    return this.nextInstance++;
  }

  blockers(): Circle[] {
    const out: Circle[] = [];
    for (const m of this.monsters) if (!m.dead) out.push(...monsterBlockers(m));
    // 狩らない依頼: 納品箱と、採掘の採取点（岩の露頭）は通り抜けない（居るエリアのものだけ）
    const e = this.errand;
    if (e) {
      if (e.def.depot.areaId === this.areaId) out.push({ x: e.def.depot.x, z: e.def.depot.z, r: DEPOT_RADIUS });
      for (const n of e.def.nodes) if (n.kind === 'mine' && n.areaId === this.areaId) out.push({ x: n.x, z: n.z, r: MINE_NODE_RADIUS });
    }
    if (this.fieldGather) {
      for(const n of this.fieldGather.nodes)if(n.kind==='mine'&&n.areaId===this.areaId)out.push({x:n.x,z:n.z,r:MINE_NODE_RADIUS});
    }
    const cat=gatheringCatalog(this.content,this.field?.id);
    if(cat&&this.field?.id===cat.fieldId&&cat.pond.areaId===this.areaId){const p=cat.pond;out.push({x:p.x,z:p.z,r:p.radius});}
    return out;
  }

  spawnHazards(def: HazardDef, target: V3, origin?: V3, owner?: MonsterDef): void {
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
        from: origin ? { x: origin.x, y: origin.y, z: origin.z } : null, peak: def.peak ?? 6, status: def.status ?? null, look: def.look ?? 'rock',
        element: owner?.element ?? null,
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
      // 属性を持つ種の飛ばすもの（v0.33.0）: 属性の分は、ハンターの耐性で変わる。怒りは掛けない（これまでどおり）
      const elem = h.element ? incomingElementScale(this.content, { element: h.element } as MonsterDef, this.gear) : 1;
      const outcome = resolveIncomingHit(p, { attackerPos: { x: h.x, y: 0, z: h.z }, baseDamage: h.baseDamage * elem * this.monsterAttackScale * this.defenseScale, guardable: false, guardCost: 0, reaction: h.reaction, status: h.status ?? undefined }, this);
      if (outcome !== 'evaded' && outcome !== 'ignored') h.hit = true;
    }
    this.hazards = this.hazards.filter((h) => h.warn > 0 || h.active > 0);
  }

  // ---- 道具 ----

  canUseItem(item: ItemDef): boolean {
    // 回復と研磨石は依頼の外（訓練場）や達成後でも使える。罠と鎮静玉は狩猟中だけ。罠は同時に 1 つまで。
    if (item.kind === 'heal' || item.kind === 'whet') return true;
    if (this.hunt?.phase !== 'active') return false;
    return item.kind !== 'trap' || this.traps.length === 0;
  }

  applyItem(item: ItemDef): boolean {
    const p = this.player;
    const pos = { ...p.pos };
    // ビン（v0.60.0）は道具の欄から使わない（環弓の同時押しで付ける）
    if (item.kind === 'coating') return false;
    if (item.kind === 'heal') {
      const before = p.hp;
      if(item.curePoison){const poisoned=p.ailment.poisonTicks>0;p.ailment.poisonTicks=0;p.ailment.build.poison=0;if(poisoned)this.emit({type:'status',kind:'poison',on:false});}
      p.hp = Math.min(this.content.player.maxHp, p.hp + (item.heal ?? 0));
      this.emit({ type: 'item_effect', itemId: item.id, kind: 'heal', ok: true, amount: p.hp - before, pos });
      return true;
    }
    if (item.kind === 'whet') {
      // 研磨石: 刃の状態を最大まで戻す
      const E = this.content.edge;
      const before = p.edge;
      const stage = edgeStage(E, before).id;
      p.edge = E.max;
      this.emit({ type: 'item_effect', itemId: item.id, kind: 'whet', ok: true, amount: Math.round(p.edge - before), pos });
      const now = edgeStage(E, p.edge);
      if (now.id !== stage) this.emit({ type: 'edge', stage: now.id, value: p.edge });
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
    // 標識玉（v0.42.0。#19 の F04）: 正面の範囲に居る、いちばん近い大型に当たると、しばらく地図に居場所が出る。外しても 1 個減る
    if (item.kind === 'mark') {
      const k = item.mark!;
      const hit = this.frontMonster(k.range, k.halfAngleDeg);
      if (hit) hit.markTicks = k.ticks;
      const f = forwardOf(p.yaw);
      this.emit({ type: 'item_effect', itemId: item.id, kind: 'mark', ok: !!hit, amount: hit ? Math.round(k.ticks / 60) : 0, pos: hit ? { x: hit.pos.x, y: 1.4, z: hit.pos.z } : { x: p.pos.x + f.x * k.range, y: 0.3, z: p.pos.z + f.z * k.range } });
      return true;
    }
    // 鎮静玉: 正面の範囲に居る、いちばん近い大型に当たる。外しても 1 個減る。
    const q = item.tranq!;
    let best: MonsterState | null = null;
    let bestDist = Infinity;
    for (const m of this.monsters) {
      if (m.dead || m.captured || m.herd) continue;
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

  /** 正面 ±halfAngleDeg、range 以内のいちばん近い大型（群れの幼体を除く）。投げる道具が当たる相手 */
  private frontMonster(range: number, halfAngleDeg: number): MonsterState | null {
    const p = this.player;
    let best: MonsterState | null = null;
    let bestDist = Infinity;
    for (const m of this.monsters) {
      if (m.dead || m.captured || m.herd) continue;
      const dx = m.pos.x - p.pos.x, dz = m.pos.z - p.pos.z;
      const dist = Math.max(0, Math.hypot(dx, dz) - m.def.bodyRadius);
      if (dist > range || dist >= bestDist) continue;
      if (Math.abs(angleDiff(yawOf(dx, dz), p.yaw)) > halfAngleDeg * DEG) continue;
      best = m;
      bestDist = dist;
    }
    return best;
  }

  /**
   * 標的の居場所を、狩人が知っている範囲で（v0.42.0。#19 の F04。地図と文字に出すもの）。
   * visible = 同じエリアに居る / marked = 標識玉の印がある（別のエリアでも、いまの居場所）/ last_seen = 最後に見たエリア（いまは違うかもしれない）/ unknown。
   * フィールドの大型だけ。群れの幼体と、エリアが 1 つの狩場は、いつも visible
   */
  trackOf(m: MonsterState): { state: 'visible' | 'marked' | 'last_seen' | 'unknown'; areaId: string | null } {
    const area = this.monsterArea(m);
    if (!this.field || !m.roam || !area) return { state: 'visible', areaId: area?.id ?? null };
    if (area.id === this.areaId) return { state: 'visible', areaId: area.id };
    if (m.markTicks > 0) return { state: 'marked', areaId: area.id };
    return m.seenAreaId ? { state: 'last_seen', areaId: m.seenAreaId } : { state: 'unknown', areaId: null };
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
        // 罠は大型だけが踏む（幼体は軽くて作動しない）
        if (m.dead || m.captured || m.trapTicks > 0 || m.herd) continue;
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
      clearAilments(m.ailments);
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

  /**
   * いま剥ぎ取れる対象。達成した後: 1 体の標的の本体 → 切り落とした部位 → 倒した幼体（いちばん近いもの）。
   * 狩りの途中は、倒した幼体だけ（納刀している時。抜刀中の攻撃ボタンは、攻撃のまま）。
   */
  carveTarget(): string | null {
    const h = this.hunt;
    if (!h || h.closed || h.phase === 'failed') return null;
    const p = this.player;
    const m = this.main;
    if (h.phase === 'success' && m) {
      if ((h.carves.body ?? 0) > 0 && Math.hypot(p.pos.x - m.pos.x, p.pos.z - m.pos.z) <= m.def.bodyRadius + CARVE_REACH) return 'body';
      for (const [partId, at] of Object.entries(this.severedAt)) {
        if ((h.carves[partId] ?? 0) > 0 && Math.hypot(p.pos.x - at.x, p.pos.z - at.z) <= CARVE_PIECE_REACH) return partId;
      }
    }
    if (h.phase !== 'success' && p.drawn) return null;
    let best: string | null = null;
    let bd = Infinity;
    for (const x of this.monsters) {
      if (!x.dead || !x.herd) continue;
      const key = `body:${x.id}`;
      if (!((h.carves[key] ?? 0) > 0)) continue;
      const d = Math.hypot(p.pos.x - x.pos.x, p.pos.z - x.pos.z) - x.def.bodyRadius;
      if (d <= CARVE_REACH && d < bd) {
        bd = d;
        best = key;
      }
    }
    return best;
  }

  // ---- 狩らない依頼（採集・採掘・現地の納品。v0.27.0、docs/spec.md の 27 章）----

  /**
   * いま攻撃ボタンでできること（納刀している時だけ。抜刀中の攻撃ボタンは、攻撃のまま）。
   * 納品箱のそばで、要る数がそろっていれば「納品」。そうでなければ、届くうちでいちばん近い、まだ採っていない採取点（採集袋に入る時だけ）。
   */
  errandTarget(): ErrandTarget | null {
    const e = this.errand;
    const h = this.hunt;
    if (!h || h.phase !== 'active' || h.closed) return null;
    const p = this.player;
    if (p.drawn || p.mode === 'dead') return null;
    if (!e || e.def.fieldGathering) {
      if(p.mode!=='free'||!p.grounded)return null;
      if (e && e.def.depot.areaId===this.areaId && Math.hypot(p.pos.x-e.def.depot.x,p.pos.z-e.def.depot.z)<=DEPOT_REACH) return {kind:'deliver',actionId:DELIVER_ACTION};
      const speed=1-skillValue(this.content,this.gear.levels,'mining_haste')/100;
      return this.fieldGather?.target(this.areaId,p.pos.x,p.pos.z,p.yaw,(x,z)=>this.world.groundHeight(x,z),speed)??null;
    }
    const d = e.def.depot;
    if (d.areaId === this.areaId && Math.hypot(p.pos.x - d.x, p.pos.z - d.z) <= DEPOT_REACH && errandReady(e)) return { kind: 'deliver', actionId: DELIVER_ACTION };
    let best: ErrandTarget | null = null;
    let bd = Infinity;
    for (const n of e.def.nodes) {
      if (n.areaId !== this.areaId || e.used.includes(n.id) || !bagHasRoom(e, n) || (this.options.classicBox&&this.fieldPouchRoom(n.itemId)<e.def.yieldPerNode)) continue;
      const dist = Math.hypot(p.pos.x - n.x, p.pos.z - n.z);
      if (dist <= NODE_REACH && dist < bd) {
        bd = dist;
        best = { kind: 'node', nodeId: n.id, actionId: nodeAction(n) };
      }
    }
    return best;
  }

  /** 採る・納める行動が、品の入る tick まで進んだ時に 1 度だけ呼ばれる。その時点で、もう 1 度確かめる */
  errandDo(t: ErrandTarget): void {
    const e = this.errand;
    const h = this.hunt;
    if (!h || h.phase !== 'active' || h.closed) return;
    if(t.kind==='field_node'){
      const g=this.fieldGather,n=g?.nodes.find(n=>n.id===t.nodeId),p=this.player;
      if(!g||!n||n.areaId!==this.areaId||Math.hypot(p.pos.x-n.x,p.pos.z-n.z)>FIELD_NODE_REACH+.2||p.drawn)return;
      if(n.kind==='fish'&&g.hookInstance!==p.errandOp?.instanceId){this.emit({type:'field_gather_miss',kind:'fish'});return;}
      const hit=g.take(n);if(!hit)return;
      const accepted=this.options.classicBox?Math.min(hit.count,this.fieldPouchRoom(hit.itemId)):hit.count;
      if(accepted<hit.count)this.emit({type:'pouch_full',itemId:hit.itemId});
      if(!accepted)return;
      for(let i=0;i<accepted;i++)h.loot.push({itemId:hit.itemId,source:'field_'+hit.kind});
      this.emit({type:'field_gather',nodeId:n.id,...hit,count:accepted,pos:{x:n.x,y:this.world.groundHeight(n.x,n.z),z:n.z}});
      return;
    }
    if(!e)return;
    if (t.kind === 'deliver') {
      if (!errandReady(e) || e.delivered) return;
      e.delivered = true;
      this.emit({ type: 'errand_deliver', pos: { ...this.player.pos } });
      return;
    }
    const n = e.def.nodes.find((x) => x.id === t.nodeId);
    if (!n || e.used.includes(n.id) || !bagHasRoom(e, n)) return;
    if(this.options.classicBox&&this.fieldPouchRoom(n.itemId)<e.def.yieldPerNode){this.emit({type:'pouch_full',itemId:n.itemId});return;}
    e.used.push(n.id);
    e.bag[n.itemId] = (e.bag[n.itemId] ?? 0) + e.def.yieldPerNode;
    this.emit({ type: 'errand_gather', nodeId: n.id, itemId: n.itemId, count: e.def.yieldPerNode, total: e.bag[n.itemId]!, kind: n.kind, pos: { x: n.x, y: 0, z: n.z } });
  }

  /** その個体から出る素材の表（段階ごとの表があればそれ、無ければモンスターの lootId）。 */
  private lootOf(m: MonsterState): LootDef | undefined {
    const id = (this.rank && m.def.lootByRank?.[this.rank.id]) ?? m.def.lootId;
    return id ? this.content.loot.get(id) : undefined;
  }

  carve(source: string): void {
    const h = this.hunt;
    if (!h || h.closed || !((h.carves[source] ?? 0) > 0)) return;
    const juvenile = source.startsWith('body:') ? this.monsters.find((x) => x.id === source.slice(5)) : undefined;
    const m = juvenile ?? this.main;
    const loot = m ? this.lootOf(m) : undefined;
    if (!loot) return;
    const table = juvenile || source === 'body' ? loot.carve : loot.severed?.[source];
    if (!table) return;
    h.carves[source]!--;
    let total = 0;
    for (const e of table.table) total += e.weight;
    const itemId = this.pick(table, total);
    const tag = juvenile ? `carve:${juvenile.def.id}` : source === 'body' ? 'carve' : `severed:${source}`;
    if(this.options.classicBox&&this.fieldPouchRoom(itemId)<=0){this.emit({type:'pouch_full',itemId});return;}
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
      const left = this.carvesLeft();
      // 狩らない依頼は、剥ぎ取りが無いので、帰還の表示（5 秒）をそのまま見せる
      if (!this.errand && left === 0 && !this.player.carving && h.returnTicks > CLOSE_AFTER_LAST_CARVE) h.returnTicks = CLOSE_AFTER_LAST_CARVE;
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
      // 狩らない依頼: 納品で使った数を除いた、余りだけを持ち帰る（使った数を、報酬へ戻さない）
      if (this.errand) for (const s of errandSurplus(this.errand)) for (let i = 0; i < s.count; i++) h.loot.push({ itemId: s.itemId, source: 'gather' });
      const m = this.main;
      const loot = m ? this.lootOf(m) : undefined;
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
    if (this.errand) {
      // 狩らない依頼: 同じ tick に 3 回目の力尽き・時間切れが決まったら、納品は成り立たない（終わり方は 1 つだけ）
      if (input.pressed & Btn.Retire) end('failed', 'retire');
      else if (h.faints >= h.quest.maxFaints) end('failed', 'faints');
      else if (h.ticks >= h.timeLimitTicks) end('failed', 'time');
      else if (this.errand.delivered) end('success', 'deliver');
      return;
    }
    if (this.pack ? this.targets.every((t) => this.slain(t.monsterId) >= t.count) : this.main?.dead) end('success', 'slay');
    else if (!this.pack && this.main?.captured) end('success', 'capture');
    else if (input.pressed & Btn.Retire) end('failed', 'retire');
    else if (h.faints >= h.quest.maxFaints) end('failed', 'faints');
    else if (h.ticks >= h.timeLimitTicks) end('failed', 'time');
  }

  /** たまった出来事を取り出す（描画・音・UI が毎フレーム呼ぶ）。 */
  drainEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  step(input: InputFrame): void {
    this.tick++;
    if(input.supplyId)this.takeSupply(input.supplyId);
    const fg=this.fieldGather,op=this.player.errandOp,run=this.player.action;
    if(fg&&op?.target.kind==='field_node'&&op.target.source==='fish'&&run?.instanceId===op.instanceId&&fg.bite(run.tick)&&(input.pressed&Btn.Main))fg.hookInstance=run.instanceId;
    stepPlayer(this.player, input, this);
    if(fg&&this.hunt?.phase==='active')fg.discover(this.areaId,this.player.pos.x,this.player.pos.z,10+skillValue(this.content,this.gear.levels,'gather_sense'));
    if (this.field) this.stepExits();
    for (const g of this.herds) stepHerdGroup(g, this);
    for (const m of this.monsters) stepMonster(m, this.player, this);
    // 目印と、最後に見た所（v0.42.0。#19 の F04）: 印の残りを減らし、同じエリアに居る大型は「見た」ことにする
    if (this.field) {
      for (const m of this.monsters) {
        if (!m.roam) continue;
        if (m.markTicks > 0) m.markTicks--;
        if (!m.dead && !m.captured && m.roam.areaId === this.areaId) m.seenAreaId = m.roam.areaId;
      }
    }
    this.separateHerds();
    // 歩いてきた大型に重なったら押し出す（プレイヤーが動いていなくても胴を抜けない）。
    // 登攀・乗り越えの間は、その動きが位置を持つので押し出さない（v0.69.0。押し出しが体を地面の高さへ上げ、登り切る・上から取り付く途中で
    // 縁を越えた時に高さが跳んでいた。D-167）
    const pm = this.player.mode;
    if (pm !== 'dead' && pm !== 'climb' && pm !== 'vault') this.world.move(this.player.pos, this.content.player.radius, 0, 0, this.blockers());
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

  /** Physical field pouch counts: real carried items, supplies and field-acquired materials. */
  private fieldPouchCounts():Map<string,number>{
    const counts=new Map((this.options.pouch??[]).map(x=>[x.itemId,x.count]));
    for(const x of [...this.player.items,...this.player.coatings])counts.set(x.itemId,x.count);
    for(const g of this.hunt?.loot??[])if(isCarriedLoot(g.source))counts.set(g.itemId,(counts.get(g.itemId)??0)+1);
    if(this.errand&&!this.errand.delivered)for(const [id,n] of Object.entries(this.errand.bag))counts.set(id,(counts.get(id)??0)+n);
    return counts;
  }
  fieldPouchRoom(id:string):number{
    const counts=this.fieldPouchCounts(),have=counts.get(id)??0,limit=carryLimit(this.content,id);
    return Math.max(0,have>0||[...counts.values()].filter(n=>n>0).length<POUCH_SLOTS?limit-have:0);
  }
  get supplyAccessible():boolean{
    return !!this.options.classicBox&&this.hunt?.phase==='active'&&!this.hunt.closed&&this.field?.areas.some(a=>a.id===this.areaId&&a.kind==='camp')===true&&!this.player.drawn&&this.player.mode==='free';
  }
  supplyChoices():{itemId:string;count:number;room:number}[]{
    if(!this.supplyAccessible)return [];
    const fam=familyOf(this.player,this.content);
    return this.supplyStock.filter(x=>x.count>0).map(x=>{const it=this.content.items.get(x.itemId);return {...x,room:!it||(it.kind==='whet'&&!fam.edge)||(it.kind==='coating'&&!fam.coatable)?0:this.fieldPouchRoom(x.itemId)};});
  }
  takeSupply(id:string):void{
    const choice=this.supplyChoices().find(x=>x.itemId===id),stock=this.supplyStock.find(x=>x.itemId===id);
    if(!choice||!stock||choice.room<=0)return;
    const n=Math.min(choice.room,stock.count),it=this.content.items.get(id)!;
    const list=it.kind==='coating'?this.player.coatings:this.player.items,stack=list.find(x=>x.itemId===id);
    const prior=this.brought[id];
    if(prior&&stack)this.ownSpentFloor[id]=Math.max(this.ownSpentFloor[id]??0,Math.max(0,prior.own-stack.count));
    if(stack)stack.count+=n;else list.push({itemId:id,count:n});
    (this.brought[id]??={supplied:0,own:0}).supplied+=n;stock.count-=n;
  }

  /**
   * 自分で持ってきた道具のうち、使った数（支給品のぶんから先に使ったことにする）。
   * 狩りが終わった時に、これを持ち物から減らす。持ってこなかった道具（環弓の研磨石など）は入らない。
   */
  spentOwn(): ItemStack[] {
    const out: ItemStack[] = [];
    for (const [itemId, b] of Object.entries(this.brought)) {
      if (b.own <= 0) continue;
      const stack = this.player.items.find((s) => s.itemId === itemId) ?? this.player.coatings.find((s) => s.itemId === itemId);
      if (!stack) continue;
      const used = b.supplied + b.own - stack.count;
      const own = Math.min(b.own, Math.max(this.ownSpentFloor[itemId]??0, used - b.supplied));
      if (own > 0) out.push({ itemId, count: own });
    }
    return out;
  }

  // ---- フィールド ----

  /** プレイヤーが居るエリア（フィールドでなければ null）。 */
  area(): FieldAreaDef | null {
    return this.field?.areas.find((a) => a.id === this.areaId) ?? null;
  }

  /** モンスターが居るエリア（フィールドでなければ null）。大型は巡り方のエリア、幼体は居る位置のエリア。 */
  monsterArea(m: MonsterState): FieldAreaDef | null {
    if (!this.field) return null;
    if (m.roam) return this.field.areas.find((a) => a.id === m.roam!.areaId) ?? null;
    if (!m.herd) return null;
    const at = this.world.areaAt(m.pos.x, m.pos.z);
    return this.field.areas.find((a) => a === at) ?? null;
  }

  /** 群れが居るエリア（生きている仲間の多いエリア。フィールドでなければ null）。 */
  herdArea(g: HerdGroup): FieldAreaDef | null {
    return herdArea(g, this.field?.areas, this);
  }

  /** まだ倒していない標的（群れの依頼。種ごとに、生きている個体） */
  livingTargets(): MonsterState[] {
    if (!this.pack) return this.main && !this.main.dead && !this.main.captured ? [this.main] : [];
    const out: MonsterState[] = [];
    for (const t of this.targets) {
      if (this.slain(t.monsterId) >= t.count) continue;
      for (const g of this.herds) if (g.monsterId === t.monsterId) out.push(...livingMembers(g));
    }
    return out;
  }

  /** 出口に入ったら、行き先のエリアへ移る。力尽きて野営地へ戻った時も、居るエリアを合わせる。 */
  private stepExits(): void {
    const field = this.field!;
    const p = this.player;
    const here = this.area()!;
    const b = here.bounds;
    if (p.pos.x < b.minX - 1 || p.pos.x > b.maxX + 1 || p.pos.z < b.minZ - 1 || p.pos.z > b.maxZ + 1) {
      // 出口を通らずに別のエリアに居る（力尽きて野営地へ戻った）
      const now = field.areas.find((a) => p.pos.x >= a.bounds.minX && p.pos.x <= a.bounds.maxX && p.pos.z >= a.bounds.minZ && p.pos.z <= a.bounds.maxZ);
      if (now && now.id !== this.areaId) {
        const from = this.areaId;
        this.areaId = now.id;
        this.emit({ type: 'area_change', from, to: now.id });
      }
      return;
    }
    if (p.mode === 'dead') return;
    for (const e of here.exits) {
      if (Math.hypot(p.pos.x - e.x, p.pos.z - e.z) > e.r) continue;
      p.pos = { x: e.arrive.x, y: 0, z: e.arrive.z };
      p.pos.y = this.world.groundHeight(p.pos.x, p.pos.z);
      p.prevPos = { ...p.pos };
      p.yaw = e.arrive.yaw;
      p.prevYaw = p.yaw;
      const from = this.areaId;
      this.areaId = e.to;
      this.emit({ type: 'area_change', from, to: e.to });
      return;
    }
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
    // 砲弾が無い・冷却中で出せなかった砲撃（v0.80.0）は、当たらない
    if (run.extraAllowed === false) return;
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
        // 弾かれて行動が止まったら、この行動の残りの判定は見ない
        if (p.action !== run) return;
      }
    }
  }

  private applyPlayerHit(run: ActionRun, hw: HitWindowDef, t: number, m: MonsterState, partIndex: number, point: V3): void {
    const charge = run.def.charge;
    let scale = charge ? charge.coefficientScale[run.chargeLevel] ?? 1 : 1;
    // 猛り（双剣。v0.54.0）: 入っている間は、命中の係数に倍率を掛ける
    const fam = familyOf(this.player, this.content);
    if (this.player.demon) scale *= fam.demon?.damageScale ?? 1;
    // 響笛の旋律「攻撃」（v0.80.0）: 効いている間は、命中の係数に倍率を掛ける
    if (this.player.extraWeapon?.buffKind === 'attack' && this.player.extraWeapon.buff > 0) scale *= HORN_ATTACK_SCALE;
    // 気（太刀。v0.56.0）: 満ちている間は倍率を掛ける。気を使わない技が当たると、気がたまる（この命中の後から）
    const SP = fam.spirit;
    if (SP && this.player.spirit >= SP.max) scale *= SP.fullScale;
    const hitstop = hw.hitstopTicks + (charge ? charge.hitstopBonus[run.chargeLevel] ?? 0 : 0);
    run.hitstop = hitstop;
    // 刃の減り方は、溜めや猛りの倍率を掛ける前の、技そのものの係数で決める
    const bounced = this.dealPlayerDamage(m, partIndex, point, { actionId: run.def.actionId, windowId: hw.id, actionTick: t, motion: hw.damageCoefficient * scale, damageType: hw.damageType, hitstop, chargeLevel: run.chargeLevel, wearMotion: shellAction(run.def.actionId) ? undefined : hw.damageCoefficient, contact: hw.contact, fixedShell: shellAction(run.def.actionId) });
    if (SP && !run.def.spirit) {
      setSpirit(this.player, this.player.spirit + SP.gainPerHit, this);
      this.player.spiritIdle = 0;
    }
    if (bounced) this.bouncePlayer(run);
  }

  /** 攻撃が弾かれた: いまの行動を止めて、少しの間よろける（被弾ではないので、体力は減らず、無敵も付かない）。 */
  private bouncePlayer(run: ActionRun): void {
    const p = this.player;
    if (p.action !== run || p.mode !== 'action') return;
    p.action = null;
    p.guard = null;
    p.mode = 'hurt';
    p.hurt = { kind: 'bounce', tick: 0, duration: this.content.edge.bounce.recoilTicks, dirYaw: p.yaw + Math.PI };
  }

  /** プレイヤーの攻撃（武器・矢）が部位に当たった時の、ダメージの計算と記録。 */
  private dealPlayerDamage(
    m: MonsterState,
    partIndex: number,
    point: V3,
    h: {
      actionId: string;
      windowId: string;
      actionTick: number;
      /** 命中の最後の係数（溜め・双剣の猛り・矢の距離を掛けた後）。物理にも、属性・状態異常・気絶にも、これを 1 回だけ使う（v0.33.0） */
      motion: number;
      damageType: DamageType;
      hitstop: number;
      chargeLevel: number;
      /** 武器で直接当てた時の、技の係数（刃の減り方に使う）。矢は省く */
      wearMotion?: number;
      /** 盾で打った（v0.33.0）。武器の属性・状態異常は乗らない */
      contact?: 'shield';
      /** 砲撃（v0.80.0。銃槍）: 肉質・刃の状態・会心・武器の属性を使わない、決まった力の命中 */
      fixedShell?: boolean;
    },
  ): boolean {
    const p = this.player;
    const C = this.content;
    const weapon = weaponOf(p, C);
    const part = m.def.parts[partIndex]!;
    const g = this.gear;
    const R = ailmentRules(C);
    // 刃の状態: 武器で直接当てた時だけ（矢には無い）。段階で刃補正が変わり、硬い部位では弾かれる
    const E = C.edge;
    const famEdge = h.wearMotion !== undefined ? familyOf(p, C).edge : undefined;
    const stage = famEdge ? edgeStage(E, p.edge) : null;
    const hitzone = h.fixedShell ? 1 : (m.parts[partIndex]!.broken && part.brokenHitzone ? part.brokenHitzone : part.hitzone)[h.damageType];
    const bounced = !!stage && hitzone < stage.bounceBelow;
    // 会心は seed 付き乱数。1 命中につき必ず 1 回引き、乱数列を入力だけで決まるようにする。
    // 会心率は武器の会心 + 急所観察（物理の肉質が境目以上の時）。上限は critCap（v0.33.0）
    const roll = this.rng.next() * 100;
    const T = C.player;
    const chance = h.fixedShell ? 0 : critChance(C, weapon, g, hitzone);
    let crit = 0;
    if (chance > 0 && roll < chance) crit = 1;
    else if (chance < 0 && roll < -chance) crit = -1;
    // 武器の属性は、武器そのもので当てた時だけ（盾には乗らない）。部位の係数は属性ごと（弱点・耐性。複合は大きい方、弱点でなければ半分）
    const weaponHit = h.contact !== 'shield' && !h.fixedShell;
    const elementZone = weaponHit ? weaponElementZone(C, weapon, m.def, part) : 0;
    // 状態異常の睡眠: 覚ます最初の命中だけ wakeScale 倍（v0.33.0）
    const woke = !m.dead && wakeFromSleep(m.ailments, R);
    const damage = computeDamage({
      attack: weapon.attack * prepBonus(this.options.questId?this.options.hubPrep:null).attack,
      motion: h.motion,
      sharpness: h.fixedShell ? 1 : weapon.sharpnessModifier * (stage?.damageScale ?? 1),
      hitzone,
      crit: crit > 0 ? T.critMultiplier : crit < 0 ? 0.75 : 1,
      element: elementZone > 0 ? weapon.element.value * g.element : 0,
      elementMotion: h.motion,
      elementZone,
      questModifier: this.questModifier * (woke ? R.sleep.wakeScale : 1),
    });
    if (woke) this.emit({ type: 'monster_ailment', target: m.id, kind: 'sleep', on: false, woke: true });
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
      bounced,
      ...(elementZone > 0 ? { element: (weapon.element.type === 'compound' ? weapon.element.elements![0] : weapon.element.type) as ElementId } : {}),
    });
    applyDamageToMonster(m, partIndex, damage, h.damageType, this, g.partDamage);
    if (m.herd) herdHurt(m, this);
    // 状態異常（v0.33.0）: 武器の毒・麻痺・睡眠は、武器そのもので当てた時だけ。気絶は、打撃が頭に当たった時だけ
    if (!m.dead && !m.captured) {
      if (weaponHit && weapon.status) this.storeAilment(m, weapon.status.kind, ailmentAmount(weapon.status.potency, h.motion, g.status), point);
      if (h.damageType === 'blunt' && part.head) this.storeAilment(m, 'stun', ailmentAmount(R.stunPerMotion, h.motion, g.stun), point);
    }
    if (famEdge && stage) {
      // 当てるたびに減る。弾かれた時は余分に減る。防具の技能「刃持ち」で減り方が小さくなる（v0.33.0）
      p.edge = Math.max(0, p.edge - famEdge.wearPerMotion * (h.wearMotion ?? 0) * (bounced ? E.bounce.wearScale : 1) * g.edgeWear);
      const now = edgeStage(E, p.edge);
      if (now.id !== stage.id) this.emit({ type: 'edge', stage: now.id, value: p.edge });
    }
    return bounced;
  }

  /** 状態異常をためる（v0.33.0）。発症したら、効き目を始めて知らせる（硬直は、いまの技を止める） */
  private storeAilment(m: MonsterState, kind: StatusKind, amount: number, pos: V3): void {
    const R = ailmentRules(this.content);
    if (addAilment(m.ailments, R, kind, amount) !== 'triggered') return;
    if (kind === 'poison') startPoison(m.ailments, R, m.def.hp);
    else {
      m.action = null;
      m.attackEval = null;
    }
    this.emit({ type: 'monster_ailment', target: m.id, kind, on: true, pos: { ...pos } });
  }

  /**
   * 矢を放つ（環弓）。胸の前から放つ。
   * 手で狙っている間（v0.61.0。#19 の H05）は、狙いの線（目の点から狙いの向きへ）が最初に当たる所へ向けて飛ぶ（画面の照準の所）。
   * 狙っていなければ、体の向きへ水平に飛ぶ。操作補助の「弓の狙いの補助」が入なら、正面の近くの部位へ向きと高さを寄せる（v0.60.0 までの標準）。
   */
  spawnProjectiles(spec: ShootDef, run: ActionRun): void {
    const p = this.player;
    const level = Math.min(run.chargeLevel, spec.speed.length - 1);
    const gun = isBowgun(p.extraWeapon) && run.extraAmmo !== undefined;
    let from: V3 = { x: p.pos.x + Math.sin(p.yaw) * 0.5, y: p.pos.y + 1.35, z: p.pos.z + Math.cos(p.yaw) * 0.5 };
    let yaw = p.yaw;
    let pitch = 0;
    // 軽弩・重弩（v0.80.0）: 弾は銃口（武器の軌道の先）から、銃身の向きへ出る
    if (gun && run.def.weaponTrack) {
      const s = sampleTrack(this.content.tracks.get(run.def.weaponTrack)!, spec.tick);
      const len = familyOf(p, this.content).blade.to;
      from = toWorld({ x: s.grip.x + s.dir.x * len, y: s.grip.y + s.dir.y * len, z: s.grip.z + s.dir.z * len }, p.pos, p.yaw);
      yaw = p.yaw + yawOf(s.dir.x, s.dir.z);
      pitch = Math.atan2(s.dir.y, Math.hypot(s.dir.x, s.dir.z));
    }
    let best = Infinity;
    // 手で狙う（v0.61.0）: 環弓と同じく、軽弩・重弩（v0.80.0）も、狙いの線の当たる所へ飛ばす（銃口から）
    if (p.aim) {
      const t = aimTarget(this.monsters, this.world, aimEye(p.pos, p.aim.yaw), aimDir(p.aim.yaw, p.aim.pitch)).point;
      const dx = t.x - from.x, dz = t.z - from.z;
      yaw = yawOf(dx, dz);
      pitch = Math.atan2(t.y - from.y, Math.hypot(dx, dz));
    }
    for (const m of p.aim || !this.aimAssist ? [] : this.monsters) {
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
    let total = (spec.coefficient[level] ?? spec.coefficient[0] ?? 0.3) * (run.extraScale ?? 1);
    // ビン（v0.60.0）: 付けていれば、この射撃の矢の力に scale を掛け、1 本使う。使い切ると外れる
    let coated: string | undefined;
    if (p.coating) {
      const stack = p.coatings.find((s) => s.itemId === p.coating);
      const it = this.content.items.get(p.coating);
      if (stack && stack.count > 0 && it?.coating) {
        total *= it.coating.scale;
        coated = p.coating;
        stack.count--;
        if (stack.count <= 0) {
          this.emit({ type: 'coating', itemId: p.coating, on: false, left: 0, reason: 'out' });
          p.coating = null;
        }
      } else p.coating = null;
    }
    const arrow = (dy: number, dyaw: number, coefficient: number, pierce?: number): void => {
      const y = yaw + dyaw;
      const vel: V3 = { x: Math.sin(y) * Math.cos(pitch) * speed, y: Math.sin(pitch) * speed, z: Math.cos(y) * Math.cos(pitch) * speed };
      const pos = { x: from.x, y: from.y + dy, z: from.z };
      this.projectiles.push({ id: this.nextProjectile++, pos, prevPos: { ...pos }, vel, life: ARROW_LIFE_TICKS, travelled: 0, actionId: run.def.actionId, coefficient, level, ...(gun ? { kind: 'round' as const } : {}), ...(pierce ? { pierce, hitParts: [] } : {}) });
    };
    // 射ち方の表（v0.60.0）: 武器の shots、無ければ系統の shots。その段階の射ち方で、力の合計を矢へ分ける
    const shot = spec.table ? (weaponOf(p, this.content).shots ?? familyOf(p, this.content).shots)?.[level] : undefined;
    let count = spec.count;
    if (gun) {
      // 弾の種類（v0.80.0）: 貫通弾は 3 回まで当たる（1 回の力は小さい）、散弾は 3 つに分かれる、通常弾は 1 発
      if (run.extraAmmo === 1) {
        arrow(0, 0, total * ROUND_PIERCE_SHARE, 3);
        count = 1;
      } else if (run.extraAmmo === 2) {
        for (const angle of ROUND_SPREAD_YAW) arrow(0, angle, total * ROUND_SPREAD_SHARE);
        count = ROUND_SPREAD_YAW.length;
      } else {
        arrow(0, 0, total);
        count = 1;
      }
    } else if (shot?.type === 'rapid') {
      const share = RAPID_SHARE[shot.n] ?? [1];
      share.forEach((f, i) => arrow((i - (share.length - 1) / 2) * RAPID_GAP, 0, total * f));
      count = share.length;
    } else if (shot?.type === 'spread') {
      const fan = SPREAD_FAN[shot.n] ?? SPREAD_FAN[3]!;
      for (const f of fan) arrow(0, f.deg * DEG, total * f.share);
      count = fan.length;
    } else if (shot?.type === 'pierce') {
      arrow(0, 0, (total * PIERCE_TOTAL) / shot.n, shot.n);
      count = 1;
    } else {
      for (let i = 0; i < spec.count; i++) arrow(0, spec.count > 1 ? (i / (spec.count - 1) - 0.5) * spec.spreadDeg * DEG : 0, total);
    }
    this.emit({ type: 'shoot', count, level, pos: from, ...(shot ? { kind: shot.type } : {}), ...(coated ? { coated } : {}) });
  }

  private stepProjectiles(): void {
    if (this.projectiles.length === 0) return;
    const keep: Projectile[] = [];
    for (const a of this.projectiles) {
      a.prevPos = { ...a.pos };
      const next: V3 = { x: a.pos.x + a.vel.x, y: a.pos.y + a.vel.y, z: a.pos.z + a.vel.z };
      let done = false;
      for (const m of this.monsters) {
        if (done) break;
        if (m.dead || m.captured) continue;
        const all = monsterShapes(m);
        // 貫通の矢（v0.60.0）: 当たった部位を除いて、同じ区間をもう 1 度調べる（1 tick の間に、体の別の部位へも当たる）
        for (;;) {
          const shapes = a.hitParts?.length ? all.filter((sh) => !a.hitParts!.includes(`${m.id}:${sh.partIndex}`)) : all;
          const hit = sweepCapsule(a.pos, a.pos, next, next, ARROW_RADIUS, shapes);
          if (!hit) break;
          const dist = a.travelled + Math.hypot(hit.point.x - a.pos.x, hit.point.y - a.pos.y, hit.point.z - a.pos.z);
          this.dealPlayerDamage(m, hit.partIndex, hit.point, { actionId: a.actionId, windowId: 'arrow', actionTick: 0, motion: a.coefficient * (a.kind === 'round' ? roundDistanceScale(dist) : arrowDistanceScale(dist)), damageType: 'shot', hitstop: 2, chargeLevel: a.level });
          if (a.pierce !== undefined && a.pierce > 1 && !m.dead) {
            a.pierce--;
            a.hitParts!.push(`${m.id}:${hit.partIndex}`);
            continue;
          }
          done = true;
          break;
        }
      }
      if (done) continue;
      a.pos = next;
      a.travelled += Math.hypot(a.vel.x, a.vel.y, a.vel.z);
      a.life--;
      // 地面（v0.46.0 から起伏も）の下へ 0.5m 潜ったら消す
      if (a.life > 0 && a.pos.y > this.world.groundHeight(a.pos.x, a.pos.z) - 0.5) keep.push(a);
    }
    this.projectiles = keep;
  }

  private resolveMonsterAttacks(): void {
    const p = this.player;
    for (const m of this.monsters) {
      const ev = m.attackEval;
      if (!ev || m.dead || m.captured || m.trapTicks > 0 || activeControl(m.ailments) !== null) continue;
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
            // (物理 + 属性 × (1 - 耐性/100)) × 防御 × 段階 × 怒り を、小数のまま渡す（切り捨ては resolveIncomingHit で 1 回だけ。v0.33.0）
            baseDamage: (hw.baseDamage ?? 0) * incomingElementScale(this.content, m.def, this.gear) * this.monsterAttackScale * this.defenseScale * (m.enraged && m.def.rage ? m.def.rage.damageScale : 1),
            guardable: hw.guardable ?? true,
            guardCost: hw.guardCost ?? 20,
            reaction: hw.reaction ?? 'flinch',
            status: hw.status,
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
      p.edge.toFixed(4),
      p.mode,
      p.drawn ? 1 : 0,
      act(p.action),
      p.guard ? `${p.guard.phase}:${p.guard.tick}` : '-',
      p.hurt ? `${p.hurt.kind}:${p.hurt.tick}` : '-',
      `${p.ailment.poisonTicks}:${STATUS_KINDS.map((k) => p.ailment.build[k].toFixed(3)).join(',')}`,
      this.rng.state,
      this.totalDamage,
      this.hitCount,
      this.damageTaken,
    ];
    for (const m of this.monsters) {
      parts.push(m.hp, m.pos.x, m.pos.z, m.yaw, m.dead ? 1 : 0, m.staggerTicks, m.cooldown, act(m.action), m.aware ? 1 : 0, m.enraged ? m.enragedTicks : 0, m.rageAcc);
      if (m.spinegale) parts.push(m.spinegale.stamina,m.spinegale.remaining,m.spinegale.rank);
      if(m.frostald)parts.push(m.frostald.charge,m.frostald.capacity,m.frostald.rank);
      if(m.venolka)parts.push(m.venolka.charge,m.venolka.capacity,m.venolka.rank);
      for (const q of m.parts) parts.push(q.durability, q.broken ? 1 : 0, q.severed ? 1 : 0, q.severAcc, q.flinchAcc, q.flinchThreshold);
    }
    for (const h of this.hazards) parts.push(h.x, h.z, h.warn, h.active, h.hit ? 1 : 0);
    parts.push(p.itemIndex, p.items.map((s) => s.count).join(','), p.itemUse ? `${p.itemUse.itemId}:${p.itemUse.done ? 1 : 0}` : '-', p.lastSingle ? `${p.lastSingle.key}:${p.lastSingle.instanceId}` : '-', p.carving ? p.carving.source : '-');
    for (const m of this.monsters) parts.push(m.trapTicks, m.trapCount, m.tranq, m.tranqTicks, m.captured ? 1 : 0, m.markTicks, m.seenAreaId ?? '-');
    for (const m of this.monsters) {
      const a = m.ailments;
      parts.push(STATUS_KINDS.map((k) => `${a.gauge[k]}/${a.count[k]}/${a.idle[k]}/${a.ticks[k]}`).join(','), a.poisonTotal, a.poisonDone, a.grace);
    }
    for (const t of this.traps) parts.push(t.x, t.z, t.state, t.arm, t.life);
    parts.push(p.demon ? 1 : 0, p.spirit, p.spiritIdle);
    if (p.extraWeapon) parts.push(JSON.stringify(p.extraWeapon), p.action?.extraDone ? 1 : 0, p.action?.extraAllowed === false ? 0 : 1, p.action?.extraAmmo ?? -1, p.action?.extraScale ?? 1);
    if (p.coatings.length || p.coating) parts.push(p.coating ?? '-', p.coatings.map((s) => s.count).join(','));
    if (p.aim) parts.push(p.aim.yaw, p.aim.pitch);
    for (const a of this.projectiles) if (a.pierce !== undefined) parts.push(a.pierce, a.hitParts!.join(','));
    if (p.climb) parts.push(p.climb.def.id, p.climb.phase, p.climb.t, p.climb.h);
    if (p.vault) parts.push(p.vault.def.id, p.vault.t);
    if(this.options.classicBox)parts.push(this.supplyStock.map(x=>x.itemId+'='+x.count).join(','),JSON.stringify(this.brought),JSON.stringify(this.ownSpentFloor));
    if(this.fieldGather)parts.push(this.fieldGather.hash());
    if (this.errand) parts.push(this.errand.used.join(','), Object.entries(this.errand.bag).map(([k, v]) => `${k}=${v}`).join(','), this.errand.delivered ? 1 : 0, p.errandOp ? `${p.errandOp.target.kind}:${p.errandOp.done ? 1 : 0}` : '-');
    for (const a of this.projectiles) parts.push(a.pos.x, a.pos.y, a.pos.z, a.life);
    if (this.hunt) {
      const h = this.hunt;
      parts.push(h.phase, h.reason ?? '-', h.ticks, h.faints, h.returnTicks, h.closed ? 1 : 0, h.loot.map((g) => `${g.itemId}@${g.source}`).join(','), Object.entries(h.carves).map(([k, v]) => `${k}=${v}`).join(','));
    }
    for (const g of this.herds) parts.push(g.rng.state, g.anchor.x, g.anchor.z, g.restTicks, g.restIn, g.driftIn, g.travelIn, g.travel ? `${g.travel.to}:${g.travel.ticks}` : '-', g.areaId, g.quiet, g.temperamentSeed, g.engagedId ?? '-');
    for (const m of this.monsters) {
      const hm = m.herd;
      if (hm) parts.push(hm.mood, hm.ticks, hm.alarm, hm.idle, hm.tired, hm.stuck, hm.goal ? `${hm.goal.x},${hm.goal.z}` : '-', hm.temperament, hm.threatTicks, hm.reengageTicks, hm.retaliate ? 1 : 0, hm.attacksLeft, hm.countedActionId ?? '-', hm.fightOrigin ? `${hm.fightOrigin.x},${hm.fightOrigin.z}` : '-');
    }
    if (this.field) {
      parts.push(this.areaId);
      for (const m of this.monsters) if (m.roam) parts.push(m.roam.areaId, m.roam.state, m.roam.ticks, m.roam.routeIndex, m.roam.limping ? 1 : 0, m.roam.idle, m.roam.wander ? `${m.roam.wander.x},${m.roam.wander.z}` : '-', m.asleep ? 1 : 0, m.roam.feinted ? 1 : 0);
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
