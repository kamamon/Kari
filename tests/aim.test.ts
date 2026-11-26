// 手で狙う（v0.61.0。2G の弓の照準。#19 の H05。docs/spec.md の 32.27）。
// 狙いの向きは入力（aimYaw・aimPitch）で simulation へ渡す。狙っている間は体をその向きへ向けて止まり、矢は狙いの線の当たる所へ飛ぶ。
// 狙いの補助（正面 14° の部位へ寄せる）は操作補助で、標準は切。
import { beforeAll, describe, expect, it } from 'vitest';
import { yawOf, type V3 } from '../src/core/math';
import type { Content } from '../src/data/schemas';
import { aimDir, aimEye, aimTarget } from '../src/game/aim';
import type { SimEvent } from '../src/game/events';
import { monsterShapes } from '../src/game/monster';
import { Simulation } from '../src/game/sim';
import { Btn, baseOptions, frame, loadContent, placeInFrontOfHead, run } from './helpers';

let content: Content;
beforeAll(async () => {
  content = await loadContent();
});

type Hit = Extract<SimEvent, { type: 'hit' }>;
const hits = (evs: SimEvent[]): Hit[] => evs.filter((e): e is Hit => e.type === 'hit');
const bow = (over = {}): Simulation => new Simulation(content, baseOptions({ weaponId: 'weapon.ring_bow.001', ...over }));

/** 目の点から point を見る狙いの向き（目の点は向きで右へずれるので、2 回寄せる） */
function aimAt(sim: Simulation, point: V3): { yaw: number; pitch: number } {
  let yaw = sim.player.yaw;
  let pitch = 0;
  for (let i = 0; i < 3; i++) {
    const e = aimEye(sim.player.pos, yaw);
    yaw = yawOf(point.x - e.x, point.z - e.z);
    pitch = Math.atan2(point.y - e.y, Math.hypot(point.x - e.x, point.z - e.z));
  }
  return { yaw, pitch };
}

/** 固有を押して狙い（aim があれば）、主を holdTicks 押して溜めて射る */
function shootAimed(sim: Simulation, aim: { yaw: number; pitch: number } | null, holdTicks = 60): SimEvent[] {
  return run(sim, holdTicks + 100, (i) => {
    const special = aim ? Btn.Special : 0;
    const main = i < holdTicks ? Btn.Main : 0;
    return frame({ held: special | main, pressed: (i === 0 ? Btn.Main | special : 0), ...(aim ? { aimYaw: aim.yaw, aimPitch: aim.pitch } : {}) });
  });
}

