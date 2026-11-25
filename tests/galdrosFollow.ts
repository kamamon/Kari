// ガルドロスの部位の追従の表を、描画の骨から作る（v0.36.0。ChatGPT のモンスターの解剖 #12 の M3、D-119）。
// 一般の種の表（tests/creature-motion.test.ts の bakeFollow）と同じ決まり: 部位の形の端を、いちばん近い皮の頂点と同じ重みで骨に乗せ、
// 技の step tick ごとの、形を作った時の位置からのずれ（cm の整数）を並べる。5cm に満たない形は書かない。
// ガルドロスだけの違い:
//   - 新しい体で、技の tick 0 から 60Hz で 1 tick ずつ進めた姿勢（描画の時刻 = tick / 60）。狩人を目で追う向きは入れない（視線によらない）
//   - 体が進む技（突進・噛みつき・のしかかり・後ずさり）は、戦闘と同じ曲線で体を進めてから測る（駆け足の脚も表に入る）
//   - 転倒・怯み（部位破壊・切断も同じ姿勢）・気絶の表（states）。転倒は 190 tick、怯みは 46 tick で作り、経過の割合で引く。
//     気絶は首のふらつきのひと回り（STUN_LOOP tick）の繰り返しの表で、残りの tick で引く
//   - 尾を切った後に残る形（sever.shapesAfter）も、残った尾の骨で測って after として書く（切った先の骨は使わない）
// npm run monsters:bake（tests/creature-motion.test.ts）が、一般の種と一緒に public/data/follow/galdros.json へ書く。
import { Vector3 } from 'three';
import type { Content, FollowDef, FollowSetDef, FollowStateDef, FollowStateId, HurtShapeDef } from '../src/data/schemas';
import { newRun } from '../src/game/action';
import { followKeys, followTick } from '../src/game/follow';
import { createMonster, type MonsterState } from '../src/game/monster';
import { sampleCurve } from '../src/game/tracks';
import { GALDROS_BONES, GALDROS_LEGS, GALDROS_LEG_EXTRAS, GALDROS_SCAPULAE, GALDROS_TAIL, galdrosBone } from '../src/render/galdrosBones';
import { GaldrosRig, STUN_LOOP } from '../src/render/galdrosRig';

export const GALDROS_ID = 'monster.galdros';
const STEP = 6;
const MIN_CM = 5;
/** 表を作る長さ（転倒はガルドロスの転倒の長さ、怯みは最も多い怯みの長さ。ほかの長さは経過の割合で引く） */
export const GALDROS_STATE_TICKS: Record<FollowStateId, number> = { topple: 190, flinch: 46, stun: STUN_LOOP };

export interface End {
  part: string;
  i: number;
  after: boolean;
  a: Vector3;
  b: Vector3 | null;
  sa: { bones: number[]; w: number[] };
  sb: { bones: number[]; w: number[] } | null;
}

/** 部位の形の端と、それを乗せる骨（検査用にも返す） */
export function galdrosFollowEnds(content: Content): End[] {
  const def = content.monsters.get(GALDROS_ID)!;
  const probe = new GaldrosRig(def.parts.map((p) => p.id));
  // 部位ごとに、拾ってよい皮（頂点の骨の並び）。体の中の点が、近くの別の部位の皮（頭の点があごの皮、胴の点が上腕の皮など）を拾わないように
  const trunk = new Set(['body', 'lumbar', 'pelvis', 'thorax', 'chest', 'ribs_l', 'ribs_r'].map(galdrosBone));
  const tail = new Set(GALDROS_TAIL), cut = new Set(GALDROS_TAIL.slice(4));
  const head = galdrosBone('head');
  const legBones = (li: number): Set<number> => {
    const L = GALDROS_LEGS[li]!, E = GALDROS_LEG_EXTRAS[li]!;
    return new Set([L.upper, L.lower, L.foot, L.toe, E.twist, ...E.digits, ...(E.spur === null ? [] : [E.spur]), ...(li < 2 ? [GALDROS_SCAPULAE[li]!] : [])]);
  };
  const acceptFor = (part: string, at: Vector3, after: boolean): ((bones: readonly number[]) => boolean) => {
    if (part === 'head') return (b) => b.every((x) => x === head);
    if (part === 'tail') return (b) => b.some((x) => tail.has(x)) && b.every((x) => tail.has(x) || trunk.has(x)) && !(after && b.some((x) => cut.has(x)));
    if (part === 'foreleg' || part === 'hindleg') {
      // 左（+X）と右の脚は、端の x の向きで決める
      const li = (part === 'foreleg' ? 0 : 2) + (at.x >= 0 ? 0 : 1);
      const own = legBones(li);
      return (b) => b.some((x) => own.has(x)) && b.every((x) => own.has(x) || trunk.has(x));
    }
    return (b) => b.every((x) => trunk.has(x));
  };
  const endsOf = (part: string, list: readonly HurtShapeDef[], after: boolean): End[] => list.map((s, i) => {
    const a = new Vector3(...s.a), b = s.b ? new Vector3(...s.b) : null;
    return { part, i, after, a, b, sa: probe.skinOf(a, acceptFor(part, a, after)), sb: b ? probe.skinOf(b, acceptFor(part, b, after)) : null };
  });
  return def.parts.flatMap((p) => [...endsOf(p.id, p.shapes, false), ...endsOf(p.id, p.sever?.shapesAfter ?? [], true)]);
}

/** 骨の名前（検査の表示用） */
export const boneName = (b: number): string => GALDROS_BONES[b]!.name;

