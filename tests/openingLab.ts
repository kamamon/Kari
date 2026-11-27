// 後隙の反撃（v0.73.0。#19 の M02。docs/spec.md の 32.39。D-171）を確かめる道具。検査から使う（これ自体は検査ではない）。
//
// 1 つの技について:
//   1. 技が選ばれる位置（AI の選び方の距離と角度の真ん中）に相手が居たとして、技を最後まで動かし、判定と落下物の通った所を記録する。
//   2. その位置から前転 1 回（3.4m）で届く所のうち、判定にも落下物にも当たらない所（当たる間が前転の無敵 8 tick より短い所も）を「避けた所」とする。
//      狙う部位へいちばん近い所を選ぶ（狙って避けた狩人）。
//   3. 最後の判定が終わった tick に、武器を抜いた狩人（護刃か断岳剣）を「避けた所」へ置き、部位へ歩いて、届いたら主の斬りを出す。
//      部位に当たった時の、技の tick を返す。
import type { ActionDef, Content, MapDef } from '../src/data/schemas';
import { DEG, forwardOf, toWorld, type V3 } from '../src/core/math';
import { inWindow, newRun } from '../src/game/action';
import { Btn, type InputFrame } from '../src/game/inputFrame';
import { monsterBlockers, monsterShapes } from '../src/game/monster';
import { Simulation } from '../src/game/sim';
import { trackSegment } from '../src/game/tracks';
import { baseOptions, frame } from './helpers';

export const FLAT_MAP = 'map.test.flat';
/** 前転 1 回の距離（m。curves_player.json の roll_std） */
export const ROLL = 3.4;
/**
 * 反撃する狩人: 護刃（主の斬り = 縦。8 tick 目から当たる。副 = 横斬り。9 tick 目から）と、断岳剣（主 = 縦斬り。22 tick 目から。副 = 薙ぎ払い。18 tick 目から）。
 * reach = 斬りを出す、部位までの横の距離（m）。近くと、刃先だけが届く遠くの 2 通り。縦の斬りは高い所から当たるので、
 * 頭の上や奥に別の部位がある体では、横の斬り（btn = Btn.Sub）や、刃先だけを届かせる間合いで頭を狙う
 */
export const HUNTERS = {
  quick: { weaponId: 'weapon.guard_blade.001', reach: [1.0, 1.3] },
  heavy: { weaponId: 'weapon.heavy_blade.001', reach: [1.7, 2.2] },
} as const;
export type HunterKind = keyof typeof HUNTERS;
const PARK: V3 = { x: 70, y: 0, z: 70 };

/** 岩も段も無い、広い狩場（検査の中だけ） */
export function addFlatMap(content: Content): void {
  if (content.maps.has(FLAT_MAP)) return;
  const base = content.maps.get('map.basin.training')!;
  const map: MapDef = { ...base, id: FLAT_MAP, bounds: { minX: -90, maxX: 90, minZ: -90, maxZ: 90 }, rocks: [], platforms: [] };
  content.maps.set(FLAT_MAP, map);
}

export interface Capsule { a: V3; b: V3; r: number }
interface TickRec { pos: V3; yaw: number; hits: (Capsule & { id: string })[]; hazards: { id: number; x: number; z: number; r: number }[] }
export interface DryRun { aid: string; def: ActionDef; p0: V3; ticks: TickRec[]; lastHit: number; hasHazard: boolean }

const hdist = (a: V3, b: V3): number => Math.hypot(a.x - b.x, a.z - b.z);

/** 線分 ab の上で、点 p に（横の距離で）いちばん近い点 */
function nearestOnSeg(p: V3, a: V3, b: V3): V3 {
  const dx = b.x - a.x, dz = b.z - a.z;
  const l2 = dx * dx + dz * dz;
  const u = l2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2));
  return { x: a.x + dx * u, y: a.y + (b.y - a.y) * u, z: a.z + dz * u };
}
/** 2 つの線分のいちばん近い距離（粗く: 両方を 9 点に分けて比べる） */
function segDist(a0: V3, a1: V3, b0: V3, b1: V3): number {
  let best = Infinity;
  for (let i = 0; i <= 8; i++) {
    const p = { x: a0.x + ((a1.x - a0.x) * i) / 8, y: a0.y + ((a1.y - a0.y) * i) / 8, z: a0.z + ((a1.z - a0.z) * i) / 8 };
    for (let j = 0; j <= 8; j++) {
      const q = { x: b0.x + ((b1.x - b0.x) * j) / 8, y: b0.y + ((b1.y - b0.y) * j) / 8, z: b0.z + ((b1.z - b0.z) * j) / 8 };
      best = Math.min(best, Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z));
    }
  }
  return best;
}

