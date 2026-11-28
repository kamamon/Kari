// 後隙の反撃（v0.73.0。#19 の M02 の「空振り後の反撃部位」。docs/spec.md の 32.39。D-171）:
//   大型の攻撃の技は、後隙の中に「狙える部位が低い所で止まる区間」（技データの opening）を持つ。
//   - 区間は後隙の中で、最後の判定が終わった後。20 tick 以上（大技 = その種のいちばん強い一撃の 9 割以上の技は 30 tick 以上）
//   - 区間の間、その部位の下の端は 1.6m 以下（どの武器の基本の斬り・突きも届く高さ）で、形の端は 1 tick に 2cm より動かない
//   - 技が選ばれる位置から前転 1 回で届く、当たらない所へ避けた狩人が、区間が終わる前に、その部位へ斬りを当てられる
//     （護刃の主の斬り。大技は、断岳剣の縦斬りも）
//   v0.75.0（利用者の指示。D-175）で、生成の体の 19 種を外した。ここで確かめるのは、動きを変えずに、いまの動きで決まりを満たす区間だけを書いた
//   2 種（ガルドロスとスパインゲイル）。フロストアルドの区間は届いたまま（決まりを満たさない技がある）で、ここに入れていない（docs/monster-openings.md）。
//   これから足される種を入れる時は、KEPT に足す（技の全部に区間が要る種は、技の数と、隙を作らない技の理由もここに書く）。
import { beforeAll, describe, expect, it } from 'vitest';
import type { ActionDef, Content, MonsterDef } from '../src/data/schemas';
import { newRun } from '../src/game/action';
import { Simulation } from '../src/game/sim';
import { trackSegment } from '../src/game/tracks';
import { firstCounter, partTrace, type HunterKind } from './openingLab';
import { baseOptions, frame, loadContent } from './helpers';

let content: Content;
beforeAll(async () => {
  content = await loadContent();
});

/** 区間の長さ（tick） */
const OPEN_MIN = 20, OPEN_HEAVY_MIN = 30;
/** 部位の下の端の高さの上限（m）と、形の端が 1 tick に動いてよい距離（m） */
const LOW_Y = 1.6, STILL = 0.02;

/** 動きを変えずに、いまの動きで決まりを満たす区間だけを書いた種（専用の体のガルドロスと、GLB のスパインゲイル） */
const KEPT = ['monster.galdros', 'monster.spinegale'];
/** 決まりを確かめる種の全部 */
const all = (): MonsterDef[] => KEPT.map((id) => content.monsters.get(id)!);
const attacksOf = (m: MonsterDef): ActionDef[] => [...content.actions.values()].filter((a) => a.actionId.startsWith(`${m.id}.`) && (a.hitWindows.length > 0 || (a.hazards?.length ?? 0) > 0));
const damageOf = (a: ActionDef): number => Math.max(0, ...a.hitWindows.map((h) => h.baseDamage ?? 0), ...(a.hazards ?? []).map((h) => h.baseDamage ?? 0));
const isHeavy = (m: MonsterDef, a: ActionDef): boolean => damageOf(a) >= 0.9 * Math.max(...attacksOf(m).map(damageOf));

/** 位置・避けた所・間合い・斬り方のどれかで、区間が終わる前に当てられるか（tests/openingLab.ts の firstCounter） */
const best = (m: MonsterDef, a: ActionDef, hunter: HunterKind): ReturnType<typeof firstCounter> => firstCounter(content, m.id, a.actionId, a.opening!.partId, a.opening!.to, hunter);

