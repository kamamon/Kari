// プレイヤーの状態機械。行動の可否はここ（ロジック）が決め、アニメーションの終了には頼らない。
// 状態: free（移動）/ action（データ定義の行動）/ guard / hurt / dead
import { DEG, angleDiff, forwardOf, smoothstep, turnToward, v3, yawOf, type V3 } from '../core/math';
import type { SeededRng } from '../core/seededRng';
import type { GearEffects } from './gear';
import { STATUS_KINDS, type ClimbDef, type FieldDef, type ActionDef, type CancelWindowDef, type Content, type GuardDef, type HazardDef, type ItemDef, type ItemStack, type MonsterDef, type ShootDef, type StatusHit, type StatusKind, type StatusTuning, type WeaponDef, type WeaponFamilyDef } from '../data/schemas';
import { inWindow, newRun, type ActionRun } from './action';
import { edgeStage } from './combat';
import type { SimEvent } from './events';
import { Btn, type InputFrame } from './inputFrame';
import { sampleCurve } from './tracks';
import type { Circle, World } from './world';
import type { ErrandTarget } from './errand';

/** climb = 登攀（v0.44.0。#19 の H07）: 取り付き・登る・登り切る・上から取り付く。その間は登攀が位置を持つ（重力・地面に合わせない） */
export type PlayerMode = 'free' | 'action' | 'guard' | 'hurt' | 'dead' | 'climb';
export type HurtKind = 'flinch' | 'knockdown' | 'bounce' | 'para' | 'sleep' | 'stun';
/** 動けなくなる状態異常 */
export const isDisabled = (p: PlayerState): boolean => p.mode === 'hurt' && (p.hurt?.kind === 'para' || p.hurt?.kind === 'sleep' || p.hurt?.kind === 'stun');
export type GuardPhase = 'start' | 'hold' | 'end' | 'recoil' | 'break';

export interface PlayerState {
  id: string;
  pos: V3;
  prevPos: V3;
  yaw: number;
  prevYaw: number;
  vel: { vy: number };
  grounded: boolean;
  hp: number;
  stamina: number;
  staminaDelay: number;
  exhausted: boolean;
  drawn: boolean;
  mode: PlayerMode;
  action: ActionRun | null;
  /** この tick に処理した行動の tick。命中判定はこれを見て 1 回だけ評価する。 */
  attackEval: { run: ActionRun; t: number } | null;
  guard: { phase: GuardPhase; tick: number } | null;
  /** bounce: 攻撃が弾かれて、よろけている（被弾ではない）。para / sleep / stun: 状態異常で動けない（v0.17.0） */
  hurt: { kind: HurtKind; tick: number; duration: number; dirYaw: number } | null;
  /** 状態異常（v0.17.0）: 毒の残り時間と、種類ごとにためた値 */
  ailment: { poisonTicks: number; build: Record<StatusKind, number> };
  deadTicks: number;
  invulnTicks: number;
  /**
   * 先行入力（押した tick から inputBufferTicks の間）。1 回の押下は 1 つの命令で、使ったら消える（v0.40.0 の入力の表。docs/spec.md の 32.2）。
   * combo は主と副の同時押し（複合入力）。主と副が両方残っている時も、複合の技を持つ系統では複合として扱う
   */
  buffer: { main: number; sub: number; dodge: number; weapon: number; item: number; special: number; combo: number };
  /**
   * 押し遅れの複合入力（v0.40.0）: 主か副の 1 つだけで技を始めた直後（COMBO_SLACK_TICKS 以内）に、もう片方が押されたら、
   * 同時押しの技へ替える。comboId は、その時に複合で出せた技
   */
  lastSingle: { instanceId: number; key: 'main' | 'sub'; comboId: string } | null;
  /** 勢い（双剣）の段階と、最後に振ってからの tick 数。勢いの無い武器では 0 のまま。 */
  momentum: number;
  momentumTicks: number;
  /** 刃の状態（0〜最大）。当てると減り、研磨石で最大へ戻る。狩りごとの値で、保存はしない。刃の状態の無い武器（環弓）では最大のまま */
  edge: number;
  /** 狩猟中の持ち物（依頼の支給品）。数が 0 になっても欄は残る。 */
  items: ItemStack[];
  itemIndex: number;
  /** 使っている途中の道具。効果が出る tick より前に妨害されると、消費しない。 */
  itemUse: { itemId: string; instanceId: number; done: boolean } | null;
  /** 剥ぎ取りの途中（source は剥ぎ取る対象） */
  carving: { source: string; instanceId: number; done: boolean } | null;
  /** 採る・納める途中（狩らない依頼。v0.27.0）。品が入る tick より前に止まると、何も起きない */
  errandOp: { target: ErrandTarget; instanceId: number; done: boolean } | null;
  sprinting: boolean;
  /** 見た目用の現在速度 (m/s) */
  moveSpeed: number;
  weaponId: string;
  /**
   * 登攀（v0.44.0）。phase: mount = 地面から壁へ取り付く / down = 上の段から向きを変えて壁へ取り付く / climb = 壁にいる / exit = 上の段へ登り切る。
   * h は登り口の地面からの足の高さ。from は取り付き・登り切りを始めた時の位置と向き
   */
  climb: { def: ClimbDef; phase: 'mount' | 'down' | 'climb' | 'exit'; t: number; h: number; from: { x: number; y: number; z: number; yaw: number } } | null;
  /**
   * 段の端から降りている（v0.45.0。#19 の H07 の降下）: 足元が DROP_MIN より深い所へ歩いて出た時。落ちる間は、出た時の水平の動き（drift。m/tick）のまま進み、
   * 入力は受けない（攻撃・道具・回避・登攀へつながない）。top は落ち始めた高さ
   */
  drop: { top: number; drift: { x: number; z: number }; ticks: number } | null;
  /** 着地の立て直し（v0.45.0）。高い所から降りて地面に着いた後、ticks の間は動けない（total は始めの長さ） */
  land: { ticks: number; total: number } | null;
}

export interface SimCtx {
  content: Content;
  /** 装備の効き目（v0.33.0。防具の技能と耐性。src/game/gear.ts）。狩りの間は変わらない */
  gear: GearEffects;
  world: World;
  /** フィールド（エリアに分かれた狩場）。そうでなければ null */
  field: FieldDef | null;
  rng: SeededRng;
  tick: number;
  emit(ev: SimEvent): void;
  newInstanceId(): number;
  /** プレイヤーが通り抜けられない円（生きている大型の胴体など） */
  blockers(): Circle[];
  /** 落下物などを出す。位置は target を基準にこの時点で固定する。owner は出した種（属性を持つ種なら、属性の分がハンターの耐性で変わる。v0.33.0） */
  spawnHazards(def: HazardDef, target: V3, origin?: V3, owner?: MonsterDef): void;
  /** いまこの道具を使い始められるか（罠は狩猟中に 1 つまで、など） */
  canUseItem(item: ItemDef): boolean;
  /** 道具の効果を出す。効果が出なかった時は false を返し、道具は減らない。 */
  applyItem(item: ItemDef): boolean;
  /** いま剥ぎ取れる対象（近くにあり、回数が残っている）。無ければ null。 */
  carveTarget(): string | null;
  /** 剥ぎ取り 1 回分を確定する */
  carve(source: string): void;
  /** 狩らない依頼で、いま攻撃ボタンでできること（採る・納める）。無ければ null */
  errandTarget(): ErrandTarget | null;
  /** 採る・納める行動が、品の入る tick まで進んだ */
  errandDo(t: ErrandTarget): void;
  /** 矢を放つ（環弓）。向きと狙いは、この時点のプレイヤーと敵の位置から決める。 */
  spawnProjectiles(spec: ShootDef, run: ActionRun): void;
}

