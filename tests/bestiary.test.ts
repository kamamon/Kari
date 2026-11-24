// モンスターの登録簿（図鑑）と、ChatGPT の案の取り込み（v0.13.0、docs/spec.md 20 章）。
// v0.15.0: 依頼 9 の返事（86 種と、狩場の案 14）を取り込んだ。狩場の案（fields）も、登録簿に持つ。
// 案は機械で検査し、決まりに合わない種が 1 つでもあれば、登録簿は変えない。
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { bestiaryCounts, mergeBestiary, validateBestiary, type BestiaryDef, type BestiaryEnv, type FieldPlan, type SpeciesDef } from '../src/data/bestiary';
import type { Content } from '../src/data/schemas';
import { loadContent } from './helpers';

let content: Content;
let env: BestiaryEnv;
let sample: { species: Partial<SpeciesDef>[]; frames: unknown[]; fields: Partial<FieldPlan>[] };
beforeAll(async () => {
  content = await loadContent();
  env = { ranks: [...content.ranks.values()].sort((a, b) => a.order - b.order).map((r) => r.id), playable: new Set(content.monsters.keys()), fieldIds: new Set(content.fields.keys()) };
  const text = readFileSync(new URL('./fixtures/bestiary-sample.json', import.meta.url), 'utf8');
  sample = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as typeof sample;
});
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const base = (): BestiaryDef => clone(content.bestiary);
/** 案の 1 種だけを書き換えて、取り込んだ時の理由を返す */
const reject = (edit: (s: Partial<SpeciesDef>, all: Partial<SpeciesDef>[]) => void, index = 0): string => {
  const inc = clone(sample);
  edit(inc.species[index]!, inc.species);
  const r = mergeBestiary(base(), inc, env, 'test');
  expect(r.bestiary).toEqual(content.bestiary); // 断った時は、何も変えない
  return r.errors.join('\n');
};

/** はじめの 13 種（初級の大型）。id・番号・名前・骨格・原画は、案を取り込んでも変えない */
const FIRST_13: [string, string, string, string | null][] = [
  ['monster.galdros', '岩殻獣 ガルドロス', 'frame.quad_heavy', null],
  ['monster.selvark', '帆角獣 セルヴァルク', 'frame.quad_light', 'monster_02_selvark_concept_v2.png'],
  ['monster.numeradon', '泥冠獣 ヌメラドン', 'frame.quad_heavy', 'monster_03_numeradon_concept_v2.png'],
  ['monster.bornakel', '鐘嚢獣 ボルナケル', 'frame.quad_heavy', 'monster_04_bornakel_concept_v2.png'],
  ['monster.ashreia', '灰帷鳥 アシュレイア', 'frame.biped_wing', 'monster_05_ashreia_concept_v2.png'],
  ['monster.lumisca', '燐尾鳥 ルミスカ', 'frame.biped_wing', 'monster_06_lumisca_concept_v2.png'],
  ['monster.orglass', '硝殻蟹 オルグラス', 'frame.crust_six', 'monster_07_orglass_concept_v2.png'],
  ['monster.tengaro', '鉤輪蟲 テンガロ', 'frame.crust_many', 'monster_08_tengaro_concept_v2.png'],
  ['monster.verito', '絹霧蟲 ヴェリト', 'frame.crust_many', 'monster_09_verito_concept_v2.png'],
  ['monster.razmer', '環骨蛇 ラズメル', 'frame.long', 'monster_10_razmer_concept_v2.png'],
  ['monster.kirisave', '氷帆蛇 キリサーヴ', 'frame.long', 'monster_11_kirisave_concept_v2.png'],
  ['monster.velgait', '霧灯獣 ヴェルガイト', 'frame.quad_light', 'monster_12_velgait_concept_v2.png'],
  ['monster.embarg', '熾炉獣 エンバルグ', 'frame.quad_heavy', 'monster_13_embarg_concept_v2.png'],
];

