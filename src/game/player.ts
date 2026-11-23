// プレイヤーの状態機械。行動の可否はここ（ロジック）が決め、アニメーションの終了には頼らない。
// 状態: free（移動）/ action（データ定義の行動）/ guard / hurt / dead
import { DEG, angleDiff, forwardOf, turnToward, v3, yawOf, type V3 } from '../core/math';
import type { SeededRng } from '../core/seededRng';
import type { Content, GuardDef, HazardDef, ItemDef, ItemStack, WeaponDef, WeaponFamilyDef } from '../data/schemas';
import { inWindow, newRun, type ActionRun } from './action';
import type { SimEvent } from './events';
import { Btn, type InputFrame } from './inputFrame';
import { sampleCurve } from './tracks';
import type { Circle, World } from './world';

export type PlayerMode = 'free' | 'action' | 'guard' | 'hurt' | 'dead';
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
  hurt: { kind: 'flinch' | 'knockdown'; tick: number; duration: number; dirYaw: number } | null;
  deadTicks: number;
  invulnTicks: number;
  buffer: { main: number; sub: number; dodge: number; weapon: number; item: number };
  /** 狩猟中の持ち物（依頼の支給品）。数が 0 になっても欄は残る。 */
  items: ItemStack[];
  itemIndex: number;
  /** 使っている途中の道具。効果が出る tick より前に妨害されると、消費しない。 */
  itemUse: { itemId: string; instanceId: number; done: boolean } | null;
  /** 抜刀中に道具ボタンを押した: 納刀が終わったら続けて使う */
  pendingItem: boolean;
  /** 剥ぎ取りの途中（source は剥ぎ取る対象） */
  carving: { source: string; instanceId: number; done: boolean } | null;
  sprinting: boolean;
  /** 見た目用の現在速度 (m/s) */
  moveSpeed: number;
  weaponId: string;
}

export interface SimCtx {
  content: Content;
  world: World;
  rng: SeededRng;
  tick: number;
  emit(ev: SimEvent): void;
  newInstanceId(): number;
  /** プレイヤーが通り抜けられない円（生きている大型の胴体など） */
  blockers(): Circle[];
  /** 落下物などを出す。位置は target を基準にこの時点で固定する。 */
  spawnHazards(def: HazardDef, target: V3): void;
  /** いまこの道具を使い始められるか（罠は狩猟中に 1 つまで、など） */
  canUseItem(item: ItemDef): boolean;
  /** 道具の効果を出す。効果が出なかった時は false を返し、道具は減らない。 */
  applyItem(item: ItemDef): boolean;
  /** いま剥ぎ取れる対象（近くにあり、回数が残っている）。無ければ null。 */
  carveTarget(): string | null;
  /** 剥ぎ取り 1 回分を確定する */
  carve(source: string): void;
}

/** 剥ぎ取りの行動。素材は recovery の始まりで手に入る。 */
const CARVE_ACTION = 'player.common.carve';

/** 選んでいる道具を使い始める。使えない時は理由を知らせて false。 */
function tryUseItem(p: PlayerState, ctx: SimCtx): boolean {
  const stack = p.items[p.itemIndex];
  const item = stack ? ctx.content.items.get(stack.itemId) : undefined;
  if (!stack || !item || stack.count <= 0) {
    ctx.emit({ type: 'item_fail', reason: 'empty' });
    return false;
  }
  if (!ctx.canUseItem(item)) {
    ctx.emit({ type: 'item_fail', reason: 'not_now' });
    return false;
  }
  const run = startAction(p, item.useActionId, ctx);
  p.itemUse = { itemId: item.id, instanceId: run.instanceId, done: false };
  ctx.emit({ type: 'item_use', itemId: item.id, pos: { ...p.pos } });
  return true;
}

const MOVE_DEADZONE = 0.12;

