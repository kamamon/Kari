// 大槌（両手の槌）の技と動き。右手が柄の下（握り）、左手がその 0.5m 先（頭の近く）。左足を前にした半身。
// 縦の叩きつけは、槌を頭上へ上げ、下の手を腹へ引きながら上の手で押し下ろす。横殴りは、腰・背・胸の回転で運ぶ。
// 手のキーは「胸の座標」（両肩の中点が原点）。数値は机上の初期値。
import { curve, family, sheathOf } from './lib.mjs';

export function warMaul() {
  const hands = { primary: 'R', second: 'along', along: 0.5, wrist: [10, 150] };
  const { fam, motion, snap, trackOf, action, pose } = family('war_maul', hands, { from: 0.62, to: 1.2, radius: 0.06, maxTurn: 1200 });
  /** 当たるのは頭（握りから 0.95〜1.27m） */
  const HEAD = { radius: 0.2, from: 0.95, to: 1.27 };
  // 背中に負った時（握りが右肩の上、頭は左下）
  const BACK = { grip: [-0.26, 0.18, -0.17], dir: [0.62, -0.77, -0.13], edge: [0.77, 0.62, 0] };
  fam.sheath = sheathOf('chest', [-0.26, 0.46, -0.17], BACK.dir, BACK.edge);
  const OVER = [-0.5, 0.8, 0.5];
  const AROUND = { grip: [-0.42, 0.1, -0.04], dir: [0.45, -0.7, -0.55], edge: [0.9, 0.4, 0.05], elbowR: [-0.8, 0.4, 0.1] };
  /** 右 → 左へ振る時の、叩く面の向き（柄の向き d に対して、進む側） */
  const r2l = (d) => [d[2], 0, -d[0]];
  /** 体の向き（腰 + 背 + 胸の合計。度。- が右）を、腰 58%・背 17%・胸 25% に分ける。lean は前傾。 */
  const Y = (tot, lean = 5) => ({ hipR: [lean * 0.6, tot * 0.58, 0], spine: [lean, tot * 0.17, 0], chest: [lean * 0.4, tot * 0.25, 0] });
  const FWD = [0, -0.2, 1];

  // ---- 立ち姿 ----
  // 構え: 左肩を前にした半身。槌を体の前で斜めに立て、頭を左肩の外へ預ける。
  const idle = (fam.stances.idle = pose({
    feet: { L: [0.1, 0.2, 6], R: [-0.14, -0.2, -42] },
    hip: [0, -0.05, 0], hipR: [3, -30, 0], spine: [4, -6, 0], chest: [2, -8, 0],
    grip: [-0.16, -0.5, 0.16], dir: [0.6, 0.78, 0.16], edge: [0.2, -0.3, 0.9], on: [1],
  }));
  const sheathed = (fam.stances.sheathed = pose({
    feet: { L: [0.095, 0, 4], R: [-0.095, 0, -4] },
    grip: BACK.grip, dir: BACK.dir, edge: BACK.edge, on: [0], grab: [0],
  }));

  curve('w_step_060', [[0, 0], [14, 0], [30, 0.6], [62, 0.6]]);
  curve('w_step_030b', [[0, 0], [10, 0], [22, 0.3], [50, 0.3]]);

  // 縦の叩きつけの形（胸の座標）: 頭上 → 振り下ろしの途中 → 前 → 打ち終わり。
  // 下の手（右）を腹へ引き、上の手（左）で押し下ろす。左手が届く範囲で決めてある。
  const TOP = { grip: [-0.08, 0.1, 0.2], dir: [0.1, 0.8, -0.59], edge: [0, 0.6, 0.8] };
  const DOWN1 = { grip: [-0.1, -0.2, 0.1], dir: [0.15, 0.85, 0.5], edge: [0, -0.5, 0.85] };
  const DOWN2 = { grip: [-0.16, -0.34, -0.04], dir: [0.3, 0.2, 0.93], edge: [0, -0.98, 0.2] };
  const HIT = { grip: [-0.16, -0.26, -0.1], dir: [0.3, -0.28, 0.91], edge: [0, -0.96, -0.28] };
  /** 叩きつけのキー。t0 = 頭上に上げ切る tick、a0 / a1 = 有効判定。 */
  const smashKeys = (t0, a0, a1) => [
    { t: t0, hip: [0, -0.02, -0.03], hipR: [-2, -24, 0], spine: [-6, -5, 0], chest: [-4, -6, 0], look: [0, 4], ...TOP },
    { t: a0, hip: [0, -0.06, 0.02], hipR: [6, -18, 0], spine: [8, -4, 0], chest: [4, -4, 0], look: [0, 6], ...DOWN1 },
    { t: Math.round((a0 + a1) / 2) + 1, hip: [0, -0.14, 0.06], hipR: [14, -14, 0], spine: [18, -3, 0], chest: [8, -3, 0], look: [0, 16], ...DOWN2 },
    { t: a1, hip: [0, -0.22, 0.08], hipR: [18, -12, 0], spine: [24, -3, 0], chest: [10, -3, 0], look: [0, 26], ...HIT },
    { t: a1 + 8, hip: [0, -0.22, 0.08], hipR: [18, -12, 0], spine: [23, -3, 0], chest: [10, -3, 0], look: [0, 24], ...HIT },
  ];

  // ---- 叩きつけ（縦）----
  const smash = motion('wm_smash_01', {
    dur: 56, from: idle, root: 'w_step_030b',
    keys: smashKeys(13, 22, 30),
    feet: { L: [[8, 20, 0.1, 0.24, 6, 0.06]], R: [[39, 48, -0.14, -0.2, -42, 0.05]] },
  });
  trackOf('wm_smash', HEAD, smash);

  // ---- 横殴り（右 → 左）----
  // 叩きつけの後から。腰を右へ深く巻いて槌を右後ろへ引き、左へ巻き戻しながら正面を殴る。
  const A = {
    30: { grip: [-0.25, -0.37, -0.12], dir: [0.5, 0.05, 0.864] },
    34: { grip: [-0.24, -0.37, -0.08], dir: [0.56, 0.05, 0.83] },
    45: { grip: [-0.23, -0.36, -0.04], dir: [0.707, 0.03, 0.707] },
    60: { grip: [-0.21, -0.36, 0.04], dir: [0.866, 0.02, 0.5] },
    80: { grip: [-0.18, -0.37, 0.16], dir: [0.985, -0.02, 0.17] },
    86: { grip: [-0.17, -0.38, 0.2], dir: [0.997, -0.03, 0.07] },
  };
  const k = (t, shape, body) => ({ t, grip: shape.grip, dir: shape.dir, edge: r2l(shape.dir), ...body });
  const swing = motion('wm_swing_01', {
    dur: 56, from: snap(smash, 35),
    keys: [
      { t: 8, hip: [-0.01, -0.1, 0], ...Y(-60, 8), grip: [-0.24, -0.4, -0.04], dir: [0.5, 0.3, 0.81], edge: [0.8, 0, -0.5] },
      k(15, A[30], { hip: [-0.03, -0.08, -0.05], ...Y(-100, 4), look: [0, 0] }),
      k(19, A[34], { hip: [-0.02, -0.09, -0.02], ...Y(-84, 6) }),
      k(25, A[45], { hip: [0, -0.1, 0.08], ...Y(-40, 11) }),
      k(30, A[60], { hip: [0.02, -0.1, 0.08], ...Y(0, 10) }),
      k(34, A[80], { hip: [0.04, -0.08, 0.05], ...Y(20, 7) }),
      k(38, A[86], { hip: [0.04, -0.08, 0.04], ...Y(24, 6) }),
      { t: 43, edge: [0, -1, 0] },
      { t: 48, grip: [-0.18, -0.46, 0.14], dir: [0.8, 0.5, 0.3], edge: FWD },
    ],
    feet: { R: [[4, 12, -0.14, -0.2, -42, 0.04]] },
  });
  trackOf('wm_swing', HEAD, swing);

  // ---- 溜め叩き ----
  // 頭上へ上げた所で溜める（押し続ける）。離すと叩きつける。
  const charge = motion('wm_charge_01', {
    dur: 60, from: idle, root: 'w_step_030b',
    keys: smashKeys(14, 24, 32),
    feet: { L: [[10, 22, 0.1, 0.24, 6, 0.06]], R: [[42, 51, -0.14, -0.2, -42, 0.05]] },
  });
  trackOf('wm_charge', HEAD, charge);

  // ---- 抜刀叩き ----
  // 右手で肩越しに柄を取り、前へ引き上げる。頭が背の後ろから上へ回った所で左手を添え、踏み込んで叩きつける。
  const drawSmash = motion('wm_draw_smash_01', {
    dur: 68, from: sheathed, root: 'w_step_060', skipBody: [0, 20],
    keys: [
      { t: 6, hipR: [2, -8, 0], chest: [0, -8, 0], grab: [1], grip: BACK.grip, dir: BACK.dir, edge: BACK.edge, on: [0], elbowR: OVER },
      { t: 14, hipR: [2, -16, 0], grip: [-0.24, 0.42, 0.12], dir: [0.35, -0.7, -0.62], edge: [0.5, 0.6, -0.4], elbowR: [-0.6, 0.5, 0.6] },
      { t: 21, hipR: [0, -22, 0], spine: [-4, -5, 0], chest: [-3, -6, 0], grip: [-0.14, 0.26, 0.2], dir: [0.2, 0.45, -0.87], edge: [0, 0.87, 0.45], on: [0] },
      { t: 22, elbowR: [0, 0, 0] },
      { t: 26, on: [1], hip: [0, -0.02, -0.03], hipR: [-2, -24, 0], spine: [-6, -5, 0], chest: [-4, -6, 0], look: [0, 4], ...TOP },
      ...smashKeys(27, 36, 44),
    ],
    feet: { L: [[12, 28, 0.1, 0.3, 6, 0.07]], R: [[3, 9, -0.12, -0.02, -40, 0.03], [50, 60, -0.14, -0.2, -42, 0.05]] },
  });
  trackOf('wm_draw_smash', HEAD, drawSmash);

  // ---- 抜刀・納刀 ----
  // 抜刀: 右手で肩越しに柄を取り、体の右を回して前へ。柄が前へ来た所で左手を添える。納刀はその逆。
  const DRAW = [
    { grip: [-0.32, -0.12, 0.02], dir: [0.2, -0.5, -0.84], edge: [0.9, 0.3, 0.05], elbowR: [-0.8, 0.1, -0.3] },
    { grip: [-0.31, -0.32, 0], dir: [-0.5, -0.55, -0.3], edge: [0.5, -0.3, 0.8], elbowR: [0, 0, 0] },
    { grip: [-0.28, -0.4, 0.02], dir: [-0.3, -0.35, 0.75], edge: [0.6, -0.5, 0.6] },
    { grip: [-0.22, -0.46, 0.08], dir: [0.3, 0.3, 0.9], edge: [0.4, -0.6, 0.6] },
  ];
  const draw = motion('wm_draw_01', {
    dur: 40, from: sheathed, skipBody: [0, 16],
    keys: [
      { t: 6, hipR: [2, -8, 0], chest: [0, -8, 0], grab: [1], grip: BACK.grip, dir: BACK.dir, edge: BACK.edge, on: [0], elbowR: OVER },
      { t: 10, ...AROUND },
      { t: 14, hipR: [3, -20, 0], ...DRAW[0] },
      { t: 20, ...DRAW[1] },
      { t: 27, ...DRAW[2], on: [0] },
      { t: 33, hip: [0, -0.04, 0], hipR: [3, -28, 0], ...DRAW[3] },
    ],
    feet: { L: [[12, 20, 0.1, 0.2, 6, 0.04]], R: [[21, 28, -0.14, -0.2, -42, 0.04]] },
  });
  trackOf('wm_draw', HEAD, draw);
  const sheathe = motion('wm_sheathe_01', {
    dur: 42, from: idle, to: sheathed, skipBody: [22, 42],
    keys: [
      { t: 7, ...DRAW[3], on: [0] },
      { t: 13, hipR: [3, -20, 0], ...DRAW[2], on: [0] },
      { t: 19, ...DRAW[1] },
      { t: 25, hipR: [2, -10, 0], ...DRAW[0] },
      { t: 29, ...AROUND },
      { t: 33, hipR: [2, -8, 0], chest: [0, -8, 0], grip: BACK.grip, dir: BACK.dir, edge: BACK.edge, grab: [1], elbowR: OVER },
      { t: 35, grab: [1], elbowR: OVER },
    ],
    feet: { R: [[4, 12, -0.095, 0, -4, 0.04]], L: [[14, 22, 0.095, 0, 4, 0.04]] },
  });
  trackOf('wm_sheathe', HEAD, sheathe);

  // ---- 技のデータ ----
  const hit = (t, coef, o = {}) => [{ id: 'head', track: t, coef, type: 'blunt', hitstop: 5, ...o }];
  action('smash', { clip: 'wm_smash_01', dur: 56, active: [22, 30], track: 'wm_smash', hits: hit('wm_smash', 0.6), curve: 'w_step_030b', turn: [12, 180], sound: [20, 'hb_swing_01'], events: [{ tick: 30, type: 'sound', id: 'ground_slam' }], cancels: [[36, 56, ['wm_swing', 'roll']]] });
  action('swing', { clip: 'wm_swing_01', dur: 56, active: [19, 34], track: 'wm_swing', hits: hit('wm_swing', 0.76), turn: [14, 180], sound: [17, 'hb_swing_01'], cancels: [[40, 56, ['wm_smash', 'roll']]] });
  // 溜め叩き: 頭上で溜める。段階（0〜3）で威力が上がる。
  action('charge', { clip: 'wm_charge_01', dur: 60, active: [24, 32], track: 'wm_charge', hits: hit('wm_charge', 0.72, { hitstop: 6 }), curve: 'w_step_030b', turn: [14, 150], sound: [22, 'hb_swing_01'], events: [{ tick: 32, type: 'sound', id: 'ground_slam' }],
    charge: { holdTick: 14, button: 'sub', levelTicks: [30, 60, 95], maxHoldTicks: 160, coefficientScale: [1, 1.7, 2.55, 3.8], hitstopBonus: [0, 1, 2, 4] }, cancels: [[42, 60, ['wm_swing', 'roll']]] });
  action('draw_smash', { clip: 'wm_draw_smash_01', dur: 68, active: [36, 44], track: 'wm_draw_smash', hits: hit('wm_draw_smash', 0.76), curve: 'w_step_060', turn: [20, 150], sound: [34, 'hb_swing_01'], events: [{ tick: 3, type: 'sound', id: 'hb_draw_01' }, { tick: 44, type: 'sound', id: 'ground_slam' }], cancels: [[54, 68, ['wm_swing', 'roll']]] });
  action('draw', { clip: 'wm_draw_01', dur: 40, track: 'wm_draw', sound: [4, 'hb_draw_01'] });
  action('sheathe', { clip: 'wm_sheathe_01', dur: 42, track: 'wm_sheathe', sound: [29, 'hb_sheathe_01'], finish: 'sheathed_idle' });
}
