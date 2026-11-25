// ガルドロスの骨の表（v0.30.0。ChatGPT のモンスターの解剖 #12 の M1「骨と部位の対応」）。
// - 骨の名前 → 番号の表が、#12 の設計の 79 ノード（いまの 53 + 追加案 26）と合う
// - 骨を 2 段で組む（親が子より後ろの番号でもよい。体の空間の基準の姿勢は変わらない）
// - いまの骨の基準の位置と、全部の技・待機・尾を切られた後の姿勢が、v0.29.0 と同じ（下の記録と比べる）
// 記録を作り直す時（形や動きを、わざと変えた時だけ）: GALDROS_POSE_BAKE=1 npx vitest run tests/galdros-rig.test.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Bone, Quaternion, SkinnedMesh, Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Content } from '../src/data/schemas';
import { newRun } from '../src/game/action';
import { Simulation } from '../src/game/sim';
import { GALDROS_BONES, GALDROS_BONE_INDEX, GALDROS_LEGS, GALDROS_LIDS, GALDROS_PLANNED_NODES, GALDROS_PLATES, GALDROS_TAIL, buildBoneTree, galdrosBone } from '../src/render/galdrosBones';
import { GaldrosRig } from '../src/render/galdrosRig';
import { baseOptions, loadContent } from './helpers';

const root = (p: string): string => resolve(__dirname, '..', p);
const FIXTURE = root('tests/fixtures/galdros_pose_v029.json');
const BAKE = process.env.GALDROS_POSE_BAKE === '1';
/** 位置（m）と向き（四元数）を、この細かさの整数で記録する */
const UNIT = 1e-4;

let content: Content;
beforeAll(async () => {
  content = await loadContent();
});

const bonesOf = (rig: GaldrosRig): Bone[] => (rig as unknown as { bones: Bone[] }).bones;

/** いまの姿勢: 骨ごとに、体の空間の位置 3 つと向き 4 つ（UNIT の整数） */
function record(rig: GaldrosRig): number[] {
  rig.root.updateMatrixWorld(true);
  const p = new Vector3(), q = new Quaternion(), out: number[] = [];
  for (const b of bonesOf(rig)) {
    b.getWorldPosition(p);
    b.getWorldQuaternion(q);
    // 四元数は q と −q が同じ向き。w を 0 以上にそろえる
    const s = q.w < 0 ? -1 : 1;
    for (const v of [p.x, p.y, p.z, q.x * s, q.y * s, q.z * s, q.w * s]) out.push(Math.round(v / UNIT));
  }
  return out;
}

interface Case { id: string; action: string | null; ticks: number[]; severed?: boolean }

/** 技を tick 0 から 1 tick ずつ進め、決めた tick の姿勢を記録する（新しい体で。描画の dt は 1/60 秒） */
function poses(c: Case): number[][] {
  const sim = new Simulation(content, baseOptions({ questId: 'quest.basin.003' }));
  const m = sim.monsters[0]!;
  m.aware = true;
  if (c.severed) {
    const tail = m.def.parts.findIndex((p) => p.id === 'tail');
    m.parts[tail]!.severed = true;
  }
  const rig = new GaldrosRig(m.def.parts.map((p) => p.id));
  const run = c.action ? newRun(content.actions.get(c.action)!, 1, m.yaw) : null;
  m.action = run;
  const out: number[][] = [];
  const last = Math.max(...c.ticks);
  for (let k = 0; k <= last; k++) {
    if (run) {
      run.tick = k;
      run.advanced = false;
    }
    rig.update(m, { alpha: 1, dt: 1 / 60, time: k / 60, content });
    if (c.ticks.includes(k)) out.push(record(rig));
  }
  return out;
}

function cases(): Case[] {
  const moves = [...content.actions.values()].filter((a) => a.actionId.startsWith('monster.galdros.')).sort((a, b) => a.actionId.localeCompare(b.actionId));
  const list: Case[] = [{ id: 'idle', action: null, ticks: [1, 90] }];
  for (const a of moves) {
    const d = a.durationTicks;
    list.push({ id: a.actionId, action: a.actionId, ticks: [Math.floor(d * 0.3), Math.floor(d * 0.55), d - 1] });
  }
  const sweep = moves.find((a) => a.clip === 'galdros_tail_sweep_01');
  if (sweep) list.push({ id: `${sweep.actionId}#severed`, action: sweep.actionId, ticks: [Math.floor(sweep.durationTicks * 0.45)], severed: true });
  return list;
}