/** 剥ぎ取りの行動。素材は recovery の始まりで手に入る。 */
const CARVE_ACTION = 'player.common.carve';

/** 選んでいる道具を、いま使えない理由（使えるなら null）。 */
function itemBlock(p: PlayerState, ctx: SimCtx): 'empty' | 'not_now' | 'no_need' | null {
  const stack = p.items[p.itemIndex];
  const item = stack ? ctx.content.items.get(stack.itemId) : undefined;
  if (!stack || !item || stack.count <= 0) return 'empty';
  if (item.kind === 'whet') {
    if (!familyOf(p, ctx.content).edge) return 'not_now';
    if (p.edge >= ctx.content.edge.max) return 'no_need';
  }
  return ctx.canUseItem(item) ? null : 'not_now';
}

/** 選んでいる道具（無ければ undefined） */
function selectedItem(p: PlayerState, ctx: SimCtx): ItemDef | undefined {
  const stack = p.items[p.itemIndex];
  return stack ? ctx.content.items.get(stack.itemId) : undefined;
}

/** 選んでいる道具を使い始める。使えない時は理由を知らせて false。 */
function tryUseItem(p: PlayerState, ctx: SimCtx, keepDrawn = false): boolean {
  const why = itemBlock(p, ctx);
  if (why) {
    ctx.emit({ type: 'item_fail', reason: why });
    return false;
  }
  const item = selectedItem(p, ctx)!;
  const run = startAction(p, item.useActionId, ctx);
  run.keepDrawn = keepDrawn;
  // 防具の技能「道具整備」（v0.33.0）: 整備の道具（研磨石）を使う時間だけが短くなる（効き目は変えない）
  if (item.maintenance && ctx.gear.itemTime < 1) run.speed = ctx.gear.itemTime;
  p.itemUse = { itemId: item.id, instanceId: run.instanceId, done: false };
  ctx.emit({ type: 'item_use', itemId: item.id, pos: { ...p.pos } });
  return true;
}

const MOVE_DEADZONE = 0.12;
/** 押し遅れの複合入力を受け付ける、技を始めてからの tick 数（v0.40.0。Kari の仮の値。判定の始まるずっと前） */
export const COMBO_SLACK_TICKS = 3;

export function createPlayer(content: Content, spawn: { x: number; z: number; yaw: number }, weaponId: string, supplies: readonly ItemStack[] = []): PlayerState {
  const T = content.player;
  const pos = v3(spawn.x, 0, spawn.z);
  // 研磨石は、刃の状態のある武器でだけ持つ（環弓では使えないので、持たせない）
  const fam = content.families.get(content.weapons.get(weaponId)!.family)!;
  const carried = supplies.filter((s) => fam.edge || content.items.get(s.itemId)?.kind !== 'whet');
  return {
    id: 'player',
    pos,
    prevPos: { ...pos },
    yaw: spawn.yaw,
    prevYaw: spawn.yaw,
    vel: { vy: 0 },
    grounded: true,
    hp: T.maxHp,
    stamina: T.maxStamina,
    staminaDelay: 0,
    exhausted: false,
    drawn: false,
    mode: 'free',
    action: null,
    attackEval: null,
    guard: null,
    hurt: null,
    ailment: freshAilment(),
    deadTicks: 0,
    invulnTicks: 0,
    buffer: { main: 0, sub: 0, dodge: 0, weapon: 0, item: 0, special: 0, combo: 0 },
    lastSingle: null,
    momentum: 0,
    momentumTicks: 0,
    edge: content.edge.max,
    items: carried.map((s) => ({ itemId: s.itemId, count: s.count })),
    itemIndex: 0,
    itemUse: null,
    carving: null,
    errandOp: null,
    sprinting: false,
    moveSpeed: 0,
    weaponId,
    climb: null,
    drop: null,
    land: null,
  };
}

export const weaponOf = (p: PlayerState, c: Content): WeaponDef => c.weapons.get(p.weaponId)!;

const freshAilment = (): PlayerState['ailment'] => ({ poisonTicks: 0, build: { poison: 0, para: 0, sleep: 0, stun: 0 } });

/** player.json に status が無い時の値 */
export const DEFAULT_STATUS: StatusTuning = {
  threshold: 100,
  decayPerSec: 4,
  poison: { ticks: 900, intervalTicks: 45, damage: 2 },
  para: { ticks: 150 },
  sleep: { ticks: 540 },
  stun: { ticks: 210 },
};
export const statusTuning = (c: Content): StatusTuning => c.player.status ?? DEFAULT_STATUS;

/**
 * 状態異常をためる。閾値に達すると発症し、ためた値は 0 へ戻る。
 * 毒は体力が減っていくだけ。麻痺・睡眠・気絶は、その間は動けない（いまの行動・防御・怯みは止まる）。
 */
export function applyStatus(p: PlayerState, s: StatusHit, ctx: SimCtx): void {
  if (p.mode === 'dead' || s.power <= 0) return;
  const S = statusTuning(ctx.content);
  const b = p.ailment.build;
  // 防具の技能「個別状態耐性」（v0.33.0）: 発症までにためる量が増える
  const thr = S.threshold * ctx.gear.statusResist[s.kind];
  b[s.kind] = Math.min(thr, b[s.kind] + s.power);
  if (b[s.kind] < thr) return;
  b[s.kind] = 0;
  if (s.kind === 'poison') {
    if (p.ailment.poisonTicks <= 0) ctx.emit({ type: 'status', kind: 'poison', on: true });
    p.ailment.poisonTicks = S.poison.ticks;
    return;
  }
  p.action = null;
  p.guard = null;
  p.itemUse = null;
  p.carving = null;
  p.mode = 'hurt';
  p.hurt = { kind: s.kind, tick: 0, duration: S[s.kind].ticks, dirYaw: p.yaw };
  ctx.emit({ type: 'status', kind: s.kind, on: true });
}

/** 毎 tick: 毒の減り、ためた値の自然な減り */
function stepAilment(p: PlayerState, ctx: SimCtx): void {
  const a = p.ailment;
  if (p.mode === 'dead') return;
  const S = statusTuning(ctx.content);
  const decay = S.decayPerSec / 60;
  for (const k of STATUS_KINDS) if (a.build[k] > 0) a.build[k] = Math.max(0, a.build[k] - decay);
  if (a.poisonTicks > 0) {
    a.poisonTicks--;
    if (a.poisonTicks % S.poison.intervalTicks === 0 && p.hp > 1) p.hp = Math.max(1, p.hp - S.poison.damage);
    if (a.poisonTicks === 0) ctx.emit({ type: 'status', kind: 'poison', on: false });
  }
}
export const familyOf = (p: PlayerState, c: Content): WeaponFamilyDef => c.families.get(weaponOf(p, c).family)!;

export function isGuarding(p: PlayerState, g: GuardDef | null): boolean {
  if (p.mode !== 'guard' || !p.guard || !g) return false;
  const ph = p.guard.phase;
  return ph === 'hold' || ph === 'recoil' || (ph === 'start' && p.guard.tick >= g.activeFromTick);
}

export function isInvulnerable(p: PlayerState): boolean {
  if (p.invulnTicks > 0) return true;
  // attackEval はこの tick に処理した行動 tick を指す（回避の無敵区間はここで判定）
  const ev = p.attackEval;
  if (ev && ev.run.def.invulnerable) return ev.run.def.invulnerable.some((w) => inWindow(ev.t, w));
  return false;
}

