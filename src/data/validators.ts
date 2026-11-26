// 読み込んだ JSON を検証して Content へ組み立てる。
// ブラウザ（fetch）と Node のテスト（fs）の両方から同じ関数を使う。
// 問題は黙って直さず、すべて errors に積んで呼び出し側へ返す。

import { buildFollowTable } from '../game/follow';
import { AreaShape, NavGraph } from '../game/areaShape';
import { VAULT_REACH, groundAt } from '../game/world';
import { VAULT_IN } from '../game/player';
import { reliefAt } from '../game/relief';
import { validateBestiary, type BestiaryDef } from './bestiary';
import { validateStory, type StoryDef } from './story';
import { validateBoard, validateDeliveries, validateSupport } from './questBoard';
import {
  ARMOR_SLOTS,
  ELEMENT_IDS,
  HUB_PROP_ARTS,
  HUB_SCENERY_KINDS,
  PLATFORM_LOOKS,
  FINISH_STATES,
  STATUS_KINDS,
  GATHER_BAG,
  questTargets,
  SCHEMA_VERSION,
  recipeFrom,
  recipeResult,
  type ActionDef,
  type AppearanceCatalog,
  type ArmorDef,
  type ElementRules,
  type SkillDef,
  type ArmorSlot,
  type Content,
  type ContentIndex,
  type CurveDef,
  type DeliveriesDef,
  type EdgeRules,
  type FieldDef,
  type HubDef,
  type ItemDef,
  type LootDef,
  type LootRoll,
  type MapDef,
  type MaterialDef,
  type FollowDef,
  type MonsterDef,
  type PlayerTuning,
  type QuestBoardDef,
  type QuestDef,
  type RankDef,
  type RecipeDef,
  type ShapeTrackDef,
  type ShopDef,
  type SupportDef,
  type WeaponDef,
  type WeaponFamilyDef,
} from './schemas';

export type JsonGetter = (path: string) => Promise<unknown>;

