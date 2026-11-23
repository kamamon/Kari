// 護刃・旋鎌・長尖槍・環弓の、技（actions）と軌道（tracks）と移動曲線のデータを作る。
//
//   node tools/gen-weapons.mjs
//
// 書き出すもの:
//   public/data/actions/<系統>.json, public/data/tracks/<系統>.json … この道具の出力（手で編集しない）
//   public/data/curves.json … id が "w_" で始まる行だけを入れ替える（ほかの行と書式は変えない）
//   src/render/weaponClipSpecs.ts … 仮アニメーションの一覧（名前・型・長さ・有効判定の区間）
// 数値はすべて机上の初期値（docs/weapons.md）。座標はアクターのローカル（m、Y 上、+Z 前、右手側は -X）。
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const D2R = Math.PI / 180;
const norm = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const r4 = (n) => Math.round(n * 10000) / 10000;
const v3 = (v) => v.map(r4);

const curves = [];
const clips = new Map();
const out = {};

function family(id) {
  out[id] = { actions: [], tracks: [] };
  const F = out[id];
  /** 軌道。keys は [tick, 握り, 向き] */
  const track = (tid, o, keys) => {
    F.tracks.push({ id: tid, radius: o.radius, from: o.from, to: o.to, planeNormal: o.normal ?? [1, 0, 0], keys: keys.map(([t, grip, dir]) => ({ t, grip: v3(grip), dir: v3(norm(dir)) })) });
    return tid;
  };
  /** 技。active = [有効判定の始まり, 終わり]。hits は時間枠ごとの上書き。 */
  const action = (name, o) => {
    const actionId = `player.${id}.${name}`;
    const [a0, a1] = o.active ?? [Math.round(o.dur * 0.45), Math.round(o.dur * 0.45)];
    const phases = o.active
      ? [{ id: 'startup', from: 0, to: a0 }, { id: 'active', from: a0, to: a1 }, { id: 'recovery', from: a1, to: o.dur }]
      : [{ id: 'startup', from: 0, to: a0 }, { id: 'recovery', from: a0, to: o.dur }];
    const hitWindows = (o.hits ?? []).map((h) => ({
      id: h.id, from: h.from ?? a0, to: h.to ?? a1, shapeTrack: h.track, damageType: h.type ?? 'cut', damageCoefficient: h.coef,
      maxHitsPerTarget: 1, hitstopTicks: h.hitstop ?? 3, ...(h.group ? { group: h.group } : {}),
    }));
    const events = [...(o.events ?? [])];
    if (o.sound) events.push({ tick: o.sound[0], type: 'sound', id: o.sound[1] });
    if (o.trail !== false && hitWindows.length > 0) events.push({ tick: a0, type: 'trail_on', id: 'blade' }, { tick: a1, type: 'trail_off', id: 'blade' });
    events.sort((x, y) => x.tick - y.tick);
    const def = {
      schemaVersion: 1, actionId, clip: o.clip, tickRate: 60, durationTicks: o.dur, phases,
      rootMotion: o.curve ? { mode: 'controller', curveId: o.curve } : { mode: 'none' },
      ...(o.turn ? { turning: { untilTick: o.turn[0], maxDegreesPerSecond: o.turn[1] } } : {}),
      hitWindows, cancelWindows: (o.cancels ?? []).map(([from, to, into]) => ({ from, to, into })), events,
      onFinish: o.finish ?? 'drawn_idle',
      ...(o.track ? { weaponTrack: o.track } : {}),
    };
    for (const k of ['staminaCost', 'invulnerable', 'charge', 'freeMove', 'guardWindows', 'counter', 'momentum', 'shoot', 'spin', 'offhandTrack']) if (o[k] !== undefined) def[k] = o[k];
    F.actions.push(def);
    const prev = clips.get(o.clip);
    if (prev && prev.dur !== o.dur) throw new Error(`clip ${o.clip} の長さが技ごとに違う`);
    clips.set(o.clip, { style: o.style, dur: o.dur, a0, a1 });
    return actionId;
  };
  return { track, action };
}
/** 移動曲線。keys は [tick, 累積距離 m] */
const curve = (id, keys) => (curves.push({ id, keys }), id);