function consume(p: PlayerState, key: keyof PlayerState['buffer']): boolean {
  if (p.buffer[key] > 0) {
    p.buffer[key] = 0;
    return true;
  }
  return false;
}

function spendStamina(p: PlayerState, amount: number, ctx: SimCtx): void {
  p.stamina = Math.max(0, p.stamina - amount);
  p.staminaDelay = ctx.content.player.staminaRegenDelayTicks;
}

/** 回避の行動か（共通の転がる回避と、武器ごとの回避。長尖槍の跳びなど） */
function isDodgeAction(p: PlayerState, actionId: string, ctx: SimCtx): boolean {
  return actionId === ctx.content.player.rollActionId || actionId === familyOf(p, ctx.content).actions.dodge;
}

/** 行動のスタミナの消費。回避は、防具の技能「身軽」で減る（v0.33.0。無敵の区間・動く距離は変えない） */
export function staminaCostOf(p: PlayerState, def: ActionDef, ctx: SimCtx): number {
  const c = def.staminaCost ?? 0;
  if (c <= 0) return 0;
  return isDodgeAction(p, def.actionId, ctx) ? c * ctx.gear.dodgeStamina : c;
}

export function startAction(p: PlayerState, actionId: string, ctx: SimCtx): ActionRun {
  const def = ctx.content.actions.get(actionId)!;
  const run = newRun(def, ctx.newInstanceId(), p.yaw);
  p.mode = 'action';
  p.action = run;
  p.guard = null;
  p.hurt = null;
  const cost = staminaCostOf(p, def, ctx);
  if (cost > 0) spendStamina(p, cost, ctx);
  // 勢い（双剣）: 始めた時の段階で、この行動の速さと威力が決まる。大技は段階をすべて使う。
  const M = familyOf(p, ctx.content).momentum;
  if (M && def.momentum) {
    run.momentumLevel = p.momentum;
    run.speed = M.speedScale[p.momentum] ?? 1;
    p.momentumTicks = 0;
    if (def.momentum.spendScale && p.momentum > 0) {
      p.momentum = 0;
      ctx.emit({ type: 'momentum', level: 0 });
    }
  }
  ctx.emit({ type: 'action_start', actor: p.id, actionId, instanceId: run.instanceId });
  return run;
}

function tryStartRoll(p: PlayerState, inp: InputFrame, ctx: SimCtx): boolean {
  const T = ctx.content.player;
  // 回避の行動は武器ごと（長尖槍は短い跳び）。無ければ共通の転がる回避。
  const dodgeId = familyOf(p, ctx.content).actions.dodge ?? T.rollActionId;
  const def = ctx.content.actions.get(p.drawn ? dodgeId : T.rollActionId)!;
  if (p.stamina < staminaCostOf(p, def, ctx)) {
    ctx.emit({ type: 'stamina_empty' });
    return false;
  }
  const mag = Math.hypot(inp.moveX, inp.moveZ);
  const dir = mag > MOVE_DEADZONE ? yawOf(inp.moveX, inp.moveZ) : p.yaw;
  let dirIndex = 0;
  if (p.drawn) {
    // 抜刀中は体の向きを保ち、入力方向へ転がる。見た目は前後左右の近い方を使う。
    const rel = angleDiff(p.yaw, dir);
    dirIndex = ((Math.round(rel / (Math.PI / 2)) % 4) + 4) % 4;
  } else {
    p.yaw = dir;
  }
  const run = startAction(p, def.actionId, ctx);
  run.moveYaw = dir;
  run.fixedDir = true;
  run.dirIndex = dirIndex;
  return true;
}

/** 技の名前（cancelNames）を、どのボタンで出すか */
function cancelKey(fam: WeaponFamilyDef, name: string): 'main' | 'sub' | 'special' | 'combo' | null {
  const actionId = fam.cancelNames[name];
  if (!actionId) return null;
  return fam.cancelButtons?.[name] ?? (actionId === fam.actions.main ? 'main' : actionId === fam.actions.sub ? 'sub' : actionId === fam.actions.combo ? 'combo' : null);
}

/** 主と副の同時押しを待っているか（複合の技を持つ系統だけ。主と副が両方残っている時も含む） */
function comboIntent(p: PlayerState, fam: WeaponFamilyDef): boolean {
  if (!fam.actions.combo) return false;
  return p.buffer.combo > 0 || (p.buffer.main > 0 && p.buffer.sub > 0);
}

/** 主・副・複合の先行入力を、まとめて使い切る（1 押しを 2 つの技に使わない） */
function clearAttackBuffers(p: PlayerState): void {
  p.buffer.main = 0;
  p.buffer.sub = 0;
  p.buffer.combo = 0;
}

function tryCancelInto(p: PlayerState, name: string, cw: CancelWindowDef, inp: InputFrame, ctx: SimCtx): boolean {
  if (name === 'roll') {
    return p.buffer.dodge > 0 && consume(p, 'dodge') && tryStartRoll(p, inp, ctx);
  }
  const fam = familyOf(p, ctx.content);
  const actionId = fam.cancelNames[name];
  const key = cancelKey(fam, name);
  if (!actionId || !key) return false;
  if (key === 'combo' ? !comboIntent(p, fam) : p.buffer[key] <= 0) return false;
  const def = ctx.content.actions.get(actionId);
  if (def && p.stamina < staminaCostOf(p, def, ctx)) return false;
  if (key === 'combo' || key === 'main' || key === 'sub') {
    // この区間で複合の技も出せるなら、押し遅れのもう片方で替えられるように覚えておく
    const comboName = key !== 'combo' ? cw.into.find((n) => cancelKey(fam, n) === 'combo') : undefined;
    clearAttackBuffers(p);
    const run = startAction(p, actionId, ctx);
    p.lastSingle = comboName && (key === 'main' || key === 'sub') ? { instanceId: run.instanceId, key, comboId: fam.cancelNames[comboName]! } : null;
    return true;
  }
  consume(p, key);
  startAction(p, actionId, ctx);
  return true;
}

/** 区間の中で、つなげられる技を試す。複合の入力を待っている時は、複合の技を先に試す（1 つの押下で単発の技を先に出さない） */
function tryCancels(p: PlayerState, def: ActionDef, run: ActionRun, inp: InputFrame, ctx: SimCtx): boolean {
  const fam = familyOf(p, ctx.content);
  const combo = comboIntent(p, fam);
  for (const cw of def.cancelWindows) {
    if (!inWindow(run.tick, cw)) continue;
    const names = combo ? [...cw.into.filter((n) => cancelKey(fam, n) === 'combo'), ...cw.into.filter((n) => cancelKey(fam, n) !== 'combo')] : cw.into;
    for (const name of names) if (tryCancelInto(p, name, cw, inp, ctx)) return true;
  }
  return false;
}

function finishAction(p: PlayerState): void {
  const fin = p.action?.def.onFinish;
  if (fin === 'drawn_idle') p.drawn = true;
  else if (fin === 'sheathed_idle' && !p.action?.keepDrawn) {
    p.drawn = false;
    p.momentum = 0; // 納刀で勢いは消える
  }
  p.mode = 'free';
  p.action = null;
}

const inHitWindow = (def: ActionDef, t: number): boolean => def.hitWindows.some((hw) => inWindow(t, hw));

