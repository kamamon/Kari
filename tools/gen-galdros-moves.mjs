// ガルドロスの追加の技（v0.4.1）の、技（actions）と判定の軌道（tracks）と移動曲線を作る。
//
//   node tools/gen-galdros-moves.mjs
//
// 書き出すもの:
//   public/data/actions/galdros_ext.json, public/data/tracks/galdros_ext.json … この道具の出力（手で編集しない）
//   public/data/curves.json … id が "g_" で始まる行だけを入れ替える
// 元からある 6 つの技（咆哮・叩きつけ左右・突進・尾薙ぎ）は public/data/actions/galdros.json のまま。
// 「落石」は、尾で地面を叩いて岩を打ち上げる技に作り直して、こちらへ移した（D-053）。
// 座標はモンスターのローカル（m、Y 上、+Z 前、左が +X）。数値は机上の初期値。
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const D2R = Math.PI / 180;
const r4 = (n) => Math.round(n * 10000) / 10000;
const norm = (v) => {
  const l = Math.hypot(...v) || 1;
  return v.map((x) => r4(x / l));
};
const actions = [], tracks = [], curves = [], clips = [];

const track = (id, o, keys) => (tracks.push({ id, radius: o.radius, from: o.from, to: o.to, planeNormal: o.normal ?? [1, 0, 0], keys: keys.map(([t, grip, dir]) => ({ t, grip: grip.map(r4), dir: norm(dir) })) }), id);
const curve = (id, keys) => (curves.push({ id, keys }), id);
const hit = (id, shapeTrack, baseDamage, o = {}) => ({ id, ...(o.from !== undefined ? { from: o.from, to: o.to } : {}), shapeTrack, damageType: 'blunt', damageCoefficient: 1.0, maxHitsPerTarget: 1, hitstopTicks: 0, baseDamage, guardable: true, guardCost: o.cost ?? 30, reaction: o.reaction ?? 'knockdown' });
const snd = (tick, id) => ({ tick, type: 'sound', id });
const SLAM = (tick) => ({ tick, type: 'vfx', id: 'ground_slam' });

function action(name, o) {
  const [a0, a1] = o.active;
  const def = {
    schemaVersion: 1, actionId: `monster.galdros.${name}`, clip: o.clip ?? `galdros_${name}_01`, tickRate: 60, durationTicks: o.dur,
    phases: [{ id: 'startup', from: 0, to: a0 }, { id: 'active', from: a0, to: a1 }, { id: 'recovery', from: a1, to: o.dur }],
    rootMotion: o.curve ? { mode: 'controller', curveId: o.curve } : { mode: 'none' },
    ...(o.turn ? { turning: { untilTick: o.turn[0], maxDegreesPerSecond: o.turn[1] } } : {}),
    hitWindows: (o.hits ?? []).map((h) => ({ from: a0, to: a1, ...h })),
    cancelWindows: [], events: (o.events ?? []).sort((x, y) => x.tick - y.tick),
    ...(o.hazards ? { hazards: o.hazards } : {}),
    onFinish: 'keep',
    ...(o.track ? { weaponTrack: o.track } : {}),
  };
  actions.push(def);
  if (!clips.includes(def.clip)) clips.push(def.clip);
}

