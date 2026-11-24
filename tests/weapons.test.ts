// 断岳剣以外の 6 系統（護刃・長尖槍・環弓・大槌・双剣・太刀）の技と固有の仕組み。断岳剣は combat.test.ts。
import { beforeAll, describe, expect, it } from 'vitest';
import type { Content } from '../src/data/schemas';
import type { SimEvent } from '../src/game/events';
import { Simulation, arrowDistanceScale } from '../src/game/sim';
import { Btn, baseOptions, frame, hold, loadContent, placeInFrontOfHead, press, run } from './helpers';

let content: Content;
beforeAll(async () => {
  content = await loadContent();
});

const mk = (w: string, over = {}): Simulation => new Simulation(content, baseOptions({ weaponId: `weapon.${w}.001`, ...over }));
type Hit = Extract<SimEvent, { type: 'hit' }>;
const hits = (evs: SimEvent[]): Hit[] => evs.filter((e): e is Hit => e.type === 'hit');
const starts = (evs: SimEvent[]): string[] => evs.filter((e) => e.type === 'action_start').map((e) => (e as Extract<SimEvent, { type: 'action_start' }>).actionId);
/** 訓練標的に攻撃させ、プレイヤーを叩きつけの届く位置へ置く（combat.test.ts と同じ配置） */
const underSlam = (w: string): Simulation => {
  const sim = mk(w, { monsterAttacks: true });
  const m = sim.monsters[0]!;
  m.cooldown = 0;
  sim.player.pos = { x: m.pos.x + 0.6, y: 0, z: m.pos.z - 2.4 };
  sim.player.yaw = 0;
  sim.player.drawn = true;
  return sim;
};
/** 防御し続けた時に、叩きつけを受け止める tick */
const slamTick = (w: string): number => {
  const sim = underSlam(w);
  for (let i = 0; i < 200; i++) {
    sim.step(hold(Btn.Special));
    if (sim.drainEvents().some((e) => e.type === 'guard' || e.type === 'parry')) return i;
  }
  throw new Error('叩きつけが来ない');
};

describe('武器系統の共通', () => {
  it('どの武器も、主攻撃が訓練標的に当たる（武器ごとの間合い）', () => {
    for (const [w, dist] of [['guard_blade', 1.2], ['long_lance', 2.7], ['war_maul', 1.2], ['twin_blades', 0.9], ['long_blade', 1.3]] as const) {
      const sim = mk(w);
      placeInFrontOfHead(sim, dist);
      const h = hits(run(sim, 70, (i) => (i === 0 ? press(Btn.Main) : frame())));
      expect(h, w).toHaveLength(1);
      expect(h[0]!.actionId).toBe(content.families.get(w)!.actions.main);
    }
  });

  it('護刃は遠い標的に届かず、長尖槍は届く（間合いが違う）', () => {
    for (const [w, n] of [['guard_blade', 0], ['long_lance', 1]] as const) {
      const sim = mk(w);
      placeInFrontOfHead(sim, 2.7);
      expect(hits(run(sim, 70, (i) => (i === 0 ? press(Btn.Main) : frame()))), w).toHaveLength(n);
    }
  });

  it('同じ入力なら、どの武器でも結果が同じ（決定論）', () => {
    for (const w of ['guard_blade', 'long_lance', 'ring_bow', 'war_maul', 'twin_blades', 'long_blade']) {
      const play = (): string => {
        const sim = mk(w, { monsterAttacks: true });
        placeInFrontOfHead(sim, 1.6);
        run(sim, 400, (i) => (i % 23 === 0 ? press(Btn.Main) : i % 61 === 7 ? press(Btn.Sub) : i % 97 === 50 ? frame({ pressed: Btn.Dodge, moveX: 1 }) : hold(i % 140 > 100 ? Btn.Special : 0)));
        return sim.hash();
      };
      expect(play(), w).toBe(play());
    }
  });
});