/** 行動の最中にスティックで歩く（環弓の引き絞り）。 */
function freeMove(p: PlayerState, def: ActionDef, t: number, inp: InputFrame, ctx: SimCtx): void {
  const fm = def.freeMove;
  if (!fm || t < (fm.from ?? 0) || t >= (fm.to ?? def.durationTicks)) return;
  const mag = Math.min(1, Math.hypot(inp.moveX, inp.moveZ));
  if (mag <= MOVE_DEADZONE) return;
  const want = yawOf(inp.moveX, inp.moveZ);
  // 体ごと回る区間（回し薙ぎ）では、向きは変えずに歩くだけ
  const spinning = !!def.spin && t >= def.spin.from && t < def.spin.to;
  if (!spinning) p.yaw = turnToward(p.yaw, want, (fm.turnDegPerSec * DEG) / 60);
  const d = (fm.speed * mag) / 60;
  ctx.world.move(p.pos, ctx.content.player.radius, Math.sin(want) * d, Math.cos(want) * d, ctx.blockers());
  p.moveSpeed = fm.speed * mag;
}

function stepAction(p: PlayerState, inp: InputFrame, ctx: SimCtx, depth = 0): void {
  const run = p.action!;
  run.advanced = false;
  if (run.hitstop > 0) {
    run.hitstop--;
    return;
  }
  const def = run.def;
  const T = ctx.content.player;
  const mag = Math.hypot(inp.moveX, inp.moveZ);

  const turn = (): void => {
    if (def.turning && run.tick < def.turning.untilTick && !run.fixedDir && mag > MOVE_DEADZONE) {
      p.yaw = turnToward(p.yaw, yawOf(inp.moveX, inp.moveZ), (def.turning.maxDegreesPerSecond * DEG) / 60);
    }
  };

  // 溜め: holdTick で止まり、ボタンを離す（または上限、スタミナ切れ）で続きへ進む
  if (def.charge && run.tick === def.charge.holdTick && !run.released) {
    const b = def.charge.button === 'main' ? Btn.Main : Btn.Sub;
    const drain = def.charge.staminaPerSec ?? 0;
    if (inp.held & b && run.chargeTicks < def.charge.maxHoldTicks && (drain <= 0 || p.stamina > 0)) {
      run.chargeTicks++;
      if (drain > 0) spendStamina(p, drain / 60, ctx);
      let level = 0;
      for (const lt of def.charge.levelTicks) if (run.chargeTicks >= lt) level++;
      if (level > run.chargeLevel) {
        run.chargeLevel = level;
        ctx.emit({ type: 'charge_level', level, pos: { ...p.pos } });
      }
      // 溜めの最中に回避へ移れる技もある（環弓）
      if (depth === 0 && tryCancels(p, def, run, inp, ctx)) return stepAction(p, inp, ctx, 1);
      turn();
      freeMove(p, def, run.tick, inp, ctx);
      return;
    }
    run.released = true;
  }

  // キャンセルは定義した区間でだけ受け付ける
  if (depth === 0 && tryCancels(p, def, run, inp, ctx)) {
    stepAction(p, inp, ctx, 1);
    return;
  }

  turn();
  freeMove(p, def, run.tick, inp, ctx);

  // 行動の tick を 1 つ進める。勢いで速くなっている時（双剣）は、判定の時間枠の外でだけ、もう 1 tick 進めることがある。
  const one = (): void => {
    const t = run.tick;
    if (def.rootMotion.mode === 'controller' && def.rootMotion.curveId) {
      const curve = ctx.content.curves.get(def.rootMotion.curveId)!;
      const d = sampleCurve(curve, t + 1) - sampleCurve(curve, t);
      if (d !== 0) {
        const f = forwardOf(run.fixedDir ? run.moveYaw : p.yaw);
        ctx.world.move(p.pos, T.radius, f.x * d, f.z * d, ctx.blockers());
      }
    }
    // 体ごと回る（spin を持つ技。v0.5.0 の時点では使う技が無い。旋鎌で使っていた）
    const sp = def.spin;
    if (sp && t >= sp.from && t < sp.to) {
      const y = p.yaw + (sp.degrees * DEG) / (sp.to - sp.from);
      p.yaw = Math.atan2(Math.sin(y), Math.cos(y));
    }
    for (const ev of def.events) {
      if (ev.tick === t) ctx.emit({ type: 'action_event', actor: p.id, kind: ev.type, id: ev.id, pos: { ...p.pos } });
    }
    for (const sh of def.shoot ?? []) if (sh.tick === t) ctx.spawnProjectiles(sh, run);
    p.attackEval = { run, t };
    run.advanced = true;
    run.tick++;
  };
  one();
  if (run.speed < 1) {
    run.speedAcc += 1 / run.speed - 1;
    while (run.speedAcc >= 1 && run.tick < def.durationTicks && !inHitWindow(def, run.tick - 1) && !inHitWindow(def, run.tick)) {
      run.speedAcc -= 1;
      one();
    }
  }
  if (run.tick >= def.durationTicks) finishAction(p);
}

// ---- 登攀（v0.44.0。#19 の H07。docs/spec.md の 32.9。値は Kari の仮の値）----
/** 登る速さ・下りる速さ（m/tick） */
export const CLIMB_UP = 1.5 / 60;
export const CLIMB_DOWN = 2.1 / 60;
/** 地面から取り付く・上の段から取り付く・登り切る、の長さ（tick） */
export const CLIMB_MOUNT_TICKS = 14;
export const CLIMB_DOWN_TICKS = 30;
export const CLIMB_EXIT_TICKS = 36;
/** 上の端からこれだけ下まで登ると、登り切る（手が縁に掛かる高さ） */
export const CLIMB_EXIT_BELOW = 1.45;
/** 壁にいる時の、壁の面から体の中心までの距離 */
const CLIMB_OFF = 0.38;
/** 降下（v0.45.0）: 足元がこれより深い所へ歩いて出ると、降下になる（低い段の上り下りは、ふつうに歩く） */
export const DROP_MIN = 1.0;
/** 着地の立て直し: 降りた高さがこれより低ければ LAND_TICKS、高ければ LAND_TICKS_HIGH（Kari の仮の値） */
export const LAND_HIGH = 2.5;
export const LAND_TICKS = 10;
export const LAND_TICKS_HIGH = 20;

/** 壁にいる時の位置（xz） */
function climbSpot(d: ClimbDef): { x: number; z: number } {
  return { x: d.x + Math.sin(d.yaw) * (d.faceDist - CLIMB_OFF), z: d.z + Math.cos(d.yaw) * (d.faceDist - CLIMB_OFF) };
}

/** 取り付く。武器は背へ納める（2G と同じく、武器を納めて登る） */
function startClimb(p: PlayerState, d: ClimbDef, dir: 'up' | 'down', ctx: SimCtx): void {
  for (const k of Object.keys(p.buffer) as (keyof PlayerState['buffer'])[]) p.buffer[k] = 0;
  p.lastSingle = null;
  p.drawn = false;
  p.sprinting = false;
  p.mode = 'climb';
  p.vel.vy = 0;
  const base = ctx.world.groundHeight(d.x, d.z);
  p.climb = { def: d, phase: dir === 'up' ? 'mount' : 'down', t: 0, h: dir === 'up' ? 0 : d.top - base - CLIMB_EXIT_BELOW, from: { x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: p.yaw } };
  ctx.emit({ type: 'climb', phase: 'start', climbId: d.id, dir });
}

/** 登攀を終えて、地面（または上の段）に立つ */
function endClimb(p: PlayerState, ctx: SimCtx, how: 'top' | 'bottom' | 'release'): void {
  const id = p.climb?.def.id ?? '';
  p.climb = null;
  p.mode = 'free';
  p.vel.vy = 0;
  p.moveSpeed = 0;
  // 手を離した所が高ければ、その場から降下（v0.45.0。着地で立て直す。攻撃で落とされた時は、この後の被弾が降下を消す）
  if (how === 'release' && p.pos.y - ctx.world.groundHeight(p.pos.x, p.pos.z) > DROP_MIN - 0.05) p.drop = { top: p.pos.y, drift: { x: 0, z: 0 }, ticks: 0 };
  ctx.emit({ type: 'climb', phase: how, climbId: id, dir: how === 'top' ? 'up' : 'down' });
}

