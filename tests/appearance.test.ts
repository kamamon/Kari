// ハンターの外見（v0.28.0。ChatGPT のキャラメイク設計 #10、docs/spec.md の 28 章、D-104〜D-107）。
// 保存の形（版 5）・決定で当てる差分・描くための解決・編集の履歴とランダム・体型の変形・色替えの印と素材。
import { existsSync, readFileSync } from 'node:fs';
import { BufferGeometry, Float32BufferAttribute, ShaderChunk, ShaderLib, Texture, TextureLoader, Uint16BufferAttribute, Vector3, MeshLambertMaterial, type SkinnedMesh } from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  APPEARANCE_DATA_VERSION,
  CUSTOM_PROFILE,
  DraftHistory,
  LEGACY_PROFILE,
  RANDOM_RANGE,
  applyDraft,
  bodyKey,
  changedKinds,
  describeKind,
  draftChanges,
  draftOf,
  emptyDraft,
  legacyAppearance,
  randomDraft,
  resolveAppearance,
  resolveDraft,
  toneSkin,
  validateDraft,
  type AppearanceDoc,
  type AppearanceDraft,
} from '../src/data/appearance';
import type { Content } from '../src/data/schemas';
import { validateAppearanceCatalog } from '../src/data/validators';
import { addAppearanceShader, deformBody, deformPoint, setLookColors } from '../src/render/appearance';
import { PART_HAIR, PART_SKIN, buildHunterBody } from '../src/render/hunterBody';
import { BASE_LOOK, HunterRig } from '../src/render/rig';
import { RuleError, SAVE_SCHEMA_VERSION, newSave, readSave, setAppearance, validateSave, type SaveDoc } from '../src/save/profile';
import { MemoryBackend } from '../src/save/saveDb';
import { SaveManager, type SaveEnv } from '../src/save/saveManager';
import { SLOT_ID } from '../src/save/profile';
import { loadContent } from './helpers';

let content: Content;
beforeAll(async () => {
  content = await loadContent();
});

const stamp = { now: '2026-11-25T00:00:00.000Z', appVersion: 'test', contentVersion: 'test' };
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const B03 = (): NonNullable<AppearanceDraft['body']> => ({ presetId: 'B03', axes: { ...content.appearance.bodyPresets.find((p) => p.id === 'B03')!.axes } });
const ORIGINAL = JSON.parse(readFileSync(new URL('../docs/source/chatgpt-hunter-customization-20261125/appearance_catalog_v1.json', import.meta.url), 'utf8')) as Record<string, unknown>;