function setup(content: Content, monsterId: string, weaponId: string = HUNTERS.quick.weaponId): Simulation {
  addFlatMap(content);
  const sim = new Simulation(content, baseOptions({ mapId: FLAT_MAP, monsterId, weaponId, monsterAttacks: false }));
  const m = sim.monsters[0]!;
  m.pos = { x: 0, y: 0, z: 0 };
  m.prevPos = { ...m.pos };
  m.yaw = 0;
  m.prevYaw = 0;
  m.aware = true;
  return sim;
}
const park = (sim: Simulation, at: V3, yaw = 0): void => {
  const p = sim.player;
  p.pos = { ...at };
  p.prevPos = { ...at };
  p.yaw = yaw;
  p.prevYaw = yaw;
};

export type AimKind = 'mid' | 'near' | 'far';
export const AIMS: readonly AimKind[] = ['mid', 'near', 'far'];
/**
 * 技が選ばれる位置（モンスターは原点で +Z を向く。左 = +X）。AI の選び方の角度の真ん中で、
 * 距離は mid = 選ばれる距離の真ん中、near = 近い端から 1m（体の当たりの外 1m より近くはしない。mid より遠くもしない）、
 * far = 遠い端（まわり全部へ広がる技は、外へ離れて避ける）
 */
export function aimPoint(content: Content, monsterId: string, aid: string, kind: AimKind = 'mid'): V3 {
  const def = content.monsters.get(monsterId)!;
  const c = def.ai.choices.find((x) => x.actionId === aid || x.ifSevered?.actionId === aid);
  if (!c) return { x: 0, y: 0, z: def.bodyRadius + 2.5 };
  const mid = (c.minDist + c.maxDist) / 2;
  const d = kind === 'mid' ? mid : kind === 'far' ? c.maxDist : Math.min(mid, Math.max(c.minDist + 1, def.bodyRadius + 1));
  const ang = c.minAngleDeg !== undefined ? (c.minAngleDeg + c.maxAngleDeg) / 2 : 0;
  const f = forwardOf((c.side === 'right' ? -ang : ang) * DEG);
  return { x: f.x * d, y: 0, z: f.z * d };
}

/** 技を最後まで動かして、判定と落下物の通った所を記録する */
export function dryRun(content: Content, monsterId: string, aid: string, kind: AimKind = 'mid'): DryRun {
  const sim = setup(content, monsterId);
  const m = sim.monsters[0]!;
  const def = content.actions.get(aid)!;
  const p0 = aimPoint(content, monsterId, aid, kind);
  park(sim, p0);
  sim.player.hp = 1e9;
  m.action = newRun(def, 9001, m.yaw);
  const ticks: TickRec[] = [];
  let lastHit = 0, hasHazard = false;
  // 落下物は技が終わった後も残るので、少し長く見る
  for (let i = 0; i < def.durationTicks + 120; i++) {
    const t = m.action ? m.action.tick : def.durationTicks;
    const rec: TickRec = { pos: { ...m.pos }, yaw: m.yaw, hits: [], hazards: [] };
    if (m.action && m.action.def === def) {
      for (const hw of def.hitWindows) {
        if (!inWindow(t, hw)) continue;
        const tr = content.tracks.get(hw.shapeTrack)!;
        for (const tt of [t, t + 1]) {
          const s = trackSegment(tr, tt);
          rec.hits.push({ id: hw.id, a: toWorld(s.a, m.pos, m.yaw), b: toWorld(s.b, m.pos, m.yaw), r: tr.radius });
        }
        lastHit = Math.max(lastHit, t + 1);
      }
    }
    for (const h of sim.hazards) {
      hasHazard = true;
      if (h.warn <= 1 && h.active > 0) rec.hazards.push({ id: h.id, x: h.x, z: h.z, r: h.radius });
    }
    ticks.push(rec);
    if (i >= def.durationTicks && sim.hazards.length === 0) break;
    // 技が終わった後は、次の技を出させない
    if (!m.action) m.cooldown = 9999;
    sim.step(frame());
    sim.drainEvents();
    sim.player.hp = 1e9;
    if (sim.player.mode === 'dead') break;
  }
  if (lastHit === 0) lastHit = def.phases.find((p) => p.id === 'active')?.to ?? def.durationTicks;
  return { aid, def, p0, ticks, lastHit, hasHazard };
}

/**
 * その場所へ避けられるか（当たりの円柱は、狩人の体）: 技の判定にも落下物にも当たらないか、
 * 当たる間が、前転の無敵（player.common.roll の invulnerable。8 tick）より短い（前転で抜けられる）。判定の窓・落下物ごとに数える
 */