function stepClimb(p: PlayerState, inp: InputFrame, ctx: SimCtx): void {
  const c = p.climb!;
  const d = c.def;
  const base = ctx.world.groundHeight(d.x, d.z);
  const spot = climbSpot(d);
  c.t++;
  p.moveSpeed = 0;
  if (c.phase === 'mount' || c.phase === 'down') {
    const n = c.phase === 'mount' ? CLIMB_MOUNT_TICKS : CLIMB_DOWN_TICKS;
    const u = smoothstep(Math.min(1, c.t / n));
    p.pos.x = c.from.x + (spot.x - c.from.x) * u;
    p.pos.z = c.from.z + (spot.z - c.from.z) * u;
    p.pos.y = c.from.y + (base + c.h - c.from.y) * u;
    p.yaw = turnToward(c.from.yaw, d.yaw, Math.PI * u + 1e-9);
    if (c.t >= n) {
      c.phase = 'climb';
      c.t = 0;
      p.yaw = d.yaw;
    }
    return;
  }
  if (c.phase === 'exit') {
    const u = smoothstep(Math.min(1, c.t / CLIMB_EXIT_TICKS));
    const uy = smoothstep(Math.min(1, c.t / (CLIMB_EXIT_TICKS * 0.6)));
    p.pos.x = c.from.x + (d.exit.x - c.from.x) * u;
    p.pos.z = c.from.z + (d.exit.z - c.from.z) * u;
    p.pos.y = c.from.y + (d.top - c.from.y) * uy;
    if (c.t >= CLIMB_EXIT_TICKS) {
      p.pos = { x: d.exit.x, y: d.top, z: d.exit.z };
      endClimb(p, ctx, 'top');
    }
    return;
  }
  // 壁にいる: 回避で手を離す（落ちる）。スティックを壁へ押すと登り、引くと下りる（カメラから見た向きを、壁の向きへ写す）
  if (inp.pressed & Btn.Dodge) {
    p.pos.x -= Math.sin(d.yaw) * 0.25;
    p.pos.z -= Math.cos(d.yaw) * 0.25;
    endClimb(p, ctx, 'release');
    return;
  }
  const push = inp.moveX * Math.sin(d.yaw) + inp.moveZ * Math.cos(d.yaw);
  if (push > 0.3) c.h += CLIMB_UP * Math.min(1, push);
  else if (push < -0.3) c.h -= CLIMB_DOWN * Math.min(1, -push);
  p.moveSpeed = push > 0.3 ? CLIMB_UP * 60 : push < -0.3 ? CLIMB_DOWN * 60 : 0;
  p.pos.x = spot.x;
  p.pos.z = spot.z;
  p.yaw = d.yaw;
  if (base + c.h >= d.top - CLIMB_EXIT_BELOW) {
    c.h = d.top - base - CLIMB_EXIT_BELOW;
    p.pos.y = base + c.h;
    c.phase = 'exit';
    c.t = 0;
    c.from = { x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: p.yaw };
    ctx.emit({ type: 'climb', phase: 'exit', climbId: d.id, dir: 'up' });
    return;
  }
  if (c.h <= 0) {
    // 下まで下りた: 壁から半歩離れて地面に立つ
    p.pos = { x: spot.x - Math.sin(d.yaw) * 0.3, y: base, z: spot.z - Math.cos(d.yaw) * 0.3 };
    endClimb(p, ctx, 'bottom');
    return;
  }
  p.pos.y = base + c.h;
}

/**
 * 降下と着地（v0.45.0。#19 の H07。docs/spec.md の 32.10）: 歩いて（自由な状態で）段の端から出て、足元が DROP_MIN より深ければ降下。
 * 地面に着いたら、降りた高さで立て直しの長さを決める（LAND_HIGH より高いと長い）。被弾・技の途中の落下は、それぞれの状態のまま（降下にしない）
 */
function stepDrop(p: PlayerState, wasGrounded: boolean, ctx: SimCtx): void {
  if (p.mode !== 'free') {
    p.drop = null;
    return;
  }
  if (p.drop) {
    p.drop.ticks++;
    if (!p.grounded) return;
    const height = p.drop.top - p.pos.y;
    p.drop = null;
    const total = height >= LAND_HIGH ? LAND_TICKS_HIGH : LAND_TICKS;
    p.land = { ticks: total, total };
    ctx.emit({ type: 'land', height: Math.round(height * 100) / 100, pos: { ...p.pos } });
    return;
  }
  if (wasGrounded && !p.grounded && p.pos.y - ctx.world.groundHeight(p.pos.x, p.pos.z) > DROP_MIN - 0.05) {
    // 出た時の水平の動き（この tick の移動）を保つ。止まって出ることは無いが、念のため前へ少し
    const dx = p.pos.x - p.prevPos.x, dz = p.pos.z - p.prevPos.z;
    const f = forwardOf(p.yaw);
    const d = Math.hypot(dx, dz);
    const drift = d > 0.01 ? { x: dx, z: dz } : { x: f.x * 0.03, z: f.z * 0.03 };
    p.drop = { top: p.prevPos.y, drift, ticks: 0 };
    p.sprinting = false;
    ctx.emit({ type: 'drop', from: Math.round(p.prevPos.y * 100) / 100 });
  }
}

