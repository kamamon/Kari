// 2G を主基準にする（classic_hunt_v1。v0.40.0、docs/spec.md の 32 章、ChatGPT の #19）: 入力の表・道具・断岳剣の連係。
// 原作のフレームは測っていない。ここで確かめるのは、状態の移り方（どの入力で、何が出て、何が出ないか）と、Kari の仮の値の境目。
import { beforeAll, describe, expect, it } from 'vitest';
import type { Content } from '../src/data/schemas';
import type { SimEvent } from '../src/game/events';
import { COMBO_SLACK_TICKS, resolveIncomingHit } from '../src/game/player';
import { Simulation } from '../src/game/sim';
import { Btn, baseOptions, frame, loadContent, placeInFrontOfHead, press, run } from './helpers';

let content: Content;
beforeAll(async () => {
  content = await loadContent();
});

const mk = (w = 'heavy_blade', over = {}): Simulation => new Simulation(content, baseOptions({ weaponId: `weapon.${w}.001`, ...over }));
const starts = (evs: SimEvent[]): string[] => evs.filter((e) => e.type === 'action_start' && e.actor === 'player').map((e) => (e as Extract<SimEvent, { type: 'action_start' }>).actionId);
const hb = (name: string): string => `player.heavy_blade.${name}`;
/** 抜刀して、行動の無い所に立たせる */
const drawn = (sim: Simulation): Simulation => {
  sim.player.drawn = true;
  return sim;
};
/** 行動が name になってから、その技の tick が at になるまで進める */
function untilTick(sim: Simulation, actionId: string, at: number): void {
  for (let i = 0; i < 400; i++) {
    const a = sim.player.action;
    if (a && a.def.actionId === actionId && a.tick >= at) return;
    run(sim, 1);
  }
  throw new Error(`${actionId} の ${at} tick へ届かない`);
}

describe('入力の表（H01）: 押下・同時押し・1 押し 1 命令', () => {
  it('主と副を同じ tick に押すと、抜刀中は斬り上げ（1 つの命令）。納刀中は抜刀斬り', () => {
    const a = drawn(mk());
    expect(starts(run(a, 1, () => press(Btn.Main | Btn.Sub)))).toEqual([hb('upswing')]);
    // 縦斬り・薙ぎ払いの先行入力は残らない
    expect(a.player.buffer.main + a.player.buffer.sub + a.player.buffer.combo).toBe(0);
    const b = mk();
    expect(starts(run(b, 1, () => press(Btn.Main | Btn.Sub)))).toEqual([hb('draw_slash')]);
    // 複合のボタン（タッチの「斬上」・キーボードの V）も同じ
    const c = drawn(mk());
    expect(starts(run(c, 1, () => press(Btn.Combo)))).toEqual([hb('upswing')]);
  });

  it(`押し遅れ: 主で技を始めて ${COMBO_SLACK_TICKS} tick 以内に副を押すと、斬り上げへ替わる。それより遅いと替わらない`, () => {
    for (let late = 1; late <= COMBO_SLACK_TICKS + 2; late++) {
      const sim = drawn(mk());
      const evs = run(sim, late + 1, (i) => (i === 0 ? press(Btn.Main) : i === late ? press(Btn.Sub) : frame()));
      const want = late <= COMBO_SLACK_TICKS ? [hb('overhead'), hb('upswing')] : [hb('overhead')];
      expect(starts(evs), `${late} tick 遅れ`).toEqual(want);
    }
    // 副が先でも同じ
    const sim = drawn(mk());
    expect(starts(run(sim, 3, (i) => (i === 0 ? press(Btn.Sub) : i === 2 ? press(Btn.Main) : frame())))).toEqual([hb('side_sweep'), hb('upswing')]);
  });

  it('複合の技を持たない武器（護刃）は、同時押しを主と副として扱う（これまでどおり、主の技が出る）', () => {
    const sim = drawn(mk('guard_blade'));
    const evs = run(sim, 1, () => press(Btn.Main | Btn.Sub));
    expect(starts(evs)).toEqual(['player.guard_blade.slash1']);
  });

  it('被弾・転倒の間に押した入力は消える（起き上がった時に、前の入力で勝手に動かない）', () => {
    const sim = drawn(mk());
    resolveIncomingHit(sim.player, { attackerPos: { x: 0, y: 0, z: 5 }, baseDamage: 5, guardable: false, guardCost: 0, reaction: 'flinch' }, sim);
    expect(sim.player.mode).toBe('hurt');
    const left = sim.player.hurt!.duration;
    // 起き上がる直前（最後の 2 tick）に、攻撃と回避を押しておく
    run(sim, left - 2);
    run(sim, 2, () => press(Btn.Main | Btn.Dodge));
    expect(sim.player.mode).toBe('free');
    const after = run(sim, 10);
    expect(starts(after)).toEqual([]);
  });
});