describe('護刃（短剣と盾）', () => {
  it('主ボタンを続けて押すと、斬り → 返し → 突き とつながる', () => {
    const sim = mk('guard_blade');
    placeInFrontOfHead(sim, 1.2);
    const evs = run(sim, 110, (i) => (i === 0 || i === 13 || i === 26 ? press(Btn.Main) : frame()));
    expect(starts(evs)).toEqual(['player.guard_blade.slash1', 'player.guard_blade.slash2', 'player.guard_blade.thrust']);
    expect(hits(evs).map((h) => h.actionId)).toEqual(['player.guard_blade.slash1', 'player.guard_blade.slash2', 'player.guard_blade.thrust']);
    expect(sim.player.mode).toBe('free');
  });

  it('盾打ちは打撃で当たる', () => {
    const sim = mk('guard_blade');
    placeInFrontOfHead(sim, 1.2);
    const h = hits(run(sim, 60, (i) => (i === 0 ? press(Btn.Sub) : frame())));
    expect(h.map((x) => x.windowId)).toEqual(['shield']);
  });

  it('受け流し: 構えてすぐに受けると、削りもスタミナ消費も無い', () => {
    const at = slamTick('guard_blade');
    const sim = underSlam('guard_blade');
    const evs = run(sim, at + 30, (i) => (i >= at - 4 ? hold(Btn.Special) : frame()));
    expect(evs.filter((e) => e.type === 'parry')).toHaveLength(1);
    expect(evs.some((e) => e.type === 'guard' || e.type === 'player_hurt')).toBe(false);
    expect(sim.player.hp).toBe(100);
  });

  it('早くから構えていると、ふつうの防御になる（削りとスタミナ消費がある）', () => {
    const sim = underSlam('guard_blade');
    const evs = run(sim, 120, () => hold(Btn.Special));
    expect(evs.filter((e) => e.type === 'guard')).toHaveLength(1);
    expect(evs.some((e) => e.type === 'parry')).toBe(false);
    expect(sim.player.hp).toBeLessThan(100);
  });

  it('抜刀したまま道具を使え、使い終わっても抜刀のまま。断岳剣は納刀してから使う', () => {
    for (const [w, drawnAfter, sheathes] of [['guard_blade', true, false], ['heavy_blade', false, true]] as const) {
      const sim = mk(w, { questId: 'quest.basin.003', monsterAttacks: false });
      sim.player.drawn = true;
      sim.player.hp = 50;
      const evs = run(sim, 220, (i) => (i === 0 ? press(Btn.Item) : frame()));
      expect(evs.some((e) => e.type === 'item_effect'), w).toBe(true);
      expect(starts(evs).some((a) => a.endsWith('.sheathe')), w).toBe(sheathes);
      expect(sim.player.drawn, w).toBe(drawnAfter);
      expect(sim.player.hp, w).toBeGreaterThan(50);
    }
  });
});

describe('双剣', () => {
  it('主ボタンを続けて押すと、右 → 左 → 交差 とつながり、交差は 2 回当たる', () => {
    const sim = mk('twin_blades');
    placeInFrontOfHead(sim, 0.9);
    // 交差まで出たら押すのをやめる（押し続けると、交差のあとにまた右の斬りから始まる）
    let started = 0;
    const evs: SimEvent[] = [];
    for (let i = 0; i < 110; i++) {
      sim.step(started < 3 && i % 8 === 0 ? press(Btn.Main) : frame());
      const out = sim.drainEvents();
      started += starts(out).length;
      evs.push(...out);
    }
    expect(starts(evs)).toEqual(['player.twin_blades.slash1', 'player.twin_blades.slash2', 'player.twin_blades.cross']);
    const h = hits(evs);
    expect(h.filter((x) => x.actionId === 'player.twin_blades.slash1').map((x) => x.windowId)).toEqual(['blade_r']);
    expect(h.filter((x) => x.actionId === 'player.twin_blades.slash2').map((x) => x.windowId)).toEqual(['blade_l']);
    expect(h.filter((x) => x.actionId === 'player.twin_blades.cross').map((x) => x.windowId).sort()).toEqual(['blade_l', 'blade_r']);
  });

  it('当て続けると勢いが 3 まで上がり、振らずにいると消える', () => {
    const sim = mk('twin_blades');
    placeInFrontOfHead(sim, 0.9);
    const evs = run(sim, 260, (i) => (i % 9 === 0 ? press(Btn.Main) : frame()));
    const levels = evs.filter((e) => e.type === 'momentum').map((e) => (e as Extract<SimEvent, { type: 'momentum' }>).level);
    expect(levels.slice(0, 3)).toEqual([1, 2, 3]);
    expect(sim.player.momentum).toBe(3);
    run(sim, 200);
    expect(sim.player.momentum).toBe(0);
  });

  it('勢いが高いと、同じ斬りが速く終わる', () => {
    const ticksFor = (momentum: number): number => {
      const sim = mk('twin_blades');
      sim.player.drawn = true;
      sim.player.momentum = momentum;
      sim.step(press(Btn.Main));
      let n = 1;
      while (sim.player.mode === 'action' && n < 200) {
        sim.step(frame());
        n++;
      }
      return n;
    };
    expect(ticksFor(0)).toBe(24);
    expect(ticksFor(3)).toBeLessThan(ticksFor(2));
    expect(ticksFor(2)).toBeLessThan(ticksFor(0));
  });

  it('連ね斬りは 5 回当たり、勢いをすべて使い、段階が高いほど強い', () => {
    const total = (momentum: number): { damage: number; left: number; n: number } => {
      const sim = mk('twin_blades');
      placeInFrontOfHead(sim, 0.9);
      sim.player.momentum = momentum;
      const h = hits(run(sim, 100, (i) => (i === 0 ? press(Btn.Special) : frame())));
      return { damage: h.reduce((s, x) => s + x.damage, 0), left: sim.player.momentum, n: h.length };
    };
    const low = total(0), high = total(3);
    expect(low.n).toBe(5);
    expect(high.left).toBe(0);
    expect(high.damage).toBeGreaterThan(low.damage * 1.7);
  });

  it('被弾すると勢いを失う', () => {
    const sim = underSlam('twin_blades');
    sim.player.momentum = 3;
    sim.player.momentumTicks = -100000;
    const evs = run(sim, 120);
    expect(evs.some((e) => e.type === 'player_hurt')).toBe(true);
    expect(sim.player.momentum).toBe(0);
  });
});