function safeAt(content: Content, run: DryRun, c: V3): boolean {
  const T = content.player;
  const inv = content.actions.get('player.common.roll')?.invulnerable?.[0];
  const iframes = inv ? inv.to - inv.from : 0;
  const a = { x: c.x, y: T.radius, z: c.z }, b = { x: c.x, y: T.height - T.radius, z: c.z };
  const inside = new Map<string, number>();
  for (const rec of run.ticks) {
    const now = new Set<string>();
    for (const h of rec.hits) if (segDist(a, b, h.a, h.b) < h.r + T.radius + 0.15) now.add(`w:${h.id}`);
    for (const h of rec.hazards) if (Math.hypot(c.x - h.x, c.z - h.z) < h.r + T.radius + 0.2) now.add(`z:${h.id}`);
    for (const k of now) {
      const n = (inside.get(k) ?? 0) + 1;
      if (n > iframes) return false;
      inside.set(k, n);
    }
  }
  return true;
}

export interface CounterResult {
  /** 避けた所（無ければ null: 前転 1 回で届く所に、当たらない所が無い） */
  spot: V3 | null;
  /** 部位に当たった時の、技の tick（技が終わった後は 長さ + 過ぎた tick）。当たらなければ null */
  hitTick: number | null;
  /** はじめに当たった部位（狙った部位でなくても） */
  firstPart: string | null;
  firstTick: number | null;
  /** 置いた時の、部位までの横の距離（m） */
  dist: number;
}

/** 部位の形のうち、点 p にいちばん近い点（横の距離）と、その距離（形の太さを引く） */
function nearestOnPart(sim: Simulation, partIndex: number, p: V3): { q: V3; d: number } {
  let best = { q: p, d: Infinity };
  for (const s of monsterShapes(sim.monsters[0]!)) {
    if (s.partIndex !== partIndex) continue;
    const q = s.b ? nearestOnSeg(p, s.a, s.b) : s.a;
    const d = hdist(p, q) - s.r;
    if (d < best.d) best = { q, d };
  }
  return best;
}

/**
 * 最後の判定が終わった tick に、避けた所へ狩人（hunter = quick 護刃・heavy 断岳剣）を置いて、部位を斬りに行く。
 * until = この技の tick まで見る（既定は技の終わり）
 */
export function counter(content: Content, monsterId: string, run: DryRun, partId: string, until = run.def.durationTicks, hunter: HunterKind = 'quick', btn: number = Btn.Main, rank = 0, reach: number = HUNTERS[hunter].reach[0]): CounterResult {
  const H = HUNTERS[hunter];
  const sim = setup(content, monsterId, H.weaponId);
  const m = sim.monsters[0]!;
  const def = run.def;
  const partIndex = m.def.parts.findIndex((p) => p.id === partId);
  if (partIndex < 0) throw new Error(`${monsterId}: 部位 ${partId} が無い`);
  park(sim, PARK);
  m.action = newRun(def, 9001, m.yaw);
  while (m.action && m.action.tick < run.lastHit) {
    sim.step(frame());
    sim.drainEvents();
  }
  const t0 = m.action ? m.action.tick : def.durationTicks;
  // 避けた所: 技が選ばれる位置から前転 1 回で届く所で、当たらず、体の当たりの外。部位へ近い順に並べ、互いに 0.85m 以上離れたものの rank 番目
  const T = content.player;
  const blockers = monsterBlockers(m);
  const cands: { c: V3; d: number }[] = [];
  for (let r = 0; r <= ROLL + 1e-6; r += 0.425) {
    const n = r === 0 ? 1 : 24;
    for (let k = 0; k < n; k++) {
      const c = { x: run.p0.x + Math.sin((k / n) * Math.PI * 2) * r, y: 0, z: run.p0.z + Math.cos((k / n) * Math.PI * 2) * r };
      if (blockers.some((b) => Math.hypot(c.x - b.x, c.z - b.z) < b.r + T.radius + 0.05)) continue;
      if (!safeAt(content, run, c)) continue;
      cands.push({ c, d: nearestOnPart(sim, partIndex, c).d });
    }
  }
  cands.sort((a, b) => a.d - b.d);
  const picked: { c: V3; d: number }[] = [];
  for (const k of cands) if (picked.every((q) => hdist(q.c, k.c) >= 0.85)) picked.push(k);
  const pick = picked[rank] ?? null;
  const spot = pick ? pick.c : null;
  const bestD = pick ? pick.d : Infinity;
  const out: CounterResult = { spot, hitTick: null, firstPart: null, firstTick: null, dist: bestD };
  if (!spot) return out;
  const p = sim.player;
  const q0 = nearestOnPart(sim, partIndex, spot).q;
  park(sim, spot, Math.atan2(q0.x - spot.x, q0.z - spot.z));
  p.drawn = true;
  let pressed = -99;
  for (let i = 0; t0 + i < until; i++) {
    const tick = t0 + i;
    if (!m.action) m.cooldown = 9999;
    let input: InputFrame = frame();
    if (!p.action) {
      const { q, d } = nearestOnPart(sim, partIndex, p.pos);
      const dx = q.x - p.pos.x, dz = q.z - p.pos.z;
      const len = Math.hypot(dx, dz) || 1;
      if (d > reach) input = frame({ moveX: dx / len, moveZ: dz / len });
      else if (i - pressed > 2) {
        // 向きを合わせてから斬る（歩いて来た時は、もう向いている）
        p.yaw = Math.atan2(dx, dz);
        input = frame({ pressed: btn, held: btn });
        pressed = i;
      }
    }
    sim.step(input);
    for (const ev of sim.drainEvents()) {
      if (ev.type !== 'hit' || ev.target !== m.id) continue;
      if (out.firstPart === null) {
        out.firstPart = ev.partId;
        out.firstTick = tick;
      }
      if (ev.partId === partId && out.hitTick === null) out.hitTick = tick;
    }
    if (out.hitTick !== null) break;
  }
  return out;
}

