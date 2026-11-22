// 読み込んだ JSON を検証して Content へ組み立てる。
// ブラウザ（fetch）と Node のテスト（fs）の両方から同じ関数を使う。
// 問題は黙って直さず、すべて errors に積んで呼び出し側へ返す。

import {
  FINISH_STATES,
  SCHEMA_VERSION,
  type ActionDef,
  type Content,
  type ContentIndex,
  type CurveDef,
  type MapDef,
  type MonsterDef,
  type PlayerTuning,
  type QuestDef,
  type ShapeTrackDef,
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
}

function validateMap(m: MapDef, errors: string[]): void {
  const w = `map ${m.id}`;
  checkVersion(w, m.schemaVersion, errors);
  const b = m.bounds;
  if (!b || !(b.maxX > b.minX) || !(b.maxZ > b.minZ)) errors.push(`${w}: bounds が不正`);
  if (!isNum(m.stepUp)) errors.push(`${w}: stepUp が無い`);
  for (const p of m.platforms ?? []) {
    if (!(p.maxX > p.minX) || !(p.maxZ > p.minZ) || !isNum(p.h)) errors.push(`${w}: platform が不正`);
  }
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
    if (!c.monsters.has(q.targetMonsterId)) errors.push(`quest ${q.id}: monster ${q.targetMonsterId} が無い`);
    if (!(q.timeLimitTicks > 0) || !(q.maxFaints > 0)) errors.push(`quest ${q.id}: 制限が不正`);
    if (q.monsterAttackScale !== undefined && !(q.monsterAttackScale > 0 && q.monsterAttackScale <= 3)) errors.push(`quest ${q.id}: monsterAttackScale が不正`);
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
    actions: new Map(),
    curves: new Map(),
    tracks: new Map(),
    families: new Map(),
    weapons: new Map(),
    monsters: new Map(),
    maps: new Map(),
    quests: new Map(),
    player: (await get(index.files.player)) as PlayerTuning,
  };
  checkVersion(index.files.player, content.player.schemaVersion, errors);

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
  const curves = (await get(index.files.curves)) as { curves: CurveDef[] };
  for (const c of curves.curves ?? []) {
    validateCurve(c, errors);
    putUnique(content.curves, c.id, c, 'curve', errors);
  }
  const weapons = (await get(index.files.weapons)) as { families: WeaponFamilyDef[]; weapons: WeaponDef[] };
  for (const f of weapons.families ?? []) putUnique(content.families, f.id, f, 'family', errors);
  for (const w of weapons.weapons ?? []) putUnique(content.weapons, w.id, w, 'weapon', errors);
  for (const f of index.files.monsters) {
    const m = (await get(f)) as MonsterDef;
    validateMonster(m, errors);
    putUnique(content.monsters, m.id, m, 'monster', errors);
  }
  for (const f of index.files.maps) {
    const m = (await get(f)) as MapDef;
    validateMap(m, errors);
    putUnique(content.maps, m.id, m, 'map', errors);
  }
  const quests = (await get(index.files.quests)) as { quests: QuestDef[] };
  for (const q of quests.quests ?? []) putUnique(content.quests, q.id, q, 'quest', errors);
  crossCheck(content, errors);
  if (errors.length > 0) throw new ContentError(errors);
  return content;
}
