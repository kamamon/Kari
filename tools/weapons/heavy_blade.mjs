// 断岳剣（大剣）の技と動き（v0.57.0 から。D-150: ハンターの動きを 2G の動きを手本に作り直す、の最初の武器）。
// v0.56.0 まではキー姿勢の方式（src/render/poses.ts の hb_*・heavyBodyMotion.ts・手で書いた軌道 tracks/heavy_blade.json）だった。
// それは保留の組 v056 に残してある（public/data/motionsets/v056/、src/render/motionsets/v056.ts）。
//
// 2G の大剣の手本（観察したのではなく、技の流れと決めの姿勢の知識から組んだ Claude の形）:
//  - 構え: 左足を前に開いて腰を落とし、柄を右の腰の前で両手に持つ。刃は体の前を上へ、少し前へ倒して立てる。
//  - 縦斬り: 刃を頭上から背へ担ぐように振りかぶり（溜めはここで止める）、左足を大きく踏み込んで真下へ叩き下ろす。
//    切っ先が前の地面に届き、前へ深く沈んだまま重さを受け止めてから、持ち上げて構えへ戻る。
//  - 薙ぎ払い: 刃を右の後ろへ引いて腰を巻き、腰の高さを右から左へ大きく払う。左の後ろまで振り抜いて戻す。
//  - 斬り上げ: 刃を前の低い所へ下ろしてから、体の前を下から頭上まで振り上げる。縦斬りの後は、地面の刃からそのまま。
//  - 抜刀斬り: 右手で肩越しに柄を取り、背から頭上へ抜き上げて（溜めはここで止める）、踏み込んで叩き下ろす。
//  - 防御: 刃を体の前に縦に立て、腹を相手へ向けて受ける。腰を落とす。
// 技の長さ・判定の区間・係数・連係・溜めは v0.56.0 と同じ（2G の組み立て。D-127）。値は Kari の仮の値（原作を測っていない）。
// 座標はアクターのローカル（m、Y 上、+Z 前、+X 左）。
import { curve, family, sheathOf } from './lib.mjs';

