// 響笛・銃槍・軽弩・重弩（v0.80.0。ChatGPT の #39 の案を取り込んだ。D-180。docs/spec.md の 33 章）。
// 状態（演奏・砲弾・弾）の決まりと、simulation を通した動き（当たる・減る・装填・狙う・入力だけで決まる）。
import { beforeAll, describe, expect, it } from 'vitest';
import type { Content } from '../src/data/schemas';
import { newRun } from '../src/game/action';
import type { SimEvent } from '../src/game/events';
import { BIG_SHELL_COOLDOWN_TICKS, BRACE_SHOT_SCALE, EXTRA_FAMILIES, HORN_ATTACK_SCALE, HORN_BUFF_TICKS, changeAmmo, extraEvent, extraText, makeExtraWeapon, resolveExtra, tickExtra, type ExtraWeaponState } from '../src/game/extraWeapons';
import { Simulation, roundDistanceScale } from '../src/game/sim';
import { useMotionSet } from '../src/render/motionSet';
import { WEAPON_MOTIONS, WEAPON_STANCES } from '../src/render/weaponClipSpecs';
import { Btn, baseOptions, frame, loadContent, placeInFrontOfHead, press, run } from './helpers';

let content: Content;
beforeAll(async () => {
  content = await loadContent();
});

type Hit = Extract<SimEvent, { type: 'hit' }>;
const hits = (evs: SimEvent[]): Hit[] => evs.filter((e): e is Hit => e.type === 'hit');
const started = (evs: SimEvent[]): string[] => evs.flatMap((e) => (e.type === 'action_start' ? [e.actionId.split('.').pop()!] : []));
const sounds = (evs: SimEvent[]): string[] => evs.flatMap((e) => (e.type === 'action_event' && e.kind === 'sound' ? [e.id] : []));

function action(s: ExtraWeaponState, name: string): ReturnType<typeof newRun> {
  const def = content.actions.get(`player.${s.family}.${name}`);
  if (!def) throw new Error(`行動が無い: ${name}`);
  return newRun(def, 1, 0);
}
/** 行動の決まる tick（当たりの区間の始め。無ければ後隙の始め）の状態の変化を起こす */
function commit(s: ExtraWeaponState, name: string): { r: ReturnType<typeof newRun>; t: number } {
  const r = action(s, name);
  const t = r.def.phases.find((p) => p.id === 'active')?.from ?? r.def.phases.find((p) => p.id === 'recovery')!.from;
  extraEvent(s, r, t);
  return { r, t };
}
const sim = (family: string, dist: number): Simulation => {
  const s = new Simulation(content, baseOptions({ weaponId: `weapon.${family}.001` }));
  placeInFrontOfHead(s, dist);
  return s;
};
/** 行動が終わるまで待つ（立ちに戻るまで） */
const settle = (s: Simulation, max = 400): SimEvent[] => {
  const out: SimEvent[] = [];
  for (let i = 0; i < max && (s.player.mode !== 'free' || i === 0); i++) out.push(...run(s, 1));
  return out;
};

