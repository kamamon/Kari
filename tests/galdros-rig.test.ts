// ガルドロスの骨の表（v0.30.0。ChatGPT のモンスターの解剖 #12 の M1「骨と部位の対応」。v0.36.0 で M2 の 26 本を足した）。
// - 骨の名前 → 番号の表が、#12 の設計の 79 ノード（v0.29.0 までの 53 + M2 の 26）と合う
// - 骨を 2 段で組む（親が子より後ろの番号でもよい。体の空間の基準の姿勢は変わらない）
// - v0.29.0 までの 53 本の基準の位置と、全部の技・待機・尾を切られた後の姿勢が、v0.29.0 と同じ（下の記録と比べる。足した 26 本は比べない）
// 記録を作り直す時（形や動きを、わざと変えた時だけ）: GALDROS_POSE_BAKE=1 npx vitest run tests/galdros-rig.test.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Bone, Quaternion, SkinnedMesh, Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Content } from '../src/data/schemas';
import { newRun } from '../src/game/action';
import { createMonster } from '../src/game/monster';
import { Simulation } from '../src/game/sim';
import { GALDROS_BONES, GALDROS_BONE_INDEX, GALDROS_LEGACY_BONES, GALDROS_LEGS, GALDROS_LIDS, GALDROS_PLATES, GALDROS_TAIL, buildBoneTree, galdrosBone } from '../src/render/galdrosBones';
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

/** いまの姿勢: v0.29.0 までの 53 本の骨ごとに、体の空間の位置 3 つと向き 4 つ（UNIT の整数） */
function record(rig: GaldrosRig): number[] {
  rig.root.updateMatrixWorld(true);
  const p = new Vector3(), q = new Quaternion(), out: number[] = [];
  for (const b of bonesOf(rig).slice(0, GALDROS_LEGACY_BONES)) {
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
  it('79 本（v0.29.0 までの 53 + M2 の 26）。名前が重ならず、名前 → 番号の表で引ける。親は表の中にあり、根は 1 つ', () => {
    expect(GALDROS_BONES.length).toBe(79);
    expect(GALDROS_LEGACY_BONES).toBe(53);
    expect(new Set(GALDROS_BONES.map((b) => b.name)).size).toBe(79);
    GALDROS_BONES.forEach((b, i) => {
      expect(GALDROS_BONE_INDEX[b.name]).toBe(i);
      if (b.parent !== null) expect(GALDROS_BONE_INDEX[b.parent], `${b.name} の親 ${b.parent}`).toBeDefined();
    });
    expect(GALDROS_BONES.filter((b) => b.parent === null).map((b) => b.name)).toEqual(['root']);
    expect(() => galdrosBone('wing_l')).toThrow(/表に無い/);
    // 尾 8・岩板 15・脚 4 × 4・まぶた 2
    expect(GALDROS_TAIL.map((i) => GALDROS_BONES[i]!.name)).toEqual(['tail_01', 'tail_02', 'tail_03', 'tail_04', 'tail_05', 'tail_06', 'tail_07', 'tail_08']);
    expect(GALDROS_PLATES.length).toBe(15);
    expect(GALDROS_PLATES.every((i) => GALDROS_BONES[i]!.name.startsWith('plate_'))).toBe(true);
    expect(GALDROS_LEGS.length).toBe(4);
    expect(GALDROS_LIDS.map((i) => GALDROS_BONES[i]!.name)).toEqual(['lid_l', 'lid_r']);
  });

  it('#12 の設計の 79 ノードと合う: 「現行 N」の 53 は番号・名前・親が同じ（上腕だけは、設計の親の肩甲を designParent に控え、胸に付く）。追加案の 26 は 53 番から設計の並びで、親も設計と同じ', () => {
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
        // 親が追加案（上腕の親の肩甲）: 肩甲は枝の骨にして、上腕はその親（胸）につなぐ（D-118。上腕の付け根を判定の軌道データの肩に合わせたまま）
        expect(b.designParent, n.name).toBe(par.name);
        expect(b.parent, n.name).toBe(par.parent);
      }
    }
    expect(GALDROS_BONES.filter((b) => b.designParent).map((b) => b.name).sort()).toEqual(['fore_upper_l', 'fore_upper_r']);
    const added = bp.nodes.filter((n) => !n.origin_printed.startsWith('現行'));
    expect(added.length).toBe(26);
    added.forEach((n, j) => {
      const b = GALDROS_BONES[GALDROS_LEGACY_BONES + j]!;
      expect(b.name, `${GALDROS_LEGACY_BONES + j} 番`).toBe(n.name);
      expect(b.parent, n.name).toBe(n.parent);
      expect(b.designParent, n.name).toBeUndefined();
    });
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
    // 記録にある動き（v0.29.0 までの技・待機・尾を切った後）は全部あること。記録の後に足した技（v0.41.0 の向き直り）は、記録と比べない
    expect(Object.keys(old.poses).filter((k) => !(k in now))).toEqual([]);
    // 技の数（v0.29.0 で 23）
    expect(Object.keys(now).filter((k) => k.startsWith('monster.galdros.') && !k.includes('#')).length).toBeGreaterThanOrEqual(23);
    for (const [id, list] of Object.entries(now)) {
      if (!(id in old.poses)) continue;
      list.forEach((pose, j) => {
        const w = worst(pose, old.poses[id]![j]!);
        expect(w.d, `${id} の ${j} 番目の時刻: ${where(w.at)}`).toBeLessThanOrEqual(1);
      });
    }
  }, 120000);
});

