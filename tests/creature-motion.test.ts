// 大型 11 種と幼体 8 種の動き（v0.21.0。docs/decisions.md D-087・D-088）:
//   - どの技も、種ごとに固有の鍵の姿勢を持つ（ほかの種と同じ動きを使い回さない）。始まりと終わりは、ふだんの姿勢へつながる。
//   - 体の部位に付けた判定（設計図の bind）は、動きの中の部位の位置と、技データの軌道が一致する。
//     CREATURE_BAKE=1 で走らせると（npm run monsters:bake）、検査の代わりに、動きから軌道を作って public/data/tracks/ へ書く。
//   - 技以外の動き（構え・眠る・倒れる・しぐさ）も、種ごとに持つ。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import type { ActionDef, Content, FollowDef, FollowSetDef, FollowStateDef, FollowStateId, ShapeTrackDef } from '../src/data/schemas';
import { newRun } from '../src/game/action';
import { followKeys, followTick } from '../src/game/follow';
import { sampleCurve, trackSegment } from '../src/game/tracks';
import { createMonster } from '../src/game/monster';
import { CREATURE_PLANS } from '../src/render/creaturePlans';
import { sampleMove, type Pose } from '../src/render/creatureMoves';
import { CREATURE_STUN_LOOP, CreatureRig } from '../src/render/creatureRig';
import type { BindPlan } from '../src/render/creaturePlan';
import { GALDROS_ID, bakeGaldrosFollow } from './galdrosFollow';
import { loadContent } from './helpers';

let content: Content;
beforeAll(async () => {
  content = await loadContent();
});

const BAKE = process.env.CREATURE_BAKE === '1';
const ROOT = resolve(__dirname, '..');
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

/** 技の動きの中で、印 a → b の位置から、判定の軌道を作る */
function bakeTrack(rig: CreatureRig, monsterId: string, a: ActionDef, b: BindPlan, side: number): ShapeTrackDef {
  const def = content.monsters.get(monsterId)!;
  const m = createMonster(def, { x: 0, z: 0, yaw: 0 }, 'bake');
  m.aware = true;
  const wins = a.hitWindows.filter((h) => h.shapeTrack === b.track);
  const lo = Math.max(0, Math.min(...wins.map((h) => h.from)) - 2);
  const hi = Math.min(a.durationTicks - 1, Math.max(...wins.map((h) => h.to)) + 1);
  const ticks: number[] = [];
  for (let t = lo; t < hi; t += 2) ticks.push(t);
  ticks.push(hi);
  const keys: ShapeTrackDef['keys'] = [];
  const lens: number[] = [];
  for (const t of ticks) {
    const run = newRun(a, 1, 0);
    run.tick = t;
    m.action = run;
    rig.update(m, { alpha: 0, dt: 1 / 60, time: 0, content });
    const pa = rig.marker(b.a, side), pb = rig.marker(b.b, side);
    const d = pb.clone().sub(pa);
    const len = Math.max(1e-3, d.length());
    d.multiplyScalar(1 / len);
    if (wins.some((h) => t >= h.from && t < h.to)) lens.push(len);
    keys.push({ t, grip: [r3(pa.x), r3(pa.y), r3(pa.z)], dir: [r3(d.x), r3(d.y), r3(d.z)] });
  }
  lens.sort((x, y) => x - y);
  const med = lens[Math.floor(lens.length / 2)] ?? 1;
  return { id: b.track, radius: b.r, from: r3(-(b.back ?? 0)), to: r3(med + (b.ext ?? 0)), keys };
}

/** 種ごとに、部位に付けた判定の軌道を、すべて作る（軌道の id → 軌道） */
function bakeAll(): Map<string, ShapeTrackDef> {
  const out = new Map<string, ShapeTrackDef>();
  for (const [id, plan] of Object.entries(CREATURE_PLANS)) {
    const def = content.monsters.get(id)!;
    const rig = new CreatureRig(plan, def.parts.map((p) => p.id), { seed: 0 });
    for (const a of content.actions.values()) {
      if (!a.actionId.startsWith(`${id}.`)) continue;
      const mp = plan.moves[a.clip];
      for (const b of mp?.bind ?? []) out.set(b.track, bakeTrack(rig, id, a, b, mp!.side ?? 1));
    }
  }
  return out;
}

