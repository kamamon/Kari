// 11 系統（断岳剣は v0.57.0 から。響笛・銃槍・軽弩・重弩は v0.80.0 から）の体の動きが「人にできる範囲」に収まっているかを、全部の技の全 tick で調べる。
// 調べる中身（関節の曲がる範囲・手が武器に届くか・手首・重心・足の滑り・自分の体と武器の重なり・速さ）は src/render/humanLimits.ts。
// v0.56.0 までの断岳剣（キー姿勢 + 腕の IK の方式）は保留の組 v056 に残してあり、ここでは調べない（tests/motion-replacement.test.ts）。
import { beforeAll, describe, expect, it } from 'vitest';
import type { Content } from '../src/data/schemas';
import { sampleTrack } from '../src/game/tracks';
import { evalMotion, rootAt, solveBody, vadd, vlen, vsub, type Vec } from '../src/render/bodySolve';
import { solveState } from '../src/render/hunterAnim';
import { checkFrame, checkSpeed, toAction, yawOf, type MotionPoint, type Violation } from '../src/render/humanLimits';
import { WEAPON_MOTIONS, WEAPON_STANCES } from '../src/render/weaponClipSpecs';
import { loadContent } from './helpers';

let content: Content;
beforeAll(async () => {
  content = await loadContent();
});

const FAMILIES = Object.keys(WEAPON_STANCES);
/**
 * いまも外れている所（数は増やさない。直したら消す）。どれも、納めた武器や背の盾へ手を伸ばす間・体ごと回る間の、短い区間。
 * 値は「いちばん悪い値」の上限。
 */
const KNOWN: Record<string, number> = {};

/** 動き 1 つを全 tick 調べて、規則ごとのいちばん悪い値を返す */
function worstOf(clip: string): Map<string, { v: Violation; t: number }> {
  const m = WEAPON_MOTIONS[clip]!;
  const S = WEAPON_STANCES[m.family]!;
  const worst = new Map<string, { v: Violation; t: number }>();
  const note = (v: Violation, t: number): void => {
    const w = worst.get(v.rule);
    const worse = v.limit.startsWith('≥') ? v.value < (w?.v.value ?? Infinity) : Math.abs(v.value) > Math.abs(w?.v.value ?? 0);
    if (!w || worse) worst.set(v.rule, { v, t });
  };
  const skip = (m as { skipBody?: [number, number] | null }).skipBody;
  let prev: MotionPoint | null = null;
  for (let t = 0; t <= m.dur; t++) {
    const e = evalMotion(m, t);
    const s = solveBody(e.ctl, e.footL, e.footR, S.hands);
    const near = !!skip && t >= skip[0] && t <= skip[1];
    for (const v of checkFrame(s, S.hands, near ? null : S.shape)) note(v, t);
    const root = rootAt(m, t);
    const F = s.frames;
    const g = toAction(s.weapon.grip, root);
    const pt: MotionPoint = {
      hand: toAction(S.hands.primary === 'R' ? F.handR : F.handL, root), dir: vsub(toAction(vadd(s.weapon.grip, s.weapon.dir), root), g), pelvis: toAction(F.pelvis, root),
      chestYaw: yawOf(F.qPelvis) + root.yaw, footL: toAction(F.ballL, root), footR: toAction(F.ballR, root), liftL: F.liftL, liftR: F.liftR,
    };
    if (prev) for (const v of checkSpeed(prev, pt, S.shape.maxTurn)) note(v, t);
    prev = pt;
  }
  return worst;
}

