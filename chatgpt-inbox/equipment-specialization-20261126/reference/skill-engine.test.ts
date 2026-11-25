import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SkillEngine, canonicalEvent, combine, collectLoadout, commonEffects, damageTerms, edgeRules, staminaCost, type Definition, type SkillEvent, type ArmorRecord} from './skill-engine.ts';

const base: Definition = {id: 'test', name: 'test', trigger: {event: 'hit', tagsAll: [], tagsAny: [], hpMin: 0, hpMax: 100, staminaMin: 0, staminaMax: 100}, hitsRequired: 1, windowTicks: 120, cooldownTicks: 180, durationTicks: 60, consumeOnHit: true, sameTarget: false, resetOn: [], effects: [{stat: 'rawPct', values: [4, 8]}], explanation: 'test fixture'};
const def = (p: Partial<Definition> = {}) => ({...structuredClone(base), ...p});
let eventNo = 0;
const event = (tick: number, actionId = `action${tick}`, p: Partial<SkillEvent> = {}): SkillEvent => ({id: `event${++eventNo}`, actionId, tick, event: 'hit', targetId: 'targetA', tags: [], hp: 100, stamina: 100, ...p});
const engine = (d: Definition = def()) => new SkillEngine([{definition: d, level: 1}]);

test('A proc never buffs its origin action, including later hits in the same action', () => {
  const s = engine();
  assert.equal(s.handle(event(0, 'a')).effects.rawPct, undefined);
  assert.equal(s.handle(event(1, 'a')).effects.rawPct, undefined);
  assert.equal(s.handle(event(2, 'b')).effects.rawPct, 4);
  assert.equal(s.handle(event(3, 'b')).effects.rawPct, 4);
  assert.equal(s.handle(event(4, 'c')).effects.rawPct, undefined);
});
test('Release and draw cannot buff their own attack; the next different action consumes', () => {
  for (const trigger of ['charge_release', 'draw'] as const) {
    const d = def(); d.trigger.event = trigger; const s = engine(d);
    s.handle(event(0, 'origin', {event: trigger}));
    assert.equal(s.handle(event(2, 'origin')).effects.rawPct, undefined);
    assert.equal(s.handle(event(3, 'next')).effects.rawPct, 4);
  }
});
test('Delayed arrows keep the first landed hit snapshot across expiry, without affecting new actions', () => {
  const d = def(); d.trigger.event = 'guard'; const s = engine(d);
  s.handle(event(0, 'guard', {event: 'guard'}));
  assert.equal(s.handle(event(59, 'arrow')).effects.rawPct, 4);
  assert.equal(s.handle(event(70, 'arrow')).effects.rawPct, 4);
  assert.equal(s.handle(event(71, 'other')).effects.rawPct, undefined);
  s.releaseAction('arrow'); assert.ok(!s.stateJSON().includes('"actions":[["arrow"'));
});
test('Only one contribution per action; repeated event IDs are no-ops even after time has advanced', () => {
  const s = engine(def({hitsRequired: 2})); const first = event(0, 'a');
  s.handle(first); s.handle(event(1, 'a'));
  assert.equal(s.handle(event(2, 'b')).effects.rawPct, undefined);
  assert.equal(s.handle(event(3, 'c')).effects.rawPct, 4);
  const state = s.stateJSON(); assert.equal(s.handle(first).duplicate, true); assert.equal(s.stateJSON(), state);
  assert.throws(() => s.handle(event(1, 'freshOld')), /monotonic/);
});
test('Counter window and duration are half-open, cooldown begins at activation', () => {
  const s = engine(def({hitsRequired: 2, consumeOnHit: false}));
  s.handle(event(0, 'a')); s.handle(event(120, 'b'));
  assert.equal(s.handle(event(121, 'c')).effects.rawPct, undefined);
  assert.equal(s.handle(event(180, 'd')).effects.rawPct, 4);
  assert.equal(s.handle(event(181, 'e')).effects.rawPct, undefined);
  s.handle(event(300, 'f')); s.handle(event(301, 'g'));
  assert.equal(s.handle(event(302, 'h')).effects.rawPct, undefined);
  assert.equal(s.handle(event(303, 'i')).effects.rawPct, 4);
});
test('Target-bound bonuses neither leak nor consume on an ineligible target', () => {
  const d = def({sameTarget: true}); d.trigger.event = 'part_break'; const s = engine(d);
  s.handle(event(0, 'break', {event: 'part_break'}));
  assert.equal(s.handle(event(1, 'b', {targetId: 'targetB'})).effects.rawPct, undefined);
  assert.equal(s.handle(event(2, 'c')).effects.rawPct, 4);
  assert.equal(s.handle(event(3, 'c', {targetId: 'targetB'})).effects.rawPct, undefined);
  assert.equal(s.handle(event(4, 'd')).effects.rawPct, undefined);
});
test('Same-target counters restart on a different target instead of sharing marks', () => {
  const s = engine(def({sameTarget: true, hitsRequired: 2}));
  s.handle(event(0, 'a')); s.handle(event(1, 'b', {targetId: 'targetB'})); s.handle(event(2, 'c'));
  assert.equal(s.handle(event(3, 'd')).effects.rawPct, undefined);
  assert.equal(s.handle(event(4, 'e')).effects.rawPct, 4);
});
test('Damage, explicit sheath and target-change resets remove buffs without refunding cooldown', () => {
  for (const reset of ['damage_taken', 'sheathe', 'target_change'] as const) {
    const d = def({resetOn: [reset]}); d.trigger.event = 'guard'; const s = engine(d);
    s.handle(event(0, 'g', {event: 'guard'})); s.handle(event(1, 'reset', {event: reset}));
    s.handle(event(2, 'g2', {event: 'guard'})); assert.equal(s.handle(event(3, 'h')).effects.rawPct, undefined);
    s.handle(event(180, 'g3', {event: 'guard'})); assert.equal(s.handle(event(181, 'h2')).effects.rawPct, 4);
  }
});
test('HP/stamina ranges and all/any tags are inclusive and evaluated on resolved event', () => {
  const d = def(); Object.assign(d.trigger, {hpMin: 30, hpMax: 60, staminaMin: 25, staminaMax: 50, tagsAll: ['head'], tagsAny: ['blunt', 'finisher']}); const s = engine(d);
  for (const p of [{hp: 29}, {hp: 61}, {stamina: 24}, {stamina: 51}, {tags: ['head']}]) s.handle(event(++eventNo, `bad${eventNo}`, {hp: 30, stamina: 25, tags: ['head', 'blunt'], ...p}));
  assert.equal(s.handle(event(100, 'good', {hp: 60, stamina: 50, tags: ['head', 'finisher']})).effects.rawPct, undefined);
  assert.equal(s.handle(event(101, 'next')).effects.rawPct, 4);
});
test('Common and dynamic effects add before channel caps; weak-spot crit is checked for each hit', () => {
  assert.deepEqual(combine({rawPct: 10, edgeWearPct: -20}, {rawPct: 8, edgeWearPct: -13}), {rawPct: 12, edgeWearPct: -25});
  const d = def({effects: [{stat: 'affinityPoints', values: [12, 12]}]}); d.trigger.event = 'guard';
  const s = new SkillEngine([{definition: d, level: 1}], {}, 10);
  s.handle(event(0, 'g', {event: 'guard'}));
  assert.equal(s.handle(event(1, 'h', {hitzone: 0.55})).effects.affinityPoints, 15);
  assert.equal(s.handle(event(2, 'h', {hitzone: 0.54})).effects.affinityPoints, 12);
});
test('Non-attack effects expire immediately even if an old action snapshot remains', () => {
  const d = def({consumeOnHit: false, effects: [{stat: 'rawPct', values: [4, 4]}, {stat: 'incomingDamagePct', values: [8, 8]}]}); d.trigger.event = 'guard'; const s = engine(d);
  s.handle(event(0, 'g', {event: 'guard'})); s.handle(event(1, 'h'));
  assert.equal(s.current().incomingDamagePct, 8);
  s.advance(60); assert.equal(s.current().incomingDamagePct, undefined);
  assert.equal(s.handle(event(61, 'h')).effects.rawPct, 4);
});
test('2+2 mixed sets, rank mixing, 4-piece Lv2; duplicates/unknown/unowned do not create skills', () => {
  const slots = ['head', 'chest', 'arms', 'waist', 'legs'];
  const records = new Map<string, ArmorRecord>(slots.map((slot, i) => [`a${i}`, {id: `a${i}`, slot, defense: i + 1, seriesId: i < 2 ? 'series.a' : i < 4 ? 'series.b' : 'series.c', skill: {id: 'guard_economy'}}]));
  const owned = new Set(records.keys());
  const mix = collectLoadout(['a0','a1','a2','a3','a4','a0','unknown'], owned, records);
  assert.deepEqual(mix.signatures, {'series.a': 1, 'series.b': 1}); assert.equal(mix.levels.guard_economy, 3);
  records.get('a2')!.seriesId = 'series.a'; records.get('a3')!.seriesId = 'series.a';
  assert.deepEqual(collectLoadout([...owned], owned, records).signatures, {'series.a': 2});
  owned.delete('a3'); assert.deepEqual(collectLoadout([...records.keys()], owned, records).signatures, {'series.a': 1});
});
test('Common resist parameters stay separate and values never exceed Lv3', () => {
  const c = commonEffects({guard_economy: 10, 'element_resistance:fire': 2, 'element_resistance:ice': 1, 'status_resistance:para': 3, weak_crit: 1});
  assert.equal(c.effects.guardCostPct, -20); assert.deepEqual(c.elementalResistance, {fire: 6, ice: 3});
  assert.equal(c.statusThreshold.para, 1.5); assert.equal(c.weakCrit, 4);
});
test('HP, break/sever accumulation, status and head-only stun use separate terms', () => {
  const plain = damageTerms(100, 20, 10, 5, {}, 0, 0.99);
  const part = damageTerms(100, 20, 10, 5, {partPct: 25}, 0, 0.99);
  assert.equal(part.hp, plain.hp); assert.equal(part.part, plain.part * 1.25);
  const crit = damageTerms(100, 20, 10, 5, {elementPct: 20, statusPct: 20, stunPct: 15}, 30, 0, true);
  assert.equal(crit.hp, 149); assert.equal(crit.status, 12); assert.equal(crit.stun, 5.75);
  assert.equal(damageTerms(100, 20, 10, 5, {}, -20, 0).hp, 95);
  assert.equal(damageTerms(100, 0, 0, 5, {}, 0, 0.9).stun, 0);
});
test('Edge capacity scales max and thresholds; static stamina cost has an explicit combat scope', () => {
  assert.deepEqual(edgeRules(0.8, 1.2, {edgeWearPct: -25}), {max: 80, stages: [48,20,0], wearScale: 0.8999999999999999});
  assert.equal(staminaCost(25, 'dodge', 1.2, {dodgeCostPct: -20}), 24);
  assert.equal(staminaCost(25, 'sprint', 1.2, {dodgeCostPct: -20}), 25);
  assert.equal(staminaCost(0, 'charge', 1.2, {}), 0);
});
test('Adapter rejects dodge-input farming, invulnerable revival, chip, DoT, lethal damage and bow maintenance', () => {
  const d = event(0, 'roll', {event: 'dodge'});
  assert.equal(canonicalEvent(d), null); assert.equal(canonicalEvent(d, {hostileContact: true}), null);
  assert.ok(canonicalEvent(d, {hostileContact: true, evadedByDodgeFrames: true}));
  const hurt = event(1, 'hurt', {event: 'damage_taken'});
  assert.equal(canonicalEvent(hurt, {hostileContact: true, hpDamage: 5, survived: true}), null);
  assert.equal(canonicalEvent(hurt, {hostileContact: true, unguarded: true, hpDamage: 5, survived: false}), null);
  assert.ok(canonicalEvent(hurt, {hostileContact: true, unguarded: true, hpDamage: 5, survived: true}));
  const item = event(2, 'item', {event: 'item_used'});
  assert.equal(canonicalEvent(item, {maintenanceConsumed: 1, family: 'ring_bow'}), null);
  assert.ok(canonicalEvent(item, {maintenanceConsumed: 1, family: 'long_blade'}));
  assert.equal(canonicalEvent(item, {maintenanceConsumed: 1, family: 'unknown'}), null);
  const status = event(2, 'status', {event: 'status_inflicted', tags: ['head', 'poisoned', 'asleep']});
  assert.equal(canonicalEvent(status), null);
  assert.deepEqual(canonicalEvent(status, {inflictedStatus: 'para'})!.tags, ['head', 'paralyzed']);
  assert.equal(canonicalEvent(event(3, 's', {event: 'sheathe'})), null);
  assert.equal(canonicalEvent(event(4, 'c', {event: 'charge_release'}), {chargeLevel: 0}), null);
});
test('State is deterministic, action snapshots are reclaimed, and quest reset leaves only common effects', () => {
  const d = def(); d.trigger.event = 'guard'; const a = engine(d), b = engine(d);
  for (const e of [event(0,'g',{event:'guard'}),event(1,'h'),event(3,'h')]) {a.handle(e); b.handle(e);}
  assert.equal(a.stateJSON(), b.stateJSON()); a.releaseAction('h'); b.releaseAction('h'); assert.equal(a.stateJSON(), b.stateJSON());
  a.clear(); b.clear(); assert.equal(a.stateJSON(), engine(d).stateJSON());
});