// ---- 頭 ----
// 噛みつき: 首を引いてから、体ごと踏み込んで噛む
curve('g_lunge_090', [[0, 0], [32, 0], [38, -0.15], [46, 0.9], [96, 0.9]]);
const head = (z) => [[0, 1.5, z], [0, -0.12, 1]];
track('galdros_bite', { radius: 0.55, from: 0.1, to: 1.1 }, [[0, ...head(1.9)], [30, ...head(1.6)], [40, ...head(1.9)], [45, ...head(2.5)], [52, ...head(2.5)], [70, ...head(2.0)], [96, ...head(1.9)]]);
action('bite', { dur: 96, active: [40, 47], curve: 'g_lunge_090', track: 'galdros_bite', turn: [30, 70], hits: [hit('head', 'galdros_bite', 24, { cost: 28, reaction: 'flinch' })], events: [snd(2, 'galdros_warn'), snd(38, 'galdros_swing')] });
// 頭の横薙ぎ: 右へ溜めて、左へ振り抜く
const neck = (deg) => [[0, 1.5, 1.7], [Math.sin(deg * D2R), -0.08, Math.cos(deg * D2R)]];
track('galdros_head_swing', { radius: 0.5, from: 0.4, to: 1.6, normal: [0, 1, 0] }, [[0, ...neck(0)], [28, ...neck(-60)], [42, ...neck(-55)], [46, ...neck(-20)], [50, ...neck(20)], [54, ...neck(55)], [70, ...neck(40)], [104, ...neck(0)]]);
action('head_swing', { dur: 104, active: [42, 54], track: 'galdros_head_swing', turn: [26, 60], hits: [hit('head', 'galdros_head_swing', 22, { cost: 28 })], events: [snd(2, 'galdros_warn'), snd(40, 'galdros_swing')] });

// ---- 前脚と体 ----
// 両前脚の叩きつけ: 上体を起こして、両脚で正面を叩く（横に長い判定が、上から落ちる）
const bar = (y, z = 2.4) => [[-0.9, y, z], [1, 0, 0]];
track('galdros_double_slam', { radius: 1.0, from: 0, to: 1.8 }, [[0, ...bar(2.4)], [40, ...bar(3.0)], [58, ...bar(2.8)], [62, ...bar(1.4)], [65, ...bar(0.5)], [90, ...bar(0.5)], [136, ...bar(2.4)]]);
action('double_slam', { dur: 136, active: [60, 67], track: 'galdros_double_slam', turn: [34, 55], hits: [hit('forelegs', 'galdros_double_slam', 36, { cost: 50 })], events: [snd(2, 'galdros_warn'), snd(56, 'galdros_swing'), SLAM(65)] });
// 足踏み: その場で前脚を踏み鳴らす。足もとに張り付いた相手を払う（軽い）
const pad = (y) => [[0, y, 1.5], [0, 1, 0]];
track('galdros_stomp', { radius: 1.6, from: 0, to: 0.5 }, [[0, ...pad(1.8)], [30, ...pad(1.8)], [34, ...pad(1.0)], [38, ...pad(0.1)], [40, ...pad(0.1)], [84, ...pad(1.8)]]);
action('stomp', { dur: 84, active: [34, 40], track: 'galdros_stomp', hits: [hit('forelegs', 'galdros_stomp', 16, { cost: 20, reaction: 'flinch' })], events: [snd(2, 'galdros_warn'), SLAM(37)] });
// のしかかり: 沈んでから前へ跳び、腹で潰す
curve('g_press', [[0, 0], [48, 0], [53, -0.2], [68, 3.2], [156, 3.2]]);
const belly = (y) => [[0, y, -0.7], [0, 0, 1]];
track('galdros_body_press', { radius: 1.3, from: 0, to: 2.4 }, [[0, ...belly(2.6)], [60, ...belly(2.6)], [66, ...belly(1.5)], [70, ...belly(0.7)], [74, ...belly(0.6)], [100, ...belly(0.6)], [156, ...belly(2.6)]]);
action('body_press', { dur: 156, active: [66, 74], curve: 'g_press', track: 'galdros_body_press', turn: [44, 60], hits: [hit('body', 'galdros_body_press', 38, { cost: 55 })], events: [snd(2, 'galdros_warn'), snd(18, 'galdros_scrape'), snd(52, 'galdros_charge'), SLAM(70)] });
// 横への体当たり: 体を傾けて、横にいる相手へぶつける
for (const [s, sign] of [['l', 1], ['r', -1]]) {
  const side = (x) => [[sign * x, 1.0, -1.1], [0, 0, 1]];
  track(`galdros_side_bash_${s}`, { radius: 0.8, from: 0, to: 2.4 }, [[0, ...side(0.6)], [30, ...side(0.4)], [38, ...side(0.9)], [44, ...side(1.9)], [46, ...side(1.9)], [64, ...side(1.2)], [96, ...side(0.6)]]);
  action(`side_bash_${s}`, { dur: 96, active: [38, 46], track: `galdros_side_bash_${s}`, hits: [hit('body', `galdros_side_bash_${s}`, 24)], events: [snd(2, 'galdros_warn'), snd(36, 'galdros_swing')] });
}
// 短い突進: 溜めが短く、距離も短い
curve('g_charge_short', [[0, 0], [28, 0], [40, -0.35], [44, -0.35], [52, 0.8], [86, 7.2], [96, 7.8], [130, 7.8]]);
action('charge_short', { dur: 130, active: [46, 86], curve: 'g_charge_short', track: 'galdros_charge_front', turn: [28, 80], hits: [hit('body_front', 'galdros_charge_front', 28, { cost: 40 })], events: [snd(2, 'galdros_warn'), snd(14, 'galdros_scrape'), snd(44, 'galdros_charge')] });