export class ContentError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(`データ検証で ${errors.length} 件の問題:\n- ${errors.join('\n- ')}`);
    this.errors = errors;
  }
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInt = (v: unknown): v is number => isNum(v) && Number.isInteger(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isTriple = (v: unknown): boolean => Array.isArray(v) && v.length === 3 && v.every(isNum);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function checkVersion(where: string, v: unknown, errors: string[]): void {
  if (v !== SCHEMA_VERSION) errors.push(`${where}: schemaVersion が ${SCHEMA_VERSION} ではない (${String(v)})`);
}

export function validateAction(a: ActionDef, errors: string[]): void {
  const w = `action ${a.actionId}`;
  checkVersion(w, a.schemaVersion, errors);
  if (!isStr(a.actionId)) errors.push(`${w}: actionId が無い`);
  if (!isStr(a.clip)) errors.push(`${w}: clip が無い`);
  if (a.tickRate !== 60) errors.push(`${w}: tickRate は 60 固定`);
  if (!isInt(a.durationTicks) || a.durationTicks <= 0) errors.push(`${w}: durationTicks が不正`);
  // phases は 0 から durationTicks まで隙間なく並ぶこと
  let cursor = 0;
  for (const p of a.phases ?? []) {
    if (p.from !== cursor) errors.push(`${w}: phase ${p.id} の from=${p.from} が直前の to=${cursor} と繋がらない`);
    if (!(p.to > p.from)) errors.push(`${w}: phase ${p.id} の区間が空`);
    cursor = p.to;
  }
  if (cursor !== a.durationTicks) errors.push(`${w}: phases の終わり ${cursor} が durationTicks ${a.durationTicks} と一致しない`);
  const inRange = (from: number, to: number): boolean => isInt(from) && isInt(to) && from >= 0 && to > from && to <= a.durationTicks;
  const ids = new Set<string>();
  for (const h of a.hitWindows ?? []) {
    if (!inRange(h.from, h.to)) errors.push(`${w}: hitWindow ${h.id} の区間が範囲外`);
    if (ids.has(h.id)) errors.push(`${w}: hitWindow id ${h.id} が重複`);
    ids.add(h.id);
    if (!isNum(h.damageCoefficient) || h.damageCoefficient < 0) errors.push(`${w}: hitWindow ${h.id} の damageCoefficient が不正`);
    if (!isInt(h.maxHitsPerTarget) || h.maxHitsPerTarget < 1) errors.push(`${w}: hitWindow ${h.id} の maxHitsPerTarget が不正`);
    if (!isInt(h.hitstopTicks) || h.hitstopTicks < 0) errors.push(`${w}: hitWindow ${h.id} の hitstopTicks が不正`);
    if (h.contact !== undefined && h.contact !== 'shield') errors.push(`${w}: hitWindow ${h.id} の contact が不正（shield だけ）`);
    if (!['cut', 'blunt', 'shot'].includes(h.damageType)) errors.push(`${w}: hitWindow ${h.id} の damageType が不正`);
  }
  for (const c of a.cancelWindows ?? []) {
    if (!inRange(c.from, c.to)) errors.push(`${w}: cancelWindow [${c.from},${c.to}) が範囲外`);
    if (!Array.isArray(c.into) || c.into.length === 0) errors.push(`${w}: cancelWindow の into が空`);
  }
  for (const e of a.events ?? []) {
    if (!isInt(e.tick) || e.tick < 0 || e.tick >= a.durationTicks) errors.push(`${w}: event ${e.type}:${e.id} の tick が範囲外`);
  }
  for (const iv of a.invulnerable ?? []) {
    if (!inRange(iv.from, iv.to)) errors.push(`${w}: invulnerable [${iv.from},${iv.to}) が範囲外`);
  }
  if (a.turning && (!isInt(a.turning.untilTick) || !isNum(a.turning.maxDegreesPerSecond))) errors.push(`${w}: turning が不正`);
  if (!(FINISH_STATES as readonly string[]).includes(a.onFinish)) errors.push(`${w}: onFinish "${a.onFinish}" は未定義の状態`);
  if (a.charge) {
    const c = a.charge;
    if (!isInt(c.holdTick) || c.holdTick < 0 || c.holdTick >= a.durationTicks) errors.push(`${w}: charge.holdTick が範囲外`);
    if (c.coefficientScale.length !== c.levelTicks.length + 1) errors.push(`${w}: charge.coefficientScale は levelTicks より 1 つ多いこと`);
    if (c.hitstopBonus.length !== c.levelTicks.length + 1) errors.push(`${w}: charge.hitstopBonus は levelTicks より 1 つ多いこと`);
    if (a.hitWindows.some((h) => h.from <= c.holdTick)) errors.push(`${w}: charge.holdTick は最初の hitWindow より前に置く`);
  }
}

export function validateTrack(t: ShapeTrackDef, errors: string[]): void {
  const w = `track ${t.id}`;
  if (!isStr(t.id)) errors.push(`${w}: id が無い`);
  if (!isNum(t.radius) || t.radius <= 0) errors.push(`${w}: radius が不正`);
  if (!isNum(t.from) || !isNum(t.to) || t.to <= t.from) errors.push(`${w}: from/to が不正`);
  if (!Array.isArray(t.keys) || t.keys.length === 0) {
    errors.push(`${w}: keys が空`);
    return;
  }
  let last = -Infinity;
  for (const k of t.keys) {
    if (!isNum(k.t) || k.t <= last) errors.push(`${w}: keys の t が昇順ではない (${k.t})`);
    last = k.t;
    if (!isTriple(k.grip) || !isTriple(k.dir)) errors.push(`${w}: key t=${k.t} の grip/dir が不正`);
    else if (Math.hypot(k.dir[0], k.dir[1], k.dir[2]) < 1e-6) errors.push(`${w}: key t=${k.t} の dir が零ベクトル`);
    // 刃の面の向き（v0.40.0。描画だけ）: 刃の向きと平行に近いと、面が決まらない
    if (k.normal !== undefined) {
      if (!isTriple(k.normal) || Math.hypot(k.normal[0], k.normal[1], k.normal[2]) < 1e-6) errors.push(`${w}: key t=${k.t} の normal が不正`);
      else if (isTriple(k.dir)) {
        const n = Math.hypot(...k.normal) * Math.hypot(...k.dir);
        if (Math.abs(k.normal[0] * k.dir[0] + k.normal[1] * k.dir[1] + k.normal[2] * k.dir[2]) / n > 0.9) errors.push(`${w}: key t=${k.t} の normal が dir とほぼ平行`);
      }
    }
  }
  // 隣り合うキーの面の向きが真逆だと、間の向きが決まらない
  for (let i = 1; i < t.keys.length; i++) {
    const a = t.keys[i - 1]!.normal ?? t.planeNormal, b = t.keys[i]!.normal ?? t.planeNormal;
    if (a && b && isTriple(a) && isTriple(b) && a[0] * b[0] + a[1] * b[1] + a[2] * b[2] < -0.999 * Math.hypot(...a) * Math.hypot(...b)) errors.push(`${w}: t=${t.keys[i - 1]!.t} と ${t.keys[i]!.t} の normal が真逆`);
  }
}

export function validateCurve(c: CurveDef, errors: string[]): void {
  const w = `curve ${c.id}`;
  let last = -Infinity;
  if (!Array.isArray(c.keys) || c.keys.length < 2) errors.push(`${w}: keys は 2 点以上`);
  for (const k of c.keys ?? []) {
    if (!Array.isArray(k) || !isNum(k[0]) || !isNum(k[1])) errors.push(`${w}: key が不正`);
    else {
      if (k[0] <= last) errors.push(`${w}: tick が昇順ではない`);
      last = k[0];
    }
  }
}

function validateMonster(m: MonsterDef, errors: string[]): void {
  const w = `monster ${m.id}`;
  checkVersion(w, m.schemaVersion, errors);
  if (!isNum(m.hp) || m.hp <= 0) errors.push(`${w}: hp が不正`);
  if (!Array.isArray(m.parts) || m.parts.length === 0) errors.push(`${w}: parts が空`);
  const ids = new Set<string>();
  for (const p of m.parts ?? []) {
    if (ids.has(p.id)) errors.push(`${w}: part ${p.id} が重複`);
    ids.add(p.id);
    for (const k of ['cut', 'blunt', 'shot'] as const) {
      if (!isNum(p.hitzone?.[k]) || p.hitzone[k] < 0) errors.push(`${w}: part ${p.id} の hitzone.${k} が不正`);
    }
    if (!Array.isArray(p.shapes) || p.shapes.length === 0) errors.push(`${w}: part ${p.id} の shapes が空`);
    for (const s of p.shapes ?? []) {
      if (!isTriple(s.a) || (s.b !== undefined && !isTriple(s.b)) || !isNum(s.r) || s.r <= 0) errors.push(`${w}: part ${p.id} の shape が不正`);
    }
  }
  if (!isObj(m.ai) || !Array.isArray(m.ai.choices)) errors.push(`${w}: ai が不正`);
  // 属性の印と頭（v0.33.0）
  const els = new Set<string>(ELEMENT_IDS);
  if (m.element !== undefined && !els.has(m.element)) errors.push(`${w}: element が不正`);
  for (const k of ['weak', 'resist'] as const) if (m[k] !== undefined && !(Array.isArray(m[k]) && m[k].every((e) => els.has(e)))) errors.push(`${w}: ${k} が不正`);
  if ((m.weak ?? []).some((e) => (m.resist ?? []).includes(e))) errors.push(`${w}: 同じ属性が、弱点と耐性の両方にある`);
  const heads = (m.parts ?? []).filter((p) => p.head === true).length;
  if (heads !== 1) errors.push(`${w}: 頭の部位（head: true）が ${heads} 個（1 個にする。気絶はここにたまる）`);
  const H = m.herd;
  if (H !== undefined) {
    const range = (v: unknown): boolean => Array.isArray(v) && v.length === 2 && isInt(v[0]) && isInt(v[1]) && v[0] >= 1 && v[1] >= v[0];
    if (!range(H.size) || H.size[1] > 12) errors.push(`${w}: herd.size が不正（1〜12 頭）`);
    if (!(H.spacing > 0 && H.fleeRange > 0 && H.alertRange > H.fleeRange)) errors.push(`${w}: herd の距離が不正（気づく距離は、逃げ出す距離より遠くする）`);
    if (!(H.fleeSpeedScale > 0 && isInt(H.fleeTicks) && H.fleeTicks > 0)) errors.push(`${w}: herd の逃げ方が不正`);
    if (!(H.fightChance >= 0 && H.fightChance <= 1 && range(H.fightTicks))) errors.push(`${w}: herd の反撃が不正`);
    if (typeof H.scatter !== 'boolean') errors.push(`${w}: herd.scatter が不正`);
    if (m.captureAllowed) errors.push(`${w}: 群れの幼体は捕獲できない（captureAllowed: false）`);
    if (!(m.moveSpeed && m.moveSpeed > 0)) errors.push(`${w}: 群れの幼体には moveSpeed が要る`);
  }
}

function validateMap(m: MapDef, errors: string[]): void {
  const w = `map ${m.id}`;
  checkVersion(w, m.schemaVersion, errors);
  const b = m.bounds;
  if (!b || !(b.maxX > b.minX) || !(b.maxZ > b.minZ)) errors.push(`${w}: bounds が不正`);
  if (!isNum(m.stepUp)) errors.push(`${w}: stepUp が無い`);
  if (m.stepDown !== undefined && !(isNum(m.stepDown) && m.stepDown > 0)) errors.push(`${w}: stepDown が不正`);
  for (const p of m.platforms ?? []) {
    if (!(p.maxX > p.minX) || !(p.maxZ > p.minZ) || !isNum(p.h)) errors.push(`${w}: platform が不正`);
    if (p.look !== undefined && !PLATFORM_LOOKS.includes(p.look)) errors.push(`${w}: platform の look ${String(p.look)} が不明`);
  }
  for (const r of m.rocks ?? []) if (r.y !== undefined && !(isNum(r.y) && r.y < r.h)) errors.push(`${w}: rock の y が不正（下の端は上の端より低く）`);
}

/** 相互参照の検査。存在しない曲線・軌道・技を指していないか。 */
export function crossCheck(c: Content, errors: string[]): void {
  for (const a of c.actions.values()) {
    const w = `action ${a.actionId}`;
    if (a.rootMotion.curveId && !c.curves.has(a.rootMotion.curveId)) errors.push(`${w}: curve ${a.rootMotion.curveId} が無い`);
    if (a.weaponTrack && !c.tracks.has(a.weaponTrack)) errors.push(`${w}: weaponTrack ${a.weaponTrack} が無い`);
    for (const h of a.hitWindows) {
      if (!c.tracks.has(h.shapeTrack)) errors.push(`${w}: shapeTrack ${h.shapeTrack} が無い`);
    }
  }
  for (const f of c.families.values()) {
    const w = `family ${f.id}`;
    for (const [slot, id] of Object.entries(f.actions)) {
      if (!c.actions.has(id)) errors.push(`${w}: actions.${slot} の ${id} が無い`);
    }
    for (const [name, id] of Object.entries(f.cancelNames)) {
      if (!c.actions.has(id)) errors.push(`${w}: cancelNames.${name} の ${id} が無い`);
    }
    // 複合入力（v0.40.0）で出す技は、複合の技（actions.combo）を持つ系統だけ
    for (const [name, key] of Object.entries(f.cancelButtons ?? {})) {
      if (!(name in f.cancelNames)) errors.push(`${w}: cancelButtons.${name} が cancelNames に無い`);
      if (key === 'combo' && !f.actions.combo) errors.push(`${w}: cancelButtons.${name} は combo だが、actions.combo が無い`);
    }
    if (f.labels && f.actions.combo && !f.labels.combo) errors.push(`${w}: actions.combo があるのに labels.combo（ボタンの表示名）が無い`);
  }
  for (const wpn of c.weapons.values()) {
    if (!c.families.has(wpn.family)) errors.push(`weapon ${wpn.id}: family ${wpn.family} が無い`);
    if (!isNum(wpn.attack) || wpn.attack <= 0) errors.push(`weapon ${wpn.id}: attack が不正`);
  }
  for (const m of c.monsters.values()) {
    const partIds = new Set(m.parts.map((p) => p.id));
    for (const ch of m.ai.choices) {
      if (!c.actions.has(ch.actionId)) errors.push(`monster ${m.id}: ai の ${ch.actionId} が無い`);
      if (ch.ifSevered) {
        if (!c.actions.has(ch.ifSevered.actionId)) errors.push(`monster ${m.id}: ifSevered の ${ch.ifSevered.actionId} が無い`);
        if (!partIds.has(ch.ifSevered.partId)) errors.push(`monster ${m.id}: ifSevered の部位 ${ch.ifSevered.partId} が無い`);
      }
    }
    if (m.discover && !c.actions.has(m.discover.actionId)) errors.push(`monster ${m.id}: discover の ${m.discover.actionId} が無い`);
    if (m.rage && !c.actions.has(m.rage.actionId)) errors.push(`monster ${m.id}: rage の ${m.rage.actionId} が無い`);
    for (const p of m.parts) {
      if (p.sever && (!Array.isArray(p.sever.shapesAfter) || !(p.sever.threshold > 0))) errors.push(`monster ${m.id}: part ${p.id} の sever が不正`);
      if (p.flinch && !(p.flinch.threshold > 0 && p.flinch.ticks > 0)) errors.push(`monster ${m.id}: part ${p.id} の flinch が不正`);
    }
  }
  for (const q of c.quests.values()) {
    if (!c.maps.has(q.mapId)) errors.push(`quest ${q.id}: map ${q.mapId} が無い`);
    if (q.fieldId !== undefined) {
      const fd = c.fields.get(q.fieldId);
      if (!fd) errors.push(`quest ${q.id}: field ${q.fieldId} が無い`);
      else {
        if (fd.legacyMapId !== q.mapId) errors.push(`quest ${q.id}: field ${q.fieldId} の「これまでの狩場」が mapId と違う`);
        if (!q.targets && q.targetMonsterId && !fd.routes[q.targetMonsterId]) errors.push(`quest ${q.id}: field ${q.fieldId} に、標的 ${q.targetMonsterId} の巡り方が無い`);
      }
    }
    if (q.targets !== undefined) {
      // 群れの依頼: 種ごとの頭数。どれも群れで暮らす種で、討伐だけ
      if (!Array.isArray(q.targets) || q.targets.length === 0) errors.push(`quest ${q.id}: targets が空`);
      else if (q.targets[0]!.monsterId !== q.targetMonsterId) errors.push(`quest ${q.id}: targetMonsterId は targets の 1 つ目と同じにする`);
      const seen = new Set<string>();
      for (const t of q.targets ?? []) {
        const tm = c.monsters.get(t.monsterId);
        if (!tm) errors.push(`quest ${q.id}: 標的 ${t.monsterId} が無い`);
        else if (!tm.herd) errors.push(`quest ${q.id}: 標的 ${t.monsterId} は群れで暮らさない`);
        if (!(isInt(t.count) && t.count >= 1 && t.count <= 12)) errors.push(`quest ${q.id}: 標的 ${t.monsterId} の頭数が不正（1〜12）`);
        if (seen.has(t.monsterId)) errors.push(`quest ${q.id}: 標的 ${t.monsterId} が重複`);
        seen.add(t.monsterId);
      }
      if (q.kind !== 'slay') errors.push(`quest ${q.id}: 群れの依頼は討伐だけ（kind: slay）`);
    }
    if (q.kind === 'gather') {
      // 狩らない依頼（v0.27.0）: 標的は無い（ダミーの標的・空の targets で表さない）。中身は validateGather
      if (q.targetMonsterId !== undefined || q.targets !== undefined || q.monsterSpawn !== undefined) errors.push(`quest ${q.id}: 狩らない依頼に、標的・出る位置を書かない`);
      errors.push(...validateGather(c, q));
    } else {
      if (q.gather !== undefined) errors.push(`quest ${q.id}: 狩りの依頼に gather を書かない`);
      if (!q.targetMonsterId || !c.monsters.has(q.targetMonsterId)) errors.push(`quest ${q.id}: monster ${String(q.targetMonsterId)} が無い`);
      if (!q.monsterSpawn || !isNum(q.monsterSpawn.x) || !isNum(q.monsterSpawn.z)) errors.push(`quest ${q.id}: monsterSpawn が無い`);
    }
    if (!c.ranks.has(q.rankId)) errors.push(`quest ${q.id}: 段階 ${String(q.rankId)} が無い`);
    for (const need of q.requires ?? []) {
      const other = c.quests.get(need);
      if (!other || need === q.id) errors.push(`quest ${q.id}: requires の依頼 ${need} が不正`);
      // 先に達成する依頼は、同じか下の段階（上の段階を条件にすると、どこからも入れなくなる）
      else if ((c.ranks.get(other.rankId)?.order ?? 0) > (c.ranks.get(q.rankId)?.order ?? 0)) errors.push(`quest ${q.id}: requires の依頼 ${need} の段階が上`);
    }
    if (!(q.timeLimitTicks > 0) || !(q.maxFaints > 0)) errors.push(`quest ${q.id}: 制限が不正`);
    // フィールドの時間（v0.26.0）: フィールドの依頼だけ。正の整数で、1 つの狩場の時間より短くしない
    if (q.fieldTimeLimitTicks !== undefined && !(q.fieldId && isInt(q.fieldTimeLimitTicks) && q.fieldTimeLimitTicks >= q.timeLimitTicks)) errors.push(`quest ${q.id}: fieldTimeLimitTicks が不正（フィールドの依頼だけ、timeLimitTicks 以上の整数）`);
    if (q.monsterAttackScale !== undefined && !(q.monsterAttackScale > 0 && q.monsterAttackScale <= 3)) errors.push(`quest ${q.id}: monsterAttackScale が不正`);
    if (q.kind !== 'slay' && q.kind !== 'hunt' && q.kind !== 'gather') errors.push(`quest ${q.id}: kind "${String(q.kind)}" は未定義`);
    if (q.returnTicks !== undefined && !(isInt(q.returnTicks) && q.returnTicks >= 0)) errors.push(`quest ${q.id}: returnTicks が不正`);
    for (const s of q.supplies ?? []) {
      const it = c.items.get(s.itemId);
      if (!it) errors.push(`quest ${q.id}: 支給品 ${s.itemId} が無い`);
      else if (!(isInt(s.count) && s.count > 0 && s.count <= it.carryMax)) errors.push(`quest ${q.id}: 支給品 ${s.itemId} の数が不正（持てるのは ${it.carryMax} 個まで）`);
    }
    if (q.rewards) {
      if (!(isInt(q.rewards.money) && q.rewards.money >= 0)) errors.push(`quest ${q.id}: 報酬の金額が不正`);
      for (const s of q.rewards.items ?? []) if (!c.materials.has(s.itemId) || !(isInt(s.count) && s.count > 0)) errors.push(`quest ${q.id}: 報酬 ${s.itemId} が不正`);
    }
  }
  for (const it of c.items.values()) {
    const w = `item ${it.id}`;
    const a = c.actions.get(it.useActionId);
    if (!a) errors.push(`${w}: useActionId ${it.useActionId} が無い`);
    else if (!(isInt(it.effectTick) && it.effectTick >= 0 && it.effectTick < a.durationTicks)) errors.push(`${w}: effectTick が行動の長さの外`);
    if (!(isInt(it.carryMax) && it.carryMax > 0)) errors.push(`${w}: carryMax が不正`);
    if (it.maintenance !== undefined && typeof it.maintenance !== 'boolean') errors.push(`${w}: maintenance が不正`);
    if (it.kind === 'heal') {
      if (!(isNum(it.heal) && it.heal > 0)) errors.push(`${w}: heal が不正`);
    } else if (it.kind === 'trap') {
      if (!(it.trap && it.trap.armTicks >= 0 && it.trap.radius > 0 && it.trap.holdTicks > 0 && it.trap.lifeTicks > 0)) errors.push(`${w}: trap が不正`);
    } else if (it.kind === 'tranq') {
      if (!(it.tranq && it.tranq.range > 0 && it.tranq.halfAngleDeg > 0)) errors.push(`${w}: tranq が不正`);
    } else if (it.kind === 'mark') {
      if (!(it.mark && it.mark.range > 0 && it.mark.halfAngleDeg > 0 && Number.isInteger(it.mark.ticks) && it.mark.ticks > 0)) errors.push(`${w}: mark が不正`);
    } else if (it.kind === 'whet') {
      // 研いだ後は納める（v0.40.0。2G に合わせて、納刀して使い、背から下ろして研ぐ。護刃が防御を構えたまま使った時だけ、抜刀のまま）
      if (a && a.onFinish !== 'sheathed_idle') errors.push(`${w}: 研ぐ行動の onFinish は sheathed_idle にする`);
    } else errors.push(`${w}: kind "${String(it.kind)}" は未定義`);
  }
  const checkRoll = (w: string, r: LootRoll | undefined): void => {
    if (!r || !(isInt(r.count) && r.count > 0) || !Array.isArray(r.table) || r.table.length === 0) {
      errors.push(`${w}: 抽選の定義が不正`);
      return;
    }
    for (const e of r.table) if (!c.materials.has(e.itemId) || !(e.weight > 0)) errors.push(`${w}: ${e.itemId} が不正`);
  };
  for (const l of c.loot.values()) {
    checkRoll(`loot ${l.id} carve`, l.carve);
    checkRoll(`loot ${l.id} capture`, l.capture);
    for (const [k, r] of Object.entries(l.severed ?? {})) checkRoll(`loot ${l.id} severed.${k}`, r);
    for (const [k, r] of Object.entries(l.breaks ?? {})) checkRoll(`loot ${l.id} breaks.${k}`, r);
  }
  for (const m of c.monsters.values()) {
    const l = m.lootId ? c.loot.get(m.lootId) : undefined;
    if (m.lootId && !l) errors.push(`monster ${m.id}: lootId ${m.lootId} が無い`);
    const tables = [l, ...Object.entries(m.lootByRank ?? {}).map(([rankId, lootId]) => {
      if (!c.ranks.has(rankId)) errors.push(`monster ${m.id}: lootByRank の段階 ${rankId} が無い`);
      if (!c.loot.has(lootId)) errors.push(`monster ${m.id}: lootByRank の ${lootId} が無い`);
      return c.loot.get(lootId);
    })];
    for (const t of tables) for (const k of [...Object.keys(t?.severed ?? {}), ...Object.keys(t?.breaks ?? {})]) if (!m.parts.some((p) => p.id === k)) errors.push(`monster ${m.id}: loot ${t!.id} の部位 ${k} が無い`);
    if (m.captureAllowed && !(m.capture && m.capture.hpRatio > 0 && m.capture.hpRatio < 1 && isInt(m.capture.tranqNeeded) && m.capture.tranqNeeded > 0 && m.capture.tranqDecayTicks > 0)) errors.push(`monster ${m.id}: capture が不正`);
  }
  for (const a of c.actions.values()) {
    for (const h of a.hazards ?? []) {
      if (!Number.isInteger(h.tick) || h.tick < 0 || h.tick >= a.durationTicks || !(h.count > 0) || !(h.radius > 0) || !(h.warnTicks > 0)) errors.push(`action ${a.actionId}: hazards が不正`);
    }
  }
  if (!c.actions.has(c.player.rollActionId)) errors.push(`player: rollActionId ${c.player.rollActionId} が無い`);
  // cancelWindow の into は、共通名（roll）か、どこかの武器系統の cancelNames に定義されていること
  const known = new Set<string>(['roll']);
  for (const f of c.families.values()) for (const k of Object.keys(f.cancelNames)) known.add(k);
  for (const a of c.actions.values()) {
    for (const cw of a.cancelWindows) for (const n of cw.into) if (!known.has(n)) errors.push(`action ${a.actionId}: cancel 先 "${n}" が未定義`);
  }
  for (const f of c.families.values()) {
    if (f.edge !== undefined && !(f.edge && f.edge.wearPerMotion > 0 && f.edge.wearPerMotion <= 20 && typeof f.edge.label === 'string' && f.edge.label !== '')) errors.push(`family ${f.id}: edge が不正`);
  }
  for (const s of c.player.huntSupplies ?? []) {
    const it = c.items.get(s.itemId);
    if (!it) errors.push(`player: huntSupplies の ${s.itemId} が無い`);
    else if (!(Number.isInteger(s.count) && s.count > 0 && s.count <= it.carryMax)) errors.push(`player: huntSupplies の ${s.itemId} の数が不正`);
  }
  for (const s of c.player.trainingSupplies ?? []) {
    const it = c.items.get(s.itemId);
    if (!it) errors.push(`player: 訓練用の道具 ${s.itemId} が無い`);
    else if (!(isInt(s.count) && s.count > 0 && s.count <= it.carryMax)) errors.push(`player: 訓練用の道具 ${s.itemId} の数が不正`);
  }
  // 最初から持つ武器が 1 つはあること
  if (![...c.weapons.values()].some((w) => w.starter)) errors.push('weapons: starter の武器が 1 つも無い');
  validateRanks(c, errors);
  validateArmor(c, errors);
  // 工房: 元と結果の武器（防具）があり、同じ系統（部位）で、素材はどこかで手に入ること（手に入らない素材を要求しない）
  const obtainable = obtainableMaterials(c);
  const matRank = materialRanks(c);
  const results = new Set<string>();
  const sources = new Set<string>();
  for (const r of c.recipes.values()) {
    const w = `recipe ${r.id}`;
    if (r.kind === 'upgrade') {
      const from = c.weapons.get(r.fromWeaponId);
      const to = c.weapons.get(r.resultWeaponId);
      if (!from) errors.push(`${w}: 元の武器 ${r.fromWeaponId} が無い`);
      if (!to) errors.push(`${w}: 結果の武器 ${r.resultWeaponId} が無い`);
      if (from && to && from.family !== to.family) errors.push(`${w}: 元と結果の系統が違う`);
      if (to?.starter) errors.push(`${w}: 結果の武器が最初から持つ武器になっている`);
      if (from && to && !(to.attack > from.attack)) errors.push(`${w}: 強化しても攻撃力が上がらない`);
    } else if (r.kind === 'armor_upgrade') {
      const from = c.armor.get(r.fromArmorId);
      const to = c.armor.get(r.resultArmorId);
      if (!from) errors.push(`${w}: 元の防具 ${r.fromArmorId} が無い`);
      if (!to) errors.push(`${w}: 結果の防具 ${r.resultArmorId} が無い`);
      if (from && to && from.slot !== to.slot) errors.push(`${w}: 元と結果の部位が違う`);
      if (to?.starter) errors.push(`${w}: 結果の防具が最初から持つ防具になっている`);
      if (from && to && !(to.defense > from.defense)) errors.push(`${w}: 強化しても防御力が上がらない`);
    } else if (r.kind === 'craft' || r.kind === 'armor_craft') {
      // 作る（v0.32.0。ChatGPT の全装備四級版 #15）: 結果は系列と級を持ち、最初から持つ物ではない。素材は、その級までの依頼で手に入る
      const to = r.kind === 'craft' ? c.weapons.get(r.resultWeaponId) : c.armor.get(r.resultArmorId);
      if (!to) errors.push(`${w}: 結果の${r.kind === 'craft' ? '武器' : '防具'} ${recipeResult(r)} が無い`);
      else {
        if (to.starter) errors.push(`${w}: 結果が最初から持つ物になっている`);
        if (!to.series || !to.rankId) errors.push(`${w}: 結果に系列（series）と級（rankId）が無い`);
        const order = to.rankId ? c.ranks.get(to.rankId)?.order : undefined;
        if (to.rankId && order === undefined) errors.push(`${w}: 級 ${to.rankId} が無い`);
        for (const s of r.cost?.items ?? []) {
          const got = matRank.get(s.itemId);
          if (order !== undefined && got !== undefined && got > order) errors.push(`${w}: 素材 ${s.itemId} は、結果の級より上の依頼でしか手に入らない`);
        }
      }
    } else errors.push(`${w}: kind "${String((r as { kind: unknown }).kind)}" は未定義`);
    const fromId = recipeFrom(r), resultId = recipeResult(r);
    if (fromId === resultId) errors.push(`${w}: 元と結果が同じ`);
    if (results.has(resultId)) errors.push(`${w}: 結果 ${resultId} を作るレシピが重複`);
    results.add(resultId);
    // 1 つの武器・防具から進める先は 1 つ（派生はまだ無い。工房の画面は「次の強化」を 1 つだけ出す）
    if (fromId !== null) {
      if (sources.has(fromId)) errors.push(`${w}: 元 ${fromId} から進めるレシピが重複`);
      sources.add(fromId);
    }
    if (!(r.cost && isInt(r.cost.money) && r.cost.money >= 0 && Array.isArray(r.cost.items))) {
      errors.push(`${w}: cost が不正`);
      continue;
    }
    const seen = new Set<string>();
    for (const s of r.cost.items) {
      if (!c.materials.has(s.itemId)) errors.push(`${w}: 素材 ${s.itemId} が無い`);
      else if (!obtainable.has(s.itemId)) errors.push(`${w}: 素材 ${s.itemId} は、どの報酬・剥ぎ取りからも手に入らない`);
      if (!(isInt(s.count) && s.count > 0)) errors.push(`${w}: 素材 ${s.itemId} の数が不正`);
      if (seen.has(s.itemId)) errors.push(`${w}: 素材 ${s.itemId} が重複`);
      seen.add(s.itemId);
    }
  }
}

/** 属性と状態異常の決まり（v0.33.0）。値の範囲だけを確かめる */
export function validateElementRules(e: ElementRules | undefined, errors: string[]): void {
  const w = 'elements';
  if (!e || !Array.isArray(e.elements)) {
    errors.push(`${w}: 決まりが無い`);
    return;
  }
  const ids = e.elements.map((x) => x.id).sort().join();
  if (ids !== [...ELEMENT_IDS].sort().join()) errors.push(`${w}: 属性は ${ELEMENT_IDS.join('・')} の 6 つ`);
  if (!(e.zone?.weak > 1 && e.zone.resist > 0 && e.zone.resist < 1)) errors.push(`${w}: zone（弱点 > 1、0 < 耐性 < 1）が不正`);
  if (!(e.compoundNonWeak > 0 && e.compoundNonWeak <= 1)) errors.push(`${w}: compoundNonWeak が不正`);
  if (!(e.monsterElementShare >= 0 && e.monsterElementShare < 1)) errors.push(`${w}: monsterElementShare が不正`);
  if (!(Array.isArray(e.resistRange) && e.resistRange[0] < 0 && e.resistRange[1] > 0)) errors.push(`${w}: resistRange が不正`);
  if (!(e.critCap > 0 && e.critCap <= 100)) errors.push(`${w}: critCap が不正`);
  const a = e.ailment;
  if (!(a && a.threshold > 0 && a.growth >= 1 && a.stunGrowth >= 1 && isInt(a.decayDelayTicks) && a.decayPerSec >= 0 && isInt(a.para?.ticks) && isInt(a.sleep?.ticks) && a.sleep.wakeScale >= 1
    && isInt(a.stun?.ticks) && a.poison?.hpRatio > 0 && isInt(a.poison.ticks) && isInt(a.poison.hits) && a.poison.hits > 0 && isInt(a.lockGraceTicks) && a.stunPerMotion >= 0)) errors.push(`${w}: ailment が不正`);
}

/** 武器の属性・状態異常と、防具の耐性・技能（v0.33.0）が、決まりの中の名前と値か */
export function validateGear(c: Content, errors: string[]): void {
  const els = new Set<string>(ELEMENT_IDS);
  for (const wp of c.weapons.values()) {
    const w = `weapon ${wp.id}`;
    const e = wp.element;
    if (e.type === 'compound') {
      if (!(e.elements?.length === 2 && e.elements.every((x) => els.has(x)) && e.elements[0] !== e.elements[1])) errors.push(`${w}: 複合の属性は、違う 2 つ`);
    } else if (e.type !== 'none' && !els.has(e.type)) errors.push(`${w}: 属性 ${e.type} が無い`);
    if (e.type === 'none' ? e.value !== 0 : !(e.value > 0)) errors.push(`${w}: 属性値が不正`);
    if (wp.status && !(STATUS_KINDS.includes(wp.status.kind) && wp.status.potency > 0)) errors.push(`${w}: 状態異常が不正`);
  }
  for (const a of c.armor.values()) {
    const w = `armor ${a.id}`;
    for (const [k, v] of Object.entries(a.resist ?? {})) if (!els.has(k) || !Number.isFinite(v)) errors.push(`${w}: 耐性 ${k} が不正`);
    const sk = a.skill;
    if (!sk) continue;
    if (!c.skills.has(sk.id)) errors.push(`${w}: 技能 ${sk.id} が無い`);
    if (!(isInt(sk.points) && sk.points > 0)) errors.push(`${w}: 技能の点が不正`);
    if (sk.id === 'element_resistance' && !(sk.element && els.has(sk.element))) errors.push(`${w}: 個別属性耐性に属性が無い`);
    if (sk.id === 'status_resistance' && !(sk.status && STATUS_KINDS.includes(sk.status))) errors.push(`${w}: 個別状態耐性に状態異常が無い`);
  }
}

/** 刃の状態の決まり: 段階は鋭い順、最後は 0 から、倍率と弾かれる境目は鋭いほど有利。 */
export function validateEdge(e: EdgeRules | undefined, errors: string[]): void {
  if (!e || !(e.max > 0) || !Array.isArray(e.stages) || e.stages.length === 0) {
    errors.push('weapons: edge（刃の状態の決まり）が無い、または不正');
    return;
  }
  const ids = new Set<string>();
  e.stages.forEach((s, i) => {
    const w = `edge.stages[${i}]`;
    if (typeof s.id !== 'string' || s.id === '' || ids.has(s.id)) errors.push(`${w}: id が無い、または重複`);
    ids.add(s.id);
    if (typeof s.name !== 'string' || s.name === '') errors.push(`${w}: name が無い`);
    if (!(isNum(s.min) && s.min >= 0 && s.min < e.max)) errors.push(`${w}: min が不正`);
    if (!(isNum(s.damageScale) && s.damageScale > 0 && s.damageScale <= 1.5)) errors.push(`${w}: damageScale が不正`);
    if (!(isNum(s.bounceBelow) && s.bounceBelow >= 0 && s.bounceBelow < 1)) errors.push(`${w}: bounceBelow が不正`);
    const prev = e.stages[i - 1];
    if (prev && !(s.min < prev.min && s.damageScale <= prev.damageScale && s.bounceBelow >= prev.bounceBelow)) errors.push(`${w}: 段階は鋭い順に並べる（min は小さく、damageScale は同じか小さく、bounceBelow は同じか大きく）`);
  });
  if (e.stages[e.stages.length - 1]!.min !== 0) errors.push('edge.stages: 最後の段階の min は 0 にする');
  if (!(e.bounce && e.bounce.wearScale >= 1 && isInt(e.bounce.recoilTicks) && e.bounce.recoilTicks > 0 && e.bounce.pushback >= 0)) errors.push('edge.bounce が不正');
}

/** 採取点・納品箱が、エリアの外周から離す距離・岩から離す距離・出口から離す距離（m）。歩いて届き、出入りを塞がない */
export const GATHER_EDGE_MARGIN = 1.6;
export const GATHER_ROCK_MARGIN = 1.2;
export const GATHER_EXIT_MARGIN = 4;

/**
 * 狩らない依頼の検査（v0.27.0）。フィールドの依頼で、要る数より 2 個以上多く採れる（抽選も、採取点の戻りも待たない）。
 * 採れる全部が採集袋に入る（袋が満ちて採れない、が起きない）。採取点と納品箱は、エリアの中で、外周・岩・出口から離れている。
 */
export function validateGather(c: Content, q: QuestDef): string[] {
  const e: string[] = [];
  const w = `quest ${q.id}`;
  const g = q.gather;
  if (!g) return [`${w}: gather が無い`];
  const fd = q.fieldId ? c.fields.get(q.fieldId) : undefined;
  if (!fd) return [`${w}: 狩らない依頼は、フィールドの依頼にする（fieldId）`];
  if (q.fieldTimeLimitTicks === undefined) e.push(`${w}: フィールドの時間（fieldTimeLimitTicks）を書く`);
  if (g.encounters !== 'none') e.push(`${w}: encounters "${String(g.encounters)}" は未定義（いまは none だけ）`);
  if (!(isInt(g.yieldPerNode) && g.yieldPerNode >= 1 && g.yieldPerNode <= 5)) e.push(`${w}: yieldPerNode が不正`);
  if (!Array.isArray(g.needs) || g.needs.length === 0) e.push(`${w}: 要る素材が無い`);
  const need = new Map<string, number>();
  for (const s of g.needs ?? []) {
    if (!c.materials.has(s.itemId)) e.push(`${w}: 要る素材 ${s.itemId} が無い`);
    if (need.has(s.itemId)) e.push(`${w}: 要る素材 ${s.itemId} が 2 行ある`);
    if (!(isInt(s.count) && s.count > 0)) e.push(`${w}: 要る素材 ${s.itemId} の数が不正`);
    need.set(s.itemId, s.count);
  }
  const supply = new Map<string, number>();
  const ids = new Set<string>();
  const place = (label: string, areaId: string, x: number, z: number, campOnly = false): void => {
    const area = fd.areas.find((a) => a.id === areaId);
    if (!area) return void e.push(`${w}: ${label} のエリア ${areaId} が無い`);
    if (campOnly && area.kind !== 'camp') e.push(`${w}: ${label} は野営地に置く`);
    if (!isNum(x) || !isNum(z)) return void e.push(`${w}: ${label} の位置が不正`);
    const shape = area.shape ? new AreaShape(area.shape) : null;
    if (!shape || shape.signedDistance(x, z) < GATHER_EDGE_MARGIN) e.push(`${w}: ${label} がエリア ${areaId} の外か、外周に近すぎる`);
    for (const r of area.rocks) if (Math.hypot(x - r.x, z - r.z) < r.r + GATHER_ROCK_MARGIN) e.push(`${w}: ${label} が岩に近すぎる`);
    for (const x2 of area.exits) if (Math.hypot(x - x2.x, z - x2.z) < x2.r + GATHER_EXIT_MARGIN) e.push(`${w}: ${label} が出口に近すぎる`);
  };
  for (const n of g.nodes ?? []) {
    if (!isStr(n.id) || ids.has(n.id)) e.push(`${w}: 採取点の id ${String(n.id)} が空か重複`);
    ids.add(n.id);
    if (n.kind !== 'gather' && n.kind !== 'mine') e.push(`${w}: 採取点 ${n.id} の kind が不正`);
    if (!need.has(n.itemId)) e.push(`${w}: 採取点 ${n.id} の素材 ${n.itemId} は、要る素材に無い`);
    supply.set(n.itemId, (supply.get(n.itemId) ?? 0) + (g.yieldPerNode ?? 0));
    place(`採取点 ${n.id}`, n.areaId, n.x, n.z);
  }
  for (const [id, n] of need) {
    const got = supply.get(id) ?? 0;
    if (got < n + 2) e.push(`${w}: ${id} は ${got} 個しか採れない（要る ${n} + 予備 2 以上）`);
    if (got > GATHER_BAG.perItem) e.push(`${w}: ${id} が採集袋に入りきらない（${got} > ${GATHER_BAG.perItem}）`);
  }
  if (need.size > GATHER_BAG.kinds) e.push(`${w}: 素材の種類が採集袋に入りきらない`);
  if (!g.depot) e.push(`${w}: 納品箱が無い`);
  else place('納品箱', g.depot.areaId, g.depot.x, g.depot.z, true);
  // 採取点どうし・納品箱は離す（どれを採るか、迷わない）
  const pts = [...(g.nodes ?? []).map((n) => ({ id: n.id, a: n.areaId, x: n.x, z: n.z })), ...(g.depot ? [{ id: '納品箱', a: g.depot.areaId, x: g.depot.x, z: g.depot.z }] : [])];
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
    const a = pts[i]!, b = pts[j]!;
    if (a.a === b.a && Math.hypot(a.x - b.x, a.z - b.z) < 4) e.push(`${w}: ${a.id} と ${b.id} が近すぎる（4m 未満）`);
  }
  return e;
}

