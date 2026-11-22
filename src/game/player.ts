// プレイヤーの状態機械。行動の可否はここ（ロジック）が決め、アニメーションの終了には頼らない。
// 状態: free（移動）/ action（データ定義の行動）/ guard / hurt / dead
import { DEG, angleDiff, forwardOf, turnToward, v3, yawOf, type V3 } from '../core/math';
import type { SeededRng } from '../core/seededRng';
import type { Content, GuardDef, WeaponDef, WeaponFamilyDef } from '../data/schemas';
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
  buffer: { main: number; sub: number; dodge: number; weapon: number };
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
}

const MOVE_DEADZONE = 0.12;

export function createPlayer(content: Content, spawn: { x: number; z: number; yaw: number }, weaponId: string): PlayerState {
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
    buffer: { main: 0, sub: 0, dodge: 0, weapon: 0 },
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

  if (consume(p, 'dodge') && tryStartRoll(p, inp, ctx)) return stepAction(p, inp, ctx, 1);
  if (consume(p, 'weapon')) {
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
  for (const k of ['main', 'sub', 'dodge', 'weapon'] as const) if (p.buffer[k] > 0) p.buffer[k]--;
  if (inp.pressed & Btn.Main) p.buffer.main = T.inputBufferTicks;
  if (inp.pressed & Btn.Sub) p.buffer.sub = T.inputBufferTicks;
  if (inp.pressed & Btn.Dodge) p.buffer.dodge = T.inputBufferTicks;
  if (inp.pressed & Btn.Weapon) p.buffer.weapon = T.inputBufferTicks;
  if (p.invulnTicks > 0) p.invulnTicks--;

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