/** 軌道を tick t で読む（src/game/tracks.ts の sampleTrack と同じ計算） */
function sample(keys, t) {
  if (t <= keys[0][0]) return { grip: keys[0][1], dir: norm(keys[0][2]) };
  const last = keys[keys.length - 1];
  if (t >= last[0]) return { grip: last[1], dir: norm(last[2]) };
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1][0] <= t) i++;
  const [t0, g0, d0] = keys[i], [t1, g1, d1] = keys[i + 1];
  const u = (t - t0) / (t1 - t0);
  const a = norm(d0), b = norm(d1);
  const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  let dir;
  const th = Math.acos(dot), s = Math.sin(th);
  if (dot > 0.9995 || s < 1e-6) dir = norm(a.map((x, k) => x + (b[k] - x) * u));
  else dir = a.map((x, k) => (x * Math.sin((1 - u) * th)) / s + (b[k] * Math.sin(u * th)) / s);
  return { grip: g0.map((x, k) => x + (g1[k] - x) * u), dir };
}

// ============================================================ 護刃（短剣と盾）
{
  const { track, action } = family('guard_blade');
  const B = { radius: 0.11, from: 0.13, to: 0.88 };
  const READY = [[-0.28, 0.98, 0.28], [0.05, 0.75, 0.66]];
  const S1_END = [[0.18, 0.92, 0.4], [0.7, -0.2, 0.65]];
  const S2_END = [[-0.38, 1.05, 0.38], [-0.75, 0.15, 0.6]];
  curve('w_step_015', [[0, 0], [4, 0], [10, 0.15], [40, 0.15]]);
  curve('w_step_030', [[0, 0], [6, 0], [14, 0.3], [40, 0.3]]);
  curve('w_step_040', [[0, 0], [6, 0], [14, 0.4], [40, 0.4]]);
  curve('w_lunge_120', [[0, 0], [6, 0], [18, 1.15], [24, 1.2], [40, 1.2]]);
  track('gb_slash1', B, [[0, ...READY], [5, [-0.38, 1.35, 0.05], [-0.5, 0.8, -0.3]], [7, [-0.3, 1.38, 0.3], [-0.35, 0.75, 0.55]], [9, [-0.05, 1.15, 0.55], [0.15, 0.2, 0.97]], [11, [0.15, 0.95, 0.45], [0.65, -0.25, 0.72]], [16, ...S1_END], [24, ...READY]]);
  track('gb_slash2', B, [[0, ...S1_END], [4, [0.3, 1.05, 0.2], [0.9, 0.1, -0.2]], [6, [0.25, 1.1, 0.4], [0.75, 0.1, 0.6]], [8, [-0.05, 1.1, 0.6], [0, 0.1, 1]], [10, [-0.35, 1.08, 0.45], [-0.7, 0.1, 0.65]], [16, ...S2_END], [24, ...READY]]);
  track('gb_thrust', B, [[0, ...S2_END], [7, [-0.3, 1.1, 0.0], [0, 0.05, 1]], [10, [-0.25, 1.12, 0.25], [0, 0.02, 1]], [13, [-0.18, 1.15, 0.75], [0, 0, 1]], [15, [-0.18, 1.15, 0.8], [0, 0, 1]], [22, [-0.18, 1.15, 0.8], [0, 0, 1]], [34, ...READY]]);
  // 盾打ち: 当たるのは盾（縦の短い芯 + 大きめの半径）。剣は後ろへ引いておく。
  track('gb_bash_shield', { radius: 0.26, from: -0.18, to: 0.18 }, [[0, [0.28, 1.1, 0.3], [0, 1, 0]], [8, [0.3, 1.15, 0.2], [0, 1, 0]], [10, [0.25, 1.18, 0.45], [0, 1, 0]], [13, [0.15, 1.2, 0.95], [0, 1, 0]], [15, [0.15, 1.2, 1.0], [0, 1, 0]], [24, [0.25, 1.12, 0.4], [0, 1, 0]], [36, [0.28, 1.1, 0.3], [0, 1, 0]]]);
  track('gb_bash_sword', B, [[0, ...READY], [10, [-0.4, 1.0, 0.0], [-0.2, 0.6, 0.77]], [24, [-0.4, 1.0, 0.0], [-0.2, 0.6, 0.77]], [36, ...READY]]);
  track('gb_lunge', B, [[0, [-0.3, 1.0, 0.1], [0.3, -0.3, -0.9]], [8, [-0.35, 1.45, 0.0], [-0.3, 0.9, -0.3]], [14, [-0.25, 1.5, 0.3], [-0.1, 0.8, 0.6]], [17, [-0.1, 1.15, 0.6], [0.1, 0.1, 1]], [19, [0.0, 0.9, 0.55], [0.3, -0.4, 0.87]], [28, [0.0, 0.9, 0.55], [0.3, -0.4, 0.87]], [40, ...READY]]);
  track('gb_draw', B, [[0, [-0.25, 0.95, -0.05], [0.3, -0.3, -0.9]], [10, [-0.35, 1.2, 0.1], [0, 0.9, 0.2]], [20, ...READY]]);
  track('gb_sheathe', B, [[0, ...READY], [12, [-0.35, 1.2, 0.1], [0, 0.9, 0.2]], [24, [-0.25, 0.95, -0.05], [0.3, -0.3, -0.9]]]);
  const cut = (t, coef, o = {}) => [{ id: 'blade_main', track: t, coef, hitstop: 2, ...o }];
  action('slash1', { clip: 'gb_slash1_01', style: 'slash_r2l', dur: 24, active: [7, 11], track: 'gb_slash1', hits: cut('gb_slash1', 0.28), curve: 'w_step_015', turn: [6, 360], sound: [6, 'hb_swing_02'], cancels: [[12, 24, ['gb_slash2', 'gb_bash', 'roll']]] });
  action('slash2', { clip: 'gb_slash2_01', style: 'slash_l2r', dur: 24, active: [6, 10], track: 'gb_slash2', hits: cut('gb_slash2', 0.3), curve: 'w_step_015', turn: [5, 360], sound: [5, 'hb_swing_02'], cancels: [[11, 24, ['gb_thrust', 'gb_bash', 'roll']]] });
  action('thrust', { clip: 'gb_thrust_01', style: 'thrust', dur: 34, active: [10, 15], track: 'gb_thrust', hits: cut('gb_thrust', 0.42, { hitstop: 3 }), curve: 'w_step_030', turn: [8, 360], sound: [9, 'hb_swing_02'], cancels: [[22, 34, ['gb_bash', 'roll']]] });
  action('bash', { clip: 'gb_bash_01', style: 'bash', dur: 36, active: [10, 15], track: 'gb_bash_sword', offhandTrack: 'gb_bash_shield', hits: [{ id: 'shield', track: 'gb_bash_shield', coef: 0.25, type: 'blunt', hitstop: 4 }], trail: false, curve: 'w_step_040', turn: [8, 360], sound: [9, 'hb_swing_01'], cancels: [[22, 36, ['gb_slash1', 'roll']]] });
  action('lunge', { clip: 'gb_lunge_01', style: 'lunge', dur: 40, active: [14, 19], track: 'gb_lunge', hits: cut('gb_lunge', 0.45, { hitstop: 3 }), curve: 'w_lunge_120', turn: [10, 240], sound: [13, 'hb_swing_02'], events: [{ tick: 2, type: 'sound', id: 'hb_draw_01' }], cancels: [[26, 40, ['gb_slash1', 'gb_bash', 'roll']]] });
  action('draw', { clip: 'gb_draw_01', style: 'draw', dur: 20, track: 'gb_draw', sound: [3, 'hb_draw_01'] });
  action('sheathe', { clip: 'gb_sheathe_01', style: 'sheathe', dur: 24, track: 'gb_sheathe', sound: [14, 'hb_sheathe_01'], finish: 'sheathed_idle' });
}