/** その依頼の標的から出る素材の表（段階ごとの表があればそれ、無ければモンスターの lootId）。monsterId で、群れの依頼の 2 つ目以降の標的も引ける。 */
export function lootForQuest(c: Content, q: QuestDef, monsterId = q.targetMonsterId): LootDef | undefined {
  if (!monsterId) return undefined;
  const m = c.monsters.get(monsterId);
  const id = m?.lootByRank?.[q.rankId] ?? m?.lootId;
  return id ? c.loot.get(id) : undefined;
}

/** 1 つの依頼で手に入る素材（依頼の報酬と、標的の剥ぎ取り・捕獲・部位。群れの依頼は、標的の種ごとの剥ぎ取り）。 */
export function questMaterials(c: Content, q: QuestDef): Set<string> {
  const out = new Set<string>();
  for (const s of q.rewards?.items ?? []) out.add(s.itemId);
  // 狩らない依頼（v0.27.0）: 採取点の素材（納品の余りを持ち帰る）
  for (const n of q.gather?.nodes ?? []) out.add(n.itemId);
  for (const t of questTargets(q)) {
    const m = c.monsters.get(t.monsterId);
    const l = lootForQuest(c, q, t.monsterId);
    if (!l) continue;
    const rolls: (LootRoll | undefined)[] = [l.carve, m?.captureAllowed && q.kind === 'hunt' ? l.capture : undefined, ...Object.values(l.severed ?? {}), ...Object.values(l.breaks ?? {})];
    for (const r of rolls) for (const e of r?.table ?? []) out.add(e.itemId);
  }
  return out;
}