export function bakeGaldrosFollow(content: Content): FollowDef {
  const def = content.monsters.get(GALDROS_ID)!;
  const ids = def.parts.map((p) => p.id);
  const ends = galdrosFollowEnds(content);
  const fresh = (): { rig: GaldrosRig; m: MonsterState } => {
    const m = createMonster(def, { x: 0, z: 0, yaw: 0 }, 'follow');
    m.aware = true;
    return { rig: new GaldrosRig(ids), m };
  };
  /** 形の端のずれ（cm）。体の座標（体の位置を引く。向きは 0） */
  const sampleAll = (rig: GaldrosRig, m: MonsterState): number[][] => ends.map((e) => {
    const o = new Vector3(m.pos.x, m.pos.y, m.pos.z);
    const da = rig.skinned(e.a, e.sa).sub(o).sub(e.a);
    const db = e.b ? rig.skinned(e.b, e.sb!).sub(o).sub(e.b) : new Vector3();
    return [da.x, da.y, da.z, db.x, db.y, db.z].map((v) => Math.round(v * 100) + 0);
  });
  const pick = (keys: number[][][]): FollowSetDef => ({
    shapes: ends.flatMap((e, q) => (keys.some((k) => k[q]!.some((v) => Math.abs(v) >= MIN_CM))
      ? [{ part: e.part, i: e.i, ...(e.after ? { after: true } : {}), d: keys.map((k) => k[q]!) }]
      : [])),
  });
  const step = (rig: GaldrosRig, m: MonsterState, t: number): void => {
    rig.root.position.set(m.pos.x, m.pos.y, m.pos.z);
    rig.update(m, { alpha: 1, dt: 1 / 60, time: t / 60, content });
  };

  // ---- 技 ----
  const actions: Record<string, FollowSetDef> = {};
  const moves = [...content.actions.values()].filter((a) => a.actionId.startsWith(`${GALDROS_ID}.`)).sort((a, b) => a.actionId.localeCompare(b.actionId));
  for (const a of moves) {
    const { rig, m } = fresh();
    const curve = a.rootMotion.mode === 'controller' && a.rootMotion.curveId ? content.curves.get(a.rootMotion.curveId)! : null;
    const dir = ((a.rootMotion.dirDeg ?? 0) * Math.PI) / 180;
    const want = new Set(Array.from({ length: followKeys(a.durationTicks, STEP) }, (_, k) => followTick(k, a.durationTicks, STEP)));
    const run = newRun(a, 1, 0);
    const keys: number[][][] = [];
    for (let t = 0; t < a.durationTicks; t++) {
      // 戦闘と同じ: tick t の時の体の位置は、曲線の t までの進み（向き 0 = +Z。横・後ろへ跳ぶ技は dirDeg の向き）
      const d = curve ? sampleCurve(curve, t) - sampleCurve(curve, 0) : 0;
      m.pos.x = Math.sin(dir) * d;
      m.pos.z = Math.cos(dir) * d;
      run.tick = t;
      run.advanced = false;
      m.action = run;
      step(rig, m, t);
      if (want.has(t)) keys.push(sampleAll(rig, m));
    }
    const set = pick(keys);
    if (set.shapes.length) actions[a.actionId] = set;
  }

  // ---- 転倒・怯み: 怯みの経過 tick ごと ----
  const states: Partial<Record<FollowStateId, FollowStateDef>> = {};
  for (const kind of ['topple', 'flinch'] as const) {
    const T = GALDROS_STATE_TICKS[kind];
    const { rig, m } = fresh();
    const want = new Set(Array.from({ length: followKeys(T, STEP) }, (_, k) => followTick(k, T, STEP)));
    const keys: number[][][] = [];
    for (let t = 0; t < T; t++) {
      m.staggerKind = kind;
      m.staggerTotal = T;
      m.staggerTicks = T - t;
      step(rig, m, t);
      if (want.has(t)) keys.push(sampleAll(rig, m));
    }
    const set = pick(keys);
    if (set.shapes.length) states[kind] = { ticks: T, ...set };
  }
  // ---- 気絶: 倒れ切ってから、首のふらつきのひと回り。鍵 k は「残りの tick を STUN_LOOP で割った余り」が followTick(k) の時 ----
  {
    const L = STUN_LOOP;
    const { rig, m } = fresh();
    const keyAt = new Map(Array.from({ length: followKeys(L, STEP) }, (_, k) => [followTick(k, L, STEP), k] as const));
    const keys: number[][][] = [];
    for (let t = 0; t < 2 * L; t++) {
      m.ailments.ticks.stun = 3 * L - t;
      step(rig, m, t);
      const k = keyAt.get(m.ailments.ticks.stun % L);
      if (t >= L && k !== undefined) keys[k] = sampleAll(rig, m);
    }
    const set = pick(keys);
    if (set.shapes.length) states.stun = { ticks: L, ...set };
  }
  // ---- 眠っている姿勢（捕獲された時も同じ） ----
  const { rig, m } = fresh();
  m.asleep = true;
  for (let t = 0; t < 180; t++) step(rig, m, t);
  const sleep = pick([sampleAll(rig, m)]);
  return {
    schemaVersion: 1, monsterId: GALDROS_ID, step: STEP,
    note: '攻撃を受ける部位の追従（v0.36.0 からガルドロスも。npm run monsters:bake の出力。手で編集しない）。d は部位の形の端 a・b のずれ（cm）を、技の step tick ごとに並べたもの。after は尾を切った後に残る形。states は転倒・怯み・気絶',
    actions, poses: sleep.shapes.length ? { sleep } : {}, states,
  };
}