describe('11 の武器の系統（データ）', () => {
  it('系統は 11、最初から持つ武器も 11。足した 4 系統には、里鍛ち〜輝殻の 5 段と、採集の系列・3 種の系列の武器がある', () => {
    expect([...content.families.keys()]).toEqual(['heavy_blade', 'guard_blade', 'war_maul', 'twin_blades', 'long_blade', 'long_lance', 'ring_bow', ...EXTRA_FAMILIES]);
    expect([...content.weapons.values()].filter((w) => w.starter)).toHaveLength(11);
    for (const family of EXTRA_FAMILIES) {
      const own = [...content.weapons.values()].filter((w) => w.family === family);
      expect(own.filter((w) => !w.series).map((w) => w.id), family).toEqual([1, 2, 3, 4, 5].map((n) => `weapon.${family}.00${n}`));
      expect(own.filter((w) => w.series?.startsWith('gathering.')), family).toHaveLength(8);
      expect(own.filter((w) => w.series?.startsWith('series.')), family).toHaveLength(9);
    }
  });

  it('名前は Kari のもの（響笛・銃槍・軽弩・重弩）。原作の武器種の名前を、系統・武器の名前に使わない', () => {
    expect(EXTRA_FAMILIES.map((f) => content.families.get(f)!.name)).toEqual(['響笛', '銃槍', '軽弩', '重弩']);
    const borrowed = /狩猟笛|ガンランス|ボウガン|ランス|ハンマー|大剣|片手剣/;
    for (const f of content.families.values()) expect(borrowed.test(f.name), f.id).toBe(false);
    for (const w of content.weapons.values()) if ((EXTRA_FAMILIES as readonly string[]).includes(w.family)) expect(borrowed.test(w.name), w.id).toBe(false);
  });

  it('保留の組 v056 でも、4 系統は同じ行動・軌道で読み込める（この 4 系統に、作り直す前の動きは無い）', async () => {
    const held = await loadContent({ motionSet: 'v056' });
    for (const family of EXTRA_FAMILIES) {
      expect(held.families.get(family), family).toEqual(content.families.get(family));
      for (const a of content.actions.values()) if (a.actionId.startsWith(`player.${family}.`)) expect(held.actions.get(a.actionId), a.actionId).toEqual(a);
    }
    // これまでの 7 系統は、保留の組のもの
    expect(held.families.get('guard_blade')).not.toEqual(content.families.get('guard_blade'));
  });

  it('保留の組 v056 の描画: 4 系統の構えと動きは、いまの組のものを使う（保留の組のファイルは変えない）。断岳剣は、これまでどおりキー姿勢の方式', async () => {
    const now = { stances: { ...WEAPON_STANCES }, motions: { ...WEAPON_MOTIONS } };
    await useMotionSet('v056');
    try {
      expect(WEAPON_STANCES.heavy_blade).toBeUndefined();
      expect(WEAPON_STANCES.guard_blade).not.toEqual(now.stances.guard_blade);
      for (const family of EXTRA_FAMILIES) expect(WEAPON_STANCES[family], family).toBe(now.stances[family]);
      for (const a of content.actions.values()) {
        if (!(EXTRA_FAMILIES as readonly string[]).includes(a.actionId.split('.')[1]!)) continue;
        expect(WEAPON_MOTIONS[a.clip], a.clip).toBe(now.motions[a.clip]);
      }
    } finally {
      await useMotionSet('2g');
    }
    expect(Object.keys(WEAPON_STANCES).sort()).toEqual(Object.keys(now.stances).sort());
    expect(WEAPON_STANCES.heavy_blade).toBe(now.stances.heavy_blade);
  });

  it('軽弩・重弩は、固有を押している間は手で狙う（系統の aim）。固有の技・防御は持たない', () => {
    for (const family of ['light_bowgun', 'heavy_bowgun']) {
      const f = content.families.get(family)!;
      expect(f.aim, family).toEqual({ pitchMinDeg: -35, pitchMaxDeg: 55 });
      expect([f.actions.special, f.guard], family).toEqual([undefined, null]);
      expect(content.actions.has(`player.${family}.aim`), family).toBe(false);
    }
  });
});