/** いまの依頼のどれかで手に入る素材。 */
export function obtainableMaterials(c: Content): Set<string> {
  const out = new Set<string>();
  for (const q of c.quests.values()) for (const id of questMaterials(c, q)) out.add(id);
  return out;
}

/** 素材ごとの、手に入るいちばん下の段階（order）。どの依頼からも出ない素材は入らない。 */
export function materialRanks(c: Content): Map<string, number> {
  const out = new Map<string, number>();
  for (const q of c.quests.values()) {
    const order = c.ranks.get(q.rankId)?.order;
    if (order === undefined) continue;
    for (const id of questMaterials(c, q)) out.set(id, Math.min(out.get(id) ?? Infinity, order));
  }
  return out;
}

/** 段階: order は 1 から続き番号、倍率は正の数で、上の段階ほど弱くならない。段階ごとに、受けられる依頼が 1 つはある。 */
function validateRanks(c: Content, errors: string[]): void {
  const ranks = [...c.ranks.values()].sort((a, b) => a.order - b.order);
  if (ranks.length === 0) errors.push('ranks: 段階が 1 つも無い');
  ranks.forEach((r, i) => {
    const w = `rank ${r.id}`;
    if (r.order !== i + 1) errors.push(`${w}: order は 1 から続き番号にする`);
    if (typeof r.name !== 'string' || r.name === '') errors.push(`${w}: name が無い`);
    const m = r.monster;
    if (!(m && [m.hpScale, m.partScale, m.attackScale, m.cooldownScale].every((v) => isNum(v) && v > 0 && v <= 10))) {
      errors.push(`${w}: monster の倍率が不正`);
      return;
    }
    const prev = ranks[i - 1]?.monster;
    if (prev && !(m.hpScale >= prev.hpScale && m.partScale >= prev.partScale && m.attackScale >= prev.attackScale && m.cooldownScale <= prev.cooldownScale)) errors.push(`${w}: 下の段階より弱くなっている`);
    if (![...c.quests.values()].some((q) => q.rankId === r.id)) errors.push(`${w}: この段階の依頼が無い`);
  });
}

/** 防具: 部位は決まった 5 つ、防御力は 0 以上、どの部位にも最初から持つ防具がちょうど 1 つ。 */
function validateArmor(c: Content, errors: string[]): void {
  if (!(isNum(c.armorRules.base) && c.armorRules.base > 0)) errors.push('armor: defense.base が不正');
  for (const s of ARMOR_SLOTS) if (typeof c.armorRules.slotNames?.[s] !== 'string' || c.armorRules.slotNames[s] === '') errors.push(`armor: 部位 ${s} の名前が無い`);
  for (const a of c.armor.values()) {
    const w = `armor ${a.id}`;
    if (!ARMOR_SLOTS.includes(a.slot)) errors.push(`${w}: slot "${String(a.slot)}" は未定義`);
    if (typeof a.name !== 'string' || a.name === '') errors.push(`${w}: name が無い`);
    if (!(isInt(a.defense) && a.defense >= 0 && a.defense <= 9999)) errors.push(`${w}: defense が不正`);
    if (c.weapons.has(a.id) || c.materials.has(a.id) || c.items.has(a.id)) errors.push(`${w}: id がほかの種類と重複`);
  }
  for (const s of ARMOR_SLOTS) {
    const n = [...c.armor.values()].filter((a) => a.slot === s && a.starter).length;
    if (n !== 1) errors.push(`armor: 部位 ${s} の、最初から持つ防具が ${n} 個（1 個にする）`);
  }
}

/** 商店: 売るのは道具、買い取るのは素材。値段は 1 以上。同じものを 2 度並べない。 */
export function validateShop(c: Content, errors: string[]): void {
  const s = c.shop;
  if (!(isInt(s.holdMax) && s.holdMax > 0)) errors.push('shop: holdMax が不正');
  const seen = new Set<string>();
  for (const g of s.goods ?? []) {
    const it = c.items.get(g.itemId);
    if (!it) errors.push(`shop: 道具 ${g.itemId} が無い`);
    else if (it.carryMax > s.holdMax) errors.push(`shop: 道具 ${g.itemId} は、持っておける数より多く持ち出せる`);
    if (!(isInt(g.price) && g.price > 0)) errors.push(`shop: ${g.itemId} の値段が不正`);
    if (seen.has(g.itemId)) errors.push(`shop: ${g.itemId} が重複`);
    seen.add(g.itemId);
  }
  if ((s.goods ?? []).length === 0) errors.push('shop: 売り物が無い');
  for (const g of s.sell ?? []) {
    if (!c.materials.has(g.itemId)) errors.push(`shop: 素材 ${g.itemId} が無い`);
    if (!(isInt(g.price) && g.price > 0)) errors.push(`shop: ${g.itemId} の買い取り値が不正`);
    if (seen.has(g.itemId)) errors.push(`shop: ${g.itemId} が重複`);
    seen.add(g.itemId);
  }
}