describe('体の動きが人にできる範囲にある', () => {
  it('11 系統の技は、すべて「解く方式」の動きを持つ（断岳剣は v0.57.0 から。D-150。響笛・銃槍・軽弩・重弩は v0.80.0 から。D-180）', () => {
    expect(FAMILIES.sort()).toEqual(['guard_blade', 'gunlance', 'heavy_blade', 'heavy_bowgun', 'hunting_horn', 'light_bowgun', 'long_blade', 'long_lance', 'ring_bow', 'twin_blades', 'war_maul']);
    for (const a of content.actions.values()) {
      const fam = a.actionId.split('.')[1]!;
      if (!FAMILIES.includes(fam)) continue;
      expect(WEAPON_MOTIONS[a.clip], a.clip).toBeDefined();
      expect(WEAPON_MOTIONS[a.clip]!.dur, a.clip).toBe(a.durationTicks);
    }
  });

  for (const [clip, m] of Object.entries(WEAPON_MOTIONS)) {
    it(`${clip}（${m.family}）: 全 tick で、関節・手の届き・重心・足・速さが範囲内`, () => {
      const out: string[] = [];
      for (const [rule, { v, t }] of worstOf(clip)) {
        const cap = KNOWN[`${clip}: ${rule}`];
        if (cap !== undefined && (v.limit.startsWith('≥') ? v.value >= cap : Math.abs(v.value) <= cap)) continue;
        out.push(`${rule} = ${v.value}（許す範囲 ${v.limit}）tick ${t}`);
      }
      expect(out, out.join('\n')).toEqual([]);
    });
  }

  it('構え・歩き・防御の姿も範囲内（足が地面に届き、手が武器に届く）', () => {
    for (const fam of FAMILIES) {
      const S = WEAPON_STANCES[fam]!;
      const speed = content.families.get(fam)!.drawnMoveSpeed;
      const states: [string, ReturnType<typeof solveState>][] = [['構え', solveState(fam, { kind: 'idle' })]];
      for (let i = 0; i < 12; i++) states.push([`歩き ${i}`, solveState(fam, { kind: 'idle' }, speed, (i / 12) * (2 / speed))]);
      if (S.guard) for (const b of [0.5, 1]) states.push([`防御 ${b}`, solveState(fam, { kind: 'guard', blend: b, shake: b === 1 ? 1 : 0 })]);
      for (const [name, s] of states) {
        const v = checkFrame(s, S.hands, S.shape).filter((x) => !x.rule.startsWith('重心'));
        expect(v.map((x) => `${x.rule} = ${x.value}（${x.limit}）`), `${fam} ${name}`).toEqual([]);
      }
    }
  });

  it('歩いている間、歩幅の全体を通して足が地面に届く', () => {
    for (const fam of FAMILIES) {
      const speed = content.families.get(fam)!.drawnMoveSpeed;
      for (let i = 0; i < 40; i++) {
        const s = solveState(fam, { kind: 'idle' }, speed, i * 0.05);
        expect(Math.max(s.frames.legShortL, s.frames.legShortR), `${fam} 歩き ${i}`).toBeLessThan(0.012);
      }
    }
  });
});

describe('見える武器と判定が同じ場所にある', () => {
  it('技の軌道（判定の正本）は、体の動きを解いた握りと向きに一致する', () => {
    for (const a of content.actions.values()) {
      const m = WEAPON_MOTIONS[a.clip];
      if (!m || !a.weaponTrack) continue;
      const S = WEAPON_STANCES[m.family]!;
      const tr = content.tracks.get(a.weaponTrack)!;
      for (let t = 0; t <= m.dur; t++) {
        const e = evalMotion(m, t);
        const s = solveBody(e.ctl, e.footL, e.footR, S.hands);
        const k = sampleTrack(tr, t);
        const grip: Vec = [k.grip.x, k.grip.y, k.grip.z], dir: Vec = [k.dir.x, k.dir.y, k.dir.z];
        expect(vlen(vsub(grip, s.weapon.grip)), `${a.actionId} tick ${t} 握り`).toBeLessThan(0.002);
        expect(vlen(vsub(dir, s.weapon.dir)), `${a.actionId} tick ${t} 向き`).toBeLessThan(0.002);
      }
    }
  });

  it('環弓の近接（v0.60.0）: 判定の軌道は、握った矢（体の動きを解いた手と前腕の向き）と同じ。判定のある間は矢を握っている', () => {
    for (const id of ['player.ring_bow.melee1', 'player.ring_bow.melee2']) {
      const a = content.actions.get(id)!;
      const m = WEAPON_MOTIONS[a.clip]!;
      const S = WEAPON_STANCES[m.family]!;
      for (const hw of a.hitWindows) {
        const tr = content.tracks.get(hw.shapeTrack)!;
        expect(tr.to - tr.from).toBeGreaterThan(0.5);
        for (let t = hw.from; t < hw.to; t++) {
          const e = evalMotion(m, t);
          const s = solveBody(e.ctl, e.footL, e.footR, S.hands);
          expect(s.held, `${id} tick ${t} 矢を握っている`).not.toBeNull();
          const k = sampleTrack(tr, t);
          expect(vlen(vsub([k.grip.x, k.grip.y, k.grip.z], s.held!.pos)), `${id} tick ${t} 握り`).toBeLessThan(0.002);
          expect(vlen(vsub([k.dir.x, k.dir.y, k.dir.z], s.held!.dir)), `${id} tick ${t} 向き`).toBeLessThan(0.002);
        }
      }
    }
  });

  it('構えの握り（weapons.json の ready）は、構えを解いた値と同じ。技は構えから始まり、構えへ戻る', () => {
    for (const fam of FAMILIES) {
      const F = content.families.get(fam)!;
      const s = solveState(fam, { kind: 'idle' });
      expect(vlen(vsub(F.ready.grip as Vec, s.weapon.grip)), `${fam} ready`).toBeLessThan(0.002);
      const main = content.actions.get(F.actions.main)!;
      const m = WEAPON_MOTIONS[main.clip]!;
      const S = WEAPON_STANCES[fam]!;
      for (const t of [0, m.dur]) {
        const e = evalMotion(m, t);
        const p = solveBody(e.ctl, e.footL, e.footR, S.hands);
        expect(vlen(vsub(p.weapon.grip, s.weapon.grip)), `${fam} 主攻撃 tick ${t}`).toBeLessThan(0.01);
      }
    }
  });
});
