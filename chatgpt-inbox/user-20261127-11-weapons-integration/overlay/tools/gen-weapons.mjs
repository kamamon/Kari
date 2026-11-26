// 断岳剣（v0.57.0 から）・護刃・長尖槍・環弓・大槌・双剣・太刀の、技（actions）・軌道（tracks）・移動曲線・体の動きのデータを作る。
//
//   node tools/gen-weapons.mjs
//
// 書き出すもの:
//   public/data/actions/<系統>.json, public/data/tracks/<系統>.json … この道具の出力（手で編集しない）
//   public/data/curves_player.json … ハンターの移動曲線（前転と各武器の技。v0.57.0 から。全部をこの道具が書く）
//   public/data/weapons.json … 各系統の "ready" と防御の "pose" の行だけを入れ替える（構えから計算した値）
//   src/render/weaponClipSpecs.ts … 体の動き（構え・各技のキー）。描画がこれを解いて、体と武器を置く
// 技ごとの中身は tools/weapons/<系統>.mjs。体の解き方は src/render/bodySolve.ts、人にできる範囲の検査は src/render/humanLimits.ts。
// 数値はすべて机上の初期値（docs/weapons.md）。座標はアクターのローカル（m、Y 上、+Z 前、右手側は -X）。
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { B, checkAll, r4, state } from './weapons/lib.mjs';
import { guardBlade } from './weapons/guard_blade.mjs';
import { warMaul } from './weapons/war_maul.mjs';
import { twinBlades } from './weapons/twin_blades.mjs';
import { longBlade } from './weapons/long_blade.mjs';
import { longLance } from './weapons/long_lance.mjs';
import { ringBow } from './weapons/ring_bow.mjs';
import { extraWeapons } from './weapons/extra_classes.mjs';
import { common } from './weapons/common.mjs';
import { heavyBlade } from './weapons/heavy_blade.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

common();
heavyBlade();
guardBlade();
warMaul();
twinBlades();
longBlade();
longLance();
ringBow();
extraWeapons();

// ---- 書き出し ----
const line = (o) => JSON.stringify(o).replace(/"(\w+)":/g, '"$1": ').replace(/,"/g, ', "');
for (const [id, F] of Object.entries(state.out)) {
  const a = ['{', '  "schemaVersion": 1,', '  "note": "tools/gen-weapons.mjs の出力。手で編集しない。数値は机上の初期値。",', '  "actions": [', F.actions.map((x) => '    ' + line(x)).join(',\n'), '  ]', '}', ''];
  writeFileSync(resolve(ROOT, `public/data/actions/${id}.json`), a.join('\n'));
  const t = ['{', '  "schemaVersion": 1,', '  "note": "tools/gen-weapons.mjs の出力。手で編集しない。体の動き（src/render/weaponClipSpecs.ts）を解いた、毎 tick の握りと向き。アクターのローカル座標（m、Y 上、+Z 前、右手側は -X）。",', '  "tracks": [', F.tracks.map((x) => '    ' + line(x)).join(',\n'), '  ]', '}', ''];
  writeFileSync(resolve(ROOT, `public/data/tracks/${id}.json`), t.join('\n'));
}
// 移動曲線（v0.57.0 から、ハンターの曲線は curves_player.json に分けた。全部をこの道具が書く）
{
  const rows = state.curves.filter(c=>!c.id.startsWith('xw_')).map((c) => `    {"id": "${c.id}", "keys": ${JSON.stringify(c.keys).replace(/,/g, ', ')}}`);
  const out = ['{', '  "schemaVersion": 1,', '  "note": "tools/gen-weapons.mjs の出力。手で編集しない。ハンターの移動曲線（前転と各武器の技）。[tick, 進んだ距離 m]。",', '  "curves": [', rows.join(',\n'), '  ]', '}', ''];
  writeFileSync(resolve(ROOT, 'public/data/curves_player.json'), out.join('\n'));
  writeFileSync(resolve(ROOT,'public/data/curves_extra_weapons.json'),JSON.stringify({schemaVersion:1,curves:state.curves.filter(c=>c.id.startsWith('xw_'))},null,2)+'\n');
}
// Ready and guard poses derive from the same rig as tracks.
{
 const path=resolve(ROOT,'public/data/weapons.json');
 const doc=JSON.parse(readFileSync(path,'utf8'));
 for(const fam of Object.values(state.stances)){
  const f=doc.families.find(f=>f.id===fam.id);if(!f)throw Error('Missing family '+fam.id);
  const value=st=>{const s=B.solveBody(st.ctl,st.feet.L,st.feet.R,fam.hands);return {grip:s.weapon.grip.map(r4),dir:s.weapon.dir.map(r4),planeNormal:s.weapon.normal.map(r4)};};
  f.ready=value(fam.stances.idle);if(f.guard&&fam.stances.guard)f.guard.pose=value(fam.stances.guard);
 }
 writeFileSync(path,JSON.stringify(doc,null,2)+'\n');
}
// 体の動き
{
  const num = (k, v) => (typeof v === 'number' ? r4(v) : v);
  const js = (o) => JSON.stringify(o, num);
  const ts = [
    '// 生成物（tools/gen-weapons.mjs）。手で編集しない。',
    '// 7 系統の体の動き（断岳剣は v0.57.0 から）: 構え（立ち姿）と、技ごとのキー。解き方は bodySolve.ts。v0.56.0 までの動きは motionsets/v056.ts（保留の組。D-150）。',
    "import type { Ctl, Foot, Hands, Motion } from './bodySolve';",
    "import type { WeaponShape } from './humanLimits';",
    '',
    'export interface Stance { ctl: Ctl; feet: { L: Foot; R: Foot } }',
    '/** 武器系統ごとの持ち方と立ち姿（idle = 抜刀して構えた姿、guard = 防御、sheathed = 納刀）と、自分の体と重なってはいけない武器の範囲 */',
    '/** 納めた時の武器の置き場所: 付く骨、その骨の座標での握りの位置、武器の向き（+Y）、武器の +X の向き */',
    "export interface Sheath { parent: 'chest' | 'pelvis'; pos: number[]; dir: number[]; normal: number[] }",
    'export interface WeaponStances { hands: Hands; shape: WeaponShape; sheath: Sheath; sheath2?: Sheath; idle: Stance; guard?: Stance; sheathed?: Stance }',
    'export const WEAPON_STANCES: Record<string, WeaponStances> = {',
    ...Object.values(state.stances).map((f) => `  ${f.id}: ${js({ hands: f.hands, shape: f.shape, sheath: f.sheath, ...(f.sheath2 ? { sheath2: f.sheath2 } : {}), ...f.stances })},`),
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