// ============================================================ 旋鎌（大鎌）
{
  const { track, action } = family('reap_scythe');
  const SHAFT = { radius: 0.07, from: 0.35, to: 1.4 };
  // 刃の芯: 柄の先（握りから 1.47m）の少し横から、刃先（高さ 1.35m・横 0.74m）まで。横の向きは武器の -Z（= 向き × 面の法線）。
  const bladeOf = (keys, normal, ticks) =>
    ticks.map((t) => {
      const s = sample(keys, t);
      const n = normal.map((x, k) => x - s.dir[k] * (normal[0] * s.dir[0] + normal[1] * s.dir[1] + normal[2] * s.dir[2]));
      const side = cross(s.dir, norm(n)); // 武器の -Z（刃の伸びる向き）
      const p0 = s.grip.map((g, k) => g + s.dir[k] * 1.47 + side[k] * 0.05);
      const p1 = s.grip.map((g, k) => g + s.dir[k] * 1.35 + side[k] * 0.74);
      return [t, p0, p1.map((x, k) => x - p0[k])];
    });
  const BLADE = { radius: 0.1, from: 0, to: 0.7 };
  /** 柄の軌道と、そこから求めた刃の軌道を登録する。刃は有効判定の前後を 1 tick ごとに取る。 */
  const both = (name, normal, keys, a0, a1) => {
    track(name, { ...SHAFT, normal }, keys);
    const ticks = new Set(keys.map((k) => k[0]));
    for (let t = a0 - 2; t <= a1 + 2; t++) ticks.add(t);
    track(`${name}_blade`, BLADE, bladeOf(keys, normal, [...ticks].sort((x, y) => x - y)));
  };
  /** 水平に薙ぐ軌道: 角度 th（度。0 が正面、+ が左）で、柄が体から外へ伸びる */
  const at = (th, tilt = -0.12, h = 1.05) => [[0.25 * Math.sin(th * D2R), h, 0.15 + 0.2 * Math.cos(th * D2R)], [Math.sin(th * D2R), tilt, Math.cos(th * D2R)]];
  const arc = (t0, t1, th0, th1, n = 8) => Array.from({ length: n + 1 }, (_, i) => [Math.round((t0 + ((t1 - t0) * i) / n) * 100) / 100, ...at(th0 + ((th1 - th0) * i) / n)]);
  // 構え: 刃を右前の上へ向けて持つ（薙ぎの始まりの形）
  const READY = at(-60, 0.5, 1.0);
  const R2L = [0, -1, 0], L2R = [0, 1, 0];
  curve('w_step_060', [[0, 0], [8, 0], [18, 0.6], [46, 0.6]]);
  curve('w_back_100', [[0, 0], [16, 0], [26, -1.0], [46, -1.0]]);
  both('rs_sweep1', R2L, [[0, ...READY], [8, ...at(-125)], ...arc(14, 22, -110, 100), [30, ...at(115)], [42, ...READY]], 14, 22);
  both('rs_sweep2', L2R, [[0, ...at(120)], [7, ...at(125)], ...arc(12, 20, 110, -100), [28, ...at(-115)], [40, ...READY]], 12, 20);
  // 回し薙ぎ・大刈り: 柄を右前へ伸ばしたまま、体ごと回る（回転は技の spin が行う）
  both('rs_spin', R2L, [[0, ...at(-120)], [10, ...at(-95)], [14, ...at(-80)], [30, ...at(-80)], [38, ...at(-60)], [48, ...READY]], 14, 30);
  both('rs_great', R2L, [[0, ...READY], [16, ...at(-130, -0.05, 1.15)], [26, ...at(-80, -0.18)], [58, ...at(-80, -0.18)], [70, ...at(-40, -0.3, 0.95)], [96, ...READY]], 26, 58);
  // 引き刈り: 刃を奥へ掛けて、手前へ引く（刃は下向き）
  both('rs_pull', [-1, 0, 0], [[0, ...READY], [10, [-0.15, 1.15, 0.3], [0.05, 0.12, 1]], [16, [-0.15, 1.1, 0.6], [0.03, 0.08, 1]], [24, [-0.2, 1.0, -0.15], [0.03, 0.05, 1]], [32, [-0.2, 1.0, -0.15], [0.05, 0.2, 1]], [46, ...READY]], 16, 24);
  both('rs_draw_sweep', R2L, [[0, [-0.2, 1.3, -0.15], [0.62, -0.77, -0.13]], [10, ...at(-125)], ...arc(16, 24, -110, 100), [32, ...at(115)], [46, ...READY]], 16, 24);
  track('rs_draw', { ...SHAFT, normal: [-1, 0, 0] }, [[0, [-0.2, 1.3, -0.15], [0.62, -0.77, -0.13]], [12, [-0.25, 1.15, 0.0], [0.5, 0.6, 0.3]], [22, ...READY]]);
  track('rs_sheathe', { ...SHAFT, normal: [-1, 0, 0] }, [[0, ...READY], [14, [-0.25, 1.15, 0.0], [0.5, 0.6, 0.3]], [28, [-0.2, 1.3, -0.15], [0.62, -0.77, -0.13]]]);
  // 刃（切断）を先に判定し、当たらなかった時だけ柄（打撃・半分の威力）を判定する
  const hits = (t, coef, g = 'w', o = {}) => [
    { id: `blade_${g}`, track: `${t}_blade`, coef, group: g, hitstop: 3, ...o },
    { id: `shaft_${g}`, track: t, coef: r4(coef * 0.5), type: 'blunt', group: g, hitstop: 2, ...o },
  ];
  const walk = { speed: 1.8, turnDegPerSec: 150 };
  const gain = { gain: true };
  action('sweep1', { clip: 'rs_sweep1_01', style: 'sweep_r2l', dur: 42, active: [14, 22], track: 'rs_sweep1', hits: hits('rs_sweep1', 0.45), freeMove: walk, momentum: gain, sound: [12, 'hb_swing_01'], cancels: [[26, 42, ['rs_sweep2', 'rs_pull', 'rs_great', 'roll']]] });
  action('sweep2', { clip: 'rs_sweep2_01', style: 'sweep_l2r', dur: 40, active: [12, 20], track: 'rs_sweep2', hits: hits('rs_sweep2', 0.45), freeMove: walk, momentum: gain, sound: [10, 'hb_swing_01'], cancels: [[24, 40, ['rs_spin', 'rs_pull', 'rs_great', 'roll']]] });
  action('spin', { clip: 'rs_spin_01', style: 'spin', dur: 48, active: [14, 30], track: 'rs_spin', hits: hits('rs_spin', 0.6), freeMove: walk, momentum: gain, spin: { from: 14, to: 30, degrees: 360 }, sound: [12, 'hb_swing_01'], cancels: [[34, 48, ['rs_sweep1', 'rs_pull', 'rs_great', 'roll']]] });
  action('pull', { clip: 'rs_pull_01', style: 'pull', dur: 46, active: [16, 24], track: 'rs_pull', hits: hits('rs_pull', 0.5), curve: 'w_back_100', turn: [12, 240], momentum: gain, sound: [15, 'hb_swing_02'], cancels: [[30, 46, ['rs_sweep1', 'rs_great', 'roll']]] });
  // 大刈り: 2 回転。1 回転ごとに 1 回当たる。勢いをすべて使い、その段階で威力が決まる。
  action('great', { clip: 'rs_great_01', style: 'spin', dur: 96, active: [26, 58], track: 'rs_great',
    hits: [...hits('rs_great', 0.45, 'a', { from: 26, to: 42, hitstop: 4 }), ...hits('rs_great', 0.45, 'b', { from: 42, to: 58, hitstop: 6 })],
    momentum: { spendScale: [1, 1, 1.45, 2] }, spin: { from: 26, to: 58, degrees: 720 }, turn: [20, 180], events: [{ tick: 40, type: 'sound', id: 'hb_swing_01' }], sound: [24, 'hb_swing_01'], cancels: [[80, 96, ['roll']]] });
  action('draw_sweep', { clip: 'rs_draw_sweep_01', style: 'sweep_r2l', dur: 46, active: [16, 24], track: 'rs_draw_sweep', hits: hits('rs_draw_sweep', 0.4), curve: 'w_step_060', turn: [12, 180], momentum: gain, sound: [14, 'hb_swing_01'], events: [{ tick: 2, type: 'sound', id: 'hb_draw_01' }], cancels: [[30, 46, ['rs_sweep2', 'rs_pull', 'roll']]] });
  action('draw', { clip: 'rs_draw_01', style: 'draw', dur: 22, track: 'rs_draw', sound: [3, 'hb_draw_01'] });
  action('sheathe', { clip: 'rs_sheathe_01', style: 'sheathe', dur: 28, track: 'rs_sheathe', sound: [18, 'hb_sheathe_01'], finish: 'sheathed_idle' });
}

