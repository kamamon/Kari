// 太刀（細長い両手剣）の技と動き。右手が鍔のすぐ下（握り）、左手がその 0.2m 下（柄の端）。
// 右足を前にして正面に構え、振りかぶって踏み込みながら斬る。斬りは腰の回転と、両腕の押し引きで運ぶ。
// v0.56.0 で 2G の動作構成へ（#19 の H03。docs/spec.md の 32.22、D-149）: 主と副の同時押し = 下がり斬り、固有 = 斬ってためた「気」を使う気合い斬り。兜割りは外した。
// v0.62.0 で 2G の連係へ（docs/spec.md の 32.28、D-156。依頼 11 の第 2 便）: 主 = 縦斬り → 突き → 斬り上げ →（縦斬り）、副 = 突き → 斬り上げ、
// 抜刀攻撃 = 踏み込み斬り（縦）、固有 = 気合い斬り 一 → 二 → 三（ここで終わる。後年の大回り斬りは外した）。
// 気合い斬り 一の後の突き・二の後の斬り上げを挟んでも、固有で次の段へ続く（2G の 気刃1 → 突き → 気刃2 → 斬り上げ → 気刃3）。
// 座標はアクターのローカル（m、Y 上、+Z 前、+X 左）。数値は机上の初期値（Kari の仮の値）。
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

  /** 振りかぶり（上段）の形: 両手を額の上へ、刃は頭の後ろへ寝かせる */
  const JODAN = { gripA: [-0.05, 1.68, 0.06], dirA: [0, 0.72, -0.69], edgeA: [0, 0.69, 0.72] };

  // ---- 縦斬り（主の 1 段目。v0.62.0 で 2G を手本に、袈裟から作り直した）----
  // 両手を額の上へ振りかぶり（〜8。刃は頭の後ろ）、右足を踏み込みながら、体の真ん中を真上から真下へ斬り下ろす（12〜18）。
  // 刃は体の前の縦の面を通り、刃先は前の低い所で止まる。刃の向きは振る向きの前（上 → 前 → 下）
  const VSTRIKE = [
    { t: 12, hip: [0, -0.05, 0.02], hipR: [4, 4, 0], spine: [3, 1, 0], chest: [2, 2, 0], gripA: [-0.06, 1.58, 0.28], dirA: [0, 0.86, 0.5], edgeA: [0, -0.5, 0.86] },
    { t: 15, hip: [0, -0.08, 0.06], hipR: [7, 6, 0], spine: [8, 2, 0], chest: [4, 3, 0], gripA: [-0.05, 1.3, 0.5], dirA: [0, 0.15, 0.99], edgeA: [0, -0.99, 0.15] },
    { t: 18, hip: [0, -0.11, 0.07], hipR: [9, 7, 0], spine: [12, 2, 0], chest: [6, 3, 0], gripA: [-0.04, 1.02, 0.48], dirA: [0, -0.5, 0.87], edgeA: [0, -0.87, -0.5] },
    { t: 22, hip: [0, -0.11, 0.06], hipR: [9, 7, 0], spine: [11, 2, 0], chest: [6, 3, 0], gripA: [-0.04, 0.99, 0.45], dirA: [0, -0.55, 0.83], edgeA: [0, -0.83, -0.55] },
  ];
  const vertical = motion('lb_vertical_01', {
    dur: 34, from: idle, root: 'w_step_030',
    keys: [
      { t: 8, hip: [0, -0.03, -0.02], hipR: [0, 2, 0], spine: [-3, 0, 0], chest: [-3, 0, 0], ...JODAN },
      ...VSTRIKE,
    ],
    feet: { R: [[6, 14, -0.1, 0.24, -4, 0.05]], L: [[22, 30, 0.12, -0.18, 32, 0.04]] },
  });
  trackOf('lb_vertical', B, vertical);

  // ---- 突き（主の 2 段目・副。構えからも）----
  const thrust = motion('lb_thrust_01', {
    dur: 38, from: idle, root: 'w_step_030',
    keys: [
      { t: 7, hip: [0, -0.06, -0.03], hipR: [3, -4, 0], spine: [3, -2, 0], chest: [1, -2, 0], gripA: [-0.2, 1.12, 0.22], dirA: [0.1, 0.06, 0.99], edgeA: [0, -1, 0.06] },
      { t: 12, hip: [0, -0.08, 0.04], hipR: [6, 4, 0], spine: [6, 1, 0], chest: [3, 2, 0], gripA: [-0.06, 1.2, 0.42], dirA: [0.01, 0.03, 1], edgeA: [0, -1, 0] },
      { t: 15, hip: [0, -0.11, 0.1], hipR: [9, 10, 0], spine: [9, 3, 0], chest: [5, 6, 0], gripA: [-0.03, 1.2, 0.62], dirA: [0, 0.01, 1], edgeA: [0, -1, 0] },
      { t: 22, hip: [0, -0.11, 0.1], hipR: [9, 10, 0], spine: [9, 3, 0], chest: [5, 6, 0], gripA: [-0.03, 1.2, 0.6], dirA: [0, 0.01, 1], edgeA: [0, -1, 0] },
    ],
    feet: { R: [[7, 14, -0.1, 0.3, -4, 0.06], [30, 36, -0.1, 0.2, -4, 0.03]], L: [[22, 29, 0.12, -0.18, 32, 0.05]] },
  });
  trackOf('lb_thrust', B, thrust);

  // ---- 斬り 2（逆袈裟: 左下 → 右上の斬り上げ）----
  // v0.62.0: 突きの後（2G の 突き → 斬り上げ）。突き出した刃を左下へ下ろして返し、右上へ斬り上げる
  const rise = motion('lb_rise_01', {
    dur: 32, from: snap(thrust, 30), root: 'w_step_015',
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

  // ---- 気合い斬り 一（固有。v0.56.0）----
  // 刃を左肩の上へ担ぎ、左上から右下へ斜めに斬り下ろす（袈裟の逆）。腰は左から右へ回る。
  const spirit1 = motion('lb_spirit1_01', {
    dur: 36, from: idle, root: 'w_step_015',
    keys: [
      { t: 8, hip: [0, -0.04, -0.02], hipR: [2, 16, 0], spine: [-1, 6, 0], chest: [-2, 10, 0], gripA: [0.06, 1.5, 0.14], dirA: [0.3, 0.8, -0.52], edgeA: [-0.36, 0.6, 0.71] },
      { t: 13, hip: [0, -0.06, 0.03], hipR: [5, 6, 0], spine: [5, 2, 0], chest: [2, 4, 0], gripA: [0, 1.4, 0.42], dirA: [-0.25, 0.7, 0.67], edgeA: [-0.6, -0.66, 0.47] },
      { t: 16, hip: [-0.01, -0.08, 0.06], hipR: [7, -4, 0], spine: [8, -2, 0], chest: [4, -4, 0], gripA: [-0.08, 1.12, 0.5], dirA: [-0.4, 0.05, 0.92], edgeA: [-0.02, -1, 0.05] },
      { t: 19, hip: [-0.02, -0.1, 0.07], hipR: [8, -14, 0], spine: [10, -5, 0], chest: [5, -9, 0], gripA: [-0.18, 0.96, 0.4], dirA: [-0.62, -0.42, 0.66], edgeA: [-0.22, -0.72, -0.66] },
      { t: 25, hip: [-0.02, -0.1, 0.06], hipR: [8, -15, 0], spine: [9, -5, 0], chest: [5, -10, 0], gripA: [-0.2, 0.95, 0.38], dirA: [-0.65, -0.42, 0.63], edgeA: [-0.22, -0.72, -0.66] },
    ],
    feet: { R: [[6, 12, -0.1, 0.26, -4, 0.05]], L: [[24, 30, 0.12, -0.18, 32, 0.04]] },
  });
  trackOf('lb_spirit1', B, spirit1);

  // ---- 気合い斬り 二 ----
  // 右下に残った刃を右後ろへ引いて寝かせ、胸の高さを右から左へ水平に払う。
  const spirit2 = motion('lb_spirit2_01', {
    dur: 34, from: snap(spirit1, 25), root: 'w_step_015',
    keys: [
      { t: 3, gripA: [-0.26, 1.08, 0.32], dirA: [-0.74, -0.23, 0.63], edgeA: [0.45, -0.87, 0.18] },
      { t: 6, hip: [-0.01, -0.07, -0.02], hipR: [4, -24, 0], spine: [4, -8, 0], chest: [2, -14, 0], gripA: [-0.32, 1.24, 0.26], dirA: [-0.8, 0.12, 0.58], edgeA: [0.59, 0, 0.81] },
      { t: 10, hip: [0, -0.08, 0.04], hipR: [6, -6, 0], spine: [6, -2, 0], chest: [3, -3, 0], gripA: [-0.06, 1.26, 0.48], dirA: [0, 0.08, 1], edgeA: [1, 0, 0] },
      { t: 13, hip: [0.01, -0.08, 0.05], hipR: [6, 10, 0], spine: [6, 4, 0], chest: [3, 8, 0], gripA: [0.18, 1.24, 0.38], dirA: [0.75, 0.05, 0.66], edgeA: [0.66, 0, -0.75] },
      { t: 16, hip: [0.02, -0.08, 0.04], hipR: [5, 18, 0], spine: [5, 6, 0], chest: [3, 12, 0], gripA: [0.24, 1.22, 0.3], dirA: [0.85, 0.08, 0.5], edgeA: [0.5, 0, -0.86] },
      { t: 24, hip: [0.02, -0.07, 0.03], hipR: [5, 18, 0], spine: [5, 6, 0], chest: [3, 12, 0], gripA: [0.22, 1.2, 0.32], dirA: [0.82, 0.1, 0.56], edgeA: [0.56, 0, -0.83] },
    ],
    feet: { L: [[3, 9, 0.12, -0.12, 32, 0.04]], R: [[8, 14, -0.1, 0.24, -4, 0.05]] },
  });
  trackOf('lb_spirit2', B, spirit2);

  // ---- 気合い斬り 三（2 回斬る）----
  // 左に残った刃を下から右上の頭上まで斬り上げ（1 回目）、上段で一度ためて、右上から左下へ大きく斬り下ろす（2 回目）。
  const spirit3 = motion('lb_spirit3_01', {
    dur: 52, from: snap(spirit2, 24), root: 'w_step_030',
    keys: [
      { t: 2, gripA: [0.17, 1.1, 0.34], dirA: [0.74, -0.23, 0.64], edgeA: [0.58, 0.79, -0.18] },
      { t: 5, hip: [0, -0.1, 0.02], hipR: [7, 16, 0], spine: [8, 5, 0], chest: [4, 10, 0], gripA: [0.12, 1.0, 0.38], dirA: [0.55, -0.55, 0.62], edgeA: [-0.01, 0.75, 0.66] },
      { t: 10, hip: [0, -0.06, 0.04], hipR: [4, 2, 0], spine: [2, 0, 0], chest: [0, 0, 0], gripA: [-0.04, 1.32, 0.48], dirA: [-0.05, 0.6, 0.8], edgeA: [0, 0.8, -0.6] },
      { t: 17, hip: [0, -0.03, -0.02], hipR: [0, -6, 0], spine: [-3, -3, 0], chest: [-3, -4, 0], ...JODAN },
      { t: 22, hip: [0, -0.04, -0.03], hipR: [-1, -6, 0], spine: [-4, -3, 0], chest: [-4, -4, 0], gripA: [-0.05, 1.7, 0.04], dirA: [0, 0.7, -0.71], edgeA: [0, 0.71, 0.7] },
      { t: 27, hip: [0, -0.05, 0.02], hipR: [4, 0, 0], spine: [4, 0, 0], chest: [2, 2, 0], gripA: [-0.08, 1.56, 0.3], dirA: [-0.05, 0.86, 0.5], edgeA: [0.2, -0.45, 0.87] },
      { t: 30, hip: [0.01, -0.08, 0.06], hipR: [7, 8, 0], spine: [8, 3, 0], chest: [4, 6, 0], gripA: [-0.02, 1.26, 0.5], dirA: [0.18, 0.22, 0.96], edgeA: [0.45, -0.88, 0.1] },
      { t: 33, hip: [0.02, -0.12, 0.08], hipR: [9, 14, 0], spine: [12, 5, 0], chest: [6, 9, 0], gripA: [0.06, 0.96, 0.44], dirA: [0.45, -0.44, 0.78], edgeA: [0.5, -0.75, -0.4] },
      { t: 40, hip: [0.02, -0.12, 0.07], hipR: [9, 15, 0], spine: [11, 5, 0], chest: [6, 10, 0], gripA: [0.08, 0.94, 0.4], dirA: [0.5, -0.44, 0.75], edgeA: [0.5, -0.75, -0.4] },
    ],
    feet: { R: [[20, 28, -0.1, 0.3, -4, 0.06], [44, 50, -0.1, 0.2, -4, 0.03]], L: [[36, 44, 0.12, -0.18, 32, 0.04]] },
  });
  trackOf('lb_spirit3', B, spirit3);

  // ---- 踏み込み斬り（抜刀攻撃。v0.62.0 で 2G を手本に、縦の斬り下ろしへ）----
  // 右手で肩越しに柄を取り、そのまま頭上へ抜き上げて左手を添え、大きく踏み込んで真上から斬り下ろす。
  const drawCut = motion('lb_draw_cut_01', {
    dur: 60, from: sheathed, root: 'w_step_060', skipBody: [0, 20],
    keys: [
      { t: 6, hipR: [2, -8, 0], chest: [0, -8, 0], grab: [1], grip: BACK.grip, dir: BACK.dir, edge: BACK.edge, on: [0], elbowR: OVER },
      { t: 14, hipR: [2, -12, 0], grip: [-0.24, 0.4, 0.1], dir: [0.4, -0.6, -0.69], edge: [0.5, 0.75, -0.4], elbowR: [-0.6, 0.5, 0.6] },
      { t: 21, hipR: [0, -8, 0], spine: [-3, -3, 0], chest: [-3, -4, 0], grip: [-0.16, 0.3, 0.1], dir: [0.15, 0.5, -0.85], edge: [0, 0.85, 0.5], on: [0] },
      { t: 22, elbowR: [0, 0, 0] },
      { t: 26, on: [1], hip: [0, -0.03, -0.02], hipR: [0, 2, 0], spine: [-3, 0, 0], chest: [-3, 0, 0], ...JODAN },
      // 縦斬りの斬り下ろし（12〜22）を 18 tick 後ろへ
      ...VSTRIKE.map((k) => ({ ...k, t: k.t + 18 })),
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
  // 2G の連係（v0.62.0）: 主 = 縦斬り → 突き → 斬り上げ →（縦斬り）、副 = 突き → 斬り上げ、主と副の同時押し = 下がり斬り、固有 = 気合い斬り
  // 名前: lb_vertical（主）/ lb_thrust（主）・lb_stab（副）= 突き / lb_rise（主）・lb_rise_s（副）= 斬り上げ
  action('vertical', { clip: 'lb_vertical_01', dur: 34, active: [12, 18], track: 'lb_vertical', hits: cut('lb_vertical', 0.38), curve: 'w_step_030', turn: [8, 300], sound: [11, 'hb_swing_02'], cancels: [[20, 34, ['lb_thrust', 'lb_stab', 'lb_back', 'lb_spirit', 'roll']]] });
  action('thrust', { clip: 'lb_thrust_01', dur: 38, active: [12, 17], track: 'lb_thrust', hits: cut('lb_thrust', 0.44, { hitstop: 4 }), curve: 'w_step_030', turn: [8, 300], sound: [11, 'hb_swing_02'], cancels: [[24, 38, ['lb_rise', 'lb_rise_s', 'lb_back', 'lb_spirit', 'roll']]] });
  action('rise', { clip: 'lb_rise_01', dur: 32, active: [9, 15], track: 'lb_rise', hits: cut('lb_rise', 0.72), curve: 'w_step_015', turn: [6, 300], sound: [8, 'hb_swing_02'], cancels: [[18, 32, ['lb_vertical', 'lb_stab', 'lb_back', 'lb_spirit', 'roll']]] });
  action('back_cut', { clip: 'lb_back_01', dur: 50, active: [10, 16], track: 'lb_back', hits: cut('lb_back', 0.32), curve: 'w_back_200', turn: [8, 300], sound: [9, 'hb_swing_02'], cancels: [[38, 50, ['lb_vertical', 'lb_stab', 'lb_spirit', 'roll']]] });
  // 気合い斬り: 始めた時に「気」を使う（気が 0 なら出ない）。気合い斬りの命中では、気はたまらない。三で終わる（v0.62.0。後年の大回り斬りは外した）。
  // 一の後に突き（主・副）、二の後に斬り上げ（主）を挟んでも、固有で次の段へ続く（2G の 気刃1 → 突き → 気刃2 → 斬り上げ → 気刃3）
  action('spirit1', { clip: 'lb_spirit1_01', dur: 36, active: [12, 20], track: 'lb_spirit1', hits: cut('lb_spirit1', 0.4), curve: 'w_step_015', turn: [6, 300], spirit: { cost: 15 }, sound: [11, 'hb_swing_02'], cancels: [[22, 36, ['lb_spirit2', 'lb_thrust_s1m', 'lb_thrust_s1', 'lb_back', 'roll']]] });
  action('spirit2', { clip: 'lb_spirit2_01', dur: 34, active: [9, 16], track: 'lb_spirit2', hits: cut('lb_spirit2', 0.42), curve: 'w_step_015', turn: [6, 300], spirit: { cost: 15 }, sound: [8, 'hb_swing_02'], cancels: [[22, 34, ['lb_spirit3', 'lb_rise_s2m', 'lb_stab', 'lb_back', 'roll']]] });
  action('spirit3', { clip: 'lb_spirit3_01', dur: 52, active: [6, 34], track: 'lb_spirit3', hits: [{ id: 'up', track: 'lb_spirit3', coef: 0.3, hitstop: 3, from: 6, to: 12 }, { id: 'down', track: 'lb_spirit3', coef: 0.6, hitstop: 4, from: 27, to: 34 }], curve: 'w_step_030', turn: [6, 300], spirit: { cost: 20 },
    sound: [6, 'hb_swing_02'], events: [{ tick: 26, type: 'sound', id: 'hb_swing_01' }], cancels: [[40, 52, ['lb_vertical', 'lb_stab', 'lb_back', 'roll']]] });
  // 気合い斬りの間に挟む突き・斬り上げ（動きと判定は ふつうの突き・斬り上げと同じ。固有で次の気合い斬りへ）
  action('thrust_s1', { clip: 'lb_thrust_01', dur: 38, active: [12, 17], track: 'lb_thrust', hits: cut('lb_thrust', 0.44, { hitstop: 4 }), curve: 'w_step_030', turn: [8, 300], sound: [11, 'hb_swing_02'], cancels: [[24, 38, ['lb_spirit2', 'lb_rise', 'lb_rise_s', 'lb_back', 'roll']]] });
  action('rise_s2', { clip: 'lb_rise_01', dur: 32, active: [9, 15], track: 'lb_rise', hits: cut('lb_rise', 0.72), curve: 'w_step_015', turn: [6, 300], sound: [8, 'hb_swing_02'], cancels: [[18, 32, ['lb_spirit3', 'lb_vertical', 'lb_stab', 'lb_back', 'roll']]] });
  action('draw_cut', { clip: 'lb_draw_cut_01', dur: 60, active: [30, 36], track: 'lb_draw_cut', hits: cut('lb_draw_cut', 0.56), curve: 'w_step_060', turn: [20, 180], sound: [29, 'hb_swing_02'], events: [{ tick: 3, type: 'sound', id: 'hb_draw_01' }], cancels: [[44, 60, ['lb_thrust', 'lb_stab', 'lb_back', 'lb_spirit', 'roll']]] });
  action('draw', { clip: 'lb_draw_01', dur: 38, track: 'lb_draw', sound: [4, 'hb_draw_01'] });
  action('sheathe', { clip: 'lb_sheathe_01', dur: 40, track: 'lb_sheathe', sound: [28, 'hb_sheathe_01'], finish: 'sheathed_idle' });
}