// ---- 尾 ----
const TAIL = { radius: 0.5, from: 0.3, to: 1.75 }, STUMP = { radius: 0.5, from: 0.3, to: 0.95 };
const tail = (up, back) => [[0, 1.0, -1.5], [0, up, -back]];
const REST = tail(-0.12, 0.99);
// 尾の叩きつけ: 尾を高く上げて、真後ろへ叩き下ろす
const slamKeys = [[0, ...REST], [28, ...tail(0.7, 0.71)], [46, ...tail(0.88, 0.47)], [50, ...tail(0.6, 0.8)], [54, ...tail(-0.3, 0.95)], [57, ...tail(-0.36, 0.93)], [80, ...tail(-0.36, 0.93)], [116, ...REST]];
track('galdros_tail_slam', TAIL, slamKeys);
track('galdros_tail_slam_short', STUMP, slamKeys);
for (const [name, t] of [['tail_slam', 'galdros_tail_slam'], ['tail_slam_short', 'galdros_tail_slam_short']]) {
  action(name, { clip: 'galdros_tail_slam_01', dur: 116, active: [50, 57], track: t, hits: [hit('tail', t, 30, { cost: 36 })], events: [snd(2, 'galdros_warn'), snd(48, 'galdros_swing'), SLAM(55)] });
}
// 逆回りの尾薙ぎ: 元の尾薙ぎの軌道を、左右反転する
{
  const src = JSON.parse(readFileSync(resolve(ROOT, 'public/data/tracks/galdros.json'), 'utf8')).tracks;
  for (const [from, to] of [['galdros_tail_sweep', 'galdros_tail_sweep_rev'], ['galdros_tail_sweep_short', 'galdros_tail_sweep_rev_short']]) {
    const t = src.find((x) => x.id === from);
    tracks.push({ ...t, id: to, keys: t.keys.map((k) => ({ t: k.t, grip: [-k.grip[0], k.grip[1], k.grip[2]], dir: [-k.dir[0], k.dir[1], k.dir[2]] })) });
    action(to.replace('galdros_', ''), { clip: 'galdros_tail_sweep_rev_01', dur: 110, active: [40, 58], track: to, hits: [hit('tail', to, 26)], events: [snd(2, 'galdros_warn'), snd(38, 'galdros_swing')] });
  }
}