describe('後隙の反撃（v0.73.0。D-171）', () => {
  it('ガルドロス（専用の体。動きは変えていない）: いまの動きで決まりを満たす区間を 18 の技に書いてある。横への体当たり 2 つは無い', () => {
    const g = content.monsters.get('monster.galdros')!;
    const atk = attacksOf(g);
    expect(atk.length).toBe(20);
    expect(atk.filter((a) => !a.opening).map((a) => a.actionId).sort()).toEqual(['monster.galdros.side_bash_l', 'monster.galdros.side_bash_r']);
    // 尾を切った後に替わる技も、元の技と同じ区間
    for (const [a, b] of [['tail_sweep', 'tail_sweep_short'], ['tail_slam', 'tail_slam_short'], ['tail_sweep_rev', 'tail_sweep_rev_short']]) {
      expect(content.actions.get(`monster.galdros.${b}`)!.opening).toEqual(content.actions.get(`monster.galdros.${a}`)!.opening);
    }
  });

  it('スパインゲイル（ChatGPT の #50。体と動きは GLB。動きは変えていない）: いまの動きで決まりを満たす区間を 12 の技に書いてある。突進は無い', () => {
    const sg = content.monsters.get('monster.spinegale')!;
    const atk = attacksOf(sg);
    expect(atk.length).toBe(13);
    // 突進: 走り抜けた後、止まるまで 0.55m 滑り、止まってからは 12 tick しか無い（この種の大きな隙は、走った後の息切れ）
    expect(atk.filter((a) => !a.opening).map((a) => a.actionId)).toEqual(['monster.spinegale.dash']);
    const dash = content.actions.get('monster.spinegale.dash')!;
    const keys = content.curves.get(dash.rootMotion.curveId!)!.keys;
    const stop = keys.findIndex(([, v]) => v === keys[keys.length - 1]![1]);
    expect(dash.durationTicks - keys[stop]![0]).toBeLessThan(OPEN_MIN);
    // 尾を切った後に替わる技も、元の技と同じ区間
    for (const side of ['l', 'r']) expect(content.actions.get(`monster.spinegale.tail_sweep_${side}_short`)!.opening).toEqual(content.actions.get(`monster.spinegale.tail_sweep_${side}`)!.opening);
    // 狙える部位は 3 種類。斬りがいちばん通る喉袋が狙える技が 3 つ以上（頭の冠棘は、3 連の突進の後だけ）
    const opens = atk.map((a) => a.opening).filter((o): o is NonNullable<ActionDef['opening']> => !!o);
    expect(new Set(opens.map((o) => o.partId))).toEqual(new Set(['dewlap', 'legs', 'head']));
    const cut = (id: string): number => sg.parts.find((p) => p.id === id)!.hitzone.cut;
    expect(Math.max(...sg.parts.map((p) => p.hitzone.cut))).toBe(cut('dewlap'));
    expect(opens.filter((o) => o.partId === 'dewlap').length).toBeGreaterThanOrEqual(3);
    // 息切れ（専用の疲労。8〜10 秒止まる）は、技の隙とは別にある
    for (const id of ['fatigue_full', 'fatigue_r2', 'fatigue_r3']) expect(content.actions.get(`monster.spinegale.${id}`)!.durationTicks).toBeGreaterThanOrEqual(480);
  });

  it('区間の端は、部位の追従の表の刻み（6 tick）の上。後隙の中で、最後の判定の後。区間の後に、構えへ戻る間が 2 tick 以上ある', () => {
    for (const m of all()) {
      const step = m.follow!.step;
      expect(step).toBe(6);
      for (const a of attacksOf(m)) {
        const o = a.opening;
        if (!o) continue;
        const rec = a.phases.find((p) => p.id === 'recovery')!;
        expect(o.from % step, a.actionId).toBe(0);
        expect(o.to % step, a.actionId).toBe(0);
        expect(o.from, a.actionId).toBeGreaterThanOrEqual(rec.from);
        expect(o.from, a.actionId).toBeGreaterThanOrEqual(Math.max(0, ...a.hitWindows.map((h) => h.to)));
        expect(a.durationTicks - o.to, a.actionId).toBeGreaterThanOrEqual(2);
        expect(m.parts.some((p) => p.id === o.partId), a.actionId).toBe(true);
      }
    }
  });

  it('区間は 20 tick 以上（大技は 30 tick 以上）。その間、部位の下の端は 1.6m 以下で、ほとんど動かない。技の移動も終わっている', () => {
    const bad: string[] = [];
    for (const m of all()) {
      for (const a of attacksOf(m)) {
        const o = a.opening;
        if (!o) continue;
        const len = o.to - o.from;
        const need = isHeavy(m, a) ? OPEN_HEAVY_MIN : OPEN_MIN;
        if (len < need) bad.push(`${a.actionId}: 区間 ${len} tick（${need} 以上）`);
        const tr = partTrace(content, m.id, a.actionId, o.partId, o.from, o.to);
        if (tr.low > LOW_Y) bad.push(`${a.actionId}: ${o.partId} の下の端 ${tr.low.toFixed(2)} m（${LOW_Y} 以下）`);
        if (tr.maxStep > STILL) bad.push(`${a.actionId}: ${o.partId} が 1 tick に ${(tr.maxStep * 100).toFixed(1)} cm 動く（${STILL * 100} まで）`);
        // 技の移動（移動曲線）は、区間の前に終わっている
        const cid = a.rootMotion.curveId;
        if (cid) {
          const keys = content.curves.get(cid)!.keys;
          const at = (t: number): number => {
            let v = 0;
            for (let i = 0; i < keys.length; i++) {
              const [kt, kv] = keys[i]!;
              if (t >= kt) v = kv;
              else {
                const [pt, pv] = keys[i - 1] ?? [0, 0];
                v = pv + ((kv - pv) * (t - pt)) / Math.max(1e-9, kt - pt);
                break;
              }
            }
            return v;
          };
          if (Math.abs(at(o.to) - at(o.from)) > 0.05) bad.push(`${a.actionId}: 区間の間に ${Math.abs(at(o.to) - at(o.from)).toFixed(2)} m 進む`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('技を避けた狩人が、区間が終わる前に、その部位へ斬りを当てられる（護刃。大技は断岳剣も）', { timeout: 300000 }, () => {
    const bad: string[] = [];
    const report: string[] = [];
    for (const m of all()) {
      for (const a of attacksOf(m)) {
        const o = a.opening;
        if (!o) continue;
        const q = best(m, a, 'quick');
        if (q.r.hitTick === null) bad.push(`${a.actionId}: 護刃が ${o.partId} に当てられない（${q.r.spot ? `避けた所から ${q.r.dist.toFixed(1)} m。はじめに当たったのは ${q.r.firstPart ?? '無し'}` : '避ける所が無い'}）`);
        let h: ReturnType<typeof best> | null = null;
        if (isHeavy(m, a)) {
          h = best(m, a, 'heavy');
          if (h.r.hitTick === null) bad.push(`${a.actionId}: 断岳剣が ${o.partId} に当てられない（大技。${h.r.spot ? `避けた所から ${h.r.dist.toFixed(1)} m` : '避ける所が無い'}）`);
        }
        const tr = partTrace(content, m.id, a.actionId, o.partId, o.from, o.to);
        report.push(`${a.actionId} ${o.partId} ${o.from}-${o.to} 下の端 ${tr.low.toFixed(2)}m 動き ${(tr.maxStep * 100).toFixed(1)}cm 護刃@${q.r.hitTick}(${q.kind},#${q.rank},${q.reach},${q.btn})${h ? ` 断岳剣@${h.r.hitTick}(${h.kind},#${h.rank},${h.reach},${h.btn})` : ''}`);
      }
    }
    // OPENING_REPORT=1 で、技ごとの測った値（部位・区間・下の端・動き・当たった tick と、位置・避けた所の番号・間合い・斬り方）を出す（技を足す時の確かめ用）
    if (process.env.OPENING_REPORT) console.log(report.join('\n'));
    expect(bad).toEqual([]);
  });

  it('高さの決まり（1.6m）の根拠: 近接の 6 系統のどれにも、判定の上の端が 1.7m 以上に届く、主か副の攻撃がある', () => {
    const melee = [...content.families.values()].filter((f) => f.id !== 'ring_bow');
    expect(melee.length).toBe(6);
    for (const f of melee) {
      let top = -Infinity;
      for (const aid of [f.actions.main, f.actions.sub]) {
        for (const hw of content.actions.get(aid)!.hitWindows) {
          const tr = content.tracks.get(hw.shapeTrack)!;
          for (let t = hw.from; t <= hw.to; t++) {
            const seg = trackSegment(tr, t);
            top = Math.max(top, seg.a.y + tr.radius, seg.b.y + tr.radius);
          }
        }
      }
      expect(top, `${f.id}: 主・副の判定の上の端 ${top.toFixed(2)} m`).toBeGreaterThanOrEqual(LOW_Y + 0.1);
    }
  });

  it('怒っていても、技の長さと隙の区間は変わらない（怒りで変わるのは、技の間の待ち時間・歩く速さ・向く速さ・威力）', () => {
    for (const id of KEPT) {
      const m = content.monsters.get(id)!;
      const a = attacksOf(m).find((x) => x.opening)!;
      const ticksOf = (enraged: boolean): number => {
        const sim = new Simulation(content, baseOptions({ monsterId: id, monsterAttacks: false }));
        const mon = sim.monsters[0]!;
        mon.aware = true;
        mon.enraged = enraged;
        mon.enragedTicks = 9999;
        mon.action = newRun(a, 9001, mon.yaw);
        let n = 0;
        while (mon.action && mon.action.def === a && n < 1000) {
          sim.step(frame());
          n++;
        }
        return n;
      };
      expect(ticksOf(true), id).toBe(a.durationTicks);
      expect(ticksOf(false), id).toBe(a.durationTicks);
      expect(m.rage!.cooldownScale).toBeLessThan(1);
    }
  });
});