/** 拠点: 施設は 4 種類が 1 つずつ。施設の前に立てる（外周の中で、建物の当たりの外）。出発地点から、どの施設の前へも重ならずに立てる。 */
export function validateHub(c: Content, errors: string[]): void {
  const h = c.hub;
  const map = c.maps.get(h.mapId);
  if (!map) {
    errors.push(`hub: map ${h.mapId} が無い`);
    return;
  }
  if (typeof h.name !== 'string' || h.name === '') errors.push('hub: name が無い');
  const pr = c.player.radius;
  const free = (x: number, z: number): boolean =>
    x >= map.bounds.minX + pr && x <= map.bounds.maxX - pr && z >= map.bounds.minZ + pr && z <= map.bounds.maxZ - pr && map.rocks.every((r) => Math.hypot(r.x - x, r.z - z) >= r.r + pr);
  if (!free(map.spawn.x, map.spawn.z)) errors.push('hub: 出発地点が、建物か外周に重なる');
  const ids = new Set<string>();
  for (const kind of ['workshop', 'shop', 'chest'] as const) {
    const n = (h.facilities ?? []).filter((f) => f.kind === kind).length;
    if (n !== 1) errors.push(`hub: 施設 ${kind} が ${n} 個（1 個にする）`);
  }
  // 依頼の受付は、級ごとに 1 つずつ（v0.38.0。ChatGPT の Pull Request #17。受付の級は questRankId。星から級を決めない）
  const coveredRanks = new Set<string>();
  for (const f of (h.facilities ?? []).filter((x) => x.kind === 'quest')) {
    if (f.questRankId === undefined || !c.ranks.has(f.questRankId)) errors.push(`hub facility ${f.id}: 受付の級 ${String(f.questRankId)} が無い`);
    else if (coveredRanks.has(f.questRankId)) errors.push(`hub: 級 ${f.questRankId} の受付が重複`);
    else coveredRanks.add(f.questRankId);
  }
  for (const rankId of c.ranks.keys()) if (!coveredRanks.has(rankId)) errors.push(`hub: 級 ${rankId} の受付が無い`);
  for (const f of h.facilities ?? []) if (f.kind !== 'quest' && f.questRankId !== undefined) errors.push(`hub facility ${f.id}: 依頼受付以外に questRankId を指定できない`);
  // 施設の前（立つ輪）には、その施設の建物のほかの当たりがかからない（v0.35.0。建物と飾り・小物が増えたので）
  for (const f of h.facilities ?? []) {
    for (const r of map.rocks) {
      if (f.building && Math.hypot(r.x - f.building.x, r.z - f.building.z) < 0.01) continue;
      if (Math.hypot(r.x - f.x, r.z - f.z) < r.r + f.r * 0.5) errors.push(`hub facility ${f.id}: 施設の前（立つ輪）に、当たり（${r.x}, ${r.z}）がかかる`);
    }
  }
  for (const f of h.facilities ?? []) {
    const w = `hub facility ${f.id}`;
    if (ids.has(f.id)) errors.push(`${w}: id が重複`);
    ids.add(f.id);
    if ([f.name, f.action, f.summary].some((t) => typeof t !== 'string' || t === '')) errors.push(`${w}: name / action / summary が無い`);
    if (!(isNum(f.x) && isNum(f.z) && f.r > 0)) errors.push(`${w}: 位置が不正`);
    else if (!free(f.x, f.z)) errors.push(`${w}: 施設の前に立てない（建物か外周に重なる）`);
    else if (Math.hypot(f.x - map.spawn.x, f.z - map.spawn.z) <= f.r) errors.push(`${w}: 出発地点が、施設の前に重なる`);
    if (!(f.building && isNum(f.building.x) && isNum(f.building.z) && isNum(f.building.yaw))) errors.push(`${w}: building が不正`);
    else if (!map.rocks.some((r) => Math.hypot(r.x - f.building.x, r.z - f.building.z) < 0.01)) errors.push(`${w}: 建物の当たり（map の rocks）が無い`);
    else {
      // 段のある里（v0.31.0）: 施設の前（立つ輪の中）は平ら、建物は同じ床、当たりの下の端は床
      const floor = groundAt(map.platforms, f.x, f.z);
      const ring = f.r * 0.5;
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        if (Math.abs(groundAt(map.platforms, f.x + Math.cos(a) * ring, f.z + Math.sin(a) * ring) - floor) > 0.01) {
          errors.push(`${w}: 施設の前（立つ輪）が平らでない（段か階段にかかる）`);
          break;
        }
      }
      if (Math.abs(groundAt(map.platforms, f.building.x, f.building.z) - floor) > 0.01) errors.push(`${w}: 建物と施設の前の床の高さが違う`);
      const rock = map.rocks.find((r) => Math.hypot(r.x - f.building.x, r.z - f.building.z) < 0.01)!;
      if (Math.abs((rock.y ?? 0) - floor) > 0.01) errors.push(`${w}: 建物の当たりの下の端（y）が床の高さと違う`);
    }
    for (const o of h.facilities) if (o !== f && o.id < f.id && Math.hypot(o.x - f.x, o.z - f.z) < o.r + f.r) errors.push(`${w}: 施設 ${o.id} の前と重なる`);
  }
  // 里に立つ人（v0.23.0）: id は重ならない。同じ位置に当たりの円がある。施設の前（立つ輪）と出発地点に重ならない
  const npcIds = new Set<string>();
  for (const n of h.npcs ?? []) {
    const w = `hub npc ${n.id}`;
    if (npcIds.has(n.id)) errors.push(`${w}: id が重複`);
    npcIds.add(n.id);
    if (typeof n.name !== 'string' || n.name === '' || typeof n.art !== 'string' || n.art === '') errors.push(`${w}: name / art が無い`);
    if (!(isNum(n.x) && isNum(n.z) && isNum(n.yaw))) {
      errors.push(`${w}: 位置が不正`);
      continue;
    }
    const own = n.facility !== undefined ? (h.facilities ?? []).find((f) => f.id === n.facility) : undefined;
    if (n.facility !== undefined && !own) errors.push(`${w}: 施設 ${n.facility} が無い`);
    const floor = groundAt(map.platforms, n.x, n.z);
    // 段のある里（v0.31.0）: 係の人は、その施設と同じ段に立つ
    if (own && Math.abs(groundAt(map.platforms, own.x, own.z) - floor) > 0.01) errors.push(`${w}: 施設 ${own.id} と違う段に立っている`);
    const body = map.rocks.find((r) => Math.hypot(r.x - n.x, r.z - n.z) < 0.01 && r.r <= 0.6);
    if (!body) errors.push(`${w}: 人の当たり（map の rocks、半径 0.6m まで）が無い`);
    else if (Math.abs((body.y ?? 0) - floor) > 0.01) errors.push(`${w}: 人の当たりの下の端（y）が床の高さと違う`);
    for (const f of h.facilities ?? []) if (Math.hypot(f.x - n.x, f.z - n.z) < f.r * 0.5 + 0.8) errors.push(`${w}: 施設 ${f.id} の前（立つ輪）に近すぎる`);
    if (Math.hypot(map.spawn.x - n.x, map.spawn.z - n.z) < 2) errors.push(`${w}: 出発地点に近すぎる`);
  }
  // 里の 5 つの段（v0.35.0）: 外周の出口・建物と飾り・小物
  const b = map.bounds;
  const sceneIds = new Set<string>([...ids]);
  for (const g of h.gates ?? []) {
    const w = `hub gate ${g.id}`;
    if (sceneIds.has(g.id)) errors.push(`${w}: id が重複`);
    sceneIds.add(g.id);
    if (typeof g.name !== 'string' || g.name === '') errors.push(`${w}: name が無い`);
    const onEdge = Math.min(Math.abs(g.x - b.minX), Math.abs(g.x - b.maxX), Math.abs(g.z - b.minZ), Math.abs(g.z - b.maxZ)) < 0.6;
    if (!(isNum(g.x) && isNum(g.z)) || !onEdge || g.x < b.minX - 0.6 || g.x > b.maxX + 0.6 || g.z < b.minZ - 0.6 || g.z > b.maxZ + 0.6) errors.push(`${w}: 外周の上に無い`);
  }
  /** (x, z) の床に下の端（y）を置いた当たりで、中心が near m 以内のもの */
  const bodyAt = (x: number, z: number, near: number): MapDef['rocks'][number] | undefined => {
    const floor = groundAt(map.platforms, x, z);
    return map.rocks.find((r) => Math.hypot(r.x - x, r.z - z) <= near && Math.abs((r.y ?? 0) - floor) < 0.01);
  };
  for (const s of h.scenery ?? []) {
    const w = `hub scenery ${s.id}`;
    if (sceneIds.has(s.id)) errors.push(`${w}: id が重複`);
    sceneIds.add(s.id);
    if (!HUB_SCENERY_KINDS.includes(s.kind)) errors.push(`${w}: kind ${String(s.kind)} が不明`);
    if (typeof s.name !== 'string' || s.name === '') errors.push(`${w}: name が無い`);
    if (!(isNum(s.x) && isNum(s.z) && isNum(s.yaw)) || s.x < b.minX || s.x > b.maxX || s.z < b.minZ || s.z > b.maxZ) {
      errors.push(`${w}: 位置が不正（里の外）`);
      continue;
    }
    // 畑は歩ける（当たりが無い）。物干しは柱の 2 本。ほかは、建物の近く（3m 以内）に、床に立つ当たりがある
    if (s.kind !== 'field' && !bodyAt(s.x, s.z, 3)) errors.push(`${w}: 当たり（map の rocks。下の端が床）が無い`);
    if (Math.hypot(map.spawn.x - s.x, map.spawn.z - s.z) < 2.5) errors.push(`${w}: 出発地点に近すぎる`);
  }
  for (const p of h.props ?? []) {
    const w = `hub prop ${p.id}`;
    if (sceneIds.has(p.id)) errors.push(`${w}: id が重複`);
    sceneIds.add(p.id);
    if (!(HUB_PROP_ARTS as readonly string[]).includes(p.art)) errors.push(`${w}: art ${p.art} が不明`);
    if (!(isNum(p.x) && isNum(p.z))) {
      errors.push(`${w}: 位置が不正`);
      continue;
    }
    const body = bodyAt(p.x, p.z, 0.01);
    if (!body || body.r > 1.3) errors.push(`${w}: 当たり（map の rocks、半径 1.3m まで。下の端が床）が無い`);
  }
}

/** エリアどうしを、これだけ離す（別のエリアの相手に、気づいたり攻撃が届いたりしないための距離）。 */
export const FIELD_AREA_GAP = 120;

/**
 * フィールド: エリアは重ならず離れている / 出口は往復で対になり、着く場所は行き先の中で、どの出口にも触れない /
 * どのエリアへも野営地から歩いて行ける / 大型の巡り方は、大型が通れる出口だけでつながっている / 「これまでの狩場」と同じ形のエリアがある。
 */