/** 軌道のファイル（public/data/tracks/*.json。1 行に 1 つ）の、作り直した軌道を差し替える */
function writeBaked(baked: Map<string, ShapeTrackDef>): number {
  const idx = JSON.parse(readFileSync(resolve(ROOT, 'public/data/content.json'), 'utf8')) as { files: { tracks: string[] | string } };
  const files = Array.isArray(idx.files.tracks) ? idx.files.tracks : [idx.files.tracks];
  let n = 0;
  for (const f of files) {
    const path = resolve(ROOT, 'public/data', f);
    const lines = readFileSync(path, 'utf8').split('\n');
    let changed = false;
    for (let i = 0; i < lines.length; i++) {
      const m = /^(\s*)(\{"id": ?"([^"]+)".*?)(,?)\s*$/.exec(lines[i]!);
      if (!m || !baked.has(m[3]!)) continue;
      lines[i] = `${m[1]}${JSON.stringify(baked.get(m[3]!))}${m[4]}`;
      changed = true;
      n++;
    }
    if (changed) writeFileSync(path, lines.join('\n'));
  }
  return n;
}

const near = (a: readonly number[], b: readonly number[], tol: number): boolean => a.every((v, i) => Math.abs(v - b[i]!) <= tol);

/**
 * 部位の追従（v0.25.0。ChatGPT の設計提案 #6）: 攻撃を受ける部位の形の端が、技の間（と眠り）に、体の面と同じに動いた量（cm）。
 * 端は、いちばん近い体の面の頂点と同じ重みで骨に乗せる。5cm に満たない形は書かない。
 */