describe('状態の決まり（src/game/extraWeapons.ts）', () => {
  it('砲弾は、当たりの始めの tick に 1 つだけ減る。空なら砲撃は装填になり、装填で 3 発に戻る。大砲撃は冷却の間は出ない', () => {
    const s = makeExtraWeapon('gunlance')!;
    const { r, t } = commit(s, 'shell');
    expect(s.loaded).toBe(2);
    extraEvent(s, r, t);
    expect(s.loaded).toBe(2);
    s.loaded = 0;
    expect(resolveExtra(s, 'player.gunlance.shell')).toBe('player.gunlance.reload');
    commit(s, 'reload');
    expect(s.loaded).toBe(3);
    commit(s, 'wyvern_fire');
    expect(s.cooldown).toBe(BIG_SHELL_COOLDOWN_TICKS);
    expect(resolveExtra(s, 'player.gunlance.wyvern_fire')).toBe('player.gunlance.guard');
    expect(extraText(s)).toBe('砲弾 3/3 / 冷却 75秒');
  });

  it('速射は弾を 1 つだけ使う。弾の種類を選び直すと、装填するまで射てず、装填しても弾の合計は変わらない。通常弾でなければ速射は 1 発', () => {
    const s = makeExtraWeapon('light_bowgun')!;
    const n = s.loaded;
    const { r, t } = commit(s, 'rapid_fire');
    expect(s.loaded).toBe(n - 1);
    extraEvent(s, r, t);
    expect(s.loaded).toBe(n - 1);
    const total = s.loaded + s.reserve.reduce((a, b) => a + b, 0);
    changeAmmo(s, 1);
    expect(resolveExtra(s, 'player.light_bowgun.fire')).toBe('player.light_bowgun.reload');
    commit(s, 'reload');
    expect(s.loadedKind).toBe(1);
    expect(s.loaded + s.reserve.reduce((a, b) => a + b, 0)).toBe(total);
    expect(resolveExtra(s, 'player.light_bowgun.rapid_fire')).toBe('player.light_bowgun.fire');
    expect(extraText(s)).toBe('貫通弾 3/3 / 予備 27');
  });

  it('演奏の構えで音を 1・2・3 と並べると攻撃、2・3・1 で持久。納刀で構えが解け、力尽きると効き目も消える', () => {
    const s = makeExtraWeapon('hunting_horn')!;
    commit(s, 'play_note1');
    expect(s.notes).toEqual([]); // 構えていなければ、音にならない
    commit(s, 'recital_enter');
    expect(s.recital).toBe(true);
    for (const name of ['play_note1', 'play_note2', 'play_note3']) commit(s, name);
    expect([s.buffKind, s.buff, s.notes]).toEqual(['attack', HORN_BUFF_TICKS, []]);
    for (const name of ['play_note2', 'play_note3', 'play_note1']) commit(s, name);
    expect(s.buffKind).toBe('stamina');
    expect(extraText(s)).toBe('演奏 ― / 持久 60秒');
    tickExtra(s, false, 'free');
    expect(s.recital).toBe(false);
    expect(s.buff).toBe(HORN_BUFF_TICKS - 1);
    tickExtra(s, false, 'dead');
    expect([s.buff, s.buffKind]).toEqual([0, 'none']);
  });

  it('重弩の据え構えは、次の 1 発だけを強める。4 系統のほかの武器は、状態を持たない', () => {
    const s = makeExtraWeapon('heavy_bowgun')!;
    commit(s, 'charge_stance');
    expect(s.brace).toBe(true);
    expect(commit(s, 'fire').r.extraScale).toBe(BRACE_SHOT_SCALE);
    expect(s.brace).toBe(false);
    expect(commit(s, 'fire').r.extraScale).toBe(1);
    expect(makeExtraWeapon('heavy_blade')).toBeNull();
    expect(new Simulation(content, baseOptions()).player.extraWeapon).toBeNull();
  });
});

