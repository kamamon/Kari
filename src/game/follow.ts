// 攻撃を受ける部位の追従（v0.25.0。ChatGPT の設計提案 #6「頭・脚・尾の被攻撃部位を固定 tick の共通姿勢へ追従させる」）。
// 技の間（と眠っている間）、部位の形（カプセル）の端を、描画の動きから前もって作った表（public/data/follow/）のとおりに動かす。
// 表は npm run monsters:bake が描画の骨から作る。戦闘はこの表だけを読む（描画の骨の位置を、戦闘の正本にしない。60Hz の tick で決まる）。
import type { FollowDef, FollowStateId, FollowTable, HurtShapeDef, MonsterDef } from '../data/schemas';

/** 読み込んだ表を、部位と形の番号で引ける形にする。合わない所があれば errors に書く */
export function buildFollowTable(def: MonsterDef, doc: FollowDef, actionLength: (id: string) => number | undefined, errors: string[]): FollowTable {
  const w = `follow ${doc.monsterId}`;
  const index = new Map(def.parts.map((p, i) => [p.id, i]));
  if (!(Number.isInteger(doc.step) && doc.step > 0)) errors.push(`${w}: step が正の整数でない`);
  const step = Math.max(1, doc.step | 0);
  // 部位ごとに、形の番号の後ろへ、切断の後の形の番号を続ける（v0.36.0）
  const grid = (): (Int16Array | null)[][] => def.parts.map((p) => [...p.shapes, ...(p.sever?.shapesAfter ?? [])].map(() => null));
  const fill = (name: string, set: { shapes: { part: string; i: number; after?: boolean; d: number[][] }[] }, keys: number): (Int16Array | null)[][] => {
    const g = grid();
    for (const sh of set.shapes ?? []) {
      const pi = index.get(sh.part);
      if (pi === undefined) {
        errors.push(`${w} ${name}: 部位 ${sh.part} が無い`);
        continue;
      }
      const part = def.parts[pi]!;
      const count = sh.after ? (part.sever?.shapesAfter.length ?? 0) : part.shapes.length;
      if (!(Number.isInteger(sh.i) && sh.i >= 0 && sh.i < count)) {
        errors.push(`${w} ${name}: ${sh.part} の${sh.after ? '切断の後の' : ''}形 ${sh.i} が無い`);
        continue;
      }
      if (!Array.isArray(sh.d) || sh.d.length !== keys || !sh.d.every((k) => Array.isArray(k) && k.length === 6 && k.every((v) => Number.isInteger(v) && Math.abs(v) < 2000))) {
        errors.push(`${w} ${name}: ${sh.part}[${sh.i}] の鍵の数か値が合わない（鍵 ${keys} 個、6 つずつの cm の整数）`);
        continue;
      }
      g[pi]![sh.after ? part.shapes.length + sh.i : sh.i] = Int16Array.from(sh.d.flat());
    }
    return g;
  };
  const actions = new Map<string, (Int16Array | null)[][]>();
  for (const [id, set] of Object.entries(doc.actions ?? {})) {
    const dur = actionLength(id);
    if (dur === undefined) {
      errors.push(`${w}: 技 ${id} が無い`);
      continue;
    }
    if (!id.startsWith(`${doc.monsterId}.`)) errors.push(`${w}: 技 ${id} は、ほかの種の技`);
    actions.set(id, fill(id, set, followKeys(dur, step)));
  }
  const sleep = doc.poses?.sleep ? fill('sleep', doc.poses.sleep, 1) : null;
  const states: FollowTable['states'] = {};
  for (const [id, set] of Object.entries(doc.states ?? {})) {
    if (!FOLLOW_STATES.includes(id as FollowStateId)) {
      errors.push(`${w}: 状態 ${id} は知らない（${FOLLOW_STATES.join(' / ')}）`);
      continue;
    }
    if (!set || !(Number.isInteger(set.ticks) && set.ticks > 1)) {
      errors.push(`${w}: 状態 ${id} の ticks が 2 以上の整数でない`);
      continue;
    }
    states[id as FollowStateId] = { ticks: set.ticks, grid: fill(id, set, followKeys(set.ticks, step)) };
  }
  return { step, actions, sleep, states };
}

/** 表を作れる、技以外の時間で動く状態（v0.36.0） */
export const FOLLOW_STATES: readonly FollowStateId[] = ['topple', 'flinch', 'stun'];

/**
 * 怯みの経過から、表の tick を引く（v0.36.0）。経過の割合（経過 / 全体）を、表を作った時の長さへ写す。
 * 転倒は全体がいつも同じ長さなので、経過の tick そのものになる。
 */
export function staggerFollowTick(elapsed: number, total: number, ticks: number): number {
  if (total <= 0) return 0;
  return Math.min(ticks - 1, Math.max(0, Math.round((elapsed * ticks) / total)));
}

/** 長さ dur の技の鍵の数（tick 0, step, 2·step, … と、最後の tick） */
export function followKeys(dur: number, step: number): number {
  return Math.ceil(Math.max(0, dur - 1) / step) + 1;
}

/** 鍵の tick */
export function followTick(k: number, dur: number, step: number): number {
  return Math.min(k * step, Math.max(0, dur - 1));
}

/**
 * 形 s の、tick の時の位置（体の座標）。d は表のずれ（cm）。
 * dur は技の長さ（決まった姿勢の時は 1）。
 */
export function followShape(s: HurtShapeDef, d: Int16Array, tick: number, dur: number, step: number): HurtShapeDef {
  const n = d.length / 6;
  let k = 0, f = 0;
  if (n > 1) {
    const t = Math.max(0, Math.min(tick, dur - 1));
    k = Math.min(n - 2, Math.floor(t / step));
    const t0 = followTick(k, dur, step), t1 = followTick(k + 1, dur, step);
    f = t1 > t0 ? Math.min(1, Math.max(0, (t - t0) / (t1 - t0))) : 0;
  }
  const at = (j: number): number => {
    const v0 = d[k * 6 + j]!;
    const v1 = n > 1 ? d[(k + 1) * 6 + j]! : v0;
    return (v0 + (v1 - v0) * f) / 100;
  };
  const a: [number, number, number] = [s.a[0]! + at(0), s.a[1]! + at(1), s.a[2]! + at(2)];
  const b: [number, number, number] | undefined = s.b ? [s.b[0]! + at(3), s.b[1]! + at(4), s.b[2]! + at(5)] : undefined;
  return b ? { ...s, a, b } : { ...s, a };
}