/** 部位の形の、技の tick ごとの様子（モンスターは原点で動かさない。技の移動は入れない） */
export function partTrace(content: Content, monsterId: string, aid: string, partId: string, from: number, to: number): { low: number; high: number; maxStep: number } {
  const sim = setup(content, monsterId);
  const m = sim.monsters[0]!;
  const def = content.actions.get(aid)!;
  const partIndex = m.def.parts.findIndex((p) => p.id === partId);
  let low = -Infinity, high = Infinity, maxStep = 0;
  let prev: { a: V3; b: V3 | null }[] | null = null;
  for (let t = from; t < to; t++) {
    m.action = { ...newRun(def, 9001, 0), tick: t };
    const shapes = monsterShapes(m).filter((s) => s.partIndex === partIndex);
    // その tick の、いちばん低い所と高い所。区間の中でいちばん悪い値（低い所の最大・高い所の最小）を返す
    let lo = Infinity, hi = -Infinity;
    for (const s of shapes) {
      lo = Math.min(lo, Math.min(s.a.y, s.b ? s.b.y : s.a.y) - s.r);
      hi = Math.max(hi, Math.max(s.a.y, s.b ? s.b.y : s.a.y) + s.r);
    }
    low = Math.max(low, lo);
    high = Math.min(high, hi);
    if (prev) {
      shapes.forEach((s, i) => {
        const q = prev![i]!;
        maxStep = Math.max(maxStep, Math.hypot(s.a.x - q.a.x, s.a.y - q.a.y, s.a.z - q.a.z));
        if (s.b && q.b) maxStep = Math.max(maxStep, Math.hypot(s.b.x - q.b.x, s.b.y - q.b.y, s.b.z - q.b.z));
      });
    }
    prev = shapes.map((s) => ({ a: s.a, b: s.b }));
  }
  m.action = null;
  return { low, high, maxStep };
}

/** 避けた所の候補の数（部位へ近い順） */
export const SPOTS = 4;

/**
 * 位置（選ばれる距離の真ん中・近い端・遠い端）・避けた所（部位へ近い順に SPOTS 個）・間合い（近く・刃先）・斬り方（主・副）を順に試して、
 * はじめに当てられたもの（当てられなければ、はじめに試した結果）。上手な狩人は、立つ所と間合いと斬り方を選ぶ
 */
export interface Tried { kind: AimKind; btn: 'main' | 'sub'; rank: number; reach: number; r: CounterResult }
export function firstCounter(content: Content, monsterId: string, aid: string, partId: string, until: number, hunter: HunterKind): Tried {
  let first: Tried | null = null;
  const seen: V3[] = [];
  for (const kind of AIMS) {
    const run = dryRun(content, monsterId, aid, kind);
    // 前の位置と同じなら、試さない
    if (seen.some((q) => Math.hypot(q.x - run.p0.x, q.z - run.p0.z) < 0.05)) continue;
    seen.push(run.p0);
    for (let rank = 0; rank < SPOTS; rank++) {
      for (const reach of HUNTERS[hunter].reach) {
        for (const btn of ['main', 'sub'] as const) {
          const r = counter(content, monsterId, run, partId, until, hunter, btn === 'main' ? Btn.Main : Btn.Sub, rank, reach);
          const t: Tried = { kind, btn, rank, reach, r };
          if (r.hitTick !== null) return t;
          first ??= t;
          if (!r.spot) break;
        }
        if (!first!.r.spot && rank === 0) break;
      }
    }
  }
  return first!;
}