describe('simulation を通した動き', () => {
  it('響笛: 主の左振りが当たり、主をもう 1 度で右振り（打ち下ろし）へつながる。旋律「攻撃」の間は、同じ技の威力が 1.12 倍', () => {
    const s = sim('hunting_horn', 0.9);
    const first = [...run(s, 1, () => press(Btn.Main)), ...run(s, 44), ...run(s, 1, () => press(Btn.Main)), ...settle(s)];
    expect(started(first)).toEqual(['swing_left', 'swing_right']);
    const plain = hits(first).find((h) => h.actionId.endsWith('swing_left'))!;
    expect(plain.damage).toBeGreaterThan(0);
    // 演奏: 固有で構え、主・副・同時押しで音 1・2・3
    const play = [...run(s, 1, () => press(Btn.Special)), ...settle(s)];
    for (const btn of [Btn.Main, Btn.Sub, Btn.Combo]) play.push(...run(s, 1, () => press(btn)), ...settle(s));
    expect(started(play)).toEqual(['recital_enter', 'play_note1', 'play_note2', 'play_note3']);
    expect(sounds(play).filter((x) => x.startsWith('xw_note'))).toEqual(['xw_note_1', 'xw_note_2', 'xw_note_3']);
    expect(hits(play)).toEqual([]);
    expect(s.player.extraWeapon).toMatchObject({ recital: true, buffKind: 'attack', notes: [] });
    // 構えを解いて、もう 1 度振る
    const again = [...run(s, 1, () => press(Btn.Special)), ...settle(s), ...run(s, 1, () => press(Btn.Main)), ...settle(s)];
    expect(started(again)).toEqual(['recital_exit', 'swing_left']);
    const buffed = hits(again).find((h) => h.actionId.endsWith('swing_left'))!;
    expect(buffed.damage / plain.damage).toBeCloseTo(HORN_ATTACK_SCALE, 1);
  });

  it('銃槍: 砲撃は、肉質に関わらない決まった力（会心なし）で、刃の状態を減らさない。3 発で空になり、4 発目は装填になる', () => {
    const s = sim('gunlance', 1.6);
    const edge0 = s.player.edge;
    const evs: SimEvent[] = [];
    for (let i = 0; i < 4; i++) evs.push(...run(s, 1, () => press(Btn.Sub)), ...settle(s));
    expect(started(evs)).toEqual(['shell', 'shell', 'shell', 'reload']);
    const shells = hits(evs);
    expect(shells).toHaveLength(3);
    const w = content.weapons.get('weapon.gunlance.001')!;
    for (const h of shells) expect([h.damage, h.crit]).toEqual([Math.round(w.attack * 0.37), 0]);
    expect(s.player.edge).toBe(edge0);
    expect(s.player.extraWeapon!.loaded).toBe(3);
    // 突きは刃を使う（減る）
    const thrust = [...run(s, 1, () => press(Btn.Main)), ...settle(s)];
    expect(hits(thrust)).toHaveLength(1);
    expect(s.player.edge).toBeLessThan(edge0);
  });

  it('銃槍: 防御を構えたままの同時押しで大砲撃。撃つと冷却に入り、冷却の間は構え直すだけ。構えたままの副は装填', () => {
    const s = sim('gunlance', 1.8);
    s.player.extraWeapon!.loaded = 1;
    const guard = (n: number, pressed = 0): SimEvent[] => run(s, n, (i) => frame({ held: Btn.Special, pressed: i === 0 ? pressed : 0 }));
    const evs = [...guard(12), ...guard(1, Btn.Combo), ...guard(200)];
    expect(started(evs)).toEqual(['wyvern_fire']);
    expect(hits(evs).map((h) => h.damage)).toEqual([Math.round(content.weapons.get('weapon.gunlance.001')!.attack * 2.5)]);
    expect(s.player.extraWeapon!.cooldown).toBeGreaterThan(BIG_SHELL_COOLDOWN_TICKS - 200);
    const more = [...guard(1, Btn.Combo), ...guard(60), ...guard(1, Btn.Sub), ...guard(120)];
    expect(started(more)).toEqual(['guard', 'reload']);
    expect(hits(more)).toEqual([]);
    expect(s.player.extraWeapon!.loaded).toBe(3);
  });

  it('軽弩: 主で 1 発射つと、弾（round）が銃口から出て標的に当たり、込めた弾が 1 つ減る。空になると主は装填になる', () => {
    const s = sim('light_bowgun', 6);
    const n = s.player.extraWeapon!.loaded;
    const evs = [...run(s, 1, () => press(Btn.Main)), ...run(s, 16)];
    expect(s.projectiles).toHaveLength(1);
    expect(s.projectiles[0]).toMatchObject({ kind: 'round', actionId: 'player.light_bowgun.fire' });
    // 銃口は、体の前・胸の高さ
    expect(s.projectiles[0]!.pos.y).toBeGreaterThan(0.9);
    evs.push(...settle(s), ...run(s, 30));
    expect(hits(evs)).toHaveLength(1);
    expect(hits(evs)[0]!.windowId).toBe('arrow');
    expect(s.player.extraWeapon!.loaded).toBe(n - 1);
    s.player.extraWeapon!.loaded = 0;
    const empty = [...run(s, 1, () => press(Btn.Main)), ...settle(s)];
    expect(started(empty)).toEqual(['reload']);
    expect(sounds(empty)).toEqual(['xw_reload']);
    expect(s.player.extraWeapon!.loaded).toBe(n);
  });

  it('軽弩: 同時押しの速射は、弾 1 つで 3 発。抜いている間の道具の送りで弾の種類を選び、散弾は 3 つに分かれる', () => {
    const s = sim('light_bowgun', 5);
    const n = s.player.extraWeapon!.loaded;
    const rapid = [...run(s, 1, () => press(Btn.Combo)), ...settle(s), ...run(s, 30)];
    expect(started(rapid)).toEqual(['rapid_fire']);
    expect(sounds(rapid).filter((x) => x === 'xw_shot')).toHaveLength(3);
    expect(hits(rapid)).toHaveLength(3);
    expect(s.player.extraWeapon!.loaded).toBe(n - 1);
    // 道具の送り 2 回で散弾（道具の欄は動かない）
    const item0 = s.player.itemIndex;
    run(s, 1, () => press(Btn.ItemNext));
    run(s, 1, () => press(Btn.ItemNext));
    expect([s.player.extraWeapon!.ammo, s.player.itemIndex]).toEqual([2, item0]);
    const spread = [...run(s, 1, () => press(Btn.Main)), ...settle(s)];
    expect(started(spread)).toEqual(['reload']);
    run(s, 1, () => press(Btn.Main));
    run(s, 15);
    expect(s.projectiles).toHaveLength(3);
    expect(new Set(s.projectiles.map((a) => Math.round(Math.atan2(a.vel.x, a.vel.z) * 100))).size).toBe(3);
    // 納刀している間は、道具の送りは道具を選ぶ
    settle(s);
    s.player.drawn = false;
    run(s, 1, () => press(Btn.ItemNext));
    expect(s.player.extraWeapon!.ammo).toBe(2);
  });

  it('軽弩・重弩: 固有を押して狙うと、体が狙いの向きを向いて止まり、射っている間も狙いが続く。弾は狙いの線の当たる所へ飛ぶ', () => {
    for (const family of ['light_bowgun', 'heavy_bowgun']) {
      const s = sim(family, 9);
      const aim = { aimYaw: 0.05, aimPitch: 0.04 };
      run(s, 5, () => frame({ held: Btn.Special, moveX: 1, ...aim }));
      expect(s.player.aim, family).toEqual({ yaw: 0.05, pitch: 0.04 });
      run(s, 1, () => frame({ held: Btn.Special | Btn.Main, pressed: Btn.Main, ...aim }));
      let seen = false;
      for (let i = 0; i < 60 && s.player.mode === 'action'; i++) {
        run(s, 1, () => frame({ held: Btn.Special, ...aim }));
        expect(s.player.aim, `${family} ${i}`).not.toBeNull();
        if (s.projectiles.length && !seen) {
          seen = true;
          const a = s.projectiles[0]!;
          // 右上を狙ったので、弾は右（+X の向きは左なので x が増える側）・上へ向かう
          expect(a.vel.y, family).toBeGreaterThan(0);
          expect(Math.atan2(a.vel.x, a.vel.z), family).toBeGreaterThan(0);
        }
      }
      expect(seen, family).toBe(true);
    }
  });

  it('重弩: 同時押しの据え構えの次の 1 発は 1.12 倍。構えている間は歩みが遅い。弾の威力は 12m までそのまま、遠いと下がる', () => {
    const shot = (brace: boolean): number => {
      const s = sim('heavy_bowgun', 7);
      if (brace) {
        run(s, 1, () => press(Btn.Combo));
        settle(s);
        expect(s.player.extraWeapon!.brace).toBe(true);
      }
      const evs = [...run(s, 1, () => press(Btn.Main)), ...settle(s), ...run(s, 30)];
      expect(s.player.extraWeapon!.brace).toBe(false);
      return hits(evs)[0]!.damage;
    };
    const plain = shot(false), braced = shot(true);
    expect(braced / plain).toBeCloseTo(BRACE_SHOT_SCALE, 1);
    const walk = (brace: boolean): number => {
      const s = sim('heavy_bowgun', 12);
      s.player.extraWeapon!.brace = brace;
      const z0 = s.player.pos.z;
      run(s, 60, () => frame({ moveZ: -1 }));
      return Math.abs(s.player.pos.z - z0);
    };
    expect(walk(true) / walk(false)).toBeCloseTo(0.55, 1);
    expect([roundDistanceScale(3), roundDistanceScale(12), roundDistanceScale(24), roundDistanceScale(60)]).toEqual([1, 1, 0.5, 0.35]);
  });

  it('同じ入力なら、4 系統とも同じ結果になる（状態は入力と tick だけで決まる）', () => {
    for (const family of EXTRA_FAMILIES) {
      const play = (): string => {
        const s = sim(family, family.endsWith('bowgun') ? 6 : 1.4);
        const script = [Btn.Main, Btn.Sub, Btn.Combo, Btn.Special, Btn.Main, Btn.ItemNext, Btn.Sub, Btn.Main, Btn.Dodge, Btn.Combo];
        for (const btn of script) {
          run(s, 1, () => press(btn));
          run(s, 70);
        }
        return s.hash();
      };
      expect(play(), family).toBe(play());
    }
  });
});
