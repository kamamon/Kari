// 双剣（短い剣 2 本）の技と動き。右手と左手に 1 本ずつ。左足を前にして、両方の切っ先を前へ向けて構える。
// 右で斬れば腰は左へ、左で斬れば腰は右へ回る。振らない側の剣は、体の前へ戻して守りに残す。
// 座標はアクターのローカル（m、Y 上、+Z 前、+X 左）。数値は机上の初期値。
import { curve, family, sheathOf } from './lib.mjs';

export function twinBlades() {
  const hands = { primary: 'R', second: 'blade', wrist: [3, 135] };
  const { fam, motion, snap, trackOf, action, pose } = family('twin_blades', hands, { from: 0.1, to: 0.62, radius: 0.03, maxTurn: 2200 });
  const B = { radius: 0.1, from: 0.1, to: 0.62 };
  // 納めた時: 右手の剣は左腰、左手の剣は右腰（柄が前寄り、刃先は後ろ下）
  const HILT_R = [0.17, 1.0, 0.06], SH_R = [0.1, -0.8, -0.6], HILT_L = [-0.17, 1.0, 0.06], SH_L = [-0.1, -0.8, -0.6], SH_E = [0, -0.6, 0.8];
  fam.sheath = sheathOf('pelvis', [0.17, 0.08, 0.06], SH_R, SH_E);
  fam.sheath2 = sheathOf('pelvis', [-0.17, 0.08, 0.06], SH_L, SH_E);
  /** 左の剣の軌道: 握りと向き（持っていない間は、手の位置で代える） */
  const left = (s) => (s.off ? [s.off.grip, s.off.dir] : [s.frames.handL, [0, -1, 0]]);

  // ---- 立ち姿 ----
  const FEET = { L: [0.11, 0.18, 10], R: [-0.13, -0.16, -30] };
  /** 構えた時の右・左の剣（体の前で、切っ先を前上へ） */
  const R0 = { gripA: [-0.26, 1.1, 0.24], dirA: [0.15, 0.72, 0.68], edgeA: [0.1, -0.68, 0.72] };
  const L0 = { offA: [0.24, 1.14, 0.3], offNA: [-0.15, 0.68, 0.72], offEA: [-0.1, -0.72, 0.68] };
  const idle = (fam.stances.idle = pose({
    feet: FEET,
    hip: [0, -0.06, 0], hipR: [4, -14, 0], spine: [4, -3, 0], chest: [2, -3, 0],
    ...R0, ...L0, on: [1],
  }));
  const sheathed = (fam.stances.sheathed = pose({
    feet: { L: [0.095, 0, 4], R: [-0.095, 0, -4] },
    gripA: HILT_R, dirA: SH_R, edgeA: SH_E, off: [0.235, -0.555, 0.07], offNA: SH_L, offEA: SH_E, on: [0], grab: [0],
  }));

  // 右の剣の袈裟（右上 → 左下）と、左の剣の袈裟（左上 → 右下）の形。t は振り始め（有効判定の始まり）。
  const rCut = (t, o = {}) => [
    { t: t - 3, hip: [-0.01, -0.06, -0.02], hipR: [3, -26, 0], spine: [2, -6, 0], chest: [0, -10, 0], gripA: [-0.3, 1.5, 0], dirA: [-0.25, 0.75, -0.6], edgeA: [0.2, 0.3, 0.9], ...(o.wind ?? {}) },
    { t, hipR: [4, -14, 0], spine: [5, -3, 0], chest: [2, -2, 0], gripA: [-0.24, 1.5, 0.22], dirA: [-0.12, 0.92, 0.36], edgeA: [0.3, -0.2, 0.9] },
    { t: t + 2, hip: [0.01, -0.07, 0.03], hipR: [5, -4, 0], spine: [7, 0, 0], chest: [3, 8, 0], gripA: [-0.06, 1.3, 0.5], dirA: [0.12, 0.3, 0.95], edgeA: [0.5, -0.8, 0.2] },
    { t: t + 5, hip: [0.02, -0.08, 0.04], hipR: [5, 6, 0], spine: [8, 3, 0], chest: [4, 16, 0], gripA: [0.12, 1.02, 0.44], dirA: [0.62, -0.38, 0.68], edgeA: [0.6, -0.75, -0.2], ...(o.end ?? {}) },
  ];
  const lCut = (t, o = {}) => [
    { t: t - 3, hip: [0.01, -0.06, -0.02], hipR: [3, 2, 0], spine: [2, 4, 0], chest: [0, 10, 0], offA: [0.36, 1.5, 0.06], offNA: [0.25, 0.75, -0.6], offEA: [-0.2, 0.3, 0.9], ...(o.wind ?? {}) },
    { t, hipR: [4, -8, 0], spine: [5, 1, 0], chest: [2, 2, 0], offA: [0.24, 1.5, 0.22], offNA: [0.12, 0.92, 0.36], offEA: [-0.3, -0.2, 0.9] },
    { t: t + 2, hip: [-0.01, -0.07, 0.03], hipR: [5, -20, 0], spine: [7, -3, 0], chest: [3, -8, 0], offA: [0.06, 1.3, 0.5], offNA: [-0.12, 0.3, 0.95], offEA: [-0.5, -0.8, 0.2] },
    { t: t + 5, hip: [-0.02, -0.08, 0.04], hipR: [5, -30, 0], spine: [8, -6, 0], chest: [4, -14, 0], offA: [-0.12, 1.02, 0.44], offNA: [-0.62, -0.38, 0.68], offEA: [-0.6, -0.75, -0.2], ...(o.end ?? {}) },
  ];
  /** 両方の剣を外から内へ斬り下ろして交差させる形。t は振り始め。 */
  const xCut = (t) => [
    { t: t - 5, hip: [0, -0.04, -0.02], hipR: [0, -8, 0], spine: [-2, -2, 0], chest: [-3, 0, 0], gripA: [-0.36, 1.5, 0.1], dirA: [-0.5, 0.8, -0.2], edgeA: [0.4, 0.2, 0.9], offA: [0.36, 1.5, 0.1], offNA: [0.5, 0.8, -0.2], offEA: [-0.4, 0.2, 0.9] },
    { t, hip: [0, -0.06, 0.02], hipR: [4, -8, 0], spine: [4, -2, 0], chest: [2, 0, 0], gripA: [-0.28, 1.46, 0.34], dirA: [-0.3, 0.8, 0.5], edgeA: [0.5, -0.3, 0.8], offA: [0.28, 1.46, 0.34], offNA: [0.3, 0.8, 0.5], offEA: [-0.5, -0.3, 0.8] },
    { t: t + 3, hip: [0, -0.09, 0.07], hipR: [8, -8, 0], spine: [9, -2, 0], chest: [4, 0, 0], gripA: [-0.06, 1.22, 0.56], dirA: [0.25, 0.2, 0.95], edgeA: [0.6, -0.8, 0], offA: [0.06, 1.24, 0.54], offNA: [-0.25, 0.2, 0.95], offEA: [-0.6, -0.8, 0] },
    { t: t + 6, hip: [0, -0.12, 0.09], hipR: [10, -8, 0], spine: [12, -2, 0], chest: [5, 0, 0], gripA: [0.12, 0.98, 0.46], dirA: [0.6, -0.4, 0.69], edgeA: [0.6, -0.7, -0.3], offA: [-0.12, 1.02, 0.42], offNA: [-0.6, -0.4, 0.69], offEA: [-0.6, -0.7, -0.3] },
    { t: t + 11, hip: [0, -0.12, 0.08], hipR: [10, -8, 0], spine: [11, -2, 0], chest: [5, 0, 0], gripA: [0.13, 0.97, 0.44], dirA: [0.62, -0.4, 0.67], edgeA: [0.6, -0.7, -0.3], offA: [-0.13, 1.01, 0.4], offNA: [-0.62, -0.4, 0.67], offEA: [-0.6, -0.7, -0.3] },
  ];
  /** 振らない側の剣を、体の前へ戻しておく */
  const keepL = { offA: [0.2, 1.16, 0.3], offNA: [-0.1, 0.7, 0.7], offEA: [-0.1, -0.7, 0.7] };
  const keepR = { gripA: [-0.24, 1.12, 0.26], dirA: [0.1, 0.72, 0.68], edgeA: [0.1, -0.68, 0.72] };

  // ---- 斬り 1（右）→ 斬り 2（左）→ 交差斬り ----
  const slash1 = motion('tb_slash1_01', {
    dur: 24, from: idle, root: 'w_step_015',
    keys: [...rCut(8, { wind: keepL, end: keepL }), { t: 16, hip: [0.02, -0.08, 0.03], hipR: [4, 8, 0], spine: [7, 3, 0], chest: [3, 18, 0], gripA: [0.16, 0.98, 0.38], dirA: [0.7, -0.3, 0.64], edgeA: [0.6, -0.75, -0.2] }],
    feet: { L: [[3, 9, 0.11, 0.215, 10, 0.05]], R: [[17, 23, -0.13, -0.16, -30, 0.04]] },
  });
  const slash2 = motion('tb_slash2_01', {
    dur: 24, from: snap(slash1, 15), root: 'w_step_015',
    keys: [...lCut(7, { end: keepR }), { t: 5, ...keepR }, { t: 15, hipR: [5, -32, 0], spine: [7, -6, 0], chest: [3, -16, 0], offA: [-0.16, 0.98, 0.38], offNA: [-0.7, -0.3, 0.64], offEA: [-0.6, -0.75, -0.2] }],
    feet: { R: [[2, 8, -0.13, -0.11, -30, 0.04]], L: [[10, 16, 0.11, 0.18, 10, 0.04]] },
  });
  const cross = motion('tb_cross_01', {
    dur: 36, from: snap(slash2, 14), root: 'w_step_030',
    keys: xCut(11),
    feet: { L: [[7, 14, 0.11, 0.28, 10, 0.06], [28, 34, 0.11, 0.18, 10, 0.03]], R: [[22, 28, -0.13, -0.16, -30, 0.05]] },
  });
  trackOf('tb_slash1', B, slash1);
  trackOf('tb_slash2', B, slash2);
  trackOf('tb_slash2_l', B, slash2, left);
  trackOf('tb_cross', B, cross);
  trackOf('tb_cross_l', B, cross, left);

  // ---- 突き込み（右で突き、すぐ左で突く）----
  const AIM = [0, -1, 0];
  const stab = motion('tb_stab_01', {
    dur: 42, from: idle, root: 'w_step_040',
    keys: [
      { t: 6, hip: [0, -0.07, -0.03], hipR: [3, -30, 0], spine: [4, -6, 0], chest: [2, -10, 0], gripA: [-0.32, 1.14, 0], dirA: [0.08, 0.05, 1], edgeA: AIM, ...keepL },
      { t: 10, hip: [0, -0.09, 0.04], hipR: [6, -12, 0], spine: [6, -1, 0], chest: [3, 2, 0], gripA: [-0.22, 1.18, 0.42], dirA: [0.03, 0.02, 1], edgeA: AIM },
      { t: 13, hip: [0, -0.1, 0.08], hipR: [8, 0, 0], spine: [8, 3, 0], chest: [4, 12, 0], gripA: [-0.12, 1.2, 0.72], dirA: [0, 0, 1], edgeA: AIM, offA: [0.28, 1.14, 0.2], offNA: [-0.05, 0.05, 1], offEA: AIM },
      { t: 17, hip: [0, -0.1, 0.08], hipR: [8, -14, 0], spine: [8, -2, 0], chest: [4, -2, 0], gripA: [-0.22, 1.16, 0.4], dirA: [0.05, 0.1, 0.99], edgeA: AIM, offA: [0.22, 1.19, 0.42], offNA: [-0.03, 0.02, 1], offEA: AIM },
      { t: 20, hip: [0, -0.1, 0.09], hipR: [8, -32, 0], spine: [8, -6, 0], chest: [4, -14, 0], gripA: [-0.28, 1.12, 0.14], dirA: [0.1, 0.3, 0.95], edgeA: AIM, offA: [0.1, 1.2, 0.74], offNA: [0, 0, 1], offEA: AIM },
      { t: 26, hip: [0, -0.1, 0.08], hipR: [8, -31, 0], spine: [8, -6, 0], chest: [4, -13, 0], gripA: [-0.28, 1.12, 0.14], dirA: [0.1, 0.4, 0.91], edgeA: AIM, offA: [0.1, 1.2, 0.72], offNA: [0, 0, 1], offEA: AIM },
    ],
    feet: { L: [[6, 14, 0.11, 0.18, 10, 0.05]], R: [[27, 35, -0.13, -0.16, -30, 0.05]] },
  });
  trackOf('tb_stab', B, stab);
  trackOf('tb_stab_l', B, stab, left);

  // ---- 連ね斬り（固有。右・左・右と斬り、最後に交差）----
  const flurry = motion('tb_flurry_01', {
    dur: 86, from: idle,
    keys: [
      ...rCut(10, { wind: keepL, end: keepL }),
      ...lCut(23, { end: keepR }), { t: 21, ...keepR },
      ...rCut(36, { end: keepL }), { t: 33, ...keepL },
      ...xCut(56),
    ],
  });
  trackOf('tb_flurry', B, flurry);
  trackOf('tb_flurry_l', B, flurry, left);

  // ---- 抜刀斬り（腕を交差させて両腰の剣を取り、踏み込みながら左右へ開いて斬る）----
  const CROSSED = { grab: [1], on: [1], gripA: HILT_R, dirA: SH_R, edgeA: SH_E, offA: HILT_L, offNA: SH_L, offEA: SH_E };
  const HALF = { gripA: [0.12, 1.22, 0.26], dirA: [0.2, -0.72, -0.66], edgeA: [-0.6, 0.3, 0.7], offA: [-0.12, 1.2, 0.3], offNA: [-0.2, -0.72, -0.66], offEA: [0.6, 0.3, 0.7] };
  const drawCross = motion('tb_draw_cross_01', {
    dur: 52, from: sheathed, root: 'w_step_060', skipBody: [0, 24],
    keys: [
      { t: 6, hip: [0, -0.04, 0.02], hipR: [8, 0, 0], spine: [10, 0, 0], chest: [5, 0, 0], ...CROSSED },
      { t: 15, hip: [0, -0.06, 0.03], hipR: [8, 0, 0], spine: [9, 0, 0], chest: [5, 0, 0], ...HALF },
      { t: 24, hip: [0, -0.08, 0.04], hipR: [8, -4, 0], spine: [9, -1, 0], chest: [5, 0, 0], gripA: [0.14, 1.26, 0.38], dirA: [0.78, -0.3, 0.3], edgeA: [-0.3, 0.2, 0.9], offA: [-0.14, 1.22, 0.4], offNA: [-0.78, -0.3, 0.3], offEA: [0.3, 0.2, 0.9] },
      { t: 30, hip: [0, -0.09, 0.07], hipR: [8, -6, 0], spine: [8, -2, 0], chest: [4, 0, 0], gripA: [0.06, 1.28, 0.52], dirA: [0.6, -0.1, 0.79], edgeA: [-0.8, 0.1, 0.6], offA: [-0.06, 1.24, 0.5], offNA: [-0.6, -0.1, 0.79], offEA: [0.8, 0.1, 0.6] },
      { t: 33, hip: [0, -0.09, 0.08], hipR: [7, -8, 0], spine: [6, -2, 0], chest: [2, 0, 0], gripA: [-0.14, 1.32, 0.56], dirA: [0, 0.15, 0.99], edgeA: [-1, 0.1, 0], offA: [0.14, 1.3, 0.54], offNA: [0, 0.15, 0.99], offEA: [1, 0.1, 0] },
      { t: 36, hip: [0, -0.08, 0.07], hipR: [6, -10, 0], spine: [3, -2, 0], chest: [0, 0, 0], gripA: [-0.38, 1.36, 0.34], dirA: [-0.7, 0.3, 0.65], edgeA: [-0.7, 0, -0.7], offA: [0.38, 1.36, 0.34], offNA: [0.7, 0.3, 0.65], offEA: [0.7, 0, -0.7] },
      { t: 41, hip: [0, -0.08, 0.06], hipR: [6, -10, 0], spine: [3, -2, 0], chest: [0, 0, 0], gripA: [-0.4, 1.36, 0.3], dirA: [-0.74, 0.3, 0.6], edgeA: [-0.7, 0, -0.7], offA: [0.4, 1.36, 0.3], offNA: [0.74, 0.3, 0.6], offEA: [0.7, 0, -0.7] },
      { t: 47, gripA: [-0.32, 1.22, 0.26], dirA: [-0.2, 0.7, 0.68], edgeA: [-0.6, -0.3, 0.4], offA: [0.32, 1.24, 0.28], offNA: [0.2, 0.7, 0.68], offEA: [0.6, -0.3, 0.4] },
    ],
    feet: { L: [[12, 26, 0.11, 0.3, 10, 0.07]], R: [[27, 38, -0.13, -0.16, -30, 0.05]] },
  });
  trackOf('tb_draw_cross', B, drawCross);
  trackOf('tb_draw_cross_l', B, drawCross, left);

  // ---- 抜刀・納刀 ----
  /** 抜いた剣を、体の前で切っ先を前へ返す途中の形 */
  const TURN = { gripA: [0.04, 1.3, 0.34], dirA: [0.5, -0.6, 0.3], edgeA: [-0.5, -0.2, 0.8], offA: [-0.04, 1.27, 0.38], offNA: [-0.5, -0.6, 0.3], offEA: [0.5, -0.2, 0.8] };
  const FRONT = { gripA: [-0.08, 1.3, 0.4], dirA: [0.3, 0.1, 0.95], edgeA: [-0.3, -0.6, 0.7], offA: [0.08, 1.28, 0.42], offNA: [-0.3, 0.1, 0.95], offEA: [0.3, -0.6, 0.7] };
  const draw = motion('tb_draw_01', {
    dur: 30, from: sheathed, skipBody: [0, 18],
    keys: [
      { t: 6, hipR: [5, 0, 0], spine: [8, 0, 0], chest: [4, 0, 0], ...CROSSED },
      { t: 13, hipR: [5, -4, 0], spine: [7, 0, 0], chest: [4, 0, 0], ...HALF },
      { t: 18, ...TURN },
      { t: 23, hip: [0, -0.04, 0], hipR: [4, -10, 0], ...FRONT },
    ],
    feet: { L: [[8, 16, 0.11, 0.18, 10, 0.04]], R: [[16, 23, -0.13, -0.16, -30, 0.04]] },
  });
  trackOf('tb_draw', B, draw);
  const sheathe = motion('tb_sheathe_01', {
    dur: 34, from: idle, to: sheathed, skipBody: [10, 34],
    keys: [
      { t: 7, hipR: [4, -8, 0], ...FRONT },
      { t: 12, ...TURN },
      { t: 17, hipR: [5, -2, 0], spine: [7, 0, 0], chest: [4, 0, 0], ...HALF },
      { t: 25, hipR: [5, 0, 0], spine: [8, 0, 0], chest: [4, 0, 0], ...CROSSED },
      { t: 27, grab: [1], on: [1] },
    ],
    feet: { R: [[4, 12, -0.095, 0, -4, 0.04]], L: [[14, 22, 0.095, 0, 4, 0.04]] },
  });
  trackOf('tb_sheathe', B, sheathe);

  // ---- 技のデータ ----
  const R = (t, coef, o = {}) => ({ id: 'blade_r', track: t, coef, hitstop: 2, ...o });
  const L = (t, coef, o = {}) => ({ id: 'blade_l', track: `${t}_l`, coef, hitstop: 2, ...o });
  const gain = { gain: true };
  action('slash1', { clip: 'tb_slash1_01', dur: 24, active: [8, 13], track: 'tb_slash1', hits: [R('tb_slash1', 0.2)], curve: 'w_step_015', turn: [6, 360], momentum: gain, sound: [7, 'hb_swing_02'], cancels: [[14, 24, ['tb_slash2', 'tb_stab', 'tb_flurry', 'roll']]] });
  action('slash2', { clip: 'tb_slash2_01', dur: 24, active: [7, 12], track: 'tb_slash2', hits: [L('tb_slash2', 0.2)], curve: 'w_step_015', turn: [5, 360], momentum: gain, sound: [6, 'hb_swing_02'], cancels: [[13, 24, ['tb_cross', 'tb_stab', 'tb_flurry', 'roll']]] });
  action('cross', { clip: 'tb_cross_01', dur: 36, active: [11, 17], track: 'tb_cross', hits: [R('tb_cross', 0.22, { hitstop: 3 }), L('tb_cross', 0.22, { hitstop: 3 })], curve: 'w_step_030', turn: [8, 360], momentum: gain, sound: [10, 'hb_swing_01'], cancels: [[22, 36, ['tb_slash1', 'tb_stab', 'tb_flurry', 'roll']]] });
  action('stab', { clip: 'tb_stab_01', dur: 42, active: [10, 20], track: 'tb_stab', hits: [R('tb_stab', 0.2, { from: 10, to: 14 }), L('tb_stab', 0.24, { from: 17, to: 21 })], curve: 'w_step_040', turn: [8, 360], momentum: gain, sound: [9, 'hb_swing_02'], events: [{ tick: 16, type: 'sound', id: 'hb_swing_02' }], cancels: [[26, 42, ['tb_slash1', 'tb_flurry', 'roll']]] });
  // 連ね斬り: 5 回当たる。勢いをすべて使い、その段階で威力が決まる。
  action('flurry', { clip: 'tb_flurry_01', dur: 86, active: [10, 62], track: 'tb_flurry',
    hits: [R('tb_flurry', 0.2, { id: 'r1', from: 10, to: 15 }), L('tb_flurry', 0.2, { id: 'l1', from: 23, to: 28 }), R('tb_flurry', 0.2, { id: 'r2', from: 36, to: 41 }), R('tb_flurry', 0.3, { id: 'r3', from: 56, to: 62, hitstop: 4 }), L('tb_flurry', 0.3, { id: 'l3', from: 56, to: 62, hitstop: 4 })],
    momentum: { spendScale: [1, 1, 1.4, 1.9] }, turn: [8, 240], sound: [9, 'hb_swing_02'], events: [{ tick: 22, type: 'sound', id: 'hb_swing_02' }, { tick: 35, type: 'sound', id: 'hb_swing_02' }, { tick: 55, type: 'sound', id: 'hb_swing_01' }], cancels: [[70, 86, ['roll']]] });
  action('draw_cross', { clip: 'tb_draw_cross_01', dur: 52, active: [30, 36], track: 'tb_draw_cross', hits: [R('tb_draw_cross', 0.22), L('tb_draw_cross', 0.22)], curve: 'w_step_060', turn: [20, 240], momentum: gain, sound: [29, 'hb_swing_01'], events: [{ tick: 4, type: 'sound', id: 'hb_draw_01' }], cancels: [[42, 52, ['tb_slash1', 'tb_stab', 'roll']]] });
  action('draw', { clip: 'tb_draw_01', dur: 30, track: 'tb_draw', sound: [4, 'hb_draw_01'] });
  action('sheathe', { clip: 'tb_sheathe_01', dur: 34, track: 'tb_sheathe', sound: [24, 'hb_sheathe_01'], finish: 'sheathed_idle' });
}