export function validateField(c: Content, f: FieldDef, errors: string[]): void {
  const w = `field ${f.id}`;
  if (typeof f.name !== 'string' || f.name === '') errors.push(`${w}: name が無い`);
  const areas = new Map<string, FieldDef['areas'][number]>();
  for (const a of f.areas ?? []) {
    if (areas.has(a.id)) errors.push(`${w}: area ${a.id} が重複`);
    areas.set(a.id, a);
  }
  if (areas.size === 0) {
    errors.push(`${w}: エリアが無い`);
    return;
  }
  const climbIds = new Set<string>();
  const vaultIds = new Set<string>();
  // 自然な形のエリア（v0.20.0）は、外周の多角形で、内か外かを見る
  const shapes = new Map<string, AreaShape>();
  for (const a of areas.values()) {
    if (!a.shape) continue;
    if (!(Array.isArray(a.shape) && a.shape.length >= 12 && a.shape.every((p) => Array.isArray(p) && p.length === 2 && isNum(p[0]) && isNum(p[1])))) {
      errors.push(`${w} area ${a.id}: shape が不正（[x, z] の点を 12 個以上）`);
      continue;
    }
    shapes.set(a.id, new AreaShape(a.shape));
  }
  const inside = (a: FieldDef['areas'][number], x: number, z: number, margin: number): boolean => {
    const s = shapes.get(a.id);
    if (s) return s.signedDistance(x, z) >= margin;
    return x >= a.bounds.minX + margin && x <= a.bounds.maxX - margin && z >= a.bounds.minZ + margin && z <= a.bounds.maxZ - margin;
  };
  const list = [...areas.values()];
  const nos = new Set<number>();
  for (const a of list) {
    const wa = `${w} area ${a.id}`;
    const b = a.bounds;
    if (!b || !(b.maxX > b.minX) || !(b.maxZ > b.minZ)) {
      errors.push(`${wa}: bounds が不正`);
      continue;
    }
    if (typeof a.name !== 'string' || a.name === '') errors.push(`${wa}: name が無い`);
    if (!isInt(a.no) || a.no < 0 || nos.has(a.no)) errors.push(`${wa}: no が不正か重複`);
    nos.add(a.no);
    if (!['camp', 'hunt', 'path', 'nest'].includes(a.kind)) errors.push(`${wa}: kind "${String(a.kind)}" は未定義`);
    if (!isNum(a.stepUp)) errors.push(`${wa}: stepUp が無い`);
    for (const p of a.platforms ?? []) {
      if (!(p.maxX > p.minX) || !(p.maxZ > p.minZ) || !isNum(p.h)) errors.push(`${wa}: platform が不正`);
      else if (shapes.has(a.id) && ![[p.minX, p.minZ], [p.maxX, p.minZ], [p.minX, p.maxZ], [p.maxX, p.maxZ]].every(([x, z]) => inside(a, x!, z!, 0.5))) errors.push(`${wa}: platform が外周からはみ出す`);
    }
    // 岩は、まるごと外周の中（自然な形のエリア）。四角のエリアは、中心が中
    for (const r of a.rocks ?? []) if (!(isNum(r.x) && isNum(r.z) && r.r > 0 && inside(a, r.x, r.z, shapes.has(a.id) ? r.r : 0))) errors.push(`${wa}: rock が不正（エリアの外）`);
    for (const r of a.rocks ?? []) if (r.art !== undefined && !(typeof r.art === 'string' && /^R-\d{2}$/.test(r.art))) errors.push(`${wa}: rock の art "${String(r.art)}" が不正（R-01 の形）`);
    // 地面の起伏（v0.46.0。#19 の F02）: 格子が外周を覆い、坂は 30° まで、出口・着く所・中心・登り口は平ら、段は起伏に埋まらない
    const rl = a.relief;
    if (rl) {
      const okGrid = isNum(rl.x0) && isNum(rl.z0) && rl.step > 0 && isInt(rl.nx) && isInt(rl.nz) && rl.nx >= 2 && rl.nz >= 2 && Array.isArray(rl.h) && rl.h.length === rl.nx * rl.nz && rl.h.every((v) => isInt(v) && v >= -1000 && v <= 1000);
      if (!okGrid) errors.push(`${wa}: relief が不正（nx × nz の cm の整数）`);
      else {
        if (rl.x0 > b.minX || rl.z0 > b.minZ || rl.x0 + (rl.nx - 1) * rl.step < b.maxX || rl.z0 + (rl.nz - 1) * rl.step < b.maxZ) errors.push(`${wa}: relief が外周を覆っていない`);
        let steep = 0;
        const lim = Math.tan((30 * Math.PI) / 180) * rl.step * 100 + 1;
        for (let j = 0; j < rl.nz; j++) {
          for (let i = 0; i < rl.nx; i++) {
            const x = rl.x0 + i * rl.step, z = rl.z0 + j * rl.step;
            if (!inside(a, x, z, 0)) continue;
            const v = rl.h[j * rl.nx + i]!;
            if (i + 1 < rl.nx && inside(a, x + rl.step, z, 0) && Math.abs(rl.h[j * rl.nx + i + 1]! - v) > lim) steep++;
            if (j + 1 < rl.nz && inside(a, x, z + rl.step, 0) && Math.abs(rl.h[(j + 1) * rl.nx + i]! - v) > lim) steep++;
          }
        }
        if (steep > 0) errors.push(`${wa}: relief の坂が 30° を超える所が ${steep} か所`);
        const flat = (x: number, z: number, what: string): void => {
          if (Math.abs(reliefAt(rl, x, z)) > 0.05) errors.push(`${wa}: ${what} が平らでない（起伏 ${reliefAt(rl, x, z).toFixed(2)}m）`);
        };
        for (const e of a.exits ?? []) flat(e.x, e.z, `出口 ${e.to}`);
        if (a.center) flat(a.center.x, a.center.z, '中心');
        for (const c of a.climbs ?? []) flat(c.x, c.z, `登り口 ${c.id}`);
        for (const v of a.vaults ?? []) flat(v.x, v.z, `乗り越える帯 ${v.id}`);
        for (const other of areas.values()) {
          for (const e of other.exits ?? []) {
            if (e.to !== a.id) continue;
            flat(e.arrive.x, e.arrive.z, `${other.id} から着く所`);
            if (e.arriveLarge) flat(e.arriveLarge.x, e.arriveLarge.z, `${other.id} から大型が着く所`);
          }
        }
        for (const q of a.platforms ?? []) {
          const under = Math.max(...[[q.minX, q.minZ], [q.maxX, q.minZ], [q.minX, q.maxZ], [q.maxX, q.maxZ]].map(([x, z]) => reliefAt(rl, x!, z!)));
          if (q.h < under + 0.2) errors.push(`${wa}: 段（高さ ${q.h}）が起伏（${under.toFixed(2)}m）に埋まる`);
        }
      }
    }
    // 登攀（v0.44.0。#19 の H07）: 登り口は歩ける地面、壁の面の先は上の段（top）、手前は登れない高さ、登り切って立つ所は上の段の上
    for (const c of a.climbs ?? []) {
      const wc = `${wa} climb ${String(c.id)}`;
      if (typeof c.id !== 'string' || c.id === '' || climbIds.has(c.id)) errors.push(`${wc}: id が無いか重複`);
      climbIds.add(c.id);
      if (![c.x, c.z, c.yaw, c.width, c.faceDist, c.top].every(isNum) || !(c.exit && isNum(c.exit.x) && isNum(c.exit.z))) {
        errors.push(`${wc}: 値が不正`);
        continue;
      }
      if (!(c.width >= 1.2 && c.width <= 6) || !(c.faceDist >= 0.6 && c.faceDist <= 2.5)) errors.push(`${wc}: width（1.2〜6m）か faceDist（0.6〜2.5m）が範囲の外`);
      const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
      const base = groundAt(a.platforms ?? [], c.x, c.z, a.relief);
      const faceX = c.x + fx * c.faceDist, faceZ = c.z + fz * c.faceDist;
      if (!inside(a, c.x, c.z, 1.5)) errors.push(`${wc}: 登り口が外周に近すぎる（1.5m より内側に）`);
      if (!(c.top - base >= 1.5 && c.top - base <= 8)) errors.push(`${wc}: 登る高さ ${c.top - base}m が 1.5〜8m の外`);
      if (Math.abs(groundAt(a.platforms ?? [], faceX + fx * 0.2, faceZ + fz * 0.2) - c.top) > 1e-6) errors.push(`${wc}: 壁の面の先が、高さ top の段ではない`);
      if (groundAt(a.platforms ?? [], faceX - fx * 0.2, faceZ - fz * 0.2, a.relief) > c.top - a.stepUp - 1e-6) errors.push(`${wc}: 壁の面の手前が、歩いて上がれる高さ（壁になっていない）`);
      if (Math.abs(groundAt(a.platforms ?? [], c.exit.x, c.exit.z) - c.top) > 1e-6 || !inside(a, c.exit.x, c.exit.z, 0.5)) errors.push(`${wc}: 登り切って立つ所が、上の段の上ではない`);
      const back = (c.exit.x - faceX) * fx + (c.exit.z - faceZ) * fz;
      if (!(back >= 0.8 && back <= 3)) errors.push(`${wc}: 登り切って立つ所が、壁の面から 0.8〜3m 内側ではない`);
      for (const r of a.rocks ?? []) if (Math.hypot(r.x - c.x, r.z - c.z) < r.r + 1) errors.push(`${wc}: 登り口が岩にかかる`);
    }
    // 低い岩棚の乗り越え（v0.49.0。#19 の H07 の低棚）: 帯は歩ける地面、縁の面の先は高さ top の段、段は 0.8〜1.2m 高く（歩いては上がれない）、
    // 帯の両端まで同じ段に向き合い、乗り越えて立つ所は段の上で、岩にかからない
    for (const v of a.vaults ?? []) {
      const wv = `${wa} vault ${String(v.id)}`;
      if (typeof v.id !== 'string' || v.id === '' || vaultIds.has(v.id) || climbIds.has(v.id)) errors.push(`${wv}: id が無いか重複`);
      vaultIds.add(v.id);
      if (![v.x, v.z, v.yaw, v.width, v.faceDist, v.top].every(isNum)) {
        errors.push(`${wv}: 値が不正`);
        continue;
      }
      if (!(v.width >= 1.5 && v.width <= 24) || !(v.faceDist >= 0.6 && v.faceDist <= 1.5)) errors.push(`${wv}: width（1.5〜24m）か faceDist（0.6〜1.5m）が範囲の外`);
      const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
      const base = groundAt(a.platforms ?? [], v.x, v.z, a.relief);
      if (!(v.top - base >= 0.8 && v.top - base <= 1.2)) errors.push(`${wv}: 乗り越える高さ ${(v.top - base).toFixed(2)}m が 0.8〜1.2m の外`);
      if (v.top - base <= a.stepUp) errors.push(`${wv}: 歩いて上がれる高さ（乗り越えにしない）`);
      for (const k of [-0.5, 0, 0.5]) {
        // 帯の端と真ん中: 縁の前から縁まで（帯）、縁の先、立つ所
        const sx = v.x + fz * v.width * k, sz = v.z - fx * v.width * k;
        const at = (d: number): [number, number] => [sx + fx * d, sz + fz * d];
        const [ax, az] = at(v.faceDist - VAULT_REACH), [ix, iz] = at(v.faceDist + 0.2), [ox, oz] = at(v.faceDist - 0.2), [tx, tz] = at(v.faceDist + VAULT_IN);
        if (!inside(a, ax, az, 0.5) || !inside(a, ox, oz, 0.5)) errors.push(`${wv}: 帯（${k}）が外周に近すぎる`);
        if (Math.abs(groundAt(a.platforms ?? [], ix, iz) - v.top) > 1e-6) errors.push(`${wv}: 縁の面の先（${k}）が、高さ top の段ではない`);
        if (Math.abs(groundAt(a.platforms ?? [], ox, oz, a.relief) - base) > 0.05) errors.push(`${wv}: 縁の前（${k}）が、帯の地面と同じ高さではない`);
        if (Math.abs(groundAt(a.platforms ?? [], tx, tz) - v.top) > 1e-6 || !inside(a, tx, tz, 0.5)) errors.push(`${wv}: 乗り越えて立つ所（${k}）が、段の上ではない`);
        for (const r of a.rocks ?? []) for (const [px, pz] of [[ax, az], [ox, oz], [tx, tz]] as const) if (Math.hypot(r.x - px, r.z - pz) < r.r + 0.5) errors.push(`${wv}: 帯（${k}）が岩にかかる`);
      }
    }
    const sh = shapes.get(a.id);
    if (sh) {
      // 外周を囲む四角 = bounds
      if (Math.abs(sh.minX - b.minX) > 0.05 || Math.abs(sh.maxX - b.maxX) > 0.05 || Math.abs(sh.minZ - b.minZ) > 0.05 || Math.abs(sh.maxZ - b.maxZ) > 0.05) errors.push(`${wa}: bounds が、shape を囲む四角と違う`);
      if (!(a.center && isNum(a.center.x) && isNum(a.center.z) && inside(a, a.center.x, a.center.z, 3))) errors.push(`${wa}: center が無いか、外周に近すぎる（3m より内側に）`);
      if (!(Array.isArray(a.nav) && a.nav.length > 0 && a.nav.every((p) => Array.isArray(p) && p.length === 2 && inside(a, p[0]!, p[1]!, 1.5)))) errors.push(`${wa}: nav（道しるべ）が無いか、外周に近すぎる`);
      else {
        // どの道しるべの間も、いちばん大きな大型（体の半径 1.5m）が通れる道でつながる
        const g = new NavGraph(sh, a.nav, 1.8);
        for (let i = 1; i < a.nav.length; i++) if (!g.connected(0, i)) errors.push(`${wa}: nav ${i} が、道しるべ 0 とつながらない`);
      }
      if (a.size !== undefined && !['narrow', 'medium', 'wide'].includes(a.size)) errors.push(`${wa}: size "${String(a.size)}" は未定義`);
    }
    for (const o of list) {
      if (o === a || o.id < a.id || !o.bounds) continue;
      const dx = Math.max(o.bounds.minX - b.maxX, b.minX - o.bounds.maxX, 0), dz = Math.max(o.bounds.minZ - b.maxZ, b.minZ - o.bounds.maxZ, 0);
      if (Math.hypot(dx, dz) < FIELD_AREA_GAP) errors.push(`${wa}: area ${o.id} と近すぎる（${FIELD_AREA_GAP}m 以上離す）`);
    }
    const tos = new Set<string>();
    for (const e of a.exits ?? []) {
      const we = `${wa} exit→${e.to}`;
      const to = areas.get(e.to);
      if (!to || e.to === a.id) {
        errors.push(`${we}: 行き先が無い`);
        continue;
      }
      if (tos.has(e.to)) errors.push(`${we}: 同じ行き先の出口が 2 つある`);
      tos.add(e.to);
      if (!(e.r > 0) || !inside(a, e.x, e.z, 0)) errors.push(`${we}: 出口がエリアの外`);
      else if ((a.rocks ?? []).some((r) => Math.hypot(r.x - e.x, r.z - e.z) <= r.r + e.r + 1)) errors.push(`${we}: 出口が岩でふさがっている`);
      const back = to.exits?.find((x) => x.to === a.id);
      if (!back) errors.push(`${we}: 戻る出口が無い`);
      else if (!!back.large !== !!e.large) errors.push(`${we}: 戻る出口と large が違う`);
      if (e.large && !(a.large && to.large)) errors.push(`${we}: 大型が入れないエリアにつながっている`);
      if (e.large && !e.arriveLarge) errors.push(`${we}: arriveLarge が無い`);
      for (const [label, p] of [['arrive', e.arrive], ['arriveLarge', e.arriveLarge]] as const) {
        if (!p) continue;
        if (!(isNum(p.x) && isNum(p.z) && isNum(p.yaw)) || !inside(to, p.x, p.z, 1)) errors.push(`${we}: ${label} が行き先の外`);
        // 着いた場所が出口に触れていると、行ったり来たりを繰り返す
        else if ((to.exits ?? []).some((x) => Math.hypot(x.x - p.x, x.z - p.z) <= x.r + 1.5)) errors.push(`${we}: ${label} が行き先の出口に近すぎる`);
        else if ((to.rocks ?? []).some((r) => Math.hypot(r.x - p.x, r.z - p.z) <= r.r + (label === 'arrive' ? 1 : 3))) errors.push(`${we}: ${label} が岩と重なる`);
      }
    }
  }
  // 歩いて行けること
  const reach = (from: string, largeOnly: boolean): Set<string> => {
    const seen = new Set([from]);
    const queue = [from];
    while (queue.length > 0) {
      for (const e of areas.get(queue.shift()!)?.exits ?? []) {
        if ((largeOnly && !e.large) || seen.has(e.to) || !areas.has(e.to)) continue;
        seen.add(e.to);
        queue.push(e.to);
      }
    }
    return seen;
  };
  const startArea = areas.get(f.start?.areaId);
  if (!startArea || !inside(startArea, f.start.x, f.start.z, 1)) errors.push(`${w}: start が不正`);
  else {
    const seen = reach(startArea.id, false);
    for (const a of list) if (!seen.has(a.id)) errors.push(`${w}: area ${a.id} へ、出発するエリアから行けない`);
    if (startArea.kind !== 'camp' || startArea.large) errors.push(`${w}: 出発するエリアは、大型が入れない野営地にする`);
    if (!(f.camp && isNum(f.camp.x) && isNum(f.camp.z) && inside(startArea, f.camp.x, f.camp.z, 0))) errors.push(`${w}: camp が野営地の外`);
  }
  // これまでの狩場にあたるエリア: 岩はこれまでと同じ位置。依頼の出発地点とモンスターの出る所が、中にある
  // （v0.20.0 から、外周は自然な形。段差は、ほかのエリアと同じように作る）
  const legacy = c.maps.get(f.legacyMapId);
  const la = areas.get(f.legacyAreaId);
  if (!legacy || !la) errors.push(`${w}: legacyMapId / legacyAreaId が不正`);
  else {
    if (JSON.stringify(la.rocks) !== JSON.stringify(legacy.rocks) || la.stepUp !== legacy.stepUp) errors.push(`${w}: area ${la.id} の岩が、${legacy.id} と違う`);
    for (const [label, p] of [['spawn', legacy.spawn], ['monsterSpawn', legacy.monsterSpawn]] as const) {
      if (!inside(la, p.x, p.z, 3)) errors.push(`${w}: area ${la.id} の中に、${legacy.id} の ${label} が無い`);
    }
  }
  if (!(isNum(f.timeLimitScale) && f.timeLimitScale >= 1 && f.timeLimitScale <= 10)) errors.push(`${w}: timeLimitScale が不正`);
  // 巡り方
  const R = f.roam;
  if (!(R && Array.isArray(R.stayTicks) && isInt(R.stayTicks[0]) && isInt(R.stayTicks[1]) && R.stayTicks[0] > 0 && R.stayTicks[1] >= R.stayTicks[0])) errors.push(`${w}: roam.stayTicks が不正`);
  else {
    if (!(R.limpSpeedScale > 0 && R.wanderSpeedScale > 0)) errors.push(`${w}: roam の速さが不正`);
    // 出ていく大型に、狩人が追いつけない（追いつくと、攻撃してこない相手を一方的に斬れてしまう）
    const run = c.player.sprintSpeed;
    if (!(isNum(R.leaveSpeed) && R.leaveSpeed > run * 1.15)) errors.push(`${w}: roam.leaveSpeed（${R.leaveSpeed}）は、狩人の走る速さ ${run} の 1.15 倍より速くする`);
    if (!(isNum(R.limpLeaveSpeed) && R.limpLeaveSpeed > run * 1.05 && R.limpLeaveSpeed <= R.leaveSpeed)) errors.push(`${w}: roam.limpLeaveSpeed（${R.limpLeaveSpeed}）は、狩人の走る速さ ${run} の 1.05 倍より速く、leaveSpeed 以下にする`);
    if (!(isNum(R.leaveTurnScale) && R.leaveTurnScale >= 1 && R.leaveTurnScale <= 5)) errors.push(`${w}: roam.leaveTurnScale は 1〜5`);
    if (!(R.limpHpRatio > 0 && R.limpHpRatio < 1 && R.sleepHealCap > R.limpHpRatio && R.sleepHealCap <= 1 && R.sleepHealPerSec >= 0)) errors.push(`${w}: roam の体力の割合が不正（眠って戻る上限は、弱る割合より上にする）`);
    if (!(isInt(R.sleepTicks) && R.sleepTicks > 0 && isInt(R.wakeStayTicks) && R.wakeStayTicks > 0)) errors.push(`${w}: roam の時間が不正`);
    if (!(Array.isArray(R.wanderIdleTicks) && isInt(R.wanderIdleTicks[0]) && isInt(R.wanderIdleTicks[1]) && R.wanderIdleTicks[0] > 0 && R.wanderIdleTicks[1] >= R.wanderIdleTicks[0] && R.wanderInset >= 0)) errors.push(`${w}: roam のぶらつきが不正`);
    if (!(isInt(R.loseSightTicks) && R.loseSightTicks > 0)) errors.push(`${w}: roam.loseSightTicks が不正`);
  }
  for (const [mid, route] of Object.entries(f.routes ?? {})) {
    const wr = `${w} route ${mid}`;
    if (!c.monsters.has(mid)) errors.push(`${wr}: monster が無い`);
    const ids = [route.start, route.nest, ...(route.roam ?? [])];
    if (!(Array.isArray(route.roam) && route.roam.length >= 2 && route.roam.includes(route.start))) errors.push(`${wr}: roam は 2 つ以上で、start を含める`);
    if (ids.some((id) => !areas.get(id)?.large)) {
      errors.push(`${wr}: 大型が入れないエリアがある`);
      continue;
    }
    const seen = reach(route.start, true);
    for (const id of ids) if (!seen.has(id)) errors.push(`${wr}: area ${id} へ、大型が通れる出口だけでは行けない`);
    if (areas.get(route.nest)?.kind !== 'nest') errors.push(`${wr}: nest が巣（kind: nest）でない`);
  }
  // 群れの住みか（v0.18.0）: 群れで暮らす種で、野営地ではなく、住みかどうしは歩いて行ける
  for (const [i, hd] of (f.herds ?? []).entries()) {
    const wh = `${w} herds[${i}] ${hd.monsterId}`;
    const m = c.monsters.get(hd.monsterId);
    if (!m) errors.push(`${wh}: monster が無い`);
    else if (!m.herd) errors.push(`${wh}: 群れで暮らさない種`);
    if (!Array.isArray(hd.areas) || hd.areas.length === 0) {
      errors.push(`${wh}: areas が空`);
      continue;
    }
    if (typeof hd.native !== 'boolean') errors.push(`${wh}: native が無い`);
    for (const id of hd.areas) {
      const a = areas.get(id);
      if (!a) errors.push(`${wh}: area ${id} が無い`);
      else if (a.kind === 'camp') errors.push(`${wh}: 野営地には住まない`);
    }
    const seen = reach(hd.areas[0]!, false);
    for (const id of hd.areas) if (areas.has(id) && !seen.has(id)) errors.push(`${wh}: area ${id} へ歩いて行けない`);
  }
}