const FOLLOW_STEP = 6;
const FOLLOW_MIN_CM = 5;
function bakeFollow(only?: string): Map<string, FollowDef> {
  const out = new Map<string, FollowDef>();
  for (const [id, plan] of Object.entries(CREATURE_PLANS)) {
    if (only && id !== only) continue;
    const def = content.monsters.get(id)!;
    const ids = def.parts.map((p) => p.id);
    const probe = new CreatureRig(plan, ids, { seed: 0 });
    const ends = def.parts.flatMap((part) => part.shapes.map((s, i) => {
      const a = new Vector3(...s.a), b = s.b ? new Vector3(...s.b) : null;
      return { part: part.id, i, a, b, sa: probe.skinOf(a), sb: b ? probe.skinOf(b) : null };
    }));
    const sampleAll = (rig: CreatureRig): number[][] => ends.map((e) => {
      const da = rig.skinned(e.a, e.sa).sub(e.a);
      const db = e.b ? rig.skinned(e.b, e.sb!).sub(e.b) : new Vector3();
      return [da.x, da.y, da.z, db.x, db.y, db.z].map((v) => Math.round(v * 100) + 0);
    });
    const pick = (keys: number[][][]): FollowSetDef => ({
      shapes: ends.flatMap((e, q) => (keys.some((k) => k[q]!.some((v) => Math.abs(v) >= FOLLOW_MIN_CM)) ? [{ part: e.part, i: e.i, d: keys.map((k) => k[q]!) }] : [])),
    });
    const actions: Record<string, FollowSetDef> = {};
    for (const a of content.actions.values()) {
      if (!a.actionId.startsWith(`${id}.`)) continue;
      const rig = new CreatureRig(plan, ids, { seed: 0 });
      const m = createMonster(def, { x: 0, z: 0, yaw: 0 }, 'follow');
      m.aware = true;
      const want = new Set(Array.from({ length: followKeys(a.durationTicks, FOLLOW_STEP) }, (_, k) => followTick(k, a.durationTicks, FOLLOW_STEP)));
      const keys: number[][][] = [];
      for (let t = 0; t < a.durationTicks; t++) {
        const run = newRun(a, 1, 0);
        run.tick = t;
        m.action = run;
        rig.update(m, { alpha: 0, dt: 1 / 60, time: 0, content });
        if (want.has(t)) keys.push(sampleAll(rig));
      }
      const set = pick(keys);
      if (set.shapes.length) actions[a.actionId] = set;
    }
    // 眠っている姿勢（捕獲された時も同じ）
    const rig = new CreatureRig(plan, ids, { seed: 0 });
    const m = createMonster(def, { x: 0, z: 0, yaw: 0 }, 'follow');
    m.asleep = true;
    let time = 0;
    for (let i = 0; i < 180; i++) {
      time += 1 / 60;
      rig.update(m, { alpha: 0, dt: 1 / 60, time, content });
    }
    const sleep = pick([sampleAll(rig)]);
    // 転倒・怯み・気絶（v0.67.0。#19 の M03。ガルドロスの tests/galdrosFollow.ts と同じ決まり）: 転倒と怯みは経過の tick ごとに作り、
    // 戦闘は経過の割合で引く（表の長さは、その種の転倒・怯みのいちばん長いもの）。気絶は、残りの tick を CREATURE_STUN_LOOP で割った余りで引く繰り返しの表
    const states: Partial<Record<FollowStateId, FollowStateDef>> = {};
    const lengthOf = (topple: boolean): number => Math.max(0, ...def.parts.filter((p) => p.flinch && !!p.flinch.topple === topple).map((p) => p.flinch!.ticks));
    for (const kind of ['topple', 'flinch'] as const) {
      const T = lengthOf(kind === 'topple');
      if (T < 2) continue;
      const r = new CreatureRig(plan, ids, { seed: 0 });
      const s = createMonster(def, { x: 0, z: 0, yaw: 0 }, 'follow');
      s.aware = true;
      const want = new Set(Array.from({ length: followKeys(T, FOLLOW_STEP) }, (_, k) => followTick(k, T, FOLLOW_STEP)));
      const keys: number[][][] = [];
      for (let t = 0; t < T; t++) {
        s.staggerKind = kind;
        s.staggerTotal = T;
        s.staggerTicks = T - t;
        r.update(s, { alpha: 0, dt: 1 / 60, time: t / 60, content });
        if (want.has(t)) keys.push(sampleAll(r));
      }
      const set = pick(keys);
      if (set.shapes.length) states[kind] = { ticks: T, ...set };
    }
    {
      const L = CREATURE_STUN_LOOP;
      const r = new CreatureRig(plan, ids, { seed: 0 });
      const s = createMonster(def, { x: 0, z: 0, yaw: 0 }, 'follow');
      s.aware = true;
      const keyAt = new Map(Array.from({ length: followKeys(L, FOLLOW_STEP) }, (_, k) => [followTick(k, L, FOLLOW_STEP), k] as const));
      const keys: number[][][] = [];
      for (let t = 0; t < 2 * L; t++) {
        s.ailments.ticks.stun = 3 * L - t;
        r.update(s, { alpha: 0, dt: 1 / 60, time: t / 60, content });
        const k = keyAt.get(s.ailments.ticks.stun % L);
        if (t >= L && k !== undefined) keys[k] = sampleAll(r);
      }
      const set = pick(keys);
      if (set.shapes.length) states.stun = { ticks: L, ...set };
    }
    out.set(id, {
      schemaVersion: 1, monsterId: id, step: FOLLOW_STEP,
      note: '攻撃を受ける部位の追従（v0.25.0。npm run monsters:bake の出力。手で編集しない）。d は部位の形の端 a・b のずれ（cm）を、技の step tick ごとに並べたもの。states は転倒・怯み・気絶（v0.67.0）',
      actions, poses: sleep.shapes.length ? { sleep } : {}, states,
    });
  }
  return out;
}