// ---- 岩 ----
const rocks = (tick, origin, o = {}) => ({ tick, count: 5, spread: 4.5, radius: 1.5, warnTicks: 66, activeTicks: 6, baseDamage: 22, reaction: 'knockdown', origin, peak: 6.5, ...o });
// 落石（作り直し）: 尾で地面を叩き、打ち上がった岩が狩人のまわりへ落ちてくる。尾の近くにいると、叩きつけにも当たる。
track('galdros_rockfall_tail', TAIL, [[0, ...REST], [36, ...tail(0.75, 0.66)], [50, ...tail(0.9, 0.44)], [54, ...tail(0.5, 0.87)], [57, ...tail(-0.36, 0.93)], [100, ...tail(-0.36, 0.93)], [160, ...REST]]);
action('rockfall', { dur: 160, active: [52, 60], track: 'galdros_rockfall_tail', hits: [hit('tail', 'galdros_rockfall_tail', 26)], hazards: [rocks(58, [0, 0.3, -3.0])], events: [snd(4, 'galdros_rumble'), snd(50, 'galdros_swing'), SLAM(57)] });
// 尾を切られた後の落石: 両前脚で地面を叩いて、岩を打ち上げる
track('galdros_rock_stomp', { radius: 1.0, from: 0, to: 1.8 }, [[0, ...bar(2.4)], [36, ...bar(3.0)], [50, ...bar(2.8)], [54, ...bar(1.4)], [57, ...bar(0.5)], [90, ...bar(0.5)], [150, ...bar(2.4)]]);
action('rock_stomp', { dur: 150, active: [52, 59], track: 'galdros_rock_stomp', turn: [30, 50], hits: [hit('forelegs', 'galdros_rock_stomp', 26, { cost: 40 })], hazards: [rocks(58, [0, 0.3, 2.6])], events: [snd(4, 'galdros_rumble'), snd(48, 'galdros_swing'), SLAM(57)] });
// 岩飛ばし: 前脚で地面を掻き、岩を狩人の方へ一列に弾き飛ばす
action('rock_fling', { dur: 120, active: [44, 50], turn: [36, 80], hazards: [rocks(44, [0.9, 0.3, 2.3], { count: 3, pattern: 'line', spread: 0.5, radius: 1.2, warnTicks: 42, baseDamage: 20, reaction: 'flinch', peak: 3.5 })], events: [snd(2, 'galdros_warn'), snd(10, 'galdros_scrape'), snd(26, 'galdros_scrape'), snd(42, 'galdros_swing')] });

// ---- 攻撃ではない動き ----
// 後ろへ跳ぶ: 張り付かれた時に、間合いを取り直す
curve('g_retreat', [[0, 0], [20, 0], [38, -3.2], [72, -3.2]]);
action('retreat', { dur: 72, active: [20, 38], curve: 'g_retreat', events: [snd(18, 'galdros_scrape'), SLAM(38)] });
// 威嚇: 離れた相手へ、短く吠える
action('threat', { dur: 64, active: [14, 44], turn: [40, 60], events: [snd(4, 'galdros_warn')] });

// ---- 書き出し ----
const line = (o) => JSON.stringify(o).replace(/"(\w+)":/g, '"$1": ').replace(/,"/g, ', "');
const file = (key, note, rows) => ['{', '  "schemaVersion": 1,', `  "note": "${note}",`, `  "${key}": [`, rows.map((x) => '    ' + line(x)).join(',\n'), '  ]', '}', ''].join('\n');
writeFileSync(resolve(ROOT, 'public/data/actions/galdros_ext.json'), file('actions', 'tools/gen-galdros-moves.mjs の出力。手で編集しない。数値は机上の初期値。', actions));
writeFileSync(resolve(ROOT, 'public/data/tracks/galdros_ext.json'), file('tracks', 'tools/gen-galdros-moves.mjs の出力。手で編集しない。モンスターのローカル座標（m、Y 上、+Z 前、左が +X）。', tracks));
{
  const p = resolve(ROOT, 'public/data/curves.json');
  const rows = readFileSync(p, 'utf8').split('\n').filter((l) => !l.includes('"id": "g_'));
  const end = rows.findIndex((l) => l.trim() === ']');
  rows[end - 1] = rows[end - 1].replace(/,?\s*$/, ',');
  rows.splice(end, 0, ...curves.map((c, i) => `    {"id": "${c.id}", "keys": ${JSON.stringify(c.keys).replace(/,/g, ', ')}}${i < curves.length - 1 ? ',' : ''}`));
  writeFileSync(p, rows.join('\n'));
}
console.log(`技 ${actions.length} 件、軌道 ${tracks.length} 件、移動曲線 ${curves.length} 件`);
console.log('clips: ' + clips.map((c) => `"${c}"`).join(', '));
