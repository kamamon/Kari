// ハンターの動きの組（v0.57.0。D-150）: いまの組（2G の動きを手本に作り直している）と、保留の組 v056（v0.56.0 までの動き）。
// 保留の組は、データ（技・軌道・移動曲線・武器の系統）を public/data/motionsets/v056/、描画の動きを src/render/motionsets/v056.ts に持つ。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ActionDef, ContentIndex, CurveDef, ShapeTrackDef, WeaponFamilyDef } from '../src/data/schemas';
import { ContentError } from '../src/data/validators';
import { Simulation } from '../src/game/sim';
import { CLIPS } from '../src/render/poses';
import { WEAPON_MOTIONS, WEAPON_STANCES } from '../src/render/weaponClipSpecs';
import * as HELD from '../src/render/motionsets/v056';
import { CURRENT_MOTION_SET, MOTION_SETS, appliedMotionSet, motionSetOf, useMotionSet } from '../src/render/motionSet';
import { Btn, baseOptions, frame, loadContent, placeInFrontOfHead, press } from './helpers';

const root = (p: string): string => fileURLToPath(new URL(`../${p}`, import.meta.url));
const json = <T>(p: string): T => JSON.parse(readFileSync(root(`public/data/${p}`), 'utf8')) as T;

describe('ハンターの動きの組（v0.57.0。D-150）', () => {
  it('content.json の組の名前と、設定に並べる組の一覧が合う', () => {
    const index = json<ContentIndex>('content.json');
    expect(index.motionSets?.current).toBe(CURRENT_MOTION_SET);
    const ids = MOTION_SETS.map((m) => m.id);
    expect(ids[0]).toBe(CURRENT_MOTION_SET);
    expect(ids.slice(1).sort()).toEqual(Object.keys(index.motionSets!.held).sort());
    expect(motionSetOf('v056')).toBe('v056');
    expect(motionSetOf('nope')).toBe(CURRENT_MOTION_SET);
    expect(motionSetOf(null)).toBe(CURRENT_MOTION_SET);
  });

  it('保留の組 v056 を読むと、ハンターの技・軌道・移動曲線・武器の系統だけが組のものになる（モンスター・装備・依頼は同じ）', async () => {
    const now = await loadContent();
    const held = await loadContent({ motionSet: 'v056' });
    expect(now.motionSet).toBe(CURRENT_MOTION_SET);
    expect(held.motionSet).toBe('v056');
    const set = json<{ families: string; files: Record<string, string> }>('motionsets/v056/set.json');
    for (const [from, to] of Object.entries(set.files)) {
      const doc = json<{ actions?: ActionDef[]; tracks?: ShapeTrackDef[]; curves?: CurveDef[] }>(to);
      for (const a of doc.actions ?? []) expect(held.actions.get(a.actionId), `${from}: ${a.actionId}`).toEqual(a);
      for (const t of doc.tracks ?? []) expect(held.tracks.get(t.id), `${from}: ${t.id}`).toEqual(t);
      for (const c of doc.curves ?? []) expect(held.curves.get(c.id), `${from}: ${c.id}`).toEqual(c);
    }
    for (const f of json<{ families: WeaponFamilyDef[] }>(set.families).families) expect(held.families.get(f.id)).toEqual(f);
    // ハンター以外は同じ
    expect([...held.monsters.keys()]).toEqual([...now.monsters.keys()]);
    for (const [id, a] of now.actions) if (!id.startsWith('player.')) expect(held.actions.get(id), id).toEqual(a);
    expect([...held.weapons.keys()]).toEqual([...now.weapons.keys()]);
    expect([...held.quests.keys()]).toEqual([...now.quests.keys()]);
    // 同じ系統・同じ技の名前がそろう（組を替えても、装備と保存が同じ ID で働く）
    expect([...held.families.keys()].sort()).toEqual([...now.families.keys()].sort());
  });

  it('知らない組を読もうとすると、読み込みが止まる（黙っていまの組にしない）', async () => {
    await expect(loadContent({ motionSet: 'v999' })).rejects.toBeInstanceOf(ContentError);
  });

  it('保留の組の描画の動き: ハンターのどの技の clip も描ける（解く方式の動きか、キー姿勢）。長さは技と同じ。断岳剣はキー姿勢の方式', async () => {
    const held = await loadContent({ motionSet: 'v056' });
    expect(Object.keys(HELD.WEAPON_STANCES)).not.toContain('heavy_blade');
    let solved = 0, keyed = 0;
    for (const a of held.actions.values()) {
      if (!a.actionId.startsWith('player.')) continue;
      const m = HELD.WEAPON_MOTIONS[a.clip];
      if (m) {
        expect(m.dur, a.clip).toBe(a.durationTicks);
        expect(Object.keys(HELD.WEAPON_STANCES), a.clip).toContain(m.family);
        solved++;
      } else {
        expect(CLIPS[a.clip], a.clip).toBeDefined();
        keyed++;
      }
    }
    expect(solved).toBeGreaterThan(50);
    expect(keyed).toBeGreaterThan(10);
  });

  it('描画の動きを組で入れ替えられ、いまの組へ戻せる', async () => {
    const stances = { ...WEAPON_STANCES }, motions = { ...WEAPON_MOTIONS };
    expect(appliedMotionSet()).toBe(CURRENT_MOTION_SET);
    await useMotionSet('v056');
    expect(appliedMotionSet()).toBe('v056');
    expect(WEAPON_STANCES).toEqual(HELD.WEAPON_STANCES);
    expect(WEAPON_MOTIONS).toEqual(HELD.WEAPON_MOTIONS);
    await useMotionSet(CURRENT_MOTION_SET);
    expect(appliedMotionSet()).toBe(CURRENT_MOTION_SET);
    expect(WEAPON_STANCES).toEqual(stances);
    expect(WEAPON_MOTIONS).toEqual(motions);
  });

  it('保留の組でも戦える: 断岳剣の縦斬りと護刃の連係が標的に当たり、同じ入力で同じ結果になる', async () => {
    const held = await loadContent({ motionSet: 'v056' });
    for (const weaponId of ['weapon.heavy_blade.001', 'weapon.guard_blade.001']) {
      const hp: number[] = [];
      for (let k = 0; k < 2; k++) {
        const sim = new Simulation(held, baseOptions({ weaponId }));
        placeInFrontOfHead(sim, 1.2);
        const hp0 = sim.monsters[0]!.hp;
        for (let i = 0; i < 120; i++) {
          sim.step(i === 0 ? press(Btn.Main) : i === 70 ? press(Btn.Main) : frame());
          sim.drainEvents();
        }
        hp.push(sim.monsters[0]!.hp);
        expect(sim.monsters[0]!.hp, weaponId).toBeLessThan(hp0);
      }
      expect(hp[0], weaponId).toBe(hp[1]);
    }
  });
});
