// モンスターの登録簿（図鑑）と、ChatGPT の案の取り込み（v0.13.0、docs/spec.md 20 章）。
// 案は機械で検査し、決まりに合わない種が 1 つでもあれば、登録簿は変えない。
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { bestiaryCounts, mergeBestiary, validateBestiary, type BestiaryDef, type BestiaryEnv, type SpeciesDef } from '../src/data/bestiary';
import type { Content } from '../src/data/schemas';
import { loadContent } from './helpers';

let content: Content;
let env: BestiaryEnv;
let sample: { species: Partial<SpeciesDef>[]; frames: unknown[] };
beforeAll(async () => {
  content = await loadContent();
  env = { ranks: [...content.ranks.values()].sort((a, b) => a.order - b.order).map((r) => r.id), playable: new Set(content.monsters.keys()) };
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

describe('登録簿のデータ', () => {
  it('いまの大型 13 種が入っていて、検査に通る。どれも初級から。遊べるのはガルドロスだけ', () => {
    const b = content.bestiary;
    expect(validateBestiary(b, env)).toEqual([]);
    expect(b.species.length).toBe(13);
    expect(b.species.every((s) => s.rank === 'rank.1' && s.class === 'large' && s.variant === 'base')).toBe(true);
    expect(b.species.filter((s) => s.state === 'implemented').map((s) => s.id)).toEqual(['monster.galdros']);
    expect(b.species.filter((s) => s.state === 'art').length).toBe(12);
    expect(b.species.map((s) => s.no)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  });

  it('目標の数: 初級 13、中級 +20、上級 +25、極級 +20（合わせて 78 種）', () => {
    expect(content.bestiary.plan).toEqual({ 'rank.1': 13, 'rank.2': 20, 'rank.3': 25, 'rank.4': 20 });
    const c = bestiaryCounts(content.bestiary, env.ranks);
    expect(c.map((x) => [x.have, x.plan])).toEqual([[13, 13], [0, 20], [0, 25], [0, 20]]);
  });

  it('ガルドロスは無属性で、弱点は火、雷に強い。火の持ち主はエンバルグ', () => {
    const g = content.bestiary.species.find((s) => s.id === 'monster.galdros')!;
    expect([g.elements, g.weak, g.resist]).toEqual([['none'], ['fire'], ['thunder']]);
    expect(content.bestiary.species.filter((s) => s.elements.includes('fire')).map((s) => s.name)).toEqual(['エンバルグ']);
  });

  it('依頼の標的は、どれも登録簿にある。骨格は 7 つで、体を作ってあるのは四足重獣だけ', () => {
    for (const q of content.quests.values()) expect(content.bestiary.species.some((s) => s.id === q.targetMonsterId), q.id).toBe(true);
    expect(content.bestiary.frames.map((f) => f.id)).toEqual(['frame.quad_heavy', 'frame.quad_light', 'frame.biped_wing', 'frame.crust_six', 'frame.crust_many', 'frame.long', 'frame.colossus']);
    expect(content.bestiary.frames.filter((f) => f.built).map((f) => f.name)).toEqual(['四足重獣']);
  });

  it('「実装済み」と書いた種が、遊べるデータに無ければ、検査で分かる', () => {
    const b = base();
    b.species[1]!.state = 'implemented';
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
    expect(added.map((s) => s.no)).toEqual([14, 15, 16]);
    expect(added.every((s) => s.state === 'planned' && s.source === 'chatgpt:test')).toBe(true);
    expect(r.bestiary.frames.find((f) => f.id === 'frame.test_hopper')).toMatchObject({ name: '跳脚獣', built: false });
    expect(validateBestiary(r.bestiary, env)).toEqual([]);
    // 数: 中級に 2 種（原種 1・亜種 1）。幼体は、種の数に入れない
    const c = bestiaryCounts(r.bestiary, env.ranks);
    expect(c[1]).toMatchObject({ have: 2, large: 2, subspecies: 1 });
    expect(c[0]).toMatchObject({ have: 13, juveniles: 1 });
    // もとの登録簿は変えない
    expect(content.bestiary.species.length).toBe(13);
  });

  it('いまある種の書き直し（生態を足す）は、番号・状態・原画の印を残して、上書きする', () => {
    const inc = { species: [{ ...clone(content.bestiary.species[1]!), organ: '帆のように開く角膜', moves: ['横跳び', '風圧', '角膜の突き'], parts: ['頭', '角膜'], gear: '帆膜・弾性腱 / 回避', state: 'implemented' as const, art: 'x.png',
      ecology: { diet: 'a。', behavior: 'b。', territory: 'c。', rhythm: 'd。', nest: 'e。', relations: 'f。', juvenile: 'g。', signs: 'h。' } }] };
    const r = mergeBestiary(base(), inc, env, 'chatgpt:test');
    expect(r.errors).toEqual([]);
    expect(r.updated).toEqual(['monster.selvark']);
    const s = r.bestiary.species.find((x) => x.id === 'monster.selvark')!;
    expect(s.ecology!.diet).toBe('a。');
    // 案の側で「実装済み」「原画」と書いてあっても、事実は変えない
    expect([s.no, s.state, s.art]).toEqual([2, 'art', 'monster_02_selvark_concept_v2.png']);
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
    expect(r.bestiary.species.length).toBe(13);
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

  it('--check: いまの登録簿を検査して、段階ごとの数と、あと何種かを出す', () => {
    const r = run('--check');
    expect(r.code).toBe(0);
    expect(r.out).toContain('登録簿は決まりどおりです（13 種）');
    expect(r.out).toContain('中級: 0 / 20 種（あと 20）');
  });

  it('--dry: 前後に文章が付いた案でも読めて、足す種を出す。登録簿のファイルは変えない', () => {
    const before = readFileSync('public/data/bestiary.json', 'utf8');
    const r = run('tests/fixtures/bestiary-sample.json', '--dry', '--source', 'chatgpt:検査');
    expect(r.code).toBe(0);
    expect(r.out).toContain('足す種 3、書き換える種 0');
    expect(r.out).toContain('+  014 試跳獣 テストホップ（中級・大型）');
    expect(r.out).toContain('+  016 岩殻仔 ガルドロスの幼体（初級・幼体）');
    expect(r.out).toContain('（--dry: 書き込んでいません）');
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
