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
  it('v0.53.0（2G）: 主ボタンを続けて押すと、斬り下ろし → 横斬り → 斬り返し → 回転斬り とつながり、どれも当たる', () => {
    const sim = mk('guard_blade');
    placeInFrontOfHead(sim, 1.2);
    const evs = run(sim, 150, (i) => (i === 0 || i === 15 || i === 29 || i === 44 ? press(Btn.Main) : frame()));
    const chain = ['player.guard_blade.slash1', 'player.guard_blade.slash2', 'player.guard_blade.return', 'player.guard_blade.round'];
    expect(starts(evs)).toEqual(chain);
    expect(hits(evs).map((h) => h.actionId)).toEqual(chain);
    expect(sim.player.mode).toBe('free');
  });

  it('v0.53.0: 回転斬りは体ごと右へ 1 回転して、元の向きに戻る（回る間は向きが変わる）。連係の締めで、続けて主を押しても次の技は無い', () => {
    const sim = mk('guard_blade');
    const yaw0 = sim.player.yaw;
    sim.player.drawn = true;
    const evs: SimEvent[] = [];
    const yaws: number[] = [];
    for (let i = 0; i < 140; i++) {
      sim.step(i === 0 || i === 15 || i === 29 || i === 44 || i === 100 ? press(Btn.Main) : frame());
      evs.push(...sim.drainEvents());
      if (sim.player.action?.def.actionId === 'player.guard_blade.round') yaws.push(sim.player.yaw);
    }
    expect(starts(evs).slice(0, 4).at(-1)).toBe('player.guard_blade.round');
    // 回る間に、右（yaw が減る向き）へ 90° より大きく向きが変わる時がある
    const turned = yaws.map((y) => Math.atan2(Math.sin(y - yaw0), Math.cos(y - yaw0)));
    expect(Math.min(...turned)).toBeLessThan(-Math.PI / 2);
    expect(Math.abs(Math.atan2(Math.sin(sim.player.yaw - yaw0), Math.cos(sim.player.yaw - yaw0)))).toBeLessThan(1e-6);
  });

  it('v0.53.0: 副は横斬り（構えから）。連係の途中の副で盾打ち（打撃）、盾打ちから主で斬り返しへ', () => {
    const side = mk('guard_blade');
    placeInFrontOfHead(side, 1.2);
    const sevs = run(side, 60, (i) => (i === 0 ? press(Btn.Sub) : frame()));
    expect(starts(sevs)).toEqual(['player.guard_blade.side']);
    expect(hits(sevs).map((x) => x.windowId)).toEqual(['blade_main']);
    const sim = mk('guard_blade');
    placeInFrontOfHead(sim, 1.2);
    const evs = run(sim, 110, (i) => (i === 0 ? press(Btn.Main) : i === 15 ? press(Btn.Sub) : i === 38 ? press(Btn.Main) : frame()));
    expect(starts(evs)).toEqual(['player.guard_blade.slash1', 'player.guard_blade.bash', 'player.guard_blade.return']);
    expect(hits(evs).map((x) => x.windowId)).toEqual(['blade_main', 'shield', 'blade_main']);
  });

  it('v0.53.0（2G）: 受け流しは無い。構えてすぐに受けても、ふつうの防御（削りとスタミナ消費がある）', () => {
    const at = slamTick('guard_blade');
    const sim = underSlam('guard_blade');
    const evs = run(sim, at + 30, (i) => (i >= at - 4 ? hold(Btn.Special) : frame()));
    expect(evs.filter((e) => e.type === 'parry')).toHaveLength(0);
    expect(evs.filter((e) => e.type === 'guard')).toHaveLength(1);
    expect(sim.player.hp).toBeLessThan(100);
  });

  it('v0.53.0: ガード斬り: 防御を構えたまま主で斬り、防御を押し続けていれば、斬った後は防御へ戻る', () => {
    const sim = mk('guard_blade');
    placeInFrontOfHead(sim, 1.2);
    run(sim, 10, () => hold(Btn.Special));
    expect(sim.player.mode).toBe('guard');
    const evs = run(sim, 60, (i) => (i === 0 ? { ...press(Btn.Main), held: Btn.Main | Btn.Special } : hold(Btn.Special)));
    expect(starts(evs)).toEqual(['player.guard_blade.guard_slash']);
    expect(hits(evs).map((x) => x.actionId)).toEqual(['player.guard_blade.guard_slash']);
    expect(sim.player.mode).toBe('guard');
  });

  it('早くから構えていると、ふつうの防御になる（削りとスタミナ消費がある）', () => {
    const sim = underSlam('guard_blade');
    const evs = run(sim, 120, () => hold(Btn.Special));
    expect(evs.filter((e) => e.type === 'guard')).toHaveLength(1);
    expect(evs.some((e) => e.type === 'parry')).toBe(false);
    expect(sim.player.hp).toBeLessThan(100);
  });

  it('v0.40.0（2G）: 防御を構えたまま道具を使え、使い終わっても抜刀のまま。構えていなければ、ほかの武器と同じく納刀だけ', () => {
    // 護刃: 防御を構えたまま道具を押す
    const g = mk('guard_blade', { questId: 'quest.basin.003', monsterAttacks: false });
    g.player.drawn = true;
    g.player.hp = 50;
    g.player.itemIndex = g.player.items.findIndex((s) => s.itemId === 'item.heal_tonic');
    run(g, 8, () => ({ ...frame(), held: Btn.Special }));
    const evs = run(g, 220, (i) => (i === 0 ? { ...frame(), held: Btn.Special | Btn.Item, pressed: Btn.Item } : frame()));
    expect(evs.some((e) => e.type === 'item_effect')).toBe(true);
    expect(starts(evs).some((a) => a.endsWith('.sheathe'))).toBe(false);
    expect(g.player.drawn).toBe(true);
    expect(g.player.hp).toBeGreaterThan(50);
    // 構えていない護刃と、断岳剣: 押すと納刀だけ（使わない）
    for (const w of ['guard_blade', 'heavy_blade']) {
      const sim = mk(w, { questId: 'quest.basin.003', monsterAttacks: false });
      sim.player.drawn = true;
      sim.player.hp = 50;
      sim.player.itemIndex = sim.player.items.findIndex((s) => s.itemId === 'item.heal_tonic');
      const e2 = run(sim, 220, (i) => (i === 0 ? press(Btn.Item) : frame()));
      expect(e2.some((e) => e.type === 'item_effect'), w).toBe(false);
      expect(starts(e2).some((a) => a.endsWith('.sheathe')), w).toBe(true);
      expect(sim.player.drawn, w).toBe(false);
      expect(sim.player.hp, w).toBe(50);
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

  it('副は回転斬り: 0.4m 踏み込んで体ごと左へ 1 回転し、左右の剣が 1 回ずつ当たって、元の向きへ戻る', () => {
    const sim = mk('twin_blades');
    placeInFrontOfHead(sim, 1.0);
    const z0 = sim.player.pos.z;
    const yaws: number[] = [];
    const evs: SimEvent[] = [];
    for (let i = 0; i < 60; i++) {
      sim.step(i === 0 ? press(Btn.Sub) : frame());
      evs.push(...sim.drainEvents());
      yaws.push(sim.player.yaw);
    }
    expect(starts(evs)).toEqual(['player.twin_blades.round']);
    expect(hits(evs).map((h) => h.windowId)).toEqual(['blade_r', 'blade_l']);
    // 回る途中は後ろを向き（|yaw| が 90° を超える）、回り終えると元の向き
    expect(Math.max(...yaws.map(Math.abs))).toBeGreaterThan(Math.PI / 2);
    expect(Math.abs(sim.player.yaw)).toBeLessThan(1e-6);
    expect(sim.player.pos.z - z0).toBeGreaterThan(0.3);
    expect(sim.player.mode).toBe('free');
  });

  it('主と副の同時押しは突き込み（2 回当たる）。猛りの間は、連ね斬り（5 回当たる）に替わる', () => {
    const normal = mk('twin_blades');
    placeInFrontOfHead(normal, 0.9);
    const a = run(normal, 60, (i) => (i === 0 ? press(Btn.Main | Btn.Sub) : frame()));
    expect(starts(a)).toEqual(['player.twin_blades.stab']);
    expect(hits(a)).toHaveLength(2);

    const demon = mk('twin_blades');
    placeInFrontOfHead(demon, 0.9);
    demon.player.demon = true;
    const b = run(demon, 100, (i) => (i === 0 ? press(Btn.Main | Btn.Sub) : frame()));
    expect(starts(b)).toEqual(['player.twin_blades.flurry']);
    expect(hits(b)).toHaveLength(5);
    // 押し遅れ（主の 2 tick 後に副）でも、同じく替わる
    const late = mk('twin_blades');
    placeInFrontOfHead(late, 0.9);
    late.player.demon = true;
    const c = run(late, 10, (i) => (i === 0 ? press(Btn.Main) : i === 2 ? press(Btn.Sub) : frame()));
    expect(starts(c)).toEqual(['player.twin_blades.slash1', 'player.twin_blades.flurry']);
  });

  it('固有ボタンで猛りに入り、もう 1 度押すと解ける。入っている間はスタミナが減り続けて戻らない', () => {
    const D = content.families.get('twin_blades')!.demon!;
    const sim = mk('twin_blades');
    sim.player.drawn = true;
    const on = run(sim, 1, () => press(Btn.Special));
    expect(starts(on)).toEqual(['player.twin_blades.demon_on']);
    expect(on.filter((e) => e.type === 'demon')).toEqual([{ type: 'demon', on: true, reason: 'toggle' }]);
    expect(sim.player.demon).toBe(true);
    // 2 秒で staminaPerSec × 2 だけ減る（待ち時間が過ぎても戻らない）
    const st0 = sim.player.stamina;
    run(sim, 120);
    expect(st0 - sim.player.stamina).toBeCloseTo(D.staminaPerSec * 2, 5);
    const off = run(sim, 1, () => press(Btn.Special));
    expect(starts(off)).toEqual(['player.twin_blades.demon_off']);
    expect(off.filter((e) => e.type === 'demon')).toEqual([{ type: 'demon', on: false, reason: 'toggle' }]);
    expect(sim.player.demon).toBe(false);
    // 解いた後は、待ち時間を置いて戻る
    const st1 = sim.player.stamina;
    run(sim, 120);
    expect(sim.player.stamina).toBeGreaterThan(st1 + 10);
  });

  it('猛りは、連係の後半からも入れる。猛りの間は、同じ技の威力が上がる', () => {
    const sim = mk('twin_blades');
    placeInFrontOfHead(sim, 0.9);
    const evs = run(sim, 40, (i) => (i === 0 ? press(Btn.Main) : i === 15 ? press(Btn.Special) : frame()));
    expect(starts(evs)).toEqual(['player.twin_blades.slash1', 'player.twin_blades.demon_on']);
    expect(sim.player.demon).toBe(true);
    const dmg = (demon: boolean): number => {
      const s1 = mk('twin_blades');
      placeInFrontOfHead(s1, 0.9);
      s1.player.demon = demon;
      return hits(run(s1, 30, (i) => (i === 0 ? press(Btn.Main) : frame())))[0]!.damage;
    };
    const base = dmg(false), up = dmg(true);
    const scale = content.families.get('twin_blades')!.demon!.damageScale;
    expect(up).toBeGreaterThan(base);
    expect(up).toBeLessThanOrEqual(Math.ceil(base * scale) + 1);
  });

  it('スタミナが尽きると猛りは解け、空のままでは入れない', () => {
    const sim = mk('twin_blades');
    sim.player.drawn = true;
    sim.player.demon = true;
    sim.player.stamina = 0.05;
    const evs = run(sim, 3);
    expect(sim.player.demon).toBe(false);
    expect(evs.filter((e) => e.type === 'demon')).toEqual([{ type: 'demon', on: false, reason: 'stamina' }]);
    sim.player.stamina = 0;
    sim.player.staminaDelay = 9999;
    const again = run(sim, 2, (i) => (i === 0 ? press(Btn.Special) : frame()));
    expect(starts(again)).toEqual([]);
    expect(again.some((e) => e.type === 'stamina_empty')).toBe(true);
    expect(sim.player.demon).toBe(false);
  });

  it('納刀を始めると猛りは解ける。被弾しても解けない', () => {
    const sim = mk('twin_blades');
    sim.player.drawn = true;
    sim.player.demon = true;
    const evs = run(sim, 1, () => press(Btn.Weapon));
    expect(starts(evs)).toEqual(['player.twin_blades.sheathe']);
    expect(evs.filter((e) => e.type === 'demon')).toEqual([{ type: 'demon', on: false, reason: 'sheathe' }]);

    const hit = underSlam('twin_blades');
    hit.player.demon = true;
    const h = run(hit, 120);
    expect(h.some((e) => e.type === 'player_hurt')).toBe(true);
    expect(hit.player.demon).toBe(true);
  });
});

describe('大槌', () => {
  it('主ボタンを続けて押すと、叩きつけ → 叩きつけ（二）→ 振り上げ とつながり、どれも打撃で頭に当たる（v0.55.0）', () => {
    const sim = mk('war_maul');
    placeInFrontOfHead(sim, 1.2);
    const evs = run(sim, 200, (i) => (i % 10 === 0 ? press(Btn.Main) : frame()));
    expect(starts(evs).slice(0, 3)).toEqual(['player.war_maul.smash', 'player.war_maul.smash2', 'player.war_maul.upswing']);
    const h = hits(evs);
    expect(h.length).toBeGreaterThanOrEqual(3);
    expect(h.every((x) => x.windowId === 'head')).toBe(true);
    for (const a of ['smash', 'smash2', 'upswing']) expect(content.actions.get(`player.war_maul.${a}`)!.hitWindows[0]!.damageType).toBe('blunt');
  });

  it('副は構えからの横殴り。連係の途中の副でも横殴りへ移る', () => {
    const sim = mk('war_maul');
    placeInFrontOfHead(sim, 1.2);
    const a = run(sim, 80, (i) => (i === 0 ? press(Btn.Sub) : frame()));
    expect(starts(a)).toEqual(['player.war_maul.swing']);
    expect(hits(a)).toHaveLength(1);
    const b = mk('war_maul');
    placeInFrontOfHead(b, 1.2);
    const c = run(b, 120, (i) => (i === 0 ? press(Btn.Main) : i === 40 ? press(Btn.Sub) : frame()));
    expect(starts(c)).toEqual(['player.war_maul.smash', 'player.war_maul.swing']);
  });

  /** 固有を holdTicks 押し続けて放す。movingAtRelease ならば、放す前後の数 tick だけスティックを横へ倒す（放した tick に倒していれば「動きながら」） */
  const chargeRelease = (holdTicks: number, movingAtRelease = false, after = 160): { starts: string[]; hits: Hit[]; level: number } => {
    const sim = mk('war_maul');
    placeInFrontOfHead(sim, 1.2);
    const evs = run(sim, holdTicks + after, (i) => {
      if (i === 0) return press(Btn.Special);
      const move = movingAtRelease && i >= holdTicks - 4 && i <= holdTicks + 1 ? { moveX: 1 } : {};
      if (i < holdTicks) return frame({ held: Btn.Special, ...move });
      return frame(move);
    });
    const lv = evs.filter((e) => e.type === 'charge_level').map((e) => (e as Extract<SimEvent, { type: 'charge_level' }>).level);
    return { starts: starts(evs), hits: hits(evs), level: lv.length > 0 ? Math.max(...lv) : 0 };
  };

  it('固有を押し続けて溜め、放した時の段階で分かれる: 0・1 = 溜め叩き、2 = 溜め振り上げ、3 で止まっていれば大叩きつけ（2 回）（v0.55.0）', () => {
    const lv1 = chargeRelease(45);
    expect(lv1.level).toBe(1);
    expect(lv1.starts).toEqual(['player.war_maul.charge', 'player.war_maul.charge_smash']);
    expect(lv1.hits).toHaveLength(1);
    const lv2 = chargeRelease(80);
    expect(lv2.level).toBe(2);
    expect(lv2.starts).toEqual(['player.war_maul.charge', 'player.war_maul.charge_upswing']);
    expect(lv2.hits).toHaveLength(1);
    expect(lv2.hits[0]!.damage).toBeGreaterThan(lv1.hits[0]!.damage * 1.3);
    const lv3 = chargeRelease(115);
    expect(lv3.level).toBe(3);
    expect(lv3.starts).toEqual(['player.war_maul.charge', 'player.war_maul.pound']);
    expect(lv3.hits.map((h) => h.windowId)).toEqual(['head1', 'head2']);
    expect(lv3.hits[1]!.damage).toBeGreaterThan(lv2.hits[0]!.damage);
    // すぐ放しても（段階 0）、溜め叩き
    expect(chargeRelease(3).starts).toEqual(['player.war_maul.charge', 'player.war_maul.charge_smash']);
  });

  it('段階 3 で、スティックを倒しながら放すと回転攻撃: 体ごと 2 回転して周りを殴り、締めの叩きつけ（v0.55.0）', () => {
    const r = chargeRelease(115, true, 200);
    expect(r.starts).toEqual(['player.war_maul.charge', 'player.war_maul.spin']);
    const ids = r.hits.map((h) => h.windowId);
    expect(ids).toContain('head');
    expect(ids.filter((x) => x.startsWith('spin')).length).toBeGreaterThanOrEqual(1);
    expect(content.actions.get('player.war_maul.spin')!.spin).toEqual({ from: 12, to: 80, degrees: -720 });
  });

  it('溜めている間は歩け（構えたまま）、スタミナが減って戻らない。回避へ移れる', () => {
    const sim = mk('war_maul');
    sim.player.drawn = true;
    const z0 = sim.player.pos.z;
    run(sim, 70, (i) => (i === 0 ? press(Btn.Special) : frame({ held: Btn.Special, moveZ: 1 })));
    expect(sim.player.action?.def.actionId).toBe('player.war_maul.charge');
    expect(sim.player.pos.z - z0).toBeGreaterThan(0.8);
    expect(sim.player.stamina).toBeLessThan(100 - 5);
    const evs = run(sim, 2, (i) => (i === 0 ? frame({ held: Btn.Special, pressed: Btn.Dodge }) : frame({ held: Btn.Special })));
    expect(starts(evs)).toEqual(['player.common.roll']);
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

  it('副は構えからの突き。突きの後の副で斬り上げ（v0.56.0）', () => {
    const sim = mk('long_blade');
    placeInFrontOfHead(sim, 1.3);
    const evs = run(sim, 80, (i) => (i === 0 || i === 26 ? press(Btn.Sub) : frame()));
    expect(starts(evs)).toEqual(['player.long_blade.thrust', 'player.long_blade.rise']);
  });

  it('下がり斬り（主と副の同時押し。v0.56.0 までは副）は、当てながら後ろへ 2m 跳び退く（v0.16.0。0.5m から広げた）', () => {
    const sim = mk('long_blade');
    placeInFrontOfHead(sim, 1.2);
    const z0 = sim.player.pos.z;
    const evs = run(sim, 60, (i) => (i === 0 ? press(Btn.Main | Btn.Sub) : frame()));
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

  it('当てると気がたまり、固有で気合い斬り 一 → 二 → 三 → 大回り斬り。気合い斬りは気を使い、その命中では気はたまらない（v0.56.0）', () => {
    const S = content.families.get('long_blade')!.spirit!;
    const sim = mk('long_blade');
    placeInFrontOfHead(sim, 1.3);
    const a = run(sim, 40, (i) => (i === 0 ? press(Btn.Main) : frame()));
    expect(hits(a)).toHaveLength(1);
    expect(sim.player.spirit).toBe(S.gainPerHit);
    sim.player.spirit = S.max;
    placeInFrontOfHead(sim, 1.3);
    // 大回り斬りが始まるまで、10 tick ごとに固有を押す
    const evs: SimEvent[] = [];
    for (let i = 0; i < 260; i++) {
      const done = starts(evs).includes('player.long_blade.round');
      sim.step(!done && i % 10 === 0 ? press(Btn.Special) : frame());
      evs.push(...sim.drainEvents());
    }
    expect(starts(evs)).toEqual(['player.long_blade.spirit1', 'player.long_blade.spirit2', 'player.long_blade.spirit3', 'player.long_blade.round']);
    const cost = ['spirit1', 'spirit2', 'spirit3', 'round'].reduce((sum, x) => sum + content.actions.get(`player.long_blade.${x}`)!.spirit!.cost, 0);
    expect(sim.player.spirit).toBeCloseTo(S.max - cost, 5);
    expect(hits(evs).length).toBeGreaterThanOrEqual(4);
    expect(evs.filter((e) => e.type === 'spirit')).toEqual([{ type: 'spirit', full: false }]);
  });

  it('気が無いと気合い斬りは出ない（知らせが出る）。気が満ちている間は威力が上がり、しばらく何もしないと気は減る（v0.56.0）', () => {
    const S = content.families.get('long_blade')!.spirit!;
    const none = mk('long_blade');
    none.player.drawn = true;
    const evs = run(none, 3, (i) => (i === 0 ? press(Btn.Special) : frame()));
    expect(starts(evs)).toEqual([]);
    expect(evs.some((e) => e.type === 'spirit_empty')).toBe(true);
    const dmg = (spirit: number): number => {
      const s1 = mk('long_blade');
      placeInFrontOfHead(s1, 1.3);
      s1.player.spirit = spirit;
      return hits(run(s1, 40, (i) => (i === 0 ? press(Btn.Main) : frame())))[0]!.damage;
    };
    expect(dmg(S.max)).toBeGreaterThan(dmg(S.max - 1));
    const decay = mk('long_blade');
    decay.player.drawn = true;
    decay.player.spirit = 50;
    run(decay, S.decayDelayTicks);
    expect(decay.player.spirit).toBe(50);
    run(decay, 60);
    expect(decay.player.spirit).toBeCloseTo(50 - S.decayPerSec, 5);
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