function stepFree(p: PlayerState, inp: InputFrame, ctx: SimCtx): void {
  const T = ctx.content.player;
  const fam = familyOf(p, ctx.content);

  // 降下の間（v0.45.0）: 出た時の水平の動きのまま進む。入力は受けない（押した入力も残さない）
  if (p.drop) {
    for (const k of Object.keys(p.buffer) as (keyof PlayerState['buffer'])[]) p.buffer[k] = 0;
    ctx.world.move(p.pos, T.radius, p.drop.drift.x, p.drop.drift.z, ctx.blockers());
    p.moveSpeed = Math.hypot(p.drop.drift.x, p.drop.drift.z) * 60;
    return;
  }
  // 着地の立て直し（v0.45.0）: しゃがんで受け止める間は動けない
  if (p.land) {
    for (const k of Object.keys(p.buffer) as (keyof PlayerState['buffer'])[]) p.buffer[k] = 0;
    p.moveSpeed = 0;
    if (--p.land.ticks <= 0) p.land = null;
    return;
  }

  if (consume(p, 'dodge') && tryStartRoll(p, inp, ctx)) return stepAction(p, inp, ctx, 1);
  // 登攀（v0.44.0）: 登り口で壁へ向かって押すと取り付く。上の段の登り切った所で縁へ向かって押すと、向きを変えて取り付いて下りる
  if (p.grounded && Math.hypot(inp.moveX, inp.moveZ) > 0.5) {
    const c = ctx.world.climbAt(p.pos, yawOf(inp.moveX, inp.moveZ));
    if (c) {
      startClimb(p, c.climb, c.dir, ctx);
      return stepClimb(p, inp, ctx);
    }
  }
  // 剥ぎ取り: 達成後、対象の近くで攻撃ボタン（道具ボタンでもよい）
  if (p.buffer.main > 0 || p.buffer.item > 0) {
    const source = ctx.carveTarget();
    if (source) {
      clearAttackBuffers(p);
      p.buffer.item = 0;
      p.drawn = false;
      const run = startAction(p, CARVE_ACTION, ctx);
      p.carving = { source, instanceId: run.instanceId, done: false };
      return stepAction(p, inp, ctx, 1);
    }
    // 狩らない依頼（v0.27.0）: 納刀して採取点・納品箱のそばで、攻撃ボタン（道具ボタンは、道具を使うまま）
    const target = p.buffer.main > 0 ? ctx.errandTarget() : null;
    if (target) {
      clearAttackBuffers(p);
      p.buffer.item = 0;
      const run = startAction(p, target.actionId, ctx);
      p.errandOp = { target, instanceId: run.instanceId, done: false };
      return stepAction(p, inp, ctx, 1);
    }
  }
  // 道具（v0.40.0。2G に合わせた）: 納刀している時だけ使える（研磨石も、片ひざを突いて背から下ろして研ぎ、終わったら納める）。
  // 抜刀中に押したら納刀するだけで、続けて使いはしない（使うのは、納刀した後にもう 1 度押した時）。護刃は、防御を構えたまま使える（stepGuard）
  if (consume(p, 'item')) {
    if (p.drawn) {
      startAction(p, fam.actions.sheathe, ctx);
      return stepAction(p, inp, ctx, 1);
    }
    if (tryUseItem(p, ctx)) return stepAction(p, inp, ctx, 1);
  }
  if (consume(p, 'weapon')) {
    startAction(p, p.drawn ? fam.actions.sheathe : fam.actions.draw, ctx);
    return stepAction(p, inp, ctx, 1);
  }
  // 主と副の同時押し（複合入力。v0.40.0）: 抜刀していれば複合の技、納刀していれば抜刀攻撃
  if (comboIntent(p, fam)) {
    clearAttackBuffers(p);
    startAction(p, p.drawn ? fam.actions.combo! : fam.actions.drawAttack, ctx);
    return stepAction(p, inp, ctx, 1);
  }
  for (const key of ['main', 'sub'] as const) {
    if (!consume(p, key)) continue;
    const run = startAction(p, p.drawn ? fam.actions[key] : fam.actions.drawAttack, ctx);
    // 押し遅れのもう片方が来たら、複合の技へ替える（抜刀して立っている時だけ）
    p.lastSingle = p.drawn && fam.actions.combo ? { instanceId: run.instanceId, key, comboId: fam.actions.combo } : null;
    return stepAction(p, inp, ctx, 1);
  }
  if (p.drawn && fam.guard && inp.held & Btn.Special) {
    p.mode = 'guard';
    p.guard = { phase: 'start', tick: 0 };
    return;
  }
  // 固有ボタンの技（防御の無い武器）
  if (p.drawn && !fam.guard && fam.actions.special && consume(p, 'special')) {
    startAction(p, fam.actions.special, ctx);
    return stepAction(p, inp, ctx, 1);
  }

  const mag = Math.min(1, Math.hypot(inp.moveX, inp.moveZ));
  if (mag <= MOVE_DEADZONE) return;
  const want = yawOf(inp.moveX, inp.moveZ);
  let speed: number;
  let turnRate: number;
  if (p.drawn) {
    speed = fam.drawnMoveSpeed * mag;
    turnRate = fam.drawnTurnDegPerSec;
  } else {
    const sprint = (inp.held & Btn.Sprint) !== 0 && !p.exhausted && mag > 0.6 && p.stamina > 0;
    if (sprint) {
      p.sprinting = true;
      spendStamina(p, T.sprintCostPerSec / 60, ctx);
      if (p.stamina <= 0) p.exhausted = true;
    }
    speed = (sprint ? T.sprintSpeed : T.walkSpeed) * mag;
    turnRate = T.turnDegPerSec;
  }
  p.yaw = turnToward(p.yaw, want, (turnRate * DEG) / 60);
  const d = speed / 60;
  ctx.world.move(p.pos, T.radius, Math.sin(want) * d, Math.cos(want) * d, ctx.blockers());
  p.moveSpeed = speed;
}

function stepGuard(p: PlayerState, inp: InputFrame, ctx: SimCtx): void {
  const fam = familyOf(p, ctx.content);
  const G = fam.guard!;
  const g = p.guard!;
  const T = ctx.content.player;
  const canAct = g.phase === 'start' || g.phase === 'hold' || g.phase === 'end';
  if (canAct && p.buffer.dodge > 0 && consume(p, 'dodge') && tryStartRoll(p, inp, ctx)) return stepAction(p, inp, ctx, 1);
  // 護刃（v0.40.0）: 防御を構えている間だけ、抜刀したまま道具を使える（使い終わっても抜刀のまま）
  if (fam.itemsWhileGuarding && isGuarding(p, G) && p.buffer.item > 0) {
    consume(p, 'item');
    if (tryUseItem(p, ctx, true)) return stepAction(p, inp, ctx, 1);
  }
  // 構えたまま出す技（長尖槍の構え突き・受け返し）
  if (isGuarding(p, G)) {
    for (const [key, id] of [['main', fam.actions.guardMain], ['sub', fam.actions.guardSub]] as const) {
      if (!id || p.buffer[key] <= 0) continue;
      const def = ctx.content.actions.get(id)!;
      if (p.stamina < staminaCostOf(p, def, ctx)) continue;
      consume(p, key);
      startAction(p, id, ctx);
      return stepAction(p, inp, ctx, 1);
    }
  }
  const held = (inp.held & Btn.Special) !== 0;
  switch (g.phase) {
    case 'start':
      g.tick++;
      if (g.tick >= G.startTicks) p.guard = { phase: held ? 'hold' : 'end', tick: 0 };
      break;
    case 'hold': {
      if (!held) {
        p.guard = { phase: 'end', tick: 0 };
        break;
      }
      g.tick++;
      if (Math.hypot(inp.moveX, inp.moveZ) > MOVE_DEADZONE) {
        p.yaw = turnToward(p.yaw, yawOf(inp.moveX, inp.moveZ), (G.turnDegPerSec * DEG) / 60);
      }
      break;
    }
    case 'recoil': {
      // 受け止めた反動で少し下がる（前半に大きく、後半は止まる）
      const u = g.tick / G.recoilTicks;
      const d = ((G.recoilDistance ?? 0.9) * 2 * (1 - u)) / G.recoilTicks;
      const f = forwardOf(p.yaw);
      ctx.world.move(p.pos, T.radius, -f.x * d, -f.z * d, ctx.blockers());
      g.tick++;
      if (g.tick >= G.recoilTicks) p.guard = { phase: held ? 'hold' : 'end', tick: 0 };
      break;
    }
    case 'break':
      g.tick++;
      if (g.tick >= G.breakTicks) {
        p.mode = 'free';
        p.guard = null;
      }
      break;
    case 'end':
      g.tick++;
      if (g.tick >= G.endTicks) {
        p.mode = 'free';
        p.guard = null;
      }
      break;
  }
}

function stepHurt(p: PlayerState, ctx: SimCtx): void {
  const h = p.hurt!;
  const T = ctx.content.player;
  // 吹き飛び距離: 怯み 0.5m / 転倒 3.2m / 弾かれ（データの pushback）。前半で進み切る。状態異常（麻痺・睡眠・気絶）は、その場で動けない。
  const travelTicks = h.kind === 'knockdown' ? 28 : h.kind === 'bounce' ? 8 : 10;
  const total = h.kind === 'knockdown' ? 3.2 : h.kind === 'bounce' ? ctx.content.edge.bounce.pushback : h.kind === 'flinch' ? 0.5 : 0;
  if (h.tick < travelTicks) {
    const u = h.tick / travelTicks;
    const d = (total * 2 * (1 - u)) / travelTicks;
    ctx.world.move(p.pos, T.radius, Math.sin(h.dirYaw) * d, Math.cos(h.dirYaw) * d, ctx.blockers());
  }
  h.tick++;
  if (h.tick >= h.duration) {
    if (h.kind === 'para' || h.kind === 'sleep' || h.kind === 'stun') ctx.emit({ type: 'status', kind: h.kind, on: false });
    p.mode = 'free';
    p.hurt = null;
  }
}

