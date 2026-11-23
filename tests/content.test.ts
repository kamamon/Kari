// npm run assets:validate。ゲームのデータと素材台帳の整合を検査する。
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { SOUND_IDS } from '../src/core/audio';
import type { ActionDef, Content } from '../src/data/schemas';
import { ContentError, assembleContent, validateAction } from '../src/data/validators';
import { sampleTrack } from '../src/game/tracks';
import { clipDuration, hasClip } from '../src/render/poses';
import { loadContent } from './helpers';

interface ManifestAsset {
  id: string;
  type: string;
  status: string;
  path: string | null;
  sourcePath?: string;
  files?: string[];
  owner: string;
  clips?: string[];
  ids?: string[];
  placeholder?: { kind: string; source: string };
  dependsOn?: string[];
}

const root = (p: string): string => fileURLToPath(new URL(`../${p}`, import.meta.url));
const STATUS_3D = ['planned', 'concept', 'modeled', 'rigged', 'animated', 'integrated', 'approved'];
const STATUS_2D = ['planned', 'generated', 'validated', 'integrated', 'approved'];

let content: Content;
let assets: ManifestAsset[];
beforeAll(async () => {
  content = await loadContent();
  assets = (JSON.parse(readFileSync(root('docs/asset-manifest.json'), 'utf8')) as { assets: ManifestAsset[] }).assets;
});

describe('ゲームデータ', () => {
  it('すべての JSON が検証を通る', () => {
    expect(content.actions.size).toBeGreaterThanOrEqual(7);
    expect(content.weapons.has('weapon.heavy_blade.001')).toBe(true);
    expect(content.monsters.has('monster.training_dummy')).toBe(true);
  });

  it('壊れた技データは読み込みで弾かれる', async () => {
    const good = content.actions.get('player.heavy_blade.overhead')!;
    const errs = (patch: Partial<ActionDef>): string[] => {
      const e: string[] = [];
      validateAction({ ...good, ...patch }, e);
      return e;
    };
    expect(errs({})).toEqual([]);
    expect(errs({ durationTicks: 70 }).length).toBeGreaterThan(0); // phases の終わりと不一致
    expect(errs({ phases: [{ id: 'startup', from: 0, to: 20 }, { id: 'active', from: 22, to: 72 }] }).length).toBeGreaterThan(0); // 隙間
    expect(errs({ onFinish: 'somewhere' }).length).toBeGreaterThan(0);
    expect(errs({ hitWindows: [{ ...good.hitWindows[0]!, to: 99 }] }).length).toBeGreaterThan(0);
    // 存在しない曲線を指すデータは、組み立て時に ContentError になる
    const { readFile } = await import('node:fs/promises');
    await expect(
      assembleContent(async (p) => {
        const doc = JSON.parse(await readFile(root(`public/data/${p}`), 'utf8')) as { curves?: unknown[] };
        if (p === 'curves.json') doc.curves = [];
        return doc;
      }),
    ).rejects.toBeInstanceOf(ContentError);
  });

  it('武器の軌道: 技の開始と終了が構えの位置に繋がり、握りが腕の届く範囲にある', () => {
    for (const fam of content.families.values()) {
      for (const id of [fam.actions.main, fam.actions.sub]) {
        const a = content.actions.get(id)!;
        const tr = content.tracks.get(a.weaponTrack!)!;
        for (const t of [0, a.durationTicks]) {
          const s = sampleTrack(tr, t);
          expect([s.grip.x, s.grip.y, s.grip.z]).toEqual(fam.ready.grip);
        }
        expect(tr.to).toBe(fam.blade.to);
        expect(tr.radius).toBe(fam.blade.radius);
      }
    }
    for (const tr of content.tracks.values()) {
      if (!tr.id.startsWith('hb_')) continue;
      for (const k of tr.keys) {
        // 肩はおよそ (∓0.21, 1.46, 0)。上体の傾きを含めても握りは肩から 1m 以内に置く
        expect(Math.hypot(k.grip[0], k.grip[1] - 1.3, k.grip[2])).toBeLessThan(1.0);
      }
    }
  });
});

describe('素材台帳（docs/asset-manifest.json）', () => {
  it('id が重複せず、状態が規定の語で、ファイルが実在する', () => {
    const seen = new Set<string>();
    for (const a of assets) {
      expect(seen.has(a.id), `重複: ${a.id}`).toBe(false);
      seen.add(a.id);
      const flow = a.type === 'model' || a.type === 'env' ? STATUS_3D : STATUS_2D;
      expect(flow, `${a.id} の status`).toContain(a.status);
      expect(a.owner.length, `${a.id} の owner`).toBeGreaterThan(0);
      // 存在しないファイルを素材として登録しない
      if (a.path !== null) expect(existsSync(root(`public/${a.path}`)), `${a.id}: ${a.path} が無い`).toBe(true);
      if (a.sourcePath) expect(existsSync(root(a.sourcePath)), `${a.id}: 原本 ${a.sourcePath} が無い`).toBe(true);
      for (const f of a.files ?? []) expect(existsSync(root(`${a.sourcePath}/${f}`)), `${a.id}: 原本 ${f} が無い`).toBe(true);
      if (a.path === null && !a.sourcePath) expect(['planned', 'concept'], `${a.id}: ファイルが無いのに ${a.status}`).toContain(a.status);
      if (a.placeholder) expect(existsSync(root(a.placeholder.source.split(' ')[0]!)), `${a.id} の仮素材の出所`).toBe(true);
      for (const d of a.dependsOn ?? []) expect(assets.some((x) => x.id === d), `${a.id} の依存先 ${d}`).toBe(true);
    }
  });

  it('ゲームが参照する assetId は台帳にあり、ファイルか仮素材のどちらかを持つ', () => {
    const used = [...[...content.weapons.values()].map((w) => w.assetId), ...[...content.monsters.values()].map((m) => m.assetId)];
    for (const id of used) {
      const a = assets.find((x) => x.id === id);
      expect(a, `台帳に無い: ${id}`).toBeDefined();
      expect(a!.path !== null || a!.placeholder !== undefined, `${id} は実体が無い`).toBe(true);
    }
  });

  it('技データの clip は台帳に載っていて、仮アニメーションにも欠落が無く、長さが一致する', () => {
    const listed = new Set(assets.flatMap((a) => a.clips ?? []));
    for (const a of content.actions.values()) {
      expect(listed.has(a.clip), `台帳に無い clip: ${a.clip}`).toBe(true);
      if (a.actionId.startsWith('player.')) {
        expect(hasClip(a.clip), `仮アニメーションに無い clip: ${a.clip}`).toBe(true);
        expect(clipDuration(a.clip), `${a.clip} の長さ`).toBe(a.durationTicks);
      }
    }
  });

  it('技データの sound は、鳴らせる音の一覧と台帳の仮素材一覧にある', () => {
    const synth = assets.find((a) => a.id === 'audio.se.placeholder_synth')!;
    expect([...synth.ids!].sort()).toEqual([...SOUND_IDS].sort());
    for (const a of content.actions.values()) {
      for (const e of a.events) if (e.type === 'sound') expect(SOUND_IDS as readonly string[], `${a.actionId} の音 ${e.id}`).toContain(e.id);
    }
    for (const m of content.monsters.values()) for (const p of m.parts) expect(SOUND_IDS as readonly string[]).toContain(`hit_${p.material}`);
  });
});