describe('ガルドロスの骨の表（#12 の M1）', () => {
  it('53 本。名前が重ならず、名前 → 番号の表で引ける。親は表の中にあり、根は 1 つ', () => {
    expect(GALDROS_BONES.length).toBe(53);
    expect(new Set(GALDROS_BONES.map((b) => b.name)).size).toBe(53);
    GALDROS_BONES.forEach((b, i) => {
      expect(GALDROS_BONE_INDEX[b.name]).toBe(i);
      if (b.parent !== null) expect(GALDROS_BONE_INDEX[b.parent], `${b.name} の親 ${b.parent}`).toBeDefined();
    });
    expect(GALDROS_BONES.filter((b) => b.parent === null).map((b) => b.name)).toEqual(['root']);
    expect(() => galdrosBone('scapula_l')).toThrow(/表に無い/);
    // 尾 8・岩板 15・脚 4 × 4・まぶた 2
    expect(GALDROS_TAIL.map((i) => GALDROS_BONES[i]!.name)).toEqual(['tail_01', 'tail_02', 'tail_03', 'tail_04', 'tail_05', 'tail_06', 'tail_07', 'tail_08']);
    expect(GALDROS_PLATES.length).toBe(15);
    expect(GALDROS_PLATES.every((i) => GALDROS_BONES[i]!.name.startsWith('plate_'))).toBe(true);
    expect(GALDROS_LEGS.length).toBe(4);
    expect(GALDROS_LIDS.map((i) => GALDROS_BONES[i]!.name)).toEqual(['lid_l', 'lid_r']);
  });

  it('#12 の設計の 79 ノードと合う: 「現行 N」の 53 は番号・名前・親が同じ（親が追加案の骨は designParent）、残りの 26 は追加案として控える', () => {
    const bp = JSON.parse(readFileSync(root('docs/source/chatgpt-monster-anatomy-20261125/galdros_rig_blueprint_recovered_v3.json'), 'utf8')) as {
      nodes: { name: string; parent: string | null; pivot_actor_m_printed_precision: [number, number, number]; origin_printed: string }[];
    };
    expect(bp.nodes.length).toBe(79);
    const byName = new Map(bp.nodes.map((n) => [n.name, n]));
    const legacy = bp.nodes.filter((n) => n.origin_printed.startsWith('現行'));
    expect(legacy.length).toBe(53);
    for (const n of legacy) {
      const i = Number(n.origin_printed.replace('現行', '').trim());
      const b = GALDROS_BONES[i]!;
      expect(b.name, `現行 ${i}`).toBe(n.name);
      const par = n.parent === null ? null : byName.get(n.parent)!;
      if (par === null) expect(b.parent).toBeNull();
      else if (par.origin_printed.startsWith('現行')) expect(b.parent, n.name).toBe(par.name);
      else {
        // 親が追加案（例: 上腕の親の肩甲）: いまは、その追加案の親につなぐ
        expect(b.designParent, n.name).toBe(par.name);
        expect(b.parent, n.name).toBe(par.parent);
      }
    }
    const planned = bp.nodes.filter((n) => !n.origin_printed.startsWith('現行')).map((n) => n.name);
    expect([...planned].sort()).toEqual([...GALDROS_PLANNED_NODES].sort());
    expect(GALDROS_PLANNED_NODES.some((n) => n in GALDROS_BONE_INDEX)).toBe(false);
  });

  it('いまの体の骨は表と同じ: 名前・並び・親。基準の位置は設計の表（小数第 3 位）と 0.6mm 以内', () => {
    const rig = new GaldrosRig(['head', 'tail', 'back', 'foreleg', 'hindleg', 'body']);
    const bones = bonesOf(rig);
    expect(bones.map((b) => b.name)).toEqual(GALDROS_BONES.map((b) => b.name));
    bones.forEach((b, i) => {
      const want = GALDROS_BONES[i]!.parent;
      if (want === null) expect(b.parent).toBe(rig.root);
      else expect((b.parent as Bone).name, b.name).toBe(want);
    });
    const bp = JSON.parse(readFileSync(root('docs/source/chatgpt-monster-anatomy-20261125/galdros_rig_blueprint_recovered_v3.json'), 'utf8')) as {
      nodes: { name: string; pivot_actor_m_printed_precision: [number, number, number] }[];
    };
    rig.root.updateMatrixWorld(true);
    const p = new Vector3();
    for (const n of bp.nodes) {
      const i = GALDROS_BONE_INDEX[n.name];
      if (i === undefined) continue;
      bones[i]!.getWorldPosition(p);
      const [x, y, z] = n.pivot_actor_m_printed_precision;
      expect(Math.max(Math.abs(p.x - x), Math.abs(p.y - y), Math.abs(p.z - z)), n.name).toBeLessThan(0.0006);
    }
  });

  it('皮・岩板を曲げる骨（deform）と、動かすだけの骨（control）の区別が、重みと合う', () => {
    const rig = new GaldrosRig(['head', 'tail', 'back', 'foreleg', 'hindleg', 'body']);
    const used = new Set<number>();
    rig.root.traverse((o) => {
      if (!(o instanceof SkinnedMesh)) return;
      const idx = o.geometry.getAttribute('skinIndex'), w = o.geometry.getAttribute('skinWeight');
      for (let v = 0; v < idx.count; v++) for (let k = 0; k < 4; k++) if (w.getComponent(v, k) > 1e-6) used.add(idx.getComponent(v, k));
    });
    GALDROS_BONES.forEach((b, i) => expect(b.kind, `${b.name}`).toBe(used.has(i) ? 'deform' : 'control'));
  });

  it('骨を 2 段で組む: 親が子より後ろの番号でも組め、体の空間の基準の位置と向きが保たれる。親の無い番号・自分が親・輪は誤り', () => {
    const q = (x: number, y: number, z: number): Quaternion => new Quaternion().setFromAxisAngle(new Vector3(x, y, z).normalize(), 0.7);
    // 0 の親が 2（後ろ）、2 の親が 1、1 は根。向きのある骨もある
    const rests = [
      { name: 'c', parent: 2, pos: new Vector3(1, 2, 3), quat: q(0, 1, 0) },
      { name: 'r', parent: -1, pos: new Vector3(0, 1, 0) },
      { name: 'p', parent: 1, pos: new Vector3(0.5, 1.5, 0.2), quat: q(1, 0, 1) },
      { name: 'd', parent: 2, pos: new Vector3(-1, 0.4, 2) },
    ];
    const bones = buildBoneTree(rests);
    bones[1]!.updateMatrixWorld(true);
    const p = new Vector3(), w = new Quaternion();
    rests.forEach((r, i) => {
      bones[i]!.getWorldPosition(p);
      bones[i]!.getWorldQuaternion(w);
      expect(p.distanceTo(r.pos), r.name).toBeLessThan(1e-9);
      expect(Math.abs(w.dot(r.quat ?? new Quaternion())), r.name).toBeCloseTo(1, 9);
      expect(bones[i]!.name).toBe(r.name);
    });
    expect(bones[0]!.parent).toBe(bones[2]);
    expect(() => buildBoneTree([{ name: 'a', parent: 3, pos: new Vector3() }])).toThrow(/親/);
    expect(() => buildBoneTree([{ name: 'a', parent: 0, pos: new Vector3() }])).toThrow(/自分/);
    expect(() => buildBoneTree([{ name: 'a', parent: 1, pos: new Vector3() }, { name: 'b', parent: 0, pos: new Vector3() }])).toThrow(/輪/);
  });

  it('ガルドロスの骨の参照に、番号の足し算・番号の直書きが残っていない（どの参照も名前 → 番号の表を通る）', () => {
    const src = readFileSync(root('src/render/galdrosRig.ts'), 'utf8');
    expect(src).not.toMatch(/\b(LEG|PLATE|TAIL|LID)\s*\+/);
    expect(src).not.toMatch(/\bb\s*\+\s*[123]\b/);
    expect(src).not.toMatch(/const\s+ROOT\s*=\s*0/);
  });
});