describe('ガルドロスの骨の続き（v0.36.0。#12 の M2: 肩甲・胸郭の左右・舌の先・眼・ねじれ・趾、ひじ・ひざの補正形状）', () => {
  /** 検査用に、描画の中の骨と脚の状態を見る */
  type Inner = { bones: Bone[]; legs: { t: number; twist: Bone; digits: Bone[]; foot: Bone }[] };
  type Rig = GaldrosRig & { readonly in: Inner };
  const fresh = (): { rig: Rig; m: ReturnType<typeof createMonster> } => {
    const def = content.monsters.get('monster.galdros')!;
    const m = createMonster(def, { x: 0, z: 0, yaw: 0 }, 'm2');
    m.aware = true;
    const rig = new GaldrosRig(def.parts.map((p) => p.id));
    return { rig: Object.assign(rig, { in: rig as unknown as Inner }), m };
  };
  const hideOf = (rig: GaldrosRig): SkinnedMesh => rig.root.children.find((o) => o.name === 'hide') as SkinnedMesh;
  const B = (n: string): number => galdrosBone(n);
  const weightsOf = (mesh: SkinnedMesh, v: number): Map<number, number> => {
    const idx = mesh.geometry.getAttribute('skinIndex'), w = mesh.geometry.getAttribute('skinWeight');
    const out = new Map<number, number>();
    for (let k = 0; k < 4; k++) if (w.getComponent(v, k) > 0) out.set(idx.getComponent(v, k), (out.get(idx.getComponent(v, k)) ?? 0) + w.getComponent(v, k));
    return out;
  };

  it('重み: どの頂点も合計 1・4 本まで。胸郭は x で左右に分かれ（腹の真ん中だけ混ぜる）、舌の先・眼・爪・足の先・下の節の先が、足した骨に付く', () => {
    const { rig } = fresh();
    const used = new Map<number, number>();
    rig.root.traverse((o) => {
      if (!(o instanceof SkinnedMesh)) return;
      const pos = o.geometry.getAttribute('position'), w = o.geometry.getAttribute('skinWeight');
      for (let v = 0; v < pos.count; v++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) sum += w.getComponent(v, k);
        expect(Math.abs(sum - 1), `${o.name} の頂点 ${v}`).toBeLessThan(1e-5);
        const ws = weightsOf(o, v);
        for (const [b, x] of ws) used.set(b, (used.get(b) ?? 0) + x);
        if (o.name !== 'hide') continue;
        const x = pos.getX(v);
        if (x > 0.12) expect(ws.has(B('ribs_r')), `左の頂点 ${v} に右の胸郭`).toBe(false);
        if (x < -0.12) expect(ws.has(B('ribs_l')), `右の頂点 ${v} に左の胸郭`).toBe(false);
      }
    });
    // 足した 26 本は、どれも皮か爪を曲げる（重みの合計が、頂点 3 つ分より多い）
    for (const b of GALDROS_BONES.slice(GALDROS_LEGACY_BONES)) expect(used.get(B(b.name)) ?? 0, b.name).toBeGreaterThan(3);
    // 前脚の 4 趾は、それぞれ爪 1 本分（同じくらいの重み）。後脚の中の群は、爪 2 本分で、内・外の群より重い
    const fl = [1, 2, 3, 4].map((n) => used.get(B(`digit_0${n}_l`))!);
    expect(Math.max(...fl) / Math.min(...fl)).toBeLessThan(1.6);
    expect(used.get(B('toes_middle_l'))!).toBeGreaterThan(used.get(B('toes_inner_l'))!);
  });

  it('ひじ・ひざ: 全部の技・眠る・転倒・気絶・死の中で最も曲げた時も、関節の輪の断面が基準の 9 割以上（補正形状が無いと 8 割より細る）', () => {
    const { rig: probe } = fresh();
    const hide = hideOf(probe);
    const ringOf = (li: number): number[] => {
      const L = GALDROS_LEGS[li]!;
      const out: number[] = [];
      for (let v = 0; v < hide.geometry.getAttribute('position').count; v++) {
        const w = weightsOf(hide, v);
        if (Math.abs((w.get(L.upper) ?? 0) - 0.5) < 1e-4 && Math.abs((w.get(L.lower) ?? 0) - 0.5) < 1e-4) out.push(v);
      }
      return out.slice(0, 14);
    };
    const rings = [0, 1, 2, 3].map(ringOf);
    rings.forEach((r) => expect(r.length).toBe(14));
    const area = (rig: Rig, li: number): { bend: number; area: number } => {
      rig.root.updateMatrixWorld(true);
      const L = GALDROS_LEGS[li]!;
      const h = rig.in.bones[L.upper]!.getWorldPosition(new Vector3()), j = rig.in.bones[L.lower]!.getWorldPosition(new Vector3()), a = rig.in.bones[L.foot]!.getWorldPosition(new Vector3());
      const du = j.clone().sub(h).normalize(), dl = a.clone().sub(j).normalize();
      const n = du.clone().add(dl).normalize();
      const mesh = hideOf(rig);
      const pts = rings[li]!.map((v) => mesh.getVertexPosition(v, new Vector3()));
      const c = pts.reduce((s, p) => s.add(p), new Vector3()).multiplyScalar(1 / pts.length);
      const ex = new Vector3(1, 0, 0).addScaledVector(n, -n.x).normalize(), ey = n.clone().cross(ex);
      let s2 = 0;
      pts.forEach((p, k) => {
        const q = pts[(k + 1) % pts.length]!;
        s2 += p.clone().sub(c).dot(ex) * q.clone().sub(c).dot(ey) - q.clone().sub(c).dot(ex) * p.clone().sub(c).dot(ey);
      });
      return { bend: Math.acos(Math.min(1, du.dot(dl))), area: Math.abs(s2) / 2 };
    };
    const rest = [0, 1, 2, 3].map((li) => {
      const { rig, m } = fresh();
      rig.update(m, { alpha: 1, dt: 1 / 60, time: 0, content });
      return area(rig, li);
    });
    const worst = [0, 1, 2, 3].map(() => ({ bend: 0, ratio: 1, raw: 1, what: '' }));
    const scan = (what: string, setup: (m: ReturnType<typeof createMonster>, k: number) => void, n: number): void => {
      const { rig, m } = fresh();
      for (let k = 0; k < n; k++) {
        setup(m, k);
        rig.update(m, { alpha: 1, dt: 1 / 60, time: k / 60, content });
        for (let li = 0; li < 4; li++) {
          const r = area(rig, li);
          if (r.bend <= worst[li]!.bend) continue;
          // 補正形状を外した時の断面（比べるため）
          const infl = hideOf(rig).morphTargetInfluences!;
          const keep = infl[li]!;
          infl[li] = 0;
          const raw = area(rig, li).area;
          infl[li] = keep;
          worst[li] = { bend: r.bend, ratio: r.area / rest[li]!.area, raw: raw / rest[li]!.area, what };
        }
      }
    };
    for (const a of content.actions.values()) {
      if (!a.actionId.startsWith('monster.galdros.')) continue;
      const run = newRun(a, 1, 0);
      scan(a.actionId, (m, k) => {
        run.tick = k;
        run.advanced = false;
        m.action = run;
      }, a.durationTicks);
    }
    scan('sleep', (m) => (m.asleep = true), 200);
    scan('topple', (m, k) => {
      m.staggerKind = 'topple';
      m.staggerTotal = 190;
      m.staggerTicks = 190 - k;
    }, 189);
    scan('stun', (m) => (m.ailments.ticks.stun = 100), 120);
    scan('dead', (m, k) => {
      m.dead = true;
      m.deadTicks = k;
    }, 200);
    for (const [li, w] of worst.entries()) {
      // 基準の姿勢より 50° 以上深く曲げる姿勢があり、その時も断面が 9 割以上
      expect(w.bend - rest[li]!.bend, `脚 ${li}`).toBeGreaterThan(0.87);
      expect(w.ratio, `脚 ${li} の ${w.what}（${Math.round((w.bend * 180) / Math.PI)}°）`).toBeGreaterThan(0.9);
      expect(w.raw, `脚 ${li}: 補正形状が無い時は細る`).toBeLessThan(w.ratio - 0.05);
    }
    expect(Math.min(...worst.map((w) => w.raw)), '補正形状が無いと、最も曲げる脚は 8 割まで細る').toBeLessThan(0.8);
  }, 120000);

  it('眼はまぶたと別に動く: 狩人の位置を渡すと眼が向き、まぶた（まばたき）は渡さない時と同じ。眼の回る量は 0.32 まで', () => {
    const a = fresh(), b = fresh();
    const target = new Vector3(3, 0, 5);
    for (let k = 0; k < 90; k++) {
      a.rig.update(a.m, { alpha: 1, dt: 1 / 60, time: k / 60, content, lookAt: target });
      b.rig.update(b.m, { alpha: 1, dt: 1 / 60, time: k / 60, content });
      for (const lid of GALDROS_LIDS) expect(a.rig.in.bones[lid]!.quaternion.angleTo(b.rig.in.bones[lid]!.quaternion)).toBeLessThan(1e-6);
    }
    const eyeL = a.rig.in.bones[B('eye_l')]!, eyeR = a.rig.in.bones[B('eye_r')]!;
    const angle = (q: Quaternion): number => 2 * Math.acos(Math.min(1, Math.abs(q.w)));
    expect(angle(eyeL.quaternion)).toBeGreaterThan(0.03);
    for (const e of [eyeL, eyeR]) expect(angle(e.quaternion)).toBeLessThanOrEqual(0.32 + 1e-6);
    // 左の眼（+X 側を向く）は、左前の狩人の方へ回る: 眼の前の向きが、狩人への向きに近づく
    a.rig.root.updateMatrixWorld(true);
    const headQ = a.rig.in.bones[B('head')]!.getWorldQuaternion(new Quaternion());
    const eyePos = eyeL.getWorldPosition(new Vector3());
    const toT = new Vector3(target.x, target.y + 1.1, target.z).sub(eyePos).normalize();
    const out = new Vector3(0.62, 0.12, 0.78).normalize();
    const restDir = out.clone().applyQuaternion(headQ);
    const nowDir = out.clone().applyQuaternion(eyeL.getWorldQuaternion(new Quaternion()));
    expect(nowDir.angleTo(toT)).toBeLessThan(restDir.angleTo(toT) - 0.02);
  });

  it('舌の先・胸郭・肩甲: 舌を出す技で先が反る。転倒中は上になった左の胸郭が大きく息をする。前脚を打ち付ける技で肩甲が傾いて滑る', () => {
    let curl = 0, scap = 0, slide = 0;
    for (const id of ['monster.galdros.roar', 'monster.galdros.slam_l']) {
      const { rig, m } = fresh();
      const run = newRun(content.actions.get(id)!, 1, 0);
      const rest = rig.in.bones[B('scapula_l')]!.position.clone();
      for (let k = 0; k < run.def.durationTicks; k++) {
        run.tick = k;
        run.advanced = false;
        m.action = run;
        rig.update(m, { alpha: 1, dt: 1 / 60, time: k / 60, content });
        curl = Math.min(curl, rig.in.bones[B('tongue_02')]!.rotation.x);
        scap = Math.max(scap, Math.abs(rig.in.bones[B('scapula_l')]!.rotation.x));
        slide = Math.max(slide, rig.in.bones[B('scapula_l')]!.position.distanceTo(rest));
      }
    }
    expect(curl).toBeLessThan(-0.1);
    expect(scap).toBeGreaterThan(0.08);
    expect(slide).toBeGreaterThan(0.02);
    const { rig, m } = fresh();
    let more = 0;
    for (let k = 0; k < 150; k++) {
      m.staggerKind = 'topple';
      m.staggerTotal = 190;
      m.staggerTicks = 190 - k;
      rig.update(m, { alpha: 1, dt: 1 / 60, time: k / 60, content });
      const l = rig.in.bones[B('ribs_l')]!.scale.x - 1, r = rig.in.bones[B('ribs_r')]!.scale.x - 1;
      if (k > 60 && Math.abs(l) > 0.01) more = Math.max(more, Math.abs(l) / Math.max(1e-6, Math.abs(r)));
    }
    expect(more).toBeGreaterThan(2);
  });

  it('趾と足の向き: 歩くと、踏み出している足の趾は曲がり、接地している足の趾はまっすぐ。その場で向きを変えても、接地した足は踏み直すまで向きを保ち、ねじれの骨が回る', () => {
    const { rig, m } = fresh();
    let swingCurl = 0, stanceCurl = 0, pinned = 0, twisted = 0;
    const yawOf = (b: Bone): number => {
      const f = new Vector3(0, 0, 1).applyQuaternion(b.getWorldQuaternion(new Quaternion()));
      return Math.atan2(f.x, f.z);
    };
    const before = rig.in.legs.map(() => 0);
    for (let k = 0; k < 240; k++) {
      // 前半は前へ歩き、後半はその場で右へ回る
      if (k < 120) rig.root.position.z += 2.2 / 60;
      else rig.root.rotation.y += 0.9 / 60;
      rig.update(m, { alpha: 1, dt: 1 / 60, time: k / 60, content });
      rig.root.updateMatrixWorld(true);
      rig.in.legs.forEach((l, i) => {
        const c = Math.max(...l.digits.map((d) => d.rotation.x));
        if (l.t < 1 && l.t > 0.3 && l.t < 0.7) swingCurl = Math.max(swingCurl, c);
        if (l.t >= 1 && k < 120) stanceCurl = Math.max(stanceCurl, Math.abs(c));
        const y = yawOf(l.foot);
        if (k > 120 && l.t >= 1 && before[i]! !== 0) pinned = Math.max(pinned, Math.abs(y - before[i]!) < 1e-6 ? 1 : 0);
        before[i] = l.t >= 1 ? y : 0;
        twisted = Math.max(twisted, 2 * Math.acos(Math.min(1, Math.abs(l.twist.quaternion.w))));
      });
    }
    expect(swingCurl).toBeGreaterThan(0.15);
    expect(stanceCurl).toBeLessThan(0.08);
    expect(pinned).toBe(1);
    expect(twisted).toBeGreaterThan(0.03);
  });
});