// ============================================================ 長尖槍（ランス）
{
  const { track, action } = family('long_lance');
  const TIP = { radius: 0.1, from: 0.9, to: 2.36 };
  const READY = [[-0.32, 1.0, 0.05], [0.05, 0.12, 1]];
  const SHIELD = { radius: 0.3, from: -0.3, to: 0.3 };
  const FRONT = [[0.05, 1.15, 0.5], [0, 1, 0]];
  curve('w_lunge_260', [[0, 0], [10, 0], [30, 2.45], [38, 2.6], [56, 2.6]]);
  curve('w_hop_150', [[0, 0], [2, 0.1], [12, 1.35], [18, 1.5], [22, 1.5]]);
  const thrust = (name, d, a0, a1, up = 0.02, h = 1.1) =>
    track(name, TIP, [[0, ...READY], [a0 - 3, [-0.32, h - 0.03, -0.25], [0.03, up, 1]], [a0, [-0.3, h, 0.0], [0, up, 1]], [a1 - 2, [-0.25, h + 0.02, 0.55], [0, up, 1]], [a1, [-0.25, h + 0.02, 0.6], [0, up, 1]], [a1 + 7, [-0.25, h + 0.02, 0.6], [0, up, 1]], [d, ...READY]]);
  thrust('ll_thrust', 38, 10, 15);
  thrust('ll_high', 42, 12, 17, 0.5, 1.25);
  thrust('ll_guard_thrust', 44, 14, 19, 0.04, 1.05);
  thrust('ll_counter_thrust', 40, 8, 14, 0.06, 1.12);
  thrust('ll_lunge', 56, 18, 30, 0.03, 1.08);
  track('ll_counter', TIP, [[0, ...READY], [6, [-0.38, 1.05, -0.2], [0.1, 0.25, 1]], [52, [-0.38, 1.05, -0.2], [0.1, 0.25, 1]], [60, ...READY]]);
  track('ll_hold', TIP, [[0, ...READY], [22, ...READY]]);
  track('ll_shield_front', SHIELD, [[0, ...FRONT], [60, ...FRONT]]);
  track('ll_draw', TIP, [[0, [-0.22, 1.3, -0.18], [0.3, -0.9, -0.3]], [14, [-0.35, 1.2, -0.1], [0.2, 0.7, 0.6]], [26, ...READY]]);
  track('ll_sheathe', TIP, [[0, ...READY], [18, [-0.35, 1.2, -0.1], [0.2, 0.7, 0.6]], [34, [-0.22, 1.3, -0.18], [0.3, -0.9, -0.3]]]);
  const stab = (t, coef, o = {}) => [{ id: 'tip', track: t, coef, hitstop: 3, ...o }];
  const chain = (name, coef, next) =>
    action(name, { clip: 'll_thrust_01', style: 'thrust', dur: 38, active: [10, 15], track: 'll_thrust', hits: stab('ll_thrust', coef), curve: 'w_step_015', turn: [8, 120], sound: [9, 'hb_swing_02'], cancels: [[18, 38, [...next, 'roll']]] });
  chain('thrust1', 0.5, ['ll_thrust2', 'll_high']);
  chain('thrust2', 0.5, ['ll_thrust3', 'll_high']);
  chain('thrust3', 0.62, []);
  action('high', { clip: 'll_high_01', style: 'thrust', dur: 42, active: [12, 17], track: 'll_high', hits: stab('ll_high', 0.55), curve: 'w_step_015', turn: [10, 120], sound: [11, 'hb_swing_02'], cancels: [[22, 42, ['ll_thrust1', 'roll']]] });
  // 構え突き: 突いている間も防御が有効
  action('guard_thrust', { clip: 'll_guard_thrust_01', style: 'thrust', dur: 44, active: [14, 19], track: 'll_guard_thrust', offhandTrack: 'll_shield_front', hits: stab('ll_guard_thrust', 0.36, { hitstop: 2 }), guardWindows: [{ from: 0, to: 44 }], sound: [13, 'hb_swing_02'], cancels: [[30, 44, ['roll']]] });
  // 受け返し: 構えの間に正面から受けると、無傷で大きな突きを返す
  action('counter', { clip: 'll_counter_01', style: 'stance', dur: 60, track: 'll_counter', offhandTrack: 'll_shield_front', staminaCost: 15, counter: { from: 4, to: 50, into: 'player.long_lance.counter_thrust' }, sound: [2, 'guard'] });
  action('counter_thrust', { clip: 'll_counter_thrust_01', style: 'thrust', dur: 40, active: [8, 14], track: 'll_counter_thrust', hits: stab('ll_counter_thrust', 1.6, { hitstop: 7 }), curve: 'w_step_030', sound: [7, 'hb_swing_01'], invulnerable: [{ from: 0, to: 8 }], cancels: [[26, 40, ['ll_thrust1', 'roll']]] });
  action('lunge', { clip: 'll_lunge_01', style: 'lunge', dur: 56, active: [18, 30], track: 'll_lunge', hits: stab('ll_lunge', 0.7, { hitstop: 5 }), curve: 'w_lunge_260', turn: [14, 90], sound: [16, 'hb_swing_01'], events: [{ tick: 2, type: 'sound', id: 'hb_draw_01' }], cancels: [[42, 56, ['ll_thrust1', 'roll']]] });
  // 短い跳び（回避）。続けてもう 1 回跳べる。
  action('hop', { clip: 'll_hop_01', style: 'hop', dur: 22, track: 'll_hold', curve: 'w_hop_150', staminaCost: 14, invulnerable: [{ from: 2, to: 9 }], sound: [1, 'roll_01'], cancels: [[14, 22, ['roll']]] });
  action('draw', { clip: 'll_draw_01', style: 'draw', dur: 26, track: 'll_draw', sound: [4, 'hb_draw_01'] });
  action('sheathe', { clip: 'll_sheathe_01', style: 'sheathe', dur: 34, track: 'll_sheathe', sound: [22, 'hb_sheathe_01'], finish: 'sheathed_idle' });
}

