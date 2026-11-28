// ChatGPT が考えたモンスターの案（JSON）を、登録簿 public/data/bestiary.json へ足す（docs/spec.md 20 章）。
// 使い方:
//   npm run bestiary:import -- <案の JSON> [--dry] [--source "chatgpt:依頼 9A"]
//     --dry  = 検査だけして、書き込まない
//     --out <ファイル> = 登録簿ではなく、そのファイルへ書く（試す時・検査用。登録簿は変えない）
//   npm run bestiary:import -- --check        = いまの登録簿を検査して、段階ごとの数を出す
// 案の JSON は { "species": [ ... ], "frames": [ ... ], "fields": [ ... ] }。書き方は docs/bestiary-template.json。
// 1 つでも決まりに合わない種があれば、何も書き込まずに、理由を全部出す（直して、もう一度）。
import { readFileSync, writeFileSync } from 'node:fs';
import { bestiaryCounts, mergeBestiary, validateBestiary, CLASS_NAMES, VARIANT_NAMES } from '../src/data/bestiary.ts';

const root = new URL('../', import.meta.url);
const read = (p) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
const FILE = 'public/data/bestiary.json';
const bestiary = read(FILE);
const ranks = read('public/data/ranks.json').ranks.slice().sort((a, b) => a.order - b.order);
const rankIds = ranks.map((r) => r.id);
const rankName = Object.fromEntries(ranks.map((r) => [r.id, r.name]));
const playable = new Set(read('public/data/content.json').files.monsters.map((f) => read(`public/data/${f}`).id));
const fieldIds = new Set((read('public/data/content.json').files.fields ?? []).map((f) => read(`public/data/${f}`).id));
const env = { ranks: rankIds, playable, fieldIds };

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--source' && args[i - 1] !== '--out');

function report(b) {
  console.log('段階ごとの数（その段階から新しく登場する種。幼体は別）');
  for (const c of bestiaryCounts(b, rankIds)) {
    const left = c.plan - c.have;
    // v0.75.0（D-175）: 数の計画は持たない（モンスターは 1 匹ずつ足す）。plan が、いまの数より多い時だけ、残りを出す
    console.log(`  ${rankName[c.rank]}: ${c.have}${c.plan > c.have ? ` / ${c.plan}` : ''} 種${left > 0 ? `（あと ${left}）` : ''}　大型 ${c.large}・超大型 ${c.huge}・亜種 ${c.subspecies}・希少種 ${c.rare}　幼体 ${c.juveniles}`);
  }
}

if (flag('--check') || !file) {
  const errors = validateBestiary(bestiary, env);
  if (errors.length) {
    console.error(`登録簿に、決まりに合わない所が ${errors.length} 個あります:\n` + errors.map((e) => '  - ' + e).join('\n'));
    process.exit(1);
  }
  console.log(`登録簿は決まりどおりです（${bestiary.species.length} 種、狩場の案 ${bestiary.fields.length}）。`);
  report(bestiary);
  if (!file && !flag('--check')) console.log('\n案を足すには: npm run bestiary:import -- <案の JSON> [--dry]');
  process.exit(0);
}

let incoming;
try {
  // ChatGPT の返事を、そのまま保存した物でも読めるように、最初の { から最後の } までを取り出す
  const text = readFileSync(file, 'utf8');
  const from = text.indexOf('{'), to = text.lastIndexOf('}');
  incoming = JSON.parse(from >= 0 && to > from ? text.slice(from, to + 1) : text);
} catch (e) {
  console.error(`JSON として読めません: ${file}\n  ${e.message}`);
  process.exit(1);
}
const source = opt('--source') ?? `chatgpt:${file.split('/').pop()}`;
const r = mergeBestiary(bestiary, incoming, env, source);
if (r.errors.length) {
  console.error(`取り込めません。決まりに合わない所が ${r.errors.length} 個あります（何も書き込んでいません）:\n` + r.errors.map((e) => '  - ' + e).join('\n'));
  process.exit(1);
}
const line = (id) => {
  const s = r.bestiary.species.find((x) => x.id === id);
  return `  ${String(s.no).padStart(3, '0')} ${s.title} ${s.name}（${rankName[s.rank]}・${CLASS_NAMES[s.class]}${s.variant !== 'base' ? '・' + VARIANT_NAMES[s.variant] : ''}）`;
};
console.log(`足す種 ${r.added.length}、書き換える種 ${r.updated.length}`);
for (const id of r.added) console.log('+' + line(id));
for (const id of r.updated) console.log('~' + line(id));
if ((r.addedFields?.length ?? 0) + (r.updatedFields?.length ?? 0) > 0) {
  console.log(`足す狩場 ${r.addedFields.length}、書き換える狩場 ${r.updatedFields.length}`);
  for (const n of r.addedFields) console.log(`+  狩場 ${n}`);
  for (const n of r.updatedFields) console.log(`~  狩場 ${n}`);
}
report(r.bestiary);
console.log(`  狩場の案: ${r.bestiary.fields.length}（歩けるのは ${r.bestiary.fields.filter((f) => f.fieldId).length}）`);
if (flag('--dry')) {
  console.log('\n（--dry: 書き込んでいません）');
  process.exit(0);
}
// 1 種を 1 行にして書く（差分を読みやすくする）
const b = r.bestiary;
const rows = (list) => list.map((x, i) => '  ' + JSON.stringify(x) + (i < list.length - 1 ? ',' : ''));
const out = ['{', ` "schemaVersion": ${b.schemaVersion},`, ` "note": ${JSON.stringify(b.note)},`, ` "plan": ${JSON.stringify(b.plan)},`, ' "frames": [', ...rows(b.frames), ' ],', ' "fields": [', ...rows(b.fields), ' ],', ' "species": [', ...rows(b.species), ' ]', '}'];
const outFile = opt('--out');
if (outFile) {
  writeFileSync(outFile, out.join('\n') + '\n');
  console.log(`\n${outFile} へ書き込みました（登録簿 ${FILE} は変えていません）。`);
} else {
  writeFileSync(new URL(FILE, root), out.join('\n') + '\n');
  console.log(`\n${FILE} へ書き込みました。npm run assets:validate と npm run test で確かめてください。`);
}