export function createPlayer(content: Content, spawn: { x: number; z: number; yaw: number }, weaponId: string, supplies: readonly ItemStack[] = []): PlayerState {
  const T = content.player;
  const pos = v3(spawn.x, 0, spawn.z);
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
    deadTicks: 0,
    invulnTicks: 0,
    buffer: { main: 0, sub: 0, dodge: 0, weapon: 0, item: 0 },
    items: supplies.map((s) => ({ itemId: s.itemId, count: s.count })),
    itemIndex: 0,
    itemUse: null,
    pendingItem: false,
    carving: null,
    sprinting: false,
    moveSpeed: 0,
    weaponId,
  };
}

export const weaponOf = (p: PlayerState, c: Content): WeaponDef => c.weapons.get(p.weaponId)!;
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

export function startAction(p: PlayerState, actionId: string, ctx: SimCtx): ActionRun {
  const def = ctx.content.actions.get(actionId)!;
  const run = newRun(def, ctx.newInstanceId(), p.yaw);
  p.mode = 'action';
  p.action = run;
  p.guard = null;
  p.hurt = null;
  if (def.staminaCost) spendStamina(p, def.staminaCost, ctx);
  ctx.emit({ type: 'action_start', actor: p.id, actionId, instanceId: run.instanceId });
  return run;
}