// ============================================================ 環弓（弓）
{
  const { track, action } = family('ring_bow');
  // 弓は左手で持つ。握りは弓の中央、向きは弓の上。武器の -Z（弓の背）が前を向くよう、面の法線は [-1,0,0]。
  const BOW = { radius: 0.05, from: -0.75, to: 0.75, normal: [-1, 0, 0] };
  const READY = [[0.25, 1.1, 0.3], [0.25, 0.95, 0.15]];
  const AIM = [[0.12, 1.38, 0.55], [0, 1, 0]];
  const aim = (name, d, a) => track(name, BOW, [[0, ...READY], [a - 2, ...AIM], [d - 14, ...AIM], [d, ...READY]]);
  aim('rb_shot', 50, 12);
  aim('rb_spread', 44, 10);
  track('rb_draw', BOW, [[0, [0.1, 1.3, -0.2], [0.5, 0.8, -0.2]], [20, ...READY]]);
  track('rb_sheathe', BOW, [[0, ...READY], [24, [0.1, 1.3, -0.2], [0.5, 0.8, -0.2]]]);
  const after = ['rb_shot', 'rb_spread', 'roll'];
  // 引き絞り → 放つ。溜めの段階（0〜3）で、矢の速さと威力が変わる。溜めている間はスタミナが減り、歩ける。
  action('shot', { clip: 'rb_shot_01', style: 'shoot', dur: 50, active: [12, 16], track: 'rb_shot',
    charge: { holdTick: 12, button: 'main', levelTicks: [30, 70, 120], maxHoldTicks: 240, coefficientScale: [1, 1, 1, 1], hitstopBonus: [0, 0, 0, 0], staminaPerSec: 12 },
    shoot: [{ tick: 16, count: 1, spreadDeg: 0, speed: [26, 32, 40, 48], coefficient: [0.18, 0.3, 0.55, 0.9] }],
    freeMove: { speed: 1.6, turnDegPerSec: 240, from: 0, to: 16 }, turn: [16, 240], sound: [16, 'orb_throw'], events: [{ tick: 2, type: 'sound', id: 'hb_draw_01' }], cancels: [[12, 13, ['roll']], [30, 50, after]] });
  action('spread', { clip: 'rb_spread_01', style: 'shoot', dur: 44, active: [10, 14], track: 'rb_spread',
    shoot: [{ tick: 14, count: 3, spreadDeg: 16, speed: [30], coefficient: [0.22] }], turn: [12, 300], sound: [14, 'orb_throw'], cancels: [[28, 44, after]] });
  action('draw', { clip: 'rb_draw_01', style: 'draw', dur: 20, track: 'rb_draw', sound: [3, 'hb_draw_01'] });
  action('sheathe', { clip: 'rb_sheathe_01', style: 'sheathe', dur: 24, track: 'rb_sheathe', sound: [14, 'hb_sheathe_01'], finish: 'sheathed_idle' });
}