function putUnique<T>(map: Map<string, T>, id: string, value: T, kind: string, errors: string[]): void {
  if (map.has(id)) errors.push(`${kind} id "${id}" が重複`);
  map.set(id, value);
}

/** content.json を起点に全データを読み、検証して返す。問題があれば ContentError を投げる。 */
export async function assembleContent(get: JsonGetter): Promise<Content> {
  const errors: string[] = [];
  const index = (await get('content.json')) as ContentIndex;
  checkVersion('content.json', index.schemaVersion, errors);
  const content: Content = {
    contentVersion: index.contentVersion,
    elements: (await get(index.files.elements)) as ElementRules,
    skills: new Map(),
    actions: new Map(),
    curves: new Map(),
    tracks: new Map(),
    families: new Map(),
    weapons: new Map(),
    monsters: new Map(),
    maps: new Map(),
    fields: new Map(),
    shop: { schemaVersion: 0, holdMax: 0, goods: [], sell: [] },
    hub: { schemaVersion: 0, id: '', name: '', mapId: '', facilities: [] },
    bestiary: { schemaVersion: 0, plan: {}, frames: [], fields: [], species: [] },
    story: { schemaVersion: 0, id: '', title: '', note: '', speakers: {}, chapters: [], scenes: [], common: { unplayable: '' } },
    board: { schemaVersion: 0, recommend: { text: '', questIds: [] }, quests: [] },
    support: { schemaVersion: 0, packs: [] },
    deliveries: new Map(),
    appearance: { schemaVersion: 0, profiles: { legacy: '', custom: '' }, base: { skin: '#000000', hair: '#000000' }, skinColors: [], skinTone: { min: 0, max: 0 }, hairColors: [], bodyAxes: [], bodyPresets: [], hairStyles: [], faces: [], brows: [], eyeColors: [], presets: [] },
    quests: new Map(),
    items: new Map(),
    materials: new Map(),
    loot: new Map(),
    recipes: new Map(),
    ranks: new Map(),
    armor: new Map(),
    armorRules: { base: 1, slotNames: { head: '', chest: '', arms: '', waist: '', legs: '' } },
    edge: { max: 0, stages: [], bounce: { wearScale: 1, recoilTicks: 1, pushback: 0 } },
    player: (await get(index.files.player)) as PlayerTuning,
  };
  checkVersion(index.files.player, content.player.schemaVersion, errors);
  validateElementRules(content.elements, errors);
  const skills = (await get(index.files.skills)) as { schemaVersion: number; skills: SkillDef[] };
  checkVersion(index.files.skills, skills.schemaVersion, errors);
  for (const sk of skills.skills ?? []) putUnique(content.skills, sk.id, sk, 'skill', errors);

  for (const f of index.files.actions) {
    const doc = (await get(f)) as { actions: ActionDef[] };
    for (const a of doc.actions ?? []) {
      validateAction(a, errors);
      putUnique(content.actions, a.actionId, a, 'action', errors);
    }
  }
  for (const f of index.files.tracks) {
    const doc = (await get(f)) as { tracks: ShapeTrackDef[] };
    for (const t of doc.tracks ?? []) {
      validateTrack(t, errors);
      putUnique(content.tracks, t.id, t, 'track', errors);
    }
  }
  const many = (f: string | string[]): string[] => (Array.isArray(f) ? f : [f]);
  for (const f of many(index.files.curves)) {
    const curves = (await get(f)) as { curves: CurveDef[] };
    for (const c of curves.curves ?? []) {
      validateCurve(c, errors);
      putUnique(content.curves, c.id, c, 'curve', errors);
    }
  }
  const weapons = (await get(index.files.weapons)) as { families: WeaponFamilyDef[]; weapons: WeaponDef[]; edge: EdgeRules };
  content.edge = weapons.edge;
  validateEdge(weapons.edge, errors);
  for (const f of weapons.families ?? []) putUnique(content.families, f.id, f, 'family', errors);
  for (const w of weapons.weapons ?? []) putUnique(content.weapons, w.id, w, 'weapon', errors);
  for (const f of index.files.monsters) {
    const m = (await get(f)) as MonsterDef;
    validateMonster(m, errors);
    putUnique(content.monsters, m.id, m, 'monster', errors);
  }
  // 攻撃を受ける部位の追従（v0.25.0。npm run monsters:bake の出力）。読み込みの時に、種の定義へ付ける
  for (const f of index.files.follow ?? []) {
    const doc = (await get(f)) as FollowDef;
    checkVersion(f, doc.schemaVersion, errors);
    const m = content.monsters.get(doc.monsterId);
    if (!m) {
      errors.push(`${f}: monster ${doc.monsterId} が無い`);
      continue;
    }
    if (m.follow) errors.push(`${f}: ${doc.monsterId} の追従が 2 つある`);
    m.follow = buildFollowTable(m, doc, (id) => content.actions.get(id)?.durationTicks, errors);
  }
  for (const f of index.files.maps) {
    const m = (await get(f)) as MapDef;
    validateMap(m, errors);
    putUnique(content.maps, m.id, m, 'map', errors);
  }
  for (const f of index.files.fields ?? []) {
    const fd = (await get(f)) as FieldDef;
    checkVersion(f, fd.schemaVersion, errors);
    putUnique(content.fields, fd.id, fd, 'field', errors);
  }
  for (const f of many(index.files.quests)) {
    const quests = (await get(f)) as { quests: QuestDef[] };
    for (const q of quests.quests ?? []) putUnique(content.quests, q.id, q, 'quest', errors);
  }
  for (const f of many(index.files.items)) {
    const items = (await get(f)) as { schemaVersion: number; items: ItemDef[]; materials: MaterialDef[] };
    checkVersion(f, items.schemaVersion, errors);
    for (const it of items.items ?? []) putUnique(content.items, it.id, it, 'item', errors);
    for (const m of items.materials ?? []) {
      if (content.items.has(m.id)) errors.push(`material id "${m.id}" が道具と重複`);
      putUnique(content.materials, m.id, m, 'material', errors);
    }
  }
  for (const f of many(index.files.loot)) {
    const loot = (await get(f)) as { schemaVersion: number; tables: LootDef[] };
    checkVersion(f, loot.schemaVersion, errors);
    for (const l of loot.tables ?? []) putUnique(content.loot, l.id, l, 'loot', errors);
  }
  const recipes = (await get(index.files.recipes)) as { schemaVersion: number; recipes: RecipeDef[] };
  checkVersion(index.files.recipes, recipes.schemaVersion, errors);
  for (const r of recipes.recipes ?? []) putUnique(content.recipes, r.id, r, 'recipe', errors);
  const ranks = (await get(index.files.ranks)) as { schemaVersion: number; ranks: RankDef[] };
  checkVersion(index.files.ranks, ranks.schemaVersion, errors);
  for (const r of ranks.ranks ?? []) putUnique(content.ranks, r.id, r, 'rank', errors);
  const armor = (await get(index.files.armor)) as { schemaVersion: number; defense: { base: number }; slots: { id: ArmorSlot; name: string }[]; armor: ArmorDef[] };
  checkVersion(index.files.armor, armor.schemaVersion, errors);
  content.armorRules = { base: armor.defense?.base ?? 0, slotNames: Object.fromEntries((armor.slots ?? []).map((s) => [s.id, s.name])) as Record<ArmorSlot, string> };
  for (const a of armor.armor ?? []) putUnique(content.armor, a.id, a, 'armor', errors);
  // 系列の装備（v0.32.0。武器・防具・作るレシピ。npm run equipment:gen の出力）
  for (const f of index.files.equipment ?? []) {
    const eq = (await get(f)) as { schemaVersion: number; weapons?: WeaponDef[]; armor?: ArmorDef[]; recipes?: RecipeDef[]; armorTraits?: Record<string, Pick<ArmorDef, 'resist' | 'skill'>> };
    checkVersion(f, eq.schemaVersion, errors);
    for (const w of eq.weapons ?? []) putUnique(content.weapons, w.id, w, 'weapon', errors);
    for (const a of eq.armor ?? []) putUnique(content.armor, a.id, a, 'armor', errors);
    for (const r of eq.recipes ?? []) putUnique(content.recipes, r.id, r, 'recipe', errors);
    // これまでの防具（ガルドロスの岩殻〜輝殻）の耐性と技能（v0.33.0。設計の proposedAdditions。armor.json は変えない）
    for (const [id, t] of Object.entries(eq.armorTraits ?? {})) {
      const a = content.armor.get(id);
      if (!a) errors.push(`${f}: armorTraits の防具 ${id} が無い`);
      else content.armor.set(id, { ...a, ...t });
    }
  }
  validateGear(content, errors);
  content.shop = (await get(index.files.shop)) as ShopDef;
  checkVersion(index.files.shop, content.shop.schemaVersion, errors);
  content.hub = (await get(index.files.hub)) as HubDef;
  checkVersion(index.files.hub, content.hub.schemaVersion, errors);
  crossCheck(content, errors);
  for (const fd of content.fields.values()) validateField(content, fd, errors);
  validateShop(content, errors);
  validateHub(content, errors);
  content.bestiary = (await get(index.files.bestiary)) as BestiaryDef;
  checkVersion(index.files.bestiary, content.bestiary.schemaVersion, errors);
  // 登録簿: 段階の低い順と、遊べるモンスターの一覧を渡して検査する
  const rankIds = [...content.ranks.values()].sort((a, b) => a.order - b.order).map((r) => r.id);
  for (const e of validateBestiary(content.bestiary, { ranks: rankIds, playable: new Set(content.monsters.keys()), fieldIds: new Set(content.fields.keys()) })) errors.push(`bestiary: ${e}`);
  // 歩ける狩場は、どれも、登録簿の狩場の案とつながっている（名前も同じ）
  for (const fd of content.fields.values()) {
    const plan = (content.bestiary.fields ?? []).find((f) => f.fieldId === fd.id);
    if (!plan) errors.push(`field ${fd.id}: 登録簿（bestiary）の狩場の案に、fieldId が無い`);
    else if (plan.name !== fd.name) errors.push(`field ${fd.id}: 名前「${fd.name}」が、登録簿の狩場の案「${plan.name}」と違う`);
  }
  // 属性の印（v0.33.0）: 遊べるモンスターの技の属性・弱点・耐性は、登録簿と同じ（登録簿に無い訓練用の標的は除く）
  const sameSet = (a: readonly string[] | undefined, b: readonly string[]): boolean => [...(a ?? [])].sort().join() === [...b].sort().join();
  for (const m of content.monsters.values()) {
    const s = content.bestiary.species.find((x) => x.id === m.id);
    if (!s) continue;
    const own = s.elements.filter((e) => e !== 'none');
    if (own.length > 1 || (m.element ?? null) !== (own[0] ?? null) || !sameSet(m.weak, s.weak) || !sameSet(m.resist, s.resist)) {
      errors.push(`monster ${m.id}: 属性の印（element・weak・resist）が、登録簿と違う`);
    }
  }
  // 依頼の標的は、登録簿にあること（訓練用の標的は除く）
  for (const q of content.quests.values()) if (q.targetMonsterId && !content.bestiary.species.some((s) => s.id === q.targetMonsterId)) errors.push(`quest ${q.id}: 標的 ${q.targetMonsterId} が、登録簿（bestiary）に無い`);
  // 物語（v0.23.0）: 遊べる章の狩りは、いまある依頼だけ。場面は、どれもどこかの章から使う。狩場の名前は登録簿の狩場の案
  content.story = (await get(index.files.story)) as StoryDef;
  checkVersion(index.files.story, content.story.schemaVersion, errors);
  for (const e of validateStory(content.story, new Set(content.quests.keys()))) errors.push(`story: ${e}`);
  for (const ch of content.story.chapters ?? []) if (ch.field && !(content.bestiary.fields ?? []).some((f) => f.name === ch.field)) errors.push(`story: chapter ${ch.id}: 狩場 ${ch.field} が登録簿に無い`);
  // 依頼の掲示・工房からの支給・里の納品（v0.26.0、docs/spec.md の 25 章）。掲示は、読み込みの時に依頼へ付ける
  content.board = (await get(index.files.board)) as QuestBoardDef;
  checkVersion(index.files.board, content.board.schemaVersion, errors);
  errors.push(...validateBoard(content.board, content));
  for (const b of content.board.quests ?? []) {
    const q = content.quests.get(b.questId);
    if (q && !q.board) q.board = b;
  }
  content.support = (await get(index.files.support)) as SupportDef;
  checkVersion(index.files.support, content.support.schemaVersion, errors);
  errors.push(...validateSupport(content.support, content));
  const deliveries = (await get(index.files.deliveries)) as DeliveriesDef;
  checkVersion(index.files.deliveries, deliveries.schemaVersion, errors);
  errors.push(...validateDeliveries(deliveries, content, new Set((content.support.packs ?? []).map((p) => p.id))));
  for (const d of deliveries.deliveries ?? []) putUnique(content.deliveries, d.id, d, 'delivery', errors);
  // ハンターの外見の選べるもの（v0.28.0、docs/spec.md の 28 章）
  content.appearance = (await get(index.files.appearance)) as AppearanceCatalog;
  checkVersion(index.files.appearance, content.appearance.schemaVersion, errors);
  errors.push(...validateAppearanceCatalog(content.appearance));
  if (errors.length > 0) throw new ContentError(errors);
  return content;
}