describe('登録簿のデータ', () => {
  it('86 種（成体 78・幼体 8）が入っていて、どの種も、生態 8 項目・器官・部位・素材までそろっている。遊べるのは、はじめの 12 種（v0.17.0）', () => {
    const b = content.bestiary;
    expect(validateBestiary(b, env)).toEqual([]);
    // 受け取る案と同じ厳しさで、全部の種を見ても、合わない所が無い
    expect(validateBestiary(b, env, () => true)).toEqual([]);
    expect(b.species.length).toBe(86);
    expect(b.species.filter((s) => s.class !== 'juvenile').length).toBe(78);
    expect(b.species.filter((s) => s.class === 'juvenile').length).toBe(8);
    expect(b.species.filter((s) => s.state === 'implemented').map((s) => s.no)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(b.species.filter((s) => s.state === 'art').map((s) => s.id)).toEqual(['monster.embarg']);
    expect(b.species.filter((s) => s.state === 'planned').length).toBe(73);
    expect(b.species.map((s) => s.no)).toEqual(Array.from({ length: 86 }, (_, i) => i + 1));
  });

  it('はじめの 13 種は、id・番号・名前・骨格・原画・段階が、案を取り込む前のまま', () => {
    const first = content.bestiary.species.slice(0, 13);
    expect(first.map((s) => [s.id, `${s.title} ${s.name}`, s.frame, s.art ?? null])).toEqual(FIRST_13);
    expect(first.every((s) => s.rank === 'rank.1' && s.class === 'large' && s.variant === 'base')).toBe(true);
  });

  it('数は、計画どおり: 初級 13、中級 20（亜種 8・超大型 3）、上級 25（希少種 8・亜種 5・超大型 3）、極級 20（希少種 5・超大型 4）', () => {
    expect(content.bestiary.plan).toEqual({ 'rank.1': 13, 'rank.2': 20, 'rank.3': 25, 'rank.4': 20 });
    const c = bestiaryCounts(content.bestiary, env.ranks);
    expect(c.map((x) => [x.have, x.plan])).toEqual([[13, 13], [20, 20], [25, 25], [20, 20]]);
    expect(c.map((x) => [x.subspecies, x.rare, x.huge, x.juveniles])).toEqual([[0, 0, 0, 8], [8, 0, 3, 0], [5, 8, 3, 0], [0, 5, 4, 0]]);
  });

  it('ガルドロスは無属性で、弱点は火、雷に強い。初級の火の持ち主はエンバルグだけ', () => {
    const g = content.bestiary.species.find((s) => s.id === 'monster.galdros')!;
    expect([g.elements, g.weak, g.resist]).toEqual([['none'], ['fire'], ['thunder']]);
    expect(content.bestiary.species.filter((s) => s.rank === 'rank.1' && s.class === 'large' && s.elements.includes('fire')).map((s) => s.name)).toEqual(['エンバルグ']);
  });

  it('複合属性は、上級に 3 種、極級に 8 種。幼体は 8 種とも、初級の大型の子で、群れの数を持つ', () => {
    const sp = content.bestiary.species;
    const compound = (rank: string): number => sp.filter((s) => s.rank === rank && s.elements.length === 2).length;
    expect([compound('rank.1'), compound('rank.2'), compound('rank.3'), compound('rank.4')]).toEqual([0, 0, 3, 8]);
    const first = new Set(FIRST_13.map((x) => x[0]));
    for (const j of sp.filter((s) => s.class === 'juvenile')) {
      expect(first.has(j.baseId!), j.id).toBe(true);
      expect(j.pack![0], j.id).toBeGreaterThanOrEqual(2);
    }
  });

  it('一緒に出る相手（2 体の狩りの組）は 17 組。どの組も、同じ狩場に居る', () => {
    const sp = content.bestiary.species;
    const byId = new Map(sp.map((s) => [s.id, s]));
    const pairs = new Set<string>();
    for (const s of sp) for (const p of s.pairs ?? []) {
      pairs.add([s.id, p].sort().join(' + '));
      expect(byId.get(p)!.habitat, `${s.id} + ${p}`).toBe(s.habitat);
    }
    expect(pairs.size).toBe(17);
  });

  it('狩場の案は 20。歩けるのは風礫盆地だけ。どの種の狩場も、この一覧にあり、どの狩場にも種が居る', () => {
    const b = content.bestiary;
    expect(b.fields.length).toBe(20);
    expect(b.fields.filter((f) => f.fieldId).map((f) => [f.name, f.fieldId])).toEqual([['風礫盆地', 'field.basin']]);
    const names = new Set(b.fields.map((f) => f.name));
    for (const s of b.species) expect(names.has(s.habitat), s.id).toBe(true);
    for (const f of b.fields) expect(b.species.some((s) => s.habitat === f.name), f.name).toBe(true);
    expect(b.fields.every((f) => f.terrain.length > 5)).toBe(true);
  });

  it('依頼の標的は、どれも登録簿にある。骨格は 7 つで、体を作ってあるのは四足重獣だけ', () => {
    for (const q of content.quests.values()) expect(content.bestiary.species.some((s) => s.id === q.targetMonsterId), q.id).toBe(true);
    expect(content.bestiary.frames.map((f) => f.id)).toEqual(['frame.quad_heavy', 'frame.quad_light', 'frame.biped_wing', 'frame.crust_six', 'frame.crust_many', 'frame.long', 'frame.colossus']);
    expect(content.bestiary.frames.filter((f) => f.built).map((f) => f.name)).toEqual(['四足重獣']);
  });

  it('「実装済み」と書いた種が、遊べるデータに無ければ、検査で分かる', () => {
    const b = base();
    const embarg = b.species.find((s) => s.id === 'monster.embarg')!;
    embarg.state = 'implemented';
    expect(validateBestiary(b, env).join('\n')).toContain('public/data/monsters/ に無い');
  });
});

describe('案の取り込み', () => {
  it('決まりどおりの案（原種・亜種・幼体、新しい骨格）は入る。番号は空きへ付き、状態は「案」になる', () => {
    const r = mergeBestiary(base(), clone(sample), env, 'chatgpt:test');
    expect(r.errors).toEqual([]);
    expect(r.added).toEqual(['monster.test_base', 'monster.test_galdros_sub', 'monster.test_galdros_child']);
    expect(r.updated).toEqual([]);
    const added = r.bestiary.species.filter((s) => s.id.startsWith('monster.test_'));
    expect(added.map((s) => s.no)).toEqual([87, 88, 89]);
    expect(added.every((s) => s.state === 'planned' && s.source === 'chatgpt:test')).toBe(true);
    expect(r.bestiary.frames.find((f) => f.id === 'frame.test_hopper')).toMatchObject({ name: '跳脚獣', built: false });
    expect(validateBestiary(r.bestiary, env)).toEqual([]);
    // 数: 中級に 2 種（原種 1・亜種 1）。幼体は、種の数に入れない
    const c = bestiaryCounts(r.bestiary, env.ranks);
    expect(c[1]).toMatchObject({ have: 22, large: 19, subspecies: 9 });
    expect(c[0]).toMatchObject({ have: 13, juveniles: 9 });
    // 案に書いた新しい狩場も入る（v0.15.0。それまでは、検査を通るのに、黙って捨てていた）
    expect(r.addedFields).toEqual(['試しの原']);
    expect(r.bestiary.fields.find((f) => f.name === '試しの原')).toEqual({ name: '試しの原', terrain: '検査用', mood: '検査用', source: 'chatgpt:test' });
    // もとの登録簿は変えない
    expect(content.bestiary.species.length).toBe(86);
    expect(content.bestiary.fields.length).toBe(20);
  });

  it('いまある種の書き直し（生態を足す）は、番号・状態・原画の印を残して、上書きする', () => {
    const inc = { species: [{ ...clone(content.bestiary.species[1]!), organ: '帆のように開く角膜', moves: ['横跳び', '風圧', '角膜の突き'], parts: ['頭', '角膜'], gear: '帆膜・弾性腱 / 回避', state: 'planned' as const, art: 'x.png',
      ecology: { diet: 'a。', behavior: 'b。', territory: 'c。', rhythm: 'd。', nest: 'e。', relations: 'f。', juvenile: 'g。', signs: 'h。' } }] };
    const r = mergeBestiary(base(), inc, env, 'chatgpt:test');
    expect(r.errors).toEqual([]);
    expect(r.updated).toEqual(['monster.selvark']);
    const s = r.bestiary.species.find((x) => x.id === 'monster.selvark')!;
    expect(s.ecology!.diet).toBe('a。');
    // 案の側で「案」「原画」と書いてあっても、事実（v0.17.0 で実装済み）は変えない
    expect([s.no, s.state, s.art]).toEqual([2, 'implemented', 'monster_02_selvark_concept_v2.png']);
  });

  it('生態・器官・部位・素材が欠けた案は、断る（どの種の、何が無いかを言う）', () => {
    expect(reject((s) => void delete s.ecology)).toContain('monster.test_base（試跳獣 テストホップ）: 生態の「食べ物」（ecology.diet）が無い');
    expect(reject((s) => void (s.ecology!.signs = ''))).toContain('生態の「痕跡」');
    expect(reject((s) => void (s.organ = ''))).toContain('organ');
    expect(reject((s) => void (s.moves = ['1', '2']))).toContain('moves は 3〜8 個');
    expect(reject((s) => void (s.parts = ['頭']))).toContain('parts は 2〜6 個');
    expect(reject((s) => void (s.materials = []))).toContain('materials は 2〜6 個');
  });

  it('段階の決まり: 亜種は中級から、希少種は上級から、超大型は中級から・25m 以上', () => {
    expect(reject((s) => void (s.rank = 'rank.1'), 1)).toContain('亜種は、中級から');
    expect(reject((s) => void (s.variant = 'rare'), 1)).toContain('希少種は、上級から');
    expect(reject((s) => { s.class = 'huge'; s.rank = 'rank.1'; s.size = 30; })).toContain('超大型は、中級から');
    expect(reject((s) => void (s.class = 'huge'))).toContain('全長 25m 以上');
    expect(reject((s) => void (s.size = 30))).toContain('超大型（class: huge）にする');
  });

  it('もとの種の決まり: 亜種・幼体には、もとの種が要り、同じ骨格。幼体は 7 割より小さく、群れの数がある', () => {
    expect(reject((s) => void delete s.baseId, 1)).toContain('baseId（もとの種）が無い');
    expect(reject((s) => void (s.baseId = 'monster.none'), 1)).toContain('baseId（もとの種）が無い');
    expect(reject((s) => void (s.frame = 'frame.long'), 1)).toContain('骨格が、もとの種と違う');
    expect(reject((s) => void (s.baseId = 'monster.test_galdros_sub'), 2)).toContain('原種の成体ではない');
    expect(reject((s) => void (s.size = 7), 2)).toContain('7 割より小さく');
    expect(reject((s) => void delete s.pack, 2)).toContain('pack');
    expect(reject((s) => void (s.pack = [3, 5]))).toContain('pack は、幼体だけ');
    expect(reject((s) => void (s.baseId = 'monster.galdros'))).toContain('原種の成体に baseId は付けない');
  });

  it('属性の決まり: 複合は上級・極級だけ。自分の属性は弱点にしない。弱点と耐性を重ねない。決まった言葉だけ', () => {
    expect(reject((s) => void (s.elements = ['wind', 'ice']))).toContain('複合属性');
    // 上級なら、複合属性でよい
    const upper = clone(sample);
    Object.assign(upper.species[0]!, { rank: 'rank.3', elements: ['wind', 'ice'], resist: [] });
    expect(mergeBestiary(base(), upper, env, 't').errors).toEqual([]);
    expect(reject((s) => void (s.weak = ['wind']))).toContain('自分の属性が弱点');
    expect(reject((s) => void (s.resist = ['fire']))).toContain('弱点と耐性の両方');
    expect(reject((s) => void (s.elements = ['dark' as never]))).toContain('elements は 1〜2 個');
    expect(reject((s) => void (s.statuses = ['burn' as never]))).toContain('statuses が不正');
  });

  it('名前・id・相手の決まり: 重なり、見本の例、居ない相手は断る', () => {
    expect(reject((s) => { s.title = '岩殻獣'; s.name = 'ガルドロス'; })).toContain('同じ名前の種がある');
    expect(reject((s) => void (s.id = 'Monster.Bad'))).toContain('monster.<英小文字・数字・_>');
    expect(reject((s, all) => void (all[1]!.id = s.id!))).toContain('同じ id が 2 つ');
    expect(reject((s) => void (s.id = 'monster.example_base'))).toContain('見本の例');
    expect(reject((s) => void (s.pairs = ['monster.nobody']))).toContain('pairs の相手');
    expect(reject((s) => void (s.frame = 'frame.none'))).toContain('frame "frame.none" が無い');
    expect(mergeBestiary(base(), {}, env, 't').errors).toEqual(['species（種の一覧）が無い']);
  });

  it('1 種でも決まりに合わなければ、ほかの正しい種も入れない（まとめて直してもらう）', () => {
    const inc = clone(sample);
    inc.species[2]!.pack = [1, 99];
    const r = mergeBestiary(base(), inc, env, 't');
    expect(r.errors.length).toBe(1);
    expect(r.added).toEqual([]);
    expect(r.bestiary.species.length).toBe(86);
  });

  it('狩場の決まり: 種の狩場は、狩場の一覧に無ければ断る。地形の無い狩場・見本の例・同じ名前 2 つも断る（どれも、何も入れない）', () => {
    // 新しい狩場の名前を使ったのに、fields に書いていない
    const noField = clone(sample);
    noField.fields = [];
    const r1 = mergeBestiary(base(), noField, env, 't');
    expect(r1.errors.join('\n')).toContain('habitat「試しの原」が、狩場の一覧（fields）に無い');
    expect(r1.bestiary).toEqual(content.bestiary);
    const bad = (edit: (f: Partial<FieldPlan>[]) => void): string => {
      const inc = clone(sample);
      edit(inc.fields);
      const r = mergeBestiary(base(), inc, env, 't');
      expect(r.bestiary).toEqual(content.bestiary);
      expect(r.added).toEqual([]);
      return r.errors.join('\n');
    };
    expect(bad((f) => void delete f[0]!.terrain)).toContain('狩場「試しの原」: terrain（地形）が無い');
    expect(bad((f) => void f.push({ terrain: '名前が無い' }))).toContain('name の無いものがある');
    expect(bad((f) => void f.push({ name: '（新しい狩場の名前を使った時だけ）', terrain: 'x' }))).toContain('見本の例');
    expect(bad((f) => void f.push({ ...f[0]! }))).toContain('同じ名前が 2 つある');
    expect(mergeBestiary(base(), { ...clone(sample), fields: 'x' }, env, 't').errors).toEqual(['fields は、狩場の一覧（配列）にする']);
  });

  it('いまある狩場を書き直す案は、地形と雰囲気だけを替える（歩ける狩場とのつながりは残す）。同じ内容なら、何も変えない', () => {
    const inc = clone(sample);
    inc.fields.push({ name: '風礫盆地', terrain: '草と岩の盆地。書き直し', mood: '風の音', fieldId: 'field.other' } as Partial<FieldPlan>);
    // fieldId は、歩ける狩場に無いものを書いても、案としては断る
    expect(mergeBestiary(base(), inc, env, 't').errors.join('\n')).toContain('fieldId "field.other" の歩ける狩場が無い');
    delete inc.fields[1]!.fieldId;
    const r = mergeBestiary(base(), inc, env, 'chatgpt:test');
    expect(r.errors).toEqual([]);
    expect(r.updatedFields).toEqual(['風礫盆地']);
    expect(r.bestiary.fields.find((f) => f.name === '風礫盆地')).toEqual({ name: '風礫盆地', terrain: '草と岩の盆地。書き直し', mood: '風の音', fieldId: 'field.basin', source: 'chatgpt:test' });
    // 同じ内容を、もう一度
    const again = mergeBestiary(r.bestiary, { species: clone(sample).species.slice(2), fields: [inc.fields[1]!] }, env, 'chatgpt:again');
    expect(again.errors).toEqual([]);
    expect(again.updatedFields).toEqual([]);
    expect(again.bestiary.fields.find((f) => f.name === '風礫盆地')!.source).toBe('chatgpt:test');
  });

  it('登録簿の検査: 狩場の一覧が無い・同じ名前がある・歩ける狩場に無い fieldId は、分かる', () => {
    const b = base();
    b.fields.push({ name: '風礫盆地', terrain: 'x' });
    expect(validateBestiary(b, env).join('\n')).toContain('狩場「風礫盆地」: 同じ名前の狩場がある');
    const c = base();
    c.fields[1]!.fieldId = 'field.nowhere';
    expect(validateBestiary(c, env).join('\n')).toContain('fieldId "field.nowhere" の歩ける狩場が無い');
    const d = base() as Partial<BestiaryDef>;
    delete d.fields;
    expect(validateBestiary(d as BestiaryDef, env).join('\n')).toContain('fields（狩場の一覧）が無い');
  });
});

describe('取り込みの道具（npm run bestiary:import）', () => {
  const run = (...args: string[]): { out: string; code: number } => {
    try {
      return { out: execFileSync('node', ['--experimental-strip-types', '--no-warnings', 'tools/bestiary-import.mjs', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }), code: 0 };
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; status?: number };
      return { out: `${err.stdout ?? ''}${err.stderr ?? ''}`, code: err.status ?? 1 };
    }
  };

  it('--check: いまの登録簿を検査して、段階ごとの数を出す（計画の数に届いているので、「あと何種」は出ない）', () => {
    const r = run('--check');
    expect(r.code).toBe(0);
    expect(r.out).toContain('登録簿は決まりどおりです（86 種、狩場の案 20）');
    expect(r.out).toContain('中級: 20 / 20 種　大型 17・超大型 3・亜種 8・希少種 0');
    expect(r.out).not.toContain('あと');
  });

  it('--dry: 前後に文章が付いた案でも読めて、足す種を出す。登録簿のファイルは変えない', () => {
    const before = readFileSync('public/data/bestiary.json', 'utf8');
    const r = run('tests/fixtures/bestiary-sample.json', '--dry', '--source', 'chatgpt:検査');
    expect(r.code).toBe(0);
    expect(r.out).toContain('足す種 3、書き換える種 0');
    expect(r.out).toContain('+  087 試跳獣 テストホップ（中級・大型）');
    expect(r.out).toContain('+  089 岩殻仔 ガルドロスの幼体（初級・幼体）');
    expect(r.out).toContain('足す狩場 1、書き換える狩場 0');
    expect(r.out).toContain('+  狩場 試しの原');
    expect(r.out).toContain('（--dry: 書き込んでいません）');
    expect(readFileSync('public/data/bestiary.json', 'utf8')).toBe(before);
  });

  it('--out: 別のファイルへ書いて読み直しても、足した種と狩場が残っている。登録簿のファイルは変えない', () => {
    const before = readFileSync('public/data/bestiary.json', 'utf8');
    const out = join(mkdtempSync(join(tmpdir(), 'vh-bestiary-')), 'out.json');
    const r = run('tests/fixtures/bestiary-sample.json', '--out', out);
    expect(r.code).toBe(0);
    expect(r.out).toContain('（登録簿 public/data/bestiary.json は変えていません）');
    const written = JSON.parse(readFileSync(out, 'utf8')) as BestiaryDef;
    expect(written.species.length).toBe(89);
    expect(written.fields.length).toBe(21);
    expect(written.fields.at(-1)).toMatchObject({ name: '試しの原', terrain: '検査用' });
    expect(validateBestiary(written, env)).toEqual([]);
    expect(readFileSync('public/data/bestiary.json', 'utf8')).toBe(before);
  });

  it('書き方の見本（docs/bestiary-template.json）は JSON として読めて、そのまま返されたら断る', () => {
    const t = JSON.parse(readFileSync('docs/bestiary-template.json', 'utf8')) as { species: { id: string }[] };
    expect(t.species.every((s) => s.id.startsWith('monster.example_'))).toBe(true);
    const r = run('docs/bestiary-template.json', '--dry');
    expect(r.code).toBe(1);
    expect(r.out).toContain('見本の例が入っている');
  });
});