describe('大槌', () => {
  it('主ボタンを続けて押すと、叩きつけ → 横殴り とつながり、どちらも打撃で当たる', () => {
    const sim = mk('war_maul');
    placeInFrontOfHead(sim, 1.2);
    const evs = run(sim, 150, (i) => (i % 10 === 0 ? press(Btn.Main) : frame()));
    expect(starts(evs).slice(0, 2)).toEqual(['player.war_maul.smash', 'player.war_maul.swing']);
    const h = hits(evs);
    expect(h.length).toBeGreaterThanOrEqual(2);
    expect(h.every((x) => x.windowId === 'head')).toBe(true);
    expect(content.actions.get('player.war_maul.smash')!.hitWindows[0]!.damageType).toBe('blunt');
  });

  it('副ボタンを押し続けて溜めるほど、叩きつけが強い', () => {
    const smash = (holdTicks: number): number => {
      const sim = mk('war_maul');
      placeInFrontOfHead(sim, 1.2);
      const h = hits(run(sim, holdTicks + 80, (i) => (i === 0 ? press(Btn.Sub) : i < holdTicks ? hold(Btn.Sub) : frame())));
      expect(h, `溜め ${holdTicks}`).toHaveLength(1);
      return h[0]!.damage;
    };
    const d0 = smash(2), d2 = smash(90), d3 = smash(125);
    expect(d2).toBeGreaterThan(d0 * 1.5);
    expect(d3).toBeGreaterThan(d2);
  });
});

describe('太刀', () => {
  it('主ボタンを続けて押すと、袈裟 → 斬り上げ → 突き とつながる', () => {
    const sim = mk('long_blade');
    placeInFrontOfHead(sim, 1.3);
    const evs = run(sim, 130, (i) => (i % 8 === 0 ? press(Btn.Main) : frame()));
    expect(starts(evs).slice(0, 3)).toEqual(['player.long_blade.kesa', 'player.long_blade.rise', 'player.long_blade.thrust']);
    expect(hits(evs).length).toBeGreaterThanOrEqual(3);
  });

  it('下がり斬りは、当てながら後ろへ 2m 跳び退く（v0.16.0。0.5m から広げた）', () => {
    const sim = mk('long_blade');
    placeInFrontOfHead(sim, 1.2);
    const z0 = sim.player.pos.z;
    const evs = run(sim, 60, (i) => (i === 0 ? press(Btn.Sub) : frame()));
    expect(hits(evs)).toHaveLength(1);
    expect(starts(evs)[0]).toBe('player.long_blade.back_cut');
    expect(z0 - sim.player.pos.z).toBeGreaterThan(1.95);
    expect(z0 - sim.player.pos.z).toBeLessThan(2.05);
    // 跳び退きの間（8〜38 tick）は、秒速 6m を超えない（人の動きの範囲。tests/human-motion.test.ts と同じ上限）
    const curve = content.curves.get('w_back_200')!;
    for (let i = 1; i < curve.keys.length; i++) {
      const [t0, d0] = curve.keys[i - 1]!, [t1, d1] = curve.keys[i]!;
      expect((Math.abs(d1 - d0) / (t1 - t0)) * 60).toBeLessThanOrEqual(6);
    }
  });

  it('兜割りは遅いが、袈裟より大きく削る', () => {
    const one = (btn: number, ticks: number): number => {
      const sim = mk('long_blade');
      placeInFrontOfHead(sim, 1.3);
      const h = hits(run(sim, ticks, (i) => (i === 0 ? press(btn) : frame())));
      expect(h).toHaveLength(1);
      return h[0]!.damage;
    };
    expect(one(Btn.Special, 80)).toBeGreaterThan(one(Btn.Main, 40) * 2);
  });
});