export function respawnPlayer(p: PlayerState, ctx: SimCtx): void {
  const T = ctx.content.player;
  const s = ctx.world.spawn;
  p.pos = v3(s.x, 0, s.z);
  p.prevPos = { ...p.pos };
  p.yaw = s.yaw;
  p.prevYaw = s.yaw;
  p.hp = T.maxHp;
  p.stamina = T.maxStamina;
  p.staminaDelay = 0;
  p.exhausted = false;
  p.drawn = false;
  p.mode = 'free';
  p.action = null;
  p.guard = null;
  p.hurt = null;
  p.ailment = freshAilment();
  p.deadTicks = 0;
  p.invulnTicks = 90;
  ctx.emit({ type: 'player_respawn' });
}

export function stepPlayer(p: PlayerState, inp: InputFrame, ctx: SimCtx): void {
  const T = ctx.content.player;
  p.prevPos = { ...p.pos };
  p.prevYaw = p.yaw;
  p.attackEval = null;
  p.sprinting = false;
  p.moveSpeed = 0;

  // 先行入力: 押した tick を含めて inputBufferTicks の間だけ有効
  for (const k of ['main', 'sub', 'dodge', 'weapon', 'item', 'special', 'combo'] as const) if (p.buffer[k] > 0) p.buffer[k]--;
  // 主と副を同じ tick に押した（または複合のボタン）: 複合の技を持つ系統では、1 つの命令（combo）。持たない系統では、これまでどおり主と副
  const fam = familyOf(p, ctx.content);
  const both = (inp.pressed & Btn.Main) !== 0 && (inp.pressed & Btn.Sub) !== 0;
  if (fam.actions.combo && ((inp.pressed & Btn.Combo) !== 0 || both)) {
    p.buffer.combo = T.inputBufferTicks;
    p.buffer.main = 0;
    p.buffer.sub = 0;
  } else {
    if (inp.pressed & (Btn.Main | Btn.Combo)) p.buffer.main = T.inputBufferTicks;
    if (inp.pressed & Btn.Sub) p.buffer.sub = T.inputBufferTicks;
  }
  if (inp.pressed & Btn.Dodge) p.buffer.dodge = T.inputBufferTicks;
  if (inp.pressed & Btn.Weapon) p.buffer.weapon = T.inputBufferTicks;
  if (inp.pressed & Btn.Item) p.buffer.item = T.inputBufferTicks;
  if (inp.pressed & Btn.Special) p.buffer.special = T.inputBufferTicks;
  // 道具の切り替えは、いつでもできる（使っている途中の道具は変わらない）
  if (p.items.length > 0) {
    if (inp.pressed & Btn.ItemNext) p.itemIndex = (p.itemIndex + 1) % p.items.length;
    if (inp.pressed & Btn.ItemPrev) p.itemIndex = (p.itemIndex + p.items.length - 1) % p.items.length;
  }
  if (p.invulnTicks > 0) p.invulnTicks--;
  // 被弾・転倒・力尽き（v0.40.0）: 古い先行入力は消す（起き上がった時に、前の入力で勝手に攻撃・回避・道具をしない）
  if (p.mode === 'hurt' || p.mode === 'dead') {
    for (const k of Object.keys(p.buffer) as (keyof PlayerState['buffer'])[]) p.buffer[k] = 0;
    p.lastSingle = null;
  }
  stepAilment(p, ctx);
  // 押し遅れの複合入力（v0.40.0）: 主か副で技を始めた直後に、もう片方が押されたら、同時押しの技へ替える
  const ls = p.lastSingle;
  if (ls) {
    const run = p.mode === 'action' ? p.action : null;
    if (!run || run.instanceId !== ls.instanceId || run.tick > COMBO_SLACK_TICKS) p.lastSingle = null;
    else if (run.hitstop === 0 && inp.pressed & (ls.key === 'main' ? Btn.Sub | Btn.Combo : Btn.Main | Btn.Combo)) {
      p.lastSingle = null;
      clearAttackBuffers(p);
      startAction(p, ls.comboId, ctx);
    }
  }

  switch (p.mode) {
    case 'dead':
      p.deadTicks++;
      if (p.deadTicks >= T.respawnTicks) respawnPlayer(p, ctx);
      break;
    case 'hurt':
      stepHurt(p, ctx);
      break;
    case 'guard':
      stepGuard(p, inp, ctx);
      break;
    case 'action':
      stepAction(p, inp, ctx);
      break;
    case 'free':
      stepFree(p, inp, ctx);
      break;
    case 'climb':
      stepClimb(p, inp, ctx);
      break;
  }

  // 道具の効果と剥ぎ取り: 行動がその tick まで進んだ時にだけ起きる。途中で妨害されたら何も起きない。
  const ev = p.attackEval as PlayerState['attackEval'];
  const use = p.itemUse;
  if (use) {
    const item = ctx.content.items.get(use.itemId)!;
    if (!use.done && ev && ev.run.instanceId === use.instanceId && ev.t >= item.effectTick) {
      use.done = true;
      const stack = p.items.find((s) => s.itemId === use.itemId);
      if (stack && stack.count > 0 && ctx.applyItem(item)) stack.count--;
    }
    if (!p.action || p.action.instanceId !== use.instanceId) p.itemUse = null;
  }
  const cv = p.carving;
  if (cv) {
    const at = ev && ev.run.instanceId === cv.instanceId ? ev.run.def.phases.find((ph) => ph.id === 'recovery')?.from ?? 0 : 0;
    if (!cv.done && ev && ev.run.instanceId === cv.instanceId && ev.t >= at) {
      cv.done = true;
      ctx.carve(cv.source);
    }
    if (!p.action || p.action.instanceId !== cv.instanceId) p.carving = null;
  }
  // 採る・納める: 剥ぎ取りと同じく、recovery の始まりまで進んだ時にだけ、1 度だけ
  const eo = p.errandOp;
  if (eo) {
    const at = ev && ev.run.instanceId === eo.instanceId ? ev.run.def.phases.find((ph) => ph.id === 'recovery')?.from ?? 0 : 0;
    if (!eo.done && ev && ev.run.instanceId === eo.instanceId && ev.t >= at) {
      eo.done = true;
      ctx.errandDo(eo.target);
    }
    if (!p.action || p.action.instanceId !== eo.instanceId) p.errandOp = null;
  }

  // 勢い（双剣）: 振っていない時間が続くと消える
  const M = familyOf(p, ctx.content).momentum;
  if (M && p.momentum > 0) {
    if (p.mode === 'action' && p.action?.def.momentum) p.momentumTicks = 0;
    else if (++p.momentumTicks >= M.decayTicks) {
      p.momentum = 0;
      ctx.emit({ type: 'momentum', level: 0 });
    }
  }

  // 登攀の間は、登攀が位置を持つ（重力も、地面への合わせも無い）。終えた時に、立つ面（地面・上の段）が決まる
  const wasGrounded = p.grounded;
  if (p.mode === 'climb') p.grounded = false;
  else p.grounded = ctx.world.settle(p.pos, p.vel, T.gravity, 1 / 60);
  stepDrop(p, wasGrounded, ctx);

  // スタミナ: 消費が終わってから待ち時間を置いて回復
  if (p.mode !== 'dead' && !p.sprinting) {
    if (p.staminaDelay > 0) p.staminaDelay--;
    else if (p.stamina < T.maxStamina) p.stamina = Math.min(T.maxStamina, p.stamina + (T.staminaRegenPerSec * ctx.gear.staminaRegen) / 60);
  }
  if (p.exhausted && p.stamina >= T.sprintRestartStamina) p.exhausted = false;
}

