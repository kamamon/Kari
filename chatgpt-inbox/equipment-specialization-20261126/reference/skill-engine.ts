/** Equipment specialization reference, not a patch applied to the game. 60 Hz simulation ticks. */
export const CAPS = {
  rawPct: [-20, 12], elementPct: [-30, 20], statusPct: [-30, 20], partPct: [-30, 25],
  stunPct: [-30, 15], affinityPoints: [-15, 15], guardCostPct: [-30, 25],
  dodgeCostPct: [-25, 25], edgeWearPct: [-25, 40], staminaRecoveryPct: [-25, 20],
  incomingDamagePct: [-12, 25], itemUseTicksPct: [-20, 25],
} as const;
export type Stat = keyof typeof CAPS;
export type Effects = Partial<Record<Stat, number>>;
export type EventKind = 'hit' | 'guard' | 'parry' | 'dodge' | 'charge_release' | 'sheathe' |
  'draw' | 'part_break' | 'status_inflicted' | 'damage_taken' | 'item_used' | 'target_change';
export interface SkillEvent {
  id: string; actionId: string; tick: number; event: EventKind; targetId?: string;
  tags: string[]; hp: number; stamina: number; hitzone?: number;
}
export interface Definition {
  id: string; name: string;
  trigger: {event: EventKind; tagsAll: string[]; tagsAny: string[]; hpMin: number; hpMax: number; staminaMin: number; staminaMax: number};
  hitsRequired: number; windowTicks: number; cooldownTicks: number; durationTicks: number;
  consumeOnHit: boolean; sameTarget: boolean; resetOn: EventKind[];
  effects: {stat: Stat; values: [number, number]}[]; explanation: string;
}
export interface EquippedMechanic {definition: Definition; level: 1 | 2}
interface Proc {id: string; serial: number; originActionId: string; targetId?: string; start: number; end: number; consumeOnHit: boolean; effects: Effects}
interface State {nextReady: number; marks: {tick: number; actionId: string; targetId?: string}[]; contributed: Set<string>; proc?: Proc}
const ATTACK = new Set<Stat>(['rawPct', 'elementPct', 'statusPct', 'partPct', 'stunPct', 'affinityPoints', 'edgeWearPct']);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const copy = <T>(x: T): T => structuredClone(x);
export function combine(...sources: Effects[]): Effects {
  const result: Effects = {};
  for (const source of sources) for (const [key, value] of Object.entries(source)) {
    if (!(key in CAPS) || !Number.isFinite(value)) throw new Error(`Invalid effect ${key}`);
    const stat = key as Stat; result[stat] = (result[stat] ?? 0) + value;
  }
  for (const key of Object.keys(result) as Stat[]) result[key] = clamp(result[key]!, CAPS[key][0], CAPS[key][1]);
  return result;
}
function subset(source: Effects, attack: boolean): Effects {
  return Object.fromEntries(Object.entries(source).filter(([k]) => ATTACK.has(k as Stat) === attack));
}
/** Events must already represent resolved, successful game events (see canonicalEvent). */
export class SkillEngine {
  private tick = -1;
  private serial = 0;
  private states = new Map<string, State>();
  private seen = new Set<string>();
  private actions = new Map<string, Proc[]>();
  private mechanics: EquippedMechanic[];
  private common: Effects;
  private weakCrit: number;
  constructor(mechanics: EquippedMechanic[], common: Effects = {}, weakCrit = 0) {
    this.mechanics = copy(mechanics).sort((a, b) => a.definition.id.localeCompare(b.definition.id));
    this.common = copy(common); this.weakCrit = weakCrit;
    for (const {definition: d, level} of this.mechanics) {
      if (this.states.has(d.id) || ![1, 2].includes(level) || d.hitsRequired < 1 ||
        !Number.isInteger(d.hitsRequired) || d.windowTicks <= 0 || d.durationTicks <= 0 ||
        d.cooldownTicks < d.durationTicks || d.effects.length > 2 ||
        d.effects.some(x => !(x.stat in CAPS) || x.values.length !== 2 || x.values.some(v => !Number.isFinite(v)))) {
        throw new Error(`Invalid mechanic ${d.id}`);
      }
      this.states.set(d.id, {nextReady: 0, marks: [], contributed: new Set()});
    }
  }
  advance(tick: number): void {
    if (!Number.isInteger(tick) || tick < this.tick) throw new Error('Simulation ticks must be monotonic integers');
    this.tick = tick;
    for (const {definition: d} of this.mechanics) {
      const s = this.states.get(d.id)!;
      if (s.proc && tick >= s.proc.end) delete s.proc;
      s.marks = s.marks.filter(m => tick - m.tick < d.windowTicks);
    }
  }
  private live(): Proc[] { return [...this.states.values()].flatMap(s => s.proc ? [s.proc] : []); }
  /** Current non-attack effects; never use this to calculate a hit. */
  current(): Effects { return combine(subset(this.common, false), ...this.live().map(p => subset(p.effects, false))); }
  handle(e: SkillEvent): {duplicate: boolean; effects: Effects} {
    // Dedup precedes clock advancement: late retransmission of an old event is harmless.
    if (this.seen.has(e.id)) return {duplicate: true, effects: {}};
    if (!e.id || !e.actionId || !Number.isFinite(e.hp) || !Number.isFinite(e.stamina) ||
        e.hp < 0 || e.hp > 100 || e.stamina < 0 || e.stamina > 100) throw new Error('Invalid canonical event');
    if (e.event === 'hit' && !e.targetId) throw new Error('A landed hit needs a target');
    this.advance(e.tick); this.seen.add(e.id);
    let effects: Effects = {};
    if (e.event === 'hit') {
      if (!this.actions.has(e.actionId)) {
        this.actions.set(e.actionId, copy(this.live().filter(p => p.originActionId !== e.actionId)));
      }
      const eligible = this.actions.get(e.actionId)!.filter(p => !p.targetId || p.targetId === e.targetId);
      const weak: Effects = (e.hitzone ?? 0) >= 0.55 ? {affinityPoints: this.weakCrit} : {};
      effects = combine(subset(this.common, true), weak, ...eligible.map(p => subset(p.effects, true)));
      // Consume a one-shot proc only on an eligible landed DIFFERENT action, once for the whole action.
      for (const p of eligible.filter(p => p.consumeOnHit)) {
        const state = this.states.get(p.id)!;
        if (state.proc?.serial === p.serial) delete state.proc;
      }
    }
    for (const {definition: d, level} of this.mechanics) {
      const s = this.states.get(d.id)!;
      if (d.resetOn.includes(e.event)) { s.marks = []; delete s.proc; }
      const t = d.trigger;
      if (e.event !== t.event || e.tick < s.nextReady || s.contributed.has(e.actionId) ||
          e.hp < t.hpMin || e.hp > t.hpMax || e.stamina < t.staminaMin || e.stamina > t.staminaMax ||
          !t.tagsAll.every(tag => e.tags.includes(tag)) || (t.tagsAny.length > 0 && !t.tagsAny.some(tag => e.tags.includes(tag))) ||
          (d.sameTarget && !e.targetId)) continue;
      if (d.sameTarget && s.marks.some(m => m.targetId !== e.targetId)) s.marks = [];
      s.contributed.add(e.actionId);
      s.marks.push({tick: e.tick, actionId: e.actionId, targetId: e.targetId});
      if (s.marks.length < d.hitsRequired) continue;
      s.marks = []; s.nextReady = e.tick + d.cooldownTicks;
      s.proc = {
        id: d.id, serial: ++this.serial, originActionId: e.actionId,
        ...(d.sameTarget ? {targetId: e.targetId} : {}),
        start: e.tick, end: e.tick + d.durationTicks, consumeOnHit: d.consumeOnHit,
        effects: Object.fromEntries(d.effects.map(x => [x.stat, x.values[level - 1]])),
      };
    }
    return {duplicate: false, effects: e.event === 'hit' ? effects : this.current()};
  }
  /** Call only after action AND every projectile belonging to it have ended. IDs may never be reused. */
  releaseAction(actionId: string): void {
    this.actions.delete(actionId);
    for (const s of this.states.values()) s.contributed.delete(actionId);
  }
  /** Quest start/end, death/respawn, and equipment changes discard transient state, never serialize to save. */
  clear(): void {
    this.tick = -1; this.serial = 0; this.seen.clear(); this.actions.clear();
    for (const s of this.states.values()) {s.nextReady = 0; s.marks = []; s.contributed.clear(); delete s.proc;}
  }
  /** Includes origin/action snapshots, cooldowns, counters and event receipts for deterministic QA. */
  stateJSON(): string {
    return JSON.stringify({tick: this.tick, serial: this.serial, seen: [...this.seen].sort(),
      states: [...this.states].map(([id, s]) => [id, {...s, contributed: [...s.contributed].sort()}]),
      actions: [...this.actions].sort(([a], [b]) => a.localeCompare(b))});
  }
}