/** 追従の表を public/data/follow/ へ書き、content.json の files.follow を合わせる */
function writeFollow(docs: Map<string, FollowDef>): void {
  const files: string[] = [];
  for (const [id, d] of docs) {
    const f = `follow/${id.split('.')[1]}.json`;
    files.push(f);
    const rows = (o: Record<string, FollowSetDef>): string[] => Object.entries(o).map(([k, v], i, all) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}${i < all.length - 1 ? ',' : ''}`);
    // 転倒・怯み・気絶の表（v0.36.0 のガルドロスから。v0.67.0 から全部の種）
    const states = d.states && Object.keys(d.states).length ? [' "states": {', ...rows(d.states as Record<string, FollowSetDef>), ' }'] : [];
    const text = ['{', ` "schemaVersion": ${d.schemaVersion},`, ` "monsterId": ${JSON.stringify(d.monsterId)},`, ` "step": ${d.step},`, ` "note": ${JSON.stringify(d.note)},`,
      ' "actions": {', ...rows(d.actions), ' },', ' "poses": {', ...rows(d.poses ?? {}), states.length ? ' },' : ' }', ...states, '}', ''].join('\n');
    mkdirSync(resolve(ROOT, 'public/data/follow'), { recursive: true });
    writeFileSync(resolve(ROOT, 'public/data', f), text);
  }
  const path = resolve(ROOT, 'public/data/content.json');
  const idx = JSON.parse(readFileSync(path, 'utf8')) as { files: Record<string, unknown> };
  if (JSON.stringify(idx.files.follow) !== JSON.stringify(files)) {
    idx.files.follow = files;
    writeFileSync(path, JSON.stringify(idx, null, 2) + '\n');
  }
}

describe('攻撃を受ける部位の追従（v0.25.0）', () => {
  it(BAKE ? '動きから追従の表を作って、public/data/follow/ へ書く（npm run monsters:bake）' : '追従の表が、動きの中の部位の位置と一致する（ずれていたら npm run monsters:bake）', () => {
    if (BAKE) {
      const docs = bakeFollow();
      expect(docs.size).toBe(Object.keys(CREATURE_PLANS).length);
      // ガルドロスの表（v0.36.0。#12 の M3。専用の描画の骨から作る: tests/galdrosFollow.ts）
      docs.set(GALDROS_ID, bakeGaldrosFollow(content));
      writeFollow(docs);
      return;
    }
    // ふだんの検査は 3 種だけ作り直して比べる（全部は npm run monsters:bake の時）
    for (const id of ['monster.selvark', 'monster.razmer', 'monster.kordopil']) {
      const doc = bakeFollow(id).get(id)!;
      const table = content.monsters.get(id)!.follow!;
      expect(table, id).toBeDefined();
      const def = content.monsters.get(id)!;
      const same = (name: string, set: FollowSetDef, grid: (Int16Array | null)[][] | undefined): void => {
        expect(grid, name).toBeDefined();
        for (const sh of set.shapes) {
          const d = grid![def.parts.findIndex((p) => p.id === sh.part)]![sh.i]!;
          expect(d, `${name} ${sh.part}[${sh.i}]`).not.toBeNull();
          const flat = sh.d.flat();
          expect(flat.every((v, k) => Math.abs(v - d[k]!) <= 2), `${name} ${sh.part}[${sh.i}]`).toBe(true);
        }
      };
      for (const [aid, set] of Object.entries(doc.actions)) same(aid, set, table.actions.get(aid));
      // 転倒・怯み・気絶の表（v0.67.0）も、作り直したものと同じ
      for (const [sid, set] of Object.entries(doc.states ?? {})) {
        const st = table.states[sid as FollowStateId];
        expect(st?.ticks, `${id} ${sid}`).toBe(set!.ticks);
        same(`${id} ${sid}`, set!, st?.grid);
      }
    }
  }, 120000);
});

describe('転がる突進の制動と輪の向き（v0.68.0。D-166）', () => {
  it('テンガロの転がる突進が、突進の制動で走る区間の終わりへ跳んでも、輪の向きは跳ばずに揺り戻り、揺り戻した後は跳ばない時と同じ形', () => {
    const id = 'monster.tengaro';
    const def = content.monsters.get(id)!;
    const plan = CREATURE_PLANS[id]!;
    const a = content.actions.get(`${id}.roll_straight`)!;
    expect(a.brake).toEqual({ from: 56, to: 100 });
    const marks = plan.spine.map((_, i) => `sp:${i}`);
    /** 1 回描くごとに 1 tick 進め、jumpAt の tick で制動と同じに走る区間の終わりへ跳ぶ。描いた tick → 背骨の点 */
    const play = (jumpAt: number | null): Map<number, Vector3[]> => {
      const rig = new CreatureRig(plan, def.parts.map((p) => p.id), { seed: 0 });
      const m = createMonster(def, { x: 0, z: 0, yaw: 0 }, 'roll');
      m.aware = true;
      m.action = newRun(a, 1, 0);
      const out = new Map<number, Vector3[]>();
      while (m.action.tick < a.durationTicks) {
        if (m.action.tick === jumpAt) m.action.tick = a.brake!.to - 1;
        rig.update(m, { alpha: 0, dt: 1 / 60, time: m.action.tick / 60, content });
        out.set(m.action.tick, marks.map((k) => rig.marker(k).clone()));
        m.action.tick++;
      }
      return out;
    };
    const plain = play(null);
    const braked = play(72);
    // 跳ぶ前の tick 71 と、跳んだ先の tick 99 の間で、背骨の点は 1 回の描画で 0.35m より大きく動かない（跳ぶ分を回すと何 m も動く）
    const before = braked.get(71)!, after = braked.get(99)!;
    const jump = Math.max(...before.map((p, i) => p.distanceTo(after[i]!)));
    expect(jump).toBeLessThan(0.35);
    // 揺り戻しが終わった後（18 tick）は、跳ばない時と同じ形（輪が何周かした元の向き）
    for (let tick = 99 + 18; tick < a.durationTicks; tick += 4) {
      const d = Math.max(...braked.get(tick)!.map((p, i) => p.distanceTo(plain.get(tick)![i]!)));
      expect(d, `tick ${tick}`).toBeLessThan(0.01);
    }
  });
});

describe('判定の形を体の部位に付けた技（v0.21.0）', () => {
  it(BAKE ? '動きから軌道を作って、public/data/tracks/ へ書く（npm run monsters:bake）' : '技データの軌道が、動きの中の部位の位置と一致する（ずれていたら npm run monsters:bake）', () => {
    const baked = bakeAll();
    expect(baked.size).toBeGreaterThan(0);
    if (BAKE) {
      const n = writeBaked(baked);
      expect(n).toBe(baked.size);
      return;
    }
    const bad: string[] = [];
    for (const [id, b] of baked) {
      const tr = content.tracks.get(id);
      if (!tr) {
        bad.push(`${id}: 軌道が無い`);
        continue;
      }
      const ok = tr.radius === b.radius && Math.abs(tr.from - b.from) <= 0.02 && Math.abs(tr.to - b.to) <= 0.02 && tr.keys.length === b.keys.length &&
        tr.keys.every((k, i) => k.t === b.keys[i]!.t && near(k.grip, b.keys[i]!.grip, 0.03) && near(k.dir, b.keys[i]!.dir, 0.03));
      if (!ok) bad.push(id);
    }
    expect(bad, `動きと軌道がずれている: ${bad.slice(0, 8).join(', ')}`).toEqual([]);
  });
});

/** 姿勢の値が、すべて有限の数か */
function finitePose(p: Pose): boolean {
  for (const [k, v] of Object.entries(p)) {
    if (k === 'legs') {
      for (const lv of Object.values(v as Record<string, number[]>)) if (!lv.every((x) => Number.isFinite(x))) return false;
    } else if (Array.isArray(v)) {
      if (!v.every((x) => Number.isFinite(x))) return false;
    } else if (!Number.isFinite(v as number)) return false;
  }
  return true;
}
const magnitude = (p: Pose): number => {
  let s = 0;
  for (const [k, v] of Object.entries(p)) {
    if (k === 'legs') for (const lv of Object.values(v as Record<string, number[]>)) s += lv.reduce((a, x) => a + Math.abs(x), 0);
    else if (Array.isArray(v)) s += v.reduce((a, x) => a + Math.abs(x), 0);
    else s += Math.abs(v as number);
  }
  return s;
};

describe.skipIf(BAKE)('種ごとに固有の動き（v0.21.0）', () => {
  it('どの技にも鍵の姿勢があり、値は有限で、始まりと終わりはふだんの姿勢へつながる', () => {
    for (const [id, plan] of Object.entries(CREATURE_PLANS)) {
      for (const a of content.actions.values()) {
        if (!a.actionId.startsWith(`${id}.`)) continue;
        const mp = plan.moves[a.clip];
        expect(mp?.def.K.length, a.clip).toBeGreaterThanOrEqual(2);
        for (const k of mp!.def.K) {
          expect(['w', 's', 'r']).toContain(k.p);
          expect(k.t >= 0 && k.t <= 1, `${a.clip} ${k.p}${k.t}`).toBe(true);
          expect(finitePose(k.pose), a.clip).toBe(true);
        }
        const side = mp!.side ?? 1;
        expect(magnitude(sampleMove(mp!.def, a, 0, side, 1).pose), `${a.clip} の始まり`).toBeLessThan(1e-6);
        expect(magnitude(sampleMove(mp!.def, a, a.durationTicks, side, 1).pose), `${a.clip} の終わり`).toBeLessThan(1e-6);
        // 途中で、はっきり動く
        let peak = 0;
        for (let t = 0; t <= a.durationTicks; t += 4) peak = Math.max(peak, magnitude(sampleMove(mp!.def, a, t, side, 1).pose));
        expect(peak, a.clip).toBeGreaterThan(0.3);
      }
    }
  });
});

describe.skipIf(BAKE)('体の印（判定を付ける部位）', () => {
  it('どの印も、体の近くの有限の位置を指す', () => {
    for (const [id, plan] of Object.entries(CREATURE_PLANS)) {
      const def = content.monsters.get(id)!;
      const rig = new CreatureRig(plan, def.parts.map((p) => p.id), { seed: 0 });
      const m = createMonster(def, { x: 0, z: 0, yaw: 0 }, 'probe');
      rig.update(m, { alpha: 0, dt: 1 / 60, time: 0, content });
      for (const mp of Object.values(plan.moves)) {
        for (const b of mp.bind ?? []) {
          for (const mk of [b.a, b.b]) {
            const p = rig.marker(mk, mp.side ?? 1);
            expect(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z), `${id} ${mk}`).toBe(true);
            expect(p.distanceTo(new Vector3(0, p.y, 0)), `${id} ${mk}`).toBeLessThan(8);
          }
        }
      }
    }
  });
});

describe.skipIf(BAKE)('種ごとに固有の動きと、技以外の動き（v0.21.0）', () => {
  it('同じ動きを、ほかの種と使い回さない（同じ種の左右の技だけが、向きを変えて同じ鍵を使う）', () => {
    const seen = new Map<string, string[]>();
    for (const [id, plan] of Object.entries(CREATURE_PLANS)) {
      for (const [clip, mp] of Object.entries(plan.moves)) {
        const k = JSON.stringify(mp.def);
        seen.set(k, [...(seen.get(k) ?? []), `${id}:${clip}`]);
      }
    }
    for (const list of seen.values()) {
      if (list.length < 2) continue;
      const ids = new Set(list.map((x) => x.split(':')[0]));
      expect(ids.size, list.join(', ')).toBe(1);
      // 同じ種の中では、左右の組（_l_ / _r_。向き直りは turn_l90 / turn_r90 のように角度が後ろに付く）だけ
      const bases = new Set(list.map((x) => x.split(':')[1]!.replace(/_01$/, '').replace(/_(l|r)(90|180)?$/, (_m, _s, n?: string) => (n ? `_${n}` : ''))));
      expect(bases.size, list.join(', ')).toBe(1);
    }
  });

  it('どの種も、技以外の動き（構え・眠る・怯む・転倒と起き上がり・倒れる・しぐさ）を持つ。幼体は食む姿勢も', () => {
    for (const [id, plan] of Object.entries(CREATURE_PLANS)) {
      const m = content.monsters.get(id)!;
      const idle = plan.idle;
      expect(idle, id).toBeDefined();
      expect(idle!.dead.length, id).toBeGreaterThanOrEqual(2);
      expect(idle!.dead.every((d, i) => i === 0 || d.t > idle!.dead[i - 1]!.t), id).toBe(true);
      for (const p of [idle!.unaware, idle!.alert, idle!.weak, idle!.rage, idle!.run, idle!.sleep, idle!.flinch, idle!.topple, idle!.rise]) expect(finitePose(p), id).toBe(true);
      expect(magnitude(idle!.sleep), id).toBeGreaterThan(0.3);
      expect(magnitude(idle!.topple), id).toBeGreaterThan(0.5);
      const ids = new Set(idle!.fidgets.map((f) => f.id));
      expect(ids.size, id).toBe(idle!.fidgets.length);
      if (m.herd) {
        expect(idle!.graze, id).toBeDefined();
        expect(idle!.fidgets.length, id).toBeGreaterThanOrEqual(3);
      } else {
        expect(idle!.fidgets.length, id).toBeGreaterThanOrEqual(5);
        // 気付いている時と、気付く前の、どちらにもしぐさがある
        expect(idle!.fidgets.some((f) => f.when !== 'calm'), id).toBe(true);
        expect(idle!.fidgets.some((f) => f.when !== 'aware'), id).toBe(true);
      }
      for (const f of idle!.fidgets) {
        expect(f.dur, `${id} ${f.id}`).toBeGreaterThan(0.3);
        for (const k of f.K) expect(k.t > 0 && k.t < 1 && finitePose(k.pose), `${id} ${f.id}`).toBe(true);
      }
    }
  });

  it('AI が技を選ぶ距離は、その技の判定が届く距離を超えない（狩人の太さと、技で進む距離を含めて）', () => {
    const PR = content.player.radius;
    const bad: string[] = [];
    for (const id of Object.keys(CREATURE_PLANS)) {
      const m = content.monsters.get(id)!;
      for (const c of m.ai.choices) {
        const a = content.actions.get(c.actionId)!;
        if (a.hitWindows.length === 0 || a.hazards?.length) continue;
        const curve = a.rootMotion.curveId ? content.curves.get(a.rootMotion.curveId) : undefined;
        const dd = ((a.rootMotion.dirDeg ?? 0) * Math.PI) / 180;
        let reach = 0;
        for (const hw of a.hitWindows) {
          const tr = content.tracks.get(hw.shapeTrack)!;
          for (let t = hw.from; t < hw.to; t++) {
            const sg = trackSegment(tr, t);
            const adv = curve ? sampleCurve(curve, t) : 0;
            const ox = Math.sin(dd) * adv, oz = Math.cos(dd) * adv;
            for (let k = 0; k <= 10; k++) {
              const y = sg.a.y + ((sg.b.y - sg.a.y) * k) / 10;
              if (y - tr.radius > 1.7) continue;
              const x = sg.a.x + ((sg.b.x - sg.a.x) * k) / 10 + ox, z = sg.a.z + ((sg.b.z - sg.a.z) * k) / 10 + oz;
              reach = Math.max(reach, Math.hypot(x, z) + tr.radius + PR);
            }
          }
        }
        if (c.maxDist > reach + 0.3) bad.push(`${c.actionId}: ${c.maxDist} > ${reach.toFixed(2)}`);
      }
    }
    expect(bad, bad.join(', ')).toEqual([]);
  });
});

describe.skipIf(BAKE)('技の中で、体が大きく動く（v0.21.0）', () => {
  // 飾り（冠・袋など）だけが動く技にしない: 背骨の点と脚の先のどれかが、技の中で、体の高さの 12% 以上動く
  it('どの技も、背骨・脚の先が、体の高さの 12% 以上動く', () => {
    const bad: string[] = [];
    for (const [id, plan] of Object.entries(CREATURE_PLANS)) {
      const def = content.monsters.get(id)!;
      const rig = new CreatureRig(plan, def.parts.map((p) => p.id), { seed: 0 });
      const m = createMonster(def, { x: 0, z: 0, yaw: 0 }, 'move');
      m.aware = true;
      const marks = plan.spine.map((_, i) => `sp:${i}`);
      for (const l of plan.legs) for (const sd of l.mirror ? ['L', 'R'] : ['C']) marks.push(`leg:${l.group}:${sd}:end`);
      const H = rig.info().height;
      for (const a of content.actions.values()) {
        if (!a.actionId.startsWith(`${id}.`)) continue;
        m.action = null;
        rig.update(m, { alpha: 0, dt: 1 / 60, time: 0, content });
        const p0 = marks.map((k) => rig.marker(k).clone());
        let d = 0;
        for (let t = 1; t < a.durationTicks; t += 3) {
          const run = newRun(a, 1, 0);
          run.tick = t;
          m.action = run;
          rig.update(m, { alpha: 0, dt: 1 / 60, time: 0, content });
          marks.forEach((k, i) => { d = Math.max(d, rig.marker(k).distanceTo(p0[i]!)); });
        }
        if (d < 0.12 * H) bad.push(`${a.actionId}: ${d.toFixed(2)} m（体の高さ ${H.toFixed(2)} m）`);
      }
    }
    expect(bad, bad.join('\n')).toEqual([]);
  });
});

describe.skipIf(BAKE)('横たわる姿勢は、地面に横たわる（v0.21.0）', () => {
  // 眠る・転倒・死んだ姿勢で、体を支える所（胴の筒と、袋・甲羅・嚢・胴の塊）の下が地面に着き（浮かない・沈まない）、
  // 脚や翼が地面へ深く潜らない（脚と動かす飾りは、潜った分だけ付け根で回して出す。細い飾りが少し刺さるのは許す）
  it('眠る・転倒・死んだ姿勢の、体の下は地面の高さ、全体も深く潜らない', () => {
    const bad: string[] = [];
    for (const [id, plan] of Object.entries(CREATURE_PLANS)) {
      const def = content.monsters.get(id)!;
      const pose = (name: string, setup: (m: ReturnType<typeof createMonster>) => void, secs: number): void => {
        const rig = new CreatureRig(plan, def.parts.map((p) => p.id), { seed: 0 });
        const m = createMonster(def, { x: 0, z: 0, yaw: 0 }, 'lie');
        m.aware = true;
        setup(m);
        let time = 0;
        for (let i = 0; i < Math.round(secs * 60); i++) {
          time += 1 / 60;
          rig.update(m, { alpha: 0, dt: 1 / 60, time, content });
        }
        const H = rig.info().height;
        const lo = rig.lowest();
        if (lo.torso < -(0.06 * H + 0.02) || lo.torso > 0.05 * H + 0.03) bad.push(`${id} ${name}: 体の下 ${lo.torso.toFixed(2)} m`);
        if (lo.all < -(0.3 * H + 0.15)) bad.push(`${id} ${name}: いちばん低い所 ${lo.all.toFixed(2)} m`);
      };
      pose('眠る', (m) => { m.asleep = true; }, 3);
      pose('転倒', (m) => { m.staggerKind = 'topple'; m.staggerTotal = 400; m.staggerTicks = 220; }, 0.1);
      pose('死', (m) => { m.dead = true; m.deadTicks = 300; }, 0.1);
    }
    expect(bad, bad.join('\n')).toEqual([]);
  });
});

describe.skipIf(BAKE)('足の接地（v0.25.0。ChatGPT の設計提案 #6）', () => {
  // まっすぐ歩く 5 秒（はじめの 1 秒は数えない）の、足先の滑り（支えの始めから 3/4 までの間の、着いた所からの水平のずれの最大）と、いちばん低い足先
  const walk = (id: string, on: boolean): { slide: number; contacts: number; low: number } => {
    CreatureRig.plantFeetOn = on;
    try {
      const def = content.monsters.get(id)!;
      const rig = new CreatureRig(CREATURE_PLANS[id]!, def.parts.map((p) => p.id), { seed: 0 });
      const m = createMonster(def, { x: 0, z: 0, yaw: 0 }, 'walk');
      m.aware = true;
      const v = def.moveSpeed ?? 2.5;
      const start = new Map<string, Vector3>();
      let slide = 0, contacts = 0, low = Infinity, time = 0;
      for (let i = 0; i < 300; i++) {
        time += 1 / 60;
        m.pos.z += v / 60;
        rig.root.position.set(m.pos.x, 0, m.pos.z);
        rig.update(m, { alpha: 0, dt: 1 / 60, time, content });
        if (i < 60) continue;
        for (const f of rig.feet()) {
          low = Math.min(low, f.p.y);
          const key = `${f.group}${f.side}`;
          if (f.stance < 0 || f.stance > 0.75) {
            start.delete(key);
            continue;
          }
          const s0 = start.get(key);
          if (!s0) {
            start.set(key, f.p.clone());
            contacts++;
            continue;
          }
          slide = Math.max(slide, Math.hypot(f.p.x - s0.x, f.p.z - s0.z));
        }
      }
      return { slide, contacts, low };
    } finally {
      CreatureRig.plantFeetOn = true;
    }
  };

  it('四足・二足が歩く間、支えている足先は 3.5cm より滑らず、地面へ潜らない（留めないと、6〜20cm 滑る）', () => {
    const ids = Object.entries(CREATURE_PLANS).filter(([, p]) => p.frame === 'quad' || p.frame === 'biped').map(([id]) => id);
    expect(ids.length).toBe(10);
    for (const id of ids) {
      const on = walk(id, true), off = walk(id, false);
      expect(on.contacts, id).toBeGreaterThan(8);
      expect(on.slide, `${id}: ${on.slide.toFixed(3)} m`).toBeLessThan(0.035);
      expect(off.slide, `${id}: 留めない時 ${off.slide.toFixed(3)} m`).toBeGreaterThan(on.slide + 0.03);
      expect(on.low, `${id}: いちばん低い足先 ${on.low.toFixed(3)} m`).toBeGreaterThan(-0.015);
    }
  });
});