describe('長尖槍（ランス）', () => {
  it('主ボタン 3 回で、突きが 3 段つながる', () => {
    const sim = mk('long_lance');
    placeInFrontOfHead(sim, 2.4);
    const evs = run(sim, 140, (i) => (i === 0 || i === 20 || i === 40 ? press(Btn.Main) : frame()));
    expect(starts(evs)).toEqual(['player.long_lance.thrust1', 'player.long_lance.thrust2', 'player.long_lance.thrust3']);
    expect(hits(evs)).toHaveLength(3);
  });

  it('構え突き: 突いている最中も防御が有効で、行動が続く', () => {
    const at = slamTick('long_lance');
    const sim = underSlam('long_lance');
    let modeAtGuard = '';
    for (let i = 0; i < at + 20; i++) {
      sim.step(i === at - 10 ? frame({ held: Btn.Special, pressed: Btn.Main }) : hold(Btn.Special));
      const evs = sim.drainEvents();
      expect(evs.some((e) => e.type === 'player_hurt')).toBe(false);
      if (evs.some((e) => e.type === 'guard')) modeAtGuard = `${sim.player.mode}:${sim.player.action?.def.actionId}`;
    }
    expect(modeAtGuard).toBe('action:player.long_lance.guard_thrust');
    expect(sim.player.hp).toBeLessThan(100); // 削りはある
  });

  it('受け返し: 構えの間に受けると無傷で、大きな突きを返す', () => {
    const at = slamTick('long_lance');
    const sim = underSlam('long_lance');
    const evs = run(sim, at + 60, (i) => (i === at - 12 ? frame({ held: Btn.Special, pressed: Btn.Sub }) : i < at - 12 ? hold(Btn.Special) : frame()));
    expect(evs.filter((e) => e.type === 'parry')).toHaveLength(1);
    expect(starts(evs)).toContain('player.long_lance.counter_thrust');
    expect(sim.player.hp).toBe(100);
  });

  it('回避は短い跳び（転がらない）。納刀中は共通の回避', () => {
    const sim = mk('long_lance');
    sim.player.drawn = true;
    expect(starts(run(sim, 3, (i) => (i === 0 ? frame({ pressed: Btn.Dodge, moveZ: 1 }) : frame())))).toEqual(['player.long_lance.hop']);
    const sim2 = mk('long_lance');
    expect(starts(run(sim2, 3, (i) => (i === 0 ? frame({ pressed: Btn.Dodge, moveZ: 1 }) : frame())))).toEqual([content.player.rollActionId]);
  });
});

describe('環弓（弓）', () => {
  const shoot = (dist: number, holdTicks: number): { h: Hit[]; minStamina: number } => {
    const sim = mk('ring_bow');
    placeInFrontOfHead(sim, dist);
    const h: Hit[] = [];
    let minStamina = 100;
    for (let i = 0; i < holdTicks + 120; i++) {
      sim.step(i === 0 ? press(Btn.Main) : i < holdTicks ? hold(Btn.Main) : frame());
      h.push(...hits(sim.drainEvents()));
      minStamina = Math.min(minStamina, sim.player.stamina);
    }
    return { h, minStamina };
  };

  it('矢が飛んで当たる。溜めるほど強い', () => {
    const weak = shoot(8, 5), mid = shoot(8, 60), strong = shoot(8, 140);
    for (const s of [weak, mid, strong]) {
      expect(s.h).toHaveLength(1);
      expect(s.h[0]!.windowId).toBe('arrow');
    }
    expect(mid.h[0]!.damage).toBeGreaterThan(weak.h[0]!.damage);
    expect(strong.h[0]!.damage).toBeGreaterThan(mid.h[0]!.damage);
  });

  it('溜めている間はスタミナが減る', () => {
    expect(shoot(8, 5).minStamina).toBeGreaterThan(95);
    expect(shoot(8, 140).minStamina).toBeLessThan(80);
  });

  it('適正距離（6〜12m）より近い・遠いと弱い', () => {
    expect(arrowDistanceScale(8)).toBe(1);
    expect(arrowDistanceScale(3)).toBe(0.6);
    expect(arrowDistanceScale(20)).toBe(0.5);
    const near = shoot(3, 140), good = shoot(8, 140), far = shoot(18, 140);
    expect(good.h[0]!.damage).toBeGreaterThan(near.h[0]!.damage);
    expect(good.h[0]!.damage).toBeGreaterThan(far.h[0]!.damage);
  });

  it('散らし撃ちは 3 本。近くなら複数当たることがある', () => {
    const sim = mk('ring_bow');
    placeInFrontOfHead(sim, 2.5);
    const evs = run(sim, 80, (i) => (i === 0 ? press(Btn.Sub) : frame()));
    const shot = evs.find((e) => e.type === 'shoot') as Extract<SimEvent, { type: 'shoot' }>;
    expect(shot.count).toBe(3);
    expect(hits(evs).length).toBeGreaterThanOrEqual(1);
    expect(sim.projectiles.length).toBe(0); // 飛び終わった矢は残らない
  });
});
