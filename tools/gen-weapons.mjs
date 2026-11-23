// 護刃・旋鎌・長尖槍・環弓の、技（actions）・軌道（tracks）・移動曲線・体の動きのデータを作る。
//
//   node tools/gen-weapons.mjs
//
// 書き出すもの:
//   public/data/actions/<系統>.json, public/data/tracks/<系統>.json … この道具の出力（手で編集しない）
//   public/data/curves.json … id が "w_" で始まる行だけを入れ替える（ほかの行と書式は変えない）
//   public/data/weapons.json … 各系統の "ready" と防御の "pose" の行だけを入れ替える（構えから計算した値）
//   src/render/weaponClipSpecs.ts … 体の動き（構え・各技のキー）。描画がこれを解いて、体と武器を置く
// 技ごとの中身は tools/weapons/<系統>.mjs。体の解き方は src/render/bodySolve.ts、人にできる範囲の検査は src/render/humanLimits.ts。
// 数値はすべて机上の初期値（docs/weapons.md）。座標はアクターのローカル（m、Y 上、+Z 前、右手側は -X）。
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { B, checkAll, r4, state } from './weapons/lib.mjs';
import { guardBlade } from './weapons/guard_blade.mjs';
import { reapScythe } from './weapons/reap_scythe.mjs';
import { longLance } from './weapons/long_lance.mjs';
import { ringBow } from './weapons/ring_bow.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

guardBlade();
reapScythe();
longLance();
ringBow();

// ---- 書き出し ----
const line = (o) => JSON.stringify(o).replace(/"(\w+)":/g, '"$1": ').replace(/,"/g, ', "');
for (const [id, F] of Object.entries(state.out)) {
  const a = ['{', '  "schemaVersion": 1,', '  "note": "tools/gen-weapons.mjs の出力。手で編集しない。数値は机上の初期値。",', '  "actions": [', F.actions.map((x) => '    ' + line(x)).join(',\n'), '  ]', '}', ''];
  writeFileSync(resolve(ROOT, `public/data/actions/${id}.json`), a.join('\n'));
  const t = ['{', '  "schemaVersion": 1,', '  "note": "tools/gen-weapons.mjs の出力。手で編集しない。体の動き（src/render/weaponClipSpecs.ts）を解いた、毎 tick の握りと向き。アクターのローカル座標（m、Y 上、+Z 前、右手側は -X）。",', '  "tracks": [', F.tracks.map((x) => '    ' + line(x)).join(',\n'), '  ]', '}', ''];
  writeFileSync(resolve(ROOT, `public/data/tracks/${id}.json`), t.join('\n'));
}
// 移動曲線: "w_" で始まる行だけを入れ替える
{
  const p = resolve(ROOT, 'public/data/curves.json');
  const old = readFileSync(p, 'utf8').split('\n');
  const rows = old.filter((l) => !l.includes('"id": "w_'));
  const end = rows.findIndex((l) => l.trim() === ']');
  rows[end - 1] = rows[end - 1].replace(/,?\s*$/, ',');
  const add = state.curves.map((c) => `{"id": "${c.id}", "keys": ${JSON.stringify(c.keys).replace(/,/g, ', ')}}`);
  rows.splice(end, 0, ...add.map((l, i) => `    ${l}${i < add.length - 1 ? ',' : ''}`));
  writeFileSync(p, rows.join('\n'));
}
// 構えの握り（weapons.json の ready と、防御の pose）: 構えを解いた値で、その行だけを入れ替える
{
  const p = resolve(ROOT, 'public/data/weapons.json');
  const rows = readFileSync(p, 'utf8').split('\n');
  for (const fam of Object.values(state.stances)) {
    const at = rows.findIndex((l) => l.includes(`"id": "${fam.id}"`));
    const next = rows.findIndex((l, i) => i > at && /^\s{4}\{\s*$/.test(l));
    const put = (key, st) => {
      const s = B.solveBody(st.ctl, st.feet.L, st.feet.R, fam.hands);
      const i = rows.findIndex((l, k) => k > at && (next < 0 || k < next) && l.includes(`"${key}": {`) && l.includes('"grip"'));
      if (i < 0) throw new Error(`weapons.json: ${fam.id} の ${key} の行が見つからない`);
      const f = (v) => `[${v.map((x) => r4(x)).join(', ')}]`;
      rows[i] = rows[i].replace(/\{.*\}/, `{ "grip": ${f(s.weapon.grip)}, "dir": ${f(s.weapon.dir)}, "planeNormal": ${f(s.weapon.normal)} }`);
    };
    put('ready', fam.stances.idle);
    if (fam.stances.guard) put('pose', fam.stances.guard);
  }
  writeFileSync(p, rows.join('\n'));
}
// 体の動き
{
  const num = (k, v) => (typeof v === 'number' ? r4(v) : v);
  const js = (o) => JSON.stringify(o, num);
  const ts = [
    '// 生成物（tools/gen-weapons.mjs）。手で編集しない。',
    '// 護刃・旋鎌・長尖槍・環弓の体の動き: 構え（立ち姿）と、技ごとのキー。解き方は bodySolve.ts。',
    "import type { Ctl, Foot, Hands, Motion } from './bodySolve';",
    "import type { WeaponShape } from './humanLimits';",
    '',
    'export interface Stance { ctl: Ctl; feet: { L: Foot; R: Foot } }',
    '/** 武器系統ごとの持ち方と立ち姿（idle = 抜刀して構えた姿、guard = 防御、sheathed = 納刀）と、自分の体と重なってはいけない武器の範囲 */',
    '/** 納めた時の武器の置き場所: 付く骨、その骨の座標での握りの位置、武器の向き（+Y）、武器の +X の向き */',
    "export interface Sheath { parent: 'chest' | 'pelvis'; pos: number[]; dir: number[]; normal: number[] }",
    'export interface WeaponStances { hands: Hands; shape: WeaponShape; sheath: Sheath; idle: Stance; guard?: Stance; sheathed?: Stance }',
    'export const WEAPON_STANCES: Record<string, WeaponStances> = {',
    ...Object.values(state.stances).map((f) => `  ${f.id}: ${js({ hands: f.hands, shape: f.shape, sheath: f.sheath, ...f.stances })},`),
    '};',
    '',
    'export const WEAPON_MOTIONS: Record<string, Motion> = {',
    ...Object.entries(state.motions).map(([name, m]) => `  ${name}: ${js({ dur: m.dur, family: m.family, base: m.base, ...(m.root ? { root: m.root } : {}), ...(m.spin ? { spin: m.spin } : {}), ...(m.skipBody ? { skipBody: m.skipBody } : {}), ch: m.ch, feet: m.feet })},`),
    '};',
    '',
  ];
  writeFileSync(resolve(ROOT, 'src/render/weaponClipSpecs.ts'), ts.join('\n'));
}
const n = Object.values(state.out).reduce((s, F) => s + F.actions.length, 0);
console.log(`技 ${n} 件、軌道 ${Object.values(state.out).reduce((s, F) => s + F.tracks.length, 0)} 件、移動曲線 ${state.curves.length} 件、体の動き ${Object.keys(state.motions).length} 件`);
console.log('clips: ' + [...state.clips.keys()].map((c) => `"${c}"`).join(', '));
const problems = [...state.problems, ...checkAll()];
if (problems.length > 0) {
  console.log(`\n人にできる範囲を外れている所: ${problems.length} 件`);
  for (const p of problems) console.log('  ' + p);
  if (process.argv.includes('--strict')) process.exit(1);
} else console.log('人にできる範囲の検査: すべて通過');