export interface IncomingHit {
  attackerPos: V3;
  baseDamage: number;
  guardable: boolean;
  guardCost: number;
  reaction: 'flinch' | 'knockdown';
  /** 当たった時（防御していない時）にためる状態異常 */
  status?: StatusHit;
}

export type HitOutcome = 'ignored' | 'evaded' | 'guarded' | 'guard_break' | 'hit';

/**
 * 被弾の解決。無敵 → 防御 → 被弾の順に、ここ一か所で決める。
 * 'evaded' は台帳へ記録しない（無敵が切れた後もまだ判定が残っていれば当たる）。
 */
export function resolveIncomingHit(p: PlayerState, hit: IncomingHit, ctx: SimCtx): HitOutcome {
  if (p.mode === 'dead') return 'ignored';
  if (isInvulnerable(p)) return 'evaded';
  // 登攀の途中で当たると、壁から落とされる（防御はできない。ここからは、ふつうの被弾として落ちていく）
  if (p.mode === 'climb') endClimb(p, ctx, 'release');
  const T = ctx.content.player;
  const fam = familyOf(p, ctx.content);
  const G = fam.guard;
  const toAttacker = yawOf(hit.attackerPos.x - p.pos.x, hit.attackerPos.z - p.pos.z);
  const pos = { x: p.pos.x, y: p.pos.y + 1.1, z: p.pos.z };

  // この tick に処理した行動 tick（行動の最中の防御と受け返しは、ここで見る）
  const run = p.mode === 'action' ? p.action : null;
  const at = run ? (p.attackEval && p.attackEval.run === run ? p.attackEval.t : run.tick) : 0;
  const facing = (arc: number): boolean => Math.abs(angleDiff(p.yaw, toAttacker)) <= (arc * DEG) / 2;

  // 受け返し（長尖槍）: 構えの区間に正面から受けると、無傷で反撃へ移る
  const counter = run?.def.counter;
  if (run && counter && hit.guardable && inWindow(at, counter) && facing(G?.arcDegrees ?? 120)) {
    ctx.emit({ type: 'parry', kind: 'counter', pos });
    startAction(p, counter.into, ctx);
    return 'guarded';
  }

  const actionGuard = !!run && !!G && (run.def.guardWindows ?? []).some((w) => inWindow(at, w));
  if (G && hit.guardable && (isGuarding(p, G) || actionGuard) && facing(G.arcDegrees)) {
    // 受け流し（護刃）: 構えてすぐに受けると、削りもスタミナ消費も後退も無い
    if (!actionGuard && G.parryTicks && p.guard) {
      const since = p.guard.phase === 'start' ? p.guard.tick - G.activeFromTick : p.guard.phase === 'hold' ? G.startTicks - G.activeFromTick + p.guard.tick : Infinity;
      if (since < G.parryTicks) {
        p.guard = { phase: 'hold', tick: G.parryTicks };
        ctx.emit({ type: 'parry', kind: 'parry', pos });
        return 'guarded';
      }
    }
    // 防具の技能「受け支え」（v0.33.0）: 受けた時のスタミナの消費が減る（削り・防げる向きは変えない）
    const guardCost = hit.guardCost * ctx.gear.guardStamina;
    if (p.stamina >= guardCost) {
      spendStamina(p, guardCost, ctx);
      // 刃で受ける系統（断岳剣。v0.40.0）: 受けるたびに刃が減る（防具の技能「刃の保ち」で減り方が小さくなる）
      if (G.edgeWear && fam.edge) wearEdge(p, G.edgeWear * ctx.gear.edgeWear, ctx);
      const chip = Math.floor(hit.baseDamage * G.chipScale);
      p.hp = Math.max(0, p.hp - chip);
      // 行動の最中に受けた時は、その行動を続ける（後退しない）
      if (!actionGuard) p.guard = { phase: 'recoil', tick: 0 };
      ctx.emit({ type: 'guard', damage: chip, pos });
      if (p.hp <= 0) killPlayer(p, ctx);
      return 'guarded';
    }
    // スタミナが足りず受け切れない → 防御崩れ
    p.stamina = 0;
    p.staminaDelay = T.staminaRegenDelayTicks;
    const dmg = Math.max(1, Math.floor(hit.baseDamage * G.breakDamageScale));
    p.hp = Math.max(0, p.hp - dmg);
    p.mode = 'guard';
    p.action = null;
    p.guard = { phase: 'break', tick: 0 };
    ctx.emit({ type: 'guard_break', damage: dmg, pos });
    if (p.hp <= 0) killPlayer(p, ctx);
    return 'guard_break';
  }

  const dmg = Math.max(1, Math.floor(hit.baseDamage));
  p.hp = Math.max(0, p.hp - dmg);
  ctx.emit({ type: 'player_hurt', damage: dmg, reaction: hit.reaction, pos });
  if (p.hp <= 0) {
    killPlayer(p, ctx);
    return 'hit';
  }
  p.action = null;
  p.guard = null;
  p.mode = 'hurt';
  if (p.momentum > 0) {
    p.momentum = 0; // 被弾で勢いを失う
    ctx.emit({ type: 'momentum', level: 0 });
  }
  const knock = hit.reaction === 'knockdown';
  // 眠っていた・麻痺していた時は、この攻撃で目が覚める（動けない状態は終わり、怯みか転倒になる）
  if (p.hurt && (p.hurt.kind === 'para' || p.hurt.kind === 'sleep' || p.hurt.kind === 'stun')) ctx.emit({ type: 'status', kind: p.hurt.kind, on: false });
  p.hurt = { kind: hit.reaction, tick: 0, duration: knock ? T.knockdownTicks : T.flinchTicks, dirYaw: toAttacker + Math.PI };
  if (knock) p.invulnTicks = T.knockdownInvulnTicks;
  if (hit.status) applyStatus(p, hit.status, ctx);
  return 'hit';
}

/** 刃の状態を減らす。段階が替わったら知らせる */
function wearEdge(p: PlayerState, amount: number, ctx: SimCtx): void {
  const E = ctx.content.edge;
  const before = edgeStage(E, p.edge).id;
  p.edge = Math.max(0, p.edge - amount);
  const now = edgeStage(E, p.edge);
  if (now.id !== before) ctx.emit({ type: 'edge', stage: now.id, value: p.edge });
}

function killPlayer(p: PlayerState, ctx: SimCtx): void {
  // 終端状態を先に確定する
  p.mode = 'dead';
  p.action = null;
  p.guard = null;
  p.hurt = null;
  p.deadTicks = 0;
  ctx.emit({ type: 'player_dead' });
}

/** プレイヤーの被弾カプセル（ワールド座標）。 */
export function playerHurtCapsule(p: PlayerState, c: Content): { a: V3; b: V3; r: number } {
  const T = c.player;
  const low = p.mode === 'hurt' && (p.hurt?.kind === 'knockdown' || p.hurt?.kind === 'sleep');
  const top = low ? 0.6 : T.height - T.radius;
  return { a: { x: p.pos.x, y: p.pos.y + T.radius, z: p.pos.z }, b: { x: p.pos.x, y: p.pos.y + top, z: p.pos.z }, r: T.radius };
}