describe('ガルドロスの姿勢が v0.29.0 と同じ（#12 の M1: 骨の名前と組み方を変えても、基準の姿勢・全部の技・尾 8・岩板 15 を保つ）', () => {
  it(`待機・全部の技（3 つの時刻）・尾を切られた後の尾払いで、53 本の位置と向きが ${UNIT} 以内で同じ`, () => {
    const now: Record<string, number[][]> = {};
    for (const c of cases()) now[c.id] = poses(c);
    const rig = new GaldrosRig(['head', 'tail', 'back', 'foreleg', 'hindleg', 'body']);
    const rest = record(rig);
    if (BAKE) {
      writeFileSync(FIXTURE, JSON.stringify({ note: 'tests/galdros-rig.test.ts の記録（v0.29.0 のガルドロスの骨 53 本の、体の空間の位置 xyz と向き xyzw。1e-4 の整数）。GALDROS_POSE_BAKE=1 で作り直す', unit: UNIT, rest, poses: now }) + '\n');
      return;
    }
    expect(existsSync(FIXTURE), '記録が無い（GALDROS_POSE_BAKE=1 で作る）').toBe(true);
    const old = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { rest: number[]; poses: Record<string, number[][]> };
    const worst = (a: number[], b: number[]): { d: number; at: number } => {
      let d = 0, at = -1;
      a.forEach((v, i) => {
        const e = Math.abs(v - (b[i] ?? Number.NaN));
        if (!(e <= d)) { d = e; at = i; }
      });
      return { d, at };
    };
    const where = (at: number): string => `${GALDROS_BONES[Math.floor(at / 7)]?.name ?? '?'} の ${['x', 'y', 'z', 'qx', 'qy', 'qz', 'qw'][at % 7]}`;
    const r = worst(rest, old.rest);
    expect(rest.length).toBe(53 * 7);
    expect(r.d, `基準の姿勢: ${where(r.at)}`).toBeLessThanOrEqual(1);
    expect(Object.keys(now).sort()).toEqual(Object.keys(old.poses).sort());
    // 技の数（v0.29.0 で 23）
    expect(Object.keys(now).filter((k) => k.startsWith('monster.galdros.') && !k.includes('#')).length).toBeGreaterThanOrEqual(23);
    for (const [id, list] of Object.entries(now)) {
      list.forEach((pose, j) => {
        const w = worst(pose, old.poses[id]![j]!);
        expect(w.d, `${id} の ${j} 番目の時刻: ${where(w.at)}`).toBeLessThanOrEqual(1);
      });
    }
  }, 120000);
});
