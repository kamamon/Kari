// 護刃（短剣と盾）の技と動き。右手に剣、左腕に盾。左足を前にした半身の構え。
// 座標はアクターのローカル（m、Y 上、+Z 前、+X 左）。数値は机上の初期値。
import { curve, family, sheathOf } from './lib.mjs';

export function guardBlade() {
  const hands = { primary: 'R', second: 'shield', shieldGrip: [-0.116, 0.04, -0.041], wrist: [5, 135] };
  const { fam, motion, snap, trackOf, action, pose } = family('guard_blade', hands, { from: 0.14, to: 0.88, radius: 0.04, maxTurn: 2000 });
  const B = { radius: 0.11, from: 0.13, to: 0.88 };

  // 左腰の鞘に納めた時の、握りの位置と剣の向き（rig.ts の socket_hip と同じ値）
  const HILT = [0.17, 1.0, 0.06], SHEATH = [0.1, -0.8, -0.6], SHEATH_EDGE = [0, -0.6, 0.8];
  fam.sheath = sheathOf('pelvis', [0.17, 0.08, 0.06], SHEATH, SHEATH_EDGE);

  /** 盾を背から左腕へ移した時の、左ひじの向き（真下。ひじを脇に付けて前腕を前へ水平に出し、盾を立てたまま体の横に持つ） */
  const SIDE_ELBOW = [0.25, -0.95, -0.2];
  /** 背の盾へ左手を伸ばす所（肩の上・少し後ろ） */
  const REACH = [0.3, 1.66, -0.06];
  /** 左手が、下げた位置と背の盾のあいだで通る所（肩の外を回す） */
  const VIA = [0.44, 1.24, 0.12];

  // ---- 立ち姿 ----
  // 構え: 左足が前、腰と胸を右へ開いて盾の側を前に出す。剣は右の肩口で、切っ先を前上へ。
  const idle = (fam.stances.idle = pose({
    feet: { L: [0.1, 0.2, 6], R: [-0.14, -0.2, -42] },
    hip: [0, -0.05, 0], hipR: [3, -26, 0], spine: [4, -5, 0], chest: [2, -6, 0],
    gripA: [-0.31, 1.08, 0.14], dirA: [0.1, 0.8, 0.59], edgeA: [0.2, -0.55, 0.8],
    offA: [-0.02, 1.2, 0.36], offNA: [0.15, 0, 1], elbowL: [0.85, -0.5, 0.15], on: [1],
  }));
  // 防御: 腰を落とし、盾を顔の前まで上げて体に寄せる。剣は盾の陰へ引く。
  fam.stances.guard = pose({
    feet: { L: [0.1, 0.22, 6], R: [-0.15, -0.22, -45] },
    hip: [0, -0.13, -0.02], hipR: [6, -30, 0], spine: [8, -5, 0], chest: [4, -6, 0], look: [0, -4],
    gripA: [-0.34, 0.98, 0.02], dirA: [0.15, 0.6, 0.78], edgeA: [0.2, -0.6, 0.75],
    offA: [-0.06, 1.3, 0.38], offNA: [0.05, 0.1, 1], elbowL: [0.85, -0.5, 0.15], on: [1],
  });
  // 納刀: まっすぐ立ち、剣は左腰の鞘、盾は背中。
  const sheathed = (fam.stances.sheathed = pose({
    feet: { L: [0.095, 0, 4], R: [-0.095, 0, -4] },
    gripA: HILT, dirA: SHEATH, edgeA: SHEATH_EDGE,
    off: [0.235, -0.555, 0.07], offNA: [1, 0, 0], on: [0], grab: [0],
  }));

  curve('w_step_015', [[0, 0], [4, 0], [10, 0.15], [40, 0.15]]);
  curve('w_step_030', [[0, 0], [6, 0], [14, 0.3], [40, 0.3]]);
  curve('w_step_040', [[0, 0], [6, 0], [14, 0.4], [40, 0.4]]);
  curve('w_lunge_120', [[0, 0], [4, 0], [26, 1.15], [32, 1.2], [50, 1.2]]);

  // ---- 斬り 1（右上 → 左下の袈裟）----
  // 腰を右へ溜めてから左へ回し、その回転で剣を振り下ろす。左足を半歩出す。盾は体の前に残す。
  const slash1 = motion('gb_slash1_01', {
    dur: 26, from: idle, root: 'w_step_015',
    keys: [
      { t: 5, hip: [-0.01, -0.05, -0.03], hipR: [2, -34, 0], spine: [2, -6, 0], chest: [0, -10, 0], gripA: [-0.3, 1.5, -0.02], dirA: [-0.25, 0.75, -0.6], edgeA: [0.2, 0.3, 0.9], offA: [0, 1.22, 0.4] },
      { t: 8, hip: [0, -0.06, 0], hipR: [4, -20, 0], spine: [5, -4, 0], chest: [2, -2, 0], gripA: [-0.24, 1.5, 0.22], dirA: [-0.12, 0.92, 0.36], edgeA: [0.3, -0.2, 0.9] },
      { t: 10, hip: [0.01, -0.07, 0.03], hipR: [5, -10, 0], spine: [7, -2, 0], chest: [3, 8, 0], gripA: [-0.06, 1.3, 0.5], dirA: [0.12, 0.3, 0.95], edgeA: [0.5, -0.8, 0.2], offA: [0.06, 1.18, 0.34] },
      { t: 13, hip: [0.02, -0.08, 0.04], hipR: [5, -2, 0], spine: [8, 2, 0], chest: [4, 18, 0], gripA: [0.12, 1.02, 0.44], dirA: [0.62, -0.38, 0.68], edgeA: [0.6, -0.75, -0.2], offA: [0.14, 1.12, 0.26] },
      { t: 16, hip: [0.02, -0.08, 0.03], hipR: [4, 0, 0], spine: [7, 2, 0], chest: [3, 20, 0], gripA: [0.16, 0.98, 0.38], dirA: [0.7, -0.3, 0.64], edgeA: [0.6, -0.75, -0.2], offA: [0.15, 1.12, 0.25] },
    ],
    feet: { L: [[3, 9, 0.1, 0.235, 6, 0.05]], R: [[18, 24, -0.14, -0.2, -42, 0.05]] },
  });
  trackOf('gb_slash1', B, slash1);

  // ---- 斬り 2（左 → 右の水平の返し）----
  // 斬り 1 の振り抜きから。剣を左肩の前へ返し、腰を右へ回して水平に払う。後ろ足を引き付ける。
  const slash2 = motion('gb_slash2_01', {
    dur: 26, from: snap(slash1, 15), root: 'w_step_015',
    keys: [
      { t: 4, hipR: [4, 4, 0], spine: [6, 3, 0], chest: [3, 24, 0], gripA: [0.2, 1.2, 0.24], dirA: [0.85, 0.4, -0.15], edgeA: [0, -0.1, 1], offA: [0.12, 1.14, 0.3] },
      { t: 7, hipR: [4, -8, 0], spine: [6, 0, 0], chest: [3, 14, 0], gripA: [0.12, 1.24, 0.44], dirA: [0.8, 0.15, 0.55], edgeA: [-0.5, 0, 0.85] },
      { t: 9, hip: [0, -0.07, 0.02], hipR: [4, -16, 0], spine: [6, -3, 0], chest: [3, 2, 0], gripA: [-0.08, 1.24, 0.56], dirA: [0.05, 0.08, 1], edgeA: [-1, 0, 0.05], offA: [0.08, 1.16, 0.34] },
      { t: 12, hip: [-0.01, -0.07, 0.01], hipR: [3, -26, 0], spine: [5, -5, 0], chest: [2, -12, 0], gripA: [-0.36, 1.2, 0.42], dirA: [-0.72, 0.1, 0.68], edgeA: [-0.7, 0, -0.7], offA: [0.02, 1.2, 0.38] },
      { t: 15, hipR: [3, -28, 0], spine: [5, -5, 0], chest: [2, -14, 0], gripA: [-0.42, 1.17, 0.32], dirA: [-0.82, 0.12, 0.55], edgeA: [-0.7, 0, -0.7] },
      { t: 21, gripA: [-0.38, 1.12, 0.24], dirA: [-0.45, 0.6, 0.6], edgeA: [-0.4, -0.5, 0.3] },
    ],
    feet: { R: [[2, 8, -0.14, -0.15, -42, 0.05]], L: [[10, 16, 0.1, 0.2, 6, 0.04]] },
  });
  trackOf('gb_slash2', B, slash2);

  // ---- 突き（3 段目）----
  // 斬り 2 の振り抜きから。剣を右の脇へ引き、左足を大きく出して、腰の回転と腕の伸びで突く。
  const thrust = motion('gb_thrust_01', {
    dur: 36, from: snap(slash2, 14), root: 'w_step_030',
    keys: [
      { t: 6, hip: [0, -0.07, -0.04], hipR: [3, -34, 0], spine: [4, -6, 0], chest: [2, -12, 0], gripA: [-0.32, 1.12, -0.02], dirA: [0.1, 0.05, 1], edgeA: [0, -1, 0], offA: [0, 1.2, 0.38] },
      { t: 11, hip: [0, -0.09, 0.05], hipR: [6, -14, 0], spine: [6, -2, 0], chest: [4, 2, 0], gripA: [-0.22, 1.18, 0.42], dirA: [0.03, 0.02, 1], edgeA: [0, -1, 0], offA: [0.12, 1.16, 0.3] },
      { t: 14, hip: [0, -0.11, 0.1], hipR: [8, -2, 0], spine: [8, 3, 0], chest: [5, 14, 0], gripA: [-0.12, 1.2, 0.74], dirA: [0, 0, 1], edgeA: [0, -1, 0], offA: [0.22, 1.14, 0.2] },
      { t: 20, hip: [0, -0.11, 0.1], hipR: [8, -2, 0], spine: [8, 3, 0], chest: [5, 14, 0], gripA: [-0.12, 1.2, 0.72], dirA: [0, 0, 1], edgeA: [0, -1, 0], offA: [0.22, 1.14, 0.2] },
    ],
    feet: { L: [[7, 14, 0.1, 0.3, 4, 0.06], [29, 35, 0.1, 0.2, 6, 0.03]], R: [[21, 28, -0.14, -0.2, -42, 0.05]] },
  });
  trackOf('gb_thrust', B, thrust);

  // ---- 盾打ち ----
  // 盾を胸へ引き付けてから、左足を踏み込み、左肩を前へ入れて盾の面を突き出す。剣は右腰へ引いておく。
  const bash = motion('gb_bash_01', {
    dur: 36, from: idle, root: 'w_step_040',
    keys: [
      { t: 7, hip: [0, -0.07, -0.03], hipR: [3, -18, 0], spine: [4, -2, 0], chest: [2, -2, 0], offA: [0.08, 1.26, 0.24], offNA: [0.2, 0, 1], gripA: [-0.36, 1.02, 0], dirA: [-0.05, 0.6, 0.8], edgeA: [0.2, -0.6, 0.75] },
      { t: 11, hip: [0, -0.08, 0.04], hipR: [5, -30, 0], spine: [6, -6, 0], chest: [3, -8, 0], offA: [0.05, 1.27, 0.52], offNA: [0, 0, 1] },
      { t: 14, hip: [0, -0.09, 0.1], hipR: [7, -40, 0], spine: [8, -8, 0], chest: [4, -12, 0], offA: [0.03, 1.28, 0.8], offNA: [0, 0, 1], gripA: [-0.38, 1.0, -0.08], dirA: [-0.1, 0.5, 0.85], edgeA: [0.2, -0.6, 0.75] },
      { t: 18, hip: [0, -0.09, 0.09], hipR: [7, -38, 0], spine: [8, -8, 0], chest: [4, -11, 0], offA: [0.03, 1.27, 0.76], offNA: [0, 0, 1] },
    ],
    feet: { L: [[6, 14, 0.1, 0.2, 6, 0.05]], R: [[19, 27, -0.14, -0.2, -42, 0.05]] },
  });
  trackOf('gb_bash_sword', B, bash);
  // 当たるのは盾: 盾の中心を通る、縦の短い芯
  trackOf('gb_bash_shield', { radius: 0.26, from: -0.18, to: 0.18 }, bash, (s) => [s.shield.pos, [0, 1, 0]]);

  // ---- 抜刀斬り（踏み込み斬り）----
  // 右足・左足と 2 歩走り込みながら、左腰の鞘から抜きざまに、左下から右上へ斬り上げる。盾は走りながら背から前へ回す。
  const lunge = motion('gb_lunge_01', {
    dur: 50, from: sheathed, root: 'w_lunge_120', skipBody: [0, 16],
    keys: [
      { t: 3, offA: VIA },
      { t: 4, hip: [0, -0.04, 0.02], hipR: [8, 8, 0], spine: [6, 6, 0], chest: [3, 12, 0], grab: [1], gripA: HILT, dirA: SHEATH, edgeA: SHEATH_EDGE, on: [0] },
      { t: 8, offA: REACH, elbowL: [0.5, 0.8, 0.5] },
      { t: 12, on: [0], offA: [0.48, 1.36, 0.1], elbowL: [0.9, 0.1, 0] },
      { t: 13, on: [1], offA: [0.22, 1.16, 0.3], offNA: [1, 0, 0.2], elbowL: SIDE_ELBOW },
      { t: 14, hip: [0, -0.07, 0.03], hipR: [9, 10, 0], spine: [8, 6, 0], chest: [4, 14, 0], gripA: [0.14, 1.22, 0.26], dirA: [0.15, -0.7, -0.7], edgeA: [-0.3, 0.6, 0.7] },
      { t: 19, hipR: [9, 4, 0], spine: [8, 3, 0], chest: [4, 8, 0], gripA: [0.08, 1.3, 0.42], dirA: [0.5, -0.75, -0.05], edgeA: [-0.5, 0.5, 0.7], offA: [0.26, 1.2, 0.3], offNA: [0.6, 0, 1] },
      { t: 22, hip: [0, -0.09, 0.06], hipR: [9, -6, 0], spine: [8, -2, 0], chest: [4, -2, 0], gripA: [-0.02, 1.3, 0.56], dirA: [0.55, -0.35, 0.75], edgeA: [-0.6, 0.6, 0.5] },
      { t: 25, hip: [0, -0.09, 0.08], hipR: [8, -16, 0], spine: [6, -5, 0], chest: [2, -10, 0], gripA: [-0.18, 1.42, 0.56], dirA: [0.05, 0.25, 0.97], edgeA: [-0.65, 0.75, 0], offA: [0.12, 1.18, 0.46], offNA: [0.2, 0, 1] },
      { t: 28, hip: [0, -0.08, 0.08], hipR: [6, -26, 0], spine: [4, -7, 0], chest: [0, -16, 0], gripA: [-0.34, 1.58, 0.36], dirA: [-0.5, 0.72, 0.48], edgeA: [-0.7, 0.6, -0.4] },
      { t: 33, hip: [0, -0.08, 0.07], hipR: [6, -28, 0], spine: [4, -7, 0], chest: [0, -17, 0], gripA: [-0.38, 1.58, 0.28], dirA: [-0.55, 0.75, 0.36], edgeA: [-0.7, 0.6, -0.4], offA: [0.06, 1.2, 0.5], offNA: [0.15, 0, 1] },
      { t: 42, gripA: [-0.36, 1.32, 0.2], dirA: [-0.3, 0.85, 0.4], edgeA: [-0.5, -0.3, 0.6] },
    ],
    feet: { R: [[2, 11, -0.11, 0.2, -8, 0.08], [36, 45, -0.14, -0.2, -42, 0.06]], L: [[9, 24, 0.1, 0.3, 5, 0.09]] },
  });
  trackOf('gb_lunge', B, lunge);

  // ---- 抜刀・納刀 ----
  // 抜刀: 胸を左へひねって右手を左腰の柄へ。鞘の向きに沿って引き抜き、体の左で切っ先を前へ返して構える。左手は背の盾を取る。
  const draw = motion('gb_draw_01', {
    dur: 26, from: sheathed, skipBody: [0, 12],
    keys: [
      { t: 3, offA: VIA },
      { t: 4, hipR: [2, 8, 0], spine: [4, 6, 0], chest: [3, 12, 0], grab: [1], gripA: HILT, dirA: SHEATH, edgeA: SHEATH_EDGE, on: [0] },
      { t: 8, offA: REACH, elbowL: [0.5, 0.8, 0.5] },
      { t: 9, hipR: [2, 6, 0], spine: [3, 4, 0], chest: [2, 8, 0], gripA: [0.1, 1.3, 0.3], dirA: [0.2, -0.75, -0.62], edgeA: [-0.2, 0.5, 0.8] },
      { t: 10, on: [0], offA: [0.48, 1.36, 0.1], elbowL: [0.9, 0.1, 0] },
      { t: 11, on: [1], offA: [0.22, 1.16, 0.3], offNA: [1, 0, 0.2], elbowL: SIDE_ELBOW },
      { t: 12, gripA: [0.04, 1.32, 0.36], dirA: [0.35, -0.75, 0.3], edgeA: [-0.2, -0.2, 0.9] },
      { t: 16, hipR: [2, -6, 0], chest: [2, 0, 0], gripA: [-0.1, 1.25, 0.38], dirA: [0.15, -0.1, 0.98], edgeA: [0, -0.9, 0.2] },
      { t: 21, hip: [0, -0.04, 0], hipR: [3, -20, 0], gripA: [-0.26, 1.15, 0.24], dirA: [0.1, 0.6, 0.8], edgeA: [0.2, -0.6, 0.75], offA: [0.12, 1.22, 0.3], offNA: [0.4, 0, 1] },
    ],
    feet: { L: [[8, 16, 0.1, 0.2, 6, 0.04]], R: [[16, 23, -0.14, -0.2, -42, 0.04]] },
  });
  trackOf('gb_draw', B, draw);
  // 納刀: 盾を左の脇から背へ回し、切っ先を鞘口へ合わせて、鞘の向きに沿って納める。
  const sheathe = motion('gb_sheathe_01', {
    dur: 30, from: idle, to: sheathed, skipBody: [12, 30],
    keys: [
      { t: 7, hipR: [2, -10, 0], gripA: [-0.12, 1.25, 0.36], dirA: [0.15, -0.1, 0.98], edgeA: [0, -0.9, 0.2], offA: [0.22, 1.16, 0.3], offNA: [1, 0, 0.2], elbowL: SIDE_ELBOW, on: [1] },
      { t: 8, on: [0] },
      { t: 11, hipR: [2, 6, 0], spine: [3, 4, 0], chest: [2, 8, 0], gripA: [0.04, 1.32, 0.36], dirA: [0.35, -0.75, 0.3], edgeA: [-0.2, -0.2, 0.9] },
      { t: 13, offA: REACH, elbowL: [0.5, 0.8, 0.5] },
      { t: 15, hipR: [2, 8, 0], spine: [4, 6, 0], chest: [3, 12, 0], gripA: [0.1, 1.3, 0.3], dirA: [0.2, -0.75, -0.62], edgeA: [-0.2, 0.5, 0.8] },
      { t: 21, offA: VIA },
      { t: 22, hipR: [2, 8, 0], spine: [4, 6, 0], chest: [3, 12, 0], gripA: HILT, dirA: SHEATH, edgeA: SHEATH_EDGE, grab: [1] },
    ],
    feet: { R: [[4, 12, -0.095, 0, -4, 0.04]], L: [[14, 22, 0.095, 0, 4, 0.04]] },
  });
  trackOf('gb_sheathe', B, sheathe);

  // ---- 技のデータ ----
  const cut = (t, coef, o = {}) => [{ id: 'blade_main', track: t, coef, hitstop: 2, ...o }];
  action('slash1', { clip: 'gb_slash1_01', dur: 26, active: [8, 13], track: 'gb_slash1', hits: cut('gb_slash1', 0.28), curve: 'w_step_015', turn: [6, 360], sound: [7, 'hb_swing_02'], cancels: [[14, 26, ['gb_slash2', 'gb_bash', 'roll']]] });
  action('slash2', { clip: 'gb_slash2_01', dur: 26, active: [7, 12], track: 'gb_slash2', hits: cut('gb_slash2', 0.3), curve: 'w_step_015', turn: [5, 360], sound: [6, 'hb_swing_02'], cancels: [[13, 26, ['gb_thrust', 'gb_bash', 'roll']]] });
  action('thrust', { clip: 'gb_thrust_01', dur: 36, active: [11, 16], track: 'gb_thrust', hits: cut('gb_thrust', 0.42, { hitstop: 3 }), curve: 'w_step_030', turn: [8, 360], sound: [10, 'hb_swing_02'], cancels: [[23, 36, ['gb_bash', 'roll']]] });
  action('bash', { clip: 'gb_bash_01', dur: 36, active: [11, 16], track: 'gb_bash_sword', offhandTrack: 'gb_bash_shield', hits: [{ id: 'shield', track: 'gb_bash_shield', coef: 0.25, type: 'blunt', hitstop: 4 }], trail: false, curve: 'w_step_040', turn: [8, 360], sound: [10, 'hb_swing_01'], cancels: [[22, 36, ['gb_slash1', 'roll']]] });
  action('lunge', { clip: 'gb_lunge_01', dur: 50, active: [22, 28], track: 'gb_lunge', hits: cut('gb_lunge', 0.45, { hitstop: 3 }), curve: 'w_lunge_120', turn: [12, 240], sound: [21, 'hb_swing_02'], events: [{ tick: 3, type: 'sound', id: 'hb_draw_01' }], cancels: [[35, 50, ['gb_slash1', 'gb_bash', 'roll']]] });
  action('draw', { clip: 'gb_draw_01', dur: 26, track: 'gb_draw', sound: [3, 'hb_draw_01'] });
  action('sheathe', { clip: 'gb_sheathe_01', dur: 30, track: 'gb_sheathe', sound: [18, 'hb_sheathe_01'], finish: 'sheathed_idle' });
}
