// 旋鎌（大鎌）の技と動き。右手が柄の下（握り）、左手がその 0.64m 先。左足を前にした半身。
// 薙ぎは、腕で振り回すのではなく、腰 → 背 → 胸の順に体を回して柄を運ぶ（手は胸の前からあまり動かない）。
// だから薙ぎのキーは「胸の座標」（両肩の中点が原点）で書いてある。数値は机上の初期値。
import { B, curve, family, sheathOf } from './lib.mjs';

export function reapScythe() {
  const hands = { primary: 'R', second: 'along', along: 0.64, wrist: [10, 150] };
  const { fam, motion, snap, solve, track, trackOf, action, pose } = family('reap_scythe', hands, { from: 0.78, to: 1.45, radius: 0.02, blade: { at: 1.4, out: 0.72 }, maxTurn: 1100 });
  const SHAFT = { radius: 0.07, from: 0.35, to: 1.4 };
  const BLADE = { radius: 0.1, from: 0, to: 0.7 };
  // 背中に負った時の、握りの位置と柄の向き（胸の座標）。右手が肩越しに届く所。
  const BACK = { grip: [-0.26, 0.18, -0.17], dir: [0.62, -0.77, -0.13], edge: [0.77, 0.62, 0] };
  fam.sheath = sheathOf('chest', [-0.26, 0.46, -0.17], BACK.dir, BACK.edge);
  /** 肩越しに背の柄へ手を伸ばす時の、ひじの向き（上・外・前） */
  const OVER = [-0.5, 0.8, 0.5];
  /** 背から体の右へ柄を回す途中（手は肩の外を通る） */
  const AROUND = { grip: [-0.42, 0.1, -0.04], dir: [0.45, -0.7, -0.55], edge: [0.9, 0.4, 0.05], elbowR: [-0.8, 0.4, 0.1] };
  /** 右 → 左へ薙ぐ時の刃の向き（柄の向き d に対して、進む側）。左 → 右は逆。 */
  const r2l = (d) => [d[2], 0, -d[0]];
  const l2r = (d) => [-d[2], 0, d[0]];

  // ---- 立ち姿 ----
  // 構え: 左肩を前にした半身。柄を体の前で斜めに持つ（石突が右腰、刃は正面の頭上）。
  // 左手が前にあるので、柄は胸の正面より左を向く。体を右へ開いて立つと、それが敵の方になる。
  const idle = (fam.stances.idle = pose({
    feet: { L: [0.1, 0.2, 6], R: [-0.14, -0.2, -42] },
    hip: [0, -0.05, 0], hipR: [3, -42, 0], spine: [4, -8, 0], chest: [2, -10, 0],
    grip: [-0.22, -0.42, 0.02], dir: [0.74, 0.38, 0.56], edge: [0.3, -0.9, 0.1], on: [1],
  }));
  const sheathed = (fam.stances.sheathed = pose({
    feet: { L: [0.095, 0, 4], R: [-0.095, 0, -4] },
    grip: BACK.grip, dir: BACK.dir, edge: BACK.edge, on: [0], grab: [0],
  }));

  curve('w_step_060', [[0, 0], [14, 0], [30, 0.6], [62, 0.6]]);
  curve('w_back_060', [[0, 0], [14, 0], [34, -0.6], [50, -0.6]]);

  // 薙ぎの形（胸の座標）: 柄が胸の正面より左へ何度を向くか（30° 〜 86°）ごとの、握りの位置と柄の向き。
  // 左手が柄に届く範囲で決めてある。薙ぎの大きな弧は、この形のまま、腰・背・胸を回して作る。
  const A = {
    30: { grip: [-0.25, -0.37, -0.12], dir: [0.5, 0.05, 0.864] },
    34: { grip: [-0.24, -0.37, -0.08], dir: [0.56, 0.05, 0.83] },
    45: { grip: [-0.23, -0.36, -0.04], dir: [0.707, 0.03, 0.707] },
    60: { grip: [-0.21, -0.36, 0.04], dir: [0.866, 0.02, 0.5] },
    80: { grip: [-0.18, -0.37, 0.16], dir: [0.985, -0.02, 0.17] },
    86: { grip: [-0.17, -0.38, 0.2], dir: [0.997, -0.03, 0.07] },
  };
  /** 体の向き（腰 + 背 + 胸の合計。度。- が右）を、腰 58%・背 17%・胸 25% に分ける。lean は前傾。 */
  const Y = (tot, lean = 5) => ({ hipR: [lean * 0.6, tot * 0.58, 0], spine: [lean, tot * 0.17, 0], chest: [lean * 0.4, tot * 0.25, 0] });
  const k = (t, shape, edgeOf, body) => ({ t, grip: shape.grip, dir: shape.dir, edge: edgeOf(shape.dir), ...body });

  // ---- 薙ぎ 1（右 → 左）----
  // 腰を右へ深く巻いて柄を右後ろへ引き、左へ巻き戻しながら正面を薙ぐ。正面を通る時に腰を前へ入れる。
  const sweep1 = motion('rs_sweep1_01', {
    dur: 48, from: idle,
    keys: [
      k(11, A[30], r2l, { hip: [-0.03, -0.08, -0.05], ...Y(-100, 4) }),
      k(14, A[34], r2l, { hip: [-0.02, -0.09, -0.02], ...Y(-84, 6) }),
      k(19, A[45], r2l, { hip: [0, -0.1, 0.08], ...Y(-40, 11) }),
      k(24, A[60], r2l, { hip: [0.02, -0.1, 0.08], ...Y(0, 10) }),
      k(28, A[80], r2l, { hip: [0.04, -0.08, 0.05], ...Y(20, 7) }),
      k(32, A[86], r2l, { hip: [0.04, -0.08, 0.04], ...Y(24, 6) }),
      { t: 40, edge: [0, -1, 0] },
    ],
  });
  // ---- 薙ぎ 2（左 → 右の返し）----
  // 薙ぎ 1 の振り抜きから。柄を手の中で半回転させて刃を返し、腰を右へ巻きながら正面を戻す。
  const sweep2 = motion('rs_sweep2_01', {
    dur: 46, from: snap(sweep1, 32),
    keys: [
      { t: 4, edge: [0, 1, 0] },
      k(7, A[86], l2r, { hip: [0.04, -0.08, 0.04], ...Y(28, 6) }),
      k(12, A[80], l2r, { hip: [0.03, -0.09, 0.05], ...Y(20, 7) }),
      k(17, A[60], l2r, { hip: [0.01, -0.1, 0.08], ...Y(0, 10) }),
      k(21, A[45], l2r, { hip: [0, -0.1, 0.08], ...Y(-40, 11) }),
      k(26, A[34], l2r, { hip: [-0.02, -0.09, -0.02], ...Y(-84, 6) }),
      k(30, A[30], l2r, { hip: [-0.03, -0.08, -0.05], ...Y(-100, 4) }),
      { t: 38, edge: [-0.3, -0.9, 0] },
    ],
  });

  // 体ごと回る時の足: 軸足（母指球）を体の真下に置いて半回転し、反対の足を回し込んで次の軸足にする。
  // from / to は回る区間。turns は回転数。返り値は { L, R } の歩。
  const pivots = (from, to, turns) => {
    const half = (to - from) / (turns * 2);
    const L = [[from - 7, from - 1, 0.05, -0.02, 10, 0.04, 1]], R = [];
    for (let i = 0; i < turns * 2; i++) {
      const t0 = from + half * i, t1 = from + half * (i + 1);
      const last = i === turns * 2 - 1;
      if (i % 2 === 0) R.push([t0 - 1, t1 - 1, -0.06, 0, -15, 0.1, 1]);
      else L.push(last ? [t0 - 1, t1 - 1, 0.1, 0.2, 6, 0.1, 0] : [t0 - 1, t1 - 1, 0.05, -0.02, 10, 0.1, 1]);
    }
    R.push([to, to + 9, -0.14, -0.2, -42, 0.05, 0]);
    return { L, R };
  };
  /** 回っている間、重心を軸足の上へ寄せるキー */
  const lean = (from, to, turns) => {
    const half = (to - from) / (turns * 2);
    return Array.from({ length: turns * 2 }, (_, i) => ({ t: Math.round(from + half * (i + 0.5)), hip: [i % 2 === 0 ? 0.08 : -0.08, -0.1, 0] }));
  };

  // ---- 回し薙ぎ（3 段目。体ごと 1 回転）----
  // 薙ぎ 2 の振り抜き（右へ巻いた形）から、刃を返して、左回りに 1 回転。柄は右前へ出したまま、体の回転で運ぶ。
  const SPIN = { from: 16, to: 50, degrees: 360 };
  const spin = motion('rs_spin_01', {
    dur: 68, from: snap(sweep2, 30), spin: SPIN,
    keys: [
      { t: 5, edge: [0, 1, 0] },
      k(11, A[30], r2l, { hip: [0.02, -0.1, 0], ...Y(-100, 4) }),
      ...lean(16, 50, 1),
      k(33, A[45], r2l, Y(-80, 7)),
      k(50, A[60], r2l, { hip: [0.02, -0.08, 0.03], ...Y(-50, 8) }),
      k(57, A[80], r2l, Y(-10, 7)),
      { t: 63, edge: [0, -1, 0] },
    ],
    feet: pivots(16, 50, 1),
  });

  // ---- 大刈り（体ごと 2 回転）----
  // 深く溜めてから、左回りに 2 回転。1 回転ごとに 1 回当たる。
  const GREAT = { from: 28, to: 96, degrees: 720 };
  const great = motion('rs_great_01', {
    dur: 136, from: idle, spin: GREAT,
    keys: [
      k(18, A[30], r2l, { hip: [-0.02, -0.14, -0.04], ...Y(-100, 7) }),
      k(26, A[30], r2l, { hip: [0.02, -0.12, 0], ...Y(-100, 7) }),
      ...lean(28, 96, 2),
      k(62, A[45], r2l, Y(-84, 7)),
      k(96, A[60], r2l, { hip: [0.02, -0.09, 0.03], ...Y(-50, 8) }),
      k(104, A[80], r2l, { hip: [0.03, -0.12, 0.04], ...Y(0, 10) }),
      { t: 120, hip: [0.02, -0.1, 0.02], ...Y(-20, 8), grip: A[60].grip, dir: [0.8, 0.25, 0.5], edge: [0.3, -0.9, -0.2] },
    ],
    feet: pivots(28, 96, 2),
  });

  // ---- 引き刈り ----
  // 左肩を入れて柄を奥へ伸ばし、刃を下向きに掛けて、後ろへ下がりながら手前へ引く。
  const pull = motion('rs_pull_01', {
    dur: 50, from: idle, root: 'w_back_060',
    keys: [
      { t: 11, hip: [0, -0.1, 0.12], hipR: [10, -40, 0], spine: [8, -6, 0], chest: [4, -6, 0], look: [0, -5], gripA: [-0.2, 1.06, 0.26], dirA: [0.24, 0.1, 0.97], edgeA: [0, -1, 0.1] },
      { t: 16, hip: [0, -0.1, 0.12], hipR: [10, -40, 0], spine: [8, -6, 0], chest: [4, -6, 0], gripA: [-0.21, 1.05, 0.24], dirA: [0.22, 0.08, 0.975], edgeA: [0, -1, 0.1] },
      { t: 27, hip: [0, -0.07, -0.06], hipR: [2, -30, 0], spine: [0, -5, 0], chest: [-2, -5, 0], look: [0, 0], gripA: [-0.36, 1.0, -0.2], dirA: [0.3, 0.12, 0.95], edgeA: [0, -1, 0.1] },
      { t: 35, hip: [0, -0.07, -0.05], hipR: [2, -30, 0], spine: [1, -5, 0], chest: [-1, -5, 0], gripA: [-0.36, 1.0, -0.18], dirA: [0.3, 0.2, 0.93], edgeA: [0, -0.9, 0.4] },
    ],
    feet: { R: [[13, 23, -0.14, -0.53, -42, 0.05]], L: [[21, 33, 0.1, 0.23, 6, 0.05]] },
  });

  // ---- 抜刀薙ぎ ----
  // 右手で背の柄を取り、体の右を回して前へ出しながら踏み込む。柄が左前へ来た所で左手を添え、そのまま右 → 左へ薙ぐ。
  const drawSweep = motion('rs_draw_sweep_01', {
    dur: 62, from: sheathed, root: 'w_step_060', skipBody: [0, 18],
    keys: [
      { t: 6, hipR: [2, -8, 0], chest: [0, -8, 0], grab: [1], grip: BACK.grip, dir: BACK.dir, edge: BACK.edge, on: [0], elbowR: OVER },
      { t: 10, ...AROUND },
      { t: 14, hipR: [3, -24, 0], spine: [3, -8, 0], chest: [1, -12, 0], grip: [-0.32, -0.12, 0.02], dir: [0.2, -0.5, -0.84], edge: [0.9, 0.3, 0.05], elbowR: [-0.8, 0.1, -0.3] },
      { t: 16, edge: [0.3, 0.3, 0.9] },
      { t: 19, hip: [-0.02, -0.06, -0.03], ...Y(-70, 4), grip: [-0.3, -0.36, -0.02], dir: [-0.75, -0.1, -0.65], edge: r2l([-0.75, 0, -0.65]), elbowR: [0, 0, 0] },
      { t: 24, ...Y(-80, 4), grip: [-0.27, -0.37, -0.06], dir: [-0.85, -0.02, 0.5], edge: r2l([-0.85, 0, 0.5]) },
      { t: 28, on: [0] },
      { t: 29, ...Y(-84, 4), grip: [-0.25, -0.37, -0.1], dir: [-0.1, 0.02, 0.99], edge: r2l([-0.1, 0, 0.99]) },
      k(34, A[30], r2l, { hip: [-0.01, -0.08, -0.02], ...Y(-90, 5), on: [1] }),
      k(40, A[45], r2l, { hip: [0, -0.1, 0.08], ...Y(-40, 11) }),
      k(44, A[60], r2l, { hip: [0.02, -0.1, 0.08], ...Y(0, 10) }),
      k(48, A[80], r2l, { hip: [0.04, -0.08, 0.05], ...Y(20, 7) }),
      k(52, A[86], r2l, { hip: [0.04, -0.08, 0.04], ...Y(24, 6) }),
      { t: 57, grip: [-0.2, -0.4, 0.1], dir: [0.9, 0.2, 0.38], edge: [0, -1, 0] },
    ],
    feet: { R: [[3, 9, -0.12, -0.02, -40, 0.03], [33, 43, -0.14, -0.2, -42, 0.05]], L: [[12, 26, 0.1, 0.35, 6, 0.07]] },
  });

  // ---- 抜刀・納刀 ----
  // 抜刀: 右手で肩越しに柄を取り、体の右を回して前へ。柄が前へ来た所で左手を添える。納刀はその逆。
  const DRAW = [
    { grip: [-0.32, -0.12, 0.02], dir: [0.2, -0.5, -0.84], edge: [0.9, 0.3, 0.05], elbowR: [-0.8, 0.1, -0.3] },
    { grip: [-0.31, -0.32, 0], dir: [-0.5, -0.55, -0.3], edge: [0.5, -0.3, 0.8], elbowR: [0, 0, 0] },
    { grip: [-0.28, -0.4, 0.02], dir: [-0.3, -0.35, 0.75], edge: [0.6, -0.5, 0.6] },
    { grip: [-0.24, -0.42, 0.04], dir: [0.3, 0.2, 0.9], edge: [0.4, -0.6, 0.6] },
  ];
  const draw = motion('rs_draw_01', {
    dur: 38, from: sheathed, skipBody: [0, 16],
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
  const sheathe = motion('rs_sheathe_01', {
    dur: 40, from: idle, to: sheathed, skipBody: [22, 40],
    keys: [
      { t: 6, ...DRAW[3], on: [0] },
      { t: 12, hipR: [3, -20, 0], ...DRAW[2], on: [0] },
      { t: 18, ...DRAW[1] },
      { t: 24, hipR: [2, -10, 0], ...DRAW[0] },
      { t: 28, ...AROUND },
      { t: 32, hipR: [2, -8, 0], chest: [0, -8, 0], grip: BACK.grip, dir: BACK.dir, edge: BACK.edge, grab: [1], elbowR: OVER },
      { t: 34, grab: [1], elbowR: OVER },
    ],
    feet: { R: [[4, 12, -0.095, 0, -4, 0.04]], L: [[14, 22, 0.095, 0, 4, 0.04]] },
  });

  // ---- 軌道 ----
  // 柄の軌道と、そこから求めた刃の軌道。刃の芯は、柄の先（握りから 1.47m）の少し横から、刃先（高さ 1.35m・横 0.74m）まで。
  const blade = (s) => {
    const side = B.vmul(B.vcross(s.weapon.normal, s.weapon.dir), -1); // 武器の -Z（刃の伸びる向き）
    const p0 = B.vadd(B.vadd(s.weapon.grip, B.vmul(s.weapon.dir, 1.47)), B.vmul(side, 0.05));
    const p1 = B.vadd(B.vadd(s.weapon.grip, B.vmul(s.weapon.dir, 1.35)), B.vmul(side, 0.74));
    return [p0, B.vsub(p1, p0)];
  };
  const both = (name, m) => {
    const normal = solve(m, 0).weapon.normal;
    trackOf(name, { ...SHAFT, normal }, m);
    trackOf(`${name}_blade`, BLADE, m, blade);
  };
  both('rs_sweep1', sweep1);
  both('rs_sweep2', sweep2);
  both('rs_spin', spin);
  both('rs_great', great);
  both('rs_pull', pull);
  both('rs_draw_sweep', drawSweep);
  trackOf('rs_draw', SHAFT, draw);
  trackOf('rs_sheathe', SHAFT, sheathe);
  void track;

  // ---- 技のデータ ----
  // 刃（切断）を先に判定し、当たらなかった時だけ柄（打撃・半分の威力）を判定する
  const hits = (t, coef, g = 'w', o = {}) => [
    { id: `blade_${g}`, track: `${t}_blade`, coef, group: g, hitstop: 3, ...o },
    { id: `shaft_${g}`, track: t, coef: Math.round(coef * 5000) / 10000, type: 'blunt', group: g, hitstop: 2, ...o },
  ];
  const walk = { speed: 1.8, turnDegPerSec: 150 };
  const gain = { gain: true };
  action('sweep1', { clip: 'rs_sweep1_01', dur: 48, active: [14, 28], track: 'rs_sweep1', hits: hits('rs_sweep1', 0.5), freeMove: walk, momentum: gain, sound: [12, 'hb_swing_01'], cancels: [[30, 48, ['rs_sweep2', 'rs_pull', 'rs_great', 'roll']]] });
  action('sweep2', { clip: 'rs_sweep2_01', dur: 46, active: [12, 26], track: 'rs_sweep2', hits: hits('rs_sweep2', 0.5), freeMove: walk, momentum: gain, sound: [10, 'hb_swing_01'], cancels: [[28, 46, ['rs_spin', 'rs_pull', 'rs_great', 'roll']]] });
  action('spin', { clip: 'rs_spin_01', dur: 68, active: [16, 50], track: 'rs_spin', hits: hits('rs_spin', 0.8), momentum: gain, spin: SPIN, turn: [12, 180], sound: [14, 'hb_swing_01'], cancels: [[54, 68, ['rs_sweep1', 'rs_pull', 'rs_great', 'roll']]] });
  action('pull', { clip: 'rs_pull_01', dur: 50, active: [16, 26], track: 'rs_pull', hits: hits('rs_pull', 0.5), curve: 'w_back_060', turn: [12, 240], momentum: gain, sound: [15, 'hb_swing_02'], cancels: [[34, 50, ['rs_sweep1', 'rs_great', 'roll']]] });
  // 大刈り: 2 回転。1 回転ごとに 1 回当たる。勢いをすべて使い、その段階で威力が決まる。
  action('great', { clip: 'rs_great_01', dur: 136, active: [28, 96], track: 'rs_great',
    hits: [...hits('rs_great', 0.6, 'a', { from: 28, to: 62, hitstop: 4 }), ...hits('rs_great', 0.6, 'b', { from: 62, to: 96, hitstop: 6 })],
    momentum: { spendScale: [1, 1, 1.45, 2] }, spin: GREAT, turn: [22, 180], events: [{ tick: 60, type: 'sound', id: 'hb_swing_01' }], sound: [26, 'hb_swing_01'], cancels: [[116, 136, ['roll']]] });
  action('draw_sweep', { clip: 'rs_draw_sweep_01', dur: 62, active: [34, 48], track: 'rs_draw_sweep', hits: hits('rs_draw_sweep', 0.5), curve: 'w_step_060', turn: [14, 180], momentum: gain, sound: [32, 'hb_swing_01'], events: [{ tick: 3, type: 'sound', id: 'hb_draw_01' }], cancels: [[52, 62, ['rs_sweep2', 'rs_pull', 'roll']]] });
  action('draw', { clip: 'rs_draw_01', dur: 38, track: 'rs_draw', sound: [4, 'hb_draw_01'] });
  action('sheathe', { clip: 'rs_sheathe_01', dur: 40, track: 'rs_sheathe', sound: [28, 'hb_sheathe_01'], finish: 'sheathed_idle' });
}