/** 外見の選べるものの検査（v0.28.0）: ID は種類の中で重ならない・色は #RRGGBB・体型の見本は 8 軸を 0〜100 で持つ・A（legacy）で描くものは ready */
export function validateAppearanceCatalog(a: AppearanceCatalog): string[] {
  const e: string[] = [];
  const hex = /^#[0-9A-Fa-f]{6}$/;
  if (a.profiles?.legacy !== 'legacy_hunter_a_v1' || a.profiles?.custom !== 'custom_hunter_v1') e.push('appearance: profiles が不正');
  if (!hex.test(a.base?.skin ?? '') || !hex.test(a.base?.hair ?? '')) e.push('appearance: base の色が不正');
  const lists: [string, { id: string; hex?: string }[], boolean][] = [
    ['skinColors', a.skinColors, true], ['hairColors', a.hairColors, true], ['eyeColors', a.eyeColors, true],
    ['bodyPresets', a.bodyPresets, false], ['hairStyles', a.hairStyles, false], ['faces', a.faces, false], ['brows', a.brows, false], ['presets', a.presets, false], ['bodyAxes', a.bodyAxes, false],
  ];
  for (const [name, list, colored] of lists) {
    if (!Array.isArray(list) || list.length === 0) {
      e.push(`appearance: ${name} が空`);
      continue;
    }
    const ids = new Set<string>();
    for (const x of list) {
      if (!isStr(x.id) || ids.has(x.id)) e.push(`appearance: ${name} の id ${String(x.id)} が空か重複`);
      ids.add(x.id);
      if (colored && !hex.test(x.hex ?? '')) e.push(`appearance: ${name} ${x.id} の色が不正`);
    }
  }
  if (!(a.skinTone && a.skinTone.min < 0 && a.skinTone.max > 0)) e.push('appearance: skinTone が不正');
  for (const p of a.bodyPresets ?? []) for (const ax of a.bodyAxes ?? []) {
    const v = p.axes?.[ax.id];
    if (!(isNum(v) && v >= 0 && v <= 100)) e.push(`appearance: 体型の見本 ${p.id} の ${ax.id} が 0〜100 でない`);
  }
  // A（基準ハンター）で描くもの: 髪型 H01・顔 F01・眉 R01・目 E01・見本 P01 は、選べる
  for (const [name, list, id] of [['hairStyles', a.hairStyles, 'H01'], ['faces', a.faces, 'F01'], ['brows', a.brows, 'R01'], ['presets', a.presets, 'P01']] as const) {
    if (!(list ?? []).some((x) => x.id === id && x.ready)) e.push(`appearance: ${name} の ${id}（A）が選べない`);
  }
  return e;
}

