// 読み込んだ JSON を検証して Content へ組み立てる。
// ブラウザ（fetch）と Node のテスト（fs）の両方から同じ関数を使う。
// 問題は黙って直さず、すべて errors に積んで呼び出し側へ返す。

import {
  ARMOR_SLOTS,
  FINISH_STATES,
  SCHEMA_VERSION,
  recipeFrom,
  recipeResult,
  type ActionDef,
  type ArmorDef,
  type ArmorSlot,
  type Content,
  type ContentIndex,
  type CurveDef,
  type EdgeRules,
  type FieldDef,
  type HubDef,
  type ItemDef,
  type LootDef,
  type LootRoll,
  type MapDef,
  type MaterialDef,
  type MonsterDef,
  type PlayerTuning,
  type QuestDef,
  type RankDef,
  type RecipeDef,
  type ShapeTrackDef,
  type ShopDef,
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
    if (q.fieldId !== undefined) {
      const fd = c.fields.get(q.fieldId);
      if (!fd) errors.push(`quest ${q.id}: field ${q.fieldId} が無い`);
      else {
        if (fd.legacyMapId !== q.mapId) errors.push(`quest ${q.id}: field ${q.fieldId} の「これまでの狩場」が mapId と違う`);
        if (!fd.routes[q.targetMonsterId]) errors.push(`quest ${q.id}: field ${q.fieldId} に、標的 ${q.targetMonsterId} の巡り方が無い`);
      }
    }
    if (!c.monsters.has(q.targetMonsterId)) errors.push(`quest ${q.id}: monster ${q.targetMonsterId} が無い`);
    if (!c.ranks.has(q.rankId)) errors.push(`quest ${q.id}: 段階 ${String(q.rankId)} が無い`);
    for (const need of q.requires ?? []) {
      const other = c.quests.get(need);
      if (!other || need === q.id) errors.push(`quest ${q.id}: requires の依頼 ${need} が不正`);
      // 先に達成する依頼は、同じか下の段階（上の段階を条件にすると、どこからも入れなくなる）
      else if ((c.ranks.get(other.rankId)?.order ?? 0) > (c.ranks.get(q.rankId)?.order ?? 0)) errors.push(`quest ${q.id}: requires の依頼 ${need} の段階が上`);
    }
    if (!(q.timeLimitTicks > 0) || !(q.maxFaints > 0)) errors.push(`quest ${q.id}: 制限が不正`);
    if (q.monsterAttackScale !== undefined && !(q.monsterAttackScale > 0 && q.monsterAttackScale <= 3)) errors.push(`quest ${q.id}: monsterAttackScale が不正`);
    if (q.kind !== 'slay' && q.kind !== 'hunt') errors.push(`quest ${q.id}: kind "${String(q.kind)}" は未定義`);
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
    if (it.kind === 'heal') {
      if (!(isNum(it.heal) && it.heal > 0)) errors.push(`${w}: heal が不正`);
    } else if (it.kind === 'trap') {
      if (!(it.trap && it.trap.armTicks >= 0 && it.trap.radius > 0 && it.trap.holdTicks > 0 && it.trap.lifeTicks > 0)) errors.push(`${w}: trap が不正`);
    } else if (it.kind === 'tranq') {
      if (!(it.tranq && it.tranq.range > 0 && it.tranq.halfAngleDeg > 0)) errors.push(`${w}: tranq が不正`);
    } else if (it.kind === 'whet') {
      // 研いだ後は抜刀のままにする（手に持った武器を研ぐ）
      if (a && a.onFinish !== 'drawn_idle') errors.push(`${w}: 研ぐ行動の onFinish は drawn_idle にする`);
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
    } else errors.push(`${w}: kind "${String((r as { kind: unknown }).kind)}" は未定義`);
    const fromId = recipeFrom(r), resultId = recipeResult(r);
    if (fromId === resultId) errors.push(`${w}: 元と結果が同じ`);
    if (results.has(resultId)) errors.push(`${w}: 結果 ${resultId} を作るレシピが重複`);
    results.add(resultId);
    // 1 つの武器・防具から進める先は 1 つ（派生はまだ無い。工房の画面は「次の強化」を 1 つだけ出す）
    if (sources.has(fromId)) errors.push(`${w}: 元 ${fromId} から進めるレシピが重複`);
    sources.add(fromId);
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

/** その依頼の標的から出る素材の表（段階ごとの表があればそれ、無ければモンスターの lootId）。 */
export function lootForQuest(c: Content, q: QuestDef): LootDef | undefined {
  const m = c.monsters.get(q.targetMonsterId);
  const id = m?.lootByRank?.[q.rankId] ?? m?.lootId;
  return id ? c.loot.get(id) : undefined;
}

/** 1 つの依頼で手に入る素材（依頼の報酬と、標的の剥ぎ取り・捕獲・部位）。 */
export function questMaterials(c: Content, q: QuestDef): Set<string> {
  const out = new Set<string>();
  for (const s of q.rewards?.items ?? []) out.add(s.itemId);
  const m = c.monsters.get(q.targetMonsterId);
  const l = lootForQuest(c, q);
  if (!l) return out;
  const rolls: (LootRoll | undefined)[] = [l.carve, m?.captureAllowed && q.kind === 'hunt' ? l.capture : undefined, ...Object.values(l.severed ?? {}), ...Object.values(l.breaks ?? {})];
  for (const r of rolls) for (const e of r?.table ?? []) out.add(e.itemId);
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
  for (const kind of ['quest', 'workshop', 'shop', 'chest'] as const) {
    const n = (h.facilities ?? []).filter((f) => f.kind === kind).length;
    if (n !== 1) errors.push(`hub: 施設 ${kind} が ${n} 個（1 個にする）`);
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
    for (const o of h.facilities) if (o !== f && o.id < f.id && Math.hypot(o.x - f.x, o.z - f.z) < o.r + f.r) errors.push(`${w}: 施設 ${o.id} の前と重なる`);
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
  const inside = (a: FieldDef['areas'][number], x: number, z: number, margin: number): boolean => x >= a.bounds.minX + margin && x <= a.bounds.maxX - margin && z >= a.bounds.minZ + margin && z <= a.bounds.maxZ - margin;
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
    for (const p of a.platforms ?? []) if (!(p.maxX > p.minX) || !(p.maxZ > p.minZ) || !isNum(p.h)) errors.push(`${wa}: platform が不正`);
    for (const r of a.rocks ?? []) if (!(isNum(r.x) && isNum(r.z) && r.r > 0 && inside(a, r.x, r.z, 0))) errors.push(`${wa}: rock が不正（エリアの外）`);
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
  // これまでの狩場と同じ形のエリア
  const legacy = c.maps.get(f.legacyMapId);
  const la = areas.get(f.legacyAreaId);
  if (!legacy || !la) errors.push(`${w}: legacyMapId / legacyAreaId が不正`);
  else if (JSON.stringify(la.bounds) !== JSON.stringify(legacy.bounds) || JSON.stringify(la.rocks) !== JSON.stringify(legacy.rocks) || JSON.stringify(la.platforms) !== JSON.stringify(legacy.platforms) || la.stepUp !== legacy.stepUp) {
    errors.push(`${w}: area ${la.id} の形が、${legacy.id} と違う`);
  }
  if (!(isNum(f.timeLimitScale) && f.timeLimitScale >= 1 && f.timeLimitScale <= 10)) errors.push(`${w}: timeLimitScale が不正`);
  // 巡り方
  const R = f.roam;
  if (!(R && Array.isArray(R.stayTicks) && isInt(R.stayTicks[0]) && isInt(R.stayTicks[1]) && R.stayTicks[0] > 0 && R.stayTicks[1] >= R.stayTicks[0])) errors.push(`${w}: roam.stayTicks が不正`);
  else {
    if (!(R.walkSpeedScale > 0 && R.limpSpeedScale > 0 && R.wanderSpeedScale > 0)) errors.push(`${w}: roam の速さが不正`);
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
    fields: new Map(),
    shop: { schemaVersion: 0, holdMax: 0, goods: [], sell: [] },
    hub: { schemaVersion: 0, id: '', name: '', mapId: '', facilities: [] },
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
  const quests = (await get(index.files.quests)) as { quests: QuestDef[] };
  for (const q of quests.quests ?? []) putUnique(content.quests, q.id, q, 'quest', errors);
  const items = (await get(index.files.items)) as { schemaVersion: number; items: ItemDef[]; materials: MaterialDef[] };
  checkVersion(index.files.items, items.schemaVersion, errors);
  for (const it of items.items ?? []) putUnique(content.items, it.id, it, 'item', errors);
  for (const m of items.materials ?? []) {
    if (content.items.has(m.id)) errors.push(`material id "${m.id}" が道具と重複`);
    putUnique(content.materials, m.id, m, 'material', errors);
  }
  const loot = (await get(index.files.loot)) as { schemaVersion: number; tables: LootDef[] };
  checkVersion(index.files.loot, loot.schemaVersion, errors);
  for (const l of loot.tables ?? []) putUnique(content.loot, l.id, l, 'loot', errors);
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
  content.shop = (await get(index.files.shop)) as ShopDef;
  checkVersion(index.files.shop, content.shop.schemaVersion, errors);
  content.hub = (await get(index.files.hub)) as HubDef;
  checkVersion(index.files.hub, content.hub.schemaVersion, errors);
  crossCheck(content, errors);
  for (const fd of content.fields.values()) validateField(content, fd, errors);
  validateShop(content, errors);
  validateHub(content, errors);
  if (errors.length > 0) throw new ContentError(errors);
  return content;
}