/** Adapter guards. Game integration must call this only after cost/damage/consumption resolution. */
export interface EventProof {
  hostileContact?: boolean; evadedByDodgeFrames?: boolean; unguarded?: boolean;
  hpDamage?: number; survived?: boolean; explicitSheatheCompleted?: boolean;
  maintenanceConsumed?: number; family?: string; chargeLevel?: number;
}
export function canonicalEvent(e: SkillEvent, proof: EventProof = {}): SkillEvent | null {
  if (e.event === 'dodge' && !(proof.hostileContact && proof.evadedByDodgeFrames)) return null;
  if (e.event === 'damage_taken' && !(proof.hostileContact && proof.unguarded && (proof.hpDamage ?? 0) > 0 && proof.survived)) return null;
  if (e.event === 'sheathe' && !proof.explicitSheatheCompleted) return null;
  if (e.event === 'charge_release' && !((proof.chargeLevel ?? 0) >= 1)) return null;
  if (e.event === 'item_used' && !((proof.maintenanceConsumed ?? 0) >= 1 && proof.family && proof.family !== 'ring_bow')) return null;
  return copy(e);
}

export interface CommonSkill {id: string; parameters?: {element?: string; status?: string}}
export interface ArmorRecord {id: string; slot: string; defense: number; seriesId: string; skill: CommonSkill}
export function skillKey(s: CommonSkill): string {return [s.id, s.parameters?.element ?? s.parameters?.status].filter(Boolean).join(':');}
export function collectLoadout(ids: string[], owned: Set<string>, records: Map<string, ArmorRecord>): {pieces: ArmorRecord[]; levels: Record<string, number>; signatures: Record<string, 1 | 2>} {
  const bySlot = new Map<string, ArmorRecord>();
  for (const id of new Set(ids)) {
    const a = records.get(id); if (!a || !owned.has(id)) continue;
    const current = bySlot.get(a.slot);
    if (!current || a.defense > current.defense) bySlot.set(a.slot, a);
  }
  const levels: Record<string, number> = {}; const counts: Record<string, number> = {};
  const pieces = [...bySlot.values()].sort((a, b) => a.slot.localeCompare(b.slot));
  for (const a of pieces) {
    const k = skillKey(a.skill); levels[k] = Math.min(3, (levels[k] ?? 0) + 1);
    counts[a.seriesId] = (counts[a.seriesId] ?? 0) + 1;
  }
  const signatures: Record<string, 1 | 2> = {};
  for (const [id, count] of Object.entries(counts)) if (count >= 2) signatures[id] = count >= 4 ? 2 : 1;
  return {pieces, levels, signatures};
}
const COMMON: Record<string, [Stat, number[]]> = {
  guard_economy: ['guardCostPct', [-8, -14, -20]], edge_keep: ['edgeWearPct', [-5, -9, -13]],
  dodge_economy: ['dodgeCostPct', [-5, -9, -13]], stamina_recovery: ['staminaRecoveryPct', [4, 7, 10]],
  part_damage: ['partPct', [5, 9, 13]], element_tuning: ['elementPct', [4, 7, 10]],
  status_tuning: ['statusPct', [4, 7, 10]], stun_tuning: ['stunPct', [4, 7, 10]],
  item_efficiency: ['itemUseTicksPct', [-5, -9, -13]],
};
export function commonEffects(levels: Record<string, number>): {effects: Effects; weakCrit: number; elementalResistance: Record<string, number>; statusThreshold: Record<string, number>} {
  const effects: Effects = {}; const elementalResistance: Record<string, number> = {}; const statusThreshold: Record<string, number> = {};
  let weakCrit = 0;
  for (const [key, n] of Object.entries(levels)) {
    const level = clamp(Math.floor(n), 0, 3); if (!level) continue;
    const [id, parameter] = key.split(':');
    if (COMMON[id!]) {const [stat, values] = COMMON[id!]!; effects[stat] = values[level - 1]!;}
    else if (id === 'weak_crit') weakCrit = [4, 7, 10][level - 1]!;
    else if (id === 'element_resistance' && parameter) elementalResistance[parameter] = [3, 6, 9][level - 1]!;
    else if (id === 'status_resistance' && parameter) statusThreshold[parameter] = 1 + [20, 35, 50][level - 1]! / 100;
  }
  return {effects, weakCrit, elementalResistance, statusThreshold};
}
/** Reference arithmetic: raw and element input are the separate existing game terms before rounding. */
export function damageTerms(raw: number, element: number, status: number, stun: number, effects: Effects, affinity: number, rng: number, bluntHead = false) {
  const a = clamp(affinity + (effects.affinityPoints ?? 0), -100, 60);
  const crit = rng < Math.abs(a) / 100 ? (a >= 0 ? 1.25 : 0.75) : 1;
  const r = raw * (1 + (effects.rawPct ?? 0) / 100) * crit;
  const el = element * (1 + (effects.elementPct ?? 0) / 100);
  return {hp: r + el, part: (r + el) * (1 + (effects.partPct ?? 0) / 100),
    status: status * (1 + (effects.statusPct ?? 0) / 100),
    stun: bluntHead ? stun * (1 + (effects.stunPct ?? 0) / 100) : 0, crit};
}
export function edgeRules(capacityScale: number, wearScale: number, effects: Effects) {
  return {max: 100 * capacityScale, stages: [60, 25, 0].map(x => x * capacityScale),
    wearScale: wearScale * (1 + (effects.edgeWearPct ?? 0) / 100)};
}
/** Apply static cost scale only to current combat costs; zero-cost attacks stay zero. */
export function staminaCost(base: number, scope: 'dodge' | 'guard' | 'charge' | 'sprint' | 'item' | 'gather' | 'sheathe', staticScale: number, effects: Effects): number {
  if (!['dodge', 'guard', 'charge'].includes(scope)) return base;
  const pct = scope === 'dodge' ? effects.dodgeCostPct ?? 0 : scope === 'guard' ? effects.guardCostPct ?? 0 : 0;
  return base * staticScale * (1 + pct / 100);
}