describe('道具（H04）: 2G に合わせて、納刀と使用を分ける', () => {
  it('抜刀中の道具ボタンは納刀だけ。納刀してから押すと使う。回復液は決め姿勢まで動けない（124 tick）', () => {
    const sim = drawn(mk('heavy_blade', { questId: 'quest.basin.003' }));
    sim.player.hp = 40;
    sim.player.itemIndex = sim.player.items.findIndex((s) => s.itemId === 'item.heal_tonic');
    expect(starts(run(sim, 1, () => press(Btn.Item)))).toEqual([hb('sheathe')]);
    run(sim, 80);
    expect(sim.player.drawn).toBe(false);
    expect(sim.player.hp).toBe(40);
    expect(starts(run(sim, 1, () => press(Btn.Item)))).toEqual(['player.item.drink']);
    run(sim, 58);
    expect(sim.player.hp).toBe(80);
    // 決め姿勢の間は、回避も攻撃も受け付けない
    const busy = run(sim, 60, () => press(Btn.Dodge | Btn.Main));
    expect(starts(busy)).toEqual([]);
    run(sim, 10);
    expect(sim.player.mode).toBe('free');
  });
});

describe('断岳剣（H03 の大剣。v0.40.0）', () => {
  it('連係: 縦斬り → 斬り上げ（低い所から）→ 縦斬り、薙ぎ払い → 斬り上げ → 薙ぎ払い。区間の前の押下はつながらない', () => {
    const sim = drawn(mk());
    run(sim, 1, () => press(Btn.Main));
    untilTick(sim, hb('overhead'), 30);
    // 振り下ろす前（40 より前）の同時押しは、先行入力が切れて、つながらない
    run(sim, 1, () => press(Btn.Combo));
    untilTick(sim, hb('overhead'), 40);
    expect(sim.player.action?.def.actionId).toBe(hb('overhead'));
    expect(starts(run(sim, 1, () => press(Btn.Combo)))).toEqual([hb('upswing_low')]);
    untilTick(sim, hb('upswing_low'), 28);
    expect(starts(run(sim, 1, () => press(Btn.Main)))).toEqual([hb('overhead')]);

    const s2 = drawn(mk());
    run(s2, 1, () => press(Btn.Sub));
    untilTick(s2, hb('side_sweep'), 44);
    expect(starts(run(s2, 1, () => press(Btn.Combo)))).toEqual([hb('upswing')]);
    untilTick(s2, hb('upswing'), 40);
    expect(starts(run(s2, 1, () => press(Btn.Sub)))).toEqual([hb('side_sweep')]);
  });

  it('斬り上げは、正面の低い所から頭の高さまで、判定 18〜27 の間に 1 回だけ当たる', () => {
    const sim = mk();
    placeInFrontOfHead(sim, 1.9);
    const at: number[] = [];
    for (let i = 0; i < 70; i++) {
      const evs = run(sim, 1, () => (i === 0 ? press(Btn.Combo) : frame()));
      // この tick に処理した技の tick（attackEval）
      if (evs.some((e) => e.type === 'hit')) at.push(sim.player.attackEval!.t);
    }
    expect(at).toHaveLength(1);
    expect(at[0]).toBeGreaterThanOrEqual(18);
    expect(at[0]).toBeLessThan(27);
  });

  it('抜刀斬りは溜められる（主を押し続ける。縦斬りと同じ段階と倍率）。副で出した抜刀斬りは溜めない', () => {
    const a = mk();
    run(a, 1, () => press(Btn.Main));
    run(a, 80, () => ({ ...frame(), held: Btn.Main }));
    expect(a.player.action?.def.actionId).toBe(hb('draw_slash'));
    expect(a.player.action!.chargeLevel).toBe(2);
    expect(a.player.action!.tick).toBe(16);
    run(a, 1, () => frame({ released: Btn.Main }));
    expect(a.player.action!.tick).toBeGreaterThan(16);
    const b = mk();
    run(b, 1, () => press(Btn.Sub));
    run(b, 40, () => ({ ...frame(), held: Btn.Sub }));
    expect(b.player.action!.chargeLevel).toBe(0);
    expect(b.player.action!.tick).toBeGreaterThan(16);
  });

  it('防御で受けると、刃も減る（刃で受けるので。3）。護刃（盾で受ける）は減らない', () => {
    for (const [w, wear] of [['heavy_blade', 3], ['guard_blade', 0]] as const) {
      const sim = drawn(mk(w));
      run(sim, 14, () => ({ ...frame(), held: Btn.Special }));
      expect(sim.player.mode, w).toBe('guard');
      const e0 = sim.player.edge;
      const out = resolveIncomingHit(sim.player, { attackerPos: { x: sim.player.pos.x, y: 0, z: sim.player.pos.z + 4 }, baseDamage: 20, guardable: true, guardCost: 10, reaction: 'flinch' }, sim);
      expect(out, w).toBe('guarded');
      expect(e0 - sim.player.edge, w).toBeCloseTo(wear, 6);
    }
  });

  it('刃の向き（描画だけ）: 斬り上げは手首で刃を返し、隣り合うキーの面の向きが真逆にならない', () => {
    for (const id of ['hb_upswing_blade_sweep', 'hb_upswing_low_blade_sweep', 'hb_draw_track', 'hb_sheathe_track']) {
      const tr = content.tracks.get(id)!;
      expect(tr.keys.every((k) => k.normal), id).toBe(true);
    }
    // 振り上げる間（判定の区間）は、刃が上（+X の面の向きで、刃 = -Z が上を向く）
    const up = content.tracks.get('hb_upswing_blade_sweep')!;
    for (const k of up.keys.filter((k) => k.t >= 16 && k.t <= 27)) expect(k.normal).toEqual([1, 0, 0]);
  });
});