// ---- 書き出し ----
const line = (o) => JSON.stringify(o).replace(/"(\w+)":/g, '"$1": ').replace(/,"/g, ', "');
for (const [id, F] of Object.entries(out)) {
  const a = ['{', '  "schemaVersion": 1,', '  "note": "tools/gen-weapons.mjs の出力。手で編集しない。数値は机上の初期値。",', '  "actions": [', F.actions.map((x) => '    ' + line(x)).join(',\n'), '  ]', '}', ''];
  writeFileSync(resolve(ROOT, `public/data/actions/${id}.json`), a.join('\n'));
  const t = ['{', '  "schemaVersion": 1,', '  "note": "tools/gen-weapons.mjs の出力。手で編集しない。アクターのローカル座標（m、Y 上、+Z 前、右手側は -X）。",', '  "tracks": [', F.tracks.map((x) => '    ' + line(x)).join(',\n'), '  ]', '}', ''];
  writeFileSync(resolve(ROOT, `public/data/tracks/${id}.json`), t.join('\n'));
}
// 移動曲線: "w_" で始まる行だけを入れ替える
{
  const p = resolve(ROOT, 'public/data/curves.json');
  const rows = readFileSync(p, 'utf8').split('\n').filter((l) => !l.includes('"id": "w_'));
  const end = rows.findIndex((l) => l.trim() === ']');
  rows[end - 1] = rows[end - 1].replace(/,?\s*$/, ',');
  const add = curves.map((c, i) => `    {"id": "${c.id}", "keys": ${JSON.stringify(c.keys).replace(/,/g, ', ')}}${i < curves.length - 1 ? ',' : ''}`);
  rows.splice(end, 0, ...add);
  writeFileSync(p, rows.join('\n'));
}
{
  const rows = [...clips.entries()].map(([name, c]) => `  ['${name}', '${c.style}', ${c.dur}, ${c.a0}, ${c.a1}],`);
  const ts = ['// 生成物（tools/gen-weapons.mjs）。手で編集しない。', '// 護刃・旋鎌・長尖槍・環弓の仮アニメーション: [名前, 型, 長さ, 有効判定の始まり, 終わり]（tick）', 'export const WEAPON_CLIP_SPECS: readonly (readonly [string, string, number, number, number])[] = [', ...rows, '];', ''];
  writeFileSync(resolve(ROOT, 'src/render/weaponClipSpecs.ts'), ts.join('\n'));
}
const n = Object.values(out).reduce((s, F) => s + F.actions.length, 0);
console.log(`技 ${n} 件、軌道 ${Object.values(out).reduce((s, F) => s + F.tracks.length, 0)} 件、移動曲線 ${curves.length} 件、クリップ ${clips.size} 件`);
console.log('clips: ' + [...clips.keys()].map((c) => `"${c}"`).join(', '));