describe('外見の選べるもの（public/data/appearance.json）', () => {
  it('検査を通る。ID・名前・色・体型の見本の値は、ChatGPT のカタログと同じ（足していない）', () => {
    const a = content.appearance;
    expect(validateAppearanceCatalog(a)).toEqual([]);
    const pick = (k: string): { id: string; label: string; srgbHex?: string }[] => ORIGINAL[k] as { id: string; label: string; srgbHex?: string }[];
    expect(a.skinColors.map((c) => [c.id, c.label, c.hex])).toEqual(pick('skinColors').map((c) => [c.id, c.label, c.srgbHex]));
    expect(a.hairColors.map((c) => [c.id, c.label, c.hex])).toEqual(pick('hairColors').map((c) => [c.id, c.label, c.srgbHex]));
    expect(a.eyeColors.map((c) => [c.id, c.label, c.hex])).toEqual(pick('eyeColors').map((c) => [c.id, c.label, c.srgbHex]));
    expect(a.hairStyles.map((c) => [c.id, c.label])).toEqual(pick('hairStyles').map((c) => [c.id, c.label]));
    expect(a.faces.map((c) => [c.id, c.label])).toEqual(pick('facePresets').map((c) => [c.id, c.label]));
    expect(a.brows.map((c) => [c.id, c.label])).toEqual(pick('browStyles').map((c) => [c.id, c.label]));
    expect(a.presets.map((c) => [c.id, c.label])).toEqual(pick('startingPresets').map((c) => [c.id, c.label]));
    const bodies = ORIGINAL.bodyPresets as { id: string; label: string; authoringDraftValues: Record<string, number> }[];
    expect(a.bodyPresets.map((p) => [p.id, p.label, p.axes])).toEqual(bodies.map((p) => [p.id, p.label, p.authoringDraftValues]));
    const axes = (ORIGINAL.uiAxes as { body: { id: string; label: string }[] }).body;
    expect(a.bodyAxes.map((x) => [x.id, x.label])).toEqual(axes.map((x) => [x.id, x.label]));
    expect([a.skinColors.length, a.hairColors.length, a.hairStyles.length, a.faces.length, a.brows.length, a.eyeColors.length, a.presets.length, a.bodyPresets.length, a.bodyAxes.length]).toEqual([12, 12, 16, 6, 6, 7, 6, 4, 8]);
  });

  it('選べるのは、3D の形と絵があるものだけ: 髪型・顔・眉・目の色・全体の見本は、A のもの（H01・F01・R01・E01・P01）だけ', () => {
    const a = content.appearance;
    const ready = (list: { id: string; ready?: boolean }[]): string[] => list.filter((x) => x.ready !== false).map((x) => x.id);
    expect(ready(a.hairStyles)).toEqual(['H01']);
    expect(ready(a.faces)).toEqual(['F01']);
    expect(ready(a.brows)).toEqual(['R01']);
    expect(ready(a.eyeColors)).toEqual(['E01']);
    expect(ready(a.presets)).toEqual(['P01']);
    expect(ready(a.skinColors)).toHaveLength(12);
    expect(ready(a.hairColors)).toHaveLength(12);
    // 標準 B02 は全軸 50（= A の体つき。軸を動かし始める時の元）
    expect(Object.values(a.bodyPresets.find((p) => p.id === 'B02')!.axes)).toEqual(Array(8).fill(50));
  });

  it('A の色（色替えの元）は、印の所の絵の平均を測った値で、描く側の初めの値と同じ', () => {
    const m = JSON.parse(readFileSync(new URL('../art-source/player/hunter_mask_v1.measure.json', import.meta.url), 'utf8')) as { skinMeanRgb: number[]; hairMeanRgb: number[]; px: number[]; charts: Record<string, { skinPx: number; hairPx: number }> };
    const hex = (rgb: number[]): string => `#${rgb.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
    expect(content.appearance.base).toEqual({ skin: hex(m.skinMeanRgb), hair: hex(m.hairMeanRgb) });
    expect(BASE_LOOK).toEqual(content.appearance.base);
    // 肌は頭・腕・胴（首もと）・外套に、髪は頭だけにある。服の区画（脚・腰布・足）には無い
    for (const k of ['head', 'armL', 'armR', 'torso']) expect(m.charts[k]!.skinPx, k).toBeGreaterThan(1000);
    expect(m.charts.head!.hairPx).toBeGreaterThan(10000);
    for (const k of ['legL', 'legR', 'skirt', 'footL', 'footR']) expect(m.charts[k]!.skinPx + m.charts[k]!.hairPx, k).toBe(0);
    expect(m.px).toEqual([1024, 1024]);
    expect(existsSync(new URL('../public/assets/textures/hunter/hunter_mask_v1.png', import.meta.url))).toBe(true);
  });
});

describe('保存の版 5: 外見（appearance）', () => {
  it('新しいデータは基準ハンター A。版 4 のデータ（外見が無い）は、開いた時に A を足して版 5 へ（近い色や全軸 50 にしない）', () => {
    const fresh = newSave(content, stamp);
    expect(SAVE_SCHEMA_VERSION).toBe(5);
    expect(fresh.appearance).toEqual({ dataVersion: APPEARANCE_DATA_VERSION, profile: LEGACY_PROFILE, overrides: {} });
    const { appearance: _a, ...v4 } = { ...clone(fresh), schemaVersion: 4 };
    void _a;
    const r = readSave(v4);
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.migratedFrom).toBe(4);
    expect(r.doc.schemaVersion).toBe(5);
    expect(r.doc.appearance).toEqual(legacyAppearance());
    expect(draftOf(r.doc.appearance)).toEqual(emptyDraft());
  });

  it('外見の欄が壊れているデータは読まない（ほかの欄と同じ）。中の値が読めないだけなら、保存はそのまま読み、描く時に A へ代える', () => {
    const doc = clone(newSave(content, stamp)) as unknown as Record<string, unknown>;
    expect(validateSave({ ...doc, appearance: 'x' })).not.toEqual([]);
    expect(validateSave({ ...doc, appearance: { dataVersion: 1 } })).not.toEqual([]);
    const odd = { dataVersion: 1, profile: CUSTOM_PROFILE, skin: { colorId: 'S99', redness: 0, yellowness: 0 }, body: { presetId: 'B03', axes: { shoulderWidth: 140 } } };
    expect(validateSave({ ...doc, appearance: odd })).toEqual([]);
    const r = resolveAppearance(odd, content.appearance);
    expect(r).toMatchObject({ skin: null, hair: null, body: null });
    expect(r.fallback).toEqual(['肌 S99', '体型']);
    // 新しい版の外見データ: 全部 A で描き、編集では書き換えない
    const future = { dataVersion: 2, profile: 'custom_hunter_v2', skin: { colorId: 'S01' } };
    expect(resolveAppearance(future, content.appearance)).toMatchObject({ skin: null, hair: null, body: null, fallback: ['外見の版 2・種類 custom_hunter_v2'] });
    expect(() => setAppearance({ ...newSave(content, stamp), appearance: future }, content, emptyDraft(), { ...emptyDraft(), hairColorId: 'C01' })).toThrow(RuleError);
  });

  it('決定は、編集した種類だけを当てる: 未知の髪型 H99・知らない欄は残り、肌だけが替わる（設計の unknownIdRoundTrip）', () => {
    const saved: AppearanceDoc = { dataVersion: 1, profile: CUSTOM_PROFILE, skin: { colorId: 'S04', redness: 0, yellowness: 0 }, hair: { styleId: 'H99', colorId: 'C03' }, extensions: { futureSkinDetailId: 'SKIN_DETAIL_99' } };
    const doc: SaveDoc = { ...newSave(content, stamp), appearance: saved };
    const start = draftOf(saved);
    expect(start).toEqual({ body: null, skin: { colorId: 'S04', redness: 0, yellowness: 0 }, hairColorId: 'C03' });
    const draft = { ...clone(start), skin: { colorId: 'S08', redness: 0, yellowness: 0 } };
    const next = setAppearance(doc, content, start, draft)!;
    expect(next.appearance).toEqual({ ...saved, skin: { colorId: 'S08', redness: 0, yellowness: 0 } });
    // 描く時は、H99 を A の髪型で代わりに描く（保存値はそのまま）
    expect(resolveAppearance(next.appearance, content.appearance).fallback).toEqual(['髪型 H99']);
    // 持ち物・装備・進行は変えない
    const strip = (d: SaveDoc): unknown => ({ ...d, appearance: null });
    expect(strip(next)).toEqual(strip(doc));
    // 元の doc は変えない
    expect(doc.appearance).toEqual(saved);
  });

  it('A から体型だけを変えて決定 → custom（体型だけ）。全部を A に戻して決定 → legacy（知らない欄は残る）。変わらなければ null', () => {
    const doc = newSave(content, stamp);
    const d1 = { ...emptyDraft(), body: B03() };
    const a1 = setAppearance(doc, content, emptyDraft(), d1)!.appearance;
    expect(a1).toEqual({ dataVersion: 1, profile: CUSTOM_PROFILE, body: B03() });
    const back = applyDraft({ ...a1, note: 'keep' }, d1, emptyDraft());
    expect(back).toEqual({ dataVersion: 1, profile: LEGACY_PROFILE, overrides: {}, note: 'keep' });
    expect(setAppearance(doc, content, emptyDraft(), emptyDraft())).toBeNull();
    // 髪の色を A に戻しても、髪型（未知の ID）は残る
    expect(applyDraft({ dataVersion: 1, profile: CUSTOM_PROFILE, hair: { styleId: 'H07', colorId: 'C05' } }, { ...emptyDraft(), hairColorId: 'C05' }, emptyDraft()).hair).toEqual({ styleId: 'H07' });
  });

  it('決定できない下書き（この版に無い ID・範囲外の数）は RuleError。保存は変えない', () => {
    const doc = newSave(content, stamp);
    const bad: AppearanceDraft[] = [
      { ...emptyDraft(), body: { presetId: 'B03', axes: { ...B03().axes, muscleAmount: 101 } } },
      { ...emptyDraft(), body: { presetId: 'B09', axes: B03().axes } },
      { ...emptyDraft(), skin: { colorId: 'S13', redness: 0, yellowness: 0 } },
      { ...emptyDraft(), skin: { colorId: 'S01', redness: -101, yellowness: 0 } },
      { ...emptyDraft(), hairColorId: 'C13' },
    ];
    for (const d of bad) {
      expect(validateDraft(d, content.appearance)).not.toEqual([]);
      expect(() => setAppearance(doc, content, emptyDraft(), d)).toThrow(RuleError);
    }
    expect(validateDraft({ body: B03(), skin: { colorId: 'S12', redness: 100, yellowness: -100 }, hairColorId: 'C12' }, content.appearance)).toEqual([]);
  });

  it('保存の管理役を通して決定すると、書き込みが完了してから外見が替わり、読み直しても残る', async () => {
    const b = new MemoryBackend();
    const env = (): SaveEnv => ({ now: () => stamp.now, appVersion: 'test' });
    const m = await SaveManager.open(content, b, env());
    const d = { ...emptyDraft(), skin: { colorId: 'S05', redness: 10, yellowness: -5 }, hairColorId: 'C07' };
    expect(await m.setAppearance(emptyDraft(), d)).toEqual({ ok: true });
    expect((b.peek(SLOT_ID) as SaveDoc).appearance).toEqual({ dataVersion: 1, profile: CUSTOM_PROFILE, skin: d.skin, hair: { colorId: 'C07' } });
    const again = await SaveManager.open(content, b, env());
    expect(draftOf(again.doc.appearance)).toEqual(d);
  });
});

describe('描くための解決・名前・編集の履歴・ランダム', () => {
  it('肌の色に赤み・黄みを足す（範囲の端でも 0〜1）。下書きの名前と違いの一覧', () => {
    const base = [0.6, 0.45, 0.35] as const;
    const red = toneSkin(base, 100, 0), yel = toneSkin(base, 0, 100);
    expect(red[0]).toBeGreaterThan(base[0]);
    expect(red[2]).toBeLessThan(base[2]);
    expect(yel[1]).toBeGreaterThan(base[1]);
    expect(yel[2]).toBeLessThan(base[2]);
    for (const v of [...toneSkin([1, 1, 1], 100, 100), ...toneSkin([0, 0, 0], -100, -100)]) expect(v >= 0 && v <= 1).toBe(true);
    const d: AppearanceDraft = { body: { ...B03(), axes: { ...B03().axes, softness: 31 } }, skin: { colorId: 'S10', redness: 5, yellowness: -3 }, hairColorId: 'C09' };
    expect(describeKind('body', d, content.appearance)).toBe('筋肉質（B03・調整あり）');
    expect(describeKind('skin', d, content.appearance)).toBe('深いニュートラルブラウン（S10・赤み +5・黄み −3）');
    expect(describeKind('hairColorId', emptyDraft(), content.appearance)).toBe('A の髪の色');
    expect(draftChanges(emptyDraft(), d, content.appearance).map((c) => `${c.label}：${c.before} → ${c.after}`)).toEqual([
      '体型：A の体つき → 筋肉質（B03・調整あり）',
      '肌：A の肌 → 深いニュートラルブラウン（S10・赤み +5・黄み −3）',
      '髪の色：A の髪の色 → 砂色の金髪（C09）',
    ]);
    const r = resolveDraft(d, content.appearance);
    expect(r.fallback).toEqual([]);
    expect(r.body).toEqual(d.body!.axes);
    expect(r.hair).toEqual([0xc7 / 255, 0xb1 / 255, 0x85 / 255]);
    expect(bodyKey(r.body)).not.toBe('A');
    expect(bodyKey(null)).toBe('A');
  });

  it('元に戻す・やり直す: 50 操作まで。戻した後に新しい操作をすると、やり直しの枝は消える', () => {
    const h = new DraftHistory(50);
    let cur = emptyDraft();
    const step = (i: number): void => {
      h.push(cur);
      cur = { ...clone(cur), hairColorId: `C${String((i % 12) + 1).padStart(2, '0')}` };
    };
    for (let i = 0; i < 51; i++) step(i);
    expect(h.undoCount).toBe(50);
    let n = 0;
    for (let d = h.undo(cur); d; d = h.undo(cur)) {
      cur = d;
      n++;
    }
    expect(n).toBe(50);
    // 51 操作のうち、いちばん古い 1 つは戻せない（1 操作目の後の状態で止まる）
    expect(cur.hairColorId).toBe('C01');
    expect(h.redoCount).toBe(50);
    cur = h.redo(cur)!;
    expect(cur.hairColorId).toBe('C02');
    step(99);
    expect(h.redoCount).toBe(0);
    expect(h.redo(cur)).toBeNull();
  });

  it('ランダム: 固定した種類は変えない。全部を固定すると null。選ぶのは、この版で確かめた範囲だけ', () => {
    let seed = 7;
    const rnd = (): number => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const cur: AppearanceDraft = { body: B03(), skin: { colorId: 'S02', redness: 0, yellowness: 0 }, hairColorId: 'C05' };
    expect(randomDraft(cur, { body: true, skin: true, hairColor: true }, content.appearance, rnd)).toBeNull();
    for (let i = 0; i < 300; i++) {
      const d = randomDraft(cur, { body: false, skin: true, hairColor: false }, content.appearance, rnd)!;
      expect(d.skin).toEqual(cur.skin);
      expect(validateDraft(d, content.appearance)).toEqual([]);
      const p = content.appearance.bodyPresets.find((x) => x.id === d.body!.presetId)!;
      for (const ax of content.appearance.bodyAxes) {
        const v = d.body!.axes[ax.id]!;
        expect(v).toBeGreaterThanOrEqual(RANDOM_RANGE.axisMin);
        expect(v).toBeLessThanOrEqual(RANDOM_RANGE.axisMax);
        expect(Math.abs(v - p.axes[ax.id]!)).toBeLessThanOrEqual(RANDOM_RANGE.axisJitter);
      }
      const s = randomDraft(cur, { body: true, skin: false, hairColor: true }, content.appearance, rnd)!;
      expect(s.body).toEqual(cur.body);
      expect(s.hairColorId).toBe('C05');
      expect(Math.abs(s.skin!.redness)).toBeLessThanOrEqual(RANDOM_RANGE.tone);
      expect(Math.abs(s.skin!.yellowness)).toBeLessThanOrEqual(RANDOM_RANGE.tone);
    }
    // 入力の下書きは変えない
    expect(cur.hairColorId).toBe('C05');
    expect(changedKinds(cur, cur)).toEqual([]);
  });
});

describe('描く側: 体型の変形・色替え', () => {
  it('全軸 50（A の形）は 1 点も動かさない。頭・手・足と高さ（y）は、どの軸でも変えない', () => {
    const fifty = Object.fromEntries(content.appearance.bodyAxes.map((a) => [a.id, 50]));
    const big = Object.fromEntries(content.appearance.bodyAxes.map((a) => [a.id, 100]));
    for (let bone = 0; bone < 17; bone++) {
      for (const p of [[0.1, 1.3, 0.05], [-0.2, 1.0, -0.06], [0.25, 0.4, 0.02]] as [number, number, number][]) {
        expect(deformPoint(...p, bone, fifty)).toEqual(p);
        const q = deformPoint(...p, bone, big);
        expect(q[1]).toBe(p[1]);
        if ([4, 13, 16].includes(bone)) expect(q).toEqual(p);
      }
    }
    // 肩幅を広げると、肩の高さの胴が外へ。腹部の量を増やすと、腹の前が前へ
    expect(deformPoint(0.15, 1.4, 0, 2, { ...fifty, shoulderWidth: 100 })[0]).toBeGreaterThan(0.15 * 1.15);
    expect(deformPoint(0, 1.1, 0.1, 1, { ...fifty, abdomenVolume: 100 })[2]).toBeGreaterThan(0.1 * 1.25);
    expect(deformPoint(0, 1.1, 0.1, 1, { ...fifty, abdomenVolume: 0 })[2]).toBeLessThan(0.1 * 0.8);
    // 首より上（1.53m〜）は、胴の骨でも変えない（頭とのつなぎ目に段を作らない）
    expect(deformPoint(0.05, 1.56, 0.04, 3, big)).toEqual([0.05, 1.56, 0.04]);
  });

  it('骨に重み付けした頂点を、骨の決まりを重みで混ぜて動かす', () => {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute([0.15, 1.4, 0, 0.15, 1.4, 0], 3));
    g.setAttribute('skinIndex', new Uint16BufferAttribute([2, 0, 0, 0, 2, 4, 0, 0], 4));
    g.setAttribute('skinWeight', new Float32BufferAttribute([1, 0, 0, 0, 0.5, 0.5, 0, 0], 4));
    const axes = Object.fromEntries(content.appearance.bodyAxes.map((a) => [a.id, a.id === 'shoulderWidth' ? 100 : 50]));
    deformBody(g, axes);
    const pos = g.getAttribute('position');
    const full = deformPoint(0.15, 1.4, 0, 2, axes)[0];
    expect(pos.getX(0)).toBeCloseTo(full, 6);
    expect(pos.getX(1)).toBeCloseTo((full + 0.15) / 2, 6);
  });

  it('体の部品の印: 耳・親指は肌、髪の束は髪（絵を貼らない部品も、色替えに付いていく）', () => {
    const g = buildHunterBody().build();
    const part = g.getAttribute('aPart');
    let skin = 0, hair = 0;
    for (let i = 0; i < part.count; i++) {
      if (part.getX(i) === PART_SKIN) skin++;
      else if (part.getX(i) === PART_HAIR) hair++;
    }
    expect(skin).toBeGreaterThan(50);
    expect(hair).toBeGreaterThan(50);
  });

  it('色替えの式を、three の Lambert の shader へ差し込める（差し込む所の名前が、いまの three にある）', () => {
    const mat = new MeshLambertMaterial({ map: new Texture() });
    const u = addAppearanceShader(mat, { skin: [0.76, 0.55, 0.43], hair: [0.28, 0.21, 0.16] });
    const shader = { uniforms: {} as Record<string, unknown>, vertexShader: ShaderLib.lambert.vertexShader, fragmentShader: ShaderLib.lambert.fragmentShader };
    mat.onBeforeCompile(shader as never, undefined as never);
    expect(shader.vertexShader).toContain('vTint = aPart;');
    expect(shader.fragmentShader).toContain('retint(diffuseColor.rgb, uSkin');
    expect(shader.fragmentShader).toContain('texture2D(appearanceMask, vMapUv)');
    expect(ShaderChunk.map_fragment).toContain('vMapUv');
    expect(shader.uniforms.uSkinOn).toBe(u.uSkinOn);
    expect(mat.customProgramCacheKey()).toBe('hunter-appearance-v1');
    setLookColors(u, { skin: [1, 0, 0], hair: null });
    expect(u.uSkinOn.value).toBe(1);
    expect(u.uHairOn.value).toBe(0);
    setLookColors(u, { skin: null, hair: null });
    expect(u.uSkinOn.value).toBe(0);
  });

  it('狩人の外見を替えても、骨・関節・socket の位置は変わらない。A に戻すと、体の形は元どおり。防具も同じ決まりで変わる', () => {
    const mock = vi.spyOn(TextureLoader.prototype, 'load').mockImplementation(() => new Texture());
    try {
      const rig = new HunterRig();
      const body = (): SkinnedMesh => rig.root.getObjectByName('hunter_body') as SkinnedMesh;
      const before = Array.from(body().geometry.getAttribute('position').array as Float32Array);
      const joints = (): number[] => {
        rig.root.updateMatrixWorld(true);
        const out: number[] = [];
        const v = new Vector3();
        rig.root.traverse((o) => {
          if (o.type === 'Bone' || o.name.startsWith('socket_')) out.push(...o.getWorldPosition(v).toArray());
        });
        return out;
      };
      const j0 = joints();
      rig.setArmor({ head: 3, chest: 3, arms: 3, waist: 3, legs: 3 });
      const armor0 = Array.from((rig.root.getObjectByName('hunter_armor') as SkinnedMesh).geometry.getAttribute('position').array as Float32Array);
      const look = resolveDraft({ body: { presetId: 'B04', axes: { ...content.appearance.bodyPresets.find((p) => p.id === 'B04')!.axes } }, skin: { colorId: 'S10', redness: 0, yellowness: 0 }, hairColorId: 'C01' }, content.appearance);
      rig.setLook(look, content.appearance.base);
      expect(rig.bodyShapeKey).toBe(bodyKey(look.body));
      expect(rig.lookColors.skin).toEqual(look.skin);
      expect(joints()).toEqual(j0);
      const after = Array.from(body().geometry.getAttribute('position').array as Float32Array);
      expect(after.length).toBe(before.length);
      expect(after).not.toEqual(before);
      // y（高さ）は変わらない
      for (let i = 1; i < after.length; i += 3) expect(after[i]).toBe(before[i]);
      const armor1 = Array.from((rig.root.getObjectByName('hunter_armor') as SkinnedMesh).geometry.getAttribute('position').array as Float32Array);
      expect(armor1).not.toEqual(armor0);
      // 兜と胴の防具を着ている間は、髪の束と外套を描かない（体型を変えた後の形にも当てる）
      expect(rig.hiddenBody).toEqual(['mantle', 'hair']);
      expect(body().geometry.groups.length).toBeGreaterThan(0);
      // 同じ外見をもう一度渡しても、作り直さない
      const g = body().geometry;
      rig.setLook(look);
      expect(body().geometry).toBe(g);
      rig.setLook({ skin: null, hair: null, body: null });
      expect(rig.bodyShapeKey).toBe('A');
      expect(Array.from(body().geometry.getAttribute('position').array as Float32Array)).toEqual(before);
      expect(Array.from((rig.root.getObjectByName('hunter_armor') as SkinnedMesh).geometry.getAttribute('position').array as Float32Array)).toEqual(armor0);
      expect(rig.lookColors).toEqual({ skin: null, hair: null });
    } finally {
      mock.mockRestore();
    }
  });
});
