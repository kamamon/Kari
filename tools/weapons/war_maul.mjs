// 大槌（両手の槌）の技と動き。右手が柄の下（握り）、左手がその 0.5m 先（頭の近く）。左足を前にした半身。
// 縦の叩きつけは、槌を頭上へ上げ、下の手を腹へ引きながら上の手で押し下ろす。横殴りは、腰・背・胸の回転で運ぶ。
// v0.55.0 で 2G の動作構成へ（#19 の H03。docs/spec.md の 32.21、D-148）: 主 = 叩きつけ → 叩きつけ（二）→ 振り上げ、副 = 横殴り、
// 固有を押し続けて溜める（歩ける）。放した時の段階と、動いているかで、溜め叩き・溜め振り上げ・大叩きつけ・回転攻撃に分かれる。
// 手のキーは「胸の座標」（両肩の中点が原点）。数値は机上の初期値（Kari の仮の値）。
import { D2R, curve, family, sheathOf } from './lib.mjs';

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

  // ---- 横殴り（右 → 左。副。v0.55.0 までは主の 2 段目）----
  // 腰を右へ深く巻いて槌を右後ろへ引き、左へ巻き戻しながら正面を殴る。
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
    dur: 56, from: idle,
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

  /** 柄の向き d（胸の座標）から、縦に振る時の叩く面の向き（柄に直角。柄を縦の面で回すと、面も一緒に回る） */
  const faceOf = (d) => {
    const phi = Math.atan2(d[1], d[2]) - 89 * D2R;
    return [0, Math.sin(phi), Math.cos(phi)];
  };
  const S = (grip, dir) => ({ grip, dir, edge: faceOf(dir) });

  // ---- 叩きつけ（二）（主の 2 段目。v0.55.0）----
  // 地面を叩いた槌を、腰を伸ばしながら引き起こして頭上へ戻し、もう 1 度叩きつける（1 段目より短い）。
  const smash2 = motion('wm_smash2_01', {
    dur: 58, from: snap(smash, 36),
    keys: [
      { t: 7, hip: [0, -0.12, 0.04], hipR: [8, -20, 0], spine: [6, -5, 0], chest: [2, -6, 0], look: [0, 8], ...S([-0.12, -0.12, 0.12], [0.25, 0.62, 0.74]) },
      { t: 11, hip: [0, -0.06, 0], hipR: [3, -22, 0], spine: [0, -5, 0], chest: [-2, -6, 0], look: [0, 6], ...S([-0.1, 0.02, 0.18], [0.16, 0.96, 0.22]) },
      ...smashKeys(16, 24, 32),
    ],
    feet: { R: [[6, 14, -0.14, -0.22, -42, 0.04]], L: [[46, 54, 0.1, 0.2, 6, 0.03]] },
  });
  trackOf('wm_smash2', HEAD, smash2);

  // ---- 振り上げ（主の 3 段目と、溜め 2 段の解放。v0.55.0）----
  // 地面の近くまで沈めた槌を、腰と脚で伸び上がりながら、体の前を下から頭上へ振り上げる（下から頭を打つ）。
  const upswing = motion('wm_upswing_01', {
    dur: 50, from: snap(smash2, 40), root: 'w_step_015',
    keys: [
      { t: 4, hip: [0, -0.26, 0.07], hipR: [21, -13, 0], spine: [27, -3, 0], chest: [11, -3, 0], look: [0, 27], ...S([-0.16, -0.26, -0.1], [0.3, -0.28, 0.91]) },
      { t: 10, hip: [0, -0.14, 0.05], hipR: [10, -16, 0], spine: [12, -4, 0], chest: [4, -4, 0], look: [0, 10], ...S([-0.15, -0.24, 0.04], [0.28, 0.12, 0.95]) },
      { t: 15, hip: [0, -0.04, 0.02], hipR: [0, -18, 0], spine: [-2, -5, 0], chest: [-4, -5, 0], look: [0, -4], ...S([-0.12, -0.04, 0.16], [0.18, 0.86, 0.48]) },
      { t: 20, hip: [0, 0, 0], hipR: [-4, -20, 0], spine: [-8, -5, 0], chest: [-6, -6, 0], look: [0, -8], ...S([-0.08, 0.04, 0.2], [0.08, 0.92, -0.38]) },
      { t: 28, hip: [0, -0.02, 0], hipR: [-2, -22, 0], spine: [-6, -5, 0], chest: [-4, -6, 0], look: [0, -4], ...S([-0.09, 0.02, 0.2], [0.1, 0.94, -0.3]) },
    ],
    feet: { L: [[3, 9, 0.1, 0.24, 6, 0.05], [42, 48, 0.1, 0.2, 6, 0.03]], R: [[32, 40, -0.14, -0.2, -42, 0.04]] },
  });
  trackOf('wm_upswing', HEAD, upswing);

  // ---- 溜め（固有を押し続ける。v0.55.0）----
  // 腰を落として前へ傾け、槌の頭を体の前の低い所（左寄り）へ下ろして構える。押している間は歩ける（溜め歩き）。
  const HOLD = { hip: [0, -0.16, 0.04], hipR: [12, -18, 0], spine: [14, -4, 0], chest: [6, -4, 0], look: [0, 12], ...S([-0.16, -0.3, -0.04], [0.35, -0.12, 0.93]) };
  const charge = motion('wm_charge_01', {
    dur: 12, from: idle, to: null,
    keys: [{ t: 10, ...HOLD }, { t: 12, ...HOLD }],
    feet: { L: [[2, 8, 0.12, 0.26, 6, 0.04]] },
  });
  trackOf('wm_charge', HEAD, charge);
  const held = snap(charge, 10);
  /** 溜めの構えから、頭上へ引き上げる途中 */
  const LIFT = { hip: [0, -0.08, 0.02], hipR: [4, -20, 0], spine: [2, -5, 0], chest: [0, -6, 0], look: [0, 6], ...S([-0.12, -0.1, 0.12], [0.25, 0.72, 0.65]) };

  // ---- 溜め叩き（段階 0・1 で放す）----
  const chargeSmash = motion('wm_charge_smash_01', {
    dur: 54, from: held, root: 'w_step_015',
    keys: [{ t: 6, ...LIFT }, ...smashKeys(14, 22, 30)],
    feet: { L: [[6, 12, 0.1, 0.28, 6, 0.05], [46, 52, 0.1, 0.2, 6, 0.03]], R: [[38, 46, -0.14, -0.2, -42, 0.04]] },
  });
  trackOf('wm_charge_smash', HEAD, chargeSmash);

  // ---- 大叩きつけ（段階 3 で、止まって放す）----
  // 頭上へ大きく振りかぶって叩きつけ、引き起こしてさらに高く振りかぶり、深く沈んでもう 1 度叩きつける（2 回目が重い）。
  const pound = motion('wm_pound_01', {
    dur: 94, from: held, root: 'w_step_015',
    keys: [
      { t: 6, ...LIFT },
      { t: 14, hip: [0, -0.02, -0.03], hipR: [-4, -26, 0], spine: [-8, -6, 0], chest: [-6, -7, 0], look: [0, 2], ...TOP },
      { t: 23, hip: [0, -0.06, 0.02], hipR: [6, -18, 0], spine: [8, -4, 0], chest: [4, -4, 0], look: [0, 6], ...DOWN1 },
      { t: 28, hip: [0, -0.12, 0.06], hipR: [12, -14, 0], spine: [16, -3, 0], chest: [7, -3, 0], look: [0, 14], ...DOWN2 },
      { t: 31, hip: [0, -0.16, 0.07], hipR: [14, -13, 0], spine: [18, -3, 0], chest: [8, -3, 0], look: [0, 20], ...HIT },
      { t: 40, hip: [0, -0.06, 0.02], hipR: [2, -22, 0], spine: [-2, -5, 0], chest: [-2, -6, 0], look: [0, 4], ...S([-0.12, -0.06, 0.14], [0.2, 0.8, 0.56]) },
      { t: 47, hip: [0, 0, -0.03], hipR: [-4, -26, 0], spine: [-10, -6, 0], chest: [-6, -7, 0], look: [0, 0], ...S([-0.06, 0.12, 0.18], [0.06, 0.82, -0.57]) },
      { t: 56, hip: [0, -0.07, 0.02], hipR: [6, -18, 0], spine: [8, -4, 0], chest: [4, -4, 0], look: [0, 6], ...DOWN1 },
      { t: 61, hip: [0, -0.16, 0.06], hipR: [15, -14, 0], spine: [20, -3, 0], chest: [8, -3, 0], look: [0, 16], ...DOWN2 },
      { t: 64, hip: [0, -0.25, 0.09], hipR: [20, -12, 0], spine: [27, -3, 0], chest: [11, -3, 0], look: [0, 28], ...HIT },
      { t: 73, hip: [0, -0.25, 0.09], hipR: [20, -12, 0], spine: [26, -3, 0], chest: [11, -3, 0], look: [0, 26], ...HIT },
    ],
    feet: { L: [[6, 14, 0.1, 0.28, 6, 0.05], [84, 90, 0.1, 0.2, 6, 0.03]], R: [[76, 84, -0.14, -0.2, -42, 0.04]] },
  });
  trackOf('wm_pound', HEAD, pound);

  // ---- 回転攻撃（段階 3 で、動きながら放す）----
  // 槌を左へ水平に振り出し、右足の母指球を軸に、体ごと右へ 2 回転（spin −720°）して周りを殴る。左足で地面を蹴り続ける。
  // 回り終えたら、振り上げて叩きつけで締める。
  const BZ = 0.13;
  const R_PIVOT = [-Math.sin(-30 * D2R) * BZ, -Math.cos(-30 * D2R) * BZ];
  const OUT = { grip: [-0.1, -0.32, 0.22], dir: [0.9, -0.02, 0.43], edge: [-0.43, 0, 0.9] };
  const SPIN_BODY = { hip: [0, -0.1, 0], hipR: [6, -2, 0], spine: [6, 0, 0], chest: [3, 0, 0], look: [0, 4] };
  const kick = (a) => [a, a + 8, 0.22, 0.2, 20, 0.05];
  const spin = motion('wm_spin_01', {
    dur: 140, from: held, spin: { from: 12, to: 80, degrees: -720 },
    keys: [
      { t: 8, hip: [0, -0.12, 0.02], hipR: [8, 14, 0], spine: [8, 4, 0], chest: [4, 8, 0], look: [0, 8], grip: [-0.11, -0.33, 0.22], dir: [0.88, -0.05, 0.47], edge: [-0.47, 0, 0.88] },
      { t: 12, ...SPIN_BODY, ...OUT },
      { t: 46, ...SPIN_BODY, ...OUT },
      { t: 79, ...SPIN_BODY, ...OUT },
      { t: 88, ...LIFT },
      ...smashKeys(96, 105, 113),
    ],
    feet: {
      R: [[3, 10, R_PIVOT[0], R_PIVOT[1], -30, 0.04, 1], [98, 106, -0.14, -0.2, -42, 0.04]],
      L: [kick(12), kick(20), kick(28), kick(36), kick(44), kick(52), kick(60), kick(68), [76, 82, 0.22, 0.2, 20, 0.04], [88, 94, 0.1, 0.24, 6, 0.05], [124, 130, 0.1, 0.2, 6, 0.03]],
    },
  });
  trackOf('wm_spin', HEAD, spin);

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
  const H = (id, t, coef, from, to, o = {}) => ({ id, track: t, coef, type: 'blunt', hitstop: 5, from, to, ...o });
  // 技の後半から出せる技: 副 = 横殴り、固有 = 溜め（押し続ける）
  const NEXT = ['wm_swing', 'wm_charge', 'roll'];
  action('smash', { clip: 'wm_smash_01', dur: 56, active: [22, 30], track: 'wm_smash', hits: hit('wm_smash', 0.6), curve: 'w_step_030b', turn: [12, 180], sound: [20, 'hb_swing_01'], events: [{ tick: 30, type: 'sound', id: 'ground_slam' }], cancels: [[36, 56, ['wm_smash2', ...NEXT]]] });
  action('smash2', { clip: 'wm_smash2_01', dur: 58, active: [24, 33], track: 'wm_smash2', hits: hit('wm_smash2', 0.5), turn: [8, 180], sound: [22, 'hb_swing_01'], events: [{ tick: 32, type: 'sound', id: 'ground_slam' }], cancels: [[40, 58, ['wm_upswing', ...NEXT]]] });
  action('upswing', { clip: 'wm_upswing_01', dur: 50, active: [10, 20], track: 'wm_upswing', hits: hit('wm_upswing', 0.8, { hitstop: 6 }), curve: 'w_step_015', turn: [6, 180], sound: [9, 'hb_swing_01'], cancels: [[36, 50, ['wm_smash', ...NEXT]]] });
  action('swing', { clip: 'wm_swing_01', dur: 56, active: [19, 34], track: 'wm_swing', hits: hit('wm_swing', 0.76), turn: [14, 180], sound: [17, 'hb_swing_01'], cancels: [[40, 56, ['wm_smash', 'wm_charge', 'roll']]] });
  // 溜め: 固有を押し続ける間は構えたまま歩ける（スタミナが減る）。放した時の段階と、スティックを倒しているかで分かれる
  action('charge', { clip: 'wm_charge_01', dur: 12, track: 'wm_charge', turn: [10, 180], freeMove: { speed: 1.3, turnDegPerSec: 180, from: 10 },
    charge: { holdTick: 10, button: 'special', levelTicks: [30, 60, 95], maxHoldTicks: 600, coefficientScale: [1, 1, 1, 1], hitstopBonus: [0, 0, 0, 0], staminaPerSec: 8,
      release: [
        { level: 3, moving: true, into: 'player.war_maul.spin' },
        { level: 3, into: 'player.war_maul.pound' },
        { level: 2, into: 'player.war_maul.charge_upswing' },
        { level: 0, into: 'player.war_maul.charge_smash' },
      ] },
    cancels: [[10, 12, ['roll']]] });
  action('charge_smash', { clip: 'wm_charge_smash_01', dur: 54, active: [22, 31], track: 'wm_charge_smash', hits: hit('wm_charge_smash', 0.75, { hitstop: 6 }), curve: 'w_step_015', sound: [20, 'hb_swing_01'], events: [{ tick: 30, type: 'sound', id: 'ground_slam' }], cancels: [[38, 54, ['wm_smash2', ...NEXT]]] });
  action('charge_upswing', { clip: 'wm_upswing_01', dur: 50, active: [10, 20], track: 'wm_upswing', hits: hit('wm_upswing', 1.2, { hitstop: 8 }), curve: 'w_step_015', sound: [9, 'hb_swing_01'], cancels: [[36, 50, ['wm_smash', ...NEXT]]] });
  action('pound', { clip: 'wm_pound_01', dur: 94, active: [23, 65], track: 'wm_pound', hits: [H('head1', 'wm_pound', 0.8, 23, 32, { hitstop: 6 }), H('head2', 'wm_pound', 1.5, 56, 65, { hitstop: 9 })], curve: 'w_step_015',
    sound: [21, 'hb_swing_01'], events: [{ tick: 31, type: 'sound', id: 'ground_slam' }, { tick: 54, type: 'sound', id: 'hb_swing_01' }, { tick: 64, type: 'sound', id: 'ground_slam' }], cancels: [[80, 94, ['roll']]] });
  action('spin', { clip: 'wm_spin_01', dur: 140, active: [14, 114], track: 'wm_spin', hits: [H('spin1', 'wm_spin', 0.5, 14, 46), H('spin2', 'wm_spin', 0.5, 46, 80), H('head', 'wm_spin', 0.9, 105, 114, { hitstop: 7 })], spin: { from: 12, to: 80, degrees: -720 },
    sound: [12, 'hb_swing_01'], events: [{ tick: 46, type: 'sound', id: 'hb_swing_01' }, { tick: 103, type: 'sound', id: 'hb_swing_01' }, { tick: 113, type: 'sound', id: 'ground_slam' }], cancels: [[118, 140, ['roll']]] });
  action('draw_smash', { clip: 'wm_draw_smash_01', dur: 68, active: [36, 44], track: 'wm_draw_smash', hits: hit('wm_draw_smash', 0.76), curve: 'w_step_060', turn: [20, 150], sound: [34, 'hb_swing_01'], events: [{ tick: 3, type: 'sound', id: 'hb_draw_01' }, { tick: 44, type: 'sound', id: 'ground_slam' }], cancels: [[54, 68, ['wm_smash2', ...NEXT]]] });
  action('draw', { clip: 'wm_draw_01', dur: 40, track: 'wm_draw', sound: [4, 'hb_draw_01'] });
  action('sheathe', { clip: 'wm_sheathe_01', dur: 42, track: 'wm_sheathe', sound: [29, 'hb_sheathe_01'], finish: 'sheathed_idle' });
}
