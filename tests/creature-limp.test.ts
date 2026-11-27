// 弱った大型が足を引きずる（v0.72.0。#19 の M05。docs/decisions.md D-170。描画だけ）:
//   - 弱って巣へ向かう間（roam.limping。気づいた相手と戦っている間は除く）、四足と脚のある長胴は右の後ろ脚、二足は右脚を引きずる:
//     その脚は足先がほとんど上がらず、体の後ろへ流れる。その脚に体重が乗る間だけ、腰がその側へ傾いて体が沈み、頭が落ちる
//     （肩は傾けない。反対の側の足は浮かない。胴が地面に近い種は、胴の下が潜らない所までしか傾けない）
//   - 巣に着いて眠る時は、ゆっくり（2 秒ほど）、後ろから腰を下ろす
import { beforeAll, describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import type { Content } from '../src/data/schemas';
import { createMonster, type MonsterState } from '../src/game/monster';
import { CREATURE_PLANS } from '../src/render/creaturePlans';
import { CreatureRig, limpGait } from '../src/render/creatureRig';
import { loadContent } from './helpers';

let content: Content;
beforeAll(async () => {
  content = await loadContent();
});

type Roam = NonNullable<MonsterState['roam']>;
const roamOf = (limping: boolean, state: Roam['state'] = 'stay'): Roam => ({ areaId: 'a', state, ticks: 0, via: null, routeIndex: 0, limping, wander: null, idle: 0, lost: 0, feinted: false });

/** 遊べる大型（群れで暮らす幼体は、巣へ向かわない） */
const bigOnes = (): [string, (typeof CREATURE_PLANS)[string]][] => Object.entries(CREATURE_PLANS).filter(([id]) => !!content.monsters.get(id) && !content.monsters.get(id)!.herd);

function setup(id: string, limping: boolean, aware = false, state: Roam['state'] = 'stay') {
  const def = content.monsters.get(id)!;
  const rig = new CreatureRig(CREATURE_PLANS[id]!, def.parts.map((p) => p.id), { seed: 0 });
  const m = createMonster(def, { x: 0, z: 0, yaw: 0 }, 'limp');
  m.aware = aware;
  m.roam = roamOf(limping, state);
  return { def, rig, m };
}

/** まっすぐ歩く 6 秒（寝床へ歩く速さ。はじめの 2 秒は数えない） */
function walk(id: string, limping: boolean, aware = false, state: Roam['state'] = 'stay', speed?: number) {
  const { def, rig, m } = setup(id, limping, aware, state);
  const v = speed ?? (def.moveSpeed ?? 2.5) * 0.7;
  const rec = new Map<string, { z: number[]; stMax: number }>();
  const frames: { hitch: number; dragStance: number; rootY: number }[] = [];
  const start = new Map<string, Vector3>();
  let slide = 0, time = 0, torso = Infinity;
  for (let i = 0; i < 360; i++) {
    time += 1 / 60;
    m.pos.z += v / 60;
    rig.root.position.set(m.pos.x, 0, m.pos.z);
    rig.update(m, { alpha: 0, dt: 1 / 60, time, content });
    if (i < 120) continue;
    const drag = rig.dragLegOf();
    let dragStance = -1;
    for (const f of rig.feet()) {
      const key = `${f.group}${f.side}`;
      if (drag && f.group === drag.group && f.side === drag.side) dragStance = f.stance;
      const r = rec.get(key) ?? { z: [], stMax: -Infinity };
      rec.set(key, r);
      r.z.push(f.p.z - m.pos.z);
      if (f.stance >= 0 && f.stance <= 0.75) r.stMax = Math.max(r.stMax, f.p.y);
      if (f.stance < 0 || f.stance > 0.75) {
        start.delete(key);
        continue;
      }
      const s0 = start.get(key);
      if (!s0) start.set(key, f.p.clone());
      else slide = Math.max(slide, Math.hypot(f.p.x - s0.x, f.p.z - s0.z));
    }
    frames.push({ hitch: rig.limpHitch, dragStance, rootY: rig.marker(`sp:${CREATURE_PLANS[id]!.root}`).y });
    if (i % 4 === 0) torso = Math.min(torso, rig.lowest().torso);
  }
  const mean = (a: number[]): number => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  const feet = new Map<string, { z: number; stMax: number }>();
  for (const [k, r] of rec) feet.set(k, { z: mean(r.z), stMax: r.stMax });
  return { rig, m, feet, frames, slide, torso, resteps: rig.plantResteps };
}

describe('足を引きずる（v0.72.0。D-170）', () => {
  it('引きずる脚: 四足と脚のある長胴は右の後ろ脚、二足は右脚。前後に振る脚が無い体（甲殻・輪・虫・ひれの長胴）には無い', () => {
    const got: string[] = [];
    for (const [id, plan] of Object.entries(CREATURE_PLANS)) {
      if (!content.monsters.get(id)) continue;
      const { rig, m } = setup(id, false);
      rig.update(m, { alpha: 0, dt: 1 / 60, time: 0, content });
      const d = rig.dragLegOf();
      got.push(`${id.replace('monster.', '')}:${d ? `${d.group}${d.side}` : '-'}`);
      if (plan.frame === 'quad') expect(d, id).toEqual({ group: 'H', side: -1 });
      else if (plan.frame === 'biped') expect(d, id).toEqual({ group: 'B', side: -1 });
      else if (plan.frame === 'serpent') expect(d === null || (d.group === 'H' && d.side === -1), id).toBe(true);
      else expect(d, id).toBeNull();
      expect(rig.hasDragLeg).toBe(!!d);
    }
    // 長胴のうち、脚のあるラズメルには有り、ひれ足のキリサーヴには無い
    expect(got).toContain('razmer:H-1');
    expect(got).toContain('kirisave:-');
  });

  it('引きずる時: 体重が乗る間だけ体が沈み、引きずる脚は体の後ろへ流れ、胴の下は潜らず、反対の側の足は浮かず、留めた足は滑らない', () => {
    const big = bigOnes().filter(([id]) => {
      const { rig, m } = setup(id, false);
      rig.update(m, { alpha: 0, dt: 1 / 60, time: 0, content });
      return rig.hasDragLeg;
    });
    expect(big.map(([id]) => id.replace("monster.", "")).sort()).toEqual(["ashreia", "bornakel", "lumisca", "numeradon", "razmer", "selvark", "velgait"]);
    for (const [id, plan] of big) {
      const a = walk(id, true), b = walk(id, false);
      const drag = a.rig.dragLegOf()!;
      // 揺れは、引きずる脚が支える半周期の真ん中で 1、踏み出している間は 0
      const hs = a.frames.map((f) => f.hitch);
      expect(Math.max(...hs), id).toBeGreaterThan(0.95);
      for (const f of a.frames) if (f.hitch > 0.3) expect(f.dragStance, `${id}: 揺れ ${f.hitch.toFixed(2)} の時に、引きずる脚が踏み出している`).toBeGreaterThanOrEqual(0);
      expect(Math.max(...b.frames.map((f) => f.hitch)), `${id}: 弱っていないのに揺れる`).toBe(0);
      // 体が沈む: 揺れが大きい時の体の中心は、弱っていない時の同じ歩きより 2cm 以上低い
      const low = (fs: typeof a.frames, pick: (f: (typeof a.frames)[number]) => boolean): number => Math.min(...fs.filter(pick).map((f) => f.rootY));
      const sink = low(b.frames, () => true) - low(a.frames, (f) => f.hitch > 0.9);
      expect(sink, `${id}: 沈み ${sink.toFixed(3)} m`).toBeGreaterThan(0.02);
      // 引きずる脚は、反対の側の同じ脚との前後の差が、弱っていない時より、平均で 5cm 以上後ろ
      const mirror = `${drag.group}${-drag.side}`, own = `${drag.group}${drag.side}`;
      const trailA = a.feet.get(own)!.z - a.feet.get(mirror)!.z, trailB = b.feet.get(own)!.z - b.feet.get(mirror)!.z;
      expect(trailA - trailB, `${id}: 引きずる脚の後ろへの流れ ${trailA.toFixed(3)} / 弱っていない時 ${trailB.toFixed(3)} m`).toBeLessThan(-0.05);
      // 胴の下は、弱っていない時の歩きより 4.5cm 以上は地面へ潜らない（胴が地面に近い種は、腰をあまり傾けない）
      expect(a.torso, `${id}: 胴のいちばん低い所 ${a.torso.toFixed(3)} / 弱っていない時 ${b.torso.toFixed(3)} m`).toBeGreaterThan(Math.min(b.torso, 0) - 0.045);
      // ほかの足は、支える間に、弱っていない時より 1.5cm 以上は浮かない
      for (const [k, f] of a.feet) {
        if (k === own) continue;
        expect(f.stMax, `${id} ${k}: 支える間の足先 ${f.stMax.toFixed(3)} / 弱っていない時 ${b.feet.get(k)!.stMax.toFixed(3)}`).toBeLessThan(b.feet.get(k)!.stMax + 0.015);
      }
      // 足の接地（v0.25.0）はそのまま: 四足・二足は、支えている足先が、弱っていない時の歩きより 1cm 以上は多く滑らず（3.5cm までは許す）、その場で踏み直さない
      if (plan.frame === 'quad' || plan.frame === 'biped') {
        expect(a.slide, `${id}: 滑り ${a.slide.toFixed(3)} m / 弱っていない時 ${b.slide.toFixed(3)} m`).toBeLessThan(Math.max(0.035, b.slide + 0.01));
        expect(a.resteps, id).toBe(0);
      }
    }
  });

  it('弱って急いでエリアを出る間（走る速さ）も引きずり、留めた足は滑らず、踏み直さない', () => {
    const fast = content.fields.get('field.basin')!.roam.limpLeaveSpeed;
    expect(fast).toBeGreaterThan(5);
    for (const [id, plan] of bigOnes()) {
      if (plan.frame !== 'quad' && plan.frame !== 'biped') continue;
      const a = walk(id, true, true, 'leave', fast), b = walk(id, false, true, 'leave', fast);
      expect(Math.max(...a.frames.map((f) => f.hitch)), id).toBeGreaterThan(0.95);
      expect(a.slide, `${id}: 滑り ${a.slide.toFixed(3)} m / 弱っていない時 ${b.slide.toFixed(3)} m`).toBeLessThan(Math.max(0.035, b.slide + 0.025));
      expect(a.resteps, id).toBe(0);
      expect(a.torso, id).toBeGreaterThan(Math.min(b.torso, 0) - 0.045);
    }
  });

  it('気づいた相手と同じエリアで戦っている間は引きずらない（エリアを出る間は、気づいていても引きずる）', () => {
    const id = 'monster.selvark';
    const fight = walk(id, true, true, 'stay'), leave = walk(id, true, true, 'leave');
    expect(Math.max(...fight.frames.map((f) => f.hitch))).toBe(0);
    expect(Math.max(...leave.frames.map((f) => f.hitch))).toBeGreaterThan(0.95);
    const m = setup(id, true).m;
    expect(limpGait(m)).toBe(true);
    m.aware = true;
    expect(limpGait(m)).toBe(false);
    m.roam!.state = 'leave';
    expect(limpGait(m)).toBe(true);
    m.asleep = true;
    expect(limpGait(m)).toBe(false);
  });

  it('巣に着いて眠る時は、2 秒ほどかけて、後ろから腰を下ろす（弱って歩いて来なかった時は、これまでどおり 1.3 秒ほど）', () => {
    let arcs = 0;
    for (const [id, plan] of bigOnes()) {
      const roles = plan.roles;
      const rear = roles.indexOf('b'), front = roles.lastIndexOf('b');
      const run = (limping: boolean) => {
        const { def, rig, m } = setup(id, limping);
        const v = (def.moveSpeed ?? 2.5) * 0.7;
        let time = 0;
        for (let i = 0; i < 120; i++) {
          time += 1 / 60;
          m.pos.z += v / 60;
          rig.root.position.set(m.pos.x, 0, m.pos.z);
          rig.update(m, { alpha: 0, dt: 1 / 60, time, content });
        }
        m.asleep = true;
        const y0 = rig.marker(`sp:${plan.root}`).y;
        let pitchMax = -Infinity, full = Infinity;
        for (let i = 0; i < 240; i++) {
          time += 1 / 60;
          rig.update(m, { alpha: 0, dt: 1 / 60, time, content });
          if (rear >= 0 && front > rear) {
            const r = rig.marker(`sp:${rear}`), f = rig.marker(`sp:${front}`);
            pitchMax = Math.max(pitchMax, Math.atan2(f.y - r.y, Math.abs(f.z - r.z)));
          }
          if (rig.lieRest >= 1 && full === Infinity) full = (i + 1) / 60;
        }
        return { full, pitchMax, drop: y0 - rig.marker(`sp:${plan.root}`).y };
      };
      const a = run(true), b = run(false);
      expect(a.full, `${id}: 弱って来た時 ${a.full.toFixed(2)} 秒`).toBeGreaterThan(2.0);
      expect(a.full, id).toBeLessThan(2.5);
      expect(b.full, `${id}: ふだん ${b.full.toFixed(2)} 秒`).toBeLessThan(1.3);
      // 体が 30cm 以上下がる種は、下ろす途中に、体の前が後ろより上がる（ふだんの下ろし方より 0.05 rad 以上）
      if (a.drop > 0.3 && rear >= 0 && front > rear) {
        arcs++;
        expect(a.pitchMax - b.pitchMax, `${id}: 腰を下ろす途中の前の上がり ${a.pitchMax.toFixed(3)} / ${b.pitchMax.toFixed(3)} rad`).toBeGreaterThan(0.05);
      }
    }
    expect(arcs).toBeGreaterThanOrEqual(5);
  });
});