describe('手で狙う（v0.61.0。環弓。#19 の H05）', () => {
  it('固有を押して狙いの向きを渡すと、体がその向きを向いて止まる（移動の入力は使わない）。離すと元どおり動ける', () => {
    const sim = bow();
    placeInFrontOfHead(sim, 8);
    const p0 = { ...sim.player.pos };
    run(sim, 30, () => frame({ held: Btn.Special, moveX: 1, moveZ: 0, aimYaw: 0.4, aimPitch: 0.2 }));
    expect(sim.player.aim).toEqual({ yaw: 0.4, pitch: 0.2 });
    expect(sim.player.yaw).toBeCloseTo(0.4, 9);
    expect(Math.hypot(sim.player.pos.x - p0.x, sim.player.pos.z - p0.z)).toBeLessThan(1e-9);
    run(sim, 30, () => frame({ moveX: 1, moveZ: 0 }));
    expect(sim.player.aim).toBeNull();
    expect(Math.hypot(sim.player.pos.x - p0.x, sim.player.pos.z - p0.z)).toBeGreaterThan(0.5);
  });

  it('上下の範囲（-35°〜55°）を超えた向きは、範囲の端で止まる。狙いの向きが無い・抜刀していない時は狙わない', () => {
    const sim = bow();
    placeInFrontOfHead(sim, 8);
    run(sim, 2, () => frame({ held: Btn.Special, aimYaw: 0, aimPitch: 1.5 }));
    expect(sim.player.aim!.pitch).toBeCloseTo((55 * Math.PI) / 180, 9);
    run(sim, 2, () => frame({ held: Btn.Special }));
    expect(sim.player.aim).toBeNull();
    const sheathed = bow();
    run(sheathed, 2, () => frame({ held: Btn.Special, aimYaw: 0, aimPitch: 0 }));
    expect(sheathed.player.aim).toBeNull();
  });

  it('矢は狙いの線の当たる所へ飛ぶ: 正面の頭ではなく、狙った脚に当たる。横へ外して狙うと当たらない', () => {
    const plain = bow();
    placeInFrontOfHead(plain, 8);
    expect(hits(shootAimed(plain, null)).map((h) => h.partId)[0]).toBe('head');
    const sim = bow();
    placeInFrontOfHead(sim, 8);
    // 狩人に近い側の前脚の、真ん中の高さ
    const m = sim.monsters[0]!;
    const legIndex = m.def.parts.findIndex((q) => q.id === 'legs');
    const legs = monsterShapes(m).filter((s) => s.partIndex === legIndex && s.b);
    const near = legs.sort((a, b) => Math.hypot(a.a.x - sim.player.pos.x, a.a.z - sim.player.pos.z) - Math.hypot(b.a.x - sim.player.pos.x, b.a.z - sim.player.pos.z))[0]!;
    const point = { x: (near.a.x + near.b!.x) / 2, y: (near.a.y + near.b!.y) / 2, z: (near.a.z + near.b!.z) / 2 };
    const aim = aimAt(sim, point);
    // 照準（狙いの線）も、その脚を指している
    const t = aimTarget(sim.monsters, sim.world, aimEye(sim.player.pos, aim.yaw), aimDir(aim.yaw, aim.pitch));
    expect(t).toMatchObject({ kind: 'monster', partIndex: legIndex });
    const h = hits(shootAimed(sim, aim));
    expect(h.length).toBeGreaterThanOrEqual(1);
    expect(h.every((x) => x.partId === 'legs')).toBe(true);
    const away = bow();
    placeInFrontOfHead(away, 8);
    expect(hits(shootAimed(away, { yaw: 0.6, pitch: 0 }))).toHaveLength(0);
  });

  it('狙いの補助（操作補助）: 標準は切で、狙っていない矢は体の向きへ水平に飛ぶ。入なら正面 14° の部位へ寄せる。手で狙っている間は寄せない', () => {
    const place = (sim: Simulation): void => {
      placeInFrontOfHead(sim, 12);
      sim.player.pos = { ...sim.player.pos, x: sim.player.pos.x + 2.6 };
      sim.player.prevPos = { ...sim.player.pos };
    };
    const off = bow();
    place(off);
    expect(off.aimAssist).toBe(false);
    expect(hits(shootAimed(off, null))).toHaveLength(0);
    const on = bow({ aimAssist: true });
    place(on);
    expect(hits(shootAimed(on, null)).length).toBeGreaterThanOrEqual(1);
    const aimed = bow({ aimAssist: true });
    place(aimed);
    expect(hits(shootAimed(aimed, { yaw: 0, pitch: 0 }))).toHaveLength(0);
  });

  it('弓のほかの武器では、狙いの入力を使わない（固有は防御のまま）。同じ入力なら同じ結果（指紋に狙いが入る）', () => {
    const blade = new Simulation(content, baseOptions({ weaponId: 'weapon.heavy_blade.001' }));
    placeInFrontOfHead(blade, 3);
    run(blade, 20, () => frame({ held: Btn.Special, aimYaw: 1, aimPitch: 0.3 }));
    expect(blade.player.aim).toBeNull();
    expect(blade.player.mode).toBe('guard');
    const a = bow(), b = bow();
    for (const s of [a, b]) placeInFrontOfHead(s, 8);
    const input = (i: number) => frame({ held: Btn.Special | (i < 50 ? Btn.Main : 0), pressed: i === 0 ? Btn.Main : 0, aimYaw: 0.02 * Math.sin(i / 7), aimPitch: 0.05 });
    run(a, 120, input);
    run(b, 120, input);
    expect(a.hash()).toBe(b.hash());
    const c = bow();
    placeInFrontOfHead(c, 8);
    run(c, 120, (i) => ({ ...input(i), aimPitch: 0.06 }));
    expect(c.hash()).not.toBe(a.hash());
  });
});
