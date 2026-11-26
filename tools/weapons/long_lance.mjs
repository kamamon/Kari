// 長尖槍（ランス）の技と動き。右手に槍（全長 2.9m。握りから穂先まで 2.36m、石突まで 0.54m）、左腕に大盾。
// 槍は右の脇に抱え（石突が脇の下を通る）、腰の回転と踏み込みで突く。盾は体の前から外さない。
// v0.59.0 で 2G の組み立てへ（#19 の H03 の 01 の 5 章の表。docs/spec.md の 32.25、D-153。動きも 2G を手本に。D-150）:
// 主 = 中段突き、副 = 上段突き（中段と上段を混ぜて 3 回まで）、主と副の同時押し = 突進（走り続けてスタミナを使い、何度も当たる。
// 主でフィニッシュ突き、副で止まる。時間かスタミナが尽きると止まる）、防御を構えたまま歩く・主で構え突き。受け返し（カウンター）は外した。
// 回避は短い跳び（前へは跳ばない: 入力なし・前 = 後ろ、左右 = 横、後ろ = 大きく後ろへ）。
// 座標はアクターのローカル（m、Y 上、+Z 前、+X 左）。数値は机上の初期値（Kari の仮の値）。
import { curve, family, sheathOf } from './lib.mjs';

export function longLance() {
  // 手首: 抱えた槍は前腕とほぼ同じ向きになる
  const hands = { primary: 'R', second: 'shield', shieldGrip: [-0.118, 0.033, -0.045], wrist: [0, 142] };
  const { fam, motion, snap, trackOf, action, pose } = family('long_lance', hands, { from: 0.3, to: 2.36, radius: 0.03, maxTurn: 900 });
  const TIP = { radius: 0.1, from: 0.9, to: 2.36 };
  // 背に立てて負った時の、握りの位置と槍の向き（胸の座標）。握りが右の肩甲骨の上、穂先は真上。背と、背負った大盾のあいだに通る。
  const BACK = { grip: [-0.16, 0.14, -0.17], dir: [0.06, 0.995, -0.05], edge: [0, 0.05, 0.99] };
  fam.sheath = sheathOf('chest', [-0.16, 0.42, -0.17], BACK.dir, BACK.edge);
  /** 肩越しに背の槍へ手を伸ばす時の、ひじの向き（上・外・前） */
  const OVER = [-0.5, 0.8, 0.5];
  /** 背の盾へ左手を伸ばす所 */
  const SHIELD_REACH = [0.3, 1.66, -0.06];
  /** 左手が、下げた位置と背の盾のあいだで通る所（肩の外を回す） */
  const VIA = [0.46, 1.42, 0.18];
  /** 背から槍を体の右へ出す途中（手は肩の外を通る） */
  const AROUND = { grip: [-0.4, 0.16, 0.08], dir: [0.05, 0.98, 0.15], edge: [0, -0.15, 0.98], elbowR: [-0.8, 0.4, 0.1] };
  const E = [0, -1, 0]; // 槍に刃の向きは無いので、下に固定する
  const SHIELD_ELBOW = [0.85, -0.5, 0.15];
  /** 盾を背から左腕へ移した時の、左ひじの向き（真下。ひじを脇に付けて前腕を前へ水平に出し、盾を立てたまま体の横に持つ） */
  const SIDE_ELBOW = [0.25, -0.95, -0.2];

  // ---- 立ち姿 ----
  // 構え: 左足が前。腰を落として盾を体の前に立て、槍は右の脇に抱えて穂先を少し上げる。
  const idle = (fam.stances.idle = pose({
    feet: { L: [0.1, 0.22, 6], R: [-0.15, -0.22, -45] },
    hip: [0, -0.08, 0], hipR: [4, -34, 0], spine: [5, -4, 0], chest: [2, -4, 0],
    gripA: [-0.3, 1.02, 0.1], dirA: [0.06, 0.07, 1], edgeA: E,
    offA: [-0.02, 1.1, 0.36], offNA: [0.12, 0, 1], elbowL: SHIELD_ELBOW, on: [1],
  }));
  // 防御: さらに腰を落とし、盾の陰に体を入れる。槍は引いて盾の縁に沿わせる。
  const guard = (fam.stances.guard = pose({
    feet: { L: [0.1, 0.24, 6], R: [-0.16, -0.24, -48] },
    hip: [0, -0.17, -0.02], hipR: [8, -36, 0], spine: [9, -4, 0], chest: [4, -4, 0], look: [0, -3],
    gripA: [-0.32, 0.95, -0.02], dirA: [0.06, 0.1, 1], edgeA: E,
    offA: [-0.05, 1.14, 0.36], offNA: [0.05, 0.05, 1], elbowL: SHIELD_ELBOW, on: [1],
  }));
  const sheathed = (fam.stances.sheathed = pose({
    feet: { L: [0.095, 0, 4], R: [-0.095, 0, -4] },
    grip: BACK.grip, dir: BACK.dir, edge: BACK.edge,
    off: [0.235, -0.555, 0.07], offNA: [1, 0, 0], on: [0], grab: [0],
  }));

  curve('w_lunge_200', [[0, 0], [8, 0], [42, 2.0], [48, 2.05], [66, 2.05]]);
  curve('w_hop_120', [[0, 0], [4, 0.04], [20, 1.16], [24, 1.2], [26, 1.2]]);

  /**
   * 突き。溜め（槍を引いて腰を右へ）→ 腰を左へ回しながら腕を伸ばす → 止める → 戻す。
   * o = { dur, a0, a1, from, to, step（左足の出し方）, reach（伸ばした握りの位置）, aim（槍の向き）, back（引いた握りの位置）, low（腰の落とし）}
   */
  const thrust = (clip, o) => {
    const { a0, a1 } = o;
    const low = o.low ?? 0;
    return motion(clip, {
      dur: o.dur, from: o.from ?? idle, to: o.to, root: o.root,
      keys: [
        { t: a0 - 5, hip: [0, -0.09 - low, -0.04], hipR: [4, -44, 0], spine: [5, -6, 0], chest: [2, -8, 0], gripA: o.back, dirA: o.aim, edgeA: E, offA: o.shield ?? [-0.02, 1.1, 0.38] },
        { t: a0, hip: [0, -0.1 - low, 0.01], hipR: [6, -28, 0], spine: [6, -3, 0], chest: [3, -2, 0], gripA: [(o.back[0] + o.reach[0]) / 2 - 0.02, (o.back[1] + o.reach[1]) / 2, o.back[2] * 0.45 + o.reach[2] * 0.55], dirA: o.aim, edgeA: E },
        { t: a1 - 2, hip: [0, -0.11 - low, 0.07], hipR: [8, -10, 0], spine: [8, 2, 0], chest: [4, 8, 0], gripA: o.reach, dirA: o.aim, edgeA: E, offA: o.shieldEnd ?? [0.06, 1.08, 0.34] },
        { t: a1 + 5, hip: [0, -0.11 - low, 0.06], hipR: [8, -12, 0], spine: [8, 2, 0], chest: [4, 7, 0], gripA: [o.reach[0], o.reach[1], o.reach[2] - 0.03], dirA: o.aim, edgeA: E, offA: o.shieldEnd ?? [0.06, 1.08, 0.34] },
      ],
      feet: o.feet,
    });
  };
  const STEP15 = { L: [[3, 9, 0.1, 0.255, 6, 0.04]], R: [[22, 29, -0.15, -0.22, -45, 0.04]] };

  // ---- 突き（3 連まで同じ動き）----
  const t1 = thrust('ll_thrust_01', { dur: 38, a0: 10, a1: 15, root: 'w_step_015', back: [-0.33, 1.05, -0.12], reach: [-0.2, 1.12, 0.52], aim: [0.02, 0.02, 1], feet: STEP15 });
  trackOf('ll_thrust', TIP, t1);
  // ---- 上段突き（v0.59.0 で 2G を手本に作り直した）: 槍を脇から外して肩の上へ持ち上げ、盾の上から、斜め上の高い所を突く ----
  // 右ひじを外へ張って握りを肩より上へ上げ（〜7）、腰を左へ回しながら腕を伸ばして突き出し（12〜17）、槍を脇へ戻して構えへ。
  // 中段（脇に抱えて正面へ）と、構え・槍の通り道で見分けられるようにする。v0.58.0 までは、脇に抱えたまま穂先を上げて突いた
  const AUTO_LOW = [-0.55, -0.75, -0.35]; // 手が肩より下の時の、ひじの向きの自動（胸の座標）
  const HIGH_ELBOW = [-0.85, 0.1, -0.45];
  const high = motion('ll_high_01', {
    dur: 42, from: idle, root: 'w_step_015',
    keys: [
      { t: 1, elbowR: AUTO_LOW },
      { t: 7, hip: [0, -0.09, -0.03], hipR: [4, -42, 0], spine: [4, -6, 0], chest: [0, -8, 0], gripA: [-0.3, 1.52, -0.06], dirA: [0.03, 0.2, 0.98], edgeA: E, offA: [-0.02, 1.04, 0.38], elbowR: HIGH_ELBOW },
      { t: 12, hip: [0, -0.1, 0.01], hipR: [6, -28, 0], spine: [6, -3, 0], chest: [2, -2, 0], gripA: [-0.26, 1.57, 0.14], dirA: [0.02, 0.24, 0.97], edgeA: E },
      { t: 15, hip: [0, -0.11, 0.07], hipR: [8, -10, 0], spine: [8, 2, 0], chest: [3, 8, 0], gripA: [-0.21, 1.6, 0.38], dirA: [0.02, 0.27, 0.96], edgeA: E, offA: [0.06, 1.02, 0.34] },
      { t: 22, hip: [0, -0.11, 0.06], hipR: [8, -12, 0], spine: [8, 2, 0], chest: [3, 7, 0], gripA: [-0.21, 1.58, 0.35], dirA: [0.02, 0.27, 0.96], edgeA: E, offA: [0.06, 1.02, 0.34], elbowR: HIGH_ELBOW },
      { t: 26, gripA: [-0.3, 1.38, 0.38], dirA: [0.04, 0.2, 0.98], edgeA: E, elbowR: [-0.8, -0.35, -0.45] },
      { t: 31, hip: [0, -0.09, 0.02], hipR: [5, -28, 0], gripA: [-0.32, 1.14, 0.24], dirA: [0.05, 0.1, 0.99], edgeA: E, elbowR: AUTO_LOW },
    ],
    feet: { L: [[4, 10, 0.1, 0.255, 6, 0.04]], R: [[24, 31, -0.15, -0.22, -45, 0.04]] },
  });
  trackOf('ll_high', TIP, high);
  // ---- 構え突き: 盾の陰から、腰を落としたまま短く突く ----
  const gt = thrust('ll_guard_thrust_01', { dur: 44, a0: 14, a1: 19, from: guard, to: guard, low: 0.07, back: [-0.34, 0.96, -0.12], reach: [-0.24, 1.02, 0.4], aim: [0.03, 0.04, 1], shield: [-0.05, 1.14, 0.36], shieldEnd: [-0.02, 1.13, 0.36] });
  trackOf('ll_guard_thrust', TIP, gt);
  // ---- 突進突き（抜刀攻撃）----
  // 背の槍を取りながら 4 歩走り込み、穂先を前へ倒して脇に抱え、最後の 1 歩で突く。
  const lunge = motion('ll_lunge_01', {
    dur: 66, from: sheathed, root: 'w_lunge_200', skipBody: [0, 16],
    keys: [
      { t: 3, offA: VIA },
      { t: 7, hip: [0, -0.04, 0.03], hipR: [10, -6, 0], spine: [6, -4, 0], chest: [2, -8, 0], grab: [1], grip: BACK.grip, dir: BACK.dir, edge: BACK.edge, elbowR: OVER, on: [0] },
      { t: 9, off: [0.3, 0.22, -0.04], elbowL: [0.5, 0.8, 0.5] },
      { t: 12, ...AROUND },
      { t: 13, offA: [0.48, 1.36, 0.1], elbowL: [0.9, 0.1, 0] },
      { t: 14, on: [0] },
      { t: 15, on: [1], offA: [0.22, 1.16, 0.3], offNA: [1, 0, 0.2], elbowL: SIDE_ELBOW },
      { t: 16, hip: [0, -0.06, 0.04], hipR: [10, -16, 0], spine: [6, -4, 0], chest: [2, -6, 0], grip: [-0.3, 0.06, 0.12], dir: [0.03, 0.9, 0.44], edge: [0, -0.44, 0.9] },
      { t: 17, elbowR: [0, 0, 0] },
      { t: 24, hip: [0, -0.08, 0.04], hipR: [10, -28, 0], spine: [6, -4, 0], chest: [2, -6, 0], gripA: [-0.33, 1.04, -0.06], dirA: [0.04, 0.42, 0.9], edgeA: E, offA: [0.04, 1.1, 0.32], offNA: [0.3, 0, 1] },
      { t: 30, hip: [0, -0.1, 0.02], hipR: [10, -40, 0], spine: [7, -5, 0], chest: [3, -7, 0], gripA: [-0.34, 1.04, -0.12], dirA: [0.03, 0.06, 1], edgeA: E, offA: [-0.02, 1.1, 0.36], offNA: [0.12, 0, 1] },
      { t: 36, hip: [0, -0.12, 0.06], hipR: [11, -22, 0], spine: [8, -1, 0], chest: [4, 2, 0], gripA: [-0.26, 1.08, 0.24], dirA: [0.02, 0.04, 1], edgeA: E },
      { t: 41, hip: [0, -0.14, 0.1], hipR: [12, -8, 0], spine: [10, 3, 0], chest: [5, 9, 0], gripA: [-0.18, 1.1, 0.56], dirA: [0.01, 0.03, 1], edgeA: E, offA: [0.08, 1.06, 0.3] },
      { t: 49, hip: [0, -0.14, 0.09], hipR: [11, -10, 0], spine: [10, 3, 0], chest: [5, 8, 0], gripA: [-0.18, 1.1, 0.53], dirA: [0.01, 0.03, 1], edgeA: E, offA: [0.08, 1.06, 0.3] },
    ],
    feet: {
      R: [[4, 14, -0.11, 0.3, -8, 0.07], [24, 36, -0.12, 0.2, -10, 0.08], [50, 59, -0.15, -0.22, -45, 0.05]],
      L: [[12, 27, 0.1, 0.34, 5, 0.08], [33, 43, 0.1, 0.25, 6, 0.07]],
    },
  });
  trackOf('ll_lunge', TIP, lunge);

  // ---- 跳び（回避）----
  // 沈んで両足で地面を蹴り、低く短く跳んで、構えのまま着く。向きは回避の入力で決まる（体の解き方は同じ）。
  const hop = motion('ll_hop_01', {
    dur: 26, from: idle, root: 'w_hop_120',
    keys: [
      { t: 4, hip: [0, -0.2, 0], hipR: [10, -34, 0], spine: [9, -4, 0] },
      { t: 8, hip: [0, -0.04, 0], hipR: [2, -34, 0], spine: [3, -4, 0] },
      { t: 13, hip: [0, -0.02, 0], hipR: [4, -34, 0], spine: [5, -4, 0] },
      { t: 20, hip: [0, -0.19, 0], hipR: [11, -34, 0], spine: [10, -4, 0] },
    ],
    feet: { R: [[5, 18, -0.15, -0.22, -45, 0.1]], L: [[6, 19, 0.1, 0.22, 6, 0.1]] },
  });
  trackOf('ll_hold', TIP, hop);

  // ---- 突進（主と副の同時押し。v0.59.0。2G のランスの継続突進）----
  // 腰を落として盾を前に据え（〜14）、槍を脇に抱えたまま走り出す。左右の足で交互に地面を蹴って走り続ける（走りには両足の浮く間がある）。
  // 向きは走りながら少しずつ変えられる。時間かスタミナが尽きると止まる（突進の止まり）。主でフィニッシュ突き、副で止まる
  const CHARGE_DUR = 210;
  curve('w_charge', [[0, 0], [14, 0], [24, 0.36], [30, 0.72], [CHARGE_DUR, 0.72 + (3.8 * (CHARGE_DUR - 30)) / 60]]);
  const RUN = { hipR: [10, -24, 0], spine: [12, -4, 0], chest: [4, -4, 0], gripA: [-0.3, 1.0, 0.16], dirA: [0.04, -0.04, 1], edgeA: E, offA: [-0.02, 1.08, 0.42], offNA: [0.12, 0, 1] };
  const runKeys = [
    { t: 8, hip: [0, -0.16, 0], hipR: [10, -30, 0], spine: [12, -5, 0], chest: [4, -5, 0], gripA: [-0.32, 0.98, 0.06], dirA: [0.04, -0.06, 1], edgeA: E, offA: [-0.02, 1.08, 0.4] },
    { t: 14, hip: [0, -0.14, 0.03], ...RUN },
  ];
  // 走る間の腰の上下: 足が着いている真ん中で低く、両足が浮く所で高い（5 tick ごと）
  for (let t = 30; t <= CHARGE_DUR; t += 5) runKeys.push({ t, hip: [0, ((t - 30) / 5) % 2 === 0 ? -0.15 : -0.11, 0.04] });
  const runSteps = (first, side) => {
    const out = [];
    for (let lift = first; lift <= CHARGE_DUR; lift += 20) out.push([lift, lift + 14, side * 0.1, 0.2, side * 6, 0.1]);
    return out;
  };
  const charge = motion('ll_charge_01', {
    dur: CHARGE_DUR, from: idle, to: null, root: 'w_charge',
    keys: runKeys,
    feet: { R: runSteps(14, -1), L: runSteps(24, 1) },
  });
  trackOf('ll_charge', TIP, charge);
  // フィニッシュ突き: 走った勢いのまま、槍を引いて大きく踏み込み、突き抜く
  curve('w_charge_fin', [[0, 0], [4, 0.28], [10, 0.72], [16, 0.95], [22, 1.02], [44, 1.02]]);
  const RUN_SNAP = snap(charge, 57);
  const chargeFinish = motion('ll_charge_finish_01', {
    dur: 44, from: RUN_SNAP, root: 'w_charge_fin',
    keys: [
      { t: 4, hip: [0, -0.15, 0.0], hipR: [8, -32, 0], spine: [8, -5, 0], chest: [3, -6, 0], gripA: [-0.34, 1.02, -0.02], dirA: [0.03, 0.02, 1], edgeA: E, offA: [0.02, 1.1, 0.4] },
      { t: 10, hip: [0, -0.16, 0.06], hipR: [10, -22, 0], spine: [10, -1, 0], chest: [5, 3, 0], gripA: [-0.24, 1.08, 0.4], dirA: [0.02, 0.02, 1], edgeA: E },
      { t: 16, hip: [0, -0.17, 0.1], hipR: [12, -8, 0], spine: [12, 3, 0], chest: [6, 9, 0], gripA: [-0.18, 1.1, 0.62], dirA: [0.01, 0.02, 1], edgeA: E, offA: [0.08, 1.06, 0.3] },
      { t: 26, hip: [0, -0.16, 0.08], hipR: [11, -10, 0], spine: [11, 3, 0], chest: [5, 8, 0], gripA: [-0.19, 1.1, 0.58], dirA: [0.01, 0.02, 1], edgeA: E, offA: [0.08, 1.06, 0.3] },
    ],
    feet: { R: [[0, 9, -0.14, 0.0, -30, 0.06], [18, 29, -0.15, -0.22, -45, 0.06]], L: [[5, 16, 0.1, 0.32, 6, 0.08]] },
  });
  trackOf('ll_charge_finish', TIP, chargeFinish);
  // 突進の止まり: 前の足で地面を踏んで勢いを殺し、体を起こして槍を上げ、構えへ戻る
  curve('w_charge_stop', [[0, 0], [6, 0.36], [12, 0.56], [18, 0.64], [34, 0.64]]);
  const chargeStop = motion('ll_charge_stop_01', {
    dur: 34, from: RUN_SNAP, root: 'w_charge_stop',
    keys: [
      { t: 6, hip: [0, -0.17, -0.04], hipR: [6, -30, 0], spine: [2, -6, 0], chest: [-2, -6, 0], gripA: [-0.3, 1.06, 0.02], dirA: [0.04, 0.45, 0.89], edgeA: E, offA: [-0.02, 1.12, 0.38] },
      { t: 14, hip: [0, -0.12, -0.02], hipR: [5, -32, 0], spine: [4, -5, 0], chest: [1, -5, 0], gripA: [-0.31, 1.04, 0.06], dirA: [0.05, 0.25, 0.97], edgeA: E },
    ],
    feet: { R: [[0, 6, -0.14, 0.02, -30, 0.06], [14, 22, -0.15, -0.22, -45, 0.05]], L: [[6, 12, 0.1, 0.3, 6, 0.06]] },
  });
  trackOf('ll_charge_stop', TIP, chargeStop);

  // ---- 大きく後ろへ跳ぶ（後ろへ入れた回避。v0.59.0。2G のランスの大バックステップ）----
  // 深く沈んで両足で蹴り、高く長く後ろへ跳んで、構えのまま着く。盾と槍は体の前に保つ
  curve('w_backstep', [[0, 0], [5, 0.05], [25, 1.8], [30, 1.88], [36, 1.88]]);
  const backstep = motion('ll_backstep_01', {
    dur: 36, from: idle, root: 'w_backstep',
    keys: [
      { t: 4, hip: [0, -0.23, 0], hipR: [10, -34, 0], spine: [10, -4, 0] },
      { t: 11, hip: [0, -0.03, 0], hipR: [2, -34, 0], spine: [2, -4, 0] },
      { t: 18, hip: [0, -0.01, 0], hipR: [4, -34, 0], spine: [5, -4, 0] },
      { t: 27, hip: [0, -0.21, 0], hipR: [11, -34, 0], spine: [10, -4, 0] },
    ],
    feet: { R: [[6, 26, -0.15, -0.22, -45, 0.16]], L: [[7, 27, 0.1, 0.22, 6, 0.16]] },
  });
  trackOf('ll_backstep', TIP, backstep);

  // ---- 抜刀・納刀 ----
  // 抜刀: 右手を腰の後ろへ回して槍を取り、体の右へ立てて抜き、穂先を前へ倒して脇に抱える。左手は背の盾を取る。
  const UP = { grip: [-0.3, 0.06, 0.12], dir: [0.03, 0.9, 0.44], edge: [0, -0.44, 0.9] };
  const LOWER = { gripA: [-0.32, 1.1, 0.04], dirA: [0.05, 0.5, 0.86], edgeA: E };
  const draw = motion('ll_draw_01', {
    dur: 34, from: sheathed, skipBody: [0, 14],
    keys: [
      { t: 3, offA: VIA },
      { t: 7, hipR: [2, -8, 0], chest: [0, -6, 0], grab: [1], grip: BACK.grip, dir: BACK.dir, edge: BACK.edge, elbowR: OVER, on: [0] },
      { t: 9, offA: SHIELD_REACH, elbowL: [0.5, 0.8, 0.5] },
      { t: 12, ...AROUND },
      { t: 12, offA: [0.48, 1.36, 0.1], elbowL: [0.9, 0.1, 0] },
      { t: 13, on: [0] },
      { t: 14, on: [1], offA: [0.22, 1.16, 0.3], offNA: [1, 0, 0.2], elbowL: SIDE_ELBOW },
      { t: 16, hipR: [3, -18, 0], ...UP },
      { t: 17, elbowR: [0, 0, 0] },
      { t: 25, hip: [0, -0.06, 0], hipR: [4, -30, 0], ...LOWER, offA: [0.06, 1.12, 0.3], offNA: [0.4, 0, 1] },
    ],
    feet: { L: [[10, 18, 0.1, 0.22, 6, 0.04]], R: [[19, 26, -0.15, -0.22, -45, 0.04]] },
  });
  trackOf('ll_draw', TIP, draw);
  const sheathe = motion('ll_sheathe_01', {
    dur: 40, from: idle, to: sheathed, skipBody: [22, 40],
    keys: [
      { t: 8, hipR: [4, -24, 0], ...LOWER, offA: [0.22, 1.16, 0.3], offNA: [1, 0, 0.2], elbowL: SIDE_ELBOW, on: [1] },
      { t: 9, on: [0] },
      { t: 12, offA: [0.48, 1.36, 0.1], elbowL: [0.9, 0.1, 0] },
      { t: 15, offA: SHIELD_REACH, elbowL: [0.5, 0.8, 0.5] },
      { t: 18, hipR: [3, -14, 0], ...UP },
      { t: 22, offA: VIA },
      { t: 23, ...AROUND },
      { t: 28, hipR: [2, -8, 0], chest: [0, -6, 0], grip: BACK.grip, dir: BACK.dir, edge: BACK.edge, grab: [1], elbowR: OVER },
      { t: 29, grab: [1] },
      { t: 34, grab: [0], elbowR: [0, 0, 0] },
    ],
    feet: { R: [[5, 13, -0.095, 0, -4, 0.04]], L: [[15, 23, 0.095, 0, 4, 0.04]] },
  });
  trackOf('ll_sheathe', TIP, sheathe);

  // ---- 技のデータ ----
  const stab = (t, coef, o = {}) => [{ id: 'tip', track: t, coef, hitstop: 3, ...o }];
  // 中段・上段の突き: 混ぜて 3 回まで（3 回目の後は跳びだけ）。v0.59.0
  const mid = (name, coef, next) =>
    action(name, { clip: 'll_thrust_01', dur: 38, active: [10, 15], track: 'll_thrust', hits: stab('ll_thrust', coef), curve: 'w_step_015', turn: [8, 120], sound: [9, 'hb_swing_02'], cancels: [[18, 38, [...next, 'roll']]] });
  const up = (name, coef, next) =>
    action(name, { clip: 'll_high_01', dur: 42, active: [12, 17], track: 'll_high', hits: stab('ll_high', coef), curve: 'w_step_015', turn: [10, 120], sound: [11, 'hb_swing_02'], cancels: [[22, 42, [...next, 'roll']]] });
  mid('thrust1', 0.36, ['ll_thrust2', 'll_high2']);
  mid('thrust2', 0.42, ['ll_thrust3', 'll_high3']);
  mid('thrust3', 0.72, []);
  up('high1', 0.38, ['ll_thrust2', 'll_high2']);
  up('high2', 0.44, ['ll_thrust3', 'll_high3']);
  up('high3', 0.7, []);
  // 構え突き: 突いている間も防御が有効
  action('guard_thrust', { clip: 'll_guard_thrust_01', dur: 44, active: [14, 19], track: 'll_guard_thrust', hits: stab('ll_guard_thrust', 0.3, { hitstop: 2 }), guardWindows: [{ from: 0, to: 44 }], sound: [13, 'hb_swing_02'], cancels: [[30, 44, ['roll']]] });
  // 突進（v0.59.0）: 16 tick ごとに当たり直す（同じ相手に何度も）。24 tick から毎秒 18 のスタミナを使い、尽きたら止まる。
  // 終わりまで走ると止まる（next）。主でフィニッシュ突き、副で止まる
  const runHits = [];
  for (let k = 0, from = 24; from + 8 <= CHARGE_DUR; k++, from += 16) runHits.push({ id: `tip_${k}`, track: 'll_charge', coef: 0.28, hitstop: 2, from, to: from + 8 });
  action('charge', { clip: 'll_charge_01', dur: CHARGE_DUR, active: [24, runHits[runHits.length - 1].to], track: 'll_charge', hits: runHits, curve: 'w_charge', turn: [CHARGE_DUR, 150], staminaCost: 10,
    sustain: { from: 24, staminaPerSec: 18, out: 'player.long_lance.charge_stop' }, next: 'player.long_lance.charge_stop',
    sound: [12, 'hb_swing_01'], cancels: [[24, CHARGE_DUR, ['ll_charge_finish', 'll_charge_stop']]] });
  action('charge_finish', { clip: 'll_charge_finish_01', dur: 44, active: [10, 16], track: 'll_charge_finish', hits: stab('ll_charge_finish', 0.9, { hitstop: 6 }), curve: 'w_charge_fin', sound: [9, 'hb_swing_01'], cancels: [[34, 44, ['ll_thrust1', 'll_high1', 'roll']]] });
  action('charge_stop', { clip: 'll_charge_stop_01', dur: 34, track: 'll_charge_stop', curve: 'w_charge_stop', sound: [2, 'roll_01'], cancels: [[26, 34, ['ll_thrust1', 'll_high1', 'roll']]] });
  action('lunge', { clip: 'll_lunge_01', dur: 66, active: [34, 46], track: 'll_lunge', hits: stab('ll_lunge', 0.82, { hitstop: 5 }), curve: 'w_lunge_200', turn: [20, 90], sound: [32, 'hb_swing_01'], events: [{ tick: 4, type: 'sound', id: 'hb_draw_01' }], cancels: [[52, 66, ['ll_thrust1', 'll_high1', 'roll']]] });
  // 短い跳び（回避）。後ろ・横へ。続けてもう 1 回跳べる。後ろへ入れると大きく跳ぶ（v0.59.0）
  action('hop', { clip: 'll_hop_01', dur: 26, track: 'll_hold', curve: 'w_hop_120', staminaCost: 14, invulnerable: [{ from: 3, to: 11 }], sound: [3, 'roll_01'], cancels: [[18, 26, ['roll']]], dodge: true });
  action('backstep', { clip: 'll_backstep_01', dur: 36, track: 'll_backstep', curve: 'w_backstep', staminaCost: 20, invulnerable: [{ from: 3, to: 13 }], sound: [4, 'roll_01'], cancels: [[28, 36, ['roll']]], dodge: true });
  action('draw', { clip: 'll_draw_01', dur: 34, track: 'll_draw', sound: [5, 'hb_draw_01'] });
  action('sheathe', { clip: 'll_sheathe_01', dur: 40, track: 'll_sheathe', sound: [28, 'hb_sheathe_01'], finish: 'sheathed_idle' });
}