function tryStartRoll(p: PlayerState, inp: InputFrame, ctx: SimCtx): boolean {
  const T = ctx.content.player;
  const def = ctx.content.actions.get(T.rollActionId)!;
  if (p.stamina < (def.staminaCost ?? 0)) {
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
  const run = startAction(p, T.rollActionId, ctx);
  run.moveYaw = dir;
  run.fixedDir = true;
  run.dirIndex = dirIndex;
  return true;
}

function tryCancelInto(p: PlayerState, name: string, inp: InputFrame, ctx: SimCtx): boolean {
  if (name === 'roll') {
    return p.buffer.dodge > 0 && consume(p, 'dodge') && tryStartRoll(p, inp, ctx);
  }
  const fam = familyOf(p, ctx.content);
  const actionId = fam.cancelNames[name];
  if (!actionId) return false;
  const key = actionId === fam.actions.main ? 'main' : actionId === fam.actions.sub ? 'sub' : null;
  if (!key || p.buffer[key] <= 0) return false;
  consume(p, key);
  startAction(p, actionId, ctx);
  return true;
}

function finishAction(p: PlayerState): void {
  const fin = p.action?.def.onFinish;
  if (fin === 'drawn_idle') p.drawn = true;
  else if (fin === 'sheathed_idle') p.drawn = false;
  p.mode = 'free';
  p.action = null;
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

  // 溜め: holdTick で止まり、ボタンを離す（または上限）で続きへ進む
  if (def.charge && run.tick === def.charge.holdTick && !run.released) {
    const b = def.charge.button === 'main' ? Btn.Main : Btn.Sub;
    if (inp.held & b && run.chargeTicks < def.charge.maxHoldTicks) {
      run.chargeTicks++;
      let level = 0;
      for (const lt of def.charge.levelTicks) if (run.chargeTicks >= lt) level++;
      if (level > run.chargeLevel) {
        run.chargeLevel = level;
        ctx.emit({ type: 'charge_level', level, pos: { ...p.pos } });
      }
      turn();
      return;
    }
    run.released = true;
  }

  const t = run.tick;

  // キャンセルは定義した区間でだけ受け付ける
  if (depth === 0) {
    for (const cw of def.cancelWindows) {
      if (!inWindow(t, cw)) continue;
      for (const name of cw.into) {
        if (tryCancelInto(p, name, inp, ctx)) {
          stepAction(p, inp, ctx, 1);
          return;
        }
      }
    }
  }

  turn();

  if (def.rootMotion.mode === 'controller' && def.rootMotion.curveId) {
    const curve = ctx.content.curves.get(def.rootMotion.curveId)!;
    const d = sampleCurve(curve, t + 1) - sampleCurve(curve, t);
    if (d !== 0) {
      const f = forwardOf(run.fixedDir ? run.moveYaw : p.yaw);
      ctx.world.move(p.pos, T.radius, f.x * d, f.z * d, ctx.blockers());
    }
  }

  for (const ev of def.events) {
    if (ev.tick === t) ctx.emit({ type: 'action_event', actor: p.id, kind: ev.type, id: ev.id, pos: { ...p.pos } });
  }

  p.attackEval = { run, t };
  run.advanced = true;
  run.tick++;
  if (run.tick >= def.durationTicks) finishAction(p);
}

function stepFree(p: PlayerState, inp: InputFrame, ctx: SimCtx): void {
  const T = ctx.content.player;
  const fam = familyOf(p, ctx.content);

  if (consume(p, 'dodge') && tryStartRoll(p, inp, ctx)) {
    p.pendingItem = false;
    return stepAction(p, inp, ctx, 1);
  }
  // 剥ぎ取り: 達成後、対象の近くで攻撃ボタン（道具ボタンでもよい）
  if (p.buffer.main > 0 || p.buffer.item > 0) {
    const source = ctx.carveTarget();
    if (source) {
      p.buffer.main = 0;
      p.buffer.item = 0;
      p.pendingItem = false;
      p.drawn = false;
      const run = startAction(p, CARVE_ACTION, ctx);
      p.carving = { source, instanceId: run.instanceId, done: false };
      return stepAction(p, inp, ctx, 1);
    }
  }
  // 道具: 納刀中だけ使える。抜刀中に押したら、納刀してから続けて使う。
  if (consume(p, 'item') || (p.pendingItem && !p.drawn)) {
    if (p.drawn) {
      p.pendingItem = true;
      startAction(p, fam.actions.sheathe, ctx);
      return stepAction(p, inp, ctx, 1);
    }
    p.pendingItem = false;
    if (tryUseItem(p, ctx)) return stepAction(p, inp, ctx, 1);
  }
  if (consume(p, 'weapon')) {
    p.pendingItem = false;
    startAction(p, p.drawn ? fam.actions.sheathe : fam.actions.draw, ctx);
    return stepAction(p, inp, ctx, 1);
  }
  if (consume(p, 'main')) {
    startAction(p, p.drawn ? fam.actions.main : fam.actions.drawAttack, ctx);
    return stepAction(p, inp, ctx, 1);
  }
  if (consume(p, 'sub')) {
    startAction(p, p.drawn ? fam.actions.sub : fam.actions.drawAttack, ctx);
    return stepAction(p, inp, ctx, 1);
  }
  if (p.drawn && fam.guard && inp.held & Btn.Special) {
    p.mode = 'guard';
    p.guard = { phase: 'start', tick: 0 };
    return;
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
      const d = (0.9 * 2 * (1 - u)) / G.recoilTicks;
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
  // 吹き飛び距離: 怯み 0.5m / 転倒 3.2m。前半で進み切る。
  const travelTicks = h.kind === 'knockdown' ? 28 : 10;
  const total = h.kind === 'knockdown' ? 3.2 : 0.5;
  if (h.tick < travelTicks) {
    const u = h.tick / travelTicks;
    const d = (total * 2 * (1 - u)) / travelTicks;
    ctx.world.move(p.pos, T.radius, Math.sin(h.dirYaw) * d, Math.cos(h.dirYaw) * d, ctx.blockers());
  }
  h.tick++;
  if (h.tick >= h.duration) {
    p.mode = 'free';
    p.hurt = null;
  }
}

export function respawnPlayer(p: PlayerState, ctx: SimCtx): void {
  const T = ctx.content.player;
  const s = ctx.world.map.spawn;
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
  for (const k of ['main', 'sub', 'dodge', 'weapon', 'item'] as const) if (p.buffer[k] > 0) p.buffer[k]--;
  if (inp.pressed & Btn.Main) p.buffer.main = T.inputBufferTicks;
  if (inp.pressed & Btn.Sub) p.buffer.sub = T.inputBufferTicks;
  if (inp.pressed & Btn.Dodge) p.buffer.dodge = T.inputBufferTicks;
  if (inp.pressed & Btn.Weapon) p.buffer.weapon = T.inputBufferTicks;
  if (inp.pressed & Btn.Item) p.buffer.item = T.inputBufferTicks;
  // 道具の切り替えは、いつでもできる（使っている途中の道具は変わらない）
  if (p.items.length > 0) {
    if (inp.pressed & Btn.ItemNext) p.itemIndex = (p.itemIndex + 1) % p.items.length;
    if (inp.pressed & Btn.ItemPrev) p.itemIndex = (p.itemIndex + p.items.length - 1) % p.items.length;
  }
  if (p.invulnTicks > 0) p.invulnTicks--;
  if (p.mode === 'hurt' || p.mode === 'dead' || p.mode === 'guard') p.pendingItem = false;

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

  p.grounded = ctx.world.settle(p.pos, p.vel, T.gravity, 1 / 60);

  // スタミナ: 消費が終わってから待ち時間を置いて回復
  if (p.mode !== 'dead' && !p.sprinting) {
    if (p.staminaDelay > 0) p.staminaDelay--;
    else if (p.stamina < T.maxStamina) p.stamina = Math.min(T.maxStamina, p.stamina + T.staminaRegenPerSec / 60);
  }
  if (p.exhausted && p.stamina >= T.sprintRestartStamina) p.exhausted = false;
}

export interface IncomingHit {
  attackerPos: V3;
  baseDamage: number;
  guardable: boolean;
  guardCost: number;
  reaction: 'flinch' | 'knockdown';
}

export type HitOutcome = 'ignored' | 'evaded' | 'guarded' | 'guard_break' | 'hit';

/**
 * 被弾の解決。無敵 → 防御 → 被弾の順に、ここ一か所で決める。
 * 'evaded' は台帳へ記録しない（無敵が切れた後もまだ判定が残っていれば当たる）。
 */
export function resolveIncomingHit(p: PlayerState, hit: IncomingHit, ctx: SimCtx): HitOutcome {
  if (p.mode === 'dead') return 'ignored';
  if (isInvulnerable(p)) return 'evaded';
  const T = ctx.content.player;
  const fam = familyOf(p, ctx.content);
  const G = fam.guard;
  const toAttacker = yawOf(hit.attackerPos.x - p.pos.x, hit.attackerPos.z - p.pos.z);
  const pos = { x: p.pos.x, y: p.pos.y + 1.1, z: p.pos.z };

  if (G && hit.guardable && isGuarding(p, G) && Math.abs(angleDiff(p.yaw, toAttacker)) <= (G.arcDegrees * DEG) / 2) {
    if (p.stamina >= hit.guardCost) {
      spendStamina(p, hit.guardCost, ctx);
      const chip = Math.floor(hit.baseDamage * G.chipScale);
      p.hp = Math.max(0, p.hp - chip);
      p.guard = { phase: 'recoil', tick: 0 };
      ctx.emit({ type: 'guard', damage: chip, pos });
      if (p.hp <= 0) killPlayer(p, ctx);
      return 'guarded';
    }
    // スタミナが足りず受け切れない → 防御崩れ
    p.stamina = 0;
    p.staminaDelay = T.staminaRegenDelayTicks;
    const dmg = Math.max(1, Math.floor(hit.baseDamage * G.breakDamageScale));
    p.hp = Math.max(0, p.hp - dmg);
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
  const knock = hit.reaction === 'knockdown';
  p.hurt = { kind: hit.reaction, tick: 0, duration: knock ? T.knockdownTicks : T.flinchTicks, dirYaw: toAttacker + Math.PI };
  if (knock) p.invulnTicks = T.knockdownInvulnTicks;
  return 'hit';
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
  const low = p.mode === 'hurt' && p.hurt?.kind === 'knockdown';
  const top = low ? 0.6 : T.height - T.radius;
  return { a: { x: p.pos.x, y: p.pos.y + T.radius, z: p.pos.z }, b: { x: p.pos.x, y: p.pos.y + top, z: p.pos.z }, r: T.radius };
}