export function heavyBlade() {
  // 右手が柄頭の側、左手が鍔の側（握りから刃の側へ 0.2m）。断岳剣の柄は握りから -0.09〜+0.23m（src/render/heavyBlade.ts）
  const hands = { primary: 'R', second: 'along', along: 0.2, wrist: [5, 150] };
  const { fam, motion, snap, trackOf, action, pose } = family('heavy_blade', hands, { from: 0.33, to: 1.79, radius: 0.16, maxTurn: 1500 });
  // 判定の形（v0.56.0 と同じ。握りから 0.30〜1.75m、半径 0.20m）
  const B = { radius: 0.2, from: 0.3, to: 1.75 };

  // 背に負った時（握りが右肩の上、刃先は左の腰の後ろ。rig.ts の socket_back と同じ置き場所）
  const BACK = { grip: [-0.22, 0.1, -0.16], dir: [0.62, -0.77, -0.13], edge: [0.78, 0.63, 0] };
  fam.sheath = sheathOf('chest', [-0.22, 0.38, -0.16], BACK.dir, BACK.edge);
  /** 肩越しに背の柄へ手を伸ばす時の、右ひじの向き */
  const OVER = [-0.5, 0.8, 0.5];

  // ---- 立ち姿 ----
  // 構え: 左足を前に開いて腰を落とす。柄は右の腰の前、刃は体の前を上へ立て、少し前へ倒す。刃（-Z）は前下を向く
  const FEET = { L: [0.12, 0.17, 10], R: [-0.15, -0.2, -32] };
  const idle = (fam.stances.idle = pose({
    feet: FEET,
    hip: [0, -0.07, 0], hipR: [5, -20, 0], spine: [5, -4, 0], chest: [3, -6, 0],
    gripA: [-0.17, 1.0, 0.25], dirA: [-0.05, 0.76, 0.65], edgeA: [0, -0.65, 0.76], on: [1],
  }));
  // 防御: 刃を体の前に縦に立て、腹を前へ向ける（刃は右を向く）。腰をさらに落とし、両手で柄を胸の前に引き寄せる
  fam.stances.guard = pose({
    feet: { L: [0.13, 0.2, 10], R: [-0.17, -0.24, -35] },
    hip: [0, -0.14, -0.03], hipR: [6, -12, 0], spine: [10, -2, 0], chest: [6, -2, 0],
    gripA: [-0.08, 1.02, 0.4], dirA: [0.1, 0.98, 0.14], edgeA: [-1, 0.1, 0], on: [1],
  });
  // 納刀: まっすぐ立ち、剣は背中
  const sheathed = (fam.stances.sheathed = pose({
    feet: { L: [0.095, 0, 4], R: [-0.095, 0, -4] },
    grip: BACK.grip, dir: BACK.dir, edge: BACK.edge, on: [0], grab: [0],
  }));

  // 移動曲線（v0.56.0 と同じ）
  curve('hb_step_035m', [[0, 0], [14, 0], [24, 0.33], [30, 0.35], [72, 0.35]]);
  curve('hb_step_025m', [[0, 0], [10, 0], [20, 0.25], [66, 0.25]]);
  curve('hb_step_045m', [[0, 0], [8, 0], [22, 0.42], [28, 0.45], [64, 0.45]]);
  curve('hb_step_030m', [[0, 0], [10, 0], [20, 0.28], [26, 0.3], [66, 0.3]]);
  curve('hb_step_030m_low', [[0, 0], [8, 0.26], [14, 0.3], [54, 0.3]]);

  /** 頭上に担いだ形（縦斬りの頂点・溜め・抜刀斬りの頂点）: 両手は頭の右上、刃は背の上を後ろへ寝かせ、刃は上を向く */
  const TOP = { gripA: [-0.16, 1.62, 0.02], dirA: [-0.1, 0.24, -0.965], edgeA: [0, 0.97, 0.24] };
  /** 頭上に担ぐ間は、左のひじを外の上へ張る（手首が刃と平行にならない） */
  const ELBOW_OUT = [0.6, 0.8, 0];
  const TOP_BODY = { hip: [0, -0.06, -0.03], hipR: [0, -16, 0], spine: [-6, -6, 0], chest: [-8, -6, 0], elbowL: ELBOW_OUT };
  /** 叩き下ろした形: 切っ先が前の地面に届き、前へ深く沈む */
  const SLAM = { gripA: [-0.02, 0.86, 0.5], dirA: [0, -0.42, 0.91], edgeA: [0, -0.91, -0.42] };
  const SLAM_BODY = { hip: [0, -0.22, 0.08], hipR: [12, -4, 0], spine: [22, 0, 0], chest: [14, 0, 0], look: [0, 20] };
  /** 振り下ろす途中（頭上 → 前 → 水平） */
  const DOWN = [
    { gripA: [-0.1, 1.68, 0.08], dirA: [-0.05, 0.85, -0.52], edgeA: [0, 0.52, 0.85], hip: [0, -0.07, 0.0], hipR: [2, -12, 0], spine: [-2, -4, 0], chest: [-2, -4, 0], elbowL: [0.3, 0.4, 0] },
    { gripA: [-0.05, 1.62, 0.26], dirA: [-0.02, 0.98, 0.18], edgeA: [0, -0.18, 0.98], hip: [0, -0.09, 0.03], hipR: [5, -7, 0], spine: [6, -2, 0], chest: [5, -2, 0], elbowL: [0, 0, 0] },
    { gripA: [-0.03, 1.44, 0.42], dirA: [0, 0.72, 0.69], edgeA: [0, -0.69, 0.72], hip: [0, -0.13, 0.05], hipR: [8, -4, 0], spine: [13, 0, 0], chest: [9, 0, 0], look: [0, 8] },
    { gripA: [-0.02, 1.2, 0.52], dirA: [0, 0.2, 0.98], edgeA: [0, -0.98, 0.2], hip: [0, -0.17, 0.07], hipR: [10, -4, 0], spine: [17, 0, 0], chest: [11, 0, 0], look: [0, 14] },
  ];

  // ---- 縦斬り（主。溜めは 18 tick で止める）----
  const vertical = motion('hb_attack_vertical_01', {
    dur: 72, from: idle, root: 'hb_step_035m',
    keys: [
      { t: 8, hip: [0, -0.05, 0], hipR: [3, -18, 0], spine: [0, -4, 0], chest: [-2, -6, 0], gripA: [-0.12, 1.3, 0.2], dirA: [-0.05, 0.98, 0.15], edgeA: [0, -0.15, 0.99] },
      { t: 14, hip: [0, -0.05, -0.02], hipR: [1, -17, 0], spine: [-4, -6, 0], chest: [-6, -6, 0], elbowL: [0.4, 0.55, 0], gripA: [-0.13, 1.56, 0.08], dirA: [-0.08, 0.72, -0.69], edgeA: [0, 0.69, 0.72] },
      { t: 18, ...TOP_BODY, ...TOP },
      { t: 21, ...DOWN[0] },
      { t: 24, ...DOWN[1] },
      { t: 26, ...DOWN[2] },
      { t: 28, ...DOWN[3] },
      { t: 30, ...SLAM_BODY, ...SLAM },
      { t: 46, ...SLAM_BODY, hip: [0, -0.21, 0.07], ...SLAM },
      { t: 58, hip: [0, -0.12, 0.03], hipR: [8, -12, 0], spine: [10, -3, 0], chest: [6, -4, 0], look: [0, 6], gripA: [-0.12, 0.96, 0.36], dirA: [-0.05, 0.4, 0.92], edgeA: [0, -0.92, 0.4] },
    ],
    feet: { L: [[12, 24, 0.12, 0.19, 10, 0.08]], R: [[48, 60, -0.15, -0.2, -32, 0.05]] },
  });
  trackOf('hb_vertical_blade_sweep', B, vertical);

  // ---- 薙ぎ払い（副）----
  // 刃を右の後ろへ引いて腰を巻き、腰の高さを右から左へ払う。刃（-Z）は振る向きの前
  const side = motion('hb_attack_side_01', {
    dur: 66, from: idle, root: 'hb_step_025m',
    keys: [
      { t: 8, hip: [0, -0.08, -0.01], hipR: [5, -38, 0], spine: [5, -12, 0], chest: [3, -16, 0], gripA: [-0.25, 1.08, 0.1], dirA: [-0.45, 0.45, -0.77], edgeA: [-0.86, 0, 0.5], elbowL: ELBOW_OUT },
      { t: 14, hip: [0, -0.1, -0.02], hipR: [6, -46, 0], spine: [6, -10, 0], chest: [4, -12, 0], gripA: [-0.3, 1.04, 0.1], dirA: [-0.62, 0.3, -0.72], edgeA: [-0.76, 0, 0.65], elbowL: ELBOW_OUT },
      { t: 18, hip: [0, -0.12, 0.0], hipR: [7, -34, 0], spine: [7, -6, 0], chest: [4, -4, 0], gripA: [-0.26, 1.02, 0.22], dirA: [-0.9, 0.05, 0.43], edgeA: [0.43, 0, 0.9], elbowL: [0.3, 0.4, 0] },
      { t: 21, hip: [0, -0.13, 0.02], hipR: [8, -12, 0], spine: [8, 0, 0], chest: [4, 2, 0], gripA: [-0.1, 1.02, 0.38], dirA: [-0.25, 0, 0.97], edgeA: [0.97, 0, 0.25], elbowL: [0, 0, 0] },
      { t: 24, hip: [0, -0.13, 0.02], hipR: [8, 12, 0], spine: [8, 6, 0], chest: [4, 12, 0], gripA: [0.1, 1.02, 0.36], dirA: [0.6, 0, 0.8], edgeA: [0.8, 0, -0.6] },
      { t: 27, hip: [0, -0.12, 0.01], hipR: [8, 26, 0], spine: [8, 8, 0], chest: [4, 16, 0], gripA: [0.22, 1.0, 0.2], dirA: [0.97, -0.05, 0.24], edgeA: [0.24, 0, -0.97] },
      { t: 34, hip: [0, -0.11, 0.0], hipR: [7, 32, 0], spine: [7, 8, 0], chest: [4, 16, 0], gripA: [0.24, 0.98, 0.06], dirA: [0.85, -0.1, -0.5], edgeA: [-0.5, 0, -0.86] },
      { t: 42, hip: [0, -0.1, 0.0], hipR: [6, 18, 0], spine: [6, 4, 0], chest: [4, 6, 0], gripA: [0.12, 1.0, 0.16], dirA: [0.9, 0.39, 0.19], edgeA: [0.4, -0.9, -0.15] },
      { t: 50, hip: [0, -0.09, 0.0], hipR: [6, 0, 0], spine: [6, -2, 0], chest: [4, -4, 0], gripA: [-0.04, 1.0, 0.24], dirA: [0.3, 0.6, 0.74], edgeA: [0, -0.78, 0.63] },
    ],
    feet: { L: [[10, 20, 0.16, 0.2, 20, 0.07]], R: [[40, 52, -0.15, -0.2, -32, 0.05]] },
  });
  trackOf('hb_side_blade_sweep', B, side);

  // ---- 斬り上げ（主と副の同時押し）----
  // 刃を前の低い所へ下ろし、体の前を下から頭上まで振り上げる。刃（-Z）は上を向いて先に立つ
  const RISE = [
    { gripA: [-0.07, 0.86, 0.4], dirA: [0, -0.25, 0.97], edgeA: [0, 0.97, 0.25], hip: [0, -0.16, 0.05], hipR: [9, -8, 0], spine: [17, -2, 0], chest: [11, -2, 0], look: [0, 10] },
    { gripA: [-0.04, 1.02, 0.46], dirA: [0, 0.3, 0.95], edgeA: [0, 0.95, -0.3], hip: [0, -0.12, 0.04], hipR: [7, -6, 0], spine: [10, -1, 0], chest: [6, -1, 0], look: [0, 4] },
    { gripA: [-0.03, 1.3, 0.4], dirA: [0, 0.78, 0.62], edgeA: [0, 0.62, -0.78], hip: [0, -0.08, 0.02], hipR: [4, -6, 0], spine: [2, -1, 0], chest: [0, -2, 0] },
    { gripA: [-0.04, 1.56, 0.24], dirA: [0, 0.99, -0.1], edgeA: [0, -0.1, -0.99], hip: [0, -0.05, -0.01], hipR: [0, -8, 0], spine: [-5, -2, 0], chest: [-6, -2, 0] },
  ];
  const UP_HOLD = { gripA: [-0.06, 1.64, 0.16], dirA: [-0.03, 0.62, -0.78], edgeA: [0, -0.78, -0.62], hip: [0, -0.06, -0.02], hipR: [0, -10, 0], spine: [-6, -3, 0], chest: [-8, -3, 0] };
  /** 振り上げた後、刃を前へ倒しながら下ろす（刃は後ろ向きのまま）→ 手首で返して構えへ */
  const UP_DOWN = { gripA: [-0.12, 1.36, 0.3], dirA: [-0.05, 0.97, 0.22], edgeA: [0, 0.22, -0.97], hip: [0, -0.06, -0.01], hipR: [3, -16, 0], spine: [0, -4, 0], chest: [-2, -5, 0] };
  const UP_TURN = { gripA: [-0.15, 1.16, 0.28], dirA: [-0.05, 0.88, 0.47], edgeA: [-1, 0, 0] };
  const upswing = motion('hb_attack_upswing_01', {
    dur: 66, from: idle, root: 'hb_step_030m',
    keys: [
      { t: 4, gripA: [-0.17, 0.96, 0.3], dirA: [-0.05, 0.55, 0.83], edgeA: [-1, 0.05, 0] },
      { t: 8, hip: [0, -0.1, 0.01], hipR: [6, -14, 0], spine: [8, -3, 0], chest: [5, -4, 0], gripA: [-0.15, 0.92, 0.34], dirA: [-0.05, 0.25, 0.97], edgeA: [0, 0.97, -0.25] },
      { t: 14, hip: [0, -0.16, 0.05], hipR: [9, -10, 0], spine: [17, -2, 0], chest: [11, -2, 0], look: [0, 12], gripA: [-0.11, 0.88, 0.32], dirA: [-0.02, -0.5, 0.86], edgeA: [0, 0.86, 0.5] },
      { t: 18, ...RISE[0] },
      { t: 21, ...RISE[1] },
      { t: 24, ...RISE[2] },
      { t: 27, ...RISE[3] },
      { t: 36, ...UP_HOLD },
      { t: 50, ...UP_DOWN },
      { t: 58, ...UP_TURN },
    ],
    feet: { L: [[10, 22, 0.12, 0.18, 10, 0.07]], R: [[44, 56, -0.15, -0.2, -32, 0.05]] },
  });
  trackOf('hb_upswing_blade_sweep', B, upswing);

  // ---- 斬り上げ（縦斬り・抜刀斬りの後。地面の刃からそのまま）----
  // 地面に下ろした刃を、手首で返して（刃を上へ）から、同じ振り上げへ
  const upswingLow = motion('hb_attack_upswing_low_01', {
    dur: 54, from: snap(vertical, 46), root: 'hb_step_030m_low',
    keys: [
      { t: 2, edgeA: [1, 0, 0] },
      { t: 4, hip: [0, -0.18, 0.05], hipR: [10, -6, 0], spine: [18, -1, 0], chest: [11, -1, 0], look: [0, 14], gripA: [-0.05, 0.84, 0.44], dirA: [0, -0.38, 0.92], edgeA: [0, 0.92, 0.38] },
      { t: 6, ...RISE[0] },
      { t: 9, ...RISE[1] },
      { t: 12, ...RISE[2] },
      { t: 15, ...RISE[3] },
      { t: 24, ...UP_HOLD },
      { t: 38, ...UP_DOWN },
      { t: 46, ...UP_TURN },
    ],
    feet: { R: [[0, 9, -0.15, -0.2, -32, 0.08]] },
  });
  trackOf('hb_upswing_low_blade_sweep', B, upswingLow);

  // ---- 抜刀斬り（納刀中の主・副。溜めは 16 tick で止める）----
  // 右手で肩越しに柄を取り、背から頭上へ抜き上げて左手を添え、大きく踏み込んで叩き下ろす
  const drawSlash = motion('hb_draw_slash_01', {
    dur: 64, from: sheathed, root: 'hb_step_045m', skipBody: [0, 12],
    keys: [
      { t: 5, hipR: [2, -10, 0], chest: [0, -10, 0], grab: [1], grip: BACK.grip, dir: BACK.dir, edge: BACK.edge, on: [0], elbowR: OVER },
      { t: 10, hipR: [1, -14, 0], spine: [-3, -5, 0], chest: [-4, -8, 0], gripA: [-0.2, 1.7, -0.06], dirA: [0.3, -0.1, -0.95], edgeA: [0.55, 0.8, 0.1], elbowR: [-0.6, 0.6, 0.4] },
      { t: 13, ...TOP_BODY, ...TOP, on: [1], elbowR: [0, 0, 0] },
      { t: 16, ...TOP_BODY, ...TOP },
      { t: 19, ...DOWN[0] },
      { t: 22, ...DOWN[1] },
      { t: 24, ...DOWN[2] },
      { t: 26, ...DOWN[3] },
      { t: 28, ...SLAM_BODY, ...SLAM },
      { t: 40, ...SLAM_BODY, hip: [0, -0.21, 0.07], ...SLAM },
      { t: 52, hip: [0, -0.12, 0.03], hipR: [8, -12, 0], spine: [10, -3, 0], chest: [6, -4, 0], look: [0, 6], gripA: [-0.12, 0.96, 0.36], dirA: [-0.05, 0.4, 0.92], edgeA: [0, -0.92, 0.4] },
    ],
    feet: { L: [[6, 22, 0.12, 0.19, 10, 0.09]], R: [[42, 54, -0.15, -0.2, -32, 0.05]] },
  });
  trackOf('hb_draw_slash_sweep', B, drawSlash);

  // ---- 抜刀・納刀 ----
  // 抜刀: 肩越しに柄を取り、背から頭上を回して、体の前の構えへ下ろす
  const draw = motion('hb_draw_01', {
    dur: 26, from: sheathed, skipBody: [0, 11],
    keys: [
      { t: 6, hipR: [2, -10, 0], chest: [0, -10, 0], grab: [1], grip: BACK.grip, dir: BACK.dir, edge: BACK.edge, on: [0], elbowR: OVER },
      { t: 11, hipR: [2, -14, 0], chest: [-2, -10, 0], gripA: [-0.2, 1.66, -0.04], dirA: [0.3, -0.1, -0.95], edgeA: [0.55, 0.8, 0.1], elbowR: [-0.6, 0.6, 0.4] },
      { t: 16, hipR: [2, -16, 0], chest: [-2, -8, 0], gripA: [-0.16, 1.5, 0.12], dirA: [-0.05, 0.85, -0.52], edgeA: [0, 0.52, 0.85], on: [1], elbowR: [0, 0, 0] },
      { t: 21, gripA: [-0.17, 1.2, 0.24], dirA: [-0.05, 0.98, 0.18], edgeA: [0, -0.18, 0.98] },
    ],
    feet: { L: [[8, 16, 0.12, 0.17, 10, 0.05]], R: [[14, 22, -0.15, -0.2, -32, 0.04]] },
  });
  trackOf('hb_draw_track', B, draw);
  // 納刀: 刃を立てて持ち上げ、右肩の上から背へ回して負う（左手を離し、右手で柄を背に置いてから下ろす）
  const sheathe = motion('hb_sheathe_01', {
    dur: 44, from: idle, to: sheathed, skipBody: [26, 44],
    keys: [
      { t: 8, gripA: [-0.17, 1.2, 0.24], dirA: [-0.05, 0.98, 0.18], edgeA: [0, -0.18, 0.98] },
      { t: 16, hipR: [2, -16, 0], chest: [-2, -8, 0], gripA: [-0.16, 1.5, 0.12], dirA: [-0.05, 0.85, -0.52], edgeA: [0, 0.52, 0.85], on: [1] },
      { t: 22, hipR: [2, -14, 0], chest: [-2, -10, 0], gripA: [-0.2, 1.66, -0.04], dirA: [0.3, -0.1, -0.95], edgeA: [0.55, 0.8, 0.1], on: [0], elbowR: [-0.6, 0.6, 0.4] },
      { t: 30, hipR: [2, -10, 0], chest: [0, -10, 0], grip: BACK.grip, dir: BACK.dir, edge: BACK.edge, grab: [1], elbowR: OVER },
      { t: 34, grab: [1], elbowR: OVER },
    ],
    feet: { R: [[4, 12, -0.095, 0, -4, 0.04]], L: [[14, 22, 0.095, 0, 4, 0.04]] },
  });
  trackOf('hb_sheathe_track', B, sheathe);

  // ---- 技のデータ（v0.56.0 と同じ値。D-127）----
  const CHARGE = { button: 'main', levelTicks: [30, 60, 90], maxHoldTicks: 120, coefficientScale: [1.0, 1.5, 2.1, 2.8], hitstopBonus: [0, 2, 4, 6] };
  const blade = (track, coef, hitstop) => [{ id: 'blade_main', track, coef, hitstop }];
  action('overhead', { clip: 'hb_attack_vertical_01', dur: 72, active: [22, 30], track: 'hb_vertical_blade_sweep', hits: blade('hb_vertical_blade_sweep', 1.05, 4), curve: 'hb_step_035m', turn: [10, 90], sound: [20, 'hb_swing_01'], cancels: [[40, 72, ['upswing_low', 'side_sweep']], [58, 72, ['roll']]], charge: { holdTick: 18, ...CHARGE } });
  action('side_sweep', { clip: 'hb_attack_side_01', dur: 66, active: [18, 27], track: 'hb_side_blade_sweep', hits: blade('hb_side_blade_sweep', 0.7, 3), curve: 'hb_step_025m', turn: [8, 120], sound: [16, 'hb_swing_02'], cancels: [[44, 66, ['upswing', 'overhead', 'roll']]] });
  action('draw_slash', { clip: 'hb_draw_slash_01', dur: 64, active: [20, 28], track: 'hb_draw_slash_sweep', hits: blade('hb_draw_slash_sweep', 1.0, 4), curve: 'hb_step_045m', turn: [8, 120], sound: [18, 'hb_swing_01'], events: [{ tick: 4, type: 'sound', id: 'hb_draw_01' }], cancels: [[40, 64, ['upswing_low', 'side_sweep']], [50, 64, ['roll']]], charge: { holdTick: 16, ...CHARGE } });
  action('upswing', { clip: 'hb_attack_upswing_01', dur: 66, active: [18, 27], track: 'hb_upswing_blade_sweep', hits: blade('hb_upswing_blade_sweep', 0.95, 4), curve: 'hb_step_030m', turn: [8, 120], sound: [15, 'hb_swing_02'], cancels: [[40, 66, ['overhead', 'side_sweep']], [46, 66, ['roll']]] });
  action('upswing_low', { clip: 'hb_attack_upswing_low_01', dur: 54, active: [6, 15], track: 'hb_upswing_low_blade_sweep', hits: blade('hb_upswing_low_blade_sweep', 0.95, 4), curve: 'hb_step_030m_low', turn: [4, 120], sound: [3, 'hb_swing_02'], cancels: [[28, 54, ['overhead', 'side_sweep']], [34, 54, ['roll']]] });
  action('draw', { clip: 'hb_draw_01', dur: 26, track: 'hb_draw_track', sound: [4, 'hb_draw_01'] });
  action('sheathe', { clip: 'hb_sheathe_01', dur: 44, track: 'hb_sheathe_track', sound: [30, 'hb_sheathe_01'], finish: 'sheathed_idle' });
}
