// 太刀（細長い両手剣）の技と動き。右手が鍔のすぐ下（握り）、左手がその 0.2m 下（柄の端）。
// 右足を前にして正面に構え、振りかぶって踏み込みながら斬る。斬りは腰の回転と、両腕の押し引きで運ぶ。
// 座標はアクターのローカル（m、Y 上、+Z 前、+X 左）。数値は机上の初期値。
import { curve, family, sheathOf } from './lib.mjs';

export function longBlade() {
  const hands = { primary: 'R', second: 'along', along: -0.2, wrist: [5, 140] };
  const { fam, motion, snap, trackOf, action, pose } = family('long_blade', hands, { from: 0.2, to: 1.2, radius: 0.03, maxTurn: 1600 });
  const B = { radius: 0.12, from: 0.15, to: 1.2 };
  // 背中に負った時（握りが右肩の上、刃先は左下）
  const BACK = { grip: [-0.26, 0.18, -0.17], dir: [0.62, -0.77, -0.13], edge: [0.77, 0.62, 0] };
  fam.sheath = sheathOf('chest', [-0.26, 0.46, -0.17], BACK.dir, BACK.edge);
  const OVER = [-0.5, 0.8, 0.5];
  const AROUND = { grip: [-0.42, 0.1, -0.04], dir: [0.45, -0.7, -0.55], edge: [0.9, 0.4, 0.05], elbowR: [-0.8, 0.4, 0.1] };

  // ---- 立ち姿 ----
  // 構え（中段）: 右足が前。切っ先を相手ののどの高さへ向け、両手はへその前。
  const FEET = { R: [-0.1, 0.2, -4], L: [0.12, -0.18, 32] };
  const idle = (fam.stances.idle = pose({
    feet: FEET,
    hip: [0, -0.04, 0], hipR: [3, 8, 0], spine: [3, 2, 0], chest: [1, 2, 0],
    gripA: [-0.04, 1.08, 0.34], dirA: [0.02, 0.45, 0.89], edgeA: [0, -0.89, 0.45], on: [1],
  }));
  const sheathed = (fam.stances.sheathed = pose({
    feet: { L: [0.095, 0, 4], R: [-0.095, 0, -4] },
    grip: BACK.grip, dir: BACK.dir, edge: BACK.edge, on: [0], grab: [0],
  }));

  // 下がり斬り: 斬りながら 2.0m 跳び退く（v0.16.0。利用者の指示で 0.5m から広げた）。前半ほど速く下がる
  // 体の速さは人の範囲（秒速 6m まで）に収めるため、0.5 秒（30 tick）かけて下がる
  curve('w_back_200', [[0, 0], [8, 0], [11, -0.06], [15, -0.29], [19, -0.64], [23, -1.0], [27, -1.36], [31, -1.72], [35, -1.94], [38, -2.0], [50, -2.0]]);
  curve('w_step_040b', [[0, 0], [16, 0], [32, 0.4], [70, 0.4]]);

  /** 振りかぶり（上段）の形: 両手を額の上へ、刃は頭の後ろへ寝かせる */
  const JODAN = { gripA: [-0.05, 1.68, 0.06], dirA: [0, 0.72, -0.69], edgeA: [0, 0.69, 0.72] };

  // ---- 斬り 1（袈裟: 右上 → 左下）----
  const kesa = motion('lb_kesa_01', {
    dur: 34, from: idle, root: 'w_step_030',
    keys: [
      { t: 8, hip: [0, -0.03, -0.02], hipR: [0, -6, 0], spine: [-3, -3, 0], chest: [-3, -4, 0], ...JODAN },
      { t: 12, hip: [0, -0.05, 0.02], hipR: [4, 0, 0], spine: [4, 0, 0], chest: [2, 2, 0], gripA: [-0.08, 1.56, 0.3], dirA: [-0.05, 0.86, 0.5], edgeA: [0.2, -0.45, 0.87] },
      { t: 15, hip: [0.01, -0.08, 0.06], hipR: [7, 8, 0], spine: [8, 3, 0], chest: [4, 6, 0], gripA: [-0.02, 1.26, 0.5], dirA: [0.18, 0.22, 0.96], edgeA: [0.45, -0.88, 0.1] },
      { t: 18, hip: [0.02, -0.1, 0.07], hipR: [8, 14, 0], spine: [10, 5, 0], chest: [5, 9, 0], gripA: [0.06, 0.98, 0.44], dirA: [0.45, -0.42, 0.79], edgeA: [0.5, -0.75, -0.4] },
      { t: 22, hip: [0.02, -0.1, 0.06], hipR: [8, 15, 0], spine: [9, 5, 0], chest: [5, 10, 0], gripA: [0.08, 0.95, 0.4], dirA: [0.5, -0.42, 0.76], edgeA: [0.5, -0.75, -0.4] },
    ],
    feet: { R: [[6, 14, -0.1, 0.24, -4, 0.05]], L: [[22, 30, 0.12, -0.18, 32, 0.04]] },
  });
  trackOf('lb_kesa', B, kesa);

  // ---- 斬り 2（逆袈裟: 左下 → 右上の斬り上げ）----
  const rise = motion('lb_rise_01', {
    dur: 32, from: snap(kesa, 20), root: 'w_step_015',
    keys: [
      { t: 2, edgeA: [0.3, -0.2, 0.9] },
      { t: 5, hipR: [8, 18, 0], spine: [9, 6, 0], chest: [5, 12, 0], gripA: [0.1, 0.92, 0.36], dirA: [0.6, -0.5, 0.62], edgeA: [-0.5, 0.3, 0.8] },
      { t: 9, hip: [0.01, -0.09, 0.06], hipR: [7, 10, 0], spine: [7, 3, 0], chest: [4, 6, 0], gripA: [0.05, 1.0, 0.48], dirA: [0.48, -0.2, 0.85], edgeA: [-0.6, 0.6, 0.5] },
      { t: 12, hip: [0, -0.07, 0.06], hipR: [5, 0, 0], spine: [4, -2, 0], chest: [2, -4, 0], gripA: [-0.08, 1.22, 0.52], dirA: [0, 0.28, 0.96], edgeA: [-0.65, 0.75, 0] },
      { t: 15, hip: [-0.01, -0.06, 0.05], hipR: [3, -10, 0], spine: [1, -5, 0], chest: [0, -9, 0], gripA: [-0.2, 1.46, 0.36], dirA: [-0.45, 0.72, 0.52], edgeA: [-0.7, 0.3, -0.6] },
      { t: 19, hipR: [3, -11, 0], spine: [1, -5, 0], chest: [0, -10, 0], gripA: [-0.22, 1.48, 0.32], dirA: [-0.5, 0.74, 0.45], edgeA: [-0.7, 0.3, -0.6] },
      { t: 26, gripA: [-0.12, 1.26, 0.34], dirA: [-0.2, 0.7, 0.68], edgeA: [-0.3, -0.5, 0.8] },
    ],
    feet: { L: [[2, 8, 0.12, -0.14, 32, 0.04]], R: [[9, 15, -0.1, 0.2, -4, 0.04]] },
  });
  trackOf('lb_rise', B, rise);

  // ---- 突き（3 段目）----
  const thrust = motion('lb_thrust_01', {
    dur: 38, from: snap(rise, 18), root: 'w_step_030',
    keys: [
      { t: 7, hip: [0, -0.06, -0.03], hipR: [3, -4, 0], spine: [3, -2, 0], chest: [1, -2, 0], gripA: [-0.2, 1.12, 0.22], dirA: [0.1, 0.06, 0.99], edgeA: [0, -1, 0.06] },
      { t: 12, hip: [0, -0.08, 0.04], hipR: [6, 4, 0], spine: [6, 1, 0], chest: [3, 2, 0], gripA: [-0.06, 1.2, 0.42], dirA: [0.01, 0.03, 1], edgeA: [0, -1, 0] },
      { t: 15, hip: [0, -0.11, 0.1], hipR: [9, 10, 0], spine: [9, 3, 0], chest: [5, 6, 0], gripA: [-0.03, 1.2, 0.62], dirA: [0, 0.01, 1], edgeA: [0, -1, 0] },
      { t: 22, hip: [0, -0.11, 0.1], hipR: [9, 10, 0], spine: [9, 3, 0], chest: [5, 6, 0], gripA: [-0.03, 1.2, 0.6], dirA: [0, 0.01, 1], edgeA: [0, -1, 0] },
    ],
    feet: { R: [[7, 14, -0.1, 0.3, -4, 0.06], [30, 36, -0.1, 0.2, -4, 0.03]], L: [[22, 29, 0.12, -0.18, 32, 0.05]] },
  });
  trackOf('lb_thrust', B, thrust);

  // ---- 下がり斬り ----
  // 右から左へ胸の高さを払いながら、後ろへ大きく跳び退く（2.0m。v0.16.0）。沈んで蹴り、両足が浮いて、低く着地する。
  const back = motion('lb_back_01', {
    dur: 50, from: idle, root: 'w_back_200',
    keys: [
      { t: 7, hip: [0, -0.07, 0.01], hipR: [3, -14, 0], spine: [3, -6, 0], chest: [1, -10, 0], gripA: [-0.28, 1.34, 0.16], dirA: [-0.72, 0.4, 0.57], edgeA: [0.6, 0, 0.8] },
      { t: 10, hip: [0, -0.05, 0], hipR: [4, -6, 0], spine: [4, -3, 0], chest: [2, -5, 0], gripA: [-0.22, 1.32, 0.34], dirA: [-0.55, 0.2, 0.81], edgeA: [0.8, 0, 0.55] },
      { t: 13, hip: [0, -0.03, -0.02], hipR: [4, 6, 0], spine: [4, 2, 0], chest: [2, 4, 0], gripA: [-0.04, 1.28, 0.46], dirA: [0.1, 0.1, 0.99], edgeA: [1, 0, -0.1] },
      { t: 16, hip: [0, -0.03, -0.04], hipR: [3, 18, 0], spine: [3, 6, 0], chest: [1, 12, 0], gripA: [0.16, 1.24, 0.36], dirA: [0.72, 0.05, 0.69], edgeA: [0.7, 0, -0.72] },
      { t: 24, hip: [0, -0.03, -0.04], hipR: [3, 20, 0], spine: [3, 6, 0], chest: [1, 13, 0], gripA: [0.18, 1.22, 0.32], dirA: [0.78, 0.05, 0.62], edgeA: [0.7, 0, -0.72] },
      { t: 38, hip: [0, -0.09, -0.02], hipR: [4, 18, 0], spine: [5, 6, 0], chest: [3, 12, 0], gripA: [0.16, 1.14, 0.34], dirA: [0.7, 0.1, 0.7], edgeA: [0.7, 0, -0.72] },
      { t: 44, hip: [0, -0.05, 0], gripA: [0.06, 1.14, 0.34], dirA: [0.35, 0.4, 0.85], edgeA: [0.5, -0.6, -0.3] },
    ],
    // 両足とも 8〜38 の間に浮く（跳び退き）。左足を後ろへ引いて着く
    feet: { L: [[8, 37, 0.12, -0.42, 32, 0.24]], R: [[9, 38, -0.1, 0.16, -4, 0.2]] },
  });
  trackOf('lb_back', B, back);

  // ---- 兜割り（大きな唐竹割り）----
  // 深く振りかぶって溜め、大きく踏み込んで真っ向から斬り下ろす。隙が大きい。
  const helm = motion('lb_helm_01', {
    dur: 70, from: idle, root: 'w_step_040b',
    keys: [
      { t: 12, hip: [0, -0.04, -0.03], hipR: [-2, -4, 0], spine: [-5, -2, 0], chest: [-4, -3, 0], ...JODAN },
      { t: 24, hip: [0, -0.06, -0.04], hipR: [-3, -4, 0], spine: [-7, -2, 0], chest: [-5, -3, 0], gripA: [-0.05, 1.7, 0.02], dirA: [0, 0.6, -0.8], edgeA: [0, 0.8, 0.6] },
      { t: 30, hip: [0, -0.06, 0.03], hipR: [5, 2, 0], spine: [5, 0, 0], chest: [3, 0, 0], gripA: [-0.05, 1.58, 0.38], dirA: [0, 0.85, 0.53], edgeA: [0, -0.53, 0.85] },
      { t: 33, hip: [0, -0.12, 0.08], hipR: [10, 6, 0], spine: [12, 2, 0], chest: [6, 2, 0], gripA: [-0.03, 1.22, 0.6], dirA: [0.02, 0.15, 0.99], edgeA: [0, -0.99, 0.15] },
      { t: 36, hip: [0, -0.18, 0.1], hipR: [14, 8, 0], spine: [18, 2, 0], chest: [8, 3, 0], gripA: [-0.02, 0.86, 0.58], dirA: [0.04, -0.45, 0.89], edgeA: [0, -0.89, -0.45] },
      { t: 46, hip: [0, -0.18, 0.1], hipR: [14, 8, 0], spine: [17, 2, 0], chest: [8, 3, 0], gripA: [-0.02, 0.86, 0.56], dirA: [0.04, -0.42, 0.9], edgeA: [0, -0.89, -0.45] },
    ],
    feet: { R: [[18, 28, -0.1, 0.3, -4, 0.08]], L: [[29, 42, 0.12, -0.18, 32, 0.05]] },
  });
  trackOf('lb_helm', B, helm);

  // ---- 抜刀斬り ----
  // 右手で肩越しに柄を取り、そのまま頭上へ抜き上げて左手を添え、踏み込んで斬り下ろす。
  const drawCut = motion('lb_draw_cut_01', {
    dur: 60, from: sheathed, root: 'w_step_060', skipBody: [0, 20],
    keys: [
      { t: 6, hipR: [2, -8, 0], chest: [0, -8, 0], grab: [1], grip: BACK.grip, dir: BACK.dir, edge: BACK.edge, on: [0], elbowR: OVER },
      { t: 14, hipR: [2, -12, 0], grip: [-0.24, 0.4, 0.1], dir: [0.4, -0.6, -0.69], edge: [0.5, 0.75, -0.4], elbowR: [-0.6, 0.5, 0.6] },
      { t: 21, hipR: [0, -8, 0], spine: [-3, -3, 0], chest: [-3, -4, 0], grip: [-0.16, 0.3, 0.1], dir: [0.15, 0.5, -0.85], edge: [0, 0.85, 0.5], on: [0] },
      { t: 22, elbowR: [0, 0, 0] },
      { t: 26, on: [1], hip: [0, -0.03, -0.02], hipR: [0, -6, 0], spine: [-3, -3, 0], chest: [-3, -4, 0], ...JODAN },
      { t: 30, hip: [0, -0.05, 0.02], hipR: [4, 0, 0], spine: [4, 0, 0], chest: [2, 2, 0], gripA: [-0.08, 1.56, 0.3], dirA: [-0.05, 0.86, 0.5], edgeA: [0.2, -0.45, 0.87] },
      { t: 33, hip: [0.01, -0.08, 0.06], hipR: [7, 8, 0], spine: [8, 3, 0], chest: [4, 6, 0], gripA: [-0.02, 1.26, 0.5], dirA: [0.18, 0.22, 0.96], edgeA: [0.45, -0.88, 0.1] },
      { t: 36, hip: [0.02, -0.1, 0.07], hipR: [8, 14, 0], spine: [10, 5, 0], chest: [5, 9, 0], gripA: [0.06, 0.98, 0.44], dirA: [0.45, -0.42, 0.79], edgeA: [0.5, -0.75, -0.4] },
      { t: 42, hip: [0.02, -0.1, 0.06], hipR: [8, 15, 0], spine: [9, 5, 0], chest: [5, 10, 0], gripA: [0.08, 0.95, 0.4], dirA: [0.5, -0.42, 0.76], edgeA: [0.5, -0.75, -0.4] },
    ],
    feet: { R: [[12, 26, -0.1, 0.3, -4, 0.07]], L: [[27, 39, 0.12, -0.18, 32, 0.06]] },
  });
  trackOf('lb_draw_cut', B, drawCut);

  // ---- 抜刀・納刀 ----
  const DRAW = [
    { grip: [-0.32, -0.12, 0.02], dir: [0.2, -0.5, -0.84], edge: [0.9, 0.3, 0.05], elbowR: [-0.8, 0.1, -0.3] },
    { grip: [-0.31, -0.3, 0.02], dir: [-0.5, -0.55, -0.3], edge: [0.5, -0.3, 0.8], elbowR: [0, 0, 0] },
    { grip: [-0.26, -0.36, 0.1], dir: [-0.3, -0.2, 0.8], edge: [0.6, -0.5, 0.6] },
    { grip: [-0.2, -0.36, 0.2], dir: [0, 0.3, 0.95], edge: [0, -0.95, 0.3] },
  ];
  const draw = motion('lb_draw_01', {
    dur: 38, from: sheathed, skipBody: [0, 16],
    keys: [
      { t: 6, hipR: [2, -8, 0], chest: [0, -8, 0], grab: [1], grip: BACK.grip, dir: BACK.dir, edge: BACK.edge, on: [0], elbowR: OVER },
      { t: 10, ...AROUND },
      { t: 14, hipR: [3, -14, 0], ...DRAW[0] },
      { t: 20, ...DRAW[1] },
      { t: 26, ...DRAW[2], on: [0] },
      { t: 32, hip: [0, -0.03, 0], hipR: [3, 4, 0], ...DRAW[3] },
    ],
    feet: { R: [[12, 20, -0.1, 0.2, -4, 0.04]], L: [[21, 28, 0.12, -0.18, 32, 0.04]] },
  });
  trackOf('lb_draw', B, draw);
  const sheathe = motion('lb_sheathe_01', {
    dur: 40, from: idle, to: sheathed, skipBody: [22, 40],
    keys: [
      { t: 6, ...DRAW[3], on: [0] },
      { t: 12, hipR: [3, -10, 0], ...DRAW[2], on: [0] },
      { t: 18, ...DRAW[1] },
      { t: 24, hipR: [2, -10, 0], ...DRAW[0] },
      { t: 28, ...AROUND },
      { t: 32, hipR: [2, -8, 0], chest: [0, -8, 0], grip: BACK.grip, dir: BACK.dir, edge: BACK.edge, grab: [1], elbowR: OVER },
      { t: 34, grab: [1], elbowR: OVER },
    ],
    feet: { R: [[4, 12, -0.095, 0, -4, 0.04]], L: [[14, 22, 0.095, 0, 4, 0.04]] },
  });
  trackOf('lb_sheathe', B, sheathe);

  // ---- 技のデータ ----
  const cut = (t, coef, o = {}) => [{ id: 'blade_main', track: t, coef, hitstop: 3, ...o }];
  action('kesa', { clip: 'lb_kesa_01', dur: 34, active: [12, 18], track: 'lb_kesa', hits: cut('lb_kesa', 0.4), curve: 'w_step_030', turn: [8, 300], sound: [11, 'hb_swing_02'], cancels: [[20, 34, ['lb_rise', 'lb_back', 'lb_helm', 'roll']]] });
  action('rise', { clip: 'lb_rise_01', dur: 32, active: [9, 15], track: 'lb_rise', hits: cut('lb_rise', 0.38), curve: 'w_step_015', turn: [6, 300], sound: [8, 'hb_swing_02'], cancels: [[18, 32, ['lb_thrust', 'lb_back', 'lb_helm', 'roll']]] });
  action('thrust', { clip: 'lb_thrust_01', dur: 38, active: [12, 17], track: 'lb_thrust', hits: cut('lb_thrust', 0.5, { hitstop: 4 }), curve: 'w_step_030', turn: [8, 300], sound: [11, 'hb_swing_02'], cancels: [[24, 38, ['lb_back', 'lb_helm', 'roll']]] });
  action('back_cut', { clip: 'lb_back_01', dur: 50, active: [10, 16], track: 'lb_back', hits: cut('lb_back', 0.42), curve: 'w_back_200', turn: [8, 300], sound: [9, 'hb_swing_02'], cancels: [[38, 50, ['lb_kesa', 'lb_helm', 'roll']]] });
  action('helm', { clip: 'lb_helm_01', dur: 70, active: [30, 36], track: 'lb_helm', hits: cut('lb_helm', 1.15, { hitstop: 7 }), curve: 'w_step_040b', turn: [24, 150], sound: [29, 'hb_swing_01'], cancels: [[54, 70, ['roll']]] });
  action('draw_cut', { clip: 'lb_draw_cut_01', dur: 60, active: [30, 36], track: 'lb_draw_cut', hits: cut('lb_draw_cut', 0.48), curve: 'w_step_060', turn: [20, 180], sound: [29, 'hb_swing_02'], events: [{ tick: 3, type: 'sound', id: 'hb_draw_01' }], cancels: [[44, 60, ['lb_rise', 'lb_back', 'roll']]] });
  action('draw', { clip: 'lb_draw_01', dur: 38, track: 'lb_draw', sound: [4, 'hb_draw_01'] });
  action('sheathe', { clip: 'lb_sheathe_01', dur: 40, track: 'lb_sheathe', sound: [28, 'hb_sheathe_01'], finish: 'sheathed_idle' });
}
