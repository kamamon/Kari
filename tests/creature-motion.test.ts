// 大型 11 種と幼体 8 種の動き（v0.21.0。docs/decisions.md D-087・D-088）:
//   - どの技も、種ごとに固有の鍵の姿勢を持つ（ほかの種と同じ動きを使い回さない）。始まりと終わりは、ふだんの姿勢へつながる。
//   - 体の部位に付けた判定（設計図の bind）は、動きの中の部位の位置と、技データの軌道が一致する。
//     CREATURE_BAKE=1 で走らせると（npm run monsters:bake）、検査の代わりに、動きから軌道を作って public/data/tracks/ へ書く。
//   - 技以外の動き（構え・眠る・倒れる・しぐさ）も、種ごとに持つ。
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import type { ActionDef, Content, ShapeTrackDef } from '../src/data/schemas';
import { newRun } from '../src/game/action';
import { sampleCurve, trackSegment } from '../src/game/tracks';
import { createMonster } from '../src/game/monster';
import { CREATURE_PLANS } from '../src/render/creaturePlans';
import { sampleMove, type Pose } from '../src/render/creatureMoves';
import { CreatureRig } from '../src/render/creatureRig';
import type { BindPlan } from '../src/render/creaturePlan';
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
      // 同じ種の中では、左右の組（_l_ / _r_）だけ
      const bases = new Set(list.map((x) => x.split(':')[1]!.replace(/_01$/, '').replace(/_(l|r)$/, '')));
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
